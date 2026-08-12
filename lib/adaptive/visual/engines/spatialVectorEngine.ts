import type { SpatialVectorDataSpec, VisualGradingResult, VisualSourceSpan } from '../visualContract'

export interface SpatialVectorExtraction { data: SpatialVectorDataSpec; sourceSpans: VisualSourceSpan[] }

// Números cardinales en español (0-29 + decenas 30-90) — vocabulario general
// del idioma, NO frases del stress test — para leer magnitudes/ángulos que el
// material escriba en palabras ("treinta grados") en vez de dígitos.
const NUMBER_WORDS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
  veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
}
const TENS_WORDS: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
}
function normalizeWord(w: string): string {
  return w.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}
function parseSpanishNumberWords(phrase: string): number | null {
  const words = phrase.trim().split(/\s+/).map(normalizeWord).filter(Boolean)
  if (words.length === 1) {
    if (words[0] in NUMBER_WORDS) return NUMBER_WORDS[words[0]]
    if (words[0] in TENS_WORDS) return TENS_WORDS[words[0]]
    return null
  }
  if (words.length === 3 && words[1] === 'y' && words[0] in TENS_WORDS && words[2] in NUMBER_WORDS) {
    return TENS_WORDS[words[0]] + NUMBER_WORDS[words[2]]
  }
  return null
}
// Busca dígitos+unidad primero; si no hay, escanea hasta 3 tokens de palabra
// inmediatamente antes de la unidad buscando un numeral en español válido
// (probando el span más corto primero para no arrastrar palabras de relleno
// como "es"/"de").
function findNumberBeforeUnit(clause: string, unitPattern: RegExp): number | null {
  const digitMatch = clause.match(new RegExp(String.raw`(\d+(?:[.,]\d+)?)\s*(?:${unitPattern.source})`, 'i'))
  if (digitMatch) return Number(digitMatch[1].replace(',', '.'))
  const unitWordMatch = clause.match(new RegExp(String.raw`\b((?:[a-záéíóúñ]+\s+){0,2}[a-záéíóúñ]+)\s+(?:${unitPattern.source})`, 'i'))
  if (!unitWordMatch) return null
  const words = unitWordMatch[1].trim().split(/\s+/)
  for (let span = Math.min(3, words.length); span >= 1; span--) {
    const candidate = words.slice(words.length - span).join(' ')
    const parsed = parseSpanishNumberWords(candidate)
    if (parsed !== null) return parsed
  }
  return null
}

const FORCE_LABELS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bpeso\b/i, label: 'Peso' },
  { pattern: /\bnormal\b/i, label: 'Normal' },
  { pattern: /\bfricci[oó]n\b/i, label: 'Fricción' },
  { pattern: /\btensi[oó]n\b/i, label: 'Tensión' },
  { pattern: /\bempuje\b/i, label: 'Empuje' },
  { pattern: /\bfuerza\s+aplicada\b/i, label: 'Fuerza aplicada' },
  { pattern: /\bfuerza\b/i, label: 'Fuerza' },
]
// Direcciones expresadas en palabras (sin número) — convención física estándar,
// no inventa HACIA dónde apunta la fuerza, solo traduce una dirección YA
// explícita en el texto a grados.
const DIRECTIONAL_ANGLES: Array<{ pattern: RegExp; angle: number }> = [
  { pattern: /hacia\s+arriba/i, angle: 90 },
  { pattern: /hacia\s+abajo/i, angle: 270 },
  { pattern: /hacia\s+la\s+derecha/i, angle: 0 },
  { pattern: /hacia\s+la\s+izquierda/i, angle: 180 },
]

function extractAngle(clause: string): number | null {
  const numericOrWord = findNumberBeforeUnit(clause, /°|grados?/)
  if (numericOrWord !== null) return numericOrWord
  for (const { pattern, angle } of DIRECTIONAL_ANGLES) if (pattern.test(clause)) return angle
  return null
}
function extractLabel(clause: string, usedLabels: Set<string>, index: number): string {
  for (const { pattern, label } of FORCE_LABELS) {
    if (pattern.test(clause)) return usedLabels.has(label) ? `${label} ${index}` : label
  }
  return `Fuerza ${index}`
}

// Extrae fuerzas (etiqueta, magnitud, ángulo) grounded en el texto — YA NO
// exige un formato literal tipo "Peso = 50 N a 270°": lee lenguaje natural
// normal ("Se aplica una fuerza de 50 N a 30° sobre la horizontal"),
// clásula por cláusula, para no mezclar datos de fuerzas distintas. Cada
// fuerza exige magnitud+unidad Y ángulo/dirección EN LA MISMA cláusula — si
// falta el ángulo, esa fuerza se omite (nunca se inventa un ángulo; el
// contrato exige angleDeg numérico, no opcional). Si ninguna cláusula aporta
// una fuerza completa, devuelve null (fail closed).
export function extractSpatialVectorSpec(sourceText: string, factKeys: string[], sourceStepId: string): SpatialVectorExtraction | null {
  // Frontera de cláusula: también coma/dos puntos, no solo fin de oración —
  // varias fuerzas suelen listarse en una sola oración separadas por comas
  // ("Peso = 50 N a 270°, Normal = 43.3 N a 90°."), y sin esto la segunda
  // fuerza de la lista se perdería (magnitud/ángulo de la primera contaminaría
  // el escaneo de la segunda).
  const clauses = sourceText.split(/(?<=[.!?,;:])\s+/).map(s => s.trim()).filter(Boolean)
  const forces: SpatialVectorDataSpec['forces'] = []
  const usedLabels = new Set<string>()
  const quotes: string[] = []

  for (const clause of clauses) {
    const magnitude = findNumberBeforeUnit(clause, /N\b|newtons?\b/)
    if (magnitude === null) continue
    const angle = extractAngle(clause)
    if (angle === null) continue // fail closed para ESTA fuerza — nunca inventar el ángulo
    const index = forces.length + 1
    const label = extractLabel(clause, usedLabels, index)
    usedLabels.add(label)
    forces.push({ id: `force_${index}`, label, magnitude, angleDeg: angle, unit: 'N' })
    quotes.push(clause)
  }
  if (!forces.length) return null

  const bodyMatch = sourceText.match(/\b(caja|bloque|cuerpo|objeto|carro|carrito|placa|masa)\b/i)
    || sourceText.match(/Sobre (?:el|la)\s+([^\s]+(?:\s[^\s]+)?)\s+act[uú]an/i)
  const body = (bodyMatch?.[1] || bodyMatch?.[0] || 'cuerpo').trim()

  return {
    data: { body, forces, axes: { x: 'horizontal', y: 'vertical' } },
    sourceSpans: factKeys.map(factKey => ({ stepId: sourceStepId, factKey, quote: quotes[0] })),
  }
}

export function gradeSpatialVectorInteraction(
  data: SpatialVectorDataSpec,
  verb: 'place_vector',
  response: unknown,
): VisualGradingResult {
  const submitted = response as Record<string, { angleDeg?: number; magnitude?: number }> | null
  if (!submitted || typeof submitted !== 'object') {
    return { correct: false, score: 0, evidenceKind: 'visual_construction', feedback: 'Ubica cada fuerza en el diagrama.', errorType: 'missing_response' }
  }
  const angleTolerance = 5
  const results = data.forces.map(force => {
    const attempt = submitted[force.id]
    if (!attempt || typeof attempt.angleDeg !== 'number') return false
    const angleOk = Math.abs(attempt.angleDeg - force.angleDeg) <= angleTolerance
    if (force.magnitude === null) return angleOk
    const magnitudeTolerance = Math.max(0.5, force.magnitude * 0.05)
    const magnitudeOk = typeof attempt.magnitude === 'number' && Math.abs(attempt.magnitude - force.magnitude) <= magnitudeTolerance
    return angleOk && magnitudeOk
  })
  const hits = results.filter(Boolean).length
  const score = data.forces.length ? Math.round((hits / data.forces.length) * 100) : 0
  const correct = score === 100
  return {
    correct,
    score,
    evidenceKind: 'visual_construction',
    feedback: correct ? 'Diagrama de cuerpo libre correcto.' : 'Alguna fuerza tiene ángulo o magnitud incorrectos.',
    errorType: correct ? null : 'free_body_diagram',
  }
}
