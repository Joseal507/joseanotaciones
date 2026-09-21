/**
 * OPT-IN live tutor probe (not part of the default suite): REAL provider + REAL persisted chemistry Enjoyer + REAL stored material text,
 * around an ISOLATED in-memory PageStudy state (no production PageStudy rows are read or written; the Worker is only read for the material).
 *   usage: npx tsx --env-file=.env.local scripts/tests/page-study-tutor-live-probe.ts
 */
import { CAPTURED_WORKER_SECRET } from './page-study-live-env'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { alai } from '../../lib/alai'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { lookupStudyalMaterialEnjoyer, WorkerMaterialEnjoyerStore } from '../../lib/adaptive/materialEnjoyer'
import { getMaterialText } from '../../lib/materials/repository'
import { createPageStudy, loadPageStudy } from '../../lib/pageStudy/service'
import { runTutorTurn, type TutorDeps } from '../../lib/pageStudy/tutor'
import { resolveTutorContext, inspectTutorPrompt } from '../../lib/pageStudy/context'
import { nextSlotOf } from '../../lib/pageStudy/view'
import { makeWorker } from './page-study-worker-harness'

const MATERIAL = process.env.PROBE_MATERIAL || 'mat_72c19d2e7b1596f05e39d45c'
const PROBE_OUT = process.env.PROBE_OUT || '/tmp/page-study-tutor-live-probe.out.json'
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const dump: { prompts: string[]; raws: string[]; transcript: unknown[] } = { prompts: [], raws: [], transcript: [] }
async function main() {
  const text = await getMaterialText(MATERIAL); assert.ok(text?.raw_text, 'real material text')
  const totalPages = (text!.raw_text.match(/\[P[aá]gina \d+\]/gi) || []).length
  const w = makeWorker(); w.env.WORKER_SHARED_SECRET = CAPTURED_WORKER_SECRET; const userId = 'live-probe-user'
  let clock = Date.now(); const base = { store: w.store, now: () => (clock += 25) }
  const created = await createPageStudy(base, { userId, temaId: 'live-tema', materials: [{ materialId: MATERIAL, name: 'Química (real)', selectedPages: range(1, totalPages) }], blockSize: 15, universe: { [MATERIAL]: range(1, totalPages) } })
  const planId = created.state.planId
  const fp = created.state.plan.batches[0].selection.fingerprint
  assert.equal(fp, buildSourceSelectionSnapshot([MATERIAL], { [MATERIAL]: range(1, totalPages) }).fingerprint)
  const persisted = await lookupStudyalMaterialEnjoyer(fp, new WorkerMaterialEnjoyerStore()); assert.ok(persisted, `the persisted Enjoyer for ${fp} must exist`)
  const stat = { lookups: 0, loads: 0, calls: 0, prompts: dump.prompts, raws: dump.raws }
  const provider: NonNullable<TutorDeps['provider']> = (async (params: Parameters<typeof alai>[0]) => {
    stat.calls++; stat.prompts.push((params as { messages: Array<{ content: string }> }).messages.map(m => m.content).join('\n'))
    const out = await alai(params); stat.raws.push((out as { text: string }).text); return out
  }) as never
  const deps = (): TutorDeps => ({ ...base, provider, context: {
    lookupEnjoyer: async f => { stat.lookups++; return lookupStudyalMaterialEnjoyer(f, new WorkerMaterialEnjoyerStore()) },
    loadSource: async id => { stat.loads++; return { materialId: id, name: 'Química (real)', kind: 'pdf', rawText: text!.raw_text } },
  } })
  const transcript = dump.transcript as Array<Record<string, unknown>>
  const say = async (label: string, message: string, o: { slot?: string; languageOverride?: string } = {}) => {
    const { state } = await loadPageStudy(base, { userId, planId }); const before = stat.calls; const p0 = stat.prompts.length
    const out = await runTutorTurn(deps(), { userId, planId, slot: o.slot ?? nextSlotOf(state)!, message, expectedSeq: state.turnSeq + 1, languageOverride: o.languageOverride })
    const t = out.turn; const row = { label, student: message.slice(0, 160), role: t.role, graded: t.graded, providerCalls: stat.calls - before, repaired: t.diagnostics.repaired, promptChars: stat.prompts.length > p0 ? stat.prompts.at(-1)!.length : 0, pending: t.pendingQuestion ? `${t.pendingQuestion.kind}: ${t.pendingQuestion.text.slice(0, 120)}` : null, provenance: t.provenance.map(x => `${x.kind}:${x.pages.join('/')}`).join(' '), ignored: t.diagnostics.ignored, reply: t.reply, replayed: out.replayed, cov: out.view.coverage }
    transcript.push(row); console.log(`\n── ${label} ── [${row.role}${row.graded ? '/' + row.graded : ''}] calls=${row.providerCalls} prompt=${row.promptChars} pend=${row.pending ?? '-'}\n${t.reply}`)
    return out
  }
  const pend = async () => (await loadPageStudy(base, { userId, planId })).state.pending

  await say('1 start block', '')
  await say('2 continue', 'sigue')
  for (let i = 0; i < 4 && !(await pend()); i++) await say(`2b continue ${i}`, 'sigue')
  assert.ok(await pend(), 'the tutor asked a check')
  await say('3 wrong answer', 'Yo diría que es porque el carbono es un gas noble que no reacciona con nada, y por eso todo lo demás se forma a su alrededor.')
  assert.ok(await pend(), 'a wrong answer keeps a re-anchored question on the same concept')
  const pendBefore = (await pend())?.ref
  await say('4 conceptual doubt (pending must survive)', '¿Pero por qué funciona así? No termino de entender la razón de fondo.')
  assert.equal((await pend())?.ref, pendBefore, 'pending survived the doubt')
  const understood = await say('5 understanding shown', 'El carbono puede formar cuatro enlaces estables y también enlazarse consigo mismo; por eso construye cadenas, anillos y muchos compuestos diferentes.')
  assert.equal(understood.turn.graded, 'correct', 'the student demonstrated the pending concept')
  assert.equal(await pend(), null, 'the correctly demonstrated concept clears pending')
  await say('6 continue', 'sigue'); await say('7 continue', 'sigue')
  const seqBefore = (await loadPageStudy(base, { userId, planId })).state.turnSeq; const callsBefore = stat.calls; const writesBefore = w.stats.writes
  const reopened = await loadPageStudy(base, { userId, planId }); assert.equal(reopened.state.turnSeq, seqBefore)
  const replay = await runTutorTurn(deps(), { userId, planId, slot: 'pstudy:' + reopened.state.plan.blocks[0].blockKey + ':start', message: '', expectedSeq: 1 })
  assert.equal(replay.replayed, true); assert.equal(stat.calls, callsBefore, 'close/reopen made zero provider calls'); assert.equal(w.stats.writes, writesBefore, 'and zero writes')

  // ── prompt safety over the ACTUAL prompts the provider received ─────────────────────────────────────────────
  const finalState = (await loadPageStudy(base, { userId, planId })).state
  const block = finalState.plan.blocks[0]; const allowed = new Set(range(block.start, block.end))
  let maxPage = 0; let futureRefs = 0
  for (const p of stat.prompts) for (const m of p.matchAll(/(?:\bp\.|\bpage\s|\bpágina\s)(\d+)/gi)) { maxPage = Math.max(maxPage, Number(m[1])); if (!allowed.has(Number(m[1]))) futureRefs++ }
  const ctx = await resolveTutorContext(finalState, deps().context, userId); const violations = stat.prompts.flatMap(p => inspectTutorPrompt(p, ctx))
  const summary = {
    material: MATERIAL, totalPages, block: `${block.start}-${block.end}`, providerCallsTotal: stat.calls, turns: transcript.length,
    callsPerTurn: transcript.map(r => r.providerCalls), promptChars: stat.prompts.map(p => p.length), maxPromptChars: Math.max(...stat.prompts.map(p => p.length)), repairs: transcript.filter(r => r.repaired).length,
    lookups: stat.lookups, sourceLoads: stat.loads, promptPageRefsOutsideBlock: futureRefs, maxPageMentioned: maxPage, inspectorViolationsOnActualPrompts: violations,
    otherMaterialInPrompt: stat.prompts.some(p => /mat_[0-9a-f]{8,}/.test(p) && !p.includes(MATERIAL)), recentWindowInLastPrompt: /RECENT CONVERSATION/.test(stat.prompts.at(-1)!), digestChars: (stat.prompts.at(-1)!.match(/PREVIOUS STUDY[\s\S]*?(?=\n[A-Z ]{6,}:|\n\n)/)?.[0] ?? '').length,
    markersMissing: stat.raws.filter(r => !/\[\[U:/.test(r)).length, pendingSurvivedDoubt: true, reopenCalls: 0, reopenWrites: 0,
  }
  writeFileSync(PROBE_OUT, JSON.stringify({ summary, transcript, prompts: stat.prompts, raws: stat.raws }, null, 1))
  console.log('\nSUMMARY', JSON.stringify(summary, null, 1))
  assert.equal(futureRefs, 0); assert.deepEqual(violations, [])
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => writeFileSync(PROBE_OUT.replace('.json', '.dump.json'), JSON.stringify(dump, null, 1)))
