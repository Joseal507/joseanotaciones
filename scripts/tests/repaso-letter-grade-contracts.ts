import assert from 'node:assert/strict'
import { computeRepasoLetterGrade } from '../../app/api/alai-studyal-repasar/route'

// ============================================================
// REPASO PRODUCT REDESIGN — Stage 1 slice: the deterministic "professor
// paper" letter grade. Pure function of the ALREADY-canonical Repaso
// score (calibrateRepasarScore <- computeRepasarMastery <- domainMap) —
// never a provider-assigned letter, never a second scoring formula.
// ============================================================

const CASES: [number, string][] = [
  [100, 'A+'], [97, 'A+'], [96, 'A'], [93, 'A'], [92, 'A-'], [90, 'A-'],
  [89, 'B+'], [87, 'B+'], [86, 'B'], [83, 'B'], [82, 'B-'], [80, 'B-'],
  [79, 'C+'], [77, 'C+'], [76, 'C'], [73, 'C'], [72, 'C-'], [70, 'C-'],
  [69, 'D'], [60, 'D'], [59, 'F'], [18, 'F'], [0, 'F'],
]

function testBoundaries() {
  for (const [score, expected] of CASES) {
    assert.equal(computeRepasoLetterGrade(score), expected, `score ${score} -> expected ${expected}`)
  }
  console.log('repaso-letter-grade: boundary cases PASS')
}

function testClampingAndCoercion() {
  assert.equal(computeRepasoLetterGrade(-5), 'F', 'negative scores clamp to F, never crash/negative-index')
  assert.equal(computeRepasoLetterGrade(150), 'A+', 'scores above 100 clamp to A+, never a fabricated super-grade')
  assert.equal(computeRepasoLetterGrade(NaN), 'F', 'NaN never produces an undefined/crashing letter')
  assert.equal(computeRepasoLetterGrade(18.4), 'F', 'fractional scores round deterministically before banding')
  console.log('repaso-letter-grade: clamping/coercion PASS')
}

function testMonotonic() {
  let prevRank = -1
  const order = ['F', 'D', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+']
  for (let score = 0; score <= 100; score++) {
    const rank = order.indexOf(computeRepasoLetterGrade(score))
    assert.ok(rank >= prevRank, `letter grade must never regress as score increases (score=${score})`)
    prevRank = rank
  }
  console.log('repaso-letter-grade: monotonicity PASS')
}

function main() {
  testBoundaries()
  testClampingAndCoercion()
  testMonotonic()
  console.log('repaso-letter-grade-contracts: ALL PASS')
}

main()
