import assert from 'node:assert/strict'
import {
  matchingDisplayOptions,
  normalizeGeneratedQuestion,
  restoreCanonicalQuestion,
  type CanonicalQuestion,
  type GenerationContext,
} from '../../lib/adaptive/evaluation/questionContract'
import { scoreQuestion } from '../../lib/adaptive/evaluation/scoring'
import {
  beginRecoveryReteach,
  beginRecoveryVerification,
  activateRecoveryVerification,
  canCompleteProgramWithRecovery,
  canCompleteSessionWithRecovery,
  createRecoveryQueue,
  deferNormalBlockFailures,
  hasPendingRecovery,
  latestRecoveryFailure,
  mergeRecoveryFailures,
  normalizeRestoredRecoveryItem,
  nextRecoveryItem,
  persistRecoveryVerificationQuestions,
  prepareVerificationGenerationRetry,
  presentRecoveryVerificationQuestion,
  recordRecoveryReteachContent,
  recordRecoveryCheck as recordRecoveryCheckRaw,
  recordVerificationGenerationAttempt,
  recoveryCompletionAudit,
  recoveryDirective,
  releaseNormalBlockRecoveries,
  selectRecoveryStrategy,
  type RecoveryFailure,
  type RecoveryItem,
} from '../../lib/adaptive/evaluation/recoveryQueue'
import type { AssistanceLevel } from '../../lib/adaptive/v3/engine/helpContract'
import type { CanonicalUserAnswer, EvaluationOutcome } from '../../lib/adaptive/evaluation/questionContract'
import { prepareReteachContent } from '../../lib/adaptive/evaluation/reteachContent'
import {
  createDeterministicRecoveryFallback,
  validateDeterministicRecoveryFallback,
} from '../../lib/adaptive/evaluation/recoveryFallback'

const context: GenerationContext = {
  activeConceptId: 'micro-a',
  activeConceptLabel: 'Concepto A',
  teachingBlockId: 'step-a',
  targetDimension: 'comprehension',
  questionFamily: 'matching_concept_def',
  allowedConceptIds: ['micro-a'],
  forbiddenConceptIds: [],
}

function matchingQuestion(size: number, id: string, semantics: 'bijective' | 'many_to_one' = 'bijective') {
  const options = Array.from({ length: size }, (_, index) => ({
    id: `left-${index}`,
    left: index === 0 ? '$x^2$' : index === 1 ? '\\ce{H2O}' : `Símbolo α ${index}`,
    rightId: semantics === 'many_to_one' && index > 0 ? 'shared-right' : `right-${index}`,
    right: semantics === 'many_to_one' && index > 0
      ? 'Respuesta compartida α'
      : index === 0 ? '$y^2$' : index === 1 ? '\\ce{CO2}' : `Texto mixto β ${index}`,
  }))
  return normalizeGeneratedQuestion({
    conceptId: 'micro-a',
    conceptLabel: 'Concepto A',
    variant: 'matching_concept_def',
    targetDimension: 'comprehension',
    difficulty: 'medium',
    questionText: 'Relaciona cada elemento con su representación correspondiente.',
    options,
    correctAnswer: Object.fromEntries(options.map(option => [option.id, option.rightId])),
    matchingSemantics: semantics,
    explanation: 'Cada relación sigue el contenido enseñado.',
    hint: 'Compara el significado de ambos lados.',
    factKey: `matching:${id}`,
  }, context, id)
}

for (const size of [2, 3, 4, 5, 8]) {
  const question = matchingQuestion(size, `matching-${size}`)
  assert(question && question.format === 'matching')
  const source = [...new Set(question.options.map(pair => pair.rightId))]
  assert.notDeepEqual(question.matchingOptionOrder, source, `${size} pares no deben conservar identidad`)
  assert.deepEqual(matchingDisplayOptions(question).map(option => option.id), question.matchingOptionOrder)
  assert.deepEqual(matchingDisplayOptions(question).map(option => option.id), matchingDisplayOptions(question).map(option => option.id))
  assert.equal(scoreQuestion(question, question.correctAnswer).correct, true)
  const restored = restoreCanonicalQuestion(JSON.parse(JSON.stringify(question)), context)
  assert(restored && restored.format === 'matching')
  assert.deepEqual(restored.matchingOptionOrder, question.matchingOptionOrder)
}

const instanceA = matchingQuestion(5, 'instance-a')
const instanceB = matchingQuestion(5, 'instance-b')
assert(instanceA && instanceA.format === 'matching' && instanceB && instanceB.format === 'matching')
assert.notDeepEqual(instanceA.matchingOptionOrder, instanceB.matchingOptionOrder)

const bijective = matchingQuestion(3, 'bijective')
assert(bijective && bijective.format === 'matching')
assert.equal(bijective.matchingSemantics, 'bijective')
assert.equal(new Set(bijective.options.map(option => option.rightId)).size, 3)

const manyToOne = matchingQuestion(3, 'many-to-one', 'many_to_one')
assert(manyToOne && manyToOne.format === 'matching')
assert.equal(manyToOne.matchingSemantics, 'many_to_one')
assert.equal(matchingDisplayOptions(manyToOne).length, 2)
assert.equal(scoreQuestion(manyToOne, manyToOne.correctAnswer).correct, true)

function question(id: string, conceptId = 'micro-a', factKey = `fact:${id}`, text = `Analiza ${id.repeat(8)}.`): CanonicalQuestion {
  const localContext = { ...context, activeConceptId: conceptId, activeConceptLabel: conceptId, allowedConceptIds: [conceptId] }
  const normalized = normalizeGeneratedQuestion({
    conceptId,
    conceptLabel: conceptId,
    variant: 'mcq_best_answer',
    targetDimension: 'comprehension',
    difficulty: 'medium',
    questionText: text,
    options: [{ id: 'yes', text: `Solución específica ${id}` }, { id: 'no', text: `Alternativa distinta ${id}` }],
    correctAnswer: 'yes',
    explanation: 'Explicación',
    hint: 'Pista',
    factKey,
  }, localContext, id)
  assert(normalized)
  return normalized
}

const failure = (q: CanonicalQuestion): RecoveryFailure => ({
  question: q,
  answer: 'no',
  result: { outcome: 'incorrect', correct: false, errorType: 'selection' },
})

function preparedItem(source = question('source')): RecoveryItem {
  const item = createRecoveryQueue([failure(source)])[0]
  const reteaching = beginRecoveryReteach(item, 'contrastive_explanation')
  const explained = recordRecoveryReteachContent(reteaching, `Explicación ${source.id}`)
  return recordVerificationGenerationAttempt(beginRecoveryVerification(explained), true)
}

function recordRecoveryCheck(
  item: RecoveryItem,
  recoveryQuestion: CanonicalQuestion,
  result: { outcome: EvaluationOutcome; correct: boolean; errorType?: string | null },
  assistanceLevel: AssistanceLevel = 'independent',
  studentAnswer: CanonicalUserAnswer = '',
) {
  const roundId = `${item.recoveryId}:round:${item.verificationRound}`
  const alreadyPersisted = item.verificationQuestions.some(entry =>
    entry.roundId === roundId && entry.question.id === recoveryQuestion.id && entry.answeredAt === null)
  let prepared = item
  if (!alreadyPersisted) {
    if (prepared.status === 'verification_active') prepared = { ...prepared, status: 'pending_verification' }
    prepared = persistRecoveryVerificationQuestions(prepared, [recoveryQuestion], 1000 + prepared.verificationQuestions.length)
  }
  const presented = presentRecoveryVerificationQuestion(prepared, 2000 + prepared.verificationQuestions.length)
  assert(presented.question, `la pregunta ${recoveryQuestion.id} debe estar persistida y visible`)
  assert.equal(presented.question.id, recoveryQuestion.id)
  return recordRecoveryCheckRaw(presented.item, recoveryQuestion, result, assistanceLevel, studentAnswer)
}

let item = preparedItem()
item = recordRecoveryCheck(item, question('verify-1', 'micro-a', 'fact:verify-1', 'Distingue la categoría aplicable en este escenario completamente nuevo.'), { outcome: 'correct', correct: true }).item
assert.equal(item.status, 'pending_verification')
assert.equal(item.successfulIndependentChecks, 1)
item = activateRecoveryVerification(item)
item = recordRecoveryCheck(item, question('verify-2', 'micro-a', 'fact:verify-2', 'Predice el resultado de una transferencia bajo condiciones diferentes.'), { outcome: 'correct', correct: true }).item
assert.equal(item.status, 'resolved')

item = preparedItem()
item = recordRecoveryCheck(item, question('mixed-1', 'micro-a', 'fact:mixed-1', 'Clasifica una representación usando criterios nuevos y específicos del primer escenario.'), { outcome: 'correct', correct: true }).item
item = activateRecoveryVerification(item)
item = recordRecoveryCheck(item, question('mixed-2', 'micro-a', 'fact:mixed-2', 'Predice una consecuencia bajo condiciones distintas dentro del segundo escenario.'), { outcome: 'incorrect', correct: false }).item
assert.equal(item.status, 'pending_reteach')
assert.equal(item.successfulIndependentChecks, 1)
item = beginRecoveryReteach(item, 'alternative_representation')
item = recordRecoveryReteachContent(item, 'Una explicación nueva para la segunda ronda.')
item = beginRecoveryVerification(item)
assert.equal(item.verificationRound, 2)
assert.equal(item.completedIndependentChecks, 0)
assert.equal(item.successfulIndependentChecks, 0, 'la ronda fallida no arrastra crédito')
item = recordVerificationGenerationAttempt(item, true)
item = recordRecoveryCheck(item, question('mixed-round-2-a', 'micro-a', 'fact:mixed-round-2-a', 'Reconoce la relación correcta en una representación nueva.'), { outcome: 'correct', correct: true }).item
assert.equal(item.status, 'pending_verification')
item = activateRecoveryVerification(item)
item = recordRecoveryCheck(item, question('mixed-round-2-b', 'micro-a', 'fact:mixed-round-2-b', 'Aplica la relación a un segundo contexto independiente.'), { outcome: 'correct', correct: true }).item
assert.equal(item.status, 'resolved')

item = preparedItem()
item = recordRecoveryCheck(item, question('invalid'), { outcome: 'invalid', correct: false }).item
assert.equal(item.completedIndependentChecks, 0)
item = activateRecoveryVerification(item)
item = recordRecoveryCheck(item, question('valid-1'), { outcome: 'correct', correct: true }).item
assert.equal(item.successfulIndependentChecks, 1)
assert.equal(item.completedIndependentChecks, 1)
assert.equal(item.status, 'pending_verification', 'una pregunta válida todavía exige reemplazar la inválida')

// Generar y persistir no equivale a presentar: sin presentedAt no hay crédito.
item = preparedItem(question('unpresented-source'))
const generatedButHidden = question('generated-but-hidden')
item = persistRecoveryVerificationQuestions(item, [generatedButHidden], 3000)
item = activateRecoveryVerification(item)
const hiddenResult = recordRecoveryCheckRaw(item, generatedButHidden, { outcome: 'correct', correct: true })
assert.equal(hiddenResult.item.completedIndependentChecks, 0)
assert.equal(hiddenResult.item.successfulIndependentChecks, 0)
assert.equal(hiddenResult.item.reason, 'unpresented_question_not_counted')

// Una pregunta visible conserva el ciclo generado → persistido → presentado → respondido.
item = preparedItem(question('lifecycle-source'))
const lifecycleQuestion = question(
  'lifecycle-visible',
  'micro-a',
  'fact:lifecycle-visible',
  'Predice el cambio observable bajo una condición de transferencia completamente nueva.',
)
item = recordRecoveryCheck(item, lifecycleQuestion, { outcome: 'correct', correct: true }).item
const lifecycle = item.verificationQuestions.find(entry => entry.question.id === lifecycleQuestion.id)
assert(lifecycle)
assert(lifecycle.generatedAt > 0)
assert(lifecycle.persistedAt > 0)
assert(lifecycle.presentedAt !== null)
assert(lifecycle.answeredAt !== null)
assert(lifecycle.evidenceId)

const twoMicros = createRecoveryQueue([failure(question('a-source', 'micro-a')), failure(question('b-source', 'micro-b'))])
assert.equal(twoMicros.length, 2)
let totalRequired = 0
for (const recovery of twoMicros) {
  let current = beginRecoveryReteach(recovery, 'new_context')
  current = recordRecoveryReteachContent(current, `Contenido ${current.microId}`)
  current = recordVerificationGenerationAttempt(beginRecoveryVerification(current), true)
  current = recordRecoveryCheck(current, question(`${current.microId}-1`, current.microId, `one:${current.microId}`, 'Clasifica una representación usando una distinción conceptual nueva.'), { outcome: 'correct', correct: true }).item
  current = activateRecoveryVerification(current)
  current = recordRecoveryCheck(current, question(`${current.microId}-2`, current.microId, `two:${current.microId}`, 'Predice una consecuencia en un caso de transferencia desconocido.'), { outcome: 'correct', correct: true }).item
  totalRequired += current.completedIndependentChecks
  assert.equal(current.status, 'resolved')
}
assert.equal(totalRequired, 4)

const separateTargets = mergeRecoveryFailures(
  createRecoveryQueue([failure(question('same-source-1'))]),
  [failure(question('same-source-2'))],
)
assert.equal(separateTargets.length, 2)
assert.equal(new Set(separateTargets.map(target => target.recoveryTargetId)).size, 2)
assert.equal(separateTargets.filter(target => target.microId === 'micro-a').length, 2)
const consolidatedRetry = mergeRecoveryFailures(
  createRecoveryQueue([failure(question('same-source-retry'))]),
  [failure(question('same-source-retry'))],
)
assert.equal(consolidatedRetry.length, 1)
assert.equal(consolidatedRetry[0].failures.length, 2)

// Un fallo normal se persiste de inmediato, pero no puede interrumpir el bloque.
const normalOne = question('normal-1')
const normalTwo = question('normal-2')
const normalThree = question('normal-3')
let deferredQueue = deferNormalBlockFailures([], [failure(normalOne)])
assert.equal(deferredQueue.length, 1)
assert.equal(deferredQueue[0].deferredUntilNormalBlockComplete, true)
assert.equal(nextRecoveryItem(deferredQueue), null)
// Las preguntas 2 y 3 se completan antes de liberar la recuperación.
assert(normalTwo.id && normalThree.id)
deferredQueue = releaseNormalBlockRecoveries(deferredQueue)
assert.equal(deferredQueue[0].deferredUntilNormalBlockComplete, false)
assert.equal(nextRecoveryItem(deferredQueue)?.microId, 'micro-a')

// Dos preguntas falladas del mismo micro son targets distintos.
let deferredSameMicro = deferNormalBlockFailures([], [failure(question('normal-same-1'))])
deferredSameMicro = deferNormalBlockFailures(deferredSameMicro, [failure(question('normal-same-3'))])
assert.equal(deferredSameMicro.length, 2)
assert.equal(deferredSameMicro[0].failures.length, 1)
let deferredTwoMicros = deferNormalBlockFailures(deferredSameMicro, [failure(question('normal-b', 'micro-b'))])
assert.equal(deferredTwoMicros.length, 3)
assert.equal(nextRecoveryItem(deferredTwoMicros), null)
deferredTwoMicros = releaseNormalBlockRecoveries(deferredTwoMicros)
assert.equal(nextRecoveryItem(deferredTwoMicros)?.microId, 'micro-a')

item = preparedItem()
item = recordRecoveryCheck(item, question('restore-1'), { outcome: 'correct', correct: true }).item
const restoredRecovery = JSON.parse(JSON.stringify(item)) as RecoveryItem
assert.equal(restoredRecovery.successfulIndependentChecks, 1)
assert.equal(restoredRecovery.status, 'pending_verification')
assert.equal(restoredRecovery.latestFailureEvidenceId, item.latestFailureEvidenceId)
assert.equal(restoredRecovery.verificationGenerationAttempts, item.verificationGenerationAttempts)

item = preparedItem()
item = recordRecoveryCheck(item, question('revealed'), { outcome: 'correct', correct: true }, 'revealed').item
assert.equal(item.successfulIndependentChecks, 0)
assert.equal(item.status, 'pending_verification')

item = preparedItem()
const first = question('unique')
item = recordRecoveryCheck(item, first, { outcome: 'correct', correct: true }).item
item = activateRecoveryVerification(item)
const repeated = recordRecoveryCheckRaw(item, first, { outcome: 'correct', correct: true })
assert.equal(repeated.item.successfulIndependentChecks, 1)
assert.equal(repeated.telemetry.repeatedQuestion, true)

item = preparedItem()
item = recordRecoveryCheck(item, question('round-0'), { outcome: 'incorrect', correct: false, errorType: 'conceptual' }, 'independent', 'respuesta B').item
item = activateRecoveryVerification(item)
item = recordRecoveryCheck(item, question('round-0b'), { outcome: 'incorrect', correct: false, errorType: 'conceptual' }, 'independent', 'respuesta B2').item
for (let index = 1; index <= 20; index++) {
  const strategy = selectRecoveryStrategy(item)
  assert(strategy)
  item = beginRecoveryReteach(item, strategy)
  item = recordRecoveryReteachContent(item, `Explicación alternativa ${index}`)
  item = recordVerificationGenerationAttempt(beginRecoveryVerification(item), true)
  const firstRoundQuestion = { ...question(`round-${index}`), questionFamily: 'deterministic_recovery_selection' }
  const secondRoundQuestion = { ...question(`round-${index}-second`), questionFamily: 'deterministic_recovery_claim' }
  item = recordRecoveryCheck(item, firstRoundQuestion, { outcome: 'incorrect', correct: false, errorType: 'conceptual' }, 'independent', `respuesta ${index}`).item
  if (item.status === 'pending_verification') {
    item = activateRecoveryVerification(item)
    item = recordRecoveryCheck(item, secondRoundQuestion, { outcome: 'incorrect', correct: false, errorType: 'conceptual' }, 'independent', `segunda respuesta ${index}`).item
  }
  assert.equal(item.status, 'pending_reteach')
}
assert.equal(item.status, 'pending_reteach')
assert.equal(item.successfulIndependentChecks, 0)
assert.equal(item.totalStudentFailureRounds, 21)
assert.equal(hasPendingRecovery([item]), true)

// El fallo más reciente, no el original, gobierna el siguiente diagnóstico.
item = preparedItem(question('original-order-error'))
item = recordRecoveryCheck(
  item,
  question('new-conceptual-error', 'micro-a', 'fact:new-conceptual', 'Explica la frontera conceptual usando un caso completamente diferente.'),
  { outcome: 'incorrect', correct: false, errorType: 'conceptual' },
  'independent',
  'respuesta conceptual reciente',
).item
assert.equal(item.status, 'pending_verification')
item = activateRecoveryVerification(item)
item = recordRecoveryCheck(
  item,
  question('new-conceptual-error-second', 'micro-a', 'fact:new-conceptual-second', 'Distingue nuevamente el límite conceptual en otro contexto independiente.'),
  { outcome: 'correct', correct: true },
).item
const latest = latestRecoveryFailure(item)
assert(latest)
assert.equal(latest.question.id, 'new-conceptual-error')
assert.equal(item.latestQuestionId, 'new-conceptual-error')
assert.equal(item.latestStudentAnswer, 'respuesta conceptual reciente')
assert.equal(item.latestExpectedAnswer, latest.question.correctAnswer)
assert.equal(item.latestErrorType, 'conceptual')
assert.equal(item.latestAssistanceLevel, 'independent')
assert.equal(item.failureHistory.length, 2)
assert.notEqual(item.latestFailureEvidenceId, item.failureHistory[0].evidenceId)
assert.equal(selectRecoveryStrategy(item), 'concept_boundary')

// Un cambio de error cambia la familia de estrategia; una explicación idéntica pide alternativa sin abandonar.
let changedError = createRecoveryQueue([{
  ...failure(question('ordering-source')),
  result: { outcome: 'incorrect', correct: false, errorType: 'ordering' },
}])[0]
assert.equal(selectRecoveryStrategy(changedError), 'sequence_contrast')
changedError = beginRecoveryReteach(changedError, 'sequence_contrast')
changedError = recordRecoveryReteachContent(changedError, 'Primera explicación de secuencia.')
changedError = recordVerificationGenerationAttempt(beginRecoveryVerification(changedError), true)
changedError = recordRecoveryCheck(
  changedError,
  question('conceptual-after-order', 'micro-a', 'fact:conceptual-after-order', 'Contrasta el concepto en una situación de transferencia completamente nueva.'),
  { outcome: 'incorrect', correct: false, errorType: 'conceptual' },
  'independent',
  'confusión conceptual',
).item
changedError = activateRecoveryVerification(changedError)
changedError = recordRecoveryCheck(
  changedError,
  question('conceptual-after-order-second', 'micro-a', 'fact:conceptual-after-order-second', 'Selecciona la frontera correcta en otro escenario independiente.'),
  { outcome: 'correct', correct: true },
).item
assert.equal(selectRecoveryStrategy(changedError), 'concept_boundary')
changedError = beginRecoveryReteach(changedError, 'concept_boundary')
changedError = recordRecoveryReteachContent(changedError, 'Primera explicación de secuencia.')
// Auditoría adversarial (Codex, Reteach 3.1): un duplicado debe bloquear
// semánticamente el avance a verificación — status vuelve a 'pending_reteach'
// (no se queda en 'reteaching', que dejaba pasar beginRecoveryVerification) y
// preparedReteachContent se limpia (nunca debe quedar contenido de una ronda
// anterior disponible como si fuera nuevo).
assert.equal(changedError.status, 'pending_reteach')
assert.equal(changedError.reason, 'duplicate_reteach_requires_alternate_content')
assert.equal(changedError.preparedReteachContent, null)
assert.equal(beginRecoveryVerification(changedError).status, 'pending_reteach', 'beginRecoveryVerification debe rechazar un item que no está en reteaching')

// La generación inválida agota solo el lote técnico y conserva la deuda pedagógica.
let generationFuse = createRecoveryQueue([failure(question('generation-source'))])[0]
generationFuse = beginRecoveryReteach(generationFuse, 'contrastive_explanation')
generationFuse = recordRecoveryReteachContent(generationFuse, 'Explicación antes del fusible de generación.')
generationFuse = beginRecoveryVerification(generationFuse)
for (let attempt = 0; attempt < generationFuse.maxVerificationGenerationAttempts; attempt++) {
  generationFuse = recordVerificationGenerationAttempt(generationFuse, false)
}
assert.equal(generationFuse.status, 'pending_verification')
assert.equal(generationFuse.reason, 'technical_generation_attempts_exhausted')
assert.ok(generationFuse.maxVerificationGenerationAttempts >= 2, 'el ítem tiene al menos 2 intentos configurados')
assert.equal(generationFuse.verificationGenerationAttempts, generationFuse.maxVerificationGenerationAttempts)
const retryableGeneration = prepareVerificationGenerationRetry(generationFuse)
assert.equal(retryableGeneration.status, 'pending_verification')
assert.equal(retryableGeneration.verificationGenerationAttempts, generationFuse.maxVerificationGenerationAttempts)
assert.equal(retryableGeneration.verificationGenerationVersion, generationFuse.verificationGenerationVersion + 1)
assert.equal(hasPendingRecovery([retryableGeneration]), true)

// No-progress por misma estrategia + misma evidencia y directiva explícita.
let noProgress = createRecoveryQueue([failure(question('no-progress-source'))])[0]
noProgress = beginRecoveryReteach(noProgress, 'contrastive_explanation')
noProgress = recordRecoveryReteachContent(noProgress, 'Explicación inicial no repetida.')
noProgress = recordVerificationGenerationAttempt(beginRecoveryVerification(noProgress), true)
noProgress = recordRecoveryCheck(
  noProgress,
  question('no-progress-check', 'micro-a', 'fact:no-progress-check', 'Resuelve un caso distinto para producir evidencia nueva suficiente.'),
  { outcome: 'incorrect', correct: false, errorType: 'selection' },
).item
noProgress = activateRecoveryVerification(noProgress)
noProgress = recordRecoveryCheck(
  noProgress,
  question('no-progress-check-second', 'micro-a', 'fact:no-progress-check-second', 'Aplica la distinción en un segundo caso antes de cerrar la ronda.'),
  { outcome: 'correct', correct: true },
).item
noProgress = beginRecoveryReteach(noProgress, 'contrastive_explanation')
assert.equal(noProgress.status, 'reteaching', 'una evidencia nueva sí permite revisar la estrategia')
const directive = recoveryDirective(noProgress)
assert.deepEqual(directive, {
  nextAction: 'generate_verification',
  recoveryStatus: 'reteaching',
  remainingChecks: 2,
})

// Restore normaliza estados efímeros sin reiniciar deuda ni contadores.
const activeBeforeRestore = preparedItem(question('restore-active'))
const normalizedRestore = normalizeRestoredRecoveryItem(JSON.parse(JSON.stringify(activeBeforeRestore)) as RecoveryItem)
assert.equal(normalizedRestore.status, 'pending_verification')
assert.equal(normalizedRestore.reteachAttempt, activeBeforeRestore.reteachAttempt)
assert.equal(normalizedRestore.verificationGenerationAttempts, activeBeforeRestore.verificationGenerationAttempts)
assert.equal(normalizedRestore.latestFailureEvidenceId, activeBeforeRestore.latestFailureEvidenceId)

let readyBeforeRestore = preparedItem(question('restore-ready-source'))
readyBeforeRestore = persistRecoveryVerificationQuestions(readyBeforeRestore, [
  question('restore-ready-a'),
  question('restore-ready-b'),
], 4000)
const presentedBeforeRefresh = presentRecoveryVerificationQuestion(readyBeforeRestore, 5000)
assert(presentedBeforeRefresh.question)
const readyAfterRestore = normalizeRestoredRecoveryItem(
  JSON.parse(JSON.stringify(presentedBeforeRefresh.item)) as RecoveryItem,
)
assert.equal(readyAfterRestore.status, 'verification_ready')
const representedAfterRefresh = presentRecoveryVerificationQuestion(readyAfterRestore, 6000)
assert.equal(representedAfterRefresh.question?.id, presentedBeforeRefresh.question.id)
const autosaveDuringGeneration = normalizeRestoredRecoveryItem({
  ...readyBeforeRestore,
  status: 'pending_verification',
  reason: 'autosave_before_view_switch',
})
assert.equal(autosaveDuringGeneration.status, 'verification_ready')
assert.equal(autosaveDuringGeneration.recoveryId, readyBeforeRestore.recoveryId)

const legacyRestore = normalizeRestoredRecoveryItem({
  ...activeBeforeRestore,
  failureHistory: undefined,
  verificationGenerationAttempts: undefined,
  reteachContentHistory: undefined,
  latestFailureEvidenceId: undefined,
} as unknown as RecoveryItem)
assert.equal(legacyRestore.status, 'pending_verification')
assert.deepEqual(legacyRestore.failureHistory, [])
assert.deepEqual(legacyRestore.reteachContentHistory, [])
assert.equal(legacyRestore.verificationGenerationAttempts, 0)
assert.equal(legacyRestore.latestQuestionId, activeBeforeRestore.latestQuestionId)

const pending = preparedItem()
assert.equal(hasPendingRecovery([pending]), true)
assert.notEqual(pending.status, 'resolved')
assert.equal(canCompleteSessionWithRecovery([pending]), false)
assert.equal(canCompleteProgramWithRecovery([pending], [pending.microId]), false)
assert.equal(canCompleteProgramWithRecovery([item], [item.microId]), false)
assert.deepEqual(recoveryCompletionAudit([generationFuse]), {
  skippedRecovery: 1,
  reteachWithoutTwoAnsweredVerifications: 0,
})

const brokenReteach = prepareReteachContent(
  'Explicación con fórmula rota $\\frac{a}{b$',
  '**Explicación segura.** Continúa con las verificaciones del mismo concepto.',
)
assert.equal(brokenReteach.usedFallback, true)
assert.match(brokenReteach.validationReason || '', /INVALID_ACADEMIC_FRAGMENT|broken_delimiter/)
assert.match(brokenReteach.content, /Explicación segura/)

const fallbackInput = {
  sourceQuestion: question('fallback-source'),
  studentAnswer: 'b',
  evaluationMode: 'quick_test',
  roundNumber: 8,
  teachingContent: 'Explicación canónica del concepto.',
} as const
const deterministicFallback = createDeterministicRecoveryFallback(fallbackInput)
assert.equal(deterministicFallback.length, 2)
assert.equal(new Set(deterministicFallback.map(entry => entry.id)).size, 2)
assert(deterministicFallback.every(entry => entry.conceptId === fallbackInput.sourceQuestion.conceptId))
assert.equal(validateDeterministicRecoveryFallback(deterministicFallback, fallbackInput).valid, true)

console.log('adaptive-matching-recovery-contracts: matching + 18 recovery contracts PASS')
