// ═══════════════════════════════════════════════════════════════
// StudyAL — Pedagogical Utility Engine
// ALAI ya no sigue reglas. Calcula utilidad.
//
// Pregunta: dado el estado actual del estudiante,
// ¿cuál es la mejor inversión de tiempo?
//
// Responde con evidencia, no con thresholds.
// ═══════════════════════════════════════════════════════════════

import type { MaterialMastery } from '../masteryEngine'
import { calculateMasterySnapshot } from '../masteryEngine'
import type { StepEngine, SessionPurpose } from './program'
import type { StudentMemory } from './studentMemory'

// ── Tipos ────────────────────────────────────────────────────────

export interface UtilityOption {
  engine: StepEngine
  purpose: SessionPurpose
  estimatedDomainGain: number      // puntos de dominio esperados
  estimatedMinutes: number
  utilityPerMinute: number         // ROI pedagógico
  confidence: number               // qué tan seguro está ALAI (0-100)
  reasoning: string                // por qué esta opción
  risks: string[]                  // qué podría salir mal
}

export interface PedagogicalPlan {
  bestOption: UtilityOption
  alternatives: UtilityOption[]
  conflictDetected: boolean
  conflictMessage?: string          // "No es posible llegar a 95% en 40 min"
  realisticTarget: number           // objetivo ajustado a la realidad
  projectedDomain: number[]         // dominio proyectado sesión por sesión
}

export interface FatigueSignal {
  level: 'none' | 'mild' | 'moderate' | 'high'
  message: string
  recommendation: string
  switchToEngine?: StepEngine
}

// ═══════════════════════════════════════════════════════════════
// 1. CALCULAR UTILIDAD DE CADA MOTOR
// ═══════════════════════════════════════════════════════════════

export function calculateEngineUtility(
  mastery: MaterialMastery | null,
  memory: StudentMemory | null,
  availableMinutes: number,
  targetScore: number,
): UtilityOption[] {
  if (!mastery) return getDefaultOptions(availableMinutes)

  let snap: ReturnType<typeof calculateMasterySnapshot>
  try {
    snap = calculateMasterySnapshot(mastery)
  } catch {
    return getDefaultOptions(availableMinutes)
  }

  const concepts = mastery.concepts || []
  const weakCount = snap.weakConcepts.length
  const criticalCount = snap.criticalConcepts.length
  const hasIllusion = concepts.some(c => c.confidence > 65 && c.mistakes >= 2)
  const hasForgetting = concepts.some(
    c => c.forgettingRisk === 'very_high' || c.forgettingRisk === 'high'
  )

  // Preferencias del estudiante desde su memoria
  const enginePrefs = memory?.enginePreferences || []
  const getEngineBonus = (engine: string): number => {
    const pref = enginePrefs.find(e => e.engine === engine)
    if (!pref) return 0
    return pref.trend === 'improving' ? 8 :
           pref.trend === 'declining' ? -8 : 0
  }

  const options: UtilityOption[] = []

  // ── ANÁLISIS (comprensión) ────────────────────────────────────
  {
    const understanding = snap.understanding
    const baseGain = understanding < 30 ? 14 :
                     understanding < 50 ? 8 :
                     understanding < 70 ? 4 : 2
    const bonus = getEngineBonus('analisis')
    const gain = Math.max(0, baseGain + bonus)
    const mins = Math.min(availableMinutes, 15)
    const utility = mins > 0 ? (gain / mins) * 10 : 0

    options.push({
      engine: 'analisis',
      purpose: 'understand',
      estimatedDomainGain: gain,
      estimatedMinutes: mins,
      utilityPerMinute: Math.round(utility * 10) / 10,
      confidence: understanding < 40 ? 90 : 60,
      reasoning: understanding < 40
        ? `Comprensión muy baja (${understanding}%). El análisis da el mayor retorno ahora.`
        : `Comprensión aceptable (${understanding}%). El análisis aportará poco.`,
      risks: understanding > 60
        ? ['Dominio de comprensión ya alto. Rendimiento decreciente.']
        : [],
    })
  }

  // ── FLASHCARDS (memoria) ──────────────────────────────────────
  {
    const memory_dim = snap.memory
    const forgettingBonus = hasForgetting ? 6 : 0
    const baseGain = memory_dim < 30 ? 15 :
                     memory_dim < 50 ? 10 :
                     memory_dim < 70 ? 5 : 2
    const bonus = getEngineBonus('flashcards')
    const gain = Math.max(0, baseGain + forgettingBonus + bonus)
    const mins = Math.min(availableMinutes, 12)
    const utility = mins > 0 ? (gain / mins) * 10 : 0

    options.push({
      engine: 'flashcards',
      purpose: 'memorize',
      estimatedDomainGain: gain,
      estimatedMinutes: mins,
      utilityPerMinute: Math.round(utility * 10) / 10,
      confidence: hasForgetting ? 92 : memory_dim < 40 ? 88 : 65,
      reasoning: hasForgetting
        ? `Riesgo de olvido activo. Flashcards tienen mayor ROI ahora.`
        : memory_dim < 40
          ? `Memoria baja (${memory_dim}%). Flashcards son la mejor inversión.`
          : `Memoria aceptable. Flashcards aportarán pero no es prioridad.`,
      risks: hasIllusion
        ? ['Hay ilusión de conocimiento. Flashcards podrían reforzar respuestas incorrectas.']
        : [],
    })
  }

  // ── QUIZ (aplicación) ─────────────────────────────────────────
  {
    const application = snap.application
    const prereqMet = snap.understanding >= 40
    const baseGain = !prereqMet ? 3 :
                     application < 30 ? 14 :
                     application < 50 ? 10 :
                     application < 70 ? 6 : 3
    const bonus = getEngineBonus('quiz')
    const gain = Math.max(0, baseGain + bonus)
    const mins = Math.min(availableMinutes, 15)
    const utility = mins > 0 ? (gain / mins) * 10 : 0

    options.push({
      engine: 'quiz',
      purpose: 'apply',
      estimatedDomainGain: gain,
      estimatedMinutes: mins,
      utilityPerMinute: Math.round(utility * 10) / 10,
      confidence: prereqMet ? (application < 40 ? 88 : 72) : 40,
      reasoning: !prereqMet
        ? `Comprensión insuficiente (${snap.understanding}%). El quiz no dará resultados sin base.`
        : application < 40
          ? `Aplicación baja (${application}%). Quiz es la mejor inversión ahora.`
          : `Aplicación aceptable. Quiz reforzará pero no es la prioridad.`,
      risks: !prereqMet
        ? ['Sin comprensión previa, el quiz puede generar frustración y confusión.']
        : hasIllusion
          ? ['Ilusión detectada. El quiz puede revelar errores graves.']
          : [],
    })
  }

  // ── EXAMEN (simulación bajo presión) ─────────────────────────
  {
    const examDim = snap.exam
    const isReady = snap.overallMastery >= 45
    const baseGain = !isReady ? 2 :
                     examDim < 40 ? 12 :
                     examDim < 60 ? 7 : 4
    const bonus = getEngineBonus('examen')
    const gain = Math.max(0, baseGain + bonus)
    const mins = Math.min(availableMinutes, 20)
    const utility = mins > 0 ? (gain / mins) * 10 : 0

    options.push({
      engine: 'examen',
      purpose: 'simulate',
      estimatedDomainGain: gain,
      estimatedMinutes: mins,
      utilityPerMinute: Math.round(utility * 10) / 10,
      confidence: isReady ? 82 : 35,
      reasoning: !isReady
        ? `Dominio insuficiente (${snap.overallMastery}%). El examen ahora generaría frustración.`
        : examDim < 40
          ? `Primera simulación. Revelará exactamente qué falta.`
          : `Examen de confirmación. Útil para verificar estabilidad.`,
      risks: !isReady
        ? ['Muy pronto para simular. Riesgo de desmotivación.']
        : [],
    })
  }

  // ── ALAI / RECALL (explicación activa) ───────────────────────
  {
    const explanation = snap.explanation
    const illusionBonus = hasIllusion ? 8 : 0
    const baseGain = explanation < 30 ? 13 :
                     explanation < 50 ? 9 :
                     explanation < 70 ? 5 : 2
    const bonus = getEngineBonus('alai')
    const gain = Math.max(0, baseGain + illusionBonus + bonus)
    const mins = Math.min(availableMinutes, 12)
    const utility = mins > 0 ? (gain / mins) * 10 : 0

    options.push({
      engine: 'alai',
      purpose: 'apply',
      estimatedDomainGain: gain,
      estimatedMinutes: mins,
      utilityPerMinute: Math.round(utility * 10) / 10,
      confidence: hasIllusion ? 93 : explanation < 40 ? 85 : 68,
      reasoning: hasIllusion
        ? `Ilusión detectada. Explicar con palabras propias la rompe mejor que cualquier otra herramienta.`
        : explanation < 40
          ? `No puedes explicar lo que estudias. ALAI lo trabajará directamente.`
          : `Explicación aceptable. ALAI reforzará conceptos débiles.`,
      risks: explanation > 70
        ? ['Dimensión de explicación ya alta. Rendimiento decreciente.']
        : [],
    })
  }

  // ── REPARACIÓN (corrección específica) ───────────────────────
  {
    const hasErrors = concepts.some(c => c.mistakes >= 2)
    const baseGain = hasErrors ? (criticalCount >= 3 ? 14 : 9) : 4
    const gain = Math.max(0, baseGain)
    const mins = Math.min(availableMinutes, 15)
    const utility = mins > 0 ? (gain / mins) * 10 : 0

    options.push({
      engine: 'alai',
      purpose: 'repair',
      estimatedDomainGain: gain,
      estimatedMinutes: mins,
      utilityPerMinute: Math.round(utility * 10) / 10,
      confidence: hasErrors ? 88 : 50,
      reasoning: hasErrors
        ? `Hay errores repetidos (${criticalCount} conceptos críticos). La reparación tiene ROI alto.`
        : `No hay errores graves detectados. La reparación no es prioritaria.`,
      risks: [],
    })
  }

  // Ordenar por utilidad por minuto (mejor inversión primero)
  return options.sort((a, b) => b.utilityPerMinute - a.utilityPerMinute)
}

// ── Opciones por defecto si no hay mastery ───────────────────────
function getDefaultOptions(availableMinutes: number): UtilityOption[] {
  return [
    {
      engine: 'analisis', purpose: 'understand',
      estimatedDomainGain: 12, estimatedMinutes: Math.min(availableMinutes, 15),
      utilityPerMinute: 8, confidence: 75,
      reasoning: 'Sin historial. Empezar con comprensión es la apuesta más segura.',
      risks: [],
    },
    {
      engine: 'flashcards', purpose: 'memorize',
      estimatedDomainGain: 10, estimatedMinutes: Math.min(availableMinutes, 12),
      utilityPerMinute: 8.3, confidence: 70,
      reasoning: 'Sin historial. Las flashcards son eficientes para cualquier nivel.',
      risks: [],
    },
  ]
}

// ═══════════════════════════════════════════════════════════════
// 2. DETECTAR CONFLICTOS ENTRE OBJETIVOS Y REALIDAD
// ═══════════════════════════════════════════════════════════════

export function detectObjectiveConflicts(
  currentDomain: number,
  targetScore: number,
  availableMinutes: number,
  daysToExam: number | null,
  options: UtilityOption[],
): { conflictDetected: boolean; message?: string; realisticTarget: number } {
  const gap = targetScore - currentDomain
  if (gap <= 0) {
    return { conflictDetected: false, realisticTarget: targetScore }
  }

  // Calcular dominio máximo alcanzable con el tiempo disponible
  const bestOption = options[0]
  const sessionsPerDay = Math.floor(availableMinutes / Math.max(1, bestOption.estimatedMinutes))
  const gainPerDay = sessionsPerDay * bestOption.estimatedDomainGain

  let maxReachableDomain = currentDomain
  if (daysToExam !== null && daysToExam > 0) {
    // Aplicar rendimiento decreciente (cada día gana menos)
    for (let day = 0; day < Math.min(daysToExam, 30); day++) {
      const decayFactor = Math.max(0.4, 1 - (day * 0.05))
      maxReachableDomain = Math.min(100, maxReachableDomain + gainPerDay * decayFactor)
    }
  } else {
    maxReachableDomain = Math.min(100, currentDomain + gainPerDay * 7)
  }

  const realisticTarget = Math.round(maxReachableDomain)

  if (realisticTarget < targetScore - 5) {
    const shortfall = targetScore - realisticTarget
    return {
      conflictDetected: true,
      message: `Con ${availableMinutes} min/día y ${daysToExam !== null ? `${daysToExam} días` : 'el tiempo disponible'}, llegar a ${targetScore}% no es realista. Puedo llevarte a ${realisticTarget}% (${shortfall} puntos menos). ¿Ajustamos el objetivo?`,
      realisticTarget,
    }
  }

  return { conflictDetected: false, realisticTarget: targetScore }
}

// ═══════════════════════════════════════════════════════════════
// 3. PROYECTAR DOMINIO SESIÓN A SESIÓN
// ═══════════════════════════════════════════════════════════════

export function projectDomainOverSessions(
  currentDomain: number,
  options: UtilityOption[],
  totalSessions: number,
): number[] {
  const projection: number[] = [currentDomain]
  let domain = currentDomain

  for (let i = 0; i < totalSessions; i++) {
    // Rotar entre las mejores opciones
    const option = options[i % Math.max(1, options.length)]

    // Rendimiento decreciente: cada sesión gana menos
    const decayFactor = Math.max(0.35, 1 - (i * 0.08))
    const gain = option.estimatedDomainGain * decayFactor

    domain = Math.min(100, domain + gain)
    projection.push(Math.round(domain))
  }

  return projection
}

// ═══════════════════════════════════════════════════════════════
// 4. DETECTAR FATIGA
// ═══════════════════════════════════════════════════════════════

export function detectFatigue(
  sessionHistory: Array<{
    engine: string
    durationMinutes: number
    completedAt: number
  }>,
  currentEngine: StepEngine,
): FatigueSignal {
  if (sessionHistory.length === 0) {
    return { level: 'none', message: '', recommendation: '' }
  }

  const now = Date.now()
  const recentSessions = sessionHistory.filter(
    s => now - s.completedAt < 90 * 60 * 1000 // últimas 90 minutos
  )

  const totalMinutes = recentSessions.reduce((sum, s) => sum + s.durationMinutes, 0)
  const sameEngineCount = recentSessions.filter(s => s.engine === currentEngine).length

  // Fatiga por tiempo total
  if (totalMinutes >= 60) {
    return {
      level: 'high',
      message: `Llevas más de ${totalMinutes} minutos de estudio. La fatiga reduce el aprendizaje.`,
      recommendation: 'Toma un descanso de al menos 15 minutos.',
      switchToEngine: 'truquitos', // algo más ligero
    }
  }

  if (totalMinutes >= 40) {
    return {
      level: 'moderate',
      message: `Llevas ${totalMinutes} minutos estudiando.`,
      recommendation: 'Considera cambiar a algo más activo o tomar una pausa corta.',
      switchToEngine: currentEngine === 'analisis' ? 'quiz' : 'analisis',
    }
  }

  // Fatiga por repetición del mismo motor
  if (sameEngineCount >= 3) {
    const alternatives: Record<string, StepEngine> = {
      flashcards: 'quiz',
      quiz: 'alai',
      analisis: 'quiz',
      alai: 'flashcards',
    }
    return {
      level: 'mild',
      message: `Llevas ${sameEngineCount} sesiones seguidas del mismo tipo.`,
      recommendation: 'Cambiar el tipo de actividad mejora la retención.',
      switchToEngine: alternatives[currentEngine] as StepEngine || 'alai',
    }
  }

  return { level: 'none', message: '', recommendation: '' }
}

// ═══════════════════════════════════════════════════════════════
// 5. GENERAR SESIÓN DINÁMICA (no plantilla)
// ═══════════════════════════════════════════════════════════════

import type { AdaptiveStep } from './program'

export function generateDynamicSteps(
  options: UtilityOption[],
  availableMinutes: number,
  studentPattern: string,
  fatigueLevel: FatigueSignal['level'],
): AdaptiveStep[] {
  const steps: AdaptiveStep[] = []
  let remainingMinutes = availableMinutes
  const usedEngines = new Set<string>()

  // Ajustar por fatiga
  const maxSteps = fatigueLevel === 'high' ? 2 :
                   fatigueLevel === 'moderate' ? 3 : 4

  // Siempre empezar con el mejor ROI
  const topOptions = options.slice(0, maxSteps)

  for (const option of topOptions) {
    if (remainingMinutes <= 0) break
    if (usedEngines.has(option.engine + option.purpose)) continue

    const stepMins = Math.min(option.estimatedMinutes, remainingMinutes)

    const stepType = purposeToStepType(option.purpose, option.engine)
    const step: AdaptiveStep = {
      id: Math.random().toString(36).slice(2, 10),
      type: stepType,
      engine: option.engine,
      title: getStepTitle(option.purpose, option.engine),
      instruction: option.reasoning,
      estimatedMinutes: stepMins,
      evidenceRequired: isEvidenceEngine(option.engine),
      status: 'pending',
    }

    steps.push(step)
    usedEngines.add(option.engine + option.purpose)
    remainingMinutes -= stepMins
  }

  // Siempre terminar con active_recall si hay tiempo
  if (remainingMinutes >= 5 && steps.length > 0) {
    steps.push({
      id: Math.random().toString(36).slice(2, 10),
      type: 'active_recall',
      engine: 'alai',
      title: 'Cierre con recall',
      instruction: 'Para cerrar la sesión: dime qué aprendiste hoy con tus propias palabras.',
      estimatedMinutes: Math.min(5, remainingMinutes),
      evidenceRequired: true,
      status: 'pending',
    })
  }

  return steps
}

function purposeToStepType(
  purpose: SessionPurpose,
  engine: StepEngine,
): AdaptiveStep['type'] {
  if (purpose === 'repair') return 'repair'
  if (purpose === 'simulate') return 'mini_exam'
  if (engine === 'flashcards') return 'micro_flashcards'
  if (engine === 'quiz') return 'micro_quiz'
  if (engine === 'alai') return 'active_recall'
  return 'explain'
}

function isEvidenceEngine(engine: StepEngine): boolean {
  return ['flashcards', 'quiz', 'examen', 'alai'].includes(engine)
}

function getStepTitle(purpose: SessionPurpose, engine: StepEngine): string {
  const titles: Record<string, string> = {
    'understand-analisis': 'Explicación ALAI',
    'understand-repasar': 'Lectura enfocada',
    'memorize-flashcards': 'Flashcards adaptativas',
    'memorize-truquitos': 'Atajos mentales',
    'apply-quiz': 'Práctica aplicada',
    'apply-alai': 'Explicación activa',
    'simulate-examen': 'Simulación de examen',
    'repair-alai': 'Corrección específica',
  }
  return titles[`${purpose}-${engine}`] || `Sesión de ${purpose}`
}

// ═══════════════════════════════════════════════════════════════
// 6. GENERAR MENSAJE DE CONFLICTO EN LENGUAJE NATURAL
// ═══════════════════════════════════════════════════════════════

export function buildConflictNarrative(
  currentDomain: number,
  targetScore: number,
  realisticTarget: number,
  daysToExam: number | null,
  availableMinutes: number,
): string {
  const gap = targetScore - currentDomain
  const shortfall = targetScore - realisticTarget

  if (daysToExam === 0) {
    return `Tu examen es hoy. Con ${currentDomain}% de dominio y ${availableMinutes} minutos disponibles, vamos a maximizar lo más importante. Objetivo realista: ${realisticTarget}%.`
  }

  if (daysToExam === 1) {
    return `Tu examen es mañana. Necesitas ${gap} puntos más para llegar a ${targetScore}%, pero con ${availableMinutes} min/día solo puedo llevarte a ${realisticTarget}%. Vamos a optimizar para eso.`
  }

  return `Para llegar de ${currentDomain}% a ${targetScore}% necesitas ${gap} puntos. Con ${availableMinutes} min/día${daysToExam !== null ? ` y ${daysToExam} días` : ''}, el objetivo realista es ${realisticTarget}%. Ajusté el programa para maximizar ese resultado.`
}
