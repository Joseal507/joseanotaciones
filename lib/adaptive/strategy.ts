// ═══════════════════════════════════════════════════════════════
// StudyAL — AI Study Strategist
// No genera sesiones. Genera la estrategia que luego
// produce sesiones. La diferencia es enorme.
//
// Program → Strategy → Sessions → Steps
// ═══════════════════════════════════════════════════════════════

import type { MaterialMastery } from '../masteryEngine'
import { calculateMasterySnapshot } from '../masteryEngine'
import type { AdaptiveProgramSetup, StepEngine } from './program'
import { getDaysToExam } from './program'
import { calculateEngineUtility, detectObjectiveConflicts, projectDomainOverSessions } from './utility'
import { getBestSequenceForStudent, DEFAULT_SEQUENCES, evaluateProgramCandidates } from './causalEngine'
import { calculateDomainEstimate } from './uncertaintyModel'



// ═══════════════════════════════════════════════════════════════
// CÁLCULO DINÁMICO DE SESIONES — derivado del Blueprint
// El número de sesiones depende del MATERIAL, no de reglas fijas.
// ═══════════════════════════════════════════════════════════════
export function calculateSessionsNeeded(params: {
  blueprint?: {
    topics?: Array<{
      concepts?: Array<{ importance?: string; difficulty?: number }>
      difficulty?: number
      importance?: number
    }>
    confidence?: number
  } | null
  initialKnowledge?: 'zero' | 'some' | 'review' | 'mastered'
  daysToExam?: number | null
  targetScore?: number
}): number {
  const { blueprint, initialKnowledge, daysToExam, targetScore } = params

  // Sin blueprint: fallback mínimo
  if (!blueprint || !blueprint.topics || blueprint.topics.length === 0) {
    if (daysToExam !== null && daysToExam !== undefined && daysToExam <= 1) return 3
    return initialKnowledge === 'zero' ? 4 : 3
  }

  const topics = blueprint.topics
  const topicCount = topics.length

  // Contar conceptos críticos (importance === 'critical')
  let criticalConcepts = 0
  let totalConcepts = 0
  for (const topic of topics) {
    const concepts = topic.concepts || []
    totalConcepts += concepts.length
    criticalConcepts += concepts.filter(c => c.importance === 'critical').length
  }

  // ═══ FÓRMULA ESTRUCTURAL ═══
  // Base: 1 sesión por topic principal
  let sessions = topicCount

  // + 1 sesión extra por cada 3 conceptos críticos
  sessions += Math.floor(criticalConcepts / 3)

  // + 1 sesión de síntesis por cada 4 topics
  sessions += Math.floor(topicCount / 4)

  // + 1 sesión de examen/práctica por cada 6 topics
  sessions += Math.floor(topicCount / 6)

  // Bonus: si targetScore >= 90, asegurar al menos 1 sesión de examen
  const wantsHighScore = (targetScore ?? 0) >= 90
  if (wantsHighScore && sessions < topicCount + 2) {
    sessions += 1  // sesión extra de examen simulado
  }

  // ═══ MODULACIÓN POR CONOCIMIENTO INICIAL ═══
  if (initialKnowledge === 'zero') {
    sessions = Math.ceil(sessions * 1.25)
  } else if (initialKnowledge === 'review') {
    sessions = Math.ceil(sessions * 0.8)
  } else if (initialKnowledge === 'mastered') {
    sessions = Math.ceil(sessions * 0.5)
  }
  // 'some' = sin modulación (1.0)

  // ═══ MODULACIÓN POR FECHA DE EXAMEN ═══
  if (daysToExam !== null && daysToExam !== undefined) {
    if (daysToExam <= 1) {
      // Hoy o mañana: modo urgente
      // No elimina temas — los AGRUPA en menos sesiones más densas
      sessions = Math.min(sessions, Math.max(4, Math.ceil(topicCount / 2) + 1))
    } else if (daysToExam <= 3) {
      sessions = Math.min(sessions, 8)
    } else if (daysToExam <= 7) {
      sessions = Math.min(sessions, 12)
    } else if (daysToExam <= 14) {
      sessions = Math.min(sessions, 18)
    }
    // Más de 14 días: sin límite por fecha
  }

  // ═══ LÍMITES ABSOLUTOS ═══
  return Math.max(2, Math.min(25, sessions))
}


// ── Tipos ────────────────────────────────────────────────────────

export type StrategyType =
  | 'understanding_first'   // No sabe nada — empezar desde cero
  | 'memory_first'          // Entiende pero no retiene
  | 'application_first'     // Sabe teoría pero no aplica
  | 'repair_first'          // Tiene errores graves o ilusión
  | 'consolidation'         // Ya domina — solo asentar
  | 'emergency'             // Examen en menos de 48h
  | 'forgetting_recovery'   // No estudió en días — recuperar

export type MemoryLoad = 'light' | 'moderate' | 'heavy'
export type SessionPacing = 'slow' | 'normal' | 'fast' | 'intensive'

export interface StudyStrategy {
  // Por qué ALAI eligió esta estrategia (para mostrar al usuario si quiere)
  why: string

  // Tipo de estrategia
  type: StrategyType

  // Qué quiere lograr con este programa
  goals: string[]

  // Orden de prioridades pedagógicas
  order: Array<'understand' | 'organize' | 'memorize' | 'apply' | 'simulate' | 'repair'>

  // Métricas del programa
  estimatedDays: number
  estimatedTotalMinutes: number
  recommendedSessionLength: number   // minutos por sesión
  totalSessions: number

  // Conceptos que ALAI va a priorizar
  priorityConcepts: string[]
  avoidConcepts: string[]            // ya dominados, no gastar tiempo

  // Motores que esta estrategia prefiere
  recommendedEngines: StepEngine[]
  avoidEngines: StepEngine[]         // no útiles para esta estrategia ahora

  // Carga cognitiva recomendada
  memoryLoad: MemoryLoad
  pacing: SessionPacing

  // Confianza de ALAI en esta estrategia (0-100)
  confidenceLevel: number

  // Qué podría cambiar la estrategia
  breakingConditions: string[]

  // Cuándo ALAI revisará si la estrategia sigue siendo válida
  reviewAfterSessions: number

  // Utilidad calculada (enriquecida por el utility engine)
  utilityOptions?: import('./utility').UtilityOption[]
  projectedDomain?: number[]
  conflictDetected?: boolean
  conflictMessage?: string
  realisticTarget?: number

  // Causal: la mejor secuencia aprendida para este perfil
  learnedSequence?: string[]
  sequenceConfidence?: number

  // Uncertainty: qué tan seguro está ALAI de esta estrategia
  domainEstimate?: import('./uncertaintyModel').DomainEstimate
}

// ── Perfil del estudiante para la estrategia ─────────────────────

interface StudentProfile {
  // Dominio
  overallDomain: number
  understanding: number
  memory: number
  application: number
  explanation: number
  exam: number

  // Conceptos
  weakConcepts: string[]
  criticalConcepts: string[]
  strongConcepts: string[]
  forgettingRiskConcepts: string[]

  // Patrones de aprendizaje
  hasIllusion: boolean
  hasForgettingRisk: boolean
  hasRepeatedMistakes: boolean
  daysSinceLastStudy: number | null

  // Contexto del examen
  daysToExam: number | null
  targetScore: number
  gapToTarget: number

  // Tiempo disponible
  dailyMinutes: number

  // Probabilidades
  examPassProbability: number
}

// ── Construir perfil desde mastery ───────────────────────────────

function buildStudentProfile(
  mastery: MaterialMastery | null,
  setup: AdaptiveProgramSetup,
  memory?: import('./studentMemory').StudentMemory | null,
): StudentProfile {
  const daysToExam = getDaysToExam(setup.examDate)

  if (!mastery) {
    return {
      overallDomain: 0, understanding: 0, memory: 0,
      application: 0, explanation: 0, exam: 0,
      weakConcepts: [], criticalConcepts: [], strongConcepts: [],
      forgettingRiskConcepts: [],
      hasIllusion: false, hasForgettingRisk: false, hasRepeatedMistakes: false,
      daysSinceLastStudy: null,
      daysToExam, targetScore: setup.targetScore,
      gapToTarget: setup.targetScore,
      dailyMinutes: setup.dailyMinutes,
      examPassProbability: 0,
    }
  }

  let snap: ReturnType<typeof calculateMasterySnapshot>
  try {
    snap = calculateMasterySnapshot(mastery)
  } catch {
    return {
      overallDomain: 0, understanding: 0, memory: 0,
      application: 0, explanation: 0, exam: 0,
      weakConcepts: [], criticalConcepts: [], strongConcepts: [],
      forgettingRiskConcepts: [],
      hasIllusion: false, hasForgettingRisk: false, hasRepeatedMistakes: false,
      daysSinceLastStudy: null,
      daysToExam, targetScore: setup.targetScore,
      gapToTarget: setup.targetScore,
      dailyMinutes: setup.dailyMinutes,
      examPassProbability: 0,
    }
  }

  const concepts = mastery.concepts || []
  const hasIllusion = concepts.some(c => c.confidence > 65 && c.mistakes >= 2)
  const hasForgettingRisk = concepts.some(
    c => c.forgettingRisk === 'very_high' || c.forgettingRisk === 'high'
  )
  const hasRepeatedMistakes = concepts.some(c => c.mistakes >= 3)

  const lastTimestamp = mastery.timeline?.length > 0
    ? mastery.timeline[mastery.timeline.length - 1].timestamp
    : null
  const daysSinceLastStudy = lastTimestamp
    ? Math.floor((Date.now() - lastTimestamp) / (1000 * 60 * 60 * 24))
    : null

  return {
    overallDomain: snap.overallMastery,
    understanding: snap.understanding,
    memory: snap.memory,
    application: snap.application,
    explanation: snap.explanation,
    exam: snap.exam,
    weakConcepts: snap.weakConcepts.map(c => c.name).slice(0, 6),
    criticalConcepts: snap.criticalConcepts.map(c => c.name).slice(0, 4),
    strongConcepts: snap.dominatedConcepts.map(c => c.name).slice(0, 6),
    forgettingRiskConcepts: concepts
      .filter(c => c.forgettingRisk === 'very_high' || c.forgettingRisk === 'high')
      .map(c => c.name).slice(0, 4),
    hasIllusion,
    hasForgettingRisk,
    hasRepeatedMistakes,
    daysSinceLastStudy,
    daysToExam,
    targetScore: setup.targetScore,
    gapToTarget: Math.max(0, setup.targetScore - snap.overallMastery),
    dailyMinutes: setup.dailyMinutes,
    examPassProbability: snap.examPassProbability,
  }
}

// ═══════════════════════════════════════════════════════════════
// EL ESTRATEGA — buildStudyStrategy()
// Esta función es el cerebro. Decide todo.
// ═══════════════════════════════════════════════════════════════

export function buildStudyStrategy(
  mastery: MaterialMastery | null,
  setup: AdaptiveProgramSetup,
  memory?: import('./studentMemory').StudentMemory | null,
  blueprint?: any,
): StudyStrategy {
  const p = buildStudentProfile(mastery, setup, memory)

  // Hints de la memoria del estudiante afectan la estrategia
  const hints = memory?.nextProgramHints || []
  const isPracticeLearner = memory?.dominantPattern === 'practice_learner'
  const isAnxietyProne = memory?.dominantPattern === 'anxiety_prone'
  const isFastLearner = memory?.dominantPattern === 'fast_learner'
  const { daysToExam, dailyMinutes } = p

  // ── ESTRATEGIA: EMERGENCIA ────────────────────────────────────
  if (daysToExam !== null && daysToExam <= 2) {
    const sessions = daysToExam === 0 ? 3 : 4
    return {
      type: 'emergency',
      why: daysToExam === 0
        ? 'Tu examen es hoy. Vamos a lo esencial y nada más.'
        : 'Tu examen es mañana. Priorizamos rescate rápido y simulación.',
      goals: [
        'Cubrir los conceptos más importantes en el menor tiempo',
        'Simular al menos una vez antes del examen',
        'Identificar y reparar los errores más críticos',
      ],
      order: ['understand', 'memorize', 'simulate', 'repair'],
      estimatedDays: daysToExam === 0 ? 1 : 2,
      estimatedTotalMinutes: sessions * Math.min(dailyMinutes, 20),
      recommendedSessionLength: Math.min(dailyMinutes, 20),
      totalSessions: sessions,
      priorityConcepts: [...p.criticalConcepts, ...p.weakConcepts].slice(0, 4),
      avoidConcepts: p.strongConcepts,
      recommendedEngines: ['analisis', 'flashcards', 'examen', 'alai'],
      avoidEngines: ['studymap', 'truquitos'],
      memoryLoad: 'heavy',
      pacing: 'intensive',
      confidenceLevel: 70,
      breakingConditions: ['El examen ya pasó'],
      reviewAfterSessions: 1,
    }
  }

  // ── ESTRATEGIA: RECUPERACIÓN DE OLVIDO ───────────────────────
  if (p.daysSinceLastStudy !== null && p.daysSinceLastStudy >= 4 && p.overallDomain > 20) {
    return {
      type: 'forgetting_recovery',
      why: `No has estudiado en ${p.daysSinceLastStudy} días. El olvido ya está actuando. Primero recuperamos, luego avanzamos.`,
      goals: [
        'Recuperar el dominio perdido por el olvido',
        'Reforzar los conceptos en mayor riesgo',
        'Retomar el ritmo antes de continuar',
      ],
      order: ['memorize', 'apply', 'repair', 'simulate'],
      estimatedDays: Math.min(5, Math.ceil((p.gapToTarget / 10) + 2)),
      estimatedTotalMinutes: 4 * dailyMinutes,
      recommendedSessionLength: dailyMinutes,
      totalSessions: calculateSessionsNeeded({ blueprint, initialKnowledge: setup.initialKnowledgeLevel as any, daysToExam, targetScore: setup.targetScore }),
      priorityConcepts: [...p.forgettingRiskConcepts, ...p.criticalConcepts].slice(0, 5),
      avoidConcepts: [],
      recommendedEngines: ['flashcards', 'quiz', 'alai', 'repasar'],
      avoidEngines: ['studymap'],
      memoryLoad: 'moderate',
      pacing: 'normal',
      confidenceLevel: 85,
      breakingConditions: [
        'El dominio recupera más del 80% del nivel anterior',
        'Han pasado más de 2 semanas desde el último estudio',
      ],
      reviewAfterSessions: 2,
    }
  }

  // ── ESTRATEGIA: REPARACIÓN PRIMERO ───────────────────────────
  if (p.hasIllusion || p.criticalConcepts.length >= 3) {
    const reason = p.hasIllusion
      ? 'Detecté ilusión de conocimiento: crees que sabes algo que en realidad falla bajo presión.'
      : `Tienes ${p.criticalConcepts.length} conceptos críticos que bloquean todo lo demás.`

    return {
      type: 'repair_first',
      why: reason,
      goals: [
        'Eliminar la ilusión de conocimiento con preguntas desafiantes',
        'Dominar los conceptos bloqueantes antes de avanzar',
        'Construir confianza real, no superficial',
      ],
      order: ['repair', 'understand', 'apply', 'simulate'],
      estimatedDays: Math.ceil(p.gapToTarget / 12),
      estimatedTotalMinutes: 5 * dailyMinutes,
      recommendedSessionLength: dailyMinutes,
      totalSessions: calculateSessionsNeeded({ blueprint, initialKnowledge: setup.initialKnowledgeLevel as any, daysToExam, targetScore: setup.targetScore }),
      priorityConcepts: p.hasIllusion
        ? [...p.criticalConcepts, ...p.weakConcepts]
        : p.criticalConcepts,
      avoidConcepts: p.strongConcepts,
      recommendedEngines: ['alai', 'quiz', 'examen', 'flashcards'],
      avoidEngines: ['repasar', 'studymap', 'truquitos'],
      memoryLoad: 'moderate',
      pacing: 'normal',
      confidenceLevel: 88,
      breakingConditions: [
        'Los conceptos críticos suben por encima de 50%',
        'La ilusión de conocimiento se elimina (errores bajan)',
      ],
      reviewAfterSessions: 2,
    }
  }

  // ── ESTRATEGIA: MEMORIA PRIMERO ───────────────────────────────
  if (p.understanding >= 55 && p.memory < 40) {
    return {
      type: 'memory_first',
      why: 'Entiendes el material pero no lo retienes. El problema no es comprensión, es memoria. No necesitas más teoría: necesitas anclar lo que ya sabes.',
      goals: [
        'Convertir comprensión en memoria a largo plazo',
        'Reducir el riesgo de olvido antes del examen',
        'Pasar de reconocer a recordar sin ayuda',
      ],
      order: ['memorize', 'apply', 'simulate', 'repair'],
      estimatedDays: Math.ceil(p.gapToTarget / 10),
      estimatedTotalMinutes: 4 * dailyMinutes,
      recommendedSessionLength: dailyMinutes,
      totalSessions: calculateSessionsNeeded({ blueprint, initialKnowledge: setup.initialKnowledgeLevel as any, daysToExam, targetScore: setup.targetScore }),
      priorityConcepts: [...p.forgettingRiskConcepts, ...p.weakConcepts].slice(0, 5),
      avoidConcepts: p.strongConcepts,
      recommendedEngines: ['flashcards', 'truquitos', 'quiz', 'alai'],
      avoidEngines: ['analisis', 'repasar', 'studymap'],
      memoryLoad: 'heavy',
      pacing: 'normal',
      confidenceLevel: 90,
      breakingConditions: [
        'La dimensión de memoria supera 65%',
        'El riesgo de olvido baja a "bajo" en la mayoría de conceptos',
      ],
      reviewAfterSessions: 2,
    }
  }

  // ── ESTRATEGIA: APLICACIÓN PRIMERO ───────────────────────────
  if (p.understanding >= 50 && p.memory >= 40 && p.application < 35) {
    return {
      type: 'application_first',
      why: 'Sabes la teoría y la recuerdas, pero no puedes usarla cuando te presionan. Ese es el salto más difícil. Lo vamos a trabajar directamente.',
      goals: [
        'Transferir conocimiento teórico a situaciones reales',
        'Practicar hasta que la aplicación sea automática',
        'Prepararte para preguntas de examen que requieren análisis',
      ],
      order: ['apply', 'simulate', 'repair', 'memorize'],
      estimatedDays: Math.ceil(p.gapToTarget / 10),
      estimatedTotalMinutes: 4 * dailyMinutes,
      recommendedSessionLength: dailyMinutes,
      totalSessions: calculateSessionsNeeded({ blueprint, initialKnowledge: setup.initialKnowledgeLevel as any, daysToExam, targetScore: setup.targetScore }),
      priorityConcepts: p.weakConcepts.slice(0, 5),
      avoidConcepts: p.strongConcepts,
      recommendedEngines: ['quiz', 'examen', 'alai', 'flashcards'],
      avoidEngines: ['repasar', 'studymap', 'truquitos'],
      memoryLoad: 'moderate',
      pacing: 'fast',
      confidenceLevel: 88,
      breakingConditions: [
        'La dimensión de aplicación supera 65%',
        'La probabilidad de aprobar supera el 75%',
      ],
      reviewAfterSessions: 2,
    }
  }

  // ── ESTRATEGIA: CONSOLIDACIÓN ─────────────────────────────────
  if (p.overallDomain >= p.targetScore - 10) {
    return {
      type: 'consolidation',
      why: `Ya estás muy cerca de tu objetivo (${p.overallDomain}% vs ${p.targetScore}%). No necesitas aprender más; necesitas consolidar y confirmar.`,
      goals: [
        'Confirmar que el dominio es estable y no superficial',
        'Simular el examen para verificar la preparación real',
        'Reparar cualquier punto débil que aparezca en la simulación',
      ],
      order: ['simulate', 'repair', 'memorize'],
      estimatedDays: daysToExam !== null && daysToExam < 7
        ? Math.min(daysToExam, 4)
        : 4,
      estimatedTotalMinutes: 3 * Math.min(dailyMinutes, 45),
      recommendedSessionLength: Math.min(dailyMinutes, 45),
      totalSessions: calculateSessionsNeeded({ blueprint, initialKnowledge: setup.initialKnowledgeLevel as any, daysToExam, targetScore: setup.targetScore }),
      priorityConcepts: [...p.weakConcepts, ...p.forgettingRiskConcepts].slice(0, 3),
      avoidConcepts: p.strongConcepts,
      recommendedEngines: ['examen', 'alai', 'quiz'],
      avoidEngines: ['repasar', 'studymap', 'truquitos'],
      memoryLoad: 'light',
      pacing: 'fast',
      confidenceLevel: 92,
      breakingConditions: [
        'La simulación falla inesperadamente',
        'Aparecen conceptos críticos nuevos',
      ],
      reviewAfterSessions: 1,
    }
  }

  // ── ESTRATEGIA: COMPRENSIÓN PRIMERO (default) ─────────────────
  // Calcular sesiones según el material (no hardcoded)
  const totalSessions = calculateSessionsNeeded({
    blueprint,
    initialKnowledge: setup.initialKnowledgeLevel as any,
    daysToExam,
  })

  const estimatedDays = daysToExam !== null
    ? Math.min(daysToExam, Math.ceil(totalSessions * dailyMinutes / Math.max(dailyMinutes, 1)))
    : totalSessions

  return {
    type: 'understanding_first',
    why: setup.initialKnowledgeLevel === 'zero'
      ? 'Empezamos desde cero. La comprensión primero es la base de todo lo demás. Sin entender, memorizar es inútil.'
      : 'Necesitas construir una base sólida antes de practicar. El orden importa.',
    goals: [
      'Construir comprensión profunda antes de memorizar',
      'Organizar las ideas para que el conocimiento sea estructurado',
      'Progresar de entender a recordar a aplicar',
    ],
    order: ['understand', 'organize', 'memorize', 'apply', 'simulate', 'repair'],
    estimatedDays,
    estimatedTotalMinutes: totalSessions * dailyMinutes,
    recommendedSessionLength: dailyMinutes,
    totalSessions,
    priorityConcepts: [...p.criticalConcepts, ...p.weakConcepts].slice(0, 5),
    avoidConcepts: p.strongConcepts,
    recommendedEngines: ['analisis', 'repasar', 'flashcards', 'quiz', 'alai'],
    avoidEngines: [],
    memoryLoad: 'moderate',
    pacing: daysToExam !== null && daysToExam < 7 ? 'fast' : 'normal',
    confidenceLevel: 82,
    breakingConditions: [
      'La comprensión no sube después de 2 sesiones',
      'Aparece ilusión de conocimiento',
      'El examen es en menos de 3 días',
    ],
    reviewAfterSessions: 2,
  }
}

// ── Enriquecer estrategia con utilidad calculada ────────────────
export function enrichStrategyWithUtility(
  strategy: StudyStrategy,
  mastery: MaterialMastery | null,
  memory: import('./studentMemory').StudentMemory | null,
  availableMinutes: number,
  targetScore: number,
  daysToExam: number | null,
): StudyStrategy {
  try {
    const options = calculateEngineUtility(mastery, memory, availableMinutes, targetScore)
    const conflict = detectObjectiveConflicts(
      mastery ? (() => { try { return calculateMasterySnapshot(mastery).overallMastery } catch { return 0 } })() : 0,
      targetScore,
      availableMinutes,
      daysToExam,
      options,
    )
    const projected = projectDomainOverSessions(
      mastery ? (() => { try { return calculateMasterySnapshot(mastery).overallMastery } catch { return 0 } })() : 0,
      options,
      strategy.totalSessions,
    )

    return {
      ...strategy,
      utilityOptions: options,
      projectedDomain: projected,
      conflictDetected: conflict.conflictDetected,
      conflictMessage: conflict.message,
      realisticTarget: conflict.realisticTarget,
    }
  } catch {
    return strategy
  }
}

// ── Re-evaluar estrategia después de sesiones ────────────────────
// Llamar después de cada sesión para ver si la estrategia sigue siendo válida

export function shouldUpdateStrategy(
  currentStrategy: StudyStrategy,
  mastery: MaterialMastery | null,
  setup: AdaptiveProgramSetup,
  completedSessions: number,
): boolean {
  if (completedSessions === 0) return false

  // Revisar según lo que dijo la estrategia
  if (completedSessions % currentStrategy.reviewAfterSessions !== 0) return false

  // Construir nuevo perfil y nueva estrategia
  const newStrategy = buildStudyStrategy(mastery, setup)

  // Si el tipo cambió, actualizar
  if (newStrategy.type !== currentStrategy.type) return true

  // Si la confianza bajó mucho, actualizar
  if (newStrategy.confidenceLevel < currentStrategy.confidenceLevel - 15) return true

  return false
}

// ═══════════════════════════════════════════════════════════════
// STRATEGY ENRICHMENT — hacer el "why" más específico con topics
// Cuando hay blueprint, el why menciona temas reales.
// ═══════════════════════════════════════════════════════════════

export function enrichStrategyWhyWithTopics(
  strategy: StudyStrategy,
  topicMastery: Array<{ topicTitle: string; score: number; critical: boolean; weak: boolean }> | null | undefined,
): StudyStrategy {
  if (!topicMastery || topicMastery.length === 0) return strategy

  const criticalTopics = topicMastery.filter(t => t.critical)
  const weakTopics = topicMastery.filter(t => t.weak && !t.critical)

  if (criticalTopics.length === 0 && weakTopics.length === 0) return strategy

  let topicContext = ''

  if (criticalTopics.length > 0) {
    const names = criticalTopics.slice(0, 2).map(t => `"${t.topicTitle}" (${t.score}%)`).join(' y ')
    topicContext = ` En particular, ${names} necesita atención urgente.`
  } else if (weakTopics.length > 0) {
    const names = weakTopics.slice(0, 2).map(t => `"${t.topicTitle}"`).join(' y ')
    topicContext = ` Los temas más débiles son ${names}.`
  }

  if (!topicContext) return strategy

  return {
    ...strategy,
    why: strategy.why + topicContext,
  }
}

