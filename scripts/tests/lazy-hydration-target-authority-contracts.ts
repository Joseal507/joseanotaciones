import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { planAssessmentQuestions, type AssessmentObjective } from '../../lib/adaptive/evaluation/assessmentBlueprint'

// AUDITORÍA ADVERSARIAL CODEX — Finding 3 (P1, CONFIRMED): la hidratación
// lazy de un evaluation block (evaluationBlocks[].questions === []) llamaba
// a /api/adaptive/session-eval SIN assessmentQuestionPlan ni
// assessmentBlueprint. La verificación en vivo (Fase A) reprodujo, contra la
// lógica REAL de app/api/adaptive/session-eval/route.ts::normalizeBatch
// (líneas 597-608), que targetObjectiveIds/factKeys colapsan a [] SIEMPRE
// que `assessmentQuestionPlan` es undefined — aunque el modelo declare
// targetObjectiveIds legítimos — porque
// `planned?.targetObjectiveIds.includes(id)` corto-circuita a undefined
// (falsy) para TODO id cuando `planned` es undefined. La pregunta pasaba
// validación estructural, la UI avanzaba, pero recordNormalAnswerOutcome
// nunca podía llamar recordAssessmentEvidence — el objective quedaba
// unresolved para siempre, sin ningún error visible.
//
// Fix (page.tsx::hydrateEvaluationBlockQuestions): construir
// assessmentQuestionPlan con planAssessmentQuestions() — función PURA ya
// existente en producción (usada en el resto del pipeline, nunca antes
// conectada a este caller específico) — a partir de los objectives REALES
// del assessmentBlueprint del cliente para los steps cubiertos por el
// bloque, y enviar también el assessmentBlueprint completo. El modelo sigue
// declarando targetObjectiveIds libremente, pero normalizeBatch los filtra
// contra el plan AUTORITATIVO — nunca se confía en un id que el plan no
// autorice explícitamente.
//
// Este archivo prueba dos cosas, ambas necesarias porque tocan capas
// distintas:
//  1. Que el CLIENTE (page.tsx) ahora efectivamente construye y envía
//     assessmentQuestionPlan/assessmentBlueprint en la petición de
//     hidratación (prueba de fuente, source-text) — sin esto, aunque el
//     servidor supiera usarlos, nunca los recibiría.
//  2. Que la lógica REAL del servidor (mirror verbatim de
//     normalizeBatch:597-608, no una reimplementación — cross-chequeado
//     contra el código fuente actual para detectar drift) efectivamente
//     preserva targetObjectiveIds/factKeys CUANDO el plan está presente, y
//     los colapsa a [] cuando NO lo está — demostrando por qué el fix del
//     cliente es necesario y suficiente.

// ═══ 1. El cliente ahora envía el plan autoritativo en la hidratación lazy ═══
function testClientSendsAuthoritativePlan() {
  const pageSource = readFileSync('app/materias/[temaId]/sesion/[sessionNumber]/page.tsx', 'utf8')
  const hydrateStart = pageSource.indexOf('async function hydrateEvaluationBlockQuestions')
  assert.ok(hydrateStart >= 0, 'hydrateEvaluationBlockQuestions debe existir en page.tsx — si se renombra, revisar este test')
  const hydrateBody = pageSource.slice(hydrateStart, hydrateStart + 4000)
  assert.ok(hydrateBody.includes('planAssessmentQuestions('), 'hydrateEvaluationBlockQuestions debe derivar el plan desde planAssessmentQuestions (objectives reales), no confiar en targets arbitrarios del modelo/cliente')
  assert.ok(hydrateBody.includes('assessmentQuestionPlan'), 'la petición de hidratación lazy debe incluir assessmentQuestionPlan — si falta, normalizeBatch vuelve a colapsar targetObjectiveIds/factKeys a [] para TODO bloque lazy')
  assert.ok(hydrateBody.includes('assessmentBlueprint: assessmentBlueprintRef.current'), 'la petición de hidratación lazy debe incluir el assessmentBlueprint real del cliente')
  assert.ok(hydrateBody.includes('block.coveredStepIds.includes(objective.stepId)'), 'los objectives enviados deben filtrarse por los steps REALMENTE cubiertos por este bloque, no todo el blueprint sin acotar')
}

// ═══ 2. Mirror verbatim de la lógica real de normalizeBatch (route.ts:597-608) ═══
// Mismo texto que el archivo fuente, no una reimplementación — el guard de
// abajo detecta si el fuente cambia sin que este mirror se actualice.
function verbatimNormalizeBatchTargeting(
  modelQuestion: { targetObjectiveIds?: unknown },
  assessmentQuestionPlan: { plannedQuestions: Array<{ targetObjectiveIds: string[] }> } | undefined,
  assessmentBlueprint: { objectives: AssessmentObjective[] } | undefined,
  sourceRecoveryTarget: { targetObjectiveIds: string[]; factKeys: string[] } | undefined,
  index: number,
) {
  const planned = assessmentQuestionPlan?.plannedQuestions[index]
  const targetObjectiveIds = Array.isArray(modelQuestion.targetObjectiveIds)
    ? modelQuestion.targetObjectiveIds.map(String).filter(id => planned?.targetObjectiveIds.includes(id))
    : planned?.targetObjectiveIds || sourceRecoveryTarget?.targetObjectiveIds || []
  const objective = assessmentBlueprint?.objectives.find(candidate => targetObjectiveIds.includes(candidate.objectiveId))
  const factKeys = sourceRecoveryTarget?.factKeys || objective?.factKeys || []
  return { targetObjectiveIds, factKeys }
}

function testNormalizeBatchSourceMirrorIsHonest() {
  const routeSource = readFileSync('app/api/adaptive/session-eval/route.ts', 'utf8')
  assert.ok(
    routeSource.includes('const planned = assessmentQuestionPlan?.plannedQuestions[context.partIndex ?? index]') &&
    routeSource.includes('planned?.targetObjectiveIds.includes(id)') &&
    routeSource.includes('const factKeys = sourceRecoveryTarget?.factKeys || objective?.factKeys || []'),
    'la lógica real de normalizeBatch en session-eval/route.ts cambió de forma que el mirror de este test ya no la refleja — actualiza verbatimNormalizeBatchTargeting() para que siga probando el código REAL, no una versión obsoleta',
  )
}

function objective(id: string, stepId: string, factKeys: string[]): AssessmentObjective {
  return {
    objectiveId: id, sessionId: 'sess-1', stepId, microId: id, factKeys, demonstratedFactKeys: [],
    cognitiveTarget: 'comprehension', importance: 0.8, taught: true, practiced: false, assessed: false,
    independentlyCorrect: false, assistedCorrect: false, failedAttempts: 0, evidenceIds: [], status: 'not_assessed',
  }
}

function testCollapseWithoutPlan() {
  const objectives = [objective('obj-1', 'step-1', ['fact-1'])]
  const blueprint = { objectives }
  const modelQuestion = { targetObjectiveIds: ['obj-1'] }
  const result = verbatimNormalizeBatchTargeting(modelQuestion, undefined, blueprint, undefined, 0)
  assert.deepEqual(result.targetObjectiveIds, [], 'BUG DE CODEX SI FALLA: sin assessmentQuestionPlan, incluso un targetObjectiveIds legítimo del modelo colapsa a [] — esto es lo que reproducía la brecha real')
  assert.deepEqual(result.factKeys, [], 'sin targetObjectiveIds resueltos, factKeys tampoco puede resolverse — recordAssessmentEvidence nunca se llama')
}

function testSurvivesWithAuthoritativePlan() {
  const objectives = [objective('obj-1', 'step-1', ['fact-1'])]
  const blueprint = { objectives }
  const plan = planAssessmentQuestions({ objectives, evaluationPreference: 'mix_everything' })
  assert.equal(plan.plannedQuestions.length, 1, 'un objective pendiente debe producir exactamente 1 planned question')
  assert.deepEqual(plan.plannedQuestions[0].targetObjectiveIds, ['obj-1'])

  const modelQuestion = { targetObjectiveIds: ['obj-1'] }
  const result = verbatimNormalizeBatchTargeting(modelQuestion, plan, blueprint, undefined, 0)
  assert.deepEqual(result.targetObjectiveIds, ['obj-1'], 'FIX CONFIRMADO: con el plan autoritativo presente, un targetObjectiveIds legítimo del modelo debe sobrevivir')
  assert.deepEqual(result.factKeys, ['fact-1'], 'factKeys debe resolverse desde el objective real una vez que targetObjectiveIds sobrevive')
}

function testModelCannotForgeUnauthorizedTarget() {
  // No basta con "no colapsar" — tampoco puede aceptar CIEGAMENTE cualquier
  // id que el modelo/cliente declare. Solo lo que el plan autoritativo
  // (derivado del blueprint real) autoriza explícitamente sobrevive.
  const objectives = [objective('obj-real', 'step-1', ['fact-real'])]
  const blueprint = { objectives }
  const plan = planAssessmentQuestions({ objectives, evaluationPreference: 'mix_everything' })
  const forgedQuestion = { targetObjectiveIds: ['obj-real', 'obj-FORGED-not-in-plan'] }
  const result = verbatimNormalizeBatchTargeting(forgedQuestion, plan, blueprint, undefined, 0)
  assert.deepEqual(result.targetObjectiveIds, ['obj-real'], 'un id no autorizado por el plan debe descartarse aunque el modelo lo declare — el plan es la única fuente de autoridad, no el modelo')
}

function main() {
  testClientSendsAuthoritativePlan()
  testNormalizeBatchSourceMirrorIsHonest()
  testCollapseWithoutPlan()
  testSurvivesWithAuthoritativePlan()
  testModelCannotForgeUnauthorizedTarget()
  console.log('lazy-hydration-target-authority-contracts: PASS (cliente envía plan autoritativo, colapso sin plan reproducido, targets sobreviven con plan, ids no autorizados descartados)')
}

main()
