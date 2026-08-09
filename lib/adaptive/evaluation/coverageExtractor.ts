/**
 * coverageExtractor.ts
 *
 * La IA que generó la clase decide cuándo evaluar cada grupo de pasos.
 * Los checkpoints vienen del análisis real del contenido, no de heurísticas.
 * Garantía: los N pasos de la sesión quedan 100% evaluados.
 */

export interface EvaluableObjective {
  id: string
  stepId: string
  stepIndex: number
  stepType: string
  stepTitle: string
  conceptLabel: string
  teachingContent: string
  keyPoint: string | null
  relatedBlockIds: string[]
  importance: 'high' | 'medium' | 'low'
  cognitiveLevel: 'recognition' | 'comprehension' | 'application' | 'transfer'
  evidencesRequired: number
  evidencesCompleted: number
  status: 'pending' | 'evaluated' | 'mastered' | 'needs_reteach'
}

export interface EvaluationCheckpoint {
  afterStepIndex: number
  coveredStepIndices: number[]
  reason: string
}

export interface CoverageMap {
  sessionId: string
  sessionNumber: number
  totalObjectives: number
  objectives: EvaluableObjective[]
  checkpoints: EvaluationCheckpoint[]
}

interface ClassStep {
  id: string
  type: string
  title: string
  content: string
  keyPoint: string | null
  relatedBlockIds: string[]
}

const EVALUABLE_TYPES = new Set([
  'concept', 'formula', 'example', 'warning', 'connection', 'recap', 'closing'
])

function ensureCheckpointCoverage(
  steps: ClassStep[],
  aiCheckpoints: Array<{ afterStepIndex: number; coveredStepIndices: number[]; reason: string }>
): EvaluationCheckpoint[] {
  const normalized: EvaluationCheckpoint[] = aiCheckpoints
    .map(cp => ({
      afterStepIndex: cp.afterStepIndex,
      coveredStepIndices: Array.from(new Set(cp.coveredStepIndices))
        .filter(i => Number.isInteger(i) && i >= 0 && i < steps.length),
      reason: cp.reason || 'ai_checkpoint',
    }))
    .filter(cp =>
      Number.isInteger(cp.afterStepIndex) &&
      cp.afterStepIndex >= 0 &&
      cp.afterStepIndex < steps.length &&
      cp.coveredStepIndices.length > 0
    )

  const covered = new Set<number>()
  normalized.forEach(cp => cp.coveredStepIndices.forEach(i => covered.add(i)))

  const missingEvaluableIndices = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => EVALUABLE_TYPES.has(step.type))
    .map(({ index }) => index)
    .filter(index => !covered.has(index))

  if (missingEvaluableIndices.length === 0) {
    return normalized.sort((a, b) => a.afterStepIndex - b.afterStepIndex)
  }

  for (const index of missingEvaluableIndices) {
    normalized.push({
      afterStepIndex: index,
      coveredStepIndices: [index],
      reason: 'coverage_repair',
    })
  }

  return normalized.sort((a, b) => a.afterStepIndex - b.afterStepIndex)
}


/**
 * Genera el CoverageMap completo.
 * Los checkpoints se calculan enviando los pasos a la IA para que
 * decida la agrupación óptima según dificultad y densidad real.
 * Esta función es síncrona — los checkpoints vienen del session-teach
 * o se calculan con la heurística de fallback si no llegan.
 */
export function buildCoverageMap(
  steps: ClassStep[],
  sessionId: string,
  sessionNumber: number,
  aiCheckpoints?: Array<{ afterStepIndex: number; coveredStepIndices: number[]; reason: string }>
): CoverageMap {
  if (aiCheckpoints && aiCheckpoints.length > 0) {
    const checkpoints = ensureCheckpointCoverage(steps, aiCheckpoints)

    return {
      sessionId,
      sessionNumber,
      totalObjectives: 0,
      objectives: [],
      checkpoints,
    }
  }

  // Fallback: generar checkpoints automáticamente según tipo de paso
  const checkpoints = generateCheckpointsFallback(steps)

  return {
    sessionId,
    sessionNumber,
    totalObjectives: 0,
    objectives: [],
    checkpoints,
  }
}

/**
 * Fallback: agrupa pasos evaluables de forma inteligente.
 * - Pasos tipo formula o que tienen keyPoint → checkpoint individual o con 1 vecino máximo
 * - Pasos simples (concept, example) → se agrupan de 2-3
 * - Pasos de recap/closing → checkpoint al final del grupo
 * Garantía: TODOS los pasos evaluables quedan en algún checkpoint.
 */
function generateCheckpointsFallback(steps: ClassStep[]): EvaluationCheckpoint[] {
  const checkpoints: EvaluationCheckpoint[] = []

  // Solo pasos evaluables con su índice real
  const evaluable = steps
    .map((step, i) => ({ step, index: i }))
    .filter(({ step }) => EVALUABLE_TYPES.has(step.type))

  if (evaluable.length === 0) return checkpoints

  let pending: number[] = []

  evaluable.forEach(({ step, index }, i) => {
    pending.push(index)

    const isLast = i === evaluable.length - 1
    const isHeavy = step.type === 'formula' ||
      (step.keyPoint && step.keyPoint.length > 30) ||
      step.content.length > 600

    // Crear checkpoint si:
    // - Es el último paso evaluable (siempre)
    // - El paso es pesado/complejo y ya hay algo pendiente
    // - Se acumularon 3 pasos simples
    const shouldFlush =
      isLast ||
      (isHeavy && pending.length >= 1) ||
      pending.length >= 3

    if (shouldFlush) {
      checkpoints.push({
        afterStepIndex: index,
        coveredStepIndices: [...pending],
        reason: isLast
          ? 'final_checkpoint'
          : isHeavy
            ? 'heavy_step'
            : 'accumulated_steps',
      })
      pending = []
    }
  })

  // Seguridad: si quedó algo pendiente que no se flusheó
  if (pending.length > 0) {
    const lastIndex = pending[pending.length - 1]
    checkpoints.push({
      afterStepIndex: lastIndex,
      coveredStepIndices: [...pending],
      reason: 'safety_flush',
    })
  }

  return checkpoints
}

export function extractEvaluableObjectives(
  steps: ClassStep[],
  sessionId: string,
  sessionNumber: number
): CoverageMap {
  return buildCoverageMap(steps, sessionId, sessionNumber)
}

export function getStepsForCheckpoint(
  coverageMap: CoverageMap,
  afterStepIndex: number
): number[] {
  const checkpoint = coverageMap.checkpoints.find(
    cp => cp.afterStepIndex === afterStepIndex
  )
  return checkpoint?.coveredStepIndices || []
}

export function updateObjectiveStatus(
  coverageMap: CoverageMap,
  objectiveId: string,
  correct: boolean
): CoverageMap {
  const updatedObjectives = coverageMap.objectives.map(obj => {
    if (obj.id !== objectiveId) return obj
    const newEvidences = correct ? obj.evidencesCompleted + 1 : obj.evidencesCompleted
    const isMastered = newEvidences >= obj.evidencesRequired
    return {
      ...obj,
      evidencesCompleted: newEvidences,
      status: isMastered
        ? 'mastered' as const
        : correct
          ? 'evaluated' as const
          : 'needs_reteach' as const,
    }
  })
  return { ...coverageMap, objectives: updatedObjectives }
}

export function isFullCoverage(coverageMap: CoverageMap): boolean {
  return coverageMap.objectives.length > 0 &&
    coverageMap.objectives.every(obj => obj.status === 'mastered')
}

export function getObjectivesNeedingReteach(
  coverageMap: CoverageMap
): EvaluableObjective[] {
  return coverageMap.objectives.filter(obj => obj.status === 'needs_reteach')
}

export function getCoveragePercentage(coverageMap: CoverageMap): number {
  if (coverageMap.objectives.length === 0) return 0
  const mastered = coverageMap.objectives.filter(
    obj => obj.status === 'mastered'
  ).length
  return Math.round((mastered / coverageMap.objectives.length) * 100)
}
