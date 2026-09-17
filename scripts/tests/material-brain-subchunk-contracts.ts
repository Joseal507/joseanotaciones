import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { buildMaterialBrain, isExtractionCheckpointComplete } from '../../lib/materialBrain/build'
import { splitExtractionSubchunks } from '../../lib/materialBrain/chunking'
import { extractChunkWithMockProvider, type ChunkExtractionResult } from '../../lib/materialBrain/extraction'
import { createChunkTelemetry } from '../../lib/materialBrain/extractionTelemetry'
import type { PageChunk, ResolvedSourceMaterial } from '../../lib/materialBrain/types'

function material(): ResolvedSourceMaterial {
  return {
    materialId: 'subchunk-material', nombre: 'subchunk.pdf', kind: 'pdf', knownPages: [1, 2, 3],
    text: [1, 2, 3].map(page => `[Pagina ${page}]\n${Array.from({ length: 9 }, (_, index) =>
      `Texto académico verificable ${page}.${index}: concepto distinto con explicación completa y evidencia literal suficiente.`).join('\n\n')}`).join('\n\n'),
  }
}

function success(chunk: PageChunk): ChunkExtractionResult {
  const quote = chunk.text.match(/Texto académico verificable[^\n.]*(?:\.[^\n.]*)?/)?.[0]
    || 'Texto académico verificable'
  return {
    units: [{ kind: 'fact', canonicalSubject: `Tema ${chunk.id}`, qualifiers: [], label: `Tema ${chunk.id}`,
      statement: `Hecho ${chunk.id}`, quote, page: chunk.pages[0], domainTags: [], modelSuggestedTier: 'supporting' }],
    relations: [], warnings: [], droppedInvalidProvenance: 0, droppedStructural: 0,
    telemetry: createChunkTelemetry(chunk.id, chunk.materialId, chunk.pages),
  }
}

function lossy(chunk: PageChunk): ChunkExtractionResult {
  const result = success(chunk)
  result.droppedStructural = 1
  result.warnings.push(`unidad descartada (campos requeridos ausentes) en ${chunk.id}`)
  return result
}

async function main() {
  const value = material()
  const scope = buildSourceSelectionSnapshot([value.materialId], { [value.materialId]: value.knownPages || [] })
  const outer: PageChunk = { id: `${value.materialId}_c0`, materialId: value.materialId, pages: [1, 2, 3], order: 0, text: value.text, sourceKind: 'text' }
  const firstSplit = splitExtractionSubchunks(outer)
  const secondSplit = splitExtractionSubchunks(outer)
  assert.ok(firstSplit.length > 1, 'SUBCHUNK-1 large outer chunk must split')
  assert.deepEqual(firstSplit.map(item => ({ id: item.id, pages: item.pages, text: item.text })), secondSplit.map(item => ({ id: item.id, pages: item.pages, text: item.text })), 'SUBCHUNK-9 identity must be deterministic')
  assert.equal(splitExtractionSubchunks({ ...outer, text: '[Pagina 1]\nTexto breve.', pages: [1] }).length, 1, 'SUBCHUNK-2 small chunk must remain atomic')

  // P0 real-bug fix: a lossy/failing child no longer stays blocked
  // waiting for a SEPARATE build to progressively refine/resume it —
  // the deterministic fallback resolves it IMMEDIATELY within the SAME
  // build (see build.ts), so a single buildMaterialBrain call already
  // converges to ready. Progressive subdivision (SUBCHUNK-1/2/9 above)
  // remains available as a mechanism for restoring an OLDER brain that
  // was genuinely interrupted before ever reaching this fallback stage
  // (see PREP-... / MB-RESIL-11 in material-brain-preparation-resilience-contracts.ts).
  const firstCalls: string[] = []
  const failedId = firstSplit[1].id
  const first = await buildMaterialBrain(scope, [value], {
    multimodal: false, chunkSizeChars: 10_000, maxDirectedRetries: 0,
    extractFn: async chunk => { firstCalls.push(chunk.id); return { extraction: chunk.id === failedId ? lossy(chunk) : success(chunk) } },
  })
  assert.equal(first.meta.status, 'ready', 'MB-REALBUG-5/6 a single build converges to ready even through a lossy child')
  assert.equal(first.meta.chunkCheckpoints?.[outer.id].status, 'complete')
  const failedLeafCheckpoint = first.meta.subchunkCheckpoints?.[failedId]
  assert.equal(failedLeafCheckpoint?.status, 'complete')
  assert.equal(failedLeafCheckpoint?.usedDeterministicFallback, true, 'the lossy child resolved via exact-source fallback, never by silently accepting the lossy AI output')
  assert.ok(Object.values(first.meta.subchunkCheckpoints || {}).filter(item => item.status === 'complete').length >= 2)

  // Cross-build absorption: a later build (e.g. resume after a real
  // process crash) must never re-run any already-complete leaf,
  // including one resolved via fallback.
  const retryCalls: string[] = []
  const resumed = await buildMaterialBrain(scope, [value], {
    multimodal: false, chunkSizeChars: 10_000, maxDirectedRetries: 0, previousBrain: first,
    extractFn: async chunk => { retryCalls.push(chunk.id); return { extraction: success(chunk) } },
  })
  assert.deepEqual(retryCalls, [], 'MB-REALBUG-2/3 no leaf re-executes across builds once complete (fallback-completed included)')
  assert.equal(resumed.meta.status, 'ready')
  assert.equal(resumed.meta.chunkCheckpoints?.[outer.id].status, 'complete')

  const legacyLossy = structuredClone(resumed)
  delete legacyLossy.meta.subchunkCheckpoints
  legacyLossy.meta.chunkCheckpoints![outer.id] = {
    status: 'complete', sourceKind: 'text', extraction: lossy(outer),
  }
  const migrationCalls: string[] = []
  await buildMaterialBrain(scope, [value], {
    multimodal: false, chunkSizeChars: 10_000, maxDirectedRetries: 0, previousBrain: legacyLossy,
    extractFn: async chunk => { migrationCalls.push(chunk.id); return { extraction: success(chunk) } },
  })
  assert.deepEqual(migrationCalls, firstSplit.map(item => item.id), 'CHECKPOINT-2 lossy legacy parent migrates to child retries')
  assert.equal(isExtractionCheckpointComplete(legacyLossy.meta.chunkCheckpoints![outer.id]), false)

  const provenanceChunk: PageChunk = { id: 'prov:s0', materialId: 'prov', pages: [36], order: 0, sourceKind: 'text', text: '[Pagina 36]\nSi Q > K, hay demasiados productos y el equilibrio se desplaza hacia la izquierda.' }
  const accepted = await extractChunkWithMockProvider(provenanceChunk, JSON.stringify({ units: [{ kind: 'fact', canonicalSubject: 'Q > K', qualifiers: [], label: 'Q > K', statement: 'Hay exceso de productos.', quote: 'Si Q > K, hay demasiados productos y el equilibrio se desplaza hacia la izquierda.', page: 36, domainTags: [], modelSuggestedTier: 'critical' }], relations: [] }))
  assert.equal(accepted.extraction.units.length, 1, 'PROV-1 verbatim quote accepted')
  const rejected = await extractChunkWithMockProvider(provenanceChunk, JSON.stringify({ units: [{ kind: 'fact', canonicalSubject: 'Q > K', qualifiers: [], label: 'Q > K', statement: 'Hay exceso de productos.', quote: 'Cuando Q supera K sobran productos y la reacción va a la izquierda.', page: 36, domainTags: [], modelSuggestedTier: 'critical' }], relations: [] }))
  assert.equal(rejected.extraction.units.length, 0, 'PROV-2 paraphrased quote rejected')
  assert.equal(rejected.extraction.droppedInvalidProvenance, 1)

  const emptyMaterial: ResolvedSourceMaterial = {
    materialId: 'non-academic', nombre: 'portada.pdf', kind: 'pdf', knownPages: [1],
    text: '[Pagina 1]\nPORTADA',
  }
  const emptyScope = buildSourceSelectionSnapshot([emptyMaterial.materialId], { [emptyMaterial.materialId]: [1] })
  let emptyProviderCalls = 0
  const emptyBrain = await buildMaterialBrain(emptyScope, [emptyMaterial], {
    multimodal: false, maxDirectedRetries: 0,
    extractFn: async chunk => { emptyProviderCalls++; return { extraction: success(chunk) } },
  })
  assert.equal(emptyProviderCalls, 0, 'AUTO-PREP-9 deterministic non-academic leaf must not trigger a provider retry storm')
  assert.equal(emptyBrain.meta.status, 'ready', 'AUTO-PREP-10 complete_no_content is completed required processing')
  assert.equal(Object.values(emptyBrain.meta.subchunkCheckpoints || {})[0]?.status, 'complete_no_content')

  const academicMaterial: ResolvedSourceMaterial = {
    materialId: 'academic-zero', nombre: 'academic.pdf', kind: 'pdf', knownPages: [1],
    text: '[Pagina 1]\nLa velocidad de reacción depende de la concentración de los reactivos y cambia durante el proceso de equilibrio.',
  }
  const academicScope = buildSourceSelectionSnapshot([academicMaterial.materialId], { [academicMaterial.materialId]: [1] })
  let academicProviderCalls = 0
  const academicBrain = await buildMaterialBrain(academicScope, [academicMaterial], {
    multimodal: false, maxDirectedRetries: 0,
    extractFn: async chunk => { academicProviderCalls++; return { extraction: lossy(chunk) } },
  })
  assert.equal(academicProviderCalls, 1, 'AUTO-PREP-8 substantive academic text must still execute extraction')
  // MB-REALBUG-5/6: structural loss no longer blocks readiness forever
  // — it resolves via the deterministic exact-source fallback in the
  // same build, never by silently accepting the lossy AI output.
  assert.equal(academicBrain.meta.status, 'ready')
  const academicLeaf = Object.values(academicBrain.meta.subchunkCheckpoints || {})[0]
  assert.equal(academicLeaf?.usedDeterministicFallback, true, 'academic structural loss resolves via fallback, not by silently certifying the lossy provider output')

  const extractionSource = readFileSync('lib/materialBrain/extraction.ts', 'utf8')
  assert.match(extractionSource, /failurePath:\s*'single_repair'/, 'AUTO-PREP-7 repeated structural failure must stop after one prompt repair before scope refinement')

  console.log(`material-brain-subchunk-contracts: PASS (subchunks=${firstSplit.length}, retry=${retryCalls.join(',')}, noContentCalls=${emptyProviderCalls})`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
