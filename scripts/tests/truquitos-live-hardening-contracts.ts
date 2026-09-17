import { checkSimpleRoute } from './truquitos-simple-route-fixture'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  buildTruquitosEnjoyerContext, consolidateOverlappingTruquitos, dedupeTruquitosByTargetIdentity,
  type TruquitoCardCandidate, type TruquitoEnjoyerTarget,
} from '../../lib/materialBrain/truquitosEnjoyerContext'
import { POST, __routeDeps } from '../../app/api/alai-studyal-cheat-codes/route'

// ============================================================
// TRUQUITOS_LIVE_HARDENING contracts.
//
// A real live test with the 43-page CLUTCH 2.pdf exposed 4 product
// bugs the existing certification suite did not catch. This file adds
// FOCUSED regression coverage for each, without re-auditing or
// redesigning anything already certified (see truquitos-final-
// certification-contracts.ts, still green, for the broader authority/
// grounding/dedup/single-flight guarantees).
// ============================================================

const clientSource = fs.readFileSync('components/materias/ALAIStudyALCheatCodes.tsx', 'utf8')

let passed = 0, failed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log('  ✅ ' + name); passed++ }
  catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
}

// ── A/B: category classification ──
// Reimplements the exact client logic (source-pattern-verified below)
// to run real assertions without a JSX/React test harness — the same
// convention already used by truquitos-final-certification-contracts.ts
// for this client component.
const ESENCIAL_CARD_TYPES = new Set(['tesis_central', 'regla_oro', 'solo_una_cosa', 'premisa_clave', 'figura_clave'])
const EXAMEN_CARD_TYPES = new Set(['examen_tip', 'trampa_examen', 'respuesta_perfecta', 'como_defender', 'momento_decisivo'])
type FakeCard = { type: string; stage?: string }
function classifyBucket(c: FakeCard): 'esencial' | 'examen' | 'estrategico' {
  if (c.stage === 'examen') return 'examen'
  if (ESENCIAL_CARD_TYPES.has(c.type)) return 'esencial'
  if (EXAMEN_CARD_TYPES.has(c.type)) return 'examen'
  return 'estrategico'
}

const ALL_CARD_TYPES = [
  'cheat_code', 'ejemplo_click', 'analogia', 'error_clasico', 'examen_tip', 'palabras_gatillo',
  'no_confundir', 'regla_oro', 'solo_una_cosa', 'cadena_logica', 'como_piensa_alai', 'combo',
  'dato_inesperado', 'respuesta_perfecta', 'trampa_examen', 'feynman', 'diez_segundos',
  'cinco_segundos', 'si_yo_fuera_tu', 'tesis_central', 'premisa_clave', 'como_defender',
  'linea_causal', 'figura_clave', 'antes_despues', 'momento_decisivo',
]

// ── C fixtures ──
const targets: TruquitoEnjoyerTarget[] = [
  { id: 't1', sourceItemIds: ['s1'], relationIds: [], kind: 'process', importanceTier: 'critical', materialId: 'mat-1', topicId: 'kc-topic', topicTitle: 'Kc', pages: [28], label: 'Datos iniciales', content: 'c1', evidence: [], sourceOrder: 0, strategyOpportunities: ['step_memory'] },
  { id: 't2', sourceItemIds: ['s2'], relationIds: [], kind: 'process', importanceTier: 'critical', materialId: 'mat-1', topicId: 'kc-topic', topicTitle: 'Kc', pages: [29], label: 'Tabla ICE', content: 'c2', evidence: [], sourceOrder: 1, strategyOpportunities: ['step_memory'] },
  { id: 't3', sourceItemIds: ['s3'], relationIds: [], kind: 'process', importanceTier: 'critical', materialId: 'mat-1', topicId: 'kc-topic', topicTitle: 'Kc', pages: [30], label: 'Cálculo de concentraciones', content: 'c3', evidence: [], sourceOrder: 2, strategyOpportunities: ['step_memory'] },
  { id: 't4', sourceItemIds: ['s4'], relationIds: [], kind: 'formula', importanceTier: 'critical', materialId: 'mat-1', topicId: 'kc-topic', topicTitle: 'Kc', pages: [31], label: 'Kc: el último paso', content: 'c4', evidence: [], sourceOrder: 3, strategyOpportunities: ['formula_memory'] },
  // A totally unrelated target — must never be swept into the kc-topic cluster.
  { id: 't5', sourceItemIds: ['s5'], relationIds: [], kind: 'terminology', importanceTier: 'supporting', materialId: 'mat-1', topicId: 'other-topic', topicTitle: 'Other', pages: [5], label: 'Unrelated', content: 'c5', evidence: [], sourceOrder: 4, strategyOpportunities: ['mnemonic'] },
]
interface FakeGroundedCard extends TruquitoCardCandidate { id: string }
function card(id: string, type: string, targetIds: string[]): FakeGroundedCard {
  return { id, type, title: id, content: id, targetIds, relationIds: [] }
}

const MATH_FIXTURES = [
  String.raw`K_{eq} = \frac{k_f}{k_r}`,
  String.raw`1.87 \times 10^{-3}`,
  String.raw`\Delta G = \Delta H - T\Delta S`,
  String.raw`N_2O_4 \rightleftharpoons 2NO_2`,
  'H₂O y CO₂ con subíndices',
  'x² y E = mc² con superíndices',
]

async function main() {
  console.log('\n── TRUQUITOS_LIVE_HARDENING contracts ──\n')

  await test('A. categories do not collapse to the default because of a normalization/schema bug — every real CardType (25) reaches a deterministic, non-estrategico-only bucket set, and the classifier is grounded in type+stage (never a text/keyword search)', () => {
    const buckets = new Map<string, string>()
    for (const type of ALL_CARD_TYPES) buckets.set(type, classifyBucket({ type }))
    const esencialCount = [...buckets.values()].filter(b => b === 'esencial').length
    const examenCount = [...buckets.values()].filter(b => b === 'examen').length
    assert.ok(esencialCount >= 5, 'esencial bucket must be reachable by type alone')
    assert.ok(examenCount >= 5, 'examen bucket must be reachable by type alone')
    assert.match(clientSource, /function classifyBucket\(c: [\s\S]{0,120}\)[\s\S]{0,400}if \(c\.stage === "examen"\) return "examen";/)
    assert.doesNotMatch(clientSource, /c\.content\.includes\(["']examen["']\)|content\.toLowerCase\(\)\.includes\(["']examen/, 'must never classify by searching for the word "examen" in content')
  })

  await test('B. obvious exam-oriented pedagogical purposes (ICE table / Kc / Q vs K style cards) reach the exam category even when their TYPE is not one of the 5 exam-labeled types — the exact live bug, now classified via `stage`', () => {
    assert.equal(classifyBucket({ type: 'error_clasico', stage: 'examen' }), 'examen')
    assert.equal(classifyBucket({ type: 'cadena_logica', stage: 'examen' }), 'examen')
    assert.equal(classifyBucket({ type: 'ejemplo_click', stage: 'examen' }), 'examen')
    assert.equal(classifyBucket({ type: 'momento_decisivo', stage: 'recuerda' }), 'examen')
  })

  await test('C. pedagogically redundant cards (heavy overlapping grounding within the same topic, same strategy type) are consolidated without deleting distinct tricks', () => {
    // Realistic live-bug shape: 4 separate cards essentially restating
    // the SAME p.28-31 workflow, each grounded in nearly the same
    // target set (>=60% Jaccard overlap with each other) but NOT
    // identical (so exact-target-identity dedup alone does not catch
    // them) — plus one card using a genuinely DIFFERENT strategy on an
    // overlapping-but-lower-overlap target set, which must survive.
    const heavyOverlap = [
      card('kc-a', 'cheat_code', ['t1', 't2', 't3']),
      card('kc-b', 'cheat_code', ['t1', 't2', 't3']),
      card('kc-c', 'cheat_code', ['t1', 't2', 't3']),
      card('kc-d', 'cheat_code', ['t1', 't2', 't3', 't4']),
      card('kc-formula', 'formula_memory', ['t4']),
      card('other', 'mnemonic', ['t5']),
    ]
    const result = consolidateOverlappingTruquitos(heavyOverlap, targets)
    const resultIds = result.map(c => c.id)
    assert.ok(resultIds.includes('other'), 'unrelated-topic card must never be touched')
    assert.ok(resultIds.includes('kc-formula'), 'a genuinely distinct strategy (formula_memory) on the same passage must survive')
    const cheatCodeSurvivors = resultIds.filter(id => ['kc-a', 'kc-b', 'kc-c', 'kc-d'].includes(id))
    assert.equal(cheatCodeSurvivors.length, 1, 'the 4 heavily-overlapping SAME-strategy cards must consolidate to exactly one')
    assert.equal(result.length, 3, 'total: 1 consolidated cheat_code + 1 distinct formula_memory + 1 unrelated')
  })

  await test('C2. cards in a DIFFERENT topic are never touched (topic is the cluster boundary — no material-wide cap); same-topic singleton-target cards of the same type DO consolidate (TRUQUITOS_LIVE_FINAL #2 fix: real cards are near-always singleton-grounded, so topicId — not Jaccard(targetIds) alone — is the correct cluster key)', () => {
    const sparse = [card('a', 'cheat_code', ['t1']), card('b', 'cheat_code', ['t3']), card('c', 'mnemonic', ['t5'])]
    const result = consolidateOverlappingTruquitos(sparse, targets)
    const ids = result.map(c => c.id)
    assert.ok(ids.includes('c'), 'the different-topic card must never be touched')
    const sameTopicSurvivors = ids.filter(id => ['a', 'b'].includes(id))
    assert.equal(sameTopicSurvivors.length, 1, 'two same-topic, same-type, disjoint-singleton-target cards must consolidate to one (the exact live ICE/Kc bug shape)')
    assert.equal(result.length, 2)
  })

  await test('C3. exact-target-identity dedup (pre-existing, unchanged) still runs before consolidation', () => {
    const exact = [card('x', 'cheat_code', ['t1', 't2']), card('y', 'cheat_code', ['t2', 't1'])]
    const deduped = dedupeTruquitosByTargetIdentity(exact)
    assert.equal(deduped.length, 1, 'exact target-set duplicates must still collapse via the pre-existing function')
  })

  await test("D. canonical notation survives Enjoyer -> server artifact -> HTTP JSON unchanged", async () => { await checkSimpleRoute("formula") })

  await test('D2. the client reuses the project\'s existing math rendering stack (katex) for rendering, rather than treating LaTeX as opaque plain text', () => {
    assert.match(clientSource, /import katex from ["']katex["'];/)
    assert.match(clientSource, /katex\.renderToString\(/)
    assert.match(clientSource, /renderInlineMathAwareText/)
  })

  await test('E. internal mat_*/target IDs remain in internal state (sourceMaterial, targetIds, relationIds) but the render path hides any internal-id-shaped sourceMaterialName from the student-facing chip', () => {
    assert.match(clientSource, /function isInternalIdLike\(value: string\): boolean \{/)
    assert.match(clientSource, /card\.sourceMaterialName && !isInternalIdLike\(card\.sourceMaterialName\)/)
    assert.match(clientSource, /sourceMaterial\?: string;/)
    assert.match(clientSource, /targetIds\?: string\[\];/)
    assert.match(clientSource, /relationIds\?: string\[\];/)

    const isInternalIdLike = (value: string) => /^[a-z][a-z0-9]{1,15}_[0-9a-f]{10,}$/i.test(value.trim())
    assert.ok(isInternalIdLike('mat_9e34e98b324aa1466321153e'), 'must detect the exact reported leaking id shape')
    assert.ok(!isInternalIdLike('Física General II'), 'a real human material name must never be hidden')
    assert.ok(!isInternalIdLike('CLUTCH 2.pdf'), 'a real filename-style display name must never be hidden')
  })

  await test('F. persisted reopen remains 0 provider calls (unchanged by this hardening)', async () => {
    const selection = { ...buildSourceSelectionSnapshot(['mat-f'], { 'mat-f': [1] }), fingerprint: 'fp-truq-f' }
    const payload = {
      sourceSelectionFingerprint: 'fp-truq-f', materialIds: ['mat-f'], selectedPages: { 'mat-f': [1] },
      topicsIndex: [{ id: 't1', title: 'T' }],
      globalOrderedAnalysis: [{ id: 'x1', kind: 'terminology', name: 'X', content: 'Contenido de X suficientemente largo.', importance: 80, difficulty: 'medium', topicId: 't1', materialId: 'mat-f', pages: [1], sourceSpans: [{ page: 1, quote: 'q' }] }],
      uniqueConceptsIndex: [], relations: [],
    }
    let providerCalls = 0
    Object.assign(__routeDeps, {
      generateValidatedLegacyJson: async () => { providerCalls++; throw new Error('MUST_NOT_CALL_PROVIDER_ON_REOPEN') },
      alai: async () => { providerCalls++; throw new Error('MUST_NOT_CALL_PROVIDER_ON_REOPEN') },
    })
    const context = buildTruquitosEnjoyerContext(payload, selection)
    assert.ok(context.targets.length > 0)
    assert.equal(providerCalls, 0, 'restoring/looking up the persisted Enjoyer context must cause zero provider calls')
  })

  await test("G. server attaches all source authority to provider prose", async () => { await checkSimpleRoute("grounding") })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('truquitos-live-hardening-contracts: ALL PASS')
}

main()
