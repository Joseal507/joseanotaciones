import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const activeRoutes = [
  'app/api/adaptive/blueprint/route.ts',
  'app/api/adaptive/generate-plan/route.ts',
  'app/api/adaptive/session-ask/route.ts',
  'app/api/adaptive/session-check/route.ts',
  'app/api/adaptive/session-copy/route.ts',
  'app/api/adaptive/session-eval/route.ts',
  'app/api/adaptive/session-reteach/route.ts',
  'app/api/adaptive/session-teach/route.ts',
]

for (const path of activeRoutes) {
  const source = readFileSync(path, 'utf8')
  assert.doesNotMatch(source, /api\.groq\.com|provider\s*:\s*['"]groq['"]|selectedProvider\s*=\s*['"]groq['"]/i, `${path} selecciona Groq directamente`)
  assert.doesNotMatch(source, /excludeProviders\s*:\s*\[[^\]]*['"]openrouter['"]/i, `${path} excluye OpenRouter sin contrato financiero`)
}

for (const path of [
  'app/api/adaptive/session-teach/route.ts',
  'app/api/adaptive/session-reteach/route.ts',
  'app/api/adaptive/session-eval/route.ts',
]) {
  const source = readFileSync(path, 'utf8')
  assert.match(source, /\balai\s*\(/, `${path} debe usar el selector canónico`)
  assert.doesNotMatch(source, /new\s+Groq|Groq\s*\(/, `${path} no puede construir cliente Groq`)
}

const alai = readFileSync('lib/alai.ts', 'utf8')
assert.match(alai, /case 'openrouter':\s*return 'google\/gemini-2\.5-flash'/)
assert.match(alai, /selectedProvider:\s*Provider\s*=\s*fallbackAllowed\s*\?\s*'groq'\s*:\s*'openrouter'/)
assert.match(alai, /fallbackAllowed\s*=\s*Boolean\(params\.fallbackError\s*&&\s*shouldFallbackToGroq\(params\.fallbackError\)\)/)
assert.match(alai, /PROVIDER_POLICY_VIOLATION:openrouter_exclusion_without_credits_exhausted/)
assert.match(alai, /normalizedFailureReason:\s*'OPENROUTER_CREDITS_EXHAUSTED'/)

const policy = readFileSync('lib/ai/providerPolicy.ts', 'utf8')
assert.match(policy, /provider === 'openrouter'/)
assert.match(policy, /return classifyProviderFailure\(error\) === 'OPENROUTER_CREDITS_EXHAUSTED'/)

console.log(`adaptive-provider-route-contracts: ${activeRoutes.length} rutas activas PASS`)
