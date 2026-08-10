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
// Deliberadamente estricto: parseNumericExpression exige que, tras recortar
// una unidad final opcional, el texto entero sea SOLO una expresión numérica
// reconocible — nunca intenta extraer un número de en medio de prosa. Esto
// evita que un distractor textual cualquiera "parezca" numéricamente
// equivalente por accidente; si no parsea limpio en ambos lados, no hay
// fallback de equivalencia.

export interface ParsedNumericExpression {
  value: number
  unit: string | null
}

const MULTIPLY_SIGNS = /[×xX·*]/g

// Formas soportadas (tras normalizar signos de multiplicación a "*"):
//   4.2e-3            (decimal + notación científica "e")
//   4,2               (coma decimal)
//   10^-2.38          (potencia de 10 en notación "^", con o sin paréntesis)
//   4.2 * 10^-3        (mantisa * potencia de 10)
//   -3.1               (negativos)
function parseBareNumericExpression(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  // mantisa opcional * 10^exponente, o 10^exponente solo.
  const powerOfTen = trimmed.match(
    /^(-?\d+(?:[.,]\d+)?\s*\*\s*)?10\s*\^\s*\(?(-?\d+(?:[.,]\d+)?)\)?$/i,
  )
  if (powerOfTen) {
    const mantissaRaw = powerOfTen[1]
    const mantissa = mantissaRaw ? Number(mantissaRaw.replace('*', '').replace(',', '.').trim()) : 1
    const exponent = Number(powerOfTen[2].replace(',', '.'))
    if (!Number.isFinite(mantissa) || !Number.isFinite(exponent)) return null
    return mantissa * Math.pow(10, exponent)
  }

  // decimal plano, opcionalmente con notación científica "e±N".
  const plain = trimmed.match(/^(-?\d+(?:[.,]\d+)?)(?:e([+-]?\d+))?$/i)
  if (plain) {
    const base = Number(plain[1].replace(',', '.'))
    if (!Number.isFinite(base)) return null
    if (plain[2] === undefined) return base
    const exponent = Number(plain[2])
    if (!Number.isFinite(exponent)) return null
    return base * Math.pow(10, exponent)
  }

  return null
}

export function parseNumericExpression(text: string | null | undefined): ParsedNumericExpression | null {
  if (typeof text !== 'string') return null
  const normalized = text.trim().replace(MULTIPLY_SIGNS, '*').replace(/\s+/g, ' ').trim()
  if (!normalized) return null

  // Intenta parsear el string completo como número puro primero (sin unidad).
  const bareValue = parseBareNumericExpression(normalized)
  if (bareValue !== null) return { value: bareValue, unit: null }

  // Si no, separa un posible sufijo de unidad al final (p.ej. "4.2e-3 M",
  // "10^-2.38 mol/L") y reintenta con la parte numérica.
  const unitSplit = normalized.match(/^(.*?)\s+([a-zA-ZμÅ°%\/·²³⁻¹⁰-]+(?:\s*\/\s*[a-zA-Z]+)?)$/)
  if (unitSplit) {
    const value = parseBareNumericExpression(unitSplit[1])
    if (value !== null) return { value, unit: unitSplit[2].trim() }
  }

  return null
}

// Tolerancia relativa por defecto: suficientemente ajustada para que
// expresiones "vagamente parecidas" nunca pasen (una expresión que no
// parsea limpio simplemente no entra a esta función), pero suficientemente
// laxa para absorber redondeo entre representaciones exactas de la misma
// cantidad (10^-2.38 vs 4.2×10^-3 difieren en <0.5% por redondeo de 2.38).
const DEFAULT_RELATIVE_TOLERANCE = 0.01

export function numericallyEquivalent(
  a: string | null | undefined,
  b: string | null | undefined,
  relativeTolerance: number = DEFAULT_RELATIVE_TOLERANCE,
): boolean {
  const parsedA = parseNumericExpression(a)
  const parsedB = parseNumericExpression(b)
  if (!parsedA || !parsedB) return false
  // Unidades: solo rechaza si AMBOS lados declaran una unidad y difieren —
  // ausencia de unidad en uno de los dos lados no es motivo de rechazo (E,
  // por diseño conservador: no inventamos una unidad que la pregunta no
  // pidió explícitamente).
  if (parsedA.unit && parsedB.unit && normalizeUnit(parsedA.unit) !== normalizeUnit(parsedB.unit)) return false
  const diff = Math.abs(parsedA.value - parsedB.value)
  const scale = Math.max(Math.abs(parsedA.value), Math.abs(parsedB.value), Number.EPSILON)
  return diff / scale <= relativeTolerance
}

function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\s+/g, '')
}
