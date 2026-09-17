import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { projectRepasoRecoveryFeedback } from '../../app/api/alai-studyal-repasar/route'
import type { RepasarReviewTarget } from '../../lib/materialBrain/reviewContext'

const target = (overrides: Partial<RepasarReviewTarget> = {}): RepasarReviewTarget => ({
  id: 't1', unitId: 't1', kind: 'concept', label: 'Reacción directa', statement: 'La reacción directa transforma N2O4 en NO2.',
  importanceTier: 'critical', materialId: 'm1', page: 7, pages: [7],
  sourceSpans: [{ page: 7, quote: 'La reacción directa transforma N2O4 en NO2.' }],
  topicId: 't', topicTitle: null, derivation: 'native_text', evidenceText: null,
  ...overrides,
})

const baseAttempt = {
  attemptId: 'a1', groupId: 'g1', createdAt: 'now', answer: 'student answer',
  requestedTargetIds: ['t1'], adjudicatedTargetIds: ['t1'], transitions: [],
  scoreBefore: 8, scoreAfter: 8, letterBefore: 'F', letterAfter: 'F',
} as any

function feedback(adjudications: any[], targets: RepasarReviewTarget[], overrides: Partial<typeof baseAttempt> = {}, pages: number[] = [7]) {
  return projectRepasoRecoveryFeedback({ ...baseAttempt, ...overrides, adjudications }, targets, pages)
}

function testCoveredExplainsSuccess() {
  const t = target()
  const result = feedback([{ targetId: 't1', status: 'covered', evidence: 'evidencia', demonstrated: 'Explicó que N2O4 se transforma en NO2.', missingDetail: '' }], [t], { scoreBefore: 8, scoreAfter: 100 })
  assert.equal(result.status, 'correct')
  assert.equal(result.title, 'Excelente')
  assert.ok(result.summary.length > 0)
  assert.deepEqual(result.didWell, ['Reacción directa: Explicó que N2O4 se transforma en NO2.'])
  assert.equal(result.needsWork.length, 0)
  assert.equal(result.hint, '', 'covered must never show a hint')
}

function testPartialExplainsDemonstratedAndMissing() {
  const t = target({ id: 't1', label: 'Reacción directa y su ley de velocidad', statement: 'v = kf[N2O4] describe la ley de velocidad de la reacción directa.' })
  const result = feedback([{
    targetId: 't1', status: 'partial',
    evidence: 'N2O4 -> 2NO2, v = kf[N2O4]',
    demonstrated: 'La reacción directa y su ley de velocidad, incluyendo la definición de kf y [N2O4].',
    missingDetail: 'Falta explicar por qué la velocidad depende únicamente de [N2O4] y no de [NO2].',
  }], [t], { scoreBefore: 8, scoreAfter: 10 })
  assert.equal(result.status, 'partial')
  assert.equal(result.title, 'Casi lo tienes')
  assert.ok(result.didWell[0].includes('kf'), 'must surface exactly what was demonstrated')
  assert.ok(result.needsWork[0].includes('por qué la velocidad depende'), 'must surface the exact canonical missingDetail')
}

function testPartialIncludesActionableImprovement() {
  const t = target()
  const result = feedback([{ targetId: 't1', status: 'partial', evidence: 'e', demonstrated: 'd', missingDetail: 'falta el mecanismo exacto' }], [t])
  assert.ok(result.suggestion.length > 0)
  assert.ok(result.suggestion.includes('falta el mecanismo exacto'), 'the suggestion must be concrete, not generic')
}

function testPartialCanonicalModelExplanation() {
  const t = target({ statement: 'La reacción directa transforma N2O4 en NO2 según v = kf[N2O4].' })
  const result = feedback([{ targetId: 't1', status: 'partial', evidence: 'e', demonstrated: 'd', missingDetail: 'f' }], [t])
  assert.equal(result.betterExplanation, 'La reacción directa transforma N2O4 en NO2 según v = kf[N2O4].')
}

function testIncorrectIdentifiesContradictionAndCorrection() {
  const t = target({ statement: 'Keq es constante a temperatura fija y no depende de las concentraciones iniciales.' })
  const result = feedback([{
    targetId: 't1', status: 'incorrect',
    evidence: 'Keq cambia si agrego más reactivo al sistema',
    demonstrated: '', missingDetail: 'contradice la definición canónica de Keq',
  }], [t])
  assert.equal(result.status, 'incorrect')
  assert.equal(result.title, 'Todavía no')
  assert.ok(result.correction.length > 0)
  assert.ok(result.correction[0].includes('Keq cambia si agrego'), 'must show the contradicted claim')
  assert.ok(result.correction[0].includes('Keq es constante'), 'must show the canonical correction')
  assert.ok(!result.correction[0].toLowerCase().includes('incorrecto: '), 'must never just say "incorrecto"')
}

function testMissingGivesTargetedHintWithoutFabricatedMastery() {
  const t = target({ label: 'Cociente de reacción Q', statement: 'Q se calcula igual que Keq pero con concentraciones actuales.' })
  const result = feedback([{ targetId: 't1', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' }], [t], { scoreBefore: 8, scoreAfter: 8 })
  assert.equal(result.status, 'missing')
  assert.equal(result.title, 'Vamos a reforzarlo')
  assert.equal(result.scoreChanged, false)
  assert.equal(result.betterExplanation, '', 'missing must never leak the full canonical answer before restudy')
  assert.ok(result.hint.includes('Cociente de reacción Q'), 'hint must point at the concept')
  assert.ok(!result.hint.includes('Q se calcula igual que Keq'), 'hint must not reveal the canonical statement itself')
}

function testMultiTargetMixedFeedback() {
  const targets = [
    target({ id: 'a', label: 'Concepto A', statement: 'Proposición canónica A.', importanceTier: 'critical' }),
    target({ id: 'b', label: 'Concepto B', statement: 'Proposición canónica B.', importanceTier: 'supporting' }),
    target({ id: 'c', label: 'Concepto C', statement: 'Proposición canónica C.', importanceTier: 'contextual' }),
  ]
  const result = feedback([
    { targetId: 'c', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
    { targetId: 'a', status: 'covered', evidence: 'e', demonstrated: 'Demostró A completamente.', missingDetail: '' },
    { targetId: 'b', status: 'partial', evidence: 'e', demonstrated: 'Demostró parte de B.', missingDetail: 'Le falta profundizar B.' },
  ], targets)
  assert.equal(result.status, 'partial', 'mixed covered+partial+missing must not collapse into correct or missing')
  // Sorted critical -> supporting -> contextual
  assert.equal(result.didWell[0], 'Concepto A: Demostró A completamente.')
  assert.ok(result.didWell.some(item => item.startsWith('Concepto B:')))
  assert.ok(result.needsWork.some(item => item.startsWith('Concepto B:')))
}

function testDeduplication() {
  const t = target()
  const result = feedback([{ targetId: 't1', status: 'partial', evidence: 'e', demonstrated: 'mismo texto', missingDetail: 'mismo texto falta' }], [t])
  const result2 = feedback([
    { targetId: 't1', status: 'partial', evidence: 'e', demonstrated: 'mismo texto', missingDetail: 'mismo texto falta' },
  ], [t])
  assert.deepEqual(result.didWell, result2.didWell)
  assert.equal(new Set(result.didWell).size, result.didWell.length)
}

function testNoExternalOrInventedContent() {
  // Target has NO statement and NO source spans — the function must never
  // invent chemistry/general knowledge to fill betterExplanation/correction.
  const t = target({ statement: '', sourceSpans: [] })
  const partial = feedback([{ targetId: 't1', status: 'partial', evidence: 'e', demonstrated: 'd', missingDetail: 'f' }], [t])
  assert.equal(partial.betterExplanation, '', 'no canonical statement available -> no fabricated model explanation')
  const incorrect = feedback([{ targetId: 't1', status: 'incorrect', evidence: 'e', demonstrated: '', missingDetail: 'f' }], [t])
  assert.equal(incorrect.correction.length, 0, 'no canonical statement available -> no fabricated correction')
}

function testInsufficientCanonicalEvidenceOmitsModelExplanation() {
  const t = target({ statement: '' })
  const result = feedback([{ targetId: 't1', status: 'partial', evidence: 'e', demonstrated: 'd', missingDetail: 'f' }], [t])
  assert.equal(result.betterExplanation, '')
}

function testScoreBehaviorPreserved() {
  const t = target()
  const unchanged = feedback([{ targetId: 't1', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' }], [t], { scoreBefore: 8, scoreAfter: 8 })
  assert.equal(unchanged.scoreChanged, false)
  const increased = feedback([{ targetId: 't1', status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' }], [t], { scoreBefore: 8, scoreAfter: 100 })
  assert.equal(increased.scoreChanged, true)
  assert.ok(increased.scoreAfter > increased.scoreBefore)
  const decreased = feedback([{ targetId: 't1', status: 'incorrect', evidence: 'e', demonstrated: '', missingDetail: 'f' }], [t], { scoreBefore: 10, scoreAfter: 4 })
  assert.equal(decreased.scoreChanged, true)
  assert.ok(decreased.scoreAfter < decreased.scoreBefore)
}

function testButtonAndControlSpacing() {
  const ui = readFileSync('components/materias/ALAIStudyALRepasar.tsx', 'utf8')
  assert.match(ui, /respuestas de recuperación<\/span><button[^>]*>/)
  assert.match(ui, /display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, gap: \d+/,
    'the answer-count/submit row must declare an explicit flex gap so the controls never visually touch')
  assert.match(ui, /justifyContent: 'flex-end', alignItems: 'center', gap: \d+/,
    '"Volver a estudiar" / "Intentar de nuevo" must sit in a row with an explicit gap')
}

function main() {
  testCoveredExplainsSuccess()
  testPartialExplainsDemonstratedAndMissing()
  testPartialIncludesActionableImprovement()
  testPartialCanonicalModelExplanation()
  testIncorrectIdentifiesContradictionAndCorrection()
  testMissingGivesTargetedHintWithoutFabricatedMastery()
  testMultiTargetMixedFeedback()
  testDeduplication()
  testNoExternalOrInventedContent()
  testInsufficientCanonicalEvidenceOmitsModelExplanation()
  testScoreBehaviorPreserved()
  testButtonAndControlSpacing()
  console.log('repaso-recovery-pedagogical-feedback-contracts: ALL PASS')
}

main()
