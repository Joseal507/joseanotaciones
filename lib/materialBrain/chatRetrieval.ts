import type { KnowledgeRelation, KnowledgeUnit, MaterialBrain } from './types'
import { liveKnowledgeUnits, liveRelationsAmong, primaryEvidenceFor } from './groundedContext'
import { normalizeSourceText, searchSourceBlocks, STOPWORDS, type AuthorizedSourceBlock, type SourceIndex } from '../materials/sourceIndex'

// ============================================================
// ALAI Chat retrieval — combines Material Brain (structured
// understanding) with the Full Authorized Source Index (faithful
// text) so a question can be answered from whichever authority
// actually has it, without ever sending the whole material every
// turn. Deterministic lexical/structural retrieval only — no
// embeddings/vector DB.
// ============================================================

export type ChatAnswerMode = 'MATERIAL_ONLY' | 'GENERAL_ONLY' | 'MIXED'

export interface ChatTurnGrounding {
  mode: ChatAnswerMode
  usedUnitIds: string[]
  usedRelationIds: string[]
  usedSourceBlockIds: string[]
  materialIds: string[]
  pages: number[]
}

export interface ChatRetrievalDiagnostics {
  explicitPages: number[]
  exactWordingIntent: boolean
  isFollowup: boolean
  brainMatches: number
  sourceMatches: number
  retrievalMs: number
}

export interface ChatRetrievalResult {
  brainUnits: KnowledgeUnit[]
  relations: KnowledgeRelation[]
  sourceBlocks: AuthorizedSourceBlock[]
  pages: number[]
  materials: string[]
  mode: ChatAnswerMode
  diagnostics: ChatRetrievalDiagnostics
}

// ─── Intent detection (deterministic, keyword-based) ────────────

const PAGE_QUERY_RE = /\b(?:p[aá]gina|p[aá]g\.?|pg\.?|page)\s*(\d{1,4})\b/gi

export function detectExplicitPages(query: string): number[] {
  const pages = new Set<number>()
  const re = new RegExp(PAGE_QUERY_RE)
  let match: RegExpExecArray | null
  while ((match = re.exec(query))) {
    const n = Number(match[1])
    if (Number.isFinite(n) && n > 0) pages.add(n)
  }
  return Array.from(pages).sort((a, b) => a - b)
}

const EXACT_WORDING_MARKERS = [
  'exactamente', 'textualmente', 'que dice', 'que decia', 'como lo explica', 'como lo dice',
  'que palabra usa', 'literal', 'literalmente', 'cita textual', 'la cita', 'palabra por palabra',
]

export function detectExactWordingIntent(query: string): boolean {
  const q = normalizeSourceText(query)
  return EXACT_WORDING_MARKERS.some(marker => q.includes(normalizeSourceText(marker)))
}

const FOLLOWUP_MARKERS = [
  'por que', 'y eso', 'explica eso', 'que significa eso', 'y por que', 'cuentame mas',
  'explicalo', 'y el segundo', 'y la segunda', 'y la primera', 'y el primero', 'que mas', 'y entonces',
]

export function detectFollowup(query: string): boolean {
  const q = normalizeSourceText(query)
  if (FOLLOWUP_MARKERS.some(marker => q.includes(marker))) return true
  const tokenCount = q.split(' ').filter(Boolean).length
  return tokenCount > 0 && tokenCount <= 4 && /\b(eso|ese|esa|esto|este|esta|aquello)\b/.test(q)
}

const MATERIAL_SCOPE_MARKERS = [
  'el material', 'mi material', 'el pdf', 'mi pdf', 'el documento', 'mi documento',
  'segun el material', 'en el material', 'que dice el material', 'que dice mi material',
]

export function isExplicitMaterialScopeQuery(query: string, explicitPages: number[]): boolean {
  if (explicitPages.length) return true
  if (detectExactWordingIntent(query)) return true
  const q = normalizeSourceText(query)
  return MATERIAL_SCOPE_MARKERS.some(marker => q.includes(normalizeSourceText(marker)))
}

// ─── Structured (Brain) match ────────────────────────────────────

function scoreUnitAgainstQuery(unit: KnowledgeUnit, queryTokens: string[], normalizedQuery: string): number {
  const haystack = normalizeSourceText(`${unit.label} ${unit.statement} ${unit.kind}`)
  const haystackTokens = new Set(haystack.split(' ').filter(Boolean).filter(t => !STOPWORDS.has(t)))
  let overlap = 0
  for (const token of queryTokens) if (haystackTokens.has(token)) overlap++
  const exactPhrase = normalizedQuery.length >= 6 && haystack.includes(normalizedQuery)
  return overlap + (exactPhrase ? 2 : 0)
}

export interface ChatRetrievalLimits { units?: number; relations?: number; blocks?: number }

export function retrieveForChat(params: {
  query: string
  brain: MaterialBrain | null
  sourceIndex: SourceIndex | null
  recentGrounding?: ChatTurnGrounding | null
  limits?: ChatRetrievalLimits
}): ChatRetrievalResult {
  const t0 = Date.now()
  const explicitPages = detectExplicitPages(params.query)
  const exactWordingIntent = detectExactWordingIntent(params.query)
  const isFollowup = detectFollowup(params.query)

  let brainUnits: KnowledgeUnit[] = []
  let relations: KnowledgeRelation[] = []
  if (params.brain) {
    const allLiveUnits = liveKnowledgeUnits(params.brain)
    // Phase 4 — explicit page scope dominates BOTH authorities: a
    // Brain unit whose primary evidence is on a different page must
    // not smuggle in a citation to that other page.
    const liveUnits = explicitPages.length
      ? allLiveUnits.filter(unit => {
          const page = primaryEvidenceFor(unit).page
          return page != null && explicitPages.includes(page)
        })
      : allLiveUnits
    const normalizedQuery = normalizeSourceText(params.query)
    const queryTokens = normalizedQuery.split(' ').filter(t => t.length >= 2 && !STOPWORDS.has(t))
    const scored = liveUnits
      .map(unit => ({ unit, score: scoreUnitAgainstQuery(unit, queryTokens, normalizedQuery) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.unit.id.localeCompare(b.unit.id))
    brainUnits = scored.slice(0, params.limits?.units ?? 8).map(entry => entry.unit)

    // Follow-up continuity: carry forward prior-turn grounded units even
    // if this turn's short query ("¿y por qué?") has no lexical overlap.
    if (isFollowup && params.recentGrounding?.usedUnitIds.length) {
      const seen = new Set(brainUnits.map(u => u.id))
      for (const id of params.recentGrounding.usedUnitIds) {
        const found = liveUnits.find(u => u.id === id)
        if (found && !seen.has(found.id)) { brainUnits.push(found); seen.add(found.id) }
      }
    }

    const unitIds = new Set(brainUnits.map(u => u.id))
    relations = liveRelationsAmong(unitIds, params.brain.relations || []).slice(0, params.limits?.relations ?? 12)
  }

  let sourceBlocks: AuthorizedSourceBlock[] = []
  if (params.sourceIndex) {
    if (explicitPages.length) {
      // Phase 4 — explicit page scope DOMINATES; never overridden by
      // semantic ranking. Blocks from the named page(s) always win,
      // ordered by lexical relevance within that scope.
      const matches = searchSourceBlocks(params.sourceIndex, params.query, { pageFilter: explicitPages, limit: 100 })
      sourceBlocks = matches.length
        ? matches.map(m => m.block)
        : params.sourceIndex.blocks.filter(b => b.page != null && explicitPages.includes(b.page))
    } else {
      const matches = searchSourceBlocks(params.sourceIndex, params.query, { limit: params.limits?.blocks ?? 6 })
      sourceBlocks = matches.map(m => m.block)
    }
    if (isFollowup && params.recentGrounding?.usedSourceBlockIds.length) {
      const seen = new Set(sourceBlocks.map(b => b.id))
      for (const id of params.recentGrounding.usedSourceBlockIds) {
        const found = params.sourceIndex.blocks.find(b => b.id === id)
        if (found && !seen.has(found.id)) { sourceBlocks.push(found); seen.add(found.id) }
      }
    }
  }

  // Phase 13 fallback is implicit here: brainUnits/sourceBlocks are
  // computed independently, so a detail absent from the Brain but
  // present in the source still surfaces via sourceBlocks alone.
  const groundingCount = brainUnits.length + sourceBlocks.length
  const mode: ChatAnswerMode = groundingCount === 0
    ? 'GENERAL_ONLY'
    : isExplicitMaterialScopeQuery(params.query, explicitPages) ? 'MATERIAL_ONLY' : 'MIXED'

  const materials = Array.from(new Set(sourceBlocks.map(b => b.materialId)))
  const pages = Array.from(new Set(sourceBlocks.map(b => b.page).filter((p): p is number => p != null))).sort((a, b) => a - b)

  return {
    brainUnits, relations, sourceBlocks, pages, materials, mode,
    diagnostics: { explicitPages, exactWordingIntent, isFollowup, brainMatches: brainUnits.length, sourceMatches: sourceBlocks.length, retrievalMs: Date.now() - t0 },
  }
}

/** Structured, id-tagged prompt block — the ONLY authorized content the provider may cite as "from the material". */
export function renderChatGroundedContext(retrieval: ChatRetrievalResult): string {
  const lines: string[] = []
  if (retrieval.brainUnits.length) {
    lines.push('=== ENTENDIMIENTO ESTRUCTURADO (Material Brain) ===')
    for (const unit of retrieval.brainUnits) {
      const primary = primaryEvidenceFor(unit)
      lines.push(`[BRAIN_UNIT ${unit.id}] kind=${unit.kind} importance=${unit.importance.tier}`)
      lines.push(`LABEL: ${unit.label}`)
      lines.push(`STATEMENT: ${unit.statement}`)
      if (primary.materialId) lines.push(`PROVENANCE: material=${primary.materialId} pagina=${primary.page ?? '?'}`)
      lines.push('')
    }
  }
  if (retrieval.relations.length) {
    lines.push('=== RELACIONES ===')
    for (const relation of retrieval.relations) {
      lines.push(`[BRAIN_RELATION ${relation.id}] type=${relation.type} ${relation.fromUnitId} -> ${relation.toUnitId}`)
      lines.push(`STATEMENT: ${relation.statement}`)
      lines.push('')
    }
  }
  if (retrieval.sourceBlocks.length) {
    lines.push('=== TEXTO FUENTE FIEL (extracción autorizada, palabra por palabra) ===')
    for (const block of retrieval.sourceBlocks) {
      lines.push(`[SOURCE_BLOCK ${block.id}] material=${block.materialId} (${block.materialName})${block.page != null ? ` pagina=${block.page}` : ''}`)
      lines.push(block.text)
      lines.push('')
    }
  }
  return lines.join('\n')
}
