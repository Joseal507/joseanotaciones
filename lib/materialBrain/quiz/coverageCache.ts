import type { MaterialBrain } from '../types'
import type { QuizConfig, QuizCoverageAnalysis } from './types'
import { analyzeQuizCoverage, normalizeQuizConfig } from './planner'

export const MATERIAL_QUIZ_COVERAGE_CONFIG: QuizConfig = normalizeQuizConfig({
  questionCount: 100,
  difficulty: 'medium',
  questionTypes: ['multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer'],
})
export const QUIZ_COVERAGE_CACHE_VERSION = '2.0.0'

export function quizCoverageCacheKey(brain: MaterialBrain, config: QuizConfig): string {
  return JSON.stringify({
    fingerprint: brain.scope.fingerprint,
    builderVersion: brain.meta.builderVersion,
    coverageVersion: QUIZ_COVERAGE_CACHE_VERSION,
    difficulty: config.difficulty,
    questionTypes: [...config.questionTypes].sort(),
  })
}

export function readCachedQuizCoverage(
  brain: MaterialBrain,
  config: QuizConfig,
): QuizCoverageAnalysis | null {
  const cached = brain.meta?.quizCoverageCache
  if (!cached || !brain.scope) return null
  return cached.key === quizCoverageCacheKey(brain, config) ? cached.analysis : null
}

export function computeAndAttachMaterialQuizCoverage(brain: MaterialBrain): QuizCoverageAnalysis {
  const analysis = analyzeQuizCoverage(brain, MATERIAL_QUIZ_COVERAGE_CONFIG)
  brain.meta.quizCoverageCache = {
    version: QUIZ_COVERAGE_CACHE_VERSION,
    key: quizCoverageCacheKey(brain, MATERIAL_QUIZ_COVERAGE_CONFIG),
    analysis,
    computedAt: new Date().toISOString(),
  }
  return analysis
}
