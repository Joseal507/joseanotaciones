import assert from 'node:assert/strict'
import {
  buildExamEnjoyerUniverse,
  composeEnjoyerExamBlueprint,
  isEligibleForTrueFalse,
  ExamEnjoyerTarget,
} from '../../lib/materialBrain/examEnjoyerContext'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  authorSlotQuestionWithDiagnostics,
  toPublicExamQuestion,
  gradeObjectiveQuestion,
  gradeDeterministicCriterion,
} from '../../app/api/alai-studyal-exam/route'
import {
  deterministicallyRecomposeSlot,
  deterministicallyFallbackToAtomicOpen,
} from '../../lib/materialBrain/examGenerationStore'

function makeItem(
  id: string,
  materialId: string,
  page: number,
  kind = 'fact',
  label = `Etiqueta ${id}`,
  content = `Contenido verificable de prueba para ${id}.`,
  examTypes: string[] = ['multiple_choice'],
  bloomLevel?: string,
  topicId = 'topic-1',
  sourceSpans?: Array<{ page: number; quote: string; certainty?: 'supported' | 'inferred' | 'uncertain' }>,
) {
  return {
    id,
    kind,
    name: label,
    label,
    content,
    summary: content,
    importance: 80,
    difficulty: 'medium',
    examTypes,
    bloomLevel,
    topicId,
    materialId,
    pages: [page],
    sourceSpans: sourceSpans || [{ materialId, page, quote: content }],
  }
}

function makeUniverse(items: any[], relations: any[] = []) {
  const blueprint = {
    sourceSelectionFingerprint: 'fp-tf-test',
    materialIds: ['mat-1'],
    selectedPages: { 'mat-1': [1, 2, 3] },
    topicsIndex: [{ id: 'topic-1', title: 'Tema 1', sourceOrder: 0 }],
    globalOrderedAnalysis: items,
    uniqueConceptsIndex: [],
    relations,
  }
  const snapshot = {
    ...buildSourceSelectionSnapshot(['mat-1'], { 'mat-1': [1, 2, 3] }),
    fingerprint: 'fp-tf-test',
  }
  return buildExamEnjoyerUniverse(blueprint, snapshot)
}

// ============================================================================
// CONTRACT A: true_false is reachable in Exam
// ============================================================================
function testTrueFalseReachableInExam() {
  const items = [
    makeItem('fact1', 'mat-1', 1, 'fact', 'Niels Bohr', 'Niels Bohr nació en Copenhague en 1885.', ['true_false'], 'remember'),
    makeItem('fact2', 'mat-1', 1, 'fact', 'Modelo atómico', 'El modelo atómico fue presentado en el año 1913.', ['true_false'], 'remember'),
  ]
  const universe = makeUniverse(items)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-tf-reach', 'seed-tf-1')

  const tfSlots = bp.slots.filter(s => s.type === 'true_false')
  assert.ok(tfSlots.length >= 1, `Contract A FAIL: true_false slot not reachable in blueprint. Slots: ${bp.slots.map(s => s.type).join(', ')}`)

  const slot = tfSlots[0]
  assert.equal(slot.answerAuthority.kind, 'boolean', 'Contract A FAIL: slot answerAuthority must be boolean')
  assert.ok(typeof (slot.answerAuthority as any).value === 'boolean', 'Contract A FAIL: answerAuthority.value must be boolean')
  assert.ok((slot.answerAuthority as any).canonicalStatement.length > 0, 'Contract A FAIL: canonicalStatement must not be empty')
  console.log('Contract A PASS: true_false is reachable in Exam with boolean authority')
}

// ============================================================================
// CONTRACT B: true_false is selective, NOT mandatory
// ============================================================================
function testTrueFalseNotMandatory() {
  // Universe with comprehension / open-response items that do not hint true_false
  const items = [
    makeItem('comp1', 'mat-1', 1, 'concept', 'Mecanismo cuántico', 'Explicación detallada del mecanismo de emisión cuántica.', ['short_answer'], 'understand'),
    makeItem('comp2', 'mat-1', 1, 'concept', 'Principio de correspondencia', 'El principio conecta la mecánica clásica con la teoría cuántica.', ['multiple_choice'], 'understand'),
  ]
  const universe = makeUniverse(items)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-tf-not-mand', 'seed-tf-2')

  // Blueprint should succeed without forcing any true_false slots
  assert.equal(bp.typeDistribution.true_false, 0, 'Contract B FAIL: true_false was forced when not appropriate')
  assert.ok(bp.slots.length > 0, 'Contract B FAIL: blueprint should have valid slots')
  console.log('Contract B PASS: true_false is selective and never mandatory')
}

// ============================================================================
// CONTRACT C: Suitable atomic evidence can select true_false
// ============================================================================
function testSuitableAtomicEvidenceEligibility() {
  const validTarget: ExamEnjoyerTarget = {
    id: 't-valid',
    sourceItemId: 's-valid',
    kind: 'fact',
    label: 'Año del Nobel',
    content: 'Bohr recibió el Premio Nobel de Física en 1922.',
    importance: 85,
    difficulty: 'medium',
    examTypes: ['true_false', 'multiple_choice'],
    rawExamTypeHints: ['true_false'],
    bloomLevel: 'remember',
    topicId: 't1',
    topicTitle: 'Física',
    sourceOrder: 1,
    materialId: 'mat-1',
    pages: [1],
    sourceSpans: [{ page: 1, quote: 'Bohr recibió el Premio Nobel de Física en 1922.', certainty: 'supported' }],
  }

  assert.ok(isEligibleForTrueFalse(validTarget), 'Contract C FAIL: clean atomic fact should be eligible for true_false')

  const formulaTarget: ExamEnjoyerTarget = {
    ...validTarget,
    id: 't-formula',
    kind: 'formula',
    label: 'Energía de Bohr',
    content: 'La energía del estado fundamental es de -13.6 eV.',
    sourceSpans: [{ page: 1, quote: 'La energía del estado fundamental es de -13.6 eV.' }],
  }
  assert.ok(isEligibleForTrueFalse(formulaTarget), 'Contract C FAIL: concise formula fact should be eligible')

  console.log('Contract C PASS: Suitable atomic evidence is eligible for true_false')
}

// ============================================================================
// CONTRACT D: Unsuitable/ambiguous evidence fails closed
// ============================================================================
function testUnsuitableEvidenceFailsClosed() {
  const baseTarget: ExamEnjoyerTarget = {
    id: 't-base',
    sourceItemId: 's-base',
    kind: 'fact',
    label: 'Base',
    content: 'Niels Bohr nació en Copenhague en 1885.',
    importance: 80,
    difficulty: 'medium',
    examTypes: ['true_false'],
    rawExamTypeHints: ['true_false'],
    bloomLevel: 'remember',
    topicId: 't1',
    topicTitle: 'Física',
    sourceOrder: 1,
    materialId: 'mat-1',
    pages: [1],
    sourceSpans: [{ page: 1, quote: 'Niels Bohr nació en Copenhague en 1885.' }],
  }

  // 1. Subjective hedges
  const hedged = { ...baseTarget, content: 'Bohr podría haber considerado el modelo como una simple hipótesis de trabajo.' }
  assert.equal(isEligibleForTrueFalse(hedged), false, 'Subjective hedge "podría" must fail closed')

  const speculative = { ...baseTarget, content: 'Tal vez el experimento de Rutherford influyó más de lo que se admite públicamente.' }
  assert.equal(isEligibleForTrueFalse(speculative), false, 'Speculative marker "tal vez" must fail closed')

  // 2. Opinion/argument kinds
  const opinionKind = { ...baseTarget, kind: 'opinion' }
  assert.equal(isEligibleForTrueFalse(opinionKind), false, 'kind "opinion" must fail closed')

  // 3. Multi-clause / compound statements (semicolon)
  const semicolon = { ...baseTarget, content: 'El electrón orbita en niveles discretos; la radiación se emite durante los saltos.' }
  assert.equal(isEligibleForTrueFalse(semicolon), false, 'Semicolon multi-clause statement must fail closed')

  // 4. Multi-sentence content
  const multiSentence = { ...baseTarget, content: 'El átomo de hidrógeno es el más simple. Posee un protón y un electrón.' }
  assert.equal(isEligibleForTrueFalse(multiSentence), false, 'Multiple sentences must fail closed')

  // 5. Coordinating compound structure joining independent claims
  const compound = { ...baseTarget, content: 'El modelo explica la estabilidad del átomo y además predice las líneas de Balmer con exactitud.' }
  assert.equal(isEligibleForTrueFalse(compound), false, 'Compound clause "y además" must fail closed')

  // 6. Insufficient or uncertain source support
  const noSpans = { ...baseTarget, sourceSpans: [] }
  assert.equal(isEligibleForTrueFalse(noSpans), false, 'Missing sourceSpans must fail closed')

  const uncertainSpan = { ...baseTarget, sourceSpans: [{ page: 1, quote: baseTarget.content, certainty: 'uncertain' as const }] }
  assert.equal(isEligibleForTrueFalse(uncertainSpan), false, 'Uncertain source support must fail closed')

  const inferredSpan = { ...baseTarget, sourceSpans: [{ page: 1, quote: baseTarget.content, certainty: 'inferred' as const }] }
  assert.equal(isEligibleForTrueFalse(inferredSpan), false, 'Inferred source support must fail closed')

  // 7. Length violations
  const tooShort = { ...baseTarget, content: 'Bohr nació.' }
  assert.equal(isEligibleForTrueFalse(tooShort), false, 'Too short (< 15 chars) must fail closed')

  const tooLong = { ...baseTarget, content: 'A'.repeat(181) }
  assert.equal(isEligibleForTrueFalse(tooLong), false, 'Too long (> 180 chars) must fail closed')

  // 8. Complex skills
  const applicationTarget = { ...baseTarget, bloomLevel: 'apply', kind: 'process' }
  assert.equal(isEligibleForTrueFalse(applicationTarget), false, 'Application skill must fail closed')

  console.log('Contract D PASS: All unsuitable and ambiguous evidence fails closed')
}

// ============================================================================
// CONTRACT E: Expected truth value stays private in frozen artifact
// ============================================================================
function testExpectedTruthValueStaysPrivateInArtifact() {
  const items = [
    makeItem('fact1', 'mat-1', 1, 'fact', 'Niels Bohr', 'Niels Bohr nació en Copenhague en 1885.', ['true_false'], 'remember'),
  ]
  const universe = makeUniverse(items)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-tf-priv', 'seed-tf-3')
  const slot = bp.slots[0]

  // AI authors a question with false proposition
  const rawFalse = {
    slotId: slot.id,
    type: 'true_false',
    prompt: 'Niels Bohr nació en Estocolmo en 1885.',
    correctAnswer: false,
  }

  const { question } = authorSlotQuestionWithDiagnostics(bp.examId, bp, slot, rawFalse)
  assert.ok(question, 'Authoring should succeed for valid proposition and boolean')
  assert.equal(question.type, 'true_false')
  assert.equal(question.correctAnswer, false, 'Authored boolean must be frozen on internal question')

  // Verify private authority on slot was updated to match frozen boolean
  assert.equal(slot.answerAuthority.value, false, 'Private slot authority must freeze expected boolean')
  assert.equal(slot.answerAuthority.canonicalStatement, 'Niels Bohr nació en Estocolmo en 1885.')

  console.log('Contract E PASS: Expected truth value is privately frozen in internal authority')
}

// ============================================================================
// CONTRACT F: Public DTO does NOT leak the answer
// ============================================================================
function testPublicDtoDoesNotLeakAnswer() {
  const items = [
    makeItem('fact1', 'mat-1', 1, 'fact', 'Niels Bohr', 'Niels Bohr nació en Copenhague en 1885.', ['true_false'], 'remember'),
  ]
  const universe = makeUniverse(items)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-tf-leak', 'seed-tf-4')
  const slot = bp.slots[0]

  const raw = {
    slotId: slot.id,
    type: 'true_false',
    prompt: 'El modelo atómico de Bohr fue propuesto en 1913.',
    correctAnswer: true,
  }

  const { question } = authorSlotQuestionWithDiagnostics(bp.examId, bp, slot, raw)
  assert.ok(question)

  const publicDto = toPublicExamQuestion(question)
  assert.equal((publicDto as any).correctAnswer, undefined, 'Public DTO must strip correctAnswer')
  assert.equal((publicDto as any).expectedAnswer, undefined, 'Public DTO must strip expectedAnswer')
  assert.equal((publicDto as any).rubricHints, undefined, 'Public DTO must strip rubricHints')
  assert.equal((publicDto as any).assessmentCriteria, undefined, 'Public DTO must strip assessmentCriteria')

  // Public prompt must be intact without answer leakage
  assert.equal(publicDto.prompt, 'El modelo atómico de Bohr fue propuesto en 1913.')
  assert.ok(!publicDto.prompt.toLowerCase().includes('verdadero'))
  assert.ok(!publicDto.prompt.toLowerCase().includes('falso'))

  console.log('Contract F PASS: Public DTO strictly prevents any answer leakage')
}

// ============================================================================
// CONTRACT G: Deterministic grading works with 0 provider calls
// ============================================================================
function testDeterministicGradingZeroProviderCalls() {
  const qTrue: any = {
    id: 'q-tf-true',
    type: 'true_false',
    prompt: 'La afirmación es correcta.',
    correctAnswer: true,
  }

  const qFalse: any = {
    id: 'q-tf-false',
    type: 'true_false',
    prompt: 'La afirmación es incorrecta.',
    correctAnswer: false,
  }

  // 1. Correct matches
  assert.equal(gradeObjectiveQuestion(qTrue, true), true, 'true === true must be correct')
  assert.equal(gradeObjectiveQuestion(qFalse, false), true, 'false === false must be correct')

  // 2. Incorrect matches
  assert.equal(gradeObjectiveQuestion(qTrue, false), false, 'false === true must be incorrect')
  assert.equal(gradeObjectiveQuestion(qFalse, true), false, 'true === false must be incorrect')

  // 3. Unanswered / null
  assert.equal(gradeObjectiveQuestion(qTrue, null), false, 'null userAnswer must be false')
  assert.equal(gradeObjectiveQuestion(qTrue, undefined), false, 'undefined userAnswer must be false')

  // 4. Deterministic criterion grading
  const criterion: any = {
    criterionId: 'crit-1',
    targetIds: ['t1'],
    points: 10,
    gradingMode: 'deterministic',
  }

  const resultCorrect = gradeDeterministicCriterion(qTrue, criterion, true, true)
  assert.equal(resultCorrect.status, 'correct')
  assert.equal(resultCorrect.scorePercent, 100)

  const resultIncorrect = gradeDeterministicCriterion(qTrue, criterion, false, true)
  assert.equal(resultIncorrect.status, 'incorrect')
  assert.equal(resultIncorrect.scorePercent, 0)

  const resultUnanswered = gradeDeterministicCriterion(qTrue, criterion, null, false)
  assert.equal(resultUnanswered.status, 'unanswered')
  assert.equal(resultUnanswered.scorePercent, 0)

  console.log('Contract G PASS: Deterministic grading works in-memory with 0 provider calls')
}

// ============================================================================
// CONTRACT H: Recovery can abandon invalid true_false item
// ============================================================================
function testRecoveryCanAbandonInvalidTrueFalse() {
  const items = [
    makeItem('fact1', 'mat-1', 1, 'fact', 'Niels Bohr', 'Niels Bohr nació en Copenhague en 1885.', ['true_false'], 'remember'),
  ]
  const universe = makeUniverse(items)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-tf-recov', 'seed-tf-5')
  const slot = bp.slots[0]

  // 1. Rejection: missing boolean answer
  // 1. Rejection: invalid non-boolean answer passed
  const rawInvalidBool = { slotId: slot.id, type: 'true_false', prompt: 'Una afirmación válida con respuesta inválida.', correctAnswer: 'tal_vez' }
  const rej1 = authorSlotQuestionWithDiagnostics(bp.examId, bp, slot, rawInvalidBool)
  assert.equal(rej1.question, null)
  assert.ok(rej1.rejectionReason?.includes('INVALID_TRUE_FALSE_ANSWER'), 'Must reject invalid boolean answer')

  // 2. Rejection: multiple propositions (semicolon)
  const rawSemicolon = { slotId: slot.id, type: 'true_false', prompt: 'Primera afirmación; segunda afirmación.', correctAnswer: true }
  const rej2 = authorSlotQuestionWithDiagnostics(bp.examId, bp, slot, rawSemicolon)
  assert.equal(rej2.question, null)
  assert.ok(rej2.rejectionReason?.includes('MULTIPLE_PROPOSITIONS'), 'Must reject multiple propositions')

  // 3. Rejection: subjective proposition
  const rawSubjective = { slotId: slot.id, type: 'true_false', prompt: 'Bohr probablemente fue el físico más influyente de Dinamarca.', correctAnswer: true }
  const rej3 = authorSlotQuestionWithDiagnostics(bp.examId, bp, slot, rawSubjective)
  assert.equal(rej3.question, null)
  assert.ok(rej3.rejectionReason?.includes('SUBJECTIVE_PROPOSITION'), 'Must reject subjective proposition')

  // 4. Deterministic recomposition transitions slot to short_answer
  const recomposed = deterministicallyRecomposeSlot(slot)
  assert.ok(recomposed, 'Slot must be deterministically recomposable')
  assert.equal(recomposed.type, 'short_answer', 'Recomposed slot must transition to short_answer')
  assert.equal(recomposed.replacesSlotId, slot.id)
  assert.equal(recomposed.assessmentCriteria[0].gradingMode, 'semantic')

  // 5. Atomic fallback is also capable of handling boolean authority
  const fallback = deterministicallyFallbackToAtomicOpen(slot)
  assert.ok(fallback, 'Atomic fallback must succeed')
  assert.equal(fallback.type, 'short_answer')
  assert.ok(fallback.id.includes(':fallback:open'))

  console.log('Contract H PASS: Bounded recovery safely abandons invalid true_false and recomposes to short_answer')
}

// ============================================================================
// CONTRACT I: Legacy exams restore unchanged
// ============================================================================
function testLegacyExamsRestoreUnchanged() {
  const legacyQuestion: any = {
    id: 'legacy-q-1',
    slotId: 'slot-legacy-1',
    section: 'I. Conceptos',
    type: 'true_false',
    prompt: 'El electrón posee carga negativa.',
    points: 10,
    correctAnswer: true,
    skill: 'retention',
    difficulty: 'basic',
    sourceMaterial: 'mat-legacy',
    sourcePage: 1,
  }

  // Passing through toPublicExamQuestion leaves core fields intact while stripping correctAnswer
  const pub = toPublicExamQuestion(legacyQuestion)
  assert.equal(pub.id, 'legacy-q-1')
  assert.equal(pub.prompt, 'El electrón posee carga negativa.')
  assert.equal(pub.type, 'true_false')
  assert.equal(pub.points, 10)
  assert.equal((pub as any).correctAnswer, undefined)

  // Grading legacy questions still operates deterministically
  assert.equal(gradeObjectiveQuestion(legacyQuestion, true), true)
  assert.equal(gradeObjectiveQuestion(legacyQuestion, false), false)

  console.log('Contract I PASS: Legacy exams restore and grade unchanged without migration drift')
}

// ============================================================================
// CONTRACT J: No type quotas were introduced
// ============================================================================
function testNoTypeQuotasIntroduced() {
  // Scenario 1: Material has 0 eligible true_false targets (e.g. all application/worked cases)
  const items = [
    makeItem('app1', 'mat-1', 1, 'process', 'Cálculo de energía', 'Calcular la longitud de onda de un fotón emitido usando la fórmula de Rydberg.', ['open'], 'apply'),
    makeItem('app2', 'mat-1', 1, 'process', 'Orbitales', 'Determinar los números cuánticos permitidos para n = 3.', ['open'], 'apply'),
  ]
  const universe = makeUniverse(items)
  const bp = composeEnjoyerExamBlueprint(universe, 30, 'exam-tf-noquota', 'seed-tf-6')

  // Type distribution for true_false must be 0, and blueprint must be 100% valid
  assert.equal(bp.typeDistribution.true_false, 0, 'Contract J: true_false count must be 0 when not appropriate')
  assert.ok(bp.slots.length > 0)
  assert.ok(bp.coveragePercent > 0)

  console.log('Contract J PASS: No type quotas exist; true_false only chosen when academically grounded')
}

// ============================================================================
// MAIN RUNNER
// ============================================================================
function main() {
  console.log('\n── RUNNING EXAM TRUE_FALSE SELECTIVE INSTRUMENT CONTRACTS ──\n')

  testTrueFalseReachableInExam()
  testTrueFalseNotMandatory()
  testSuitableAtomicEvidenceEligibility()
  testUnsuitableEvidenceFailsClosed()
  testExpectedTruthValueStaysPrivateInArtifact()
  testPublicDtoDoesNotLeakAnswer()
  testDeterministicGradingZeroProviderCalls()
  testRecoveryCanAbandonInvalidTrueFalse()
  testLegacyExamsRestoreUnchanged()
  testNoTypeQuotasIntroduced()

  console.log('\nALL 10 TRUE_FALSE INSTRUMENT CONTRACTS PASSED!\n')
}

main()
