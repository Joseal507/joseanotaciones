import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { buildSourceIndex } from '../../lib/materials/sourceIndex'
import { buildBlockGrounding, buildPageTextIndex, classifyUnit, derivePageUniverse, extractRawUnits, locateQuote, renderBlockGrounding, MIN_PROJECTION_CHARS } from '../../lib/pageStudy/grounding'

/** Page-clipped grounding: adversarial contract. Every assertion is about what may (not) reach a tutor prompt. */
const pageText = (n: number, body: string) => `[Página ${n}]\n${body}`
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

const Q14 = 'La hibridación sp combina un orbital s y un orbital p formando geometría lineal en el carbono'      // real text of p14
const Q16 = 'El triple enlace contiene un enlace sigma y dos enlaces pi perpendiculares entre sí en total'      // real text of p16 ONLY
const REPEATED = 'Los orbitales híbridos equivalentes se orientan para minimizar la repulsión electrónica entre ellos' // on p14 AND p16
const SHORT = 'orbital sp lineal'
const pages: Record<number, string> = {}
for (const n of range(1, 13)) pages[n] = `Contenido base de la página ${n} sobre configuración electrónica del carbono y orbitales atómicos número ${n}.`
pages[3] = 'El carbono tiene cuatro electrones de valencia y por eso puede formar cuatro enlaces covalentes en compuestos orgánicos.'
pages[14] = `${Q14}. ${REPEATED}. También aparece ${SHORT} en una figura.`
pages[15] = 'Resumen intermedio de la página quince con ejemplos del etileno y ángulos de 120 grados en la geometría trigonal.'
pages[16] = `FUTURE16TEXT ${Q16}. ${REPEATED}. FUTURE16TEXT`
pages[17] = 'FUTURE17TEXT el acetileno presenta hibridación sp con enlace triple y geometría lineal de 180 grados FUTURE17TEXT'
const raw = range(1, 17).filter(n => n !== 9).map(n => pageText(n, pages[n])).join('\n\n') // page 9 has NO text (visual-only page)

const selection = buildSourceSelectionSnapshot(['mat-q', 'mat-b'], { 'mat-q': range(1, 17), 'mat-b': [1, 2, 3] })
const source = buildSourceIndex(selection.fingerprint, [
  { materialId: 'mat-q', materialName: 'Química', kind: 'pdf', rawText: raw, selectedPages: range(1, 17) },
  { materialId: 'mat-b', materialName: 'Otra', kind: 'pdf', rawText: [pageText(1, 'B uno'), pageText(2, `Página dos de otro PDF. ${Q16}. B-ONLY-P2`)].join('\n\n'), selectedPages: [1, 2, 3] },
])
const index = buildPageTextIndex(source)

const unit = (id: string, over: Record<string, unknown> = {}) => ({
  id, kind: 'concept', label: id, summary: `SUMMARY-${id}`, importance: 80, difficulty: 'basic', materialId: 'mat-q', topicId: 't1',
  pages: [3], sourceSpans: [{ page: 3, quote: pages[3] }], misconceptions: [], globalOrder: 0, ...over,
})
const items = [
  unit('full', { label: 'Enlaces del carbono', pages: [3, 4], globalOrder: 1, relations: [{ type: 'related', target: 'future' }, { type: 'related', target: 'full2' }], misconceptions: ['Creer que el carbono forma dos enlaces'] }),
  unit('full2', { label: 'Configuración electrónica', pages: [2], sourceSpans: [], globalOrder: 2 }),
  unit('straddle', { label: 'Hibridación sp enlace triple p17', pages: [14, 15, 16, 17], summary: 'SYNTH-STRADDLE: el enlace triple del acetileno (p17) y el ángulo de 180 grados FUTURE-SUMMARY', sourceSpans: [{ page: 14, quote: Q14 }], misconceptions: ['FUTURE-MISCONCEPTION sobre p17'], globalOrder: 3 }),
  unit('supported', { label: 'Hibridación orbital lineal', pages: [14, 16], summary: 'SYNTH-SUPPORTED con datos de p16', sourceSpans: [{ page: 14, quote: Q14 }], globalOrder: 4 }),
  unit('falsepage', { label: 'Triple enlace', pages: [14, 15, 16, 17], summary: 'SYNTH-FALSE', sourceSpans: [{ page: 14, quote: Q16 }], globalOrder: 5 }),          // recorded p14, really p16
  unit('repeated', { label: 'Orbitales híbridos equivalentes', pages: [14, 16, 17], summary: 'SYNTH-REPEATED', sourceSpans: [{ page: 16, quote: REPEATED }], globalOrder: 6 }),
  unit('futureonly', { label: 'Acetileno', pages: [16, 17], summary: 'SYNTH-FUTUREONLY', sourceSpans: [{ page: 16, quote: Q16 }], globalOrder: 7 }),
  unit('insufficient', { label: 'Figura sp', pages: [14, 15, 16, 17], summary: 'SYNTH-INSUFFICIENT', sourceSpans: [{ page: 14, quote: SHORT }], globalOrder: 8 }),
  unit('visual', { label: 'Diagrama de orbitales', pages: [9], summary: 'SUMMARY-VISUAL diagrama', sourceSpans: [], globalOrder: 9 }),
  unit('foreign', { materialId: 'mat-b', label: 'Concepto de otro PDF', pages: [2], summary: 'SUMMARY-MATB', sourceSpans: [{ page: 2, quote: Q16 }], globalOrder: 10 }),
]
const payload = {
  blueprint: {
    sourceSelectionFingerprint: selection.fingerprint, materialIds: selection.materialIds, selectedPages: selection.selectedPages,
    topicsIndex: [
      { id: 't1', title: 'Fundamentos del carbono', pages: range(1, 5), materialId: 'mat-q' },
      { id: 't2', title: 'FUTURE-TITLE hibridación sp y enlace triple', pages: range(14, 17), materialId: 'mat-q' },
    ],
    globalOrderedAnalysis: items, uniqueConceptsIndex: [], pageDispositions: { 'mat-q:9': { status: 'no_extractable_text' }, 'mat-q:1': { status: 'represented' } },
  },
}
const frozen = JSON.stringify(payload)
const { units, topics } = extractRawUnits(payload, selection)
const ground = (over: Record<string, unknown> = {}) => buildBlockGrounding({ units, topics, pageIndex: index, materialId: 'mat-q', blockPages: range(1, 15), studiedPages: [], taught: {}, deferred: [], ...over } as any)
const by = (g: ReturnType<typeof ground>, id: string) => g.units.find(u => u.unitRef === `mat-q::${id}`)

// 1–2. Straddling target 14–17 while studying 1–15: only p14–15 authorized evidence enters; nothing synthesized from p16–17.
const g = ground(); const prompt = renderBlockGrounding(g)
const straddle = by(g, 'straddle')!
assert.equal(straddle.klass, 'PROJECTED'); assert.equal(straddle.text, '', 'the synthesized summary of a straddler is never serialized')
assert.deepEqual(straddle.evidence.map(e => e.pages), [[14]]); assert.deepEqual(straddle.misconceptions, [])
assert.ok(straddle.sourceBlocks.length >= 1 && straddle.sourceBlocks.every(b => b.page <= 15))
for (const leak of ['SYNTH-STRADDLE', 'FUTURE-SUMMARY', 'FUTURE-MISCONCEPTION', 'FUTURE16TEXT', 'FUTURE17TEXT', 'FUTURE-TITLE', 'SYNTH-SUPPORTED', 'SYNTH-FALSE', 'SYNTH-REPEATED', 'SYNTH-FUTUREONLY', 'SYNTH-INSUFFICIENT', 'acetileno', 'Página 16', 'Página 17']) {
  assert.ok(!prompt.includes(leak), `future/synthesized content leaked into the prompt: ${leak}`)
}
assert.ok(prompt.includes(Q14), 'the authorized p14 evidence IS available')
assert.ok([...prompt.matchAll(/p\.(\d+)/g)].every(m => Number(m[1]) <= 15) && [...prompt.matchAll(/page (\d+) text/g)].every(m => Number(m[1]) <= 15), '10. no future page can be serialized')
assert.ok(Math.max(...g.allowedPages) === 15)

// 3. A summary that already contains future information is only serialized for FULL units (all pages authorized).
assert.equal(by(g, 'full')!.klass, 'FULL'); assert.ok(prompt.includes('SUMMARY-full'))
assert.ok(units.find(u => u.unitRef === 'mat-q::straddle')!.summary.includes('FUTURE-SUMMARY'), 'fixture sanity: the raw summary really contains future info')

// 4. Topic title synthesized across p14–17 is excluded; a topic fully inside the allowed pages is kept.
assert.deepEqual(g.topicTitles, ['Fundamentos del carbono'])

// 5. relation/dependsOn cannot leak a future concept: labels only for units that are FULL and available.
assert.deepEqual(by(g, 'full')!.relatedLabels, ['Configuración electrónica']); assert.ok(!prompt.includes('Acetileno'))

// 6. False sourceSpan.page: recorded p14 but the quote really lives on p16 → not trusted, unit deferred.
assert.equal(by(g, 'falsepage'), undefined); assert.ok(g.deferred.includes('mat-q::falsepage'))
assert.deepEqual(locateQuote(Q16, 'mat-q', new Set(range(1, 15)), index), [], 'the quote is not on any authorized page')
assert.deepEqual(locateQuote(Q16, 'mat-q', new Set(range(1, 17)), index), [16])

// 7. Repeated quote on p14 and p16: only the authorized occurrence counts, and only p14 is exposed.
const repeated = by(g, 'repeated')!; assert.equal(repeated.klass, 'PROJECTED'); assert.deepEqual(repeated.evidence.map(e => e.pages), [[14]])

// 8. A quote found only on a future page cannot project anything; a unit living only in the future is not even mentioned.
assert.equal(by(g, 'futureonly'), undefined); assert.ok(!g.deferred.includes('mat-q::futureonly'))

// 9. Insufficient authorized evidence → DEFER (listed, never serialized).
assert.equal(by(g, 'insufficient'), undefined); assert.ok(g.deferred.includes('mat-q::insufficient'))
assert.ok(SHORT.length < MIN_PROJECTION_CHARS)
assert.equal(classifyUnit(units.find(u => u.unitRef === 'mat-q::insufficient')!, new Set(range(1, 15)), index).reason, 'insufficient_authorized_evidence')

// 10. Label guard: a straddler's label is kept only when its terms exist in authorized text; otherwise a neutral handle is used.
assert.ok(!straddle.label.includes('p17') && !straddle.label.includes('triple'), `label with unsupported terms replaced: ${straddle.label}`)
assert.equal(by(g, 'supported')!.label, 'Hibridación orbital lineal')

// 11. Visual-only page: no text, single authorized page → FULL without needing verification.
assert.equal(by(g, 'visual')!.klass, 'FULL'); assert.deepEqual(derivePageUniverse(payload, selection, 'mat-q'), range(1, 17), 'explicit selection wins')
const wholeDoc = buildSourceSelectionSnapshot(['mat-q', 'mat-b'], {})
assert.throws(() => derivePageUniverse(payload, wholeDoc, 'mat-q'), /SOURCE_SELECTION_MISMATCH/, 'a different selection never reads this artifact')

// 12. Same page number in a different PDF stays distinct: neither units nor page text cross materials.
assert.ok(!prompt.includes('SUMMARY-MATB') && !prompt.includes('B-ONLY-P2') && !prompt.includes('otro PDF'))
const gb = ground({ materialId: 'mat-b', blockPages: [1, 2, 3] })
assert.deepEqual(gb.units.map(u => u.unitRef), ['mat-b::foreign']); assert.ok(!renderBlockGrounding(gb).includes('Enlaces del carbono'))
assert.equal(gb.units[0].klass, 'FULL', 'mat-b p2 is authorized for mat-b')
assert.deepEqual(locateQuote(Q16, 'mat-q', new Set([1, 2, 3]), index), [], 'mat-b page 2 text is not mat-q page 2')
assert.deepEqual(locateQuote(Q16, 'mat-b', new Set([1, 2, 3]), index), [2])

// 13. A projected concept later becomes FULL: once the next block authorizes p16–17 it is taught in full, flagged as an upgrade.
const g2 = ground({ blockPages: range(16, 30), studiedPages: range(1, 15), taught: { 'mat-q::straddle': 'PROJECTED', 'mat-q::full': 'FULL' } })
const up = g2.units.find(u => u.unitRef === 'mat-q::straddle')!
assert.equal(up.klass, 'FULL'); assert.equal(up.upgraded, true); assert.ok(up.text.includes('SYNTH-STRADDLE'), 'now that all its pages are authorized the full text may be used')
assert.ok(g2.units.some(u => u.unitRef === 'mat-q::falsepage') && !g2.units.some(u => u.unitRef === 'mat-q::full'), 'deferred units come back; FULL-taught units do not repeat')
assert.ok(renderBlockGrounding(g2).includes('(now complete)'))
// an already-taught projected unit that is still only projected is not re-taught
assert.ok(!ground({ taught: { 'mat-q::straddle': 'PROJECTED' } }).units.some(u => u.unitRef === 'mat-q::straddle'))

// 14. The canonical Enjoyer payload is never mutated.
assert.equal(JSON.stringify(payload), frozen, 'read-only projection')

// 15. Fail closed: wrong fingerprint, foreign material.
assert.throws(() => extractRawUnits({ blueprint: { ...payload.blueprint, sourceSelectionFingerprint: 'other' } }, selection), /SOURCE_SELECTION_MISMATCH/)
assert.throws(() => extractRawUnits({ blueprint: { ...payload.blueprint, globalOrderedAnalysis: [...items, unit('sixth', { materialId: 'mat-SIXTH' })] } }, selection), /SOURCE_SELECTION_MISMATCH/, 'a sixth/foreign material never enters a batch')

// 16. Unicode: Chinese/Spanish/English evidence is located and rendered intact.
const ZH1 = '光合作用将光能转化为化学能并储存在糖类中'; const ZH2 = '叶绿素吸收光并推动电子传递过程产生氧气'
const zhSel = buildSourceSelectionSnapshot(['mat-zh'], { 'mat-zh': range(1, 4) })
const zhIndex = buildPageTextIndex(buildSourceIndex(zhSel.fingerprint, [{ materialId: 'mat-zh', materialName: '光', kind: 'pdf', rawText: [pageText(1, `${ZH1}。`), pageText(2, `${ZH2}。`), pageText(3, '未来页面 FUTURE3')].join('\n\n'), selectedPages: range(1, 4) }]))
const zhPayload = { blueprint: { sourceSelectionFingerprint: zhSel.fingerprint, materialIds: ['mat-zh'], selectedPages: zhSel.selectedPages, topicsIndex: [], globalOrderedAnalysis: [
  { id: 'z', kind: 'concept', label: '光合作用', summary: '摘要 SYNTH-ZH 第三页', materialId: 'mat-zh', pages: [1, 2, 3], sourceSpans: [{ page: 3, quote: ZH1 }, { page: 3, quote: ZH2 }], globalOrder: 0 }] } }
const zh = extractRawUnits(zhPayload, zhSel)
const zg = buildBlockGrounding({ units: zh.units, topics: zh.topics, pageIndex: zhIndex, materialId: 'mat-zh', blockPages: [1, 2], studiedPages: [], taught: {}, deferred: [] })
assert.equal(zg.units[0].klass, 'PROJECTED', 'CJK evidence clears the sufficiency floor'); const zp = renderBlockGrounding(zg)
assert.ok(zp.includes(ZH1) && zp.includes('光合作用') && !zp.includes('SYNTH-ZH') && !zp.includes('FUTURE3'))
console.log('PASS page-study-grounding: FULL/PROJECTED/DEFER, false span pages, repeated & future-only quotes, summary/title/relation leaks, visual pages, same page in two PDFs, projected→FULL, read-only, Unicode')
