// ═══════════════════════════════════════════════════════════════
// AGENTE 4 — PLANNER
// 
// Convierte MaterialIntelligence + StudentModel + StudyGoal
// en un plan de sesiones (SessionBlueprint[]).
// 
// El plan es la MISIÓN de cada sesión (qué topics cubrir,
// qué objetivos alcanzar), NO una lista rígida de actividades.
// El tutor decide después cómo enseñar cada sesión.
// ═══════════════════════════════════════════════════════════════

import { alaiRequest, safeParseJson } from '../../../alai'
import type {
  MaterialIntelligence,
  StudentModel,
  StudyGoal,
  SessionBlueprint,
  SessionKind,
  TopicNode,
} from '../types'

export interface PlannerResult {
  success: boolean
  sessions: SessionBlueprint[]
  strategy: {
    reasoning: string           // Por qué ALAI eligió esta estructura
    goals: string[]             // Metas del programa completo
    projectedProgress: number[] // Dominio esperado sesión por sesión
    warnings: string[]          // Alertas (ej: "poco tiempo para material grande")
  }
  stats: {
    totalSessions: number
    totalMinutes: number
    processingTimeMs: number
    coverageComplete: boolean   // ¿100% de topics cubiertos?
    topicsCovered: number
    topicsTotal: number
  }
  errors: string[]
}

// ═══════════════════════════════════════════════════════════════
// CALCULAR NÚMERO ÓPTIMO DE SESIONES
// ═══════════════════════════════════════════════════════════════
function calculateSessionCount(
  intelligence: MaterialIntelligence,
  goal: StudyGoal,
): { count: number; reasoning: string } {
  const totalTopics = intelligence.topics.length
  const criticalTopics = intelligence.topics.filter(t => t.importance === 'critical').length
  const daysAvailable = goal.daysUntilDeadline ?? 14
  const sessionMinutes = goal.sessionDurationMinutes

  // Topics por sesión según duración
  const topicsPerSession = sessionMinutes >= 30 ? 3 : sessionMinutes >= 20 ? 2 : 1.5

  // Sesiones base según cobertura del material
  const baseSessionsNeeded = Math.ceil(totalTopics / topicsPerSession)

  // Ajustar según urgencia
  let count: number
  let reasoning: string

  if (daysAvailable === 0) {
    // Examen hoy → máximo 3 sesiones intensivas
    count = Math.min(baseSessionsNeeded, 3)
    reasoning = `Examen HOY — 3 sesiones intensivas de rescate cubriendo lo esencial`
  } else if (daysAvailable === 1) {
    // Mañana → máximo 4 sesiones
    count = Math.min(baseSessionsNeeded, 4)
    reasoning = `Examen MAÑANA — 4 sesiones enfocadas en topics críticos`
  } else if (daysAvailable <= 3) {
    count = Math.min(baseSessionsNeeded, 5)
    reasoning = `3 días — plan comprimido de 5 sesiones`
  } else if (daysAvailable <= 7) {
    count = Math.min(Math.max(baseSessionsNeeded, 5), 8)
    reasoning = `1 semana — cobertura completa en ${count} sesiones`
  } else if (daysAvailable <= 14) {
    count = Math.min(Math.max(baseSessionsNeeded, 6), 10)
    reasoning = `2 semanas — cobertura profunda en ${count} sesiones`
  } else {
    count = Math.min(Math.max(baseSessionsNeeded, 8), 15)
    reasoning = `Tiempo abundante — ${count} sesiones para dominio completo`
  }

  // Si el objetivo es 100, agregar al menos 2 sesiones más de práctica intensiva
  if (goal.targetScore >= 95 && count < 15) {
    count = Math.min(count + 2, 15)
    reasoning += ` (+2 sesiones extra por objetivo de 100)`
  }

  return { count, reasoning }
}

// ═══════════════════════════════════════════════════════════════
// AGRUPAR TOPICS POR PREREQUISITOS
// ═══════════════════════════════════════════════════════════════
function groupTopicsBySessions(
  intelligence: MaterialIntelligence,
  sessionCount: number,
  reserveLastForReview: boolean = true,
): TopicNode[][] {
  const topics = [...intelligence.topics]

  // Ordenar topics por dependencia (topological sort)
  const ordered = topologicalSort(topics)

  // Si reservamos la última sesión para repaso, tenemos count-1 sesiones para contenido
  const teachingSessions = reserveLastForReview ? sessionCount - 1 : sessionCount
  const groups: TopicNode[][] = []

  if (teachingSessions <= 0) {
    return [ordered]
  }

  // Distribuir topics equitativamente, respetando orden
  const topicsPerSession = Math.ceil(ordered.length / teachingSessions)

  for (let i = 0; i < teachingSessions; i++) {
    const start = i * topicsPerSession
    const end = Math.min(start + topicsPerSession, ordered.length)
    const group = ordered.slice(start, end)
    if (group.length > 0) groups.push(group)
  }

  // Agregar sesión de repaso final si aplica y tenemos topics
  if (reserveLastForReview && groups.length > 0) {
    // La sesión de repaso cubre TODOS los topics críticos
    const criticalTopics = topics.filter(t => 
      t.importance === 'critical' || t.importance === 'high'
    )
    groups.push(criticalTopics.length > 0 ? criticalTopics : topics.slice(0, Math.min(5, topics.length)))
  }

  return groups
}

// ═══════════════════════════════════════════════════════════════
// TOPOLOGICAL SORT (respetar prerequisitos)
// ═══════════════════════════════════════════════════════════════
function topologicalSort(topics: TopicNode[]): TopicNode[] {
  const sorted: TopicNode[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const topicMap = new Map(topics.map(t => [t.id, t]))

  function visit(topicId: string) {
    if (visited.has(topicId)) return
    if (visiting.has(topicId)) return // Evitar ciclos

    visiting.add(topicId)
    const topic = topicMap.get(topicId)
    if (!topic) return

    // Visitar primero los prerequisitos
    for (const prereqId of topic.prerequisites) {
      if (topicMap.has(prereqId)) {
        visit(prereqId)
      }
    }

    visiting.delete(topicId)
    visited.add(topicId)
    sorted.push(topic)
  }

  // Priorizar topics críticos primero
  const priorityOrder = topics.slice().sort((a, b) => {
    const importanceOrder = { critical: 0, high: 1, medium: 2, low: 3 }
    const ai = importanceOrder[a.importance]
    const bi = importanceOrder[b.importance]
    if (ai !== bi) return ai - bi
    return a.prerequisites.length - b.prerequisites.length
  })

  for (const topic of priorityOrder) {
    visit(topic.id)
  }

  return sorted
}

// ═══════════════════════════════════════════════════════════════
// DECIDIR TIPO DE SESIÓN (SessionKind)
// ═══════════════════════════════════════════════════════════════
function decideSessionKind(
  sessionIndex: number,
  totalSessions: number,
  isLastSession: boolean,
  goal: StudyGoal,
  topicsInSession: TopicNode[],
): SessionKind {
  // Última sesión siempre es simulacro o repaso
  if (isLastSession) {
    if (goal.urgency === 'critical' || goal.urgency === 'high') return 'exam_simulation'
    return 'final_review'
  }

  // Segunda a última suele ser consolidación
  if (sessionIndex === totalSessions - 2 && totalSessions >= 5) {
    return 'consolidation'
  }

  // Primera sesión: primer contacto
  if (sessionIndex === 0) return 'first_contact'

  // Sesiones intermedias: alternar entre profundizar y practicar
  const criticalCount = topicsInSession.filter(t => t.importance === 'critical').length
  const mathematicalCount = topicsInSession.filter(t => t.topicType === 'mathematical' || t.topicType === 'procedural').length

  if (mathematicalCount >= topicsInSession.length / 2) return 'practice_heavy'
  if (criticalCount >= topicsInSession.length / 2) return 'deep_dive'
  if (sessionIndex >= totalSessions / 2) return 'connect_ideas'

  return 'deep_dive'
}

// ═══════════════════════════════════════════════════════════════
// GENERAR MISIÓN DE SESIÓN CON ALAI
// ═══════════════════════════════════════════════════════════════
/**
 * Genera un título de sesión pedagógico desde los topics agrupados,
 * SIN depender del LLM. Usado como fallback cuando la generación LLM falla.
 */
function generateFallbackSessionTitle(topics: TopicNode[], sessionNumber: number): string {
  if (topics.length === 0) return `Sesión ${sessionNumber}`

  // Extraer palabras significativas de los títulos de topics
  const STOPWORDS = new Set(['de','la','el','los','las','y','o','del','al','a','en','con','por','para','un','una','es','se','que','como','esta','este','sus','su'])

  // Si hay 1 topic, usar su título (limpio)
  if (topics.length === 1) {
    return topics[0].title.slice(0, 60)
  }

  // Si hay 2-3 topics, intentar detectar tema común usando palabras clave
  const allWords: string[] = []
  for (const t of topics) {
    const words = t.title.toLowerCase().split(/[\s\-]+/).filter(w => w.length > 2 && !STOPWORDS.has(w))
    allWords.push(...words)
  }

  // Contar frecuencia de palabras
  const freq = new Map<string, number>()
  for (const w of allWords) freq.set(w, (freq.get(w) || 0) + 1)

  // Palabras que se repiten en múltiples topics = tema central
  const common = Array.from(freq.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1))

  if (common.length > 0) {
    // Ej: si comparten "ácido" y "base" → "Ácidos y bases"
    if (common.length >= 2) return `${common[0]} y ${common[1]}`
    return `Fundamentos de ${common[0]}`
  }

  // Sin tema común: usar el título del topic más importante
  const critical = topics.find(t => t.importance === 'critical')
  const high = topics.find(t => t.importance === 'high')
  const best = critical || high || topics[0]
  return best.title.slice(0, 60)
}

async function generateSessionMissions(
  topicGroups: TopicNode[][],
  intelligence: MaterialIntelligence,
  student: StudentModel,
  goal: StudyGoal,
): Promise<Array<{
  title: string
  mission: string
  learningObjectives: Array<{ objective: string; verificationCriteria: string; priority: 'must_have' | 'should_have' | 'nice_to_have' }>
}>> {
  const totalSessions = topicGroups.length

  // Construir descripción SEMÁNTICA de cada sesión desde los conceptos reales
  // NO usamos los títulos crudos (pueden estar contaminados con metadata del PDF).
  // Usamos keyFacts + rawText para que el LLM entienda de qué trata cada sesión.
  const groupsDescription = topicGroups.map((group, i) => {
    const conceptsInSession = group.map((t, j) => {
      const facts = (t.keyFacts || []).slice(0, 3).filter(Boolean).join(' | ')
      const excerpt = (t.rawText || '').slice(0, 200).replace(/\s+/g, ' ').trim()
      return `  Concepto ${j + 1}:\n    Facts: ${facts || '(sin datos)'}\n    Extracto: ${excerpt || '(sin texto)'}`
    }).join('\n')
    return `SESIÓN ${i + 1} (${group.length} conceptos):\n${conceptsInSession}`
  }).join('\n\n')

  const profile: any = student.profile || {}
  const carreraContext = profile.carrera ? `Carrera: ${profile.carrera}` : ''
  const nivelContext = profile.tipoEstudiante ? `Nivel: ${profile.tipoEstudiante}` : ''

  const prompt = `Eres un pedagogo experto diseñando la MISIÓN de cada sesión de un programa de estudio.

═══════════════════════════════════════════════════════════════
CONTEXTO
═══════════════════════════════════════════════════════════════
Material: "${intelligence.materialTitle}"
Área: ${intelligence.subjectArea}
Nivel del material: ${intelligence.difficultyLevel}

Estudiante:
${carreraContext}
${nivelContext}
Nivel inicial: ${student.setup?.initialKnowledgeLevel || 'some'}
Objetivo: ${goal.targetScore}/100
Días para examen: ${goal.daysUntilDeadline ?? 'sin fecha'}
Urgencia: ${goal.urgency}

═══════════════════════════════════════════════════════════════
DISTRIBUCIÓN DE TOPICS POR SESIÓN
═══════════════════════════════════════════════════════════════
${groupsDescription}

═══════════════════════════════════════════════════════════════
TU TAREA
═══════════════════════════════════════════════════════════════
Para cada sesión, genera:
1. Un TÍTULO CLARO Y CORTO (max 8 palabras) que describa el foco
2. Una MISIÓN pedagógica (1 oración) que explique qué logrará el estudiante
3. 2-4 OBJETIVOS DE APRENDIZAJE verificables (el estudiante podrá X)

REGLAS ESTRICTAS PARA TÍTULOS:
- Genera el título DESDE los conceptos de la sesión (facts + extractos)
- NO copies texto crudo de los extractos — reformula pedagógicamente
- Piensa: "¿cómo aparecería este tema en el índice de un libro de texto?"
- Debe ser un TEMA educativo, NO una lista

✅ Ejemplos correctos:
  - "Fundamentos de ácidos y bases"
  - "Constante de equilibrio Ka"
  - "Ácidos de Lewis"
  - "Duplicación del ADN"
  - "Genotipo y fenotipo"

🚫 NUNCA uses:
  - Nombres de autores/profesores ("Dra. María", "Facilitador X")
  - Copyright ("© 2009 Prentice-Hall")
  - Fragmentos de oración ("En oxiácidos, en los", "para el caso de")
  - Instituciones ("Universidad X", "Facultad Y")
  - Fórmulas o ecuaciones ("[H3O+][OH-] = 10^-14")
  - Definiciones con formato "PALABRA: descripción larga"
  - Verbos imperativos ("Calcule K", "Determine X")
  - "Sesión 1", "Contenido parte X", "Introducción"

Las misiones deben conectar los conceptos entre sí, no ser una lista.

Los objetivos deben ser accionables y verificables.

Devuelve SOLO este JSON:
{
  "sessions": [
    {
      "title": "Título corto y específico",
      "mission": "El estudiante logrará [X] conectando [Y] con [Z]",
      "learningObjectives": [
        {
          "objective": "El estudiante podrá calcular/explicar/aplicar...",
          "verificationCriteria": "Cómo saber si lo logró",
          "priority": "must_have" | "should_have" | "nice_to_have"
        }
      ]
    }
  ]
}`

  try {
    const result = await alaiRequest(async (client: any, modelFn: any) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [
          { role: 'system', content: 'Eres un pedagogo diseñando planes de estudio. Solo JSON válido.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 3000,
      })
      const raw = res?.choices?.[0]?.message?.content || ''
      if (!raw.trim()) throw new Error('Empty planner response')
      return { text: raw, provider: 'unknown', model: 'unknown' }
    })

    const parsed = safeParseJson(result.text)
    if (!parsed?.sessions || !Array.isArray(parsed.sessions)) {
      // Fallback: generar misiones básicas
      return topicGroups.map((group, i) => ({
        title: generateFallbackSessionTitle(group, i + 1),
        mission: `Dominar: ${group.map(t => t.title).join(', ')}`,
        learningObjectives: group.flatMap(t => t.learningObjectives).slice(0, 4).map(obj => ({
          objective: obj,
          verificationCriteria: 'Responder correctamente ejercicios relacionados',
          priority: 'must_have' as const,
        })),
      }))
    }

    // Asegurar que hay una entrada por cada grupo
    const missions = parsed.sessions.slice(0, topicGroups.length)
    while (missions.length < topicGroups.length) {
      const i = missions.length
      const group = topicGroups[i]
      missions.push({
        title: generateFallbackSessionTitle(group, i + 1),
        mission: `Dominar: ${group.map(t => t.title).join(', ')}`,
        learningObjectives: [],
      })
    }

    return missions
  } catch (err: any) {
    console.error('[generateSessionMissions]', err.message)
    // Fallback
    return topicGroups.map((group, i) => ({
      title: generateFallbackSessionTitle(group, i + 1),
      mission: `Dominar: ${group.map(t => t.title).join(', ')}`,
      learningObjectives: group.flatMap(t => t.learningObjectives).slice(0, 4).map(obj => ({
        objective: obj,
        verificationCriteria: 'Responder correctamente ejercicios relacionados',
        priority: 'must_have' as const,
      })),
    }))
  }
}

// ═══════════════════════════════════════════════════════════════
// GENERAR ESTRATEGIA GENERAL DEL PROGRAMA
// ═══════════════════════════════════════════════════════════════
async function generateProgramStrategy(
  intelligence: MaterialIntelligence,
  student: StudentModel,
  goal: StudyGoal,
  sessionCount: number,
  topicGroups: TopicNode[][],
): Promise<{ reasoning: string; goals: string[]; warnings: string[] }> {
  const profile: any = student.profile || {}
  const carrera = profile.carrera || 'sin carrera especificada'
  const nivel = student.setup?.initialKnowledgeLevel || 'some'
  const totalTopics = intelligence.topics.length

  const prompt = `Eres un pedagogo experto explicando la estrategia de un programa de estudio.

CONTEXTO:
- Material: "${intelligence.materialTitle}" (${intelligence.subjectArea}, ${intelligence.difficultyLevel})
- Estudiante: ${carrera}, nivel inicial ${nivel}
- Objetivo: ${goal.targetScore}/100 en ${goal.daysUntilDeadline ?? 'sin fecha'} días
- Total de topics: ${totalTopics}
- Sesiones planeadas: ${sessionCount}

Explica en 2-3 oraciones POR QUÉ elegiste esta estrategia y qué lograrás al final.

Devuelve SOLO este JSON:
{
  "reasoning": "Estrategia explicada al estudiante en 2-3 oraciones, tono cercano",
  "goals": [
    "Meta 1 concreta",
    "Meta 2",
    "Meta 3"
  ],
  "warnings": [
    "Alerta si aplica (ej: 'material muy grande para el tiempo disponible')"
  ]
}`

  try {
    const result = await alaiRequest(async (client: any, modelFn: any) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [
          { role: 'system', content: 'Eres pedagogo explicando planes. Solo JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 800,
      })
      const raw = res?.choices?.[0]?.message?.content || ''
      if (!raw.trim()) throw new Error('Empty')
      return { text: raw, provider: 'unknown', model: 'unknown' }
    })

    const parsed = safeParseJson(result.text)
    return {
      reasoning: parsed?.reasoning || `Plan de ${sessionCount} sesiones para dominar ${totalTopics} topics.`,
      goals: parsed?.goals || [`Cubrir el 100% del material`, `Alcanzar ${goal.targetScore}/100`],
      warnings: parsed?.warnings || [],
    }
  } catch {
    return {
      reasoning: `Plan de ${sessionCount} sesiones para cubrir ${totalTopics} topics del material en ${goal.daysUntilDeadline ?? 'el tiempo'} disponible.`,
      goals: [
        `Cubrir el 100% del material`,
        `Alcanzar ${goal.targetScore}/100`,
        `Dominar los topics críticos`,
      ],
      warnings: [],
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// PROYECTAR PROGRESO
// ═══════════════════════════════════════════════════════════════
function projectProgress(sessionCount: number, targetScore: number, initialLevel: string): number[] {
  const startingPoint = initialLevel === 'zero' ? 0
    : initialLevel === 'some' ? 15
    : initialLevel === 'review' ? 30
    : initialLevel === 'practice' ? 50
    : 20

  const projection: number[] = [startingPoint]
  const gap = targetScore - startingPoint

  for (let i = 1; i <= sessionCount; i++) {
    // Curva de aprendizaje: más ganancia al inicio, se estabiliza
    const progress = 1 - Math.pow(1 - i / sessionCount, 1.5)
    const value = Math.round(startingPoint + gap * progress)
    projection.push(value)
  }

  return projection
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL DEL PLANNER
// ═══════════════════════════════════════════════════════════════
export async function createSessionPlan(
  intelligence: MaterialIntelligence,
  student: StudentModel,
  goal: StudyGoal,
): Promise<PlannerResult> {
  const startTime = Date.now()
  const errors: string[] = []

  console.log(`\n📋 [Planner] Diseñando plan de estudio`)
  console.log(`   Material: ${intelligence.materialTitle} (${intelligence.topics.length} topics)`)
  console.log(`   Estudiante: nivel ${student.setup?.initialKnowledgeLevel}, objetivo ${goal.targetScore}`)
  console.log(`   Días para examen: ${goal.daysUntilDeadline ?? 'sin fecha'}`)

  try {
    // ── 1. Calcular número de sesiones ──────────────────────────
    const { count: sessionCount, reasoning: countReasoning } = calculateSessionCount(intelligence, goal)
    console.log(`✓ Sesiones planeadas: ${sessionCount} (${countReasoning})`)

    // ── 2. Agrupar topics por sesiones ──────────────────────────
    const topicGroups = groupTopicsBySessions(intelligence, sessionCount, sessionCount >= 3)
    console.log(`✓ Topics agrupados en ${topicGroups.length} sesiones`)

    // ── 3. Generar misiones con ALAI (en paralelo con estrategia) ──
    const [missions, strategy] = await Promise.all([
      generateSessionMissions(topicGroups, intelligence, student, goal),
      generateProgramStrategy(intelligence, student, goal, sessionCount, topicGroups),
    ])

    // ── 4. Construir SessionBlueprints ──────────────────────────
    const now = Date.now()
    const sessions: SessionBlueprint[] = topicGroups.map((group, i) => {
      const isLast = i === topicGroups.length - 1
      const mission = missions[i]
      const sessionKind = decideSessionKind(i, topicGroups.length, isLast, goal, group)

      const estimatedMinutes = group.reduce((sum, t) => sum + t.estimatedMinutes, 0)
      const adjustedMinutes = Math.min(
        Math.max(estimatedMinutes, goal.sessionDurationMinutes - 5),
        goal.sessionDurationMinutes + 10
      )

      return {
        sessionId: `session_${i + 1}_${now}`,
        sessionNumber: i + 1,
        mission: mission?.mission || `Cubrir topics: ${group.map(t => t.title).join(', ')}`,
        targetTopics: group.map(t => t.id),
        estimatedMinutes: adjustedMinutes,
        learningObjectives: mission?.learningObjectives || [],
        sessionKind,
        createdAt: now,
        status: i === 0 ? 'ready' : 'locked',
      }
    })

    // Enriquecer con títulos generados
    sessions.forEach((s, i) => {
      (s as any).title = missions[i]?.title || `Sesión ${i + 1}`
    })

    // ── 5. Calcular proyección ──────────────────────────────────
    const projectedProgress = projectProgress(
      sessionCount,
      goal.targetScore,
      student.setup?.initialKnowledgeLevel || 'some'
    )

    // ── 6. Verificar cobertura ──────────────────────────────────
    const allCoveredIds = new Set(sessions.flatMap(s => s.targetTopics))
    const coverageComplete = intelligence.topics.every(t => allCoveredIds.has(t.id))

    if (!coverageComplete) {
      const uncovered = intelligence.topics.filter(t => !allCoveredIds.has(t.id))
      errors.push(`${uncovered.length} topics no cubiertos: ${uncovered.map(t => t.title).join(', ')}`)
    }

    const totalMs = Date.now() - startTime

    console.log(`\n📋 [Planner] COMPLETO en ${totalMs}ms`)
    console.log(`   Sesiones: ${sessions.length}`)
    console.log(`   Cobertura: ${allCoveredIds.size}/${intelligence.topics.length} topics`)
    console.log(`   Proyección: ${projectedProgress[0]} → ${projectedProgress[projectedProgress.length - 1]}`)

    return {
      success: true,
      sessions,
      strategy: {
        reasoning: strategy.reasoning,
        goals: strategy.goals,
        projectedProgress,
        warnings: strategy.warnings,
      },
      stats: {
        totalSessions: sessions.length,
        totalMinutes: sessions.reduce((sum, s) => sum + s.estimatedMinutes, 0),
        processingTimeMs: totalMs,
        coverageComplete,
        topicsCovered: allCoveredIds.size,
        topicsTotal: intelligence.topics.length,
      },
      errors,
    }
  } catch (err: any) {
    console.error('[Planner]', err.message)
    return {
      success: false,
      sessions: [],
      strategy: { reasoning: '', goals: [], projectedProgress: [], warnings: [] },
      stats: {
        totalSessions: 0,
        totalMinutes: 0,
        processingTimeMs: Date.now() - startTime,
        coverageComplete: false,
        topicsCovered: 0,
        topicsTotal: intelligence.topics.length,
      },
      errors: [err.message],
    }
  }
}
