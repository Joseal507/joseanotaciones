export const PAGE_STUDY_BLOCK_PRESETS = [5, 10, 15, 20] as const
export const PAGE_STUDY_DEFAULT_BLOCK_SIZE = 15
// Browser-safe mirror of the frozen Page Study block contract. Keep this module free
// of imports from blocks.ts: that server graph reaches node:crypto through identity.ts.
export const PAGE_STUDY_MIN_BLOCK_SIZE = 1
export const PAGE_STUDY_MAX_BLOCK_SIZE = 50

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
