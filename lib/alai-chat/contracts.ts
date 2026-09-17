/** Chat contracts are additive to DurableAlaiMessage; absent fields mean legacy/unknown. */
export const CHAT_SCHEMA_VERSION = 1 as const
/** Only provider fields: provenance and visual data remain server-owned. */
export const CHAT_RESPONSE_SCHEMA = {
  name: 'alai_chat_answer', strict: true,
  schema: { type: 'object', additionalProperties: false,
    properties: {
      answer: { type: 'string' },
      usedTargetIds: { type: 'array', items: { type: 'string' } },
      usedRelationIds: { type: 'array', items: { type: 'string' } },
      externalKnowledgeUsed: { type: 'boolean' },
      suggestedFollowups: { type: 'array', items: { type: 'string' } },
    },
    required: ['answer', 'usedTargetIds', 'usedRelationIds', 'externalKnowledgeUsed', 'suggestedFollowups'],
  },
}
export const CHAT_LIMITS = {
  messageChars: 4096, subjectChars: 384, queryChars: 768,
  historyMessages: 6, historyMessageChars: 1200, contextChars: 8000,
  answerChars: 12000, evidenceTargets: 10, relations: 12, followups: 3,
  totalTimeoutMs: 90_000, attemptTimeoutMs: 40_000,
} as const

export type SourcePolicy = 'MATERIAL_ONLY' | 'GENERAL_ONLY' | 'MIXED'
export type RetrievalOutcome = 'supported' | 'unsupported' | 'no_relevant_target' | 'not_checked'
export type ResponseShape = 'prose' | 'concise_prose' | 'deep_explanation' | 'bullet_list'
  | 'numbered_steps' | 'comparison_table' | 'timeline' | 'equation_work'
  | 'worked_solution' | 'definition_set' | 'graph' | 'mixed'

export interface ChatIntent {
  shape: ResponseShape
  followup: boolean
  explicitPolicy?: SourcePolicy
  requestedCount?: number
  ordinal?: number
  materialInspection: boolean
}

export type PedagogicalAction = 'generated_exercise' | 'solve_exercise' | 'hint' | 'clarification' | 'explanation' | 'answered'
export type RevelationRestriction = 'hidden' | 'revealed'

export interface PedagogicalState {
  version: 1
  targetObject?: string
  originTurnId?: string
  focusedEntity?: string
  lastReferent?: string
  pedagogicalAction: PedagogicalAction
  revelationRestriction: RevelationRestriction
  hintCount?: number
}

export interface PedagogicalTransition {
  action?: PedagogicalAction
  targetObject?: string
  solutionRevealed?: boolean
  focusedEntity?: string
}

export interface ChatConversationContext {
  version: 1
  subject: string
  operation: ResponseShape
  sourcePolicy: SourcePolicy
  usedTargetIds: string[]
  usedRelationIds: string[]
  requestedCount?: number
  ordinal?: number
  activeProblem?: string
  workingMemory?: string
  focusedEntity?: string
  lastReferent?: string
  lastAssistantAction?: 'answered' | 'generated_exercise' | 'clarification' | 'hint'
  pedagogicalState?: PedagogicalState
}

export interface ChatEvidence {
  targetId: string
  materialId: string
  pages: number[]
}

export interface ChatProvenance {
  sourceMode: SourcePolicy
  materialRetrievalOutcome: RetrievalOutcome
  externalKnowledgeUsed: boolean
  materialEvidenceUsed: boolean
  /** A lexical search is never an exhaustive inspection of the document. */
  inspectionScope?: 'retrieved_context'
}

export interface ChatEnvelope {
  schema: 'alai-chat'
  version: 1
  answer: string
  requestedResponseShape: ResponseShape
  sourcePolicy: SourcePolicy
  provenance: ChatProvenance
  evidence: ChatEvidence[]
  usedTargetIds: string[]
  usedRelationIds: string[]
  suggestedFollowups: string[]
  conversationContext: ChatConversationContext
  fulfillment: 'answered' | 'insufficient_material' | 'text_only' | 'partial'
}

export interface ChatFailure {
  success: false
  recoverable: true
  error: string
  detail?: string
  internalCode?: string
  userMessage?: string
}

export function chatProvenanceLabel(provenance: ChatProvenance): string {
  if (provenance.sourceMode === 'GENERAL_ONLY') return 'Conocimiento general'
  if (provenance.materialRetrievalOutcome === 'unsupported') return 'Material: sin respaldo en el contexto inspeccionado'
  if (provenance.materialRetrievalOutcome === 'no_relevant_target') return provenance.externalKnowledgeUsed
    ? 'Conocimiento general · sin evidencia material recuperada' : 'Material: no se encontró respaldo en el contexto recuperado'
  return provenance.sourceMode === 'MIXED' ? 'Material y conocimiento general' : 'Material'
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function boundedIds(value: unknown, limit: number = CHAT_LIMITS.evidenceTargets): string[] {
  return Array.isArray(value)
    ? [...new Set(value.slice(0, limit).filter((id): id is string => typeof id === 'string' && id.length <= 200 && !!id.trim()))]
    : []
}
