import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  POST,
  __routeDeps,
  computeRepasoLetterGrade,
} from '../../app/api/alai-studyal-repasar/route'
import {
  computeRepasarDomainMap,
  computeRepasoCanonicalScore,
} from '../../lib/materialBrain/reviewContext'
import {
  WorkerRepasoArtifactStore,
  repasoArtifactMaterialId,
} from '../../lib/materialBrain/repasoArtifactStore'
import {
  isRepasoArtifact,
  type RepasoArtifact,
} from '../../lib/materialBrain/repasoArtifact'

/* ------------------------------------------------------------------ */
/*  Tiny test runner                                                  */
/* ------------------------------------------------------------------ */

let passed = 0
let failed = 0
const failures: string[] = []

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e: any) {
    failed++
    failures.push(name)
    console.error(`  ✗ ${name}`)
    console.error(`    ${e.stack || e.message}`)
  }
}

/* ------------------------------------------------------------------ */
/*  Fixture data                                                      */
/* ------------------------------------------------------------------ */

const selection = buildSourceSelectionSnapshot(['m1'], { 'm1': [1, 2] })

const MOCK_VERDICTS = [
  { targetId: 't1', status: 'covered' as const, evidence: 'ev1 real text', demonstrated: 'dem1 real text', missingDetail: '' },
  { targetId: 't2', status: 'partial' as const, evidence: 'ev2 real text', demonstrated: 'dem2 real text', missingDetail: 'miss2 real text' },
  { targetId: 't3', status: 'missing' as const, evidence: '', demonstrated: '', missingDetail: '' },
]

const MOCK_FEEDBACK = {
  score: 30,
  feedback: 'ok',
  summary: 'ok',
  conceptStatus: [],
  strengths: [],
  missingConcepts: [],
  confusions: [],
  repair: {
    question: '', topicLabel: '', targetConcepts: [],
    requiredFacts: [], optionalFacts: [], targetIds: [],
  },
}

// Structured enjoyer payload that buildRepasarEnjoyerGroundedContext accepts:
const MOCK_ENJOYER_PAYLOAD = {
  sourceSelectionFingerprint: selection.fingerprint,
  topicsIndex: [{ id: 'top1', title: 'Topic 1', order: 0 }],
  globalOrderedAnalysis: [
    {
      id: 't1', kind: 'concept', name: 'Concepto A', summary: 'stmt A',
      importance: 90, materialId: 'm1', pages: [1],
      sourceSpans: [{ page: 1, quote: 'stmt A explica con evidencia sustantiva el equilibrio químico y su comportamiento dinámico.' }], topicId: 'top1', globalOrder: 1,
    },
    {
      id: 't2', kind: 'concept', name: 'Concepto B', summary: 'stmt B',
      importance: 60, materialId: 'm1', pages: [2],
      sourceSpans: [{ page: 2, quote: 'stmt B explica con evidencia sustantiva el equilibrio químico y sus constantes observables.' }], topicId: 'top1', globalOrder: 2,
    },
  ],
  uniqueConceptsIndex: [
    {
      id: 't3', kind: 'concept', name: 'Concepto C', summary: 'stmt C',
      importance: 30, materialId: 'm1', pages: [2],
      sourceSpans: [{ page: 2, quote: 'stmt C explica con evidencia sustantiva el equilibrio químico y sus relaciones observables.' }], topicId: null, firstAppearanceOrder: 3,
    },
  ],
}

/* ------------------------------------------------------------------ */
/*  Mock store                                                        */
/* ------------------------------------------------------------------ */

function createMockArtifactStore() {
  const store = new Map<string, any>()
  const saveCalls: any[] = []
  return {
    store,
    saveCalls,
    async get(artifactId: string) {
      const payload = store.get(artifactId)
      if (!payload) return null
      if (!isRepasoArtifact(payload)) return null
      if (payload.artifactId !== artifactId) return null
      return payload as RepasoArtifact
    },
    async set(artifact: RepasoArtifact) {
      const storageId = repasoArtifactMaterialId(artifact.artifactId)
      saveCalls.push({ id: storageId, material_id: storageId, artifact })
      store.set(artifact.artifactId, artifact)
    },
  }
}

/* ------------------------------------------------------------------ */
/*  Install mocks                                                     */
/* ------------------------------------------------------------------ */

function extractRequestedTargetIds(messages: any[]): string[] {
  const text = (messages || []).map((m: any) => String(m?.content || '')).join('\n')
  return [...text.matchAll(/\[TARGET (\S+?)\]/g)].map(match => match[1])
}

function installMocks(overrides: {
  incompleteCoverage?: boolean
  feedbackScore?: number
  enjoyerPayload?: any
  verdicts?: { targetId: string; status: string; evidence?: string; demonstrated?: string; missingDetail?: string }[]
  coverageForText?: Record<string, { targetId: string; status: string; evidence?: string; demonstrated?: string; missingDetail?: string }[]>
} = {}) {
  const artifactStore = createMockArtifactStore()
  const snapshotStore = new Map<string, any>()
  const callCounts = { analysisBatch: 0, analysis: 0, recoveryQuestion: 0, finalQuestion: 0 }

  const feedback = { ...MOCK_FEEDBACK, score: overrides.feedbackScore ?? 30 }
  const verdicts = overrides.verdicts ?? MOCK_VERDICTS
  const enjoyerPayload = overrides.enjoyerPayload ?? MOCK_ENJOYER_PAYLOAD

  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'user-1' } }),
    getAuthoritativeFreeSession: async () => ({
      id: 'sess-live',
      userId: 'user-1',
      processMode: 'free',
      sourceSelection: selection,
    }),
    getMaterial: async () => ({ id: 'm1' }),
    lookupEnjoyer: async (fingerprint: string) =>
      fingerprint === selection.fingerprint
        ? enjoyerPayload
        : null,
    createRepasarSnapshotStore: () => ({
      async get(id: string) { return snapshotStore.get(id) || null },
      async set(s: any) { snapshotStore.set(s.snapshotId, s) },
    }),
    createRepasoArtifactStore: () => artifactStore,
    generateValidatedLegacyJson: async ({ telemetryContext, messages }: any) => {
      const phase = telemetryContext?.phase
      if (phase === 'analysis_batch') {
        callCounts.analysisBatch++
        if (overrides.incompleteCoverage) {
          return { targetCoverage: verdicts.slice(0, 1) }
        }
        const requestedIds = new Set(extractRequestedTargetIds(messages))
        const prompt = (messages || []).map((m: any) => String(m?.content || '')).join('\n')
        const selected = Object.entries(overrides.coverageForText || {}).find(([needle]) => prompt.includes(needle))?.[1] || verdicts
        return { targetCoverage: selected.filter(v => requestedIds.has(v.targetId)) }
      }
      if (phase === 'repaso_recovery_question') {
        callCounts.recoveryQuestion++
        return { question: '¿Cómo explica stmt el equilibrio químico?' }
      }
      if (phase === 'repaso_final_question') {
        callCounts.finalQuestion++
        const prompt = (messages || []).map((m: any) => String(m?.content || '')).join('\n')
        const checkIds = [...prompt.matchAll(/(fvcheck_\d+_[^:\s]+):/g)].map(match => match[1])
        return { checks: checkIds.map((checkId, index) => ({ checkId, question: `Verificación ${index + 1}` })) }
      }
      callCounts.analysis++
      return feedback
    },
  })

  return { artifactStore, snapshotStore, callCounts }
}

function makeRequest(body: Record<string, any>): NextRequest {
  return new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

async function run() {
  console.log('\nRepaso Route Contracts (Stage 2)\n')

  /* A */ await test('A — repaso-initial returns 200 for complete coverage', async () => {
    installMocks()
    const res = await POST(makeRequest({
      kind: 'repaso-initial',
      sessionId: 'sess-live',
      explanation: 'Mi explicación inicial',
    }))
    assert.equal(res.status, 200)
  })

  /* B */ await test('B — artifact store set called exactly once', async () => {
    const { artifactStore } = installMocks()
    await POST(makeRequest({
      kind: 'repaso-initial',
      sessionId: 'sess-live',
      explanation: 'test',
    }))
    assert.equal(artifactStore.saveCalls.length, 1)
  })

  /* C */ await test('C — artifact has authoritative IDs', async () => {
    const { artifactStore } = installMocks()
    await POST(makeRequest({
      kind: 'repaso-initial',
      sessionId: 'sess-live',
      explanation: 'test',
    }))
    const saved = artifactStore.saveCalls[0].artifact as RepasoArtifact
    assert.ok(saved.artifactId.startsWith('repaso_'))
    assert.equal(saved.sessionId, 'sess-live')
    assert.ok(saved.initial.snapshotId.startsWith('rsnap_'))
    assert.equal(saved.initial.fingerprint, selection.fingerprint)
  })

  /* D */ await test('D — initial.explanation is exact input', async () => {
    const { artifactStore } = installMocks()
    const expl = 'Explicación exacta del estudiante con ñ y ü'
    await POST(makeRequest({
      kind: 'repaso-initial',
      sessionId: 'sess-live',
      explanation: expl,
    }))
    const saved = artifactStore.saveCalls[0].artifact as RepasoArtifact
    assert.equal(saved.initial.explanation, expl)
  })

  /* E */ await test('E — initial/current target universes identical', async () => {
    const { artifactStore } = installMocks()
    await POST(makeRequest({
      kind: 'repaso-initial',
      sessionId: 'sess-live',
      explanation: 'test',
    }))
    const saved = artifactStore.saveCalls[0].artifact as RepasoArtifact
    const initIds = Object.keys(saved.initial.initialTargetStates).sort()
    const curIds = Object.keys(saved.currentTargetStates).sort()
    assert.deepEqual(initIds, curIds)
  })

  /* F */ await test('F — recovery plan has every unresolved target exactly once', async () => {
    const { artifactStore } = installMocks()
    await POST(makeRequest({
      kind: 'repaso-initial',
      sessionId: 'sess-live',
      explanation: 'test',
    }))
    const saved = artifactStore.saveCalls[0].artifact as RepasoArtifact
    const planIds = saved.recoveryPlan!.groups.flatMap(g => g.targetIds).sort()
    assert.deepEqual(planIds, ['t2', 't3'])
  })

  /* G */ await test('G — covered targets absent from recovery plan', async () => {
    const { artifactStore } = installMocks()
    await POST(makeRequest({
      kind: 'repaso-initial',
      sessionId: 'sess-live',
      explanation: 'test',
    }))
    const saved = artifactStore.saveCalls[0].artifact as RepasoArtifact
    const planIds = saved.recoveryPlan!.groups.flatMap(g => g.targetIds)
    assert.ok(!planIds.includes('t1'))
  })

  /* H */ await test('H — incomplete coverage returns REPASAR_COVERAGE_INCOMPLETE_RETRYABLE 409', async () => {
    installMocks({ incompleteCoverage: true })
    const res = await POST(makeRequest({
      kind: 'repaso-initial',
      sessionId: 'sess-live',
      explanation: 'test',
    }))
    assert.equal(res.status, 409)
    const data = await res.json()
    assert.equal(data.error, 'REPASAR_COVERAGE_INCOMPLETE_RETRYABLE')
    assert.ok('totalTargets' in data)
    assert.ok('adjudicatedCount' in data)
    assert.ok('remainingTargetIds' in data)
  })

  /* I */ await test('I — incomplete coverage = ZERO artifact saves', async () => {
    const { artifactStore } = installMocks({ incompleteCoverage: true })
    await POST(makeRequest({
      kind: 'repaso-initial',
      sessionId: 'sess-live',
      explanation: 'test',
    }))
    assert.equal(artifactStore.saveCalls.length, 0)
  })

  /* J */ await test('J — response contains only expected Stage-2 fields', async () => {
    installMocks()
    const res = await POST(makeRequest({
      kind: 'repaso-initial',
      sessionId: 'sess-live',
      explanation: 'test',
    }))
    const data = await res.json()
    assert.ok('artifactId' in data)
    assert.ok('snapshotId' in data)
    assert.ok('initialScore' in data)
    assert.ok('initialLetterGrade' in data)
    assert.ok('recoveryPlan' in data)
  })

  /* K */ await test('K — response does NOT expose currentTargetStates', async () => {
    installMocks()
    const res = await POST(makeRequest({
      kind: 'repaso-initial',
      sessionId: 'sess-live',
      explanation: 'test',
    }))
    const data = await res.json()
    assert.ok(!('currentTargetStates' in data))
  })

  // ------------------------------------------------------------------
  // STAGE 2.5A MIGRATION CONTRACT — the old single "CRITICAL PARITY" test
  // asserted legacy mode:'libre' score === repaso-initial score. That
  // equality is now INTENTIONALLY obsolete: legacy keeps its provider-
  // quality-composed formula (evaluateRepasarInitialQuality), while
  // repaso-initial now uses the deterministic canonical Score v2
  // (computeRepasoCanonicalScore). Replaced by two independent contracts:
  //   L1 — proves Stage 2.5A did NOT accidentally migrate legacy.
  //   L2 — proves repaso-initial genuinely uses canonical Score v2.
  // ------------------------------------------------------------------

  /* L1 */ await test('L1 — legacy mode:libre remains on the legacy provider-quality formula (regression)', async () => {
    const { callCounts } = installMocks({ feedbackScore: 42 })
    const res = await POST(makeRequest({
      sessionId: 'sess-live',
      explanation: 'this is the legacy regression explanation text',
      mode: 'libre',
      materia: '',
      tema: '',
      notes: '',
    }))
    assert.equal(res.status, 200)
    const data = await res.json()
    // Legacy's score is masteryPercent from computeRepasarMastery, which
    // composes recallPercent (from the SAME domainMap) with qualityFrac
    // (mocked feedbackScore=42/100 here) — NOT the raw canonical-coverage
    // percentage alone. MOCK_ENJOYER_PAYLOAD importances are t1=90
    // (critical, weight 3), t2=60 (supporting, weight 2), t3=30
    // (supporting, weight 2 — the adapter's threshold is strictly "< 30"
    // for contextual). With MOCK_VERDICTS (t1 covered, t2 partial, t3
    // missing): totalWeight=7, recallWeight=3+2*0.5=4,
    // recallPercent=round(4/7*100)=57, baseMastery=57*(0.5+0.5*0.42)=
    // 57*0.71=40.47, incorrectPenalty=0 -> masteryPercent=round(40.47)=40.
    assert.equal(data.analysis.score, 40, 'legacy score must still be the provider-quality-composed formula, unchanged by Stage 2.5A')
    assert.equal(data.analysis.letterGrade, computeRepasoLetterGrade(40))
    assert.equal(callCounts.analysis, 1, 'legacy still makes exactly one phase:"analysis" (persona/quality) call')
  })

  /* L2 */ await test('L2 — repaso-initial uses canonical Score v2, independently verified, zero quality calls', async () => {
    const { callCounts } = installMocks({ feedbackScore: 42 })
    const res = await POST(makeRequest({
      kind: 'repaso-initial',
      sessionId: 'sess-live',
      explanation: 'canonical score v2 explanation',
    }))
    assert.equal(res.status, 200)
    const data = await res.json()

    // Independently recompute the expected score from the SAME canonical
    // pieces the route itself would have used — never trusting the route's
    // own output as its own proof. Importance tiers mirror the REAL
    // Enjoyer adapter mapping for MOCK_ENJOYER_PAYLOAD's importance values
    // (t1=90 -> critical, t2=60/t3=30 -> supporting; the adapter's
    // threshold for 'contextual' is strictly "< 30").
    const targets = [
      { id: 't1', importanceTier: 'critical' as const },
      { id: 't2', importanceTier: 'supporting' as const },
      { id: 't3', importanceTier: 'supporting' as const },
    ].map(t => ({ ...t, unitId: t.id, kind: 'concept', label: t.id, statement: t.id, difficulty: null, topicId: null, topicTitle: null, sourceOrder: 0, materialId: 'm1', page: 1, pages: [1], sourceSpans: [], derivation: null, evidenceText: t.id }))
    const expectedDomainMap = computeRepasarDomainMap(targets, MOCK_VERDICTS)
    const expectedScore = computeRepasoCanonicalScore(expectedDomainMap)

    assert.equal(data.initialScore, expectedScore, 'repaso-initial score must equal the independently-computed canonical Score v2')
    assert.equal(data.initialLetterGrade, computeRepasoLetterGrade(expectedScore))
    assert.equal(callCounts.analysis, 0, 'repaso-initial must make ZERO phase:"analysis" (persona/quality) calls')
    assert.ok(callCounts.analysisBatch >= 1, 'repaso-initial still makes the canonical coverage batch call(s)')
  })

  /* L3 */ await test('L3 — repaso-initial score reflects mixed importance tiers (weighted route fixture)', async () => {
    // Distinct fixture: 3 targets spanning critical/supporting/contextual
    // with mixed statuses, so the route-level score provably depends on
    // the EXISTING IMPORTANCE_WEIGHT tiers, not a uniform/unweighted count.
    const weightedPayload = {
      sourceSelectionFingerprint: selection.fingerprint,
      topicsIndex: [{ id: 'top1', title: 'Topic 1', order: 0 }],
      globalOrderedAnalysis: [
        { id: 'w1', kind: 'concept', name: 'Critical concept', summary: 'stmt w1', importance: 90, materialId: 'm1', pages: [1], sourceSpans: [{ page: 1, quote: 'stmt w1' }], topicId: 'top1', globalOrder: 1 },
        { id: 'w2', kind: 'concept', name: 'Supporting concept', summary: 'stmt w2', importance: 50, materialId: 'm1', pages: [1], sourceSpans: [{ page: 1, quote: 'stmt w2' }], topicId: 'top1', globalOrder: 2 },
        { id: 'w3', kind: 'concept', name: 'Contextual concept', summary: 'stmt w3', importance: 10, materialId: 'm1', pages: [1], sourceSpans: [{ page: 1, quote: 'stmt w3' }], topicId: 'top1', globalOrder: 3 },
      ],
      uniqueConceptsIndex: [],
    }
    // w1 critical(3) covered -> 3.0 credit; w2 supporting(2) partial -> 1.0 credit; w3 contextual(1) missing -> 0
    // totalWeight = 3+2+1 = 6, credit = 4 -> round(4/6*100) = 67
    const weightedVerdicts = [
      { targetId: 'w1', status: 'covered' as const, evidence: 'ev w1', demonstrated: 'dem w1', missingDetail: '' },
      { targetId: 'w2', status: 'partial' as const, evidence: 'ev w2', demonstrated: 'dem w2', missingDetail: 'miss w2' },
      // w3 must be an EXPLICIT "missing" verdict (never just absent) — the
      // full-universe adjudication invariant requires every target to
      // receive an explicit verdict, or it's transport-unadjudicated and
      // the request returns 409, never silently defaulted.
      { targetId: 'w3', status: 'missing' as const, evidence: '', demonstrated: '', missingDetail: '' },
    ]
    installMocks({ enjoyerPayload: weightedPayload, verdicts: weightedVerdicts })
    const res = await POST(makeRequest({
      kind: 'repaso-initial',
      sessionId: 'sess-live',
      explanation: 'weighted fixture explanation',
    }))
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.initialScore, 67, 'score must reflect critical(3)/supporting(2)/contextual(1) weighting, not a uniform count')
  })

  /* M */ await test('M — store get restores valid artifact', async () => {
    const store = new WorkerRepasoArtifactStore({
      getMaterialResult: async () => ({
        payload: {
          schemaVersion: '1.0.0',
          artifactId: 'repaso_test',
          sessionId: 's1',
          initial: {
            snapshotId: 'sn', fingerprint: 'fp', explanation: 'e',
            createdAt: '2024-01-01', initialTargetStates: {},
            initialScore: 0, initialLetterGrade: 'F',
          },
          currentTargetStates: {},
          recoveryPlan: null,
          recoveryAttempts: [],
          scoreHistory: [],
          finalVerification: null,
        },
      }) as any,
      saveMaterialResult: async () => ({}) as any,
    })
    const result = await store.get('repaso_test')
    assert.ok(result !== null)
    assert.equal(result!.artifactId, 'repaso_test')
  })

  /* N */ await test('N — store get rejects malformed payload', async () => {
    const store = new WorkerRepasoArtifactStore({
      getMaterialResult: async () => ({ payload: { garbage: true } }) as any,
      saveMaterialResult: async () => ({}) as any,
    })
    const result = await store.get('repaso_test')
    assert.equal(result, null)
  })

  /* O */ await test('O — store get rejects wrong artifactId', async () => {
    const store = new WorkerRepasoArtifactStore({
      getMaterialResult: async () => ({
        payload: {
          schemaVersion: '1.0.0',
          artifactId: 'repaso_WRONG',
          sessionId: 's1',
          initial: {
            snapshotId: 'sn', fingerprint: 'fp', explanation: 'e',
            createdAt: '2024-01-01', initialTargetStates: {},
            initialScore: 0, initialLetterGrade: 'F',
          },
          currentTargetStates: {},
          recoveryPlan: null,
          recoveryAttempts: [],
          scoreHistory: [],
          finalVerification: null,
        },
      }) as any,
      saveMaterialResult: async () => ({}) as any,
    })
    const result = await store.get('repaso_test')
    assert.equal(result, null)
  })

  /* P */ await test('P — store set sends both id and material_id', async () => {
    const saveCalls: any[] = []
    const store = new WorkerRepasoArtifactStore({
      getMaterialResult: async () => null,
      saveMaterialResult: async (data: any) => { saveCalls.push(data); return {} as any },
    })
    const artifact: RepasoArtifact = {
      schemaVersion: '1.0.0',
      artifactId: 'repaso_abc',
      sessionId: 's1',
      initial: {
        snapshotId: 'sn', fingerprint: 'fp', explanation: 'e',
        createdAt: '2024-01-01', initialTargetStates: {},
        initialScore: 0, initialLetterGrade: 'F',
      },
      currentTargetStates: {},
      recoveryPlan: null,
      recoveryAttempts: [],
      scoreHistory: [],
      finalVerification: null,
    }
    await store.set(artifact)
    assert.equal(saveCalls.length, 1)
    assert.equal(saveCalls[0].id, 'repaso_artifact:repaso_abc')
    assert.equal(saveCalls[0].material_id, 'repaso_artifact:repaso_abc')
  })

  /* Q */ await test('Q — two set calls for same artifactId use same DB id', async () => {
    const saveCalls: any[] = []
    const store = new WorkerRepasoArtifactStore({
      getMaterialResult: async () => null,
      saveMaterialResult: async (data: any) => { saveCalls.push(data); return {} as any },
    })
    const artifact: RepasoArtifact = {
      schemaVersion: '1.0.0',
      artifactId: 'repaso_xyz',
      sessionId: 's1',
      initial: {
        snapshotId: 'sn', fingerprint: 'fp', explanation: 'e',
        createdAt: '2024-01-01', initialTargetStates: {},
        initialScore: 0, initialLetterGrade: 'F',
      },
      currentTargetStates: {},
      recoveryPlan: null,
      recoveryAttempts: [],
      scoreHistory: [],
      finalVerification: null,
    }
    await store.set(artifact)
    await store.set({ ...artifact, recoveryAttempts: [] as any })
    assert.equal(saveCalls[0].id, saveCalls[1].id)
    assert.equal(saveCalls[0].id, 'repaso_artifact:repaso_xyz')
  })

  /* R */ await test('R — recovery open derives current group, canonical pages, prefers zero-call deterministic authoring, and reopens frozen', async () => {
    const { callCounts } = installMocks()
    const initial = await (await POST(makeRequest({ kind: 'repaso-initial', sessionId: 'sess-live', explanation: 'initial student text' }))).json()
    const opened = await POST(makeRequest({ kind: 'repaso-recovery-open', sessionId: 'sess-live', artifactId: initial.artifactId }))
    assert.equal(opened.status, 200)
    const first = await opened.json()
    assert.equal(first.groupId, initial.recoveryPlan.groups[0].groupId)
    assert.deepEqual(first.pagesToReview, initial.recoveryPlan.groups[0].pages)
    // Deterministic composition from the frozen grounding unit succeeds for
    // this ordinary canonical target, so authoring spends ZERO provider
    // calls — the old nested "generic 6-attempt ladder x2 route-level retry"
    // path (~12 live calls for one question) is gone entirely.
    assert.equal(callCounts.recoveryQuestion, 0, 'an ordinary groundable target must author its Recovery question deterministically, with zero provider calls')
    const reopened = await (await POST(makeRequest({ kind: 'repaso-recovery-open', sessionId: 'sess-live', artifactId: initial.artifactId }))).json()
    assert.equal(reopened.question, first.question)
    assert.equal(callCounts.recoveryQuestion, 0, 'frozen question reopen must make zero new authoring calls')
  })

  /* S */ await test('S — recovery answer is current-group authoritative, scores deterministically, advances, and is idempotent', async () => {
    const recoveryVerdicts = [
      { targetId: 't2', status: 'covered', evidence: 'student recovery evidence', demonstrated: 'student recovered concept', missingDetail: '' },
      { targetId: 't3', status: 'covered', evidence: 'student recovery evidence', demonstrated: 'student recovered concept', missingDetail: '' },
    ]
    const { artifactStore, callCounts } = installMocks({ coverageForText: { 'RECOVERY PASS': recoveryVerdicts } })
    const initial = await (await POST(makeRequest({ kind: 'repaso-initial', sessionId: 'sess-live', explanation: 'initial student text' }))).json()
    const first = await (await POST(makeRequest({ kind: 'repaso-recovery-open', sessionId: 'sess-live', artifactId: initial.artifactId }))).json()
    const jumped = await POST(makeRequest({ kind: 'repaso-recovery-answer', sessionId: 'sess-live', artifactId: initial.artifactId, groupId: 'future-group', attemptClientId: 'jump-1', answer: 'RECOVERY PASS' }))
    assert.equal(jumped.status, 409)
    const callsBefore = callCounts.analysisBatch
    const answered = await POST(makeRequest({ kind: 'repaso-recovery-answer', sessionId: 'sess-live', artifactId: initial.artifactId, groupId: first.groupId, attemptClientId: 'attempt-1', answer: 'RECOVERY PASS' }))
    assert.equal(answered.status, 200)
    const data = await answered.json()
    assert.equal(data.attempt.scoreBefore, initial.initialScore)
    assert.equal(data.attempt.letterBefore, computeRepasoLetterGrade(data.attempt.scoreBefore))
    assert.equal(data.attempt.letterAfter, computeRepasoLetterGrade(data.attempt.scoreAfter))
    assert.ok(data.attempt.requestedTargetIds.every((id: string) => id !== 't1'), 'covered target is protected')
    const saved = artifactStore.store.get(initial.artifactId) as RepasoArtifact
    assert.equal(saved.recoveryAttempts.length, 1)
    assert.equal(saved.scoreHistory.length, 2)
    assert.equal(saved.currentTargetStates.t2.recoveryAttemptCount, 1)
    assert.equal(saved.currentTargetStates.t1.recoveryAttemptCount, 0)
    const callsAfter = callCounts.analysisBatch
    const replay = await (await POST(makeRequest({ kind: 'repaso-recovery-answer', sessionId: 'sess-live', artifactId: initial.artifactId, groupId: first.groupId, attemptClientId: 'attempt-1', answer: 'DIFFERENT TEXT' }))).json()
    assert.equal(replay.idempotentReplay, true)
    assert.equal(callCounts.analysisBatch, callsAfter, 'duplicate attempt must make zero provider calls')
    assert.equal(artifactStore.saveCalls.length, 3, 'initial + question freeze + one attempt only')
    assert.ok(callCounts.analysisBatch > callsBefore)
  })

  /* T */ await test('T — incomplete recovery adjudication is 409 with zero mutation/persistence', async () => {
    const { artifactStore } = installMocks({ incompleteCoverage: true })
    // Create using complete mocks first, then switch only the provider behavior.
    const installed = installMocks()
    const initial = await (await POST(makeRequest({ kind: 'repaso-initial', sessionId: 'sess-live', explanation: 'initial' }))).json()
    const opened = await (await POST(makeRequest({ kind: 'repaso-recovery-open', sessionId: 'sess-live', artifactId: initial.artifactId }))).json()
    const store = installed.artifactStore
    const beforeSaves = store.saveCalls.length
    Object.assign(__routeDeps, { generateValidatedLegacyJson: async ({ telemetryContext }: any) => telemetryContext?.phase === 'analysis_batch' ? { targetCoverage: [] } : { question: 'Q' } })
    const response = await POST(makeRequest({ kind: 'repaso-recovery-answer', sessionId: 'sess-live', artifactId: initial.artifactId, groupId: opened.groupId, attemptClientId: 'incomplete-1', answer: 'answer' }))
    assert.equal(response.status, 409)
    assert.equal(store.saveCalls.length, beforeSaves)
    assert.equal((store.store.get(initial.artifactId) as RepasoArtifact).recoveryAttempts.length, 0)
    void artifactStore
  })

  /* U */ await test('U — FINAL PRODUCT FLOW: full recovery reaches real 100 mastered directly; student-only Paper 2, no Final Verification', async () => {
    const pass = MOCK_VERDICTS.map(v => ({ ...v, status: 'covered' as const, evidence: 'student evidence text', demonstrated: 'student demonstrated text', missingDetail: '' }))
    const { callCounts } = installMocks({ coverageForText: { 'RECOVER ALL': pass } })
    const initialText = 'EXACT ORIGINAL STUDENT ESSAY'
    const initial = await (await POST(makeRequest({ kind: 'repaso-initial', sessionId: 'sess-live', explanation: initialText }))).json()
    let opened = await (await POST(makeRequest({ kind: 'repaso-recovery-open', sessionId: 'sess-live', artifactId: initial.artifactId }))).json()
    let attempt = 0
    let finalState = opened
    while (opened.groupId) {
      const recovered = await (await POST(makeRequest({ kind: 'repaso-recovery-answer', sessionId: 'sess-live', artifactId: initial.artifactId, groupId: opened.groupId, attemptClientId: `all-${attempt++}`, answer: 'RECOVER ALL student-authored answer' }))).json()
      finalState = recovered
      if (recovered.masteryStatus === 'mastered') break
      opened = await (await POST(makeRequest({ kind: 'repaso-recovery-open', sessionId: 'sess-live', artifactId: initial.artifactId }))).json()
      finalState = opened
    }
    assert.equal(finalState.score, 100)
    assert.equal(finalState.masteryStatus, 'mastered', 'Recovery completion must reach mastered directly — no Final Verification gate')
    assert.equal(finalState.initialPaper.explanation, initialText)
    assert.ok(finalState.studentEvidencePaper.every((section: any) => section.text === initialText || section.text.includes('student-authored')))
    assert.ok(finalState.studentEvidencePaper.every((section: any) => /Explicación inicial|Recuperado en pregunta/.test(section.provenance)))

    // Final Verification is retired: a NEW verification set is never
    // generated, zero provider calls.
    const finalOpen = await (await POST(makeRequest({ kind: 'repaso-final-open', sessionId: 'sess-live', artifactId: initial.artifactId }))).json()
    assert.equal(callCounts.finalQuestion, 0, 'a NEW Final Verification set must never be generated in the final product flow')
    assert.equal(finalOpen.error, 'REPASO_FINAL_VERIFICATION_RETIRED')
  })

  /* V */ await test('V — FINAL PRODUCT FLOW: repaso-final-open never opens a NEW verification for a fully-covered artifact', async () => {
    const allCovered = MOCK_VERDICTS.map(v => ({ ...v, status: 'covered' as const, evidence: 'covered evidence', demonstrated: 'covered concept', missingDetail: '' }))
    const { callCounts } = installMocks({ verdicts: allCovered })
    const initial = await (await POST(makeRequest({ kind: 'repaso-initial', sessionId: 'sess-live', explanation: 'all covered initially' }))).json()
    assert.equal(initial.score, 100)
    assert.equal(initial.masteryStatus, 'mastered', 'full initial coverage must complete Repaso directly')
    const finalOpen = await (await POST(makeRequest({ kind: 'repaso-final-open', sessionId: 'sess-live', artifactId: initial.artifactId }))).json()
    assert.equal(finalOpen.error, 'REPASO_FINAL_VERIFICATION_RETIRED')
    assert.equal(callCounts.finalQuestion, 0)
  })

  /* ------------------------------------------------------------------ */
  /*  Summary                                                           */
  /* ------------------------------------------------------------------ */

  console.log(`\nTest results: ${passed} passed, ${failed} failed\n`)
  if (failures.length > 0) {
    console.error('Failed tests:', failures)
    process.exit(1)
  } else {
    console.log('All route contracts verified successfully.')
    process.exit(0)
  }
}

run()
