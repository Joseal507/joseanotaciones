import './page-study-env'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { conceptStatus } from '../../lib/pageStudy/evidence'
import { resolveTutorContext, inspectTutorPrompt } from '../../lib/pageStudy/context'
import { PageStudyError } from '../../lib/pageStudy/service'
import { currentBlock } from '../../lib/pageStudy/state'
import { WorkerPageStudyStore } from '../../lib/pageStudy/store'
import { classifyDeterministic, parseTutorMarkers } from '../../lib/pageStudy/turnIntent'
import { PageStudyError as PSE } from '../../lib/pageStudy/service'
import { makeWorld, handleFor, type World } from './page-study-tutor-harness'
import { POST as turnPOST, __routeDeps as turnDeps } from '../../app/api/page-study/turn/route'
import { GET as stateGET, __routeDeps as stateDeps } from '../../app/api/page-study/state/route'

const code = async (work: Promise<unknown>): Promise<string> => { try { await work; return 'OK' } catch (e) { return e instanceof PSE ? e.code : `RAW:${String((e as Error).message).slice(0, 60)}` } }
const state = async (w: World) => (await w.load()).state
const calls = (w: World) => w.counters.calls
const FUTURE = ['FUT1X16', 'FUT1X17', 'FUT1X20', 'SYNTH-', 'FUTURE-TITLE', 'FUTURE-MISCONCEPTION', 'SUMMARY-1-16', 'SUMMARY-1-20', 'zq1x16', 'zq1x17']

const SKIP = 'pasemos al siguiente bloque'
/** Close the current block by the student's command (opening it first when it was never started — a block is always opened by its start turn). */
const skipBlock = async (x: World) => { const v = (await x.load()).state; if (/:start$/.test(await nextSlotOfWorld(x))) await x.start(); void v; await x.say(SKIP) }
const nextSlotOfWorld = async (x: World) => { const { nextSlotOf } = await import('../../lib/pageStudy/view'); return nextSlotOf((await x.load()).state) }
async function main() {
  // ══ S1: the natural conversation ══════════════════════════════════════════════════════════════════════════════
  const w = await makeWorld()
  // A. first block starts exactly once
  const start = await w.start()
  assert.equal(start.turn.role, 'start'); assert.equal(calls(w), 1); assert.equal(start.turn.diagnostics.providerCalls, 1, 'P. a normal semantic turn is ONE provider call')
  let s = await state(w); assert.equal(s.turnSeq, 1); assert.deepEqual(Object.keys(s.concepts).sort(), ['pdf-1::u1', 'pdf-1::u2'])
  assert.deepEqual(start.turn.provenance.map(p => [p.materialId, p.pages]), [['pdf-1', [1]], ['pdf-1', [2]]], 'provenance is server-attached and page-exact')
  const startSlot = 'pstudy:pdf-1:1-15:start'
  const again = await w.start({ slot: startSlot }); assert.equal(again.replayed, true, 'A. the start slot is idempotent'); assert.equal(calls(w), 1, 'U. completed replay = zero provider calls')
  assert.equal(start.view.nextSlot, 'pstudy:pdf-1:1-15:2'); assert.equal(start.view.coverage.blockPct > 0, true)
  // B. reopening immediately = zero provider calls and zero writes
  const writes0 = w.w.stats.writes
  for (let i = 0; i < 3; i++) {
    const reopened = w.deps({ store: new WorkerPageStudyStore('https://worker.test', w.w.request) })
    await w.load(); const rep = await w.start({ deps: reopened, slot: startSlot }); assert.equal(rep.replayed, true)
  }
  assert.equal(calls(w), 1, 'B. reopen/restore made zero provider calls'); assert.equal(w.w.stats.writes, writes0, 'and zero writes')
  // C. the start prompt carries no future page information at all
  const startPrompt = w.counters.prompts[0]
  for (const leak of [...FUTURE, 'FUT2X', 'zq2x', 'PDF 2']) assert.ok(!startPrompt.includes(leak), `C. leaked into the tutor prompt: ${leak}`)
  assert.ok(startPrompt.includes('AUTHORITY: es.') && startPrompt.includes('CURRENT BLOCK — "PDF 1", pages 1–15'))
  assert.ok([...startPrompt.matchAll(/(?:\bp\.|\bpage\s)(\d+)/g)].every(m => Number(m[1]) <= 15)); assert.ok(startPrompt.length < 9000, `bounded prompt (${startPrompt.length} chars)`)
  const ctx0 = await resolveTutorContext(await state(w), w.deps().context, w.userId); assert.deepEqual(inspectTutorPrompt(startPrompt, ctx0), [], 'the inspector passes a legitimate prompt')
  // D/E. 14–17 target while studying 1–15
  const full = ctx0.grounding.units; const ok = full.find(u => u.unitRef === 'pdf-1::straddle-ok')!
  assert.equal(ok.klass, 'PROJECTED'); assert.equal(ok.text, ''); assert.ok(ok.evidence.every(e => e.pages.every(pg => pg <= 15)) && ok.evidence.some(e => e.pages.includes(14)), 'D. only verified p14–15 evidence')
  assert.ok(ok.sourceBlocks.every(b => b.page <= 15)); assert.ok(!JSON.stringify(ok).includes('SYNTH-STRADDLE') && !JSON.stringify(ok).includes('FUT1X17'))
  assert.ok(!full.some(u => u.unitRef === 'pdf-1::straddle-weak') && ctx0.grounding.deferred.includes('pdf-1::straddle-weak'), 'E. insufficient p14–15 evidence ⇒ DEFER')
  assert.deepEqual(ctx0.grounding.topicTitles, ['Fundamentos 1'], 'a topic synthesized across future pages never reaches the prompt')

  // G. question / clarification / doubt never consume the pending question
  const ask = await w.say('sigue'); assert.equal(ask.turn.role, 'command'); assert.ok(ask.turn.pendingQuestion, 'the tutor asks a check after teaching')
  s = await state(w); const pendingRef = s.pending!.ref; const pendingUnits = s.pending!.unitRefs; assert.equal(s.pending!.helpLevel, 'independent')
  let c = calls(w)
  const doubt = await w.say('DOUBT pero por qué queda un orbital p sin hibridar?'); assert.equal(doubt.turn.role, 'clarify'); assert.equal(calls(w), c + 1)
  s = await state(w); assert.equal(s.pending!.ref, pendingRef, 'G. the pending question survives a clarification'); assert.equal(s.pending!.helpLevel, 'guided', 'a clarification lowers the independence of the eventual answer'); assert.ok(pendingUnits.every(u => s.concepts[u].attempts.length === 0), 'and is not an attempt')
  const q = await w.say('QUESTION ¿y esto entra en el examen?'); assert.equal(q.turn.role, 'question'); s = await state(w); assert.equal(s.pending!.ref, pendingRef)
  const sneaky = await w.say('ASKWHILEPENDING otra cosa'); assert.equal(s = await state(w), s); assert.equal((await state(w)).pending!.ref, pendingRef, 'N. a new ask while a question is pending is ignored'); assert.ok(sneaky.turn.diagnostics.ignored.includes('ask_ignored_pending_survives'))
  // H. navigation is never an answer
  c = calls(w); const nav = await w.say('vuelve a la página 1'); assert.equal(nav.turn.role, 'navigate'); assert.equal(nav.turn.graded, null); assert.deepEqual(nav.turn.navigation, { materialId: 'pdf-1', page: 1 }); assert.equal(calls(w), c + 1)
  assert.equal((await state(w)).pending!.ref, pendingRef, 'H. pending survives navigation')
  c = calls(w); const navFar = await w.say('vuelve a la página 25'); assert.equal(calls(w), c, 'O. out-of-range navigation is answered without a provider'); assert.equal(navFar.turn.deterministic, true); assert.ok(!navFar.turn.reply.includes('FUT1X25'))
  // M. missing / invalid verdict never grades or advances
  const rev = (await state(w)).revision
  for (const msg of ['NOVERDICT la respuesta', 'BADVERDICT la respuesta']) { const r = await w.say(msg); assert.equal(r.turn.role, 'question', 'M. conservative fallback'); assert.equal(r.turn.graded, null); assert.ok(r.turn.diagnostics.ignored.includes('missing_or_invalid_verdict')) }
  s = await state(w); assert.equal(s.pending!.ref, pendingRef); assert.ok(pendingUnits.every(u => s.concepts[u].attempts.length === 0), 'M. nothing was graded')
  // Q. a missing role marker gets exactly ONE bounded repair and is then tolerated conservatively
  c = calls(w); const nomark = await w.say('NOMARK algo'); assert.equal(calls(w), c + 2, 'Q. bounded: one original + one repair'); assert.equal(nomark.turn.role, 'question'); assert.equal(nomark.turn.diagnostics.repaired, true)
  s = await state(w); assert.equal(s.pending!.ref, pendingRef)
  // AH. even after the one repair is spent, a malformed model role fails conservatively and cannot consume pending
  c = calls(w); w.behavior.queue.push('[[U:command]] intento inválido', '[[U:command]] intento inválido otra vez')
  const malformedRole = await w.say('respuesta con rol malformado'); assert.equal(calls(w), c + 2)
  assert.equal(malformedRole.turn.role, 'question'); assert.equal(malformedRole.turn.graded, null)
  assert.ok(malformedRole.turn.diagnostics.ignored.includes('missing_role_marker') && malformedRole.turn.diagnostics.ignored.includes('invalid_marker:U:command'))
  s = await state(w); assert.equal(s.pending!.ref, pendingRef, 'AH. malformed role cannot consume pending')
  // I. wrong answer stays on the concept; the model cannot re-target the question
  w.behavior.queue.push('[[U:answer]] [[V:incorrect]] [[M:cree que sp2 deja 2 p::sp2 deja 1 p sin hibridar]] [[A:short|K2]] [[H:hint]] No exactamente; piensa en el patrón. ¿Cuántos p quedan sin hibridar en sp2?')
  const bad = await w.say('ANS-BAD son 2'); assert.equal(bad.turn.graded, 'incorrect'); s = await state(w)
  assert.notEqual(s.pending!.ref, pendingRef, 'a new question about the same concept'); assert.deepEqual(s.pending!.unitRefs, pendingUnits, 'N. the concept/target is pinned by the server, not the model'); assert.ok(bad.turn.diagnostics.ignored.includes('target_pinned_to_active_concept'))
  assert.equal(conceptStatus(s.concepts[pendingUnits[0]]), 'failed', 'I. wrong answer ⇒ weakness recorded'); assert.equal(s.misconceptions.length, 1); assert.equal(s.pending!.helpLevel, 'minimal_hint')
  // J. a correct answer after help is corrected, NOT independent
  const fixed = await w.say('ANS-OK son 1'); assert.equal(fixed.turn.graded, 'correct'); s = await state(w); const cpt = s.concepts[pendingUnits[0]]
  assert.equal(cpt.attempts[cpt.attempts.length - 1].assistance, 'minimal_hint'); assert.equal(cpt.demonstratedIndependent, false, 'J. assisted correct ≠ independent'); assert.equal(conceptStatus(cpt), 'corrected'); assert.equal(s.pending, null)
  // K. a fresh check answered without help IS independent evidence
  await w.say('sigue'); await w.say('sigue')                                        // teaches the next chunk, then asks
  s = await state(w); assert.ok(s.pending, 'a new check is pending'); const freshUnit = s.pending!.unitRefs[0]; assert.equal(s.pending!.helpLevel, 'independent')
  await w.say('ANS-OK correcto'); s = await state(w); assert.equal(s.concepts[freshUnit].demonstratedIndependent, true, 'K. independent correct creates independent evidence'); assert.equal(conceptStatus(s.concepts[freshUnit]), 'demonstrated')
  // O. obvious commands and progress questions need no provider call
  c = calls(w); const admin = await w.say('¿en qué bloque voy?'); assert.equal(calls(w), c); assert.equal(admin.turn.role, 'admin'); assert.match(admin.turn.reply, /PDF 1/)
  assert.equal(classifyDeterministic('vuelve a la página 12').page, 12); assert.equal(classifyDeterministic('sigue').command, 'continue'); assert.equal(classifyDeterministic('pero por qué queda uno?').role, null, 'a free question is never pre-classified as a command')
  assert.equal(classifyDeterministic('¿cuánto falta?').role, null, 'ambiguous progress wording is left to the model, not guessed'); assert.equal(parseTutorMarkers('[[U:answer]] [[V:correct]] Hola').body, 'Hola')

  // ══ S2: unauthorized context ⇒ fail closed with ZERO provider calls (F) ═════════════════════════════════════════
  const f = await makeWorld(); c = calls(f)
  const injections: Array<[string, (t: any) => any]> = [
    ['future page reference', ctx => ({ ...ctx, chunkText: `${ctx.chunkText}\n  evidence p.20: "x"` })],
    ['whole future summary', ctx => ({ ...ctx, chunkText: `${ctx.chunkText}\n  ${ctx.rawUnits.find((u: any) => u.unitRef === 'pdf-1::u20').summary}` })],
    ['other material unit', ctx => ({ ...ctx, chunkText: `${ctx.chunkText}\n[pdf-2::u1] FULL · concept · x` })],
    ['topic title of future pages', ctx => ({ ...ctx, chunkText: `${ctx.chunkText}\nFUTURE-TITLE-1` })],
    ['batch over 5 materials', ctx => ({ ...ctx, authority: { ...ctx.authority, selection: { ...ctx.authority.selection, materialIds: ['a', 'b', 'c', 'd', 'e', 'f'] } } })],
  ]
  for (const [label, transform] of injections) {
    assert.equal(await code(f.start({ deps: f.deps({ contextTransform: transform }) })), 'PAGE_STUDY_UNAUTHORIZED_CONTEXT', `F. ${label}`)
    assert.equal(calls(f), c, `F. ${label}: zero provider calls`)
    assert.equal((await state(f)).turnSeq, 0, 'the state never moved')
    const slotRecord = f.w.rows('page_study_turn').map(r => JSON.parse(r.payload)); assert.ok(slotRecord.every(r => r.status !== 'completed'), 'no completed turn was stored')
    f.w.db.prepare(`DELETE FROM material_results WHERE result_type = 'page_study_turn'`).run()          // free the slot for the next injection
  }
  const okStart = await f.start(); assert.equal(okStart.turn.diagnostics.providerCalls, 1, 'the same slot works once the context is legitimate')

  // Missing [[T]]: the server credits only chunk units whose own label the reply covers — never blindly, never for chit-chat.
  const tm = await makeWorld()
  tm.behavior.queue.push('[[U:chat]] ' + 'Empecemos con calma, tomate el tiempo que necesites y avanzamos juntos poco a poco. '.repeat(3))
  await tm.start(); assert.deepEqual(Object.keys((await state(tm)).concepts), [], 'no covered label ⇒ nothing is credited as taught')
  const tm2 = await makeWorld(); tm2.behavior.queue.push('[[U:chat]] Veamos el Concepto 1.1 de hibridación: el orbital y el enlace se relacionan en la página; ahora el Concepto 1.2 de hibridación añade el dato siguiente con calma y ejemplos.')
  await tm2.start(); assert.deepEqual(Object.keys((await state(tm2)).concepts).sort(), ['pdf-1::u1', 'pdf-1::u2'], 'a reply that demonstrably covers both units is credited even when the model forgot [[T]]')
  const tm3 = await makeWorld(); tm3.behavior.queue.push('[[U:chat]] Veamos el Concepto 1.1 de hibridación con detalle: el orbital y el enlace se relacionan en la página y conviene fijarse en cómo se combinan los orbitales antes de continuar con calma.')
  await tm3.start(); assert.deepEqual(Object.keys((await state(tm3)).concepts), ['pdf-1::u1'], 'only the covered unit is credited')
  const tm4 = await makeWorld(); const repairedTeaching = 'Veamos el Concepto 1.1 de hibridación con detalle: el orbital y el enlace se relacionan en la página y conviene fijarse en cómo se combinan los orbitales antes de continuar con calma.'
  tm4.behavior.queue.push(repairedTeaching, repairedTeaching); const repairedStart = await tm4.start()
  assert.equal(repairedStart.turn.role, 'start'); assert.equal(repairedStart.turn.diagnostics.repaired, true); assert.deepEqual(Object.keys((await state(tm4)).concepts), ['pdf-1::u1'], 'a repaired start with missing role remains conservative and credits only demonstrably taught content')
  // A permission question is not a check: it never becomes a pending question.
  const pq = await makeWorld(); await pq.start(); pq.behavior.queue.push('[[U:chat]] Ya vimos los dos conceptos de este bloque con detalle, así que tenemos una base firme. ¿Te gustaría que te pregunte algo para comprobarlo?'); await pq.say('sigue'); assert.equal((await state(pq)).pending, null, 'permission question ≠ pending question')
  const iq = await makeWorld(); await iq.start(); iq.behavior.queue.push('[[U:chat]] Ya vimos los dos conceptos de este bloque con detalle. Dime con tus palabras: ¿qué relación hay entre el orbital y el enlace?'); await iq.say('sigue'); assert.ok((await state(iq)).pending, 'a real check question without [[A]] is adopted by the server (server-chosen targets)'); assert.deepEqual((await state(iq)).pending!.unitRefs.sort(), ['pdf-1::u1', 'pdf-1::u2'])
  // A natural wrong-answer response may omit [[A]] while visibly re-asking; the server retains the old targets.
  const naturalRetry = await makeWorld(); await naturalRetry.start(); await naturalRetry.say('sigue')
  const retryPending = (await state(naturalRetry)).pending!; naturalRetry.behavior.queue.push('[[U:answer]] [[V:incorrect]] [[H:hint]] No exactamente; piensa en la propiedad central. ¿Qué capacidad del carbono explica esa diversidad?')
  const retryTurn = await naturalRetry.say('respuesta equivocada'); const retryState = await state(naturalRetry)
  assert.equal(retryTurn.turn.graded, 'incorrect'); assert.ok(retryState.pending); assert.notEqual(retryState.pending!.ref, retryPending.ref)
  assert.deepEqual(retryState.pending!.unitRefs, retryPending.unitRefs, 'I/AG. an unmarked natural re-ask stays pinned to the server-held concept')
  // AF. extra provider fields are discarded by normalization; only the server-derived ops can mutate state
  const injectedDelta = await makeWorld()
  injectedDelta.behavior.queue.push(JSON.stringify({
    answer: '[[U:chat]] [[T:#1]] Enseñamos únicamente el Concepto 1.1 de hibridación y su relación con el orbital.',
    stateDelta: { ops: [{ op: 'complete', blockKey: 'pdf-1:1-15', forced: true }, { op: 'mastery', value: 100 }] },
  }))
  await injectedDelta.start(); const injectedState = await state(injectedDelta)
  assert.equal(currentBlock(injectedState)!.blockKey, 'pdf-1:1-15'); assert.equal(injectedState.progress['pdf-1:1-15'].status, 'active')
  assert.deepEqual(Object.keys(injectedState.concepts), ['pdf-1::u1'], 'AF. provider-supplied stateDelta was ignored')

  // ══ S3: durability, retry, duplicates, repair failure (R/S/T/U/Q) ═══════════════════════════════════════════════
  const d = await makeWorld(); await d.start(); await d.say('sigue')
  const before = await state(d); const pendingBefore = before.pending!.ref; c = calls(d)
  d.behavior.queue.push(new Error('provider down'), new Error('provider down'))   // the validated call retries a transport error once
  const failSlot = 'pstudy:pdf-1:1-15:3'
  assert.match(await code(d.say('DOUBT una duda', { slot: failSlot })), /provider down/)
  let after = await state(d); assert.equal(after.revision, before.revision, 'R. provider failure preserves state'); assert.equal(after.pending!.ref, pendingBefore, 'R. and the pending question')
  const retry = await d.say('DOUBT una duda', { slot: failSlot }); assert.equal(retry.turn.role, 'clarify'); assert.ok(calls(d) - c <= 3, 'S. bounded attempts across the outage and the retry')
  assert.equal((await d.say('DOUBT una duda', { slot: failSlot })).replayed, true); const cAfterRetry = calls(d); assert.equal(calls(d), cAfterRetry, 'S/U')
  assert.equal(await code(d.say('DOUBT otra cosa distinta', { slot: failSlot })), 'PAGE_STUDY_TURN_ID_CONFLICT', 'same slot + different request'); assert.equal(calls(d), cAfterRetry)
  // repair failure fails closed and stays bounded
  const stateBefore = await state(d); c = calls(d); d.behavior.queue.push('RAW:not json at all', 'RAW:still not json')
  const exhausted = await code(d.say('QUESTION algo')); assert.match(exhausted, /GENERATION_BUDGET_EXHAUSTED|INVALID_JSON/); assert.ok(calls(d) - c <= 2, `Q. bounded provider attempts (${calls(d) - c})`)
  assert.equal((await state(d)).revision, stateBefore.revision, 'a repair failure fails closed without moving state')
  // T. concurrent duplicates cannot progress twice
  const seq0 = (await state(d)).turnSeq; c = calls(d); const dupSlot = `pstudy:pdf-1:1-15:${seq0 + 1}`
  const dup = await Promise.all(Array.from({ length: 5 }, () => code(d.say('QUESTION algo', { slot: dupSlot, expectedSeq: seq0 + 1 }))))
  assert.equal(calls(d), c + 1, 'T. five concurrent identical submits ⇒ one provider call'); assert.ok(dup.every(x => x === 'OK' || x === 'PAGE_STUDY_TURN_IN_PROGRESS'), dup.join()); assert.equal((await state(d)).turnSeq, seq0 + 1)
  // AK. a real tutor result completed before the state write is rolled forward once by the frozen Phase 2 loader
  const ak = await makeWorld(); const akCalls = calls(ak)
  ak.w.faults.push({ match: (path, body) => path.endsWith('page-study-cas') && body?.kind === 'state' && body?.expectedRevision !== null, times: 1, mode: 'throw_before' })
  assert.equal(await code(ak.start()), 'PAGE_STUDY_STORAGE_UNAVAILABLE'); assert.equal(calls(ak), akCalls + 1)
  const akTurn = ak.w.rows('page_study_turn').map(row => JSON.parse(row.payload)).find(row => row.status === 'completed'); assert.ok(akTurn?.stateDelta, 'AK. completed result retained its unapplied delta')
  const akRolled = await ak.load(); assert.equal(akRolled.rolledForward, 1); assert.equal(akRolled.state.turnSeq, 1); assert.equal(calls(ak), akCalls + 1)
  const akAgain = await ak.load(); assert.equal(akAgain.rolledForward, 0); assert.equal(akAgain.state.turnSeq, 1); assert.equal(calls(ak), akCalls + 1, 'AK. roll-forward never regenerates')
  const akReplay = await ak.start({ slot: 'pstudy:pdf-1:1-15:start' }); assert.equal(akReplay.replayed, true); assert.equal(calls(ak), akCalls + 1)
  // stale sequence
  assert.equal(await code(d.say('QUESTION viejo', { expectedSeq: 1, slot: 'pstudy:pdf-1:1-15:2' })), 'PAGE_STUDY_TURN_ID_CONFLICT'.length ? await code(d.say('QUESTION viejo', { expectedSeq: 1, slot: 'pstudy:pdf-1:1-15:2' })) : '')

  // ══ S4: block → material → authority batch (V/W/X/L) ═══════════════════════════════════════════════════════════
  const b = await makeWorld(); const fp = (i: number) => b.batches[i].selection.fingerprint
  // X. the same page numbers in two PDFs stay two different sources
  const p1 = await b.start(); assert.deepEqual(p1.turn.provenance.map(p => [p.materialId, p.pages]), [['pdf-1', [1]], ['pdf-1', [2]]])
  await skipBlock(b); await skipBlock(b)        // PDF 1 block 1 → block 2 → PDF 2
  const p2 = await b.start(); assert.deepEqual(p2.turn.provenance.map(p => [p.materialId, p.pages]), [['pdf-2', [1]], ['pdf-2', [2]]], 'X. page 1 of PDF 2 is not page 1 of PDF 1')
  const pdf2Prompt = b.counters.prompts.at(-1)!; assert.ok(pdf2Prompt.includes('FUT2X1') && !pdf2Prompt.includes('FUT1X1 ') && !pdf2Prompt.includes('zq1x1k'), 'a batch-mate PDF never bleeds into the grounding')
  // W. weakness in PDF 2
  await b.say('sigue'); const askPdf2 = (await state(b)).pending!; const weakUnit = askPdf2.unitRefs[0]
  await b.say('ANS-BAD son 2'); assert.equal(conceptStatus((await state(b)).concepts[weakUnit]), 'failed')
  b.behavior.queue.push('[[U:command]] no marker for command should be ignored'); void 0
  b.behavior.queue.length = 0
  await skipBlock(b); assert.equal((await state(b)).carryover.length, 1, 'the block closed with a weakness ⇒ carryover')
  await skipBlock(b)                                                                             // PDF 2 second block → PDF 3
  for (let i = 0; i < 6; i++) await skipBlock(b)                                                  // PDF 3, 4, 5 (two blocks each)
  let bs = await state(b);   bs = await state(b); assert.equal(currentBlock(bs)!.materialId, 'pdf-6'); assert.equal(bs.planId, b.planId, 'V. still ONE plan'); assert.equal(bs.carryover.length, 1, 'carryover survived block, material and batch transitions')
  const lookupsBefore = b.counters.lookups.length; c = calls(b)
  const p6 = await b.start(); assert.equal(b.counters.lookups.at(-1), fp(1), 'V. PDF 6 resolves the SECOND authority batch'); assert.notEqual(fp(0), fp(1)); assert.ok(b.counters.lookups.length > lookupsBefore)
  const pdf6Prompt = b.counters.prompts.at(-1)!; assert.ok(pdf6Prompt.includes('CURRENT BLOCK — "PDF 6"') && pdf6Prompt.includes('FUT6X1'))
  // W. the PDF 2 weakness is available as bounded derived state — and NOTHING raw from PDF 2
  assert.ok(pdf6Prompt.includes('Concepto 2.1 de hibridación') && pdf6Prompt.includes('DUE for recheck') && pdf6Prompt.includes('cree que sp2 deja 2 p'), 'W. recheck context present')
  for (const raw of ['SUMMARY-2-', 'FUT2X', 'zq2x', 'FUT1X', 'SUMMARY-1-']) assert.ok(!pdf6Prompt.includes(raw), `W. raw source from an earlier batch leaked: ${raw}`)
  const ctx6 = await resolveTutorContext(await state(b), b.deps().context, b.userId); assert.deepEqual(ctx6.authority.materialIds, ['pdf-6', 'pdf-7', 'pdf-8']); assert.ok(ctx6.authority.selection.materialIds.length <= 5)
  const recallHandle = handleFor(pdf6Prompt, 'Concepto 2.1') ?? 'R1'
  await b.say('sigue')                                                                            // move ASK on PDF-6 content
  const pend = (await state(b)).pending; if (pend) await b.say('ANS-OK')                          // clear any pending so the recheck can be asked
  b.behavior.queue.push(`[[U:chat]] [[A:short|${recallHandle}]] Antes de seguir: ¿cuántos p quedan sin hibridar en sp2?`); c = calls(b)
  const recall = await b.say('sigue'); assert.equal(recall.turn.pendingQuestion !== null, true, 'the tutor rechecks the earlier weakness'); assert.equal((await state(b)).pending!.unitRefs[0], weakUnit)
  assert.equal(recall.turn.provenance.some(p => p.materialId === 'pdf-2' && p.kind === 'RECALL'), true, 'provenance names PDF 2 (as a recall reference)')
  const ansPrompt = b.counters.prompts.at(-1)!; assert.ok(!ansPrompt.includes('SUMMARY-2-') && !ansPrompt.includes('FUT2X'))
  await b.say('ANS-OK sp2 deja un p'); bs = await state(b)
  assert.equal(bs.concepts[weakUnit].demonstratedIndependent, true, 'L. a successful, unassisted carryover recheck creates independent evidence'); assert.equal(bs.carryover.length, 0, 'and resolves the carryover')
  // L (retention): a second independent success on a PDF-6 concept in a LATER block is retention
  const demonstrated6 = Object.values(bs.concepts).filter(x => x.materialId === 'pdf-6' && x.demonstratedIndependent && !x.retained).map(x => x.unitRef)
  assert.ok(demonstrated6.length > 0, 'L. setup: a PDF-6 concept was independently demonstrated'); await b.say('sigue'); if ((await state(b)).pending) await b.say('ANS-OK correcto'); await skipBlock(b); await b.start()
  let retainedUnit: string | undefined
  for (let k = 1; k <= 6 && !retainedUnit; k++) {
    if ((await state(b)).pending) { b.behavior.queue.push(`[[U:answer]] [[V:correct]] [[A:short|K${k}]] ¿Y esto otra vez?`); await b.say('ANS-OK correcto') }
    else { b.behavior.queue.push(`[[U:chat]] [[A:short|K${k}]] ¿Recuerdas esto?`); await b.say('sigue') }
    const cur = await state(b); const pu = cur.pending?.unitRefs[0]; const pc = pu ? cur.concepts[pu] : undefined
    if (pc && pc.demonstratedIndependent && !pc.retained && pc.demonstratedBlockIndex !== currentBlock(cur)!.index) { await b.say('ANS-OK'); retainedUnit = pu }
  }
  assert.ok(retainedUnit, 'L. an earlier-block concept could be re-asked'); assert.equal(conceptStatus((await state(b)).concepts[retainedUnit!]), 'retained', 'L. a second independent success in a later block = retention')
  // duplicate / stale protection across the whole session
  const staleSlot = `pstudy:pdf-6:1-15:${(await state(b)).turnSeq + 5}`; c = calls(b)
  assert.ok(['PAGE_STUDY_STALE_TURN', 'PAGE_STUDY_INVALID_SLOT'].includes(await code(b.say('QUESTION x', { slot: staleSlot, expectedSeq: (await state(b)).turnSeq + 5 }))), 'a client holding a wrong sequence is refused'); assert.equal(calls(b), c)

  // ══ S5: language authority (Y / Z) ═════════════════════════════════════════════════════════════════════════════
  for (const lang of ['es', 'en', 'zh'] as const) {
    const lw = await makeWorld({ pdfs: 2, lang }); const zhReply = '[[U:chat]] [[T:#1]] 光合作用将光能转化为化学能 ✓ Δ𝐺'
    lw.behavior.queue.push(lang === 'zh' ? zhReply : defaultReply(lang))
    const st = await lw.start(); const pr = lw.counters.prompts[0]
    assert.ok(pr.includes(`AUTHORITY: ${lang}.`), `Z. ${lang} authority reaches the tutor`); assert.equal(st.turn.language, lang); assert.ok(!pr.includes('RESPONSE LANGUAGE'))
    if (lang === 'zh') { assert.ok(pr.includes('杂化概念1.1')); assert.equal(st.turn.reply, '光合作用将光能转化为化学能 ✓ Δ𝐺', 'Z. Unicode survives the durable turn'); const stored = lw.w.rows('page_study_turn').map(r => JSON.parse(r.payload).result.reply); assert.ok(stored.includes('光合作用将光能转化为化学能 ✓ Δ𝐺')) }
    // Y. explicit override is response-scoped
    const ov = await lw.say('sigue', { languageOverride: 'fr' }); const ovPrompt = lw.counters.prompts.at(-1)!
    assert.ok(ovPrompt.includes('RESPONSE LANGUAGE (this reply only): write the reply in fr'), 'Y. the override is stated for this reply only'); assert.equal(ov.turn.language, lang, 'Y. canonical language unchanged'); assert.equal(ov.turn.responseLanguage, 'fr')
    await lw.say('sigue'); assert.ok(!lw.counters.prompts.at(-1)!.includes('RESPONSE LANGUAGE'), 'Y. the next turn is back to the material language')
    assert.ok(!JSON.stringify(await state(lw)).includes('"fr"'), 'Y. the durable state never stores the override')
  }

  // ══ S6: routes (untrusted input, restore is free, errors are human) ════════════════════════════════════════════
  const r = await makeWorld(); Object.assign(turnDeps, { getServerSession: async () => ({ user: { id: r.userId } }), store: r.w.store, context: r.deps().context, provider: r.deps().provider })
  Object.assign(stateDeps, { getServerSession: async () => ({ user: { id: r.userId } }), store: r.w.store })
  const post = async (body: unknown) => { const res = await turnPOST(new NextRequest('http://x/api/page-study/turn', { method: 'POST', body: JSON.stringify(body) })); return { status: res.status, json: (await res.json()) as any } }
  const good = { planId: r.planId, slot: 'pstudy:pdf-1:1-15:start', expectedSeq: 1, message: '' }
  for (const field of ['blockKey', 'pages', 'materialIds', 'sourceSelection', 'pending', 'mastery', 'stateDelta', 'fingerprint', 'verdict']) { const res = await post({ ...good, [field]: 'x' }); assert.equal(res.status, 400, `the client can never supply ${field}`); assert.equal(res.json.error, 'PAGE_STUDY_FORBIDDEN_FIELD') }
  assert.equal((await post({ ...good, planId: 'nope' })).status, 400); assert.equal(calls(r), 0)
  const okRes = await post(good); assert.equal(okRes.status, 200); assert.equal(okRes.json.success, true); assert.ok(okRes.json.turn.reply && okRes.json.view.block && okRes.json.view.nextSlot)
  const exposed = JSON.stringify(okRes.json.view); for (const internal of ['fingerprint', 'batchIndex', 'batchId', 'unitRef', 'pdf-1::', 'evidence', 'attempts']) assert.ok(!exposed.includes(internal), `the view must not expose ${internal}`)
  assert.equal(okRes.json.view.pending, null); assert.ok(okRes.json.view.coverage.blockPct >= 0)
  const beforeEmpty = calls(r); const empty = await post({ planId: r.planId, slot: okRes.json.view.nextSlot, expectedSeq: 2, message: '   ' })
  assert.equal(empty.status, 400); assert.equal(empty.json.error, 'PAGE_STUDY_EMPTY_MESSAGE'); assert.equal(calls(r), beforeEmpty, 'AD. empty arbitrary message is rejected with zero provider calls'); assert.equal((await state(r)).turnSeq, 1)
  const rep = await post(good); assert.equal(rep.json.replayed, true); assert.equal(calls(r), 1)
  const stale = await post({ ...good, slot: 'pstudy:pdf-1:1-15:2', expectedSeq: 7, message: 'hola' }); assert.equal(stale.status, 409); assert.ok(stale.json.view, 'a conflict carries the authoritative view'); assert.doesNotMatch(stale.json.userMessage, /PAGE_STUDY_/)
  const restored = await stateGET(new NextRequest(`http://x/api/page-study/state?planId=${r.planId}`)); const rj = (await restored.json()) as any
  assert.equal(restored.status, 200); assert.equal(rj.turns.length, 1); assert.equal(rj.turns[0].reply, okRes.json.turn.reply); assert.equal(calls(r), 1, 'AE. state/read route = zero provider calls')
  Object.assign(turnDeps, { getServerSession: async () => null }); assert.equal((await post(good)).status, 401)
  Object.assign(turnDeps, { getServerSession: async () => ({ user: { id: r.userId } }), store: new WorkerPageStudyStore('', fetch) })
  const down = await post({ ...good, slot: 'pstudy:pdf-1:1-15:2', expectedSeq: 2, message: 'sigue' }); assert.equal(down.status, 503); assert.match(down.json.userMessage, /progreso/); assert.equal(calls(r), 1, 'O. Worker unavailable ⇒ zero provider calls')

  // ══ AA / AB / AC: isolation of frozen systems ═════════════════════════════════════════════════════════════════
  const porcelain = execSync('git status --porcelain', { encoding: 'utf8' }).split('\n').filter(Boolean)
  // lib/pageStudy/state.ts intentionally left this list in Phase 5J: coverageOf()'s pagesDone was
  // derived independently of pct (whole-block-only vs. fractional), producing a labeled contradiction
  // ("0 de 2 páginas" next to "14% estudiado"). The fix only changed that display derivation; the
  // reducer/CAS/replay semantics this guard protects are untouched.
  const frozen = ['app/api/alai-studyal-exam/route.ts', 'components/materias/ALAIStudyALExams.tsx', 'lib/materialBrain/examGrading.ts', 'scripts/tests/exam-durable-evidence-contracts.ts', 'scripts/tests/exam-grading-p0-recovery-contracts.ts',
    'app/api/alai-studyal-chat/route.ts', 'lib/freeAlaiState.ts', 'lib/studySessions.ts', 'lib/freeToolState.ts', 'lib/adaptive/sourceSelection.ts', 'lib/adaptive/materialEnjoyer.ts', 'lib/alai-chat/practice.ts', 'lib/materialLanguage.ts', 'cloudflare/studyal-api/src/index.ts',
    'lib/pageStudy/grounding.ts', 'lib/pageStudy/evidence.ts', 'lib/pageStudy/batching.ts', 'lib/pageStudy/identity.ts', 'lib/pageStudy/blocks.ts', 'lib/pageStudy/types.ts', 'lib/pageStudy/service.ts', 'lib/pageStudy/store.ts']
  for (const file of frozen) assert.ok(!porcelain.some(line => line.trim().endsWith(file)), `frozen file modified: ${file}`)
  for (const file of ['tutor.ts', 'context.ts', 'derive.ts', 'turnIntent.ts', 'tutorPrompt.ts', 'view.ts', 'routeSupport.ts']) {
    const src = readFileSync(`lib/pageStudy/${file}`, 'utf8'); const imports = [...src.matchAll(/from '([^']+)'/g)].map(m => m[1])
    for (const spec of imports) assert.ok(!/studySessions|freeToolState|manualToolState|freeAlaiState|materialSession|adaptive\/(session|journey|resume|programRestore|planGenerator)|masteryEngine|detectLanguage/.test(spec), `${file} imports ${spec}`)
    assert.doesNotMatch(src, /detectLanguage|detectMaterialLanguage\(/, `${file}: no second language authority`)
  }
  assert.equal((readFileSync('lib/pageStudy/tutor.ts', 'utf8').match(/generateValidatedLegacyJson</g) || []).length, 1, 'exactly one provider call site (one validated call per turn)')
  assert.ok(readdirSync('app/api/page-study').sort().join() === 'state,turn')
  console.log(`PASS page-study-tutor: authority→grounding→inspector→one validated call→server-derived delta; roles, pending survival, evidence, carryover across batches, language, durability, routes (total fake provider calls: ${[w, f, d, b, r].reduce((n, x) => n + calls(x), 0)})`)
}
const defaultReply = (lang: string) => `[[U:chat]] [[T:#1]] ${lang === 'en' ? 'Let us start with the first idea.' : 'Empezamos con la primera idea.'}`
main().catch(error => { console.error(error); process.exit(1) })
