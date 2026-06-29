// ═══════════════════════════════════════════════════════════════
// StudyAL — Generador de Programa Adaptativo v2
// Ahora usa MaterialBlueprint para crear sesiones con temas reales.
// Sin blueprint: funciona con weakConcepts como fallback.
// Con blueprint: sesiones ancladas a temas reales del material.
// ═══════════════════════════════════════════════════════════════

import type {
  AdaptiveProgram,
  AdaptiveSession,
  AdaptiveStep,
  AdaptiveProgramSetup,
  SessionPurpose,
  StepType,
  StepEngine,
} from './program'
import { getDaysToExam } from './program'
import type { MaterialMastery } from '../masteryEngine'
import { calculateMasterySnapshot } from '../masteryEngine'
import { buildStudyStrategy, enrichStrategyWithUtility } from './strategy'
import type { StudyStrategy } from './strategy'
import type { MaterialBlueprint, MaterialTopic } from './blueprint'
import type { LearningMemory } from './learningMemory'
import { getStyleBasedRoute } from './learningMemory'
import { decideSessionFormat, buildSessionStructure } from './teachingEngine'
import type { SessionFormat } from './teachingEngine'
import type { UserProfile } from './userProfile'
import { getProfileDifficultyOffset, getProfileStrategyAdjustment } from './userProfile'
import {
  buildSessionTitle,
  buildSessionObjective,
  buildEvidenceGoal,
  getTopicConceptNames,
  getTopicsByImportance,
} from './blueprint'

// ── ID generator ─────────────────────────────────────────────────
function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

// ── Crear un paso ────────────────────────────────────────────────
function makeStep(params: {
  type: StepType
  engine: StepEngine
  title: string
  instruction: string
  estimatedMinutes: number
  evidenceRequired: boolean
}): AdaptiveStep {
  return {
    id: uid(),
    status: 'pending',
    result: undefined,
    ...params,
  }
}

// ── Crear una sesión base ────────────────────────────────────────
function makeSession(params: {
  sessionNumber: number
  title: string
  objective: string
  estimatedMinutes: number
  purpose: SessionPurpose
  steps: AdaptiveStep[]
  expectedDomainGain: number
  status?: 'locked' | 'available'
  // Topic context (blueprint)
  topicId?: string
  topicTitle?: string
  targetConcepts?: string[]
  sourcePages?: number[]
  evidenceGoal?: string
  blueprintConfidence?: number
  sessionFormat?: string
}): AdaptiveSession {
  return {
    id: uid(),
    status: params.status ?? 'locked',
    topicId: params.topicId,
    topicTitle: params.topicTitle,
    targetConcepts: params.targetConcepts,
    sourcePages: params.sourcePages,
    evidenceGoal: params.evidenceGoal,
    blueprintConfidence: params.blueprintConfidence,
    sessionFormat: params.sessionFormat,
    sessionNumber: params.sessionNumber,
    title: params.title,
    objective: params.objective,
    estimatedMinutes: params.estimatedMinutes,
    purpose: params.purpose,
    steps: params.steps,
    expectedDomainGain: params.expectedDomainGain,
  }
}

// ═══════════════════════════════════════════════════════════════
// PLANTILLAS DE PASOS — reutilizables
// ═══════════════════════════════════════════════════════════════

function stepsUnderstand(topicTitle?: string): AdaptiveStep[] {
  const focus = topicTitle ? ` sobre "${topicTitle}"` : ''
  return [
    makeStep({
      type: 'explain',
      engine: 'analisis',
      title: 'Lo esencial',
      instruction: `Vamos a entender los puntos clave${focus}. Lee con atención.`,
      estimatedMinutes: 5,
      evidenceRequired: false,
    }),
    makeStep({
      type: 'active_recall',
      engine: 'alai',
      title: 'Recall guiado',
      instruction: `Sin mirar nada, explícame el concepto principal${focus} y dame un ejemplo concreto.`,
      estimatedMinutes: 6,
      evidenceRequired: true,
    }),
    makeStep({
      type: 'micro_quiz',
      engine: 'quiz',
      title: 'Verificación rápida',
      instruction: `Tres preguntas${focus} para confirmar comprensión.`,
      estimatedMinutes: 5,
      evidenceRequired: true,
    }),
    makeStep({
      type: 'coach_feedback',
      engine: 'alai',
      title: 'Síntesis',
      instruction: `Repasamos lo aprendido${focus} y vemos qué reforzar.`,
      estimatedMinutes: 3,
      evidenceRequired: false,
    }),
  ]
}

function stepsOrganize(topicTitle?: string): AdaptiveStep[] {
  const focus = topicTitle ? ` de "${topicTitle}"` : ''
  return [
    makeStep({
      type: 'explain',
      engine: 'studymap',
      title: 'Mapa de conceptos',
      instruction: `Vamos a organizar los conceptos${focus} visualmente.`,
      estimatedMinutes: 5,
      evidenceRequired: false,
    }),
    makeStep({
      type: 'active_recall',
      engine: 'alai',
      title: 'Conecta las ideas',
      instruction: `Dime cómo se conectan los conceptos${focus} entre sí.`,
      estimatedMinutes: 10,
      evidenceRequired: true,
    }),
  ]
}

function stepsMemorize(topicTitle?: string): AdaptiveStep[] {
  const focus = topicTitle ? ` de "${topicTitle}"` : ''
  return [
    makeStep({
      type: 'micro_flashcards',
      engine: 'flashcards',
      title: 'Flashcards activas',
      instruction: `5 flashcards${focus} para anclar los conceptos clave.`,
      estimatedMinutes: 7,
      evidenceRequired: true,
    }),
    makeStep({
      type: 'active_recall',
      engine: 'alai',
      title: 'Recall puro',
      instruction: `Sin mirar nada, dime los 3 conceptos más importantes${focus} y por qué importan.`,
      estimatedMinutes: 5,
      evidenceRequired: true,
    }),
    makeStep({
      type: 'micro_quiz',
      engine: 'quiz',
      title: 'Confirmación',
      instruction: `3 preguntas${focus} para confirmar memoria a corto plazo.`,
      estimatedMinutes: 5,
      evidenceRequired: true,
    }),
  ]
}

function stepsApply(topicTitle?: string): AdaptiveStep[] {
  const focus = topicTitle ? ` de "${topicTitle}"` : ''
  return [
    makeStep({
      type: 'micro_quiz',
      engine: 'quiz',
      title: 'Práctica aplicada',
      instruction: `Preguntas reales${focus} que ponen a prueba lo que entendiste.`,
      estimatedMinutes: 10,
      evidenceRequired: true,
    }),
    makeStep({
      type: 'active_recall',
      engine: 'alai',
      title: 'Justifica tu respuesta',
      instruction: `Explícame por qué tu respuesta a la pregunta más difícil${focus} es correcta.`,
      estimatedMinutes: 5,
      evidenceRequired: true,
    }),
    makeStep({
      type: 'coach_feedback',
      engine: 'alai',
      title: 'Cierre',
      instruction: 'Revisemos qué dominaste y qué falta.',
      estimatedMinutes: 3,
      evidenceRequired: false,
    }),
  ]
}

function stepsSimulate(topicTitle?: string): AdaptiveStep[] {
  const focus = topicTitle ? ` sobre "${topicTitle}"` : ''
  return [
    makeStep({
      type: 'mini_exam',
      engine: 'examen',
      title: 'Simulación de examen',
      instruction: `Vamos a simular un examen real${focus}. Responde lo mejor que puedas.`,
      estimatedMinutes: 20,
      evidenceRequired: true,
    }),
    makeStep({
      type: 'coach_feedback',
      engine: 'alai',
      title: 'Análisis de resultados',
      instruction: 'Revisemos cómo te fue y qué necesitas reforzar.',
      estimatedMinutes: 5,
      evidenceRequired: false,
    }),
  ]
}

function stepsRepair(weakPoints?: string): AdaptiveStep[] {
  const focus = weakPoints ? ` Foco en: ${weakPoints}.` : ''
  return [
    makeStep({
      type: 'repair',
      engine: 'alai',
      title: 'Corrección dirigida',
      instruction: `Vamos a trabajar exactamente lo que falló.${focus}`,
      estimatedMinutes: 10,
      evidenceRequired: true,
    }),
    makeStep({
      type: 'micro_quiz',
      engine: 'quiz',
      title: 'Verificación',
      instruction: 'Comprobemos que lo entendiste esta vez.',
      estimatedMinutes: 5,
      evidenceRequired: true,
    }),
  ]
}

// ═══════════════════════════════════════════════════════════════
// BUILDER CON BLUEPRINT — sesiones ancladas a temas reales
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// TOPOLOGICAL SORT — respetar prerequisitos entre topics
// Si el topic B depende de A, la sesión de A va primero.
// ═══════════════════════════════════════════════════════════════

function topologicalSortTopics(topics: MaterialTopic[]): MaterialTopic[] {
  if (topics.length === 0) return topics

  // Construir mapa de id → topic
  const topicMap = new Map<string, MaterialTopic>()
  for (const t of topics) topicMap.set(t.id, t)

  // Construir mapa de título → id (para resolver prerequisitos por título)
  const titleToId = new Map<string, string>()
  for (const t of topics) titleToId.set(t.title.toLowerCase().trim(), t.id)

  // Resolver prerequisitos: pueden ser ids o títulos
  function resolvePrereqs(topic: MaterialTopic): string[] {
    if (!topic.prerequisites || topic.prerequisites.length === 0) return []
    return topic.prerequisites
      .map(p => {
        // Si es un id directo
        if (topicMap.has(p)) return p
        // Si es un título
        return titleToId.get(p.toLowerCase().trim()) ?? null
      })
      .filter((id): id is string => id !== null)
  }

  // Kahn's algorithm — BFS topological sort
  const inDegree = new Map<string, number>()
  const adjList = new Map<string, string[]>() // from → dependents

  for (const t of topics) {
    if (!inDegree.has(t.id)) inDegree.set(t.id, 0)
    if (!adjList.has(t.id)) adjList.set(t.id, [])
  }

  for (const t of topics) {
    const prereqs = resolvePrereqs(t)
    inDegree.set(t.id, prereqs.length)
    for (const prereqId of prereqs) {
      const deps = adjList.get(prereqId) || []
      deps.push(t.id)
      adjList.set(prereqId, deps)
    }
  }

  // Queue: topics sin prerequisitos, ordenados por importancia descendente
  const queue: string[] = []
  for (const t of topics) {
    if ((inDegree.get(t.id) ?? 0) === 0) queue.push(t.id)
  }
  // Ordenar queue inicial por importancia
  queue.sort((a, b) => {
    const ta = topicMap.get(a)
    const tb = topicMap.get(b)
    return (tb?.importance ?? 50) - (ta?.importance ?? 50)
  })

  const sorted: MaterialTopic[] = []
  const visited = new Set<string>()

  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)

    const topic = topicMap.get(id)
    if (topic) sorted.push(topic)

    // Reducir in-degree de dependientes
    const dependents = adjList.get(id) || []
    for (const depId of dependents) {
      const current = inDegree.get(depId) ?? 0
      const next = current - 1
      inDegree.set(depId, next)
      if (next <= 0 && !visited.has(depId)) {
        queue.push(depId)
      }
    }
  }

  // Si hay ciclos, agregar los topics restantes al final
  for (const t of topics) {
    if (!visited.has(t.id)) sorted.push(t)
  }

  return sorted
}

// ═══════════════════════════════════════════════════════════════
// RUTAS DINÁMICAS — cada topic recibe una ruta personalizada
// basada en el mastery actual del estudiante y la estrategia.
// Rompe la linealidad: estudiante A y B pueden tener flujos distintos.
// ═══════════════════════════════════════════════════════════════

interface TopicRoute {
  topic: MaterialTopic
  purpose: string
}

function buildTopicRoutes(
  topics: MaterialTopic[],
  strategy: StudyStrategy,
  learningMemory?: LearningMemory | null,
): TopicRoute[] {
  const routes: TopicRoute[] = []
  const { order, totalSessions } = strategy

  // Calcular cuántas sesiones corresponden a cada topic
  // Topics más importantes/difíciles reciben más sesiones
  const totalImportance = topics.reduce((sum, t) => sum + (t.importance ?? 50), 0)

  for (const topic of topics) {
    const topicWeight = (topic.importance ?? 50) / Math.max(1, totalImportance)
    const topicSessions = Math.max(1, Math.round(topicWeight * totalSessions))

    // ── Ruta del topic: secuencia de propósitos según mastery ──
    const topicRoute = buildRouteForTopic(topic, strategy, topicSessions, learningMemory)
    routes.push(...topicRoute.map(purpose => ({ topic, purpose })))
  }

  // Truncar al totalSessions
  return routes.slice(0, totalSessions)
}

function buildRouteForTopic(
  topic: MaterialTopic,
  strategy: StudyStrategy,
  sessionCount: number,
  learningMemory?: LearningMemory | null,
): string[] {
  const difficulty = topic.difficulty ?? 50
  const importance = topic.importance ?? 50
  const practiceNeeds = topic.practiceNeeds ?? ['understand', 'memorize']

  // ── Perfil del topic → ruta distinta ──────────────────────────

  // Topic difícil e importante → ruta profunda
  if (difficulty >= 70 && importance >= 70) {
    return pickN(['understand', 'organize', 'memorize', 'apply', 'simulate', 'repair'], sessionCount)
  }

  // Topic fácil e importante → ruta directa
  if (difficulty < 40 && importance >= 70) {
    return pickN(['understand', 'memorize', 'apply', 'simulate'], sessionCount)
  }

  // Topic difícil pero poco importante → ruta corta de comprensión
  if (difficulty >= 70 && importance < 50) {
    return pickN(['understand', 'organize', 'apply'], sessionCount)
  }

  // Topic con práctica específica → respetar practiceNeeds
  if (practiceNeeds.includes('simulate')) {
    return pickN(['understand', 'apply', 'simulate'], sessionCount)
  }

  if (practiceNeeds.includes('memorize') && !practiceNeeds.includes('apply')) {
    return pickN(['understand', 'memorize', 'memorize'], sessionCount)
  }

  // ── Usar el order de la estrategia global como base ──────────
  const defaultRoute = pickN(strategy.order, sessionCount)

  // ── Personalizar según cómo aprende el estudiante ───────────
  if (learningMemory) {
    const adaptedRoute = getStyleBasedRoute(learningMemory, defaultRoute)

    // Si el topic es muy difícil y el estudiante necesita ejemplos,
    // asegurar understand antes que apply
    if (
      (topic.difficulty ?? 50) >= 70 &&
      learningMemory.patterns?.includes('needs_examples') &&
      adaptedRoute.includes('apply')
    ) {
      return pickN(['understand', 'organize', 'apply', 'repair', 'simulate'], sessionCount)
    }

    // Si es overconfident y el topic es importante, forzar verificación temprana
    if (
      (topic.importance ?? 50) >= 70 &&
      learningMemory.patterns?.includes('overconfident')
    ) {
      return pickN(['simulate', 'repair', 'understand', 'apply'], sessionCount)
    }

    return adaptedRoute
  }

  return defaultRoute
}

// Tomar N elementos de un array, repitiendo si hace falta
function pickN(arr: string[], n: number): string[] {
  const result: string[] = []
  for (let i = 0; i < n; i++) {
    result.push(arr[i % arr.length])
  }
  return result
}

function buildSessionsFromBlueprint(
  blueprint: MaterialBlueprint,
  strategy: StudyStrategy,
  dailyMinutes: number,
  learningMemory?: LearningMemory | null,
  userProfile?: UserProfile | null,
): AdaptiveSession[] {
  const sessions: AdaptiveSession[] = []
  const { order, totalSessions } = strategy

  // Ordenar temas: primero por prerequisitos (topológico), luego por importancia
  // Esto garantiza que el estudiante aprende los temas base antes que los avanzados
  const topicsByImportance = getTopicsByImportance(blueprint)
  const topics = topologicalSortTopics(topicsByImportance)

  // Distribuir sesiones entre temas
  // Cada tema puede tener 1-3 sesiones según su complejidad y la estrategia
  let sessionNum = 1

  // ── Rutas dinámicas por perfil del topic ───────────────────────
  const topicRoutes = buildTopicRoutes(topics, strategy, learningMemory)

  for (const route of topicRoutes) {
    if (sessions.length >= totalSessions) break
    const { topic, purpose: routePurpose } = route
    const purpose = routePurpose as SessionPurpose
    const conceptNames = getTopicConceptNames(topic)
    const weakConceptNames = conceptNames
      .filter(name =>
        strategy.priorityConcepts.some(p =>
          p.toLowerCase().includes(name.toLowerCase().slice(0, 8)) ||
          name.toLowerCase().includes(p.toLowerCase().slice(0, 8))
        )
      )
      .slice(0, 3)

    // Título específico: "Respiración celular: entender glucólisis y ciclo de Krebs"
    const sessionTitle = buildSessionTitle(topic, purpose)
    const sessionObjective = buildSessionObjective(topic, purpose)
    const evidenceGoal = buildEvidenceGoal(topic)

    // ── Decidir formato según topic + perfil ─────────────────────
    const sessionFormat = decideSessionFormat({
      topic,
      topicScore: 0,  // primera vez = 0
      sessionPurpose: purpose,
      daysToExam: null,  // se calcula en runtime
      hasFailedBefore: false,
      isFirstTimeWithTopic: true,
      userProfile: null,
      learningMemory,
    })

    // Pasos según purpose
    const steps = (() => {
      switch (purpose) {
        case 'understand': return stepsUnderstand(topic.title)
        case 'organize':   return stepsOrganize(topic.title)
        case 'memorize':   return stepsMemorize(topic.title)
        case 'apply':      return stepsApply(topic.title)
        case 'simulate':   return stepsSimulate(topic.title)
        case 'repair':
          return stepsRepair(
            weakConceptNames.length > 0
              ? weakConceptNames.join(', ')
              : conceptNames.slice(0, 2).join(', ')
          )
        default: return stepsUnderstand(topic.title)
      }
    })()

    const estimatedMinutes = Math.min(
      dailyMinutes,
      topic.estimatedMinutes || 18
    )

    const session = makeSession({
      sessionNumber: sessionNum++,
      title: sessionTitle,
      objective: sessionObjective,
      estimatedMinutes,
      purpose,
      steps,
      expectedDomainGain: purpose === 'simulate' ? 15 : purpose === 'apply' ? 12 : 10,
      status: sessions.length === 0 ? 'available' : 'locked',
      // Topic context — lo que va a las APIs
      topicId: topic.id,
      topicTitle: topic.title,
      targetConcepts: conceptNames.slice(0, 6),
      sourcePages: topic.sourcePages,
      evidenceGoal,
      blueprintConfidence: blueprint.confidence,
      sessionFormat,  // ← formato decidido por teaching engine
    })

    sessions.push(session)
  }

  // Si faltan sesiones hasta totalSessions, completar con repair o simulate
  // usando los topics más importantes
  while (sessions.length < totalSessions) {
    const topicIndex = sessions.length % topics.length
    const topic = topics[topicIndex]
    const isLast = sessions.length === totalSessions - 1
    const purpose: SessionPurpose = isLast ? 'simulate' : 'repair'
    const conceptNames = getTopicConceptNames(topic)

    const session = makeSession({
      sessionNumber: sessionNum++,
      title: buildSessionTitle(topic, purpose),
      objective: buildSessionObjective(topic, purpose),
      estimatedMinutes: Math.min(dailyMinutes, isLast ? 25 : 15),
      purpose,
      steps: isLast ? stepsSimulate(topic.title) : stepsRepair(conceptNames.slice(0, 2).join(', ')),
      expectedDomainGain: isLast ? 15 : 10,
      status: 'locked',
      topicId: topic.id,
      topicTitle: topic.title,
      targetConcepts: conceptNames.slice(0, 6),
      sourcePages: topic.sourcePages,
      evidenceGoal: buildEvidenceGoal(topic),
      blueprintConfidence: blueprint.confidence,
    })

    sessions.push(session)
  }

  return sessions
}

// ═══════════════════════════════════════════════════════════════
// BUILDER FALLBACK — sin blueprint, usa weakConcepts
// Comportamiento idéntico al generador original.
// ═══════════════════════════════════════════════════════════════

function sessionUnderstand(n: number, available: boolean): AdaptiveSession {
  return makeSession({
    sessionNumber: n,
    title: 'Entender la base',
    objective: 'Comprende las ideas principales del tema.',
    estimatedMinutes: 18,
    purpose: 'understand',
    expectedDomainGain: 12,
    status: available ? 'available' : 'locked',
    steps: stepsUnderstand(),
  })
}

function sessionOrganize(n: number): AdaptiveSession {
  return makeSession({
    sessionNumber: n,
    title: 'Organizar ideas',
    objective: 'Conecta los conceptos y ve cómo se relacionan.',
    estimatedMinutes: 15,
    purpose: 'organize',
    expectedDomainGain: 8,
    steps: stepsOrganize(),
  })
}

function sessionMemorize(n: number): AdaptiveSession {
  return makeSession({
    sessionNumber: n,
    title: 'Recordar lo esencial',
    objective: 'Ancla los conceptos clave en tu memoria.',
    estimatedMinutes: 15,
    purpose: 'memorize',
    expectedDomainGain: 10,
    steps: stepsMemorize(),
  })
}

function sessionApply(n: number): AdaptiveSession {
  return makeSession({
    sessionNumber: n,
    title: 'Practicar',
    objective: 'Aplica lo que sabes con ejercicios reales.',
    estimatedMinutes: 18,
    purpose: 'apply',
    expectedDomainGain: 12,
    steps: stepsApply(),
  })
}

function sessionSimulate(n: number): AdaptiveSession {
  return makeSession({
    sessionNumber: n,
    title: 'Simular examen',
    objective: 'Mide tu dominio real bajo condiciones de examen.',
    estimatedMinutes: 25,
    purpose: 'simulate',
    expectedDomainGain: 15,
    steps: stepsSimulate(),
  })
}

function sessionRepair(n: number, weakConcepts?: string[]): AdaptiveSession {
  return makeSession({
    sessionNumber: n,
    title: 'Corregir errores',
    objective: 'Trabaja los conceptos que fallaron.',
    estimatedMinutes: 15,
    purpose: 'repair',
    expectedDomainGain: 10,
    steps: stepsRepair(weakConcepts?.slice(0, 2).join(', ')),
  })
}

function buildSessionsFromStrategy(
  strategy: StudyStrategy,
  learningMemory?: LearningMemory | null,
): AdaptiveSession[] {
  const { order, totalSessions } = strategy
  const finalOrder = learningMemory
    ? getStyleBasedRoute(learningMemory, order)
    : order

  const sessionBuilders: Record<string, (n: number) => AdaptiveSession> = {
    understand: (n) => sessionUnderstand(n, false),
    organize: sessionOrganize,
    memorize: sessionMemorize,
    apply: sessionApply,
    simulate: sessionSimulate,
    repair: (n) => sessionRepair(n, strategy.priorityConcepts),
  }

  const built: AdaptiveSession[] = []
  let sessionNum = 1

  for (const phase of finalOrder) {
    if (built.length >= totalSessions) break
    const builder = sessionBuilders[phase]
    if (builder) built.push(builder(sessionNum++))
  }

  while (built.length < totalSessions) {
    if (built.length < totalSessions - 1) {
      built.push(sessionRepair(sessionNum++, strategy.priorityConcepts))
    } else {
      built.push(sessionSimulate(sessionNum++))
    }
  }

  return built
}

// ═══════════════════════════════════════════════════════════════
// ANÁLISIS DE MASTERY
// ═══════════════════════════════════════════════════════════════

interface MasteryProfile {
  currentDomain: number
  hasIllusion: boolean
  hasForgettingRisk: boolean
  examPassProbability: number
  weakCount: number
  criticalCount: number
  dominatedCount: number
  needsRepair: boolean
  needsMemory: boolean
  needsApplication: boolean
}

function analyzeMastery(mastery: MaterialMastery | null): MasteryProfile {
  if (!mastery) {
    return {
      currentDomain: 0, hasIllusion: false, hasForgettingRisk: false,
      examPassProbability: 0, weakCount: 0, criticalCount: 0, dominatedCount: 0,
      needsRepair: false, needsMemory: true, needsApplication: false,
    }
  }

  try {
    const snap = calculateMasterySnapshot(mastery)
    const concepts = mastery.concepts || []

    return {
      currentDomain: snap.overallMastery,
      hasIllusion: concepts.some(c => c.confidence > 65 && c.mistakes >= 2),
      hasForgettingRisk: concepts.some(
        c => c.forgettingRisk === 'very_high' || c.forgettingRisk === 'high'
      ),
      examPassProbability: snap.examPassProbability,
      weakCount: snap.weakConcepts.length,
      criticalCount: snap.criticalConcepts.length,
      dominatedCount: snap.dominatedConcepts.length,
      needsRepair: snap.criticalConcepts.length > 2 || concepts.some(c => c.confidence > 65 && c.mistakes >= 2),
      needsMemory: snap.memory < 50,
      needsApplication: snap.application < 40,
    }
  } catch {
    return {
      currentDomain: 0, hasIllusion: false, hasForgettingRisk: false,
      examPassProbability: 0, weakCount: 0, criticalCount: 0, dominatedCount: 0,
      needsRepair: false, needsMemory: true, needsApplication: false,
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// GENERADOR PRINCIPAL
// ═══════════════════════════════════════════════════════════════

export function generateAdaptiveProgram(
  mastery: MaterialMastery | null,
  setup: AdaptiveProgramSetup,
  blueprint?: MaterialBlueprint | null,
  learningMemory?: LearningMemory | null,
  userProfile?: UserProfile | null,
): AdaptiveProgram {
  const daysToExam = getDaysToExam(setup.examDate)

  // ── Ajuste por perfil del usuario ────────────────────────────
  const profileAdjustment = userProfile
    ? getProfileStrategyAdjustment(userProfile, daysToExam)
    : null

  // Análisis del mastery actual
  analyzeMastery(mastery)

  // Construir estrategia
  const strategy = buildStudyStrategy(mastery, setup, null, blueprint)

  // Enriquecer con utilidad
  const enrichedStrategy = enrichStrategyWithUtility(
    strategy,
    mastery,
    null,
    setup.dailyMinutes,
    setup.targetScore,
    daysToExam,
  )

  let sessions: AdaptiveSession[]

  // ── CON BLUEPRINT: sesiones ancladas a temas reales ──────────
  if (blueprint && blueprint.topics.length > 0 && blueprint.validationPassed) {
    console.log(`[Generator] Usando blueprint: ${blueprint.topics.length} temas, confidence: ${blueprint.confidence}%`)
    sessions = buildSessionsFromBlueprint(blueprint, enrichedStrategy, setup.dailyMinutes, learningMemory ?? null, userProfile ?? null)
  } else {
    // ── SIN BLUEPRINT: fallback con conceptos genéricos ─────────
    if (blueprint) {
      console.log(`[Generator] Blueprint disponible pero no válido (confidence: ${blueprint.confidence}%) — usando fallback`)
    }
    sessions = buildSessionsFromStrategy(enrichedStrategy, learningMemory ?? null)
  }

  // Normalizar: numeración correcta, primera disponible
  sessions = sessions.map((s, i) => ({
    ...s,
    sessionNumber: i + 1,
    status: i === 0 ? 'available' as const : 'locked' as const,
  }))

  return {
    id: uid(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    materialIds: mastery
      ? [mastery.materialId].filter(Boolean)
      : [],
    setup,
    status: 'active',
    sessions,
    currentSessionIndex: 0,
    strategy: enrichedStrategy,
    // Guardar blueprint en el programa para que replanner y updater lo usen
    materialBlueprint: blueprint ?? null,
  }
}

// Re-exportar para consumidores
export { buildStudyStrategy }
export type { StudyStrategy }
