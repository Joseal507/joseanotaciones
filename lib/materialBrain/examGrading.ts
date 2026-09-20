import { createHash, randomUUID } from 'node:crypto'
import { workerAuthHeaders } from '../worker/auth'
import type { ExamAssessmentCriterion } from './examEnjoyerContext'

export interface CriterionResult {
  criterionId: string; scorePercent: number; status: 'correct' | 'partial' | 'incorrect' | 'unanswered'
  feedback: string; gradedBy: 'deterministic' | 'provider'
}
export interface GradingWork { sources?: Array<{ sourceItemId: string; content: string }>; criterion: ExamAssessmentCriterion; questionId: string; prompt: string; answer: unknown }
export interface ExamGradingJob {
  version: 1; identity: string; userId: string; examId: string; answersHash: string
  results: Record<string, CriterionResult>; work: GradingWork[]
  attempts: Record<string, number>; callsUsed: number; callBudget: number
  status: 'pending' | 'grading_incomplete' | 'completed'
  claim: { token: string; until: number } | null
  diagnostics: string[]
  /** Number of explicit, durable retry cycles opened after a bounded attempt
   * cycle ended without a grade. Accepted judgments are never cleared. */
  retryCycles?: number
}
export interface GradingRecord { revision: string; job: ExamGradingJob }
export interface ExamGradingStore {
  read(identity: string): Promise<GradingRecord | null>
  cas(identity: string, expected: string | null, job: ExamGradingJob): Promise<boolean>
}
export class WorkerExamGradingStore implements ExamGradingStore {
  async read(identity: string): Promise<GradingRecord | null> {
    const api = process.env.STUDYAL_API_URL
    if (!api) throw new Error('EXAM_GRADING_PERSISTENCE_UNAVAILABLE')
    const response = await fetch(`${api}/material-results/by-material?materialId=exam_grading:${identity}&enfoque=mixto&resultType=exam_grading`, { cache: 'no-store', headers: workerAuthHeaders() })
    if (!response.ok) {
      console.warn(`[EXAM_GRADING_DIAGNOSTIC] phase=grading_restore_failed examId=${identity} submissionId=${identity} status=${response.status} normalizedFailureReason=worker_read_http_${response.status}`)
      throw new Error('EXAM_GRADING_RESTORE_FAILED')
    }
    const body = await response.json()
    if (body.ok !== true || !Object.prototype.hasOwnProperty.call(body, 'result')) {
      console.warn(`[EXAM_GRADING_DIAGNOSTIC] phase=grading_restore_failed examId=${identity} submissionId=${identity} status=invalid_body normalizedFailureReason=worker_read_payload_invalid`)
      throw new Error('EXAM_GRADING_RESTORE_INVALID')
    }
    if (body.result === null) return null
    const job = typeof body.result.payload === 'string' ? JSON.parse(body.result.payload) : body.result.payload
    if (job?.version !== 1 || job.identity !== identity || !body.result.content_hash) {
      console.warn(`[EXAM_GRADING_DIAGNOSTIC] phase=grading_restore_failed examId=${identity} submissionId=${identity} status=invalid_job normalizedFailureReason=worker_read_job_corrupt`)
      throw new Error('EXAM_GRADING_RESTORE_INVALID')
    }
    return { revision: body.result.content_hash, job }
  }
  async cas(identity: string, expected: string | null, job: ExamGradingJob): Promise<boolean> {
    const api = process.env.STUDYAL_API_URL
    if (!api) throw new Error('EXAM_GRADING_PERSISTENCE_UNAVAILABLE')
    const nextRevision = randomUUID()
    const response = await fetch(`${api}/material-results/exam-grading-cas`, {
      method: 'POST', headers: workerAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ id: `exam_grading:${identity}`, expectedRevision: expected, revision: nextRevision, payload: job }),
    })
    if (response.ok) {
      const body = await response.json()
      if (body.ok !== true || typeof body.applied !== 'boolean') {
        console.warn(`[EXAM_GRADING_DIAGNOSTIC] phase=grading_cas_failed examId=${job.examId} submissionId=${identity} status=invalid_cas_response normalizedFailureReason=worker_cas_response_invalid`)
        throw new Error('EXAM_GRADING_PERSISTENCE_INVALID')
      }
      return body.applied
    }
    if (response.status === 404) {
      console.warn(`[EXAM_GRADING_DIAGNOSTIC] phase=grading_cas_failed examId=${job.examId} submissionId=${identity} status=404 normalizedFailureReason=EXAM_GRADING_CAS_ENDPOINT_UNAVAILABLE`)
      throw new Error('EXAM_GRADING_CAS_ENDPOINT_UNAVAILABLE')
    }
    console.warn(`[EXAM_GRADING_DIAGNOSTIC] phase=grading_cas_failed examId=${job.examId} submissionId=${identity} status=${response.status} normalizedFailureReason=worker_cas_http_${response.status}`)
    throw new Error('EXAM_GRADING_PERSISTENCE_FAILED')
  }
}
export class MemoryExamGradingStore implements ExamGradingStore {
  readonly records = new Map<string, GradingRecord>()
  async read(identity: string) { return structuredClone(this.records.get(identity) || null) }
  async cas(identity: string, expected: string | null, job: ExamGradingJob) {
    if ((this.records.get(identity)?.revision || null) !== expected) return false
    this.records.set(identity, { revision: randomUUID(), job: structuredClone(job) }); return true
  }
}
export const EXAM_GRADING_BATCH_SIZE = 6
export const EXAM_GRADING_ATTEMPTS_PER_CRITERION = 2
// Six compact judgments (<=80 words each), IDs and JSON overhead fit this budget.
export const examGradingTokens = (count: number) => 400 + count * 300
export function gradingIdentity(userId: string, examIdentity: string) {
  return createHash('sha256').update(JSON.stringify([1, userId, examIdentity])).digest('hex')
}
export function reconcileExamJudgments(work: GradingWork[], payload: unknown) {
  const record = payload as { judgments?: unknown[] } | null
  const judgments = Array.isArray(record?.judgments) ? record.judgments : []
  const expected = new Set(work.map(item => item.criterion.criterionId))
  const counts = new Map<string, number>()
  for (const raw of judgments) {
    const id = String((raw as { criterionId?: unknown })?.criterionId || '')
    counts.set(id, (counts.get(id) || 0) + 1)
  }
  const accepted: CriterionResult[] = []; const diagnostics = new Set<string>()
  if (!Array.isArray(record?.judgments)) diagnostics.add('malformed_judgment')
  for (const raw of judgments) {
    const row = raw as Record<string, unknown> | null
    const id = String(row?.criterionId || '')
    if (!expected.has(id)) { diagnostics.add('unknown_ids'); continue }
    if (counts.get(id)! > 1) { diagnostics.add('duplicate_ids'); continue }
    const score = row?.scorePercent
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100
      || !['correct', 'partial', 'incorrect'].includes(String(row?.status)) || typeof row?.feedback !== 'string') {
      diagnostics.add('malformed_judgment'); continue
    }
    accepted.push({ criterionId: id, scorePercent: score,
      status: score >= 80 ? 'correct' : score > 0 ? 'partial' : 'incorrect',
      feedback: row!.feedback as string, gradedBy: 'provider' })
  }
  if (work.some(item => !accepted.some(result => result.criterionId === item.criterion.criterionId))) diagnostics.add('missing_expected_ids')
  return { accepted, diagnostics: [...diagnostics] }
}
export type GradeBatch = (work: GradingWork[], beforeAttempt: () => Promise<void>) => Promise<unknown>

/** One durable submission per exam. A CAS claim reserves each actual provider attempt.
 * Accepted siblings are committed before the next batch. No unresolved student zeros. */
export async function advanceExamGrading(store: ExamGradingStore, initial: ExamGradingJob, grade: GradeBatch, options: { maxBatches?: number } = {}): Promise<ExamGradingJob> {
  try {
    await store.cas(initial.identity, null, initial)
  } catch (err: any) {
    console.warn(`[EXAM_GRADING_DIAGNOSTIC] phase=grading_job_create_failed examId=${initial.examId} submissionId=${initial.identity} status=error normalizedFailureReason=${String(err?.message || 'initial_cas_failed')}`)
    throw err
  }
  let record = await store.read(initial.identity)
  if (!record) {
    console.warn(`[EXAM_GRADING_DIAGNOSTIC] phase=grading_restore_failed examId=${initial.examId} submissionId=${initial.identity} status=not_found normalizedFailureReason=initial_read_null`)
    throw new Error('EXAM_GRADING_RESTORE_FAILED')
  }
  if (record.job.userId !== initial.userId || record.job.answersHash !== initial.answersHash) {
    console.warn(`[EXAM_GRADING_DIAGNOSTIC] phase=submission_persist_failed examId=${initial.examId} submissionId=${initial.identity} status=conflict normalizedFailureReason=submission_immutable`)
    throw new Error('EXAM_SUBMISSION_IMMUTABLE')
  }
  // A provider outage or two unusable responses exhausts the automatic
  // per-criterion attempt cycle. That must stop this HTTP request, but it must
  // not permanently brick the durable submission. A later explicit retry
  // opens one new bounded cycle while preserving every accepted judgment.
  if (record.job.status === 'grading_incomplete' && !record.job.claim) {
    const retryJob = record.job
    const pending = retryJob.work.filter(item => !retryJob.results[item.criterion.criterionId])
    const cycleExhausted = pending.length > 0 && (
      retryJob.callsUsed >= retryJob.callBudget
      || pending.every(item => (retryJob.attempts[item.criterion.criterionId] || 0) >= EXAM_GRADING_ATTEMPTS_PER_CRITERION)
    )
    if (cycleExhausted) {
      for (const item of pending) retryJob.attempts[item.criterion.criterionId] = 0
      retryJob.callBudget = Math.max(retryJob.callBudget, retryJob.callsUsed)
        + Math.max(EXAM_GRADING_ATTEMPTS_PER_CRITERION, pending.length * EXAM_GRADING_ATTEMPTS_PER_CRITERION)
      retryJob.retryCycles = (retryJob.retryCycles || 0) + 1
      retryJob.diagnostics = [...new Set([...retryJob.diagnostics, 'retry_cycle_opened'])]
      await store.cas(retryJob.identity, record.revision, retryJob)
      record = await store.read(initial.identity)
      if (!record) throw new Error('EXAM_GRADING_RESTORE_FAILED')
    }
  }
  // The HTTP route uses one batch so the existing 105s provider deadline fits its 120s lifetime.
  for (let batchNumber = 0; batchNumber < (options.maxBatches ?? 6); batchNumber++) {
    const job = record.job
    if (job.status === 'completed') return job
    if (job.claim && job.claim.until > Date.now()) return job
    const pending = job.work.filter(item => !job.results[item.criterion.criterionId])
    if (!pending.length) {
      job.status = 'completed'; job.claim = null
      if (await store.cas(job.identity, record.revision, job)) return job
      return (await store.read(job.identity))!.job
    }
    const batch = pending.filter(item => (job.attempts[item.criterion.criterionId] || 0) < EXAM_GRADING_ATTEMPTS_PER_CRITERION).slice(0, EXAM_GRADING_BATCH_SIZE)
    if (!batch.length || job.callsUsed >= job.callBudget) {
      job.status = 'grading_incomplete'; job.claim = null; job.diagnostics = ['budget_exhausted']
      await store.cas(job.identity, record.revision, job)
      return (await store.read(job.identity))!.job
    }
    const token = randomUUID()
    job.claim = { token, until: Date.now() + 600_000 }
    if (!await store.cas(job.identity, record.revision, job)) return (await store.read(job.identity))!.job
    const beforeAttempt = async () => {
      const current = await store.read(job.identity)
      if (!current || current.job.claim?.token !== token) {
        console.warn(`[EXAM_GRADING_DIAGNOSTIC] phase=grading_cas_failed examId=${job.examId} submissionId=${job.identity} status=claim_lost normalizedFailureReason=claim_lost_before_attempt`)
        throw new Error('EXAM_GRADING_CLAIM_LOST')
      }
      if (current.job.callsUsed >= current.job.callBudget || batch.some(item => (current.job.attempts[item.criterion.criterionId] || 0) >= EXAM_GRADING_ATTEMPTS_PER_CRITERION)) throw new Error('EXAM_GRADING_BUDGET_EXHAUSTED')
      current.job.callsUsed++
      for (const item of batch) current.job.attempts[item.criterion.criterionId] = (current.job.attempts[item.criterion.criterionId] || 0) + 1
      if (!await store.cas(job.identity, current.revision, current.job)) {
        console.warn(`[EXAM_GRADING_DIAGNOSTIC] phase=grading_cas_failed examId=${job.examId} submissionId=${job.identity} status=claim_lost normalizedFailureReason=cas_failed_before_attempt`)
        throw new Error('EXAM_GRADING_CLAIM_LOST')
      }
    }
    let payload: unknown; let failure: string | null = null
    try { payload = await grade(batch, beforeAttempt) }
    catch (error) {
      const message = error instanceof Error ? error.message : ''
      failure = /BUDGET/.test(message) ? 'budget_exhausted' : /JSON|PARSE|STRUCTURAL|VALIDATION/i.test(message) ? 'malformed_parser_failure' : 'provider_transport_failure'
    }
    const current = await store.read(job.identity)
    if (!current || current.job.claim?.token !== token) {
      console.warn(`[EXAM_GRADING_DIAGNOSTIC] phase=grading_cas_failed examId=${job.examId} submissionId=${job.identity} status=claim_lost normalizedFailureReason=claim_lost_after_attempt`)
      throw new Error('EXAM_GRADING_CLAIM_LOST')
    }
    const reconciled = reconcileExamJudgments(batch, payload)
    for (const result of reconciled.accepted) current.job.results[result.criterionId] ||= result
    current.job.diagnostics = failure ? [failure] : reconciled.diagnostics
    current.job.claim = null
    current.job.status = current.job.work.every(item => current.job.results[item.criterion.criterionId]) ? 'completed' : 'grading_incomplete'
    if (current.job.status !== 'completed' && (current.job.callsUsed >= current.job.callBudget || current.job.work.every(item => current.job.results[item.criterion.criterionId] || (current.job.attempts[item.criterion.criterionId] || 0) >= EXAM_GRADING_ATTEMPTS_PER_CRITERION))) current.job.diagnostics = [...new Set([...current.job.diagnostics, 'budget_exhausted'])]
    if (!await store.cas(job.identity, current.revision, current.job)) {
      console.warn(`[EXAM_GRADING_DIAGNOSTIC] phase=grading_cas_failed examId=${job.examId} submissionId=${job.identity} status=claim_lost normalizedFailureReason=cas_failed_commit_batch`)
      throw new Error('EXAM_GRADING_CLAIM_LOST')
    }
    record = (await store.read(job.identity))!
    if (failure) return record.job
  }
  return record.job
}
