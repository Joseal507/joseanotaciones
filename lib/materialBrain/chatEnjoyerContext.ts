import { resolveMaterialLanguage, academicLanguageInstruction } from '../materialLanguage'
import type { SourceSelectionSnapshot } from '../adaptive/sourceSelection'
import { CHAT_LIMITS, type ChatEvidence, type RetrievalOutcome, type SourcePolicy } from '../alai-chat/contracts'
import { detectChatIntent, detectSourcePolicy } from '../alai-chat/intent'

// ============================================================
// ALAI Chat Enjoyer adapter + retrieval — Free Mode MAIN Chat's own
// neutral view of the persisted StudyalMaterialEnjoyer, plus the
// deterministic bounded-retrieval layer that decides which canonical
// targets a given student question actually needs. Self-contained (not
// importing lib/materialBrain/chatRetrieval.ts or any other tool's
// adapter): same isolation convention already used across every Enjoyer
// migration (Exam, Flashcards, Truquitos, Análisis, Study Map).
//
// Academic authority is EXACTLY the persisted Enjoyer for this exact
// SourceSelectionSnapshot fingerprint. No Brain-based knowledge units,
// no raw material text/PDF re-read, no Vision, no
// regeneration, no second LLM planning pass — retrieval below is pure
// deterministic lexical/structural scoring, never an AI call.
// ============================================================

export const CHAT_ENJOYER_AUTHORITY_TYPE = 'studyal_material_enjoyer' as const
export const CHAT_ENJOYER_ADAPTER_VERSION = 'chat-enjoyer-1.0.0'

export type ChatImportanceTier = 'critical' | 'supporting' | 'contextual'

export interface ChatEnjoyerSourceSpan { page: number; quote: string }

export interface ChatEnjoyerTarget {
  id: string
  sourceItemId: string
  relationIds: string[]
  kind: string
  importance: number
  importanceTier: ChatImportanceTier
  difficulty: string
  materialId: string | null
  topicId: string | null
  topicTitle: string | null
  pages: number[]
  label: string
  content: string
  sourceSpans: ChatEnjoyerSourceSpan[]
  sourceOrder: number
}

export interface ChatEnjoyerRelation {
  id: string
  type: string
  fromSourceItemId: string
  toSourceItemId: string
}

export interface ChatEnjoyerContext {
  materialLanguage?: string
  fingerprint: string
  targets: ChatEnjoyerTarget[]
  relations: ChatEnjoyerRelation[]
}

type EnjoyerAuthority = {
  sourceSelectionFingerprint?: unknown
  materialIds?: unknown
  selectedPages?: unknown
  sourceSelection?: { materialIds?: unknown; selectedPages?: unknown }
  topicsIndex?: unknown
  globalOrderedAnalysis?: unknown
  uniqueConceptsIndex?: unknown
  relations?: unknown
}

const NON_ACADEMIC_KINDS = new Set(['metadata', 'decorative', 'divider', 'heading'])

function normalize(value: unknown): string {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(String).map(item => item.trim()).filter(Boolean))] : []
}

function pages(value: unknown): number[] {
  return Array.isArray(value)
    ? [...new Set(value.map(Number).filter(page => Number.isInteger(page) && page > 0))].sort((a, b) => a - b)
    : []
}

function spans(value: unknown): ChatEnjoyerSourceSpan[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap(raw => {
    const source = raw as Record<string, unknown>
    const page = Number(source.page)
    const quote = String(source.quote || source.text || '').trim()
    const key = `${page}:${quote}`
    if (!Number.isInteger(page) || page < 1 || !quote || seen.has(key)) return []
    seen.add(key)
    return [{ page, quote }]
  })
}

function importanceTier(value: unknown): ChatImportanceTier {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric >= 80 ? 'critical' : numeric >= 50 ? 'supporting' : 'contextual'
  const key = normalize(value)
  if (key === 'critical' || key === 'high') return 'critical'
  if (key === 'supporting' || key === 'medium') return 'supporting'
  return 'contextual'
}

function importanceNumber(value: unknown): number {
  if (Number.isFinite(Number(value))) return Math.max(0, Math.min(100, Number(value)))
  const key = normalize(value)
  if (key === 'critical' || key === 'high') return 90
  if (key === 'supporting' || key === 'medium') return 60
  return 35
}

function authorityFrom(payload: unknown): EnjoyerAuthority {
  const wrapper = payload as { blueprint?: EnjoyerAuthority } | null
  return (wrapper?.blueprint || payload || {}) as EnjoyerAuthority
}

function assertSelectionMetadata(authority: EnjoyerAuthority, selection: SourceSelectionSnapshot): void {
  if (String(authority.sourceSelectionFingerprint || '') !== selection.fingerprint) throw new Error('SOURCE_SELECTION_MISMATCH')
  const persistedMaterialIds = Array.isArray(authority.materialIds ?? authority.sourceSelection?.materialIds)
    ? strings(authority.materialIds ?? authority.sourceSelection?.materialIds).sort() : []
  if (persistedMaterialIds.length && JSON.stringify(persistedMaterialIds) !== JSON.stringify([...selection.materialIds].sort())) {
    throw new Error('SOURCE_SELECTION_MISMATCH')
  }
  const rawSelectedPages = authority.selectedPages ?? authority.sourceSelection?.selectedPages
  if (rawSelectedPages && typeof rawSelectedPages === 'object') {
    const actual = rawSelectedPages as Record<string, unknown>
    for (const materialId of selection.materialIds) {
      if (JSON.stringify(pages(actual[materialId])) !== JSON.stringify(pages(selection.selectedPages[materialId]))) {
        throw new Error('SOURCE_SELECTION_MISMATCH')
      }
    }
  }
}

/**
 * Builds the full canonical Chat target/relation universe from a
 * persisted Enjoyer payload for the EXACT requested source selection.
 * Never builds, never regenerates, never falls back to a different
 * fingerprint — throws SOURCE_SELECTION_MISMATCH on any mismatch, the
 * same restore-only contract already proven for every other Enjoyer
 * migration. This is the FULL universe — retrieveForChat() below is
 * what bounds it per-question; nothing here is ever sent to the
 * provider directly.
 */
export function buildChatEnjoyerContext(payload: unknown, selection: SourceSelectionSnapshot): ChatEnjoyerContext {
  const authority = authorityFrom(payload)
  assertSelectionMetadata(authority, selection)
  const selectedPages = new Map(selection.materials.map(material => [material.materialId, new Set(material.selectedPages)]))
  const topics = (Array.isArray(authority.topicsIndex) ? authority.topicsIndex : []).map((raw, index) => {
    const topic = raw as Record<string, unknown>
    return { id: String(topic.id || `topic_${index}`), title: String(topic.title || topic.name || '').trim(), order: Number(topic.order ?? index) }
  })
  const topicTitles = new Map(topics.map(topic => [topic.id, topic.title]))
  const rawItems = [
    ...(Array.isArray(authority.globalOrderedAnalysis) ? authority.globalOrderedAnalysis : []),
    ...(Array.isArray(authority.uniqueConceptsIndex) ? authority.uniqueConceptsIndex : []),
  ]

  const seenIds = new Set<string>()
  const seenExactContent = new Set<string>()
  const targets: ChatEnjoyerTarget[] = []
  for (const [index, raw] of rawItems.entries()) {
    const item = raw as Record<string, unknown>
    const sourceItemId = String(item.id || '').trim()
    const label = String(item.name || item.label || item.title || '').trim()
    const content = String(item.summary || item.content || item.statement || '').trim()
    const kind = String(item.kind || 'academic_item').trim()
    if (!sourceItemId || seenIds.has(sourceItemId) || !label || !content) continue
    if (NON_ACADEMIC_KINDS.has(normalize(kind))) continue
    const materialIds = strings(item.materialIds)
    const materialId = String(item.materialId || (materialIds.length === 1 ? materialIds[0] : '') || (selection.materialIds.length === 1 ? selection.materialIds[0] : '') || '')
    // Identity is scoped per material: identical wording in two materials is two independent sources.
    const exactIdentity = `${materialId}::${normalize(label)}::${normalize(content)}`
    if (seenExactContent.has(exactIdentity)) continue
    const itemSpans = spans(item.sourceSpans)
    const itemPages = pages(item.pages).length ? pages(item.pages) : pages(itemSpans.map(span => span.page))
    const authorized = selectedPages.get(materialId)
    if (!authorized || itemPages.some(page => !authorized.has(page))) throw new Error('SOURCE_SELECTION_MISMATCH')
    const topicIds = strings(item.topicIds)
    const topicId = String(item.topicId || topicIds[0] || '') || null
    seenIds.add(sourceItemId)
    seenExactContent.add(exactIdentity)
    targets.push({
      id: `chat_target:${sourceItemId}`, sourceItemId, relationIds: [],
      kind, importance: importanceNumber(item.importance ?? item.importanceTier), importanceTier: importanceTier(item.importance ?? item.importanceTier),
      difficulty: String(item.difficulty || 'medium'), materialId: materialId || null,
      topicId, topicTitle: topicId ? topicTitles.get(topicId) || null : null,
      pages: pages([...itemPages, ...itemSpans.filter(span => authorized.has(span.page)).map(span => span.page)]),
      label, content, sourceSpans: itemSpans.filter(span => authorized.has(span.page)),
      sourceOrder: Number(item.globalOrder ?? item.firstAppearanceOrder ?? index),
    })
  }
  targets.sort((a, b) => a.sourceOrder - b.sourceOrder || a.id.localeCompare(b.id))

  const sourceIds = new Set(targets.map(target => target.sourceItemId))
  const targetBySourceItemId = new Map(targets.map(target => [target.sourceItemId, target]))
  const rawRelations = [
    ...(Array.isArray(authority.relations) ? authority.relations : []),
    ...rawItems.flatMap(raw => Array.isArray((raw as any)?.relations) ? (raw as any).relations : []),
  ]
  const relations: ChatEnjoyerRelation[] = []
  const seenRelations = new Set<string>()
  for (const [index, raw] of rawRelations.entries()) {
    const relation = raw as Record<string, unknown>
    const from = String(relation.fromSourceItemId || relation.fromId || relation.sourceId || '').trim()
    const to = String(relation.toSourceItemId || relation.toId || relation.targetId || '').trim()
    if (!sourceIds.has(from) || !sourceIds.has(to) || from === to) continue // dangling/self relations dropped — never fabricated
    const type = String(relation.type || relation.kind || 'related').trim()
    const id = String(relation.id || `relation_${index}`)
    const key = `${from}::${type}::${to}`
    if (seenRelations.has(key)) continue
    seenRelations.add(key)
    relations.push({ id, type, fromSourceItemId: from, toSourceItemId: to })
    targetBySourceItemId.get(from)?.relationIds.push(id)
    targetBySourceItemId.get(to)?.relationIds.push(id)
  }

  return { materialLanguage: resolveMaterialLanguage(payload), fingerprint: selection.fingerprint, targets, relations }
}

// ============================================================
// Query-intent detection — deterministic, keyword-based. Intentionally
// duplicated (not imported) from lib/materialBrain/chatRetrieval.ts,
// which remains the untouched retrieval layer for every OTHER caller of
// /api/alai-studyal-chat (Análisis's doubt chat, Study Map's legacy
// chat explanation) — same isolation convention as every adapter above.
// ============================================================

const PAGE_QUERY_RE = /\b(?:p[aá]gina|p[aá]g\.?|pg\.?|page)\s*(\d{1,4})\b/gi

export function detectExplicitPages(query: string): number[] {
  const found = new Set<number>()
  const re = new RegExp(PAGE_QUERY_RE)
  let match: RegExpExecArray | null
  while ((match = re.exec(query))) {
    const n = Number(match[1])
    if (Number.isFinite(n) && n > 0) found.add(n)
  }
  return Array.from(found).sort((a, b) => a - b)
}

const EXACT_WORDING_MARKERS = [
  'exactamente', 'textualmente', 'que dice', 'que decia', 'como lo explica', 'como lo dice',
  'que palabra usa', 'literal', 'literalmente', 'cita textual', 'la cita', 'palabra por palabra',
]

export function detectExactWordingIntent(query: string): boolean {
  const q = normalize(query)
  return EXACT_WORDING_MARKERS.some(marker => q.includes(normalize(marker)))
}

const FOLLOWUP_MARKERS = [
  'y eso', 'explica eso', 'que significa eso', 'y por que', 'cuentame mas',
  'explicalo', 'y el segundo', 'y la segunda', 'y la primera', 'y el primero', 'que mas', 'y entonces',
]

export function detectFollowup(query: string): boolean {
  if (detectChatIntent(query).followup) return true
  const q = normalize(query)
  const qWords = q.split(' ').filter(Boolean)
  if ((q.startsWith('por que') || q.startsWith('y por que') || q.startsWith('pero por que')) && qWords.length <= 6) return true
  if (FOLLOWUP_MARKERS.some(marker => q.includes(marker))) return true
  return qWords.length > 0 && qWords.length <= 4 && /\b(eso|ese|esa|esto|este|esta|aquello)\b/.test(q)
}

const MATERIAL_SCOPE_MARKERS = [
  'el material', 'mi material', 'el pdf', 'mi pdf', 'el documento', 'mi documento',
  'segun el material', 'en el material', 'que dice el material', 'que dice mi material',
]

export function isExplicitMaterialScopeQuery(query: string, explicitPages: number[]): boolean {
  if (explicitPages.length) return true
  if (detectExactWordingIntent(query)) return true
  const q = normalize(query)
  return MATERIAL_SCOPE_MARKERS.some(marker => q.includes(normalize(marker)))
}

const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a', 'en', 'y', 'o', 'que',
  'es', 'son', 'para', 'por', 'con', 'sin', 'su', 'sus', 'lo', 'como', 'se', 'me', 'te', 'le', 'les',
  'mi', 'tu', 'este', 'esta', 'esto', 'ese', 'esa', 'eso', 'the', 'a', 'an', 'of', 'in', 'on', 'is', 'are',
])

const INSTRUCTIONAL_WORDS = new Set([
  'resuelve', 'resolver', 'resolucion', 'soluciona', 'solucionar', 'calcula', 'calcular', 'calculo',
  'explica', 'explicame', 'explicar', 'explicacion', 'explicalo', 'explicala', 'dime', 'dame',
  'muestra', 'muestrame', 'haz', 'hazme', 'hacer', 'haces', 'pon', 'ponme', 'escribe', 'escribeme',
  'indica', 'indicame', 'detalla', 'desarrolla', 'desarrollame', 'cuenta', 'cuentame',
  'corrige', 'corregir', 'correccion', 'convierte', 'transforma',
  'paso', 'pasos', 'cada', 'tabla', 'cuadro', 'grafica', 'grafico', 'graficame', 'graficalo', 'graficala',
  'timeline', 'cronologia', 'linea', 'tiempo', 'lista', 'vinetas', 'bullet', 'bullets',
  'resumen', 'resumir', 'resumelo', 'resumela', 'breve', 'brevemente', 'corto', 'profundo', 'profundidad',
  'detalle', 'detallado', 'detallada', 'ejemplo', 'ejemplos', 'ejercicio', 'ejercicios',
  'define', 'definir', 'definicion', 'definiciones', 'compara', 'comparar', 'comparacion', 'comparalo', 'comparala',
  'contrasta', 'contrastar', 'diferencia', 'diferencias', 'semejanza', 'semejanzas',
  'por', 'que', 'porque', 'como', 'cual', 'cuales', 'quien', 'quienes', 'donde', 'cuando', 'cuanto', 'cuanta', 'cuantos', 'cuantas',
  'otro', 'otra', 'otros', 'otras', 'parecido', 'parecida', 'parecidos', 'parecidas',
  'anterior', 'anteriores', 'siguiente', 'siguientes',
  'primero', 'primera', 'segundo', 'segunda', 'tercero', 'tercera', 'cuarto', 'cuarta', 'quinto', 'quinta',
  'mas', 'menos', 'bien', 'mal', 'correcto', 'incorrecto', 'error', 'errores',
  'parrafo', 'texto', 'frase', 'oracion', 'palabra', 'palabras', 'idea', 'ideas',
  'material', 'pdf', 'documento',
  'solve', 'solving', 'solution', 'calculate', 'calculating', 'explain', 'explaining', 'explanation',
  'show', 'give', 'tell', 'make', 'write', 'describe', 'convert', 'correct',
  'step', 'steps', 'table', 'graph', 'chart', 'plot', 'timeline', 'list', 'bullets',
  'summary', 'summarize', 'brief', 'short', 'shorter', 'deep', 'deeper', 'detail', 'detailed',
  'example', 'examples', 'exercise', 'exercises', 'define', 'definition', 'definitions',
  'compare', 'comparison', 'contrast', 'difference', 'differences',
  'what', 'why', 'how', 'which', 'who', 'where', 'when',
  'next', 'previous', 'first', 'second', 'third', 'fourth', 'fifth',
  'more', 'less', 'word', 'words', 'paragraph', 'sentence',
])

function scoreTargetAgainstQuery(target: ChatEnjoyerTarget, queryTokens: string[], normalizedQuery: string): number {
  const haystack = normalize(`${target.label} ${target.content} ${target.kind}`)
  const haystackTokens = new Set(haystack.split(' ').filter(Boolean).filter(t => !STOPWORDS.has(t) && !INSTRUCTIONAL_WORDS.has(t)))
  let overlap = 0
  for (const token of queryTokens) if (haystackTokens.has(token)) overlap++
  const exactPhrase = normalizedQuery.length >= 6 && haystack.includes(normalizedQuery)
  const titleMatch = normalize(target.label).includes(normalizedQuery) && normalizedQuery.length >= 3
  return overlap + (exactPhrase ? 2 : 0) + (titleMatch ? 3 : 0)
}

export type ChatAnswerMode = 'MATERIAL_ONLY' | 'GENERAL_ONLY' | 'MIXED'

export interface ChatTurnGrounding {
  mode: ChatAnswerMode
  usedTargetIds: string[]
  usedRelationIds: string[]
  materialIds: string[]
  pages: number[]
}

export interface ChatRetrievalDiagnostics {
  explicitPages: number[]
  exactWordingIntent: boolean
  isFollowup: boolean
  targetMatches: number
  retrievalMs: number
}

export interface ChatRetrievalResult {
  materialLanguage?: string
  targets: ChatEnjoyerTarget[]
  relations: ChatEnjoyerRelation[]
  pages: number[]
  materials: string[]
  mode: ChatAnswerMode
  materialRetrievalOutcome: RetrievalOutcome
  evidence: ChatEvidence[]
  diagnostics: ChatRetrievalDiagnostics
}

export interface ChatRetrievalLimits { targets?: number; relations?: number; maxChars?: number }

const DEFAULT_TARGET_LIMIT = 10
const DEFAULT_RELATION_LIMIT = 12
const DEFAULT_MAX_CHARS = 8000

/**
 * Deterministic bounded retrieval — NO provider call. Given the current
 * question (+ optional prior-turn grounding for follow-up continuity),
 * selects the smallest relevant set of canonical Enjoyer targets:
 *  1. explicit page mentions dominate — only targets on those pages;
 *  2. otherwise, lexical/label overlap scoring against all targets;
 *  3. explicit relation neighbors of an already-selected target receive
 *     a small deterministic boost — connectivity only, no semantic
 *     claim about what the relation *means*;
 *  4. follow-up continuity carries forward the prior turn's used target
 *     ids (validated against THIS exact universe) even with no lexical
 *     overlap in a short follow-up question;
 *  5. hard-capped by target count AND total rendered character budget —
 *     never the whole Enjoyer universe, regardless of material size.
 */
export function retrieveForChat(params: {
  query: string
  context: ChatEnjoyerContext
  recentGrounding?: ChatTurnGrounding | null
  limits?: ChatRetrievalLimits
  sourcePolicy?: SourcePolicy
  followup?: boolean
  prioritize?: boolean
}): ChatRetrievalResult {
  const t0 = Date.now()
  const { targets: allTargets, relations: allRelations } = params.context
  const query = params.query.slice(0, CHAT_LIMITS.queryChars)
  const explicitPages = detectExplicitPages(query)
  const exactWordingIntent = detectExactWordingIntent(query)
  const isFollowup = params.followup ?? detectFollowup(query)
  const bound = (n: number | undefined, cap: number) => Number.isFinite(n) ? Math.max(0, Math.min(cap, Math.floor(n!))) : cap
  const targetLimit = bound(params.limits?.targets, DEFAULT_TARGET_LIMIT)
  const relationLimit = bound(params.limits?.relations, DEFAULT_RELATION_LIMIT)
  const maxChars = bound(params.limits?.maxChars, DEFAULT_MAX_CHARS)
  const mode = params.sourcePolicy || detectSourcePolicy(query)
    || (isExplicitMaterialScopeQuery(query, explicitPages) ? 'MATERIAL_ONLY' : isFollowup ? params.recentGrounding?.mode : undefined) || 'MIXED'

  const scopedTargets = explicitPages.length
    ? allTargets.filter(target => target.pages.some(page => explicitPages.includes(page)))
    : allTargets

  const normalizedQuery = normalize(query)
  const queryTokens = normalizedQuery.split(' ').filter(t => t.length >= 2 && !STOPWORDS.has(t) && !INSTRUCTIONAL_WORDS.has(t))
  const scored = scopedTargets
    .map(target => ({ target, score: scoreTargetAgainstQuery(target, queryTokens, normalizedQuery) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.target.id.localeCompare(b.target.id))

  let selected: ChatEnjoyerTarget[] = scored.slice(0, targetLimit).map(entry => entry.target)
  if (params.prioritize && mode !== 'GENERAL_ONLY') {
    // Navigation questions need the existing Enjoyer importance ranking, even
    // when they name no academic concept. Still apply the exact same bounds.
    selected = [...(selected.length ? selected : scopedTargets)]
      .sort((a, b) => b.importance - a.importance || a.sourceOrder - b.sourceOrder)
      .slice(0, targetLimit)
  }

  // Explicit relation neighbors of an already-selected target — bounded,
  // connectivity-only boost. Never asserts what relation.type means.
  if (selected.length && selected.length < targetLimit) {
    const selectedIds = new Set(selected.map(target => target.id))
    const targetBySourceItemId = new Map(allTargets.map(target => [target.sourceItemId, target]))
    for (const relation of allRelations) {
      if (selected.length >= targetLimit) break
      const fromTarget = targetBySourceItemId.get(relation.fromSourceItemId)
      const toTarget = targetBySourceItemId.get(relation.toSourceItemId)
      if (!fromTarget || !toTarget) continue
      const known = selectedIds.has(fromTarget.id) ? toTarget : selectedIds.has(toTarget.id) ? fromTarget : null
      if (!known || selectedIds.has(known.id) || !scopedTargets.includes(known)) continue
      selected.push(known)
      selectedIds.add(known.id)
    }
  }

  // Follow-up continuity: carry forward prior-turn grounded targets even
  // if this turn's short query ("¿y si es mayor?") has no lexical
  // overlap. recentGrounding ids are validated against THIS exact
  // target universe below — never trusted blindly (security §15).
  if (isFollowup && params.recentGrounding?.usedTargetIds.length) {
    const targetById = new Map(scopedTargets.map(target => [target.id, target]))
    const seen = new Set(selected.map(target => target.id))
    const inherited: ChatEnjoyerTarget[] = []
    for (const id of params.recentGrounding.usedTargetIds.slice(0, targetLimit)) {
      const found = targetById.get(id)
      if (found) { inherited.push(found); seen.add(found.id) }
    }
    selected = [...inherited, ...selected.filter(target => !inherited.includes(target))].slice(0, targetLimit)
  }

  // Character budget — trim lowest-scored/continuity-only entries first
  // if the rendered context would exceed the bound, never the whole
  // universe regardless of material size.
  const withinBudget: ChatEnjoyerTarget[] = []
  for (const target of selected) {
    // Include headers, IDs, quotes and newlines. Never truncate an academic target.
    if (renderChatEnjoyerContext({ targets: [...withinBudget, target], relations: [] }).length <= maxChars) withinBudget.push(target)
  }
  selected = mode === 'GENERAL_ONLY' ? [] : withinBudget

  const selectedIds = new Set(selected.map(target => target.id))
  const candidateRelations = allRelations
    .filter(relation => {
      const fromId = allTargets.find(t => t.sourceItemId === relation.fromSourceItemId)?.id
      const toId = allTargets.find(t => t.sourceItemId === relation.toSourceItemId)?.id
      return fromId && toId && selectedIds.has(fromId) && selectedIds.has(toId)
    })
    .slice(0, relationLimit)

  const relations: ChatEnjoyerRelation[] = []
  for (const relation of candidateRelations) {
    if (renderChatEnjoyerContext({ targets: selected, relations: [...relations, relation] }).length <= maxChars) relations.push(relation)
  }

  const materials = Array.from(new Set(selected.map(target => target.materialId).filter((id): id is string => Boolean(id))))
  const pages = Array.from(new Set(selected.flatMap(target => target.pages))).sort((a, b) => a - b)

  return {
    materialLanguage: params.context.materialLanguage,
    targets: selected, relations, pages, materials, mode,
    materialRetrievalOutcome: mode === 'GENERAL_ONLY' ? 'not_checked' : selected.length ? 'supported' : 'no_relevant_target',
    evidence: selected.flatMap(target => target.materialId ? [{ targetId: target.id, materialId: target.materialId, pages: target.pages }] : []),
    diagnostics: { explicitPages, exactWordingIntent, isFollowup, targetMatches: selected.length, retrievalMs: Date.now() - t0 },
  }
}

/** Structured, id-tagged prompt block — the ONLY authorized content the provider may cite as "from the material". Bounded by retrieveForChat(), never the whole Enjoyer universe. */
export function renderChatEnjoyerContext(retrieval: Pick<ChatRetrievalResult, 'targets' | 'relations' | 'materialLanguage'>): string {
  const lines: string[] = [academicLanguageInstruction(retrieval.materialLanguage, true)]
  if (retrieval.targets.length) {
    lines.push('=== MATERIAL AUTORIZADO (StudyalMaterialEnjoyer) ===')
    for (const target of retrieval.targets) {
      lines.push(`[ENJOYER_TARGET ${target.id}] kind=${target.kind} importance=${target.importanceTier}`)
      lines.push(`LABEL: ${target.label}`)
      lines.push(`CONTENIDO: ${target.content}`)
      if (target.sourceSpans.length) {
        lines.push('CITAS TEXTUALES AUTORIZADAS (palabra por palabra):')
        for (const span of target.sourceSpans) lines.push(`  - pagina ${span.page}: "${span.quote}"`)
      }
      if (target.materialId) lines.push(`PROVENANCE: material=${target.materialId}${target.pages.length ? ` pagina=${target.pages.join(',')}` : ''}`)
      lines.push('')
    }
  }
  if (retrieval.relations.length) {
    lines.push('=== RELACIONES EXPLÍCITAS (solo conectividad real, no asumas el significado del tipo) ===')
    for (const relation of retrieval.relations) {
      lines.push(`[ENJOYER_RELATION ${relation.id}] type=${relation.type} ${relation.fromSourceItemId} -> ${relation.toSourceItemId}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
