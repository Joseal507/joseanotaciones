import assert from 'node:assert/strict'

process.env.STUDYAL_API_URL = 'https://quiz-worker.offline.test'

type StoredRow = {
  id: string
  material_id: string
  enfoque: string
  result_type: string
  payload: unknown
  content_hash: string
  created_at: string
}

async function main() {
  const [{ NextRequest }, { buildSourceSelectionSnapshot }, route, enjoyer, coverage] = await Promise.all([
    import('next/server'),
    import('../../lib/adaptive/sourceSelection'),
    import('../../app/api/alai-studyal-quizzes/route'),
    import('../../lib/materialBrain/quiz/enjoyer'),
    import('../../lib/materialBrain/quiz/progressiveCoverage'),
  ])

  const { POST, __routeDeps } = route
  const { WorkerEnjoyerQuizStore, startEnjoyerQuizGeneration } = enjoyer
  const { WorkerQuizCompletionStore } = coverage
  const selection = buildSourceSelectionSnapshot(['culture'], { culture: [1] })
  const payload = {
    sourceSelectionFingerprint: selection.fingerprint,
    enjoyerAcademicVersion: 2,
    topicsIndex: [{ id: 'culture-topic', title: 'Culture', order: 0 }],
    globalOrderedAnalysis: Array.from({ length: 12 }, (_, index) => ({
      id: `culture-target-${index}`,
      name: `Culture concept ${index}`,
      summary: `Culture concept ${index} has authoritative source evidence ${index}.`,
      kind: 'fact', importance: 100 - index, materialId: 'culture', pages: [1],
      globalOrder: index, topicId: 'culture-topic',
      sourceSpans: [{ page: 1, quote: `Culture concept ${index} has authoritative source evidence ${index}.` }],
    })),
  }

  const rows = new Map<string, StoredRow>()
  let workerRoutesAvailable = false
  let providerCalls = 0
  let sawCoverageEndpoint = 0
  let sawCasEndpoint = 0
  const originalFetch = globalThis.fetch
  const originalDeps = { ...__routeDeps }

  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === '/material-results/by-scope') {
      sawCoverageEndpoint++
      if (!workerRoutesAvailable) return response({ ok: false, error: 'not_found' }, 404)
      const materialId = url.searchParams.get('materialId')
      const enfoque = url.searchParams.get('enfoque')
      const resultType = url.searchParams.get('resultType')
      return response({ ok: true, results: [...rows.values()].filter(row => row.material_id === materialId
        && row.enfoque === enfoque && row.result_type === resultType) })
    }
    if (url.pathname === '/material-results/by-material') {
      const materialId = url.searchParams.get('materialId') || ''
      const row = rows.get(materialId)
      return response({ ok: true, result: row || null })
    }
    if (url.pathname === '/material-results/quiz-generation-cas') {
      sawCasEndpoint++
      if (!workerRoutesAvailable) return response({ ok: false, error: 'not_found' }, 404)
      const body = JSON.parse(String(init?.body || '{}'))
      const artifactId = `enjoyer_quiz:${body.identity}`
      const manifestId = `enjoyer_quiz_manifest:${body.identity}`
      const artifact = rows.get(artifactId)
      const manifest = rows.get(manifestId)
      const expectedMatches = (artifact?.content_hash || null) === body.expectedArtifactRevision
        && (manifest?.content_hash || null) === body.expectedManifestRevision
      const currentReady = (artifact?.payload as any)?.meta?.status === 'ready'
        || (manifest?.payload as any)?.status === 'ready'
      const scopeMatches = (!artifact && !manifest)
        || (JSON.stringify((artifact?.payload as any)?.scopePlan ?? null) === JSON.stringify(body.artifact?.scopePlan ?? null)
          && JSON.stringify((manifest?.payload as any)?.scopePlan ?? null) === JSON.stringify(body.manifest?.scopePlan ?? null))
      if (!expectedMatches || currentReady || !scopeMatches) return response({ ok: true, applied: false })
      const createdAt = new Date().toISOString()
      rows.set(artifactId, { id: artifactId, material_id: artifactId, enfoque: 'mixto', result_type: 'quiz',
        payload: structuredClone(body.artifact), content_hash: body.revision, created_at: createdAt })
      rows.set(manifestId, { id: manifestId, material_id: manifestId, enfoque: 'mixto', result_type: 'quiz',
        payload: structuredClone(body.manifest), content_hash: body.revision, created_at: createdAt })
      return response({ ok: true, applied: true })
    }
    throw new Error(`unexpected offline request: ${url.pathname}`)
  }) as typeof fetch

  const provider: enjoyer.EnjoyerQuizProvider = async request => {
    providerCalls++
    return { questions: (request.requiredSlots || []).map(slot => {
      const target = request.universe.targets.find(item => item.id === slot.primaryTargetId)!
      return { slotId: slot.slotId, type: slot.type,
        question: `Which statement identifies ${target.title} in the material?`,
        options: [target.content, `A different unsupported statement for ${slot.slotId}`],
        correctAnswer: 0, explanation: target.content }
    }) }
  }

  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'culture-user' } }),
    getAuthoritativeFreeSession: async () => ({ sourceSelection: selection }),
    getMaterial: async () => ({ id: 'culture' }),
    lookupEnjoyer: async () => payload,
    createStore: () => new WorkerEnjoyerQuizStore(),
    createCompletionStore: () => new WorkerQuizCompletionStore(),
    startGeneration: (params: Parameters<typeof startEnjoyerQuizGeneration>[0]) =>
      startEnjoyerQuizGeneration({ ...params, provider }),
  })

  const request = (body: object) => POST(new NextRequest('http://localhost/api/alai-studyal-quizzes', {
    method: 'POST', body: JSON.stringify({ sessionId: 'culture-session',
      sourceSelectionFingerprint: selection.fingerprint,
      config: { questionCount: 10, difficulty: 'medium', questionTypes: ['multiple_choice'] }, ...body }),
  }))

  try {
    // Exact live deployment-skew reproduction: the first new persistence
    // endpoint is absent, so coverage and generation stop before CAS/provider.
    const unavailableCoverage = await request({ mode: 'coverage' })
    assert.equal(unavailableCoverage.status, 503)
    assert.equal((await unavailableCoverage.json()).error, 'QUIZ_COVERAGE_STORE_UNAVAILABLE')
    const unavailableStart = await request({ generationId: 'culture-generation' })
    assert.equal(unavailableStart.status, 503)
    assert.equal((await unavailableStart.json()).error, 'QUIZ_COVERAGE_STORE_UNAVAILABLE')
    assert.equal(providerCalls, 0)
    assert.equal(sawCasEndpoint, 0, 'completion-history lookup fails before first-generation CAS')
    console.log('PASS 1: reproduced live not_found at /material-results/by-scope with zero provider/CAS calls')

    workerRoutesAvailable = true

    // Empty completion history is valid and returns authoritative zero coverage.
    const preview = await request({ mode: 'coverage' })
    const previewBody = await preview.json()
    assert.equal(preview.status, 200)
    assert.equal(previewBody.coverage.coveredTargetCount, 0)
    assert.equal(previewBody.coverage.totalAssessableTargets, 12)
    assert.equal(previewBody.providerCalls, 0)
    console.log('PASS 2: existing Enjoyer plus empty Quiz history returns 200 and 0/12 coverage')

    // Null revisions create the initial artifact/manifest pair atomically.
    const started = await request({ generationId: 'culture-generation' })
    const startedBody = await started.json()
    assert.equal(started.status, 200, JSON.stringify(startedBody))
    assert.equal(startedBody.artifact.generationId, 'culture-generation')
    assert.equal(rows.has(`enjoyer_quiz:${startedBody.artifactIdentity}`), true)
    assert.equal(rows.has(`enjoyer_quiz_manifest:${startedBody.artifactIdentity}`), true)
    assert.ok(sawCasEndpoint >= 1)
    console.log('PASS 3: first Quiz initializes an absent artifact/manifest pair through null-revision CAS')

    const callsAfterStart = providerCalls
    const restored = await request({ mode: 'lookup', generationId: 'culture-generation' })
    const restoredBody = await restored.json()
    assert.equal(restored.status, 200)
    assert.equal(restoredBody.artifactIdentity, startedBody.artifactIdentity)
    assert.deepEqual(restoredBody.quiz, startedBody.quiz)
    assert.equal(providerCalls, callsAfterStart)
    console.log('PASS 4: second read restores the same initialized state with zero new provider calls')

    // The same production store/CAS endpoint still permits only one stale-revision writer.
    const storeA = new WorkerEnjoyerQuizStore()
    const storeB = new WorkerEnjoyerQuizStore()
    const state = await storeA.loadState(startedBody.artifactIdentity)
    assert.ok(state.artifact && state.manifest)
    const candidateA = structuredClone(state.manifest!); candidateA.updatedAt = '2030-01-01T00:00:00.000Z'
    const candidateB = structuredClone(state.manifest!); candidateB.updatedAt = '2031-01-01T00:00:00.000Z'
    // Ready rows are immutable by design. Use a separate absent identity to
    // prove create arbitration, then a generating revision for stale updates.
    const raceIdentity = 'a'.repeat(64)
    const raceArtifact = structuredClone(state.artifact!); raceArtifact.meta.status = 'generating'; raceArtifact.meta.generationId = 'race'
    const raceManifest = structuredClone(state.manifest!); raceManifest.identity = raceIdentity
    raceManifest.generationId = 'race'; raceManifest.status = 'generating'
    const [createdA, createdB] = await Promise.all([
      storeA.compareAndSwapState(raceIdentity, { artifactRevision: null, manifestRevision: null }, raceArtifact, raceManifest),
      storeB.compareAndSwapState(raceIdentity, { artifactRevision: null, manifestRevision: null }, raceArtifact, raceManifest),
    ])
    assert.equal([createdA.applied, createdB.applied].filter(Boolean).length, 1)
    const raceState = await storeA.loadState(raceIdentity)
    const expected = { artifactRevision: raceState.artifactRevision, manifestRevision: raceState.manifestRevision }
    const raceCandidateA = structuredClone(raceState.manifest!); raceCandidateA.updatedAt = candidateA.updatedAt
    const raceCandidateB = structuredClone(raceState.manifest!); raceCandidateB.updatedAt = candidateB.updatedAt
    const [updatedA, updatedB] = await Promise.all([
      storeA.compareAndSwapState(raceIdentity, expected, raceState.artifact!, raceCandidateA),
      storeB.compareAndSwapState(raceIdentity, expected, raceState.artifact!, raceCandidateB),
    ])
    assert.equal([updatedA.applied, updatedB.applied].filter(Boolean).length, 1)
    console.log('PASS 5: CAS remains single-winner after absent-state initialization')

    const previousLookup = __routeDeps.lookupEnjoyer
    __routeDeps.lookupEnjoyer = async () => null
    const missingEnjoyer = await request({ mode: 'coverage' })
    assert.equal(missingEnjoyer.status, 409)
    assert.equal((await missingEnjoyer.json()).error, 'ENJOYER_NOT_READY')
    __routeDeps.lookupEnjoyer = previousLookup
    assert.equal(providerCalls, callsAfterStart)
    console.log('PASS 6: missing Enjoyer is distinct from empty Quiz history and makes zero provider calls')

    assert.ok(sawCoverageEndpoint >= 4)
    console.log('quiz-live-not-found-contracts: 6 PASS; provider=mock; live D1 mutations=0')
  } finally {
    globalThis.fetch = originalFetch
    Object.assign(__routeDeps, originalDeps)
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
