// ═══════════════════════════════════════════════════════════════
// StudyAL — Student Memory
// No recuerda el material. Recuerda al estudiante.
// Cada programa que completa deja huella.
// ═══════════════════════════════════════════════════════════════

export type LearningPattern =
  | 'practice_learner'      // Aprende haciendo, no leyendo
  | 'visual_learner'        // Funciona mejor con mapas y organización
  | 'memory_learner'        // Necesita repetición para retener
  | 'deep_thinker'          // Necesita entender antes de memorizar
  | 'exam_performer'        // Rinde bien bajo presión
  | 'anxiety_prone'         // Se bloquea en simulaciones
  | 'fast_learner'          // Sube rápido, olvida rápido
  | 'steady_learner'        // Sube despacio, retiene bien
  | 'unknown'

export type EnginePreference = {
  engine: string
  avgScore: number
  sessions: number
  trend: 'improving' | 'stable' | 'declining'
}

export interface ProgramRecord {
  programId: string
  materialId: string
  materialName: string
  completedAt: number
  initialDomain: number
  finalDomain: number
  targetScore: number
  achieved: boolean
  sessionsCompleted: number
  totalSessions: number
  strategyUsed: string
  strategyChanges: number
  avgSessionScore: number
  weakestConcepts: string[]
  strongestConcepts: string[]
}

export interface StudentMemory {
  userId: string
  createdAt: number
  updatedAt: number

  // Patrones detectados
  dominantPattern: LearningPattern
  patternConfidence: number     // 0-100
  secondaryPatterns: LearningPattern[]

  // Preferencias de motores (qué le funciona mejor)
  enginePreferences: EnginePreference[]

  // Historial de programas
  programHistory: ProgramRecord[]

  // Métricas globales
  totalStudyMinutes: number
  totalSessions: number
  avgDomainGainPerSession: number
  avgSessionScore: number

  // Patrones de comportamiento
  bestSessionTime: 'morning' | 'afternoon' | 'evening' | 'unknown'
  avgSessionLength: number      // minutos reales
  consistencyScore: number      // 0-100: qué tan regular estudia
  dropoffRisk: number           // 0-100: probabilidad de abandonar

  // Qué estrategias le han funcionado mejor
  successfulStrategies: string[]
  failedStrategies: string[]

  // Lo que no funciona para este estudiante
  knownBlockers: string[]       // ej: "se bloquea en exámenes", "olvida rápido"

  // Insights para el próximo programa
  nextProgramHints: string[]
}

// ── Storage ──────────────────────────────────────────────────────

const MEMORY_KEY = 'studyal_student_memory_v1'

export function loadStudentMemory(userId: string): StudentMemory | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(`${MEMORY_KEY}_${userId}`)
    if (!raw) return null
    return JSON.parse(raw) as StudentMemory
  } catch {
    return null
  }
}

export function saveStudentMemory(memory: StudentMemory): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(
      `${MEMORY_KEY}_${memory.userId}`,
      JSON.stringify(memory)
    )
  } catch {}
}

export function createEmptyStudentMemory(userId: string): StudentMemory {
  return {
    userId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dominantPattern: 'unknown',
    patternConfidence: 0,
    secondaryPatterns: [],
    enginePreferences: [],
    programHistory: [],
    totalStudyMinutes: 0,
    totalSessions: 0,
    avgDomainGainPerSession: 0,
    avgSessionScore: 0,
    bestSessionTime: 'unknown',
    avgSessionLength: 0,
    consistencyScore: 0,
    dropoffRisk: 0,
    successfulStrategies: [],
    failedStrategies: [],
    knownBlockers: [],
    nextProgramHints: [],
  }
}

// ═══════════════════════════════════════════════════════════════
// ACTUALIZAR MEMORIA DESPUÉS DE UN PROGRAMA
// ═══════════════════════════════════════════════════════════════

export function updateStudentMemoryAfterProgram(
  memory: StudentMemory,
  record: ProgramRecord,
  engineResults: Array<{ engine: string; score: number }>,
): StudentMemory {
  const updated = { ...memory, updatedAt: Date.now() }

  // Agregar al historial
  updated.programHistory = [...memory.programHistory.slice(-19), record]

  // Actualizar métricas globales
  updated.totalSessions += record.sessionsCompleted
  const totalPrograms = updated.programHistory.length
  updated.avgDomainGainPerSession = Math.round(
    updated.programHistory.reduce((sum, p) => {
      const gain = p.finalDomain - p.initialDomain
      return sum + (gain / Math.max(1, p.sessionsCompleted))
    }, 0) / totalPrograms
  )

  // Actualizar preferencias de motores
  for (const result of engineResults) {
    const existing = updated.enginePreferences.find(e => e.engine === result.engine)
    if (existing) {
      const newAvg = Math.round(
        (existing.avgScore * existing.sessions + result.score) / (existing.sessions + 1)
      )
      const trend: EnginePreference['trend'] =
        newAvg > existing.avgScore + 5 ? 'improving' :
        newAvg < existing.avgScore - 5 ? 'declining' : 'stable'

      existing.avgScore = newAvg
      existing.sessions += 1
      existing.trend = trend
    } else {
      updated.enginePreferences.push({
        engine: result.engine,
        avgScore: result.score,
        sessions: 1,
        trend: 'stable',
      })
    }
  }

  // Estrategias exitosas vs fallidas
  if (record.achieved) {
    if (!updated.successfulStrategies.includes(record.strategyUsed)) {
      updated.successfulStrategies = [
        ...updated.successfulStrategies.slice(-4),
        record.strategyUsed,
      ]
    }
  } else {
    if (!updated.failedStrategies.includes(record.strategyUsed)) {
      updated.failedStrategies = [
        ...updated.failedStrategies.slice(-4),
        record.strategyUsed,
      ]
    }
  }

  // Detectar patrón dominante
  updated.dominantPattern = detectLearningPattern(updated)
  updated.patternConfidence = calculatePatternConfidence(updated)

  // Calcular riesgo de abandono
  updated.dropoffRisk = calculateDropoffRisk(updated)

  // Generar hints para el próximo programa
  updated.nextProgramHints = generateNextProgramHints(updated)

  return updated
}

// ── Detectar patrón de aprendizaje ──────────────────────────────

function detectLearningPattern(memory: StudentMemory): LearningPattern {
  if (memory.totalSessions < 3) return 'unknown'

  const prefs = memory.enginePreferences

  const quizScore = prefs.find(e => e.engine === 'quiz')?.avgScore ?? 0
  const flashScore = prefs.find(e => e.engine === 'flashcards')?.avgScore ?? 0
  const analisisScore = prefs.find(e => e.engine === 'analisis')?.avgScore ?? 0
  const mapScore = prefs.find(e => e.engine === 'studymap')?.avgScore ?? 0
  const examScore = prefs.find(e => e.engine === 'examen')?.avgScore ?? 0

  // Aprende haciendo
  if (quizScore >= 75 && quizScore > analisisScore + 15) return 'practice_learner'

  // Visual
  if (mapScore >= 70 && mapScore > flashScore + 10) return 'visual_learner'

  // Memoria
  if (flashScore >= 75 && flashScore > quizScore + 10) return 'memory_learner'

  // Pensador profundo
  if (analisisScore >= 75 && analisisScore > quizScore + 10) return 'deep_thinker'

  // Rinde bajo presión
  if (examScore >= 75 && examScore > quizScore - 5) return 'exam_performer'

  // Se bloquea en exámenes
  if (examScore < 40 && quizScore > 60) return 'anxiety_prone'

  // Aprende rápido
  if (memory.avgDomainGainPerSession >= 12) return 'fast_learner'

  // Aprende despacio
  if (memory.avgDomainGainPerSession > 0 && memory.avgDomainGainPerSession < 6) return 'steady_learner'

  return 'unknown'
}

function calculatePatternConfidence(memory: StudentMemory): number {
  if (memory.totalSessions < 3) return 0
  if (memory.totalSessions < 6) return 40
  if (memory.totalSessions < 12) return 65
  if (memory.totalSessions < 20) return 80
  return 92
}

function calculateDropoffRisk(memory: StudentMemory): number {
  if (memory.programHistory.length === 0) return 30

  const lastProgram = memory.programHistory[memory.programHistory.length - 1]
  const daysSinceLast = (Date.now() - lastProgram.completedAt) / (1000 * 60 * 60 * 24)

  let risk = 0

  // No ha estudiado en días
  if (daysSinceLast > 7) risk += 30
  else if (daysSinceLast > 3) risk += 15

  // Consitencia baja
  if (memory.consistencyScore < 30) risk += 20

  // No logró el objetivo en el último programa
  if (!lastProgram.achieved) risk += 15

  // Muchos cambios de estrategia = confusión
  if (lastProgram.strategyChanges > 2) risk += 10

  return Math.min(100, risk)
}

function generateNextProgramHints(memory: StudentMemory): string[] {
  const hints: string[] = []
  const pattern = memory.dominantPattern

  if (pattern === 'practice_learner') {
    hints.push('Este estudiante aprende mejor con práctica. Priorizar quiz y examen antes que lectura.')
  }
  if (pattern === 'memory_learner') {
    hints.push('Necesita más flashcards y menos teoría extensa.')
  }
  if (pattern === 'deep_thinker') {
    hints.push('Necesita entender antes de memorizar. No saltar análisis.')
  }
  if (pattern === 'anxiety_prone') {
    hints.push('Se bloquea en simulaciones. Hacer más práctica gradual antes del examen simulado.')
  }
  if (pattern === 'fast_learner') {
    hints.push('Aprende rápido. Reducir sesiones de comprensión y ir directo a aplicación.')
  }
  if (pattern === 'steady_learner') {
    hints.push('Necesita más repeticiones. No acortar el programa aunque parezca que ya sabe.')
  }

  // Motores que no le funcionan
  const weakEngines = memory.enginePreferences
    .filter(e => e.avgScore < 40 && e.sessions >= 2)
    .map(e => e.engine)
  if (weakEngines.length > 0) {
    hints.push(`Evitar o reducir: ${weakEngines.join(', ')}. No le funcionan bien a este estudiante.`)
  }

  // Riesgo de abandono
  if (memory.dropoffRisk > 50) {
    hints.push('Alto riesgo de abandono. Sesiones más cortas y celebrar pequeños logros.')
  }

  return hints.slice(0, 4)
}

// ── Labels para UI ───────────────────────────────────────────────

export const PATTERN_LABELS: Record<LearningPattern, string> = {
  practice_learner: 'Aprende haciendo',
  visual_learner: 'Aprende visualmente',
  memory_learner: 'Aprende por repetición',
  deep_thinker: 'Aprende en profundidad',
  exam_performer: 'Rinde bajo presión',
  anxiety_prone: 'Necesita práctica gradual',
  fast_learner: 'Aprende rápido',
  steady_learner: 'Aprende de forma constante',
  unknown: 'Aún analizando tu patrón',
}

export const PATTERN_EMOJI: Record<LearningPattern, string> = {
  practice_learner: '🎯',
  visual_learner: '🗺️',
  memory_learner: '🎴',
  deep_thinker: '🔬',
  exam_performer: '📝',
  anxiety_prone: '🌱',
  fast_learner: '⚡',
  steady_learner: '🏗️',
  unknown: '🤔',
}
