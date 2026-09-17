import type { PageChunk } from './types'
import type { ChunkExtractionResult, RawExtractedUnit } from './extraction'
import { createChunkTelemetry, recordRejection } from './extractionTelemetry'
import { isNonAcademicText } from './academicSegment'
import { isDocumentBoilerplateText } from './academicRole'

// ============================================================
// Deterministic exact-source fallback extraction — the terminal
// safety net when the LLM cannot reliably produce structured JSON
// for a (by now already-minimal) text leaf. Material Brain must not
// be a single point of total failure just because a provider
// formatted output badly on one small scope.
//
// Hard invariants (never relaxed):
// - NEVER invents knowledge — every unit's statement/quote is a
//   VERBATIM substring of the chunk's own authorized text.
// - NEVER produces relations (no invented connections).
// - kind is conservative and determined only by explicit source structure:
//   equations become formulas; explicit procedures/steps become processes;
//   everything else remains a fact.
// - label is the same verbatim (truncated) text — never a
//   generated/paraphrased title.
// - page/material provenance always traces to the real chunk.
//
// P0 mission fix ("Material Brain must never silently discard
// study-worthy content"): fallback used to hard-cap at 12 units per
// leaf with ZERO loss reported — any sentence past #12 vanished with
// no trace. That is now forbidden. Every academically-classified
// sentence in the leaf becomes a unit; the ONLY remaining ceiling is
// a pathological-input safety valve (FALLBACK_UNIT_SAFETY_CEILING),
// and hitting it is never silent: it increments `droppedStructural`
// (the SAME counter extraction.ts already uses for structural loss),
// so `extractionHasCompletenessLoss`/build.ts's academic-stability
// aggregation see it exactly like any other unresolved loss.
// ============================================================

// Real leaves are bounded by DEFAULT_EXTRACTION_SUBCHUNK_CHARS (~1200
// chars — chunking.ts) — this ceiling is roughly an order of magnitude
// above what any legitimate single leaf could produce, purely a
// safety valve against a pathological/malformed input, never a
// realistic content boundary.
const FALLBACK_UNIT_SAFETY_CEILING = 200
const MIN_SENTENCE_CHARS = 20
const MAX_LABEL_CHARS = 90

interface PageTaggedSentence { page: number; sentence: string }

function splitIntoPageTaggedSentences(text: string): PageTaggedSentence[] {
  const pageMarker = /\[(?:P[aá]gina|Pagina|Page)\s+(\d+)\]/gi
  const segments: { page: number; text: string }[] = []
  const matches = [...text.matchAll(pageMarker)]
  if (matches.length) {
    for (let i = 0; i < matches.length; i++) {
      const page = Number(matches[i][1])
      const start = matches[i].index! + matches[i][0].length
      const end = i + 1 < matches.length ? matches[i + 1].index! : text.length
      segments.push({ page, text: text.slice(start, end) })
    }
  } else {
    segments.push({ page: 0, text })
  }

  const sentences: PageTaggedSentence[] = []
  for (const segment of segments) {
    const parts = segment.text.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ0-9])/)
    for (const raw of parts) {
      const sentence = raw.trim()
      if (sentence.length >= MIN_SENTENCE_CHARS) sentences.push({ page: segment.page, sentence })
    }
  }
  return sentences
}

function fallbackCanonicalSubject(chunkId: string, index: number): string {
  return `fallback:${chunkId}:${index}`
}

// Isolates the actual equation span within a prose sentence (e.g. "según
// la fórmula V = I × R, donde..." → "V = I × R") so formula identity
// comparison (decideMerge/coverageMerge) operates on the symbolic
// expression itself, never on the surrounding narration. Falls back to
// the full sentence only when no such compact span is found — the
// conservative kind/shape detection above already gated on this same
// pattern, so that case should not occur in practice.
const FORMULA_TOKEN = '\\b[\\p{L}\\p{N}_]{1,8}'
const FORMULA_JOIN = '[×·*/+\\-^()]'
const FORMULA_OPERAND = `${FORMULA_TOKEN}(?:\\s*${FORMULA_JOIN}\\s*${FORMULA_TOKEN}){0,4}`
const FORMULA_SPAN_PATTERN = new RegExp(`${FORMULA_OPERAND}\\s*[=≤≥⇌→]\\s*${FORMULA_OPERAND}`, 'u')

function extractFormulaExpression(sentence: string): string {
  const match = sentence.match(FORMULA_SPAN_PATTERN)
  return match ? match[0].trim() : sentence
}

// Guards against mislabeling a plain-prose fragment that merely
// contains an operator character as a formula (e.g. an OCR/sentence-
// split artifact like "eq = k" — two ordinary lowercase words joined
// by "="). A real symbolic expression, in ANY discipline, almost
// always shows at least one of: a digit, a bracket/parenthesis
// (concentration/grouping notation), a caret (exponent), or an
// uppercase letter (the near-universal convention for physical/
// chemical quantity symbols — V, I, R, K, Q, P, T...). Plain lowercase
// dictionary-word operands on both sides of an operator have none of
// these and are treated as prose, not a formula — a conservative
// false-negative (the content survives as kind:'fact', verbatim,
// never lost) is preferred over fabricating a formula unit the source
// does not actually support with real symbolic notation.
const FORMULA_SYMBOLIC_EVIDENCE_PATTERN = /[0-9\[\](){}^]|\p{Lu}/u

function hasCredibleFormulaSymbol(expression: string): boolean {
  return FORMULA_SYMBOLIC_EVIDENCE_PATTERN.test(expression)
}

function fallbackUnitFromSentence(chunk: PageChunk, page: number, sentence: string, index: number): RawExtractedUnit {
  const base = {
    canonicalSubject: fallbackCanonicalSubject(chunk.id, index),
    qualifiers: [],
    label: sentence.length > MAX_LABEL_CHARS ? `${sentence.slice(0, MAX_LABEL_CHARS)}…` : sentence,
    statement: sentence,
    quote: sentence,
    page: chunk.pages.includes(page) ? page : (chunk.pages[0] ?? page),
    domainTags: [],
    modelSuggestedTier: null,
    origin: 'fallback' as const,
  }

  if (/[=≤≥⇌→]/.test(sentence) && /[\p{L}\p{N}]/u.test(sentence)) {
    const expression = extractFormulaExpression(sentence)
    if (hasCredibleFormulaSymbol(expression)) {
      return { ...base, kind: 'formula', expression, variables: [] }
    }
    // Operator present but no credible symbolic evidence — falls
    // through to the process/fact checks below instead of fabricating
    // a formula unit.
  }

  const stepMatches = [...sentence.matchAll(/\b(?:paso|step)\s*(\d+)\s*[:.)-]?\s*([^]*?)(?=\b(?:paso|step)\s*\d+\s*[:.)-]?|$)/gi)]
  if (/\b(?:procedimiento|procedure)\b/i.test(sentence) || stepMatches.length > 0) {
    return {
      ...base,
      kind: 'process',
      steps: stepMatches.length > 0
        ? stepMatches.map(match => ({ order: Number(match[1]), text: match[2].trim() || sentence }))
        : [{ order: 1, text: sentence }],
    }
  }

  return { ...base, kind: 'fact' }
}

/**
 * Builds conservative, exact-evidence KnowledgeUnits from a chunk's
 * OWN authorized text — no provider call, no invention. Used only
 * after bounded provider-formatting retries have been exhausted for
 * this (already minimal-scope) leaf.
 */
export function buildDeterministicFallbackExtraction(chunk: PageChunk): ChunkExtractionResult {
  const telemetry = createChunkTelemetry(chunk.id, chunk.materialId, chunk.pages)
  const allSentences = splitIntoPageTaggedSentences(chunk.text)
  telemetry.rawUnits = allSentences.length

  // Drop paratext (headers, page-number artifacts, isolated punctuation,
  // navigation debris) using the SAME conservative classifier build.ts
  // uses to skip whole non-academic chunks — never the source of academic
  // content loss, since it only fires on word-poor, operator-free,
  // non-sentence-like fragments (see academicSegment.ts).
  const academicSentences: typeof allSentences = []
  let filteredNonAcademic = 0
  for (const entry of allSentences) {
    if (isNonAcademicText(entry.sentence) || isDocumentBoilerplateText(entry.sentence)) {
      filteredNonAcademic++
      recordRejection(telemetry, 'non_academic_segment_filtered', { detail: entry.sentence.slice(0, 60) })
    } else {
      academicSentences.push(entry)
    }
  }

  const sentences = academicSentences.slice(0, FALLBACK_UNIT_SAFETY_CEILING)
  const droppedByCeiling = academicSentences.length - sentences.length

  const units: RawExtractedUnit[] = sentences.map(({ page, sentence }, index) =>
    fallbackUnitFromSentence(chunk, page, sentence, index),
  )

  telemetry.acceptedUnits = units.length

  const warnings = [`deterministic_fallback_extraction_used:${chunk.id}:${units.length}_units`]
  if (filteredNonAcademic > 0) {
    warnings.push(`deterministic_fallback_filtered_non_academic:${chunk.id}:${filteredNonAcademic}_segments`)
  }
  if (droppedByCeiling > 0) {
    // NEVER silent: this is the only remaining way fallback content can
    // be incomplete, and it is reported as real structural loss — see
    // extractionHasCompletenessLoss (build.ts) and BrainMeta.contentLoss.
    warnings.push(`deterministic_fallback_capacity_ceiling_hit:${chunk.id}:${droppedByCeiling}_segments_dropped`)
    for (let i = 0; i < droppedByCeiling; i++) {
      recordRejection(telemetry, 'fallback_capacity_ceiling', { detail: `segment ${sentences.length + i} beyond ceiling ${FALLBACK_UNIT_SAFETY_CEILING}` })
    }
  }

  return {
    units,
    relations: [],
    warnings,
    droppedInvalidProvenance: 0,
    droppedStructural: droppedByCeiling,
    telemetry,
  }
}
