export const PAGE_STUDY_BLOCK_PRESETS = [5, 10, 15, 20] as const
export const PAGE_STUDY_DEFAULT_BLOCK_SIZE = 15
// Browser-safe mirror of the frozen Page Study block contract. Keep this module free
// of imports from blocks.ts: that server graph reaches node:crypto through identity.ts.
export const PAGE_STUDY_MIN_BLOCK_SIZE = 1
export const PAGE_STUDY_MAX_BLOCK_SIZE = 50

/** Documents at or below this length have no meaningful subdivision — studying "in one block" IS
 * studying the whole thing, so the setup step collapses to a single "material completo" choice
 * instead of a 5/10/15/20 decision that would all resolve to the same one-block plan anyway. */
const PAGE_STUDY_TINY_MATERIAL_MAX = 5

export interface AdaptiveBlockSizeChoice { size: number; label: string }
export interface AdaptiveBlockSizePlan {
  /** 'full': nothing to choose, study the whole material as one block. 'choices': offer `choices` + optional Custom. */
  mode: 'full' | 'choices'
  recommended: number
  choices: AdaptiveBlockSizeChoice[]
  showCustom: boolean
  /** Only set in 'full' mode: e.g. "2 páginas · material completo". */
  fullLabel?: string
}

/**
 * Phase 6I: replaces the Phase 5 "fixed presets filtered/unioned with the full length" rule with
 * an explicit bucketed progression — small documents get few choices, large documents get more
 * granularity, and the full material is always available:
 *   <=5    → [full]
 *   6–10   → [5, full]
 *   11–20  → [5, 10, full]
 *   21–30  → [5, 10, 15, full]
 *   31–40  → [5, 10, 15, 20, full]
 *   >40    → [5, 10, 15, 20, 25, full]
 * (deduplicated/sorted — e.g. 10 pages: bucket gives [5,10], not [5,10,10]). Custom is removed:
 * Phase 6J found no real product need for it once the bucketed choices always include the exact
 * full-document size. Bucketed by the LARGEST selected material in a multi-PDF selection — smaller
 * materials still each resolve to their own single block automatically (block size >= a material's
 * length collapses it to one block via `planMaterialBlocks`), never a phantom page range.
 *
 * `pageCounts` are per-material page counts of the CURRENTLY SELECTED materials (server-derived
 * truth, e.g. `material.pages_count`); unknown/zero entries are ignored. With no known counts at
 * all (data not loaded yet, or a kind Page Study can't page-count), this degrades to the original
 * fixed preset behavior rather than guessing — never a false "full material" claim.
 */
const BLOCK_SIZE_BUCKETS: ReadonlyArray<{ max: number; steps: readonly number[] }> = [
  { max: 10, steps: [5] },
  { max: 20, steps: [5, 10] },
  { max: 30, steps: [5, 10, 15] },
  { max: 40, steps: [5, 10, 15, 20] },
  { max: Infinity, steps: [5, 10, 15, 20, 25] },
]

export function adaptiveBlockSizeOptions(pageCounts: readonly unknown[]): AdaptiveBlockSizePlan {
  const known = pageCounts.map(Number).filter(n => Number.isInteger(n) && n > 0)
  if (!known.length) {
    return {
      mode: 'choices', recommended: PAGE_STUDY_DEFAULT_BLOCK_SIZE, showCustom: true,
      choices: PAGE_STUDY_BLOCK_PRESETS.map(size => ({ size, label: `${size} páginas` })),
    }
  }
  const maxPages = Math.max(...known)
  if (maxPages <= PAGE_STUDY_TINY_MATERIAL_MAX) {
    return { mode: 'full', recommended: maxPages, choices: [], showCustom: false, fullLabel: `${maxPages} página${maxPages === 1 ? '' : 's'} · material completo` }
  }
  const bucket = BLOCK_SIZE_BUCKETS.find(b => maxPages <= b.max)!
  const sizes = [...new Set([...bucket.steps.filter(size => size < maxPages), maxPages])].sort((a, b) => a - b)
  const recommended = sizes.includes(PAGE_STUDY_DEFAULT_BLOCK_SIZE) ? PAGE_STUDY_DEFAULT_BLOCK_SIZE : sizes[sizes.length - 1]
  return {
    mode: 'choices', recommended, showCustom: false,
    choices: sizes.map(size => ({ size, label: size === maxPages ? `${size} páginas (material completo)` : `${size} páginas` })),
  }
}

export interface PageStudyPublicTurn {
  seq: number
  role: string
  userMessage: string
  reply: string
  provenance: Array<{ materialId: string; pages: number[] }>
  navigation: { materialId: string; page: number } | null
  externalKnowledgeUsed: boolean
}

export function validatePageStudyBlockSize(value: unknown): number | null {
  const parsed = typeof value === 'string' && value.trim() === '' ? Number.NaN : Number(value)
  return Number.isInteger(parsed) && parsed >= PAGE_STUDY_MIN_BLOCK_SIZE && parsed <= PAGE_STUDY_MAX_BLOCK_SIZE ? parsed : null
}

export function normalizePublicTurns(value: unknown): PageStudyPublicTurn[] {
  if (!Array.isArray(value)) return []
  const bySequence = new Map<number, PageStudyPublicTurn>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const turn = raw as Record<string, unknown>
    const seq = Number(turn.seq)
    if (!Number.isInteger(seq) || seq < 1 || typeof turn.reply !== 'string') continue
    const provenance = Array.isArray(turn.provenance)
      ? turn.provenance.flatMap(item => {
          if (!item || typeof item !== 'object') return []
          const source = item as Record<string, unknown>
          const materialId = String(source.materialId || '')
          const pages = Array.isArray(source.pages)
            ? [...new Set(source.pages.map(Number).filter(page => Number.isInteger(page) && page > 0))].sort((a, b) => a - b)
            : []
          return materialId ? [{ materialId, pages }] : []
        })
      : []
    bySequence.set(seq, {
      seq,
      role: String(turn.role || ''),
      userMessage: typeof turn.userMessage === 'string' ? turn.userMessage : '',
      reply: turn.reply,
      provenance,
      navigation: turn.navigation && typeof turn.navigation === 'object'
        ? { materialId: String((turn.navigation as Record<string, unknown>).materialId || ''), page: Number((turn.navigation as Record<string, unknown>).page || 0) }
        : null,
      externalKnowledgeUsed: turn.externalKnowledgeUsed === true,
    })
  }
  return [...bySequence.values()].sort((a, b) => a.seq - b.seq)
}

export function compactPageList(pages: readonly number[]): string {
  const clean = [...new Set(pages.map(Number).filter(page => Number.isInteger(page) && page > 0))].sort((a, b) => a - b)
  if (!clean.length) return ''
  const ranges: string[] = []
  let start = clean[0]
  let previous = clean[0]
  for (let index = 1; index <= clean.length; index++) {
    const page = clean[index]
    if (page === previous + 1) { previous = page; continue }
    ranges.push(start === previous ? String(start) : `${start}–${previous}`)
    start = page
    previous = page
  }
  return ranges.join(', ')
}

export function safePageStudyMessage(payload: unknown, fallback = 'No pude continuar este turno. Inténtalo de nuevo.'): string {
  if (!payload || typeof payload !== 'object') return fallback
  const message = (payload as Record<string, unknown>).userMessage
  return typeof message === 'string' && message.trim() ? message.trim() : fallback
}
