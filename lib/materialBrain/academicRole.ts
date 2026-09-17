import type { KnowledgeUnit, AcademicRole } from './types'

export const STRUCTURAL_METADATA_PATTERNS: RegExp[] = [
  /\b(diapositiva|slide)\s+(anterior|siguiente|previa|previous|next)\b/i,
  /\bp[aá]gina\s+\d+\s+(de|of)\s+\d+\b|\bpage\s+\d+\s+of\s+\d+\b/i,
  /^\s*(fig(ura|\.)?\s*\d+|tabla\s*\d+|table\s*\d+)\s*[:.]?\s*$/i,
  /\bnavegaci[oó]n\b|\btable of contents\b|\b[ií]ndice\s+(general|de contenidos)\b/i,
]

export const DOCUMENT_METADATA_TOPIC_PATTERN =
  /derechos? de autor|copyright|©|all rights reserved|todos los derechos reservados|reservados todos los derechos|\b(isbn|editorial|publisher|imprenta)\b|a[nñ]o de (publicaci[oó]n|edici[oó]n)|publication year|\bedici[oó]n\b|qui[eé]n\s+(posee|es\s+el\s+propietario|es\s+el\s+due[nñ]o)|a\s+qui[eé]n\s+pertenece|propietari[oa]\s+de|\bwho\s+owns\b|\bownership\s+of\b/i

export const BARE_COLOPHON_PATTERN = /\b(inc\.?|ltd\.?|s\.a\.?|corp\.?|editorial|publishing|press|ediciones)\b.{0,40}\b(19|20)\d{2}\b/i

const DOCUMENT_BOILERPLATE_PATTERNS: RegExp[] = [
  /^\s*(?:©|copyright\b|copr\.)\s*(?:\(c\)\s*)?(?:19|20)\d{2}\b.{0,120}$/i,
  /^\s*(?:all rights reserved|todos los derechos reservados|reservados todos los derechos)\.?\s*$/i,
  /^\s*(?:isbn(?:-1[03])?\s*[:#]?\s*)?[\dXx-]{10,20}\s*$/,
  /^\s*(?:page|p[aá]gina|slide|diapositiva)\s*\d+(?:\s*(?:of|de)\s*\d+)?\s*$/i,
  /\b(?:quicktime|photo\s*-?\s*jpeg|jpeg|video)\b.{0,80}\bdecompressor\b.{0,80}\b(?:needed|required|necesari[oa])\b/i,
  /\b(?:codec|plugin|plug-in|viewer)\b.{0,80}\b(?:needed|required|missing|not installed|necesari[oa]|no instalado)\b/i,
  /^\s*(?:https?:\/\/|www\.)\S+\s*$/i,
]

/**
 * Conservative, domain-agnostic rejection for text that is a document or
 * viewer artifact rather than taught content. Patterns require a metadata
 * shape (copyright line, rights notice, bare page marker, missing-codec
 * message, etc.), so academic discussions *about* copyright or publishing
 * remain eligible when they contain a real proposition.
 */
export function isDocumentBoilerplateText(input: string): boolean {
  const text = String(input || '').replace(/\s+/g, ' ').trim()
  if (!text) return false
  return DOCUMENT_BOILERPLATE_PATTERNS.some(pattern => pattern.test(text))
}

export function documentMetadataClassificationText(unit: { label: string; statement: string; provenance: { quote?: string }[] }): string {
  const quotes = unit.provenance.map(p => p.quote).filter(Boolean).join(' ')
  return `${unit.label} ${unit.statement} ${quotes}`.trim()
}

export function lacksTaughtSignals(
  unit: { id: string; domainTags: string[]; importance: { tier: string; signals: string[] } },
  unitsWithRelations?: Set<string>
): boolean {
  if (unit.domainTags.length > 0) return false
  const hasRelation = unitsWithRelations ? unitsWithRelations.has(unit.id) : false
  const isCritical = unit.importance.tier === 'critical'
  const hasStrongSignal = unit.importance.signals.some(
    s => s === 'repeated_across_pages' || s === 'exam_marked' || s === 'declared_in_material'
  )
  return !(hasRelation && isCritical && hasStrongSignal)
}

export function looksLikeBareColophon(
  unit: { id: string; statement: string; domainTags: string[]; importance: { tier: string; signals: string[] } },
  unitsWithRelations?: Set<string>
): boolean {
  if (unit.statement.trim().split(/\s+/).length > 15) return false
  const text = `${unit.statement}`
  if (!BARE_COLOPHON_PATTERN.test(text)) return false
  return lacksTaughtSignals(unit, unitsWithRelations)
}

export function classifyAcademicRole(
  unit: { id: string; label: string; statement: string; provenance: { quote?: string }[]; domainTags: string[]; importance: { tier: string; signals: string[] } },
  unitsWithRelations?: Set<string>
): AcademicRole {
  const text = documentMetadataClassificationText(unit)
  if (!text) return 'unknown'

  if (isDocumentBoilerplateText(unit.statement) || unit.provenance.some(p => isDocumentBoilerplateText(p.quote || ''))) {
    return 'document_metadata'
  }

  if (STRUCTURAL_METADATA_PATTERNS.some(p => p.test(text))) {
    return 'document_metadata'
  }

  if (DOCUMENT_METADATA_TOPIC_PATTERN.test(text) && lacksTaughtSignals(unit, unitsWithRelations)) {
    return 'document_metadata'
  }

  if (looksLikeBareColophon(unit, unitsWithRelations)) {
    return 'document_metadata'
  }

  return 'academic_content'
}

export function resolveAcademicRole(unit: KnowledgeUnit, unitsWithRelations?: Set<string>): AcademicRole {
  if (unit.academicRole) return unit.academicRole
  return classifyAcademicRole(unit, unitsWithRelations)
}
