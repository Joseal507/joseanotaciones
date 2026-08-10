/**
 * matchingValidator.ts
 *
 * Validación determinista, post-generación, de preguntas "matching" — sin LLM.
 *
 * Motivación (P3, generación real con OpenRouter): en 2 de 2 preguntas matching
 * observadas en una muestra de 6 dominios reales, el modelo produjo pares con las
 * descripciones ("right") desplazadas entre "left" distintos — p.ej. Diástole
 * emparejado con la descripción real de Sístole y viceversa — mientras el propio
 * campo `explanation` de la pregunta describía la relación correcta. El shape era
 * internamente consistente (correctAnswer[pairId] == options[pairId].rightId), así
 * que una validación de forma no detecta nada: hay que comparar el CONTENIDO de
 * cada right contra el target enseñado.
 *
 * Dos capas, ambas deterministas:
 *  1. Estructural: bijectividad real, IDs referencialmente íntegros, sin pares o
 *     descripciones duplicadas.
 *  2. Grounding de contenido: usa targetFactKeys/explanation (ya presentes en la
 *     pregunta, sin nueva infraestructura) para verificar que cada right encaja
 *     mejor con SU PROPIO left que con cualquier otro — comparación relativa
 *     ponderada por frecuencia inversa de palabra (así los términos genéricos
 *     compartidos por varias fact keys, p.ej. "apertura de válvulas", no ocultan
 *     el término discriminante real, p.ej. "mitral" vs "aórtica").
 *
 * Si no hay señal de grounding suficiente para juzgar con seguridad, la capa 2 no
 * rechaza por sí sola (evita falsos positivos) — pero la capa 1 sí es siempre
 * exigible.
 */

export interface MatchingOption {
  id: string
  left: string
  right: string
  rightId: string
}

export interface MatchingValidationResult {
  valid: boolean
  reason?: string
}

const STOPWORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'en', 'y', 'a', 'del', 'que', 'por', 'con',
  'un', 'una', 'su', 'sus', 'se', 'es', 'al', 'para', 'como', 'o', 'u', 'e',
  'the', 'of', 'a', 'an', 'in', 'on', 'and', 'or', 'to', 'for', 'with', 'is',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    // length>1 (no solo >2): símbolos cortos reales (Kc, pH, Na, K) deben seguir
    // aportando señal — filtrarlos deja leftWords/rightWords vacíos y el par
    // pierde toda señal de grounding (falso "no verificable" que oculta drift
    // real, ver auditoría P3). Las stopwords de 2 letras ya están excluidas
    // explícitamente arriba.
    .filter(word => word.length > 1 && !STOPWORDS.has(word))
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map(sentence => sentence.trim()).filter(Boolean)
}

// Normalización LITERAL para detectar duplicados exactos — deliberadamente NO usa
// tokenize() (que descarta stopwords y palabras cortas): "Fase A" y "Fase B" deben
// seguir siendo términos distintos, no colapsar ambos a "fase". Solo colapsa
// diferencias de mayúsculas/acentos/espacios, no de contenido.
function normalizeLiteral(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Capa 1: estructural ────────────────────────────────────────

export function validateMatchingStructure(
  options: MatchingOption[],
  correctAnswer: Record<string, unknown>,
): MatchingValidationResult {
  if (!Array.isArray(options) || options.length < 2) {
    return { valid: false, reason: 'MATCHING_INSUFFICIENT_PAIRS' }
  }
  for (const option of options) {
    if (!option?.id || !option?.left || !option?.right || !option?.rightId) {
      return { valid: false, reason: 'MATCHING_INCOMPLETE_PAIR' }
    }
  }
  const pairIds = options.map(option => option.id)
  if (new Set(pairIds).size !== pairIds.length) {
    return { valid: false, reason: 'MATCHING_DUPLICATE_PAIR_ID' }
  }
  const rightIds = options.map(option => option.rightId)
  if (new Set(rightIds).size !== rightIds.length) {
    return { valid: false, reason: 'MATCHING_NON_BIJECTIVE_RIGHT_IDS' }
  }
  if (Object.keys(correctAnswer).length !== options.length) {
    return { valid: false, reason: 'MATCHING_CORRECT_ANSWER_COUNT_MISMATCH' }
  }
  for (const option of options) {
    if (correctAnswer[option.id] !== option.rightId) {
      return { valid: false, reason: 'MATCHING_CORRECT_ANSWER_ID_MISMATCH' }
    }
  }
  const seenRights = new Set<string>()
  for (const option of options) {
    const key = normalizeLiteral(option.right)
    if (key && seenRights.has(key)) return { valid: false, reason: 'MATCHING_DUPLICATE_RIGHT_DESCRIPTION' }
    seenRights.add(key)
  }
  const seenLefts = new Set<string>()
  for (const option of options) {
    const key = normalizeLiteral(option.left)
    if (key && seenLefts.has(key)) return { valid: false, reason: 'MATCHING_DUPLICATE_LEFT_TERM' }
    seenLefts.add(key)
  }
  return { valid: true }
}

// ─── Capa 2: grounding de contenido ─────────────────────────────

function weightedRecall(queryWords: string[], targetWords: Set<string>, weight: (word: string) => number): number {
  if (!queryWords.length) return 0
  let matched = 0
  let total = 0
  for (const word of queryWords) {
    const w = weight(word)
    total += w
    if (targetWords.has(word)) matched += w
  }
  return total > 0 ? matched / total : 0
}

function bestJointScore(
  leftWords: string[],
  rightWords: string[],
  docs: Set<string>[],
  weight: (word: string) => number,
): number {
  let best = 0
  for (const doc of docs) {
    const score = weightedRecall(leftWords, doc, weight) * weightedRecall(rightWords, doc, weight)
    if (score > best) best = score
  }
  return best
}

// Umbral mínimo para considerar que existe evidencia real de grounding — por
// debajo, tratamos la pregunta como "no verificable con esta señal" y no la
// usamos para rechazar (evita falsos positivos por groundingTexts pobres).
const MIN_SIGNAL = 0.15
// La permutación alternativa debe superar a la declarada por un margen real,
// no por ruido de tokenización — encontrado auditando 108 preguntas reales:
// con un margen pequeño, factKeys cortos generan falsos positivos porque un
// factKey que describe el par B menciona de pasada un término del par A.
const PERMUTATION_MARGIN = 0.3
// La capa 2 compara la asignación declarada contra TODAS las permutaciones de
// los pares juzgables — factorial en su número. Preguntas reales auditadas
// tienen 3-6 pares; por encima de esta cota el costo deja de ser instantáneo
// (medido: 8 pares ~100ms, 10 pares ~13s) y puede colgar la petición sin límite
// superior. Por encima de la cota, la capa 2 no rechaza por permutación (mismo
// comportamiento que "sin señal suficiente para juzgar" en MIN_SIGNAL) — la
// capa 1 estructural (bijectividad, IDs, duplicados) se sigue exigiendo siempre,
// sin excepción, independientemente del tamaño.
const MAX_PERMUTATION_PAIRS = 8

function* permutations(indices: number[]): Generator<number[]> {
  if (indices.length <= 1) { yield indices; return }
  for (let i = 0; i < indices.length; i++) {
    const rest = [...indices.slice(0, i), ...indices.slice(i + 1)]
    for (const perm of permutations(rest)) yield [indices[i], ...perm]
  }
}

export function validateMatchingGrounding(
  options: MatchingOption[],
  groundingTexts: string[],
): MatchingValidationResult {
  const docs = groundingTexts.map(text => new Set(tokenize(text))).filter(doc => doc.size > 0)
  if (!docs.length) return { valid: true }

  const documentFrequency = new Map<string, number>()
  for (const doc of docs) {
    for (const word of doc) documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1)
  }
  // Palabras que NUNCA aparecen en ningún grounding doc deben pesar tanto como
  // las más específicas (df=1), NO cero — si pesaran 0 desaparecerían del
  // denominador y un right/left con mucho vocabulario propio no grounded podría
  // marcar recall=1.0 solo por las pocas palabras que sí coinciden por azar en
  // algún doc (falso positivo real, encontrado auditando 108 preguntas reales).
  const weight = (word: string): number => {
    const df = documentFrequency.get(word)
    return df ? 1 / df : 1
  }

  const tokenized = options.map(option => ({
    option,
    leftWords: tokenize(option.left),
    rightWords: tokenize(option.right),
  }))

  // Pares sin ningún token propio (p.ej. símbolos de una sola letra como "v",
  // "d", "t" en una fórmula) no tienen nada verificable — se excluyen del
  // problema de asignación entero, no solo de su propia fila/columna.
  const judgeable = tokenized.map((t, i) => i).filter(i => tokenized[i].leftWords.length && tokenized[i].rightWords.length)
  if (judgeable.length < 2) return { valid: true }
  if (judgeable.length > MAX_PERMUTATION_PAIRS) return { valid: true }

  // Matriz left_i × right_j SOLO sobre índices juzgables — necesaria para
  // detectar incluso una rotación cíclica completa (TODOS los pares
  // desplazados), donde ningún par declarado (i,i) por sí solo alcanzaría
  // señal mínima aunque el grounding SÍ sea informativo para la combinación
  // correcta (i, j≠i).
  const score = new Map<string, number>()
  for (const i of judgeable) {
    for (const j of judgeable) {
      score.set(`${i}:${j}`, bestJointScore(tokenized[i].leftWords, tokenized[j].rightWords, docs, weight))
    }
  }
  const globalBest = Math.max(...score.values())

  // Si NINGUNA combinación left×right alcanza señal mínima, el grounding
  // disponible no permite juzgar esta pregunta con seguridad — no rechazar.
  if (globalBest < MIN_SIGNAL) return { valid: true }

  // Problema de asignación: ¿existe una permutación de rights sobre los pares
  // juzgables que puntúe CLARAMENTE mejor en total que la declarada (identidad)?
  // Esto es más robusto que comparar pares aislados: una coincidencia léxica
  // incidental de UN factKey con OTRO par no basta para superar a la
  // asignación completa declarada, que ya viene anclada por sus propios
  // términos en el resto de los pares.
  const identityTotal = judgeable.reduce((sum, i) => sum + (score.get(`${i}:${i}`) || 0), 0)
  let bestTotal = identityTotal
  let bestPerm: number[] = judgeable
  for (const perm of permutations(judgeable)) {
    const total = judgeable.reduce((sum, position) => sum + (score.get(`${judgeable[position]}:${perm[position]}`) || 0), 0)
    if (total > bestTotal) { bestTotal = total; bestPerm = perm }
  }

  if (bestTotal > identityTotal + PERMUTATION_MARGIN) {
    const driftedIndex = judgeable.find((i, position) => bestPerm[position] !== i)
    const driftedOption = driftedIndex !== undefined ? tokenized[driftedIndex].option : tokenized[judgeable[0]].option
    return { valid: false, reason: `MATCHING_CONTENT_DRIFT:${driftedOption.id}` }
  }
  return { valid: true }
}

// ─── API pública ─────────────────────────────────────────────────

export function validateMatchingQuestion(question: {
  options?: unknown
  correctAnswer?: unknown
  targetFactKeys?: unknown
  explanation?: unknown
}): MatchingValidationResult {
  const options = Array.isArray(question.options) ? question.options as MatchingOption[] : null
  const correctAnswer = question.correctAnswer && typeof question.correctAnswer === 'object' && !Array.isArray(question.correctAnswer)
    ? question.correctAnswer as Record<string, unknown>
    : null
  if (!options || !correctAnswer) return { valid: false, reason: 'MATCHING_SHAPE_INVALID' }

  const structural = validateMatchingStructure(options, correctAnswer)
  if (!structural.valid) return structural

  // Se combinan siempre targetFactKeys (segmentados por hecho) y las oraciones
  // de explanation. Un intento anterior prefería factKeys en solitario cuando
  // alcanzaban a cubrir todos los pares, para evitar que una explanation en UNA
  // sola oración ("A es X, B es Y, y C es Z") hiciera que cualquier left
  // encontrara cualquier right — pero eso podía perder la señal cuando los
  // factKeys de la pregunta cubren un aspecto distinto al que describen las
  // opciones (hallazgo real, ver matching-academic-validity-contracts.ts). La
  // comparación por ASIGNACIÓN COMPLETA (permutación) ya resuelve el problema
  // original de raíz — no hace falta elegir una sola fuente.
  const factKeyTexts = Array.isArray(question.targetFactKeys)
    ? question.targetFactKeys.filter((v): v is string => typeof v === 'string')
    : []
  const groundingTexts = [...factKeyTexts, ...(typeof question.explanation === 'string' ? splitSentences(question.explanation) : [])]
  return validateMatchingGrounding(options, groundingTexts)
}
