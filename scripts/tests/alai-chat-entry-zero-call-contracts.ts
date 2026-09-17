import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ============================================================
// STUDYAL — ALAI CHAT ENTRY ZERO-CALL LIFECYCLE CONTRACTS
// Verifies all 10 invariants ensuring ALAI Chat entry in Free Mode
// requires 0 provider calls, 0 preparation screens, and 0 background
// extraction triggers when using persisted Enjoyer authority.
// ============================================================

let passed = 0
let failed = 0

function runTest(name: string, fn: () => void) {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (err: any) {
    console.error(`  ❌ ${name}`)
    console.error(`     ${err?.message || err}`)
    failed++
  }
}

console.log('\n── ALAI Chat Entry Zero-Call Lifecycle Contracts ──\n')

const pageSource = readFileSync('app/materias/page.tsx', 'utf8')
const chatComponentSource = readFileSync('components/materias/ALAIStudyALChat.tsx', 'utf8')
const coachComponentSource = readFileSync('components/materias/MasteryCoach.tsx', 'utf8')
const chatRouteSource = readFileSync('app/api/alai-studyal-chat/route.ts', 'utf8')

// Invariant 1: ALAI Chat not Material-Brain gated (VISTA_TOOL has no alai)
runTest('1. ALAI Chat is excluded from VISTA_TOOL Material-Brain capability gating', () => {
  const vistaToolMatch = pageSource.match(/const VISTA_TOOL: Partial<Record<Vista, FreeTool>> = \{([\s\S]*?)\};/)
  assert.ok(vistaToolMatch, 'VISTA_TOOL must be extractable from page.tsx')
  assert.doesNotMatch(vistaToolMatch[1], /alai:/, 'alai must not exist in VISTA_TOOL')
})

// Invariant 2: onOpenAlai does not arm brainSourceSelection
runTest('2. onOpenAlai does not arm brainSourceSelection or start Material Brain', () => {
  const onOpenAlaiMatch = pageSource.match(/onOpenAlai=\{\(mats\?: any\[\], sel\?: any\[\], sessionId\?: string \| null\) => \{([\s\S]*?)\n            \}\}/)
  assert.ok(onOpenAlaiMatch, 'onOpenAlai handler must be extractable')
  const executableCode = onOpenAlaiMatch[1].split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(executableCode, /setBrainSourceSelection/, 'onOpenAlai must not call setBrainSourceSelection in executable code')
})

// Invariant 3: Chat mounts immediately when vista === 'alai' without preparation gate
runTest('3. ALAIStudyALChat mounts immediately on vista === "alai" without preparationGate.shouldGate block', () => {
  const chatMountMatch = pageSource.match(/\{vista === 'alai' && temaActual && materiaActual && \(\s*<ALAIStudyALChat/)
  assert.ok(chatMountMatch, 'ALAIStudyALChat must mount on vista === "alai" without !preparationGate.shouldGate')
  assert.doesNotMatch(chatMountMountSurrounding(pageSource), /!preparationGate\.shouldGate/, 'preparationGate must not gate ALAIStudyALChat mount')
})

function chatMountMountSurrounding(src: string): string {
  const idx = src.indexOf('<ALAIStudyALChat')
  if (idx < 0) return ''
  return src.slice(Math.max(0, idx - 120), idx + 20)
}

// Invariant 4: Chat does not import or call useAuthorizedSource
runTest('4. ALAIStudyALChat does not import or call useAuthorizedSource (no /api/enfoques/teorico/start calls)', () => {
  assert.doesNotMatch(chatComponentSource, /useAuthorizedSource/, 'ALAIStudyALChat must not import or use useAuthorizedSource')
  assert.doesNotMatch(chatComponentSource, /loadingText/, 'ALAIStudyALChat must not track or block on loadingText')
  assert.doesNotMatch(chatComponentSource, /materialText/, 'ALAIStudyALChat must not hold raw materialText state')
})

// Invariant 5: Chat entry does not trigger background concept extraction
runTest('5. Free Mode tool entry prevents autoExtractConcepts from firing via vista guard', () => {
  const autoExtractMatch = pageSource.match(/const autoExtractConcepts = async \(mastery: MaterialMastery\) => \{([\s\S]*?)\n  \}/)
  assert.ok(autoExtractMatch, 'autoExtractConcepts function must be extractable')
  assert.match(autoExtractMatch[1], /if \(vista !== 'tema'\) return;/, 'autoExtractConcepts must bail immediately if vista is not tema')
  
  const initMasteryMatch = pageSource.match(/const initMastery = \(materialIds: string\[\], materialNames: string\[\]\) => \{([\s\S]*?)\n  \}/)
  assert.ok(initMasteryMatch, 'initMastery function must be extractable')
  assert.match(initMasteryMatch[1], /vista === 'tema'/, 'initMastery must only schedule extraction when vista is tema')
})

// Invariant 6: MasteryCoach material scope strictly respects sourceSelection.materialIds
runTest('6. MasteryCoach materialIds and extraction scope respect canonical sourceSelection.materialIds', () => {
  assert.match(
    coachComponentSource,
    /if \(sourceSelection\?\.materialIds\?\.length\) return sourceSelection\.materialIds/,
    'MasteryCoach must prioritize sourceSelection.materialIds over raw materiales'
  )
  assert.match(
    coachComponentSource,
    /const targetMaterialId = sourceSelection\?\.materialIds\?\.\[0\] \|\| materialIds\[0\];/,
    'extractConcepts must derive targetMaterialId from sourceSelection.materialIds'
  )
})

// Invariant 7: Chat session restore still intact
runTest('7. ALAI Chat durable conversation state is preserved and restored by session and fingerprint', () => {
  assert.match(chatComponentSource, /readFreeToolState<DurableAlaiState>/, 'ALAIStudyALChat must read durable state')
  assert.match(chatComponentSource, /writeFreeToolState\(sessionId, effectiveSourceSelection\.fingerprint, 'alai'/, 'ALAIStudyALChat must write durable state scoped to fingerprint')
  assert.match(chatComponentSource, /initialAlaiState\(\)/, 'ALAIStudyALChat must have initial fallback state')
})

// Invariant 8: Chat POST uses Enjoyer authority via getAuthoritativeFreeSession
runTest('8. Chat route enforces server-side session authority and Enjoyer backing', () => {
  assert.match(chatRouteSource, /getAuthoritativeFreeSession\(sessionId, userId\)/, 'route must resolve session from server authority')
  assert.match(chatRouteSource, /sourceSelection\.fingerprint/, 'route must derive fingerprint from authoritative session')
  assert.match(chatRouteSource, /lookupStudyalMaterialEnjoyer/, 'route must lookup persisted StudyalMaterialEnjoyer')
  assert.match(chatRouteSource, /buildChatEnjoyerContext/, 'route must adapt Enjoyer into Chat context')
  assert.match(chatRouteSource, /retrieveForChat/, 'route must ground turns using Enjoyer retrieval')
})

// Invariant 9: No raw material text sent to Chat API; route forbids it
runTest('9. ALAI Chat sends no raw material text; route enforces RAW_SOURCE_AUTHORITY_FORBIDDEN', () => {
  assert.match(chatRouteSource, /RAW_SOURCE_AUTHORITY_FORBIDDEN/, 'route must reject any request asserting raw source text')
  const runTurnMatch = chatComponentSource.match(/const runTurn = useCallback\(async[\s\S]*?fetch\('\/api\/alai-studyal-chat'[\s\S]*?body: JSON\.stringify\(\{([\s\S]*?)\}\)/)
  assert.ok(runTurnMatch, 'Chat fetch call must be extractable')
  assert.doesNotMatch(runTurnMatch[1], /materialText/, 'Chat fetch payload must not include materialText')
})

// Invariant 10: Sibling Free Mode tools unaffected
runTest('10. Sibling Free Mode tool entrypoints remain intact and functional', () => {
  const siblingHandlers = ['onOpenFlashcards', 'onOpenQuiz', 'onOpenRepasar', 'onOpenAnalisis', 'onOpenExam']
  for (const handler of siblingHandlers) {
    const re = new RegExp(`${handler}=\\{\\(mats\\?: any\\[\\], sel\\?: any\\[\\], sessionId\\?: string \\| null\\) => \\{`)
    assert.match(pageSource, re, `page.tsx must provide ${handler}`)
  }
})

console.log(`\nResults: ${passed} passed, ${failed} failed\n`)
if (failed > 0) {
  process.exit(1)
}
console.log('ALAI_CHAT_ENTRY_ZERO_CALL_LIFECYCLE_FIXED')
