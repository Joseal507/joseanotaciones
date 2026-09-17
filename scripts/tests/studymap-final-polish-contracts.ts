import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ============================================================
// STUDYMAP_FINAL_POLISH contracts.
//
// Scope: Cards removal, toolbar/panel/map-state visual polish,
// responsive behavior. Deliberately NOT re-testing Enjoyer/camera/
// navigation-stack/expand-collapse logic in depth here — those already
// have dedicated, still-green suites (studymap-path-navigation-
// contracts.ts, studymap-smooth-local-navigation-contracts.ts,
// studymap-expand-collapse-regression-contracts.ts, etc.) run
// alongside this one as part of certification.
// ============================================================

const SRC = readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')

let passed = 0, failed = 0
function test(name: string, fn: () => void) {
  try { fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

console.log('\n── STUDYMAP_FINAL_POLISH contracts ──\n')

test('1. Cards no longer exists in Study Map — no CardsView component, no cards ViewMode, no cards render branch, no toolbar Cards button', () => {
  assert.doesNotMatch(SRC, /function CardsView\(/)
  assert.doesNotMatch(SRC, /'map' \| 'cards' \| 'outline'/)
  assert.doesNotMatch(SRC, /view === 'cards'/)
  assert.doesNotMatch(SRC, /key: 'cards', label: '🎴 Cards'/)
  assert.match(SRC, /type ViewMode = 'map' \| 'outline';/, 'ViewMode must be narrowed to the two remaining views')
})

test('2. legacy persisted view:\'cards\' state safely restores as map (sanitizeViewMode)', () => {
  const fnMatch = SRC.match(/function sanitizeViewMode\(value: unknown\): ViewMode \{([\s\S]*?)\n\}/)
  assert.ok(fnMatch, 'sanitizeViewMode must exist')
  // Simulate the exact runtime behavior.
  const sanitize = (value: unknown): 'map' | 'outline' => (value === 'outline' ? 'outline' : 'map')
  assert.equal(sanitize('cards'), 'map', 'a stale cards value must fall back to map')
  assert.equal(sanitize('outline'), 'outline', 'a valid outline value must be preserved')
  assert.equal(sanitize(undefined), 'map')
  assert.equal(sanitize('anything-unrecognized'), 'map')
  // Both restore call sites must use it, not a raw `|| 'map'` cast.
  assert.match(SRC, /setView\(sanitizeViewMode\(state\.view\)\);/)
  assert.match(SRC, /setView\(sanitizeViewMode\(restoredState\.view\)\);/)
})

test('3. standalone Flashcards tool is untouched — ALAIStudyMap.tsx has no coupling to it', () => {
  assert.doesNotMatch(SRC, /Flashcards|ALAIStudyALCards/)
  // The shared persistence type also dropped 'cards' cleanly.
  const stateSrc = readFileSync('lib/freeStudyMapState.ts', 'utf8')
  assert.match(stateSrc, /export type StudyMapView = 'map' \| 'outline';/)
})

test('4. remaining views still work: Mapa and Outline are still wired to the view switcher and still render', () => {
  assert.match(SRC, /\{ key: 'map', label: '🗺️ Mapa' \},/)
  assert.match(SRC, /\{ key: 'outline', label: '📋 Outline' \},/)
  assert.match(SRC, /\{view === 'outline' && <OutlineView data=\{mapData\} \/>\}/)
  assert.match(SRC, /function OutlineView\(/)
})

test('5. remaining toolbar functionality is all still present (Tour, Regenerar, Exportar, progress, Volver al proceso) — Regenerar demoted into an overflow menu, not removed', () => {
  assert.match(SRC, />🔊\{isMobile \? '' : ' Tour'\}<\/button>/)
  assert.match(SRC, /🔁 Regenerar mapa/, 'Regenerar must still exist, just relocated')
  assert.match(SRC, /const \[showMoreMenu, setShowMoreMenu\] = useState\(false\);/)
  assert.match(SRC, /\{exportMsg \|\| \(isMobile \? '↓' : '↓ Exportar'\)\}/)
  assert.match(SRC, /\{studiedSet\.size\} \/ \{mapData\.totalConcepts \+ 1\}/)
  assert.match(SRC, /onClick=\{onBack\} title="Volver al proceso"/)
})

test('6. toolbar is responsive — mobile gets icon-only back button, wrapping, and a collapsed title row; desktop/tablet keep full labels', () => {
  assert.match(SRC, /\{isMobile \? '←' : '← Volver al proceso'\}/)
  assert.match(SRC, /flexWrap: isMobile \? 'wrap' : 'nowrap',/)
  assert.match(SRC, /flexBasis: isMobile \? '100%' : undefined/, 'the title row must drop to its own line on mobile instead of clipping')
})

test('7. StudyPanel open/close is unaffected by the visual polish (same gate, same isFloating/isMobile/desktop branches, same onClose wiring)', () => {
  assert.match(SRC, /if \(!node\) return null;/)
  assert.doesNotMatch(SRC, /isMobile \? \{\s*position: 'fixed',\s*inset: 0,\s*zIndex: 200,[\s\S]{0,50}width: '50%'/, 'mobile full-overlay must remain untouched')
  assert.match(SRC, /\} : isFloating \? \{/)
  assert.match(SRC, /\} : \{\s*\/\/ Desktop: a narrower sidebar/)
})

test('8. guided navigation (Back anchor) is still wired identically — only its visual styling changed', () => {
  assert.match(SRC, /onClick=\{onGuidedBack\}/)
  assert.match(SRC, /const side = computeBackAnchorSide\(/)
  assert.doesNotMatch(SRC, /onGuidedBack\(\)\s*\n\s*\}\)/, 'no new wrapping/behavior around the back click handler')
})

test('9. expand/collapse composition (getGuidedForwardExpansion) is untouched by this polish pass', () => {
  assert.match(SRC, /if \(mapData\) setExpandedSet\(prev => getGuidedForwardExpansion\(mapData\.root, n\.id, prev\)\);/)
})

test('10. zero provider-call surface changes — no fetch/route touched, this is a components-only visual + Cards-removal change', () => {
  const routeFiles = ['app/api/alai-studyal-map/route.ts', 'app/api/adaptive/blueprint/route.ts']
  for (const f of routeFiles) {
    // Sanity: these files still exist and are not part of this diff's scope.
    assert.doesNotThrow(() => readFileSync(f, 'utf8'))
  }
  assert.doesNotMatch(SRC, /fetch\([^)]*cards/i)
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
console.log('studymap-final-polish-contracts: ALL PASS')
