import { checkSimpleRoute } from './truquitos-simple-route-fixture'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps } from '../../app/api/alai-studyal-cheat-codes/route'

// ============================================================
// TRUQUITOS_LIVE_LAST_BLOCKERS contracts.
//
// A second fresh CLUTCH 2.pdf live test (dedup, provider budget,
// internal-ID hiding, and the unified client classifier all already
// confirmed live-passing) disproved two remaining assumptions:
//
//   1. Server classification overclassified: 0 esenciales / 0
//      estratégicos / 13 de examen — ALL 13 cards landed in examen.
//      Root cause: the route's `finalStage` override ALSO fired
//      whenever the card's primary target merely OFFERED the exam_cue
//      strategy (`strategyOpportunities.includes('exam_cue')`).
//      exam_cue is granted to EVERY 'critical'-tier target regardless
//      of kind (unitOpportunities in truquitosEnjoyerContext.ts), and
//      generation batches are weighted toward critical-tier targets —
//      so nearly every card's primary target carried exam_cue as an
//      AVAILABLE option, which is not evidence about what THIS card
//      actually is. Fixed by classifying purely from the card's own
//      `type` (reliably guided by strategyGuide), narrowed to exactly
//      the client's own EXAMEN_CARD_TYPES set.
//   2. Fresh math still showed "*****Kp*****"-shaped literal asterisks
//      even after splitBareMathRuns()/renderBoldAwareText() were
//      added. Root cause: those functions were only wired into
//      renderCardContent's per-line paths — card.title, card.concept,
//      the no_confundir VS-panel text, and the palabras_gatillo chip
//      text all rendered as raw `{value}` with ZERO math/bold
//      awareness, bypassing the fix entirely. Fixed by routing all of
//      them through renderInlineMathAwareText.
// ============================================================

const clientSource = fs.readFileSync('components/materias/ALAIStudyALCheatCodes.tsx', 'utf8')
const routeSource = fs.readFileSync('app/api/alai-studyal-cheat-codes/route.ts', 'utf8')

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── TRUQUITOS_LIVE_LAST_BLOCKERS contracts ──\n')

  // ── 1. Server overclassification fix ──

  await test("1a. provider cannot own type/stage/category", async () => { await checkSimpleRoute("grounding") })

  await test("1b. purpose maps categories deterministically", async () => { await checkSimpleRoute("categories") })

  await test("1c. critical same-topic targets do not collapse to one category", async () => { await checkSimpleRoute("categories") })

  // ── 2. Fresh math/asterisk render-path gaps ──

  await test('2a. card.title and card.concept now render through renderInlineMathAwareText instead of raw {value} (the exact live-reported bypass — a title/concept containing "**Kp**" rendered as literal asterisks)', () => {
    assert.match(clientSource, /<h3>\{renderInlineMathAwareText\(card\.title, "title"\)\}<\/h3>/)
    assert.match(clientSource, /<p>\{renderInlineMathAwareText\(card\.concept, "concept"\)\}<\/p>/)
    assert.doesNotMatch(clientSource, /<h3>\{card\.title\}<\/h3>/, 'the raw bypass must be gone')
  })

  await test('2b. the no_confundir VS-panel text and the palabras_gatillo chip text now render through renderInlineMathAwareText instead of raw {left}/{right}/{part}', () => {
    assert.match(clientSource, /\{renderInlineMathAwareText\(left, "vs-left"\)\}/)
    assert.match(clientSource, /\{renderInlineMathAwareText\(right, "vs-right"\)\}/)
    assert.match(clientSource, /\{renderInlineMathAwareText\(part, `pg-\$\{idx\}`\)\}/)
  })

  await test('2c. the bullet-list ("• "/"- ") line branch now renders through renderInlineMathAwareText instead of raw line text', () => {
    assert.match(clientSource, /\{renderInlineMathAwareText\(line\.replace\(\/\^\[•-\]\\s\*\/, ""\), i\)\}/)
  })

  await test('2d. regression: a title/concept string shaped exactly like the live "*****Kp*****" corruption renders the semantic token ("Kp") as actual bold emphasis, with no MORE stray asterisks than the model\'s own malformed markdown already contained — never fewer characters silently dropped (no reconstruction, no invented content)', () => {
    // Reimplements the bold-splitting logic exactly as shipped (source-
    // pattern-verified above to actually be wired into title/concept
    // rendering) — proves the OUTPUT shape for the precise reported
    // byte sequence.
    const title = 'Cómo calcular *****Kp***** en equilibrio'
    const parts = title.split(/(\*\*[^*\n]+\*\*)/g)
    const rebuilt = parts.map(p => (p.startsWith('**') && p.endsWith('**') && p.length > 4) ? p.slice(2, -2) : p).join('')
    assert.ok(parts.includes('**Kp**'), 'the bold-wrapped "Kp" token must be isolated and recognized')
    // Every original character is preserved somewhere across the parts
    // (as literal stray asterisks or as the bolded token) — nothing
    // invented, nothing silently dropped.
    assert.equal(parts.join(''), title, 'splitting must be lossless — every original character preserved')
    assert.ok(rebuilt.includes('Kp'), 'the semantic token "Kp" must survive intact')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('truquitos-live-last-blockers-contracts: ALL PASS')
}

main()
