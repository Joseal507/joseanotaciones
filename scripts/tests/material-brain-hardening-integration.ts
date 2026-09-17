import assert from 'node:assert/strict'

// ============================================================
// Tests de integración — Material Brain Hardening FIX 1/2/3
//
// FIX 1: extractChunkWithMockProvider demuestra que JSON truncado
//         atraviesa el CAMINO REAL de extraction.ts y recupera objetos.
//
// FIX 2: buildMaterialBrain produce knowledgeExtraction.telemetrySummary
//         con raw/accepted/rejected coherentes.
//
// FIX 3: buildMaterialBrain obedece retry classification:
//         A — transient → retry (2 llamadas)
//         B — deterministic-structural → no retry (1 llamada)
//         C — recoverable-format con objetos → no retry ciego
// ============================================================

import { extractChunkWithMockProvider } from '../../lib/materialBrain/extraction'
import { buildMaterialBrain } from '../../lib/materialBrain/build'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
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
    console.log('     ' + err.message)
    failed++
  }
}

// ─── Fixtures ────────────────────────────────────────────────

const SIMPLE_CHUNK: PageChunk = {
  id: 'c_fix1',
  materialId: 'mat_fix1',
  pages: [1, 2],
  order: 0,
  text: '[Pagina 1]\nEl ácido clorhídrico es un ácido fuerte que se disocia completamente.\n\n[Pagina 2]\nEl pH se calcula como el logaritmo negativo de la concentración de H+.',
}

const FORMULA_MATERIAL: ResolvedSourceMaterial = {
  materialId: 'mat_fix3',
  nombre: 'Segunda Ley de Newton',
  kind: 'pdf',
  knownPages: [1],
  text: '[Pagina 1]\nLa segunda ley de Newton establece que F = m·a, donde F es la fuerza en newtons, m es la masa en kilogramos y a es la aceleración en metros por segundo al cuadrado.',
}

function makeTruncatedLLMResponse(): string {
  return [
    '{',
    '  "units": [',
    '    {',
    '      "kind": "fact",',
    '      "canonicalSubject": "Ácido clorhídrico",',
    '      "qualifiers": [],',
    '      "label": "Ácido clorhídrico",',
    '      "statement": "El HCl se disocia completamente en agua.",',
    '      "quote": "El ácido clorhídrico es un ácido fuerte que se disocia completamente",',
    '      "page": 1,',
    '      "domainTags": ["química"],',
    '      "modelSuggestedTier": "critical"',
    '    },',
    '    {',
    '      "kind": "formula",',
    '      "canonicalSubject": "pH",',
    '      "qualifiers": [],',
    '      "label": "Cálculo de pH",',
    '      "statement": "pH = -log[H+].",',
    '      "quote": "El pH se calcula como el logaritmo negativo de la concentración de H+",',
    '      "page": 2,',
    '      "domainTags": ["química"],',
    '      "modelSuggestedTier": "critical"',
    '    },',
    '    {',
    '      "kind": "concept",',
    '      "canonicalSubject": "Constante de disociación",',
    '      "qualifiers": [],',
    '      "label": "Ka",',
    '      "statement": "Mide la fuerza relativa',
  ].join('\n')
  // Truncado aquí — objeto 3 incompleto
}

function makeValidLLMResponse(): string {
  return JSON.stringify({
    units: [
      {
        kind: 'fact',
        canonicalSubject: 'Ácido clorhídrico',
        qualifiers: [],
        label: 'Ácido clorhídrico',
        statement: 'El HCl se disocia completamente en agua.',
        quote: 'El ácido clorhídrico es un ácido fuerte que se disocia completamente',
        page: 1,
        domainTags: ['química'],
        modelSuggestedTier: 'critical',
      },
    ],
    relations: [],
  })
}

function scopeFor(materials: { materialId: string; pages?: number[] }[]) {
  const materialIds = materials.map(m => m.materialId)
  const selectedPages = Object.fromEntries(materials.map(m => [m.materialId, m.pages || []]))
  return buildSourceSelectionSnapshot(materialIds, selectedPages)
}

async function main() {
  // ─────────────────────────────────────────────────────────────
  // FIX 1 — JSON truncado atraviesa el camino real de extraction.ts
  // ─────────────────────────────────────────────────────────────
  console.log('\n── FIX 1: Integration seam — extractChunkWithMockProvider ──')

  await test('JSON válido completo: full_parse, sin recovery', async () => {
    const result = await extractChunkWithMockProvider(SIMPLE_CHUNK, makeValidLLMResponse())

    assert.ok(result.extraction.units.length >= 1, 'debe extraer al menos 1 unidad')
    assert.equal(result.extraction.telemetry?.recoveryStrategy, 'full_parse')
    assert.equal(result.extraction.telemetry?.wasRecovered, false)
    assert.equal(result.extraction.telemetry?.truncatedObjectsInResponse, 0)
  })

  await test('JSON truncado: recupera 2 completas, partial NO aparece', async () => {
    const result = await extractChunkWithMockProvider(SIMPLE_CHUNK, makeTruncatedLLMResponse())

    assert.ok(result.extraction.units.length >= 2,
      'debe recuperar al menos 2 unidades, got ' + result.extraction.units.length)

    const subjects = result.extraction.units.map(u => u.canonicalSubject)
    assert.ok(!subjects.includes('Constante de disociación'), 'objeto truncado NO debe aparecer')
    assert.ok(subjects.includes('Ácido clorhídrico'), 'unidad 1 completa debe aparecer')
    assert.ok(subjects.includes('pH'), 'unidad 2 completa debe aparecer')

    assert.equal(result.extraction.telemetry?.wasRecovered, true)
    assert.equal(result.extraction.telemetry?.recoveryStrategy, 'partial_recovery')
    assert.ok((result.extraction.telemetry?.truncatedObjectsInResponse ?? 0) >= 1)
  })

  await test('JSON truncado: provenance de unidades recuperadas sigue validándose', async () => {
    const result = await extractChunkWithMockProvider(SIMPLE_CHUNK, makeTruncatedLLMResponse())

    for (const unit of result.extraction.units) {
      assert.ok(SIMPLE_CHUNK.pages.includes(unit.page),
        'page ' + unit.page + ' debe estar en páginas del chunk')
      assert.ok(unit.quote.length > 0, 'quote no puede estar vacía')
    }
  })

  await test('JSON truncado: telemetry raw/accepted/rejected coherentes', async () => {
    const result = await extractChunkWithMockProvider(SIMPLE_CHUNK, makeTruncatedLLMResponse())
    const t = result.extraction.telemetry!

    assert.ok(t.rawUnits >= 2, 'rawUnits >= 2, got ' + t.rawUnits)
    assert.ok(t.acceptedUnits >= 2, 'acceptedUnits >= 2, got ' + t.acceptedUnits)
    assert.equal(
      t.acceptedUnits + t.rejectedUnits,
      t.rawUnits,
      'accepted + rejected === raw, got accepted=' + t.acceptedUnits +
      ' rejected=' + t.rejectedUnits + ' raw=' + t.rawUnits,
    )
  })

  await test('JSON truncado: wasRecovered===true en telemetry', async () => {
    const result = await extractChunkWithMockProvider(SIMPLE_CHUNK, makeTruncatedLLMResponse())
    assert.equal(result.extraction.telemetry?.wasRecovered, true)
  })

  // ─────────────────────────────────────────────────────────────
  // FIX 2 — MaterialBrain final contiene telemetrySummary auditable
  // ─────────────────────────────────────────────────────────────
  console.log('\n── FIX 2: telemetrySummary en knowledgeExtraction ──')

  await test('buildMaterialBrain produce telemetrySummary con campos requeridos', async () => {
    const scope = scopeFor([{ materialId: FORMULA_MATERIAL.materialId }])
    const { createChunkTelemetry, recordRejection } = await import('../../lib/materialBrain/extractionTelemetry')

    const mockExtractFn = async (chunk: PageChunk): Promise<{ extraction: ChunkExtractionResult }> => {
      const telemetry = createChunkTelemetry(chunk.id, chunk.materialId, chunk.pages)
      telemetry.rawUnits = 3
      telemetry.acceptedUnits = 2
      recordRejection(telemetry, 'invalid_kind', { kind: 'unknown', detail: 'test' })
      telemetry.rawRelations = 1
      telemetry.acceptedRelations = 1

      return {
        extraction: {
          units: [
            {
              kind: 'fact',
              canonicalSubject: 'Segunda ley de Newton',
              qualifiers: [],
              label: 'F=ma',
              statement: 'F = m·a.',
              quote: 'La segunda ley de Newton establece que F = m·a',
              page: chunk.pages[0],
              domainTags: ['física'],
              modelSuggestedTier: 'critical',
            },
            {
              kind: 'formula',
              canonicalSubject: 'Fuerza',
              qualifiers: [],
              label: 'F=ma',
              statement: 'La fuerza es masa por aceleración.',
              quote: 'F es la fuerza en newtons',
              page: chunk.pages[0],
              domainTags: ['física'],
              modelSuggestedTier: 'critical',
              expression: 'F = m·a',
              variables: [{ symbol: 'F', meaning: 'fuerza' }, { symbol: 'm', meaning: 'masa' }],
            },
          ],
          relations: [],
          warnings: [],
          // droppedStructural is intentionally 0 here: this test targets
          // telemetrySummary AGGREGATION math specifically (rawUnits vs
          // acceptedUnits vs rejectedUnits), not the retry/fallback
          // machinery — a >0 value would make the checkpoint retryable
          // and eventually deterministic-fallback-resolved, replacing
          // this mock's carefully-crafted telemetry with the fallback's
          // own numbers before this assertion ever sees it.
          droppedInvalidProvenance: 0,
          droppedStructural: 0,
          telemetry,
        },
      }
    }

    const brain = await buildMaterialBrain(scope, [FORMULA_MATERIAL], { extractFn: mockExtractFn as any })
    const summary = brain.knowledgeExtraction.telemetrySummary

    assert.ok(summary, 'telemetrySummary debe estar presente')
    assert.equal(summary.rawUnits, 3)
    assert.equal(summary.acceptedUnits, 2)
    assert.equal(summary.rejectedUnits, 1)
    assert.equal(summary.rawUnits, summary.acceptedUnits + summary.rejectedUnits,
      'rawUnits === accepted + rejected')
    assert.ok('invalid_kind' in summary.rejectionReasons)
    assert.equal(summary.rejectionReasons['invalid_kind'], 1)
  })

  await test('telemetrySummary invariante rawUnits === acceptedUnits + rejectedUnits', async () => {
    const scope = scopeFor([{ materialId: FORMULA_MATERIAL.materialId }])
    const { createChunkTelemetry, recordRejection } = await import('../../lib/materialBrain/extractionTelemetry')

    const mockExtractFn = async (chunk: PageChunk): Promise<{ extraction: ChunkExtractionResult }> => {
      const telemetry = createChunkTelemetry(chunk.id, chunk.materialId, chunk.pages)
      telemetry.rawUnits = 5
      telemetry.acceptedUnits = 3
      recordRejection(telemetry, 'quote_not_in_source', { canonicalSubject: 'X' })
      recordRejection(telemetry, 'malformed_unit', { detail: 'test' })

      return {
        extraction: {
          units: [{
            kind: 'fact',
            canonicalSubject: 'Segunda ley de Newton',
            qualifiers: [],
            label: 'F=ma',
            statement: 'F = m·a.',
            quote: 'La segunda ley de Newton establece que F = m·a',
            page: chunk.pages[0],
            domainTags: ['física'],
            modelSuggestedTier: 'critical',
          }],
          relations: [],
          warnings: [],
          droppedInvalidProvenance: 1,
          droppedStructural: 1,
          telemetry,
        },
      }
    }

    const brain = await buildMaterialBrain(scope, [FORMULA_MATERIAL], { extractFn: mockExtractFn as any })
    const summary = brain.knowledgeExtraction.telemetrySummary!

    assert.equal(
      summary.rawUnits,
      summary.acceptedUnits + summary.rejectedUnits,
      'invariante fallida: raw=' + summary.rawUnits +
      ' accepted=' + summary.acceptedUnits +
      ' rejected=' + summary.rejectedUnits,
    )
  })

  // ─────────────────────────────────────────────────────────────
  // FIX 3 — buildMaterialBrain obedece retry classification
  // ─────────────────────────────────────────────────────────────
  console.log('\n── FIX 3: Retry classification en buildMaterialBrain ──')

  await test('CASO A — transient: extractor llamado 2 veces (falla 1, éxito 2)', async () => {
    const scope = scopeFor([{ materialId: FORMULA_MATERIAL.materialId }])
    let callCount = 0

    const flakyTransientFn = async (chunk: PageChunk): Promise<{ extraction: ChunkExtractionResult }> => {
      callCount++
      if (callCount === 1) {
        return {
          extraction: {
            units: [],
            relations: [],
            warnings: ['chunk ' + chunk.id + ' falló extracción tras agotar reintentos: 503 Service Unavailable [class:transient]'],
            droppedInvalidProvenance: 0,
            droppedStructural: 0,
          },
        }
      }
      return {
        extraction: {
          units: [{
            kind: 'fact',
            canonicalSubject: 'Segunda ley de Newton',
            qualifiers: [],
            label: 'F=ma',
            statement: 'F = m·a.',
            quote: 'La segunda ley de Newton establece que F = m·a',
            page: chunk.pages[0],
            domainTags: ['física'],
            modelSuggestedTier: 'critical',
          }],
          relations: [],
          warnings: [],
          droppedInvalidProvenance: 0,
          droppedStructural: 0,
        },
      }
    }

    const brain = await buildMaterialBrain(scope, [FORMULA_MATERIAL], {
      extractFn: flakyTransientFn as any,
      maxDirectedRetries: 2,
    })

    assert.equal(callCount, 2,
      'transient debe llamar al extractor 2 veces, got ' + callCount)
    assert.equal(brain.meta.status, 'ready')
    assert.equal(brain.sourceCoverage.missing.length, 0)
    assert.ok(brain.units.length > 0)
    assert.ok(brain.meta.retries >= 1)
  })

  await test('CASO B — deterministic-structural: extractor llamado EXACTAMENTE 1 vez', async () => {
    const scope = scopeFor([{ materialId: FORMULA_MATERIAL.materialId }])
    let callCount = 0

    const structuralFailFn = async (chunk: PageChunk): Promise<{ extraction: ChunkExtractionResult }> => {
      callCount++
      return {
        extraction: {
          units: [],
          relations: [],
          warnings: ['chunk ' + chunk.id + ' falló extracción tras agotar reintentos: STRUCTURAL_VALIDATION_FAILED:no_units_survived_validation [class:deterministic-structural]'],
          droppedInvalidProvenance: 0,
          droppedStructural: 0,
        },
      }
    }

    const brain = await buildMaterialBrain(scope, [FORMULA_MATERIAL], {
      extractFn: structuralFailFn as any,
      maxDirectedRetries: 3,
    })

    assert.equal(callCount, 1,
      'deterministic-structural debe llamar al extractor EXACTAMENTE 1 vez, got ' + callCount)
    assert.equal(brain.meta.retries, 0,
      'no debe registrar retries, got ' + brain.meta.retries)
    // P0 resilience fix: a deterministic-structural (terminal) chunk no
    // longer blocks READY — the deterministic exact-source fallback
    // resolves it (retrying the identical malformed request would be
    // pointless), so the material still reaches ready.
    assert.equal(brain.meta.status, 'ready')
    const checkpoint = Object.values(brain.meta.chunkCheckpoints || {})[0]
    assert.equal(checkpoint?.usedDeterministicFallback, true)
  })

  await test('CASO C — recoverable-format parcial: retry dirigido hasta respuesta completa', async () => {
    const scope = scopeFor([{ materialId: FORMULA_MATERIAL.materialId }])
    let callCount = 0
    const { createChunkTelemetry } = await import('../../lib/materialBrain/extractionTelemetry')

    const recoveredFormatFn = async (chunk: PageChunk): Promise<{ extraction: ChunkExtractionResult }> => {
      callCount++
      const telemetry = createChunkTelemetry(chunk.id, chunk.materialId, chunk.pages)
      if (callCount > 1) {
        return {
          extraction: {
            units: [{
              kind: 'fact', canonicalSubject: 'Segunda ley de Newton', qualifiers: [], label: 'F=ma',
              statement: 'F = m·a.', quote: 'La segunda ley de Newton establece que F = m·a',
              page: chunk.pages[0], domainTags: ['física'], modelSuggestedTier: 'critical',
            }],
            relations: [], warnings: [], droppedInvalidProvenance: 0, droppedStructural: 0, telemetry,
          },
        }
      }
      telemetry.wasRecovered = true
      telemetry.recoveryStrategy = 'partial_recovery'
      telemetry.truncatedObjectsInResponse = 1
      telemetry.rawUnits = 2
      telemetry.acceptedUnits = 2

      return {
        extraction: {
          units: [{
            kind: 'fact',
            canonicalSubject: 'Segunda ley de Newton',
            qualifiers: [],
            label: 'F=ma',
            statement: 'F = m·a.',
            quote: 'La segunda ley de Newton establece que F = m·a',
            page: chunk.pages[0],
            domainTags: ['física'],
            modelSuggestedTier: 'critical',
          }],
          relations: [],
          warnings: ['chunk ' + chunk.id + ': respuesta LLM truncada — recovery parcial aplicado, 1 objeto(s) incompleto(s) descartado(s)'],
          droppedInvalidProvenance: 0,
          droppedStructural: 0,
          telemetry,
        },
      }
    }

    const brain = await buildMaterialBrain(scope, [FORMULA_MATERIAL], {
      extractFn: recoveredFormatFn as any,
      maxDirectedRetries: 3,
    })

    assert.equal(callCount, 2,
      'recoverable-format parcial debe reintentar solo el chunk afectado, got ' + callCount)
    assert.equal(brain.meta.status, 'ready')
    assert.ok(brain.units.length > 0)
    assert.equal(brain.meta.retries, 1)
  })

  await test('CASO C — telemetry del brain refleja recovery', async () => {
    const scope = scopeFor([{ materialId: FORMULA_MATERIAL.materialId }])
    const { createChunkTelemetry } = await import('../../lib/materialBrain/extractionTelemetry')

    const recoveredFormatFn = async (chunk: PageChunk): Promise<{ extraction: ChunkExtractionResult }> => {
      const telemetry = createChunkTelemetry(chunk.id, chunk.materialId, chunk.pages)
      telemetry.wasRecovered = true
      telemetry.recoveryStrategy = 'partial_recovery'
      telemetry.truncatedObjectsInResponse = 2
      telemetry.rawUnits = 2
      telemetry.acceptedUnits = 2

      return {
        extraction: {
          units: [{
            kind: 'fact',
            canonicalSubject: 'Segunda ley de Newton',
            qualifiers: [],
            label: 'F=ma',
            statement: 'F = m·a.',
            quote: 'La segunda ley de Newton establece que F = m·a',
            page: chunk.pages[0],
            domainTags: ['física'],
            modelSuggestedTier: 'critical',
          }],
          relations: [],
          warnings: [],
          droppedInvalidProvenance: 0,
          droppedStructural: 0,
          telemetry,
        },
      }
    }

    const brain = await buildMaterialBrain(scope, [FORMULA_MATERIAL], {
      extractFn: recoveredFormatFn as any,
    })

    const summary = brain.knowledgeExtraction.telemetrySummary
    assert.ok(summary, 'telemetrySummary debe existir')
    assert.equal(summary.recoveredChunks, 1)
    assert.equal(summary.truncatedObjects, 2)
  })

  // ─────────────────────────────────────────────────────────────
  // CASO D — live-evidence regression: persistent PARTIAL structural
  // loss (some units accepted, some rejected, IDENTICALLY on every
  // attempt — never converging to zero loss, unlike CASO A/C's
  // transient/recoverable cases). Reproduces the real CLUTCH 2
  // leaves (mat_9e386949944932ede3d84ca1_c0:s2, c1:s1, c1:s2) that
  // repeatedly reported structuralLoss > 0 and eventually used
  // deterministic fallback. Retry must still be BOUNDED (no infinite
  // loop just because loss never reaches zero), and — the actual bug
  // this case regression-tests — the already-validated rich units
  // from the exhausted last attempt must SURVIVE into the final
  // Brain merged with fallback, never be discarded wholesale in
  // favor of the cruder raw-sentence fallback for the whole leaf.
  // ─────────────────────────────────────────────────────────────

  await test('CASO D — persistent partial structural loss: bounded retries, rich units survive fallback merge', async () => {
    const scope = scopeFor([{ materialId: FORMULA_MATERIAL.materialId }])
    let callCount = 0
    const { createChunkTelemetry, recordRejection } = await import('../../lib/materialBrain/extractionTelemetry')

    // Every single attempt returns the SAME shape: one well-formed,
    // richly-structured unit (survives) + one structurally rejected
    // "unit" (simulated as already-filtered, only the counter/telemetry
    // reflect it — normalizeRawUnit itself is exercised separately by
    // extraction.ts's own unit tests). This never improves across
    // retries, unlike CASO A (transient) or CASO C (recoverable).
    const persistentPartialLossFn = async (chunk: PageChunk): Promise<{ extraction: ChunkExtractionResult }> => {
      callCount++
      const telemetry = createChunkTelemetry(chunk.id, chunk.materialId, chunk.pages)
      telemetry.rawUnits = 2
      telemetry.acceptedUnits = 1
      recordRejection(telemetry, 'malformed_unit', { kind: 'fact' })
      return {
        extraction: {
          units: [{
            kind: 'fact', canonicalSubject: 'Segunda ley de Newton', qualifiers: [], label: 'F=ma',
            statement: 'F = m·a.', quote: 'La segunda ley de Newton establece que F = m·a',
            page: chunk.pages[0], domainTags: ['física'], modelSuggestedTier: 'critical',
          }],
          relations: [], warnings: [], droppedInvalidProvenance: 0, droppedStructural: 1, telemetry,
        },
      }
    }

    const brain = await buildMaterialBrain(scope, [FORMULA_MATERIAL], {
      extractFn: persistentPartialLossFn as any,
      maxDirectedRetries: 2,
    })

    // Bounded: initial attempt + maxDirectedRetries, never more —
    // proves there is no infinite retry loop just because loss never
    // reaches zero.
    assert.equal(callCount, 3, 'must retry up to the bound and then stop, got ' + callCount + ' calls')
    assert.equal(brain.meta.status, 'ready', 'a leaf with partial loss must still resolve via fallback, not block the build')

    const checkpoint = Object.values(brain.meta.chunkCheckpoints || {})[0]
    assert.equal(checkpoint?.usedDeterministicFallback, true, 'fallback must have been applied for the unresolved residual loss')

    // The regression this case exists for: the rich, well-structured
    // unit from the last attempt must be PRESERVED (not replaced by a
    // crude fallback re-derivation of the same sentence).
    const richSurvivor = brain.units.find(u => u.label === 'F=ma' && u.origin !== 'fallback')
    assert.ok(richSurvivor, 'the last attempt\'s validly-structured unit must survive into the final Brain, not be discarded for a cruder fallback')
    assert.equal(richSurvivor?.kind, 'fact')
  })

  await test('CASO D — fallback does not fabricate a garbage formula when no credible symbol is present', async () => {
    // Direct unit test of the deterministicFallback.ts guard (mission:
    // "fallback units cannot produce garbage formula extraction such as
    // eq = k"). Exercised through the real function, not a mock.
    const { buildDeterministicFallbackExtraction } = await import('../../lib/materialBrain/deterministicFallback')
    const garbageChunk: PageChunk = {
      id: 'c_garbage', materialId: 'mat_garbage', pages: [1], order: 0,
      text: '[Pagina 1]\nEn el equilibrio, eq = k para el sistema considerado según la tabla adjunta de resultados experimentales.',
    }
    const result = buildDeterministicFallbackExtraction(garbageChunk)
    assert.equal(result.units.length, 1)
    assert.notEqual(result.units[0].kind, 'formula', 'a bare lowercase-word "=" fragment with no credible symbolic notation must not become a formula unit')
    assert.equal(result.units[0].kind, 'fact', 'it must still survive as a fact — never silently dropped')

    const realFormulaChunk: PageChunk = {
      id: 'c_real', materialId: 'mat_real', pages: [1], order: 0,
      text: '[Pagina 1]\nLa constante de equilibrio se define como Kc = [C]^c[D]^d entre los reactivos del sistema.',
    }
    const realResult = buildDeterministicFallbackExtraction(realFormulaChunk)
    assert.equal(realResult.units[0]?.kind, 'formula', 'a real symbolic expression (uppercase/bracket/digit evidence) must still be tagged as a formula')
  })

  // ─────────────────────────────────────────────────────────────
  // CASO E — live-evidence regression: a retry attempt that comes
  // back WORSE than the one already on file for the same leaf
  // (reported live as c2:s1's structuralLoss going 0 -> 9 across
  // attempts) must NOT overwrite the better prior attempt. Retries
  // are not guaranteed monotonic; the build must keep the best-seen
  // result for a leaf across its own retry loop.
  // ─────────────────────────────────────────────────────────────

  await test('CASO E — a worse retry attempt does not overwrite a better prior attempt for the same leaf', async () => {
    const scope = scopeFor([{ materialId: FORMULA_MATERIAL.materialId }])
    let callCount = 0
    const { createChunkTelemetry: makeTelemetry } = await import('../../lib/materialBrain/extractionTelemetry')

    const regressingFn = async (chunk: PageChunk): Promise<{ extraction: ChunkExtractionResult }> => {
      callCount++
      const telemetry = makeTelemetry(chunk.id, chunk.materialId, chunk.pages)
      if (callCount === 1) {
        // First attempt: SOME loss (still triggers a retry — any
        // structuralLoss > 0 does), but 2 units accepted.
        const { recordRejection: reject1 } = await import('../../lib/materialBrain/extractionTelemetry')
        telemetry.rawUnits = 3
        telemetry.acceptedUnits = 2
        reject1(telemetry, 'malformed_unit', { kind: 'fact' })
        return {
          extraction: {
            units: [
              { kind: 'fact', canonicalSubject: 'Segunda ley de Newton', qualifiers: [], label: 'F=ma', statement: 'F = m·a.', quote: 'La segunda ley de Newton establece que F = m·a', page: chunk.pages[0], domainTags: ['física'], modelSuggestedTier: 'critical' },
              { kind: 'fact', canonicalSubject: 'Unidades de fuerza', qualifiers: [], label: 'Newton', statement: 'La fuerza se mide en newtons.', quote: 'La segunda ley de Newton establece que F = m·a, donde F es la fuerza en newtons', page: chunk.pages[0], domainTags: ['física'], modelSuggestedTier: 'supporting' },
            ],
            relations: [], warnings: [], droppedInvalidProvenance: 0, droppedStructural: 1, telemetry,
          },
        }
      }
      // Every subsequent attempt comes back WORSE: only 1 unit
      // survives and MORE structural loss appears — simulating the
      // exact live regression shape (structuralLoss 0 -> 9, here
      // 1 -> 5, and fewer accepted units).
      telemetry.rawUnits = 6
      telemetry.acceptedUnits = 1
      const { recordRejection: reject2 } = await import('../../lib/materialBrain/extractionTelemetry')
      for (let i = 0; i < 5; i++) reject2(telemetry, 'malformed_unit', { kind: 'fact' })
      return {
        extraction: {
          units: [
            { kind: 'fact', canonicalSubject: 'Segunda ley de Newton', qualifiers: [], label: 'F=ma', statement: 'F = m·a.', quote: 'La segunda ley de Newton establece que F = m·a', page: chunk.pages[0], domainTags: ['física'], modelSuggestedTier: 'critical' },
          ],
          relations: [], warnings: [], droppedInvalidProvenance: 0, droppedStructural: 5, telemetry,
        },
      }
    }

    const brain = await buildMaterialBrain(scope, [FORMULA_MATERIAL], {
      extractFn: regressingFn as any,
      maxDirectedRetries: 2,
    })

    assert.ok(callCount >= 2, 'must have actually attempted a retry, got ' + callCount + ' calls')
    assert.equal(brain.meta.status, 'ready')
    // The regression this test exists for: the FIRST, better (0-loss,
    // 2-unit) attempt must survive into the final Brain — never
    // replaced by a later, worse retry attempt.
    assert.equal(brain.units.length, 2, 'the better first attempt\'s 2 units must survive, not be discarded for a worse retry\'s 1 unit')
    assert.ok(brain.units.some(u => u.identity.canonicalSubject === 'Unidades de fuerza'), 'the unit only present in the better attempt must not have been discarded')
  })

  // ─────────────────────────────────────────────────────────────
  // Resumen
  // ─────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60))
  console.log('Integration tests: ' + (passed + failed) + ' total | ✅ ' + passed + ' passed | ❌ ' + failed + ' failed')
  if (failed > 0) {
    console.log('\n❌ Algunos integration tests fallaron.')
    process.exit(1)
  } else {
    console.log('\n✅ Todos los integration tests de hardening pasaron.')
  }
}

main().catch(err => {
  console.error('❌ Error inesperado:', err)
  process.exit(1)
})
