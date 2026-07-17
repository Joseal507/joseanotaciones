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
  // Perfil de evidencias (gestionado por evidenceEngine, almacenado aquí)
  evidenceProfile?: import('./engine/evidenceEngine').EvidenceProfile
  // Nombre del micro (para persistencia en materialMastery)
  microName?: string
  sourcePages?: number[]
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
  // ── Introducción ──────────────────────────────────────────────
  | 'introduce'                         // Presentar por primera vez
  | 'activate_prior_knowledge'          // Activar conocimiento previo antes de introducir

  // ── Explicación ───────────────────────────────────────────────
  | 'explain_deeper'                    // Profundizar explicación
  | 'explain_with_analogy'              // Usar analogía con algo familiar
  | 'explain_with_counterexample'       // Mostrar qué NO es el concepto
  | 'explain_with_contrast'             // Comparar con un concepto similar
  | 'explain_with_visualization'        // Imagen mental, diagrama, ASCII
  | 'explain_with_story'                // Historia o narrativa que contextualiza
  | 'explain_cause_effect'              // Explicar desde la causa al efecto
  | 'explain_effect_to_cause'           // Explicar desde el efecto a la causa (inversión)
  | 'explain_by_elimination'            // Llegar al concepto eliminando opciones
  | 'simplify_to_core'                  // Reducir al núcleo más simple posible
  | 'use_prior_knowledge'               // Construir sobre lo que ya sabe el estudiante

  // ── Ejemplos ──────────────────────────────────────────────────
  | 'illustrate_with_example'           // Mostrar ejemplo concreto
  | 'illustrate_with_worked_example'    // Ejemplo resuelto paso a paso completo
  | 'illustrate_with_clinical_case'     // Caso clínico real
  | 'illustrate_with_everyday_case'     // Caso cotidiano familiar
  | 'illustrate_with_error_case'        // Mostrar un error común y por qué está mal

  // ── Verificación ──────────────────────────────────────────────
  | 'verify_understanding'              // Preguntar si entendió
  | 'verify_with_prediction'            // Pedir predicción antes de revelar
  | 'verify_with_socratic_question'     // Pregunta socrática que guía al descubrimiento
  | 'verify_with_completion'            // Completar una explicación incompleta
  | 'verify_with_error_detection'       // Encontrar el error en una solución dada
  | 'verify_with_ranking'               // Ordenar conceptos por importancia o magnitud

  // ── Aplicación ────────────────────────────────────────────────
  | 'test_application'                  // Aplicar a un caso
  | 'test_transfer'                     // Aplicar en contexto nuevo
  | 'test_reverse'                      // Aplicar al revés (efecto → causa)
  | 'test_boundary'                     // Caso límite o extremo del concepto
  | 'test_integration'                  // Integrar múltiples conceptos en un caso

  // ── Profundización ────────────────────────────────────────────
  | 'connect_to_previous'               // Conectar con otros micros ya aprendidos
  | 'build_mental_model'                // Construir modelo mental completo
  | 'identify_pattern'                  // Identificar el patrón subyacente
  | 'generalize_rule'                   // Extraer la regla general desde casos

  // ── Memoria ───────────────────────────────────────────────────
  | 'recall_check'                      // Verificar retención
  | 'teach_mnemonic'                    // Enseñar mnemotecnia o regla de memoria
  | 'spaced_recall'                     // Repaso espaciado tras tiempo

  // ── Reparación ────────────────────────────────────────────────
  | 'reveal_answer'                     // Después de fallo: mostrar respuesta correcta
  | 'reconstruct_from_error'            // Reexplicar tras error con ángulo diferente
  | 'address_misconception'             // Confrontar y corregir creencia incorrecta directamente
  | 'guided_reconstruction'             // Guiar al estudiante a descubrir su propio error
  | 'split_into_submicros'              // Dividir el micro en partes más pequeñas

  // ── Cierre ────────────────────────────────────────────────────
  | 'consolidate'                       // Cierre del micro
  | 'summarize_key_idea'               // Resumir la idea clave en una frase
  | 'inverse_teaching'                  // El estudiante explica como si enseñara

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

  // Micros asignados a ESTA sesión (no al grafo global)
  requiredMicroIds?: string[]      // micros que esta sesión debe completar
  retentionMicroIds?: string[]     // micros de repaso de sesiones anteriores
  
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

  // ── Campos de sesión extendidos ────────────────────────────────
  // Spaced repetition
  spacedReviewMicros?: string[]
  reviewedSoFar?: string[]
  isSpacedReview?: boolean
  spacedReviewMicroId?: string | null
  // Interleaving
  isInterleaving?: boolean
  interleaveCount?: number
  interleaveMicroId?: string | null
  // Pre-quiz
  isPreQuiz?: boolean
  // Banco de preguntas
  usedQuestionIds?: string[]
  usedFactKeys?: string[]
  // Motores cognitivos pendientes (se persisten al final del turno)
  pendingHypotheses?: import('./engine/hypothesisEngine').LearningHypothesis[]
  pendingMisconceptions?: import('./engine/misconceptionTracker').Misconception[]
  pendingMemoryStates?: Record<string, import('./engine/memoryEngine').MemoryState>
  // Refuerzo posterior
  reinforcementMicroIds?: string[]
}

export interface TurnInteraction {
  interactionType?: string
  type?: string
  id?: string | null
  prompt?: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

export interface Turn {
  turnNumber: number
  timestamp: number
  microId: string
  objective: TeachingObjective
  content: {
    type: 'teaching' | 'question' | 'feedback' | 'transition' | 'summary'
    summary: string                     // Resumen de qué se mostró
    interaction?: TurnInteraction | null
    errorDiagnosis?: {
      errorType?: string
      isLikelyMisconception?: boolean
      [key: string]: unknown
    }
  }
  studentResponse?: {
    answer: unknown
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
