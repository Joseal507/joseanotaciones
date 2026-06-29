// ═══════════════════════════════════════════════════════════════
// StudyAL — Adaptive Program Types
// El modo adaptativo no es un menú de herramientas.
// Es un programa vivo que cambia según la evidencia del estudiante.
// ═══════════════════════════════════════════════════════════════

export type KnowledgeLevel = 'zero' | 'some' | 'review' | 'practice'

export type SessionPurpose =
  | 'understand'
  | 'organize'
  | 'memorize'
  | 'apply'
  | 'simulate'
  | 'repair'

export type StepType =
  | 'explain'
  | 'active_recall'
  | 'micro_flashcards'
  | 'micro_quiz'
  | 'mini_exam'
  | 'coach_feedback'
  | 'repair'

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

  // Se llenan al completar
  domainBefore?: number
  domainAfter?: number
  conceptsImproved?: string[]
  conceptsStillWeak?: string[]
  completedAt?: number
}

// ── Setup ───────────────────────────────────────────────────────
export interface AdaptiveProgramSetup {
  initialKnowledgeLevel: KnowledgeLevel
  targetScore: number
  examDate: string | null
  dailyMinutes?: number
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

  // ── Material Blueprint embebido ──────────────────────────────
  // Si existe, el programa fue creado con análisis completo del material
  materialBlueprint?: import('./blueprint').MaterialBlueprint | null

  // La estrategia que ALAI usó para construir este programa
  strategy?: import('./strategy').StudyStrategy

  // Narrativa generada por ALAI
  narrative?: import('./narrative').StrategyNarrative

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
  explain: 'Vamos a ver la idea principal.',
  active_recall: 'Ahora vamos a comprobar qué recuerdas.',
  micro_flashcards: 'Vamos a anclar estos conceptos en tu memoria.',
  micro_quiz: 'Pon a prueba lo que aprendiste.',
  mini_exam: 'Vamos a simular una prueba real.',
  coach_feedback: 'Revisemos cómo vas.',
  repair: 'Vamos a corregir lo que falló.',
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
