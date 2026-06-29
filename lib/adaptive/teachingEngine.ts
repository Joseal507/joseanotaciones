// ═══════════════════════════════════════════════════════════════
// StudyAL — Teaching Engine
// Convierte topics/conceptos/mastery/perfil en CLASES guiadas,
// no en secuencias de prompts.
// ═══════════════════════════════════════════════════════════════

import type { MaterialBlueprint, MaterialTopic } from './blueprint'
import type { UserProfile } from './userProfile'
import type { LearningMemory } from './learningMemory'

// ── Plan pedagógico global ───────────────────────────────────
export interface TeachingPlan {
  mainObjective: string
  studentProfileSummary: string
  teachingStyle: 'storytelling' | 'problem_first' | 'definition_first' | 'analogy_heavy' | 'exam_focused'
  difficultyLevel: 'intro' | 'normal' | 'advanced' | 'exam_ready'
  pacing: 'slow' | 'normal' | 'fast' | 'emergency'
  sessionTone: 'conversacional' | 'directo' | 'motivacional' | 'tecnico'
  firstTopicReason: string
  avoidDoing: string[]
  mustDo: string[]
}

// ── Mini clase estructurada que devuelve /api/adaptive/explain ──
export interface MiniLesson {
  hook: string                      // Pregunta o situación que engancha
  sessionGoal: string               // Si al terminar puedes responder X, valió la pena
  whyItMatters: string              // Por qué este tema importa AHORA
  priorKnowledgeBridge: string      // Conexión con lo que ya sabe
  explanationBlocks: ExplanationBlock[]
  firstCheckpoint: Checkpoint
  closingSummary: string
  nextStepReason: string
}

export interface ExplanationBlock {
  title: string
  content: string
  analogy?: string
  example?: string
  checkQuestion?: string  // Pregunta opcional al final del bloque
}

export interface Checkpoint {
  question: string
  expectedIdea: string
  feedbackIfWrong: string
  alternativeExplanation?: string
}

// ═══════════════════════════════════════════════════════════════
// CONSTRUIR TEACHING PLAN antes de generar sesiones
// ═══════════════════════════════════════════════════════════════
export function buildTeachingPlan(params: {
  blueprint: MaterialBlueprint
  userProfile: UserProfile | null
  learningMemory: LearningMemory | null
  daysToExam: number | null
  targetScore: number
  dailyMinutes: number
}): TeachingPlan {
  const { blueprint, userProfile, learningMemory, daysToExam, targetScore, dailyMinutes } = params

  // ── Pacing según urgencia ────────────────────────────────
  let pacing: TeachingPlan['pacing'] = 'normal'
  if (daysToExam !== null) {
    if (daysToExam <= 1) pacing = 'emergency'
    else if (daysToExam <= 3) pacing = 'fast'
    else if (daysToExam > 14) pacing = 'slow'
  }

  // ── Difficulty según objetivo y nivel ────────────────────
  let difficultyLevel: TeachingPlan['difficultyLevel'] = 'normal'
  if (targetScore >= 90) difficultyLevel = 'exam_ready'
  else if (userProfile?.academicLevel === 'avanzado') difficultyLevel = 'advanced'
  else if (userProfile?.academicLevel === 'basico') difficultyLevel = 'intro'

  // ── Teaching style según learning memory + perfil ────────
  let teachingStyle: TeachingPlan['teachingStyle'] = 'storytelling'

  if (learningMemory?.styleConfidence && learningMemory.styleConfidence > 30) {
    switch (learningMemory.learningStyle) {
      case 'practice_first':
        teachingStyle = 'problem_first'; break
      case 'memory_first':
        teachingStyle = 'definition_first'; break
      case 'visual_first':
        teachingStyle = 'analogy_heavy'; break
      case 'explanation_first':
        teachingStyle = 'storytelling'; break
    }
  }

  // Si tiene examen pronto, override
  if (pacing === 'emergency' || pacing === 'fast') {
    teachingStyle = 'exam_focused'
  }

  // ── Tono según contexto ──────────────────────────────────
  let sessionTone: TeachingPlan['sessionTone'] = 'conversacional'
  if (pacing === 'emergency') sessionTone = 'directo'
  else if (userProfile?.academicLevel === 'avanzado') sessionTone = 'tecnico'
  else if (userProfile?.studyContext === 'exam_prep') sessionTone = 'motivacional'

  // ── Resumen del perfil para el prompt ────────────────────
  const profileParts: string[] = []
  if (userProfile?.carrera) profileParts.push(`carrera: ${userProfile.carrera}`)
  if (userProfile?.tipoEstudiante) profileParts.push(`nivel: ${userProfile.tipoEstudiante}`)
  if (userProfile?.objetivo) profileParts.push(`objetivo: ${userProfile.objetivo}`)
  if (learningMemory?.learningStyle && learningMemory.learningStyle !== 'unknown') {
    profileParts.push(`aprende mejor: ${learningMemory.learningStyle}`)
  }
  if (learningMemory?.patterns?.length) {
    profileParts.push(`patrones: ${learningMemory.patterns.slice(0, 3).join(', ')}`)
  }

  const studentProfileSummary = profileParts.length > 0
    ? profileParts.join(' | ')
    : 'sin perfil detallado todavía'

  // ── Objetivo principal ───────────────────────────────────
  const mainObjective = daysToExam !== null && daysToExam <= 7
    ? `Aprobar el examen con ${targetScore}% en ${daysToExam} días`
    : userProfile?.objetivo || `Dominar el material al ${targetScore}%`

  // ── Razón del primer topic ───────────────────────────────
  const firstTopic = blueprint.topics[0]
  const firstTopicReason = firstTopic
    ? buildFirstTopicReason(firstTopic, pacing, userProfile)
    : 'Empezamos por el tema más importante'

  // ── Reglas de qué hacer y qué evitar ─────────────────────
  const avoidDoing: string[] = []
  const mustDo: string[] = []

  if (teachingStyle === 'problem_first') {
    avoidDoing.push('Empezar con definiciones')
    mustDo.push('Empezar con un problema o situación')
  }
  if (teachingStyle === 'analogy_heavy') {
    mustDo.push('Usar al menos 1 analogía concreta por bloque')
  }
  if (teachingStyle === 'exam_focused') {
    mustDo.push('Priorizar conceptos con alta probabilidad de examen')
    avoidDoing.push('Contenido tangencial o curiosidades')
  }
  if (pacing === 'slow') {
    mustDo.push('Construir comprensión profunda antes de evaluar')
  }
  if (pacing === 'emergency') {
    mustDo.push('Ir directo a lo esencial, sin preámbulos')
    avoidDoing.push('Explicaciones largas')
  }
  if (userProfile?.academicLevel === 'basico') {
    mustDo.push('Usar lenguaje simple, evitar tecnicismos')
  }
  if (userProfile?.carrera) {
    mustDo.push(`Conectar con la carrera del estudiante: ${userProfile.carrera}`)
  }

  return {
    mainObjective,
    studentProfileSummary,
    teachingStyle,
    difficultyLevel,
    pacing,
    sessionTone,
    firstTopicReason,
    avoidDoing,
    mustDo,
  }
}

function buildFirstTopicReason(
  topic: MaterialTopic,
  pacing: TeachingPlan['pacing'],
  profile: UserProfile | null,
): string {
  const reasons: string[] = []

  if ((topic.importance ?? 50) >= 80) {
    reasons.push('es el tema más importante del material')
  }
  if (!topic.prerequisites || topic.prerequisites.length === 0) {
    reasons.push('no depende de otros temas, es la base')
  }
  if (pacing === 'emergency' || pacing === 'fast') {
    reasons.push('tu examen está cerca y este tema tiene alta probabilidad')
  }
  if ((topic.difficulty ?? 50) >= 70) {
    reasons.push('es complejo, mejor empezarlo cuando tienes energía')
  }

  if (reasons.length === 0) {
    return `Empezamos con "${topic.title}" para construir bases sólidas.`
  }

  return `Empezamos con "${topic.title}" porque ${reasons.slice(0, 2).join(' y ')}.`
}

// ═══════════════════════════════════════════════════════════════
// PROMPT MAESTRO para /api/adaptive/explain
// Convierte el TeachingPlan + topic en una mini clase real
// ═══════════════════════════════════════════════════════════════
export function buildLessonPrompt(params: {
  topic: MaterialTopic
  plan: TeachingPlan
  materialSlice: string
  targetConcepts: string[]
  weakConcepts: string[]
  isFirstSession: boolean
  previousTopic?: string
}): string {
  const { topic, plan, materialSlice, targetConcepts, weakConcepts, isFirstSession, previousTopic } = params

  const styleInstructions = {
    storytelling: 'Empieza con una historia, situación o analogía. No con definiciones.',
    problem_first: 'Empieza con un problema concreto. Que el estudiante sienta la necesidad antes de la teoría.',
    definition_first: 'Estructura clara: definición → ejemplo → aplicación. Pero siempre con un hook al inicio.',
    analogy_heavy: 'Cada concepto debe tener al menos una analogía visual concreta.',
    exam_focused: 'Directo al grano. Prioriza lo que aparece en exámenes. Incluye trampas comunes.',
  }[plan.teachingStyle]

  const toneInstructions = {
    conversacional: 'Tono cercano, como un amigo que sabe del tema. Tutéalo.',
    directo: 'Sin rodeos. Frases cortas. Solo lo esencial.',
    motivacional: 'Reconoce el esfuerzo. Refuerza que está cerca del objetivo.',
    tecnico: 'Usa terminología precisa. Asume nivel avanzado.',
  }[plan.sessionTone]

  const continuityNote = isFirstSession
    ? 'Esta es la PRIMERA sesión. Da una bienvenida cálida y explica por qué empezamos aquí.'
    : previousTopic
      ? `El estudiante viene de estudiar "${previousTopic}". Conecta con ese conocimiento.`
      : 'Continúa el flujo natural de aprendizaje.'

  return `Eres ALAI, un PROFESOR EXCELENTE (no un generador de contenido).

Vas a construir UNA MINI CLASE COMPLETA sobre "${topic.title}".

═══ CONTEXTO DEL ESTUDIANTE ═══
${plan.studentProfileSummary}
Objetivo: ${plan.mainObjective}
Tu estilo enseñando: ${plan.teachingStyle}
Tono: ${plan.sessionTone}
Ritmo: ${plan.pacing}

═══ INSTRUCCIONES DE PEDAGOGÍA ═══
${styleInstructions}
${toneInstructions}
${continuityNote}

DEBES:
${plan.mustDo.map(d => '- ' + d).join('\n')}

NUNCA:
${plan.avoidDoing.map(d => '- ' + d).join('\n')}

═══ TEMA DE HOY ═══
Topic: ${topic.title}
Conceptos objetivo: ${targetConcepts.join(', ')}
${weakConcepts.length > 0 ? `Conceptos débiles del estudiante: ${weakConcepts.join(', ')} (refuerza estos)` : ''}

═══ MATERIAL DE REFERENCIA ═══
${materialSlice.slice(0, 4000)}

═══ ESTRUCTURA OBLIGATORIA DE LA MINI CLASE ═══

Devuelve SOLO JSON con esta estructura exacta:

{
  "hook": "Una pregunta, problema o situación INICIAL que enganche al estudiante. NO empieces con 'Hoy veremos...' o '${topic.title} es...'. Ejemplo bueno: 'Imagina que tu célula necesita energía y solo tiene 30 segundos. ¿Qué haría?'",

  "sessionGoal": "Frase tipo: 'Si al terminar puedes responder ESTA pregunta, la sesión valió la pena: [pregunta concreta]'",

  "whyItMatters": "Por qué este tema importa AHORA para este estudiante específicamente. Conecta con su carrera/objetivo si aplica.",

  "priorKnowledgeBridge": "Conecta con algo que probablemente ya sabe. Una frase puente.",

  "explanationBlocks": [
    {
      "title": "Título del bloque (corto, claro)",
      "content": "Explicación de 2-4 párrafos. Conversacional. Usa el material como fuente.",
      "analogy": "Analogía concreta opcional",
      "example": "Ejemplo específico del material",
      "checkQuestion": "Pregunta opcional al final que invite a pensar (no a memorizar)"
    }
  ],

  "firstCheckpoint": {
    "question": "Una pregunta que NACE de lo que se acaba de explicar. Que obligue a PENSAR, no a recordar.",
    "expectedIdea": "Qué idea central debería contener una buena respuesta (para evaluación)",
    "feedbackIfWrong": "Mensaje empático si falla: 'Te fuiste por X, pero la clave aquí es Y'",
    "alternativeExplanation": "Si falla, una explicación con otro ángulo (analogía distinta, ejemplo diferente)"
  },

  "closingSummary": "Cierre de 2-3 frases. Reconoce el progreso. Conecta con lo siguiente.",

  "nextStepReason": "Por qué la siguiente sesión es la lógica continuación."
}

REGLAS CRÍTICAS:
- NO uses asteriscos markdown excepto **negritas** muy esporádicas
- NO empieces con "En esta sesión vamos a..."
- NO uses frases robóticas tipo "es importante destacar que..."
- SÍ usa segunda persona ("tú", "tu célula", "imagínate")
- SÍ construye la pregunta del checkpoint DESDE la explicación, no aparte
- SÍ haz que se sienta como una conversación con un profesor real

Genera SOLO el JSON, sin texto adicional.`
}


// ═══════════════════════════════════════════════════════════════
// FORMATO DE SESIÓN — decide cómo enseñar según topic + perfil
// ═══════════════════════════════════════════════════════════════

export type SessionFormat =
  | 'discovery'        // Topic nuevo y conceptual → hook + clase guiada + checkpoint abierto
  | 'practice_drill'   // Topic ya entendido pero débil → mucho quiz rápido, poca teoría
  | 'deep_dive'        // Topic difícil e importante → clase larga + múltiples ejemplos + reflexión
  | 'rapid_review'     // Topic ya dominado, solo refresh → 1 resumen + 3 preguntas rápidas
  | 'exam_simulation'  // Cerca del examen → solo preguntas tipo examen + feedback
  | 'repair_dialogue'  // Falló repetido → conversación 1-a-1 sobre el error
  | 'application'      // Conceptos sabidos, falta aplicar → casos reales + análisis
  | 'memorization'     // Mucho que memorizar → flashcards + recall + spaced repetition

export type QuestionType =
  | 'open_essay'       // Pregunta abierta de desarrollo
  | 'multiple_choice'  // Opción múltiple clásica
  | 'true_false'       // Verdadero/falso con justificación
  | 'fill_blank'       // Completar palabra clave
  | 'match_concept'    // Asociar concepto con definición
  | 'order_steps'      // Ordenar pasos de un proceso
  | 'compare_two'      // Comparar/contrastar dos cosas
  | 'predict_outcome'  // "¿Qué pasaría si...?"
  | 'apply_scenario'   // Caso real para resolver
  | 'find_error'       // Detectar el error en un razonamiento
  | 'explain_why'      // Justificar el porqué de algo

// ── Decidir formato de sesión según contexto ─────────────────
export function decideSessionFormat(params: {
  topic: MaterialTopic
  topicScore: number              // 0-100 dominio actual del topic
  sessionPurpose: string          // understand/memorize/apply/simulate/repair
  daysToExam: number | null
  hasFailedBefore: boolean
  isFirstTimeWithTopic: boolean
  userProfile: UserProfile | null
  learningMemory: LearningMemory | null
}): SessionFormat {
  const {
    topic, topicScore, sessionPurpose, daysToExam,
    hasFailedBefore, isFirstTimeWithTopic, userProfile, learningMemory,
  } = params

  // ── Reglas en orden de prioridad ──────────────────────────

  // 1. Examen inminente → simular
  if (daysToExam !== null && daysToExam <= 2) {
    return 'exam_simulation'
  }

  // 2. Falló múltiples veces → diálogo de reparación
  if (hasFailedBefore && topicScore < 30) {
    return 'repair_dialogue'
  }

  // 3. Topic dominado pero hay que refrescarlo
  if (topicScore >= 75 && sessionPurpose !== 'simulate') {
    return 'rapid_review'
  }

  // 4. Primera vez con el topic
  if (isFirstTimeWithTopic) {
    // Topic difícil e importante → deep dive
    if ((topic.difficulty ?? 50) >= 70 && (topic.importance ?? 50) >= 70) {
      return 'deep_dive'
    }
    // Topic con muchos conceptos a memorizar
    if ((topic.concepts?.length ?? 0) >= 5 && (topic.practiceNeeds ?? []).includes('memorize')) {
      return 'memorization'
    }
    return 'discovery'
  }

  // 5. Sesión de práctica (ya entiende, falta práctica)
  if (sessionPurpose === 'apply') {
    return 'application'
  }

  // 6. Memoria débil → drill de práctica
  if (topicScore < 50 && learningMemory?.patterns?.includes('forgets_fast')) {
    return 'practice_drill'
  }

  // 7. Aplicación débil
  if (sessionPurpose === 'apply' || learningMemory?.patterns?.includes('struggles_with_application')) {
    return 'application'
  }

  // 8. Memorize purpose
  if (sessionPurpose === 'memorize') {
    return 'memorization'
  }

  // 9. Default
  return 'discovery'
}

// ── Tipos de pregunta según formato + topic ──────────────────
export function pickQuestionTypes(format: SessionFormat, topic: MaterialTopic): QuestionType[] {
  switch (format) {
    case 'discovery':
      return ['explain_why', 'predict_outcome', 'open_essay']
    case 'practice_drill':
      return ['multiple_choice', 'true_false', 'fill_blank']
    case 'deep_dive':
      return ['explain_why', 'compare_two', 'apply_scenario', 'predict_outcome']
    case 'rapid_review':
      return ['multiple_choice', 'true_false', 'fill_blank']
    case 'exam_simulation':
      return ['multiple_choice', 'apply_scenario', 'find_error', 'explain_why']
    case 'repair_dialogue':
      return ['explain_why', 'find_error', 'open_essay']
    case 'application':
      return ['apply_scenario', 'predict_outcome', 'compare_two']
    case 'memorization':
      return ['fill_blank', 'match_concept', 'order_steps', 'multiple_choice']
    default:
      return ['multiple_choice', 'explain_why']
  }
}

// ── Estructura de la sesión según formato ────────────────────
export interface SessionStructure {
  format: SessionFormat
  stages: SessionStage[]
  estimatedMinutes: number
  difficulty: number
}

export type SessionStage =
  | { type: 'hook'; instruction: string }
  | { type: 'goal'; goal: string }
  | { type: 'explanation'; depth: 'brief' | 'normal' | 'deep' }
  | { type: 'analogy' }
  | { type: 'example_real' }
  | { type: 'check_understanding'; questionType: QuestionType }
  | { type: 'practice_round'; questionType: QuestionType; count: number }
  | { type: 'reflection' }
  | { type: 'application_case' }
  | { type: 'review_summary' }
  | { type: 'next_step_preview' }

export function buildSessionStructure(
  format: SessionFormat,
  topic: MaterialTopic,
  estimatedMinutes: number = 20,
): SessionStructure {
  const questionTypes = pickQuestionTypes(format, topic)
  const stages: SessionStage[] = []

  switch (format) {
    case 'discovery':
      stages.push(
        { type: 'hook', instruction: 'Pregunta o situación que despierte curiosidad' },
        { type: 'goal', goal: 'Entender la idea central del topic' },
        { type: 'explanation', depth: 'normal' },
        { type: 'analogy' },
        { type: 'check_understanding', questionType: questionTypes[0] },
        { type: 'example_real' },
        { type: 'review_summary' },
      )
      break

    case 'practice_drill':
      stages.push(
        { type: 'goal', goal: 'Reforzar lo que ya empiezas a saber con práctica intensa' },
        { type: 'practice_round', questionType: 'multiple_choice', count: 5 },
        { type: 'practice_round', questionType: 'fill_blank', count: 3 },
        { type: 'review_summary' },
      )
      break

    case 'deep_dive':
      stages.push(
        { type: 'hook', instruction: 'Problema complejo o paradoja del topic' },
        { type: 'goal', goal: 'Dominar a profundidad este topic crítico' },
        { type: 'explanation', depth: 'deep' },
        { type: 'analogy' },
        { type: 'example_real' },
        { type: 'check_understanding', questionType: 'explain_why' },
        { type: 'application_case' },
        { type: 'reflection' },
        { type: 'review_summary' },
        { type: 'next_step_preview' },
      )
      break

    case 'rapid_review':
      stages.push(
        { type: 'review_summary' },
        { type: 'practice_round', questionType: 'multiple_choice', count: 3 },
      )
      break

    case 'exam_simulation':
      stages.push(
        { type: 'goal', goal: 'Simular condiciones de examen real' },
        { type: 'practice_round', questionType: 'multiple_choice', count: 4 },
        { type: 'practice_round', questionType: 'apply_scenario', count: 2 },
        { type: 'review_summary' },
      )
      break

    case 'repair_dialogue':
      stages.push(
        { type: 'goal', goal: 'Identificar y reparar exactamente dónde se rompe tu comprensión' },
        { type: 'check_understanding', questionType: 'explain_why' },
        { type: 'explanation', depth: 'normal' },
        { type: 'analogy' },
        { type: 'check_understanding', questionType: 'find_error' },
        { type: 'review_summary' },
      )
      break

    case 'application':
      stages.push(
        { type: 'goal', goal: 'Aplicar lo que sabes a casos reales' },
        { type: 'application_case' },
        { type: 'check_understanding', questionType: 'apply_scenario' },
        { type: 'application_case' },
        { type: 'reflection' },
      )
      break

    case 'memorization':
      stages.push(
        { type: 'goal', goal: 'Anclar los conceptos en memoria a largo plazo' },
        { type: 'explanation', depth: 'brief' },
        { type: 'practice_round', questionType: 'fill_blank', count: 4 },
        { type: 'practice_round', questionType: 'match_concept', count: 3 },
        { type: 'review_summary' },
      )
      break
  }

  // Calcular dificultad sugerida
  const difficulty = format === 'exam_simulation' ? 75
    : format === 'deep_dive' ? 70
    : format === 'rapid_review' ? 40
    : format === 'memorization' ? 50
    : 60

  return { format, stages, estimatedMinutes, difficulty }
}
