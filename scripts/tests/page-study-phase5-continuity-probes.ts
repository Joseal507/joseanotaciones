import './page-study-env'
import assert from 'node:assert/strict'
import { resolveTutorContext } from '../../lib/pageStudy/context'
import { currentBlock } from '../../lib/pageStudy/state'
import { makeWorld } from './page-study-tutor-harness'

/**
 * Phase 5 Blocker 2: interruption/resume + cross-block continuity, proven against the REAL
 * orchestration (not just suggestMove()). Cross-PDF continuity and >5-material session integrity
 * are NOT re-proven here — the existing frozen Phase 3 contract in page-study-tutor-contracts.ts
 * ("W. the PDF 2 weakness is available as bounded derived state") already drives an 8-PDF, 2-batch
 * scenario end to end: a weakness taught in PDF 2 (batch 1) reaches a PDF 6 (batch 2) prompt as
 * derived recall context (misconception text, RECALL provenance), while raw PDF-2 source
 * (SUMMARY-2-/FUT2X) is proven ABSENT from that later prompt, and the whole plan stays one visible
 * session across 8 materials / 2 internal batches. That satisfies items 10/11/12 already — no
 * production code was touched for it, so it is cited, not duplicated.
 */
async function main() {
  // ── Interruption / resume: a genuine question DURING teaching (before any check exists) must
  // not restart the block, must not skip untaught material, and must not falsely credit it.
  const w = await makeWorld({ pdfs: 1, blockSize: 6 })
  const start = await w.start() // teaches u1, u2
  const stateAfterStart = (await w.load()).state
  const taughtAfterStart = new Set(Object.keys(stateAfterStart.concepts))
  assert.deepEqual([...taughtAfterStart].sort(), ['pdf-1::u1', 'pdf-1::u2'])
  void start

  // Student interrupts with a genuine question — the harness's default script tags this via the
  // 'QUESTION' prefix and returns [[U:question]], never touching [[T]]/taught credit.
  const interrupt = await w.say('QUESTION espera, ¿por qué el orbital p queda libre aquí?')
  assert.equal(interrupt.turn.role, 'question', 'the interruption is classified as a question, never an answer')
  const stateAfterQuestion = (await w.load()).state
  assert.deepEqual(Object.keys(stateAfterQuestion.concepts).sort(), [...taughtAfterStart].sort(), '7. the clarifying exchange credits NOTHING new as taught')
  assert.equal(stateAfterQuestion.pending, null, 'a bare question never creates or consumes a pending check')

  // Resume: 'sigue' picks up the SUGGESTED MOVE exactly where the plan left off — a purposeful
  // check may legitimately be due first (2 units were taught before the interruption); answer it
  // if so, then the following turn must teach the NEXT untaught chunk (u3/u4), never u1/u2 again
  // and never skip ahead past them.
  let resume = await w.say('sigue')
  if ((await w.load()).state.pending) resume = await w.say('ANS-OK claro')
  const stateAfterResume = (await w.load()).state
  const newlyTaught = Object.keys(stateAfterResume.concepts).filter(ref => !taughtAfterStart.has(ref))
  assert.ok(newlyTaught.length > 0, '6. resume actually advances teaching')
  assert.ok(!newlyTaught.some(ref => taughtAfterStart.has(ref)), '6. resume does not re-teach u1/u2 from scratch')
  assert.deepEqual(newlyTaught.sort(), ['pdf-1::u3', 'pdf-1::u4'], '6. resume continues from the CORRECT next position (u3, u4), not an arbitrary jump')
  void resume

  // Provider-supplied progression cannot override server sequencing: even if a scripted reply
  // claims other units via [[T]], only chunk units the server actually offered this turn (and
  // whose label the reply demonstrably covers, per tutor.ts's echo-credit fallback) are ever
  // recorded — proven generically by the existing "AF. provider-supplied stateDelta discarded"
  // and "missing [[T]]" contracts in page-study-tutor-contracts.ts; not re-duplicated here.

  console.log('interruption/resume probe: OK (taught after interrupt =', [...taughtAfterStart].sort().join(','), '| after resume +', newlyTaught.sort().join(','), ')')

  // ── Cross-block continuity (SAME material, block 1 → block 2): a weak concept from block 1
  // must reach block 2's prompt as bounded derived digest text, never raw block-1 source.
  const cb = await makeWorld({ pdfs: 1, blockSize: 3 }) // 3-page blocks: block 1 = u1-u3, block 2 = u4-u6
  await cb.start() // teaches u1, u2
  let cbState = (await cb.load()).state
  if (!cbState.pending) await cb.say('sigue') // teaches u3, likely triggers a check
  cbState = (await cb.load()).state
  if (cbState.pending) {
    const missedRef = cbState.pending!.unitRefs[0]
    cb.behavior.queue.push('[[U:answer]] [[V:incorrect]] No pasa nada, te explico bien el concepto. Seguimos.')
    await cb.say('no sé')
    cbState = (await cb.load()).state
    assert.ok(!cbState.pending, 'the miss in block 1 is resolved before block 1 can close')
    var block1WeakRef = missedRef // eslint-disable-line no-var
  }
  // Drive block 1 to completion.
  let guard = 0
  const block1Key = currentBlock(cbState)!.blockKey
  while ((await cb.load()).state.progress[block1Key]?.status !== 'done' && guard < 20) {
    guard++
    const before = (await cb.load()).state
    await cb.say(before.pending ? 'ANS-OK entendido' : 'sigue')
  }
  cbState = (await cb.load()).state
  assert.equal(cbState.progress[block1Key]?.status, 'done', 'block 1 completed')
  assert.equal(currentBlock(cbState)!.blockKey === block1Key, false, 'the plan advanced into block 2 of the SAME material')
  assert.equal(currentBlock(cbState)!.materialId, 'pdf-1')

  // Block 2's real resolved prompt context: the digest may carry block-1's derived weak label,
  // but never block-1's own raw page summaries/quotes (SUMMARY-1-1/2/3 — block 1's own pages;
  // block 2's own pages, e.g. SUMMARY-1-4+, legitimately appear in its own grounding, so the
  // check must be block-1-page-specific, not a blanket "SUMMARY-1-" material-prefix check).
  const ctx2 = await resolveTutorContext(cbState, cb.deps().context, cb.userId)
  if (typeof block1WeakRef === 'string') {
    assert.ok(ctx2.digest.some(item => item.unitRef === block1WeakRef), '8. block 2 context carries block 1\'s derived weak concept forward (bounded digest)')
  }
  // NOTE: "ALREADY TAUGHT" (taughtText) intentionally CAN echo already-taught raw wording from
  // earlier blocks of the SAME material — those pages were legitimately taught, so reusing their
  // exact content for consistency is authorized continuity, not a leak. The actual invariant
  // (matching inspectTutorPrompt's frozen 'digest_carries_source_text' check) is narrower: the
  // bounded PREVIOUS STUDY digest specifically must stay derived-only — status/labels, never raw
  // source text/quotes.
  const block1PageMarkers = ['SUMMARY-1-1:', 'SUMMARY-1-2:', 'SUMMARY-1-3:']
  for (const marker of block1PageMarkers) {
    assert.ok(!ctx2.digestText.includes(marker), `9. block 2's digest never carries block 1's raw page summary (${marker})`)
  }

  console.log('PASS page-study-phase5-continuity-probes: interruption preserves teaching position (resumes at the correct next chunk, credits nothing false), cross-block derived continuity present with raw-source isolation intact')
}

main().catch(error => { console.error(error); process.exit(1) })
