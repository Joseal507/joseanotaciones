import type { SourceSelectionSnapshot } from '../adaptive/sourceSelection'
import type { SourceEvidence } from '../materials/sourceEvidence'

export type AcademicRole =
  | 'academic_content'
  | 'document_metadata'
  | 'instructional_scaffolding'
  | 'unknown'

export type BrainScope = SourceSelectionSnapshot

export interface SourceRef {
  materialId: string
  page: number
}

export function sourceRefKey(ref: SourceRef): string {
  return `${ref.materialId}::${ref.page}`
}

export interface ResolvedSourceMaterial {
  materialId: string
  nombre: string
  kind: string
  text: string
  knownPages?: number[]
  storageKey?: string
}

export interface PageChunk {
  id: string
  materialId: string
  pages: number[]
  order: number
  text: string
  sourceKind?: 'text' | 'vision'
  evidence?: SourceEvidence[]
}

export interface Provenance {
  materialId: string
  page: number
  quote: string
  chunkId: string
}

export type ImportanceTier = 'critical' | 'supporting' | 'contextual'

export type ImportanceRationale =
  | 'declared_in_material'
  | 'repeated_across_pages'
  | 'prerequisite_for'
  | 'exam_marked'
  | 'model_judged'

export interface ImportanceSignal {
  tier: ImportanceTier
  signals: ImportanceRationale[]
  confidence: number
}

export interface KnowledgeIdentity {
  canonicalSubject: string
  semanticKey: string
  qualifiers: string[]
}

export type KnowledgeUnitKind =
  | 'concept'
  | 'fact'
  | 'definition'
  | 'formula'
  | 'process'
  | 'example'
  | 'event_or_data'
  | 'terminology'

export interface KnowledgeUnitBase {
  id: string
  kind: KnowledgeUnitKind
  identity: KnowledgeIdentity
  label: string
  statement: string
  importance: ImportanceSignal
  provenance: Provenance[]
  evidence?: SourceEvidence[]
  domainTags: string[]
  supersededBy?: string
  displayQualifiers?: string[]
  origin?: 'rich' | 'fallback' | 'mixed'
  academicRole?: AcademicRole
}

export interface ConceptUnit extends KnowledgeUnitBase { kind: 'concept' }
export interface FactUnit extends KnowledgeUnitBase { kind: 'fact' }
export interface DefinitionUnit extends KnowledgeUnitBase { kind: 'definition'; term: string }
export interface FormulaUnit extends KnowledgeUnitBase {
  kind: 'formula'
  expression: string
  variables: { symbol: string; meaning: string }[]
}
export interface ProcessUnit extends KnowledgeUnitBase {
  kind: 'process'
  steps: { order: number; text: string }[]
}
export interface ExampleUnit extends KnowledgeUnitBase { kind: 'example'; illustrates: string }
export interface EventOrDataUnit extends KnowledgeUnitBase { kind: 'event_or_data'; value?: string }
export interface TerminologyUnit extends KnowledgeUnitBase { kind: 'terminology'; aliases: string[] }

export type KnowledgeUnit =
  | ConceptUnit | FactUnit | DefinitionUnit | FormulaUnit
  | ProcessUnit | ExampleUnit | EventOrDataUnit | TerminologyUnit

export type RelationType =
  | 'depends_on' | 'causes' | 'part_of' | 'contrasts_with'
  | 'example_of' | 'defined_by' | 'applies_formula' | 'precedes'

export interface KnowledgeRelation {
  id: string
  type: RelationType
  fromUnitId: string
  toUnitId: string
  statement: string
  importance: ImportanceSignal
  provenance: Provenance[]
  evidence?: SourceEvidence[]
  /**
   * Present only when fromUnitId/toUnitId (or both) were resolved via
   * the entity-level fallback (merge.ts resolveSubjectWithContext) —
   * the relation's source text gave no content signal distinguishing
   * among several real, distinct propositions of one entity/topic, so
   * resolution fell back to that entity's own definition/concept unit
   * as the closest real proxy for the topic as a whole, rather than
   * asserting the relation is about any ONE proposition specifically.
   * Additive/optional: existing consumers reading only fromUnitId/
   * toUnitId are unaffected by this field's presence.
   */
  fromResolution?: 'unit' | 'entity_representative'
  toResolution?: 'unit' | 'entity_representative'
}

export interface SourceCoverage {
  requested: SourceRef[]
  processed: SourceRef[]
  missing: SourceRef[]
  suspiciouslyEmpty: SourceRef[]
  status: 'complete' | 'partial' | 'failed'
}

export interface VisualCoverage {
  requested: SourceRef[]
  analyzed: SourceRef[]
  failed: SourceRef[]
  noContent: SourceRef[]
  status: 'complete' | 'partial' | 'not_required' | 'unavailable'
  preparationErrors?: VisualPreparationError[]
}

export interface VisualPreparationError {
  materialId: string
  stage: 'download_pdf' | 'load_pdf' | 'page_intelligence'
  code?: string
  message: string
}

export interface ExtractionTelemetrySummary {
  rawUnits: number
  acceptedUnits: number
  rejectedUnits: number
  rawRelations: number
  acceptedRelations: number
  rejectedRelations: number
  rejectionReasons: Partial<Record<string, number>>
  recoveredChunks: number
  truncatedObjects: number
}

export interface KnowledgeExtractionReport {
  chunksAttempted: number
  chunksFailed: number
  failedChunkIds: string[]
  unitsExtractedRaw: number
  unitsWithoutValidProvenance: number
  invalidStructural: number
  droppedAmbiguousRelations: number
  warnings: string[]
  telemetrySummary?: ExtractionTelemetrySummary
}

export interface BrainMeta {
  version: string
  builderVersion: string
  generatedAt: string
  chunking: { strategy: string; chunkSizeChars: number; chunkCount: number }
  llmCallsUsed: number
  retries: number
  status: 'building' | 'ready' | 'partial' | 'failed'
  sourceReadiness?: 'preparing' | 'ready' | 'failed'
  brainEnrichment?: 'not_started' | 'enriching' | 'ready' | 'degraded' | 'failed'
  enrichmentRevision?: number
  optionalGaps?: {
    visual: boolean
    details?: string[]
  }
  requiredProgress?: {
    completedRequiredSections: number
    totalRequiredSections: number
    completedOptionalSections: number
    totalOptionalSections: number
  }
  quizCoverageCache?: {
    version: string
    key: string
    analysis: import('./quiz/types').QuizCoverageAnalysis
    computedAt: string
  }
  chunkCheckpoints?: Record<string, MaterialBrainChunkCheckpoint>
  subchunkCheckpoints?: Record<string, MaterialBrainChunkCheckpoint>
  extractionQuality?: {
    richPercent: number
    fallbackPercent: number
    noContentPercent: number
  }
  contentLoss?: {
    hasLoss: boolean
    affectedLeafIds: string[]
    totalDroppedSegments: number
  }
  buildLease?: {
    ownerId: string
    startedAt: string
    expiresAt: string
  }
}

export type MaterialBrainChunkCheckpointStatus = 'complete' | 'complete_no_content' | 'retryable_failed' | 'terminal_failed'

export interface MaterialBrainChunkCheckpoint {
  status: MaterialBrainChunkCheckpointStatus
  sourceKind: 'text' | 'vision'
  failureReason?: string
  usedDeterministicFallback?: boolean
  enrichmentAttempts?: number
  extraction: {
    units: import('./extraction').RawExtractedUnit[]
    relations: import('./extraction').RawExtractedRelation[]
    warnings: string[]
    droppedInvalidProvenance: number
    droppedStructural: number
    telemetry?: import('./extractionTelemetry').ChunkTelemetry
  }
}

export type MaterialBrainLookupStatus = 'missing' | 'building' | 'ready' | 'partial' | 'failed'

export interface MergeLogEntry {
  kind: 'merged' | 'not_merged'
  candidateIds: string[]
  canonicalId?: string
  reason: string
}

export interface MaterialBrain {
  scope: BrainScope
  meta: BrainMeta
  units: KnowledgeUnit[]
  relations: KnowledgeRelation[]
  sourceCoverage: SourceCoverage
  visualCoverage?: VisualCoverage
  knowledgeExtraction: KnowledgeExtractionReport
  mergeLog: MergeLogEntry[]
}

export const MATERIAL_BRAIN_SCHEMA_VERSION = '1.0.0'
