import assert from 'node:assert/strict'

// ============================================================
// Material Brain P0 repair — "no silent academic content loss".
//
// Covers the mandatory test groups from the P0 mission:
//   A. >12 valid academic segments -> no silent loss
//   B. fallback completeness -> every segment represented OR explicit loss
//   C. notation-positive equivalence (provenance)
//   D. notation-negative/adversarial equivalence (provenance)
//   E. retry exhaustion / capacity ceiling -> loss cannot become false-lossless
//   F. academic stability -> a Brain with unresolved loss is measurably
//      distinguishable from a truly lossless fallback Brain
//   G. fallback-origin propagation
//   H. merge semantics -> rich/fallback consolidation stays truthful
// ============================================================

import { buildDeterministicFallbackExtraction } from '../../lib/materialBrain/deterministicFallback'
import { buildMaterialBrain, computeContentLoss } from '../../lib/materialBrain/build'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { canonicalizeNotation, notationEquivalent } from '../../lib/materialBrain/provenanceNotation'
import { quoteExistsInSource } from '../../lib/materialBrain/provenanceValidation'
import type { PageChunk, ResolvedSourceMaterial } from '../../lib/materialBrain/types'
import type { ChunkExtractionResult } from '../../lib/materialBrain/extraction'

let passed = 0
let failed = 0

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    console.log('  ✅ ' + name)
    passed++
  } catch (err: any) {
    console.log('  ❌ ' + name)
    console.log('     ' + (err?.message || err))
    failed++
  }
}

function scopeFor(materialIds: string[]) {
  return buildSourceSelectionSnapshot(materialIds, {})
}

function chunk(id: string, text: string): PageChunk {
  return { id, materialId: 'mat_p0', pages: [1], order: 0, text }
}

// 16 distinct, real academic sentences (equilibrium-chemistry flavored,
// generalized — not hardcoded to the real PDF) — all >= 20 chars, all
// sentence-like, none matching the non-academic filter.
const SIXTEEN_SENTENCES = [
  'La reaccion alcanza el equilibrio quimico cuando las velocidades se igualan.',
  'La constante de equilibrio Kc describe la proporcion de productos y reactivos.',
  'El principio de Le Chatelier predice el desplazamiento del equilibrio.',
  'Un catalizador acelera la reaccion directa e inversa por igual.',
  'La temperatura afecta el valor numerico de la constante de equilibrio.',
  'La presion parcial de un gas se relaciona con la constante Kp.',
  'El cociente de reaccion Q se compara con Kc para predecir el sentido del cambio.',
  'Las concentraciones de solidos puros no aparecen en la expresion de equilibrio.',
  'Un aumento de la concentracion de reactivos desplaza el equilibrio hacia productos.',
  'La entalpia de reaccion determina el efecto termico sobre el equilibrio.',
  'El equilibrio heterogeneo involucra mas de una fase distinta.',
  'La ecuacion de Vant Hoff relaciona Kc con la temperatura absoluta.',
  'El grado de disociacion mide la fraccion de reactivo convertido.',
  'La solubilidad de una sal depende de su producto de solubilidad Ksp.',
  'El pH de una disolucion tampon se calcula con Henderson Hasselbalch.',
  'La fuerza ionica afecta los coeficientes de actividad en disolucion.',
]

async function run() {
  console.log('\n=== A. >12 academic segments: no silent loss ===')

  await test('A1: 16-sentence leaf produces 16 fallback units, not capped at 12', () => {
    const text = '[Pagina 1]\n' + SIXTEEN_SENTENCES.join(' ')
    const result = buildDeterministicFallbackExtraction(chunk('c_a1', text))
    assert.equal(result.units.length, 16, `expected all 16 sentences represented, got ${result.units.length}`)
    assert.equal(result.droppedStructural, 0, 'no ceiling was hit — must report zero loss, not fabricate any')
  })

  await test('A2: every one of the 16 source sentences is verbatim-traceable in the output', () => {
    const text = '[Pagina 1]\n' + SIXTEEN_SENTENCES.join(' ')
    const result = buildDeterministicFallbackExtraction(chunk('c_a2', text))
    const statements = new Set(result.units.map(u => u.statement))
    for (const sentence of SIXTEEN_SENTENCES) {
      assert.ok(statements.has(sentence), `missing sentence: "${sentence}"`)
    }
  })

  console.log('\n=== B. fallback completeness / paratext filtering ===')

  await test('B1: headers/page-number artifacts do not become fallback units, real content does', () => {
    const text = '[Pagina 1]\nCapitulo 3\n42\nLa energia libre de Gibbs determina la espontaneidad de una reaccion quimica dada.'
    const result = buildDeterministicFallbackExtraction(chunk('c_b1', text))
    assert.ok(result.units.some(u => u.statement.includes('energia libre de Gibbs')), 'real sentence must survive')
    assert.ok(!result.units.some(u => u.statement.trim() === '42'), 'a bare page-number-like fragment must not become a unit')
  })

  await test('B2: legitimate short-but-real academic content is NOT aggressively filtered', () => {
    const text = '[Pagina 1]\nEl pH mide la acidez de una disolucion acuosa de forma cuantitativa.'
    const result = buildDeterministicFallbackExtraction(chunk('c_b2', text))
    assert.equal(result.units.length, 1)
    assert.equal(result.droppedStructural, 0)
  })

  console.log('\n=== C. notation-positive equivalence ===')

  await test('C1: NO2 unicode subscript == NO_2 ASCII', () => {
    assert.ok(notationEquivalent('NO₂', 'NO_2'))
  })
  await test('C2: N2O4 unicode subscript == N_2O_4 ASCII', () => {
    assert.ok(notationEquivalent('N₂O₄', 'N_2O_4'))
  })
  await test('C3: H2 unicode subscript == H_2 ASCII', () => {
    assert.ok(notationEquivalent('H₂', 'H_2'))
  })
  await test('C4: x^2 unicode superscript == x^2 ASCII', () => {
    assert.ok(notationEquivalent('x²', 'x^2'))
  })
  await test('C5: x_1 unicode subscript == x_1 ASCII', () => {
    assert.ok(notationEquivalent('x₁', 'x_1'))
  })
  await test('C6: quoteExistsInSource accepts a unicode-subscript quote against an ASCII-notation source', () => {
    const source = '[Pagina 1]\nLa formacion de N_2O_4 a partir de NO_2 es un equilibrio clasico.'
    assert.ok(quoteExistsInSource(source, 'La formacion de N₂O₄ a partir de NO₂ es un equilibrio clasico.'))
  })
  await test('C7: quoteExistsInSource accepts an ASCII-notation quote against a unicode-subscript source', () => {
    const source = '[Pagina 1]\nLa concentracion de NO₂ disminuye mientras aumenta N₂O₄ en el sistema.'
    assert.ok(quoteExistsInSource(source, 'La concentracion de NO_2 disminuye mientras aumenta N_2O_4 en el sistema.'))
  })

  console.log('\n=== D. notation-negative / adversarial equivalence ===')

  await test('D1: NO2 != NO3 (different digit must never be conflated)', () => {
    assert.ok(!notationEquivalent('NO₂', 'NO₃'))
  })
  await test('D2: N2O4 != N2O5', () => {
    assert.ok(!notationEquivalent('N₂O₄', 'N₂O₅'))
  })
  await test('D3: H2 != H', () => {
    assert.ok(!notationEquivalent('H₂', 'H'))
  })
  await test('D4: x^2 != x^3', () => {
    assert.ok(!notationEquivalent('x²', 'x³'))
  })
  await test('D5: x_1 != x_2', () => {
    assert.ok(!notationEquivalent('x₁', 'x₂'))
  })
  await test('D6: 2NO2 != 3NO2 (leading coefficient must survive)', () => {
    assert.ok(!notationEquivalent('2NO₂', '3NO₂'))
  })
  await test('D7: Kc != Kp', () => {
    assert.ok(!notationEquivalent('Kc', 'Kp'))
  })
  await test('D8: + != - (including superscript charge signs)', () => {
    assert.ok(!notationEquivalent('+', '-'))
    assert.ok(!notationEquivalent('Na⁺', 'Na⁻'))
  })
  await test('D9: < != >', () => {
    assert.ok(!notationEquivalent('<', '>'))
  })
  await test('D10: reaction direction (arrow) changes are never equivalent', () => {
    assert.ok(!notationEquivalent('A → B', 'A ← B'))
  })
  await test('D11: canonicalizeNotation never touches plain ASCII letters/words/numbers', () => {
    const text = 'La velocidad de reaccion depende de 100 factores y aumenta con T.'
    assert.equal(canonicalizeNotation(text), text)
  })

  console.log('\n=== E. capacity ceiling: explicit, measurable, never falsely lossless ===')

  await test('E1: pathological leaf (250 academic sentences) hits the safety ceiling and reports real loss', () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      `El concepto numero ${i} describe una propiedad academica distinta del sistema en estudio.`)
    const text = '[Pagina 1]\n' + many.join(' ')
    const result = buildDeterministicFallbackExtraction(chunk('c_e1', text))
    assert.ok(result.units.length < 250, 'ceiling must actually bound unit count')
    assert.ok(result.droppedStructural > 0, 'ceiling hit MUST be reported as real structural loss, never silently zero')
    assert.equal(result.units.length + result.droppedStructural, 250,
      'every dropped segment must be accounted for: represented OR counted as loss, nothing unaccounted')
  })

  await test('E2: a leaf under the ceiling never reports fabricated loss', () => {
    const text = '[Pagina 1]\n' + SIXTEEN_SENTENCES.join(' ')
    const result = buildDeterministicFallbackExtraction(chunk('c_e2', text))
    assert.equal(result.droppedStructural, 0)
  })

  console.log('\n=== F. academic stability: lossy vs. truly-lossless fallback Brains are distinguishable ===')

  const LOSSLESS_MATERIAL: ResolvedSourceMaterial = {
    materialId: 'mat_f_lossless',
    nombre: 'Material sin perdida',
    kind: 'pdf',
    knownPages: [1],
    text: '[Pagina 1]\n' + SIXTEEN_SENTENCES.join(' '),
  }

  const alwaysFailExtractFn = async (c: PageChunk): Promise<{ extraction: ChunkExtractionResult }> => {
    const { createChunkTelemetry } = await import('../../lib/materialBrain/extractionTelemetry')
    return {
      extraction: {
        units: [], relations: [], droppedInvalidProvenance: 0, droppedStructural: 0,
        warnings: [`chunk ${c.id} falló extracción tras agotar reintentos: forced failure [class:deterministic-structural]`],
        telemetry: createChunkTelemetry(c.id, c.materialId, c.pages),
      },
    }
  }

  await test('F1: a truly-lossless real-build fallback Brain reports contentLoss.hasLoss === false', async () => {
    const scope = scopeFor([LOSSLESS_MATERIAL.materialId])
    const brain = await buildMaterialBrain(scope, [LOSSLESS_MATERIAL], { extractFn: alwaysFailExtractFn as any })
    assert.equal(brain.meta.brainEnrichment, 'degraded', 'rich always fails here, so this settles as a fallback-only degraded brain')
    assert.ok(brain.meta.contentLoss, 'contentLoss must be present')
    assert.equal(brain.meta.contentLoss!.hasLoss, false, 'no ceiling was hit — must be provably lossless')
    assert.equal(brain.meta.contentLoss!.affectedLeafIds.length, 0)
  })

  // computeContentLoss is exercised directly (rather than forcing a real
  // 250-sentence leaf through buildMaterialBrain) because production
  // chunking makes the capacity ceiling structurally unreachable through
  // the public API: DEFAULT_EXTRACTION_SUBCHUNK_CHARS (~1200 chars) with
  // MIN_SENTENCE_CHARS=20 bounds any single real leaf to well under 100
  // sentences, far below FALLBACK_UNIT_SAFETY_CEILING=200 — confirming the
  // ceiling is a pure defensive backstop, never a practical constraint on
  // real material. computeContentLoss is the exact pure function build.ts
  // calls with the real per-leaf checkpoints, so this is a direct contract
  // test of the aggregation itself, not a mock of unrelated behavior.
  await test('F2: computeContentLoss surfaces a ceiling-hit checkpoint as hasLoss=true with affected leaf ids', () => {
    const lossyLeaf = buildDeterministicFallbackExtraction(chunk('leaf_lossy', '[Pagina 1]\n'
      + Array.from({ length: 250 }, (_, i) => `El concepto numero ${i} describe una propiedad academica distinta del sistema.`).join(' ')))
    const cleanLeaf = buildDeterministicFallbackExtraction(chunk('leaf_clean', '[Pagina 1]\n' + SIXTEEN_SENTENCES.join(' ')))
    assert.ok(lossyLeaf.droppedStructural > 0, 'fixture sanity: this leaf must actually hit the ceiling')

    const result = computeContentLoss({
      leaf_lossy: { status: 'complete', sourceKind: 'text', usedDeterministicFallback: true, extraction: lossyLeaf },
      leaf_clean: { status: 'complete', sourceKind: 'text', usedDeterministicFallback: true, extraction: cleanLeaf },
    })
    assert.equal(result.hasLoss, true, 'ceiling loss must be surfaced, never hidden behind a generic ready/degraded status')
    assert.deepEqual(result.affectedLeafIds, ['leaf_lossy'])
    assert.equal(result.totalDroppedSegments, lossyLeaf.droppedStructural)
  })

  await test('F3: computeContentLoss over a fully-clean checkpoint set is provably hasLoss=false', () => {
    const cleanLeaf = buildDeterministicFallbackExtraction(chunk('leaf_clean', '[Pagina 1]\n' + SIXTEEN_SENTENCES.join(' ')))
    const result = computeContentLoss({
      leaf_clean: { status: 'complete', sourceKind: 'text', usedDeterministicFallback: true, extraction: cleanLeaf },
    })
    assert.equal(result.hasLoss, false)
    assert.equal(result.totalDroppedSegments, 0)
  })

  console.log('\n=== G. fallback-origin propagation ===')

  await test('G1: a fallback-only unit carries origin "fallback"', async () => {
    const scope = scopeFor([LOSSLESS_MATERIAL.materialId])
    const brain = await buildMaterialBrain(scope, [LOSSLESS_MATERIAL], { extractFn: alwaysFailExtractFn as any })
    assert.ok(brain.units.length > 0)
    assert.ok(brain.units.every(u => u.origin === 'fallback'), 'every unit in an always-fails-rich brain must be fallback-origin')
  })

  await test('G2: a rich-extracted unit carries origin "rich" (undefined origin on the raw unit -> rich)', async () => {
    const material: ResolvedSourceMaterial = {
      materialId: 'mat_g2', nombre: 'Rico', kind: 'pdf', knownPages: [1],
      text: '[Pagina 1]\nLa ley de Boyle relaciona presion y volumen a temperatura constante en un gas ideal.',
    }
    const richExtractFn = async (c: PageChunk): Promise<{ extraction: ChunkExtractionResult }> => {
      const { createChunkTelemetry } = await import('../../lib/materialBrain/extractionTelemetry')
      return {
        extraction: {
          units: [{
            kind: 'concept', canonicalSubject: 'Ley de Boyle', qualifiers: [], label: 'Ley de Boyle',
            statement: 'La presión y el volumen de un gas ideal son inversamente proporcionales.',
            quote: 'La ley de Boyle relaciona presion y volumen a temperatura constante en un gas ideal',
            page: c.pages[0], domainTags: ['física'], modelSuggestedTier: 'critical',
          }],
          relations: [], warnings: [], droppedInvalidProvenance: 0, droppedStructural: 0,
          telemetry: createChunkTelemetry(c.id, c.materialId, c.pages),
        },
      }
    }
    const scope = scopeFor([material.materialId])
    const brain = await buildMaterialBrain(scope, [material], { extractFn: richExtractFn as any })
    assert.equal(brain.units.length, 1)
    assert.equal(brain.units[0].origin, 'rich')
  })

  console.log('\n=== H. merge semantics: origin stays truthful across consolidation ===')

  await test('H1: two candidates with the same identity, one rich one fallback, merge into origin "mixed"', async () => {
    const { mergeExtractions } = await import('../../lib/materialBrain/merge')
    const c1 = chunk('c_h1a', '[Pagina 1]\nLa entropia mide el desorden de un sistema termodinamico aislado.')
    const c2 = chunk('c_h1b', '[Pagina 1]\nLa entropia mide el desorden de un sistema termodinamico aislado.')
    const richExtraction: ChunkExtractionResult = {
      units: [{
        kind: 'concept', canonicalSubject: 'Entropia', qualifiers: [], label: 'Entropia',
        statement: 'La entropía mide el desorden de un sistema.',
        quote: 'La entropia mide el desorden de un sistema termodinamico aislado',
        page: 1, domainTags: [], modelSuggestedTier: 'critical',
      }],
      relations: [], warnings: [], droppedInvalidProvenance: 0, droppedStructural: 0,
    }
    const fallbackExtraction: ChunkExtractionResult = {
      units: [{
        kind: 'concept', canonicalSubject: 'Entropia', qualifiers: [], label: 'Entropia',
        statement: 'La entropia mide el desorden de un sistema termodinamico aislado.',
        quote: 'La entropia mide el desorden de un sistema termodinamico aislado.',
        page: 1, domainTags: [], modelSuggestedTier: null, origin: 'fallback',
      }],
      relations: [], warnings: [], droppedInvalidProvenance: 0, droppedStructural: 0,
    }
    const result = mergeExtractions([{ chunk: c1, extraction: richExtraction }, { chunk: c2, extraction: fallbackExtraction }])
    assert.equal(result.units.length, 1, 'identical identity must still merge into one unit')
    assert.equal(result.units[0].origin, 'mixed', 'a rich+fallback merge must be truthfully labeled mixed, never silently either origin alone')
  })

  await test('H2: two fallback-only candidates merging stay origin "fallback" (not falsely upgraded to rich)', async () => {
    const { mergeExtractions } = await import('../../lib/materialBrain/merge')
    const c1 = chunk('c_h2a', '[Pagina 1]\nLa viscosidad de un fluido depende fuertemente de la temperatura.')
    const c2 = chunk('c_h2b', '[Pagina 1]\nLa viscosidad de un fluido depende fuertemente de la temperatura.')
    const mkFallback = (): ChunkExtractionResult => ({
      units: [{
        kind: 'fact', canonicalSubject: 'Viscosidad', qualifiers: [], label: 'Viscosidad',
        statement: 'La viscosidad de un fluido depende fuertemente de la temperatura.',
        quote: 'La viscosidad de un fluido depende fuertemente de la temperatura.',
        page: 1, domainTags: [], modelSuggestedTier: null, origin: 'fallback',
      }],
      relations: [], warnings: [], droppedInvalidProvenance: 0, droppedStructural: 0,
    })
    const result = mergeExtractions([{ chunk: c1, extraction: mkFallback() }, { chunk: c2, extraction: mkFallback() }])
    assert.equal(result.units.length, 1)
    assert.equal(result.units[0].origin, 'fallback')
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

run()
