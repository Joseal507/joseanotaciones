// Auditoría adversarial (Codex, misión REAL-SESSION QUALITY, B1/B4
// CONFIRMADO P0): existían guards de IDENTIDAD (factKey/objectiveId/
// cognitiveTarget se preservan correctamente) pero ninguno de SEMÁNTICA —
// una pregunta de recovery podía declararse con el factKey/cognitiveTarget
// original y aun así introducir una dimensión conceptual nunca enseñada
// (p.ej. "ordenar por complejidad estructural" cuando el hecho enseñado era
// "algunos compuestos con carbono son inorgánicos"). Este guard es
// deliberadamente estructural/determinista (no un motor pedagógico nuevo):
// detecta frases-disparador de operaciones de ranking/clasificación/
// jerarquía y exige que el sustantivo de la dimensión comparada aparezca en
// el texto fuente permitido (hechos + keyPoints + contenido de reteach
// generado de esos mismos hechos). No prohíbe reutilizar vocabulario
// técnico inevitable — solo rechaza cuando la dimensión comparada es
// ausente del material realmente enseñado.

export interface DimensionGuardInput {
  questionText: string
  allowedText: string[]
}

export interface DimensionGuardResult {
  unsupported: boolean
  reason?: 'QUESTION_UNSUPPORTED_DIMENSION'
  trigger?: string
  dimension?: string
}

// `dimensionInMatch: true` => el propio texto disparador YA ES la dimensión
// comparada (p.ej. "complejidad"), se evalúa contra allowedText tal cual.
// `dimensionInMatch: false` => la dimensión va DESPUÉS del disparador
// (p.ej. "...ordena X de|por|según [DIMENSIÓN]"); las palabras capturadas
// por el comodín ANTES de la preposición (el sujeto: "estos compuestos")
// casi siempre son vocabulario legítimo ya enseñado y NO deben poder
// "blanquear" una dimensión distinta que aparece después.
const DIMENSION_TRIGGER_PATTERNS: { pattern: RegExp; dimensionInMatch: boolean }[] = [
  { pattern: /ordena(r)?\s+(?:[a-z0-9áéíóúñ]+\s+){0,4}(de|por|según)\s+/i, dimensionInMatch: false },
  { pattern: /de\s+(menor|mayor)\s+a\s+(mayor|menor)\s+/i, dimensionInMatch: false },
  { pattern: /clasifica(r)?\s+(?:[a-z0-9áéíóúñ]+\s+){0,4}(por|según)\s+/i, dimensionInMatch: false },
  { pattern: /jerarqu[ií]a/i, dimensionInMatch: true },
  { pattern: /complejidad/i, dimensionInMatch: true },
  { pattern: /rank(ing)?\s+(?:[a-z0-9]+\s+){0,4}by\s+/i, dimensionInMatch: false },
  { pattern: /order(ing)?\s+(?:[a-z0-9]+\s+){0,4}by\s+/i, dimensionInMatch: false },
  { pattern: /criterio\s+de\s+/i, dimensionInMatch: false },
  { pattern: /seg[uú]n\s+su\s+/i, dimensionInMatch: false },
  { pattern: /origen\s+(mineral|geológico)/i, dimensionInMatch: true },
]

const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'por', 'según', 'su', 'sus', 'que',
  'con', 'para', 'una', 'uno', 'unos', 'unas', 'esta', 'este', 'estos',
  'estas', 'the', 'by', 'of', 'to', 'and', 'or', 'a', 'an', 'is', 'are',
])

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function significantWords(clause: string): string[] {
  return clause
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter(word => word.length >= 5 && !STOPWORDS.has(word))
    .slice(0, 6)
}

// Cortar en la primera puntuación: la lista de opciones/ejemplos que suele
// seguir a la frase-disparador (p.ej. ": CO2, carbonatos, grafito") no es
// parte de la dimensión comparada y NO debe usarse para "justificar"
// términos legítimos que aparecen ahí — solo la cláusula inmediata cuenta.
function firstClause(text: string): string {
  return text.split(/[.,;:¿?¡!]/)[0] || ''
}

export function detectUnsupportedQuestionDimension(input: DimensionGuardInput): DimensionGuardResult {
  const question = normalize(input.questionText || '')
  const allowed = normalize((input.allowedText || []).filter(Boolean).join(' '))
  for (const { pattern, dimensionInMatch } of DIMENSION_TRIGGER_PATTERNS) {
    const match = pattern.exec(question)
    if (!match) continue
    const candidates = dimensionInMatch
      ? significantWords(match[0])
      : significantWords(firstClause(question.slice(match.index + match[0].length)))
    if (candidates.length === 0) continue
    // Auditoría adversarial (Codex, revisión final, P0 hallazgo #1,
    // segunda observación): `.some()` dejaba pasar una dimensión
    // multi-palabra completa ("origen mineral") si SOLO la palabra más
    // genérica ("origen") existía en algún lugar del texto permitido —
    // suficiente para "blanquear" el término realmente distintivo
    // ("mineral"). Exigir el candidato MÁS LARGO (típicamente el sustantivo
    // más específico/distintivo, menos probable que coincida por
    // casualidad) evita ese blanqueo sin ser tan estricto como exigir TODOS
    // los candidatos — palabras funcionales/comparativas cortas capturadas
    // junto al sustantivo real (p.ej. "menor"/"mayor" en "de menor a mayor
    // complejidad") no deberían por sí solas decidir el resultado.
    const longestCandidate = candidates.reduce((longest, word) => word.length > longest.length ? word : longest, candidates[0])
    const grounded = allowed.includes(longestCandidate)
    if (!grounded) {
      return {
        unsupported: true,
        reason: 'QUESTION_UNSUPPORTED_DIMENSION',
        trigger: match[0],
        dimension: candidates.join(' '),
      }
    }
  }
  return { unsupported: false }
}
