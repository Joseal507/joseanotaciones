import { createHash } from 'node:crypto'
import { getMaterialResult, saveMaterialResult } from './repository'
import type { MaterialResult } from './types'
import {
  VISUAL_PAGE_ANALYZER_VERSION,
  VISUAL_PAGE_MODEL,
  VISUAL_PAGE_PROMPT_VERSION,
  VISUAL_PAGE_PROVIDER,
  type VisualPageAnalysisResult,
} from './visualPageAnalysis'

export interface VisualPageCacheIdentity {
  materialFingerprint: string
  page: number
  pageFingerprint: string
  analyzerVersion: string
  promptVersion: string
  provider: string
  model: string
}

export type VisualPageCacheStatus = 'hit' | 'miss' | 'shared_inflight'

export interface VisualPageAnalysisCacheRecord extends VisualPageAnalysisResult {
  generatedAt: string
  cacheKey: string
  cacheIdentity: VisualPageCacheIdentity
  pageFingerprint: string
}

export interface VisualPageAnalysisCacheResult extends VisualPageAnalysisCacheRecord {
  cacheStatus: VisualPageCacheStatus
  analysisDurationMs?: number
}

export interface VisualPageAnalysisStore {
  get(identity: VisualPageCacheIdentity): Promise<VisualPageAnalysisCacheRecord | null>
  save(identity: VisualPageCacheIdentity, result: VisualPageAnalysisCacheRecord): Promise<void>
}

export interface BuildVisualPageCacheIdentityInput {
  materialFingerprint: string
  page: number
  pageFingerprint: string
  analyzerVersion?: string
  promptVersion?: string
  provider?: string
  model?: string
}

function canonicalIdentity(identity: VisualPageCacheIdentity): string {
  return JSON.stringify({
    materialFingerprint: identity.materialFingerprint,
    page: identity.page,
    pageFingerprint: identity.pageFingerprint,
    analyzerVersion: identity.analyzerVersion,
    promptVersion: identity.promptVersion,
    provider: identity.provider,
    model: identity.model,
  })
}

export function buildVisualPageCacheIdentity(
  input: BuildVisualPageCacheIdentityInput,
): VisualPageCacheIdentity {
  if (!input.materialFingerprint || !input.pageFingerprint) {
    throw new Error('VISUAL_PAGE_CACHE_IDENTITY_INCOMPLETE')
  }
  if (!Number.isInteger(input.page) || input.page < 1) {
    throw new Error('VISUAL_PAGE_CACHE_PAGE_INVALID')
  }
  return {
    materialFingerprint: input.materialFingerprint,
    page: input.page,
    pageFingerprint: input.pageFingerprint,
    analyzerVersion: input.analyzerVersion || VISUAL_PAGE_ANALYZER_VERSION,
    promptVersion: input.promptVersion || VISUAL_PAGE_PROMPT_VERSION,
    provider: input.provider || VISUAL_PAGE_PROVIDER,
    model: input.model || VISUAL_PAGE_MODEL,
  }
}

export function visualPageCacheKey(identity: VisualPageCacheIdentity): string {
  return createHash('sha256').update(canonicalIdentity(identity)).digest('hex')
}

function assertValidRecord(
  identity: VisualPageCacheIdentity,
  record: VisualPageAnalysisCacheRecord,
): void {
  const expectedKey = visualPageCacheKey(identity)
  if (!record || typeof record !== 'object'
    || record.cacheKey !== expectedKey
    || canonicalIdentity(record.cacheIdentity) !== canonicalIdentity(identity)
    || record.page !== identity.page
    || record.pageFingerprint !== identity.pageFingerprint
    || record.analyzerVersion !== identity.analyzerVersion
    || record.promptVersion !== identity.promptVersion
    || record.provider !== identity.provider
    || record.model !== identity.model
    || (record.status !== 'success' && record.status !== 'no_content')) {
    throw new Error(`VISUAL_PAGE_CACHE_CORRUPTED_PAYLOAD:${expectedKey}`)
  }
}

export class InMemoryVisualPageAnalysisStore implements VisualPageAnalysisStore {
  private readonly records = new Map<string, VisualPageAnalysisCacheRecord>()

  async get(identity: VisualPageCacheIdentity): Promise<VisualPageAnalysisCacheRecord | null> {
    return this.records.get(visualPageCacheKey(identity)) || null
  }

  async save(identity: VisualPageCacheIdentity, result: VisualPageAnalysisCacheRecord): Promise<void> {
    assertValidRecord(identity, result)
    this.records.set(visualPageCacheKey(identity), structuredClone(result))
  }
}

export const VISUAL_PAGE_CACHE_ENFOQUE = 'mixto' as const
export const VISUAL_PAGE_CACHE_RESULT_TYPE = 'visual_page_analysis' as const

function visualPageMaterialId(cacheKey: string): string {
  return `visual_page:${cacheKey}`
}

export interface WorkerVisualPageStoreDeps {
  getMaterialResult?: typeof getMaterialResult
  saveMaterialResult?: typeof saveMaterialResult
}

export class WorkerVisualPageAnalysisStore implements VisualPageAnalysisStore {
  private readonly getResult: (
    materialId: string,
    enfoque: typeof VISUAL_PAGE_CACHE_ENFOQUE,
    resultType: typeof VISUAL_PAGE_CACHE_RESULT_TYPE,
  ) => Promise<MaterialResult | null>
  private readonly saveResult: typeof saveMaterialResult

  constructor(deps: WorkerVisualPageStoreDeps = {}) {
    this.getResult = deps.getMaterialResult || getMaterialResult
    this.saveResult = deps.saveMaterialResult || saveMaterialResult
  }

  async get(identity: VisualPageCacheIdentity): Promise<VisualPageAnalysisCacheRecord | null> {
    const cacheKey = visualPageCacheKey(identity)
    const result = await this.getResult(
      visualPageMaterialId(cacheKey),
      VISUAL_PAGE_CACHE_ENFOQUE,
      VISUAL_PAGE_CACHE_RESULT_TYPE,
    )
    if (!result) return null
    const payload = result.payload as VisualPageAnalysisCacheRecord
    assertValidRecord(identity, payload)
    return payload
  }

  async save(identity: VisualPageCacheIdentity, result: VisualPageAnalysisCacheRecord): Promise<void> {
    assertValidRecord(identity, result)
    const cacheKey = visualPageCacheKey(identity)
    await this.saveResult({
      material_id: visualPageMaterialId(cacheKey),
      enfoque: VISUAL_PAGE_CACHE_ENFOQUE,
      result_type: VISUAL_PAGE_CACHE_RESULT_TYPE,
      payload: result,
      content_hash: cacheKey,
    })
  }
}

const inFlight = new Map<string, Promise<VisualPageAnalysisCacheRecord>>()

export interface GetOrAnalyzeVisualPageOptions {
  identity: VisualPageCacheIdentity
  store: VisualPageAnalysisStore
  analyze: () => Promise<VisualPageAnalysisResult>
  now?: () => Date
}

function asCacheRecord(
  identity: VisualPageCacheIdentity,
  result: VisualPageAnalysisResult,
  generatedAt: string,
): VisualPageAnalysisCacheRecord {
  return {
    ...result,
    page: identity.page,
    provider: identity.provider,
    model: identity.model,
    analyzerVersion: identity.analyzerVersion,
    promptVersion: identity.promptVersion,
    pageFingerprint: identity.pageFingerprint,
    generatedAt,
    cacheKey: visualPageCacheKey(identity),
    cacheIdentity: identity,
  }
}

export async function getOrAnalyzeVisualPage(
  options: GetOrAnalyzeVisualPageOptions,
): Promise<VisualPageAnalysisCacheResult> {
  const cacheKey = visualPageCacheKey(options.identity)
  const cached = await options.store.get(options.identity)
  if (cached) {
    assertValidRecord(options.identity, cached)
    return { ...cached, cacheStatus: 'hit' }
  }

  const shared = inFlight.get(cacheKey)
  if (shared) {
    const record = await shared
    return { ...record, cacheStatus: 'shared_inflight' }
  }

  const startedAt = Date.now()
  const operation = (async () => {
    const analyzed = await options.analyze()
    const record = asCacheRecord(
      options.identity,
      analyzed,
      (options.now || (() => new Date()))().toISOString(),
    )
    if (record.status === 'success' || record.status === 'no_content') {
      await options.store.save(options.identity, record)
    }
    return record
  })()
  inFlight.set(cacheKey, operation)

  try {
    const record = await operation
    return {
      ...record,
      cacheStatus: 'miss',
      analysisDurationMs: Date.now() - startedAt,
    }
  } finally {
    if (inFlight.get(cacheKey) === operation) inFlight.delete(cacheKey)
  }
}
