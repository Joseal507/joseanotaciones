import { alaiRequest } from '../alai'
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

  // Ordenar temas por prerequisitos y importancia
  const topicsByImportance = getTopicsByImportance(blueprint)
  const topics = topologicalSortTopics(topicsByImportance)

  // ═══════════════════════════════════════════════════════════════
  // REGLA: 1 SESIÓN = 1 TOPIC
  // El orquestador (/api/adaptive/think) decide las herramientas
  // dentro de cada sesión. No multiplicar sesiones por purposes.
  // ═══════════════════════════════════════════════════════════════
  let sessionNum = 1

  for (const topic of topics) {
    const conceptNames = getTopicConceptNames(topic)

    // Costo cognitivo del topic
    const conceptCount = (topic.concepts || []).length
    const cognitiveCost = Math.min(100,
      (topic.difficulty ?? 50) * 0.6 + (conceptCount * 5)
    )

    const profileMinutesFactor = userProfile?.academicLevel === 'basico' ? 0.75
      : userProfile?.academicLevel === 'avanzado' ? 1.1
      : 1.0

    const estimatedMinutes = cognitiveCost > 70
      ? Math.min(dailyMinutes || 45, Math.round((topic.estimatedMinutes || 20) * 0.75 * profileMinutesFactor))
      : Math.min(dailyMinutes || 45, Math.round((topic.estimatedMinutes || 20) * profileMinutesFactor))

    // Crear UNA sesión por topic
    const session = makeSession({
      sessionNumber: sessionNum++,
      title: topic.title,
      objective: buildSessionObjective(topic, 'understand'),
      estimatedMinutes,
      purpose: 'understand' as SessionPurpose,
      steps: stepsUnderstand(topic.title),
      expectedDomainGain: 18,
      status: sessions.length === 0 ? 'available' : 'locked',
      topicId: topic.id,
      topicTitle: topic.title,
      targetConcepts: conceptNames.slice(0, 6),
      sourcePages: topic.sourcePages,
      evidenceGoal: buildEvidenceGoal(topic),
      blueprintConfidence: blueprint.confidence,
      sessionFormat: 'discovery',
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

export async function generateAdaptiveProgram(
  mastery: MaterialMastery | null,
  setup: AdaptiveProgramSetup,
  blueprint?: MaterialBlueprint | null,
  learningMemory?: LearningMemory | null,
  userProfile?: UserProfile | null,
): Promise<AdaptiveProgram> {
  const daysToExam = getDaysToExam(setup.examDate)

  // Análisis y estrategia (sigue calculándose para que el updater/replanner lo use)
  analyzeMastery(mastery)
  const strategy = buildStudyStrategy(mastery, setup, null, blueprint)
  const enrichedStrategy = enrichStrategyWithUtility(
    strategy,
    mastery,
    null,
    setup.dailyMinutes,
    setup.targetScore,
    daysToExam,
  )

  let sessions: AdaptiveSession[]
  let planRationale = ''

  // ── CON BLUEPRINT: ALAI diseña el programa ──────────────
  if (blueprint && blueprint.topics.length > 0 && blueprint.validationPassed) {
    console.log(`[Generator] Pidiendo a ALAI diseñar programa | ${blueprint.topics.length} topics | sessionLength: ${setup.sessionLength || 'medium'}`)

    try {
      // Importar la route directamente para evitar fetch HTTP
      const routePath = require('path').resolve(process.cwd(), 'app/api/adaptive/plan-program/route')
      const { POST: planProgramPOST } = await import(routePath)
      const req = new Request('http://local/plan-program', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blueprint, setup, userProfile, mastery, learningMemory }),
      })
      const res = await planProgramPOST(req as any)
      const data = await res.json()

      if (!data.success || !Array.isArray(data.sessions) || data.sessions.length === 0) {
        throw new Error(data?.error || 'ALAI no devolvió sesiones')
      }

      planRationale = data.rationale || ''
      sessions = sessionsFromPlan(data.sessions, blueprint, enrichedStrategy)
      console.log(`[Generator] ✅ ALAI diseñó ${sessions.length} sesiones`)
    } catch (err: any) {
      console.error('[Generator] plan-program falló:', err.message)
      // No fallback silencioso — propagar el error
      throw new Error(err?.message || 'ALAI está ocupado. Intenta de nuevo en un momento.')
    }
  } else {
    // ── SIN BLUEPRINT VÁLIDO: error claro al usuario ──────
    if (blueprint) {
      console.log(`[Generator] Blueprint no válido (confidence: ${blueprint.confidence}%)`)
    }
    throw new Error('No se pudo analizar el material lo suficiente para diseñar un programa adaptativo. Sube material con más contenido o intenta de nuevo.')
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
    materialIds: mastery ? [mastery.materialId].filter(Boolean) : [],
    setup,
    status: 'active',
    sessions,
    currentSessionIndex: 0,
    strategy: enrichedStrategy,
    materialBlueprint: blueprint ?? null,
  }
}

// ═══════════════════════════════════════════════════════════════
// Construir sesiones del programa desde el plan de ALAI
// Cada sesión queda con steps=[] — el plan-session los llenará on-demand
// ═══════════════════════════════════════════════════════════════
function sessionsFromPlan(
  planSessions: any[],
  blueprint: MaterialBlueprint,
  strategy: StudyStrategy,
): AdaptiveSession[] {
  const topicById = new Map(blueprint.topics.map(t => [t.id, t]))

  // Construir también mapa por título para resolver cuando el LLM usa títulos en vez de IDs
  const topicByTitle = new Map(blueprint.topics.map(t => [t.title.toLowerCase().trim(), t]))
  const topicByPartialTitle = new Map<string, MaterialTopic>()
  for (const t of blueprint.topics) {
    // Indexar por palabras clave del título
    const words = t.title.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    for (const w of words) {
      if (!topicByPartialTitle.has(w)) topicByPartialTitle.set(w, t)
    }
  }

  return planSessions.map((ps: any, idx: number) => {
    // Resolver topics agrupados en esta sesión
    const rawTopicIds: string[] = Array.isArray(ps.topicIds) ? ps.topicIds : []
    
    // Resolver cada ID — el LLM a veces devuelve "Topic 1", "Topic 2" en vez del ID real
    const resolvedTopics = rawTopicIds
      .map(id => {
        // Intento 1: ID exacto
        if (topicById.has(id)) return topicById.get(id)!
        
        // Intento 2: "Topic N" → usar el Nth topic del blueprint
        const topicNMatch = id.match(/^topic\s*(\d+)$/i)
        if (topicNMatch) {
          const n = parseInt(topicNMatch[1]) - 1
          if (n >= 0 && n < blueprint.topics.length) return blueprint.topics[n]
        }
        
        // Intento 3: buscar por título exacto
        if (topicByTitle.has(id.toLowerCase().trim())) return topicByTitle.get(id.toLowerCase().trim())!
        
        // Intento 4: buscar por palabra clave en el título
        const words = id.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3)
        for (const w of words) {
          if (topicByPartialTitle.has(w)) return topicByPartialTitle.get(w)!
        }
        
        return undefined
      })
      .filter((t): t is MaterialTopic => !!t)
      // Eliminar duplicados
      .filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i)

    // Si no se resolvió ningún topic, usar el del índice como fallback
    const primaryTopic = resolvedTopics[0] || blueprint.topics[idx % blueprint.topics.length]

    // Conceptos agregados de todos los topics de esta sesión
    const allConcepts = resolvedTopics.length > 0
      ? resolvedTopics.flatMap(t => getTopicConceptNames(t)).slice(0, 12)
      : getTopicConceptNames(primaryTopic).slice(0, 8)

    // Páginas agregadas
    const allPages = Array.from(new Set(
      resolvedTopics.length > 0
        ? resolvedTopics.flatMap(t => t.sourcePages || [])
        : (primaryTopic.sourcePages || [])
    )).sort((a, b) => a - b)

    return makeSession({
      sessionNumber: idx + 1,
      title: String(ps.title || primaryTopic.title),
      objective: String(ps.objective || buildSessionObjective(primaryTopic, 'understand')),
      estimatedMinutes: Number(ps.estimatedMinutes) || 22,
      purpose: (ps.purpose || 'understand') as SessionPurpose,
      steps: [],  // ← VACÍO: plan-session los genera on-demand
      expectedDomainGain: Number(ps.expectedDomainGain) || 10,
      status: idx === 0 ? 'available' : 'locked',
      topicId: primaryTopic.id,
      topicTitle: primaryTopic.title,
      targetConcepts: allConcepts,
      sourcePages: allPages,
      evidenceGoal: buildEvidenceGoal(primaryTopic),
      blueprintConfidence: blueprint.confidence,
      sessionFormat: 'discovery',
      groupedTopicIds: rawTopicIds.length > 1 ? rawTopicIds : undefined,
      planRationale: String(ps.rationale || ''),
      plannedAt: Date.now(),
      planVersion: 1,
    } as any)
  })
}

// Re-exportar para consumidores
export { buildStudyStrategy }
export type { StudyStrategy }
