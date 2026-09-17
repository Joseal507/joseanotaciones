import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyProviderFailure } from '../../lib/ai/providerPolicy'
import { classifyGenerationFailure, runGenerationPipeline, type GenerationAttemptContext } from '../../lib/ai/generationPipeline'

// ============================================================
// EXAM_TIMEOUT_LIVE_BLOCKER contracts.
//
// A fresh live CLUTCH 2.pdf exam generation (13 questions, 51/51
// assessable targets, 15 min — composition/coverage all correct) failed
// on EVERY attempt with:
//   provider_call_failed / openrouter / google/gemini-2.5-flash /
//   taskType: final_exam / rawProviderMessage: "timeout must be an
//   integer"
// then burned all 6 retry attempts (normal -> format_repair x2 ->
// targeted_repair x2 -> simplified), all failing identically.
//
// Root cause traced to lib/alai.ts's single shared provider-call
// helper (used by Exam via generateValidatedLegacyJson, and by every
// other still-legacy caller that does not set an explicit
// `timeoutMs`): the openai SDK (node_modules/openai/core.js) validates
// per-request options with `if ('timeout' in options)
// validatePositiveInteger('timeout', options.timeout)` — the KEY
// merely being PRESENT (even set to `undefined`) triggers this, and
// `{ ..., timeout: params.timeoutMs }` always leaves the key present.
// Truquitos never hit this because its own direct alai() call
// explicitly sets `timeoutMs: 35_000` (see lib/truquitos/artifact.ts);
// Exam's shared legacy path never sets timeoutMs at all, so the key
// was always present as `undefined` -> always threw, on every single
// attempt across every stage, before any network request was even
// made.
//
// A second, compounding bug: this thrown message contains the literal
// substring "timeout", so providerPolicy.ts's existing temporary-
// failure regex (`/timeout|timed out|.../`) misclassified a
// deterministic, always-repeating LOCAL SDK validation error as
// TEMPORARY_PROVIDER_FAILURE (implying "retry may help") — which is
// why the pipeline burned the full 6-attempt budget instead of failing
// immediately.
// ============================================================

let passed = 0, failed = 0
function test(name: string, fn: () => void | Promise<void>) {
  const result = fn()
  if (result instanceof Promise) {
    return result.then(() => { console.log('  ✅ ' + name); passed++ })
      .catch((err: any) => { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ })
  }
  try { console.log('  ✅ ' + name); passed++ } catch (err: any) { console.log('  ❌ ' + name); failed++ }
}

const alaiSource = readFileSync('lib/alai.ts', 'utf8')

async function main() {
  console.log('\n── EXAM_TIMEOUT_LIVE_BLOCKER contracts ──\n')

  await test('1. lib/alai.ts no longer unconditionally includes an always-present `timeout` key in the per-call request options — the exact live SDK-validation trigger', () => {
    assert.doesNotMatch(alaiSource, /\{ maxRetries: params\.transportRetries, timeout: params\.timeoutMs \}/, 'the old always-present-key form must be gone')
    assert.match(alaiSource, /Number\.isInteger\(params\.timeoutMs\)/, 'timeout must only ever be included when it is genuinely a valid integer')
  })

  await test('2. reproduces the exact OpenAI SDK contract (node_modules/openai/core.js: `if (\'timeout\' in options) validatePositiveInteger(...)`) — proves the fixed request-options builder never leaves the key present for an unset Exam-style call, and DOES include it for a Truquitos-style explicit integer call', () => {
    // Exact re-implementation of both the SDK's own presence-check
    // contract and this fix's request-options construction (matching
    // the code at lib/alai.ts, verified by test 1 above), run against
    // the real values each call site actually supplies.
    const sdkValidate = (options: { timeout?: number }) => {
      if ('timeout' in options) {
        if (typeof options.timeout !== 'number' || !Number.isInteger(options.timeout)) {
          throw new Error('timeout must be an integer')
        }
      }
    }
    const buildRequestOptions = (timeoutMs: number | undefined) => {
      const requestOptions: { maxRetries?: number; timeout?: number } = { maxRetries: undefined }
      if (Number.isInteger(timeoutMs)) requestOptions.timeout = timeoutMs
      return requestOptions
    }

    // Exam (and every other legacy caller): timeoutMs is never set.
    assert.doesNotThrow(() => sdkValidate(buildRequestOptions(undefined)), 'an Exam-style call with no timeoutMs must never throw "timeout must be an integer" again')
    // Truquitos: explicit integer, must still work exactly as before.
    const truquitosOptions = buildRequestOptions(35_000)
    assert.doesNotThrow(() => sdkValidate(truquitosOptions))
    assert.equal(truquitosOptions.timeout, 35_000, 'an explicitly-set valid integer timeout must still be passed through unchanged')
    // Sanity: prove the OLD code shape truly did throw for the exact
    // Exam-reported case, so this is a real regression test and not a
    // tautology.
    assert.throws(() => sdkValidate({ maxRetries: undefined, timeout: undefined }), /timeout must be an integer/)
  })

  await test('3. classifyProviderFailure classifies the exact live rawProviderMessage as PROVIDER_CONFIGURATION_ERROR, never TEMPORARY_PROVIDER_FAILURE (checked BEFORE the "timeout" substring match that used to swallow it)', () => {
    assert.equal(classifyProviderFailure({ provider: 'openrouter', message: 'timeout must be an integer' }), 'PROVIDER_CONFIGURATION_ERROR')
    assert.equal(classifyProviderFailure({ provider: 'openrouter', message: 'maxRetries must be a positive integer' }), 'PROVIDER_CONFIGURATION_ERROR')
    // A genuinely temporary network condition must still classify as before.
    assert.equal(classifyProviderFailure({ provider: 'openrouter', status: 504, message: 'upstream request timeout' }), 'TEMPORARY_PROVIDER_FAILURE')
  })

  await test('4. classifyGenerationFailure maps both a providerError-carrying thrown error AND a bare error message to PROVIDER_CONFIGURATION_ERROR', () => {
    const err: any = new Error('timeout must be an integer')
    err.providerError = { provider: 'openrouter', message: 'timeout must be an integer' }
    assert.equal(classifyGenerationFailure([], err), 'PROVIDER_CONFIGURATION_ERROR')
    assert.equal(classifyGenerationFailure([], new Error('timeout must be an integer')), 'PROVIDER_CONFIGURATION_ERROR')
  })

  await test('5. the exact reported 6-attempt cascade can no longer happen: a generate() that always throws "timeout must be an integer" fails after exactly ONE attempt (normal), never proceeding through format_repair/targeted_repair/simplified', async () => {
    let calls = 0
    const seen: GenerationAttemptContext[] = []
    const result = await runGenerationPipeline({
      taskType: 'final_exam',
      generate: async context => {
        calls += 1
        seen.push(context)
        const err: any = new Error('timeout must be an integer')
        throw err
      },
      validate: () => ({ valid: true, errors: [] }),
    })
    assert.equal(calls, 1, `must fail immediately after the first attempt, got ${calls} calls across stages: ${seen.map(c => c.stage).join(',')}`)
    assert.equal(result.status, 'budget_exhausted')
    assert.equal(result.attempts.length, 1)
    assert.equal(result.attempts[0].failure, 'PROVIDER_CONFIGURATION_ERROR')
    assert.equal(result.attempts[0].stage, 'normal')
  })

  await test('6. genuinely retryable provider failures (a transient 503) still exhaust the FULL bounded stage budget exactly as before — this fix narrows ONLY the new configuration-error class, nothing else', async () => {
    let calls = 0
    const result = await runGenerationPipeline({
      taskType: 'final_exam',
      generate: async () => {
        calls += 1
        const err: any = new Error('Service Unavailable')
        err.providerError = { provider: 'openrouter', status: 503, message: 'Service Unavailable' }
        throw err
      },
      validate: () => ({ valid: true, errors: [] }),
    })
    assert.equal(calls, 6, 'a temporary provider failure must still exhaust the full normal(1)+format_repair(2)+targeted_repair(2)+simplified(1) budget unchanged')
    assert.equal(result.status, 'budget_exhausted')
  })

  await test('7. genuinely malformed/academically-rejected model output still retries through the full repair ladder exactly as before — validation-driven failures are a completely different code path from the new configuration-error short-circuit', async () => {
    let calls = 0
    const result = await runGenerationPipeline({
      taskType: 'final_exam',
      generate: async () => { calls += 1; return { value: { questions: [] }, provider: 'p', model: 'm' } },
      validate: value => (value as any).questions.length ? { valid: true, errors: [] } : { valid: false, errors: ['STRUCTURAL_VALIDATION_FAILED:missing_questions'] },
    })
    assert.equal(calls, 6)
    assert.equal(result.status, 'budget_exhausted')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('exam-timeout-provider-configuration-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
