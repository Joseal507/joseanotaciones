import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyProviderFailure, shouldFallbackToGroq } from '../../lib/ai/providerPolicy'

const error = (overrides: Record<string, unknown> = {}) => ({ provider: 'openrouter', status: 500, message: 'provider error', body: '', ...overrides })
assert.equal(classifyProviderFailure(error({ status: 402, body: 'Insufficient credits' })), 'OPENROUTER_CREDITS_EXHAUSTED')
assert.equal(classifyProviderFailure(error({ status: 429, body: 'Credit limit reached for this account' })), 'OPENROUTER_CREDITS_EXHAUSTED')
assert.equal(shouldFallbackToGroq(error({ status: 402, message: 'Payment required: insufficient balance' })), true)
for (const candidate of [
  error({ status: 429, body: 'Too many requests' }), error({ status: 503, body: 'Service unavailable' }),
  error({ status: 504, message: 'timeout' }), error({ status: 413, body: 'context too large' }),
  error({ status: 402, body: 'Payment service temporarily unavailable' }), error({ provider: 'groq', status: 402, body: 'insufficient credits' }),
  error({ status: 200, message: 'INVALID_JSON' }), error({ status: 200, message: 'STRUCTURAL_VALIDATION_FAILED' }),
]) assert.equal(shouldFallbackToGroq(candidate), false)
assert.equal(classifyProviderFailure(error({ status: 413, body: 'maximum context length exceeded' })), 'CONTEXT_TOO_LARGE')
assert.equal(classifyProviderFailure(error({ status: 429, body: 'rate limit exceeded' })), 'RATE_LIMITED')
assert.equal(classifyProviderFailure(error({ status: 503 })), 'TEMPORARY_PROVIDER_FAILURE')
assert.equal(classifyProviderFailure(error({ status: 401 })), 'AUTH_ERROR')
assert.equal(classifyProviderFailure(error({ status: 200, message: 'INVALID_JSON' })), 'INVALID_RESPONSE')
const alaiSource = readFileSync('lib/alai.ts', 'utf8')
const sessionTeachSource = readFileSync('app/api/adaptive/session-teach/route.ts', 'utf8')
const extractorsSource = readFileSync('lib/materials/extractors.ts', 'utf8')
assert.match(alaiSource, /case 'openrouter':\s*return 'google\/gemini-2\.5-flash'/)
assert.match(alaiSource, /selectedProvider: Provider = fallbackAllowed \? 'groq' : 'openrouter'/)
assert.match(alaiSource, /event: 'openrouter_credits_exhausted'/)
assert.doesNotMatch(sessionTeachSource, /excludeProviders:\s*\[['"]openrouter/)
assert.match(sessionTeachSource, /fallbackError: context\.stage\.startsWith\('split_'\)/)
assert.ok(extractorsSource.indexOf("event: 'openrouter_credits_exhausted'") < extractorsSource.indexOf("https://api.groq.com/openai/v1/chat/completions"))
console.log('provider-policy-contracts: 22 contracts PASS')
