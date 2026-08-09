import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migratedRoutes = {
  flashcards: 'app/api/alai-studyal-cards/route.ts',
  maps: 'app/api/alai-studyal-map/route.ts',
  mapExplanation: 'app/api/alai-studyal-map-explain/route.ts',
  quizzes: 'app/api/alai-studyal-quizzes/route.ts',
  exam: 'app/api/alai-studyal-exam/route.ts',
  review: 'app/api/alai-studyal-repasar/route.ts',
  studyCards: 'app/api/alai-studyal-cheat-codes/route.ts',
}

for (const [name, path] of Object.entries(migratedRoutes)) {
  const source = readFileSync(path, 'utf8')
  assert.match(source, /generateValidatedLegacyJson/, `${name} must use the common generation pipeline`)
}

const quiz = readFileSync(migratedRoutes.quizzes, 'utf8')
assert.doesNotMatch(quiz, /const fallbacks = \['teoría'/)
assert.match(quiz, /INCOMPATIBLE_ACTIVITY/)
assert.match(quiz, /SEMANTIC_DUPLICATION/)
assert.match(quiz, /LOW_DIVERSITY/)

const review = readFileSync(migratedRoutes.review, 'utf8')
assert.doesNotMatch(review, /feedback: result\.text/)
assert.doesNotMatch(review, /No pude estructurar el análisis automáticamente/)

const exam = readFileSync(migratedRoutes.exam, 'utf8')
assert.doesNotMatch(exam, /Lote \$\{batchNum\} falló:[\s\S]{0,160}return \[\]/)

const map = readFileSync(migratedRoutes.maps, 'utf8')
assert.doesNotMatch(map, /Error chunk \$\{i \+ 1\}:[\s\S]{0,120}return \[\]/)

const helper = readFileSync('lib/ai/legacyRouteGeneration.ts', 'utf8')
for (const stage of ['format_repair', 'targeted_repair', 'simplified', 'split_individual', 'alternate_provider']) {
  assert.ok(helper.includes(stage), `legacy helper must implement ${stage}`)
}
assert.match(helper, /excludeProviders/)

console.log('legacy-ai-generation-routes: 20 route and fallback contracts PASS')
