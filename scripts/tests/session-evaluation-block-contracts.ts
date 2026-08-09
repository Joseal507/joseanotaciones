import assert from 'node:assert/strict'
import {
  canonicalizeGeneratedSession,
  closeNormalEvaluationBlock,
  createEvaluationBlockProgress,
  markRecoveryReady,
  recordNormalBlockAnswer,
  RecoveryGenerationCoordinator,
  resolveBlockRecovery,
  sessionEvaluationCoverage,
  validateGeneratedSessionEvaluation,
} from '../../lib/adaptive/evaluation/sessionEvaluation'

const raw = {
  steps: [
    { id: 'model-a', type: 'concept', title: 'Perseverancia', content: 'La perseverancia fortalece el vínculo emocional con la afición.', keyPoints: ['perseverancia fortalece vínculo'], importance: 'critical' },
    { id: 'model-b', type: 'concept', title: 'Liderazgo', content: 'Matt Ryan aportó estabilidad y liderazgo durante más de una década.', keyPoints: ['Ryan aportó estabilidad'], importance: 'important' },
    { id: 'model-c', type: 'connection', title: 'Dupla', content: 'Ryan y Jones formaron una conexión ofensiva memorable.', keyPoints: ['Ryan-Jones fue una dupla memorable'], importance: 'important' },
  ],
  evaluationBlocks: [{
    afterStepId: 'model-c',
    coveredStepIds: ['model-a', 'model-b', 'model-c'],
    coveredKeyPoints: ['perseverancia fortalece vínculo', 'Ryan aportó estabilidad', 'Ryan-Jones fue una dupla memorable'],
    questions: [
      {
        type: 'multiple_choice',
        difficulty: 'medium',
        cognitiveTarget: 'comprehension',
        prompt: '¿Qué explica mejor el vínculo entre perseverancia y afición?',
        options: [{ id: 'a', text: 'La constancia fortalece la conexión emocional.' }, { id: 'b', text: 'El estadio sustituye la relación.' }],
        correctAnswer: 'a',
        explanation: 'La perseverancia muestra compromiso sostenido.',
        coveredStepIds: ['model-a'],
        coveredKeyPoints: ['perseverancia fortalece vínculo'],
      },
      {
        type: 'true_false',
        difficulty: 'easy',
        cognitiveTarget: 'recognition',
        prompt: 'Matt Ryan aportó estabilidad y liderazgo durante más de una década.',
        correctAnswer: true,
        explanation: 'Es una afirmación enseñada en la sesión.',
        coveredStepIds: ['model-b'],
        coveredKeyPoints: ['Ryan aportó estabilidad'],
      },
      {
        type: 'multiple_choice',
        difficulty: 'medium',
        cognitiveTarget: 'comprehension',
        prompt: '¿Cuál asociación representa la conexión ofensiva enseñada?',
        options: [{ id: 'a', text: 'Ryan y Jones' }, { id: 'b', text: 'El estadio y la identidad' }],
        correctAnswer: 'a',
        explanation: 'Ryan y Jones constituyeron la dupla descrita.',
        coveredStepIds: ['model-c'],
        coveredKeyPoints: ['Ryan-Jones fue una dupla memorable'],
      },
    ],
  }],
}

const prepared = canonicalizeGeneratedSession(raw, {
  sessionId: 'falcons-session',
  kind: 'learning',
  evaluationMode: 'quick_test',
})
assert.deepEqual(prepared.errors, [])
assert.ok(prepared.session)
assert.deepEqual(prepared.session.steps.map(step => step.id), ['model-a', 'model-b', 'model-c'])
assert.deepEqual(prepared.session.evaluationBlocks.map(block => block.id), ['evaluation_block_1'])
assert.equal(prepared.session.evaluationBlocks[0].questions.length, 3)
assert.equal(validateGeneratedSessionEvaluation(prepared.session, 'quick_test', 'learning').coverageRatio, 1)

const block = prepared.session.evaluationBlocks[0]
let progress = createEvaluationBlockProgress(block)
progress = recordNormalBlockAnswer(progress, block.questions[0], 'b', false, 'recovery-p1')
assert.equal(progress.currentQuestionIndex, 1)
assert.equal(progress.status, 'answering')
assert.deepEqual(progress.failedQuestionIds, [block.questions[0].id])
progress = recordNormalBlockAnswer(progress, block.questions[1], true, true)
assert.equal(progress.currentQuestionIndex, 2)
assert.equal(progress.status, 'answering')
progress = markRecoveryReady(progress, 'recovery-p1')
progress = recordNormalBlockAnswer(progress, block.questions[2], 'a', true)
progress = closeNormalEvaluationBlock(block, progress)
assert.equal(progress.status, 'recovering')
assert.deepEqual(progress.readyRecoveryIds, ['recovery-p1'])
progress = resolveBlockRecovery(progress, 'recovery-p1')
assert.equal(progress.status, 'completed')
assert.equal(sessionEvaluationCoverage(prepared.session, { [block.id]: progress }), 1)

const partialBlock = structuredClone(raw)
partialBlock.evaluationBlocks[0].coveredStepIds = ['model-a']
partialBlock.evaluationBlocks[0].coveredKeyPoints = ['perseverancia fortalece vínculo']
partialBlock.evaluationBlocks[0].questions = [partialBlock.evaluationBlocks[0].questions[0]]
const acceptedPartialBlock = canonicalizeGeneratedSession(partialBlock, {
  sessionId: 'falcons-session',
  kind: 'learning',
  evaluationMode: 'quick_test',
})
assert.equal(acceptedPartialBlock.session, null)
assert.ok(acceptedPartialBlock.errors.some(error => error.includes('blockId=unassigned') && error.includes('model-b|model-c')))
assert.ok(!acceptedPartialBlock.errors.some(error => error.includes('evaluation_block_1:missing=model-b')))

const complementaryPartialBlocks = structuredClone(raw)
complementaryPartialBlocks.evaluationBlocks = [
  {
    ...complementaryPartialBlocks.evaluationBlocks[0],
    afterStepId: 'model-a',
    coveredStepIds: ['model-a'],
    coveredKeyPoints: ['perseverancia fortalece vínculo'],
    questions: [complementaryPartialBlocks.evaluationBlocks[0].questions[0]],
  },
  {
    ...complementaryPartialBlocks.evaluationBlocks[0],
    id: 'model-block-2',
    afterStepId: 'model-c',
    coveredStepIds: ['model-b', 'model-c'],
    coveredKeyPoints: ['Ryan aportó estabilidad', 'Ryan-Jones fue una dupla memorable'],
    questions: complementaryPartialBlocks.evaluationBlocks[0].questions.slice(1),
  },
]
assert.ok(canonicalizeGeneratedSession(complementaryPartialBlocks, {
  sessionId: 'falcons-session',
  kind: 'learning',
  evaluationMode: 'quick_test',
}).session)

const incomplete = structuredClone(raw)
incomplete.evaluationBlocks[0].questions = [incomplete.evaluationBlocks[0].questions[0]]
const rejected = canonicalizeGeneratedSession(incomplete, {
  sessionId: 'falcons-session',
  kind: 'learning',
  evaluationMode: 'quick_test',
})
assert.equal(rejected.session, null)
assert.ok(rejected.errors.includes('SESSION_EVALUATION_COVERAGE:required_steps'))
assert.ok(rejected.errors.includes('SESSION_EVALUATION_COVERAGE:important_key_points'))
assert.ok(rejected.errors.some(error => error.includes('missing=model-b|model-c')))
assert.ok(rejected.errors.some(error => error.includes('Ryan aportó estabilidad')))
assert.ok(rejected.errors.some(error => error.includes('Ryan-Jones fue una dupla memorable')))

const inventedReference = structuredClone(raw)
inventedReference.evaluationBlocks[0].questions[0].prompt = 'Según el Paso 2, ¿qué fortalece el vínculo?'
assert.equal(canonicalizeGeneratedSession(inventedReference, {
  sessionId: 'falcons-session',
  kind: 'learning',
  evaluationMode: 'quick_test',
}).session, null)

const openQuestion = structuredClone(raw)
openQuestion.evaluationBlocks[0].questions[0].type = 'short_response'
delete (openQuestion.evaluationBlocks[0].questions[0] as any).options
openQuestion.evaluationBlocks[0].questions[0].correctAnswer = 'La perseverancia.'
assert.equal(canonicalizeGeneratedSession(openQuestion, {
  sessionId: 'falcons-session',
  kind: 'learning',
  evaluationMode: 'quick_test',
}).session, null)

// ---------------------------------------------------------------------------
// REGRESIÓN: duplicados CROSS-BLOCK en el guard final de canonicalización.
// Antes del fix, el escaneo de duplicados en validateGeneratedSessionEvaluation
// estaba scopeado por bloque (`for (const block of session.evaluationBlocks)`,
// comparando solo `block.questions.slice(0, index)` DENTRO de ese mismo
// bloque). Dos bloques distintos, cada uno individualmente completo y válido,
// podían compartir una pregunta semánticamente duplicada (mismo contenido,
// prompt parafraseado) sin que nada la detectara — ninguna otra validación de
// esta función compara entre bloques. Esto es el mismo patrón cross-block que
// causó el bug real (eval_7_6): el duplicado nunca llegaba a evaluarse contra
// preguntas de otros bloques hasta demasiado tarde.
const crossBlockDuplicateQuestion = structuredClone(prepared.session!.evaluationBlocks[0].questions[0])
crossBlockDuplicateQuestion.id = 'cross-block-dup'
crossBlockDuplicateQuestion.questionText = 'Según el material, ¿qué explica de mejor manera el vínculo entre perseverancia y afición?'
assert.ok(
  crossBlockDuplicateQuestion.questionText !== prepared.session!.evaluationBlocks[0].questions[0].questionText,
  'la pregunta cross-block debe ser un parafraseo (prompt distinto), no un duplicado literal — eso ya lo detectaba signature()',
)
const crossBlockSession = {
  steps: prepared.session!.steps,
  evaluationBlocks: [
    { id: 'cb-1', afterStepId: 'model-a', coveredStepIds: ['model-a'], coveredKeyPoints: ['perseverancia fortalece vínculo'], coveredKeyPointIds: prepared.session!.evaluationBlocks[0].coveredKeyPointIds, questions: [prepared.session!.evaluationBlocks[0].questions[0]] },
    { id: 'cb-2', afterStepId: 'model-a', coveredStepIds: ['model-a'], coveredKeyPoints: ['perseverancia fortalece vínculo'], coveredKeyPointIds: prepared.session!.evaluationBlocks[0].coveredKeyPointIds, questions: [crossBlockDuplicateQuestion] },
  ],
}
const crossBlockValidation = validateGeneratedSessionEvaluation(crossBlockSession, 'quick_test', 'learning')
assert.equal(crossBlockValidation.valid, false, 'un duplicado semántico entre bloques distintos debe invalidar la sesión — cada bloque por separado está completo, solo el cruce entre bloques revela el duplicado')
assert.ok(
  crossBlockValidation.errors.includes('SESSION_EVALUATION_INVALID:duplicate_question:cross-block-dup'),
  `se esperaba duplicate_question:cross-block-dup, se obtuvo: ${JSON.stringify(crossBlockValidation.errors)}`,
)
// El bloque que llegó primero (cb-1) no debe señalarse como el duplicado —
// mismo criterio "primero gana" que el resto del pipeline.
assert.ok(!crossBlockValidation.errors.some(error => error.includes('duplicate_question') && error.includes(prepared.session!.evaluationBlocks[0].questions[0].id)))

async function testCoordinator() {
  let concurrent = 0
  let maxConcurrent = 0
  let providerCalls = 0
  const releases: Array<() => void> = []
  const coordinator = new RecoveryGenerationCoordinator<string>(2)
  const generate = (id: string) => coordinator.run(id, () => new Promise<string>(resolve => {
    providerCalls += 1
    concurrent += 1
    maxConcurrent = Math.max(maxConcurrent, concurrent)
    releases.push(() => {
      concurrent -= 1
      resolve(id)
    })
  }))
  const p1 = generate('p1')
  const duplicateP1 = generate('p1')
  const p2 = generate('p2')
  const p3 = generate('p3')
  assert.equal(coordinator.activeCount, 2)
  assert.equal(coordinator.queueDepth, 1)
  assert.equal(providerCalls, 2)
  releases.shift()?.()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(providerCalls, 3)
  while (releases.length) releases.shift()?.()
  assert.deepEqual(await Promise.all([p1, duplicateP1, p2, p3]), ['p1', 'p1', 'p2', 'p3'])
  assert.equal(maxConcurrent, 2)
  assert.equal(providerCalls, 3)
}

void testCoordinator().then(() => {
  console.log('session-evaluation-block-contracts: 26 contracts PASS')
})
