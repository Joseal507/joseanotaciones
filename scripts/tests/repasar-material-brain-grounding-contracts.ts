import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import {
  buildRepasarGroundedContext, buildRepasarReviewTargets, computeRepasarCoverage,
  renderRepasarGroundedContextForPrompt,
} from '../../lib/materialBrain/reviewContext'
import { POST, __routeDeps } from '../../app/api/alai-studyal-repasar/route'

let providerCalls = 0

// TARGET FREEZE (lib/materialBrain/repasarSnapshot.ts): the route freezes
// each attempt's academic universe. These contracts inject an in-memory
// store so they stay provider-free and network-free.
const frozenSnapshots = new Map<string, any>()
const testSnapshotStore = {
  async get(id: string) { return frozenSnapshots.get(id) || null },
  async set(snapshot: any) { frozenSnapshots.set(snapshot.snapshotId, snapshot) },
}

function unit(id: string, materialId: string, page: number, derivation: 'native_text' | 'vision', kind: KnowledgeUnit['kind'] = 'fact'): KnowledgeUnit {
  const base: any = {
    id, kind,
    identity: { canonicalSubject: id, semanticKey: id, qualifiers: [] },
    label: `Concepto ${id}`, statement: `Contenido autorizado de ${id}`,
    importance: { tier: id === 'u-critical' ? 'critical' : 'supporting', signals: ['model_judged'], confidence: 0.9 },
    provenance: derivation === 'vision' ? [] : [{ materialId, page, quote: `Cita de ${id}`, chunkId: `c-${page}` }],
    evidence: derivation === 'vision'
      ? [{ materialId, page, derivation: 'vision', pageFingerprint: `pf-${id}`, analyzerVersion: '1.0', promptVersion: '1.0', description: `Descripción visual de ${id}` }]
      : [{ materialId, page, derivation: 'native_text', quote: `Cita de ${id}`, chunkId: `c-${page}` }],
    domainTags: [],
  }
  return base
}

function brain(
  fingerprint: string, units: KnowledgeUnit[], builderVersion = MATERIAL_BRAIN_BUILDER_VERSION,
  status: 'ready' | 'partial' | 'failed' = 'ready', relations: any[] = [],
): MaterialBrain {
  return {
    scope: buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3] }) && { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3] }), fingerprint },
    meta: {
      version: '1.0.0', builderVersion, generatedAt: new Date(0).toISOString(),
      chunking: { strategy: 'test', chunkSizeChars: 1000, chunkCount: 1 },
      llmCallsUsed: 0, retries: 0, status,
    },
    units, relations,
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'not_required' },
    knowledgeExtraction: { chunksAttempted: 1, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}

function relation(id: string, fromUnitId: string, toUnitId: string) {
  return {
    id, type: 'depends_on', fromUnitId, toUnitId, statement: `${fromUnitId} depende de ${toUnitId}`,
    importance: { tier: 'supporting', signals: [], confidence: 0.8 }, provenance: [],
  }
}

// ============================================================
// REP-COV-1/2/3, REP-GROUND-4 — pure reviewContext.ts contract
// ============================================================
function testCoverageDeterminism() {
  const b = brain('fp-cov', [
    unit('u1', 'mat-a', 1, 'native_text'),
    unit('u2', 'mat-a', 2, 'native_text'),
    unit('u3', 'mat-a', 3, 'vision'),
  ])
  const targets = buildRepasarReviewTargets(b)
  assert.equal(targets.length, 3, 'REP-COV-1 denominator is deterministic (one target per surviving unit)')

  const partial = computeRepasarCoverage(targets, ['u1'])
  assert.deepEqual(partial, {
    totalReviewTargets: 3, coveredReviewTargets: 1, coveragePercent: 33, missingTargetIds: ['u2', 'u3'],
  }, 'REP-COV-2 partial coverage produces real missingTargetIds')

  const full = computeRepasarCoverage(targets, ['u1', 'u2', 'u3'])
  assert.equal(full.coveragePercent, 100, 'REP-COV-3 full coverage = 100% when all legitimate targets covered')
  assert.deepEqual(full.missingTargetIds, [])

  // REP-GROUND-4: external/unknown ids never inflate coverage — the
  // denominator and numerator both ignore anything not in `targets`.
  const withExternal = computeRepasarCoverage(targets, ['u1', 'external-fact-not-in-brain', 'another-external'])
  assert.equal(withExternal.coveredReviewTargets, 1, 'REP-GROUND-4 unknown ids are dropped, not counted as covered')
  assert.equal(withExternal.totalReviewTargets, 3, 'REP-GROUND-4 unknown ids never grow the denominator')

  console.log('repasar-material-brain-grounding-contracts: REP-COV-1/2/3, REP-GROUND-4 PASS')
}

// ============================================================
// REP-VISION-1 — vision-derived evidence already authorized by the
// Brain participates in the grounded context without any new vision call.
// ============================================================
function testVisionEvidenceParticipates() {
  const b = brain('fp-vision', [unit('u-vision', 'mat-a', 2, 'vision')])
  const context = buildRepasarGroundedContext(b)
  assert.equal(context.targets.length, 1)
  assert.equal(context.targets[0].derivation, 'vision')
  assert.equal(context.targets[0].evidenceText, 'Descripción visual de u-vision', 'REP-VISION-1 vision evidence text is carried into the grounded target')
  const rendered = renderRepasarGroundedContextForPrompt(context)
  assert.ok(rendered.includes('Descripción visual de u-vision'), 'REP-VISION-1 vision evidence reaches the rendered prompt context')
  console.log('repasar-material-brain-grounding-contracts: REP-VISION-1 PASS')
}

// ============================================================
// Route-level contracts (REP-BRAIN-*, REP-GROUND-1/2/3, REP-PERF-*)
// ============================================================
async function testBrainAuthorityContracts() {
  const goodBrain = brain('fp-good', [
    unit('u-critical', 'mat-a', 1, 'native_text'),
    unit('u2', 'mat-a', 2, 'native_text'),
  ])

  function baseDeps(brainByFingerprint: Record<string, MaterialBrain | null>) {
    return {
      getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
      getAuthoritativeFreeSession: async (sessionId: string, userId: string) => {
        if (sessionId !== 'sess-1' || userId !== 'user-1') return null
        return { id: sessionId, userId, processMode: 'free', sourceSelection: buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3] }) && { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3] }), fingerprint: 'fp-good' } } as any
      },
      getMaterial: async () => ({ id: 'mat-a' }) as any,
      // TARGET FREEZE: in-memory attempt-snapshot store (no network).
      createRepasarSnapshotStore: () => testSnapshotStore,
      restoreMaterialBrain: async (fingerprint: string) => {
        providerCalls += 0 // restore is not a provider call
        return brainByFingerprint[fingerprint] ?? null
      },
      generateValidatedLegacyJson: async ({ validate }: any) => {
        providerCalls++
        const value = {
          score: 80, feedback: 'Buen intento', summary: 'Buen intento',
          conceptStatus: [], strengths: [], missingConcepts: [], confusions: [],
          repair: { question: '', topicLabel: '', targetConcepts: [], requiredFacts: [], optionalFacts: [] },
          targetCoverage: [
            { targetId: 'u-critical', status: 'covered' },
            { targetId: 'u2', status: 'missing' },
            { targetId: 'not-a-real-target', status: 'covered' },
          ],
        }
        assert.ok(validate(value).valid, 'mock response must satisfy route validation')
        return value
      },
    }
  }

  // REP-BRAIN-1: exact fingerprint's ready Brain is used.
  {
    Object.assign(__routeDeps, baseDeps({ 'fp-good': goodBrain }))
    const req = new NextRequest('http://localhost/api/alai-studyal-repasar', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', explanation: 'Expliqué lo que entendí del material.', mode: 'libre' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(res.status, 200, 'REP-BRAIN-1 exact-fingerprint ready Brain is accepted')
    assert.ok(data.analysis, 'REP-BRAIN-1 analysis returned from grounded evaluation')
    // REP-COV-2: deterministic coverage from targetCoverage, unknown id dropped.
    assert.equal(data.review.totalReviewTargets, 2, 'REP-GROUND-2 provider cannot add a target — denominator stays at real unit count')
    assert.equal(data.review.coveredReviewTargets, 1, 'REP-GROUND-2 unknown targetId from provider is ignored')
    assert.deepEqual(data.review.missingTargetIds, ['u2'])
    assert.equal(data.analysis.metrics.coverage, 50, 'REP-COV-1 metrics.coverage is the deterministic percent, not an LLM-invented number')
  }

  // REP-BRAIN-2: stale/wrong-fingerprint or wrong-builderVersion Brain is rejected.
  {
    const staleBrain = brain('fp-good', [unit('u1', 'mat-a', 1, 'native_text')], 'stale-builder-version')
    Object.assign(__routeDeps, baseDeps({ 'fp-good': staleBrain }))
    const req = new NextRequest('http://localhost/api/alai-studyal-repasar', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', explanation: 'Explicación', mode: 'libre' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(res.status, 409)
    assert.equal(data.error, 'STALE_BRAIN', 'REP-BRAIN-2 stale builderVersion Brain is rejected')
  }
  {
    const partialBrain = brain('fp-good', [unit('u1', 'mat-a', 1, 'native_text')], MATERIAL_BRAIN_BUILDER_VERSION, 'partial')
    Object.assign(__routeDeps, baseDeps({ 'fp-good': partialBrain }))
    const req = new NextRequest('http://localhost/api/alai-studyal-repasar', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', explanation: 'Explicación', mode: 'libre' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(res.status, 409)
    assert.equal(data.error, 'BRAIN_PARTIAL', 'REP-BRAIN-2 partial Brain is never accepted as ready')
  }

  // REP-BRAIN-3/4: restoreMaterialBrain never builds/extracts/vision — the
  // deps object below has no build/extract/vision function at all, so any
  // attempt to call one would throw ReferenceError/TypeError and fail loudly.
  {
    const providerCallsBefore = providerCalls
    Object.assign(__routeDeps, baseDeps({ 'fp-good': goodBrain }))
    const req = new NextRequest('http://localhost/api/alai-studyal-repasar', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', explanation: 'Explicación completa del material.', mode: 'libre' }),
    })
    await POST(req)
    // Two calls by design (reader-invariance fix): ONE persona-neutral
    // canonical academic evaluation (targetCoverage — decided once, before
    // any persona is injected) + ONE persona-flavored feedback call. Never
    // any build/extraction/vision call (still proven — see comment above).
    assert.equal(providerCalls, providerCallsBefore + 2, 'REP-BRAIN-3/4 exactly two provider calls (canonical evaluation + persona feedback), 0 extraction/vision calls')
  }

  // Raw source authority forbidden — client can no longer smuggle materialText.
  {
    Object.assign(__routeDeps, baseDeps({ 'fp-good': goodBrain }))
    const req = new NextRequest('http://localhost/api/alai-studyal-repasar', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', explanation: 'x', materialText: 'texto crudo inyectado' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(res.status, 400)
    assert.equal(data.detail, 'RAW_SOURCE_AUTHORITY_FORBIDDEN', 'REP-GROUND-1 client cannot inject raw materialText as authority')
  }

  console.log('repasar-material-brain-grounding-contracts: REP-BRAIN-1/2/3/4, REP-GROUND-1/2 PASS')
}

// ============================================================
// REP-PERF-1/2 — resolving a ready Brain and building the grounded
// context does zero provider calls and zero new extraction on its own
// (only the explicit evaluate() call below performs 1 provider call).
// ============================================================
async function testPerfNoWorkOnOpen() {
  const b = brain('fp-perf', Array.from({ length: 50 }, (_, i) => unit(`u${i}`, 'mat-a', (i % 3) + 1, i % 5 === 0 ? 'vision' : 'native_text')))
  const t0 = performance.now()
  const context = buildRepasarGroundedContext(b)
  const targets = context.targets
  const rendered = renderRepasarGroundedContextForPrompt(context)
  const t1 = performance.now()
  assert.equal(targets.length, 50)
  assert.ok(rendered.length > 0)
  assert.ok(t1 - t0 < 200, `REP-PERF-1/2 building grounded context from a ready Brain is fast (no extraction/vision/provider work): ${(t1 - t0).toFixed(1)}ms`)
  console.log(`repasar-material-brain-grounding-contracts: REP-PERF-1/2 PASS (${(t1 - t0).toFixed(1)}ms, 0 provider calls, 0 extraction)`)
}

// ============================================================
// Relation-backed target — real-shape acceptance (mission §4).
// ============================================================
function testRelationBackedTarget() {
  const b = brain('fp-rel', [
    unit('u-core', 'mat-a', 1, 'native_text'),
    unit('u-related', 'mat-a', 2, 'native_text'),
  ], MATERIAL_BRAIN_BUILDER_VERSION, 'ready', [relation('r1', 'u-core', 'u-related')])
  const context = buildRepasarGroundedContext(b)
  assert.equal(context.relations.length, 1, 'relation between two known targets survives into grounded context')
  assert.equal(context.relations[0].fromTargetId, 'u-core')
  const rendered = renderRepasarGroundedContextForPrompt(context)
  assert.ok(rendered.includes('RELACIONES AUTORIZADAS:'), 'relation-backed target is rendered into the prompt')
  console.log('repasar-material-brain-grounding-contracts: relation-backed target PASS')
}

// ============================================================
// REP-TRACE-1..5 — target identity survives evaluate -> teachMissing/
// repair -> checkTeachMissing, and the provider can never swap/add/
// confirm targets outside the authorized set.
// ============================================================
async function testTraceabilityContracts() {
  const b = brain('fp-trace', [
    unit('u-covered', 'mat-a', 1, 'native_text'),
    unit('u-missing', 'mat-a', 2, 'native_text'),
    unit('u-incorrect', 'mat-a', 3, 'native_text'),
  ])

  function depsFor(evaluateResponse: any, teachCheckResponse: any) {
    return {
      getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
      getAuthoritativeFreeSession: async () => ({
        id: 'sess-trace', userId: 'user-1', processMode: 'free',
        sourceSelection: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3] }), fingerprint: 'fp-trace' },
      }) as any,
      getMaterial: async () => ({ id: 'mat-a' }) as any,
      // TARGET FREEZE: in-memory attempt-snapshot store (no network).
      createRepasarSnapshotStore: () => testSnapshotStore,
      restoreMaterialBrain: async (fingerprint: string) => (fingerprint === 'fp-trace' ? b : null),
      generateValidatedLegacyJson: async ({ messages, validate }: any) => {
        providerCalls++
        const isTeachCheck = messages.some((m: any) => String(m.content || '').includes('HECHOS REQUERIDOS') || String(m.content || '').includes('Verifica si el estudiante'))
        const value = isTeachCheck ? teachCheckResponse : evaluateResponse
        assert.ok(validate(value).valid, 'mock response must satisfy route validation')
        return value
      },
    }
  }

  // REP-TRACE-1/2: evaluate marks u-missing/u-incorrect as gaps; provider
  // tries to also claim an unknown id and to include the already-covered
  // target — both must be filtered out of the returned repairTargetIds.
  const evaluateResponse = {
    score: 55, feedback: 'Cubriste una parte', summary: 'Cubriste una parte',
    conceptStatus: [], strengths: [], missingConcepts: [], confusions: [],
    repair: {
      question: '¿Qué te faltó explicar?', topicLabel: 'Repaso',
      targetConcepts: [], requiredFacts: ['Hecho A', 'Hecho B'], optionalFacts: [],
      targetIds: ['u-missing', 'u-covered', 'unknown-fabricated-target'],
    },
    targetCoverage: [
      { targetId: 'u-covered', status: 'covered' },
      { targetId: 'u-missing', status: 'missing' },
      { targetId: 'u-incorrect', status: 'incorrect' },
    ],
  }

  Object.assign(__routeDeps, depsFor(evaluateResponse, {}))
  const evalReq = new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-trace', explanation: 'Expliqué una parte del material.', mode: 'libre' }),
  })
  const evalRes = await POST(evalReq)
  const evalData = await evalRes.json()
  assert.equal(evalRes.status, 200)
  assert.deepEqual(
    [...evalData.analysis.repair.repairTargetIds].sort(),
    ['u-missing'],
    'REP-TRACE-1/2 repairTargetIds keeps only the gap that was actually flagged missing/incorrect — drops the covered target and the fabricated unknown id',
  )

  // REP-TRACE-3/4: checkTeachMissing receives back exactly the persisted
  // `repair` object (as the client would resend it after a refresh) and
  // must verify against those SAME target ids — even if the provider's
  // free-text response tries to sneak in a different confirmed id.
  // evaluateResponse.repair.requiredFacts has 2 entries, so teach-check
  // takes the deterministic hasFixedFacts/factCoverage path (both covered).
  const teachCheckResponse = {
    factCoverage: [{ covered: true, note: '' }, { covered: true, note: '' }],
    message: 'Bien explicado', improvedAnswer: '',
    // REP-TRACE-4: this extra field is NOT part of our schema — the route
    // must never read confirmedTargetIds from the provider's own output.
    confirmedTargetIds: ['smuggled-target-id'],
  }
  Object.assign(__routeDeps, depsFor(evaluateResponse, teachCheckResponse))
  const checkReq = new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'teach-check', sessionId: 'sess-trace', mode: 'libre',
      repair: evalData.analysis.repair, // exactly what would be persisted/resent
      answer: 'Ahora sí lo entendí bien.',
    }),
  })
  const checkRes = await POST(checkReq)
  const checkData = await checkRes.json()
  assert.equal(checkRes.status, 200)
  assert.deepEqual(checkData.check.targetIds, ['u-missing'], 'REP-TRACE-3 checkTeachMissing verifies exactly the target ids selected by evaluate')
  assert.deepEqual(checkData.check.confirmedTargetIds, ['u-missing'], 'REP-TRACE-3 confirmation is scoped to the authorized target id')
  assert.ok(!checkData.check.confirmedTargetIds.includes('smuggled-target-id'), 'REP-TRACE-4 provider cannot inject a confirmed target id outside the authorized set')

  // REP-TRACE-2 (defense in depth): a teach-check request that tries to pass
  // a fabricated/foreign target id directly is filtered before verification.
  Object.assign(__routeDeps, depsFor(evaluateResponse, { ...teachCheckResponse, understood: [] }))
  const tamperedReq = new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'teach-check', sessionId: 'sess-trace', mode: 'libre',
      repair: { ...evalData.analysis.repair, repairTargetIds: ['u-missing', 'client-forged-id'] },
      answer: 'Respuesta',
    }),
  })
  const tamperedRes = await POST(tamperedReq)
  const tamperedData = await tamperedRes.json()
  assert.deepEqual(tamperedData.check.targetIds, ['u-missing'], 'REP-TRACE-2 a client-forged target id is filtered out server-side, never trusted as authority')

  console.log('repasar-material-brain-grounding-contracts: REP-TRACE-1/2/3/4 PASS')
}

// ============================================================
// REP-RESUME-1..5 — persistence contract. We don't exercise the browser
// localStorage layer (freeToolState.ts is DOM-backed); instead we prove
// the SERVER-SIDE data shape that gets persisted (analysis/repair/check,
// exactly what the client stores verbatim) survives a JSON round-trip
// unchanged, is fingerprint-scoped, and degrades safely for legacy shapes.
// ============================================================
async function testResumeContracts() {
  const b1 = brain('fp-resume-a', [unit('u-a', 'mat-a', 1, 'native_text')])
  const b2 = brain('fp-resume-b', [unit('u-b', 'mat-a', 1, 'native_text')])

  function deps(brainByFingerprint: Record<string, MaterialBrain>) {
    let lastFingerprint = ''
    return {
      getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
      getAuthoritativeFreeSession: async (sessionId: string) => {
        const fingerprint = sessionId === 'sess-a' ? 'fp-resume-a' : sessionId === 'sess-b' ? 'fp-resume-b' : null
        if (!fingerprint) return null
        return { id: sessionId, userId: 'user-1', processMode: 'free', sourceSelection: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint } } as any
      },
      getMaterial: async () => ({ id: 'mat-a' }) as any,
      // TARGET FREEZE: in-memory attempt-snapshot store (no network).
      createRepasarSnapshotStore: () => testSnapshotStore,
      restoreMaterialBrain: async (fingerprint: string) => {
        lastFingerprint = fingerprint
        return brainByFingerprint[fingerprint] ?? null
      },
      generateValidatedLegacyJson: async ({ validate }: any) => {
        providerCalls++
        const ownTargetId = lastFingerprint === 'fp-resume-b' ? 'u-b' : 'u-a'
        const value = {
          score: 60, feedback: 'ok', summary: 'ok', conceptStatus: [], strengths: [], missingConcepts: [], confusions: [],
          repair: { question: 'q', topicLabel: 't', targetConcepts: [], requiredFacts: [], optionalFacts: [], targetIds: [ownTargetId] },
          targetCoverage: [{ targetId: ownTargetId, status: 'missing' }],
        }
        assert.ok(validate(value).valid)
        return value
      },
    }
  }

  Object.assign(__routeDeps, deps({ 'fp-resume-a': b1, 'fp-resume-b': b2 }))
  const req = new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-a', explanation: 'Explicación inicial.', mode: 'libre' }),
  })
  const res = await POST(req)
  const data = await res.json()

  // What the client would persist verbatim (see PersistedRepasarState.analysis).
  const persistedShape = {
    phase: 'analisis', furthestPhase: 'analisis', notes: '', explanation: 'Explicación inicial.',
    mode: 'libre', analysis: data.analysis, attempts: [{ id: 'a1', createdAt: 0, mode: 'libre', explanation: 'Explicación inicial.', analysis: data.analysis, teachCheck: null }],
    followUpAnswer: '', teachCheck: null, activeRepasarColor: 'rgba(250, 204, 21, 0.48)',
  }
  const roundTripped = JSON.parse(JSON.stringify(persistedShape))
  assert.deepEqual(roundTripped.analysis.repair.repairTargetIds, ['u-a'], 'REP-RESUME-1 grounded repair target ids survive a refresh (JSON round-trip) exactly')
  assert.equal(roundTripped.phase, 'analisis')
  assert.equal(roundTripped.followUpAnswer, '')
  assert.deepEqual(roundTripped.analysis, data.analysis, 'REP-RESUME-2 phase/analysis/teach/follow-up state restores unchanged for the same fingerprint')

  // REP-RESUME-3: a DIFFERENT session (different fingerprint) resolves a
  // DIFFERENT Brain and therefore can never reuse sess-a's grounded state —
  // durable storage itself is keyed by fingerprint (freeToolState.ts), and
  // here we prove the server-side identity that key depends on is distinct.
  Object.assign(__routeDeps, deps({ 'fp-resume-a': b1, 'fp-resume-b': b2 }))
  const reqB = new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-b', explanation: 'Otra explicación.', mode: 'libre' }),
  })
  const resB = await POST(reqB)
  const dataB = await resB.json()
  assert.notDeepEqual(dataB.analysis.repair.repairTargetIds, roundTripped.analysis.repair.repairTargetIds.map(() => 'u-a'), 'sanity: different fingerprint session produced its own targets')
  assert.deepEqual(dataB.analysis.repair.repairTargetIds, ['u-b'], 'REP-RESUME-3 a different fingerprint resolves its own Brain/targets, never fp-resume-a\'s grounded repair state')

  // REP-RESUME-4: legacy persisted `repair` (no repairTargetIds field at
  // all — pre-migration shape) must still work through teach-check via the
  // existing requiredFacts fallback, never crash, never fabricate identity.
  Object.assign(__routeDeps, deps({ 'fp-resume-a': b1, 'fp-resume-b': b2 }))
  const legacyRepair = { question: 'Pregunta vieja', topicLabel: 'Tema', targetConcepts: ['Tema'], requiredFacts: ['Hecho legado'], optionalFacts: [] }
  const legacyCheckDeps = deps({ 'fp-resume-a': b1, 'fp-resume-b': b2 })
  legacyCheckDeps.generateValidatedLegacyJson = async ({ validate }: any) => {
    providerCalls++
    const value = { factCoverage: [{ covered: true, note: '' }], message: 'Bien' }
    assert.ok(validate(value).valid)
    return value
  }
  Object.assign(__routeDeps, legacyCheckDeps)
  const legacyReq = new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'teach-check', sessionId: 'sess-a', mode: 'libre', repair: legacyRepair, answer: 'Respuesta' }),
  })
  const legacyRes = await POST(legacyReq)
  const legacyData = await legacyRes.json()
  assert.equal(legacyRes.status, 200, 'REP-RESUME-4 legacy repair (no repairTargetIds) is still accepted safely')
  assert.equal(legacyData.check.passed, true)
  assert.deepEqual(legacyData.check.targetIds, [], 'REP-RESUME-4 legacy shape never fabricates grounded target identity that was never authorized')

  // REP-RESUME-5: resuming (reading persisted state) performs 0 provider
  // calls by construction — the component never auto-invokes evaluate()/
  // checkTeachMissing() on mount. Verified statically against the source.
  const { readFileSync } = await import('node:fs')
  const componentSource = readFileSync('components/materias/ALAIStudyALRepasar.tsx', 'utf8')
  const mountEffect = componentSource.slice(
    componentSource.indexOf('readFreeToolState<PersistedRepasarState>'),
    componentSource.indexOf('readFreeToolState<PersistedRepasarState>') + 1200,
  )
  assert.ok(!mountEffect.includes('evaluate()') && !mountEffect.includes('checkTeachMissing()'), 'REP-RESUME-5 resume/restore effect never auto-triggers a provider-calling action')

  console.log('repasar-material-brain-grounding-contracts: REP-RESUME-1/2/3/4/5 PASS')
}

async function main() {
  // These authority-neutral review-context contracts remain relevant to
  // legacy Material Brain consumers. Active Free Repasar authority,
  // traceability, snapshot and restore behavior are covered by
  // repasar-enjoyer-migration-contracts.ts.
  testCoverageDeterminism()
  testVisionEvidenceParticipates()
  testRelationBackedTarget()
  await testPerfNoWorkOnOpen()
  assert.equal(providerCalls, 0, 'retained authority-neutral contracts make no provider calls')
  console.log('repasar-material-brain-grounding-contracts: AUTHORITY-NEUTRAL LEGACY CONTRACTS PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
