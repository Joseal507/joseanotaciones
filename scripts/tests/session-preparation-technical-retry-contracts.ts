import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { repairJsonLocally, withTechnicalJsonRetry } from '../../lib/ai/sessionContentGenerationPipeline'
import { parseFactoryJson } from '../../app/api/adaptive/session-teach/route'
import {
  runSessionPreparationFactory,
  type PreparedTeachingContent,
  type EvaluationPlan,
  type PreparedEvaluationQuestion,
  type PreparedEvaluationBlock,
  type SessionPreparationState,
} from '../../lib/ai/sessionPreparationFactory'

// BUG REAL (segunda prueba manual de producto) — chapter_6, remoteCallNumber=3,
// stage=evaluation_block_generation: el proveedor devolvió JSON corrupto
// ("text": "Rojo"\n immunotherapy" — coma y comilla de cierre faltantes).
// JSON.parse falla -> session_stage_parse_failed(INVALID_JSON) ->
// SESSION_PREPARATION_STAGE_FAILED -> 503, sin ningún reintento.
//
// CAUSA RAÍZ: remote() (session-teach/route.ts), la función compartida por
// evaluation_plan_enrichment, evaluation_block_generation e
// incremental_evaluation_repair, no tenía NINGÚN retry técnico — una sola
// respuesta con JSON malformado/truncado terminaba la preparación
// inmediatamente. generateTeachingStrict (teaching_generation) SÍ tenía su
// propio loop de 2 intentos para INVALID_JSON/INVALID_JSON_TRUNCATED — la
// asimetría entre stages es exactamente lo que este bug expone.
//
// FIX: se extrajo withTechnicalJsonRetry (sessionContentGenerationPipeline.ts),
// una función PURA e inyectable — N intentos de una llamada que puede fallar
// al parsear JSON, con la MISMA instrucción pedagógica en cada intento (el
// caller decide si añade aviso de sintaxis en el retry). remote() ahora es
// un wrapper delgado sobre withTechnicalJsonRetry + parseFactoryJson, usado
// uniformemente por los 3 stages que antes carecían de retry por igual.
//
// NOTA DE DISEÑO DE TEST: el SDK de OpenAI (node_modules/openai/_shims/
// node-runtime.js) usa require('node-fetch') internamente — NO respeta
// globalThis.fetch reassignment NI el dispatcher global de undici (ambos
// verificados directamente durante la investigación). Interceptar red real
// exigiría tocar lib/alai.ts solo para hacerlo testeable, lo cual no se
// justifica por este bug. Por eso withTechnicalJsonRetry se extrajo como
// función PURA (sin red) — se prueba directamente aquí (A/B/C/H/J) y las
// garantías de orquestación (D/E/F/G/I) se prueban con
// runSessionPreparationFactory real usando funciones inyectadas que llaman
// esa MISMA función exportada — nunca una reimplementación.

// ═══ Fixture REAL — exactamente el fragmento reportado en producción
// (chapter_6, remoteCallNumber=3): coma y comilla de cierre faltantes tras
// "Rojo", con "immunotherapy" fusionado a la línea siguiente. ═══
const REAL_CORRUPTED_RAW = `{"questions":[{"questionId":"q1","variant":"mcq_best_answer","targetStepIds":["step_1"],"targetKeyPointIds":["step_1:kp:1"],"targetFactKeys":["fact:1"],"targetObjectiveIds":["step_1:objective:comprehension"],"cognitiveTarget":"comprehension","format":"multiple_choice","prompt":"¿Cual es el color correcto?","options":[{"id":"a","text":"Rojo"
 immunotherapy"},{"id":"b","text":"Azul"}],"correctAnswer":"a","feedback":"Correcto.","difficulty":"easy"}]}`
// Truncado a mitad de un string abierto (el corte real de un límite de
// tokens casi siempre cae ahí) — extractBalancedObject NO autocierra dentro
// de un string abierto, así que esto no se repara localmente (a diferencia
// de un truncado limpio tras el último string cerrado, que sí autocierra
// corchetes/llaves — ver H).
const TRUNCATED_RAW = `{"questions":[{"questionId":"q1","variant":"true_false_factual","targetStepIds":["step_1"],"targetKeyPointIds":["step_1:kp:1"],"targetFactKeys":["fact:1"],"targetObjectiveIds":["step_1:objective:comprehension"],"cognitiveTarget":"comprehension","format":"true_false","prompt":"Esta pregunta se corta abruptamente a la mitad de la cadena de texto sin`
const VALID_RAW = JSON.stringify({
  questions: [
    { questionId: 'q-1', variant: 'true_false_factual', targetStepIds: ['step_1'], targetKeyPointIds: ['step_1:kp:1'], targetFactKeys: ['fact:1'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTarget: 'comprehension', format: 'true_false', prompt: 'Afirmación válida sobre step_1.', correctAnswer: true, feedback: 'Correcto.', difficulty: 'easy' },
  ],
})

// ═══ H — el fixture real ("Rojo"\nimmunotherapy") no debe aceptarse como
// válido, ni siquiera vía reparación local (repairJsonLocally) — confirma
// que el retry remoto es genuinamente necesario, no una máscara sobre un
// caso que ya se podía arreglar localmente sin red. ═══
function testH_RealFixtureNeverAccepted() {
  assert.equal(repairJsonLocally(REAL_CORRUPTED_RAW), null, 'H: el fixture real corrupto no debe repararse localmente (sería una heurística insegura, no un fix real)')
  assert.equal(repairJsonLocally(TRUNCATED_RAW), null, 'H: JSON truncado a mitad de string tampoco debe repararse localmente')
  assert.doesNotThrow(() => parseFactoryJson(VALID_RAW), 'H: control — el JSON válido sí debe parsear sin error')
}

// ═══ A — intento 1 corrupto, intento 2 válido → continúa con el valor del
// intento 2, sin fabricar ni aceptar el contenido corrupto. ═══
async function testA_CorruptThenValid() {
  const attempts: string[] = []
  const failedAttempts: number[] = []
  const retriesScheduled: Array<{ attempt: number; next: number }> = []
  const result = await withTechnicalJsonRetry({
    maxAttempts: 2,
    attempt: async (attemptNumber) => { attempts.push(String(attemptNumber)); return attemptNumber === 1 ? REAL_CORRUPTED_RAW : VALID_RAW },
    parse: parseFactoryJson,
    onAttemptFailed: (attemptNumber) => failedAttempts.push(attemptNumber),
    onRetryScheduled: (attemptNumber, nextAttempt) => retriesScheduled.push({ attempt: attemptNumber, next: nextAttempt }),
  })
  assert.deepEqual(attempts, ['1', '2'], 'A: debe hacer exactamente 2 intentos (1 fallido + 1 exitoso)')
  assert.deepEqual(failedAttempts, [1], 'A: solo el intento 1 debe registrarse como fallido')
  assert.deepEqual(retriesScheduled, [{ attempt: 1, next: 2 }], 'A: debe programar el retry del intento 1 al 2')
  assert.equal((result as { questions: unknown[] }).questions.length, 1, 'A: el resultado final debe ser el del intento 2 (válido), nunca el corrupto')
}

// ═══ B — intento 1 truncado, intento 2 válido → continúa. ═══
async function testB_TruncatedThenValid() {
  const attempts: string[] = []
  const result = await withTechnicalJsonRetry({
    maxAttempts: 2,
    attempt: async (attemptNumber) => { attempts.push(String(attemptNumber)); return attemptNumber === 1 ? TRUNCATED_RAW : VALID_RAW },
    parse: parseFactoryJson,
  })
  assert.deepEqual(attempts, ['1', '2'], 'B: debe hacer exactamente 2 intentos')
  assert.equal((result as { questions: unknown[] }).questions.length, 1, 'B: el resultado final debe ser el del intento 2 válido')
}

// ═══ C — dos intentos corruptos → falla cerrado (fail-closed), nunca acepta
// contenido inválido como si fuera válido. ═══
// ═══ J — el presupuesto de retry está acotado: exactamente maxAttempts
// intentos, nunca más (no infinite loop). ═══
async function testC_BothCorrupt_FailClosed_And_J_BoundedRetry() {
  const attempts: string[] = []
  await assert.rejects(
    () => withTechnicalJsonRetry({
      maxAttempts: 2,
      attempt: async (attemptNumber) => { attempts.push(String(attemptNumber)); return attemptNumber === 1 ? REAL_CORRUPTED_RAW : TRUNCATED_RAW },
      parse: parseFactoryJson,
    }),
    /INVALID_JSON/,
    'C: con ambos intentos corruptos debe rechazar (fail-closed), nunca devolver un valor',
  )
  assert.deepEqual(attempts, ['1', '2'], 'J: exactamente 2 intentos, ni uno más — el presupuesto está acotado, no hay loop infinito')

  // J (refuerzo): incluso si attempt() siguiera disponible para más
  // llamadas, withTechnicalJsonRetry nunca invoca más de maxAttempts veces.
  let callCount = 0
  await assert.rejects(() => withTechnicalJsonRetry({
    maxAttempts: 2,
    attempt: async () => { callCount += 1; return REAL_CORRUPTED_RAW },
    parse: parseFactoryJson,
  }))
  assert.equal(callCount, 2, 'J: nunca se invoca attempt() una tercera vez pese a que el mock permitiría infinitas llamadas')
}

// ═══ Wiring — remote() (session-teach/route.ts) debe delegar realmente en
// withTechnicalJsonRetry + parseFactoryJson para evaluation_plan_enrichment,
// evaluation_block_generation e incremental_evaluation_repair, con el mismo
// MAX_STAGE_JSON_ATTEMPTS=2 — no una implementación paralela sin probar. ═══
function testWiring_RemoteUsesSharedRetryHelper() {
  const routeSource = readFileSync('app/api/adaptive/session-teach/route.ts', 'utf8')
  assert.match(routeSource, /const MAX_STAGE_JSON_ATTEMPTS = 2/, 'wiring: presupuesto de retry técnico debe ser 2, explícito')
  assert.match(routeSource, /withTechnicalJsonRetry\(\{\s*maxAttempts: MAX_STAGE_JSON_ATTEMPTS/, 'wiring: remote() debe delegar en withTechnicalJsonRetry con el presupuesto acotado')
  assert.match(routeSource, /parse: parseFactoryJson/, 'wiring: remote() debe parsear con parseFactoryJson (mismo parser que antes, sin heurística nueva)')
  // remote() es la ÚNICA función que llama a planEvaluations/generateEvaluationBlock/
  // repairEvaluationBlock internamente — confirmando que comparten el mismo wrapper.
  assert.match(routeSource, /planEvaluations:async teaching=>\{[^]*?remote\('evaluation_plan_enrichment'/, 'wiring: evaluation_plan_enrichment usa remote()')
  assert.match(routeSource, /generateEvaluationBlock:async\(block,teaching,accepted\)=>\{[^]*?remote\('evaluation_block_generation'/, 'wiring: evaluation_block_generation usa remote()')
  assert.match(routeSource, /repairEvaluationBlock:async\(block,missing[^]*?remote\('incremental_evaluation_repair'/, 'wiring: incremental_evaluation_repair usa remote()')
}

// ═══ D/E/F/G/I — garantías de orquestación con runSessionPreparationFactory
// REAL, usando funciones inyectadas que internamente llaman la MISMA
// withTechnicalJsonRetry + parseFactoryJson que usa remote() en producción
// (nunca una reimplementación) para simular el comportamiento remoto sin
// red real (bloqueada por el SDK, ver nota de diseño arriba). ═══

function fakeRemoteStage(responsesByAttempt: string[]) {
  let callCount = 0
  const attempted: number[] = []
  const failed: number[] = []
  const retried: number[] = []
  const run = () => withTechnicalJsonRetry({
    maxAttempts: 2,
    attempt: async (attemptNumber) => { callCount += 1; attempted.push(attemptNumber); return responsesByAttempt[attemptNumber - 1] ?? responsesByAttempt[responsesByAttempt.length - 1] },
    parse: parseFactoryJson,
    onAttemptFailed: attemptNumber => failed.push(attemptNumber),
    onRetryScheduled: attemptNumber => retried.push(attemptNumber),
  })
  return { run, get callCount() { return callCount }, attempted, failed, retried }
}

async function testDEF_OrchestrationGuarantees() {
  const teaching: PreparedTeachingContent = {
    sessionId: 'sess-retry-orch', title: 'T', introduction: 'i', closing: 'c',
    steps: [
      { stepId: 'step_1', id: 'step_1', microId: 'm1', title: 'T1', type: 'concept', content: 'c1', keyPoints: ['KP1'], keyPointIds: ['step_1:kp:1'], factKeys: ['fact:1'], importance: 'critical', cognitiveTarget: 'comprehension', sourceReferences: [] },
      { stepId: 'step_2', id: 'step_2', microId: 'm2', title: 'T2', type: 'concept', content: 'c2', keyPoints: ['KP2'], keyPointIds: ['step_2:kp:1'], factKeys: ['fact:2'], importance: 'critical', cognitiveTarget: 'comprehension', sourceReferences: [] },
    ],
  }
  const block1Id = 'sess-retry-orch:evaluation:1'
  const block2Id = 'sess-retry-orch:evaluation:2'
  const plan: EvaluationPlan = {
    blocks: [
      { blockId: block1Id, afterStepId: 'step_1', coveredStepIds: ['step_1'], coveredKeyPointIds: ['step_1:kp:1'], coveredFactKeys: ['fact:1'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTargets: ['comprehension'], recommendedQuestionCount: 1, recommendedFormats: ['true_false'], difficulty: 'medium' },
      { blockId: block2Id, afterStepId: 'step_2', coveredStepIds: ['step_2'], coveredKeyPointIds: ['step_2:kp:1'], coveredFactKeys: ['fact:2'], targetObjectiveIds: ['step_2:objective:comprehension'], cognitiveTargets: ['comprehension'], recommendedQuestionCount: 1, recommendedFormats: ['true_false'], difficulty: 'medium' },
    ],
  }
  const block1ValidJson = JSON.stringify({ questions: [{ questionId: 'b1-1', blockId: block1Id, variant: 'true_false_factual', targetStepIds: ['step_1'], targetKeyPointIds: ['step_1:kp:1'], targetFactKeys: ['fact:1'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTarget: 'comprehension', format: 'true_false', prompt: 'El primer concepto enseñado es correcto tal como se describió.', correctAnswer: true, feedback: 'Correcto.', difficulty: 'easy' }] })
  const block2ValidJson = JSON.stringify({ questions: [{ questionId: 'b2-1', blockId: block2Id, variant: 'true_false_factual', targetStepIds: ['step_2'], targetKeyPointIds: ['step_2:kp:1'], targetFactKeys: ['fact:2'], targetObjectiveIds: ['step_2:objective:comprehension'], cognitiveTarget: 'comprehension', format: 'true_false', prompt: 'El segundo concepto, distinto del primero, también es correcto.', correctAnswer: true, feedback: 'Correcto.', difficulty: 'easy' }] })

  const teachingCalls = { count: 0 }
  const planCalls = { count: 0 }
  const block1 = fakeRemoteStage([block1ValidJson]) // válido al primer intento — nunca debe reintentarse
  const block2 = fakeRemoteStage([REAL_CORRUPTED_RAW, block2ValidJson]) // necesita retry

  let persisted: SessionPreparationState | null = null
  const state = await runSessionPreparationFactory({
    sessionKind: 'learning', generationKey: 'test:retry-orchestration', evalPreference: 'mix_everything',
    load: async () => persisted,
    persist: async s => { persisted = s },
    generateTeaching: async () => { teachingCalls.count += 1; return teaching },
    planEvaluations: async () => { planCalls.count += 1; return plan },
    generateEvaluationBlock: async (block): Promise<PreparedEvaluationBlock> => {
      const source = block.blockId === block1Id ? block1 : block2
      const parsed = await source.run() as { questions: PreparedEvaluationQuestion[] }
      return { ...block, questions: parsed.questions }
    },
    repairEvaluationBlock: async () => { throw new Error('D/E/F: no debería requerirse repair pedagógico — ambos bloques ya son válidos y completos') },
  })

  assert.equal(state.preparationStatus, 'ready', 'D/E/F: la preparación debe completarse pese al retry técnico del bloque 2')
  assert.equal(teachingCalls.count, 1, 'D: teaching debe generarse UNA sola vez')
  assert.equal(planCalls.count, 1, 'E: el evaluation plan debe generarse UNA sola vez')
  assert.equal(block1.callCount, 1, 'F: el bloque 1 (ya válido al primer intento) NO debe regenerarse por el retry del bloque 2')
  assert.equal(block2.callCount, 2, 'F: el bloque 2 sí necesitó su propio retry técnico (1 fallo + 1 éxito)')
  assert.deepEqual(block2.failed, [1], 'F: el fallo del bloque 2 debe registrarse en su intento 1')
  const questionIds = state.generatedEvaluationBlocks.flatMap(b => b.questions.map(q => q.questionId))
  assert.ok(questionIds.includes('b1-1') && questionIds.includes('b2-1'), 'D/E/F: ambos bloques deben aparecer completos en el resultado final — nunca el contenido corrupto del bloque 2')
}

async function testG_IncrementalRepairTechnicalRetry() {
  // El step declara DOS keyPoints/factKeys — el bloque inicial solo cubre el
  // primero (q-only), dejando el segundo genuinamente sin cobertura
  // (missingCriticalKeyPointIds/missingFactKeys no vacíos) -> SÍ dispara
  // PARTIAL_EVALUATION_COVERAGE -> repairEvaluationBlock (pedagogical repair,
  // intacto). El repair en sí también pasa por remote() en producción -> debe
  // tener su propio retry técnico si SU respuesta viene corrupta.
  // (recommendedQuestionCount por sí solo NO fuerza repair — la cobertura se
  // mide por steps/keyPoints/factKeys, no por conteo literal de preguntas.)
  const teaching: PreparedTeachingContent = {
    sessionId: 'sess-retry-repair', title: 'T', introduction: 'i', closing: 'c',
    steps: [{ stepId: 'step_1', id: 'step_1', microId: 'm1', title: 'T1', type: 'concept', content: 'c1', keyPoints: ['KP1', 'KP2'], keyPointIds: ['step_1:kp:1', 'step_1:kp:2'], factKeys: ['fact:1', 'fact:2'], importance: 'critical', cognitiveTarget: 'comprehension', sourceReferences: [] }],
  }
  const blockId = 'sess-retry-repair:evaluation:1'
  const plan: EvaluationPlan = { blocks: [{ blockId, afterStepId: 'step_1', coveredStepIds: ['step_1'], coveredKeyPointIds: ['step_1:kp:1', 'step_1:kp:2'], coveredFactKeys: ['fact:1', 'fact:2'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTargets: ['comprehension'], recommendedQuestionCount: 2, recommendedFormats: ['true_false'], difficulty: 'medium' }] }
  const partialBlockJson = JSON.stringify({ questions: [{ questionId: 'q-only', blockId, variant: 'true_false_factual', targetStepIds: ['step_1'], targetKeyPointIds: ['step_1:kp:1'], targetFactKeys: ['fact:1'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTarget: 'comprehension', format: 'true_false', prompt: 'El primer punto enseñado en este paso es correcto.', correctAnswer: true, feedback: 'Correcto.', difficulty: 'easy' }] })
  const repairQuestionJson = JSON.stringify({ questions: [{ questionId: 'q-repair', blockId, variant: 'true_false_factual', targetStepIds: ['step_1'], targetKeyPointIds: ['step_1:kp:2'], targetFactKeys: ['fact:2'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTarget: 'comprehension', format: 'true_false', prompt: 'El segundo punto, faltante en el intento inicial, ahora queda cubierto.', correctAnswer: false, feedback: 'Correcto, es falsa.', difficulty: 'easy' }] })

  const block = fakeRemoteStage([partialBlockJson])
  const repair = fakeRemoteStage([REAL_CORRUPTED_RAW, repairQuestionJson])

  let persisted: SessionPreparationState | null = null
  const state = await runSessionPreparationFactory({
    sessionKind: 'learning', generationKey: 'test:retry-repair', evalPreference: 'mix_everything',
    load: async () => persisted,
    persist: async s => { persisted = s },
    generateTeaching: async () => teaching,
    planEvaluations: async () => plan,
    generateEvaluationBlock: async (b): Promise<PreparedEvaluationBlock> => {
      const parsed = await block.run() as { questions: PreparedEvaluationQuestion[] }
      return { ...b, questions: parsed.questions }
    },
    repairEvaluationBlock: async (): Promise<PreparedEvaluationQuestion[]> => {
      const parsed = await repair.run() as { questions: PreparedEvaluationQuestion[] }
      return parsed.questions
    },
  })

  assert.equal(state.preparationStatus, 'ready', 'G: el repair incremental debe completarse tras su propio retry técnico')
  assert.equal(block.callCount, 1, 'G: el bloque inicial (válido) no debe reintentarse')
  assert.equal(repair.callCount, 2, 'G: el repair necesitó exactamente 2 intentos técnicos (1 corrupto + 1 válido)')
  const questionIds = state.generatedEvaluationBlocks.flatMap(b => b.questions.map(q => q.questionId))
  assert.ok(questionIds.includes('q-only') && questionIds.includes('q-repair'), 'G: la pregunta original válida y la de repair deben coexistir')
}

async function testI_PedagogicalInvalidNeverEntersTechnicalRetry() {
  // El step declara DOS keyPoints/factKeys — el único intento (JSON válido)
  // solo cubre el primero, dejando el segundo genuinamente sin cobertura ->
  // SÍ dispara PARTIAL_EVALUATION_COVERAGE -> repair pedagógico. El punto de
  // este test es que, pese a eso, NUNCA se dispara el camino de retry
  // TÉCNICO (que es solo para JSON.parse fallido — aquí el JSON siempre fue
  // válido, la única razón de repair es cobertura pedagógica).
  const teaching: PreparedTeachingContent = {
    sessionId: 'sess-retry-pedagogical', title: 'T', introduction: 'i', closing: 'c',
    steps: [{ stepId: 'step_1', id: 'step_1', microId: 'm1', title: 'T1', type: 'concept', content: 'c1', keyPoints: ['KP1', 'KP2'], keyPointIds: ['step_1:kp:1', 'step_1:kp:2'], factKeys: ['fact:1', 'fact:2'], importance: 'critical', cognitiveTarget: 'comprehension', sourceReferences: [] }],
  }
  const blockId = 'sess-retry-pedagogical:evaluation:1'
  const plan: EvaluationPlan = { blocks: [{ blockId, afterStepId: 'step_1', coveredStepIds: ['step_1'], coveredKeyPointIds: ['step_1:kp:1', 'step_1:kp:2'], coveredFactKeys: ['fact:1', 'fact:2'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTargets: ['comprehension'], recommendedQuestionCount: 2, recommendedFormats: ['true_false'], difficulty: 'medium' }] }
  const partialButValidJson = JSON.stringify({ questions: [{ questionId: 'q-partial', blockId, variant: 'true_false_factual', targetStepIds: ['step_1'], targetKeyPointIds: ['step_1:kp:1'], targetFactKeys: ['fact:1'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTarget: 'comprehension', format: 'true_false', prompt: 'El primer punto de este paso, JSON perfectamente válido.', correctAnswer: true, feedback: 'Correcto.', difficulty: 'easy' }] })
  const repairJson = JSON.stringify({ questions: [{ questionId: 'q-repair-i', blockId, variant: 'true_false_factual', targetStepIds: ['step_1'], targetKeyPointIds: ['step_1:kp:2'], targetFactKeys: ['fact:2'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTarget: 'comprehension', format: 'true_false', prompt: 'El segundo punto, cubierto ahora por el repair pedagógico.', correctAnswer: false, feedback: 'Correcto, es falsa.', difficulty: 'easy' }] })

  const block = fakeRemoteStage([partialButValidJson])
  const repair = fakeRemoteStage([repairJson])
  let pedagogicalRepairInvoked = false

  let persisted: SessionPreparationState | null = null
  const state = await runSessionPreparationFactory({
    sessionKind: 'learning', generationKey: 'test:retry-pedagogical', evalPreference: 'mix_everything',
    load: async () => persisted,
    persist: async s => { persisted = s },
    generateTeaching: async () => teaching,
    planEvaluations: async () => plan,
    generateEvaluationBlock: async (b): Promise<PreparedEvaluationBlock> => {
      const parsed = await block.run() as { questions: PreparedEvaluationQuestion[] }
      return { ...b, questions: parsed.questions }
    },
    repairEvaluationBlock: async (): Promise<PreparedEvaluationQuestion[]> => {
      pedagogicalRepairInvoked = true
      const parsed = await repair.run() as { questions: PreparedEvaluationQuestion[] }
      return parsed.questions
    },
  })

  assert.equal(state.preparationStatus, 'ready', 'I: cobertura incompleta con JSON válido debe resolverse por repair pedagógico normal')
  assert.equal(block.callCount, 1, 'I: el bloque con JSON válido (aunque incompleto) NO debe reintentarse técnicamente')
  assert.deepEqual(block.failed, [], 'I: el bloque nunca debe registrar un fallo técnico — su JSON siempre fue válido')
  assert.equal(pedagogicalRepairInvoked, true, 'I: debe seguir el camino de diagnóstico de cobertura PEDAGÓGICA existente, no uno nuevo')
  assert.equal(repair.callCount, 1, 'I: el repair pedagógico se invoca una vez y no necesita retry técnico (su JSON es válido)')
}

async function main() {
  testH_RealFixtureNeverAccepted()
  await testA_CorruptThenValid()
  await testB_TruncatedThenValid()
  await testC_BothCorrupt_FailClosed_And_J_BoundedRetry()
  testWiring_RemoteUsesSharedRetryHelper()
  await testDEF_OrchestrationGuarantees()
  await testG_IncrementalRepairTechnicalRetry()
  await testI_PedagogicalInvalidNeverEntersTechnicalRetry()
  console.log('session-preparation-technical-retry-contracts: A-J PASS')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
