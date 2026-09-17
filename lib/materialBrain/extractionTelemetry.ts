// ============================================================
// Telemetría auditable de extracción — Material Brain
//
// Permite observar exactamente qué produjo el LLM vs. qué
// sobrevivió la validación, con reasons concretas por rechazo.
//
// Shape agregable por build/chunk — nunca almacena el raw LLM
// completo de forma permanente (solo el conteo y las razones).
// ============================================================

export type RejectionReason =
  | 'malformed_unit'
  | 'invalid_kind'
  | 'invalid_provenance'
  | 'quote_not_in_source'
  | 'incomplete_recovered_object'
  | 'invalid_structure'
  | 'invalid_relation_type'
  | 'relation_missing_fields'
  | 'fallback_capacity_ceiling'
  | 'non_academic_segment_filtered'

export interface RejectedUnitRecord {
  reason: RejectionReason
  canonicalSubject?: string
  kind?: string
  page?: number
  detail?: string
}

export interface ChunkTelemetry {
  chunkId: string
  materialId: string
  pages: number[]
  /** Total de objetos que el LLM emitió (antes de cualquier validación) */
  rawUnits: number
  rawRelations: number
  /** Cuántos pasaron todas las validaciones */
  acceptedUnits: number
  acceptedRelations: number
  /** Cuántos fueron rechazados — derivado de rejectedUnitRecords.length para consistencia */
  rejectedUnits: number
  rejectedRelations: number
  /** Registro auditable de cada rechazo — fuente de verdad de rechazos */
  rejectedUnitRecords: RejectedUnitRecord[]
  /** Si la respuesta LLM fue truncada y se usó recovery parcial */
  wasRecovered: boolean
  recoveryStrategy: 'full_parse' | 'partial_recovery' | 'none'
  truncatedObjectsInResponse: number
}

export interface BuildTelemetry {
  totalRawUnits: number
  totalAcceptedUnits: number
  totalRejectedUnits: number
  totalRawRelations: number
  totalAcceptedRelations: number
  totalRejectedRelations: number
  rejectionsByReason: Record<RejectionReason, number>
  chunksWithRecovery: number
  chunksTotal: number
  perChunk: ChunkTelemetry[]
}

export function createChunkTelemetry(
  chunkId: string,
  materialId: string,
  pages: number[],
): ChunkTelemetry {
  return {
    chunkId,
    materialId,
    pages,
    rawUnits: 0,
    rawRelations: 0,
    acceptedUnits: 0,
    acceptedRelations: 0,
    rejectedUnits: 0,
    rejectedRelations: 0,
    rejectedUnitRecords: [],
    wasRecovered: false,
    recoveryStrategy: 'full_parse',
    truncatedObjectsInResponse: 0,
  }
}

/**
 * Registra un rechazo auditable e incrementa el contador de rechazos.
 * Es la ÚNICA forma de registrar un rechazo — garantiza que
 * rejectedUnits == rejectedUnitRecords.length siempre.
 */
export function recordRejection(
  telemetry: ChunkTelemetry,
  reason: RejectionReason,
  detail?: { canonicalSubject?: string; kind?: string; page?: number; detail?: string },
) {
  telemetry.rejectedUnitRecords.push({ reason, ...detail })
  // rejectedUnits se deriva del array para que siempre sean coherentes
  telemetry.rejectedUnits = telemetry.rejectedUnitRecords.length
}

export function aggregateBuildTelemetry(perChunk: ChunkTelemetry[]): BuildTelemetry {
  const rejectionsByReason = {} as Record<RejectionReason, number>
  let totalRawUnits = 0
  let totalAcceptedUnits = 0
  let totalRejectedUnits = 0
  let totalRawRelations = 0
  let totalAcceptedRelations = 0
  let totalRejectedRelations = 0
  let chunksWithRecovery = 0

  for (const chunk of perChunk) {
    totalRawUnits += chunk.rawUnits
    totalAcceptedUnits += chunk.acceptedUnits
    // Usar rejectedUnitRecords.length como fuente de verdad
    totalRejectedUnits += chunk.rejectedUnitRecords.length
    totalRawRelations += chunk.rawRelations
    totalAcceptedRelations += chunk.acceptedRelations
    totalRejectedRelations += chunk.rejectedRelations
    if (chunk.wasRecovered) chunksWithRecovery++
    for (const record of chunk.rejectedUnitRecords) {
      rejectionsByReason[record.reason] = (rejectionsByReason[record.reason] || 0) + 1
    }
  }

  return {
    totalRawUnits,
    totalAcceptedUnits,
    totalRejectedUnits,
    totalRawRelations,
    totalAcceptedRelations,
    totalRejectedRelations,
    rejectionsByReason,
    chunksWithRecovery,
    chunksTotal: perChunk.length,
    perChunk,
  }
}

/**
 * DEV-only diagnostic summary for a single leaf's rejection telemetry —
 * used at the per-leaf log boundary (build.ts material_brain_leaf_finalized)
 * so "which validation condition rejected these units" is observable
 * without re-running anything. Deliberately excludes `detail` and
 * `canonicalSubject` (which may echo short source-derived snippets) —
 * only the reason enum + kind are surfaced, never quotes or provider
 * payloads.
 */
export function summarizeChunkRejectionsForLog(telemetry: ChunkTelemetry): { reason: RejectionReason; kind?: string; page?: number }[] {
  return telemetry.rejectedUnitRecords.map(record => ({ reason: record.reason, kind: record.kind, page: record.page }))
}
