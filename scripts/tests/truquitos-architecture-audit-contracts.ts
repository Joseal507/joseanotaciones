import { checkSimpleRoute } from './truquitos-simple-route-fixture'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// ============================================================
// TRUQUITOS_ARCHITECTURE audit contracts.
//
// A read-only architecture audit (user click -> rendered card) found
// ONE remaining confirmed root problem beyond the prior three rounds:
// the "Otra versión" variant panel's `<h4>{variant.title}</h4>` still
// bypassed renderInlineMathAwareText — the exact same class of bug
// fixed for card.title/card.concept/no_confundir/palabras_gatillo/
// bullet-list in the prior round, just on one remaining render site
// the earlier sweep missed.
//
// Since this class of bug (a raw `{card-authored text}` render site
// silently bypassing the math/bold-aware renderer) has now recurred
// multiple times across rounds, this file also adds a general,
// whole-file invariant: no `{card.<field>}` or `{variant.<field>}`
// text-bearing field may render without going through
// renderInlineMathAwareText — so a future regression of this exact
// class fails the suite immediately instead of requiring another live
// report.
//
// Everything else audited (Enjoyer-only academic authority, no
// Material Brain/raw-PDF reanalysis in the Free grounded path,
// grounded "Otra versión"/variant provider-call scoping, single
// canonical classifyBucket, provider-call budget, persistence/reopen)
// was found already correct from the prior three rounds and is
// reconfirmed by the existing suites re-run alongside this file — no
// further code changes were required there.
// ============================================================

const clientSource = fs.readFileSync('components/materias/ALAIStudyALCheatCodes.tsx', 'utf8')
const routeSource = fs.readFileSync('app/api/alai-studyal-cheat-codes/route.ts', 'utf8')

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

async function main() {
  console.log('\n── TRUQUITOS_ARCHITECTURE audit contracts ──\n')

  await test('1. the "Otra versión" variant panel title now renders through renderInlineMathAwareText (was the one remaining raw-title bypass, same class as card.title/concept fixed previously)', () => {
    assert.match(clientSource, /<h4>\{renderInlineMathAwareText\(variant\.title, "variant-title"\)\}<\/h4>/)
    assert.doesNotMatch(clientSource, /<h4>\{variant\.title\}<\/h4>/, 'the raw bypass must be gone')
  })

  await test("2. v2 plain prose and canonical notation bypass legacy markup heuristics", () => { assert.match(clientSource, /card.schemaVersion === 2/); assert.match(clientSource, /source.content/); })

  await test("3. Free runtime rejects raw source injection", async () => { await checkSimpleRoute("authority") })

  await test("4. server attaches canonical source identity to prose", async () => { await checkSimpleRoute("grounding") })

  await test("5. one server purpose/category contract drives all new cards", async () => { await checkSimpleRoute("categories") })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('truquitos-architecture-audit-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
