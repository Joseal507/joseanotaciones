import { randomUUID } from 'node:crypto'
import { workerAuthHeaders } from '../worker/auth'
import type { PageStudyState, StateDelta } from './types'

/**
 * Durable storage for Page Study: the existing `material_results` table through three Worker routes
 * (page-study-cas / page-study-read / page-study-turns). Same rules as WorkerChatTurnStore:
 *  - only an explicit successful `null` proves absence — any transport/HTTP/shape problem is an ERROR (fail closed);
 *  - every write is a single atomic compare-and-set on an opaque revision token.
 */
export interface PageStudyStateRecord { version: 1; revision: number; state: PageStudyState; appliedTurns: string[] }
export interface PageStudyTurnRecord {
  version: 1; slot: string; requestHash: string; attempt: number; status: 'pending' | 'failed' | 'completed'
  turnSeq: number; baseRevision: number; startedAt?: number
  result?: Record<string, unknown>; stateDelta?: StateDelta; error?: string
}
export interface StoredState { token: string; record: PageStudyStateRecord }
export interface StoredTurn { token: string; id: string; record: PageStudyTurnRecord }

export interface PageStudyStore {
  readState(id: string): Promise<StoredState | null>
  casState(id: string, expectedToken: string | null, token: string, record: PageStudyStateRecord): Promise<boolean>
  readTurn(id: string): Promise<StoredTurn | null>
  casTurn(id: string, scope: string, expectedToken: string | null, token: string, record: PageStudyTurnRecord): Promise<boolean>
  listTurnsAfter(scope: string, afterSeq: number, limit: number): Promise<StoredTurn[]>
}

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

function readStateRecord(value: unknown): PageStudyStateRecord {
  if (!isRecord(value) || value.version !== 1 || !Number.isInteger(value.revision) || !isRecord(value.state) || value.state.version !== 1
    || value.state.revision !== value.revision || typeof value.state.planId !== 'string' || !Array.isArray(value.appliedTurns)) throw new Error('PAGE_STUDY_STORAGE_MALFORMED')
  return value as unknown as PageStudyStateRecord
}
function readTurnRecord(value: unknown): PageStudyTurnRecord {
  if (!isRecord(value) || value.version !== 1 || typeof value.slot !== 'string' || typeof value.requestHash !== 'string'
    || !Number.isInteger(value.attempt) || Number(value.attempt) < 1 || !Number.isInteger(value.turnSeq) || !Number.isInteger(value.baseRevision)
    || !['pending', 'failed', 'completed'].includes(String(value.status))
    || (value.status === 'completed' && (!isRecord(value.result) || !isRecord(value.stateDelta) || !Array.isArray((value.stateDelta as Record<string, unknown>).ops)))) throw new Error('PAGE_STUDY_STORAGE_MALFORMED')
  return value as unknown as PageStudyTurnRecord
}
const parsePayload = (payload: unknown): unknown => (typeof payload === 'string' ? JSON.parse(payload) : payload)

export class WorkerPageStudyStore implements PageStudyStore {
  constructor(private readonly api = process.env.STUDYAL_API_URL || '', private readonly request: typeof fetch = fetch) {}
  private async call(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
    if (!this.api) throw new Error('PAGE_STUDY_STORAGE_UNAVAILABLE')
    const response = await this.request(`${this.api}${path}`, {
      ...init, cache: 'no-store', signal: AbortSignal.timeout(10_000), headers: workerAuthHeaders({ 'content-type': 'application/json' }),
    })
    if (!response.ok) throw new Error(`PAGE_STUDY_STORAGE_FAILED:${response.status}`)
    const value: unknown = await response.json()
    if (!isRecord(value) || value.ok !== true) throw new Error('PAGE_STUDY_STORAGE_MALFORMED')
    return value
  }
  async readState(id: string): Promise<StoredState | null> {
    const value = await this.call(`/material-results/page-study-read?id=${encodeURIComponent(id)}`)
    if (value.result === null) return null
    if (!isRecord(value.result) || value.result.id !== id || typeof value.result.content_hash !== 'string') throw new Error('PAGE_STUDY_STORAGE_MALFORMED')
    return { token: value.result.content_hash, record: readStateRecord(parsePayload(value.result.payload)) }
  }
  async casState(id: string, expectedToken: string | null, token: string, record: PageStudyStateRecord): Promise<boolean> {
    const value = await this.call('/material-results/page-study-cas', { method: 'POST', body: JSON.stringify({ kind: 'state', id, revision: token, expectedRevision: expectedToken, payload: record }) })
    if (typeof value.applied !== 'boolean') throw new Error('PAGE_STUDY_STORAGE_MALFORMED')
    return value.applied
  }
  async readTurn(id: string): Promise<StoredTurn | null> {
    const value = await this.call(`/material-results/page-study-read?id=${encodeURIComponent(id)}`)
    if (value.result === null) return null
    if (!isRecord(value.result) || value.result.id !== id || typeof value.result.content_hash !== 'string') throw new Error('PAGE_STUDY_STORAGE_MALFORMED')
    return { token: value.result.content_hash, id, record: readTurnRecord(parsePayload(value.result.payload)) }
  }
  async casTurn(id: string, scope: string, expectedToken: string | null, token: string, record: PageStudyTurnRecord): Promise<boolean> {
    const value = await this.call('/material-results/page-study-cas', { method: 'POST', body: JSON.stringify({ kind: 'turn', id, scope, revision: token, expectedRevision: expectedToken, payload: record }) })
    if (typeof value.applied !== 'boolean') throw new Error('PAGE_STUDY_STORAGE_MALFORMED')
    return value.applied
  }
  async listTurnsAfter(scope: string, afterSeq: number, limit: number): Promise<StoredTurn[]> {
    const value = await this.call(`/material-results/page-study-turns?scope=${encodeURIComponent(scope)}&afterSeq=${afterSeq}&limit=${limit}`)
    if (!Array.isArray(value.results)) throw new Error('PAGE_STUDY_STORAGE_MALFORMED')
    return value.results.map(row => {
      if (!isRecord(row) || typeof row.id !== 'string' || typeof row.content_hash !== 'string') throw new Error('PAGE_STUDY_STORAGE_MALFORMED')
      return { token: row.content_hash, id: row.id, record: readTurnRecord(parsePayload(row.payload)) }
    })
  }
}

export const newRevisionToken = (): string => randomUUID()
