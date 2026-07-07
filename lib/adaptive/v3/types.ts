// ═══════════════════════════════════════════════════════════════
// StudyAL 3.0 — Knowledge Graph Types
// 
// Filosofía: 
// - El LLM extrae y genera CONTENIDO
// - El código maneja ESTADO, LÓGICA y DECISIONES
// - Cada microconcepto es un nodo con dependencias reales
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// MICRO CONCEPT — La unidad atómica de aprendizaje
// ═══════════════════════════════════════════════════════════════

export interface MicroConcept {
  id: string
  
  // Identidad
  name: string                          // Nombre corto: "pH", "Fundación Falcons"
  shortDescription: string              // 1 oración: qué es
  fullDefinition: string                // Definición completa del material
  
  // Tipo cognitivo
  cognitiveType: CognitiveType
  difficulty: number                    // 0-100 (0 = trivial, 100 = experto)
  estimatedMinutes: number              // Tiempo estimado para dominar
  
  // Contenido del material
  sourceQuotes: string[]                // Citas EXACTAS del material
  sourceChunkIds: string[]              // Chunks de origen
  sourcePages: number[]                 // Páginas del PDF
  
  // Recursos asociados
  examples: MicroExample[]              // Ejemplos concretos
  formulas: MicroFormula[]              // Fórmulas relacionadas
  procedures: MicroProcedure[]          // Procedimientos paso a paso
  commonErrors: MicroError[]            // Errores frecuentes
  
  // Relaciones (llenadas por Dependency Resolver)
  prerequisites: string[]               // IDs de micros necesarios ANTES
  enables: string[]                     // IDs de micros que este habilita
  related: string[]                     // IDs de micros relacionados
  
  // Meta
  importance: 'critical' | 'high' | 'medium' | 'low'
  topicGroup: string                    // "Fundación", "Jugadores", etc.
  extractedAt: number
}

export type CognitiveType =
  | 'definitional'          // Qué es X (memorización + comprensión)
  | 'conceptual'            // Cómo funciona X (comprensión profunda)
  | 'procedural'            // Cómo hacer X (pasos)
  | 'mathematical'          // Cálculo/fórmula
  | 'causal'                // Causa → efecto
  | 'comparative'           // X vs Y
  | 'chronological'         // Secuencia temporal
  | 'classificatory'        // Tipos/categorías
  | 'narrative'             // Historia/relato
  | 'analytical'            // Requiere análisis
  | 'applicative'           // Aplicar a casos

// ═══════════════════════════════════════════════════════════════
// RECURSOS ATÓMICOS
// ═══════════════════════════════════════════════════════════════

export interface MicroExample {
  id: string
  scenario: string                      // El caso o situación
  solution?: string                     // Cómo se resuelve
  keyInsight: string                    // Qué enseña este ejemplo
}

export interface MicroFormula {
  id: string
  expression: string                    // "pH = -log[H+]"
  latex?: string                        // Versión LaTeX si aplica
  variables: Array<{
    symbol: string
    meaning: string
    unit?: string
  }>
  whenToUse: string                     // Contexto de uso
}

export interface MicroProcedure {
  id: string
  name: string
  steps: Array<{
    order: number
    description: string
    reasoning: string                   // Por qué este paso
  }>
  applicableWhen: string                // Cuándo aplicarlo
}

export interface MicroError {
  id: string
  description: string                   // El error común
  whyItHappens: string                  // Por qué se comete
  correction: string                    // Cómo evitarlo
}

// ═══════════════════════════════════════════════════════════════
// DEPENDENCY RELATIONSHIP
// ═══════════════════════════════════════════════════════════════

export interface DependencyEdge {
  from: string                          // Micro ID que se necesita antes
  to: string                            // Micro ID que depende
  strength: 'hard' | 'soft'            // hard = obligatorio, soft = ayuda
  reason: string                        // Por qué existe esta dependencia
}

// ═══════════════════════════════════════════════════════════════
// KNOWLEDGE GRAPH — El grafo completo del material
// ═══════════════════════════════════════════════════════════════

export interface KnowledgeGraph {
  // Identidad
  materialId: string
  materialTitle: string
  subjectArea: string                   // chemistry, medical, math, history, etc
  
  // Contenido
  microConcepts: MicroConcept[]
  dependencies: DependencyEdge[]
  
  // Grupos temáticos (topics grandes que agrupan micros)
  topicGroups: TopicGroup[]
  
  // Metadata
  totalMicros: number
  totalDependencies: number
  averageDifficulty: number
  estimatedTotalMinutes: number
  criticalPath: string[]                // Micros críticos en orden
  
  // Análisis
  extractedAt: number
  chunkerVersion: string
  extractorVersion: string
  resolverVersion: string
}

export interface TopicGroup {
  id: string
  name: string                          // "Fundación", "Jugadores clave"
  description: string
  microIds: string[]                    // Micros que pertenecen a este grupo
  order: number                         // Orden pedagógico sugerido
}

// ═══════════════════════════════════════════════════════════════
// STATE MACHINE — Estado del estudiante frente al grafo
// ═══════════════════════════════════════════════════════════════

export interface MicroState {
  microId: string
  
  // Timeline de eventos (no un enum simple)
  timeline: MicroTimelineEvent[]
  
  // Evidencia acumulada
  evidence: {
    introduced: boolean
    explainedByTutor: boolean
    explainedByStudent: boolean         // El estudiante lo explicó con sus palabras
    answeredCorrectly: number           // Cuántas veces respondió bien
    answeredIncorrectly: number         // Cuántas veces respondió mal
    applied: boolean                    // Aplicó en un caso
    transferred: boolean                // Aplicó en contexto NUEVO
    connected: boolean                  // Conectó con otro micro
    recalled: boolean                   // Recordó después de tiempo
  }
  
  // Estado derivado (calculado por código, no LLM)
  masteryLevel: MasteryLevel
  isReady: boolean                      // ¿Está listo para avanzar?
  needsReview: boolean                  // ¿Necesita repaso?
  
  // Interacciones
  totalInteractions: number
  lastInteractionAt: number | null
  timeSpentSeconds: number
  
  // Errores
  errorsCommitted: string[]             // IDs de commonErrors detectados
  misunderstandings: string[]           // Malentendidos específicos
}

export type MasteryLevel =
  | 'unseen'                // No se ha visto
  | 'introduced'            // Se presentó
  | 'partially_understood'  // Entendido a medias
  | 'understood'            // Entendido
  | 'applied'               // Aplicado exitosamente
  | 'connected'             // Conectado con otros conceptos
  | 'mastered'              // Dominado
  | 'struggling'            // Con dificultades persistentes

export interface MicroTimelineEvent {
  timestamp: number
  turnNumber: number
  eventType: MicroEventType
  metadata: {
    contentShown?: string               // Qué se le mostró (resumen)
    studentResponse?: string            // Qué respondió
    outcome?: 'correct' | 'partial' | 'incorrect'
    objectiveAtTime?: TeachingObjective
    tookMs?: number
  }
}

export type MicroEventType =
  | 'introduced'
  | 'explained_by_tutor'
  | 'question_asked'
  | 'answered_correctly'
  | 'answered_partially'
  | 'answered_incorrectly'
  | 'example_shown'
  | 'analogy_used'
  | 'error_pointed_out'
  | 'correct_answer_revealed'
  | 'applied_to_case'
  | 'transferred_to_new_context'
  | 'connected_to_other_micro'
  | 'skipped'
  | 'revisited'

// ═══════════════════════════════════════════════════════════════
// TEACHING OBJECTIVE — Qué se está intentando lograr
// ═══════════════════════════════════════════════════════════════

export type TeachingObjective =
  | 'introduce'                         // Presentar por primera vez
  | 'explain_deeper'                    // Profundizar explicación
  | 'illustrate_with_example'           // Mostrar ejemplo
  | 'verify_understanding'              // Preguntar si entendió
  | 'test_application'                  // Aplicar a un caso
  | 'test_transfer'                     // Aplicar en contexto nuevo
  | 'consolidate'                       // Cierre del micro
  | 'reveal_answer'                     // Después de fallo
  | 'reconstruct_from_error'            // Reexplicar tras error
  | 'connect_to_previous'               // Conectar con otros micros
  | 'recall_check'                      // Verificar retención

// ═══════════════════════════════════════════════════════════════
// TEACHING QUEUE — Cola de micros a enseñar
// ═══════════════════════════════════════════════════════════════

export interface TeachingQueue {
  sessionId: string
  
  // Cola principal
  pendingMicroIds: string[]             // Por enseñar
  activeMicroId: string | null          // Actualmente enseñándose
  completedMicroIds: string[]           // Ya terminados
  postponedMicroIds: string[]           // Pospuestos para más adelante
  
  // Metadata
  totalPlanned: number
  createdAt: number
}

// ═══════════════════════════════════════════════════════════════
// STUDENT SESSION STATE — Todo el estado de la sesión
// ═══════════════════════════════════════════════════════════════

export interface SessionState {
  sessionId: string
  userId: string
  materialId: string
  
  // Progreso
  startedAt: number
  currentTurn: number
  totalTurnsCompleted: number
  elapsedSeconds: number
  targetMinutes: number
  
  // Estados de todos los micros del grafo
  microStates: Record<string, MicroState>
  
  // Cola de enseñanza
  queue: TeachingQueue
  
  // Historia conversacional (últimos N turnos, no todo)
  recentTurns: Turn[]                   // Últimos 10 turnos
  
  // Métricas
  totalCorrect: number
  totalIncorrect: number
  totalPartial: number
  consecutiveCorrect: number
  consecutiveIncorrect: number
  
  // Estado del estudiante (inferido)
  studentState: {
    energy: 'fresh' | 'engaged' | 'tired' | 'frustrated'
    pace: 'fast' | 'medium' | 'slow'
    confidence: 'high' | 'medium' | 'low'
  }
}

export interface Turn {
  turnNumber: number
  timestamp: number
  microId: string
  objective: TeachingObjective
  content: {
    type: 'teaching' | 'question' | 'feedback' | 'transition'
    summary: string                     // Resumen de qué se mostró
  }
  studentResponse?: {
    answer: any
    responseTimeMs: number
    outcome: 'correct' | 'partial' | 'incorrect' | null
  }
}

// ═══════════════════════════════════════════════════════════════
// CONTENT REQUEST — Lo que se le pide al LLM (Content Generator)
// ═══════════════════════════════════════════════════════════════

export interface ContentRequest {
  microConcept: MicroConcept
  objective: TeachingObjective
  microState: MicroState
  
  // Contexto del estudiante
  studentContext: {
    subjectArea: string
    profileHint: string                 // "Medicina", "Universitario"
    energy: string
    recentPerformance: 'improving' | 'struggling' | 'steady'
  }
  
  // Historia relevante
  previousAttempts: MicroTimelineEvent[] // Solo eventos de este micro
  recentErrors: string[]                 // Errores recientes en este micro
  
  // Restricciones
  avoidRepeating: string[]              // Contenido que ya se mostró
  preferredFormat: 'text' | 'question' | 'example' | 'auto'
  maxLength: 'short' | 'medium' | 'long'
}

// ═══════════════════════════════════════════════════════════════
// TUTOR RESPONSE — Lo que devuelve el sistema al front
// ═══════════════════════════════════════════════════════════════

export interface TutorResponse {
  // Página a mostrar
  page: {
    type: 'teaching' | 'question' | 'feedback' | 'summary' | 'session_close'
    title?: string
    content: any                        // Bloques de contenido
    interaction?: any                   // Widget si aplica
  }
  
  // Estado actualizado
  updatedSessionState: SessionState
  
  // Info del sistema (debug/UI)
  systemInfo: {
    activeMicroConcept: string
    objective: TeachingObjective
    reason: string                      // Por qué se eligió esto
    progressPercent: number
    microsCompleted: number
    microsRemaining: number
  }
  
  // Feedback si hubo evaluación
  evaluation?: {
    outcome: 'correct' | 'partial' | 'incorrect'
    whatWasCorrect: string
    whatWasMissing: string
    correctAnswer: string
  }
  
  // Control
  shouldCloseSession: boolean
}
