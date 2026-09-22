import './page-study-env'
import assert from 'node:assert/strict'
import { resolveTutorContext } from '../../lib/pageStudy/context'
import { applyDelta, coverageOf, createInitialState, currentBlock } from '../../lib/pageStudy/state'
import { buildTutorPrompt, suggestMove } from '../../lib/pageStudy/tutorPrompt'
import { makeWorld } from './page-study-tutor-harness'

/**
 * Phase 5B/5J pure-function contracts: the deterministic move policy and the prompt directives
 * it drives, plus the coverage-label consistency fix — tested directly against `suggestMove`,
 * `buildTutorPrompt` and `coverageOf`, independent of the provider/turn-sequencing harness (which
 * `page-study-tutor-contracts.ts` already covers end to end at the frozen Phase 3 cadence).
 */
async function main() {
  const w = await makeWorld()
  const state0 = (await w.load()).state
  const ctx0 = await resolveTutorContext(state0, w.deps().context, w.userId)
  const block = currentBlock(state0)!

  // A. A fresh chunk's SUGGESTED MOVE is TEACH, and its directive ends with a statement, never a question.
  const moveFresh = suggestMove(state0, ctx0)
  assert.equal(moveFresh.move, 'TEACH', 'A. fresh chunk starts with substantive teaching, not interrogation')
  const promptFresh = buildTutorPrompt({ state: state0, ctx: ctx0, message: '', role: null, deterministic: { role: null }, isStart: true, recent: [], pendingText: '' })
  assert.ok(promptFresh.includes('end with a statement, not a question'), 'A. TEACH directive ends with a statement')
  assert.ok(!promptFresh.includes('End with at most one question.'), 'A. TEACH turn is not told to end with a question')

  // Teach the first chunk (u1, u2) via a direct delta — no provider involved.
  const teach1 = applyDelta(state0, {
    baseRevision: state0.revision, turnSeq: state0.turnSeq + 1, at: Date.now(),
    ops: [{ op: 'units', blockKey: block.blockKey, total: 10 }, { op: 'teach', blockKey: block.blockKey, klass: 'FULL', units: [...ctx0.units.slice(0, 2).map(u => ({ unitRef: u.unitRef, materialId: u.materialId, label: u.label, kind: u.kind, pages: u.pages }))] }],
  })
  const ctx1 = await resolveTutorContext(teach1, w.deps().context, w.userId)

  // B/C. After exactly one teach turn, the next move is a check on genuinely UNTESTED ground (never a permission
  // question, never a re-ask of a concept the student hasn't even answered yet — the two units just taught).
  const moveAfterTeach = suggestMove(teach1, ctx1)
  assert.equal(moveAfterTeach.move, 'ASK', 'B. a check follows once meaningful new ground was taught')
  const untested = [...ctx1.taughtHandles].filter(([, ref]) => (teach1.concepts[ref]?.attempts.length ?? 0) === 0).map(([h]) => h)
  assert.ok(moveAfterTeach.handles.every(h => untested.includes(h)), 'C. the check targets ground that was never tested before')

  // Answer the check correctly, recording an attempt on those units.
  const askedRef = moveAfterTeach.handles.map(h => ctx1.taughtHandles.get(h)!)
  const answered = applyDelta(teach1, {
    baseRevision: teach1.revision, turnSeq: teach1.turnSeq + 1, at: Date.now(),
    ops: [
      { op: 'ask', ref: 'q1', unitRefs: askedRef, format: 'short', kind: 'mini' },
    ],
  })
  const graded = applyDelta(answered, {
    baseRevision: answered.revision, turnSeq: answered.turnSeq + 1, at: Date.now(),
    ops: [{ op: 'answer', verdict: 'correct', digest: 'ok' }],
  })

  // D. A concept the student already answered correctly is never chosen again by the deterministic ASK/RETEST
  // branch — this is exactly the "unique identity" → "emotional connection" → re-ask loop from the Falcons
  // regression: the server must sample new ground, not the same already-checked concept, whenever new material
  // remains.
  const ctx2 = await resolveTutorContext(graded, w.deps().context, w.userId)
  const moveAfterAnswer = suggestMove(graded, ctx2)
  assert.notEqual(moveAfterAnswer.move, 'ASK', 'D. immediately after a correct answer, the server does not force another check')
  assert.equal(moveAfterAnswer.move, 'TEACH', 'D. correct answer resumes teaching new material rather than re-testing the same ground')
  assert.ok(!moveAfterAnswer.handles.some(h => askedRef.includes(ctx2.handleToUnit.get(h) ?? ctx2.taughtHandles.get(h) ?? '')), 'D. the resumed move never targets the just-answered concept again')

  // E. The ASK/RETEST/RECALL/BLOCK_REVIEW directive explicitly forbids re-asking an already-answered concept.
  const promptAsk = buildTutorPrompt({ state: teach1, ctx: ctx1, message: '', role: null, deterministic: { role: null }, isStart: false, recent: [], pendingText: '' })
  assert.ok(promptAsk.includes('Do not ask about a concept the student already answered correctly'), 'E. server directive guards against re-interrogating a checked concept')

  // F/G/L. coverageOf: pagesDone and pct are two intentionally DIFFERENT truthful metrics — pct is
  // continuous content coverage, pagesDone is a literal whole-page/whole-block completion count.
  // Phase 5L audit: an earlier fix derived pagesDone FROM pct (rounding the fraction to a page
  // count) so the two numbers always agreed on screen — but for a 2-page block that is fake
  // precision: 25% rounds to "1 de 2 páginas", falsely claiming a whole page finished when zero
  // have. pagesDone must stay a real discrete count, never inferred from the percentage.
  const cov0 = coverageOf(state0)
  assert.equal(cov0.plan.pct, 0); assert.equal(cov0.plan.pagesDone, 0, 'F. untaught plan starts at 0/0, consistent')
  const cov1 = coverageOf(teach1)
  assert.ok(cov1.plan.pct > 0, 'G. content coverage advances once something is taught')
  assert.equal(cov1.plan.pagesDone, 0, 'L. pagesDone stays literally 0 until a whole block/page is actually done — even while pct > 0 (this is truthful, not a bug: they are different metrics)')

  // H. coverage is monotonic across teach → answer.
  const cov2 = coverageOf(graded)
  assert.ok(cov2.plan.pct >= cov1.plan.pct, 'H. coverage never regresses'); assert.ok(cov2.plan.pagesDone >= cov1.plan.pagesDone, 'H. pagesDone never regresses')

  // I. delayed retest: a weak concept is NOT offered as an immediate RETEST on the very next turn —
  // only once new material has been taught since the miss (or the block runs out of material,
  // where it instead flows into BLOCK_REVIEW/carryover, proven separately below).
  const askedRef2 = moveAfterTeach.handles.map(h => ctx1.taughtHandles.get(h)!)
  const askedAgain = applyDelta(teach1, {
    baseRevision: teach1.revision, turnSeq: teach1.turnSeq + 1, at: Date.now(),
    ops: [{ op: 'ask', ref: 'q1', unitRefs: askedRef2, format: 'short', kind: 'mini' }],
  })
  const failed = applyDelta(askedAgain, {
    baseRevision: askedAgain.revision, turnSeq: askedAgain.turnSeq + 1, at: Date.now(),
    ops: [{ op: 'answer', verdict: 'incorrect', digest: 'no se' }],
  })
  const ctx3 = await resolveTutorContext(failed, w.deps().context, w.userId)
  const moveRightAfterMiss = suggestMove(failed, ctx3)
  assert.notEqual(moveRightAfterMiss.move, 'RETEST', 'I. the very next move after a miss is NOT an immediate retest of the same concept')

  // Teach more material — genuine intervening activity.
  const teach2 = applyDelta(failed, {
    baseRevision: failed.revision, turnSeq: failed.turnSeq + 1, at: Date.now(),
    ops: [{ op: 'teach', blockKey: block.blockKey, klass: 'FULL', units: ctx3.units.slice(0, 2).map(u => ({ unitRef: u.unitRef, materialId: u.materialId, label: u.label, kind: u.kind, pages: u.pages })) }],
  })
  const ctx4 = await resolveTutorContext(teach2, w.deps().context, w.userId)
  const moveAfterIntervening = suggestMove(teach2, ctx4)
  assert.equal(moveAfterIntervening.move, 'RETEST', 'I. once new material was taught since the miss, the weak concept becomes eligible for delayed retest')

  console.log('PASS page-study-phase5-pedagogy: fresh chunk teaches (not interrogates), check targets untested ground, correct answer resumes teaching (not re-ask), coverage label/pct consistency + monotonicity')
}
main().catch(error => { console.error(error); process.exit(1) })
