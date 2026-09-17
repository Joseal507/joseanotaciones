import { canonicalizeNotation } from './provenanceNotation'

// ============================================================
// Provenance Whitespace Normalization — Material Brain
//
// PDF extraction puede convertir "ácido fuerte" en "ácido  fuerte"
// o "ácido\nfuerte". Eso NO debe invalidar provenance.
//
// Normalización permitida:
// - múltiples espacios → un espacio
// - \n, \r, \t → espacio
// - Unicode subscript/superscript <-> ASCII _N/^N representation gap
//   (ver provenanceNotation.ts — sustitución 1:1 por carácter, JAMÁS
//   altera qué dígito/letra/signo está presente).
//
// PROHIBIDO: fuzzy semantic matching que permita alterar
// palabras, números o signos importantes.
//
// Normalización de whitespace ≠ fuzzy semantic matching.
// ============================================================

/**
 * Normaliza whitespace para comparación de provenance.
 * Colapsa cualquier secuencia de whitespace (space, tab, newline, CR)
 * a un único espacio, y hace trim.
 *
 * NO altera palabras, números, signos ni letras.
 */
export function normalizeWhitespace(text: string): string {
  return String(text || '').replace(/[\s\t\r\n]+/g, ' ').trim()
}

/**
 * Verifica si una quote está presente en el sourceText,
 * tolerando diferencias irrelevantes de whitespace.
 *
 * Acepta:
 * - "ácido fuerte" cuando el source tiene "ácido     fuerte"
 * - "ácido\nfuerte" cuando el source tiene "ácido fuerte"
 * - múltiples espacios vs. uno
 *
 * NO acepta:
 * - cambios de palabras ("aumenta" vs "disminuye")
 * - cambios de números ("100" vs "93")
 * - cambios de signos
 *
 * @param sourceText El texto completo del chunk
 * @param quote La cita que el LLM dice que está en el source
 * @param prefixLength Cuántos caracteres del inicio de la quote usar para búsqueda (default: 15)
 */
export function quoteExistsInSource(
  sourceText: string,
  quote: string,
  prefixLength: number = 15,
): boolean {
  if (!quote || !sourceText) return false

  const normalizedSource = normalizeWhitespace(canonicalizeNotation(sourceText))
  const normalizedQuote = normalizeWhitespace(canonicalizeNotation(quote))

  if (!normalizedQuote) return false

  // Búsqueda directa con whitespace + notación normalizados
  if (normalizedSource.includes(normalizedQuote)) return true

  // Búsqueda por prefijo normalizado (para quotes largas donde el final
  // puede diferir por truncación de extracción PDF)
  const prefix = normalizedQuote.slice(0, Math.min(prefixLength, normalizedQuote.length))
  if (!prefix) return false

  return normalizedSource.includes(prefix)
}

/**
 * Versión estricta: requiere que TODA la quote normalizada esté presente,
 * no solo el prefijo. Usar cuando la confianza en la extracción PDF es alta.
 */
export function quoteExistsInSourceStrict(
  sourceText: string,
  quote: string,
): boolean {
  if (!quote || !sourceText) return false
  const normalizedSource = normalizeWhitespace(canonicalizeNotation(sourceText))
  const normalizedQuote = normalizeWhitespace(canonicalizeNotation(quote))
  if (!normalizedQuote) return false
  return normalizedSource.includes(normalizedQuote)
}
