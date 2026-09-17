import assert from 'node:assert/strict'
import { mcqHasLengthLeak } from '../../app/api/alai-studyal-exam/route'

function main() {
  // Live-reported pattern: correct option ~250 chars, distractors ~70 chars — must reject.
  const leaking = [
    'A'.repeat(250),
    'B'.repeat(70),
    'C'.repeat(68),
    'D'.repeat(72),
  ]
  assert.equal(mcqHasLengthLeak(leaking, 0), true, 'obvious correct-option length cue is rejected')

  // Reasonable natural variation must be accepted.
  const reasonable = [
    'E'.repeat(120),
    'F'.repeat(80),
    'G'.repeat(90),
    'H'.repeat(70),
  ]
  assert.equal(mcqHasLengthLeak(reasonable, 0), false, 'reasonable length variation is accepted')

  // Reverse leak: correct answer suspiciously terse next to long distractors.
  const reverseLeak = [
    'I'.repeat(30),
    'J'.repeat(200),
    'K'.repeat(210),
    'L'.repeat(190),
  ]
  assert.equal(mcqHasLengthLeak(reverseLeak, 0), true, 'suspiciously terse correct answer next to long distractors is rejected')

  // Short options overall never trip the heuristic (too little signal).
  const allShort = ['a', 'bb', 'ccc', 'dddd']
  assert.equal(mcqHasLengthLeak(allShort, 0), false, 'short options never trigger the heuristic')

  console.log('mcq-length-leak-contracts: ALL PASS')
}

main()
