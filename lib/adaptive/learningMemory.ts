// ═══════════════════════════════════════════════════════════════
// StudyAL — Learning Memory
// Detecta automáticamente cómo aprende el estudiante.
// No onboarding. Aprendido desde evidencia real.
// ═══════════════════════════════════════════════════════════════

export type LearningStyle =
  | 'explanation_first'   // entiende mejor leyendo
  | 'practice_first'      // entiende mejor haciendo
  | 'memory_first'        // necesita repetición antes de aplicar
  | 'visual_first'        // necesita mapas y estructuras
  | 'unknown'

export type LearningPattern =
  | 'learns_fast'
  | 'forgets_fast'
  | 'overconfident'       // cree saber más de lo que sabe
  | 'underconfident'      // sabe más de lo que cree
  | 'slow_but_accurate'
  | 'fast_but_careless'
  | 'needs_examples'
  | 'needs_analogies'
  | 'struggles_with_application'
  | 'strong_recall'

export interface SessionEvidence {
  sessionId: string
  timestamp: number
  topicId: string
  purpose: string             // understand | memorize | apply | simulate | repair
  stepType: string            // explain | recall | quiz | flashcards | exam
  score: number               // 0-100
  timeSpentMs: number
  correct: boolean
  wasFirstAttempt: boolean
  hadToRepeat: boolean
}

export interface LearningMemory {
  userId?: string
  materialId: string

  // Estilo aprendido automáticamente
  learningStyle: LearningStyle
  styleConfidence: number         // 0-100 qué tan seguro estamos del estilo

  // Patrones detectados
  patterns: LearningPattern[]

  // Métricas acumuladas
  avgScoreByStepType: Record<string, number>
  avgTimeByStepType: Record<string, number>
  successRateByPurpose: Record<string, number>

  // Memoria de sesiones
  sessionHistory: SessionEvidence[]
  totalSessions: number
  totalTimeMs: number

  // Preferencias inferidas
  preferredDifficulty: number     // 0-100
  optimalSessionLength: number    // minutos
  bestTimeOfDay?: 'morning' | 'afternoon' | 'night'

  // Última actualización
  updatedAt: number
}

// ── Crear memoria vacía ──────────────────────────────────────
export function createEmptyLearningMemory(materialId: string): LearningMemory {
  return {
    materialId,
    learningStyle: 'unknown',
    styleConfidence: 0,
    patterns: [],
    avgScoreByStepType: {},
    avgTimeByStepType: {},
    successRateByPurpose: {},
    sessionHistory: [],
    totalSessions: 0,
    totalTimeMs: 0,
    preferredDifficulty: 50,
    optimalSessionLength: 20,
    updatedAt: Date.now(),
  }
}

// ── Actualizar memoria después de una sesión ─────────────────
export function updateLearningMemory(
  memory: LearningMemory,
  evidence: SessionEvidence,
): LearningMemory {
  const updated = { ...memory }

  // Agregar a historial (máx 50)
  updated.sessionHistory = [...memory.sessionHistory, evidence].slice(-50)
  updated.totalSessions += 1
  updated.totalTimeMs += evidence.timeSpentMs
  updated.updatedAt = Date.now()

  // Actualizar avg por stepType
  const existing = memory.avgScoreByStepType[evidence.stepType]
  updated.avgScoreByStepType = {
    ...memory.avgScoreByStepType,
    [evidence.stepType]: existing !== undefined
      ? Math.round((existing * 0.7) + (evidence.score * 0.3))
      : evidence.score,
  }

  // Actualizar avg tiempo por stepType
  const existingTime = memory.avgTimeByStepType[evidence.stepType]
  updated.avgTimeByStepType = {
    ...memory.avgTimeByStepType,
    [evidence.stepType]: existingTime !== undefined
      ? Math.round((existingTime * 0.7) + (evidence.timeSpentMs * 0.3))
      : evidence.timeSpentMs,
  }

  // Actualizar success rate por purpose
  const existingRate = memory.successRateByPurpose[evidence.purpose]
  const newRate = evidence.correct ? 100 : 0
  updated.successRateByPurpose = {
    ...memory.successRateByPurpose,
    [evidence.purpose]: existingRate !== undefined
      ? Math.round((existingRate * 0.7) + (newRate * 0.3))
      : newRate,
  }

  // Inferir estilo desde evidencia acumulada
  if (updated.totalSessions >= 3) {
    updated.learningStyle = inferLearningStyle(updated)
    updated.styleConfidence = Math.min(100, updated.totalSessions * 8)
    updated.patterns = inferPatterns(updated)
    updated.preferredDifficulty = inferPreferredDifficulty(updated)
    updated.optimalSessionLength = inferOptimalLength(updated)
  }

  return updated
}

// ── Inferir estilo de aprendizaje ────────────────────────────
function inferLearningStyle(memory: LearningMemory): LearningStyle {
  const scores = memory.avgScoreByStepType
  const explainScore = scores['explain'] ?? 0
  const recallScore = scores['active_recall'] ?? 0
  const quizScore = scores['micro_quiz'] ?? 0
  const flashScore = scores['micro_flashcards'] ?? 0

  // Mejor en explicación que en práctica → explanation_first
  if (explainScore > 0 && explainScore > quizScore + 15) return 'explanation_first'

  // Mejor en quiz/práctica → practice_first
  if (quizScore > 0 && quizScore > explainScore + 10) return 'practice_first'

  // Mejor en flashcards → memory_first
  if (flashScore > 0 && flashScore > quizScore + 10) return 'memory_first'

  // Recall alto → explanation + repetition
  if (recallScore > 70) return 'explanation_first'

  return 'unknown'
}

// ── Inferir patrones ─────────────────────────────────────────
function inferPatterns(memory: LearningMemory): LearningPattern[] {
  const patterns: LearningPattern[] = []
  const recent = memory.sessionHistory.slice(-10)
  const scores = memory.avgScoreByStepType

  // Aprende rápido: score promedio alto en pocas sesiones
  const avgAll = Object.values(scores)
  const globalAvg = avgAll.length > 0
    ? avgAll.reduce((a, b) => a + b, 0) / avgAll.length
    : 0

  if (globalAvg >= 75 && memory.totalSessions <= 5) patterns.push('learns_fast')

  // Overconfident: falla exámenes pero cree saber
  const examRate = memory.successRateByPurpose['simulate']
  const recallRate = memory.successRateByPurpose['understand']
  if (examRate !== undefined && recallRate !== undefined) {
    if (recallRate > 70 && examRate < 50) patterns.push('overconfident')
    if (recallRate < 50 && examRate > 70) patterns.push('underconfident')
  }

  // Struggles with application
  const applyRate = memory.successRateByPurpose['apply']
  if (applyRate !== undefined && applyRate < 45) patterns.push('struggles_with_application')

  // Strong recall
  const memRate = memory.successRateByPurpose['memorize']
  if (memRate !== undefined && memRate > 80) patterns.push('strong_recall')

  // Needs examples (falla en abstract, bien en concreto)
  const quizScore = scores['micro_quiz'] ?? 0
  const flashScore = scores['micro_flashcards'] ?? 0
  if (flashScore > 70 && quizScore < 55) patterns.push('needs_examples')

  return patterns
}

// ── Inferir dificultad ideal ─────────────────────────────────
function inferPreferredDifficulty(memory: LearningMemory): number {
  // Zona de flujo: 70-80% de aciertos = dificultad ideal
  const successRates = Object.values(memory.successRateByPurpose)
  if (successRates.length === 0) return 50

  const avgSuccess = successRates.reduce((a, b) => a + b, 0) / successRates.length

  if (avgSuccess > 85) return Math.min(90, memory.preferredDifficulty + 10)
  if (avgSuccess < 50) return Math.max(20, memory.preferredDifficulty - 10)
  return memory.preferredDifficulty
}

// ── Inferir longitud óptima de sesión ────────────────────────
function inferOptimalLength(memory: LearningMemory): number {
  if (memory.totalSessions < 3) return 20

  const recentTimes = memory.sessionHistory
    .slice(-5)
    .map(s => s.timeSpentMs / 60000) // a minutos

  if (recentTimes.length === 0) return 20

  const avgMinutes = recentTimes.reduce((a, b) => a + b, 0) / recentTimes.length
  return Math.min(45, Math.max(10, Math.round(avgMinutes)))
}

// ── Obtener recomendación de ruta basada en memoria ──────────
export function getStyleBasedRoute(
  memory: LearningMemory,
  defaultRoute: string[],
): string[] {
  if (memory.styleConfidence < 30) return defaultRoute

  const style = memory.learningStyle
  const patterns = memory.patterns

  // Practice first → empezar con quiz, luego explicar
  if (style === 'practice_first') {
    return ['apply', 'understand', 'memorize', 'simulate']
  }

  // Memory first → flashcards primero
  if (style === 'memory_first') {
    return ['memorize', 'understand', 'apply', 'simulate']
  }

  // Explanation first → estándar pero con más recall
  if (style === 'explanation_first') {
    return ['understand', 'organize', 'memorize', 'apply', 'simulate']
  }

  // Overconfident → forzar examen antes
  if (patterns.includes('overconfident')) {
    return ['simulate', 'repair', 'apply', 'simulate']
  }

  // Struggles with application → más práctica
  if (patterns.includes('struggles_with_application')) {
    return ['understand', 'apply', 'repair', 'apply', 'simulate']
  }

  return defaultRoute
}

// ── Storage ──────────────────────────────────────────────────
const MEMORY_PREFIX = 'studyal_learning_memory_'

export function loadLearningMemory(materialId: string): LearningMemory | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(MEMORY_PREFIX + materialId)
    if (!raw) return null
    return JSON.parse(raw) as LearningMemory
  } catch { return null }
}

export function saveLearningMemory(memory: LearningMemory): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(MEMORY_PREFIX + memory.materialId, JSON.stringify(memory))
  } catch {}
}

// ═══════════════════════════════════════════════════════════════
// MEMORIA LONGITUDINAL — entre materiales
// ═══════════════════════════════════════════════════════════════

export interface GlobalConceptMemory {
  userId?: string
  concepts: Record<string, {
    name: string
    lastSeenMaterialId: string
    lastSeenAt: number
    totalAttempts: number
    avgScore: number
    dominated: boolean        // avg >= 80
    needsReview: boolean      // no visto en > 14 días con score < 70
  }>
  crossMaterialPatterns: {
    alwaysFailsApplication: boolean
    strongInRecall: boolean
    fastForgetter: boolean
    needsExamples: boolean
  }
  updatedAt: number
}

const GLOBAL_MEMORY_KEY = 'studyal_global_concept_memory'

export function loadGlobalMemory(): GlobalConceptMemory {
  if (typeof window === 'undefined') return createEmptyGlobalMemory()
  try {
    const raw = localStorage.getItem(GLOBAL_MEMORY_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return createEmptyGlobalMemory()
}

export function createEmptyGlobalMemory(): GlobalConceptMemory {
  return {
    concepts: {},
    crossMaterialPatterns: {
      alwaysFailsApplication: false,
      strongInRecall: false,
      fastForgetter: false,
      needsExamples: false,
    },
    updatedAt: Date.now(),
  }
}

export function saveGlobalMemory(memory: GlobalConceptMemory): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(GLOBAL_MEMORY_KEY, JSON.stringify(memory))
  } catch {}
}

// Actualizar memoria global después de cada sesión
export function updateGlobalMemory(
  global: GlobalConceptMemory,
  params: {
    materialId: string
    conceptsStudied: string[]
    avgScore: number
    evidenceType: string
  }
): GlobalConceptMemory {
  const now = Date.now()
  const updated = { ...global, concepts: { ...global.concepts } }

  for (const conceptName of params.conceptsStudied) {
    const key = conceptName.toLowerCase().trim()
    const existing = updated.concepts[key]

    updated.concepts[key] = {
      name: conceptName,
      lastSeenMaterialId: params.materialId,
      lastSeenAt: now,
      totalAttempts: (existing?.totalAttempts ?? 0) + 1,
      avgScore: existing
        ? Math.round((existing.avgScore * 0.7) + (params.avgScore * 0.3))
        : params.avgScore,
      dominated: existing
        ? Math.round((existing.avgScore * 0.7) + (params.avgScore * 0.3)) >= 80
        : params.avgScore >= 80,
      needsReview: false,
    }
  }

  // Detectar patrones cross-material
  const allScores = Object.values(updated.concepts).map(c => c.avgScore)
  const avgAll = allScores.length > 0
    ? allScores.reduce((a, b) => a + b, 0) / allScores.length
    : 0

  const applicationScores = Object.values(updated.concepts)
    .filter(c => c.totalAttempts >= 3)
    .map(c => c.avgScore)

  updated.crossMaterialPatterns = {
    alwaysFailsApplication:
      applicationScores.length > 3 && applicationScores.filter(s => s < 50).length > applicationScores.length * 0.6,
    strongInRecall: avgAll >= 70,
    fastForgetter:
      Object.values(updated.concepts).some(c =>
        c.lastSeenAt < now - 14 * 24 * 60 * 60 * 1000 && c.avgScore < 60
      ),
    needsExamples: false,
  }

  updated.updatedAt = now
  return updated
}

// Verificar si un concepto ya fue dominado en otro material
export function isConceptAlreadyDominated(
  global: GlobalConceptMemory,
  conceptName: string,
  currentMaterialId: string,
): boolean {
  const key = conceptName.toLowerCase().trim()
  const c = global.concepts[key]
  if (!c) return false
  return c.dominated && c.lastSeenMaterialId !== currentMaterialId
}

// Obtener conceptos que necesitan revisión
export function getConceptsNeedingReview(
  global: GlobalConceptMemory,
  currentConcepts: string[],
): string[] {
  const now = Date.now()
  const REVIEW_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000 // 14 días

  return currentConcepts.filter(name => {
    const key = name.toLowerCase().trim()
    const c = global.concepts[key]
    if (!c) return false
    return (
      c.avgScore < 70 &&
      (now - c.lastSeenAt) > REVIEW_THRESHOLD_MS
    )
  })
}
