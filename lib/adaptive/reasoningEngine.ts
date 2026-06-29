// ═══════════════════════════════════════════════════════════════
// StudyAL — Reasoning Engine
// NO usa plantillas fijas. NO usa switch/if cerrados.
// RAZONA qué necesita el estudiante AHORA y diseña la clase específica.
// ═══════════════════════════════════════════════════════════════

import type { MaterialTopic, MaterialBlueprint } from './blueprint'
import type { UserProfile } from './userProfile'
import type { LearningMemory } from './learningMemory'

// ═══════════════════════════════════════════════════════════════
// TEACHING INTENT — la INTENCIÓN pedagógica del momento
// (qué hay que lograr, no qué formato usar)
// ═══════════════════════════════════════════════════════════════
export type TeachingIntent =
  | 'create_intuition'      // El estudiante no tiene noción del tema
  | 'break_misconception'   // Tiene una idea equivocada, hay que desmontarla
  | 'build_recall'          // Sabe pero olvida, hay que anclar memoria
  | 'transfer_knowledge'    // Sabe en abstracto, falta aplicar
  | 'connect_to_known'      // Falta conectar con lo que ya sabe
  | 'deepen_understanding'  // Sabe lo básico, hay que profundizar
  | 'detect_blindspots'     // No sabe qué no sabe
  | 'consolidate_mastery'   // Casi domina, hay que cerrar
  | 'simulate_pressure'     // Preparar para condiciones reales
  | 'rebuild_from_zero'     // Falló todo, empezar de nuevo con otro ángulo

// ═══════════════════════════════════════════════════════════════
// CONTEXTO COMPLETO para razonar
// ═══════════════════════════════════════════════════════════════
export interface ReasoningContext {
  // Topic
  topic: MaterialTopic
  topicMastery: number              // 0-100 dominio actual del topic
  topicAttempts: number             // cuántas veces lo ha intentado
  recentFailures: number            // fallos en las últimas 3 sesiones

  // Material
  blueprint: MaterialBlueprint
  relatedDominatedTopics: string[]  // topics relacionados que ya domina
  relatedWeakTopics: string[]       // topics relacionados que están débiles

  // Estudiante
  userProfile: UserProfile | null
  learningMemory: LearningMemory | null

  // Estado
  weakConcepts: string[]
  criticalConcepts: string[]
  overallMastery: number

  // Contexto temporal
  daysToExam: number | null
  targetScore: number
  sessionNumber: number             // qué sesión es del programa
  totalSessions: number
  isFirstSessionEver: boolean       // primera sesión del estudiante con el material
  isFirstSessionForTopic: boolean

  // Última sesión
  lastSessionFormat?: string
  lastSessionScore?: number
}

// ═══════════════════════════════════════════════════════════════
// REASONING — decide la intención y razón detrás
// ═══════════════════════════════════════════════════════════════
export interface TeachingReasoning {
  intent: TeachingIntent
  reasoning: string                  // explicación humana de por qué esta intent
  priorityConcepts: string[]         // qué conceptos atacar específicamente
  avoidRepeating: string[]           // qué NO repetir (analogías ya usadas, etc.)

  // Variabilidad — para que dos sesiones nunca sean iguales
  sessionVariance: {
    openingStyle: 'question' | 'problem' | 'story' | 'scenario' | 'paradox' | 'data_point'
    explanationDepth: 'minimal' | 'moderate' | 'deep' | 'exhaustive'
    interactionFrequency: 'low' | 'medium' | 'high'  // qué tan seguido pregunta
    feedbackStyle: 'socratic' | 'direct' | 'exploratory'
    practiceIntensity: 'none' | 'light' | 'medium' | 'heavy'
    closeStyle: 'reflection' | 'summary' | 'preview' | 'celebration' | 'challenge'
  }

  // Mezcla flexible — la sesión puede combinar intenciones
  secondaryIntents: TeachingIntent[]
}

// ═══════════════════════════════════════════════════════════════
// REASONING REAL — usa señales múltiples, no ifs cerrados
// ═══════════════════════════════════════════════════════════════
export function reason(ctx: ReasoningContext): TeachingReasoning {
  const signals = collectSignals(ctx)
  const intent = inferPrimaryIntent(signals, ctx)
  const reasoning = explainIntent(intent, ctx, signals)
  const variance = designVariance(ctx, intent, signals)
  const secondary = inferSecondaryIntents(intent, signals, ctx)
  const priorityConcepts = pickPriorityConcepts(ctx, intent)
  const avoidRepeating = pickWhatToAvoid(ctx)

  return {
    intent,
    reasoning,
    priorityConcepts,
    avoidRepeating,
    sessionVariance: variance,
    secondaryIntents: secondary,
  }
}

// ── Recolectar señales del contexto ──────────────────────────
interface Signals {
  hasNoIdea: boolean
  hasFailedRepeatedly: boolean
  isUnderpressure: boolean
  isMemoryProblem: boolean
  isApplicationGap: boolean
  hasRelatedKnowledge: boolean
  isOverconfident: boolean
  isAlmostThere: boolean
  hasBlindspot: boolean
  needsFreshAngle: boolean
  topicIsCritical: boolean
}

function collectSignals(ctx: ReasoningContext): Signals {
  const lm = ctx.learningMemory

  return {
    hasNoIdea: ctx.topicMastery < 15 && ctx.topicAttempts === 0,
    hasFailedRepeatedly: ctx.recentFailures >= 2,
    isUnderpressure: ctx.daysToExam !== null && ctx.daysToExam <= 3,
    isMemoryProblem: (lm?.patterns?.includes('forgets_fast') ?? false) && ctx.topicMastery > 30 && ctx.topicMastery < 60,
    isApplicationGap: (lm?.patterns?.includes('struggles_with_application') ?? false) && ctx.topicMastery > 50,
    hasRelatedKnowledge: ctx.relatedDominatedTopics.length > 0,
    isOverconfident: (lm?.patterns?.includes('overconfident') ?? false) && ctx.topicMastery > 50,
    isAlmostThere: ctx.topicMastery >= 65 && ctx.topicMastery < 80,
    hasBlindspot: ctx.weakConcepts.length > 0 && ctx.topicMastery > 50,
    needsFreshAngle: ctx.lastSessionScore !== undefined && ctx.lastSessionScore < 50,
    topicIsCritical: (ctx.topic.importance ?? 50) >= 75 && (ctx.topic.difficulty ?? 50) >= 60,
  }
}

// ── Inferir intent primaria (combinación de señales, no if simple) ──
function inferPrimaryIntent(s: Signals, ctx: ReasoningContext): TeachingIntent {
  // Cada candidato tiene un "score" de probabilidad
  const candidates: Array<[TeachingIntent, number]> = []

  if (s.hasNoIdea) candidates.push(['create_intuition', 90])
  if (s.hasFailedRepeatedly && s.needsFreshAngle) candidates.push(['rebuild_from_zero', 85])
  if (s.hasFailedRepeatedly && !s.needsFreshAngle) candidates.push(['break_misconception', 75])
  if (s.isMemoryProblem) candidates.push(['build_recall', 70])
  if (s.isApplicationGap) candidates.push(['transfer_knowledge', 75])
  if (s.hasRelatedKnowledge && ctx.isFirstSessionForTopic) candidates.push(['connect_to_known', 65])
  if (s.isOverconfident) candidates.push(['detect_blindspots', 80])
  if (s.isAlmostThere) candidates.push(['consolidate_mastery', 70])
  if (s.isUnderpressure && ctx.topicMastery > 40) candidates.push(['simulate_pressure', 80])
  if (s.topicIsCritical && ctx.topicMastery > 30 && ctx.topicMastery < 70) candidates.push(['deepen_understanding', 65])
  if (s.hasBlindspot) candidates.push(['detect_blindspots', 60])

  // Si no hay candidatos fuertes, default razonable
  if (candidates.length === 0) {
    return ctx.isFirstSessionForTopic ? 'create_intuition' : 'consolidate_mastery'
  }

  // Ordenar por score y agregar variabilidad aleatoria pequeña para que no siempre gane lo mismo
  candidates.sort((a, b) => {
    const noise = (Math.random() - 0.5) * 10  // ±5 puntos de variabilidad
    return (b[1] + noise) - (a[1] + noise)
  })

  return candidates[0][0]
}

// ── Explicar por qué se eligió esa intent (visible al usuario) ──
function explainIntent(intent: TeachingIntent, ctx: ReasoningContext, s: Signals): string {
  const topicName = ctx.topic.title
  const explanations: Record<TeachingIntent, string> = {
    create_intuition: `Es la primera vez que ves "${topicName}". Hoy quiero que sientas el tema antes de definirlo.`,
    break_misconception: `Has fallado en "${topicName}" varias veces. Hay una idea equivocada que necesitamos desmontar.`,
    build_recall: `Ya entiendes "${topicName}", pero se te olvida. Hoy lo anclamos en memoria.`,
    transfer_knowledge: `Sabes la teoría de "${topicName}" pero te cuesta aplicarla. Hoy practicamos con casos reales.`,
    connect_to_known: `Ya dominas conceptos relacionados. Hoy conectamos "${topicName}" con lo que ya sabes.`,
    deepen_understanding: `Tienes lo básico de "${topicName}", pero es un tema importante. Hoy profundizamos.`,
    detect_blindspots: `Crees que dominas "${topicName}", pero hay puntos ciegos. Hoy los detectamos.`,
    consolidate_mastery: `Estás cerca de dominar "${topicName}". Hoy cerramos los detalles que faltan.`,
    simulate_pressure: `Tu examen está cerca. Hoy simulamos cómo te irá con "${topicName}" bajo presión.`,
    rebuild_from_zero: `Lo que intentamos en "${topicName}" no funcionó. Hoy empezamos de cero con otro ángulo.`,
  }
  return explanations[intent] || `Trabajamos "${topicName}" según tu estado actual.`
}

// ── Diseñar variabilidad — para que dos sesiones nunca sean iguales ──
function designVariance(
  ctx: ReasoningContext,
  intent: TeachingIntent,
  s: Signals,
): TeachingReasoning['sessionVariance'] {
  // Pool de opciones por intent (no fijo — se mezclan)
  const openings: Record<TeachingIntent, Array<TeachingReasoning['sessionVariance']['openingStyle']>> = {
    create_intuition: ['story', 'paradox', 'scenario'],
    break_misconception: ['paradox', 'data_point', 'question'],
    build_recall: ['question', 'scenario'],
    transfer_knowledge: ['problem', 'scenario'],
    connect_to_known: ['question', 'story'],
    deepen_understanding: ['paradox', 'data_point', 'problem'],
    detect_blindspots: ['question', 'paradox'],
    consolidate_mastery: ['data_point', 'scenario'],
    simulate_pressure: ['problem', 'scenario'],
    rebuild_from_zero: ['story', 'question'],
  }

  // Pickear con algo de aleatoriedad para evitar repetición
  const pickRandom = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

  const openingPool = openings[intent] || (['question'] as Array<TeachingReasoning['sessionVariance']['openingStyle']>)
  const openingStyle = pickRandom(openingPool)

  // Profundidad: depende de tiempo + dominio
  const explanationDepth: TeachingReasoning['sessionVariance']['explanationDepth'] =
    s.isUnderpressure ? 'minimal'
    : ctx.topicMastery < 30 ? 'deep'
    : ctx.topicMastery < 60 ? 'moderate'
    : 'minimal'

  // Frecuencia de interacción
  const interactionFrequency: TeachingReasoning['sessionVariance']['interactionFrequency'] =
    intent === 'detect_blindspots' || intent === 'simulate_pressure' ? 'high'
    : intent === 'create_intuition' || intent === 'connect_to_known' ? 'low'
    : 'medium'

  // Feedback style
  const feedbackStyle: TeachingReasoning['sessionVariance']['feedbackStyle'] =
    intent === 'detect_blindspots' || intent === 'break_misconception' ? 'socratic'
    : intent === 'simulate_pressure' || s.isUnderpressure ? 'direct'
    : 'exploratory'

  // Práctica
  const practiceIntensity: TeachingReasoning['sessionVariance']['practiceIntensity'] =
    intent === 'simulate_pressure' ? 'heavy'
    : intent === 'transfer_knowledge' || intent === 'build_recall' ? 'medium'
    : intent === 'create_intuition' ? 'none'
    : 'light'

  // Cierre
  const closeOptions: TeachingReasoning['sessionVariance']['closeStyle'][] =
    intent === 'create_intuition' ? ['reflection', 'preview']
    : intent === 'consolidate_mastery' ? ['celebration', 'challenge']
    : intent === 'simulate_pressure' ? ['summary', 'challenge']
    : ['summary', 'preview', 'reflection']

  const closeStyle = pickRandom(closeOptions)

  return {
    openingStyle,
    explanationDepth,
    interactionFrequency,
    feedbackStyle,
    practiceIntensity,
    closeStyle,
  }
}

// ── Intenciones secundarias — para mezclar formatos ──────────
function inferSecondaryIntents(
  primary: TeachingIntent,
  s: Signals,
  ctx: ReasoningContext,
): TeachingIntent[] {
  const secondaries: TeachingIntent[] = []

  // Si la sesión es larga, puede incluir múltiples intents
  if (ctx.topic.estimatedMinutes && ctx.topic.estimatedMinutes >= 20) {
    if (primary === 'create_intuition' && s.hasRelatedKnowledge) {
      secondaries.push('connect_to_known')
    }
    if (primary === 'deepen_understanding') {
      secondaries.push('transfer_knowledge')
    }
    if (primary === 'transfer_knowledge' && s.isUnderpressure) {
      secondaries.push('simulate_pressure')
    }
    if (primary === 'consolidate_mastery') {
      secondaries.push('detect_blindspots')
    }
  }

  return secondaries
}

// ── Conceptos prioritarios según intent ──────────────────────
function pickPriorityConcepts(ctx: ReasoningContext, intent: TeachingIntent): string[] {
  // Si la intent requiere atacar puntos ciegos → weak/critical primero
  if (intent === 'detect_blindspots' || intent === 'break_misconception') {
    return [...ctx.criticalConcepts, ...ctx.weakConcepts].slice(0, 3)
  }

  // Si es para anclar memoria → los conceptos que el estudiante ha tocado pero olvida
  if (intent === 'build_recall') {
    return ctx.weakConcepts.slice(0, 4)
  }

  // Si es aplicación → conceptos centrales del topic
  if (intent === 'transfer_knowledge' || intent === 'simulate_pressure') {
    return (ctx.topic.concepts || [])
      .filter(c => c.importance === 'critical' || c.importance === 'major')
      .map(c => c.name)
      .slice(0, 4)
  }

  // Default: top conceptos del topic
  return (ctx.topic.concepts || []).map(c => c.name).slice(0, 4)
}

// ── Qué evitar — para no repetir analogías o ángulos ─────────
function pickWhatToAvoid(ctx: ReasoningContext): string[] {
  const avoid: string[] = []

  // Si la última sesión fue de cierto formato, evitar repetir
  if (ctx.lastSessionFormat) {
    avoid.push(`No uses el mismo formato que la sesión pasada (${ctx.lastSessionFormat})`)
  }

  // Si pertenece a un topic ya intentado, evitar las mismas analogías
  if (ctx.topicAttempts > 0) {
    avoid.push('No uses la misma analogía o ejemplo de intentos anteriores')
  }

  // Si falló recientemente, cambiar de ángulo
  if (ctx.recentFailures > 0) {
    avoid.push('No expliques igual que antes — usa un ángulo completamente distinto')
  }

  return avoid
}

// ═══════════════════════════════════════════════════════════════
// LESSON DESIGNER — convierte reasoning en prompt específico
// (no usa plantillas — construye el prompt según el reasoning)
// ═══════════════════════════════════════════════════════════════
export function designLessonPrompt(params: {
  reasoning: TeachingReasoning
  ctx: ReasoningContext
  materialSlice: string
}): string {
  const { reasoning, ctx, materialSlice } = params
  const { intent, reasoning: why, priorityConcepts, avoidRepeating, sessionVariance, secondaryIntents } = reasoning

  // ── Construir instrucciones según variance ────────────────
  const openingInstruction = describeOpening(sessionVariance.openingStyle, ctx.topic.title)
  const depthInstruction = describeDepth(sessionVariance.explanationDepth)
  const interactionInstruction = describeInteraction(sessionVariance.interactionFrequency)
  const feedbackInstruction = describeFeedback(sessionVariance.feedbackStyle)
  const closeInstruction = describeClose(sessionVariance.closeStyle)

  // ── Perfil del estudiante en lenguaje humano ──────────────
  const studentDescription = describeStudent(ctx.userProfile, ctx.learningMemory)

  // ── Intent secundarias agregan capas ──────────────────────
  const secondaryNote = secondaryIntents.length > 0
    ? `\nAdemás de "${intent}", esta sesión debe incluir elementos de: ${secondaryIntents.join(', ')}.`
    : ''

  return `Eres ALAI, un profesor que RAZONA antes de enseñar.

═══ TU ANÁLISIS DEL ESTUDIANTE ═══
${studentDescription}

═══ TU DECISIÓN PEDAGÓGICA ═══
Para este estudiante en este momento, decidiste que la intención de hoy es:
"${intent}"

Razón: ${why}
${secondaryNote}

═══ DISEÑO DE ESTA SESIÓN ESPECÍFICA ═══
Apertura: ${openingInstruction}
Profundidad: ${depthInstruction}
Interacción: ${interactionInstruction}
Feedback: ${feedbackInstruction}
Cierre: ${closeInstruction}

Conceptos a atacar HOY: ${priorityConcepts.join(', ')}

${avoidRepeating.length > 0 ? `NUNCA HAGAS:\n${avoidRepeating.map(a => '- ' + a).join('\n')}` : ''}

═══ TOPIC ═══
"${ctx.topic.title}"
Dificultad: ${ctx.topic.difficulty}/100 · Importancia: ${ctx.topic.importance}/100
Estado del estudiante con este topic: ${ctx.topicMastery}/100

═══ MATERIAL ═══
${materialSlice.slice(0, 4000)}

═══ INSTRUCCIONES FINALES ═══

NO sigas una plantilla. DISEÑA esta clase específicamente para este momento.

Devuelve SOLO JSON con esta estructura:

{
  "intentDeclaration": "Una frase que el estudiante vea: 'Hoy decidí enfocarnos en X porque Y'",
  "hook": "Apertura según el estilo definido arriba (${sessionVariance.openingStyle})",
  "sessionGoal": "Si al terminar puedes responder esto, la sesión valió: [pregunta concreta]",
  "explanationBlocks": [
    {
      "title": "...",
      "content": "...",
      "analogy": "opcional",
      "example": "opcional",
      "interactionPoint": "opcional — pregunta breve para que el estudiante piense"
    }
  ],
  "checkpoints": [
    {
      "question": "Pregunta que NACE de la explicación, no genérica",
      "questionType": "open_essay | multiple_choice | apply_scenario | predict_outcome | explain_why | find_error | compare_two | fill_blank",
      "expectedIdea": "qué debería contener una buena respuesta",
      "feedbackIfWrong": "respuesta empática si falla",
      "alternativeExplanation": "explicación con OTRO ángulo si falla"
    }
  ],
  "closing": "Cierre según el estilo definido (${sessionVariance.closeStyle})",
  "nextStepHint": "Una pista de qué viene después y por qué"
}

REGLAS:
- El número de explanationBlocks depende de la profundidad (${sessionVariance.explanationDepth}): minimal=1, moderate=2, deep=3, exhaustive=4
- El número de checkpoints depende de la interacción (${sessionVariance.interactionFrequency}): low=1, medium=2, high=3
- VARÍA los questionType en los checkpoints — no uses siempre el mismo
- NO empieces con "Hoy veremos..."
- NO uses asteriscos markdown excesivos
- Sé conversacional, no robótico`
}

// ── Descripciones humanas para el prompt ─────────────────────
function describeOpening(style: string, topic: string): string {
  const map: Record<string, string> = {
    question: `Una pregunta abierta que haga pensar antes de saber la respuesta`,
    problem: `Un problema concreto que el estudiante quiera resolver`,
    story: `Una historia corta que contextualice "${topic}"`,
    scenario: `Un escenario real donde "${topic}" aparezca`,
    paradox: `Una paradoja o contradicción aparente sobre "${topic}"`,
    data_point: `Un dato sorprendente que motive la curiosidad`,
  }
  return map[style] || map.question
}

function describeDepth(depth: string): string {
  const map: Record<string, string> = {
    minimal: 'Solo lo esencial. 1 bloque corto.',
    moderate: '2 bloques. Construir comprensión sin sobrecargar.',
    deep: '3 bloques. Profundidad con analogías y ejemplos.',
    exhaustive: '4 bloques. Cobertura completa con conexiones.',
  }
  return map[depth] || map.moderate
}

function describeInteraction(freq: string): string {
  const map: Record<string, string> = {
    low: 'Una sola pregunta al final. Deja al estudiante absorber.',
    medium: 'Una pregunta cada bloque o dos. Verifica comprensión.',
    high: 'Pregunta constantemente. Diálogo activo.',
  }
  return map[freq] || map.medium
}

function describeFeedback(style: string): string {
  const map: Record<string, string> = {
    socratic: 'No des respuestas directas. Haz preguntas que lleven al estudiante a descubrir.',
    direct: 'Sé claro y directo. Di qué está bien y qué está mal.',
    exploratory: 'Reconoce lo que entendió y explora juntos lo que falta.',
  }
  return map[style] || map.exploratory
}

function describeClose(style: string): string {
  const map: Record<string, string> = {
    reflection: 'Pide al estudiante reflexionar sobre lo aprendido.',
    summary: 'Resume las ideas clave en 2-3 frases.',
    preview: 'Conecta con lo que viene en la próxima sesión.',
    celebration: 'Reconoce el avance real del estudiante.',
    challenge: 'Lanza un reto que pueda intentar después.',
  }
  return map[style] || map.summary
}

function describeStudent(profile: UserProfile | null, memory: LearningMemory | null): string {
  const parts: string[] = []

  if (profile?.carrera) parts.push(`Estudia ${profile.carrera}`)
  if (profile?.tipoEstudiante) parts.push(`Nivel: ${profile.tipoEstudiante}`)
  if (profile?.objetivo) parts.push(`Su objetivo: ${profile.objetivo}`)

  if (memory && memory.styleConfidence > 30) {
    parts.push(`Aprende mejor así: ${memory.learningStyle}`)
    if (memory.patterns?.length) {
      parts.push(`Patrones detectados: ${memory.patterns.slice(0, 3).join(', ')}`)
    }
  }

  if (parts.length === 0) return 'Estudiante general, sin datos detallados todavía.'
  return parts.join('. ')
}
