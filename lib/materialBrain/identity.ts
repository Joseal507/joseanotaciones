import type { KnowledgeIdentity, KnowledgeUnitKind } from './types'

// ============================================================
// Identity — estrategia de DOS pasadas (Fase 0-A):
//
//  1) Identidad determinística en extracción: el propio prompt le
//     pide al modelo un `canonicalSubject` NORMALIZADO (la forma
//     estándar/de índice, no la redacción exacta) más `qualifiers`
//     que distinguen marcos/teorías/contextos específicos cuando el
//     material los presenta (ver extraction.ts). Esto es lo que
//     permite que "autoionización del agua" y "equilibrio de
//     autoionización del H2O" converjan (mismo canonicalSubject
//     elegido por el modelo), mientras "ácido según Arrhenius" y
//     "ácido según Brønsted-Lowry" quedan separados por qualifiers
//     disjuntos aunque compartan canonicalSubject ("ácido").
//
//  2) Reconciliación conservadora, barata y determinística acá:
//     normalización de texto + comparación de qualifiers + un piso
//     de solapamiento léxico como red de seguridad. Sin embeddings.
//     Ante duda, NO se fusiona — un falso duplicado es preferible a
//     destruir dos conocimientos distintos.
// ============================================================

const STOPWORDS = new Set([
  // español
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
  'a', 'en', 'con', 'para', 'por', 'que', 'se', 'su', 'sus', 'y', 'o', 'es',
  'son', 'segun', 'según', 'como', 'entre', 'sobre', 'este', 'esta', 'estos',
  'estas', 'lo', 'le', 'les',
  // inglés
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'with', 'and', 'or', 'is',
  'are', 'according', 'as', 'between', 'about', 'this', 'that', 'these', 'those',
])

function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Normalización determinística barata: sin acentos, sin puntuación, sin stopwords. */
export function normalizeSemanticText(input: string): string {
  const cleaned = stripDiacritics(String(input || '').toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  return cleaned
    .split(' ')
    .filter(word => word.length > 0 && !STOPWORDS.has(word))
    .join(' ')
}

// Generic academic wrapper phrasing ("Concepto de X", "Definición de X")
// carries no topic information of its own — the model sometimes emits
// the bare topic and sometimes wraps it, for the SAME entity. Stripping
// this (structural, language-level, never subject-specific) prefix
// before computing the entity/topic key is what lets "Concepto de
// equilibrio químico" and "Equilibrio químico" converge to the same
// semanticKey WITHOUT touching proposition/statement identity — the
// wrapper is stripped only for entity normalization, never for the
// unit's own proposition hash (identityId below still uses the full
// statement).
const GENERIC_ENTITY_WRAPPER_PATTERN = /^(concepto|nocion|noción|idea|definicion|definición)\s+(de|del)\s+/i

function stripGenericEntityWrapper(input: string): string {
  const text = String(input || '').trim()
  const stripped = text.replace(GENERIC_ENTITY_WRAPPER_PATTERN, '')
  return stripped.trim() || text
}

export function normalizeQualifier(input: string): string {
  return normalizeSemanticText(input).replace(/\s+/g, '-')
}

/** Hash determinístico corto (FNV-1a doble, mismo espíritu que sourceSelection.ts). */
function hash(text: string): string {
  let first = 2166136261
  let second = 0x9e3779b9
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    first = Math.imul(first ^ code, 16777619)
    second = Math.imul(second ^ code, 16777619)
  }
  return (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0')
}

export function buildIdentity(kind: KnowledgeUnitKind, canonicalSubject: string, qualifiers: string[]): KnowledgeIdentity {
  const entityTopic = stripGenericEntityWrapper(String(canonicalSubject || ''))
  const semanticKey = normalizeSemanticText(entityTopic)
  return {
    canonicalSubject: String(canonicalSubject || '').trim(),
    semanticKey: semanticKey || normalizeSemanticText(String(canonicalSubject || 'unidad')),
    qualifiers: [...new Set((qualifiers || []).map(normalizeQualifier).filter(Boolean))].sort(),
  }
}

export function identityId(kind: KnowledgeUnitKind, identity: KnowledgeIdentity, proposition = ''): string {
  const normalizedProposition = normalizeSemanticText(proposition)
  return `${kind}_${hash(`${kind}::${identity.semanticKey}::${identity.qualifiers.join(',')}::${normalizedProposition}`)}`
}

function jaccard(a: string, b: string): number {
  const setA = new Set(a.split(' ').filter(Boolean))
  const setB = new Set(b.split(' ').filter(Boolean))
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const token of setA) if (setB.has(token)) intersection++
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

export type MergeDecisionReason =
  | 'kind_mismatch'
  | 'semantic_key_mismatch'
  | 'conflicting_qualifiers'
  | 'low_statement_overlap'
  | 'formula_expression_mismatch'
  | 'matching_qualifiers'
  | 'semantic_key_match_no_qualifiers'

export interface MergeDecision {
  merge: boolean
  reason: MergeDecisionReason
  overlap: number
}

const SAME_KIND_STATEMENT_OVERLAP_FLOOR = 0.45
const CROSS_NARRATIVE_KIND_OVERLAP_FLOOR = 0.55

export interface MergeSemanticPayload {
  expression?: string
}

function normalizeFormulaIdentity(text: string): string {
  return stripDiacritics(String(text || '').toLowerCase())
    .replace(/[×·]/g, '*')
    .replace(/[−–—]/g, '-')
    .replace(/[{}\[\]]/g, match => (match === '{' || match === '[' ? '(' : ')'))
    .replace(/[\s.,;:]+/g, '')
}

/**
 * 'concept' | 'fact' | 'definition' comparten exactamente el mismo shape
 * (KnowledgeUnitBase, sin campos propios) — son tres etiquetas narrativas
 * para la MISMA clase de conocimiento, y el LLM las usa de forma
 * intercambiable para el mismo hecho entre chunks/materiales distintos
 * (evidencia real: Case K — "Principio de conservación de la energía"
 * salió como 'definition' en un material y 'concept' en otro, mismo
 * canonicalSubject/semanticKey exacto, sin fusionarse). Se agrupan para
 * efectos de identidad.
 *
 * 'formula' | 'process' | 'example' | 'event_or_data' | 'terminology'
 * SÍ cargan payload estructurado propio (expression/variables, steps,
 * illustrates, value, aliases) que se perdería o confundiría si se
 * fusionaran entre kinds distintos — quedan estrictamente aislados por
 * kind exacto, sin excepción.
 *
 * Esto es una distinción de FORMA del tipo (shape), no de dominio/materia
 * — aplica igual a física, química, derecho o historia.
 */
const NARRATIVE_KINDS = new Set<KnowledgeUnitKind>(['concept', 'fact', 'definition'])

export function mergeKindGroup(kind: KnowledgeUnitKind): string {
  return NARRATIVE_KINDS.has(kind) ? 'narrative' : kind
}

/**
 * Decide si dos KnowledgeUnit candidatas representan el MISMO
 * conocimiento. Conservador por diseño: cualquier señal de conflicto
 * (grupo de kind distinto, semanticKey distinto, qualifiers disjuntos no
 * vacíos, o solapamiento léxico de statement por debajo del piso)
 * bloquea la fusión.
 */
export function decideMerge(
  kindA: KnowledgeUnitKind,
  identityA: KnowledgeIdentity,
  statementA: string,
  kindB: KnowledgeUnitKind,
  identityB: KnowledgeIdentity,
  statementB: string,
  payloadA: MergeSemanticPayload = {},
  payloadB: MergeSemanticPayload = {},
): MergeDecision {
  if (mergeKindGroup(kindA) !== mergeKindGroup(kindB)) return { merge: false, reason: 'kind_mismatch', overlap: 0 }
  if (identityA.semanticKey !== identityB.semanticKey) {
    return { merge: false, reason: 'semantic_key_mismatch', overlap: 0 }
  }

  const overlap = jaccard(normalizeSemanticText(statementA), normalizeSemanticText(statementB))

  if (kindA === 'formula' && kindB === 'formula') {
    const expressionA = normalizeFormulaIdentity(payloadA.expression || statementA)
    const expressionB = normalizeFormulaIdentity(payloadB.expression || statementB)
    if (!expressionA || !expressionB || expressionA !== expressionB) {
      return { merge: false, reason: 'formula_expression_mismatch', overlap }
    }
  }

  const exactStatementMatch = normalizeSemanticText(statementA) === normalizeSemanticText(statementB)
  const overlapFloor = kindA === kindB
    ? SAME_KIND_STATEMENT_OVERLAP_FLOOR
    : CROSS_NARRATIVE_KIND_OVERLAP_FLOOR

  const bothHaveQualifiers = identityA.qualifiers.length > 0 && identityB.qualifiers.length > 0
  if (bothHaveQualifiers) {
    const sharesQualifier = identityA.qualifiers.some(q => identityB.qualifiers.includes(q))
    if (!sharesQualifier) {
      return { merge: false, reason: 'conflicting_qualifiers', overlap }
    }
    if (!exactStatementMatch && overlap < overlapFloor) {
      return { merge: false, reason: 'low_statement_overlap', overlap }
    }
    return { merge: true, reason: 'matching_qualifiers', overlap }
  }

  // Sin qualifiers de un lado o de ambos: el semanticKey ya hizo el trabajo
  // pesado (el modelo convergió al mismo nombre canónico), pero igual se
  // exige el piso léxico como red de seguridad contra falsos positivos.
  if (!exactStatementMatch && overlap < overlapFloor) {
    return { merge: false, reason: 'low_statement_overlap', overlap }
  }
  return { merge: true, reason: 'semantic_key_match_no_qualifiers', overlap }
}
