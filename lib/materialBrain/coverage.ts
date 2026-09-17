import type {
  KnowledgeExtractionReport,
  KnowledgeUnit,
  PageChunk,
  SourceCoverage,
  SourceRef,
  ExtractionTelemetrySummary,
} from './types'
import { sourceRefKey } from './types'
import type { ChunkExtractionResult } from './extraction'
import { aggregateBuildTelemetry } from './extractionTelemetry'

// ============================================================
// sourceCoverage != knowledgeExtraction (Fase 0-B).
//
// sourceCoverage: ¿se leyó el 100% de las (materialId, page)?
// knowledgeExtraction: de lo leído, ¿qué pasó la validación?
//
// FIX 2: knowledgeExtraction ahora incluye telemetrySummary
// con raw/accepted/rejected auditables, si los ChunkTelemetry
// están disponibles en los resultados de extracción.
//
// FIX 3: una página/source unit solo cuenta como processed si
// TODOS los chunks que contienen contenido de esa página
// terminaron exitosamente. Éxito parcial de algunos chunks de
// la misma página NO basta para marcarla procesada.
// ============================================================

function uniqueRefs(chunks: PageChunk[]): SourceRef[] {
  const seen = new Map<string, SourceRef>()
  for (const chunk of chunks) {
    for (const page of chunk.pages) {
      const ref = { materialId: chunk.materialId, page }
      seen.set(sourceRefKey(ref), ref)
    }
  }
  return [...seen.values()]
}

function refDiff(a: SourceRef[], b: SourceRef[]): SourceRef[] {
  const bKeys = new Set(b.map(sourceRefKey))
  return a.filter(ref => !bKeys.has(sourceRefKey(ref)))
}

export function computeSourceCoverage(
  allChunks: PageChunk[],
  failedChunkIds: Set<string>,
  units: KnowledgeUnit[],
): SourceCoverage {
  const requested = uniqueRefs(allChunks)

  // FIX: mapear cada source ref -> TODOS los chunk ids que contienen
  // contenido de esa página. Una página solo es "processed" si todos
  // esos chunk ids fueron exitosos (ninguno está en failedChunkIds).
  const chunkIdsByRef = new Map<string, Set<string>>()
  for (const chunk of allChunks) {
    for (const page of chunk.pages) {
      const ref = { materialId: chunk.materialId, page }
      const key = sourceRefKey(ref)
      const chunkIds = chunkIdsByRef.get(key) || new Set<string>()
      chunkIds.add(chunk.id)
      chunkIdsByRef.set(key, chunkIds)
    }
  }

  const processed = requested.filter(ref => {
    const key = sourceRefKey(ref)
    const chunkIds = chunkIdsByRef.get(key)
    if (!chunkIds || chunkIds.size === 0) return false
    for (const chunkId of chunkIds) {
      if (failedChunkIds.has(chunkId)) return false
    }
    return true
  })

  const missing = refDiff(requested, processed)

  const refsWithUnits = new Set<string>()
  for (const unit of units) {
    for (const prov of unit.provenance) {
      refsWithUnits.add(sourceRefKey({ materialId: prov.materialId, page: prov.page }))
    }
    for (const evidence of unit.evidence || []) {
      refsWithUnits.add(sourceRefKey({ materialId: evidence.materialId, page: evidence.page }))
    }
  }
  const suspiciouslyEmpty = processed.filter(ref => !refsWithUnits.has(sourceRefKey(ref)))

  const status: SourceCoverage['status'] = missing.length === 0
    ? 'complete'
    : processed.length > 0 ? 'partial' : 'failed'

  return { requested, processed, missing, suspiciouslyEmpty, status }
}

export function computeKnowledgeExtractionReport(
  perChunkResults: { chunk: PageChunk; extraction: ChunkExtractionResult }[],
  failedChunkIds: Set<string>,
  unitsExtractedRaw: number,
  droppedAmbiguousRelations: number = 0,
  relationWarnings: string[] = [],
): KnowledgeExtractionReport {
  const warnings: string[] = []
  let unitsWithoutValidProvenance = 0
  let invalidStructural = 0
  for (const { extraction } of perChunkResults) {
    warnings.push(...extraction.warnings)
    unitsWithoutValidProvenance += extraction.droppedInvalidProvenance
    invalidStructural += extraction.droppedStructural
  }
  warnings.push(...relationWarnings)

  const chunksWithTelemetry = perChunkResults
    .map(r => r.extraction.telemetry)
    .filter((t): t is NonNullable<typeof t> => t !== null && t !== undefined)

  let telemetrySummary: ExtractionTelemetrySummary | undefined
  if (chunksWithTelemetry.length > 0) {
    const agg = aggregateBuildTelemetry(chunksWithTelemetry)
    telemetrySummary = {
      rawUnits: agg.totalRawUnits,
      acceptedUnits: agg.totalAcceptedUnits,
      rejectedUnits: agg.totalRejectedUnits,
      rawRelations: agg.totalRawRelations,
      acceptedRelations: agg.totalAcceptedRelations,
      rejectedRelations: agg.totalRejectedRelations,
      rejectionReasons: { ...agg.rejectionsByReason },
      recoveredChunks: agg.chunksWithRecovery,
      truncatedObjects: chunksWithTelemetry.reduce((sum, t) => sum + t.truncatedObjectsInResponse, 0),
    }
  }

  return {
    chunksAttempted: perChunkResults.length,
    chunksFailed: failedChunkIds.size,
    failedChunkIds: [...failedChunkIds],
    unitsExtractedRaw,
    unitsWithoutValidProvenance,
    invalidStructural,
    droppedAmbiguousRelations,
    warnings,
    telemetrySummary,
  }
}
