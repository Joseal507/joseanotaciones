import type { ChunkExtractionResult, RawExtractedUnit } from './extraction'
import { canonicalizeNotation } from './provenanceNotation'
import { normalizeWhitespace } from './provenanceValidation'
import { isDocumentBoilerplateText } from './academicRole'

// ============================================================
// Coverage-monotonicity guarantee (Material Brain P0 mission —
// "enrichment must never silently reduce coverage").
//
// A rich extraction that is individually VALID (zero structural/
// provenance loss on the units it returns) is NOT thereby guaranteed
// EXHAUSTIVE. The extraction prompt asks the model to be exhaustive,
// but nothing structurally enforces it — a well-formed, provenance-
// clean response covering only 2 of a leaf's 6 real facts passes every
// existing validation gate and, before this fix, unconditionally
// REPLACED the deterministic fallback checkpoint that had all 6.
//
// This is the mechanism behind unitsCount dropping across enrichment
// passes even on leaves whose upgrade was reported "successful" —
// coarser rich units silently absorbing (i.e. dropping) some of the
// finer-grained fallback sentences they nominally supersede.
//
// Fix: before a successful rich extraction replaces a fallback
// checkpoint, every fallback sentence is checked against the rich
// extraction's OWN quotes for word-overlap coverage. Any fallback
// sentence the rich response does not demonstrably cover is carried
// forward as a supplementary fallback-origin unit alongside the rich
// units — never dropped. Legitimate cross-unit dedup still happens
// downstream in merge.ts, so a retained near-duplicate is harmless
// (it collapses there); a silently dropped fact is not recoverable.
//
// This is NOT a provenance-verification mechanism (no claim is being
// accepted as source-grounded here — every unit on both sides already
// passed that gate independently) — it is strictly a coverage-
// RETENTION decision, so a looser, deliberately generous overlap
// threshold is appropriate: the failure mode we must avoid is losing
// content, not being slightly redundant.
// ============================================================

const COVERAGE_TOKEN_OVERLAP_THRESHOLD = 0.62
const COMBINED_COVERAGE_TOKEN_THRESHOLD = 0.78

const COVERAGE_STOPWORDS = new Set([
  'a', 'al', 'and', 'con', 'de', 'del', 'el', 'en', 'es', 'for', 'la', 'las',
  'los', 'of', 'para', 'por', 'que', 'se', 'the', 'to', 'un', 'una', 'y',
])

function tokenize(text: string): Set<string> {
  const normalized = normalizeWhitespace(canonicalizeNotation(text)).toLowerCase()
  const matches = normalized.match(/[\p{L}\p{N}_^]+/gu) || []
  return new Set(matches.filter(token => !COVERAGE_STOPWORDS.has(token)))
}

function coverageRatio(sentenceTokens: Set<string>, richTokens: Set<string>): number {
  let overlap = 0
  for (const token of sentenceTokens) if (richTokens.has(token)) overlap++
  return sentenceTokens.size === 0 ? 1 : overlap / sentenceTokens.size
}

function compactAcademicNotation(text: string): string {
  return normalizeWhitespace(canonicalizeNotation(text))
    .toLowerCase()
    .replace(/[\s.,;:]+/g, '')
    .replace(/[×·]/g, '*')
    .replace(/[−–—]/g, '-')
    .replace(/[{}\[\]]/g, match => (match === '{' || match === '[' ? '(' : ')'))
}

function hasFormulaShape(text: string): boolean {
  return /[=<>≤≥⇌→]/.test(text) && /[\p{L}\p{N}]/u.test(text)
}

function formulaEquivalent(fallback: RawExtractedUnit, rich: RawExtractedUnit): boolean {
  const fallbackText = fallback.expression || fallback.statement
  const richText = rich.expression || rich.statement
  if (!hasFormulaShape(fallbackText) || !hasFormulaShape(richText)) return false
  const left = compactAcademicNotation(fallbackText)
  const right = compactAcademicNotation(richText)
  if (!left || !right) return false
  return left === right || (Math.min(left.length, right.length) >= 8 && (left.includes(right) || right.includes(left)))
}

export function isFallbackCoveredByRichUnits(fallback: RawExtractedUnit, richUnits: RawExtractedUnit[]): boolean {
  if (isDocumentBoilerplateText(fallback.statement)) return true

  const samePageRich = richUnits.filter(unit => unit.page === fallback.page)
  if (samePageRich.some(unit => formulaEquivalent(fallback, unit))) return true

  const sentenceTokens = tokenize(fallback.quote || fallback.statement)
  if (sentenceTokens.size === 0) return true

  const combined = new Set<string>()
  for (const unit of samePageRich) {
    const richTokens = tokenize(`${unit.quote || ''} ${unit.statement} ${unit.expression || ''}`)
    for (const token of richTokens) combined.add(token)
    if (coverageRatio(sentenceTokens, richTokens) >= COVERAGE_TOKEN_OVERLAP_THRESHOLD) return true
  }

  return coverageRatio(sentenceTokens, combined) >= COMBINED_COVERAGE_TOKEN_THRESHOLD
}

/**
 * Merges a successful rich extraction with the fallback extraction it is
 * about to replace, retaining any fallback sentence NOT covered by the
 * rich response. Returns `rich` unchanged (no allocation) when every
 * fallback sentence is already covered.
 */
export function mergeRichWithFallbackCoverage(
  rich: ChunkExtractionResult,
  fallback: ChunkExtractionResult,
): ChunkExtractionResult {
  const fallbackUnits = fallback.units.filter(unit => !isDocumentBoilerplateText(unit.statement))
  if (!fallbackUnits.length) return rich

  const meaningfulRichUnits = rich.units.filter(u => tokenize(`${u.quote || ''} ${u.statement}`).size > 0)

  if (meaningfulRichUnits.length === 0) {
    // Rich extraction produced nothing quotable to compare against —
    // never silently drop the fallback in that case either.
    return appendUncovered(rich, fallbackUnits, fallbackUnits.length)
  }

  const uncovered = fallbackUnits.filter(u => !isFallbackCoveredByRichUnits(u, meaningfulRichUnits))
  if (uncovered.length === 0) return rich
  return appendUncovered(rich, uncovered, uncovered.length)
}

function appendUncovered(rich: ChunkExtractionResult, uncovered: RawExtractedUnit[], count: number): ChunkExtractionResult {
  return {
    units: [...rich.units, ...uncovered],
    relations: rich.relations,
    warnings: [...rich.warnings, `coverage_merge:retained_${count}_uncovered_fallback_segments`],
    droppedInvalidProvenance: rich.droppedInvalidProvenance,
    droppedStructural: rich.droppedStructural,
    telemetry: rich.telemetry,
  }
}
