// ═══════════════════════════════════════════════════════════════
// StudyAL — Program Replanner
// Cuando el programa actual ya no es el mejor,
// ALAI lo reescribe completamente.
// No inserta. No elimina. Replanifica.
// ═══════════════════════════════════════════════════════════════

import type { AdaptiveProgram, AdaptiveSession, AdaptiveStep } from './program'
import type { MaterialMastery } from '../masteryEngine'
import { calculateMasterySnapshot } from '../masteryEngine'
import type { StudentMemory } from './studentMemory'
import { buildStudyStrategy, enrichStrategyWithUtility } from './strategy'
import type { MaterialBlueprint } from './blueprint'
import { getTopicsByImportance, calculateTopicMastery, buildConceptScoreMap, getWeakTopics, getCriticalTopics } from './blueprint'
import { inferAtRiskConcepts } from './knowledgeGraph'
import type { StudentKnowledgeGraph } from './knowledgeGraph'
import { generateAdaptiveProgram } from './generator'
import type { LearningMemory } from './learningMemory'
import { getStyleBasedRoute } from './learningMemory'
import type { StudyStrategy } from './strategy'
import { getDaysToExam } from './program'

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

// ── Condiciones que disparan un replanning completo ──────────────
export interface ReplanningTrigger {
  shouldReplan: boolean
  reason: string
  urgency: 'low' | 'medium' | 'high'
}

export function shouldFullReplan(
  program: AdaptiveProgram,
  mastery: MaterialMastery | null,
  memory: StudentMemory | null,
  completedSessions: number,
  learningMemory?: LearningMemory | null,
): ReplanningTrigger {
  if (completedSessions === 0) {
    return { shouldReplan: false, reason: '', urgency: 'low' }
  }

  // Calcular estado actual
  let currentDomain = 0
  let examPassProbability = 0

  if (mastery) {
    try {
      const snap = calculateMasterySnapshot(mastery)
      currentDomain = snap.overallMastery
      examPassProbability = snap.examPassProbability
    } catch {}
  }

  const target = program.setup.targetScore
  const remainingSessions = program.sessions.filter(
    s => s.status !== 'completed' && s.status !== 'skipped'
  ).length
  const daysToExam = getDaysToExam(program.setup.examDate)

  // 1. Ya alcanzó el objetivo con sesiones restantes
  if (currentDomain >= target && remainingSessions > 2) {
    return {
      shouldReplan: true,
      reason: `Alcanzaste tu objetivo de ${target}% antes de lo esperado. Optimizo el programa restante.`,
      urgency: 'medium',
    }
  }

  // 2. Probabilidad de aprobar ya es muy alta
  if (examPassProbability >= 90 && remainingSessions > 2) {
    return {
      shouldReplan: true,
      reason: `Tu probabilidad de aprobar ya es del ${examPassProbability}%. Reducco sesiones innecesarias.`,
      urgency: 'low',
    }
  }

  // 3. El programa no está funcionando (sin avance en 3 sesiones)
  const recentSessions = program.sessions
    .filter(s => s.status === 'completed')
    .slice(-3)
  const recentGains = recentSessions.map(s => (s.domainAfter ?? 0) - (s.domainBefore ?? 0))
  const avgRecentGain = recentGains.length > 0
    ? recentGains.reduce((a, b) => a + b, 0) / recentGains.length
    : 0

  if (recentGains.length >= 3 && avgRecentGain < 2) {
    return {
      shouldReplan: true,
      reason: `El programa actual no está dando resultados. Estás ganando menos de ${avgRecentGain.toFixed(1)} puntos por sesión. Cambio de estrategia completo.`,
      urgency: 'high',
    }
  }

  // 4. El examen se acerca y el ritmo no es suficiente
  if (daysToExam !== null && daysToExam <= 3 && currentDomain < target - 15) {
    return {
      shouldReplan: true,
      reason: `El examen es en ${daysToExam} días y todavía faltan ${target - currentDomain} puntos. Activo modo de emergencia.`,
      urgency: 'high',
    }
  }

  // 5. La estrategia cambió completamente
  if (program.strategy && mastery) {
    const newStrategy = buildStudyStrategy(mastery, program.setup)
    if (newStrategy.type !== program.strategy.type) {
      return {
        shouldReplan: true,
        reason: `Cambié la estrategia de "${program.strategy.type}" a "${newStrategy.type}" porque tu situación cambió significativamente.`,
        urgency: 'medium',
      }
    }
  }

  // 6. Topics críticos por dependencias — el programa no los cubre próximamente
  if (program.materialBlueprint && mastery && mastery.concepts.length > 0) {
    try {
      const blueprint = program.materialBlueprint
      const scoreMap = buildConceptScoreMap(mastery.concepts)
      const topicMastery = calculateTopicMastery(blueprint, scoreMap)
      const criticalTopics = getCriticalTopics(topicMastery)

      if (criticalTopics.length >= 2) {
        const upcomingSessions = program.sessions
          .filter(s => s.status !== 'completed' && s.status !== 'skipped')
          .slice(0, 3)

        const criticalTopicIds = new Set(criticalTopics.map(t => t.topicId))
        const covered = upcomingSessions.some(s => s.topicId && criticalTopicIds.has(s.topicId))

        if (!covered) {
          return {
            shouldReplan: true,
            reason: `Detecté que "${criticalTopics[0].topicTitle}" (${criticalTopics[0].score}%) necesita atención y los próximos pasos no lo cubren. Reorganizo el programa.`,
            urgency: 'high',
          }
        }
      }
    } catch {}
  }

  // LearningMemory: si overconfident y ha completado sesiones, replanear con simulación
  // (este check requiere learningMemory externo — se hace en el caller)

  // ── LearningMemory: si el estilo detectado contradice el plan ───────────
  if (learningMemory && learningMemory.styleConfidence >= 30 && completedSessions >= 2) {
    // Si el plan es explanation_first pero el estudiante es practice_first
    const sessionPurposes = program.sessions
      .filter(s => s.status !== 'completed')
      .slice(0, 3)
      .map(s => s.purpose)

    const isPracticeLearner = learningMemory.learningStyle === 'practice_first'
    const planHasTooMuchUnderstand =
      sessionPurposes.filter(p => p === 'understand' || p === 'organize').length >= 2

    if (isPracticeLearner && planHasTooMuchUnderstand) {
      return {
        shouldReplan: true,
        reason: 'Detecté que aprendes mejor practicando. Ajusto el plan para ir directo a ejercicios.',
        urgency: 'medium',
      }
    }

    // Si es overconfident y las próximas sesiones son todas memorize/understand
    const isOverconfident = learningMemory.patterns?.includes('overconfident')
    const noSimulation = !sessionPurposes.includes('simulate') && !sessionPurposes.includes('apply')
    if (isOverconfident && noSimulation) {
      return {
        shouldReplan: true,
        reason: 'Incluyo una simulación pronto para verificar el dominio real.',
        urgency: 'medium',
      }
    }
  }

  return { shouldReplan: false, reason: '', urgency: 'low' }
}

// ── Crear sesión dinámica desde estrategia ───────────────────────
function createSessionFromStrategy(
  strategy: StudyStrategy,
  sessionNumber: number,
  purposeIndex: number,
  isFirst: boolean,
): AdaptiveSession {
  const purpose = strategy.order[purposeIndex % strategy.order.length]
  const engine = strategy.recommendedEngines[purposeIndex % Math.max(1, strategy.recommendedEngines.length)]

  const purposeConfig = {
    understand: {
      title: 'Entender la base',
      objective: 'Comprende las ideas principales.',
      emoji: '📖',
      minutes: Math.min(strategy.recommendedSessionLength, 18),
      gain: 12,
    },
    organize: {
      title: 'Organizar ideas',
      objective: 'Conecta los conceptos clave.',
      emoji: '🗺️',
      minutes: Math.min(strategy.recommendedSessionLength, 15),
      gain: 8,
    },
    memorize: {
      title: 'Recordar lo esencial',
      objective: 'Ancla los conceptos en memoria.',
      emoji: '🎴',
      minutes: Math.min(strategy.recommendedSessionLength, 15),
      gain: 10,
    },
    apply: {
      title: 'Practicar',
      objective: 'Aplica lo que sabes.',
      emoji: '🎯',
      minutes: Math.min(strategy.recommendedSessionLength, 18),
      gain: 12,
    },
    simulate: {
      title: 'Simular examen',
      objective: 'Mide tu dominio real.',
      emoji: '📝',
      minutes: Math.min(strategy.recommendedSessionLength, 25),
      gain: 15,
    },
    repair: {
      title: 'Corregir errores',
      objective: 'Trabaja los conceptos que fallaron.',
      emoji: '✨',
      minutes: Math.min(strategy.recommendedSessionLength, 15),
      gain: 10,
    },
  }

  const config = purposeConfig[purpose] || purposeConfig.apply

  const stepEngine = strategy.recommendedEngines[0] || engine

  const steps: AdaptiveStep[] = [
    {
      id: uid(),
      type: purpose === 'simulate' ? 'mini_exam' :
            purpose === 'repair' ? 'repair' :
            purpose === 'memorize' ? 'micro_flashcards' :
            purpose === 'apply' ? 'micro_quiz' : 'explain',
      engine: purpose === 'simulate' ? 'examen' :
              purpose === 'repair' ? 'alai' :
              purpose === 'memorize' ? 'flashcards' :
              purpose === 'apply' ? 'quiz' :
              stepEngine,
      title: config.title,
      instruction: `Sesión ${sessionNumber}: ${config.objective}`,
      estimatedMinutes: Math.round(config.minutes * 0.7),
      evidenceRequired: ['simulate', 'repair', 'memorize', 'apply'].includes(purpose),
      status: 'pending',
    },
    {
      id: uid(),
      type: 'active_recall',
      engine: 'alai',
      title: 'Verificación',
      instruction: 'Cierre: explícame qué aprendiste hoy.',
      estimatedMinutes: Math.round(config.minutes * 0.3),
      evidenceRequired: true,
      status: 'pending',
    },
  ]

  return {
    id: uid(),
    sessionNumber,
    title: config.title,
    objective: config.objective,
    estimatedMinutes: config.minutes,
    purpose,
    status: isFirst ? 'available' : 'locked',
    expectedDomainGain: config.gain,
    steps,
  }
}

// ── REPLANNING COMPLETO ───────────────────────────────────────────
export function fullReplanProgram(
  program: AdaptiveProgram,
  mastery: MaterialMastery | null,
  memory: StudentMemory | null,
  trigger: ReplanningTrigger,
  learningMemory?: LearningMemory | null,
): AdaptiveProgram {
  // ── Blueprint existente — base del replanning inteligente ────────
  const existingBlueprint: MaterialBlueprint | null = program.materialBlueprint ?? null

  // Sesiones ya completadas — mantenerlas intactas
  const completedSessions = program.sessions.filter(s => s.status === 'completed')

  // Nueva estrategia basada en estado actual
  const newStrategy = buildStudyStrategy(mastery, program.setup)
  const enriched = enrichStrategyWithUtility(
    newStrategy,
    mastery,
    memory,
    program.setup.dailyMinutes,
    program.setup.targetScore,
    getDaysToExam(program.setup.examDate),
  )

  let remainingSessions: AdaptiveSession[] = []
  const startSessionNumber = completedSessions.length + 1

  // ── Ajustar orden según estilo de aprendizaje detectado ───────────────────────
  // Si hay learningMemory, la estrategia de orden cambia
  let learningAdjustedOrder: string[] | null = null
  if (learningMemory && learningMemory.styleConfidence >= 20) {
    const baseOrder = enriched.order
    learningAdjustedOrder = getStyleBasedRoute(learningMemory, baseOrder)
    console.log('[Replanner] Orden ajustado por LearningMemory:', learningAdjustedOrder.join(' → '))
  }

  // ── CON BLUEPRINT: construir plan explícito desde criticalTopics → weakTopics ──
  if (existingBlueprint && existingBlueprint.topics.length > 0 && mastery) {
    try {
      const scoreMap = buildConceptScoreMap(mastery.concepts)
      const topicMastery = calculateTopicMastery(existingBlueprint, scoreMap)
      const criticalTopics = getCriticalTopics(topicMastery)
      const weakTopics = getWeakTopics(topicMastery)
      const dominatedTopicIds = new Set(
        topicMastery.filter(t => t.dominated).map(t => t.topicId)
      )

      // Completados — mantener intactos
      const completedTopicIds = new Set(
        completedSessions.map(s => s.topicId).filter((id): id is string => !!id)
      )

      // Orden explícito: críticos → débiles → resto no dominado → dominados al final
      const allTopics = existingBlueprint.topics
      const orderedTopics = [
        ...allTopics.filter(t =>
          criticalTopics.some(ct => ct.topicId === t.id) && !completedTopicIds.has(t.id)
        ),
        ...allTopics.filter(t =>
          weakTopics.some(wt => wt.topicId === t.id) &&
          !criticalTopics.some(ct => ct.topicId === t.id) &&
          !completedTopicIds.has(t.id)
        ),
        ...allTopics.filter(t =>
          !criticalTopics.some(ct => ct.topicId === t.id) &&
          !weakTopics.some(wt => wt.topicId === t.id) &&
          !dominatedTopicIds.has(t.id) &&
          !completedTopicIds.has(t.id)
        ),
        ...allTopics.filter(t =>
          dominatedTopicIds.has(t.id) && !completedTopicIds.has(t.id)
        ),
      ]

      console.log('[Replanner] Orden explícito:', orderedTopics.map(t => t.title).join(' → '))

      // Construir sesiones para cada topic en orden
      const newSessions: AdaptiveSession[] = []
      let sessionNum = startSessionNumber

      for (const topic of orderedTopics) {
        if (newSessions.length >= enriched.totalSessions) break

        const tm = topicMastery.find(t => t.topicId === topic.id)
        const topicScore = tm?.score ?? 0

        // Propósito según score del topic
        // Propósito base según score del topic
        let purpose = topicScore < 20 ? 'understand' :
                      topicScore < 40 ? 'repair' :
                      topicScore < 60 ? 'memorize' :
                      topicScore < 80 ? 'apply' : 'simulate'

        // Ajustar según learningMemory si existe
        if (learningMemory && learningAdjustedOrder && learningAdjustedOrder.length > 0) {
          const sessionIdx = newSessions.length
          const suggestedPurpose = learningAdjustedOrder[sessionIdx % learningAdjustedOrder.length]
          // Solo usar sugerencia si no es crítico (crítico siempre empieza con understand)
          if (topicScore >= 20 && suggestedPurpose) {
            purpose = suggestedPurpose
          }
          // Overconfident: si el score parece alto pero la memoria dice que falla exámenes,
          // bajar a repair aunque el score sea > 60
          if (
            learningMemory.patterns?.includes('overconfident') &&
            topicScore >= 60 && topicScore < 80
          ) {
            purpose = 'simulate'
          }
          // Struggles with application: no saltar directo a apply
          if (
            learningMemory.patterns?.includes('struggles_with_application') &&
            purpose === 'apply' && topicScore < 70
          ) {
            purpose = 'memorize'
          }
          // forgets_fast: siempre incluir repair antes de simulate
          if (
            learningMemory.patterns?.includes('forgets_fast') &&
            purpose === 'simulate' && topicScore < 85
          ) {
            purpose = 'repair'
          }
        }

        const { buildSessionTitle, buildSessionObjective, buildEvidenceGoal, getTopicConceptNames } =
          require('./blueprint')

        const conceptNames = getTopicConceptNames(topic)

        const stepBuilders: Record<string, () => any[]> = {
          understand: () => [{
            id: Math.random().toString(36).slice(2,8),
            type: 'explain', engine: 'analisis',
            title: 'Explicación', instruction: `Vamos a entender "${topic.title}".`,
            estimatedMinutes: 8, evidenceRequired: false, status: 'pending',
          }, {
            id: Math.random().toString(36).slice(2,8),
            type: 'active_recall', engine: 'alai',
            title: 'Recall', instruction: 'Explícame con tus palabras.',
            estimatedMinutes: 10, evidenceRequired: true, status: 'pending',
          }],
          repair: () => [{
            id: Math.random().toString(36).slice(2,8),
            type: 'repair', engine: 'alai',
            title: 'Corrección', instruction: `Trabajemos lo que falla en "${topic.title}".`,
            estimatedMinutes: 10, evidenceRequired: true, status: 'pending',
          }, {
            id: Math.random().toString(36).slice(2,8),
            type: 'micro_quiz', engine: 'quiz',
            title: 'Verificación', instruction: 'Comprobemos que lo entendiste.',
            estimatedMinutes: 5, evidenceRequired: true, status: 'pending',
          }],
          memorize: () => [{
            id: Math.random().toString(36).slice(2,8),
            type: 'micro_flashcards', engine: 'flashcards',
            title: 'Flashcards', instruction: `Ancla los conceptos de "${topic.title}".`,
            estimatedMinutes: 10, evidenceRequired: true, status: 'pending',
          }],
          apply: () => [{
            id: Math.random().toString(36).slice(2,8),
            type: 'micro_quiz', engine: 'quiz',
            title: 'Práctica', instruction: `Pon a prueba "${topic.title}".`,
            estimatedMinutes: 13, evidenceRequired: true, status: 'pending',
          }],
          simulate: () => [{
            id: Math.random().toString(36).slice(2,8),
            type: 'mini_exam', engine: 'examen',
            title: 'Simulación', instruction: `Examen sobre "${topic.title}".`,
            estimatedMinutes: 20, evidenceRequired: true, status: 'pending',
          }],
        }

        const steps = (stepBuilders[purpose] || stepBuilders.understand)()

        newSessions.push({
          id: Math.random().toString(36).slice(2,10),
          sessionNumber: sessionNum++,
          title: buildSessionTitle(topic, purpose as any),
          objective: buildSessionObjective(topic, purpose as any),
          estimatedMinutes: Math.min(program.setup.dailyMinutes, topic.estimatedMinutes || 18),
          purpose: purpose as any,
          status: newSessions.length === 0 ? 'available' : 'locked',
          expectedDomainGain: purpose === 'simulate' ? 15 : purpose === 'apply' ? 12 : 10,
          steps,
          topicId: topic.id,
          topicTitle: topic.title,
          targetConcepts: conceptNames.slice(0, 6),
          sourcePages: topic.sourcePages,
          evidenceGoal: buildEvidenceGoal(topic),
          blueprintConfidence: existingBlueprint.confidence,
        })
      }

      remainingSessions = newSessions
      console.log(`[Replanner] Plan explícito: ${remainingSessions.length} sesiones | críticos:${criticalTopics.length} débiles:${weakTopics.length}`)

    } catch (err) {    console.warn('[Replanner] Error en replan con blueprint, usando fallback:', err)
    }
  }

  // ── FALLBACK: replanning genérico sin blueprint ──────────────────
  if (remainingSessions.length === 0) {
    for (let i = 0; i < enriched.totalSessions; i++) {
      const session = createSessionFromStrategy(
        enriched,
        startSessionNumber + i,
        i,
        i === 0,
      )
      remainingSessions.push(session)
    }
  }

  const allSessions = [...completedSessions, ...remainingSessions]

  // Registrar el cambio de estrategia
  const historyEntry = {
    fromType: program.strategy?.type || 'unknown',
    toType: newStrategy.type,
    changedAt: Date.now(),
    reason: trigger.reason,
    sessionsCompleted: completedSessions.length,
  }

  return {
    ...program,
    sessions: allSessions,
    currentSessionIndex: completedSessions.length,
    strategy: enriched,
    materialBlueprint: existingBlueprint,
    updatedAt: Date.now(),
    strategyHistory: [
      ...(program.strategyHistory || []).slice(-9),
      historyEntry,
    ],
  }
}
