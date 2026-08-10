import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { withTechnicalJsonRetry } from '../../lib/ai/sessionContentGenerationPipeline'
import { classifyProviderFailure, shouldFallbackToGroq } from '../../lib/ai/providerPolicy'
import { parseFactoryJson, isTransientProviderError } from '../../app/api/adaptive/session-teach/route'
import {
  runSessionPreparationFactory,
  type PreparedTeachingContent,
  type EvaluationPlan,
  type PreparedEvaluationBlock,
  type SessionPreparationState,
} from '../../lib/ai/sessionPreparationFactory'

// GARANTÍA 1 (verificación post-misión): "un fallo transitorio recuperable
// durante session preparation debe resolverse internamente, sin que el
// usuario necesite presionar Reintentar." Este archivo prueba
// específicamente lo que session-preparation-technical-retry-contracts.ts
// (A-J, ya PASS) NO cubre: fallos que ocurren como un THROW dentro de
// attempt() (proveedor/red) en vez de un JSON inválido devuelto — la ruta
// de código es distinta (isTransientProviderError + el catch de
// withTechnicalJsonRetry alrededor de params.attempt(), no el catch
// alrededor de params.parse()). Usa las funciones REALES exportadas de
// session-teach/route.ts, nunca una reimplementación.

function providerError(status: number, message: string, provider = 'openrouter') {
  const e: any = new Error(message)
  e.providerError = { provider, status, message, body: undefined }
  return e
}

// ═══ 1. isTransientProviderError — clasificación directa, función real ═══
function test1_TransientClassification() {
  assert.equal(isTransientProviderError(providerError(408, 'timeout')), true, 'timeout debe ser transitorio')
  assert.equal(isTransientProviderError(providerError(503, 'network error')), true, '5xx/network debe ser transitorio')
  assert.equal(isTransientProviderError(providerError(429, 'rate limit exceeded')), true, 'rate limit debe ser transitorio')
  assert.equal(isTransientProviderError(providerError(204, 'ALAI_EMPTY_RESPONSE')), true, 'BUG DE ORIGEN SI FALLA: respuesta vacía del proveedor debe ser transitoria (fix de garantías)')
  assert.equal(isTransientProviderError(providerError(401, 'invalid api key')), false, 'auth error NUNCA debe reintentarse contra el mismo proveedor')
  assert.equal(isTransientProviderError(providerError(413, 'context length exceeded')), false, 'context too large NUNCA debe reintentarse (reintentar no cambia el tamaño)')
  assert.equal(isTransientProviderError(providerError(402, 'insufficient credits', 'openrouter')), false, 'BUG DE ORIGEN SI FALLA: OPENROUTER_CREDITS_EXHAUSTED NO debe reintentar el mismo proveedor — debe ir por el fallback de Groq, no por este retry')
  assert.equal(isTransientProviderError(providerError(400, 'INVALID_JSON: unexpected token')), false, 'errores de validación de CONTENIDO (no de proveedor) no deben clasificarse como transitorios aquí — esos los maneja el retry de parse()')
  assert.equal(isTransientProviderError(new Error('no providerError attached')), false, 'un error sin providerError adjunto nunca debe tratarse como transitorio')
}

// ═══ 2. withTechnicalJsonRetry + isTransientProviderError REAL — end to end ═══
async function test2_ProviderThrowRetriesAndSucceeds() {
  const cases: Array<{ label: string; err: () => any }> = [
    { label: 'timeout', err: () => providerError(408, 'timeout') },
    { label: 'rate limit', err: () => providerError(429, 'rate limit exceeded') },
    { label: 'empty response (fix)', err: () => providerError(204, 'ALAI_EMPTY_RESPONSE') },
  ]
  for (const { label, err } of cases) {
    let calls = 0
    let retried = 0
    const result = await withTechnicalJsonRetry({
      maxAttempts: 2,
      attempt: async () => { calls += 1; if (calls === 1) throw err(); return '{"blocks":[]}' },
      parse: parseFactoryJson,
      isTransientError: isTransientProviderError,
      onRetryScheduled: () => { retried += 1 },
    })
    assert.deepEqual(result, { blocks: [] }, `${label}: BUG DE ORIGEN SI FALLA: el segundo intento exitoso debe devolver el resultado — el usuario NO debe ver un error`)
    assert.equal(calls, 2, `${label}: debe haber exactamente 2 intentos (1 falla + 1 éxito)`)
    assert.equal(retried, 1, `${label}: debe haberse registrado exactamente 1 reintento`)
  }
}

async function test3_NonTransientNeverRetries() {
  let calls = 0
  await assert.rejects(
    () => withTechnicalJsonRetry({
      maxAttempts: 2,
      attempt: async () => { calls += 1; throw providerError(401, 'invalid api key') },
      parse: parseFactoryJson,
      isTransientError: isTransientProviderError,
    }),
    'BUG DE ORIGEN SI FALLA: un error no transitorio (auth) debe propagarse, nunca resolverse en éxito falso',
  )
  assert.equal(calls, 1, 'BUG DE ORIGEN SI FALLA: un error NO transitorio no debe consumir un segundo intento — falla cerrado inmediatamente (bounded, no desperdicia el presupuesto)')
}

async function test4_PersistentTransientFailureBoundedThenErrors() {
  let calls = 0
  await assert.rejects(
    () => withTechnicalJsonRetry({
      maxAttempts: 2,
      attempt: async () => { calls += 1; throw providerError(503, 'network error') },
      parse: parseFactoryJson,
      isTransientError: isTransientProviderError,
    }),
  )
  assert.equal(calls, 2, 'BUG DE ORIGEN SI FALLA: un fallo transitorio PERSISTENTE debe agotar exactamente maxAttempts (bounded) y solo entonces fallar — nunca menos (perdería la oportunidad de recuperación), nunca más (reintentos infinitos)')
}

async function test5_CreditsExhaustedNeverBypassesPolicyInsideThisRetry() {
  // OPENROUTER_CREDITS_EXHAUSTED NO debe reintentarse aquí — ese caso lo
  // maneja exclusivamente callWithGroqFallbackOnCreditsExhausted (helper
  // separado, ver test 6), nunca isTransientProviderError/
  // withTechnicalJsonRetry. Si esto reintentara aquí, sería indistinguible
  // de "confiar ciegamente en que reintentar contra OpenRouter con 0
  // créditos vaya a funcionar" — exactamente lo que AGENTS.md prohíbe.
  let calls = 0
  await assert.rejects(
    () => withTechnicalJsonRetry({
      maxAttempts: 2,
      attempt: async () => { calls += 1; throw providerError(402, 'insufficient credits') },
      parse: parseFactoryJson,
      isTransientError: isTransientProviderError,
    }),
  )
  assert.equal(calls, 1, 'BUG DE ORIGEN SI FALLA: OPENROUTER_CREDITS_EXHAUSTED no debe consumir un reintento del mismo proveedor dentro de withTechnicalJsonRetry')
}

// ═══ 6. Groq fallback — solo con evidencia confirmada, nunca especulativo ═══
function test6_GroqFallbackOnlyOnConfirmedCreditsExhausted() {
  const creditsExhausted = { provider: 'openrouter', status: 402, message: 'insufficient credits', body: undefined }
  const timeout = { provider: 'openrouter', status: 503, message: 'network error', body: undefined }
  assert.equal(classifyProviderFailure(creditsExhausted), 'OPENROUTER_CREDITS_EXHAUSTED')
  assert.equal(shouldFallbackToGroq(creditsExhausted), true, 'BUG DE ORIGEN SI FALLA: con evidencia confirmada de créditos agotados, el fallback a Groq debe estar permitido')
  assert.equal(classifyProviderFailure(timeout), 'TEMPORARY_PROVIDER_FAILURE')
  assert.equal(shouldFallbackToGroq(timeout), false, 'BUG DE ORIGEN SI FALLA: un timeout transitorio NUNCA debe habilitar Groq — solo OPENROUTER_CREDITS_EXHAUSTED confirmado')
}

function test7_GroqFallbackWiredIntoBothGenerationPaths() {
  const source = readFileSync('app/api/adaptive/session-teach/route.ts', 'utf8')
  assert.match(source, /callWithGroqFallbackOnCreditsExhausted/, 'BUG DE ORIGEN SI FALLA: debe existir el helper de fallback a Groq')
  assert.match(source, /classifyProviderFailure\(providerError\) === 'OPENROUTER_CREDITS_EXHAUSTED'/, 'el fallback debe activarse solo tras clasificación confirmada, nunca especulativamente')
  // remote() — compartido por evaluation_plan_enrichment/evaluation_block_generation/incremental_evaluation_repair.
  assert.match(source, /const generated = await callWithGroqFallbackOnCreditsExhausted\(/, 'BUG DE ORIGEN SI FALLA: remote() debe usar el fallback de Groq, no alai() directo')
  // generateTeachingStrict.
  assert.match(source, /generated=await callWithGroqFallbackOnCreditsExhausted\(/, 'BUG DE ORIGEN SI FALLA: generateTeachingStrict debe usar el fallback de Groq, no alai() directo')
}

// ═══ 8. Orquestación real: fallo de proveedor transitorio en un bloque no
// regenera teaching, no duplica bloques ya aceptados, y el estado final
// contiene TODO el contenido válido — mismo patrón que testDEF_
// OrchestrationGuarantees en session-preparation-technical-retry-contracts.ts,
// pero con un THROW de proveedor (no JSON corrupto) como modo de fallo. ═══
function fakeProviderStage(behaviors: Array<'transient_fail' | string>) {
  let callCount = 0
  const run = () => withTechnicalJsonRetry({
    maxAttempts: 2,
    attempt: async () => {
      callCount += 1
      const behavior = behaviors[callCount - 1] ?? behaviors[behaviors.length - 1]
      if (behavior === 'transient_fail') throw providerError(503, 'network error')
      return behavior
    },
    parse: parseFactoryJson,
    isTransientError: isTransientProviderError,
  })
  return { run, get callCount() { return callCount } }
}

async function test8_ProviderTransientFailureInOneBlockDoesNotAffectOthers() {
  const teaching: PreparedTeachingContent = {
    sessionId: 'sess-provider-resilience', title: 'T', introduction: 'i', closing: 'c',
    steps: [
      { stepId: 'step_1', id: 'step_1', microId: 'm1', title: 'T1', type: 'concept', content: 'c1', keyPoints: ['KP1'], keyPointIds: ['step_1:kp:1'], factKeys: ['fact:1'], importance: 'critical', cognitiveTarget: 'comprehension', sourceReferences: [] },
      { stepId: 'step_2', id: 'step_2', microId: 'm2', title: 'T2', type: 'concept', content: 'c2', keyPoints: ['KP2'], keyPointIds: ['step_2:kp:1'], factKeys: ['fact:2'], importance: 'critical', cognitiveTarget: 'comprehension', sourceReferences: [] },
    ],
  }
  const block1Id = 'sess-provider-resilience:evaluation:1'
  const block2Id = 'sess-provider-resilience:evaluation:2'
  const plan: EvaluationPlan = {
    blocks: [
      { blockId: block1Id, afterStepId: 'step_1', coveredStepIds: ['step_1'], coveredKeyPointIds: ['step_1:kp:1'], coveredFactKeys: ['fact:1'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTargets: ['comprehension'], recommendedQuestionCount: 1, recommendedFormats: ['true_false'], difficulty: 'medium' },
      { blockId: block2Id, afterStepId: 'step_2', coveredStepIds: ['step_2'], coveredKeyPointIds: ['step_2:kp:1'], coveredFactKeys: ['fact:2'], targetObjectiveIds: ['step_2:objective:comprehension'], cognitiveTargets: ['comprehension'], recommendedQuestionCount: 1, recommendedFormats: ['true_false'], difficulty: 'medium' },
    ],
  }
  const block1ValidJson = JSON.stringify({ questions: [{ questionId: 'pb1-1', blockId: block1Id, variant: 'true_false_factual', targetStepIds: ['step_1'], targetKeyPointIds: ['step_1:kp:1'], targetFactKeys: ['fact:1'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTarget: 'comprehension', format: 'true_false', prompt: 'El primer concepto enseñado es correcto tal como se describió.', correctAnswer: true, feedback: 'Correcto.', difficulty: 'easy' }] })
  const block2ValidJson = JSON.stringify({ questions: [{ questionId: 'pb2-1', blockId: block2Id, variant: 'true_false_factual', targetStepIds: ['step_2'], targetKeyPointIds: ['step_2:kp:1'], targetFactKeys: ['fact:2'], targetObjectiveIds: ['step_2:objective:comprehension'], cognitiveTarget: 'comprehension', format: 'true_false', prompt: 'El segundo concepto, distinto del primero, también es correcto.', correctAnswer: true, feedback: 'Correcto.', difficulty: 'easy' }] })

  const teachingCalls = { count: 0 }
  const block1 = fakeProviderStage([block1ValidJson]) // válido al primer intento — nunca debe reintentarse
  const block2 = fakeProviderStage(['transient_fail', block2ValidJson]) // fallo de PROVEEDOR (no JSON), luego éxito

  let persisted: SessionPreparationState | null = null
  const state = await runSessionPreparationFactory({
    sessionKind: 'learning', generationKey: 'test:provider-resilience', evalPreference: 'mix_everything',
    load: async () => persisted,
    persist: async s => { persisted = s },
    generateTeaching: async () => { teachingCalls.count += 1; return teaching },
    planEvaluations: async () => plan,
    generateEvaluationBlock: async (block): Promise<PreparedEvaluationBlock> => {
      const source = block.blockId === block1Id ? block1 : block2
      const parsed = await source.run() as { questions: any[] }
      return { ...block, questions: parsed.questions }
    },
    repairEvaluationBlock: async () => { throw new Error('no debería requerirse repair pedagógico — el fallo fue de proveedor, no de contenido') },
  })

  assert.equal(state.preparationStatus, 'ready', 'BUG DE ORIGEN SI FALLA: un fallo de proveedor transitorio en un bloque no debe impedir que la preparación complete')
  assert.equal(teachingCalls.count, 1, 'no duplica session content: teaching debe generarse UNA sola vez pese al retry de otro stage')
  assert.equal(block1.callCount, 1, 'el bloque ya válido no debe regenerarse por el fallo de proveedor del otro bloque')
  assert.equal(block2.callCount, 2, 'el bloque con fallo de proveedor debe reintentarse exactamente una vez más')
  const questionIds = state.generatedEvaluationBlocks.flatMap(b => b.questions.map((q: any) => q.questionId))
  assert.deepEqual(new Set(questionIds), new Set(['pb1-1', 'pb2-1']), 'no duplicate questions: el estado final debe contener exactamente una pregunta por bloque, sin duplicados ni pérdida')
}

async function run() {
  test1_TransientClassification()
  await test2_ProviderThrowRetriesAndSucceeds()
  await test3_NonTransientNeverRetries()
  await test4_PersistentTransientFailureBoundedThenErrors()
  await test5_CreditsExhaustedNeverBypassesPolicyInsideThisRetry()
  test6_GroqFallbackOnlyOnConfirmedCreditsExhausted()
  test7_GroqFallbackWiredIntoBothGenerationPaths()
  await test8_ProviderTransientFailureInOneBlockDoesNotAffectOthers()
  console.log('session-preparation-provider-resilience-contracts: PASS (clasificación real de transitoriedad incluyendo ALAI_EMPTY_RESPONSE, retry acotado sobre throws de proveedor, no-transitorios nunca reintentan, fallo persistente acotado antes de error final, credits-exhausted nunca reintenta el mismo proveedor, Groq fallback solo con evidencia confirmada y wireado en ambos paths de generación, orquestación real sin duplicar/perder estado)')
}

run()
