/**
 * READ-ONLY integration probe (opt-in, not part of the default suite): does the Phase 1 quote re-location strategy work on
 * a REAL persisted StudyalMaterialEnjoyer against the REAL stored material text? It never writes to the Worker or the repo.
 *   usage: npx tsx --env-file=.env.local scripts/tests/page-study-real-enjoyer-probe.ts [materialId] [fingerprint]
 */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { lookupStudyalMaterialEnjoyer, WorkerMaterialEnjoyerStore } from '../../lib/adaptive/materialEnjoyer'
import { getMaterialText } from '../../lib/materials/repository'
import { buildSourceIndex, normalizeSourceText } from '../../lib/materials/sourceIndex'
import { buildBlockGrounding, buildPageTextIndex, classifyUnit, extractRawUnits, locateQuote, renderBlockGrounding } from '../../lib/pageStudy/grounding'

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
async function main() {
  const materialId = process.argv[2] || 'mat_72c19d2e7b1596f05e39d45c'
  const fingerprint = process.argv[3] || '83d61f109ff90ef4'
  const stored = await getMaterialText(materialId)
  assert.ok(stored?.raw_text, 'real material text must exist')
  const rawText = stored!.raw_text
  const totalPages = (rawText.match(/\[P[aá]gina \d+\]/gi) || []).length
  const selection = buildSourceSelectionSnapshot([materialId], { [materialId]: range(1, totalPages) })
  assert.equal(selection.fingerprint, fingerprint, 'the persisted Enjoyer was built for exactly this 1..N selection')
  const persisted = await lookupStudyalMaterialEnjoyer(fingerprint, new WorkerMaterialEnjoyerStore())
  assert.ok(persisted, 'the persisted Enjoyer must be readable (read-only lookup)')
  const before = JSON.stringify(persisted)
  const { units, topics } = extractRawUnits(persisted, selection)
  const source = buildSourceIndex(selection.fingerprint, [{ materialId, materialName: 'real', kind: 'pdf', rawText, selectedPages: range(1, totalPages) }])
  const index = buildPageTextIndex(source)
  const all = new Set(range(1, totalPages))

  // ── 1. quote relocation statistics over EVERY span of the real Enjoyer ──────────────────────────────────
  const rows: any[] = []
  for (const u of units) for (const s of u.rawSpans) {
    const located = locateQuote(s.quote, u.materialId, all, index)
    const nq = normalizeSourceText(s.quote)
    const rawSubstring = [...(index.get(materialId) ?? [])].some(([, blocks]) => blocks.some(b => b.text.includes(s.quote.trim())))
    const normalizedExact = [...(index.get(materialId) ?? [])].some(([, blocks]) => blocks.some(b => b.normalized.includes(nq)))
    rows.push({ unit: u.sourceItemId, quoteLen: s.quote.length, recordedPage: s.recordedPage, unitPages: u.pages, located, rawSubstring, normalizedExact, short: nq.length < 12 })
  }
  const total = rows.length
  const stat = {
    spans: total,
    rawExact: rows.filter(r => r.rawSubstring).length,
    normalizedOnly: rows.filter(r => !r.rawSubstring && r.normalizedExact).length,
    fuzzyOnly: rows.filter(r => !r.normalizedExact && r.located.length).length,
    unrecoverable: rows.filter(r => !r.located.length).length,
    tooShortToLocate: rows.filter(r => r.short).length,
    repeatedOnManyPages: rows.filter(r => r.located.length > 1).length,
    recordedPageCorrect: rows.filter(r => r.located.length && r.located.includes(r.recordedPage)).length,
    recordedPageWrongButLocated: rows.filter(r => r.located.length && !r.located.includes(r.recordedPage)).length,
    recordedPageEqualsFirstUnitPage: rows.filter(r => r.recordedPage === r.unitPages[0]).length,
  }
  // Why are quotes unrecoverable? (a) their pages carry almost no raw text (slide/image content) or (b) the text exists but the quote is not in it.
  const rawCharsOn = (pages: number[]) => pages.reduce((n, p) => n + (index.get(materialId)?.get(p) || []).reduce((m, b) => m + b.text.length, 0), 0)
  const bestOverlap = (quote: string, pages: number[]) => {
    const q = normalizeSourceText(quote).split(' ').filter(t => t.length >= 3)
    let best = 0
    for (const p of pages) for (const b of index.get(materialId)?.get(p) || []) if (q.length) best = Math.max(best, q.filter(t => b.tokens.has(t)).length / q.length)
    return best
  }
  const unrec = units.flatMap(u => u.rawSpans.map(s => ({ u, s }))).filter(({ u, s }) => !locateQuote(s.quote, u.materialId, all, index).length)
  const unrecBreakdown = {
    total: unrec.length,
    onPagesWithLittleRawText: unrec.filter(({ u }) => rawCharsOn(u.pages) < 120).length,
    onPagesWithRawText: unrec.filter(({ u }) => rawCharsOn(u.pages) >= 120).length,
    bestTokenOverlapOver80pct: unrec.filter(({ u, s }) => bestOverlap(s.quote, u.pages) >= 0.8).length,
    bestTokenOverlapUnder50pct: unrec.filter(({ u, s }) => bestOverlap(s.quote, u.pages) < 0.5).length,
  }
  const unicodeLocated = units.flatMap(u => u.rawSpans.map(s => ({ u, s }))).filter(({ s }) => /[áéíóúüñÁÉÍÓÚÑ²³₂₃→≠°]/.test(s.quote) && locateQuote(s.quote, materialId, all, index).length).length
  const unicode = rows.length ? units.flatMap(u => u.rawSpans).filter(s => /[áéíóúüñÁÉÍÓÚÑ²³₂₃→≠°]/.test(s.quote)).length : 0

  // ── 2. every unit against a simulated block 1–15 (cross-boundary behaviour on real targets) ──────────────
  const A = new Set(range(1, Math.min(15, totalPages)))
  const cls = units.map(u => ({ u, c: classifyUnit(u, A, index), reach: [...new Set([...u.pages, ...u.rawSpans.map(s => s.recordedPage).filter(p => p > 0)])] }))
  const straddlers = cls.filter(x => x.reach.some(p => !A.has(p)) && x.reach.some(p => A.has(p)))
  const outcome = (k: string) => straddlers.filter(x => x.c.klass === k).length
  const g = buildBlockGrounding({ units, topics, pageIndex: index, materialId, blockPages: [...A], studiedPages: [], taught: {}, deferred: [] })
  const prompt = renderBlockGrounding(g)
  const maxPageInPrompt = Math.max(0, ...[...prompt.matchAll(/(?:p\.|page )(\d+)/g)].map(m => Number(m[1])))
  const futureUnits = units.filter(u => Math.min(...[...u.pages, ...u.rawSpans.map(s => s.recordedPage).filter(p => p > 0)]) > 15)
  const leakedFutureTitles = topics.filter(t => t.pages.some(p => p > 15) && g.topicTitles.includes(t.title))
  const futureSummaryLeaks = futureUnits.filter(u => prompt.includes(u.summary)) // the WHOLE future summary, not a shared sentence opener
  const unchanged = JSON.stringify(persisted) === before

  const report = {
    materialId, fingerprint, totalPages, rawTextChars: rawText.length, unitCount: units.length, topicCount: topics.length,
    pageTextChars: range(1, totalPages).map(p => (index.get(materialId)?.get(p) || []).reduce((n, b) => n + b.text.length, 0)),
    quoteStats: stat, unicodeSpans: unicode, unicodeSpansLocated: unicodeLocated, unrecoverableBreakdown: unrecBreakdown,
    block1to15: {
      total: units.length, FULL: cls.filter(x => x.c.klass === 'FULL').length, PROJECTED: cls.filter(x => x.c.klass === 'PROJECTED').length, DEFER: cls.filter(x => x.c.klass === 'DEFER').length,
      straddlers: straddlers.length, straddlerProjected: outcome('PROJECTED'), straddlerDeferred: outcome('DEFER'), straddlerFull: outcome('FULL'),
      groundedUnits: g.units.length, deferredListed: g.deferred.length, maxPageInPrompt, futureOnlyUnits: futureUnits.length, futureUnitsInPrompt: futureUnits.filter(u => g.units.some(x => x.unitRef === u.unitRef)).length,
      leakedFutureTopicTitles: leakedFutureTitles.length, futureSummaryLeaks: futureSummaryLeaks.length,
    },
    straddlerSamples: straddlers.slice(0, 6).map(x => ({ id: x.u.sourceItemId, reach: x.reach, klass: x.c.klass, reason: x.c.reason, evidencePages: x.c.evidence.map(e => e.pages) })),
    unrecoverableSamples: rows.filter(r => !r.located.length).slice(0, 6).map(r => ({ unit: r.unit, quoteLen: r.quoteLen, recordedPage: r.recordedPage, unitPages: r.unitPages })),
    canonicalEnjoyerUnchanged: unchanged,
  }
  writeFileSync('/tmp/page-study-real-probe.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  assert.equal(unchanged, true); assert.ok(maxPageInPrompt <= 15, 'no future page number in the prompt'); assert.equal(leakedFutureTitles.length, 0); assert.equal(futureSummaryLeaks.length, 0); assert.equal(report.block1to15.futureUnitsInPrompt, 0)
}
main().catch(error => { console.error('PROBE ERROR', error?.message || error); process.exit(1) })
