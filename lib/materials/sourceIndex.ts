import { createHash } from 'node:crypto'
import { deriveAuthorizedPageUnits, deriveTextUnitsForKind, unitTypeForKind } from '../adaptive/sourceSelection'

// ============================================================
// Full Authorized Source Index — ALAI Chat's second authority
// alongside Material Brain (see AGENTS.md "canonical source
// identity"). Material Brain answers WHAT is relevant; this answers
// WHAT THE MATERIAL ACTUALLY SAYS, faithfully, for every selected
// page — including the tiny detail that never became a KnowledgeUnit.
//
// Deliberately reuses the SAME persisted, cached raw text
// (getMaterialText) and the SAME page/unit segmentation authority
// (deriveAuthorizedPageUnits / deriveTextUnitsForKind) that already
// power filterTextToSelectedPages/filterTextToSelectedUnits — no new
// PDF extraction, no second document-storage system.
// ============================================================

export interface AuthorizedSourceBlock {
  id: string
  materialId: string
  materialName: string
  page: number | null
  blockIndex: number
  text: string
  normalizedText: string
  derivation: 'text'
}

export interface SourceIndexMaterialSummary {
  materialId: string
  materialName: string
  pages: number[]
}

export interface SourceIndex {
  fingerprint: string
  blocks: AuthorizedSourceBlock[]
  materials: SourceIndexMaterialSummary[]
}

const MAX_BLOCK_CHARS = 1400

export function normalizeSourceText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stableBlockId(materialId: string, page: number | null, blockIndex: number): string {
  const key = `${materialId}:${page ?? 'x'}:${blockIndex}`
  return `block:${createHash('sha1').update(key).digest('hex').slice(0, 16)}`
}

/** Splits one page/unit's text into bounded sub-blocks on paragraph boundaries — keeps retrieval scoring and prompt size meaningful for very long pages. */
function splitIntoSubBlocks(text: string): string[] {
  const source = text.trim()
  if (source.length <= MAX_BLOCK_CHARS) return source ? [source] : []
  const paragraphs = source.split(/\n{2,}/).filter(p => p.trim())
  const blocks: string[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    if ((current + paragraph).length > MAX_BLOCK_CHARS && current) {
      blocks.push(current.trim())
      current = paragraph + '\n\n'
    } else {
      current += paragraph + '\n\n'
    }
  }
  if (current.trim()) blocks.push(current.trim())
  return blocks.length ? blocks : [source.slice(0, MAX_BLOCK_CHARS)]
}

export interface SourceIndexMaterialInput {
  materialId: string
  materialName: string
  kind: string
  rawText: string
  selectedPages: number[]
}

/**
 * Pure, deterministic — builds the full retrievable index for exactly
 * the authorized selection (only selected materials, only selected
 * pages/units). No LLM involved; faithful extracted text is the sole
 * authority for block content.
 */
export function buildSourceIndex(fingerprint: string, materials: SourceIndexMaterialInput[]): SourceIndex {
  const blocks: AuthorizedSourceBlock[] = []
  const materialSummaries: SourceIndexMaterialSummary[] = []

  for (const material of materials) {
    const type = unitTypeForKind(material.kind)
    const units = type === 'page'
      ? deriveAuthorizedPageUnits(material.rawText, material.selectedPages)
      : deriveTextUnitsForKind(material.rawText, material.kind, material.selectedPages)
        .map(unit => ({ page: null as number | null, text: unit.text }))

    let blockIndex = 0
    const pages: number[] = []
    for (const unit of units) {
      if (unit.page != null) pages.push(unit.page)
      for (const sub of splitIntoSubBlocks(unit.text)) {
        blocks.push({
          id: stableBlockId(material.materialId, unit.page, blockIndex),
          materialId: material.materialId,
          materialName: material.materialName,
          page: unit.page,
          blockIndex,
          text: sub,
          normalizedText: normalizeSourceText(sub),
          derivation: 'text',
        })
        blockIndex++
      }
    }
    materialSummaries.push({
      materialId: material.materialId, materialName: material.materialName,
      pages: Array.from(new Set(pages)).sort((a, b) => a - b),
    })
  }

  return { fingerprint, blocks, materials: materialSummaries }
}

// ============================================================
// Deterministic lexical retrieval — no embeddings/vector DB. Token
// overlap + exact-phrase bonus + explicit page-scope override.
// ============================================================

export interface SourceBlockMatch {
  block: AuthorizedSourceBlock
  score: number
  exactPhrase: boolean
}

function tokenize(normalizedText: string): string[] {
  return normalizedText.split(' ').filter(t => t.length >= 2)
}

export const STOPWORDS = new Set([
  'que', 'para', 'con', 'los', 'las', 'del', 'una', 'uno', 'por', 'como', 'esta', 'este', 'estos', 'estas',
  'sobre', 'entre', 'segun', 'es', 'la', 'el', 'en', 'de', 'se', 'su', 'sus', 'lo', 'al', 'un', 'y', 'o',
  'mi', 'tu', 'cual', 'cuales', 'quien', 'donde', 'cuando', 'the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'does', 'say', 'is', 'are',
])

export function searchSourceBlocks(
  index: SourceIndex, query: string, options: { pageFilter?: number[]; limit?: number } = {},
): SourceBlockMatch[] {
  const normalizedQuery = normalizeSourceText(query)
  const queryTokens = tokenize(normalizedQuery).filter(t => !STOPWORDS.has(t))
  const pool = options.pageFilter?.length
    ? index.blocks.filter(block => block.page != null && options.pageFilter!.includes(block.page))
    : index.blocks
  if (!queryTokens.length) return []

  const matches: SourceBlockMatch[] = []
  for (const block of pool) {
    const blockTokens = new Set(tokenize(block.normalizedText))
    let overlap = 0
    for (const token of queryTokens) if (blockTokens.has(token)) overlap++
    const exactPhrase = normalizedQuery.length >= 8 && block.normalizedText.includes(normalizedQuery)
    if (overlap === 0 && !exactPhrase) continue
    const score = overlap / queryTokens.length + (exactPhrase ? 1 : 0)
    matches.push({ block, score, exactPhrase })
  }
  matches.sort((a, b) => b.score - a.score || a.block.id.localeCompare(b.block.id))
  return matches.slice(0, options.limit ?? 8)
}

// ============================================================
// Per-fingerprint cache (Phase 17) — same fingerprint reuses the
// built index within the warm process; a new fingerprint (new
// selection) always builds a fresh one. Rebuilding is cheap (pure
// text segmentation over already-cached raw text — 0 provider/PDF
// calls), so this is a latency optimization, not a correctness
// requirement.
// ============================================================
const indexCache = new Map<string, SourceIndex>()

export function getCachedSourceIndex(fingerprint: string): SourceIndex | null {
  return indexCache.get(fingerprint) || null
}

export function setCachedSourceIndex(index: SourceIndex): void {
  indexCache.set(index.fingerprint, index)
}

export function __clearSourceIndexCache(): void {
  indexCache.clear()
}
