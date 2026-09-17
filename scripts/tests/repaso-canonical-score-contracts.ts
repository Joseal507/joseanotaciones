import assert from 'node:assert/strict'
import {
  computeRepasarDomainMap, computeRepasoCanonicalScore,
  type RepasarReviewTarget,
} from '../../lib/materialBrain/reviewContext'
import { computeRepasoLetterGrade } from '../../app/api/alai-studyal-repasar/route'
import { computeRepasoMasteryStatus } from '../../lib/materialBrain/repasoArtifact'

// ============================================================
// REPASO SCORE V2 — pure canonical score contract (Stage 2.5A).
// covered=1.0, partial=0.5, missing/incorrect=0 credit, weighted by the
// EXISTING IMPORTANCE_WEIGHT tiers (critical=3, supporting=2,
// contextual=1) via computeRepasarDomainMap's own weighted fields — this
// suite never redefines those weights, it exercises the real path.
// ============================================================

function target(id: string, importanceTier: RepasarReviewTarget['importanceTier']): RepasarReviewTarget {
  return {
    id, unitId: id, kind: 'concept', label: id, statement: id, importanceTier,
    difficulty: null, topicId: null, topicTitle: null, sourceOrder: 0, materialId: 'm1',
    page: 1, pages: [1], sourceSpans: [], derivation: null, evidenceText: id,
  }
}

function verdict(targetId: string, status: 'covered' | 'partial' | 'missing' | 'incorrect') {
  return { targetId, status }
}

function testAllCovered() {
  const targets = [target('t1', 'supporting'), target('t2', 'critical'), target('t3', 'contextual')]
  const verdicts = targets.map(t => verdict(t.id, 'covered'))
  const domainMap = computeRepasarDomainMap(targets, verdicts)
  assert.equal(computeRepasoCanonicalScore(domainMap), 100)
  console.log('repaso-canonical-score: A (all covered -> 100) PASS')
}

function testAllMissing() {
  const targets = [target('t1', 'supporting'), target('t2', 'critical')]
  const domainMap = computeRepasarDomainMap(targets, [])
  assert.equal(computeRepasoCanonicalScore(domainMap), 0)
  console.log('repaso-canonical-score: B (all missing -> 0) PASS')
}

function testAllIncorrect() {
  const targets = [target('t1', 'supporting'), target('t2', 'critical')]
  const verdicts = targets.map(t => verdict(t.id, 'incorrect'))
  const domainMap = computeRepasarDomainMap(targets, verdicts)
  assert.equal(computeRepasoCanonicalScore(domainMap), 0)
  console.log('repaso-canonical-score: C (all incorrect -> 0) PASS')
}

function testAllPartial() {
  const targets = [target('t1', 'supporting'), target('t2', 'supporting')]
  const verdicts = targets.map(t => verdict(t.id, 'partial'))
  const domainMap = computeRepasarDomainMap(targets, verdicts)
  assert.equal(computeRepasoCanonicalScore(domainMap), 50)
  console.log('repaso-canonical-score: D (all partial -> 50) PASS')
}

function testMixedStatusesAndImportance() {
  // t1 critical(3) covered -> 3.0 credit
  // t2 supporting(2) partial -> 1.0 credit
  // t3 contextual(1) missing -> 0 credit
  // t4 supporting(2) incorrect -> 0 credit
  // totalWeight = 3+2+1+2 = 8, credit = 3+1 = 4 -> 400/8 = 50%
  const targets = [target('t1', 'critical'), target('t2', 'supporting'), target('t3', 'contextual'), target('t4', 'supporting')]
  const verdicts = [verdict('t1', 'covered'), verdict('t2', 'partial'), verdict('t4', 'incorrect')]
  const domainMap = computeRepasarDomainMap(targets, verdicts)
  assert.equal(domainMap.totalWeight, 8)
  assert.equal(domainMap.correctWeight, 3)
  assert.equal(domainMap.partialWeight, 2)
  const expected = Math.round(((3 + 2 * 0.5) / 8) * 100)
  assert.equal(expected, 50)
  assert.equal(computeRepasoCanonicalScore(domainMap), 50)
  console.log('repaso-canonical-score: E (mixed statuses + mixed importance, hand-computed = 50) PASS')
}

function testOrderPermutationInvariance() {
  const targetsA = [target('t1', 'critical'), target('t2', 'supporting'), target('t3', 'contextual')]
  const targetsB = [target('t3', 'contextual'), target('t1', 'critical'), target('t2', 'supporting')]
  const verdictsA = [verdict('t1', 'covered'), verdict('t2', 'partial'), verdict('t3', 'missing')]
  const verdictsB = [verdict('t3', 'missing'), verdict('t2', 'partial'), verdict('t1', 'covered')]
  const scoreA = computeRepasoCanonicalScore(computeRepasarDomainMap(targetsA, verdictsA))
  const scoreB = computeRepasoCanonicalScore(computeRepasarDomainMap(targetsB, verdictsB))
  assert.equal(scoreA, scoreB)
  console.log('repaso-canonical-score: F (order permutation invariant) PASS')
}

function testTotalWeightZero() {
  const domainMap = computeRepasarDomainMap([], [])
  assert.equal(domainMap.totalWeight, 0)
  assert.equal(computeRepasoCanonicalScore(domainMap), 0)
  console.log('repaso-canonical-score: G (totalWeight <= 0 -> 0) PASS')
}

function testScoreBounded() {
  for (const targets of [
    [target('t1', 'critical')],
    [target('t1', 'contextual'), target('t2', 'contextual')],
  ]) {
    for (const status of ['covered', 'partial', 'missing', 'incorrect'] as const) {
      const verdicts = targets.map(t => verdict(t.id, status))
      const score = computeRepasoCanonicalScore(computeRepasarDomainMap(targets, verdicts))
      assert.ok(score >= 0 && score <= 100, `score ${score} out of [0,100] bounds`)
    }
  }
  console.log('repaso-canonical-score: H (score always bounded 0-100) PASS')
}

function testLetterDerivesFromScore() {
  const targets = [target('t1', 'critical')]
  const domainMap = computeRepasarDomainMap(targets, [verdict('t1', 'covered')])
  const score = computeRepasoCanonicalScore(domainMap)
  assert.equal(score, 100)
  assert.equal(computeRepasoLetterGrade(score), 'A+')
  console.log('repaso-canonical-score: letter-derivation PASS')
}

function testFullCoverageIsMasteredDirectly() {
  // FINAL PRODUCT FLOW: Final Verification is retired — full assessable
  // coverage completes Repaso directly, with no intermediate gate.
  const targets = [target('t1', 'critical'), target('t2', 'supporting')]
  const domainMap = computeRepasarDomainMap(targets, targets.map(t => verdict(t.id, 'covered')))
  assert.equal(computeRepasoCanonicalScore(domainMap), 100, 'full coverage genuinely scores 100 -- no 99 cap')

  const coveredStates = Object.fromEntries(targets.map(t => [t.id, {
    targetId: t.id, status: 'covered' as const, evidence: 'ev', demonstrated: 'dem', missingDetail: '',
    lastUpdatedBy: { kind: 'initial' as const }, recoveryAttemptCount: 0,
  }]))
  const status = computeRepasoMasteryStatus(coveredStates, null)
  assert.equal(status, 'mastered', '100% coverage must complete Repaso directly -- no Final Verification gate')
  console.log('repaso-canonical-score: 100-coverage-is-mastered-directly PASS')
}

function main() {
  testAllCovered()
  testAllMissing()
  testAllIncorrect()
  testAllPartial()
  testMixedStatusesAndImportance()
  testOrderPermutationInvariance()
  testTotalWeightZero()
  testScoreBounded()
  testLetterDerivesFromScore()
  testFullCoverageIsMasteredDirectly()
  console.log('repaso-canonical-score-contracts: ALL PASS')
}

main()
