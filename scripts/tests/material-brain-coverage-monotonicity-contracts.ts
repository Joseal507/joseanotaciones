import assert from 'node:assert/strict'

// ============================================================
// Material Brain — coverage-monotonicity contracts (P0 mission:
// "enrichment must never silently reduce coverage").
//
// Root cause: a rich extraction that is individually VALID (zero
// structural/provenance loss on the units it returns) is NOT thereby
// guaranteed EXHAUSTIVE. Before this fix, build.ts's enrichment path
// let ANY successful rich checkpoint unconditionally REPLACE the
// fallback checkpoint it upgrades — with no check that the rich
// response covers what the fallback already proved existed. This is
// the mechanism behind unitsCount dropping (125 -> 104 -> 89 -> 81 in
// the real 43-page material) even on leaves reported as successfully
// "upgraded". Fixed in build.ts via coverageMerge.ts's
// mergeRichWithFallbackCoverage.
//
// These tests deliberately do NOT assert on unitsCount alone (a
// legitimate consolidation can and should reduce it) — they assert a
// COVERAGE contract: every original fallback sentence must remain
// REPRESENTED (verbatim survival OR demonstrable token-overlap
// coverage by a surviving unit) after any number of enrichment passes.
// ============================================================

import { buildMaterialBrain } from '../../lib/materialBrain/build'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import type { PageChunk, ResolvedSourceMaterial, MaterialBrain, KnowledgeUnit } from '../../lib/materialBrain/types'
import type { ChunkExtractionResult } from '../../lib/materialBrain/extraction'
import { createChunkTelemetry } from '../../lib/materialBrain/extractionTelemetry'

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

// Independent re-implementation (not a call into production code) of
// "is this original sentence still represented" — verbatim survival OR
// token-overlap coverage by some surviving unit's statement/quotes.
function sentenceRepresented(sentence: string, units: KnowledgeUnit[]): boolean {
  const norm = sentence.trim()
  if (units.some(u => u.statement.trim() === norm)) return true
  const sentenceTokens = new Set(norm.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
  if (sentenceTokens.size === 0) return true
  for (const u of units) {
    const text = `${u.statement} ${u.provenance.map(p => p.quote).join(' ')}`.toLowerCase()
    const tokens = new Set(text.match(/[\p{L}\p{N}]+/gu) || [])
    let overlap = 0
    for (const t of sentenceTokens) if (tokens.has(t)) overlap++
    if (sentenceTokens.size > 0 && overlap / sentenceTokens.size >= 0.6) return true
  }
  return false
}

function allSentencesRepresented(sentences: string[], brain: MaterialBrain): string[] {
  return sentences.filter(s => !sentenceRepresented(s, brain.units))
}

const SENTENCES_LEAF_A = [
  'La reaccion alcanza el equilibrio quimico cuando las velocidades se igualan.',
  'La constante de equilibrio Kc describe la proporcion de productos y reactivos.',
  'El principio de Le Chatelier predice el desplazamiento del equilibrio.',
  'Un catalizador acelera la reaccion directa e inversa por igual.',
]
const SENTENCES_LEAF_B = [
  'La entalpia de reaccion determina el efecto termico sobre el equilibrio.',
  'El grado de disociacion mide la fraccion de reactivo convertido.',
  'La solubilidad de una sal depende de su producto de solubilidad Ksp.',
  'El pH de una disolucion tampon se calcula con Henderson Hasselbalch.',
]

const MATERIAL_ONE_LEAF: ResolvedSourceMaterial = {
  materialId: 'mat_cov_a', nombre: 'Un leaf', kind: 'pdf', knownPages: [1],
  text: '[Pagina 1]\n' + SENTENCES_LEAF_A.join(' '),
}
// Padded well past DEFAULT_EXTRACTION_SUBCHUNK_CHARS (~1200 chars) per
// page so chunking actually produces TWO distinct leaves instead of
// merging both small pages into one — real fixture-sanity requirement
// for tests that need to observe per-leaf partial-enrichment behavior.
const FILLER_A = ' Contenido de relleno academico adicional sobre equilibrio quimico para extender el fragmento de forma realista y forzar una hoja de extraccion separada.'.repeat(6)
const FILLER_B = ' Contenido de relleno academico adicional sobre termodinamica y solubilidad para extender el fragmento de forma realista y forzar una hoja de extraccion separada.'.repeat(6)
const MATERIAL_TWO_LEAVES: ResolvedSourceMaterial = {
  materialId: 'mat_cov_b', nombre: 'Dos leaves', kind: 'pdf', knownPages: [1, 2],
  text: '[Pagina 1]\n' + SENTENCES_LEAF_A.join(' ') + FILLER_A + '\n[Pagina 2]\n' + SENTENCES_LEAF_B.join(' ') + FILLER_B,
}

function mkExtraction(units: ChunkExtractionResult['units'], opts: Partial<ChunkExtractionResult> = {}): ChunkExtractionResult {
  return {
    units, relations: [], warnings: [], droppedInvalidProvenance: 0, droppedStructural: 0,
    telemetry: createChunkTelemetry('x', 'x', [1]),
    ...opts,
  }
}

async function run() {
  console.log('\n=== Coverage monotonicity contracts ===')

  await test('COV-1: a fully-covering rich leaf cleanly replaces the fallback (no supplementary units, no coverage_merge warning)', async () => {
    const scope = scopeFor([MATERIAL_ONE_LEAF.materialId])
    const base = await buildMaterialBrain(scope, [MATERIAL_ONE_LEAF], { skipRichExtraction: true })
    const fullCoverageFn = async (c: PageChunk) => ({
      extraction: mkExtraction([{
        kind: 'concept', canonicalSubject: 'Equilibrio quimico', qualifiers: [], label: 'Equilibrio quimico',
        statement: 'El equilibrio quimico y su constante Kc, el desplazamiento de Le Chatelier y el rol de un catalizador.',
        quote: SENTENCES_LEAF_A.join(' '), page: c.pages[0], domainTags: [], modelSuggestedTier: 'critical',
      }]),
    })
    const next = await buildMaterialBrain(scope, [MATERIAL_ONE_LEAF], { enrichmentPass: true, previousBrain: base, extractFn: fullCoverageFn as any })
    assert.equal(next.units.length, 1, 'rich cleanly replaces — no supplementary units needed')
    const checkpoint = Object.values(next.meta.subchunkCheckpoints || {})[0]
    assert.ok(!checkpoint.extraction.warnings.some(w => w.includes('coverage_merge')), 'no coverage_merge warning when fully covered')
    assert.deepEqual(allSentencesRepresented(SENTENCES_LEAF_A, next), [])
  })

  await test('COV-2: a structurally invalid rich attempt never eliminates the prior fallback content', async () => {
    const scope = scopeFor([MATERIAL_ONE_LEAF.materialId])
    const base = await buildMaterialBrain(scope, [MATERIAL_ONE_LEAF], { skipRichExtraction: true })
    const alwaysInvalidFn = async (c: PageChunk) => ({
      extraction: mkExtraction([], { warnings: [`chunk ${c.id} falló extracción tras agotar reintentos: bad [class:deterministic-structural]`] }),
    })
    const next = await buildMaterialBrain(scope, [MATERIAL_ONE_LEAF], { enrichmentPass: true, previousBrain: base, extractFn: alwaysInvalidFn as any })
    assert.deepEqual(allSentencesRepresented(SENTENCES_LEAF_A, next), [], 'all fallback content must survive an invalid rich attempt')
  })

  await test('COV-3: structuralLoss on the rich attempt does not reduce final coverage', async () => {
    const scope = scopeFor([MATERIAL_ONE_LEAF.materialId])
    const base = await buildMaterialBrain(scope, [MATERIAL_ONE_LEAF], { skipRichExtraction: true })
    const structuralLossFn = async (c: PageChunk) => ({
      extraction: mkExtraction([{
        kind: 'concept', canonicalSubject: 'X', qualifiers: [], label: 'X', statement: 'parcial',
        quote: SENTENCES_LEAF_A[0], page: c.pages[0], domainTags: [], modelSuggestedTier: null,
      }], { droppedStructural: 2 }),
    })
    const next = await buildMaterialBrain(scope, [MATERIAL_ONE_LEAF], { enrichmentPass: true, previousBrain: base, extractFn: structuralLossFn as any })
    assert.deepEqual(allSentencesRepresented(SENTENCES_LEAF_A, next), [], 'structuralLoss must route to retryable_failed, keeping the fallback intact')
  })

  await test('COV-4: provenanceLoss on the rich attempt does not eliminate source-ready information', async () => {
    const scope = scopeFor([MATERIAL_ONE_LEAF.materialId])
    const base = await buildMaterialBrain(scope, [MATERIAL_ONE_LEAF], { skipRichExtraction: true })
    const provenanceLossFn = async (c: PageChunk) => ({
      extraction: mkExtraction([{
        kind: 'concept', canonicalSubject: 'X', qualifiers: [], label: 'X', statement: 'parcial',
        quote: SENTENCES_LEAF_A[0], page: c.pages[0], domainTags: [], modelSuggestedTier: null,
      }], { droppedInvalidProvenance: 1 }),
    })
    const next = await buildMaterialBrain(scope, [MATERIAL_ONE_LEAF], { enrichmentPass: true, previousBrain: base, extractFn: provenanceLossFn as any })
    assert.deepEqual(allSentencesRepresented(SENTENCES_LEAF_A, next), [])
  })

  await test('COV-5: enrichment attempts per leaf are bounded — no growth in provider calls after the budget is spent', async () => {
    const scope = scopeFor([MATERIAL_ONE_LEAF.materialId])
    let calls = 0
    const countingFail = async (c: PageChunk) => { calls++; return { extraction: mkExtraction([], { warnings: [`chunk ${c.id} falló extracción tras agotar reintentos: bad [class:deterministic-structural]`] }) } }
    let brain = await buildMaterialBrain(scope, [MATERIAL_ONE_LEAF], { skipRichExtraction: true })
    for (let i = 0; i < 3; i++) {
      brain = await buildMaterialBrain(scope, [MATERIAL_ONE_LEAF], { enrichmentPass: true, previousBrain: brain, extractFn: countingFail as any })
    }
    const callsAfterBudgetSpent = calls
    await buildMaterialBrain(scope, [MATERIAL_ONE_LEAF], { enrichmentPass: true, previousBrain: brain, extractFn: countingFail as any })
    assert.equal(calls, callsAfterBudgetSpent, 'COV-5: a leaf that spent its full enrichment budget must never be re-attempted')
  })

  await test('COV-6: a permanently-failing leaf settles degraded while retaining all its content', async () => {
    const scope = scopeFor([MATERIAL_ONE_LEAF.materialId])
    const alwaysInvalidFn = async (c: PageChunk) => ({
      extraction: mkExtraction([], { warnings: [`chunk ${c.id} falló extracción tras agotar reintentos: bad [class:deterministic-structural]`] }),
    })
    let brain = await buildMaterialBrain(scope, [MATERIAL_ONE_LEAF], { skipRichExtraction: true })
    for (let i = 0; i < 4; i++) {
      brain = await buildMaterialBrain(scope, [MATERIAL_ONE_LEAF], { enrichmentPass: true, previousBrain: brain, extractFn: alwaysInvalidFn as any })
    }
    assert.equal(brain.meta.brainEnrichment, 'degraded')
    assert.deepEqual(allSentencesRepresented(SENTENCES_LEAF_A, brain), [])
  })

  await test('COV-7: partial enrichment (batch smaller than leaf count) preserves ALL original leaves\' content, upgraded or not', async () => {
    const scope = scopeFor([MATERIAL_TWO_LEAVES.materialId])
    const base = await buildMaterialBrain(scope, [MATERIAL_TWO_LEAVES], { skipRichExtraction: true })
    const leafCount = Object.keys(base.meta.subchunkCheckpoints || {}).length
    assert.ok(leafCount >= 2, 'fixture sanity: need at least 2 leaves')
    const fullCoverageFn = async (c: PageChunk) => ({
      extraction: mkExtraction([{
        kind: 'concept', canonicalSubject: c.id, qualifiers: [], label: c.id,
        statement: `Resumen enriquecido de ${c.id}`, quote: c.text.replace(/\[Pagina \d+\]\n?/, ''),
        page: c.pages[0], domainTags: [], modelSuggestedTier: 'critical',
      }]),
    })
    // batch size 1: only ONE leaf gets a real attempt this pass
    const next = await buildMaterialBrain(scope, [MATERIAL_TWO_LEAVES], { enrichmentPass: true, previousBrain: base, extractFn: fullCoverageFn as any, enrichmentBatchSize: 1 })
    assert.deepEqual(allSentencesRepresented([...SENTENCES_LEAF_A, ...SENTENCES_LEAF_B], next), [],
      'both the upgraded leaf and the still-fallback leaf must remain fully represented')
  })

  await test('COV-8: unitsCount may legitimately decrease via consolidation, but zero original sentences become unrepresented', async () => {
    const scope = scopeFor([MATERIAL_ONE_LEAF.materialId])
    const base = await buildMaterialBrain(scope, [MATERIAL_ONE_LEAF], { skipRichExtraction: true })
    const fallbackUnitCount = base.units.length
    assert.equal(fallbackUnitCount, SENTENCES_LEAF_A.length)
    const consolidatingFn = async (c: PageChunk) => ({
      extraction: mkExtraction([{
        kind: 'concept', canonicalSubject: 'Equilibrio', qualifiers: [], label: 'Equilibrio quimico completo',
        statement: 'Consolidacion de equilibrio, Kc, Le Chatelier y catalizador.',
        quote: SENTENCES_LEAF_A.join(' '), page: c.pages[0], domainTags: [], modelSuggestedTier: 'critical',
      }]),
    })
    const next = await buildMaterialBrain(scope, [MATERIAL_ONE_LEAF], { enrichmentPass: true, previousBrain: base, extractFn: consolidatingFn as any })
    assert.ok(next.units.length < fallbackUnitCount, 'legitimate consolidation: fewer units than fallback')
    assert.deepEqual(allSentencesRepresented(SENTENCES_LEAF_A, next), [], 'but every original sentence stays represented')
  })

  await test('COV-9: resuming enrichment from persistence accumulates coverage across leaves, never loses prior leaves\' units', async () => {
    const scope = scopeFor([MATERIAL_TWO_LEAVES.materialId])
    const base = await buildMaterialBrain(scope, [MATERIAL_TWO_LEAVES], { skipRichExtraction: true })
    const fullCoverageFn = async (c: PageChunk) => ({
      extraction: mkExtraction([{
        kind: 'concept', canonicalSubject: c.id, qualifiers: [], label: c.id,
        statement: `Resumen enriquecido de ${c.id}`, quote: c.text.replace(/\[Pagina \d+\]\n?/, ''),
        page: c.pages[0], domainTags: [], modelSuggestedTier: 'critical',
      }]),
    })
    // Pass 1: only leaf 1 upgrades (batch size 1)
    const pass1 = await buildMaterialBrain(scope, [MATERIAL_TWO_LEAVES], { enrichmentPass: true, previousBrain: base, extractFn: fullCoverageFn as any, enrichmentBatchSize: 1 })
    // Pass 2 ("continuation from persistence"): fresh build call with pass1 as previousBrain
    const pass2 = await buildMaterialBrain(scope, [MATERIAL_TWO_LEAVES], { enrichmentPass: true, previousBrain: pass1, extractFn: fullCoverageFn as any, enrichmentBatchSize: 1 })
    assert.deepEqual(allSentencesRepresented([...SENTENCES_LEAF_A, ...SENTENCES_LEAF_B], pass2), [],
      'both leaves must be represented after resuming across two separate build calls')
  })

  await test('COV-10: coverage is monotonic across multiple enrichment passes with a flaky provider (never regresses pass-to-pass)', async () => {
    const scope = scopeFor([MATERIAL_TWO_LEAVES.materialId])
    let attempt = 0
    const flakyFn = async (c: PageChunk) => {
      attempt++
      // Alternate between a partial-but-valid response and total failure —
      // simulates real provider variance across passes.
      if (attempt % 2 === 0) {
        return { extraction: mkExtraction([], { warnings: [`chunk ${c.id} falló extracción tras agotar reintentos: bad [class:deterministic-structural]`] }) }
      }
      return {
        extraction: mkExtraction([{
          kind: 'concept', canonicalSubject: c.id, qualifiers: [], label: c.id,
          statement: `Parcial de ${c.id}`, quote: c.text.replace(/\[Pagina \d+\]\n?/, '').split(' ').slice(0, 8).join(' '),
          page: c.pages[0], domainTags: [], modelSuggestedTier: 'supporting',
        }]),
      }
    }
    let brain = await buildMaterialBrain(scope, [MATERIAL_TWO_LEAVES], { skipRichExtraction: true })
    let prevMissing = allSentencesRepresented([...SENTENCES_LEAF_A, ...SENTENCES_LEAF_B], brain).length
    assert.equal(prevMissing, 0, 'fallback base must already be fully covering')
    for (let i = 0; i < 5; i++) {
      brain = await buildMaterialBrain(scope, [MATERIAL_TWO_LEAVES], { enrichmentPass: true, previousBrain: brain, extractFn: flakyFn as any, enrichmentBatchSize: 2 })
      const missingNow = allSentencesRepresented([...SENTENCES_LEAF_A, ...SENTENCES_LEAF_B], brain).length
      assert.ok(missingNow <= prevMissing, `coverage regressed at pass ${i}: missing went from ${prevMissing} to ${missingNow}`)
      prevMissing = missingNow
    }
    assert.equal(prevMissing, 0, 'coverage must remain complete through every pass')
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

run()
