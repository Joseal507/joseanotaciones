// ═══════════════════════════════════════════════════════════════
// StudyAL — Error Causality Engine
// No basta con saber que falló.
// ALAI debe saber POR QUÉ falló.
// ═══════════════════════════════════════════════════════════════

export type ErrorCause =
  | 'confusion_similar'     // Confundió dos conceptos similares
  | 'missing_prerequisite'  // Falta un concepto previo
  | 'memorized_not_applied' // Memorizó pero no puede aplicar
  | 'illusion'              // Creía que sabía pero no
  | 'vocabulary'            // Problema de terminología
  | 'partial_knowledge'     // Sabe parte pero no el todo
  | 'time_pressure'         // Sabe pero falló por velocidad
  | 'unknown'

export interface ErrorPattern {
  cause: ErrorCause
  affectedConcepts: string[]
  frequency: number         // cuántas veces ocurrió este patrón
  lastSeen: number          // timestamp
  repairStrategy: string    // qué hace ALAI para corregirlo
  repairEngine: string      // qué motor usar
}

export interface ErrorMemory {
  patterns: ErrorPattern[]
  totalErrors: number
  mostFrequentCause: ErrorCause | null
  lastUpdated: number
}

// ── Crear memoria de errores vacía ───────────────────────────────
export function createEmptyErrorMemory(): ErrorMemory {
  return {
    patterns: [],
    totalErrors: 0,
    mostFrequentCause: null,
    lastUpdated: Date.now(),
  }
}

// ── Detectar causa del error ─────────────────────────────────────
export function detectErrorCause(params: {
  conceptName: string
  userAnswer: string
  correctAnswer: string
  confidence: number        // 0-100
  timeMs: number
  previousMistakes: number
  relatedConcepts: string[]
}): ErrorCause {
  const { confidence, timeMs, previousMistakes, userAnswer, correctAnswer } = params

  // Ilusión de conocimiento: alta confianza + incorrecto
  if (confidence > 70) return 'illusion'

  // Tiempo muy corto: respondió sin pensar
  if (timeMs < 3000 && previousMistakes > 0) return 'time_pressure'

  // Error repetido: falta prerequisito
  if (previousMistakes >= 3) return 'missing_prerequisite'

  // Respuesta parcialmente correcta
  const answerWords = correctAnswer.toLowerCase().split(' ')
  const userWords = userAnswer.toLowerCase().split(' ')
  const overlap = answerWords.filter(w => userWords.includes(w) && w.length > 3).length
  if (overlap > 0 && overlap < answerWords.length * 0.5) return 'partial_knowledge'

  // Vocabulario: respuesta correcta en concepto pero término incorrecto
  if (userAnswer.length > 20 && correctAnswer.length > 20) return 'vocabulary'

  return 'unknown'
}

// ── Repair strategy por causa ─────────────────────────────────────
export const REPAIR_BY_CAUSE: Record<ErrorCause, {
  strategy: string
  engine: string
  instruction: string
}> = {
  confusion_similar: {
    strategy: 'Comparación explícita de los dos conceptos',
    engine: 'alai',
    instruction: 'Vamos a comparar estos dos conceptos directamente para que nunca más los confundas.',
  },
  missing_prerequisite: {
    strategy: 'Refuerzo del concepto prerequisito primero',
    engine: 'analisis',
    instruction: 'Antes de continuar, necesitamos dominar el concepto base que te está fallando.',
  },
  memorized_not_applied: {
    strategy: 'Casos prácticos del concepto',
    engine: 'quiz',
    instruction: 'Sabes la definición pero no puedes usarla. Vamos a practicar con casos reales.',
  },
  illusion: {
    strategy: 'Preguntas trampa y explicación activa',
    engine: 'alai',
    instruction: 'Explícame este concepto con tus palabras. Quiero verificar que realmente lo dominas.',
  },
  vocabulary: {
    strategy: 'Familiarización con terminología específica',
    engine: 'flashcards',
    instruction: 'El problema es la terminología. Vamos a anclar los términos correctos.',
  },
  partial_knowledge: {
    strategy: 'Completar el conocimiento parcial',
    engine: 'alai',
    instruction: 'Sabes parte del concepto. Vamos a completar la imagen.',
  },
  time_pressure: {
    strategy: 'Práctica de velocidad con flashcards',
    engine: 'flashcards',
    instruction: 'Lo sabes pero necesitas más velocidad. Flashcards con tiempo limitado.',
  },
  unknown: {
    strategy: 'Revisión general del concepto',
    engine: 'alai',
    instruction: 'Vamos a revisar este concepto desde cero.',
  },
}

// ── Registrar error en la memoria ────────────────────────────────
export function recordError(
  memory: ErrorMemory,
  conceptName: string,
  cause: ErrorCause,
): ErrorMemory {
  const existing = memory.patterns.find(
    p => p.cause === cause && p.affectedConcepts.includes(conceptName)
  )

  let updatedPatterns: ErrorPattern[]

  if (existing) {
    updatedPatterns = memory.patterns.map(p =>
      p === existing
        ? { ...p, frequency: p.frequency + 1, lastSeen: Date.now() }
        : p
    )
  } else {
    const repair = REPAIR_BY_CAUSE[cause]
    updatedPatterns = [
      ...memory.patterns,
      {
        cause,
        affectedConcepts: [conceptName],
        frequency: 1,
        lastSeen: Date.now(),
        repairStrategy: repair.strategy,
        repairEngine: repair.engine,
      },
    ]
  }

  const allCauses = updatedPatterns.map(p => p.cause)
  const causeFreq: Partial<Record<ErrorCause, number>> = {}
  for (const cause of allCauses) {
    causeFreq[cause] = (causeFreq[cause] || 0) + 1
  }
  const mostFrequent = Object.entries(causeFreq)
    .sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0] as ErrorCause | undefined

  return {
    patterns: updatedPatterns.slice(-20),
    totalErrors: memory.totalErrors + 1,
    mostFrequentCause: mostFrequent ?? null,
    lastUpdated: Date.now(),
  }
}

// ── Generar mensaje de reparación específico ──────────────────────
export function buildRepairMessage(pattern: ErrorPattern): string {
  const repair = REPAIR_BY_CAUSE[pattern.cause]
  const concepts = pattern.affectedConcepts.slice(0, 2).join(' y ')

  const prefixes: Record<ErrorCause, string> = {
    confusion_similar: `Estás confundiendo ${concepts}.`,
    missing_prerequisite: `Te falta la base para entender ${concepts}.`,
    memorized_not_applied: `Memorizaste ${concepts} pero no puedes aplicarlo.`,
    illusion: `Crees que dominas ${concepts}, pero los errores dicen otra cosa.`,
    vocabulary: `El problema es la terminología de ${concepts}.`,
    partial_knowledge: `Tienes conocimiento parcial de ${concepts}.`,
    time_pressure: `Sabes ${concepts} pero necesitas más velocidad.`,
    unknown: `Hay una dificultad con ${concepts}.`,
  }

  return `${prefixes[pattern.cause]} ${repair.instruction}`
}
