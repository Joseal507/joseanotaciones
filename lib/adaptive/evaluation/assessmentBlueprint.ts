import type { CognitiveDimension } from '../v3/engine/masteryContract'
import type { VisualEvidenceKind } from '../visual/visualContract'

export type AssessmentObjectiveStatus =
  | 'not_assessed'
  | 'in_progress'
  | 'demonstrated'
  | 'failed'
  | 'recovery_required'

export interface SourceSpan {
  stepId: string
  factKey: string
  blockId?: string
}

export interface AssessmentObjective {
  objectiveId: string
  sessionId: string
  stepId: string
  microId: string
  // factKeys = requiredFactKeys: todo lo que este objective necesita ver
  // demostrado (Fase 1 — question coverage). Nunca se renombra el campo para
  // no romper la persistencia existente; el nombre es histórico, el
  // significado es "requerido".
  factKeys: string[]
  // demonstratedFactKeys ⊆ factKeys — SOLO factKeys que una pregunta
  // REALMENTE targeteó (question.targetFactKeys ∩ objective.factKeys) y que
  // se respondieron correcta e independientemente. Nunca se agrega
  // objective.factKeys completo por pertenecer al mismo objective — eso
  // sería demostrar F5 solo porque comparte objective con F1 (false mastery
  // por asociación amplia).
  demonstratedFactKeys: string[]
  cognitiveTarget: CognitiveDimension
  importance: number
  taught: boolean
  practiced: boolean
  assessed: boolean
  // independentlyCorrect ahora significa "completamente demostrado"
  // (factKeys ⊆ demonstratedFactKeys) — antes significaba "al menos una vez
  // correcto, alguna vez" (el bug de false mastery original). Se mantiene el
  // nombre del campo por compatibilidad con los consumidores existentes
  // (demonstratedObjectiveIds, UI); el significado es deliberadamente más
  // estricto ahora.
  independentlyCorrect: boolean
  assistedCorrect: boolean
  failedAttempts: number
  evidenceIds: string[]
  status: AssessmentObjectiveStatus
  subsumedByObjectiveId?: string
  // requiredEvidenceKind: cuando está presente, SOLO evidencia con result.evidenceKind
  // === requiredEvidenceKind puede demostrar este objective (ver recordAssessmentEvidence).
  // undefined preserva el comportamiento histórico (cualquier evidencia textual válida
  // basta) — nunca se setea salvo que un VisualRequirement required_for_mastery lo pida
  // explícitamente (FASE 5: una MCQ textual correcta no puede "false-master" un
  // objective que exige construcción/manipulación visual).
  requiredEvidenceKind?: VisualEvidenceKind
}

// unresolvedFactKeys es SIEMPRE derivado, nunca almacenado — evita que un
// tercer campo (redundante con factKeys/demonstratedFactKeys) pueda
// desincronizarse.
export const unresolvedFactKeys = (objective: AssessmentObjective): string[] =>
  objective.factKeys.filter(factKey => !objective.demonstratedFactKeys.includes(factKey))

export const isFullyDemonstrated = (objective: AssessmentObjective): boolean =>
  objective.factKeys.length > 0 && unresolvedFactKeys(objective).length === 0

// Migración conservadora de estado persistido con el shape anterior (sin
// demonstratedFactKeys): nunca fabrica dominio a partir del booleano viejo
// (independentlyCorrect === "alguna vez correcto", una garantía MÁS DÉBIL
// que la nueva). Un objective restaurado sin evidencia por-factKey conocida
// arranca con demonstratedFactKeys=[] — puede pedir evidencia otra vez para
// factKeys que bajo la regla vieja ya "contaban", pero nunca al revés.
export function normalizeAssessmentObjective(raw: unknown): AssessmentObjective | null {
  if (!raw || typeof raw !== 'object') return null
  const objective = raw as Partial<AssessmentObjective> & Record<string, unknown>
  if (typeof objective.objectiveId !== 'string' || !Array.isArray(objective.factKeys)) return null
  const factKeys = [...new Set(objective.factKeys.map(String).filter(Boolean))]
  const demonstratedFactKeys = Array.isArray(objective.demonstratedFactKeys)
    ? [...new Set(objective.demonstratedFactKeys.map(String).filter(factKey => factKeys.includes(factKey)))]
    : []
  const normalized: AssessmentObjective = {
    objectiveId: objective.objectiveId,
    sessionId: String(objective.sessionId ?? ''),
    stepId: String(objective.stepId ?? ''),
    microId: String(objective.microId ?? ''),
    factKeys,
    demonstratedFactKeys,
    cognitiveTarget: (objective.cognitiveTarget as CognitiveDimension) ?? 'comprehension',
    importance: Number.isFinite(objective.importance) ? Number(objective.importance) : 0.7,
    taught: Boolean(objective.taught),
    practiced: Boolean(objective.practiced),
    assessed: Boolean(objective.assessed),
    independentlyCorrect: false, // recalculado abajo — nunca se hereda el booleano viejo tal cual
    assistedCorrect: Boolean(objective.assistedCorrect),
    failedAttempts: Number.isFinite(objective.failedAttempts) ? Number(objective.failedAttempts) : 0,
    evidenceIds: Array.isArray(objective.evidenceIds) ? objective.evidenceIds.map(String) : [],
    status: (typeof objective.status === 'string' ? objective.status as AssessmentObjectiveStatus : 'not_assessed'),
    subsumedByObjectiveId: typeof objective.subsumedByObjectiveId === 'string' ? objective.subsumedByObjectiveId : undefined,
    requiredEvidenceKind: typeof objective.requiredEvidenceKind === 'string' ? objective.requiredEvidenceKind as VisualEvidenceKind : undefined,
  }
  normalized.independentlyCorrect = isFullyDemonstrated(normalized)
  // Si el status persistido decía 'demonstrated' pero, bajo la regla nueva,
  // ya no está completamente demostrado (factKeys sin cubrir), no debe
  // seguir reportándose como resuelto — se reabre a un estado que sí exige
  // más evidencia sin perder lo que sí quedó registrado.
  if (normalized.status === 'demonstrated' && !normalized.independentlyCorrect) {
    normalized.status = normalized.assessed ? 'in_progress' : 'not_assessed'
  }
  return normalized
}

export function normalizeAssessmentBlueprint(raw: unknown): AssessmentBlueprint | null {
  if (!raw || typeof raw !== 'object') return null
  const blueprint = raw as Partial<AssessmentBlueprint> & Record<string, unknown>
  if (typeof blueprint.sessionId !== 'string' || !Array.isArray(blueprint.objectives)) return null
  const objectives = blueprint.objectives
    .map(normalizeAssessmentObjective)
    .filter((objective): objective is AssessmentObjective => objective !== null)
  return refreshBlueprint(blueprint.sessionId, Number(blueprint.version) || 1, objectives)
}

export interface AssessmentBlueprint {
  sessionId: string
  version: number
  objectives: AssessmentObjective[]
  taughtObjectiveIds: string[]
  assessedObjectiveIds: string[]
  demonstratedObjectiveIds: string[]
  unresolvedObjectiveIds: string[]
  coverageRatio: number
}

export interface AssessmentStepDeclaration {
  id: string
  type: string
  microId?: string
  factKeys?: string[]
  cognitiveTarget?: CognitiveDimension
  objectiveIds?: string[]
  relatedBlockIds?: string[]
  importance?: number
  requiredEvidenceKind?: VisualEvidenceKind
}

export interface AssessmentQuestionTarget {
  targetObjectiveIds: string[]
  microId: string
  factKeys: string[]
  cognitiveTarget: CognitiveDimension
  questionText?: string
}

export interface AssessmentQuestionPlan {
  plannedQuestions: Array<{
    plannedQuestionId: string
    targetObjectiveIds: string[]
    preferredTypes: string[]
    rationale: string
  }>
  projectedCoverage: number
}

const DIMENSIONS = new Set<CognitiveDimension>(['recognition', 'comprehension', 'application', 'transfer'])

function declaredDimension(step: AssessmentStepDeclaration): CognitiveDimension {
  if (step.cognitiveTarget && DIMENSIONS.has(step.cognitiveTarget)) return step.cognitiveTarget
  if (step.type === 'formula' || step.type === 'example') return 'application'
  if (step.type === 'connection') return 'transfer'
  if (step.type === 'concept' || step.type === 'warning') return 'comprehension'
  return 'recognition'
}

function refreshBlueprint(sessionId: string, version: number, objectives: AssessmentObjective[]): AssessmentBlueprint {
  const taught = objectives.filter(objective => objective.taught)
  const assessed = taught.filter(objective => objective.assessed)
  // demonstrated/unresolved se derivan SIEMPRE de factKeys ⊆ demonstratedFactKeys
  // — nunca del campo `status` (una cadena mutable que solo refleja la ÚLTIMA
  // evidencia). Si un objective tiene 2 factKeys y F1 falla mientras F2
  // después se responde bien, `status` pasaría a 'in_progress' (por la
  // evidencia más reciente) aunque F1 siga sin demostrarse — leer eso como
  // "resuelto" sería exactamente el false-mastery-por-status-obsoleto que
  // esto existe para prevenir. isFullyDemonstrated() es monótono (
  // demonstratedFactKeys nunca decrece) y no puede quedar enmascarado por
  // evidencia posterior de OTRO factKey del mismo objective.
  const demonstrated = taught.filter(isFullyDemonstrated)
  const unresolved = taught.filter(objective => !isFullyDemonstrated(objective))
  return {
    sessionId,
    version,
    objectives,
    taughtObjectiveIds: taught.map(objective => objective.objectiveId),
    assessedObjectiveIds: assessed.map(objective => objective.objectiveId),
    demonstratedObjectiveIds: demonstrated.map(objective => objective.objectiveId),
    unresolvedObjectiveIds: unresolved.map(objective => objective.objectiveId),
    coverageRatio: taught.length === 0 ? 1 : assessed.length / taught.length,
  }
}

export function buildAssessmentBlueprint(
  steps: AssessmentStepDeclaration[],
  sessionId: string,
  version = 1,
): AssessmentBlueprint {
  const objectives: AssessmentObjective[] = []
  const seen = new Set<string>()
  for (const step of steps) {
    const declaredFacts = [...new Set(
      (step.factKeys?.length ? step.factKeys : step.relatedBlockIds?.length ? step.relatedBlockIds : [step.id])
        .map(String)
        .filter(Boolean),
    )]
    const declaredIds = step.objectiveIds?.length
      ? step.objectiveIds
      : declaredFacts.map(factKey => `${sessionId}:${step.id}:${factKey}`)
    // declaredIds (un objectiveId por keyPoint, ver session-teach/route.ts) y
    // declaredFacts (factKeys, un hecho atómico literal) son arrays
    // INDEPENDIENTES sin garantía de igual longitud — un keyPoint puede
    // resumir varios factKeys, o un step puede declarar más factKeys que
    // keyPoints. Zipear por posición (factKeys[index]) dejaba factKeys fuera
    // de rango del bucle (bounded por declaredIds.length) sin representación
    // evaluable — nunca targeteables, y aun así la sesión podía declararse
    // completa (issue #7).
    //
    // El fix original de #7 asignaba TODOS los factKeys del step a CADA
    // objective — garantizaba representación, pero bajo Demonstration
    // Coverage (Fase 2, regla 1: solo la intersección real entre lo que una
    // pregunta targetea y lo que el objective requiere puede demostrarse) eso
    // vuelve UN objective permanentemente irresoluble en cuanto
    // factKeys.length > keyPoints.length: sus factKeys "prestados" de un
    // keyPoint hermano solo los targetea la pregunta de ESE hermano (que
    // aporta evidencia al objectiveId del hermano, nunca a este), así que la
    // intersección para esos factKeys nunca se cumple. Reproducido en
    // session-completion-edge-cases.spec.ts: coverage=100% pero
    // unresolvedObjectiveIds nunca baja de 2/2 aunque ambas preguntas se
    // respondan y la recovery se resuelva.
    //
    // Fix: distribuir declaredFacts EXCLUSIVAMENTE (round-robin) entre
    // declaredIds — cada factKey pertenece a exactamente un objective. Sigue
    // garantizando #7 (todo factKey enseñado pertenece a algún objective
    // evaluable) sin inventar una unidad nueva, y ahora cada objective solo
    // exige factKeys que una pregunta que lo targetea a ÉL podría
    // realísticamente demostrar.
    const factKeysPerObjective: string[][] = declaredIds.map(() => [])
    declaredFacts.forEach((factKey, index) => {
      const objectiveIndex = declaredIds.length > 0 ? index % declaredIds.length : 0
      factKeysPerObjective[objectiveIndex]?.push(factKey)
    })
    declaredIds.forEach((objectiveId, index) => {
      if (!objectiveId || seen.has(objectiveId)) return
      seen.add(objectiveId)
      const primaryFactKey = declaredFacts[index] || declaredFacts[0] || step.id
      const ownFactKeys = factKeysPerObjective[index]
      objectives.push({
        objectiveId,
        sessionId,
        stepId: step.id,
        microId: step.microId || primaryFactKey,
        factKeys: ownFactKeys?.length ? ownFactKeys : [primaryFactKey],
        demonstratedFactKeys: [],
        cognitiveTarget: declaredDimension(step),
        importance: Number.isFinite(step.importance) ? Math.max(0, Math.min(1, Number(step.importance))) : 0.7,
        taught: true,
        practiced: false,
        assessed: false,
        independentlyCorrect: false,
        assistedCorrect: false,
        failedAttempts: 0,
        evidenceIds: [],
        status: 'not_assessed',
        requiredEvidenceKind: step.requiredEvidenceKind,
      })
    })
  }
  return refreshBlueprint(sessionId, version, objectives)
}

export const getUnassessedObjectives = (blueprint: AssessmentBlueprint): AssessmentObjective[] =>
  blueprint.objectives.filter(objective => objective.taught && !objective.assessed && !objective.subsumedByObjectiveId)

export const getUnresolvedObjectives = (blueprint: AssessmentBlueprint): AssessmentObjective[] =>
  blueprint.objectives.filter(objective => blueprint.unresolvedObjectiveIds.includes(objective.objectiveId))

export const calculateAssessmentCoverage = (blueprint: AssessmentBlueprint): number =>
  refreshBlueprint(blueprint.sessionId, blueprint.version, blueprint.objectives).coverageRatio

export function recordAssessmentEvidence(
  blueprint: AssessmentBlueprint,
  targetObjectiveIds: string[],
  targetFactKeys: string[],
  result: { valid: boolean; correct: boolean; independent: boolean; evidenceId?: string; evidenceKind?: VisualEvidenceKind },
): AssessmentBlueprint {
  const targets = new Set(targetObjectiveIds)
  const answeredFacts = new Set(targetFactKeys)
  const objectives = blueprint.objectives.map(objective => {
    if (!targets.has(objective.objectiveId) || !result.valid) return objective
    // Retry/duplicado: si este evidenceId ya se procesó, no reprocesar — evita
    // que un reintento de red vuelva a contar failedAttempts o reabra una
    // ronda ya resuelta. Idempotente incluso sin este guard (el Set de abajo
    // no duplicaría valores), pero esto además evita inflar failedAttempts.
    if (result.evidenceId && objective.evidenceIds.includes(result.evidenceId)) return objective
    // FASE 5 (visual): si el objective exige un tipo de evidencia concreto
    // (p.ej. visual_construction), evidencia de otro tipo (p.ej. una MCQ
    // textual correcta, evidenceKind undefined/'textual') nunca puede
    // demostrarlo — solo puede quedar registrada como intento (assessed/
    // assistedCorrect/failedAttempts se actualizan igual), nunca como
    // demonstratedFactKeys. Objectives sin requiredEvidenceKind (el caso de
    // siempre) no cambian de comportamiento.
    const evidenceKindSatisfied = !objective.requiredEvidenceKind || objective.requiredEvidenceKind === result.evidenceKind
    // Regla 1/2: SOLO la intersección entre lo que esta pregunta realmente
    // targeteó y lo que el objective requiere puede demostrarse — nunca
    // objective.factKeys completo por pertenecer al mismo objective (eso
    // sería demostrar F5 solo porque comparte objective con F1).
    const demonstrableNow = objective.factKeys.filter(factKey => answeredFacts.has(factKey))
    // Regla 3: una respuesta incorrecta nunca agrega a demonstratedFactKeys.
    const demonstratedFactKeys = result.correct && result.independent && evidenceKindSatisfied
      ? [...new Set([...objective.demonstratedFactKeys, ...demonstrableNow])]
      : objective.demonstratedFactKeys
    const updated: AssessmentObjective = {
      ...objective,
      practiced: true,
      assessed: true,
      demonstratedFactKeys,
      assistedCorrect: objective.assistedCorrect || (result.correct && !result.independent),
      failedAttempts: objective.failedAttempts + (result.correct ? 0 : 1),
      evidenceIds: result.evidenceId && !objective.evidenceIds.includes(result.evidenceId)
        ? [...objective.evidenceIds, result.evidenceId]
        : objective.evidenceIds,
      independentlyCorrect: false, // recalculado abajo desde demonstratedFactKeys, nunca heredado
      status: 'not_assessed', // idem
    }
    updated.independentlyCorrect = isFullyDemonstrated(updated)
    // status es informativo/UI (refleja la evidencia MÁS RECIENTE) — la
    // decisión de bloqueo real (unresolved/completion) nunca lee este campo,
    // lee isFullyDemonstrated() directamente (ver refreshBlueprint).
    updated.status = updated.independentlyCorrect
      ? 'demonstrated'
      : result.correct
        ? 'in_progress'
        : 'recovery_required'
    return updated
  })
  return refreshBlueprint(blueprint.sessionId, blueprint.version, objectives)
}

export function canCompleteSessionFromAssessment(
  blueprint: AssessmentBlueprint,
  activeRecoveryTargetIds: string[] = [],
): boolean {
  return calculateAssessmentCoverage(blueprint) === 1 &&
    getUnresolvedObjectives(blueprint).length === 0 &&
    activeRecoveryTargetIds.length === 0
}

function compatibleTypes(objective: AssessmentObjective, quick: boolean): string[] {
  if (objective.cognitiveTarget === 'application' || objective.cognitiveTarget === 'transfer') {
    return quick
      ? ['scenario', 'matching', 'ordering', 'find_the_error', 'multi_select']
      : ['scenario', 'numeric_problem', 'short_response', 'matching']
  }
  if (objective.cognitiveTarget === 'comprehension') {
    return ['multiple_choice', 'matching', 'classify', 'scenario']
  }
  return ['multiple_choice', 'true_false', 'word_bank', 'classify']
}

export function planAssessmentQuestions(input: {
  objectives: AssessmentObjective[]
  evaluationPreference: unknown
  urgency?: unknown
  finalReview?: boolean
  priorEvidence?: unknown
  recentQuestionHistory?: unknown
}): AssessmentQuestionPlan {
  const pending = input.objectives.filter(objective => objective.taught && !objective.assessed)
  const quick = String(input.evaluationPreference) === 'quick_test'
  const finalReviewTypes = [
    ['scenario', 'multi_select'],
    ['multiple_choice', 'find_the_error'],
    ['matching', 'classify'],
  ]
  const plannedQuestions = pending.map((objective, index) => ({
    plannedQuestionId: `planned:${objective.objectiveId}`,
    targetObjectiveIds: [objective.objectiveId],
    preferredTypes: input.finalReview && index < finalReviewTypes.length
      ? finalReviewTypes[index]
      : compatibleTypes(objective, quick),
    rationale: `Obtener evidencia ${objective.cognitiveTarget} para el objetivo enseñado ${objective.objectiveId}.`,
  }))
  return {
    plannedQuestions,
    projectedCoverage: input.objectives.length === 0
      ? 1
      : (input.objectives.length - pending.length + plannedQuestions.length) / input.objectives.length,
  }
}

const sameSet = (left: string[], right: string[]): boolean =>
  left.length === right.length && new Set(left).size === new Set(right).size &&
  left.every(value => right.includes(value))

export function validateQuestionAgainstAssessmentBlueprint(
  question: AssessmentQuestionTarget,
  blueprint: AssessmentBlueprint,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!question.targetObjectiveIds.length) errors.push('ASSESSMENT_OBJECTIVES_REQUIRED')
  const objectives = question.targetObjectiveIds
    .map(id => blueprint.objectives.find(objective => objective.objectiveId === id))
  if (objectives.some(objective => !objective)) errors.push('ASSESSMENT_OBJECTIVE_NOT_FOUND')
  const validObjectives = objectives.filter((objective): objective is AssessmentObjective => Boolean(objective))
  const allowedFacts = new Set(validObjectives.flatMap(objective => objective.factKeys))
  if (!question.factKeys.length || question.factKeys.some(factKey => !allowedFacts.has(factKey))) {
    errors.push('ASSESSMENT_FACT_KEY_MISMATCH')
  }
  if (validObjectives.some(objective => objective.microId !== question.microId)) {
    errors.push('ASSESSMENT_MICRO_MISMATCH')
  }
  if (validObjectives.some(objective => objective.cognitiveTarget !== question.cognitiveTarget)) {
    errors.push('ASSESSMENT_COGNITIVE_MISMATCH')
  }
  if (/\bpaso\s+\d+\b/i.test(question.questionText || '')) errors.push('UNVERIFIED_STEP_REFERENCE')
  return { valid: errors.length === 0, errors }
}

export const validateQuestionEvidenceAlignment = validateQuestionAgainstAssessmentBlueprint
export const validateQuestionCognitiveAlignment = validateQuestionAgainstAssessmentBlueprint

export function validateRecoveryAlignment(
  source: AssessmentQuestionTarget,
  recovery: AssessmentQuestionTarget,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!sameSet(source.targetObjectiveIds, recovery.targetObjectiveIds) ||
      !sameSet(source.factKeys, recovery.factKeys) ||
      source.microId !== recovery.microId ||
      source.cognitiveTarget !== recovery.cognitiveTarget) errors.push('RECOVERY_TARGET_DRIFT')
  return { valid: errors.length === 0, errors: [...new Set(errors)] }
}

export function assertRecoveryPreservesTarget(
  source: AssessmentQuestionTarget,
  recovery: AssessmentQuestionTarget,
): void {
  if (!validateRecoveryAlignment(source, recovery).valid) throw new Error('RECOVERY_TARGET_DRIFT')
}

export const validateRecoveryQuestionAgainstSourceFailure = validateRecoveryAlignment
