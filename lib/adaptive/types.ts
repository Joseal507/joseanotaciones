// ═══════════════════════════════════════════════════════════════
// StudyAL — Adaptive System Types v2
// El sistema que garantiza 100% del material, siempre.
// ═══════════════════════════════════════════════════════════════

// ── Área del material ────────────────────────────────────────────
export type SubjectArea =
  | 'medical'
  | 'math'
  | 'legal'
  | 'history'
  | 'science'
  | 'language'
  | 'general'
  | 'mixed'

// ── Tipo de conocimiento por concepto ───────────────────────────
export type KnowledgeType =
  | 'memorization'
  | 'conceptual'
  | 'procedural'
  | 'application'
  | 'analysis'
  | 'synthesis'
  | 'causal'
  | 'argumentative'
  | 'mathematical'
  | 'narrative'
  | 'memoristic'
  | 'visual'
  | 'medical'
  | 'legal'
  | 'historical'

// ── Objetivo de aprendizaje ──────────────────────────────────────
export type LearningGoal =
  | 'explain_concept'
  | 'apply_to_case'
  | 'solve_problem'
  | 'memorize_facts'
  | 'compare_contrast'
  | 'argue_position'
  | 'identify_pattern'
  | 'simulate_exam'
  | 'build_intuition'
  | 'follow_procedure'
  | 'analyze_cause_effect'

// ── Objetivo de evidencia ────────────────────────────────────────
export type EvidenceObjective =
  | 'recognition'
  | 'comprehension'
  | 'recall'
  | 'application'
  | 'transfer'
  | 'differentiation'
  | 'procedure'
  | 'synthesis'
  | 'retention'

// ── Tipo de pregunta ─────────────────────────────────────────────
export type QuestionType =
  | 'multiple_choice'
  | 'true_false'
  | 'short_answer'
  | 'open_explanation'
  | 'matching'
  | 'ordering'
  | 'fill_blank'
  | 'problem'
  | 'case'
  | 'error_detection'
  | 'comparison'
  | 'classification'
  | 'multi_select'

// ── Nivel de confianza ───────────────────────────────────────────
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'guess'

// ── Resultado de evidencia ───────────────────────────────────────
export type EvidenceResult =
  | 'strong_positive'
  | 'weak_positive'
  | 'neutral'
  | 'weak_negative'
  | 'strong_negative'

// ── Señal de fatiga ──────────────────────────────────────────────
export type FatigueLevel = 'low' | 'medium' | 'high'

// ── Modo de sesión ───────────────────────────────────────────────
export type SessionMode =
  | 'teaching'
  | 'checking'
  | 'practicing'
  | 'reviewing'
  | 'integrating'
  | 'summarizing'

// ── Tipo de sesión ───────────────────────────────────────────────
export type SessionType =
  | 'learning'
  | 'practice'
  | 'integration'
  | 'simulation'
  | 'review'
  | 'repair'

// ── Estado de cobertura ──────────────────────────────────────────
export type CoverageStatus =
  | 'not_started'
  | 'introduced'
  | 'practicing'
  | 'covered'
  | 'mastered'

// ── Acción del motor adaptativo ──────────────────────────────────
export type AdaptationAction =
  | 'advance'
  | 'reteach'
  | 'practice_more'
  | 'change_format'
  | 'increase_difficulty'
  | 'decrease_difficulty'
  | 'connect_concepts'
  | 'review_previous'
  | 'summarize'
  | 'pause_suggested'

// ═══════════════════════════════════════════════════════════════
// MATERIAL INTELLIGENCE
// ═══════════════════════════════════════════════════════════════

// Unidad mínima de cobertura — TODO el material debe terminar aquí
export interface CoverageUnit {
  id: string
  title: string
  sourceMaterialId: string
  sourcePage?: number
  rawTextReference: string
  importance: 'low' | 'medium' | 'high' | 'critical'
  knowledgeType: KnowledgeType
  recommendedTeachingStrategies: string[]
  recommendedAssessmentStrategies: string[]
}

// Nodo de concepto con relaciones
export interface ConceptNode {
  id: string
  name: string
  explanation: string
  sourceUnitIds: string[]
  prerequisites: string[]       // ids de conceptos que deben venir antes
  relatedConcepts: string[]
  difficulty: number            // 0-100
  anchorConcept: boolean        // si es ancla, prioridad de enseñanza
  knowledgeType: KnowledgeType
}

// Dependencia entre conceptos
export interface ConceptDependency {
  from: string    // concepto que requiere
  to: string      // concepto requerido
  strength: 'required' | 'helpful' | 'related'
}

// Elemento del material — ejemplos, problemas, fórmulas, etc.
export interface MaterialExample {
  id: string
  description: string
  conceptIds: string[]
  sourceUnitId: string
}

export interface MaterialProblem {
  id: string
  description: string
  solution?: string
  conceptIds: string[]
  sourceUnitId: string
}

export interface FormulaItem {
  id: string
  formula: string
  description: string
  conceptIds: string[]
}

export interface DefinitionItem {
  id: string
  term: string
  definition: string
  conceptIds: string[]
}

export interface ProcessItem {
  id: string
  name: string
  steps: string[]
  conceptIds: string[]
}

export interface CommonMistake {
  id: string
  description: string
  conceptIds: string[]
  correction: string
}

export interface ExamRelevantItem {
  id: string
  coverageUnitId: string
  reason: string
  likelihood: 'low' | 'medium' | 'high'
}

// Análisis completo del material
export interface MaterialAnalysis {
  materialTitle: string
  subjectArea: SubjectArea
  difficultyLevel: 'basic' | 'intermediate' | 'advanced'
  totalCoverageUnits: CoverageUnit[]
  concepts: ConceptNode[]
  dependencies: ConceptDependency[]
  examplesFromMaterial: MaterialExample[]
  problemsFromMaterial: MaterialProblem[]
  formulas: FormulaItem[]
  definitions: DefinitionItem[]
  processes: ProcessItem[]
  commonMistakes: CommonMistake[]
  examRelevantItems: ExamRelevantItem[]
  analyzedAt: number
}

// ═══════════════════════════════════════════════════════════════
// STUDENT MODEL
// ═══════════════════════════════════════════════════════════════

// Dominio por concepto — evidencia multidimensional
export interface ConceptMastery {
  conceptId: string
  masteryScore: number          // 0-100 score global
  recognition: number           // reconoce el concepto
  comprehension: number         // entiende qué significa
  application: number           // puede aplicarlo
  transfer: number              // lo aplica en contextos nuevos
  retention: number             // lo recuerda después de tiempo
  confidence: number            // nivel de confianza calibrado
  lastSeenAt?: string
  lastAssessedAt?: string
  evidenceCount: number
  falseConfidenceDetected: boolean
  commonErrors: string[]
}

// Estado de cobertura por unidad
export interface UnitCoverageStatus {
  coverageUnitId: string
  status: CoverageStatus
  taughtAt?: string
  assessedAt?: string
  needsReview: boolean
}

// Preferencias observadas — se descubren, no se preguntan
export interface ObservedLearningPreferences {
  prefersExamplesFirst: boolean       // aprende mejor con ejemplos antes que teoría
  prefersShortExplanations: boolean   // prefiere bloques cortos
  respondsWellToAnalogy: boolean      // analogías le funcionan bien
  respondsWellToCases: boolean        // casos prácticos le funcionan
  typicalResponseTimeSeconds: number  // velocidad promedio
  fatigueOnsetMinutes: number         // cuándo empieza a bajar el rendimiento
}

// Señal de fatiga
export interface FatigueSignal {
  detectedAt: string
  responseTimeIncrease: number
  errorRateIncrease: number
  sessionMinutes: number
}

// Historial de sesión
export interface AdaptiveSessionRecord {
  sessionId: string
  sessionNumber: number
  completedAt: string
  durationMinutes: number
  coverageUnitsCovered: string[]
  conceptsImproved: string[]
  averageScore: number
  fatigueDetected: boolean
}

// Modelo del estudiante — todo lo que el sistema sabe de él
export interface StudentModel {
  studentId: string
  materialId: string
  selfReportedLevel: string
  targetGrade: string
  examDate?: string
  preferredSessionMinutes: number
  conceptMastery: Record<string, ConceptMastery>
  coverageStatus: Record<string, UnitCoverageStatus>
  learningPreferencesObserved: ObservedLearningPreferences
  recurringErrors: Array<{ conceptId: string; errorType: string; count: number }>
  confidenceCalibration: {
    overallBias: 'overconfident' | 'underconfident' | 'calibrated'
    falseConfidenceCount: number
  }
  fatigueSignals: FatigueSignal[]
  sessionHistory: AdaptiveSessionRecord[]
  createdAt: string
  updatedAt: string
}

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC ENGINE
// ═══════════════════════════════════════════════════════════════

// Capa de diagnóstico — qué nivel evalúa
export type DiagnosticLayer = 'recognition' | 'comprehension' | 'application' | 'transfer'

// Pregunta de diagnóstico
export interface DiagnosticQuestion {
  id: string
  coverageUnitIds: string[]
  conceptIds: string[]
  layer: DiagnosticLayer
  type: QuestionType
  prompt: string
  options?: string[]
  correctAnswer: any
  explanation: string
  difficulty: number
  evidenceWeight: number
}

// Resultado del diagnóstico
export interface DiagnosticResult {
  questionsAsked: number
  conceptsEvaluated: string[]
  layerResults: Record<DiagnosticLayer, { correct: number; total: number }>
  falseConfidenceDetected: boolean
  estimatedLevel: 'zero' | 'basic' | 'intermediate' | 'advanced'
  conceptsKnown: string[]
  conceptsUnknown: string[]
  conceptsPartial: string[]
  recommendedStartingPoint: string
}

// ═══════════════════════════════════════════════════════════════
// PLANNING ENGINE
// ═══════════════════════════════════════════════════════════════

// Plan de sesión individual
export interface AdaptiveSessionPlan {
  id: string
  sessionNumber: number
  title: string
  estimatedMinutes: number
  objectives: string[]
  coverageUnitIds: string[]     // OBLIGATORIO — 100% del material
  conceptIds: string[]
  teachingStrategy: string
  assessmentStrategy: string
  retentionItems: string[]      // unidades que necesitan repaso
  sessionType: SessionType
}

// Plan completo del programa
export interface AdaptiveProgramPlan {
  planId: string
  totalCoverageRequired: 100    // SIEMPRE 100 — nunca menos
  estimatedSessions: AdaptiveSessionPlan[]
  coverageMap: Record<string, string>   // unitId -> sessionId
  strategySummary: string
  warnings: string[]
  createdAt: number
  examDate?: string
  targetGrade: string
}

// ═══════════════════════════════════════════════════════════════
// TEACHING ENGINE
// ═══════════════════════════════════════════════════════════════

// Bloque de enseñanza
export type TeachingBlockType =
  | 'explanation'
  | 'example'
  | 'guided_practice'
  | 'check'
  | 'summary'
  | 'connection'
  | 'reflection'

export interface TeachingBlock {
  id: string
  type: TeachingBlockType
  content: string
  keyIdea?: string
  recallPrompt?: string
  coverageUnitIds: string[]
  conceptIds: string[]
  nextExpectedAction: string
  representationUsed: string    // qué tipo de representación se usó
}

// ═══════════════════════════════════════════════════════════════
// ASSESSMENT ENGINE
// ═══════════════════════════════════════════════════════════════

// Registro de evidencia generada por una interacción
export interface EvidenceRecord {
  conceptId: string
  coverageUnitId: string
  objective: EvidenceObjective
  questionType: QuestionType
  result: EvidenceResult
  evidenceWeight: number
  errorType?: string
  confidenceSignal: ConfidenceLevel
  responseTimeSeconds: number
  timestamp: string
}

// ═══════════════════════════════════════════════════════════════
// ADAPTATION ENGINE
// ═══════════════════════════════════════════════════════════════

// Input de cada interacción del estudiante
export interface InteractionInput {
  answerCorrect: boolean
  responseTimeSeconds: number
  confidence: ConfidenceLevel
  answerText?: string
  questionType: QuestionType
  evidenceObjective: EvidenceObjective
  conceptIds: string[]
  coverageUnitIds: string[]
  helpUsed: boolean
  errorType?: string
}

// Output del motor de adaptación
export interface AdaptationOutput {
  nextAction: AdaptationAction
  reason: string
  updatedMastery: ConceptMastery[]
  teachingAdjustment: string
  adaptationDimensions: {
    rhythm: 'faster' | 'same' | 'slower'
    depth: 'deeper' | 'same' | 'lighter'
    format: string
    sequence: 'continue' | 'jump_ahead' | 'go_back'
    tone: 'dense' | 'same' | 'lighter'
  }
}

// ═══════════════════════════════════════════════════════════════
// SESSION STATE
// ═══════════════════════════════════════════════════════════════

// Interacción individual dentro de la sesión
export interface AdaptiveInteraction {
  id: string
  type: string
  conceptIds: string[]
  coverageUnitIds: string[]
  prompt?: string
  studentAnswer?: any
  correct?: boolean
  confidence?: ConfidenceLevel
  responseTimeSeconds?: number
  feedback?: string
  evidenceGenerated?: EvidenceRecord
  createdAt: string
}

// Estado de sesión activa
export interface AdaptiveSessionState {
  sessionId: string
  planId: string
  sessionNumber: number
  currentCoverageUnitIds: string[]
  completedCoverageUnitIds: string[]
  pendingCoverageUnitIds: string[]
  currentConceptIds: string[]
  interactionHistory: AdaptiveInteraction[]
  startedAt: string
  targetMinutes: number
  elapsedMinutes: number
  fatigueLevel: FatigueLevel
  currentMode: SessionMode
  coveragePercent: number       // % del material de ESTA sesión cubierto
}

// ═══════════════════════════════════════════════════════════════
// MASTERY ENGINE
// ═══════════════════════════════════════════════════════════════

// Criterios de dominio según objetivo del estudiante
export interface MasteryCriteria {
  targetGrade: string
  masteryScoreRequired: number
  recognitionRequired: number
  comprehensionRequired: number
  applicationRequired: number
  transferRequired: number
  retentionRequired: number
  evidenceCountRequired: number
}

export const MASTERY_CRITERIA: Record<string, MasteryCriteria> = {
  pass: {
    targetGrade: 'pass',
    masteryScoreRequired: 65,
    recognitionRequired: 60,
    comprehensionRequired: 60,
    applicationRequired: 50,
    transferRequired: 40,
    retentionRequired: 50,
    evidenceCountRequired: 2,
  },
  '80': {
    targetGrade: '80',
    masteryScoreRequired: 75,
    recognitionRequired: 70,
    comprehensionRequired: 70,
    applicationRequired: 65,
    transferRequired: 55,
    retentionRequired: 65,
    evidenceCountRequired: 3,
  },
  '90': {
    targetGrade: '90',
    masteryScoreRequired: 85,
    recognitionRequired: 80,
    comprehensionRequired: 80,
    applicationRequired: 75,
    transferRequired: 65,
    retentionRequired: 70,
    evidenceCountRequired: 4,
  },
  '100': {
    targetGrade: '100',
    masteryScoreRequired: 92,
    recognitionRequired: 88,
    comprehensionRequired: 88,
    applicationRequired: 85,
    transferRequired: 80,
    retentionRequired: 75,
    evidenceCountRequired: 5,
  },
}

// ═══════════════════════════════════════════════════════════════
// FINAL READINESS
// ═══════════════════════════════════════════════════════════════

export interface ReadinessReport {
  overallReady: boolean
  coverageComplete: boolean     // 100% del material cubierto
  masteredUnits: string[]
  weakUnits: string[]
  criticalGaps: string[]
  recommendedFinalReview: string[]
  estimatedScore: number
  confidenceInEstimate: number
  lastMinuteTips: string[]
  generatedAt: string
}

// ═══════════════════════════════════════════════════════════════
// INTAKE DEL USUARIO
// ═══════════════════════════════════════════════════════════════

export interface StudentIntake {
  selfReportedLevel: 'zero' | 'some' | 'review' | 'practice'
  sessionDurationMinutes: number
  examDate: string
  targetGrade: string
  materialIds: string[]
  evalPreference?: 'quick_test' | 'write_explain' | 'mix_everything'
}

// ═══════════════════════════════════════════════════════════════
// RESUMEN DE SESIÓN
// ═══════════════════════════════════════════════════════════════

export interface AdaptiveSessionSummary {
  sessionId: string
  sessionNumber: number
  durationMinutes: number
  coverageUnitsCovered: string[]
  coverageUnitsTitles: string[]
  totalCoveragePercent: number    // % del material TOTAL cubierto hasta ahora
  conceptsImproved: string[]
  conceptsStillWeak: string[]
  averageScore: number
  fatigueDetected: boolean
  nextSessionPreview: string
  motivationalMessage: string
  canSay: string[]                // "Ya puedes..."
  stillWorking: string[]          // "Estamos reforzando..."
}
