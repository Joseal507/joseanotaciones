import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  classifyGenerationFailure,
  runGenerationPipeline,
  type GenerationAttemptContext,
} from '../../lib/ai/generationPipeline'

async function internalContractDoesNotRetry() {
  let calls = 0
  const result = await runGenerationPipeline({
    taskType: 'session_content',
    generate: async () => {
      calls += 1
      return { value: { partial: true }, provider: 'provider-a', model: 'model-a' }
    },
    validate: () => ({
      valid: false,
      errors: ['SESSION_EVALUATION_COVERAGE:required_steps:evaluation_block_1:missing=step_2'],
      retryable: false,
    }),
  })
  assert.equal(calls, 1)
  assert.equal(result.status, 'budget_exhausted')
  assert.equal(result.validationResult.retryable, false)
}
import { runIdempotentGeneration } from '../../lib/ai/generationIdempotency'

async function invalidJsonThenSimplified() {
  const seen: GenerationAttemptContext[] = []
  const result = await runGenerationPipeline({
    taskType: 'evaluation_question',
    generate: async context => {
      seen.push(context)
      return { value: context.stage === 'simplified' ? { questions: ['valid'] } : { questions: [] }, provider: 'test', model: 'test' }
    },
    validate: value => value.questions.length
      ? { valid: true, errors: [] }
      : { valid: false, errors: ['INVALID_JSON'] },
  })
  assert.equal(result.status, 'validated')
  assert.ok(seen.some(context => context.stage === 'format_repair'))
  assert.ok(seen.some(context => context.stage === 'simplified'))
}

async function semanticDuplicationSplits() {
  const result = await runGenerationPipeline({
    taskType: 'recovery_question',
    splitCount: 2,
    mergeParts: parts => ({ questions: parts.flatMap(part => part.questions) }),
    generate: async context => context.stage === 'split_individual'
      ? { value: { questions: [`question_${context.partIndex}`] }, provider: 'secondary', model: 'individual' }
      : { value: { questions: ['same', 'same'] }, provider: 'primary', model: 'batch' },
    validate: value => new Set(value.questions).size === value.questions.length
      ? { valid: true, errors: [] }
      : { valid: false, errors: ['SEMANTIC_DUPLICATION'] },
  })
  assert.equal(result.status, 'validated')
  assert.deepEqual(result.content?.questions, ['question_0', 'question_1'])
  assert.ok(result.repairsApplied.includes('split_individual'))
}

async function partialBatchKeepsAcceptedItem() {
  let calls = 0
  const modes: string[] = []
  const result = await runGenerationPipeline({
    taskType: 'recovery_question',
    failurePath: 'single_repair',
    maxIndividualAttemptsPerPart: 1,
    splitCount: 2,
    getItemCount: value => value.questions.length,
    describeItems: value => value.questions,
    selectAcceptedPartial: value => value.questions.length === 1 ? value : null,
    mergeParts: parts => ({ questions: parts.flatMap(part => part.questions) }),
    generate: async context => {
      calls += 1
      modes.push(context.generationMode)
      if (context.generationMode === 'batch') return { value: { questions: ['accepted A'] } }
      assert.equal(context.expectedItemCount, 1)
      assert.deepEqual(context.acceptedItemSummaries, ['accepted A'])
      return { value: { questions: ['new B'] } }
    },
    validate: (value, context) => {
      if (value.questions.length !== context.expectedItemCount) {
        return { valid: false, errors: [`LOW_DIVERSITY:requires_${context.expectedItemCount}_questions`] }
      }
      if (context.generationMode === 'assembled_batch' && new Set(value.questions).size !== 2) {
        return { valid: false, errors: ['LOW_DIVERSITY:semantic_overlap'] }
      }
      return { valid: true, errors: [] }
    },
  })
  assert.equal(result.status, 'validated')
  assert.deepEqual(result.content?.questions, ['accepted A', 'new B'])
  assert.equal(calls, 2)
  assert.deepEqual(modes, ['batch', 'individual_part'])
  assert.ok(!result.attempts.some(attempt => attempt.stage === 'format_repair'))
}

async function successPathUsesExactlyOneCall() {
  let calls = 0
  const events: Array<{ event: string; payload: Record<string, unknown> }> = []
  const result = await runGenerationPipeline({
    taskType: 'evaluation_question',
    failurePath: 'single_repair',
    generate: async context => {
      calls += 1
      assert.equal(context.stage, 'normal')
      return { value: { questions: ['valid-first-response'] }, provider: 'primary', model: 'fast' }
    },
    validate: value => value.questions.length === 1
      ? { valid: true, errors: [] }
      : { valid: false, errors: ['STRUCTURAL_VALIDATION_FAILED'] },
    telemetry: (event, payload) => events.push({ event, payload }),
  })
  assert.equal(result.status, 'validated')
  assert.equal(calls, 1)
  assert.equal(result.attempts.length, 1)
  assert.deepEqual(result.repairsApplied, [])
  assert.equal(events.find(entry => entry.event === 'generation_validated')?.payload.successOnFirstAttempt, true)
}

async function failedEvaluationStopsAfterOneDirectedRepair() {
  const stages: string[] = []
  const result = await runGenerationPipeline({
    taskType: 'evaluation_question',
    failurePath: 'single_repair',
    generate: async context => {
      stages.push(context.stage)
      return { value: { questions: [] } }
    },
    validate: () => ({ valid: false, errors: ['INVALID_ACADEMIC_FRAGMENT:broken_delimiter'] }),
  })
  assert.equal(result.status, 'budget_exhausted')
  assert.deepEqual(stages, ['normal', 'targeted_repair'])
  assert.equal(result.attempts.length, 2)
  assert.ok(!stages.includes('alternate_provider'))
}

async function failedMissingItemStopsAndPreservesAcceptedItem() {
  let calls = 0
  const result = await runGenerationPipeline({
    taskType: 'recovery_question',
    failurePath: 'single_repair',
    maxIndividualAttemptsPerPart: 1,
    splitCount: 2,
    getItemCount: value => value.questions.length,
    describeItems: value => value.questions,
    selectAcceptedPartial: value => value.questions.length === 1 ? value : null,
    mergeParts: parts => ({ questions: parts.flatMap(part => part.questions) }),
    generate: async context => {
      calls += 1
      return context.generationMode === 'batch'
        ? { value: { questions: ['accepted A'] } }
        : { value: { questions: [] } }
    },
    validate: (value, context) => value.questions.length === context.expectedItemCount
      ? { valid: true, errors: [] }
      : { valid: false, errors: [`LOW_DIVERSITY:requires_${context.expectedItemCount}_questions`] },
  })
  assert.equal(result.status, 'budget_exhausted')
  assert.equal(calls, 2)
  assert.deepEqual(result.content?.questions, ['accepted A'])
  assert.deepEqual(result.attempts.map(attempt => attempt.stage), ['normal', 'split_individual'])
}

async function emptyRecoveryBatchNeverExceedsTwoProviderCalls() {
  let calls = 0
  const result = await runGenerationPipeline({
    taskType: 'recovery_question',
    failurePath: 'single_repair',
    splitCount: 2,
    maxIndividualAttemptsPerPart: 1,
    getItemCount: value => value.questions.length,
    mergeParts: parts => ({ questions: parts.flatMap(part => part.questions) }),
    generate: async () => {
      calls += 1
      return { value: { questions: [] } }
    },
    validate: () => ({ valid: false, errors: ['LOW_DIVERSITY:requires_2_questions'] }),
  })
  assert.equal(result.status, 'budget_exhausted')
  assert.equal(calls, 2)
}

async function temporaryProviderFailureNeverSwitches() {
  const stages: string[] = []
  const result = await runGenerationPipeline({
    taskType: 'reteach',
    generate: async context => {
      stages.push(context.stage)
      const error = new Error('provider timeout') as Error & { providerError?: object }
      error.providerError = { provider: 'openrouter', status: 504, message: 'provider timeout' }
      throw error
    },
    validate: value => value.length > 20
      ? { valid: true, errors: [] }
      : { valid: false, errors: ['LOW_QUALITY_RETEACH'] },
  })
  assert.equal(result.status, 'budget_exhausted')
  assert.ok(!stages.includes('alternate_provider'))
}

async function creditsExhaustedAllowsFallback() {
  const stages: string[] = []
  const result = await runGenerationPipeline({
    taskType: 'reteach',
    generate: async context => {
      stages.push(context.stage)
      if (context.stage === 'normal') {
        const error = new Error('insufficient credits') as Error & { providerError?: object }
        error.providerError = { provider: 'openrouter', status: 402, body: 'insufficient credits' }
        throw error
      }
      assert.deepEqual(context.excludedProviders, ['openrouter'])
      return { value: 'validated Groq explanation', provider: 'groq', model: 'fallback' }
    },
    validate: value => value.length > 20 ? { valid: true, errors: [] } : { valid: false, errors: ['LOW_QUALITY_RETEACH'] },
  })
  assert.equal(result.status, 'validated')
  assert.equal(result.providerUsed, 'groq')
  assert.deepEqual(stages, ['normal', 'alternate_provider'])
}

async function finiteBudget() {
  const result = await runGenerationPipeline({
    taskType: 'recovery_question',
    totalTimeoutMs: 5_000,
    generate: async () => { throw new Error('provider timeout') },
    validate: () => ({ valid: false, errors: ['provider timeout'] }),
    splitCount: 2,
    mergeParts: parts => parts[0],
  })
  assert.equal(result.status, 'budget_exhausted')
  assert.ok(result.attempts.length > 3)
  assert.ok(result.attempts.length <= 12)
}

async function main() {
  assert.equal(classifyGenerationFailure(['broken_delimiter']), 'INVALID_ACADEMIC_FRAGMENT')
  assert.equal(classifyGenerationFailure(['questions are semantically similar']), 'SEMANTIC_DUPLICATION')
  assert.equal(classifyGenerationFailure(['evaluation mode violation']), 'INCOMPATIBLE_ACTIVITY')
  assert.equal(classifyGenerationFailure(['provider timeout']), 'PROVIDER_ERROR')
  await internalContractDoesNotRetry()
  await invalidJsonThenSimplified()
  await semanticDuplicationSplits()
  await partialBatchKeepsAcceptedItem()
  await successPathUsesExactlyOneCall()
  await failedEvaluationStopsAfterOneDirectedRepair()
  await failedMissingItemStopsAndPreservesAcceptedItem()
  await emptyRecoveryBatchNeverExceedsTwoProviderCalls()
  let providerCalls = 0
  const operation = () => {
    providerCalls += 1
    return Promise.resolve({ value: 'approved' })
  }
  const [first, second] = await Promise.all([
    runIdempotentGeneration('same-recovery-round', operation),
    runIdempotentGeneration('same-recovery-round', operation),
  ])
  assert.deepEqual(first, second)
  assert.equal(providerCalls, 1)
  await temporaryProviderFailureNeverSwitches()
  await creditsExhaustedAllowsFallback()
  await finiteBudget()
  const sessionPage = readFileSync('app/materias/[temaId]/sesion/[sessionNumber]/page.tsx', 'utf8')
  assert.doesNotMatch(sessionPage, /createDeterministicRecoveryFallback|extreme_fallback_used/)
  const sessionEval = readFileSync('app/api/adaptive/session-eval/route.ts', 'utf8')
  assert.doesNotMatch(sessionEval, /recoveryFallbackQuestions|mode_safe_fallback/)
  console.log('ai-generation-pipeline-contracts: 20 contracts PASS')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
