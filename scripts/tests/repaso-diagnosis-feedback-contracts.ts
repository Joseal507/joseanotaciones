import assert from 'node:assert/strict'
import { projectRepasoDiagnosisFeedback } from '../../app/api/alai-studyal-repasar/route'
import type { RepasoTargetState } from '../../lib/materialBrain/repasoArtifact'
import type { RepasarReviewTarget } from '../../lib/materialBrain/reviewContext'

const target = (overrides: Partial<RepasarReviewTarget> = {}): RepasarReviewTarget => ({
  id: 't1', unitId: 't1', kind: 'concept', label: 'Cociente de reacción Q',
  statement: 'Q se calcula con la misma forma general que la expresión de equilibrio, usando las concentraciones actuales.',
  importanceTier: 'critical', materialId: 'm1', page: 4, pages: [4],
  sourceSpans: [{ page: 4, quote: 'Q se calcula igual que Keq pero con concentraciones actuales del sistema.' }],
  topicId: 'topic-1', topicTitle: 'Equilibrio químico', derivation: 'native_text', evidenceText: null,
  ...overrides,
})

const state = (overrides: Partial<RepasoTargetState> = {}): RepasoTargetState => ({
  targetId: 't1', status: 'missing', evidence: '', demonstrated: '', missingDetail: '',
  lastUpdatedBy: { kind: 'initial' }, recoveryAttemptCount: 0,
  ...overrides,
})

function testNeverBareNoAparecio() {
  const feedback = projectRepasoDiagnosisFeedback(state(), target())
  assert.notEqual(feedback.missing.trim(), '')
  assert.notEqual(feedback.missing.trim().toLowerCase(), 'no aparecio')
  assert.ok(feedback.missing.length > 5, 'must contain real pedagogical content, not a bare status word')
  assert.equal(feedback.targetLabel, 'Cociente de reacción Q')
  assert.equal(feedback.title, 'No lo explicaste todavía')
}

function testMissingDetailTakesPriorityWhenPresent() {
  const feedback = projectRepasoDiagnosisFeedback(state({ missingDetail: 'Te faltó explicar la fórmula exacta.' }), target())
  assert.equal(feedback.missing, 'Te faltó explicar la fórmula exacta.')
}

function testFallsBackToCanonicalStatementWhenMissingDetailBlank() {
  const feedback = projectRepasoDiagnosisFeedback(state(), target())
  assert.equal(feedback.missing, target().statement)
}

function testFallsBackToSourceSpanWhenNoStatement() {
  const t = target({ statement: '' })
  const feedback = projectRepasoDiagnosisFeedback(state(), t)
  assert.match(feedback.missing, /Q se calcula igual que Keq/)
}

function testFinalFallbackAlwaysNamesTarget() {
  const t = target({ statement: '', sourceSpans: [] })
  const feedback = projectRepasoDiagnosisFeedback(state(), t)
  assert.match(feedback.missing, /Cociente de reacción Q/)
}

function testFinalFallbackWithoutCanonicalTargetUsesTargetId() {
  const feedback = projectRepasoDiagnosisFeedback(state({ targetId: 'orphan-1' }), undefined)
  assert.match(feedback.missing, /orphan-1/)
  assert.equal(feedback.targetLabel, 'orphan-1')
}

function testCoveredAndPartialPreserved() {
  const covered = projectRepasoDiagnosisFeedback(state({ status: 'covered', demonstrated: 'Explicó bien la igualdad de velocidades.' }), target())
  assert.equal(covered.title, 'Bien demostrado')
  assert.equal(covered.demonstrated, 'Explicó bien la igualdad de velocidades.')

  const partial = projectRepasoDiagnosisFeedback(state({
    status: 'partial', demonstrated: 'Mencionó Q.', missingDetail: 'Le faltó comparar Q con K.',
  }), target())
  assert.equal(partial.title, 'Parcial')
  assert.equal(partial.demonstrated, 'Mencionó Q.')
  assert.equal(partial.missing, 'Le faltó comparar Q con K.')
}

function testIncorrectUsesCanonicalGapWithoutInventing() {
  const feedback = projectRepasoDiagnosisFeedback(state({ status: 'incorrect', demonstrated: 'Dijo que Q y K son lo mismo.' }), target())
  assert.equal(feedback.title, 'Hay que corregir esto')
  assert.equal(feedback.demonstrated, 'Dijo que Q y K son lo mismo.')
  assert.equal(feedback.missing, target().statement, 'incorrect fallback must come from canonical statement, never invented text')
}

function testTopicAndImportancePassThrough() {
  const feedback = projectRepasoDiagnosisFeedback(state(), target({ importanceTier: 'supporting', topicId: 'topic-2', topicTitle: 'Cinética' }))
  assert.equal(feedback.importance, 'supporting')
  assert.equal(feedback.topicId, 'topic-2')
  assert.equal(feedback.topicTitle, 'Cinética')
}

function main() {
  testNeverBareNoAparecio()
  testMissingDetailTakesPriorityWhenPresent()
  testFallsBackToCanonicalStatementWhenMissingDetailBlank()
  testFallsBackToSourceSpanWhenNoStatement()
  testFinalFallbackAlwaysNamesTarget()
  testFinalFallbackWithoutCanonicalTargetUsesTargetId()
  testCoveredAndPartialPreserved()
  testIncorrectUsesCanonicalGapWithoutInventing()
  testTopicAndImportancePassThrough()
  console.log('repaso-diagnosis-feedback-contracts: ALL PASS')
}

main()
