// BUG 2 (prueba humana real): "10^-2.38 M" y "4.2 × 10^-3 M" son el mismo
// valor, pero solo una de las dos representaciones estaba marcada como
// correctAnswer en una pregunta multiple_choice — el grading por igualdad de
// id no evalúa nunca el contenido numérico de las opciones, así que la
// equivalente fue calificada incorrecta (false non-mastery -> recovery
// innecesario). No se puede regenerar retroactivamente el contenido ya
// existente (instrucción explícita), así que la corrección vive en el
// grading: un parser de expresiones numéricas compartido, reusado tanto por
// el fallback de equivalencia en multiple_choice/scenario/find_the_error
// (scoring.ts) como por numeric_problem (que antes solo entendía decimales
// planos + notación científica "e", no "^"/"×10^").
//
// AUDITORÍA ADVERSARIAL (post-7a3c3f7, Finding 3 CONFIRMED): la versión
// original usaba una tolerancia relativa GLOBAL del 1% aplicada a CUALQUIER
// par de opciones MCQ que parsearan como número — esto aceptaba un
// distractor genuinamente distinto ("100.9" vs "100", diferencia real
// ~0.9%) como si fuera la respuesta correcta, y aceptaba "5" como
// equivalente a "5 kg" (unidad ausente en un lado, nunca debe asumirse
// equivalencia). Peor: el caso real que SÍ debe reconocerse (10^-2.38 vs
// 4.2×10^-3, diferencia real ~0.745%) tiene una diferencia relativa MENOR
// que el distractor inválido (~0.9%) — ningún porcentaje global fijo puede
// distinguir ambos casos, por diseño.
//
// Fix: en vez de una tolerancia porcentual arbitraria, cada representación
// numérica lleva su PROPIA precisión implícita (cifras significativas/
// decimales realmente escritas) — dos representaciones son equivalentes
// SOLO si los rangos de incertidumbre que esa precisión implica se solapan.
// Esto es "redondeo consistente con un mismo valor verdadero", no cercanía
// arbitraria: "100" (precisión ±0.5, ronda a la unidad) y "100.9"
// (precisión ±0.05) NO se solapan -> correctamente distintos. "10^-2.38"
// (±0.005 en el EXPONENTE, escala logarítmica) y "4.2×10^-3" (±0.05 en la
// mantisa) SÍ se solapan -> correctamente equivalentes.
//
// Deliberadamente estricto en el parseo: parseNumericExpression exige que,
// tras recortar una unidad final opcional, el texto entero sea SOLO una
// expresión numérica reconocible — nunca intenta extraer un número de en
// medio de prosa. Esto evita que un distractor textual cualquiera "parezca"
// numéricamente equivalente por accidente; si no parsea limpio en ambos
// lados, no hay fallback de equivalencia.

export interface ParsedNumericExpression {
  value: number
  unit: string | null
  // Rango de incertidumbre implícito por la precisión REALMENTE escrita en
  // esta representación (cifras decimales de la mantisa, o del exponente en
  // notación de potencia continua) — nunca un porcentaje arbitrario.
  rangeLow: number
  rangeHigh: number
}

const MULTIPLY_SIGNS = /[×xX·*]/g

function decimalPlaces(digits: string): number {
  const dot = digits.indexOf('.')
  return dot === -1 ? 0 : digits.length - dot - 1
}

interface BareNumericExpression {
  value: number
  rangeLow: number
  rangeHigh: number
}

// Formas soportadas (tras normalizar signos de multiplicación a "*"):
//   4.2e-3            (decimal + notación científica "e")
//   4,2               (coma decimal)
//   10^-2.38          (potencia de 10 en notación "^", con o sin paréntesis)
//   4.2 * 10^-3        (mantisa * potencia de 10)
//   -3.1               (negativos)
function parseBareNumericExpression(text: string): BareNumericExpression | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  // Forma "potencia de 10 CONTINUA": 10^exponente, exponente posiblemente
  // decimal (p.ej. "10^-2.38", propio de escalas logarítmicas como pH). La
  // precisión viene de las cifras decimales del EXPONENTE — su incertidumbre
  // se traduce a un rango multiplicativo en el valor resultante, no aditivo.
  const powerOfTen = trimmed.match(
    /^(-?\d+(?:[.,]\d+)?\s*\*\s*)?10\s*\^\s*\(?(-?\d+(?:[.,]\d+)?)\)?$/i,
  )
  if (powerOfTen) {
    const mantissaRaw = powerOfTen[1]
    const mantissa = mantissaRaw ? Number(mantissaRaw.replace('*', '').replace(',', '.').trim()) : 1
    const exponentText = powerOfTen[2].replace(',', '.')
    const exponent = Number(exponentText)
    if (!Number.isFinite(mantissa) || !Number.isFinite(exponent)) return null
    const exponentDecimals = decimalPlaces(exponentText.replace('-', ''))
    const halfUlpExponent = exponentDecimals > 0 ? 0.5 * Math.pow(10, -exponentDecimals) : 0
    const value = mantissa * Math.pow(10, exponent)
    const low = mantissa * Math.pow(10, exponent - halfUlpExponent)
    const high = mantissa * Math.pow(10, exponent + halfUlpExponent)
    return { value, rangeLow: Math.min(low, high), rangeHigh: Math.max(low, high) }
  }

  // Forma "mantisa × 10^entero" o decimal plano (con o sin notación
  // científica "e"): la precisión viene de las cifras decimales de la
  // MANTISA — el exponente entero, si existe, se trata como exacto (nunca se
  // escribe con incertidumbre propia en esta notación).
  const plain = trimmed.match(/^(-?\d+(?:[.,]\d+)?)(?:e([+-]?\d+))?$/i)
  if (plain) {
    const mantissaText = plain[1].replace(',', '.')
    const base = Number(mantissaText)
    if (!Number.isFinite(base)) return null
    const exponent = plain[2] !== undefined ? Number(plain[2]) : 0
    if (!Number.isFinite(exponent)) return null
    const mantissaDecimals = decimalPlaces(mantissaText.replace('-', ''))
    const halfUlp = 0.5 * Math.pow(10, -mantissaDecimals)
    const scale = Math.pow(10, exponent)
    const value = base * scale
    return { value, rangeLow: (base - halfUlp) * scale, rangeHigh: (base + halfUlp) * scale }
  }

  return null
}

export function parseNumericExpression(text: string | null | undefined): ParsedNumericExpression | null {
  if (typeof text !== 'string') return null
  const normalized = text.trim().replace(MULTIPLY_SIGNS, '*').replace(/\s+/g, ' ').trim()
  if (!normalized) return null

  // Intenta parsear el string completo como número puro primero (sin unidad).
  const bare = parseBareNumericExpression(normalized)
  if (bare !== null) return { ...bare, unit: null }

  // Si no, separa un posible sufijo de unidad al final (p.ej. "4.2e-3 M",
  // "10^-2.38 mol/L") y reintenta con la parte numérica.
  const unitSplit = normalized.match(/^(.*?)\s+([a-zA-ZμÅ°%\/·²³⁻¹⁰-]+(?:\s*\/\s*[a-zA-Z]+)?)$/)
  if (unitSplit) {
    const parsed = parseBareNumericExpression(unitSplit[1])
    if (parsed !== null) return { ...parsed, unit: unitSplit[2].trim() }
  }

  return null
}

export function numericallyEquivalent(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const parsedA = parseNumericExpression(a)
  const parsedB = parseNumericExpression(b)
  if (!parsedA || !parsedB) return false
  // Unidades (E): si CUALQUIERA de los dos lados declara una unidad, AMBOS
  // deben declararla y coincidir — nunca se asume equivalencia cuando la
  // unidad está ausente en un solo lado (una "5" sin unidad frente a
  // "5 kg" NO son la misma afirmación, aunque el número coincida).
  if (parsedA.unit || parsedB.unit) {
    if (!parsedA.unit || !parsedB.unit) return false
    if (normalizeUnit(parsedA.unit) !== normalizeUnit(parsedB.unit)) return false
  }
  // Equivalentes si los rangos de incertidumbre implícitos por la precisión
  // REALMENTE escrita en cada representación se solapan — nunca una
  // tolerancia porcentual arbitraria desconectada de esa precisión. Un
  // distractor genuinamente distinto (aunque numéricamente cercano) tiene
  // rangos que no se tocan; dos representaciones de la MISMA cantidad,
  // redondeadas de forma consistente, sí.
  return parsedA.rangeLow <= parsedB.rangeHigh && parsedB.rangeLow <= parsedA.rangeHigh
}

function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\s+/g, '')
}
