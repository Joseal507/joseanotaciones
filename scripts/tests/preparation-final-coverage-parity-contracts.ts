import assert from 'node:assert/strict'
import {
  diagnoseEvaluationBlock, diagnoseEvaluationCoverage, runSessionPreparationFactory,
  type EvaluationPlan, type PreparedEvaluationBlock, type PreparedEvaluationQuestion,
  type PreparedTeachingContent,
} from '../../lib/ai/sessionPreparationFactory'
import { canonicalizeGeneratedSession, validateGeneratedSessionEvaluation } from '../../lib/adaptive/evaluation/sessionEvaluation'

// REGRESIÓN — bug real reportado en prueba manual con CLUTCH 1, sesión 5,
// DESPUÉS del commit c72a7ec (que sí funcionó: bloques 7/8 se repararon
// correctamente por duplicados). El nuevo fallo ocurre DESPUÉS, en
// session_assembly_validation:
//   SESSION_EVALUATION_COVERAGE:important_key_points
//   missing=step_3:kp:3 ("Sus bases conjugadas son extremadamente fuertes.")
// para un bloque que la preparación YA había declarado EVALUATION_COMPLETE.
//
// CAUSA RAÍZ (confirmada por trazado, no supuesta): diagnoseEvaluationBlock /
// diagnoseEvaluationCoverage (lib/ai/sessionPreparationFactory.ts) solo exigen
// cobertura de keyPoints para steps con importance 'critical' o 'important' —
// un step 'supporting' con keyPoints nunca puede bloquear
// EVALUATION_COMPLETE, por diseño. Pero la canonicalización final
// (canonicalizeGeneratedSession → STRICT COVERAGE BLOCKER, y
// validateGeneratedSessionEvaluation) exige el 100% de los keyPoints de TODOS
// los steps sin filtrar por importance ("todo lo enseñado debe quedar
// evaluado" — ver el comentario ya existente en sessionEvaluation.ts línea
// ~493). route.ts:1071 confirma que 'supporting' es una clasificación REAL y
// común (cualquier bloque del blueprint con importance<80 se mapea a
// 'supporting'), no un caso raro.
//
// Este archivo reproduce el patrón con datos mínimos y deterministas ANTES
// de cualquier fix, usando las funciones REALES de ambas capas — nunca una
// reimplementación paralela de la lógica pedagógica.

const keyPointText = (teaching: PreparedTeachingContent) =>
  new Map(teaching.steps.flatMap(step => step.keyPointIds.map((id, index) => [id, step.keyPoints[index]] as const)))

// Traducción EXACTA de app/api/adaptive/session-teach/route.ts (rawSession),
// copiada literalmente — no una reimplementación paralela — para que el
// comportamiento probado aquí sea el mismo que corre en producción.
function buildRawSession(teaching: PreparedTeachingContent, blocks: PreparedEvaluationBlock[]) {
  const text = keyPointText(teaching)
  return {
    sessionIntro: teaching.introduction,
    sessionClosing: teaching.closing,
    steps: teaching.steps.map(step => ({ ...step, id: step.stepId })),
    evaluationBlocks: blocks.map(block => ({
      id: block.blockId, ...block,
      coveredKeyPoints: block.coveredKeyPointIds.map(id => text.get(id)).filter(Boolean),
      questions: block.questions.map(q => ({
        ...q, id: q.questionId, type: q.format, coveredStepIds: q.targetStepIds,
        coveredKeyPoints: q.targetKeyPointIds.map(id => text.get(id)).filter(Boolean),
        questionText: q.prompt, explanation: q.feedback, targetDimension: q.cognitiveTarget,
      })),
    })),
  }
}

function mcq(overrides: Partial<PreparedEvaluationQuestion> & Pick<PreparedEvaluationQuestion, 'questionId' | 'blockId' | 'targetStepIds' | 'targetKeyPointIds' | 'targetFactKeys' | 'prompt'>): PreparedEvaluationQuestion {
  return {
    id: overrides.questionId, targetObjectiveIds: [], cognitiveTarget: 'comprehension', format: 'multiple_choice',
    questionText: overrides.prompt, options: [{ id: 'a', text: 'Opción correcta' }, { id: 'b', text: 'Opción incorrecta' }],
    correctAnswer: 'a', feedback: 'Explicación.', explanation: 'Explicación.', difficulty: 'medium',
    ...overrides,
  }
}

// --- Escenario mínimo: 1 bloque, 4 steps de importance mixta ---------------
// step_1 critical (1 kp, cubierto) · step_2 important (2 kp, ambos cubiertos)
// · step_3 supporting (1 kp, "Sus bases conjugadas son extremadamente
// fuertes.", equivalente exacto del bug real — NO cubierto) · step_4
// supporting (1 kp, SÍ cubierto — control negativo: un supporting step
// cubierto no debe generar falsos positivos).
function buildScenario(coverStep3 = false) {
  const teaching: PreparedTeachingContent = {
    sessionId: 'chapter_parity', title: 'Ácidos y bases', introduction: 'i', closing: 'c',
    steps: [
      { stepId: 'step_1', id: 'step_1', microId: 'm1', title: 'Definición de ácido', type: 'concept', content: 'c1', keyPoints: ['Definición operativa de ácido'], keyPointIds: ['step_1:kp:1'], factKeys: ['fact_1'], importance: 'critical', cognitiveTarget: 'comprehension', sourceReferences: [] },
      { stepId: 'step_2', id: 'step_2', microId: 'm2', title: 'Pares conjugados', type: 'concept', content: 'c2', keyPoints: ['Definición de par conjugado', 'Relación fuerza ácido/base conjugada'], keyPointIds: ['step_2:kp:1', 'step_2:kp:2'], factKeys: ['fact_2a', 'fact_2b'], importance: 'important', cognitiveTarget: 'comprehension', sourceReferences: [] },
      { stepId: 'step_3', id: 'step_3', microId: 'm3', title: 'Bases conjugadas fuertes', type: 'concept', content: 'c3', keyPoints: ['Sus bases conjugadas son extremadamente fuertes.'], keyPointIds: ['step_3:kp:3'], factKeys: ['fact_3'], importance: 'supporting', cognitiveTarget: 'comprehension', sourceReferences: [] },
      { stepId: 'step_4', id: 'step_4', microId: 'm4', title: 'Nota adicional', type: 'concept', content: 'c4', keyPoints: ['Nota de contexto adicional'], keyPointIds: ['step_4:kp:1'], factKeys: ['fact_4'], importance: 'supporting', cognitiveTarget: 'comprehension', sourceReferences: [] },
    ],
  }
  const plan: EvaluationPlan = {
    blocks: [{
      blockId: 'chapter_parity:evaluation:1', afterStepId: 'step_4',
      coveredStepIds: ['step_1', 'step_2', 'step_3', 'step_4'],
      coveredKeyPointIds: ['step_1:kp:1', 'step_2:kp:1', 'step_2:kp:2', 'step_3:kp:3', 'step_4:kp:1'],
      coveredFactKeys: ['fact_1', 'fact_2a', 'fact_2b', 'fact_3', 'fact_4'],
      targetObjectiveIds: ['o1'], cognitiveTargets: ['comprehension'], recommendedQuestionCount: 4,
      recommendedFormats: ['multiple_choice'], difficulty: 'medium',
    }],
  }
  const questions: PreparedEvaluationQuestion[] = [
    mcq({ questionId: 'q1', blockId: plan.blocks[0].blockId, targetStepIds: ['step_1'], targetKeyPointIds: ['step_1:kp:1'], targetFactKeys: ['fact_1'], prompt: '¿Cuál es la definición operativa de ácido según el material?' }),
    mcq({ questionId: 'q2', blockId: plan.blocks[0].blockId, targetStepIds: ['step_2'], targetKeyPointIds: ['step_2:kp:1', 'step_2:kp:2'], targetFactKeys: ['fact_2a', 'fact_2b'], prompt: '¿Qué relación existe entre la fuerza de un ácido y la de su base conjugada?' }),
    mcq({ questionId: 'q4', blockId: plan.blocks[0].blockId, targetStepIds: ['step_4'], targetKeyPointIds: ['step_4:kp:1'], targetFactKeys: ['fact_4'], prompt: '¿Qué aclara la nota de contexto adicional sobre el tema?' }),
  ]
  if (coverStep3) {
    questions.push(mcq({ questionId: 'q3', blockId: plan.blocks[0].blockId, targetStepIds: ['step_3'], targetKeyPointIds: ['step_3:kp:3'], targetFactKeys: ['fact_3'], prompt: '¿Por qué las bases conjugadas de estos ácidos son extremadamente fuertes?' }))
  }
  const block: PreparedEvaluationBlock = { ...plan.blocks[0], questions }
  return { teaching, plan, block }
}

function main() {
  // ============================================================
  // A — caso exacto equivalente a step_3:kp:3 (supporting, no cubierto)
  // ============================================================
  const incomplete = buildScenario(false)
  const blockDiagnosis = diagnoseEvaluationBlock(incomplete.plan.blocks[0], incomplete.block.questions, incomplete.teaching)
  const coverageDiagnosis = diagnoseEvaluationCoverage(incomplete.teaching, [incomplete.block])

  // Con el fix aplicado, la preparación YA NO debe declarar completo un
  // bloque que deja un keyPoint de un step 'supporting' sin cubrir — debe
  // coincidir con lo que exige la canonicalización final.
  assert.equal(blockDiagnosis.code, 'PARTIAL_EVALUATION_COVERAGE', `diagnoseEvaluationBlock debe detectar step_3:kp:3 faltante (supporting ya no está exento). Diagnóstico: ${JSON.stringify(blockDiagnosis)}`)
  assert.ok(blockDiagnosis.missingImportantKeyPointIds.includes('step_3:kp:3') || blockDiagnosis.missingCriticalKeyPointIds.includes('step_3:kp:3'), `step_3:kp:3 debe aparecer como missing en algún bucket. Diagnóstico: ${JSON.stringify(blockDiagnosis)}`)
  assert.equal(coverageDiagnosis.code, 'PARTIAL_EVALUATION_COVERAGE')
  assert.ok(coverageDiagnosis.affectedBlockIds.includes(incomplete.block.blockId))

  // La canonicalización final SIEMPRE exigió esto (guard final intacto, sin
  // relajar). Verificamos que ambas capas ahora concuerdan: las dos dicen
  // "incompleto" para el MISMO conjunto canónico.
  const rawIncomplete = buildRawSession(incomplete.teaching, [incomplete.block])
  const canonicalIncomplete = canonicalizeGeneratedSession(rawIncomplete, { sessionId: incomplete.teaching.sessionId, kind: 'learning', evaluationMode: 'mix_everything' })
  assert.equal(canonicalIncomplete.session, null, 'la canonicalización final debe seguir rechazando la sesión incompleta — el guard final no se relajó')
  assert.ok(canonicalIncomplete.errors.some(e => e.includes('SESSION_EVALUATION_COVERAGE:important_key_points')))
  assert.ok(canonicalIncomplete.errors.some(e => e.includes('step_3:kp:3')), `se esperaba step_3:kp:3 en los errores: ${JSON.stringify(canonicalIncomplete.errors)}`)

  // ============================================================
  // B — kp:1/kp:2 cubiertos pero NO kp:3 (important) no puede declarar
  //     el bloque completo. Protege el comportamiento YA correcto (steps
  //     'important'), no solo el gap de 'supporting' que causó el bug.
  // ============================================================
  const importantTeaching: PreparedTeachingContent = {
    sessionId: 'chapter_b', title: 't', introduction: 'i', closing: 'c',
    steps: [{ stepId: 'step_x', id: 'step_x', microId: 'mx', title: 'Step X', type: 'concept', content: 'c', keyPoints: ['kp uno', 'kp dos', 'kp tres'], keyPointIds: ['step_x:kp:1', 'step_x:kp:2', 'step_x:kp:3'], factKeys: ['fx1', 'fx2', 'fx3'], importance: 'important', cognitiveTarget: 'comprehension', sourceReferences: [] }],
  }
  const importantBlock: PreparedEvaluationPlanBlockLike = { blockId: 'chapter_b:evaluation:1', afterStepId: 'step_x', coveredStepIds: ['step_x'], coveredKeyPointIds: ['step_x:kp:1', 'step_x:kp:2', 'step_x:kp:3'], coveredFactKeys: ['fx1', 'fx2', 'fx3'], targetObjectiveIds: ['ox'], cognitiveTargets: ['comprehension'], recommendedQuestionCount: 2, recommendedFormats: ['multiple_choice'], difficulty: 'medium' }
  // Prompts topicamente distintos (no una plantilla con una sola palabra
  // variable) — con el dedup semántico (questionSimilarity>=0.8, ver
  // commit c72a7ec) dos preguntas "primer punto clave"/"segundo punto clave"
  // resultan indistinguibles entre sí y se marcarían como duplicado.
  const partialQuestions: PreparedEvaluationQuestion[] = [
    mcq({ questionId: 'qb1', blockId: importantBlock.blockId, targetStepIds: ['step_x'], targetKeyPointIds: ['step_x:kp:1'], targetFactKeys: ['fx1'], prompt: '¿Qué papel cumple la fotosíntesis en la producción de energía celular?', options: [{ id: 'a', text: 'La luz solar se convierte en glucosa' }, { id: 'b', text: 'El oxígeno se convierte en dióxido de carbono' }] }),
    mcq({ questionId: 'qb2', blockId: importantBlock.blockId, targetStepIds: ['step_x'], targetKeyPointIds: ['step_x:kp:2'], targetFactKeys: ['fx2'], prompt: 'Describe la función principal de la mitocondria dentro de la célula eucariota.', options: [{ id: 'a', text: 'Genera ATP mediante respiración' }, { id: 'b', text: 'Almacena información genética' }] }),
  ]
  const importantDiagnosis = diagnoseEvaluationBlock(importantBlock, partialQuestions, importantTeaching)
  assert.equal(importantDiagnosis.code, 'PARTIAL_EVALUATION_COVERAGE')
  assert.deepEqual(importantDiagnosis.missingImportantKeyPointIds, ['step_x:kp:3'])

  // ============================================================
  // C — tras eliminar una pregunta por duplicate/invalid, la cobertura se
  //     recalcula sobre las preguntas REALMENTE aceptadas, no sobre el
  //     tamaño bruto de la lista de entrada.
  // ============================================================
  const structurallyInvalid: PreparedEvaluationQuestion = { ...partialQuestions[1], questionId: 'qb2-invalid', targetKeyPointIds: [] } // sin keyPoints declarados = inválida
  const withInvalid = diagnoseEvaluationBlock(importantBlock, [partialQuestions[0], structurallyInvalid], importantTeaching)
  assert.deepEqual(withInvalid.invalidQuestionIds, ['qb2-invalid'])
  // kp:2 y kp:3 deben seguir figurando como missing — la pregunta inválida no
  // debe contar como cobertura solo por haber estado en el input.
  assert.deepEqual(withInvalid.missingImportantKeyPointIds, ['step_x:kp:2', 'step_x:kp:3'])
  assert.deepEqual(withInvalid.acceptedQuestionIds, ['qb1'])

  // ============================================================
  // D — CONTRATO: preparation EVALUATION_COMPLETE ⇒ validateGeneratedSessionEvaluation
  //     no produce missing coverage sobre el MISMO conjunto canónico.
  // ============================================================
  const complete = buildScenario(true)
  const completeCoverage = diagnoseEvaluationCoverage(complete.teaching, [complete.block])
  assert.equal(completeCoverage.code, 'EVALUATION_COMPLETE', `preparación debía declarar completo: ${JSON.stringify(completeCoverage)}`)

  const rawComplete = buildRawSession(complete.teaching, [complete.block])
  const canonicalComplete = canonicalizeGeneratedSession(rawComplete, { sessionId: complete.teaching.sessionId, kind: 'learning', evaluationMode: 'mix_everything' })
  assert.ok(canonicalComplete.session, `la sesión canónica debía ser válida: ${JSON.stringify(canonicalComplete.errors)}`)
  const finalValidation = validateGeneratedSessionEvaluation(canonicalComplete.session!, 'mix_everything', 'learning')
  assert.equal(finalValidation.uncoveredRequiredStepIds.length, 0, `no debía haber steps sin cubrir: ${JSON.stringify(finalValidation.uncoveredRequiredStepIds)}`)
  assert.equal(finalValidation.coverageRatio, 1)
  assert.deepEqual(finalValidation.coverageFailures, [])
  // Verificación directa del bug real: 0 errores de STRICT COVERAGE BLOCKER.
  assert.ok(!canonicalComplete.errors.some(e => e.includes('SESSION_EVALUATION_COVERAGE')), `no debía haber errores de cobertura estricta: ${JSON.stringify(canonicalComplete.errors)}`)

  console.log('preparation-final-coverage-parity-contracts: A-D PASS (E se valida en el mismo archivo vía runSessionPreparationFactory, ver abajo)')
}

// ============================================================
// E — restore/retry conserva la propiedad: tras recargar el estado
//     persistido (mismo patrón que un 503 real + retry con teachingPreserved),
//     el nuevo diagnóstico sigue exigiendo lo mismo que la canonicalización
//     final — no se "olvida" el requisito de supporting al restaurar.
// ============================================================
async function testRestorePreservesParity() {
  const scenario = buildScenario(false)
  let durable: any = null
  const input = () => ({
    sessionKind: 'learning' as const, generationKey: 'parity-restore', evalPreference: 'mix_everything',
    load: async () => durable, persist: async (s: any) => { durable = structuredClone(s) },
    generateTeaching: async () => scenario.teaching,
    planEvaluations: async () => scenario.plan,
    generateEvaluationBlock: async (block: any) => ({ ...block, questions: scenario.block.questions }),
    repairEvaluationBlock: async () => [
      mcq({ questionId: 'q3-repaired', blockId: scenario.plan.blocks[0].blockId, targetStepIds: ['step_3'], targetKeyPointIds: ['step_3:kp:3'], targetFactKeys: ['fact_3'], prompt: '¿Por qué las bases conjugadas de estos ácidos son extremadamente fuertes?' }),
    ],
  })
  const first = await runSessionPreparationFactory(input())
  // El bloque incompleto (step_3:kp:3 sin cubrir) debe disparar repair y
  // terminar 'ready' — no debe llegar nunca a session-assembly con el hueco.
  assert.equal(first.preparationStatus, 'ready')
  assert.ok(first.generatedEvaluationBlocks[0].questions.some(q => q.questionId === 'q3-repaired'))

  // Simula un segundo request con el MISMO estado persistido (restore real) —
  // no debe regenerar nada y debe conservar la misma cobertura completa.
  const second = await runSessionPreparationFactory(input())
  assert.equal(second.preparationStatus, 'ready')
  const rawRestored = buildRawSession(scenario.teaching, second.generatedEvaluationBlocks)
  const canonicalRestored = canonicalizeGeneratedSession(rawRestored, { sessionId: scenario.teaching.sessionId, kind: 'learning', evaluationMode: 'mix_everything' })
  assert.ok(canonicalRestored.session, `restore debía seguir siendo válido: ${JSON.stringify(canonicalRestored.errors)}`)
  console.log('preparation-final-coverage-parity-contracts: E (restore/retry) PASS')
}

type PreparedEvaluationPlanBlockLike = {
  blockId: string; afterStepId: string; coveredStepIds: string[]; coveredKeyPointIds: string[]; coveredFactKeys: string[]
  targetObjectiveIds: string[]; cognitiveTargets: string[]; recommendedQuestionCount: number
  recommendedFormats: string[]; difficulty: string
}

main()
void testRestorePreservesParity()
