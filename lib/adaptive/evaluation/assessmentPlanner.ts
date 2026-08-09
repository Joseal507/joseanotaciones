import type { EvaluableObjective } from './coverageExtractor'
import { allowedQuestionTypesForObjective } from './evaluationModeContract'

export type EvaluationMode = 'quick_test' | 'write_explain' | 'mix_everything' | 'read_only'

export interface PlannedQuestionSpec {
  objectiveId: string
  formatHint: string
  difficulty: 'easy' | 'medium' | 'hard'
  cognitiveLevel: EvaluableObjective['cognitiveLevel']
}

export interface EvaluationPlan {
  mode: EvaluationMode
  totalQuestions: number
  questions: PlannedQuestionSpec[]
}

/**
 * Decide cómo evaluar un grupo de objetivos.
 * No genera preguntas aún — solo decide cuántas, de qué tipo y dificultad.
 */
export function planEvaluation(
  objectives: EvaluableObjective[],
  mode: EvaluationMode
): EvaluationPlan {

  if (mode === 'read_only') {
    return {
      mode,
      totalQuestions: 0,
      questions: []
    }
  }

  const questions: PlannedQuestionSpec[] = []

  objectives.forEach(obj => {
    const difficulty = determineDifficulty(obj)

    const formatHint = selectFormat(mode, obj)

    questions.push({
      objectiveId: obj.id,
      formatHint,
      difficulty,
      cognitiveLevel: obj.cognitiveLevel
    })

    // Si es alta importancia → segunda evidencia
    if (obj.importance === 'high') {
      questions.push({
        objectiveId: obj.id,
        formatHint: selectFormat(mode, obj, true),
        difficulty: difficulty === 'easy' ? 'medium' : difficulty,
        cognitiveLevel: obj.cognitiveLevel
      })
    }
  })

  return {
    mode,
    totalQuestions: questions.length,
    questions
  }
}

function determineDifficulty(obj: EvaluableObjective): 'easy' | 'medium' | 'hard' {
  if (obj.cognitiveLevel === 'transfer') return 'hard'
  if (obj.cognitiveLevel === 'application') return 'medium'
  if (obj.importance === 'high') return 'medium'
  return 'easy'
}

function selectFormat(
  mode: EvaluationMode,
  obj: EvaluableObjective,
  secondAttempt: boolean = false
): string {

  if (mode === 'quick_test') {
    return allowedQuestionTypesForObjective(mode, `${obj.cognitiveLevel} ${obj.conceptLabel}`)[secondAttempt ? 1 : 0]
      || 'multiple_choice'
  }

  if (mode === 'write_explain') {
    if (obj.cognitiveLevel === 'recognition') return 'short_response'
    if (obj.cognitiveLevel === 'application') return 'problem_solve'
    return 'explain_why'
  }

  // mix_everything
  if (!secondAttempt) {
    return 'multiple_choice'
  } else {
    return obj.cognitiveLevel === 'application'
      ? 'problem_solve'
      : 'explain_why'
  }
}
