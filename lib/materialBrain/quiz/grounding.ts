import { createHash } from 'node:crypto'
import {
  dedupeSourceEvidence, sourceEvidenceId, validateSourceEvidence,
  type SourceEvidence,
} from '../../materials/sourceEvidence'
import type { KnowledgeRelation, KnowledgeUnit } from '../types'
import type { EvidenceBackedAssertion, EvidenceLink } from './types'

export function normalizeGroundingText(value: unknown): string {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

export function evidenceAuthorityText(evidence: SourceEvidence): string {
  return evidence.derivation === 'vision' ? String(evidence.description || '') : evidence.quote
}

function supportedEvidence(text: string, evidence: SourceEvidence[]): SourceEvidence[] {
  const assertion = normalizeGroundingText(text)
  if (assertion.length < 2) return []
  return dedupeSourceEvidence(evidence.filter(item => {
    if (!validateSourceEvidence(item)) return false
    return normalizeGroundingText(evidenceAuthorityText(item)).includes(assertion)
  }))
}

function assertionTextsForUnit(unit: KnowledgeUnit): string[] {
  const extra = unit.kind === 'formula'
    ? [unit.expression, ...unit.variables.flatMap(variable => [variable.symbol, variable.meaning])]
    : unit.kind === 'process' ? unit.steps.map(step => step.text)
      : unit.kind === 'definition' ? [unit.term]
        : unit.kind === 'example' ? [unit.illustrates]
          : unit.kind === 'event_or_data' ? [unit.value || '']
            : unit.kind === 'terminology' ? unit.aliases : []
  return [...new Set([unit.label, unit.statement, ...extra].map(value => String(value || '').trim()).filter(Boolean))]
}

function fingerprint(kind: 'unit' | 'relation', refId: string, text: string, evidence: SourceEvidence[]): string {
  return createHash('sha256').update(JSON.stringify({
    kind, refId, text: normalizeGroundingText(text),
    evidenceIds: evidence.map(sourceEvidenceId).sort(),
  })).digest('hex')
}

export function buildEvidenceBackedAssertions(
  kind: 'unit' | 'relation',
  refId: string,
  texts: string[],
  evidence: SourceEvidence[],
): EvidenceBackedAssertion[] {
  const assertions: EvidenceBackedAssertion[] = []
  for (const text of texts) {
    const supporting = supportedEvidence(text, evidence)
    if (!supporting.length) continue
    assertions.push({
      assertionId: `${kind}:${refId}:${assertions.length + 1}`,
      kind, refId, text,
      evidence: supporting,
      supportMode: supporting.some(item => item.derivation === 'vision') ? 'visual_description' : 'text_quote',
      assertionFingerprint: fingerprint(kind, refId, text, supporting),
    })
  }
  return assertions
}

export function evidenceLinkForUnit(
  unit: KnowledgeUnit,
  evidence: SourceEvidence[],
  options: { includeVerbatimEvidence?: boolean } = {},
): EvidenceLink | null {
  const candidateTexts = options.includeVerbatimEvidence
    ? [...assertionTextsForUnit(unit), ...evidence.map(evidenceAuthorityText)]
    : assertionTextsForUnit(unit)
  const seenTexts = new Set<string>()
  const texts = candidateTexts.filter(text => {
    const normalized = normalizeGroundingText(text)
    if (!normalized || seenTexts.has(normalized)) return false
    seenTexts.add(normalized)
    return true
  })
  const assertions = buildEvidenceBackedAssertions('unit', unit.id, texts, evidence)
  return assertions.length ? { kind: 'unit', refId: unit.id, evidence: dedupeSourceEvidence(evidence), assertions } : null
}

export function evidenceLinkForRelation(relation: KnowledgeRelation, evidence: SourceEvidence[]): EvidenceLink | null {
  const assertions = buildEvidenceBackedAssertions('relation', relation.id, [relation.statement], evidence)
  return assertions.length ? { kind: 'relation', refId: relation.id, evidence: dedupeSourceEvidence(evidence), assertions } : null
}

export function authoritativeEvidenceForUnit(unit: KnowledgeUnit): SourceEvidence[] {
  const explicit = (unit.evidence || []).filter(validateSourceEvidence)
  if (explicit.length) return dedupeSourceEvidence(explicit)
  return dedupeSourceEvidence(unit.provenance.map(item => ({
    materialId: item.materialId,
    page: item.page,
    derivation: 'native_text' as const,
    quote: item.quote,
    chunkId: item.chunkId,
  })).filter(validateSourceEvidence))
}

export function authoritativeEvidenceForRelation(relation: KnowledgeRelation): SourceEvidence[] {
  const explicit = (relation.evidence || []).filter(validateSourceEvidence)
  if (explicit.length) return dedupeSourceEvidence(explicit)
  return dedupeSourceEvidence(relation.provenance.map(item => ({
    materialId: item.materialId,
    page: item.page,
    derivation: 'native_text' as const,
    quote: item.quote,
    chunkId: item.chunkId,
  })).filter(validateSourceEvidence))
}

export function resolveAuthoritativeEvidenceForLink(
  link: Pick<EvidenceLink, 'kind' | 'refId'>,
  units: Map<string, KnowledgeUnit>,
  relations: Map<string, KnowledgeRelation>,
): SourceEvidence[] | null {
  const reference = link.kind === 'unit' ? units.get(link.refId) : relations.get(link.refId)
  if (!reference) return null
  return link.kind === 'unit'
    ? authoritativeEvidenceForUnit(reference as KnowledgeUnit)
    : authoritativeEvidenceForRelation(reference as KnowledgeRelation)
}

export function verifyEvidenceLink(
  link: EvidenceLink,
  units: Map<string, KnowledgeUnit>,
  relations: Map<string, KnowledgeRelation>,
): EvidenceBackedAssertion[] | null {
  const reference = link.kind === 'unit' ? units.get(link.refId) : relations.get(link.refId)
  if (!reference || !Array.isArray(link.evidence) || !link.evidence.length || !link.evidence.every(validateSourceEvidence)) return null
  const authoritative = resolveAuthoritativeEvidenceForLink(link, units, relations)
  if (!authoritative?.length) return null
  const authoritativeById = new Map(authoritative.map(item => [sourceEvidenceId(item), item]))
  const matchedEvidence: SourceEvidence[] = []
  for (const persistedEvidence of link.evidence) {
    const match = authoritativeById.get(sourceEvidenceId(persistedEvidence))
    if (!match) return null
    matchedEvidence.push(match)
  }
  const expected = link.kind === 'unit'
    ? evidenceLinkForUnit(reference as KnowledgeUnit, matchedEvidence, { includeVerbatimEvidence: true })
    : evidenceLinkForRelation(reference as KnowledgeRelation, matchedEvidence)
  if (!expected || !Array.isArray(link.assertions) || !link.assertions.length
    || link.assertions.length > expected.assertions.length) return null
  const byFingerprint = new Map(expected.assertions.map(assertion => [assertion.assertionFingerprint, assertion]))
  const verified: EvidenceBackedAssertion[] = []
  for (const assertion of link.assertions) {
    const valid = byFingerprint.get(assertion.assertionFingerprint)
    if (!valid || assertion.kind !== link.kind || assertion.refId !== link.refId
      || normalizeGroundingText(assertion.text) !== normalizeGroundingText(valid.text)) return null
    verified.push(valid)
  }
  return verified
}
