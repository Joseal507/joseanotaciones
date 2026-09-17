// ============================================================
// JSON Truncation Recovery — Material Brain
//
// Recupera objetos JSON COMPLETOS de una respuesta parcialmente
// truncada. NUNCA inventa ni completa semántica.
//
// Principio: RECUPERAR OBJETOS COMPLETOS, NUNCA REPARAR SEMÁNTICA.
//
// Maneja correctamente:
// - JSON completo válido
// - JSON truncado después de objetos completos
// - JSON truncado dentro de un objeto
// - Braces dentro de strings
// - Escaped quotes
// - Arrays/objetos anidados
// ============================================================

export interface TruncationRecoveryResult {
  recovered: unknown[]
  truncatedCount: number
  strategy: 'full_parse' | 'partial_recovery' | 'none'
}

/**
 * Extrae objetos JSON completos de un texto que puede estar truncado.
 * Usa un parser de estado explícito — NO regex — para manejar strings
 * con braces/corchetes y escaped quotes correctamente.
 */
export function extractCompleteObjects(text: string): TruncationRecoveryResult {
  const source = String(text || '').trim()

  // Intento 1: JSON completo válido
  try {
    const parsed = JSON.parse(source)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // Objeto raíz: buscar el primer array de items
      for (const key of Object.keys(parsed)) {
        if (Array.isArray(parsed[key])) {
          return {
            recovered: parsed[key],
            truncatedCount: 0,
            strategy: 'full_parse',
          }
        }
      }
      return { recovered: [], truncatedCount: 0, strategy: 'full_parse' }
    }
    if (Array.isArray(parsed)) {
      return { recovered: parsed, truncatedCount: 0, strategy: 'full_parse' }
    }
    return { recovered: [], truncatedCount: 0, strategy: 'full_parse' }
  } catch {
    // Continúa con recovery parcial
  }

  // Intento 2: recovery parcial — encontrar el array de items
  // Buscar el primer '[' que sea inicio de array de objetos
  const arrayStart = findFirstObjectArray(source)
  if (arrayStart === -1) {
    return { recovered: [], truncatedCount: 0, strategy: 'none' }
  }

  const objects = extractObjectsFromArrayText(source, arrayStart)
  return {
    recovered: objects.complete,
    truncatedCount: objects.truncatedCount,
    strategy: objects.complete.length > 0 ? 'partial_recovery' : 'none',
  }
}

/**
 * Encuentra la posición del primer '[' que inicia un array de objetos
 * (no dentro de un string).
 */
function findFirstObjectArray(source: string): number {
  const state = new ParserState(source)
  while (state.pos < source.length) {
    const ch = source[state.pos]
    if (state.inString) {
      if (ch === '\\') {
        state.pos += 2 // skip escaped char
        continue
      }
      if (ch === '"') state.inString = false
      state.pos++
      continue
    }
    if (ch === '"') {
      state.inString = true
      state.pos++
      continue
    }
    if (ch === '[') return state.pos
    state.pos++
  }
  return -1
}

class ParserState {
  pos: number = 0
  inString: boolean = false
  constructor(public source: string) {}
}

interface ExtractResult {
  complete: unknown[]
  truncatedCount: number
}

/**
 * Extrae objetos completos del array que comienza en arrayStart.
 * Un objeto es "completo" si el parser de estado llega a depth=0 y
 * puede parsear el substring resultante con JSON.parse sin error.
 */
function extractObjectsFromArrayText(source: string, arrayStart: number): ExtractResult {
  const complete: unknown[] = []
  let truncatedCount = 0

  // Avanzar más allá del '['
  let pos = arrayStart + 1

  while (pos < source.length) {
    // Skip whitespace y comas entre objetos
    while (pos < source.length && (source[pos] === ',' || source[pos] === ' ' || source[pos] === '\n' || source[pos] === '\r' || source[pos] === '\t')) {
      pos++
    }
    if (pos >= source.length) break
    if (source[pos] === ']') break // fin del array (JSON completo)
    if (source[pos] !== '{') {
      // carácter inesperado — truncación
      truncatedCount++
      break
    }

    // Encontrar el fin del objeto actual con parser de estado
    const objectEnd = findObjectEnd(source, pos)
    if (objectEnd === -1) {
      // Objeto incompleto (truncado)
      truncatedCount++
      break
    }

    const objectText = source.slice(pos, objectEnd + 1)
    try {
      const parsed = JSON.parse(objectText)
      complete.push(parsed)
    } catch {
      // El substring que el parser dijo que era completo no pasó JSON.parse —
      // raro pero defensivo: no incluirlo
      truncatedCount++
    }
    pos = objectEnd + 1
  }

  return { complete, truncatedCount }
}

/**
 * Encuentra el índice del '}' que cierra el objeto que empieza en startPos.
 * Maneja:
 * - strings con cualquier contenido (incluyendo { } [ ])
 * - escaped quotes (\")
 * - arrays y objetos anidados
 *
 * Retorna -1 si el objeto está truncado (nunca cierra).
 */
export function findObjectEnd(source: string, startPos: number): number {
  let depth = 0
  let inString = false
  let pos = startPos

  while (pos < source.length) {
    const ch = source[pos]

    if (inString) {
      if (ch === '\\') {
        pos += 2 // skip escaped character (incluyendo \")
        continue
      }
      if (ch === '"') inString = false
      pos++
      continue
    }

    if (ch === '"') {
      inString = true
      pos++
      continue
    }

    if (ch === '{' || ch === '[') {
      depth++
      pos++
      continue
    }

    if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return pos
      pos++
      continue
    }

    pos++
  }

  return -1 // truncado
}

/**
 * Intenta parsear una respuesta LLM que debería contener un objeto
 * con una clave de array (e.g. { "units": [...], "relations": [...] }).
 *
 * Si el JSON está truncado, recupera los objetos completos de cada array.
 *
 * Retorna el objeto reconstruido con los arrays que se pudieron recuperar,
 * más metadata de recovery.
 */
export interface LLMResponseRecovery {
  result: Record<string, unknown[]>
  isPartial: boolean
  recoveredArrays: string[]
  truncatedObjectsPerArray: Record<string, number>
  strategy: 'full_parse' | 'partial_recovery' | 'none'
}

export function recoverLLMResponse(
  rawText: string,
  expectedArrayKeys: string[],
): LLMResponseRecovery {
  const source = String(rawText || '').trim()

  // Intento 1: JSON completo válido
  try {
    const parsed = JSON.parse(source)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const result: Record<string, unknown[]> = {}
      for (const key of expectedArrayKeys) {
        result[key] = Array.isArray(parsed[key]) ? parsed[key] : []
      }
      return {
        result,
        isPartial: false,
        recoveredArrays: expectedArrayKeys.filter(k => result[k].length > 0),
        truncatedObjectsPerArray: Object.fromEntries(expectedArrayKeys.map(k => [k, 0])),
        strategy: 'full_parse',
      }
    }
  } catch {
    // continúa
  }

  // Intento 2: recovery clave por clave
  const result: Record<string, unknown[]> = {}
  const truncatedObjectsPerArray: Record<string, number> = {}
  const recoveredArrays: string[] = []
  let anyTruncated = false

  for (const key of expectedArrayKeys) {
    const arrayResult = extractArrayForKey(source, key)
    result[key] = arrayResult.items
    truncatedObjectsPerArray[key] = arrayResult.truncatedCount
    if (arrayResult.items.length > 0) recoveredArrays.push(key)
    if (arrayResult.truncatedCount > 0) anyTruncated = true
  }

  const strategy = recoveredArrays.length > 0 ? 'partial_recovery' : 'none'

  return {
    result,
    isPartial: anyTruncated,
    recoveredArrays,
    truncatedObjectsPerArray,
    strategy,
  }
}

/**
 * Busca la clave `key` en el JSON (incluso truncado) y extrae su array.
 * Ejemplo: busca `"units":[` y extrae los objetos completos del array.
 */
function extractArrayForKey(source: string, key: string): { items: unknown[]; truncatedCount: number } {
  // Buscar `"key"` seguido de `:` y `[`
  // Usamos búsqueda de texto simple porque la clave es conocida y controlada
  const keyPattern = `"${key}"`
  let searchPos = 0

  while (searchPos < source.length) {
    const keyPos = source.indexOf(keyPattern, searchPos)
    if (keyPos === -1) return { items: [], truncatedCount: 0 }

    // Verificar que no estemos dentro de un string
    // (simplificación: si el key está en una posición "razonable" del JSON)
    let afterKey = keyPos + keyPattern.length
    // Skip whitespace
    while (afterKey < source.length && (source[afterKey] === ' ' || source[afterKey] === '\n' || source[afterKey] === '\r' || source[afterKey] === '\t')) {
      afterKey++
    }
    if (afterKey >= source.length || source[afterKey] !== ':') {
      searchPos = keyPos + 1
      continue
    }
    afterKey++ // skip ':'
    // Skip whitespace
    while (afterKey < source.length && (source[afterKey] === ' ' || source[afterKey] === '\n' || source[afterKey] === '\r' || source[afterKey] === '\t')) {
      afterKey++
    }
    if (afterKey >= source.length || source[afterKey] !== '[') {
      searchPos = keyPos + 1
      continue
    }

    // Encontramos el array — extraer objetos
    const extracted = extractObjectsFromArrayText(source, afterKey)
    return { items: extracted.complete, truncatedCount: extracted.truncatedCount }
  }

  return { items: [], truncatedCount: 0 }
}
