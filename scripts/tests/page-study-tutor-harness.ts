import './page-study-env'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { createPageStudy, loadPageStudy } from '../../lib/pageStudy/service'
import { WorkerPageStudyStore } from '../../lib/pageStudy/store'
import { runTutorTurn, type TutorDeps, type TutorTurnOutcome } from '../../lib/pageStudy/tutor'
import { nextSlotOf } from '../../lib/pageStudy/view'
import type { PageStudyState } from '../../lib/pageStudy/types'
import { makeWorker } from './page-study-worker-harness'

export type Lang = 'es' | 'en' | 'zh'
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

const uniq = (i: number, p: number) => [1, 2, 3, 4, 5, 6].map(k => `zq${i}x${p}k${k}`).join(' ')   // per-page vocabulary: real pages are not 95% identical
const T = {
  es: { page: (i: number, p: number) => `La hibridación del compuesto en la página explica el orbital con el dato FUT${i}X${p} ${uniq(i, p)} y el enlace correspondiente.`, label: (i: number, p: number) => `Concepto ${i}.${p} de hibridación`, sum: (i: number, p: number) => `SUMMARY-${i}-${p}: explicación completa del concepto ${p} de hibridación con detalle largo suficiente.` },
  en: { page: (i: number, p: number) => `The hybridization of the compound on the page explains the orbital with the datum FUT${i}X${p} ${uniq(i, p)} and the matching bond.`, label: (i: number, p: number) => `Hybridization concept ${i}.${p}`, sum: (i: number, p: number) => `SUMMARY-${i}-${p}: full explanation of hybridization concept ${p} with long enough detail.` },
  zh: { page: (i: number, p: number) => `化合物的杂化在此页解释了轨道以及对应的化学键并给出数据FUT${i}X${p} ${uniq(i, p)}。`, label: (i: number, p: number) => `杂化概念${i}.${p}`, sum: (i: number, p: number) => `SUMMARY-${i}-${p}：关于杂化概念${p}的完整解释，细节足够长。` },
} as const

export const PAGES = 30
export type FixtureCorpus = ReturnType<typeof makeCorpus>
export interface WorldOptions { pdfs?: number; lang?: Lang; blockSize?: number; corpus?: FixtureCorpus }

/**
 * A literal-content fixture corpus for domain-realistic probes (Phase 5 Blocker 3): unlike
 * `makeCorpus` (one generic synthetic "hybridization" unit per page, 30 pages), this takes
 * real authored concepts with their own page/label/summary/quote, so probes can assert on
 * actual domain content (chemistry/math/history/Falcons-style text) instead of synthetic markers.
 */
export interface FixtureConcept { id: string; page: number; label: string; summary: string; quote: string; kind?: string }
export interface FixtureMaterialSpec { materialId: string; name: string; lang?: Lang; pageCount: number; concepts: FixtureConcept[] }
export function buildFixtureCorpus(materialsSpec: FixtureMaterialSpec[], blockSize: number): FixtureCorpus {
  const lang = materialsSpec[0]?.lang ?? 'es'
  const pageQuote = (i: number, p: number) => {
    const spec = materialsSpec[i - 1]
    return spec?.concepts.filter(c => c.page === p).map(c => c.quote).join(' ') || `[página ${p} sin contenido de fixture]`
  }
  const rawText = (i: number) => {
    const spec = materialsSpec[i - 1]
    return range(1, spec.pageCount).map(p => `[Página ${p}]\n${pageQuote(i, p)}`).join('\n\f\n')
  }
  const units = (i: number) => {
    const spec = materialsSpec[i - 1]
    return spec.concepts.map(c => ({
      id: c.id, kind: c.kind ?? 'concept', label: c.label, summary: c.summary, importance: 80, difficulty: 'basic',
      materialId: spec.materialId, topicId: `${spec.materialId}-t1`, pages: [c.page], sourceSpans: [{ page: c.page, quote: c.quote }], misconceptions: [], globalOrder: c.page * 10,
    }))
  }
  const topics = (i: number) => { const spec = materialsSpec[i - 1]; return [{ id: `${spec.materialId}-t1`, title: spec.name, pages: range(1, spec.pageCount), materialId: spec.materialId }] }
  const materials = materialsSpec.map(spec => ({ materialId: spec.materialId, name: spec.name, selectedPages: [] as number[] }))
  const universe = Object.fromEntries(materialsSpec.map(spec => [spec.materialId, range(1, spec.pageCount)]))
  const payloadFor = (materialIds: string[], selection: ReturnType<typeof buildSourceSelectionSnapshot>) => ({
    blueprint: {
      sourceSelectionFingerprint: selection.fingerprint, materialIds, selectedPages: selection.selectedPages, materialLanguage: lang,
      topicsIndex: materialIds.flatMap(id => topics(materialsSpec.findIndex(s => s.materialId === id) + 1)),
      globalOrderedAnalysis: materialIds.flatMap(id => units(materialsSpec.findIndex(s => s.materialId === id) + 1)),
      uniqueConceptsIndex: [],
    },
  })
  return { lang, pdfs: materialsSpec.length, materials, universe, pageQuote, rawText, payloadFor, blockSize }
}

/** A synthetic corpus: every PDF has 30 pages, every page has a unique FUT-i-p marker, and PDF 1 carries cross-boundary (14–17) targets. */
export function makeCorpus(opts: WorldOptions = {}) {
  const lang = opts.lang ?? 'es'; const t = T[lang]
  const pdfs = opts.pdfs ?? 8
  const pageQuote = (i: number, p: number) => t.page(i, p)
  const rawText = (i: number) => range(1, PAGES).map(p => `[Página ${p}]\n${pageQuote(i, p)}`).join('\n\f\n')
  const units = (i: number) => {
    const list: Array<Record<string, unknown>> = range(1, PAGES).map(p => ({
      id: `u${p}`, kind: 'concept', label: t.label(i, p), summary: t.sum(i, p), importance: 80, difficulty: 'basic', materialId: `pdf-${i}`, topicId: `t${i}-${p <= 5 ? 1 : 2}`,
      pages: [p], sourceSpans: [{ page: p, quote: pageQuote(i, p) }], misconceptions: [], globalOrder: p * 10,
    }))
    if (i === 1) {
      list.push({ id: 'straddle-ok', kind: 'concept', label: t.label(i, 14), summary: `SYNTH-STRADDLE-OK-${i} menciona FUT${i}X17`, importance: 80, materialId: `pdf-${i}`, topicId: 't1-2', pages: [14, 15, 16, 17], sourceSpans: [{ page: 14, quote: pageQuote(i, 14) }, { page: 14, quote: pageQuote(i, 15) }], misconceptions: ['FUTURE-MISCONCEPTION-p17'], globalOrder: 145 })
      list.push({ id: 'straddle-weak', kind: 'concept', label: `Straddler débil ${i}`, summary: `SYNTH-WEAK-${i} menciona FUT${i}X16`, importance: 80, materialId: `pdf-${i}`, topicId: 't1-2', pages: [14, 15, 16, 17], sourceSpans: [{ page: 14, quote: 'orbital corto' }], misconceptions: [], globalOrder: 146 })
    }
    return list
  }
  const topics = (i: number) => [{ id: `t${i}-1`, title: `Fundamentos ${i}`, pages: range(1, 5), materialId: `pdf-${i}` }, { id: `t${i}-2`, title: `FUTURE-TITLE-${i}`, pages: range(14, 17), materialId: `pdf-${i}` }]
  const materials = range(1, pdfs).map(i => ({ materialId: `pdf-${i}`, name: `PDF ${i}`, selectedPages: [] as number[] }))
  const universe = Object.fromEntries(materials.map(m => [m.materialId, range(1, PAGES)]))
  const payloadFor = (materialIds: string[], selection: ReturnType<typeof buildSourceSelectionSnapshot>) => ({
    blueprint: { sourceSelectionFingerprint: selection.fingerprint, materialIds, selectedPages: selection.selectedPages, materialLanguage: lang,
      topicsIndex: materialIds.flatMap(id => topics(Number(id.split('-')[1]))), globalOrderedAnalysis: materialIds.flatMap(id => units(Number(id.split('-')[1]))), uniqueConceptsIndex: [] },
  })
  return { lang, pdfs, materials, universe, pageQuote, rawText, payloadFor, blockSize: opts.blockSize ?? 15 }
}

export interface ScriptContext { prompt: string; message: string; move: string; handles: string[]; chunk: string[]; pending: boolean; isStart: boolean }
export type TutorScript = (ctx: ScriptContext) => string | { text: string } | Error

/** A deterministic stand-in for the model: it only sees the prompt the server built and answers with the marker protocol. */
export function defaultScript(ctx: ScriptContext): string {
  const m = ctx.message
  const chunk = ctx.chunk.length ? `[[T:${ctx.chunk.join(',')}]] ` : ''
  if (ctx.isStart) return `[[U:chat]] ${chunk}[[S:${ctx.chunk.join(',')}]] Empezamos con lo básico: aquí va la primera idea.`
  if (/^ANS-OK/.test(m)) return `[[U:answer]] [[V:correct]] ${chunk}Correcto, eso es.${ctx.move === 'ASK' ? '' : ''}`
  if (/^ANS-BAD/.test(m)) return `[[U:answer]] [[V:incorrect]] [[M:cree que sp2 deja 2 p::sp2 deja 1 p sin hibridar]] [[A:short|${ctx.handles[0] || 'K1'}]] [[H:hint]] No exactamente; piensa en el patrón. ¿Cuántos p quedan sin hibridar en sp2?`
  if (/^ANS-PARTIAL/.test(m)) return `[[U:answer]] [[V:partial]] [[H:hint]] Casi; falta una parte. ¿Cuál?`
  if (/^DOUBT/.test(m)) return `[[U:clarify]] Porque los orbitales p que no se mezclan quedan libres para formar el enlace pi. Volviendo a tu pregunta.`
  if (/^QUESTION/.test(m)) return `[[U:question]] Buena pregunta: es una idea general distinta. Sigamos donde estábamos.`
  if (/^NOVERDICT/.test(m)) return `[[U:answer]] Eso suena razonable.`
  if (/^BADVERDICT/.test(m)) return `[[U:answer]] [[V:excelente]] Muy bien.`
  if (/^NOMARK/.test(m)) return `Respuesta sin marcadores.`
  if (/^EXTERNAL/.test(m)) return `[[U:question]] [[E:1]] [[T:${ctx.chunk.join(',')}]] Por conocimiento general (no del PDF): ...`
  if (/^ASKWHILEPENDING/.test(m)) return `[[U:clarify]] [[A:open|K1]] Aclaración y una pregunta nueva que debe ignorarse.`
  if (ctx.move === 'ASK' || ctx.move === 'BLOCK_REVIEW' || ctx.move === 'RETEST' || ctx.move === 'REMEDIATE') return `[[U:chat]] [[A:short|${ctx.handles[0] || 'K1'}]] A ver si quedó claro: ¿qué recuerdas de esto?`
  if (ctx.move === 'RECALL') return `[[U:chat]] [[A:short|${ctx.handles[0] || 'R1'}]] Antes de seguir, ¿recuerdas cuántos p quedan en sp2?`
  if (ctx.move === 'TEACH') return `[[U:chat]] ${chunk}Siguiente idea, explicada con calma.`
  return `[[U:chat]] Listo. ¿Seguimos?`
}

export function parsePrompt(prompt: string): ScriptContext {
  const move = /SUGGESTED MOVE: ([A-Z_]+)(?: \(([^)]*)\))?/.exec(prompt)
  const chunkSection = /SUGGESTED CHUNK[^\n]*\n([\s\S]*?)(?:\nALREADY TAUGHT|\nPREVIOUS STUDY)/.exec(prompt)?.[1] ?? ''
  const chunk = [...chunkSection.matchAll(/^\[(#\d+)\]/gm)].map(x => x[1])
  const msg = /STUDENT MESSAGE: ("(?:[^"\\]|\\.)*")/.exec(prompt)
  return { prompt, message: msg ? String(JSON.parse(msg[1])) : '', move: move?.[1] ?? '', handles: (move?.[2] ?? '').split(',').map(s => s.trim()).filter(Boolean), chunk, pending: /PENDING QUESTION \(authoritative/.test(prompt), isStart: /very start of this block/.test(prompt) }
}

export async function makeWorld(opts: WorldOptions & { userId?: string } = {}) {
  const corpus = opts.corpus ?? makeCorpus(opts)
  const w = makeWorker()
  const userId = opts.userId ?? 'u1'
  const counters = { calls: 0, prompts: [] as string[], lookups: [] as string[], loads: [] as string[] }
  const behavior: { script: TutorScript; queue: Array<string | Error | ((c: ScriptContext) => string | Error)> } = { script: defaultScript, queue: [] }
  const base = { store: w.store, now: (() => { let t = 1_700_000_000_000; return () => (t += 10) })() }
  let planId = ''; let batches: PageStudyState['plan']['batches'] = []
  const provider: NonNullable<TutorDeps['provider']> = (async (params: { messages: Array<{ content: string }> }) => {
    counters.calls++
    const prompt = params.messages.map(m => m.content).join('\n'); counters.prompts.push(prompt)
    const ctx = parsePrompt(prompt)
    const next = behavior.queue.length ? behavior.queue.shift()! : behavior.script(ctx)
    const out = typeof next === 'function' ? next(ctx) : next
    if (out instanceof Error) throw out
    const text = typeof out === 'string' ? out : (out as { text: string }).text
    return { text: text.trim().startsWith('{') || text.startsWith('RAW:') ? text.replace(/^RAW:/, '') : JSON.stringify({ answer: text }), provider: 'fake', model: 'deterministic' }
  }) as never
  const deps = (over: Partial<TutorDeps> = {}): TutorDeps => ({
    ...base, ...over,
    context: over.context ?? {
      lookupEnjoyer: async fingerprint => { counters.lookups.push(fingerprint); const b = batches.find(x => x.selection.fingerprint === fingerprint); return b ? corpus.payloadFor(b.materialIds, b.selection) : null },
      loadSource: async materialId => { counters.loads.push(materialId); const i = Number(materialId.split('-')[1]); return { materialId, name: `PDF ${i}`, kind: 'pdf', rawText: corpus.rawText(i) } },
    },
    provider: over.provider ?? provider,
  })
  const created = await createPageStudy(base, { userId, temaId: 'tema-1', materials: corpus.materials, blockSize: corpus.blockSize, universe: corpus.universe })
  planId = created.state.planId; batches = created.state.plan.batches
  const load = () => loadPageStudy(base, { userId, planId })

  async function say(message: string, o: { deps?: TutorDeps; slot?: string; expectedSeq?: number | null; languageOverride?: string } = {}): Promise<TutorTurnOutcome> {
    const { state } = await load()
    const slot = o.slot ?? nextSlotOf(state)!
    return runTutorTurn(o.deps ?? deps(), { userId, planId, slot, message, expectedSeq: o.expectedSeq === null ? undefined : o.expectedSeq ?? state.turnSeq + 1, languageOverride: o.languageOverride })
  }
  const start = (o: Parameters<typeof say>[1] = {}) => say('', o)
  return { corpus, w, userId, planId, get batches() { return batches }, counters, behavior, deps, load, say, start, initial: created.state }
}
export type World = Awaited<ReturnType<typeof makeWorld>>

/** The handle the server assigned to a unit whose label contains `needle` (parsed from the prompt the provider actually received). */
export const handleFor = (prompt: string, needle: string): string | undefined => new RegExp(`^\\[([#KR]\\d+)\\][^\\n]*${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm').exec(prompt)?.[1]
