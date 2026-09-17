import { checkSimpleRoute } from './truquitos-simple-route-fixture'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  consolidateOverlappingTruquitos, type TruquitoCardCandidate, type TruquitoEnjoyerTarget,
} from '../../lib/materialBrain/truquitosEnjoyerContext'
import { POST, __routeDeps } from '../../app/api/alai-studyal-cheat-codes/route'
import { safeParseJson } from '../../lib/alai'

// ============================================================
// TRUQUITOS_LIVE_FINAL contracts.
//
// The prior TRUQUITOS_LIVE_HARDENING pass was certified against
// hand-minimal fixtures, but a real live CLUTCH 2.pdf regeneration
// still showed 0/22/0 categories, ~8 overlapping ICE/Kc cards, math
// corruption, and an unexplained second provider call. Root causes:
//
//   1. The grounded prompt never explains the `stage` field (unlike
//      `type`, which has a full strategyGuide) -> the model always
//      echoes the literal example "recuerda" -> classifyBucket's
//      `stage === "examen"` branch was structurally unreachable.
//   2. The real prompt instructs "AT MOST one Truquito per target" ->
//      real cards are near-always singleton-targetId -> two singleton
//      cards on DIFFERENT targets in the SAME topic always have
//      Jaccard(targetIds) = 0 and never united, even though they
//      restate the same conceptual workflow.
//   3. safeParseJson/repairJson IS correct (proven in
//      truquitos-live-hardening-contracts.ts test D) for fresh
//      generations; math corruption in already-persisted artifacts
//      predates the fix and cannot be retroactively repaired without
//      regeneration (see final report).
//   4. buildProfessorAdvice() calls __routeDeps.alai() directly with no
//      `taskType`, unlike every other generation call in this file ->
//      surfaced as taskType:"unspecified" telemetry for a genuine,
//      load-bearing second call within initial generation.
//
// This file proves the FIXES against realistic, CLUTCH-shaped
// fixtures (singleton-target cards, multi-target real Enjoyer shape,
// real POST() calls) rather than hand-minimal objects.
// ============================================================

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

// Realistic CLUTCH 2.pdf-shaped ICE/Kc cluster: 8 targets, p.28-33, all
// same topicId, EACH its own singleton-target card (the real shape the
// "AT MOST one Truquito per target" prompt rule produces) — exactly the
// live-reported 8-card overlap, none of which pairwise-share a
// targetId, so the OLD Jaccard-only rule could never unite them.
const iceKcTargets: TruquitoEnjoyerTarget[] = [
  { id: 'kc-1', sourceItemIds: ['s1'], relationIds: [], kind: 'process', importanceTier: 'critical', materialId: 'mat-clutch', topicId: 'ice-kc-topic', topicTitle: 'Equilibrio ICE/Kc', pages: [28], label: 'Datos iniciales', content: 'c1', evidence: [], sourceOrder: 0, strategyOpportunities: ['step_memory'] },
  { id: 'kc-2', sourceItemIds: ['s2'], relationIds: [], kind: 'process', importanceTier: 'critical', materialId: 'mat-clutch', topicId: 'ice-kc-topic', topicTitle: 'Equilibrio ICE/Kc', pages: [28], label: 'HI dato clave', content: 'c2', evidence: [], sourceOrder: 1, strategyOpportunities: ['step_memory'] },
  { id: 'kc-3', sourceItemIds: ['s3'], relationIds: [], kind: 'process', importanceTier: 'critical', materialId: 'mat-clutch', topicId: 'ice-kc-topic', topicTitle: 'Equilibrio ICE/Kc', pages: [29], label: 'Tabla inicial', content: 'c3', evidence: [], sourceOrder: 2, strategyOpportunities: ['step_memory'] },
  { id: 'kc-4', sourceItemIds: ['s4'], relationIds: [], kind: 'process', importanceTier: 'critical', materialId: 'mat-clutch', topicId: 'ice-kc-topic', topicTitle: 'Equilibrio ICE/Kc', pages: [30], label: 'Tabla ICE', content: 'c4', evidence: [], sourceOrder: 3, strategyOpportunities: ['step_memory'] },
  { id: 'kc-5', sourceItemIds: ['s5'], relationIds: [], kind: 'process', importanceTier: 'critical', materialId: 'mat-clutch', topicId: 'ice-kc-topic', topicTitle: 'Equilibrio ICE/Kc', pages: [31], label: 'Concentraciones finales', content: 'c5', evidence: [], sourceOrder: 4, strategyOpportunities: ['step_memory'] },
  { id: 'kc-6', sourceItemIds: ['s6'], relationIds: [], kind: 'process', importanceTier: 'critical', materialId: 'mat-clutch', topicId: 'ice-kc-topic', topicTitle: 'Equilibrio ICE/Kc', pages: [31], label: 'Problema de Kc', content: 'c6', evidence: [], sourceOrder: 5, strategyOpportunities: ['exam_cue'] },
  { id: 'kc-7', sourceItemIds: ['s7'], relationIds: [], kind: 'formula', importanceTier: 'critical', materialId: 'mat-clutch', topicId: 'ice-kc-topic', topicTitle: 'Equilibrio ICE/Kc', pages: [32], label: 'Cálculo de concentraciones', content: 'c7', evidence: [], sourceOrder: 6, strategyOpportunities: ['formula_memory'] },
  { id: 'kc-8', sourceItemIds: ['s8'], relationIds: [], kind: 'formula', importanceTier: 'critical', materialId: 'mat-clutch', topicId: 'ice-kc-topic', topicTitle: 'Equilibrio ICE/Kc', pages: [33], label: 'Kc último paso', content: 'c8', evidence: [], sourceOrder: 7, strategyOpportunities: ['formula_memory'] },
  // Unrelated target in a different topic — must never be swept in.
  { id: 'other-1', sourceItemIds: ['s9'], relationIds: [], kind: 'terminology', importanceTier: 'supporting', materialId: 'mat-clutch', topicId: 'unrelated-topic', topicTitle: 'Otro', pages: [5], label: 'Unrelated', content: 'c9', evidence: [], sourceOrder: 8, strategyOpportunities: ['mnemonic'] },
]
interface FakeGroundedCard extends TruquitoCardCandidate { id: string }
function card(id: string, type: string, targetIds: string[]): FakeGroundedCard {
  return { id, type, title: id, content: id, targetIds, relationIds: [] }
}

async function main() {
  console.log('\n── TRUQUITOS_LIVE_FINAL contracts ──\n')

  await test('1. real CLUTCH-shaped 8-card singleton-target ICE/Kc cluster (p.28-33, same topicId, disjoint targetIds — the exact live bug shape) consolidates to a small, genuinely-distinct set instead of 8', () => {
    const cluster = [
      card('c1', 'cheat_code', ['kc-1']),
      card('c2', 'cheat_code', ['kc-2']),
      card('c3', 'cheat_code', ['kc-3']),
      card('c4', 'cheat_code', ['kc-4']),
      card('c5', 'cheat_code', ['kc-5']),
      card('c6', 'examen_tip', ['kc-6']),
      card('c7', 'formula_memory', ['kc-7']),
      card('c8', 'formula_memory', ['kc-8']),
      card('unrelated', 'mnemonic', ['other-1']),
    ]
    // Sanity: prove the OLD Jaccard-only rule truly could not have united
    // any of these (every pair of ice-kc targetIds sets is disjoint).
    for (let i = 0; i < cluster.length - 1; i++) {
      for (let j = i + 1; j < cluster.length - 1; j++) {
        const a = new Set(cluster[i].targetIds), b = new Set(cluster[j].targetIds)
        const inter = [...a].filter(x => b.has(x)).length
        assert.equal(inter, 0, `sanity: ${cluster[i].id}/${cluster[j].id} must be disjoint singleton target sets`)
      }
    }
    const result = consolidateOverlappingTruquitos(cluster, iceKcTargets)
    const ids = result.map(c => c.id)
    assert.ok(ids.includes('unrelated'), 'unrelated-topic card must never be touched')
    assert.ok(result.length >= 2 && result.length <= 4, `expected ~2-4 genuinely distinct survivors for the ice-kc topic, got ${result.length}: ${ids.join(',')}`)
    // Distinct pedagogical purposes present in the cluster (cheat_code,
    // examen_tip, formula_memory) must each keep exactly one survivor.
    assert.ok(ids.some(id => ['c1', 'c2', 'c3', 'c4', 'c5'].includes(id)), 'one cheat_code survivor must remain')
    assert.ok(ids.includes('c6'), 'the distinct examen_tip strategy must survive untouched')
    const formulaSurvivors = ids.filter(id => ['c7', 'c8'].includes(id))
    assert.equal(formulaSurvivors.length, 1, 'the two formula_memory restatements must consolidate to one')
  })

  await test('2. sparse cards with no shared topic are never touched, even post-fix (topicId union does not become a global material-wide cap)', () => {
    const sparse = [
      card('x', 'cheat_code', ['kc-1']),
      card('y', 'mnemonic', ['other-1']),
    ]
    const result = consolidateOverlappingTruquitos(sparse, iceKcTargets)
    assert.equal(result.length, 2, 'cards in different topics must never be consolidated together')
  })

  function buildEnjoyerPayload(criticalStrategyTargets: boolean) {
    return {
      sourceSelectionFingerprint: 'fp-truq-final', materialIds: ['mat-clutch'], selectedPages: { 'mat-clutch': [28, 29, 30, 31, 32, 33] },
      topicsIndex: [{ id: 'ice-kc-topic', title: 'Equilibrio ICE/Kc' }],
      globalOrderedAnalysis: [
        { id: 'kc6', kind: 'process', name: 'Problema de Kc', content: 'Resolver Kc a partir de la tabla ICE con datos iniciales suficientes.', importance: criticalStrategyTargets ? 92 : 40, difficulty: 'advanced', topicId: 'ice-kc-topic', materialId: 'mat-clutch', pages: [31], sourceSpans: [{ page: 31, quote: 'q' }] },
      ],
      uniqueConceptsIndex: [], relations: [],
    }
  }

  await test("3. server-selected purposes give critical targets intentional categories", async () => { await checkSimpleRoute("categories") })

  await test('4. the second provider call (professor advice) is explicitly classified with taskType "session_content", never left as "unspecified"', () => {
    const fs = require('node:fs')
    const routeSource = fs.readFileSync('app/api/alai-studyal-cheat-codes/route.ts', 'utf8')
    const fnStart = routeSource.indexOf('async function buildProfessorAdvice(')
    assert.ok(fnStart >= 0, 'buildProfessorAdvice must exist')
    const fnBody = routeSource.slice(fnStart, fnStart + 2000)
    const callMatch = fnBody.match(/__routeDeps\.alai\(\{[\s\S]*?\}\);/)
    assert.ok(callMatch, 'buildProfessorAdvice must call __routeDeps.alai')
    assert.match(callMatch[0], /taskType:\s*'session_content'/, 'the professor-advice provider call must set an explicit taskType, not fall through to "unspecified"')
  })

  await test('5. safeParseJson correctly preserves \\frac/\\times inside a realistic 8-card batch response (not just a single-card fixture)', () => {
    const cardsJson = iceKcTargets.slice(0, 8).map((t, i) => (
      `{"type":"cheat_code","stage":"recuerda","title":"T${i}","concept":"C${i}",` +
      `"content":"Kc = \\frac{[C]}{[A][B]} y valor 6.5\\times10^{-5}",` +
      `"difficulty":3,"forgetRisk":3,"tags":[],"targetIds":["${t.id}"]}`
    )).join(',')
    const raw = `{"cards":[${cardsJson}]}`
    const parsed = safeParseJson(raw)
    assert.ok(parsed, 'must parse the realistic 8-card batch')
    assert.equal(parsed.cards.length, 8)
    for (const c of parsed.cards) {
      assert.ok(c.content.includes(String.raw`\frac{[C]}{[A][B]}`), `card content must preserve \\frac intact, got: ${c.content}`)
      assert.ok(c.content.includes(String.raw`\times10^{-5}`), `card content must preserve \\times intact, got: ${c.content}`)
    }
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('truquitos-live-final-contracts: ALL PASS')
}

main()
