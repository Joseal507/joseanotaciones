// ============================================================
// Provenance-specific notation equivalence — Material Brain.
//
// Distinct from lib/alai.ts's repairJson (which repairs JSON-escaping
// damage in RAW provider output before JSON.parse). This module
// compares two ALREADY-parsed plain-text strings — a claimed `quote`
// vs. the chunk's own authorized source text — and decides whether
// they denote the SAME underlying notation, tolerating ONLY the
// unicode-subscript/superscript <-> ASCII underscore/caret
// representation gap (e.g. a PDF that renders "NO₂" as Unicode
// subscript vs. a model that echoes "NO_2" in ASCII — same molecule,
// different character encoding of the same subscript "2").
//
// HARD INVARIANT: canonicalizeNotation is a per-character, 1:1
// substitution table. It NEVER merges, drops or reorders characters —
// every digit, letter, sign and operator VALUE that was present
// survives canonicalization unchanged; only its Unicode
// subscript/superscript *packaging* is rewritten to the equivalent
// ASCII `_`/`^` form. This means:
//   - NO₂  -> NO_2   and   NO_2 -> NO_2   => EQUAL (intended)
//   - NO₂  -> NO_2   and   NO₃  -> NO_3   => NOT EQUAL (different digit survives)
//   - H₂   -> H_2    and   H    -> H      => NOT EQUAL (different length/content)
//   - x²   -> x^2    and   x³   -> x^3    => NOT EQUAL
//   - 2NO₂ -> 2NO_2  and   3NO₂ -> 3NO_2  => NOT EQUAL (leading coefficient untouched)
//   - +/-, </>, arrow direction, Kc/Kp — none of these characters are
//     in the substitution table, so they are NEVER altered and NEVER
//     conflated.
//
// This is explicitly NOT fuzzy/semantic matching — no word, number, or
// operator value is inferred or corrected. It is a narrow, deterministic
// re-encoding of representation-only Unicode subscript/superscript
// characters into their canonical ASCII form, applied identically to
// BOTH sides of the comparison.
// ============================================================

const SUBSCRIPT_DIGITS: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
}

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
}

const SUPERSCRIPT_SIGNS: Record<string, string> = {
  '⁺': '+', '⁻': '-',
}

/**
 * Rewrites ONLY Unicode subscript/superscript digit/sign codepoints
 * into an ASCII `_digit` / `^digit` / `^sign` form. Every other
 * character — letters (including existing ASCII `_`/`^`), digits,
 * operators, arrows, whitespace — passes through completely unchanged.
 */
export function canonicalizeNotation(text: string): string {
  let out = ''
  for (const ch of String(text || '')) {
    if (SUBSCRIPT_DIGITS[ch]) { out += `_${SUBSCRIPT_DIGITS[ch]}`; continue }
    if (SUPERSCRIPT_DIGITS[ch]) { out += `^${SUPERSCRIPT_DIGITS[ch]}`; continue }
    if (SUPERSCRIPT_SIGNS[ch]) { out += `^${SUPERSCRIPT_SIGNS[ch]}`; continue }
    out += ch
  }
  return out
}

/** True when two strings denote identical notation modulo subscript/superscript representation. */
export function notationEquivalent(a: string, b: string): boolean {
  return canonicalizeNotation(a) === canonicalizeNotation(b)
}
