import { createHash } from 'node:crypto'
import type { VisualPageAnalysisResult } from './visualPageAnalysisTypes'

export type SourceEvidenceDerivation = 'native_text' | 'ocr' | 'vision'

interface SourceEvidenceBase {
  materialId: string
  page: number
  derivation: SourceEvidenceDerivation
}

export interface NativeTextEvidence extends SourceEvidenceBase {
  derivation: 'native_text'
  quote: string
  chunkId?: string
}

export interface OcrTextEvidence extends SourceEvidenceBase {
  derivation: 'ocr'
  quote: string
  chunkId?: string
  extractorVersion?: string
  provider?: string
  model?: string
}

export interface SourceEvidenceRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface PdfPageAssetReference {
  kind: 'pdf_page'
  materialId: string
  page: number
  pageFingerprint: string
}

export interface VisualEvidence extends SourceEvidenceBase {
  derivation: 'vision'
  pageFingerprint: string
  assetRef?: PdfPageAssetReference
  region?: SourceEvidenceRegion
  description?: string
  analyzerVersion: string
  promptVersion: string
  provider?: string
  model?: string
}

export type SourceEvidence = NativeTextEvidence | OcrTextEvidence | VisualEvidence

export interface VisualAnalysisEvidenceOptions {
  materialId?: string
  assetRef?: PdfPageAssetReference
  region?: SourceEvidenceRegion
}

function normalizedString(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && normalizedString(value).length > 0
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isJsonSafe(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.every(item => isJsonSafe(item, seen))
  if (!isPlainObject(value)) return false
  return Object.entries(value).every(([key, item]) =>
    key.length > 0 && item !== undefined && isJsonSafe(item, seen))
}

function isValidRegion(value: unknown): value is SourceEvidenceRegion {
  if (!isPlainObject(value)) return false
  const { x, y, width, height } = value
  return [x, y, width, height].every(item =>
    typeof item === 'number' && Number.isFinite(item))
    && (x as number) >= 0
    && (y as number) >= 0
    && (width as number) > 0
    && (height as number) > 0
}

function isValidAssetRef(
  value: unknown,
  evidence: Pick<VisualEvidence, 'materialId' | 'page' | 'pageFingerprint'>,
): value is PdfPageAssetReference {
  if (!isPlainObject(value)) return false
  return value.kind === 'pdf_page'
    && value.materialId === evidence.materialId
    && value.page === evidence.page
    && value.pageFingerprint === evidence.pageFingerprint
}

export function validateSourceEvidence(value: unknown): value is SourceEvidence {
  if (!isPlainObject(value) || !isJsonSafe(value)) return false
  if (!isNonEmptyString(value.materialId)
    || !Number.isInteger(value.page)
    || (value.page as number) <= 0) return false

  if (value.derivation === 'native_text') {
    return isNonEmptyString(value.quote)
      && (value.chunkId === undefined || typeof value.chunkId === 'string')
  }

  if (value.derivation === 'ocr') {
    return isNonEmptyString(value.quote)
      && (value.chunkId === undefined || typeof value.chunkId === 'string')
      && (value.extractorVersion === undefined || typeof value.extractorVersion === 'string')
      && (value.provider === undefined || typeof value.provider === 'string')
      && (value.model === undefined || typeof value.model === 'string')
  }

  if (value.derivation === 'vision') {
    if ('quote' in value) return false
    const evidence = value as unknown as VisualEvidence
    return isNonEmptyString(evidence.pageFingerprint)
      && isNonEmptyString(evidence.analyzerVersion)
      && isNonEmptyString(evidence.promptVersion)
      && (evidence.description === undefined || typeof evidence.description === 'string')
      && (evidence.provider === undefined || typeof evidence.provider === 'string')
      && (evidence.model === undefined || typeof evidence.model === 'string')
      && (evidence.region === undefined || isValidRegion(evidence.region))
      && (evidence.assetRef === undefined || isValidAssetRef(evidence.assetRef, evidence))
  }

  return false
}

export function normalizeSourceEvidence(evidence: SourceEvidence): SourceEvidence {
  if (!validateSourceEvidence(evidence)) throw new Error('SOURCE_EVIDENCE_INVALID')
  const base = {
    materialId: normalizedString(evidence.materialId),
    page: evidence.page,
    derivation: evidence.derivation,
  }

  if (evidence.derivation === 'native_text') {
    return {
      ...base,
      derivation: 'native_text',
      quote: normalizedString(evidence.quote),
      ...(evidence.chunkId === undefined ? {} : { chunkId: normalizedString(evidence.chunkId) }),
    }
  }

  if (evidence.derivation === 'ocr') {
    return {
      ...base,
      derivation: 'ocr',
      quote: normalizedString(evidence.quote),
      ...(evidence.chunkId === undefined ? {} : { chunkId: normalizedString(evidence.chunkId) }),
      ...(evidence.extractorVersion === undefined ? {} : { extractorVersion: normalizedString(evidence.extractorVersion) }),
      ...(evidence.provider === undefined ? {} : { provider: normalizedString(evidence.provider) }),
      ...(evidence.model === undefined ? {} : { model: normalizedString(evidence.model) }),
    }
  }

  return {
    ...base,
    derivation: 'vision',
    pageFingerprint: normalizedString(evidence.pageFingerprint),
    ...(evidence.assetRef === undefined ? {} : { assetRef: { ...evidence.assetRef } }),
    ...(evidence.region === undefined ? {} : { region: { ...evidence.region } }),
    ...(evidence.description === undefined ? {} : { description: normalizedString(evidence.description) }),
    analyzerVersion: normalizedString(evidence.analyzerVersion),
    promptVersion: normalizedString(evidence.promptVersion),
    ...(evidence.provider === undefined ? {} : { provider: normalizedString(evidence.provider) }),
    ...(evidence.model === undefined ? {} : { model: normalizedString(evidence.model) }),
  }
}

function evidenceIdentityPayload(evidence: SourceEvidence): Record<string, unknown> {
  const normalized = normalizeSourceEvidence(evidence)
  if (normalized.derivation === 'native_text') {
    return {
      materialId: normalized.materialId,
      page: normalized.page,
      derivation: normalized.derivation,
      quote: normalized.quote,
      chunkId: normalized.chunkId || '',
    }
  }
  if (normalized.derivation === 'ocr') {
    return {
      materialId: normalized.materialId,
      page: normalized.page,
      derivation: normalized.derivation,
      quote: normalized.quote,
      chunkId: normalized.chunkId || '',
      extractorVersion: normalized.extractorVersion || '',
      provider: normalized.provider || '',
      model: normalized.model || '',
    }
  }
  return {
    materialId: normalized.materialId,
    page: normalized.page,
    derivation: normalized.derivation,
    pageFingerprint: normalized.pageFingerprint,
    region: normalized.region || null,
    assetRef: normalized.assetRef || null,
    description: normalized.description || '',
    analyzerVersion: normalized.analyzerVersion,
    promptVersion: normalized.promptVersion,
    provider: normalized.provider || '',
    model: normalized.model || '',
  }
}

export function sourceEvidenceId(evidence: SourceEvidence): string {
  return createHash('sha256')
    .update(JSON.stringify(evidenceIdentityPayload(evidence)))
    .digest('hex')
}

export function dedupeSourceEvidence(evidence: SourceEvidence[]): SourceEvidence[] {
  const byId = new Map<string, SourceEvidence>()
  for (const item of evidence) {
    const normalized = normalizeSourceEvidence(item)
    byId.set(sourceEvidenceId(normalized), normalized)
  }
  return [...byId.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, item]) => item)
}

export function mergeSourceEvidence(
  ...groups: ReadonlyArray<ReadonlyArray<SourceEvidence>>
): SourceEvidence[] {
  return dedupeSourceEvidence(groups.flatMap(group => [...group]))
}

export function visualAnalysisResultToEvidence(
  result: VisualPageAnalysisResult,
  options: VisualAnalysisEvidenceOptions = {},
): VisualEvidence | null {
  if (result.status !== 'success') return null
  const materialId = options.materialId || result.materialId
  if (!materialId || !result.pageFingerprint) {
    throw new Error('VISUAL_EVIDENCE_INCOMPLETE')
  }
  const assetRef = options.assetRef || {
    kind: 'pdf_page' as const,
    materialId,
    page: result.page,
    pageFingerprint: result.pageFingerprint,
  }
  const evidence: VisualEvidence = {
    materialId,
    page: result.page,
    derivation: 'vision',
    pageFingerprint: result.pageFingerprint,
    assetRef,
    ...(options.region === undefined ? {} : { region: options.region }),
    ...(result.visualDescription ? { description: result.visualDescription } : {}),
    analyzerVersion: result.analyzerVersion,
    promptVersion: result.promptVersion,
    provider: result.provider,
    model: result.model,
  }
  if (!validateSourceEvidence(evidence)) throw new Error('VISUAL_EVIDENCE_INVALID')
  return normalizeSourceEvidence(evidence) as VisualEvidence
}
