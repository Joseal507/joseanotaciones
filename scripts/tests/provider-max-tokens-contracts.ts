import assert from 'node:assert/strict'
import { providerMaxTokens } from '../../lib/alai'

// ============================================================
// providerMaxTokens contracts
//
// Cheap, deterministic unit tests for the provider-specific token
// budget mapping used by alai()/alaiJson().
// ============================================================

function caseLabel(provider: string, requested: number | undefined, expected: number) {
  const req = requested === undefined ? 'default' : `requested=${requested}`
  return `${provider} (${req}) → ${expected}`
}

function check(provider: string, requested: number | undefined, expected: number) {
  const actual = providerMaxTokens(provider as any, requested)
  assert.equal(actual, expected, caseLabel(provider, requested, expected))
}

async function main() {
  console.log('\n--- providerMaxTokens contracts ---\n')

  // OpenRouter: explicit budgets must be respected; default stays high.
  check('openrouter', undefined, 8192)
  check('openrouter', 800, 800)
  check('openrouter', 4096, 4096)
  check('openrouter', 16384, 16384)

  // Cerebras: floor at 4000, default 4096 when not requested.
  check('cerebras', undefined, 4096)
  check('cerebras', 100, 4000)
  check('cerebras', 4000, 4000)
  check('cerebras', 8192, 8192)

  // Other providers: pass through explicit value or default to 4096.
  check('groq', undefined, 4096)
  check('groq', 500, 500)
  check('github', undefined, 4096)
  check('github', 2000, 2000)

  console.log('✅ All providerMaxTokens contracts passed.')
}

main().catch(error => {
  console.error('❌ providerMaxTokens contracts failed:', error)
  process.exit(1)
})
