import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import { buildIdentity, identityId } from '../../lib/materialBrain/identity'
import { buildDeterministicFallbackExtraction } from '../../lib/materialBrain/deterministicFallback'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import { buildRepasarReviewTargets } from '../../lib/materialBrain/reviewContext'
import {
  freezeRepasarSnapshot, resolveRepasarSnapshot,
  type RepasarFrozenSnapshot, type RepasarSnapshotStore,
} from '../../lib/materialBrain/repasarSnapshot'
import { getOrBuildFlashcardDeck } from '../../lib/materialBrain/flashcards/deckStore'
import type { FlashcardDeck, FlashcardDeckStore } from '../../lib/materialBrain/flashcards/types'
import { POST, __routeDeps } from '../../app/api/alai-studyal-repasar/route'

// ============================================================
// Repasar / Flashcards TARGET-FREEZE contracts.
//
// Free Mode enters at sourceReady, so an attempt/deck can legitimately
// start against enrichment revision R1 (deterministic exact-source base
// units) while background enrichment is still upgrading leaves to R2.
// Unit ids are derived from (kind, semanticKey, qualifiers), and a base
// unit's canonicalSubject is `fallback:<chunkId>:<index>` — so a base→rich
// upgrade produces COMPLETELY DIFFERENT ids. Anything the user already
// started must therefore keep an immutable academic universe.
// ============================================================

const FP = 'fp-freeze'
const OTHER_FP = 'fp-other'

function scope(fingerprint: string) {
  return { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2] }), fingerprint }
}

function unitFrom(kind: KnowledgeUnit['kind'], canonicalSubject: string, statement: string, page = 1): KnowledgeUnit {
  const identity = buildIdentity(kind, canonicalSubject, [])
  return {
    id: identityId(kind, identity), kind, identity,
    label: statement.slice(0, 60), statement,
    importance: { tier: 'critical', signals: ['model_judged'], confidence: 0.9 },
    provenance: [{ materialId: 'mat-a', page, quote: statement, chunkId: `c-${page}` }],
    evidence: [{ materialId: 'mat-a', page, derivation: 'native_text', quote: statement, chunkId: `c-${page}` }],
    domainTags: [],
    ...(kind === 'formula' ? { expression: 'Kw = [H3O+][OH-]', variables: [{ symbol: 'Kw', meaning: 'producto iónico' }] } : {}),
  } as any
}

function brainOf(fingerprint: string, units: KnowledgeUnit[], enrichmentRevision: number, brainEnrichment: MaterialBrain['meta']['brainEnrichment']): MaterialBrain {
  return {
    scope: scope(fingerprint) as any,
    meta: {
      version: '1.0.0', builderVersion: MATERIAL_BRAIN_BUILDER_VERSION, generatedAt: new Date(0).toISOString(),
      chunking: { strategy: 'test', chunkSizeChars: 1000, chunkCount: 1 },
      llmCallsUsed: 0, retries: 0, status: 'ready',
      sourceReadiness: 'ready', brainEnrichment, enrichmentRevision,
      extractionQuality: { richPercent: brainEnrichment === 'ready' ? 100 : 0, fallbackPercent: brainEnrichment === 'ready' ? 0 : 100, noContentPercent: 0 },
    },
    units, relations: [],
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'not_required' },
    knowledgeExtraction: { chunksAttempted: 1, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}

// ── R1: deterministic base leaf (exact-source fallback), STABLE ──
// P0 product decision: generation may only start once the Brain is
// academically stable (stable_rich OR stable_degraded) — an actively
// 'enriching' Brain is now correctly BLOCKED at the route (see the
// dedicated stability-gate suites). R1 here represents a Brain that
// permanently settled on its exact-source fallback (enrichment budget
// exhausted — academicStability:'stable_degraded'), which is exactly
// as legitimate a generation target as R2's full richness — this file
// is about target-freeze integrity across a base→rich id change, not
// about whether generation is allowed while transiently enriching
// (that is covered separately).
const FALLBACK_SENTENCE = 'La autoionizacion del agua produce iones hidronio e hidroxido en equilibrio.'
const fallbackExtraction = buildDeterministicFallbackExtraction({
  id: 'chunk-1', materialId: 'mat-a', pages: [1], order: 0,
  text: `[Página 1] ${FALLBACK_SENTENCE}`,
})
const baseUnits = fallbackExtraction.units.map(raw => unitFrom('fact', raw.canonicalSubject, raw.statement))
const R1 = brainOf(FP, baseUnits, 1, 'degraded')

// ── R2: rich replacement of the SAME leaf (same fingerprint) ─────
const richUnits = [
  unitFrom('concept', 'autoionización del agua', 'El agua se autoioniza estableciendo un equilibrio.'),
  unitFrom('formula', 'producto iónico del agua', 'Kw = [H3O+][OH-] = 1.0e-14 a 25 °C.'),
]
const R2 = brainOf(FP, richUnits, 2, 'ready')

// ============================================================
// BASE→RICH ID AUDIT — the concrete premise every freeze rests on.
// ============================================================
function testBaseToRichIdAudit() {
  const r1Ids = buildRepasarReviewTargets(R1).map(t => t.id)
  const r2Ids = buildRepasarReviewTargets(R2).map(t => t.id)
  assert.ok(r1Ids.length > 0 && r2Ids.length > 0)
  for (const id of r1Ids) {
    assert.ok(!r2Ids.includes(id), 'AUDIT-1 base unit ids are NOT preserved across base→rich enrichment')
  }
  assert.equal(r2Ids.length, 2, 'AUDIT-2 one base leaf can become MULTIPLE rich units')
  assert.deepEqual(buildRepasarReviewTargets(R1).map(t => t.unitId), r1Ids, 'AUDIT-3 reviewTarget ids ARE unit ids')
  assert.equal(R1.meta.enrichmentRevision, 1)
  assert.equal(R2.meta.enrichmentRevision, 2)
  console.log('  AUDIT-1/2/3 PASS — target ids change across enrichment revisions; freeze is required')
}

// ── In-memory stores ────────────────────────────────────────────
function memorySnapshotStore() {
  const map = new Map<string, RepasarFrozenSnapshot>()
  const store: RepasarSnapshotStore = {
    async get(id) { return map.get(id) ? JSON.parse(JSON.stringify(map.get(id))) : null },
    async set(snapshot) { map.set(snapshot.snapshotId, JSON.parse(JSON.stringify(snapshot))) },
  }
  return { store, map }
}

function memoryDeckStore() {
  const map = new Map<string, FlashcardDeck>()
  const store: FlashcardDeckStore = {
    async get(fp) { return map.get(fp) ? JSON.parse(JSON.stringify(map.get(fp))) : null },
    async set(fp, deck) { map.set(fp, JSON.parse(JSON.stringify(deck))) },
  }
  return { store, map }
}

// ============================================================
// Repasar route harness — the SAME brain reference is mutated to
// simulate background enrichment writing R2 mid-attempt.
// ============================================================
let currentBrain: MaterialBrain = R1
const snapshots = memorySnapshotStore()
let providerCalls = 0
let lastPromptContext = ''
let evaluateResponse: any = {}
let teachCheckResponse: any = {}

function installRouteDeps() {
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
    getAuthoritativeFreeSession: async (sessionId: string, userId: string) => {
      if (sessionId !== 'sess-1' || userId !== 'user-1') return null
      return { id: sessionId, userId, processMode: 'free', sourceSelection: scope(FP) } as any
    },
    getMaterial: async () => ({ id: 'mat-a' }) as any,
    restoreMaterialBrain: async (fingerprint: string) => (fingerprint === FP ? currentBrain : null),
    createRepasarSnapshotStore: () => snapshots.store,
    generateValidatedLegacyJson: async ({ messages, telemetryContext }: any) => {
      providerCalls++
      lastPromptContext = messages.map((m: any) => m.content).join('\n')
      return telemetryContext?.route === 'review' ? evaluateResponse : teachCheckResponse
    },
  })
}

async function post(body: any) {
  const req = new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const res = await POST(req)
  return { status: res.status, data: await res.json() }
}

async function testRepasarFreeze() {
  installRouteDeps()
  currentBrain = R1
  const r1Targets = buildRepasarReviewTargets(R1)
  const r1Ids = r1Targets.map(t => t.id)
  const r2Ids = buildRepasarReviewTargets(R2).map(t => t.id)

  evaluateResponse = {
    score: 60, summary: 'ok', feedback: 'ok', conceptStatus: [], strengths: [], missingConcepts: [], confusions: [],
    repair: { question: '¿Qué faltó?', topicLabel: 'Tema', targetConcepts: ['x'], requiredFacts: ['f1'], optionalFacts: [], targetIds: [r1Ids[0]] },
    targetCoverage: r1Ids.map((id, i) => ({ targetId: id, status: i === 0 ? 'missing' : 'covered' })),
  }

  // REP-FREEZE-1/2: attempt starts at R1.
  const evaluated = await post({ sessionId: 'sess-1', explanation: 'Expliqué el material.', mode: 'libre' })
  assert.equal(evaluated.status, 200)
  const snapshotId = evaluated.data.snapshotId
  assert.ok(snapshotId, 'REP-FREEZE-1 evaluate returns a frozen attempt identity')
  assert.equal(evaluated.data.enrichmentRevision, 1, 'REP-FREEZE-1 attempt froze revision R1')
  assert.equal(evaluated.data.review.totalReviewTargets, r1Ids.length, 'REP-FREEZE-2 evaluate denominator is the R1 universe')
  const frozen = await snapshots.store.get(snapshotId)
  assert.deepEqual(frozen!.targets.map(t => t.id), r1Ids, 'REP-FREEZE-1 frozen universe == R1 targets')
  assert.equal((frozen as any).units, undefined, 'freeze persists the MINIMAL snapshot, never the whole MaterialBrain')
  assert.equal((frozen as any).meta, undefined, 'freeze persists no Brain meta/checkpoints')

  // REP-FREEZE-3: repair is anchored in R1 ids.
  const repairTargetIds = evaluated.data.analysis.repair.repairTargetIds
  assert.deepEqual(repairTargetIds, [r1Ids[0]], 'REP-FREEZE-3 repair targets come from the frozen R1 universe')

  // ── Background enrichment lands R2 for the SAME fingerprint ────
  currentBrain = R2

  // REP-FREEZE-4: teach-check still uses the frozen R1 ids/evidence.
  teachCheckResponse = { passed: true, message: 'ok', understood: ['f1'], factJudgements: [{ covered: true }], improvedAnswer: '' }
  const checked = await post({
    kind: 'teach-check', sessionId: 'sess-1', mode: 'libre', snapshotId,
    repair: { ...evaluated.data.analysis.repair, repairTargetIds },
    answer: 'Mi respuesta de reparación.',
  })
  assert.equal(checked.status, 200)
  assert.equal(checked.data.snapshotId, snapshotId, 'REP-FREEZE-4 teach-check stays on the same frozen attempt')
  assert.equal(checked.data.enrichmentRevision, 1, 'REP-FREEZE-4 teach-check still reports R1, not the newer R2')
  assert.deepEqual(checked.data.check.targetIds, [r1Ids[0]], 'REP-FREEZE-4 R1 repair ids remain valid after R2 landed')
  for (const id of r1Ids) {
    assert.ok(lastPromptContext.includes(id), 'REP-FREEZE-4 grounded prompt is rendered from the FROZEN R1 targets')
  }
  for (const id of r2Ids) {
    assert.ok(!lastPromptContext.includes(id), 'REP-FREEZE-4 no R2 target leaks into an existing attempt')
  }
  assert.ok(lastPromptContext.includes(FALLBACK_SENTENCE.slice(0, 40)), 'REP-FREEZE-3/4 evidence text is the frozen R1 evidence')

  // REP-FREEZE-1 (persistence): the stored snapshot never mutated.
  const stillFrozen = await snapshots.store.get(snapshotId)
  assert.deepEqual(stillFrozen!.targets.map(t => t.id), r1Ids, 'REP-FREEZE-1 existing attempt universe unchanged after R2')
  assert.equal(stillFrozen!.enrichmentRevision, 1)

  // REP-FREEZE-5: a NEW attempt may use R2.
  evaluateResponse = {
    ...evaluateResponse,
    repair: { ...evaluateResponse.repair, targetIds: [r2Ids[0]] },
    targetCoverage: r2Ids.map((id, i) => ({ targetId: id, status: i === 0 ? 'missing' : 'covered' })),
  }
  const second = await post({ sessionId: 'sess-1', explanation: 'Segundo intento.', mode: 'libre' })
  assert.equal(second.status, 200)
  assert.notEqual(second.data.snapshotId, snapshotId, 'REP-FREEZE-5 a new attempt gets a new frozen identity')
  assert.equal(second.data.enrichmentRevision, 2, 'REP-FREEZE-5 a new attempt may freeze the newer revision')
  assert.equal(second.data.review.totalReviewTargets, r2Ids.length, 'REP-FREEZE-5 new attempt uses the R2 denominator')

  console.log('  REP-FREEZE-1/2/3/4/5 PASS')
  return { snapshotId, r1Ids, r2Ids }
}

// ============================================================
// ADVERSARIAL — no cross-revision / cross-fingerprint authority leak.
// ============================================================
async function testAdversarial(ctx: { snapshotId: string; r1Ids: string[]; r2Ids: string[] }) {
  currentBrain = R2
  teachCheckResponse = { passed: true, message: 'ok', understood: [], factJudgements: [], improvedAnswer: '' }

  // ADV-1: an R2 target id injected into the R1 attempt is dropped.
  const adv1 = await post({
    kind: 'teach-check', sessionId: 'sess-1', mode: 'libre', snapshotId: ctx.snapshotId,
    repair: { question: 'q', topicLabel: '', targetConcepts: ['c'], requiredFacts: [], optionalFacts: [], repairTargetIds: [ctx.r2Ids[0]] },
    answer: 'respuesta',
  })
  assert.equal(adv1.status, 200)
  assert.deepEqual(adv1.data.check.targetIds, [], 'ADV-1 an id from a newer revision is never accepted into a frozen attempt')

  // ADV-2: a forged enrichmentRevision in the body is never read.
  const adv2 = await post({
    kind: 'teach-check', sessionId: 'sess-1', mode: 'libre', snapshotId: ctx.snapshotId,
    enrichmentRevision: 99,
    repair: { question: 'q', topicLabel: '', targetConcepts: ['c'], requiredFacts: [], optionalFacts: [], repairTargetIds: [ctx.r1Ids[0]] },
    answer: 'respuesta',
  })
  assert.equal(adv2.data.enrichmentRevision, 1, 'ADV-2 a forged enrichmentRevision is ignored — the store is authoritative')
  assert.deepEqual(adv2.data.check.targetIds, [ctx.r1Ids[0]])

  // ADV-3: a snapshot belonging to a DIFFERENT fingerprint is rejected.
  const foreign = freezeRepasarSnapshot(brainOf(OTHER_FP, richUnits, 7, 'ready'))
  await snapshots.store.set(foreign)
  const adv3 = await post({
    kind: 'teach-check', sessionId: 'sess-1', mode: 'libre', snapshotId: foreign.snapshotId,
    repair: { question: 'q', topicLabel: '', targetConcepts: ['c'], requiredFacts: [], optionalFacts: [], repairTargetIds: [] },
    answer: 'respuesta',
  })
  assert.equal(adv3.status, 409, 'ADV-3 cross-fingerprint snapshot is rejected, never silently reused')
  assert.equal(adv3.data.error, 'SNAPSHOT_SCOPE_MISMATCH')

  // ADV-4: client-supplied target content / evidence is refused outright.
  for (const key of ['targets', 'reviewTargets', 'groundedContext', 'evidence', 'materialText']) {
    const adv4 = await post({ sessionId: 'sess-1', explanation: 'x', mode: 'libre', [key]: 'texto falsificado' })
    assert.equal(adv4.status, 400, `ADV-4 client-sent academic authority key "${key}" is refused`)
    assert.equal(adv4.data.detail, 'RAW_SOURCE_AUTHORITY_FORBIDDEN')
  }

  // ADV-5: an unknown/fabricated snapshot id fails closed.
  const adv5 = await post({
    kind: 'teach-check', sessionId: 'sess-1', mode: 'libre', snapshotId: 'rsnap_fabricated',
    repair: { question: 'q', topicLabel: '', targetConcepts: ['c'], requiredFacts: [], optionalFacts: [], repairTargetIds: [] },
    answer: 'respuesta',
  })
  assert.equal(adv5.status, 409, 'ADV-5 unknown snapshot id fails closed')
  assert.equal(adv5.data.error, 'SNAPSHOT_NOT_FOUND')

  console.log('  ADV-1/2/3/4/5 PASS')
}

// ============================================================
// LEGACY RESUME — a session persisted before the freeze contract.
// ============================================================
async function testLegacyResume() {
  currentBrain = R2
  teachCheckResponse = { passed: false, message: 'ok', understood: [], factJudgements: [], improvedAnswer: '' }
  const legacy = await post({
    kind: 'teach-check', sessionId: 'sess-1', mode: 'libre', // no snapshotId at all
    repair: { question: 'q', topicLabel: '', targetConcepts: ['c'], requiredFacts: [], optionalFacts: [], repairTargetIds: [] },
    answer: 'respuesta',
  })
  assert.equal(legacy.status, 200, 'LEGACY-1 a pre-freeze session still works — it is never broken')
  assert.ok(legacy.data.snapshotId, 'LEGACY-2 a CURRENT freeze is established for the new academic operation')
  assert.equal(legacy.data.enrichmentRevision, 2, 'LEGACY-3 historical revision identity is never fabricated — the current one is used')

  // A brain with no revision identity at all records null, never a made-up number.
  const legacyBrain = brainOf(FP, richUnits, undefined as any, undefined)
  delete (legacyBrain.meta as any).enrichmentRevision
  assert.equal(freezeRepasarSnapshot(legacyBrain).enrichmentRevision, null, 'LEGACY-4 absent revision is recorded as null, never fabricated')

  console.log('  LEGACY-1/2/3/4 PASS')
}

// ============================================================
// FLASHCARDS — the generated deck is frozen.
// ============================================================
async function testFlashcardsFreeze() {
  const { store } = memoryDeckStore()
  let generatorCalls = 0
  const generateFn = async (planned: any, context: any) => {
    generatorCalls++
    const unit = context.units[0]
    return {
      ...planned,
      // Deliberately NOT an echo of unit.label/retrievalObjective (this
      // fixture's labels are raw 60-char statement slices, which would
      // otherwise trip the template-leakage gate) and the answer adds
      // distinguishing content so it isn't a verbatim restatement.
      question: `Según el material autorizado, ¿qué establece el contenido identificado por ${planned.id}?`,
      answer: `Lo siguiente: ${unit?.statement || ''}`.trim(),
      provenance: unit?.provenance || [],
      generatorVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      validated: true,
      validationErrors: [],
    }
  }

  // Deck generated at R1.
  const first = await getOrBuildFlashcardDeck(R1, store, { generateFn: generateFn as any })
  assert.ok(first.deck && first.deck.cards.length > 0, 'deck generated at R1')
  const r1Cards = JSON.parse(JSON.stringify(first.deck!.cards))
  assert.ok(r1Cards.length > 0)
  assert.equal(first.deck!.meta.enrichmentRevision, 1, 'FLASH-FREEZE-4 deck records the revision it froze')
  const callsAfterFirst = generatorCalls

  // ── Brain upgrades to R2 (same fingerprint) ──
  // FLASH-FREEZE-1/2: resuming returns the R1 deck, untouched.
  const resumed = await getOrBuildFlashcardDeck(R2, store, { generateFn: generateFn as any })
  assert.equal(generatorCalls, callsAfterFirst, 'FLASH-FREEZE-1 no regeneration is triggered by a newer revision')
  assert.deepEqual(resumed.deck!.cards, r1Cards, 'FLASH-FREEZE-2 resume returns the EXISTING R1 deck, not richer cards')
  assert.equal(resumed.deck!.meta.enrichmentRevision, 1, 'FLASH-FREEZE-1 an existing deck is never silently replaced by R2')

  // FLASH-FREEZE-4: the R1 target/answer authority is still complete and valid.
  for (const card of resumed.deck!.cards) {
    assert.ok(card.question && card.answer, 'FLASH-FREEZE-4 R1 cards remain self-contained (question + answer)')
    assert.ok(card.provenance.length > 0, 'FLASH-FREEZE-4 R1 provenance authority remains valid')
    assert.ok(card.sourceUnitIds.every((id: string) => R1.units.some(u => u.id === id)), 'FLASH-FREEZE-4 R1 card targets stay R1 unit ids')
  }

  // FLASH-FREEZE-3: an explicit "new deck" may use R2.
  const regenerated = await getOrBuildFlashcardDeck(R2, store, { generateFn: generateFn as any, regenerate: true })
  assert.ok(generatorCalls > callsAfterFirst, 'FLASH-FREEZE-3 explicit regenerate really generates again')
  assert.equal(regenerated.deck!.meta.enrichmentRevision, 2, 'FLASH-FREEZE-3 a NEW deck freezes the newer revision')
  assert.ok(
    regenerated.deck!.cards.every(card => card.sourceUnitIds.every(id => R2.units.some(u => u.id === id))),
    'FLASH-FREEZE-3 the new deck targets R2 units',
  )

  console.log('  FLASH-FREEZE-1/2/3/4 PASS')
}

// ============================================================
// ENRICHMENT REVISION must NOT over-invalidate.
// ============================================================
async function testNoOverInvalidation() {
  const { store, map } = memoryDeckStore()
  const generateFn = async (planned: any, context: any) => ({
    ...planned, question: 'q', answer: context.units[0]?.statement || 'a',
    provenance: context.units[0]?.provenance || [], generatorVersion: '1.0.0',
    generatedAt: new Date().toISOString(), validated: true, validationErrors: [],
  })
  await getOrBuildFlashcardDeck(R1, store, { generateFn: generateFn as any })
  const stored = map.get(FP)!
  // Several successive enrichment batches (R2, R3, R4 …) must not destroy it.
  for (const revision of [2, 3, 4]) {
    const next = brainOf(FP, richUnits, revision, 'enriching')
    const result = await getOrBuildFlashcardDeck(next, store, { generateFn: generateFn as any })
    assert.deepEqual(result.deck!.cards, stored.cards, `NO-OVERINVALIDATE-1 enrichment batch R${revision} does not destroy the active deck`)
  }

  // Repasar: successive revisions never touch a frozen attempt either.
  const snap = freezeRepasarSnapshot(R1)
  const mem = memorySnapshotStore()
  await mem.store.set(snap)
  for (const revision of [2, 3, 4]) {
    const resolution = await resolveRepasarSnapshot({
      brain: brainOf(FP, richUnits, revision, 'enriching'),
      store: mem.store, intent: 'continue_attempt', requestedSnapshotId: snap.snapshotId,
    })
    assert.equal(resolution.ok, true)
    assert.equal(resolution.snapshot!.enrichmentRevision, 1, `NO-OVERINVALIDATE-2 frozen attempt survives enrichment batch R${revision}`)
  }

  // A DIFFERENT fingerprint is a different source selection — never shared.
  const crossed = await resolveRepasarSnapshot({
    brain: brainOf(OTHER_FP, richUnits, 1, 'ready'),
    store: mem.store, intent: 'continue_attempt', requestedSnapshotId: snap.snapshotId,
  })
  assert.equal(crossed.ok, false)
  assert.equal(crossed.code, 'SNAPSHOT_SCOPE_MISMATCH', 'NO-OVERINVALIDATE-3 fingerprint identity is still enforced')

  console.log('  NO-OVERINVALIDATE-1/2/3 PASS')
}

async function main() {
  testBaseToRichIdAudit()
  // Active Free Repasar no longer freezes Material Brain revisions. Its
  // Enjoyer authority/snapshot replacement contracts live in
  // repasar-enjoyer-migration-contracts.ts. Keep this historical combined
  // suite focused on the still-valid Flashcards freeze behavior.
  await testFlashcardsFreeze()
  assert.equal(providerCalls, 0, 'retained Flashcards contracts make no Repasar provider calls')
  console.log('repasar-flashcards-target-freeze-contracts: FLASHCARDS LEGACY FREEZE CONTRACTS PASS')
}

main().catch(err => { console.error(err); process.exit(1) })
