import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import {
  buildRepasarGapGroups, buildRepasarReviewTargets, computeRepasarDomainMap, type RepasarReviewTarget,
} from '../../lib/materialBrain/reviewContext'
import { POST, __routeDeps } from '../../app/api/alai-studyal-repasar/route'

// ============================================================
// Repasar — final closure: "Para dominar el 100%".
//
// Real remaining bug: Repasar already KNEW there were 12 pending
// targets (76 total, 64 correct, 1 incorrect, 11 omitted) but the
// feedback only ever explained ONE of them, and "Ya dominás esto" /
// "🚀 Para llevarlo más lejos" copy appeared even with 12 real academic
// gaps outstanding — because the student-facing gate
// (hasUnresolvedConcept) read the provider-invented `conceptStatus`
// taxonomy instead of the canonical, deterministic domainMap.
//
// Fix is entirely presentation/aggregation — NO re-evaluation, NO new
// LLM call, NO change to targets/scoring/readers/Material Brain/freeze.
// ============================================================

function unit(id: string, tier: 'critical' | 'supporting' | 'contextual' = 'supporting'): KnowledgeUnit {
  return {
    id, kind: 'fact',
    identity: { canonicalSubject: id, semanticKey: id, qualifiers: [] },
    label: `Concepto ${id}`, statement: `Contenido autorizado de ${id}`,
    importance: { tier, signals: ['model_judged'], confidence: 0.9 },
    provenance: [{ materialId: 'mat-a', page: 1, quote: `Cita de ${id}`, chunkId: 'c-1' }],
    evidence: [{ materialId: 'mat-a', page: 1, derivation: 'native_text', quote: `Cita de ${id}`, chunkId: 'c-1' }],
    domainTags: [],
  } as any
}

function brain(fingerprint: string, units: KnowledgeUnit[]): MaterialBrain {
  const scope = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint }
  return {
    scope,
    meta: {
      version: '1.0.0', builderVersion: MATERIAL_BRAIN_BUILDER_VERSION, generatedAt: new Date(0).toISOString(),
      chunking: { strategy: 'test', chunkSizeChars: 1000, chunkCount: 1 },
      llmCallsUsed: 0, retries: 0, status: 'ready',
    },
    units, relations: [],
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'not_required' },
    knowledgeExtraction: { chunksAttempted: 1, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}

function enjoyerFromBrain(value: MaterialBrain) {
  return { sourceSelectionFingerprint: value.scope.fingerprint, uniqueConceptsIndex: [], topicsIndex: [],
    globalOrderedAnalysis: value.units.map((u: any, index: number) => ({ id: u.id, kind: u.kind, name: u.label, summary: u.statement,
      importance: u.importance?.tier === 'critical' ? 90 : u.importance?.tier === 'contextual' ? 10 : 50,
      materialId: u.provenance?.[0]?.materialId || 'mat-a', pages: [u.provenance?.[0]?.page || 1],
      sourceSpans: [{ page: u.provenance?.[0]?.page || 1, quote: u.provenance?.[0]?.quote || u.statement }], globalOrder: index })) }
}

function verdictsFor(targets: RepasarReviewTarget[], correctIds: string[], incorrectIds: string[] = [], partialIds: string[] = []) {
  return targets.map(t => ({
    targetId: t.id,
    status: correctIds.includes(t.id) ? 'covered' as const
      : incorrectIds.includes(t.id) ? 'incorrect' as const
        : partialIds.includes(t.id) ? 'partial' as const
          : 'missing' as const,
  })).filter(v => correctIds.includes(v.targetId) || incorrectIds.includes(v.targetId) || partialIds.includes(v.targetId))
}

function gapPayload(targets: RepasarReviewTarget[], domainMap: ReturnType<typeof computeRepasarDomainMap>) {
  const { groups, remainderCount, remainderTargetIds } = buildRepasarGapGroups(targets, domainMap, [])
  const byId = new Map(targets.map(t => [t.id, t]))
  const toItem = (id: string) => { const t = byId.get(id)!; return { id, label: t.label, importanceTier: t.importanceTier, status: domainMap.statusByTargetId[id] } }
  return {
    pendingAcademicTargets: domainMap.demonstratedPartial + domainMap.demonstratedIncorrect + domainMap.omitted,
    gapGroups: groups.map(g => ({ ...g, items: g.targetIds.map(toItem) })),
    gapRemainderCount: remainderCount,
    gapRemainder: remainderTargetIds.map(toItem),
  }
}

let passed = 0, failed = 0
function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try { await fn(); console.log('  ✅ ' + name); passed++ }
    catch (err: any) { console.log('  ❌ ' + name); console.log('     ' + (err?.message || err)); failed++ }
  })()
}

async function main() {
  console.log('\n── Repasar gap actionability contracts ──\n')

  // A. 1 total / 0 gaps -> no debt section possible, enrichment allowed.
  await test('A: 1 total / 0 gaps -> pendingAcademicTargets is 0, nothing to display as debt', () => {
    const targets = buildRepasarReviewTargets(brain('fp-a', [unit('u0')]))
    const domainMap = computeRepasarDomainMap(targets, verdictsFor(targets, ['u0']))
    const payload = gapPayload(targets, domainMap)
    assert.equal(payload.pendingAcademicTargets, 0)
    assert.equal(payload.gapGroups.length, 0)
    assert.equal(payload.gapRemainderCount, 0)
  })

  // B. 1 total / 1 omitted -> "1 por reforzar", exactly that target visible.
  await test('B: 1 total / 1 omitted -> exactly 1 pending, that exact target is the one visible', () => {
    const targets = buildRepasarReviewTargets(brain('fp-b', [unit('u0')]))
    const domainMap = computeRepasarDomainMap(targets, [])
    const payload = gapPayload(targets, domainMap)
    assert.equal(payload.pendingAcademicTargets, 1)
    const allVisible = [...payload.gapGroups.flatMap(g => g.items), ...payload.gapRemainder]
    assert.equal(allVisible.length, 1)
    assert.equal(allVisible[0].id, 'u0')
    assert.equal(allVisible[0].status, 'omitted')
  })

  // C. mixed correct+partial+incorrect+omitted -> exact counts, exact
  // pending, each gap exactly once.
  await test('C: mixed statuses -> exact counts, pending exact, every gap appears exactly once', () => {
    const targets = buildRepasarReviewTargets(brain('fp-c', Array.from({ length: 10 }, (_, i) => unit(`u${i}`))))
    const domainMap = computeRepasarDomainMap(targets, verdictsFor(targets, ['u0', 'u1', 'u2', 'u3'], ['u4'], ['u5']))
    assert.equal(domainMap.demonstratedCorrect, 4)
    assert.equal(domainMap.demonstratedIncorrect, 1)
    assert.equal(domainMap.demonstratedPartial, 1)
    assert.equal(domainMap.omitted, 4)
    const payload = gapPayload(targets, domainMap)
    assert.equal(payload.pendingAcademicTargets, 6, 'C: pending = partial(1)+incorrect(1)+omitted(4) = 6')
    const allVisible = [...payload.gapGroups.flatMap(g => g.items), ...payload.gapRemainder]
    assert.equal(allVisible.length, 6)
    const seen = new Set(allVisible.map(i => i.id))
    assert.equal(seen.size, 6, 'every gap target id must appear exactly once, no duplicates')
    for (const id of ['u4', 'u5', 'u6', 'u7', 'u8', 'u9']) assert.ok(seen.has(id), `${id} must be a visible gap`)
    for (const id of ['u0', 'u1', 'u2', 'u3']) assert.ok(!seen.has(id), `correct target ${id} must never appear as a gap`)
  })

  // D. real 76-target case: 64 correct, 1 incorrect, 11 omitted -> 12 pending.
  await test('D: real 76-target shape -> 12 pending visible/accessible, no correct target misfiled as pending', () => {
    const targets = buildRepasarReviewTargets(brain('fp-d', Array.from({ length: 76 }, (_, i) => unit(`u${i}`))))
    const correctIds = targets.slice(0, 64).map(t => t.id)
    const incorrectIds = [targets[64].id]
    const domainMap = computeRepasarDomainMap(targets, verdictsFor(targets, correctIds, incorrectIds))
    assert.equal(domainMap.demonstratedCorrect, 64)
    assert.equal(domainMap.demonstratedIncorrect, 1)
    assert.equal(domainMap.omitted, 11)
    const payload = gapPayload(targets, domainMap)
    assert.equal(payload.pendingAcademicTargets, 12)
    const allVisible = [...payload.gapGroups.flatMap(g => g.items), ...payload.gapRemainder]
    assert.equal(allVisible.length, 12, '"12 pendientes" must correspond to exactly 12 inspectable items')
    assert.ok(allVisible.every(i => !correctIds.includes(i.id)), 'no correct target ever appears in the pending set')
  })

  // E. 250+ targets -> grouping/collapse usable, not an initial monster
  // list, but everything remains accessible (groups + remainder).
  await test('E: 250+ targets -> bounded initial group list, all gaps still accessible', () => {
    const targets = buildRepasarReviewTargets(brain('fp-e', Array.from({ length: 260 }, (_, i) => unit(`u${i}`))))
    const correctIds = targets.slice(0, 20).map(t => t.id) // 240 gaps
    const domainMap = computeRepasarDomainMap(targets, verdictsFor(targets, correctIds))
    const payload = gapPayload(targets, domainMap)
    assert.equal(payload.pendingAcademicTargets, 240)
    assert.ok(payload.gapGroups.length <= 8, `initial group list must stay bounded, got ${payload.gapGroups.length}`)
    const totalAccessible = payload.gapGroups.reduce((s, g) => s + g.items.length, 0) + payload.gapRemainder.length
    assert.equal(totalAccessible, 240, 'every one of the 240 gaps must still be resolvable across groups + remainder')
  })

  // F. reader invariance — same domainMap regardless of which reader is selected.
  await test('F: reader invariance -> nino/universitario/profesor/libre see identical gaps/count/priority', async () => {
    const targets = Array.from({ length: 10 }, (_, i) => `u${i}`)
    const b = brain('fp-f', targets.map(id => unit(id)))
    const correctIds = targets.slice(0, 6)
    const incorrectIds = [targets[6]]
    const missingIds = targets.slice(7)
    const frozenSnapshots = new Map<string, any>()
    const store = { async get(id: string) { return frozenSnapshots.get(id) || null }, async set(s: any) { frozenSnapshots.set(s.snapshotId, s) } }
    const deps = {
      getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
      getAuthoritativeFreeSession: async () => ({ id: 'sess-1', userId: 'user-1', processMode: 'free', sourceSelection: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: b.scope.fingerprint } } as any),
      getMaterial: async () => ({ id: 'mat-a' }) as any,
      createRepasarSnapshotStore: () => store,
      lookupEnjoyer: async (fp: string) => (fp === b.scope.fingerprint ? enjoyerFromBrain(b) : null),
      generateValidatedLegacyJson: async ({ validate, telemetryContext }: any) => {
        const phase = String(telemetryContext?.phase || '')
        const value = phase === 'analysis_batch'
          ? { targetCoverage: [
            ...correctIds.map(id => ({ targetId: id, status: 'covered', evidence: `ev ${id}`, demonstrated: `ev ${id}` })),
            ...incorrectIds.map(id => ({ targetId: id, status: 'incorrect', evidence: `ev equivocada ${id}`, demonstrated: `ev equivocada ${id}` })),
            ...missingIds.map(id => ({ targetId: id, status: 'missing', evidence: '' })),
          ] }
          : { score: 80, feedback: 'ok', summary: 'ok', conceptStatus: [], strengths: [], missingConcepts: [], confusions: [], repair: { question: '', topicLabel: '', targetConcepts: [], requiredFacts: [], optionalFacts: [] }, targetCoverage: [] }
        const r = validate(value); assert.ok(r.valid, r.errors?.join(',')); return value
      },
    }
    const results: Record<string, any> = {}
    for (const mode of ['nino', 'universitario', 'profesor', 'libre']) {
      frozenSnapshots.clear()
      Object.assign(__routeDeps, deps)
      const req = new NextRequest('http://localhost/api/alai-studyal-repasar', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'sess-1', explanation: 'Explicación de prueba para verificar invariancia entre lectores.', mode }),
      })
      const res = await POST(req)
      const data = await res.json()
      assert.equal(res.status, 200)
      results[mode] = data.analysis.domainMap
    }
    const idsOf = (dm: any) => new Set([...dm.gapGroups.flatMap((g: any) => g.items.map((i: any) => i.id)), ...dm.gapRemainder.map((i: any) => i.id)])
    const ninoIds = idsOf(results.nino)
    for (const mode of ['universitario', 'profesor', 'libre']) {
      assert.equal(results[mode].pendingAcademicTargets, results.nino.pendingAcademicTargets, `F: ${mode} pending count must match nino`)
      assert.deepEqual(idsOf(results[mode]), ninoIds, `F: ${mode} gap id set must match nino exactly`)
      assert.equal(results[mode].nextPriorityTargetId, results.nino.nextPriorityTargetId, `F: ${mode} next-priority target must match nino`)
    }
  })

  // G. adversarial: provider claims "ya dominaste todo" while gaps exist
  // -> the domainMap/pending state must not adopt that claim.
  await test('G: provider claims full mastery despite real gaps -> pendingAcademicTargets stays truthful', async () => {
    const targets = Array.from({ length: 5 }, (_, i) => `u${i}`)
    const b = brain('fp-g', targets.map(id => unit(id)))
    const frozenSnapshots = new Map<string, any>()
    const store = { async get(id: string) { return frozenSnapshots.get(id) || null }, async set(s: any) { frozenSnapshots.set(s.snapshotId, s) } }
    Object.assign(__routeDeps, {
      getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
      getAuthoritativeFreeSession: async () => ({ id: 'sess-1', userId: 'user-1', processMode: 'free', sourceSelection: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: b.scope.fingerprint } } as any),
      getMaterial: async () => ({ id: 'mat-a' }) as any,
      createRepasarSnapshotStore: () => store,
      lookupEnjoyer: async (fp: string) => (fp === b.scope.fingerprint ? enjoyerFromBrain(b) : null),
      generateValidatedLegacyJson: async ({ validate, telemetryContext }: any) => {
        const phase = String(telemetryContext?.phase || '')
        // Only 2/5 actually demonstrated, per the canonical (persona-neutral) pass.
        const value = phase === 'analysis_batch'
          ? { targetCoverage: [
            { targetId: 'u0', status: 'covered', evidence: 'ev u0', demonstrated: 'ev u0' },
            { targetId: 'u1', status: 'covered', evidence: 'ev u1', demonstrated: 'ev u1' },
            { targetId: 'u2', status: 'missing', evidence: '' },
            { targetId: 'u3', status: 'missing', evidence: '' },
            { targetId: 'u4', status: 'missing', evidence: '' },
          ] }
          : {
            score: 100, feedback: 'Ya dominaste todo el material perfectamente, no queda nada por repasar.',
            summary: 'Dominio completo.', conceptStatus: [], strengths: [], missingConcepts: [], confusions: [],
            repair: { question: '', topicLabel: '', targetConcepts: [], requiredFacts: [], optionalFacts: [] }, targetCoverage: [],
          }
        const r = validate(value); assert.ok(r.valid); return value
      },
    })
    const req = new NextRequest('http://localhost/api/alai-studyal-repasar', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', explanation: 'Explicación parcial del material.', mode: 'libre' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(data.analysis.domainMap.pendingAcademicTargets, 3, 'G: real gaps (3/5) must stand regardless of the provider narrative claiming full mastery')
    assert.equal(data.analysis.domainMap.omitted, 3)
  })

  // H. provider invents a gap that does not exist in the frozen snapshot
  // -> must never enter the pending set (identity already enforced
  // server-side; this proves it end-to-end for the gap payload too).
  await test('H: provider-invented target id never enters the pending/gap set', async () => {
    const targets = Array.from({ length: 3 }, (_, i) => `u${i}`)
    const b = brain('fp-h', targets.map(id => unit(id)))
    const frozenSnapshots = new Map<string, any>()
    const store = { async get(id: string) { return frozenSnapshots.get(id) || null }, async set(s: any) { frozenSnapshots.set(s.snapshotId, s) } }
    Object.assign(__routeDeps, {
      getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
      getAuthoritativeFreeSession: async () => ({ id: 'sess-1', userId: 'user-1', processMode: 'free', sourceSelection: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: b.scope.fingerprint } } as any),
      getMaterial: async () => ({ id: 'mat-a' }) as any,
      createRepasarSnapshotStore: () => store,
      lookupEnjoyer: async (fp: string) => (fp === b.scope.fingerprint ? enjoyerFromBrain(b) : null),
      generateValidatedLegacyJson: async ({ validate, telemetryContext }: any) => {
        const phase = String(telemetryContext?.phase || '')
        const value = phase === 'analysis_batch'
          ? { targetCoverage: [
            { targetId: 'u0', status: 'covered', evidence: 'ev u0', demonstrated: 'ev u0' },
            { targetId: 'u1', status: 'missing', evidence: '' },
            { targetId: 'u2', status: 'missing', evidence: '' },
            { targetId: 'FABRICATED_XYZ', status: 'incorrect', evidence: 'ev fabricada', demonstrated: 'ev fabricada' },
          ] }
          : { score: 70, feedback: 'ok', summary: 'ok', conceptStatus: [], strengths: [], missingConcepts: [], confusions: [], repair: { question: '', topicLabel: '', targetConcepts: [], requiredFacts: [], optionalFacts: [] }, targetCoverage: [] }
        const r = validate(value); assert.ok(r.valid); return value
      },
    })
    const req = new NextRequest('http://localhost/api/alai-studyal-repasar', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', explanation: 'Explicación de prueba.', mode: 'libre' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(data.analysis.domainMap.totalAcademicTargets, 3, 'a fabricated id must never grow the denominator')
    const allIds = [...data.analysis.domainMap.gapGroups.flatMap((g: any) => g.items.map((i: any) => i.id)), ...data.analysis.domainMap.gapRemainder.map((i: any) => i.id)]
    assert.ok(!allIds.includes('FABRICATED_XYZ'), 'H: fabricated target id must never enter the visible gap set')
  })

  // I. historical/freeze — enrichment after an attempt must not change
  // that attempt's gaps (already exhaustively covered by
  // repasar-flashcards-target-freeze-contracts.ts REP-FREEZE-1..5; this
  // is a scoped structural confirmation that the gap payload is built
  // from `reviewTargets`/`domainMap`, both sourced from the FROZEN
  // snapshot, never a live re-fetch).
  await test('I: gap payload is built from the frozen snapshot, never a live re-fetch (structural)', () => {
    const source = readFileSync('app/api/alai-studyal-repasar/route.ts', 'utf8')
    assert.match(source, /buildRepasarGapGroups\(reviewTargets, domainMap, groundedContext\.relations\)/,
      'gap groups must be built from reviewTargets/domainMap/groundedContext, all sourced from the frozen snapshot')
    assert.doesNotMatch(source, /buildRepasarGapGroups\([^)]*restoreMaterialBrain/,
      'gap grouping must never pull from a live Brain re-fetch')
  })

  // J. New Repaso persists verification separately from immutable initial.
  await test('J: verification result is stored separately from the original attempt evidence (structural)', () => {
    const artifactSource = readFileSync('lib/materialBrain/repasoArtifact.ts', 'utf8')
    const uiSource = readFileSync('components/materias/ALAIStudyALRepasar.tsx', 'utf8')
    assert.match(artifactSource, /initial: RepasoInitialAttempt[\s\S]*finalVerification: RepasoFinalVerification \| null/,
      'initial and final verification must be separate durable artifact fields')
    assert.match(uiSource, /initialPaper\.explanation/,
      'Paper 1 must render the immutable initial explanation projection')
    assert.doesNotMatch(artifactSource, /next\.initial\s*=/, 'verification must never overwrite initial')
  })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
  console.log('repasar-gap-actionability-contracts: ALL PASS')
}

main()
