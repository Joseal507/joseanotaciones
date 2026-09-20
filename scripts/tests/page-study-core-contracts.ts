import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { getAuthoritativeFreeSession } from '../../lib/materialBrain/quiz/sessionAuthority'
import { AUTHORITY_BATCH_MAX, buildAuthorityBatches, normalizePlanMaterials } from '../../lib/pageStudy/batching'
import { narrowUniverse } from '../../lib/pageStudy/blocks'
import { conceptStatus, isWeak } from '../../lib/pageStudy/evidence'
import { ID_PATTERNS, batchIdOf, planIdOf, planKeyOf, stateRecordId, startSlot, turnRecordId, turnScopeOf, turnSlot } from '../../lib/pageStudy/identity'
import { applyDelta, applyDeltaIfPending, buildStudyDigest, coverageOf, createInitialState, createPageStudyPlan, currentBatch, currentBlock, dueRechecks, isFinished, studiedPagesOf } from '../../lib/pageStudy/state'
import type { PageStudyState, StateOp, UnitMeta } from '../../lib/pageStudy/types'

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const names = ['QUIMICA', 'ALCANOS', 'CONFORMACIONES', 'ALQUENOS', 'ALQUINOS', 'AROMATICOS', 'HALUROS', 'ALCOHOLES']
const mats = names.map((name, i) => ({ materialId: `pdf-${i + 1}`, name, selectedPages: [] as number[] }))
const universe = Object.fromEntries(mats.map(m => [m.materialId, range(1, 30)]))
const mkPlan = (materials = mats, blockSize = 15) => createPageStudyPlan({ userId: 'u1', temaId: 'tema-1', materials, blockSize, universe })
const meta = (materialId: string, id: string, label = id, pages = [1]): UnitMeta => ({ unitRef: `${materialId}::${id}`, materialId, label, kind: 'concept', pages })
let clock = 1_000
function step(state: PageStudyState, ops: StateOp[]): PageStudyState {
  return applyDelta(state, { baseRevision: state.revision, turnSeq: state.turnSeq + 1, at: (clock += 1000), ops })
}
const finishBlock = (s: PageStudyState, forced = false): PageStudyState => { const b = currentBlock(s)!; return step(s, [{ op: 'complete', blockKey: b.blockKey, forced }]) }

// ── 1. Eight PDFs → ONE plan, internal authority batches [1–5] and [6–8] ─────────────────────────────────────
const plan = mkPlan()
assert.equal(plan.materials.length, 8); assert.equal(plan.batches.length, 2)
assert.deepEqual(plan.batches.map(b => b.materialIds), [names.slice(0, 5).map((_, i) => `pdf-${i + 1}`), ['pdf-6', 'pdf-7', 'pdf-8']])
assert.ok(plan.batches.every(b => b.selection.materialIds.length <= AUTHORITY_BATCH_MAX && b.selection.materialIds.length === b.materialIds.length), 'every batch is a genuine ≤5 certified snapshot')
assert.equal(plan.blocks.length, 16, '8 PDFs × two 15-page blocks'); assert.deepEqual(plan.blocks.slice(0, 4).map(b => b.blockKey), ['pdf-1:1-15', 'pdf-1:16-30', 'pdf-2:1-15', 'pdf-2:16-30'])
assert.ok(plan.blocks.every((b, i) => b.index === i), 'one ordered block list for the whole visible plan')
assert.notEqual(plan.batches[0].selection.fingerprint, plan.batches[1].selection.fingerprint, 'each batch is its own Enjoyer identity')

// ── 2. The certified max-5 contract is untouched ─────────────────────────────────────────────────────────────
assert.equal(buildSourceSelectionSnapshot(['a', 'b', 'c', 'd', 'e', 'f'], {}).materialIds.length, 5, 'certified snapshot still truncates at 5 (unchanged)')
assert.equal(buildSourceSelectionSnapshot(['e', 'd', 'c', 'b', 'a'], {}).fingerprint, buildSourceSelectionSnapshot(['a', 'b', 'c', 'd', 'e'], {}).fingerprint, 'order-independent fingerprint (unchanged)')
const porcelain = execSync('git status --porcelain', { encoding: 'utf8' }).split('\n').filter(Boolean)
const frozen = ['lib/adaptive/sourceSelection.ts', 'lib/adaptive/materialEnjoyer.ts', 'lib/materialBrain/chatEnjoyerContext.ts', 'lib/materialBrain/quiz/sessionAuthority.ts', 'lib/studySessions.ts', 'lib/freeToolState.ts', 'lib/freeAlaiState.ts', 'lib/materialLanguage.ts', 'lib/materials/sourceIndex.ts', 'app/api/alai-studyal-chat/route.ts', 'app/api/adaptive/blueprint/route.ts']
for (const file of frozen) assert.ok(!porcelain.some(line => line.trim().endsWith(file)), `Phase 1 must not modify frozen system: ${file}`)

// ── 3. A sixth material is NEVER silently truncated ──────────────────────────────────────────────────────────
const six = mkPlan(mats.slice(0, 6)); assert.deepEqual(six.batches.map(b => b.materialIds.length), [5, 1]); assert.equal(six.batches.flatMap(b => b.materialIds).length, 6)
const eleven = createPageStudyPlan({ userId: 'u', temaId: 't', materials: Array.from({ length: 11 }, (_, i) => ({ materialId: `m${i}`, selectedPages: [] })), universe: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`m${i}`, [1]])) })
assert.deepEqual(eleven.batches.map(b => b.materialIds.length), [5, 5, 1]); assert.equal(new Set(eleven.blocks.map(b => b.materialId)).size, 11)
assert.throws(() => normalizePlanMaterials(Array.from({ length: 41 }, (_, i) => ({ materialId: `x${i}` }))), /PAGE_STUDY_TOO_MANY_MATERIALS/, 'oversize is an explicit error, not a quiet cut')
assert.equal(normalizePlanMaterials([{ materialId: 'a' }, { materialId: 'a' }, { id: 'b' }]).length, 2, 'duplicates collapse, nothing else is dropped')
const batchSource = readFileSync('lib/pageStudy/batching.ts', 'utf8'); assert.match(batchSource, /PAGE_STUDY_BATCH_TRUNCATED/, 'the truncation guard exists')

// ── 4. PDF 5 → PDF 6 resolves to the second authority batch ──────────────────────────────────────────────────
let s = createInitialState(plan, clock)
while (currentBlock(s)!.materialId !== 'pdf-5') s = finishBlock(s)
assert.equal(currentBatch(s)!.index, 0); s = finishBlock(s)                                   // pdf-5 1–15
assert.equal(currentBlock(s)!.blockKey, 'pdf-5:16-30'); assert.equal(currentBatch(s)!.index, 0); s = finishBlock(s)   // last block of PDF 5
assert.equal(currentBlock(s)!.blockKey, 'pdf-6:1-15'); assert.equal(currentBatch(s)!.index, 1, 'PDF 6 belongs to the second authority batch')
assert.deepEqual(currentBatch(s)!.selection.materialIds, ['pdf-6', 'pdf-7', 'pdf-8']); assert.ok(!currentBatch(s)!.selection.materialIds.includes('pdf-5'))
assert.equal(s.pending, null); assert.ok(!isFinished(s))

// ── 5. Weakness from PDF 2 survives into PDF 6 as bounded derived study state — never raw source ─────────────
let w = createInitialState(plan, clock)
w = finishBlock(finishBlock(w))                                                                // pdf-1 done
const sp2 = meta('pdf-2', 'sp2_unhybridized_p', 'Orbitales p sin hibridar en sp2', [7, 8])
w = step(w, [{ op: 'units', blockKey: 'pdf-2:1-15', total: 1 }, { op: 'teach', blockKey: 'pdf-2:1-15', klass: 'FULL', units: [sp2] }, { op: 'ask', ref: 'q1', unitRefs: [sp2.unitRef], format: 'open', kind: 'mini' }])
w = step(w, [{ op: 'answer', verdict: 'incorrect', digest: 'respondió 2', misconception: { statement: 'Cree que sp2 deja 2 orbitales p', correctStatement: 'sp2 deja 1 orbital p sin hibridar' } }])
assert.equal(conceptStatus(w.concepts[sp2.unitRef]), 'failed'); assert.ok(isWeak(w.concepts[sp2.unitRef]))
w = step(w, [{ op: 'wrap', blockKey: 'pdf-2:1-15' }]); w = finishBlock(w)
assert.equal(w.carryover.length, 1); assert.equal(w.carryover[0].materialId, 'pdf-2'); assert.equal(w.carryover[0].batchIndex, 0)
while (currentBlock(w)!.materialId !== 'pdf-6') w = finishBlock(w)
assert.equal(currentBatch(w)!.index, 1); assert.equal(w.carryover.length, 1, 'the weakness crossed the batch boundary')
const digest = buildStudyDigest(w); assert.equal(digest[0].unitRef, sp2.unitRef); assert.equal(digest[0].due, true); assert.equal(digest[0].misconception, 'Cree que sp2 deja 2 orbitales p')
assert.equal(dueRechecks(w)[0].cardId, `card:${sp2.unitRef}`)
const carried = JSON.stringify([w.carryover, digest])
assert.doesNotMatch(carried, /"(quote|summary|content|sourceSpans|text|evidence)"/, 'cross-batch memory has no source-bearing fields')
assert.deepEqual(Object.keys(digest[0]).sort(), ['correctStatement', 'due', 'label', 'materialId', 'misconception', 'pages', 'status', 'unitRef'].sort())
assert.ok(digest.every(d => Object.values(d).every(v => typeof v !== 'string' || v.length <= 200)), 'every digest field is bounded')
assert.ok(readFileSync('lib/pageStudy/types.ts', 'utf8').includes('never carries source text'))

// ── 6. Evidence: wrong → weakness; assisted-correct is NOT independent; a later independent success is ─────────
const cpage = 'pdf-6'; const c1 = meta(cpage, 'c1', 'Hibridación sp3')
let e = createInitialState(plan, clock); while (currentBlock(e)!.materialId !== cpage) e = finishBlock(e)
const bk = currentBlock(e)!.blockKey
e = step(e, [{ op: 'units', blockKey: bk, total: 2 }, { op: 'teach', blockKey: bk, klass: 'FULL', units: [c1] }, { op: 'ask', ref: 'a', unitRefs: [c1.unitRef], format: 'open', kind: 'mini' }])
e = step(e, [{ op: 'help', kind: 'hint' }, { op: 'answer', verdict: 'correct', digest: 'sp3 con pista' }])
assert.equal(e.concepts[c1.unitRef].attempts[0].assistance, 'minimal_hint'); assert.equal(e.concepts[c1.unitRef].demonstratedIndependent, false, 'a hinted answer is progress, not independence')
assert.notEqual(conceptStatus(e.concepts[c1.unitRef]), 'demonstrated')
e = step(e, [{ op: 'ask', ref: 'b', unitRefs: [c1.unitRef], format: 'mc', kind: 'mini' }]); e = step(e, [{ op: 'answer', verdict: 'correct', digest: 'sp3 solo' }])
assert.equal(e.concepts[c1.unitRef].demonstratedIndependent, true); assert.equal(conceptStatus(e.concepts[c1.unitRef]), 'demonstrated')
// reveal / clarification also destroy independence; clarification never counts as an answer
e = step(e, [{ op: 'ask', ref: 'c', unitRefs: [c1.unitRef], format: 'open' }, { op: 'help', kind: 'clarification' }, { op: 'help', kind: 'reveal' }])
assert.equal(e.pending!.helpLevel, 'revealed'); assert.equal(e.concepts[c1.unitRef].attempts.length, 2, 'help produced no attempt')

// ── 7. Pending question survives clarification / doubt; is consumed only by an answer ───────────────────────────
let p = createInitialState(plan, clock); const pk = currentBlock(p)!.blockKey; const u1 = meta('pdf-1', 'u1')
p = step(p, [{ op: 'units', blockKey: pk, total: 1 }, { op: 'teach', blockKey: pk, klass: 'FULL', units: [u1] }, { op: 'ask', ref: 'Q-sp2', unitRefs: [u1.unitRef], format: 'open', kind: 'mini' }])
const askedSeq = p.pending!.askedSeq
for (const kind of ['question', 'clarification', 'hint'] as const) p = step(p, [{ op: 'help', kind }])
assert.equal(p.pending!.ref, 'Q-sp2'); assert.equal(p.pending!.askedSeq, askedSeq); assert.equal(p.concepts[u1.unitRef].attempts.length, 0, 'a doubt is not an answer')
assert.throws(() => step(p, [{ op: 'ask', ref: 'other', unitRefs: [u1.unitRef], format: 'open' }]), /PAGE_STUDY_PENDING_EXISTS/, 'a new question cannot silently replace the pending one')
p = step(p, [{ op: 'ask', ref: 'other', unitRefs: [u1.unitRef], format: 'open', replace: true }]); assert.equal(p.pending!.ref, 'other')
p = step(p, [{ op: 'answer', verdict: 'correct', digest: 'x' }]); assert.equal(p.pending, null)
assert.throws(() => step(p, [{ op: 'answer', verdict: 'correct', digest: 'x' }]), /PAGE_STUDY_NO_PENDING/, 'an answer with nothing pending is rejected, not graded')

// ── 8. Force-advance, carryover through block/material/batch transitions, later independent success clears it ─
let f = createInitialState(plan, clock); const fk = currentBlock(f)!.blockKey; const fu = meta('pdf-1', 'weak', 'Concepto débil')
f = step(f, [{ op: 'units', blockKey: fk, total: 1 }, { op: 'teach', blockKey: fk, klass: 'FULL', units: [fu] }, { op: 'ask', ref: 'q', unitRefs: [fu.unitRef], format: 'open', kind: 'eval' }, ])
f = step(f, [{ op: 'answer', verdict: 'incorrect', digest: 'mal' }])
f = finishBlock(f, true)                                                                        // user forces advance despite the weakness
assert.equal(f.progress[fk].forced, true); assert.equal(f.carryover.length, 1); assert.equal(currentBlock(f)!.blockKey, 'pdf-1:16-30')
while (currentBlock(f)!.materialId !== 'pdf-6') f = finishBlock(f)
assert.equal(f.carryover.length, 1, 'carryover survives block → material → batch transitions')
f = step(f, [{ op: 'ask', ref: 'r', unitRefs: [fu.unitRef], format: 'open', kind: 'recheck' }]); assert.equal(f.carryover[0].checks, 1)
f = step(f, [{ op: 'help', kind: 'hint' }, { op: 'answer', verdict: 'correct', digest: 'con pista' }])
assert.equal(f.carryover.length, 1, 'a hinted success does not clear the weakness'); assert.equal(conceptStatus(f.concepts[fu.unitRef]), 'corrected')
f = step(f, [{ op: 'ask', ref: 'r2', unitRefs: [fu.unitRef], format: 'mc', kind: 'recheck' }, ]); f = step(f, [{ op: 'answer', verdict: 'correct', digest: 'solo' }])
assert.equal(f.carryover.length, 0, 'a later INDEPENDENT correct answer resolves it'); assert.equal(conceptStatus(f.concepts[fu.unitRef]), 'demonstrated')
f = step(f, [{ op: 'ask', ref: 'same-block', unitRefs: [fu.unitRef], format: 'open' }]); f = step(f, [{ op: 'answer', verdict: 'correct', digest: 'mismo bloque' }])
assert.equal(conceptStatus(f.concepts[fu.unitRef]), 'demonstrated', 'a second success in the SAME block is not retention')
f = finishBlock(f)
f = step(f, [{ op: 'ask', ref: 'r3', unitRefs: [fu.unitRef], format: 'open' }]); f = step(f, [{ op: 'answer', verdict: 'correct', digest: 'otra vez' }])
assert.equal(conceptStatus(f.concepts[fu.unitRef]), 'retained', 'a second independent success in a later block is retention')
assert.equal(f.misconceptions.filter(m => m.status === 'corrected').length, f.misconceptions.length)

// ── 9. Coverage is coverage: no mastery percentage exists ───────────────────────────────────────────────────────
const cov = coverageOf(p); assert.deepEqual(Object.keys(cov).sort(), ['block', 'concepts', 'plan']); assert.deepEqual(Object.keys(cov.block).sort(), ['pct', 'projected', 'taught', 'total'])
assert.ok(cov.block.pct >= 0 && cov.block.pct <= 100)
for (const file of readdirSync('lib/pageStudy')) assert.doesNotMatch(readFileSync(`lib/pageStudy/${file}`, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /masteryPercent|masteryPct|masteryScore/i, `${file}: no fake mastery number`)

// ── 10. Deterministic, replayable, rehydratable with no provider ────────────────────────────────────────────────
const before = JSON.stringify(p); const delta = { baseRevision: p.revision, turnSeq: p.turnSeq + 1, at: 9_999, ops: [{ op: 'help', kind: 'hint' } as StateOp] }
const once = applyDelta(p, delta); assert.equal(JSON.stringify(p), before, 'the reducer never mutates its input')
assert.deepEqual(applyDeltaIfPending(once, delta), once, 'a replayed delta is a no-op (roll-forward after a lost CAS response)')
assert.throws(() => applyDelta(p, { ...delta, baseRevision: p.revision - 1 }), /PAGE_STUDY_STALE_REVISION/); assert.throws(() => applyDelta(p, { ...delta, turnSeq: p.turnSeq + 2 }), /PAGE_STUDY_TURN_OUT_OF_ORDER/)
const restored: PageStudyState = JSON.parse(JSON.stringify(f)); assert.deepEqual(restored, f, 'JSON rehydration is lossless')
assert.deepEqual(applyDelta(restored, { baseRevision: restored.revision, turnSeq: restored.turnSeq + 1, at: 5, ops: [{ op: 'pace', pace: 'through' }] }).prefs, { pace: 'through' })
for (const file of readdirSync('lib/pageStudy')) {
  const source = readFileSync(`lib/pageStudy/${file}`, 'utf8')
  assert.doesNotMatch(source, /from '\.\.\/alai'|from '\.\.\/\.\.\/lib\/alai'|generateValidatedLegacyJson|fetch\(|openrouter|anthropic|detectLanguage|detectMaterialLanguage/i, `${file}: the pure core has no provider, network or language detector`)
}

// ── 11. Durable identity definitions ───────────────────────────────────────────────────────────────────────────
assert.equal(planIdOf('u1', 'tema-1', plan.planKey), plan.planId); assert.match(plan.planId, ID_PATTERNS.plan); assert.match(plan.batches[1].batchId, ID_PATTERNS.batch)
assert.equal(planKeyOf([...mats].reverse().map(m => ({ ...m }))), plan.planKey, 'same PDFs + same initial selection = same plan, whatever the click order')
assert.notEqual(planKeyOf(mats.map((m, i) => (i === 0 ? { ...m, selectedPages: [1, 2] } : m))), plan.planKey, 'a different page selection is a different plan')
assert.notEqual(planIdOf('u2', 'tema-1', plan.planKey), plan.planId); assert.notEqual(planIdOf('u1', 'tema-2', plan.planKey), plan.planId)
assert.equal(batchIdOf(plan.planId, 1), plan.batches[1].batchId); assert.notEqual(batchIdOf(plan.planId, 0), batchIdOf(plan.planId, 1))
const slot = turnSlot('pdf-1:1-15', 4); assert.equal(slot, 'pstudy:pdf-1:1-15:4'); assert.equal(startSlot('pdf-1:1-15'), 'pstudy:pdf-1:1-15:start')
assert.equal(turnRecordId('u1', plan.planId, slot), turnRecordId('u1', plan.planId, slot)); assert.notEqual(turnRecordId('u1', plan.planId, slot), turnRecordId('u1', plan.planId, turnSlot('pdf-1:1-15', 5)))
assert.notEqual(turnRecordId('u1', plan.planId, slot), turnRecordId('u2', plan.planId, slot)); assert.match(turnRecordId('u1', plan.planId, slot), ID_PATTERNS.turn)
assert.match(stateRecordId('u1', plan.planId), ID_PATTERNS.state); assert.equal(turnScopeOf('u1', plan.planId).startsWith('pstudy_turns:'), true)

// ── 12. Scope only narrows; blocks are rebuilt only for pages not yet started ─────────────────────────────────
assert.deepEqual(narrowUniverse(range(1, 30), { upTo: 12 }), range(1, 12)); assert.deepEqual(narrowUniverse(range(1, 30), { ranges: [[20, 25]] }), range(20, 25)); assert.deepEqual(narrowUniverse([1, 2, 3], { upTo: 99 }), [1, 2, 3], 'never widens')
let n = createInitialState(plan, clock); n = step(n, [{ op: 'narrow', materialId: 'pdf-3', upTo: 20 }])
assert.deepEqual(n.plan.blocks.filter(b => b.materialId === 'pdf-3').map(b => b.blockKey), ['pdf-3:1-15', 'pdf-3:16-20']); assert.ok(n.plan.blocks.every((b, i) => b.index === i))
assert.ok(Object.keys(n.progress).length === n.plan.blocks.length && n.plan.blocks.every(b => n.progress[b.blockKey]), 'progress stays consistent with the rebuilt blocks')
n = step(n, [{ op: 'narrow', materialId: 'pdf-1', ranges: [[1, 5]] }]); assert.equal(currentBlock(n)!.blockKey, 'pdf-1:1-15', 'the already-active block is never rewritten')
assert.ok(n.plan.batches.length === 2 && n.plan.batches[0].materialIds.length === 5, 'narrowing never touches the authority batches')
assert.equal(studiedPagesOf(w, 'pdf-2').length, 30)

// ── 13. No contamination of Free / Adaptive / Manual ───────────────────────────────────────────────────────────
const sessionsSource = readFileSync('lib/studySessions.ts', 'utf8'); assert.match(sessionsSource, /export type ProcessMode = 'free' \| 'adaptive' \| 'manual';/, 'Phase 1 does not touch ProcessMode')
for (const file of readdirSync('lib/pageStudy')) {
  const source = readFileSync(`lib/pageStudy/${file}`, 'utf8')
  const imports = [...source.matchAll(/from '([^']+)'/g)].map(m => m[1])
  for (const spec of imports) assert.ok(!/studySessions|freeToolState|manualToolState|materialSession|freeAlaiState|adaptive\/(session|journey|resume|programRestore|planGenerator)|masteryEngine/.test(spec), `${file} must not depend on Free/Adaptive/Manual runtime: ${spec}`)
}
const realFetch = globalThis.fetch; process.env.STUDYAL_API_URL = 'https://worker.test'
globalThis.fetch = (async () => new Response(JSON.stringify({ sessions: [{ id: 's-ps', userId: 'u1', processMode: 'page_study', materialIds: ['pdf-1'], selectedPages: {} }] }), { status: 200 })) as typeof fetch
const freeSessionCheck = getAuthoritativeFreeSession('s-ps', 'u1').then(result => assert.equal(result, null, 'a page_study session is invisible to every Free tool')).finally(() => { globalThis.fetch = realFetch })

// ── 14. EN / ES / ZH / Unicode survive the pure state layer ────────────────────────────────────────────────────
let uni = createInitialState(plan, clock); const uk = currentBlock(uni)!.blockKey
const labels = ['Photosynthesis converts light energy', 'La fotosíntesis convierte la energía luminosa', '光合作用将光能转化为化学能', 'Δ𝐺 = ΔH − TΔS ✓']
const uMetas = labels.map((label, i) => meta('pdf-1', `u${i}`, label))
uni = step(uni, [{ op: 'units', blockKey: uk, total: 4 }, { op: 'teach', blockKey: uk, klass: 'FULL', units: uMetas }, { op: 'ask', ref: 'zh', unitRefs: [uMetas[2].unitRef], format: 'open' }])
uni = step(uni, [{ op: 'answer', verdict: 'incorrect', digest: '光能转化为热能', misconception: { statement: '认为光能变成热能', correctStatement: '光能转化为化学能' } }])
const back = JSON.parse(JSON.stringify(uni)) as PageStudyState; assert.deepEqual(back, uni)
assert.equal(back.concepts['pdf-1::u2'].label, '光合作用将光能转化为化学能'); assert.equal(back.concepts['pdf-1::u3'].label, 'Δ𝐺 = ΔH − TΔS ✓'); assert.equal(back.misconceptions[0].statement, '认为光能变成热能')
assert.equal(back.concepts['pdf-1::u2'].attempts[0].digest, '光能转化为热能')
assert.equal(buildStudyDigest(uni).some(d => d.label === '光合作用将光能转化为化学能'), true)
freeSessionCheck.then(() => console.log('PASS page-study-core: 8 PDFs→one plan (5+3 batches), max-5 untouched, no silent truncation, PDF5→PDF6, cross-batch weakness as derived state, evidence/independence, pending survives doubts, carryover, coverage-only, replay/rehydration, identities, scope, isolation, Unicode')).catch(error => { console.error(error); process.exit(1) })
