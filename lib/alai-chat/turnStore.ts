import { createHash, randomUUID } from 'node:crypto'
import { workerAuthHeaders } from '../worker/auth'
import { isRecord, type ChatEnvelope } from './contracts'

export type ChatTurnResult = ChatEnvelope & { success: true; [key: string]: unknown }
export interface ChatTurnRecord {
  version: 1
  requestHash: string
  attempt: number
  status: 'pending' | 'failed' | 'completed'
  result?: ChatTurnResult
}
export interface StoredChatTurn { revision: string; record: ChatTurnRecord }
export interface ChatTurnStore {
  read(id: string): Promise<StoredChatTurn | null>
  compareAndSet(id: string, expectedRevision: string | null, revision: string, record: ChatTurnRecord): Promise<boolean>
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export function chatTurnIdentity(userId: string, sessionId: string, fingerprint: string, turnId: string): string {
  return `alai_chat_turn:${hash(JSON.stringify([userId, sessionId, fingerprint, turnId]))}`
}
export const chatRequestHash = (message: string, context?: unknown) => hash(context === undefined ? message : JSON.stringify([message, context]))

function validResult(value: unknown): value is ChatTurnResult {
  if (!isRecord(value) || value.success !== true || value.schema !== 'alai-chat' || value.version !== 1
    || typeof value.answer !== 'string' || !value.answer || !isRecord(value.provenance) || !isRecord(value.conversationContext)) return false
  return ['usedTargetIds', 'usedRelationIds', 'suggestedFollowups', 'evidence'].every(key => Array.isArray(value[key]))
}
function readRecord(value: unknown): ChatTurnRecord {
  if (!isRecord(value) || value.version !== 1 || typeof value.requestHash !== 'string'
    || !Number.isInteger(value.attempt) || Number(value.attempt) < 1
    || !['pending', 'failed', 'completed'].includes(String(value.status))
    || (value.status === 'completed' && !validResult(value.result))) throw new Error('CHAT_TURN_STORAGE_MALFORMED')
  return value as unknown as ChatTurnRecord
}

/** Existing material_results table, with strict absence and atomic revision semantics. */
export class WorkerChatTurnStore implements ChatTurnStore {
  constructor(private readonly api = process.env.STUDYAL_API_URL || '', private readonly request: typeof fetch = fetch) {}
  private async call(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    if (!this.api) throw new Error('CHAT_TURN_STORAGE_UNAVAILABLE')
    const response = await this.request(`${this.api}${path}`, {
      ...init, cache: 'no-store', signal: AbortSignal.timeout(10_000),
      headers: workerAuthHeaders({ 'content-type': 'application/json' }),
    })
    if (!response.ok) throw new Error(`CHAT_TURN_STORAGE_FAILED:${response.status}`)
    const value: unknown = await response.json()
    if (!isRecord(value) || value.ok !== true) throw new Error('CHAT_TURN_STORAGE_MALFORMED')
    return value
  }
  async read(id: string): Promise<StoredChatTurn | null> {
    const value = await this.call(`/material-results/by-material?materialId=${encodeURIComponent(id)}&enfoque=mixto&resultType=alai_chat_turn`)
    if (value.result === null) return null // only an explicit successful null proves absence
    if (!isRecord(value.result) || value.result.id !== id || typeof value.result.content_hash !== 'string') throw new Error('CHAT_TURN_STORAGE_MALFORMED')
    const payload: unknown = typeof value.result.payload === 'string' ? JSON.parse(value.result.payload) : value.result.payload
    return { revision: value.result.content_hash, record: readRecord(payload) }
  }
  async compareAndSet(id: string, expectedRevision: string | null, revision: string, record: ChatTurnRecord): Promise<boolean> {
    const value = await this.call('/material-results/alai-chat-turn-cas', {
      method: 'POST', body: JSON.stringify({ id, expectedRevision, revision, payload: record }),
    })
    if (typeof value.applied !== 'boolean') throw new Error('CHAT_TURN_STORAGE_MALFORMED')
    return value.applied
  }
}

export async function runDurableChatTurn(params: {
  store: ChatTurnStore; id: string; requestHash: string; attempt: number
  generate: () => Promise<ChatTurnResult>
}): Promise<ChatTurnResult> {
  const { store, id, requestHash, attempt } = params
  let previous: StoredChatTurn | null
  try {
    previous = await store.read(id)
  } catch (err: any) {
    const msg = String(err?.message || err || '')
    throw new Error(`CHAT_TURN_STORAGE_READ_FAILED:${msg}`)
  }
  if (previous && previous.record.requestHash !== requestHash) throw new Error('CHAT_TURN_ID_CONFLICT')
  if (previous?.record.status === 'completed') return previous.record.result!
  // An abandoned pending record is uncertain, not proof that paid work is absent.
  // Never steal it on a timer. A confirmed failed attempt can be explicitly retried.
  if (previous?.record.status === 'pending') throw new Error('CHAT_TURN_IN_PROGRESS')
  if (previous && attempt <= previous.record.attempt) throw new Error('CHAT_TURN_PREVIOUS_ATTEMPT_FAILED')
  const revision = randomUUID()
  const pending: ChatTurnRecord = { version: 1, requestHash, attempt, status: 'pending' }
  let reserved = false
  try {
    reserved = await store.compareAndSet(id, previous?.revision ?? null, revision, pending)
  } catch (err: any) {
    const msg = String(err?.message || err || '')
    throw new Error(`CHAT_TURN_STORAGE_RESERVE_FAILED:${msg}`)
  }
  if (!reserved) {
    const winner = await store.read(id)
    if (winner?.record.requestHash === requestHash && winner.record.status === 'completed') return winner.record.result!
    throw new Error('CHAT_TURN_IN_PROGRESS')
  }
  let result: ChatTurnResult
  try { result = await params.generate() }
  catch (error) {
    // No successful candidate exists. A storage failure leaves pending, which safely blocks regeneration.
    await store.compareAndSet(id, revision, randomUUID(), { ...pending, status: 'failed' }).catch(() => false)
    throw error
  }
  try {
    if (await store.compareAndSet(id, revision, randomUUID(), { ...pending, status: 'completed', result })) return result
  } catch { /* a commit response can be lost after the immutable result was stored */ }
  const committed = await store.read(id)
  if (committed?.record.requestHash === requestHash && committed.record.status === 'completed') return committed.record.result!
  throw new Error('CHAT_TURN_COMMIT_UNCONFIRMED')
}
