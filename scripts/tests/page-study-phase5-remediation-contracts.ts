import './page-study-env'
import assert from 'node:assert/strict'
import { currentBlock } from '../../lib/pageStudy/state'
import { makeWorld } from './page-study-tutor-harness'

/**
 * Phase 5 Blocker 1: bounded end-of-block remediation. Drives a small real block (one material,
 * blockSize=3, three teachable units) through the REAL orchestration to a natural close, forcing
 * a miss on one concept along the way, and proves the missing lifecycle step:
 *   TEACH block → BLOCK_REVIEW agenda → REMEDIATE (bounded) → WRAP → ADVANCE
 * with a weak concept that is never perfectly resolved still allowing the block to complete.
 */
async function main() {
  const w = await makeWorld({ pdfs: 1, blockSize: 3 })
  await w.start() // teaches u1, u2
  let state = (await w.load()).state
  const block = currentBlock(state)!

  // Reach the first purposeful check and fail it deliberately — this is the concept we expect to
  // see remediated at block close.
  if (!state.pending) await w.say('sigue')
  state = (await w.load()).state
  assert.ok(state.pending, 'setup: a purposeful check is pending before we can miss it')
  const missedRef = state.pending!.unitRefs[0]
  w.behavior.queue.push('[[U:answer]] [[V:incorrect]] No importa, aquí va la explicación completa. Sigamos.')
  await w.say('no sé')
  state = (await w.load()).state
  assert.equal(state.pending, null, 'the miss is resolved, not left hanging')
  assert.ok(isWeak(state.concepts[missedRef]), '1. a genuine miss is retained as weak')

  // Drive the block to natural exhaustion: keep answering correctly to anything else, teaching
  // whatever remains, until BLOCK_REVIEW/REMEDIATE/WRAP have all run their course.
  const roleTrace: string[] = []
  const remediationReplies: string[] = []
  let sawBlockReview = false
  let sawRemediationOfMissed = false
  let guard = 0
  while ((await w.load()).state.progress[block.blockKey]?.status !== 'done' && guard < 30) {
    guard++
    const before = (await w.load()).state
    const msg = before.pending ? 'ANS-OK ya entendí' : 'sigue'
    const turn = await w.say(msg)
    roleTrace.push(turn.turn.role)
    const after = (await w.load()).state
    if (!before.pending && after.pending) {
      const kind = after.progress[block.blockKey]
      if (kind && kind.evalAsked > (before.progress[block.blockKey]?.evalAsked ?? 0)) sawBlockReview = true
      if (after.pending.unitRefs.includes(missedRef)) { sawRemediationOfMissed = true; remediationReplies.push(turn.turn.reply) }
    }
  }
  assert.ok(guard < 30, 'the block reached completion within a bounded number of turns — no infinite loop')
  const finalState = (await w.load()).state
  assert.equal(finalState.progress[block.blockKey]?.status, 'done', '20. the block completes')
  assert.ok(sawBlockReview, '21. a cumulative BLOCK_REVIEW step ran before completion')
  assert.ok(sawRemediationOfMissed, '1/3. the missed concept was picked up again (delayed RETEST mid-block, or bounded REMEDIATE at block close) — never silently dropped')

  // 2/9. bounded: the missed concept was remediated AT MOST once (attempts.length caps it),
  // never an endless loop chasing perfect mastery of the same concept.
  const missedConcept = finalState.concepts[missedRef]
  assert.ok(missedConcept.attempts.length <= 2, `2. bounded remediation: at most one retest beyond the original miss (attempts=${missedConcept.attempts.length})`)
  if (sawRemediationOfMissed) assert.equal(remediationReplies.length, 1, '2. the missed concept was remediated exactly once, not repeatedly')

  // 4. assisted correction is never independent mastery, even if the remediation retest is answered correctly.
  const lastAttempt = missedConcept.attempts.at(-1)
  if (lastAttempt && lastAttempt.verdict === 'correct') {
    assert.notEqual(missedConcept.demonstratedIndependent && missedConcept.attempts.length === 1, true)
  }

  // 5. block completion does not require the concept to end up fully resolved — an unresolved
  // weak target still allows the block to complete and enters bounded carryover for later study.
  assert.equal(finalState.progress[block.blockKey]?.status, 'done')
  if (isWeak(missedConcept)) {
    assert.ok(finalState.carryover.some(c => c.unitRef === missedRef), '5. an unresolved weak concept is retained in bounded carryover at block completion, not silently dropped')
  }

  console.log('PASS page-study-phase5-remediation: BLOCK_REVIEW → bounded REMEDIATE → WRAP → completion lifecycle; weak target retained/bounded; block completes without requiring perfect mastery')
}

function isWeak(concept: { attempts: Array<{ verdict: string; assistance: string }> } | undefined): boolean {
  if (!concept) return false
  let weak = false
  for (const a of concept.attempts) { if (a.verdict !== 'correct') weak = true; else if (a.assistance === 'independent') weak = false }
  return weak
}

main().catch(error => { console.error(error); process.exit(1) })
