import assert from 'node:assert/strict'
import {
  repairJsonLocally,
  runSessionContentGenerationPipeline,
} from '../../lib/ai/sessionContentGenerationPipeline'

type Session = { sessionIntro: string; steps: Array<{ id: string }>; evaluationBlocks: unknown[]; sessionClosing: string }
const valid: Session = { sessionIntro: 'Inicio', steps: [{ id: 'step_1' }], evaluationBlocks: [], sessionClosing: 'Cierre' }
const validate = (value: unknown) => {
  const candidate = value as Partial<Session>
  const errors = Array.isArray(candidate?.steps) && Array.isArray(candidate?.evaluationBlocks)
    ? [] : ['STRUCTURAL_VALIDATION_FAILED']
  return { valid: errors.length === 0, errors }
}

assert.deepEqual(repairJsonLocally('```json\n{"steps":[],"evaluationBlocks":[],}\n```'), {
  steps: [], evaluationBlocks: [],
})
assert.deepEqual(repairJsonLocally('{"steps":[{"id":"step_1"}],"evaluationBlocks":[]'), {
  steps: [{ id: 'step_1' }], evaluationBlocks: [],
})

async function firstCallSuccess() {
  let calls = 0
  const result = await runSessionContentGenerationPipeline<Session>({
    generate: async () => { calls += 1; return { text: JSON.stringify(valid) } }, validate,
  })
  assert.equal(result.status, 'validated'); assert.equal(calls, 1); assert.equal(result.remoteCalls, 1)
}

async function localRepairUsesOneCall() {
  let calls = 0
  const result = await runSessionContentGenerationPipeline<Session>({
    generate: async () => { calls += 1; return { text: `\`\`\`json\n${JSON.stringify(valid).replace(/}$/, ',}')}\n\`\`\`` } }, validate,
  })
  assert.equal(result.status, 'validated'); assert.equal(calls, 1); assert.equal(result.stage, 'local_json_repair')
}

async function directedRepairUsesTwoCalls() {
  const stages: string[] = []
  const result = await runSessionContentGenerationPipeline<Session>({
    generate: async context => {
      stages.push(context.stage)
      return { text: context.stage === 'directed_json_repair' ? JSON.stringify(valid) : "{'steps':[],'evaluationBlocks':[]}" }
    }, validate,
  })
  assert.equal(result.status, 'validated'); assert.equal(result.remoteCalls, 2)
  assert.deepEqual(stages, ['complete_generation', 'directed_json_repair'])
}

async function splitUsesThreeCallsAndAssembles() {
  const stages: string[] = []
  const result = await runSessionContentGenerationPipeline<Session>({
    generate: async context => {
      stages.push(context.stage)
      if (context.stage !== 'split_generation') return { text: 'irreparable' }
      return { text: JSON.stringify({
        teaching_content: { sessionIntro: 'Inicio', steps: [{ id: 'step_1' }], sessionClosing: 'Cierre' },
        assessment_content: { evaluationBlocks: [] },
      }) }
    },
    validate,
    validateTeaching: value => ({ valid: Array.isArray((value as any)?.steps), errors: [] }),
    validateAssessment: value => ({ valid: Array.isArray((value as any)?.evaluationBlocks), errors: [] }),
    assemble: (teaching, assessment) => ({ ...(teaching as object), ...(assessment as object) } as Session),
  })
  assert.equal(result.status, 'validated'); assert.equal(result.remoteCalls, 3)
  assert.deepEqual(stages, ['complete_generation', 'directed_json_repair', 'split_generation'])
  assert.deepEqual(result.content, valid)
}

async function splitReusesValidatedTeaching() {
  const originalTeaching = { sessionIntro: 'Inicio original', steps: [{ id: 'step_1' }], sessionClosing: 'Cierre' }
  const result = await runSessionContentGenerationPipeline<Session>({
    generate: async context => {
      if (context.stage === 'complete_generation') return { text: JSON.stringify({ ...originalTeaching, evaluationBlocks: 'invalid' }) }
      if (context.stage === 'directed_json_repair') return { text: JSON.stringify({ ...originalTeaching, evaluationBlocks: 'still-invalid' }) }
      assert.deepEqual(context.acceptedTeaching, originalTeaching)
      return { text: JSON.stringify({
        teaching_content: { sessionIntro: 'Contenido alterado', steps: [], sessionClosing: '' },
        assessment_content: { evaluationBlocks: [] },
      }) }
    },
    validate,
    validateTeaching: value => ({ valid: Array.isArray((value as any)?.steps), errors: [] }),
    validateAssessment: value => ({ valid: Array.isArray((value as any)?.evaluationBlocks), errors: [] }),
    assemble: (teaching, assessment) => ({ ...(teaching as object), ...(assessment as object) } as Session),
  })
  assert.equal(result.status, 'validated')
  assert.equal(result.remoteCalls, 3)
  assert.equal(result.content?.sessionIntro, 'Inicio original')
}

async function concurrentRequestsSharePromise() {
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const operation = () => runSessionContentGenerationPipeline<Session>({
    generationKey: 'chapter_2:v1',
    generate: async () => { calls += 1; await gate; return { text: JSON.stringify(valid) } },
    validate,
  })
  const first = operation(); const second = operation(); release()
  const [a, b] = await Promise.all([first, second])
  assert.equal(calls, 1); assert.deepEqual(a, b)
}

async function irreparableStopsAfterThreeCalls() {
  let calls = 0
  const result = await runSessionContentGenerationPipeline<Session>({
    generate: async () => { calls += 1; return { text: 'still irreparable' } },
    validate,
    validateTeaching: () => ({ valid: false, errors: ['INVALID_TEACHING'] }),
    validateAssessment: () => ({ valid: false, errors: ['INVALID_ASSESSMENT'] }),
    assemble: (teaching, assessment) => ({ ...(teaching as object), ...(assessment as object) } as Session),
  })
  assert.equal(result.status, 'budget_exhausted')
  assert.equal(calls, 3)
  assert.equal(result.remoteCalls, 3)
}

async function providerSwitchOnlyFollowsProviderFailure() {
  const contexts: Array<{ providerFailure: boolean; excludedProviders: string[] }> = []
  const result = await runSessionContentGenerationPipeline<Session>({
    generate: async context => {
      contexts.push({ providerFailure: context.providerFailure, excludedProviders: context.excludedProviders })
      if (context.attempt === 1) {
        const error = new Error('insufficient credits') as Error & { providerError?: object }
        error.providerError = { provider: 'openrouter', status: 402, body: 'insufficient credits' }
        throw error
      }
      if (context.stage === 'split_teaching') return { text: JSON.stringify({
        sessionIntro: 'Inicio', steps: [{ id: 'step_1' }], sessionClosing: 'Cierre',
      }) }
      assert.equal(context.stage, 'split_assessment')
      return { text: JSON.stringify({ evaluationBlocks: [] }) }
    },
    validate,
    validateTeaching: value => ({ valid: Array.isArray((value as any)?.steps), errors: [] }),
    validateAssessment: value => ({ valid: Array.isArray((value as any)?.evaluationBlocks), errors: [] }),
    assemble: (teaching, assessment) => ({ ...(teaching as object), ...(assessment as object) } as Session),
  })
  assert.equal(result.status, 'validated')
  assert.deepEqual(contexts, [
    { providerFailure: false, excludedProviders: [] },
    { providerFailure: true, excludedProviders: [] },
    { providerFailure: true, excludedProviders: [] },
  ])
}

async function contextTooLargeSplitsAndStaysOnOpenRouter() {
  const stages: string[] = []
  const result = await runSessionContentGenerationPipeline<Session>({
    generate: async context => {
      stages.push(context.stage)
      if (context.stage === 'complete_generation') {
        const error = new Error('context too large') as Error & { providerError?: object }
        error.providerError = { provider: 'openrouter', status: 413, body: 'maximum context length exceeded' }
        throw error
      }
      assert.deepEqual(context.excludedProviders, [])
      if (context.stage === 'split_teaching') return { text: JSON.stringify({ sessionIntro: 'Inicio', steps: [{ id: 'step_1' }], sessionClosing: 'Cierre' }) }
      return { text: JSON.stringify({ evaluationBlocks: [] }) }
    },
    validate,
    validateTeaching: value => ({ valid: Array.isArray((value as any)?.steps), errors: [] }),
    validateAssessment: value => ({ valid: Array.isArray((value as any)?.evaluationBlocks), errors: [] }),
    assemble: (teaching, assessment) => ({ ...(teaching as object), ...(assessment as object) } as Session),
  })
  assert.equal(result.status, 'validated')
  assert.equal(result.remoteCalls, 3)
  assert.deepEqual(stages, ['complete_generation', 'split_teaching', 'split_assessment'])
}

async function main() {
  await firstCallSuccess()
  await localRepairUsesOneCall()
  await directedRepairUsesTwoCalls()
  await splitUsesThreeCallsAndAssembles()
  await splitReusesValidatedTeaching()
  await concurrentRequestsSharePromise()
  await irreparableStopsAfterThreeCalls()
  await providerSwitchOnlyFollowsProviderFailure()
  await contextTooLargeSplitsAndStaysOnOpenRouter()
  console.log('session-content-generation-pipeline-contracts: 25 contracts PASS')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
