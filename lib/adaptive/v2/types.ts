// ═══════════════════════════════════════════════════════════════
// StudyAL Adaptive V2 — Tipos y Contratos
// 
// Filosofía:
// - No hay flujos fijos
// - El Pedagogical Brain decide todo en tiempo real
// - Cada decisión responde: "¿Qué necesita este estudiante ahora?"
// - Los formatos son herramientas, no plantillas
// ═══════════════════════════════════════════════════════════════

import type { UserProfile } from '../userProfile'
import type { AdaptiveProgramSetup } from '../program'

// ═══════════════════════════════════════════════════════════════
// STUDENT MODEL — Todo lo que sabemos del estudiante
// ═══════════════════════════════════════════════════════════════

export interface StudentModel {
  // Datos del perfil (ya existentes en el sistema)
  profile: UserProfile
  
  // Setup del programa
  setup: AdaptiveProgramSetup
  
  // Estado observado durante las sesiones
  observed: ObservedTraits
  
  // Historial pedagógico entre sesiones
  pedagogicalMemory: PedagogicalMemory
  
  // Dominio actual por concepto
  masteryByTopic: Record<string, TopicMastery>
}

export interface ObservedTraits {
  // Cómo aprende mejor
  learnsBestWith: LearningModality[]
  strugglesWith: LearningModality[]
  
  // Velocidad y ritmo
  averageResponseTimeSeconds: number
  pace: 'slow' | 'medium' | 'fast'
  
  // Confianza calibrada
  confidenceCalibration: 'overconfident' | 'calibrated' | 'underconfident'
  falseConfidenceCount: number
  
  // Fatiga y motivación
  fatigueLevel: 'low' | 'medium' | 'high'
  motivationLevel: 'low' | 'medium' | 'high'
  
  // Tolerancia
  toleratesLongExplanations: boolean
  prefersExamplesFirst: boolean
  respondsWellToAnalogy: boolean
  respondsWellToCases: boolean
}

export type LearningModality =
  | 'visual_diagrams'
  | 'worked_examples'
  | 'analogies'
  | 'step_by_step'
  | 'cases_and_stories'
  | 'formulas_and_math'
  | 'comparisons'
  | 'active_practice'
  | 'discovery_questions'
  | 'concept_maps'

export interface PedagogicalMemory {
  // Errores recurrentes (aprende del estudiante)
  recurringMistakes: Array<{
    pattern: string           // ej: "confunde Ka con Kb"
    concept: string
    count: number
    lastSeen: number
  }>
  
  // Formatos que le funcionan mejor
  effectiveFormats: Array<{ format: string; successRate: number; count: number }>
  ineffectiveFormats: Array<{ format: string; failureRate: number; count: number }>
  
  // Preferencias pedagógicas observadas
  effectiveStrategies: Array<{
    strategy: string           // ej: "explicar_con_ejemplo_primero"
    subject: string            // en qué materia funciona
    successRate: number
  }>
  
  // Momentos del día donde aprende mejor
  bestTimeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night'
  
  // Notas humanas del sistema
  notes: string[]
}

// ═══════════════════════════════════════════════════════════════
// MASTERY — Dominio multidimensional por topic
// ═══════════════════════════════════════════════════════════════

export interface TopicMastery {
  topicId: string
  topicTitle: string
  
  // Las 7 dimensiones del dominio real
  dimensions: {
    comprehension: number      // Entiende qué es
    application: number        // Puede usarlo
    memory: number             // Lo recuerda
    transfer: number           // Lo aplica en contexto nuevo
    speed: number              // Lo hace fluido
    confidence: number         // Está seguro
    retention: number          // Lo recuerda con el tiempo
  }
  
  // Score compuesto
  overallMastery: number       // 0-100
  
  // Estado
  status: MasteryStatus
  
  // Historial
  evidenceCount: number
  lastPracticed: number
  firstIntroduced: number
  
  // Metacognición
  studentSelfReported: 'not_sure' | 'somewhat' | 'confident' | 'expert' | null
  hasFalseConfidence: boolean
  
  // Errores específicos en este topic
  specificMistakes: string[]
}

export type MasteryStatus =
  | 'not_started'
  | 'introduced'         // Vio el topic
  | 'learning'           // Está aprendiéndolo
  | 'practicing'         // Ya entendió, ahora practica
  | 'consolidating'      // Casi dominado
  | 'mastered'           // Dominado
  | 'forgotten'          // Sabía pero olvidó

// ═══════════════════════════════════════════════════════════════
// MATERIAL INTELLIGENCE — Lo que sabemos del material
// ═══════════════════════════════════════════════════════════════

export interface MaterialIntelligence {
  materialId: string
  materialTitle: string
  
  // Área del material
  subjectArea: SubjectArea
  difficultyLevel: 'basic' | 'intermediate' | 'advanced'
  
  // Todo lo que hay dentro
  topics: TopicNode[]
  
  // Cosas específicas del material
  formulas: FormulaItem[]
  procedures: ProcedureItem[]
  keyExamples: ExampleItem[]
  commonMistakes: CommonMistake[]
  
  // Meta
  totalPages: number
  analyzedAt: number
}

export type SubjectArea =
  | 'medical'
  | 'math'
  | 'chemistry'
  | 'physics'
  | 'biology'
  | 'legal'
  | 'history'
  | 'literature'
  | 'engineering'
  | 'economics'
  | 'philosophy'
  | 'language'
  | 'general'
  | 'mixed'

export interface TopicNode {
  id: string
  title: string
  
  // Contenido real
  rawText: string              // Texto exacto del material
  keyFacts: string[]           // Hechos importantes
  keyIdeas: string[]           // Ideas principales
  
  // Clasificación pedagógica
  topicType: TopicType
  cognitiveLoad: 'light' | 'medium' | 'heavy'
  
  // Relaciones
  prerequisites: string[]      // IDs de topics necesarios antes
  relatedTopics: string[]      // IDs de topics relacionados
  subtopics: string[]          // IDs si tiene subtopics
  
  // Contenido específico
  formulaIds: string[]
  procedureIds: string[]
  exampleIds: string[]
  mistakeIds: string[]
  
  // Objetivos de aprendizaje
  learningObjectives: string[]
  
  // Meta
  importance: 'low' | 'medium' | 'high' | 'critical'
  estimatedMinutes: number
  sourcePage?: number
}

export type TopicType =
  | 'definition'             // Qué es X
  | 'conceptual'             // Idea abstracta
  | 'procedural'             // Cómo hacer algo
  | 'mathematical'           // Fórmula o cálculo
  | 'causal'                 // Causa-efecto
  | 'chronological'          // Secuencia temporal
  | 'comparative'            // Diferencias entre cosas
  | 'classificatory'         // Categorías
  | 'narrative'              // Historia
  | 'clinical_case'          // Caso médico
  | 'legal_case'             // Caso legal
  | 'analytical'             // Requiere análisis
  | 'memorization'           // Datos a memorizar

export interface FormulaItem {
  id: string
  name: string
  formula: string
  variables: Array<{ symbol: string; meaning: string; unit?: string }>
  whenToUse: string
  commonErrors: string[]
}

export interface ProcedureItem {
  id: string
  name: string
  steps: string[]
  whenToUse: string
  commonErrors: string[]
}

export interface ExampleItem {
  id: string
  description: string
  solution?: string
  relatedTopicIds: string[]
}

export interface CommonMistake {
  id: string
  description: string
  correction: string
  relatedTopicIds: string[]
  errorType: ErrorType
}

// ═══════════════════════════════════════════════════════════════
// PEDAGOGICAL STATE — Estado vivo de la sesión
// ═══════════════════════════════════════════════════════════════

export interface PedagogicalState {
  sessionId: string
  startedAt: number
  
  // Topic actual
  currentTopicId: string | null
  currentTopicTitle: string | null
  
  // Progreso de la sesión
  topicsCoveredThisSession: string[]
  topicsRemaining: string[]
  
  // Estado del tutor loop
  loopPhase: LoopPhase
  loopIteration: number         // Cuántas iteraciones en el topic actual
  
  // Historial reciente
  recentPages: BookPage[]       // Últimas 10 páginas mostradas
  recentInteractions: Interaction[]
  recentEvidence: EvidenceRecord[]
  
  // Contexto emocional
  studentEnergy: 'fresh' | 'engaged' | 'tired' | 'frustrated'
  streakCount: number           // Aciertos seguidos
  strugglingCount: number       // Fallos seguidos en el topic actual
  
  // Contadores
  totalPagesShown: number
  totalInteractions: number
  elapsedMinutes: number
}

export type LoopPhase =
  | 'introducing'        // Presentando el topic
  | 'teaching'           // Enseñando activamente
  | 'checking'           // Verificando comprensión
  | 'rescuing'           // Rescatando (falló, reexplicar)
  | 'practicing'         // Practicando aplicación
  | 'challenging'        // Reto más difícil
  | 'consolidating'      // Cierre del topic
  | 'transitioning'      // Pasando al siguiente topic
  | 'closing'            // Cerrando sesión

// ═══════════════════════════════════════════════════════════════
// PEDAGOGICAL DECISION — Lo que decide el cerebro
// ═══════════════════════════════════════════════════════════════

export interface PedagogicalDecision {
  // Qué hacer
  action: PedagogicalAction
  
  // Por qué (para debug y logs)
  reasoning: string
  
  // Contenido específico
  page: BookPage
  
  // Meta del cerebro
  targetTopicId: string
  targetDimension: MasteryDimension | null
  expectedNewPhase: LoopPhase
  
  // Predicción (para el planner)
  estimatedNextActions: PedagogicalAction[]
}

export type PedagogicalAction =
  | 'introduce_topic'
  | 'explain_concept'
  | 'show_example'
  | 'demonstrate_procedure'
  | 'ask_quick_check'
  | 'ask_deep_question'
  | 'give_exercise'
  | 'rescue_with_analogy'
  | 'rescue_with_example'
  | 'rescue_with_steps'
  | 'point_out_error'
  | 'compare_concepts'
  | 'connect_to_previous'
  | 'push_harder'
  | 'consolidate_topic'
  | 'transition_to_next'
  | 'give_break'
  | 'close_session'

export type MasteryDimension =
  | 'comprehension'
  | 'application'
  | 'memory'
  | 'transfer'
  | 'speed'
  | 'confidence'
  | 'retention'

// ═══════════════════════════════════════════════════════════════
// BOOK PAGE — La unidad visual del libro
// ═══════════════════════════════════════════════════════════════

export interface BookPage {
  id: string
  pageType: PageType
  
  // Contenido principal
  title?: string
  content: PageContent
  
  // Interacción (si la página requiere respuesta)
  interaction?: Interaction
  
  // Meta
  topicId: string
  createdAt: number
  isReteach?: boolean
  isRescue?: boolean
}

export type PageType =
  // Contenido teórico
  | 'theory'                 // Explicación de un concepto
  | 'warmup'                 // Introducción suave al topic
  | 'insight'                // Idea clave o truco
  | 'connection'             // Cómo se conecta con otros topics
  
  // Contenido con ejemplos
  | 'example'                // Ejemplo del material
  | 'guided_solution'        // Solución guiada paso a paso
  | 'formula_board'          // Presentación de fórmula
  | 'diagram'                // Diagrama descrito visualmente
  
  // Práctica
  | 'practice'               // Ejercicio para resolver
  | 'challenge'              // Reto más difícil
  | 'mini_challenge'         // Reto rápido
  
  // Rescate y corrección
  | 'error'                  // Mostrar y corregir error
  | 'rescue'                 // Reexplicación alternativa
  
  // Verificación
  | 'checkpoint'             // Verificar dominio antes de avanzar
  | 'exam_simulation'        // Simulacro de examen
  
  // Meta y cierre
  | 'summary'                // Resumen del topic
  | 'reflection'             // Metacognición
  | 'session_close'          // Cierre de sesión

export interface PageContent {
  // Contenido en bloques (permite mezclar texto + fórmulas + ejemplos)
  blocks: ContentBlock[]
  
  // Mensaje del tutor (voz de ALAI)
  tutorMessage?: string
  
  // Idea para recordar
  keyIdea?: string
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'heading'; text: string; level: 1 | 2 | 3 }
  | { type: 'formula'; latex?: string; plain: string; explanation?: string }
  | { type: 'example'; description: string; solution?: string }
  | { type: 'steps'; steps: Array<{ label: string; content: string; explanation?: string }> }
  | { type: 'comparison'; items: Array<{ label: string; description: string }> }
  | { type: 'callout'; variant: 'info' | 'warning' | 'success' | 'insight'; text: string }
  | { type: 'code'; language?: string; code: string }
  | { type: 'diagram'; description: string; ascii?: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string; source?: string }
  | { type: 'tutor_note'; text: string }        // Voz personal del tutor

// ═══════════════════════════════════════════════════════════════
// INTERACTION — Todos los tipos de interacción posibles
// ═══════════════════════════════════════════════════════════════

export interface Interaction {
  id: string
  interactionType: InteractionType
  prompt: string                    // La pregunta o instrucción
  data: InteractionData             // Datos específicos del tipo
  requiresConfidence?: boolean      // Si preguntar confianza
  timeLimit?: number                // Segundos opcional
}

export type InteractionType =
  // Básicos
  | 'multiple_choice'
  | 'true_false'
  | 'fill_blank'
  | 'fill_blank_bank'
  | 'open_response'
  
  // Relaciones
  | 'matching'
  | 'ordering'
  | 'classify_groups'
  | 'comparison_table'
  
  // Práctica
  | 'step_by_step_solver'
  | 'find_the_error'
  | 'complete_procedure'
  | 'complete_reaction_or_formula'
  | 'calculator_check'
  
  // Aplicación
  | 'practical_case'
  | 'prediction'
  | 'simulation_prompt'
  | 'choose_best_procedure'
  
  // Metacognición
  | 'teach_back'
  | 'final_reflection'
  | 'confidence_answer'
  
  // Visuales
  | 'identify_diagram_zones'
  | 'visual_timeline'
  
  // Adicionales
  | 'quick_check'                  // Verificación rápida (texto libre)
  | 'mini_challenge'                // Reto corto
  | 'explain_why'                   // Por qué pasa X
  | 'choose_next_step'              // Siguiente paso lógico
  | 'formula_builder'               // Armar fórmula
  | 'concept_map'                   // Mapa conceptual
  | 'continue'                      // Sin pregunta, solo continuar

// Datos específicos por tipo de interacción
export type InteractionData =
  | { type: 'multiple_choice'; options: string[]; correctIndex: number; explanation?: string }
  | { type: 'true_false'; statement: string; correctAnswer: boolean; explanation?: string }
  | { type: 'fill_blank'; template: string; correctAnswers: string[]; caseSensitive?: boolean }
  | { type: 'fill_blank_bank'; template: string; bank: string[]; correctAnswers: string[] }
  | { type: 'open_response'; acceptedAnswers?: string[]; rubric?: string[] }
  | { type: 'matching'; pairs: Array<{ left: string; right: string }> }
  | { type: 'ordering'; items: string[]; correctOrder: number[] }
  | { type: 'classify_groups'; items: string[]; groups: string[]; correctAssignments: Record<string, string> }
  | { type: 'comparison_table'; rows: string[]; columns: string[]; correctCells: Record<string, string> }
  | { type: 'step_by_step_solver'; problem: string; expectedSteps: string[]; finalAnswer: string }
  | { type: 'find_the_error'; workedSolution: string[]; errorStepIndex: number; explanation: string }
  | { type: 'complete_procedure'; steps: Array<{ label: string; content: string | null }>; correctAnswers: Record<number, string> }
  | { type: 'complete_reaction_or_formula'; template: string; correctAnswers: string[] }
  | { type: 'calculator_check'; problem: string; correctAnswer: number; tolerance?: number; units?: string }
  | { type: 'practical_case'; scenario: string; question: string; expectedElements: string[] }
  | { type: 'prediction'; setup: string; question: string; expectedAnswer: string }
  | { type: 'simulation_prompt'; setup: string; variableName: string; changeDescription: string; expectedOutcome: string }
  | { type: 'choose_best_procedure'; scenario: string; options: string[]; correctIndex: number; reasoning: string }
  | { type: 'teach_back'; concept: string; rubric: string[] }
  | { type: 'final_reflection'; prompts: string[] }
  | { type: 'confidence_answer'; question: string; acceptedAnswers: string[] }
  | { type: 'identify_diagram_zones'; diagramDescription: string; zones: Array<{ label: string; description: string }>; askedZone: string }
  | { type: 'visual_timeline'; events: string[]; correctOrder: number[] }
  | { type: 'quick_check'; question: string; acceptedAnswers: string[] }
  | { type: 'mini_challenge'; challenge: string; expectedApproach: string }
  | { type: 'explain_why'; phenomenon: string; expectedFactors: string[] }
  | { type: 'choose_next_step'; scenario: string; options: string[]; correctIndex: number }
  | { type: 'formula_builder'; targetConcept: string; components: string[]; correctFormula: string }
  | { type: 'concept_map'; centralConcept: string; relatedConcepts: string[]; expectedConnections: Array<{ from: string; to: string; relation: string }> }
  | { type: 'continue' }

// ═══════════════════════════════════════════════════════════════
// EVIDENCE RECORD — Registro de aprendizaje
// ═══════════════════════════════════════════════════════════════

export interface EvidenceRecord {
  id: string
  timestamp: number
  
  // Contexto
  topicId: string
  sessionId: string
  pageId: string
  interactionId?: string
  
  // Qué se evaluó
  dimension: MasteryDimension
  interactionType: InteractionType
  
  // Resultado
  correct: boolean
  score: number                    // 0-100
  strength: EvidenceStrength
  weight: number                   // Cuánto pesa esta evidencia
  
  // Detalles
  studentResponse: any
  expectedResponse: any
  responseTimeSeconds: number
  studentConfidence?: 'high' | 'medium' | 'low' | 'guess'
  
  // Análisis
  errorType?: ErrorType
  conceptsIdentified: string[]
  conceptsMissed: string[]
  
  // Meta
  wasReteach?: boolean
  wasRescue?: boolean
}

export type EvidenceStrength =
  | 'strong_positive'         // Correcto + rápido + seguro
  | 'weak_positive'           // Correcto pero inseguro/lento
  | 'neutral'
  | 'weak_negative'           // Incorrecto pero reconoce
  | 'strong_negative'         // Incorrecto con alta confianza

export type ErrorType =
  | 'no_error'
  | 'vocabulary'              // No conoce términos
  | 'concept_confusion'       // Confunde con otro concepto
  | 'incomplete_understanding'
  | 'application_error'       // Sabe teoría pero no aplica
  | 'procedure_error'         // Se equivoca en pasos
  | 'formula_misuse'          // Usa fórmula mal
  | 'memory_lapse'            // Olvidó
  | 'careless'                // Descuido
  | 'false_confidence'        // Muy seguro pero incorrecto

// ═══════════════════════════════════════════════════════════════
// GOAL — Qué quiere lograr el estudiante
// ═══════════════════════════════════════════════════════════════

export interface StudyGoal {
  primaryObjective: GoalType
  targetScore: number
  daysUntilDeadline: number | null
  sessionDurationMinutes: number
  urgency: 'low' | 'medium' | 'high' | 'critical'
  
  // Prioridades derivadas
  prioritizeSpeed: boolean         // Sacrificar profundidad por cobertura
  prioritizeDepth: boolean         // Ir más lento pero más completo
  prioritizeApplication: boolean   // Enfocarse en resolver ejercicios
  prioritizeConcepts: boolean      // Enfocarse en entender
}

export type GoalType =
  | 'exam_tomorrow'          // Modo rescate
  | 'exam_this_week'         // Intensivo
  | 'exam_this_month'        // Balanceado
  | 'deep_learning'          // Aprender bien sin prisa
  | 'quick_review'           // Repaso rápido
  | 'perfect_score'          // Dominio total (100)
  | 'just_pass'              // Solo aprobar

// ═══════════════════════════════════════════════════════════════
// SESSION BLUEPRINT — La misión de una sesión
// ═══════════════════════════════════════════════════════════════

export interface SessionBlueprint {
  sessionId: string
  sessionNumber: number
  
  // Misión (no lista de actividades)
  mission: string                  // "Dominar equilibrio químico"
  targetTopics: string[]           // IDs de topics a cubrir
  estimatedMinutes: number
  
  // Objetivos concretos verificables
  learningObjectives: Array<{
    objective: string              // "Podrá calcular pH desde [H+]"
    verificationCriteria: string   // Cómo saber si se cumplió
    priority: 'must_have' | 'should_have' | 'nice_to_have'
  }>
  
  // Tipo de sesión
  sessionKind: SessionKind
  
  // Meta
  createdAt: number
  status: 'locked' | 'ready' | 'in_progress' | 'completed'
}

export type SessionKind =
  | 'first_contact'          // Primera vez con el material
  | 'deep_dive'              // Profundizar en algo
  | 'connect_ideas'          // Relacionar topics
  | 'practice_heavy'         // Muchos ejercicios
  | 'rescue_weak_topics'     // Reforzar débiles
  | 'exam_simulation'        // Simulacro
  | 'final_review'           // Repaso final
  | 'consolidation'          // Consolidar dominio

// ═══════════════════════════════════════════════════════════════
// TUTOR VOICE — Cómo habla ALAI
// ═══════════════════════════════════════════════════════════════

export interface TutorVoiceContext {
  streakCount: number
  strugglingCount: number
  studentEnergy: 'fresh' | 'engaged' | 'tired' | 'frustrated'
  isFirstInteraction: boolean
  isSessionOpening: boolean
  isSessionClosing: boolean
  justMastered?: string             // Nombre del topic recién dominado
  justFailed?: string               // Concepto que acaba de fallar
}
