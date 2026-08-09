// ═══════════════════════════════════════════════════════════════
// MISCONCEPTION TRACKER
//
// Registra y sigue el ciclo de vida de creencias incorrectas.
//
// Una misconception NO es un simple error:
// - Es una creencia específica, estable y resistente al cambio
// - Aparece repetidamente en respuestas distintas
// - El estudiante la mantiene con confianza
// - Requiere una intervención específica para corregirla
//
// Ciclo de vida:
// suspected → testing → confirmed → challenged → corrected | relapsed
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export type MisconceptionStatus =
  | 'suspected'    // Detectada en 1-2 instancias, no confirmada
  | 'testing'      // Se está diseñando actividad para confirmar
  | 'confirmed'    // Apareció 3+ veces o con alta confianza
  | 'challenged'   // Se intervino pero no se sabe si se corrigió
  | 'corrected'    // El estudiante demostró la comprensión correcta
  | 'relapsed'     // Fue corregida pero volvió a aparecer

export type MisconceptionCategory =
  | 'definition'           // Definición incorrecta del concepto
  | 'relation'             // Relación incorrecta entre conceptos
  | 'direction'            // Dirección equivocada (causa/efecto, mayor/menor)
  | 'scope'                // Aplica el concepto donde no corresponde
  | 'confusedConcepts'     // Confunde dos conceptos distintos
  | 'incompleteRule'       // Aplica una regla correcta pero incompleta
  | 'falseAnalogy'         // Usa una analogía incorrecta
  | 'prerequisiteError'    // Error en un prerrequisito que propaga el error

export interface Misconception {
  id: string
  // Qué cree incorrectamente
  statement: string             // "El estudiante cree que pH bajo = ácido débil"
  correctStatement: string      // "En realidad, pH bajo = ácido fuerte"
  // Clasificación
  category: MisconceptionCategory
  relatedMicroIds: string[]
  // Evidencia
  firstDetectedAt: number
  lastObservedAt: number
  observationCount: number      // veces que se observó
  highConfidenceCount: number   // veces que fue con alta confianza del estudiante
  // Estado
  status: MisconceptionStatus
  confirmedAt?: number
  correctedAt?: number
  relapseCount: number
  // Intervenciones aplicadas
  interventionsApplied: string[]  // IDs de estrategias usadas para corregirla
  lastInterventionAt?: number
}

// ═══════════════════════════════════════════════════════════════
// CREAR NUEVA MISCONCEPTION
// ═══════════════════════════════════════════════════════════════
export function createMisconception(params: {
  statement: string
  correctStatement: string
  category: MisconceptionCategory
  microId: string
  wasHighConfidence: boolean
}): Misconception {
  const now = Date.now()
  return {
    id: `misc_${now}_${Math.random().toString(36).slice(2, 8)}`,
    statement: params.statement,
    correctStatement: params.correctStatement,
    category: params.category,
    relatedMicroIds: [params.microId],
    firstDetectedAt: now,
    lastObservedAt: now,
    observationCount: 1,
    highConfidenceCount: params.wasHighConfidence ? 1 : 0,
    status: 'suspected',
    relapseCount: 0,
    interventionsApplied: [],
  }
}

// ═══════════════════════════════════════════════════════════════
// ACTUALIZAR MISCONCEPTION CUANDO SE VUELVE A OBSERVAR
// ═══════════════════════════════════════════════════════════════
export function observeMisconception(
  misconception: Misconception,
  wasHighConfidence: boolean,
): Misconception {
  const updated = {
    ...misconception,
    lastObservedAt: Date.now(),
    observationCount: misconception.observationCount + 1,
    highConfidenceCount: misconception.highConfidenceCount + (wasHighConfidence ? 1 : 0),
  }

  // Confirmar si se observó suficientes veces o con alta confianza consistente
  if (
    (updated.observationCount >= 3) ||
    (updated.highConfidenceCount >= 2) ||
    (updated.observationCount >= 2 && updated.highConfidenceCount >= 1)
  ) {
    updated.status = 'confirmed'
  } else if (updated.status === 'suspected') {
    updated.status = 'testing'
  }

  // Verificar relapse si estaba corregida
  if (misconception.status === 'corrected') {
    updated.status = 'relapsed'
    updated.relapseCount = misconception.relapseCount + 1
  }

  return updated
}

// ═══════════════════════════════════════════════════════════════
// REGISTRAR INTERVENCIÓN
// ═══════════════════════════════════════════════════════════════
export function recordIntervention(
  misconception: Misconception,
  strategyId: string,
): Misconception {
  return {
    ...misconception,
    interventionsApplied: [...misconception.interventionsApplied, strategyId],
    lastInterventionAt: Date.now(),
    status: 'challenged',
  }
}

// ═══════════════════════════════════════════════════════════════
// MARCAR COMO CORREGIDA
// ═══════════════════════════════════════════════════════════════
export function markMisconceptionCorrected(misconception: Misconception): Misconception {
  return {
    ...misconception,
    status: 'corrected',
    correctedAt: Date.now(),
  }
}

// ═══════════════════════════════════════════════════════════════
// OBTENER MISCONCEPTIONS ACTIVAS
// ═══════════════════════════════════════════════════════════════
export function getActiveMisconceptions(
  misconceptions: Misconception[],
  microId?: string,
): Misconception[] {
  const active = misconceptions.filter(m =>
    ['suspected', 'testing', 'confirmed', 'challenged', 'relapsed'].includes(m.status)
  )

  if (microId) {
    return active.filter(m => m.relatedMicroIds.includes(microId))
  }

  return active.sort((a, b) => {
    // Priorizar: confirmadas y relapsadas > testing > suspected
    const priority = { relapsed: 0, confirmed: 1, challenged: 2, testing: 3, suspected: 4 }
    return (priority[a.status as keyof typeof priority] || 5) -
           (priority[b.status as keyof typeof priority] || 5)
  })
}

// ═══════════════════════════════════════════════════════════════
// RESUMEN DE MISCONCEPTIONS
// ═══════════════════════════════════════════════════════════════
export function getMisconceptionSummary(misconceptions: Misconception[]): {
  total: number
  confirmed: number
  suspected: number
  corrected: number
  relapsed: number
  mostDangerous: Misconception | null
  requiresImmediateAttention: boolean
} {
  const confirmed = misconceptions.filter(m => m.status === 'confirmed')
  const suspected = misconceptions.filter(m => ['suspected', 'testing'].includes(m.status))
  const corrected = misconceptions.filter(m => m.status === 'corrected')
  const relapsed = misconceptions.filter(m => m.status === 'relapsed')

  // La más peligrosa: confirmada con alta confianza del estudiante
  const mostDangerous = [...confirmed, ...relapsed]
    .sort((a, b) => b.highConfidenceCount - a.highConfidenceCount)[0] || null

  // Requiere atención inmediata si hay confirmed o relapsed
  const requiresImmediateAttention = confirmed.length > 0 || relapsed.length > 0

  return {
    total: misconceptions.length,
    confirmed: confirmed.length,
    suspected: suspected.length,
    corrected: corrected.length,
    relapsed: relapsed.length,
    mostDangerous,
    requiresImmediateAttention,
  }
}

// ═══════════════════════════════════════════════════════════════
// DETECTAR POSIBLE MISCONCEPTION DESDE UN ERROR
// ═══════════════════════════════════════════════════════════════
export function detectMisconceptionFromError(params: {
  microId: string
  distractorChosen: string
  correctAnswer: string
  hypothesis: string
  isHighConfidence: boolean
  existingMisconceptions: Misconception[]
}): {
  isNewMisconception: boolean
  existingMatch: Misconception | null
  suggestedStatement: string
} {
  const { microId, distractorChosen, correctAnswer, hypothesis, isHighConfidence, existingMisconceptions } = params

  // Buscar si ya existe una misconception similar para este micro
  const existingMatch = existingMisconceptions.find(m =>
    m.relatedMicroIds.includes(microId) &&
    m.statement.toLowerCase().includes(distractorChosen.toLowerCase().slice(0, 20)) &&
    ['suspected', 'testing', 'confirmed', 'relapsed'].includes(m.status)
  ) || null

  // Solo es potencial misconception si fue con alta confianza
  const isNewMisconception = !existingMatch && isHighConfidence

  const suggestedStatement = `El estudiante eligió "${distractorChosen}" en vez de "${correctAnswer}". ${hypothesis}`

  return {
    isNewMisconception,
    existingMatch,
    suggestedStatement,
  }
}
