import type {
  FillBlankQuestion, MatchingQuestion, MultipleChoiceQuestion, MultiSelectQuestion, QuizQuestion,
} from '../../types/quiz'
import type { GroundedQuizQuestion, QuizConfig, QuizPlan } from './types'
import {
  QUIZ_GENERATOR_VERSION, QUIZ_PLANNER_VERSION, QUIZ_PRESENTATION_VERSION,
  QUIZ_SCHEMA_VERSION,
} from './types'
import { hashToSeed, shuffleWithSeed } from './random'

/**
 * Fixed-length distribution across ALL option indexes.
 *
 * Instead of piling the remainder onto the first N%optionCount positions
 * (which made N=1 always fall on option A after any shuffle), we FIRST derive
 * a seed-driven cyclic ordering of the option indexes, THEN append base+1
 * copies of the first (N%optionCount) indexes in that order, and base copies
 * of the rest. This makes N=1's correct index deterministically vary with
 * artifact identity (Blocker 3).
 *
 * Contract:
 *   For any N, seed:
 *     Σ counts = N
 *     max(count) - min(count) ≤ 1   (across ALL option indexes, including zeros)
 *   For N=1, different (brain, config) identities produce different indexes.
 */
export function computeCorrectPositionAssignment(
  mcQuestionIds: string[],
  optionCount: number,
  seed: number,
): Map<string, number> {
  const assignment = new Map<string, number>()
  const n = mcQuestionIds.length
  if (n === 0 || optionCount <= 0) return assignment

  // Seed-driven permutation of option indexes 0..optionCount-1.
  const optionOrder = shuffleWithSeed(
    Array.from({ length: optionCount }, (_, i) => i),
    seed,
  )
  const base = Math.floor(n / optionCount)
  const remainder = n % optionCount

  // Emit positions cycling through the permuted option order.
  // First `remainder` positions in optionOrder each receive one EXTRA (base+1),
  // the rest receive `base`. This preserves ≤1 imbalance while removing the
  // structural A-bias for small N.
  const positions: number[] = []
  for (let idx = 0; idx < optionOrder.length; idx += 1) {
    const count = base + (idx < remainder ? 1 : 0)
    for (let k = 0; k < count; k += 1) positions.push(optionOrder[idx])
  }

  // Deterministic pairing of questionIds → positions.
  const shuffledIds = shuffleWithSeed(mcQuestionIds, seed ^ 0x9e3779b9)
  for (let i = 0; i < shuffledIds.length; i += 1) {
    assignment.set(shuffledIds[i], positions[i] ?? optionOrder[0])
  }
  return assignment
}

export interface PresentationIdentity {
  brainFingerprint: string
  configFingerprint: string
  generationId?: string
}

export function computePresentationSeed(identity: PresentationIdentity, questionId: string): number {
  return hashToSeed(
    identity.brainFingerprint,
    identity.configFingerprint,
    QUIZ_SCHEMA_VERSION,
    QUIZ_PLANNER_VERSION,
    QUIZ_GENERATOR_VERSION,
    QUIZ_PRESENTATION_VERSION,
    ...(identity.generationId ? [identity.generationId] : []),
    questionId,
  )
}

export interface QuizPresentationResult {
  questions: GroundedQuizQuestion[]
  /**
   * Correct-answer position histogram over ALL option indexes 0..optionCount-1,
   * including zero counts. Callers/tests can therefore prove balance without
   * missing the pathological "only-one-key-present" case.
   */
  correctPositionCounts: Record<string, number>
}

const OPTION_COUNT = 4

function questionOrderSeed(identity: PresentationIdentity): number {
  return hashToSeed(identity.brainFingerprint, identity.configFingerprint, QUIZ_PRESENTATION_VERSION,
    ...(identity.generationId ? [identity.generationId] : []), 'question_order')
}

export function computePresentedSlotOrder(plan: QuizPlan, identity: PresentationIdentity): string[] {
  return shuffleWithSeed(plan.slots.map(slot => slot.slotId), questionOrderSeed(identity))
}

export function computeMcTargetAssignment(plan: QuizPlan, identity: PresentationIdentity): Map<string, number> {
  const slotIds = plan.slots.filter(slot => slot.questionType === 'multiple_choice').map(slot => slot.slotId)
  const seed = hashToSeed(identity.brainFingerprint, identity.configFingerprint, QUIZ_PRESENTATION_VERSION,
    ...(identity.generationId ? [identity.generationId] : []), 'mc_position_balancing')
  return computeCorrectPositionAssignment(slotIds, OPTION_COUNT, seed)
}

export function applyPresentationToOne(
  question: GroundedQuizQuestion,
  identity: PresentationIdentity,
  mcTarget?: number,
): GroundedQuizQuestion {
  if (question.type === 'multiple_choice') {
    const mc = question as MultipleChoiceQuestion & typeof question
    const target = mcTarget ?? 0
    const seed = computePresentationSeed(identity, mc.id)
    const correctText = mc.options[mc.correctAnswer]
    const distractors = shuffleWithSeed(mc.options.filter((_, idx) => idx !== mc.correctAnswer), seed)
    const finalOptions: string[] = []; let ptr = 0
    for (let idx = 0; idx < mc.options.length; idx++) finalOptions.push(idx === target ? correctText : distractors[ptr++])
    return { ...mc, options: finalOptions, correctAnswer: target } as GroundedQuizQuestion
  }
  if (question.type === 'multi_select') {
    const ms = question as MultiSelectQuestion & typeof question
    const permutation = shuffleWithSeed(ms.options.map((_, i) => i), computePresentationSeed(identity, ms.id))
    const oldToNew = new Map<number, number>(); permutation.forEach((old, next) => oldToNew.set(old, next))
    return { ...ms, options: permutation.map(old => ms.options[old]),
      correctAnswers: ms.correctAnswers.map(old => oldToNew.get(old)!).sort((a, b) => a - b) } as GroundedQuizQuestion
  }
  if (question.type === 'matching') {
    const q = question as MatchingQuestion & typeof question
    return { ...q, pairs: shuffleWithSeed(q.pairs, computePresentationSeed(identity, q.id)) } as GroundedQuizQuestion
  }
  if (question.type === 'fill_blank') {
    const q = question as FillBlankQuestion & typeof question
    return { ...q, ...(q.wordBank ? { wordBank: shuffleWithSeed(q.wordBank, computePresentationSeed(identity, q.id)) } : {}) } as GroundedQuizQuestion
  }
  return question
}

export function applyQuizPresentation(
  questions: GroundedQuizQuestion[],
  identity: PresentationIdentity,
  _config: QuizConfig,
): QuizPresentationResult {
  void _config
  const mcIds = questions.filter(q => q.type === 'multiple_choice').map(q => q.id)
  const globalSeed = hashToSeed(
    identity.brainFingerprint,
    identity.configFingerprint,
    QUIZ_PRESENTATION_VERSION,
    ...(identity.generationId ? [identity.generationId] : []),
    'mc_position_balancing',
  )
  const targetByQuestionId = computeCorrectPositionAssignment(mcIds, OPTION_COUNT, globalSeed)
  const correctPositionCounts: Record<string, number> = {}
  // Initialize all option indexes to 0 so tests can prove exact balance
  // across the FULL histogram (Blocker 3 test-fix requirement).
  for (let i = 0; i < OPTION_COUNT; i += 1) correctPositionCounts[String(i)] = 0

  const transformed = questions.map(question => applyPresentationToOne(question, identity, targetByQuestionId.get(question.id)))
  for (const question of transformed) if (question.type === 'multiple_choice') {
    correctPositionCounts[String(question.correctAnswer)]++
  }

  return { questions: shuffleWithSeed(transformed, questionOrderSeed(identity)), correctPositionCounts }
}

/**
 * Test helper — returns histogram over ALL option indexes including zeros so
 * tests can distinguish "balanced" from "structurally forced onto A".
 */
export function summarizeCorrectPositions(questions: QuizQuestion[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (let i = 0; i < OPTION_COUNT; i += 1) out[String(i)] = 0
  for (const q of questions) {
    if (q.type === 'multiple_choice') {
      const k = String(q.correctAnswer)
      out[k] = (out[k] || 0) + 1
    }
  }
  return out
}
