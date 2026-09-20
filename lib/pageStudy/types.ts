import type { SourceSelectionSnapshot } from '../adaptive/sourceSelection'
import type { AssistanceLevel } from '../adaptive/v3/engine/helpContract'
import type { MisconceptionStatus } from '../adaptive/v3/engine/misconceptionTracker'

/**
 * Page Study core types. Everything here is plain, JSON-serializable data: the state is durable and must survive a
 * round trip unchanged (Unicode included). Nothing here holds raw source text.
 */
export interface PlanMaterial { materialId: string; name: string; selectedPages: number[] }

/** An internal authority batch: at most 5 materials, one canonical source-selection snapshot (= one Enjoyer identity). */
export interface AuthorityBatch { batchId: string; index: number; materialIds: string[]; selection: SourceSelectionSnapshot }

export interface BlockPlan {
  blockKey: string        // `${materialId}:${start}-${end}` — stable identity of a page block
  materialId: string
  batchIndex: number
  index: number           // position in plan.blocks
  pages: number[]         // the pages this block covers (a set, not a range: explicit selections can be sparse)
  start: number
  end: number
}

export interface PageStudyPlan {
  planId: string
  planKey: string
  temaId: string
  materials: PlanMaterial[]                    // the single ordered PDF queue the user sees
  batches: AuthorityBatch[]                    // internal only
  blockSize: number
  universe: Record<string, number[]>           // studyable pages per material (narrowed by scope, never widened)
  blocks: BlockPlan[]
  scopeNotes: string[]                         // free-text scope the deterministic layer cannot enforce (bounded)
}

export type BlockStatus = 'pending' | 'active' | 'done'
export interface BlockProgress {
  status: BlockStatus
  totalUnits: number
  taught: string[]                             // unitRefs taught in FULL
  projected: string[]                          // unitRefs taught only from verified in-range evidence
  deferred: string[]                           // unitRefs postponed to a later block
  unitsSinceCheck: number
  checksAsked: number
  evalAsked: number
  rechecks: number
  wrapped: boolean
  forced: boolean
}

export type Verdict = 'correct' | 'partial' | 'incorrect'
export interface AttemptRecord { turnSeq: number; verdict: Verdict; assistance: AssistanceLevel; at: number; digest: string; blockKey: string; blockIndex: number }

export interface ConceptRecord {
  unitRef: string
  materialId: string
  label: string
  kind: string
  pages: number[]
  taughtClass: 'FULL' | 'PROJECTED'
  taughtSeq: number
  attempts: AttemptRecord[]
  corrected: boolean
  demonstratedIndependent: boolean
  demonstratedAt?: number
  demonstratedBlockIndex?: number
  retained: boolean
}

export interface PendingQuestion {
  ref: string                                  // identity of the pending question (never consumed by doubts)
  unitRefs: string[]
  format: string
  askedSeq: number
  helpLevel: AssistanceLevel                   // assistance received SINCE the question was asked
  clarifications: number
}

/** Bounded, derived study state that may cross authority batches. It never carries source text, quotes or summaries. */
export interface RecheckCard {
  cardId: string
  unitRef: string
  materialId: string
  batchIndex: number
  label: string
  kind: string
  pages: number[]
  misconception?: string
  correctStatement?: string
  attempts: number
  lastVerdict: Verdict
  createdSeq: number
  checks: number
}

export interface MisconceptionRecord {
  id: string
  unitRef: string
  statement: string
  correctStatement: string
  status: MisconceptionStatus
  observations: number
  firstSeq: number
  lastSeq: number
  correctedSeq?: number
}

export interface PageStudyState {
  version: 1
  planId: string
  revision: number
  turnSeq: number
  plan: PageStudyPlan
  cursor: { blockIdx: number }                 // == plan.blocks.length when the whole plan is finished
  progress: Record<string, BlockProgress>
  pending: PendingQuestion | null
  concepts: Record<string, ConceptRecord>
  misconceptions: MisconceptionRecord[]
  carryover: RecheckCard[]
  prefs: { pace: 'steady' | 'through' }
  updatedAt: number
}

export interface UnitMeta { unitRef: string; materialId: string; label: string; kind: string; pages: number[] }

export type HelpKind = 'hint' | 'clarification' | 'reveal' | 'question'
export type StateOp =
  | { op: 'units'; blockKey: string; total: number }
  | { op: 'teach'; blockKey: string; klass: 'FULL' | 'PROJECTED'; units: UnitMeta[] }
  | { op: 'defer'; blockKey: string; unitRefs: string[] }
  | { op: 'ask'; ref: string; unitRefs: string[]; format: string; replace?: boolean; kind?: 'mini' | 'eval' | 'recheck' }
  | { op: 'help'; kind: HelpKind }
  | { op: 'answer'; verdict: Verdict; digest: string; misconception?: { statement: string; correctStatement: string } }
  | { op: 'wrap'; blockKey: string }
  | { op: 'complete'; blockKey: string; forced?: boolean }
  | { op: 'narrow'; materialId: string; upTo?: number; ranges?: Array<[number, number]> }
  | { op: 'pace'; pace: 'steady' | 'through' }
  | { op: 'note'; text: string }

/** One turn's state change. Deterministic and replayable: applying it twice is a no-op (roll-forward safe). */
export interface StateDelta { baseRevision: number; turnSeq: number; at: number; ops: StateOp[] }
