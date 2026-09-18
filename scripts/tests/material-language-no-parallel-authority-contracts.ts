import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Active Free/Adaptive generation code must not import the es/en-only detector.
// Legacy raw-text branches (not dispatched for Free sessions) are allowlisted explicitly.
const LEGACY_ALLOWLIST = new Set([
  'app/api/alai-studyal-exam/route.ts', // generateExam/adaptExam: not dispatched by POST
  'app/api/alai-studyal-map/route.ts', // legacy `texto` branch: unreachable from UI, auth-gated
  'app/api/alai-studyal-cheat-codes/route.ts', // legacy materialText variant: only when no sessionId
])
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e) && !/\.bak/.test(e)) out.push(p)
  }
  return out
}
const offenders = [...walk('lib/materialBrain'), ...walk('lib/adaptive'), ...walk('app/api/adaptive'),
  'app/api/alai-studyal-chat/route.ts', 'app/api/alai-studyal-quizzes/route.ts', 'app/api/flashcards-v2/route.ts',
  'app/api/alai-studyal-repasar/route.ts', 'lib/truquitos/artifact.ts']
  .filter(f => /lib\/detectLanguage'/.test(readFileSync(f, 'utf8')))
assert.deepEqual(offenders, [], `parallel es/en detector in active path: ${offenders.join(', ')}`)

// Legacy allowlisted routes: their Enjoyer dispatch must exist and precede legacy work.
for (const f of LEGACY_ALLOWLIST) assert.match(readFileSync(f, 'utf8'), /getAuthoritativeFreeSession/, `${f} lacks Free-session Enjoyer dispatch`)
const exam = readFileSync('app/api/alai-studyal-exam/route.ts', 'utf8')
assert.equal((exam.match(/\bgenerateExam\(/g) || []).length, 1, 'generateExam must have no call sites (definition only)')
assert.equal((exam.match(/\badaptExam\(/g) || []).length, 1, 'adaptExam must have no call sites (definition only)')

// Every Adaptive route resolves the canonical language and injects the shared instruction.
for (const r of ['blueprint', 'session-teach', 'session-ask', 'session-chat', 'session-eval', 'session-reteach', 'session-check', 'session-copy']) {
  const src = readFileSync(`app/api/adaptive/${r}/route.ts`, 'utf8')
  assert.match(src, /(resolve|normalize|detect)MaterialLanguage\(/, `${r}: no canonical resolve`)
  assert.match(src, /academicLanguageInstruction\(/, `${r}: no shared instruction`)
}
// Client never supplies generation language authority to Free Flashcards/Quiz prompts.
assert.match(readFileSync('lib/materialBrain/flashcards/enjoyerGenerator.ts', 'utf8'), /language: materialLanguage/)
console.log('PASS no parallel language authority in active Free/Adaptive paths; legacy branches allowlisted')
