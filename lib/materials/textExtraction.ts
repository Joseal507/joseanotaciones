import type { ExtractionResult } from './extractors'
import { extractText } from './extractors'
import {
  getMaterialText,
  resolveStudyKind,
  resolveStudyStorageKey,
  saveMaterialText,
  updateMaterialTextStatus,
} from './repository'
import { downloadFromR2 } from './storage'
import type { Material, TextStatus } from './types'

export interface MaterialTextExtractionResult {
  status: TextStatus
  text?: string
  error?: string
}

export interface MaterialTextExtractionDeps {
  getMaterialText?: typeof getMaterialText
  downloadFromR2?: typeof downloadFromR2
  extractText?: typeof extractText
  saveMaterialText?: typeof saveMaterialText
  updateMaterialTextStatus?: typeof updateMaterialTextStatus
}

const inFlight = new Map<string, Promise<MaterialTextExtractionResult>>()
export const TEXT_EXTRACTION_PROCESSING_STALE_MS = 3 * 60 * 1000

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || 'TEXT_EXTRACTION_FAILED')
  return raw
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/((?:api[_-]?key|token|secret|authorization))\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 500)
}

export async function ensureMaterialTextExtraction(
  material: Material,
  userId: string,
  deps: MaterialTextExtractionDeps = {},
): Promise<MaterialTextExtractionResult> {
  const existingFlight = inFlight.get(material.id)
  if (existingFlight) return existingFlight

  const task = runMaterialTextExtraction(material, userId, deps)
  inFlight.set(material.id, task)
  try {
    return await task
  } finally {
    if (inFlight.get(material.id) === task) inFlight.delete(material.id)
  }
}

async function runMaterialTextExtraction(
  material: Material,
  userId: string,
  deps: MaterialTextExtractionDeps,
): Promise<MaterialTextExtractionResult> {
  const loadText = deps.getMaterialText || getMaterialText
  const existingText = (await loadText(material.id))?.raw_text?.trim() || ''
  const updateStatus = deps.updateMaterialTextStatus || updateMaterialTextStatus
  if (existingText) {
    if (material.text_status !== 'ready') {
      await updateStatus(material.id, userId, 'ready', { extracted_chars: existingText.length })
    }
    return { status: 'ready', text: existingText }
  }
  if (material.text_status === 'ready' || material.text_status === 'error') {
    return { status: material.text_status }
  }
  if (material.text_status === 'processing') {
    const updatedAt = new Date(material.updated_at).getTime()
    const isRecent = Number.isFinite(updatedAt)
      && Date.now() - updatedAt < TEXT_EXTRACTION_PROCESSING_STALE_MS
    if (isRecent) return { status: 'processing' }
    // Un processing abandonado no bloquea el material para siempre. La misma
    // operación idempotente vuelve a reclamarlo después del TTL.
  }

  try {
    await updateStatus(material.id, userId, 'processing')
    const download = deps.downloadFromR2 || downloadFromR2
    const runExtraction = deps.extractText || extractText
    const buffer = await download(resolveStudyStorageKey(material))
    const extraction: ExtractionResult = await runExtraction(
      buffer,
      resolveStudyKind(material),
      material.mime_type,
      material.nombre,
    )
    if (!extraction.hasText || !extraction.text.trim()) {
      throw new Error(`TEXT_EXTRACTION_EMPTY:${extraction.method}`)
    }
    const saveText = deps.saveMaterialText || saveMaterialText
    await saveText(material.id, extraction.text)
    await updateStatus(material.id, userId, 'ready', {
      extracted_chars: extraction.text.length,
      pages_count: extraction.pages,
    })
    return { status: 'ready', text: extraction.text }
  } catch (error) {
    const message = safeErrorMessage(error)
    await updateStatus(material.id, userId, 'error', { last_error: message }).catch(() => undefined)
    return { status: 'error', error: message }
  }
}
