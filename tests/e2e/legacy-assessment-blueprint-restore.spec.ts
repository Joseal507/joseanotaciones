import { expect, test, type Page } from '@playwright/test'
import { scoreQuestion } from '../../lib/adaptive/evaluation/scoring'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'

// AUDITORÍA ADVERSARIAL CODEX — Finding 4 (P1, CONFIRMED): page.tsx::loadContext
// e initCoverage leían cached.assessmentBlueprint / cd.assessmentBlueprint
// directamente, sin pasar por normalizeAssessmentBlueprint. Un blueprint
// legacy persistido ANTES de que sus objectives tuvieran demonstratedFactKeys
// crasheaba con TypeError — en el restore mismo (sesión ya completed) o en la
// primera respuesta nueva (sesión in-progress), vía
// unresolvedFactKeys/recordAssessmentEvidence accediendo
// objective.demonstratedFactKeys sin guard.
//
// Fix: cached.assessmentBlueprint se normaliza UNA VEZ, mutando `cached` in
// -place, justo donde ya se normalizaba evaluationBlocks — así todo lector
// posterior (incluido initCoverage, que también normaliza como defensa en
// profundidad) recibe la versión segura. Fail-closed: si la migración no es
// posible, se descarta (null) y cae al fallback buildAssessmentBlueprint —
// nunca inventa demonstration evidence, nunca preserva mastery falso.

const temaId = 'e2e-legacy-blueprint-tema'
const sessionId = 'e2e-legacy-blueprint-session'
const stepId = 'node-legacy-blueprint'
const factKey = 'fact-legacy-blueprint'
const keyPoints = [factKey]
const legacyObjectiveId = 'obj-legacy-1'

// Blueprint LEGACY intencional: objectiveId + factKeys son los únicos campos
// que normalizeAssessmentObjective exige — deliberadamente SIN
// demonstratedFactKeys, reproduciendo exactamente la forma "de antes de que
// existiera ese campo" que Codex reportó.
function legacyAssessmentBlueprint() {
  return {
    sessionId: 'chapter-legacy',
    version: 1,
    objectives: [
      { objectiveId: legacyObjectiveId, factKeys: [factKey], taught: true, assessed: false, status: 'not_assessed' },
    ],
    // Deliberadamente ausentes: taughtObjectiveIds, assessedObjectiveIds,
    // demonstratedObjectiveIds, unresolvedObjectiveIds, coverageRatio — un
    // blueprint legacy real tampoco los tendría poblados de forma confiable.
  }
}

function buildLearning(withQuestion: boolean) {
  const questions: CanonicalQuestion[] = withQuestion ? [{
    id: 'q-legacy-normal', conceptId: stepId, conceptLabel: 'Concepto legacy', teachingBlockId: stepId,
    questionFamily: 'mcq_best_answer', variant: 'mcq_best_answer', difficulty: 'medium',
    targetDimension: 'comprehension', questionText: 'Pregunta normal sobre el concepto legacy.',
    explanation: 'Explicación.', hint: '',
    estimatedSeconds: 30, evidencesNeeded: 1, factKey, factKeys: keyPoints,
    targetObjectiveIds: [legacyObjectiveId], evidenceProduced: [legacyObjectiveId], coveredStepIds: [stepId], coveredKeyPoints: keyPoints,
    format: 'multiple_choice', options: [{ id: 'a', text: 'Opción correcta' }, { id: 'b', text: 'Opción incorrecta' }], correctAnswer: 'a',
  } as CanonicalQuestion] : []

  return {
    sessionId: 'chapter-legacy', sessionTitle: 'Concepto legacy — aprendizaje', sessionNumber: 2,
    sessionKind: 'learning', materialType: 'general', academicDomain: 'general',
    sessionIntro: 'Aprendizaje del concepto legacy.',
    steps: [{ id: stepId, type: 'concept', title: 'Concepto legacy', content: 'Explicación del concepto legacy.', keyPoints, importance: 'critical', relatedBlockIds: ['block-real'] }],
    sessionClosing: 'Integración terminada.', totalSteps: 1,
    assessmentBlueprint: legacyAssessmentBlueprint(),
    evaluationBlocks: [{ id: 'block-real', afterStepId: stepId, coveredStepIds: [stepId], coveredKeyPoints: keyPoints, questions }],
    evaluationProgress: {}, recoveryQueue: [],
  }
}

async function installLegacyBlueprintSession(page: Page, opts: { completed: boolean; withQuestion: boolean }) {
  const learning = buildLearning(opts.withQuestion)
  await page.route('**/api/study-sessions**', route =>
    route.fulfill({ json: route.request().method() === 'GET' ? { success: true, sessions: [] } : { success: true } }))
  await page.route('**/api/adaptive/session-teach', route => route.fulfill({ json: { success: true, classContent: learning } }))
  await page.route('**/api/adaptive/session-check', route => {
    const body = route.request().postDataJSON()
    const result = scoreQuestion(body.question, body.answer)
    return route.fulfill({ json: { success: true, result: { outcome: result.outcome, correct: result.correct, score: result.score, feedback: result.correct ? 'Respuesta correcta.' : 'Respuesta incorrecta.', errorType: result.errorType } } })
  })
  await page.addInitScript(({ sessionId, temaId, learning, completed }) => {
    const journey = { id: 'journey_legacy_e2e', version: 4, chapters: [{ id: 'chapter-legacy', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['block-real'], unitIds: ['unit-real'] }], totalChapters: 1 }
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['material-legacy'], primaryMaterialId: 'material-legacy', materialNames: ['Concepto legacy'],
      selectedPages: {}, adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80, evalPreference: 'mix_everything', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, academicDomain: 'general', blocks: [{ id: 'block-real' }], topics: [] },
      journey, currentSessionNumber: 2, currentStep: 0,
      completedSessionNumbers: completed ? [2] : [], status: completed ? 'completed' : 'in_progress', adaptiveState: 'studying',
      isProgramComplete: false, unresolvedMicroIds: [], sessionContent: { '2': learning }, recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId, learning, completed: opts.completed })
}

async function readAssessmentBlueprint(page: Page) {
  return page.evaluate(({ sessionId }) => {
    const raw = localStorage.getItem('studyal_adaptive_artifacts_v1')
    if (!raw) return null
    const artifacts = JSON.parse(raw)
    const sessionContent = artifacts?.[sessionId]?.sessionContent
    const key = Object.keys(sessionContent || {})[0]
    return sessionContent?.[key]?.assessmentBlueprint ?? null
  }, { sessionId })
}

test('Caso A: restore de sesión legacy YA completed no crashea y no preserva mastery falso', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', error => pageErrors.push(error))

  // withQuestion:true — un bloque sin preguntas y sin marca lazyGeneration
  // es rechazado por validateSessionEvaluationForKind/cachedIsAcceptable por
  // una razón TOTALMENTE AJENA a Finding 4 (contrato de caché vacío) — eso
  // enmascararía la prueba real. Necesitamos que el caché SEA aceptado para
  // llegar al código de Finding 4.
  await installLegacyBlueprintSession(page, { completed: true, withQuestion: true })
  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)

  // No debe crashear (antes del fix: TypeError en canCompleteSessionFromAssessment
  // -> unresolvedFactKeys, disparado por el restore mismo) NI degradar
  // silenciosamente a un error genérico (el TypeError es capturado por el
  // try/catch de loadContext, así que sin el fix esto NO llega a ser un
  // pageerror sin capturar — se convierte en "No pudimos preparar esta
  // sesión", un resultado real y peor: una sesión antes completada queda
  // inaccesible. Solo "cero pageerror" no basta para demostrar el fix.
  await expect(page.getByText('Algo salió mal')).toHaveCount(0)
  await expect(page.getByText('No pudimos preparar esta sesión')).toHaveCount(0)
  expect(pageErrors, `no debe haber excepciones sin capturar en restore (encontradas: ${pageErrors.map(e => e.message).join(' | ')})`).toHaveLength(0)

  // Fail-closed: un blueprint legacy sin demonstratedFactKeys se normaliza a
  // "nada demostrado" — la sesión NO puede mostrarse como completada solo
  // porque completedSessionNumbers lo afirmaba; debe poder seguir
  // estudiándose. No basta con "no crashea": tampoco puede fabricar mastery.
  await expect(page.getByText('Sesión completada')).toHaveCount(0)

  // Prueba positiva: la sesión debe quedar realmente USABLE (no solo "sin
  // texto de error") — el estudiante puede continuar estudiando el paso.
  await expect(page.getByText('Paso 1 de 1')).toBeVisible()
})

test('Caso B: sesión legacy in-progress acepta nueva evidencia sin crashear ni heredar demonstration falsa', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', error => pageErrors.push(error))

  await installLegacyBlueprintSession(page, { completed: false, withQuestion: true })
  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Paso 1 de 1')).toBeVisible()

  // Nota: localStorage aún refleja el fixture legacy CRUDO tal cual se
  // sembró — la normalización ocurre en memoria (initCoverage -> estado
  // React) y solo se escribe a localStorage en el primer
  // persistAssessmentBlueprint (disparado por una respuesta). La prueba real
  // de que la migración funcionó está en el resultado DESPUÉS de responder:
  // si el objective hubiera heredado basura o el registro hubiera crasheado,
  // esto fallaría o el array tendría algo distinto de exactamente [factKey].

  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await page.getByRole('button', { name: 'Opción correcta' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await expect(page.getByText('✅ ¡Correcto!')).toBeVisible()

  expect(pageErrors, `no debe haber excepciones sin capturar al registrar evidencia nueva (encontradas: ${pageErrors.map(e => e.message).join(' | ')})`).toHaveLength(0)

  const afterAnswer = await readAssessmentBlueprint(page)
  const objectiveAfter = afterAnswer.objectives.find((o: any) => o.objectiveId === legacyObjectiveId)
  expect(objectiveAfter.demonstratedFactKeys, 'tras la migración, demonstratedFactKeys debe contener EXACTAMENTE el nuevo factKey — ni vacío (evidencia perdida) ni con datos heredados del blueprint legacy (mastery falso)').toEqual([factKey])
})
