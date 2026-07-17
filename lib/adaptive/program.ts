// ═══════════════════════════════════════════════════════════════
// StudyAL — Adaptive Program Types
// El modo adaptativo no es un menú de herramientas.
// Es un programa vivo que cambia según la evidencia del estudiante.
// ═══════════════════════════════════════════════════════════════

export type KnowledgeLevel = 'zero' | 'some' | 'review' | 'practice'

// ── Preferencia de duración de sesión ──
// Define profundidad y cantidad de actividades por sesión.
// El dominio final es el mismo; solo cambia el ritmo y la extensión.
export type SessionLength = 'short' | 'medium' | 'long'

export const SESSION_LENGTH_CONFIG: Record<SessionLength, {
  label: string
  description: string
  emoji: string
  targetMinutes: number
  activitiesPerSession: { min: number; max: number }
  explanationDepth: 'concise' | 'balanced' | 'deep'
}> = {
  short: {
    label: 'Cortas',
    description: 'Explicaciones concisas, más sesiones',
    emoji: '⚡',
    targetMinutes: 12,
    activitiesPerSession: { min: 3, max: 5 },
    explanationDepth: 'concise',
  },
  medium: {
    label: 'Medias',
    description: 'Balance entre explicación y práctica',
    emoji: '⚖️',
    targetMinutes: 22,
    activitiesPerSession: { min: 5, max: 8 },
    explanationDepth: 'balanced',
  },
  long: {
    label: 'Largas',
    description: 'Profundas, menos cambios entre sesiones',
    emoji: '🌊',
    targetMinutes: 35,
    activitiesPerSession: { min: 7, max: 12 },
    explanationDepth: 'deep',
  },
}

export type SessionPurpose =
  | 'understand'
  | 'organize'
  | 'memorize'
  | 'apply'
  | 'simulate'
  | 'repair'

export type StepType =
  // Básicas (legacy, siguen funcionando)
  | 'explain'
  | 'active_recall'
  | 'micro_flashcards'
  | 'micro_quiz'
  | 'mini_exam'
  | 'coach_feedback'
  | 'repair'
  // Expandidas (catálogo nuevo de actividades pedagógicas)
  | 'analogy'              // analogía con algo conocido
  | 'concrete_example'     // ejemplo concreto del material
  | 'visualization'        // describir visualmente / dibujar mental
  | 'mind_map'             // mapa mental del topic
  | 'timeline'             // línea de tiempo de eventos/procesos
  | 'classification'       // clasificar elementos en categorías
  | 'comparison'           // comparar dos conceptos
  | 'case_study'           // caso aplicado (clínico/práctico)
  | 'application'          // aplicar a un problema nuevo
  | 'synthesis'            // sintetizar varios conceptos
  | 'inverse_teaching'     // que el estudiante explique como si enseñara
  | 'error_detection'      // identificar errores en una explicación dada
  | 'concept_mapping'      // relacionar conceptos entre sí
  | 'metacognition'        // reflexionar sobre el propio aprendizaje

export type StepEngine =
  | 'analisis'
  | 'repasar'
  | 'flashcards'
  | 'quiz'
  | 'examen'
  | 'alai'
  | 'truquitos'
  | 'studymap'

export type StepStatus = 'pending' | 'active' | 'completed' | 'skipped'
export type SessionStatus = 'locked' | 'available' | 'in_progress' | 'completed' | 'skipped'
export type ProgramStatus = 'setup' | 'active' | 'completed'

// ── Step ────────────────────────────────────────────────────────
export interface AdaptiveStep {
  id: string
  type: StepType
  engine: StepEngine
  title: string
  instruction: string
  estimatedMinutes: number
  evidenceRequired: boolean
  status: StepStatus

  // ── Diseño pedagógico (Fase 2: planeación por ALAI) ──
  pedagogicalReason?: string       // por qué ALAI eligió este step
  expectedEvidence?: string[]      // qué evidencia se espera recolectar
  conceptsTargeted?: string[]      // conceptos específicos que toca este step
  difficulty?: 'easy' | 'medium' | 'hard'
  fallbackIfFails?: StepType       // qué hacer si el estudiante falla aquí

  result?: {
    score?: number
    correct?: boolean
    domainGain?: number
    completedAt?: number
    userResponse?: string
  }
}

// ── Session ─────────────────────────────────────────────────────
export interface AdaptiveSession {
  id: string
  sessionNumber: number
  title: string
  objective: string
  estimatedMinutes: number
  status: SessionStatus
  purpose: SessionPurpose
  steps: AdaptiveStep[]
  expectedDomainGain: number

  // ── Topic context (Material Blueprint) ──────────────────────
  // Conecta la sesión con un tema real del material
  topicId?: string              // id del MaterialTopic
  topicTitle?: string           // "Respiración celular"
  targetConcepts?: string[]     // ["Glucólisis", "Ciclo de Krebs", "ATP"]
  sourcePages?: number[]        // páginas del material donde está el tema
  evidenceGoal?: string
  sessionFormat?: string  // discovery | practice_drill | deep_dive | rapid_review | exam_simulation | repair_dialogue | application | memorization         // qué debe demostrar el estudiante
  blueprintConfidence?: number  // 0-100 confianza del blueprint en este topic
  evaluationPreference?: 'quick_test' | 'write_explain' | 'mix_everything'
  examFormat?: import('./planner/types').ExamFormat

  // ── Planeación (Fase 2: por ALAI) ──
  plannedAt?: number               // timestamp cuando ALAI diseñó la sesión
  planRationale?: string           // explicación de ALAI de por qué eligió esta estructura
  planVersion?: number             // si se re-planeó, qué versión es
  groupedTopicIds?: string[]       // si la sesión cubre varios topics agrupados

  // ── Asignación determinista de micros del grafo v3 ──────────
  // Llenado por el tutor al iniciar la sesión desde el grafo
  assignedMicroIds?: string[]      // micros concretos asignados a esta sesión
  requiredMicroIds?: string[]      // micros que deben completarse (subset de assigned)
  retentionMicroIds?: string[]     // micros de repaso espaciado

  // Se llenan al completar
  domainBefore?: number
  domainAfter?: number
  conceptsImproved?: string[]
  conceptsStillWeak?: string[]
  completedAt?: number
  plannedDate?: string
  planStatus?: import('./planner/types').PlanSessionStatus
  planReason?: string
  repairOf?: string | null
  reviewOf?: string[]
  revisionVersion?: number
}

// ── Setup ───────────────────────────────────────────────────────
export interface AdaptiveProgramSetup {
  initialKnowledgeLevel: KnowledgeLevel
  sessionLength: SessionLength
  targetScore: number
  examDate: string | null
  dailyMinutes?: number
  evalPreference?: 'quick_test' | 'write_explain' | 'mix_everything'
  examDateTime?: string
  examFormat?: import('./planner/types').ExamFormat
  availability?: import('./planner/types').Availability
  priorities?: string[]
}

// ── Program ─────────────────────────────────────────────────────
export interface AdaptiveProgram {
  id: string
  createdAt: number
  updatedAt: number
  materialIds: string[]
  setup: AdaptiveProgramSetup
  status: ProgramStatus
  sessions: AdaptiveSession[]
  currentSessionIndex: number
  studyPlan?: import('./planner/types').StudyPlan

  // ── Material Blueprint embebido ──────────────────────────────
  // Si existe, el programa fue creado con análisis completo del material
  materialBlueprint?: any | null

  // Análisis completo del material para usar texto real en sesiones
  materialAnalysis?: any

  // La estrategia que ALAI usó para construir este programa
  strategy?: any

  // Narrativa generada por ALAI
  narrative?: any

  // Historial de cambios de estrategia
  strategyHistory?: Array<{
    fromType: string
    toType: string
    changedAt: number
    reason: string
    sessionsCompleted: number
  }>
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════

export const EVIDENCE_ENGINES: StepEngine[] = [
  'flashcards',
  'quiz',
  'examen',
  'alai',
]

export const SUPPORT_ENGINES: StepEngine[] = [
  'analisis',
  'repasar',
  'truquitos',
  'studymap',
]

export const DOMAIN_GAIN_BY_STEP_TYPE: Record<StepType, number> = {
  explain: 2,
  active_recall: 10,
  micro_flashcards: 8,
  micro_quiz: 12,
  // Nuevas actividades
  analogy: 4,
  concrete_example: 4,
  visualization: 5,
  mind_map: 6,
  timeline: 5,
  classification: 7,
  comparison: 7,
  case_study: 12,
  application: 14,
  synthesis: 10,
  inverse_teaching: 15,
  error_detection: 11,
  concept_mapping: 8,
  metacognition: 6,
  mini_exam: 15,
  coach_feedback: 5,
  repair: 8,
}

// ── Labels UI — nunca mostrar términos técnicos ──────────────────
// REGLA: no decir "conceptos críticos" al usuario
// Decir "temas que todavía no dominas"
export const SESSION_PURPOSE_LABELS: Record<SessionPurpose, string> = {
  understand: 'Entender la base',
  organize: 'Organizar ideas',
  memorize: 'Recordar lo esencial',
  apply: 'Practicar',
  simulate: 'Simular examen',
  repair: 'Corregir errores',
}

export const SESSION_PURPOSE_EMOJI: Record<SessionPurpose, string> = {
  understand: '📖',
  organize: '🗺️',
  memorize: '🎴',
  apply: '🎯',
  simulate: '📝',
  repair: '✨',
}

export const STEP_TYPE_INSTRUCTION: Record<StepType, string> = {
  // Básicas (legacy)
  explain: 'Vamos a ver la idea principal.',
  active_recall: 'Ahora vamos a comprobar qué recuerdas.',
  micro_flashcards: 'Vamos a anclar estos conceptos en tu memoria.',
  micro_quiz: 'Pon a prueba lo que aprendiste.',
  mini_exam: 'Vamos a simular una prueba real.',
  coach_feedback: 'Revisemos cómo vas.',
  repair: 'Vamos a corregir lo que falló.',
  // Expandidas
  analogy: 'Vamos a compararlo con algo que ya conoces.',
  concrete_example: 'Veamos un ejemplo concreto del material.',
  visualization: 'Vamos a visualizar el concepto.',
  mind_map: 'Vamos a mapear las ideas y sus relaciones.',
  timeline: 'Ordenemos los eventos en el tiempo.',
  classification: 'Clasifiquemos los elementos en categorías.',
  comparison: 'Comparemos dos conceptos relacionados.',
  case_study: 'Veamos un caso aplicado.',
  application: 'Apliquemos el concepto a un problema nuevo.',
  synthesis: 'Sinteticemos lo aprendido.',
  inverse_teaching: 'Ahora tú explícalo como si fueras el profesor.',
  error_detection: 'Identifica el error en esta explicación.',
  concept_mapping: 'Relacionemos los conceptos entre sí.',
  metacognition: 'Reflexiona sobre lo que aprendiste.',
}

// ── Helper: días hasta examen ────────────────────────────────────
export function getDaysToExam(examDate: string | null): number | null {
  if (!examDate) return null
  const map: Record<string, number> = {
    today: 0,
    tomorrow: 1,
    in_3_days: 3,
    in_1_week: 7,
    in_2_weeks: 14,
    in_1_month: 30,
    no_exam: 999,
  }
  return map[examDate] ?? null
}

// ── Helper: label de fecha de examen ────────────────────────────
export function getExamDateLabel(examDate: string | null): string {
  if (!examDate) return 'Sin fecha'
  const map: Record<string, string> = {
    today: 'Hoy',
    tomorrow: 'Mañana',
    in_3_days: 'En 3 días',
    in_1_week: 'En 1 semana',
    in_2_weeks: 'En 2 semanas',
    in_1_month: 'En 1 mes',
    no_exam: 'Sin examen',
  }
  return map[examDate] ?? examDate
}

// ── Helper: sesión actual ────────────────────────────────────────
export function getCurrentSession(program: AdaptiveProgram): AdaptiveSession | null {
  if (!program.sessions.length) return null
  return program.sessions[program.currentSessionIndex] ?? null
}

// ── Helper: siguiente sesión disponible ─────────────────────────
export function getNextAvailableSession(program: AdaptiveProgram): AdaptiveSession | null {
  return program.sessions.find(s => s.status === 'available') ?? null
}

// ── Helper: progreso del programa ───────────────────────────────
export function getProgramProgress(program: AdaptiveProgram): {
  completedSessions: number
  totalSessions: number
  percentComplete: number
} {
  const completed = program.sessions.filter(s => s.status === 'completed').length
  const total = program.sessions.length
  return {
    completedSessions: completed,
    totalSessions: total,
    percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0,
  }
}

// ── Helper: obtener contexto de topic para APIs ──────────────────
// Extrae los datos del topic actual para pasar a las APIs
export function getSessionTopicContext(session: AdaptiveSession): {
  topicTitle: string | null
  targetConcepts: string[]
  sourcePages: number[]
  evidenceGoal: string | null
  hasBlueprintContext: boolean
} {
  return {
    topicTitle: session.topicTitle ?? null,
    targetConcepts: session.targetConcepts ?? [],
    sourcePages: session.sourcePages ?? [],
    evidenceGoal: session.evidenceGoal ?? null,
    hasBlueprintContext: !!(session.topicId && session.topicTitle),
  }
}
