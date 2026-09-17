import { workerAuthHeaders } from '../worker/auth'
import { createHash, randomUUID } from 'node:crypto'
import { getMaterialResult, saveMaterialResult } from '../materials/repository'
import type { ExamBlueprint, ExamComposedSlot, ExamAssessmentCriterion } from './examEnjoyerContext'

// ============================================================
// Progressive Exam generation — reuses Quiz V2's proven manifest
// architecture (frozen plan + per-slot status + client-driven
// advance + ready-slot precedence merge), simplified because Exam's
// ExamBlueprint is ALREADY fully frozen (targets, types, difficulty,
// answerAuthority, order, coverage) before this module is ever
// touched. Progressive generation here changes ONLY when a slot's
// question WORDING becomes available — never the academic
// composition. See EXAM-STATIC-1/2/3 and EXAM-PROG-* contracts.
// ============================================================

export const EXAM_MANIFEST_SCHEMA_VERSION = 2

export type ExamSlotStatus = 'pending' | 'generating' | 'ready' | 'retryable_failed' | 'terminal_failed' | 'superseded_terminal_failed' | 'infra_paused'

export type ExamRecoveryStage =
  | 'stage_1_same_type'
  | 'stage_2_repair'
  | 'stage_3_recompose'
  | 'stage_4_composite_split'
  | 'stage_5_atomic_fallback'
  | 'exhausted'

export interface ExamSlotState {
  status: ExamSlotStatus
  attempts: number
  stage?: ExamRecoveryStage
  stageAttempts?: number
  questionId?: string
  lastFailureReason?: string
  validationFailures?: string[]
  replacesSlotId?: string
  supersededBySlotId?: string
  supersededBySlotIds?: string[]
  originalSlotId?: string
  networkRetries?: number
  /** Per-slot infrastructure retry counter (durable, CAS-persisted). Never counts academic failures. */
  infraRetries?: number
  /** Hard cap for automatic infra retries for this slot. Set at first infra failure; never changes. */
  infraRetryBudget?: number
}

export interface ExamGenerationManifest {
  schemaVersion: number
  identity: string
  examId: string
  fingerprint: string
  sessionId: string
  /** FROZEN at creation — never mutated by progressive generation. */
  blueprint: ExamBlueprint
  totalSlots: number
  status: 'generating' | 'ready' | 'failed'
  slots: Record<string, ExamSlotState>
  providerAttemptsBudget: number
  providerAttemptsUsed: number
  failureReason?: string
  createdAt: string
  updatedAt: string
}

export interface ExamArtifact<Q extends { id: string }> {
  examId: string
  fingerprint: string
  meta: { status: 'generating' | 'ready' | 'failed'; generatedAt: string }
  /** Only READY questions, always ordered by blueprint.slots (presentation order). */
  questions: Q[]
}

/**
 * EXAM_FINAL blocker #4: a durable, restorable grading result — keyed
 * by the exam's generation identity PLUS a hash of the exact submitted
 * answers, so an IDENTICAL resubmission (double-click, retry after a
 * dropped response, reconnect) restores this SAME persisted result
 * instead of re-invoking semantic grading, while a genuinely DIFFERENT
 * submission (different answers) gets its own independent result. Not
 * a full cross-process CAS/lease (that requires a coordinated Worker
 * endpoint change outside this session's authorized scope — see final
 * report) — this closes the reproduced "duplicate identical submission
 * causes a second provider call" scenario using the SAME stable-id
 * persistence pattern already used for manifest/artifact.
 */
export interface ExamResultRecord {
  examId: string
  fingerprint: string
  answersHash: string
  result: unknown
  createdAt: string
}

export interface ExamGenerationStore<Q extends { id: string }> {
  getManifest(identity: string): Promise<ExamGenerationManifest | null>
  saveManifest(identity: string, manifest: ExamGenerationManifest): Promise<void>
  getArtifact(identity: string): Promise<ExamArtifact<Q> | null>
  saveArtifact(identity: string, artifact: ExamArtifact<Q>): Promise<void>
  getResult(identity: string, answersHash: string): Promise<ExamResultRecord | null>
  saveResult(identity: string, record: ExamResultRecord): Promise<void>
}

function manifestMaterialId(identity: string) { return `exam_manifest:${identity}` }
function artifactMaterialId(identity: string) { return `exam_artifact:${identity}` }
function resultMaterialId(identity: string, answersHash: string) { return `exam_result:${identity}:${answersHash}` }
const EXAM_ENFOQUE = 'mixto' as const

/** Deterministic hash of the exact submitted answers — the identity half of the result key. */
export function examAnswersHash(answers: unknown): string {
  return createHash('sha256').update(JSON.stringify(answers ?? null)).digest('hex').slice(0, 32)
}

function mergeAcceptedArtifact<Q extends { id: string }>(
  previous: ExamArtifact<Q> | null, incoming: ExamArtifact<Q>, blueprint?: ExamBlueprint,
): ExamArtifact<Q> {
  if (previous?.meta.status === 'ready') return structuredClone(previous)
  const questions = new Map(incoming.questions.map(question => [question.id, question]))
  // Acceptance is immutable even while the enclosing artifact is generating.
  for (const question of previous?.questions || []) questions.set(question.id, question)
  const order = new Map(blueprint?.slots.map((slot, index) => [slot.id, index]) || [])
  return structuredClone({ ...incoming, questions: [...questions.values()]
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)) })
}

function mergeAcceptedManifest<Q extends { id: string }>(
  previous: ExamGenerationManifest | null, incoming: ExamGenerationManifest, artifact: ExamArtifact<Q> | null,
): ExamGenerationManifest {
  if (previous?.status === 'ready') return structuredClone(previous)
  const merged = structuredClone(incoming)
  for (const [id, state] of Object.entries(previous?.slots || {})) {
    if (state.status === 'ready' || state.status === 'superseded_terminal_failed' || state.status === 'infra_paused') merged.slots[id] = state
    else if (state.status === 'generating') continue
    else if (merged.slots[id]) merged.slots[id].attempts = Math.max(state.attempts, merged.slots[id].attempts)
  }
  // A stale manifest cannot undo an accepted question or a replacement blueprint.
  // 1:1 recomposition (replacesSlotId) — adopt winner's replacement slot.
  for (const slot of previous?.blueprint.slots || []) {
    if (slot.replacesSlotId && !merged.blueprint.slots.some(candidate => candidate.id === slot.id)) {
      const index = merged.blueprint.slots.findIndex(candidate => candidate.id === slot.replacesSlotId)
      if (index >= 0) merged.blueprint.slots[index] = slot
      merged.slots[slot.id] = previous!.slots[slot.id]
    }
  }
  // 1:N composite split (supersededBySlotIds) — adopt winner's child set deterministically.
  // If the previous (winning) manifest already committed a split of parent P into children
  // C1..Cn, detect this and adopt the canonical child set exactly once, discarding any
  // competing child set the incoming worker may have computed for the same parent.
  for (const [parentId, parentState] of Object.entries(previous?.slots || {})) {
    const childIds = parentState.supersededBySlotIds
    if (!childIds || childIds.length < 2) continue
    // Previous already split this parent — adopt it unconditionally as the canonical split.
    merged.slots[parentId] = parentState // superseded_terminal_failed, supersededBySlotIds
    // Remove any competing children the incoming worker may have inserted for the same parent.
    // Keep only the canonical winning children from previous.
    const winnerChildIds = new Set(childIds)
    // Find children in incoming that share the same replacesSlotId=parentId but are NOT
    // part of the winner's canonical child set — these are a competing split, remove them.
    merged.blueprint.slots = merged.blueprint.slots.filter(slot => {
      if (slot.replacesSlotId === parentId && !winnerChildIds.has(slot.id)) return false
      return true
    })
    for (const id of Object.keys(merged.slots)) {
      const s = merged.slots[id]
      if (s.replacesSlotId === parentId && !winnerChildIds.has(id)) delete merged.slots[id]
    }
    // Ensure canonical children are present in merged blueprint exactly once.
    for (const childId of childIds) {
      const prevSlot = previous!.blueprint.slots.find(s => s.id === childId)
      if (!prevSlot) continue
      if (!merged.blueprint.slots.some(s => s.id === childId)) {
        // Insert at the position of the parent in the merged blueprint (or append).
        const parentIdx = merged.blueprint.slots.findIndex(s => s.id === parentId)
        if (parentIdx >= 0) {
          merged.blueprint.slots.splice(parentIdx, 0, prevSlot)
        } else {
          merged.blueprint.slots.push(prevSlot)
        }
      }
      // Adopt winner's child slot state.
      merged.slots[childId] = previous!.slots[childId] ?? merged.slots[childId]
    }
  }
  // Recompute totalSlots and providerAttemptsBudget after any structural reconciliation.
  const activeSlotCount = merged.blueprint.slots.filter(s => !s.supersededBySlotId).length
  if (activeSlotCount !== merged.totalSlots) {
    merged.totalSlots = activeSlotCount
    merged.providerAttemptsBudget = Math.max(merged.providerAttemptsBudget, activeSlotCount * EXAM_PROVIDER_ATTEMPTS_PER_SLOT)
  }
  for (const question of artifact?.questions || []) {
    if (merged.slots[question.id]) merged.slots[question.id] = {
      ...merged.slots[question.id], status: 'ready', questionId: question.id,
    }
  }
  merged.providerAttemptsUsed = Math.max(previous?.providerAttemptsUsed || 0, merged.providerAttemptsUsed)
  if (merged.blueprint.slots.every(slot => merged.slots[slot.id]?.status === 'ready')) {
    merged.status = 'ready'
    delete merged.failureReason
  }
  return merged
}


export class WorkerExamGenerationStore<Q extends { id: string }> implements ExamGenerationStore<Q> {
  constructor(private deps: {
    getMaterialResult?: typeof getMaterialResult
    saveMaterialResult?: typeof saveMaterialResult
  } = {}) {}
  async getManifest(identity: string): Promise<ExamGenerationManifest | null> {
    const getResult = this.deps.getMaterialResult || getMaterialResult
    const result = await getResult(manifestMaterialId(identity), EXAM_ENFOQUE, 'exam_manifest')
    return result?.payload && typeof result.payload === 'object' ? result.payload as ExamGenerationManifest : null
  }
  async saveManifest(identity: string, manifest: ExamGenerationManifest): Promise<void> {
    await this.writeFrozen(identity, 'exam_manifest', manifest)
  }

  async getArtifact(identity: string): Promise<ExamArtifact<Q> | null> {
    const getResult = this.deps.getMaterialResult || getMaterialResult
    const result = await getResult(artifactMaterialId(identity), EXAM_ENFOQUE, 'exam_artifact')
    return result?.payload && typeof result.payload === 'object' ? result.payload as ExamArtifact<Q> : null
  }
  async saveArtifact(identity: string, artifact: ExamArtifact<Q>): Promise<void> {
    await this.writeFrozen(identity, 'exam_artifact', artifact)
  }
  private async writeFrozen(identity: string, kind: 'exam_manifest' | 'exam_artifact',
    value: ExamGenerationManifest | ExamArtifact<Q>): Promise<void> {
    const id = kind === 'exam_manifest' ? manifestMaterialId(identity) : artifactMaterialId(identity)
    const get = this.deps.getMaterialResult || getMaterialResult
    let lastExpectedRevision: string | null = null
    for (let retry = 0; retry < 16; retry++) {
      const row = await get(id, EXAM_ENFOQUE, kind)
      const old = row?.payload
      const payload = kind === 'exam_artifact'
        ? mergeAcceptedArtifact(old as ExamArtifact<Q> | null, value as ExamArtifact<Q>, (await this.getManifest(identity))?.blueprint)
        : mergeAcceptedManifest(old as ExamGenerationManifest | null, value as ExamGenerationManifest, await this.getArtifact(identity))
      const api = process.env.STUDYAL_API_URL
      if (!api) throw new Error('EXAM_PERSISTENCE_UNAVAILABLE')
      const expectedRevision = row?.content_hash ?? null
      lastExpectedRevision = expectedRevision
      const revision = randomUUID()
      const response = await fetch(`${api}/material-results/exam-generation-cas`, {
        method: 'POST', headers: workerAuthHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ id, resultType: kind, expectedRevision, revision, payload }),
      })
      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        console.warn(`[EXAM_GENERATION_DIAGNOSTIC] phase=cas_request_failed kind=${kind} identity=${identity} id=${id} attempt=${retry + 1} status=${response.status} expectedRevision=${expectedRevision ?? 'null'} errorBody=${errorText.slice(0, 200)}`)
        throw new Error(`EXAM_GENERATION_CAS_FAILED:${response.status}`)
      }
      const result = await response.json().catch(() => null)
      if (!result || result.ok !== true || typeof result.applied !== 'boolean') {
        console.warn(`[EXAM_GENERATION_DIAGNOSTIC] phase=cas_invalid_response kind=${kind} identity=${identity} id=${id} attempt=${retry + 1} expectedRevision=${expectedRevision ?? 'null'} body=${JSON.stringify(result).slice(0, 200)}`)
        throw new Error('EXAM_GENERATION_CAS_INVALID')
      }
      if (result.applied) return
    }
    console.warn(`[EXAM_GENERATION_DIAGNOSTIC] phase=cas_contention_exhausted kind=${kind} identity=${identity} id=${id} attempts=16 expectedRevision=${lastExpectedRevision ?? 'null'}`)
    throw new Error('EXAM_GENERATION_CAS_CONTENDED')
  }

  async getResult(identity: string, answersHash: string): Promise<ExamResultRecord | null> {
    const getResult = this.deps.getMaterialResult || getMaterialResult
    const result = await getResult(resultMaterialId(identity, answersHash), EXAM_ENFOQUE, 'exam_result')
    return result?.payload && typeof result.payload === 'object' ? result.payload as ExamResultRecord : null
  }
  async saveResult(identity: string, record: ExamResultRecord): Promise<void> {
    const saveResult = this.deps.saveMaterialResult || saveMaterialResult
    const id = resultMaterialId(identity, record.answersHash)
    await saveResult({ id, material_id: id, enfoque: EXAM_ENFOQUE, result_type: 'exam_result', payload: record, content_hash: `${identity}:${record.answersHash}` })
  }
}

export class InMemoryExamGenerationStore<Q extends { id: string }> implements ExamGenerationStore<Q> {
  private manifests = new Map<string, ExamGenerationManifest>()
  private artifacts = new Map<string, ExamArtifact<Q>>()
  async getManifest(identity: string) {
    const value = this.manifests.get(identity)
    return value ? JSON.parse(JSON.stringify(value)) as ExamGenerationManifest : null
  }
  async saveManifest(identity: string, manifest: ExamGenerationManifest) {
    if (this.manifests.get(identity)?.status === 'ready') return
    this.manifests.set(identity, mergeAcceptedManifest(this.manifests.get(identity) || null, manifest, this.artifacts.get(identity) || null))
  }
  async getArtifact(identity: string) {
    const value = this.artifacts.get(identity)
    return value ? JSON.parse(JSON.stringify(value)) as ExamArtifact<Q> : null
  }
  async saveArtifact(identity: string, artifact: ExamArtifact<Q>) {
    if (this.artifacts.get(identity)?.meta.status === 'ready') return
    this.artifacts.set(identity, mergeAcceptedArtifact(this.artifacts.get(identity) || null, artifact, this.manifests.get(identity)?.blueprint))
  }
  private results = new Map<string, ExamResultRecord>()
  async getResult(identity: string, answersHash: string) {
    const value = this.results.get(`${identity}:${answersHash}`)
    return value ? JSON.parse(JSON.stringify(value)) as ExamResultRecord : null
  }
  async saveResult(identity: string, record: ExamResultRecord) {
    this.results.set(`${identity}:${record.answersHash}`, JSON.parse(JSON.stringify(record)))
  }
}

export function examGenerationIdentity(sessionId: string, fingerprint: string, examId: string): string {
  return createHash('sha256').update(JSON.stringify({ sessionId, fingerprint, examId, v: EXAM_MANIFEST_SCHEMA_VERSION })).digest('hex')
}

/**
 * Conceptually 3-5 questions — never derived from the total slot count
 * via an arbitrary ratio. Small exams (<3 slots) simply generate all
 * of them upfront.
 */
export function examInitialBatchSize(totalSlots: number): number {
  if (totalSlots <= 3) return totalSlots
  return Math.min(5, totalSlots)
}

export const EXAM_DEFAULT_BATCH_SIZE = 4
export const EXAM_STAGE_SAME_TYPE_ATTEMPTS = 3
export const EXAM_STAGE_REPAIR_ATTEMPTS = 2
export const EXAM_STAGE_ATOMIC_FALLBACK_ATTEMPTS = 2
export const EXAM_PROVIDER_ATTEMPTS_PER_SLOT = 3
/**
 * Maximum automatic infra (503/429/timeout/network) retries per slot.
 * After this many consecutive infra failures the slot is marked
 * 'infra_paused' — an honest infrastructure pause, NOT an academic
 * SLOT_UNRESOLVABLE. Does NOT consume academic authoring budget.
 * User-initiated resume resets this counter.
 */
export const EXAM_MAX_INFRA_RETRIES = 8
const EXAM_LEASE_MS = 120_000

export function isNetworkOrProviderFailure(errOrReason: unknown): boolean {
  if (!errOrReason) return false
  const msg = String((errOrReason as any)?.message || errOrReason).toLowerCase()
  const status = Number((errOrReason as any)?.status || (errOrReason as any)?.statusCode || 0)
  if (status === 429 || (status >= 500 && status <= 599)) return true
  if (msg.includes('503') || msg.includes('502') || msg.includes('504') || msg.includes('429')) return true
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) return true
  if (msg.includes('network') || msg.includes('fetch failed') || msg.includes('econnreset') || msg.includes('econnrefused')) return true
  if (msg.includes('service unavailable') || msg.includes('too many requests')) return true
  if (msg.includes('rate limit') || msg.includes('ratelimit')) return true
  return false
}

export type GenerateExamSlotBatchOutput<Q extends { id: string }> =
  | Map<string, Q>
  | { questions: Map<string, Q>; rejections?: Record<string, string> }

export type GenerateExamSlotBatchFn<Q extends { id: string }> = (
  slotIds: string[], blueprint: ExamBlueprint, attemptSeed: string,
  slotStates?: Record<string, ExamSlotState>,
) => Promise<GenerateExamSlotBatchOutput<Q>>

export interface ExamProgressiveResult<Q extends { id: string }> {
  status: 'generating' | 'ready' | 'failed'
  cacheStatus: 'miss' | 'hit' | 'shared_inflight'
  manifest: ExamGenerationManifest
  artifact: ExamArtifact<Q>
}

// Same-isolate single-flight — the honest guarantee this module makes.
// Cross-isolate correctness comes from re-read/merge + ready-slot
// precedence in runExamChunk below, never from this map alone.
const inFlight = new Map<string, Promise<ExamProgressiveResult<any>>>()

function orderedReadyQuestions<Q extends { id: string }>(
  blueprint: ExamBlueprint, readyBySlot: Map<string, Q>,
): Q[] {
  return blueprint.slots.flatMap(slot => {
    const q = readyBySlot.get(slot.id)
    return q ? [q] : []
  })
}

export async function runExamChunk<Q extends { id: string }>(
  sessionId: string, fingerprint: string, store: ExamGenerationStore<Q>,
  manifest: ExamGenerationManifest, artifact: ExamArtifact<Q>, targetSlotIds: string[],
  generateBatch: GenerateExamSlotBatchFn<Q>, batchSize: number,
): Promise<ExamProgressiveResult<Q>> {
  const identity = manifest.identity
  const target = targetSlotIds.filter(slotId => manifest.slots[slotId] && manifest.slots[slotId].status !== 'ready').slice(0, batchSize)
  if (!target.length) {
    return { status: manifest.status, cacheStatus: 'hit', manifest, artifact }
  }

  const now = new Date().toISOString()
  for (const slotId of target) {
    manifest.slots[slotId] = { ...manifest.slots[slotId], status: 'generating', attempts: manifest.slots[slotId].attempts + 1 }
  }
  manifest.updatedAt = now
  await store.saveManifest(identity, manifest)

  // Fold thrown provider errors into the same bounded failure path.
  let generated: Map<string, Q>
  let rejections: Record<string, string> = {}
  try {
    const batchOutput = await generateBatch(target, manifest.blueprint, `${manifest.examId}:${manifest.providerAttemptsUsed}`, manifest.slots)
    if (batchOutput instanceof Map) {
      generated = batchOutput
    } else if (batchOutput && typeof batchOutput === 'object' && 'questions' in batchOutput) {
      generated = batchOutput.questions
      rejections = batchOutput.rejections || {}
    } else {
      generated = new Map<string, Q>()
    }
  } catch (err: any) {
    generated = new Map<string, Q>()
    for (const slotId of target) {
      rejections[slotId] = `PROVIDER_EXCEPTION: ${err?.message || 'error'}`
    }
  }

  // Re-read the LATEST state right before merging — this is the honest
  // cross-isolate guarantee: a racing call may have already resolved
  // some of these slots (or even completed the whole manifest). Ready
  // slots always win over anything this call produced for the same id.
  const latestManifest = (await store.getManifest(identity)) || manifest
  const latestArtifact = (await store.getArtifact(identity)) || artifact
  const readyBySlot = new Map<string, Q>(latestArtifact.questions.map(q => [String((q as any).slotId), q]))
  const existingPromptKeys = new Set(latestArtifact.questions.map(question =>
    String((question as any).prompt || '').normalize('NFKD').toLowerCase().replace(/\s+/g, ' ').trim(),
  ).filter(Boolean))

  latestManifest.providerAttemptsUsed += target.length
  for (const slotId of target) {
    if (latestManifest.slots[slotId]?.status === 'ready') continue // already resolved by a racing call — precedence to ready
    const question = generated.get(slotId)
    let promptKey = String((question as any)?.prompt || '').normalize('NFKD').toLowerCase().replace(/\s+/g, ' ').trim()
    let duplicateQuestion = Boolean(promptKey && existingPromptKeys.has(promptKey))
    if (question && !duplicateQuestion) {
      latestManifest.slots[slotId] = {
        ...latestManifest.slots[slotId],
        status: 'ready',
        attempts: latestManifest.slots[slotId]?.attempts || 1,
        questionId: question.id,
      }
      readyBySlot.set(slotId, question)
      if (promptKey) existingPromptKeys.add(promptKey)
    } else {
      const rejectionReason = duplicateQuestion
        ? 'DUPLICATE_QUESTION_PROMPT: el enunciado generado duplica una pregunta existente'
        : (rejections[slotId] || latestManifest.slots[slotId]?.lastFailureReason || 'UNRESOLVED_VALIDATION')

      if (isNetworkOrProviderFailure(rejectionReason)) {
        latestManifest.providerAttemptsUsed = Math.max(0, latestManifest.providerAttemptsUsed - 1)
        const prevState = latestManifest.slots[slotId]
        const newInfraRetries = (prevState?.infraRetries || 0) + 1
        // Set the per-slot infrastructure retry budget once (conservative: EXAM_MAX_INFRA_RETRIES).
        const infraRetryBudget = prevState?.infraRetryBudget ?? EXAM_MAX_INFRA_RETRIES
        if (newInfraRetries > infraRetryBudget) {
          // Infra budget exhausted — pause honestly. NOT an academic failure.
          latestManifest.slots[slotId] = {
            ...prevState,
            status: 'infra_paused',
            attempts: Math.max(0, (prevState?.attempts || 1) - 1),
            lastFailureReason: `INFRA_RETRY_BUDGET_EXHAUSTED:${slotId}:${newInfraRetries}_infra_failures`,
            networkRetries: (prevState?.networkRetries || 0) + 1,
            infraRetries: newInfraRetries,
            infraRetryBudget,
          }
        } else {
          latestManifest.slots[slotId] = {
            ...prevState,
            status: 'retryable_failed',
            attempts: Math.max(0, (prevState?.attempts || 1) - 1),
            lastFailureReason: rejectionReason,
            networkRetries: (prevState?.networkRetries || 0) + 1,
            infraRetries: newInfraRetries,
            infraRetryBudget,
          }
        }
        continue
      }

      const currentSlotState = latestManifest.slots[slotId] || { status: 'pending', attempts: 1 }
      const stage: ExamRecoveryStage = currentSlotState.stage || 'stage_1_same_type'
      const totalAttempts = currentSlotState.attempts || 1
      const stageAttempts = currentSlotState.stageAttempts !== undefined ? currentSlotState.stageAttempts + 1 : totalAttempts
      const validationFailures = [...(currentSlotState.validationFailures || []), rejectionReason]

      if (stage === 'stage_1_same_type') {
        if (stageAttempts < EXAM_STAGE_SAME_TYPE_ATTEMPTS) {
          latestManifest.slots[slotId] = {
            ...currentSlotState,
            status: 'retryable_failed',
            stage: 'stage_1_same_type',
            stageAttempts,
            attempts: totalAttempts,
            lastFailureReason: rejectionReason,
            validationFailures,
          }
        } else {
          latestManifest.slots[slotId] = {
            ...currentSlotState,
            status: 'retryable_failed',
            stage: 'stage_2_repair',
            stageAttempts: 0,
            attempts: totalAttempts,
            lastFailureReason: rejectionReason,
            validationFailures,
          }
        }
      } else if (stage === 'stage_2_repair') {
        if (stageAttempts < EXAM_STAGE_REPAIR_ATTEMPTS) {
          latestManifest.slots[slotId] = {
            ...currentSlotState,
            status: 'retryable_failed',
            stage: 'stage_2_repair',
            stageAttempts,
            attempts: totalAttempts,
            lastFailureReason: rejectionReason,
            validationFailures,
          }
        } else {
          latestManifest.slots[slotId] = {
            ...currentSlotState,
            status: 'terminal_failed',
            stage: 'stage_2_repair',
            stageAttempts,
            attempts: totalAttempts,
            lastFailureReason: rejectionReason,
            validationFailures,
          }
        }
      } else if (stage === 'stage_3_recompose') {
        if (stageAttempts < EXAM_STAGE_REPAIR_ATTEMPTS) {
          latestManifest.slots[slotId] = {
            ...currentSlotState,
            status: 'retryable_failed',
            stage: 'stage_3_recompose',
            stageAttempts,
            attempts: totalAttempts,
            lastFailureReason: rejectionReason,
            validationFailures,
          }
        } else {
          latestManifest.slots[slotId] = {
            ...currentSlotState,
            status: 'terminal_failed',
            stage: 'stage_3_recompose',
            stageAttempts,
            attempts: totalAttempts,
            lastFailureReason: rejectionReason,
            validationFailures,
          }
        }
      } else if (stage === 'stage_4_composite_split') {
        if (stageAttempts < EXAM_STAGE_SAME_TYPE_ATTEMPTS) {
          latestManifest.slots[slotId] = {
            ...currentSlotState,
            status: 'retryable_failed',
            stage: 'stage_4_composite_split',
            stageAttempts,
            attempts: totalAttempts,
            lastFailureReason: rejectionReason,
            validationFailures,
          }
        } else {
          latestManifest.slots[slotId] = {
            ...currentSlotState,
            status: 'terminal_failed',
            stage: 'stage_4_composite_split',
            stageAttempts,
            attempts: totalAttempts,
            lastFailureReason: rejectionReason,
            validationFailures,
          }
        }
      } else if (stage === 'stage_5_atomic_fallback') {
        if (stageAttempts < EXAM_STAGE_ATOMIC_FALLBACK_ATTEMPTS) {
          latestManifest.slots[slotId] = {
            ...currentSlotState,
            status: 'retryable_failed',
            stage: 'stage_5_atomic_fallback',
            stageAttempts,
            attempts: totalAttempts,
            lastFailureReason: rejectionReason,
            validationFailures,
          }
        } else {
          latestManifest.slots[slotId] = {
            ...currentSlotState,
            status: 'terminal_failed',
            stage: 'exhausted',
            stageAttempts,
            attempts: totalAttempts,
            lastFailureReason: `SLOT_UNRESOLVABLE:${slotId}:validator_exhaustion_after_recomposition`,
            validationFailures,
          }
        }
      } else {
        latestManifest.slots[slotId] = {
          ...currentSlotState,
          status: 'terminal_failed',
          stage: 'exhausted',
          stageAttempts,
          attempts: totalAttempts,
          lastFailureReason: rejectionReason,
          validationFailures,
        }
      }
    }
  }

  const activeSlots = latestManifest.blueprint.slots.filter(s => !s.supersededBySlotId)
  const readyCount = activeSlots.filter(s => latestManifest.slots[s.id]?.status === 'ready').length
  const hasActivePending = activeSlots.some(s =>
    latestManifest.slots[s.id]?.status === 'pending' || latestManifest.slots[s.id]?.status === 'retryable_failed'
  )
  const hasInfraPaused = activeSlots.some(s => latestManifest.slots[s.id]?.status === 'infra_paused')

  if (readyCount === latestManifest.totalSlots) {
    latestManifest.status = 'ready'
    delete latestManifest.failureReason
  } else if (hasActivePending) {
    latestManifest.status = 'generating'
    delete latestManifest.failureReason
  } else if (hasInfraPaused) {
    // Infrastructure retry budget exhausted for one or more slots.
    // This is NOT an academic failure — mark failed with a distinct reason
    // so the route returns success:false and the client HTTP failure counter increments,
    // stopping the automatic polling loop. Academic authoring budget is unaffected.
    const infraPausedSlots = activeSlots.filter(s => latestManifest.slots[s.id]?.status === 'infra_paused')
    latestManifest.status = 'failed'
    latestManifest.failureReason = infraPausedSlots
      .map(s => latestManifest.slots[s.id]?.lastFailureReason || `INFRA_RETRY_BUDGET_EXHAUSTED:${s.id}`)
      .join(';')
  } else {
    // Attempt recovery on any terminal_failed slots
    const recovered = attemptSlotRecovery(latestManifest, latestArtifact)
    if (recovered) {
      latestManifest.status = 'generating'
      delete latestManifest.failureReason
    } else {
      const finalActive = latestManifest.blueprint.slots.filter(s => !s.supersededBySlotId)
      const finalFailed = finalActive.filter(s => latestManifest.slots[s.id]?.status === 'terminal_failed')
      latestManifest.status = 'failed'
      latestManifest.failureReason = finalFailed.length
        ? finalFailed.map(s => latestManifest.slots[s.id]?.lastFailureReason || `SLOT_UNRESOLVABLE:${s.id}`).join(';')
        : 'EXAM_ATTEMPTS_EXHAUSTED'
    }
  }

  const finalPendingCount = Object.values(latestManifest.slots).filter(slot =>
    slot.status === 'pending' || slot.status === 'retryable_failed' || slot.status === 'terminal_failed'
  ).length

  latestManifest.updatedAt = new Date().toISOString()
  console.log(`[EXAM_DIAGNOSTIC] phase=candidate_accepted examId=${latestManifest.examId} targetSlots=${target.join(',')} acceptedCount=${readyCount} pendingCount=${finalPendingCount} status=${latestManifest.status}${latestManifest.failureReason ? ` failureReason=${latestManifest.failureReason}` : ''}`)

  const mergedArtifact: ExamArtifact<Q> = {
    ...latestArtifact,
    meta: { ...latestArtifact.meta, status: latestManifest.status === 'ready' ? 'ready' : latestManifest.status === 'failed' ? 'failed' : 'generating' },
    questions: orderedReadyQuestions(latestManifest.blueprint, readyBySlot),
  }

  await store.saveArtifact(identity, mergedArtifact)
  await store.saveManifest(identity, latestManifest)

  // A racing worker may have frozen READY first. Always deliver the durable winner.
  const frozenManifest = await store.getManifest(identity)
  const frozenArtifact = await store.getArtifact(identity)
  if (!frozenManifest || !frozenArtifact) throw new Error('EXAM_PERSISTENCE_INCOMPLETE')
  console.log(`[EXAM_DIAGNOSTIC] phase=chunk_committed examId=${frozenManifest.examId} committedSlots=${target.join(',')} acceptedCount=${readyCount} pendingCount=${finalPendingCount} status=${frozenManifest.status}${frozenManifest.failureReason ? ` failureReason=${frozenManifest.failureReason}` : ''}`)
  return {
    status: frozenManifest.status, cacheStatus: 'miss', manifest: frozenManifest, artifact: frozenArtifact,
  }
}

/**
 * Deterministic final recovery policy for a terminally unresolved slot:
 * Recomposes an unresolvable slot (e.g. multiple_choice with distractor length leak
 * or operation mismatch) into a compatible short_answer slot that directly evaluates
 * the exact same frozen academic criteria and canonical authority without synthetic
 * distractors.
 *
 * Enforces strict boundaries:
 * - Max 1 recomposition pass (recomposed slots cannot be recomposed again).
 * - short_answer cannot be recomposed (cannot be further simplified without evidence loss).
 * - Missing frozen sources or criteria returns null (honest failure, no generic prompts).
 * - Preserves all academic targets, sources, criteria, operations, and bloom skills.
 */
export function deterministicallyRecomposeSlot(
  slot: ExamComposedSlot,
  lastFailureReason?: string,
  targetTypeOverride?: 'multiple_choice' | 'short_answer',
): ExamComposedSlot | null {
  // 1. Guard against re-recomposition (max 1 pass) or already superseded slots
  if (slot.replacesSlotId || slot.supersededBySlotId) return null

  // 2. Determine target interaction type
  const targetType = targetTypeOverride || (slot.type === 'fill_blank' ? 'multiple_choice' : 'short_answer')

  // Short answer is already the most direct format; if targetType matches current type, cannot recompose to itself
  if (slot.type === targetType) return null

  // 3. Must have verified frozen sources and assessment criteria
  if (!slot.frozenSources || slot.frozenSources.length === 0) return null
  if (!slot.assessmentCriteria || slot.assessmentCriteria.length === 0) return null

  // 4. Derive canonical authority for target type
  let canonicalValue = ''
  let distractorPool: string[] = []
  if (slot.answerAuthority.kind === 'single_text') {
    canonicalValue = slot.answerAuthority.canonicalValue
    distractorPool = slot.answerAuthority.distractorPool || []
  } else if (slot.answerAuthority.kind === 'boolean') {
    canonicalValue = slot.answerAuthority.canonicalStatement
  } else if (slot.answerAuthority.kind === 'multi_text') {
    canonicalValue = slot.answerAuthority.canonicalValues.join(', ')
  } else if (slot.answerAuthority.kind === 'pairs') {
    canonicalValue = slot.answerAuthority.pairs.map(p => `${p.left}: ${p.right}`).join('; ')
  }

  if (!canonicalValue || !canonicalValue.trim()) return null

  const recomposedId = `${slot.id}:recomposed:${targetType}`

  // 5. Transform assessment criteria to semantic grading mode if short_answer, preserving canonical criteria
  const assessmentCriteria: ExamAssessmentCriterion[] = slot.assessmentCriteria.map(crit => ({
    ...crit,
    gradingMode: targetType === 'short_answer' ? 'semantic' : crit.gradingMode,
    canonicalCriterion: crit.canonicalCriterion || canonicalValue,
  }))

  const recomposed: ExamComposedSlot = {
    ...slot,
    id: recomposedId,
    type: targetType,
    replacesSlotId: slot.id,
    supersededBySlotId: undefined,
    answerAuthority: {
      kind: 'single_text',
      canonicalValue,
      distractorPool: targetType === 'multiple_choice' ? distractorPool : [],
    },
    assessmentCriteria,
  }

  return recomposed
}

/**
 * Stage 4: Composite Split
 * If an unresolved composite slot contains multiple independently gradable criteria
 * and is too complex, split it deterministically into smaller atomic slots preserving
 * all criteria, points, and target ownership. Total question count can increase.
 */
export function deterministicallySplitCompositeSlot(
  slot: ExamComposedSlot,
): ExamComposedSlot[] | null {
  if (slot.supersededBySlotId || (slot as any).supersededBySlotIds) return null
  if (!slot.assessmentCriteria || slot.assessmentCriteria.length < 2) return null
  if (!slot.frozenSources || slot.frozenSources.length === 0) return null

  const criteria = slot.assessmentCriteria
  // Split criteria: each child slot covers a single atomic criterion from the parent
  const partitions = criteria.map(crit => [crit])

  const splitSlots: ExamComposedSlot[] = partitions.map((partCriteria, index) => {
    const splitId = `${slot.id}:split:${index + 1}`
    const targetIds = Array.from(new Set(partCriteria.flatMap(c => c.targetIds || [])))
    const primaryTargetId = targetIds[0] || slot.primaryTargetId
    const sourceItemIds = Array.from(new Set(partCriteria.map(c => c.sourceItemId).filter(Boolean) as string[]))
    const relevantSources = slot.frozenSources.filter(s => sourceItemIds.includes(s.sourceItemId))
    const frozenSources = relevantSources.length > 0 ? relevantSources : slot.frozenSources

    const canonicalValues = partCriteria.map(c => c.canonicalCriterion).filter(Boolean)
    const canonicalValue = canonicalValues.length > 0
      ? canonicalValues.join('; ')
      : (slot.answerAuthority.kind === 'single_text' ? slot.answerAuthority.canonicalValue : 'Respuesta')

    const assessmentCriteria: ExamAssessmentCriterion[] = partCriteria.map(crit => ({
      ...crit,
      gradingMode: 'semantic',
      canonicalCriterion: crit.canonicalCriterion || canonicalValue,
    }))

    return {
      ...slot,
      id: splitId,
      type: 'short_answer',
      primaryTargetId,
      targetIds: targetIds.length > 0 ? targetIds : slot.targetIds,
      assessedTargetIds: targetIds.length > 0 ? targetIds : slot.assessedTargetIds,
      sourceItemIds: sourceItemIds.length > 0 ? sourceItemIds : slot.sourceItemIds,
      frozenSources,
      replacesSlotId: slot.id,
      supersededBySlotId: undefined,
      answerAuthority: {
        kind: 'single_text',
        canonicalValue,
        distractorPool: [],
      },
      assessmentCriteria,
    }
  })

  return splitSlots
}

/**
 * Stage 5: Atomic Open Fallback
 * For a grounded atomic criterion that cannot support a specialized closed interaction,
 * use a concise short_answer/open response as the final safe fallback.
 */
export function deterministicallyFallbackToAtomicOpen(
  slot: ExamComposedSlot,
): ExamComposedSlot | null {
  if (slot.supersededBySlotId || slot.id.includes(':fallback:open')) return null
  if (!slot.frozenSources || slot.frozenSources.length === 0) return null
  if (!slot.assessmentCriteria || slot.assessmentCriteria.length === 0) return null

  let canonicalValue = ''
  if (slot.answerAuthority.kind === 'single_text') {
    canonicalValue = slot.answerAuthority.canonicalValue
  } else if (slot.answerAuthority.kind === 'boolean') {
    canonicalValue = slot.answerAuthority.canonicalStatement
  } else if (slot.answerAuthority.kind === 'multi_text') {
    canonicalValue = slot.answerAuthority.canonicalValues.join(', ')
  } else if (slot.answerAuthority.kind === 'pairs') {
    canonicalValue = slot.answerAuthority.pairs.map(p => `${p.left}: ${p.right}`).join('; ')
  }

  if (!canonicalValue || !canonicalValue.trim()) return null

  const fallbackId = `${slot.id}:fallback:open`
  const assessmentCriteria: ExamAssessmentCriterion[] = slot.assessmentCriteria.map(crit => ({
    ...crit,
    gradingMode: 'semantic',
    canonicalCriterion: crit.canonicalCriterion || canonicalValue,
  }))

  return {
    ...slot,
    id: fallbackId,
    type: 'short_answer',
    replacesSlotId: slot.id,
    supersededBySlotId: undefined,
    answerAuthority: {
      kind: 'single_text',
      canonicalValue,
      distractorPool: [],
    },
    assessmentCriteria,
  }
}

/**
 * Executes deterministic recovery ladder on terminally unresolved slots:
 * Stage 3: Safe Type Recomposition (fill_blank -> multiple_choice; others -> short_answer)
 * Stage 4: Composite Split (composite slots with >= 2 criteria split into atomic slots)
 * Stage 5: Atomic Open Fallback (single criterion short_answer semantic fallback)
 * Stage 6: Honest terminal failure with structured reason
 */
export function attemptSlotRecovery(
  manifest: ExamGenerationManifest,
  artifact?: ExamArtifact<any>,
): boolean {
  if (!manifest.slots || typeof manifest.slots !== 'object') return false

  const budget = manifest.providerAttemptsBudget || (manifest.totalSlots * EXAM_PROVIDER_ATTEMPTS_PER_SLOT)
  const used = manifest.providerAttemptsUsed || 0
  if (used >= budget) return false

  for (const slot of manifest.blueprint.slots) {
    if (slot.supersededBySlotId) continue
    const state = manifest.slots[slot.id]
    if (state?.status !== 'terminal_failed') continue

    // 1. Honesty check
    if (!slot.frozenSources || slot.frozenSources.length === 0) {
      manifest.slots[slot.id] = {
        ...state,
        stage: 'exhausted',
        lastFailureReason: `SLOT_UNRESOLVABLE:${slot.id}:insufficient_source_evidence`,
      }
      continue
    }
    if (!slot.assessmentCriteria || slot.assessmentCriteria.length === 0) {
      manifest.slots[slot.id] = {
        ...state,
        stage: 'exhausted',
        lastFailureReason: `SLOT_UNRESOLVABLE:${slot.id}:no_grounded_answer_authority`,
      }
      continue
    }

    // 2. Stage 3: Safe Type Recomposition
    if (!slot.replacesSlotId && slot.type !== 'short_answer') {
      const targetType = slot.type === 'fill_blank' ? 'multiple_choice' : 'short_answer'
      const recomposed = deterministicallyRecomposeSlot(slot, state.lastFailureReason, targetType)
      if (recomposed) {
        const idx = manifest.blueprint.slots.findIndex(s => s.id === slot.id)
        if (idx >= 0) {
          manifest.blueprint.slots[idx] = recomposed
          manifest.slots[slot.id] = {
            ...state,
            status: 'superseded_terminal_failed',
            supersededBySlotId: recomposed.id,
          }
          manifest.slots[recomposed.id] = {
            status: 'pending',
            attempts: 0,
            stage: 'stage_3_recompose',
            stageAttempts: 0,
            replacesSlotId: slot.id,
          }
          manifest.status = 'generating'
          delete manifest.failureReason
          manifest.updatedAt = new Date().toISOString()
          return true
        }
      }
    }

    // 3. Stage 4: Composite Split
    if (slot.assessmentCriteria && slot.assessmentCriteria.length >= 2 && !state.supersededBySlotIds && !slot.id.includes(':split:')) {
      const splitSlots = deterministicallySplitCompositeSlot(slot)
      if (splitSlots && splitSlots.length >= 2) {
        const idx = manifest.blueprint.slots.findIndex(s => s.id === slot.id)
        if (idx >= 0) {
          manifest.blueprint.slots.splice(idx, 1, ...splitSlots)
          manifest.totalSlots = manifest.blueprint.slots.filter(s => !s.supersededBySlotId).length
          manifest.providerAttemptsBudget = Math.max(
            manifest.providerAttemptsBudget || 0,
            manifest.totalSlots * EXAM_PROVIDER_ATTEMPTS_PER_SLOT,
          )
          manifest.slots[slot.id] = {
            ...state,
            status: 'superseded_terminal_failed',
            supersededBySlotIds: splitSlots.map(s => s.id),
          }
          for (const ss of splitSlots) {
            manifest.slots[ss.id] = {
              status: 'pending',
              attempts: 0,
              stage: 'stage_1_same_type',
              stageAttempts: 0,
              replacesSlotId: slot.id,
            }
          }
          manifest.status = 'generating'
          delete manifest.failureReason
          manifest.updatedAt = new Date().toISOString()
          return true
        }
      }
    }

    // 4. Stage 5: Atomic Open Fallback
    if (!slot.id.includes(':fallback:open') && !slot.id.includes(':split:') && slot.type !== 'short_answer') {
      const fallback = deterministicallyFallbackToAtomicOpen(slot)
      if (fallback) {
        const idx = manifest.blueprint.slots.findIndex(s => s.id === slot.id)
        if (idx >= 0) {
          manifest.blueprint.slots[idx] = fallback
          manifest.slots[slot.id] = {
            ...state,
            status: 'superseded_terminal_failed',
            supersededBySlotId: fallback.id,
          }
          manifest.slots[fallback.id] = {
            status: 'pending',
            attempts: 0,
            stage: 'stage_5_atomic_fallback',
            stageAttempts: 0,
            replacesSlotId: slot.id,
          }
          manifest.status = 'generating'
          delete manifest.failureReason
          manifest.updatedAt = new Date().toISOString()
          return true
        }
      }
    }

    // 5. Stage 6: Honest terminal failure
    manifest.slots[slot.id] = {
      ...state,
      stage: 'exhausted',
      lastFailureReason: state.lastFailureReason && state.lastFailureReason.startsWith('SLOT_UNRESOLVABLE:')
        ? state.lastFailureReason
        : `SLOT_UNRESOLVABLE:${slot.id}:validator_exhaustion_after_recomposition`,
    }
  }

  return false
}

/**
 * Self-heals a manifest that was prematurely marked 'failed' by a pre-fix bug
 * when legitimate actionable work remains (untouched pending or retryable slots,
 * or an unhandled terminally-failed slot eligible for deterministic recovery).
 * Never resets ready questions, attempt counters, or terminal_failed history.
 */
export function normalizeActionableExamManifest(manifest: ExamGenerationManifest): boolean {
  if (manifest.status !== 'failed') return false
  if (!manifest.slots || typeof manifest.slots !== 'object') return false

  // Clean up any stale 'generating' slots from a crashed or interrupted batch
  for (const slotId of Object.keys(manifest.slots)) {
    if (manifest.slots[slotId]?.status === 'generating') {
      const attempts = manifest.slots[slotId]?.attempts || 1
      const exhausted = attempts >= EXAM_PROVIDER_ATTEMPTS_PER_SLOT
      manifest.slots[slotId] = {
        ...manifest.slots[slotId],
        status: exhausted ? 'terminal_failed' : 'retryable_failed',
      }
    }
  }

  const activePending = Object.values(manifest.slots).filter(
    slot => slot.status === 'pending' || slot.status === 'retryable_failed',
  )
  const budget = manifest.providerAttemptsBudget || (manifest.totalSlots * EXAM_PROVIDER_ATTEMPTS_PER_SLOT)
  const used = manifest.providerAttemptsUsed || 0
  const hasRemainingBudget = used < budget

  if (activePending.length > 0 && hasRemainingBudget) {
    manifest.status = 'generating'
    delete manifest.failureReason
    manifest.updatedAt = new Date().toISOString()
    return true
  }

  // Final recovery policy: if no regular pending slots remain and budget allows, attempt recovery ladder
  if (hasRemainingBudget) {
    return attemptSlotRecovery(manifest)
  }

  return false
}

/** Lookup-only restore for grading/continuity. Never generates or repairs. */
export async function restoreExamGeneration<Q extends { id: string }>(
  sessionId: string, fingerprint: string, examId: string, store: ExamGenerationStore<Q>,
): Promise<{ manifest: ExamGenerationManifest; artifact: ExamArtifact<Q> } | null> {
  const identity = examGenerationIdentity(sessionId, fingerprint, examId)
  const [manifest, artifact] = await Promise.all([store.getManifest(identity), store.getArtifact(identity)])
  if (!manifest || !artifact) return null
  if (manifest.schemaVersion !== EXAM_MANIFEST_SCHEMA_VERSION
    || manifest.sessionId !== sessionId || manifest.fingerprint !== fingerprint || manifest.examId !== examId
    || artifact.fingerprint !== fingerprint || artifact.examId !== examId) return null

  if (normalizeActionableExamManifest(manifest)) {
    artifact.meta.status = 'generating'
    await store.saveManifest(identity, manifest)
    await store.saveArtifact(identity, artifact)
  }

  return { manifest, artifact }
}

/**
 * Creates (or resumes) an Exam generation manifest for a FROZEN
 * blueprint and generates the small initial playable batch. The full
 * blueprint (examId, targets, types, difficulty, answerAuthority,
 * order, honest duration-bounded coverage) is persisted BEFORE this function makes any
 * provider call — EXAM-PROG-1.
 */
export async function getOrBuildExamGeneration<Q extends { id: string }>(
  sessionId: string, fingerprint: string, examId: string, blueprint: ExamBlueprint,
  store: ExamGenerationStore<Q>, generateBatch: GenerateExamSlotBatchFn<Q>,
  options: { batchSize?: number } = {},
): Promise<ExamProgressiveResult<Q>> {
  const identity = examGenerationIdentity(sessionId, fingerprint, examId)
  const shared = inFlight.get(identity)
  if (shared) return { ...(await shared), cacheStatus: 'shared_inflight' }

  const task = (async (): Promise<ExamProgressiveResult<Q>> => {
    const existingManifest = await store.getManifest(identity)
    const existingArtifact = await store.getArtifact(identity)
    if (existingManifest && existingArtifact) {
      if (normalizeActionableExamManifest(existingManifest)) {
        existingArtifact.meta.status = 'generating'
        await store.saveManifest(identity, existingManifest)
        await store.saveArtifact(identity, existingArtifact)
      }
      // EXAM-PROG-14: an already-resolved (ready/failed) manifest never
      // triggers another provider call on resume.
      return { status: existingManifest.status, cacheStatus: 'hit', manifest: existingManifest, artifact: existingArtifact }
    }

    const createdAt = new Date().toISOString()
    const manifest: ExamGenerationManifest = {
      schemaVersion: EXAM_MANIFEST_SCHEMA_VERSION, identity, examId, fingerprint, sessionId,
      blueprint, totalSlots: blueprint.slots.length, status: 'generating',
      slots: Object.fromEntries(blueprint.slots.map(slot => [slot.id, { status: 'pending' as ExamSlotStatus, attempts: 0 }])),
      providerAttemptsBudget: blueprint.slots.length * EXAM_PROVIDER_ATTEMPTS_PER_SLOT,
      providerAttemptsUsed: 0, createdAt, updatedAt: createdAt,
    }
    const artifact: ExamArtifact<Q> = {
      examId, fingerprint, meta: { status: 'generating', generatedAt: createdAt }, questions: [],
    }
    await store.saveManifest(identity, manifest)
    await store.saveArtifact(identity, artifact)

    if (!blueprint.slots.length) {
      manifest.status = 'ready'
      await store.saveManifest(identity, manifest)
      return { status: 'ready', cacheStatus: 'miss', manifest, artifact }
    }

    const initialBatch = blueprint.slots.slice(0, examInitialBatchSize(blueprint.slots.length)).map(slot => slot.id)
    return runExamChunk(sessionId, fingerprint, store, manifest, artifact, initialBatch, generateBatch, options.batchSize || EXAM_DEFAULT_BATCH_SIZE)
  })()
  inFlight.set(identity, task)
  try { return await task } finally { if (inFlight.get(identity) === task) inFlight.delete(identity) }
}

/**
 * Client-driven advancement: request the next batch of not-yet-ready
 * slots. Never mutates the frozen blueprint — only fills in wording
 * for slots the composer already decided must exist.
 */
export async function advanceExamGeneration<Q extends { id: string }>(
  sessionId: string, fingerprint: string, examId: string,
  store: ExamGenerationStore<Q>, generateBatch: GenerateExamSlotBatchFn<Q>,
  options: { batchSize?: number } = {},
): Promise<ExamProgressiveResult<Q>> {
  const identity = examGenerationIdentity(sessionId, fingerprint, examId)
  const shared = inFlight.get(identity)
  if (shared) return { ...(await shared), cacheStatus: 'shared_inflight' }

  const task = (async (): Promise<ExamProgressiveResult<Q>> => {
    const manifest = await store.getManifest(identity)
    const artifact = await store.getArtifact(identity)
    if (!manifest || !artifact) throw new Error('EXAM_MANIFEST_MISSING')
    if (normalizeActionableExamManifest(manifest)) {
      artifact.meta.status = 'generating'
      await store.saveManifest(identity, manifest)
      await store.saveArtifact(identity, artifact)
    }
    if (manifest.status === 'ready' || manifest.status === 'failed') {
      return { status: manifest.status, cacheStatus: 'hit', manifest, artifact } // EXAM-PROG-14
    }
    const leaseExpired = Date.now() - Date.parse(manifest.updatedAt) > EXAM_LEASE_MS
    if (leaseExpired) {
      for (const slotId of Object.keys(manifest.slots)) {
        if (manifest.slots[slotId]?.status === 'generating') manifest.slots[slotId] = { ...manifest.slots[slotId], status: 'retryable_failed' }
      }
    }
    let pending = manifest.blueprint.slots
      .map(slot => slot.id)
      .filter(slotId => ['pending', 'retryable_failed'].includes(manifest.slots[slotId]?.status))

    if (pending.length === 0) {
      const recovered = attemptSlotRecovery(manifest, artifact)
      if (recovered) {
        await store.saveManifest(identity, manifest)
        artifact.meta.status = 'generating'
        await store.saveArtifact(identity, artifact)
        pending = manifest.blueprint.slots
          .map(slot => slot.id)
          .filter(slotId => ['pending', 'retryable_failed'].includes(manifest.slots[slotId]?.status))
      }
    }
    return runExamChunk(sessionId, fingerprint, store, manifest, artifact, pending, generateBatch, options.batchSize || EXAM_DEFAULT_BATCH_SIZE)
  })()
  inFlight.set(identity, task)
  try { return await task } finally { if (inFlight.get(identity) === task) inFlight.delete(identity) }
}
