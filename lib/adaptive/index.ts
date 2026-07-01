// ═══════════════════════════════════════════════════════════════
// StudyAL Adaptive — Public API
// ═══════════════════════════════════════════════════════════════

// El cerebro
export { AdaptiveBrain } from './brain'
export type { BrainDecision, BrainContext, BrainState } from './brain'

// Tipos del programa
export type {
  AdaptiveProgram,
  AdaptiveSession,
  AdaptiveStep,
  AdaptiveProgramSetup,
  SessionPurpose,
  StepType,
  StepEngine,
  SessionStatus,
  ProgramStatus,
} from './program'

export {
  SESSION_PURPOSE_LABELS,
  SESSION_PURPOSE_EMOJI,
  STEP_TYPE_INSTRUCTION,
  DOMAIN_GAIN_BY_STEP_TYPE,
  EVIDENCE_ENGINES,
  SUPPORT_ENGINES,
  getDaysToExam,
  getExamDateLabel,
  getCurrentSession,
  getNextAvailableSession,
  getProgramProgress,
} from './program'

// Generator
export { generateAdaptiveProgram } from './generator'

// Updater
export {
  updateAdaptiveProgramAfterSession,
  getLatestStrategyChangeMessage,
} from './updater'

// Strategy
export { buildStudyStrategy, enrichStrategyWithUtility, shouldUpdateStrategy } from './strategy'
export type { StudyStrategy, StrategyType } from './strategy'

// Narrative
export { buildStrategyNarrative, buildProgramChangeMessage } from './narrative'
export type { StrategyNarrative } from './narrative'

// Student Memory
export type { StudentMemory, LearningPattern } from './studentMemory'
export {
  loadStudentMemory,
  saveStudentMemory,
  createEmptyStudentMemory,
  updateStudentMemoryAfterProgram,
  PATTERN_LABELS,
  PATTERN_EMOJI,
} from './studentMemory'

// Uncertainty
export type { DomainEstimate, ConfidenceLevel } from './uncertaintyModel'
export {
  calculateDomainEstimate,
  shouldTrustDomainForAdaptation,
  getAdaptationAggressiveness,
  formatDomainWithUncertainty,
} from './uncertaintyModel'

// Phases
export type { ProgramPhase, PhaseName } from './phases'
export { assignPhasesToSessions, getPhaseMessage } from './phases'

// Domain model
export {
  applyNonLinearGain,
  calculateDomainConfidence,
  detectPlateau,
  projectRealDomain,
} from './domainModel'

// Forgetting curve
export type { ConceptForgettingProfile } from './forgettingCurve'
export {
  createForgettingProfile,
  updateForgettingCurve,
  getConceptsDueForReview,
  generateReviewSchedule,
} from './forgettingCurve'

// Knowledge graph
export type { StudentKnowledgeGraph, ConceptNode, ConceptEdge } from './knowledgeGraph'
export {
  createEmptyGraph,
  upsertNode,
  addEdge,
  inferAtRiskConcepts,
  discoverEmpiricalRelations,
  propagateDomainGains,
} from './knowledgeGraph'

// Error causality
export type { ErrorPattern, ErrorMemory, ErrorCause } from './errorCausality'
export {
  createEmptyErrorMemory,
  detectErrorCause,
  recordError,
  buildRepairMessage,
  REPAIR_BY_CAUSE,
} from './errorCausality'

// Causal engine
export type { SequenceOutcome, CausalModel, ProgramCandidate } from './causalEngine'
export {
  createEmptyCausalModel,
  recordSequenceOutcome,
  getBestSequenceForStudent,
  evaluateProgramCandidates,
  DEFAULT_SEQUENCES,
} from './causalEngine'

// Pedagogical utility
export type { UtilityOption, PedagogicalPlan, FatigueSignal } from './utility'
export {
  calculateEngineUtility,
  detectObjectiveConflicts,
  projectDomainOverSessions,
  detectFatigue,
  generateDynamicSteps,
} from './utility'

// Replanner
export { shouldFullReplan, fullReplanProgram } from './replanner'

// ── Material Blueprint ───────────────────────────────────────────
export type {
  MaterialBlueprint,
  MaterialTopic,
  TopicConcept,
  TopicEvidenceRequirement,
  BlueprintValidationResult,
  BlueprintBuildParams,
} from './blueprint'

export {
  buildMaterialBlueprint,
  validateMaterialBlueprint,
  fallbackBlueprintFromText,
  getTopicForConcept,
  getTopicsByImportance,
  getTopicsByDifficulty,
  getAllConcepts,
  buildSessionTitle,
  buildSessionObjective,
  buildEvidenceGoal,
  getTopicConceptNames,
  isTopicDominated,
  isTopicWeak,
} from './blueprint'

// ── Blueprint Builder ────────────────────────────────────────────
export {
  fetchAndBuildBlueprint,
  buildBlueprintFromExistingAnalysis,
} from './blueprintBuilder'

export type { BuildBlueprintOptions } from './blueprintBuilder'
// ── Session topic context helper ────────────────────────────────
export { getSessionTopicContext } from './program'

// ── Topic Mastery helpers ────────────────────────────────────────
export {
  calculateTopicMastery,
  buildConceptScoreMap,
  getWeakTopics,
  getCriticalTopics,
  getDominatedTopics,
  calculateBlueprintOverallMastery,
} from './blueprint'

export type { TopicMasteryScore } from './blueprint'
// ── Strategy enrichment ──────────────────────────────────────────
export { enrichStrategyWhyWithTopics } from './strategy'

// ── AdaptiveContext universal ────────────────────────────────────
export {
  buildAdaptiveContext,
  serializeAdaptiveContext,
  buildFocusInstruction,
} from './adaptiveContext'
export type { AdaptiveContext } from './adaptiveContext'

// ── Exam Prediction ──────────────────────────────────────────────
export { buildExamPrediction } from './adaptiveContext'
export type { ExamPrediction } from './adaptiveContext'

// ── Learning Memory ──────────────────────────────────────────────
export {
  createEmptyLearningMemory,
  updateLearningMemory,
  loadLearningMemory,
  saveLearningMemory,
  getStyleBasedRoute,
} from './learningMemory'

export type {
  LearningMemory,
  LearningStyle,
  LearningPattern as LearningBehaviorPattern,
  SessionEvidence,
} from './learningMemory'
// ── Blueprint Refinement ─────────────────────────────────────────
export {
  analyzeBlueprintForRefinement,
  applyBlueprintRefinement,
} from './blueprintRefinement'
export type { RefinementAction, BlueprintRefinement } from './blueprintRefinement'

// ── Graph from Blueprint ─────────────────────────────────────────
export { buildGraphFromBlueprint } from './blueprintBuilder'
export type { BlueprintGraphRelation } from './blueprintBuilder'

// ── Global Concept Memory (longitudinal) ────────────────────────
export {
  loadGlobalMemory,
  saveGlobalMemory,
  updateGlobalMemory,
  isConceptAlreadyDominated,
  getConceptsNeedingReview,
  createEmptyGlobalMemory,
} from './learningMemory'
export type { GlobalConceptMemory } from './learningMemory'

// ── Observabilidad ───────────────────────────────────────────────
export {
  recordApiCall,
  getObservabilityState,
  measureApiCall,
  resetObservability,
} from './observability'
export type {
  ApiCallRecord,
  ObservabilityState,
  EndpointId,
  ErrorTaxonomy,
} from './observability'

// ── User Profile ─────────────────────────────────────────────────
export {
  buildUserProfile,
  buildProfileContext,
  getProfileDifficultyOffset,
  getProfileStrategyAdjustment,
  cacheUserProfile,
  loadCachedUserProfile,
} from './userProfile'
export type { UserProfile } from './userProfile'


export type { SessionLength } from './program'
export { SESSION_LENGTH_CONFIG } from './program'
