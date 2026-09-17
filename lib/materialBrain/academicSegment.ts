// ============================================================
// Shared deterministic, provider-free classifier: "is this text
// segment academically study-worthy, or is it paratext (headers,
// page-number artifacts, isolated punctuation, navigation debris)?"
//
// Used at two granularities against the SAME rule, so a chunk-level
// skip decision (build.ts) and a sentence-level fallback-unit filter
// (deterministicFallback.ts) can never silently diverge:
// - build.ts: whole-chunk pre-extraction skip (isDeterministicallyNonAcademicSegment)
// - deterministicFallback.ts: per-sentence filter before emitting fallback units
//
// Conservative by construction: only classifies as non-academic when
// there is no math/chemistry operator AND the segment is extremely
// short/word-poor. Never filters legitimate prose, however short a
// sentence fragment might look, once it contains real academic
// content signals.
// ============================================================

export function isNonAcademicText(rawText: string): boolean {
  const text = String(rawText || '')
    .replace(/\[(?:P[aá]gina|Pagina|Page)\s+\d+\]/gi, ' ')
    .replace(/\b(?:p[aá]gina|page)\s+\d+\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return true
  if (/[=<>±→⇌∑∫√^]|\b[A-Za-z]\s*\([^)]*\)/.test(text)) return false
  const words = text.match(/[\p{L}\p{N}]+/gu) || []
  if (words.length <= 2) return true
  const sentenceLike = /[.!?:;]/.test(text)
  return words.length <= 6 && !sentenceLike
}
