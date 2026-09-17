import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import {
  WorkerExamGradingStore,
  MemoryExamGradingStore,
  advanceExamGrading,
  gradingIdentity,
  type ExamGradingJob,
  type ExamGradingStore,
  type GradingRecord,
} from '../../lib/materialBrain/examGrading'
import {
  InMemoryExamGenerationStore,
  examGenerationIdentity,
  EXAM_MANIFEST_SCHEMA_VERSION,
  type ExamArtifact,
  type ExamGenerationManifest,
} from '../../lib/materialBrain/examGenerationStore'
import {
  EXAM_ENJOYER_AUTHORITY_TYPE,
  type ExamAssessmentCriterion,
} from '../../lib/materialBrain/examEnjoyerContext'
import { POST, __routeDeps } from '../../app/api/alai-studyal-exam/route'

async function testWorkerCasStrictAtomicContracts() {
  console.log('--- Test 1: Worker Strict Atomic CAS & Fail-Closed Policy ---')
  const originalFetch = globalThis.fetch
  const originalApi = process.env.STUDYAL_API_URL
  const d1Store = new Map<string, { payload: string; content_hash: string }>()
  let casCalls = 0
  let upsertCalls = 0

  try {
    process.env.STUDYAL_API_URL = 'https://studyal-worker.offline.test'

    // Phase 1: 404 route unavailable -> MUST fail closed with EXAM_GRADING_CAS_ENDPOINT_UNAVAILABLE
    let warningLogged = false
    const originalWarn = console.warn
    console.warn = (...args: any[]) => {
      const msg = args.join(' ')
      if (msg.includes('[EXAM_GRADING_DIAGNOSTIC]') && msg.includes('phase=grading_cas_failed') && msg.includes('EXAM_GRADING_CAS_ENDPOINT_UNAVAILABLE')) {
        warningLogged = true
      }
      originalWarn(...args)
    }

    globalThis.fetch = async (url: string | URL | Request) => {
      const urlStr = String(url)
      if (urlStr.includes('/material-results/exam-grading-cas')) {
        casCalls++
        return new Response(JSON.stringify({ ok: false, error: 'not_found' }), { status: 404 })
      }
      if (urlStr.includes('/material-results/upsert')) {
        upsertCalls++
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response('Not Found', { status: 404 })
    }

    const store = new WorkerExamGradingStore()
    const identity = 'test_identity_strict_' + Date.now()
    const initialJob: ExamGradingJob = {
      version: 1, identity, userId: 'user-nb', examId: 'exam-nb-30', answersHash: 'hash-answers-1',
      results: {}, work: [], attempts: {}, callsUsed: 0, callBudget: 10,
      status: 'completed', claim: null, diagnostics: [],
    }

    // Must fail closed on 404 and NEVER fall back to generic /upsert
    await assert.rejects(
      () => store.cas(identity, null, initialJob),
      /EXAM_GRADING_CAS_ENDPOINT_UNAVAILABLE/,
    )
    assert.equal(warningLogged, true, 'Diagnostic log must record EXAM_GRADING_CAS_ENDPOINT_UNAVAILABLE')
    assert.equal(upsertCalls, 0, 'Generic /upsert MUST NOT be called as a fallback')
    console.warn = originalWarn

    // Phase 2: Atomic CAS endpoint simulation matching deployed Worker D1 behavior
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url)
      if (urlStr.includes('/material-results/exam-grading-cas')) {
        casCalls++
        const body = JSON.parse(String(init?.body || '{}'))
        const existing = d1Store.get(body.id)
        if (body.expectedRevision === null) {
          if (existing) return new Response(JSON.stringify({ ok: true, applied: false }), { status: 200 })
          d1Store.set(body.id, { payload: JSON.stringify(body.payload), content_hash: body.revision })
          return new Response(JSON.stringify({ ok: true, applied: true }), { status: 200 })
        }
        if (!existing || existing.content_hash !== body.expectedRevision) {
          return new Response(JSON.stringify({ ok: true, applied: false }), { status: 200 })
        }
        d1Store.set(body.id, { payload: JSON.stringify(body.payload), content_hash: body.revision })
        return new Response(JSON.stringify({ ok: true, applied: true }), { status: 200 })
      }
      if (urlStr.includes('/material-results/by-material')) {
        const parsed = new URL(urlStr)
        const matId = parsed.searchParams.get('materialId') || ''
        const row = d1Store.get(matId) || null
        return new Response(JSON.stringify({ ok: true, result: row ? { id: matId, material_id: matId, payload: row.payload, content_hash: row.content_hash } : null }))
      }
      if (urlStr.includes('/material-results/upsert')) {
        upsertCalls++
        throw new Error('Generic /upsert must never be touched by WorkerExamGradingStore')
      }
      return new Response('Not Found', { status: 404 })
    }

    // 1. expected=null inserts revision 1
    const applied1 = await store.cas(identity, null, initialJob)
    assert.equal(applied1, true, 'First expected=null must succeed')

    const rec1 = await store.read(identity)
    assert.ok(rec1)
    const rev1 = rec1.revision

    // 2. second expected=null loses
    const appliedDupNull = await store.cas(identity, null, initialJob)
    assert.equal(appliedDupNull, false, 'Second expected=null must lose')

    // 3. expected=1 advances to revision 2
    const appliedAdv = await store.cas(identity, rev1, { ...initialJob, callsUsed: 1 })
    assert.equal(appliedAdv, true, 'Matching expected revision must advance')

    const rec2 = await store.read(identity)
    assert.ok(rec2)
    assert.notEqual(rec2.revision, rev1)
    const rev2 = rec2.revision

    // 4. simultaneous competing requests produce exactly one winner
    const [wA, wB] = await Promise.all([
      store.cas(identity, rev2, { ...initialJob, callsUsed: 2, diagnostics: ['winner-A'] }),
      store.cas(identity, rev2, { ...initialJob, callsUsed: 2, diagnostics: ['winner-B'] }),
    ])
    assert.deepEqual([wA, wB].sort(), [false, true], 'Exactly one concurrent writer must win')

    // 5. stale expected=rev2 after advancement loses
    const appliedStale = await store.cas(identity, rev2, { ...initialJob, callsUsed: 3 })
    assert.equal(appliedStale, false, 'Stale expected revision must lose')

    // 6. stored payload corresponds to the winner
    const rec3 = await store.read(identity)
    assert.ok(rec3)
    assert.equal(rec3.job.callsUsed, 2)
    assert.ok(['winner-A', 'winner-B'].includes(rec3.job.diagnostics[0]))

    // 7. Verify NO generic /upsert fallback was involved
    assert.equal(upsertCalls, 0, 'Generic /upsert calls count must remain exactly 0')

    // 8. 500 error on CAS fails closed with EXAM_GRADING_PERSISTENCE_FAILED
    globalThis.fetch = async (url: string | URL | Request) => {
      if (String(url).includes('/material-results/exam-grading-cas')) {
        return new Response('Internal Server Error', { status: 500 })
      }
      return new Response('Not Found', { status: 404 })
    }
    await assert.rejects(
      () => store.cas(identity, rec3.revision, { ...initialJob, callsUsed: 4 }),
      /EXAM_GRADING_PERSISTENCE_FAILED/,
    )
  } finally {
    globalThis.fetch = originalFetch
    if (originalApi === undefined) delete process.env.STUDYAL_API_URL
    else process.env.STUDYAL_API_URL = originalApi
  }
  console.log('Worker Strict Atomic CAS & Fail-Closed test PASS')
}

async function test23Question24CriteriaGradingLifecycle() {
  console.log('--- Test 2: 23 Questions, 24 Criteria, 21 Answered, 2 Blank Lifecycle ---')

  const sessionId = 'session-bohr-30'
  const examId = 'exam-bohr-30'
  const userId = 'student-1'
  const fingerprint = 'fp-bohr'

  // Build 23 questions with 24 assessment criteria:
  // 15 answered closed questions (0..14) -> 15 criteria
  // 5 answered semantic questions (15..19) -> 5 criteria
  // 1 blank closed question (20) -> 1 criterion
  // 1 blank semantic question (21) -> 1 criterion
  // 1 answered semantic question (22) with 2 criteria -> 2 criteria
  // Total: 23 questions, 24 criteria, 21 answered, 2 blank!

  const questions: any[] = []
  const slots: any[] = []
  const targetUniverse: any[] = []

  let criterionCounter = 0
  for (let i = 0; i < 23; i++) {
    const isBlank = i === 20 || i === 21
    const isClosed = i < 15 || i === 20
    const qId = `q-${i}`
    const slotId = `slot-${i}`

    if (i < 22) {
      criterionCounter++
      const cId = `crit-${criterionCounter}`
      const tId = `target-${criterionCounter}`
      targetUniverse.push({ targetId: tId, label: `Objetivo ${criterionCounter}`, pages: [1], canonicalRequirement: `Req ${cId}` })
      const criterion: ExamAssessmentCriterion = {
        criterionId: cId, targetIds: [tId], operation: isClosed ? 'recall' : 'explain',
        canonicalCriterion: `Req ${cId}`,
        gradingMode: isClosed ? 'deterministic' : 'semantic',
        points: 1, skill: isClosed ? 'retrieval' : 'comprehension', label: `Objetivo ${criterionCounter}`,
        sourceItemId: `src-${i}`, materialId: 'mat-bohr', pages: [1],
      }
      slots.push({ id: slotId, primaryTargetId: tId, assessmentCriteria: [criterion], sourceItemIds: [`src-${i}`], frozenSources: [{ sourceItemId: `src-${i}`, content: `Texto fuente ${i}` }] })
      questions.push({
        id: qId, slotId, type: isClosed ? (i % 2 === 0 ? 'multiple_choice' : 'true_false') : 'short_answer',
        prompt: `Pregunta ${i}`, points: 1, skill: isClosed ? 'retrieval' : 'comprehension',
        section: 'Física Cuántica', sourceMaterial: 'mat-bohr', sourcePages: [1],
        assessmentCriteria: [criterion],
        ...(isClosed ? (i % 2 === 0 ? { options: ['A', 'B', 'C', 'D'], correctAnswer: 1 } : { correctAnswer: true }) : {}),
      })
    } else {
      // Question 22 has 2 criteria
      criterionCounter++
      const cId1 = `crit-${criterionCounter}`
      const tId1 = `target-${criterionCounter}`
      targetUniverse.push({ targetId: tId1, label: `Objetivo ${criterionCounter}`, pages: [1], canonicalRequirement: `Req ${cId1}` })
      const crit1: ExamAssessmentCriterion = {
        criterionId: cId1, targetIds: [tId1], operation: 'explain',
        canonicalCriterion: `Req ${cId1}`, gradingMode: 'semantic', points: 1,
        skill: 'analysis', label: `Objetivo ${criterionCounter}`,
        sourceItemId: `src-${i}`, materialId: 'mat-bohr', pages: [1],
      }
      criterionCounter++
      const cId2 = `crit-${criterionCounter}`
      const tId2 = `target-${criterionCounter}`
      targetUniverse.push({ targetId: tId2, label: `Objetivo ${criterionCounter}`, pages: [1], canonicalRequirement: `Req ${cId2}` })
      const crit2: ExamAssessmentCriterion = {
        criterionId: cId2, targetIds: [tId2], operation: 'analyze',
        canonicalCriterion: `Req ${cId2}`, gradingMode: 'semantic', points: 1,
        skill: 'analysis', label: `Objetivo ${criterionCounter}`,
        sourceItemId: `src-${i}`, materialId: 'mat-bohr', pages: [1],
      }
      slots.push({ id: slotId, primaryTargetId: tId1, assessmentCriteria: [crit1, crit2], sourceItemIds: [`src-${i}`], frozenSources: [{ sourceItemId: `src-${i}`, content: `Texto fuente ${i}` }] })
      questions.push({
        id: qId, slotId, type: 'short_answer', prompt: `Pregunta ${i} compuesta`,
        points: 2, skill: 'analysis', section: 'Física Cuántica', sourceMaterial: 'mat-bohr',
        sourcePages: [1], assessmentCriteria: [crit1, crit2],
      })
    }
  }

  // Also add an unassessed target to targetUniverse to verify zero unassessed target contamination
  targetUniverse.push({ targetId: 'target-unassessed', label: 'Objetivo No Evaluado', pages: [2], canonicalRequirement: 'Req Unassessed' })

  assert.equal(questions.length, 23, 'Must have exactly 23 questions')
  assert.equal(criterionCounter, 24, 'Must have exactly 24 criteria')

  // Answers array: 21 answered, 2 blank (indices 20 and 21)
  const answers: any[] = []
  const confidences: string[] = []
  for (let i = 0; i < 23; i++) {
    if (i === 20) {
      answers.push(null) // blank closed question
      confidences.push('low')
    } else if (i === 21) {
      answers.push('') // blank semantic question
      confidences.push('low')
    } else if (i < 15) {
      // closed questions: answered correctly
      answers.push(i % 2 === 0 ? 1 : true)
      confidences.push('high')
    } else {
      // open/semantic questions: answered with student explanation
      answers.push(`Respuesta fundamentada del estudiante para la pregunta ${i}`)
      confidences.push('high')
    }
  }

  const now = new Date().toISOString()
  const identity = examGenerationIdentity(sessionId, fingerprint, examId)
  const manifest: ExamGenerationManifest = {
    schemaVersion: EXAM_MANIFEST_SCHEMA_VERSION,
    identity, sessionId, fingerprint, examId, status: 'ready', totalSlots: 23,
    readyCount: 23,
    slots: Object.fromEntries(slots.map(s => [s.id, { status: 'ready', attempts: 1 }])),
    providerAttemptsBudget: 46, providerAttemptsUsed: 1,
    createdAt: now, updatedAt: now,
    blueprint: {
      authorityType: EXAM_ENJOYER_AUTHORITY_TYPE,
      fingerprint, slots, targetUniverse,
      coverage: { coveragePercent: 100 },
      materialLanguage: 'es',
    } as any,
  }
  const artifact: ExamArtifact<any> = {
    examId, fingerprint,
    meta: { identity, status: 'ready', totalSlots: 23, readyCount: 23, generatedAt: now },
    questions,
  }

  const examStore = new InMemoryExamGenerationStore<any>()
  await examStore.saveManifest(identity, manifest)
  await examStore.saveArtifact(identity, artifact)

  const gradingStore = new MemoryExamGradingStore()
  let providerCalls = 0
  let criteriaEvaluatedByProvider: string[] = []

  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: userId } }),
    getAuthoritativeFreeSession: async () => ({
      id: sessionId, userId, processMode: 'free',
      sourceSelection: { fingerprint, materialIds: ['mat-bohr'], selectedPages: { 'mat-bohr': [1] } },
    }),
    getMaterial: async () => ({ id: 'mat-bohr', nombre: 'Niels Bohr' }),
    gradingStore,
    examStore,
    generateValidatedLegacyJson: async ({ prompt, beforeProviderAttempt, telemetryContext }: any) => {
      if (telemetryContext?.phase === 'semantic_grade') {
        await beforeProviderAttempt?.()
        providerCalls++
        const batch = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1)) as Array<{ criterion: { criterionId: string } }>
        // Verify batch size does not exceed limit (6)
        assert.ok(batch.length <= 6, 'Batch size must not exceed 6')
        for (const item of batch) {
          criteriaEvaluatedByProvider.push(item.criterion.criterionId)
        }
        return {
          judgments: batch.map(item => ({
            criterionId: item.criterion.criterionId,
            scorePercent: 100,
            status: 'correct',
            feedback: 'Excelente desarrollo analítico.',
          })),
        }
      }
      throw new Error('Unexpected generator call in evaluate test')
    },
  })

  async function post(body: unknown) {
    const response = await POST(new NextRequest('http://localhost/api/alai-studyal-exam', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
    return { status: response.status, data: await response.json() }
  }

  // --- Step A: First submit request ---
  const firstRes = await post({ mode: 'evaluate', sessionId, examId, answers, confidences })

  // 1. First grading HTTP request processes at most one semantic batch:
  // There are 7 answered semantic criteria (q15-19: 5 criteria; q22: 2 criteria).
  // Batch 1 processes 6 criteria, leaving 1 pending.
  assert.equal(firstRes.status, 409, 'First request should return 409 retryable when semantic criteria remain')
  assert.equal(firstRes.data.error, 'SEMANTIC_GRADING_RETRYABLE')
  assert.equal(firstRes.data.retryable, true)
  assert.equal(firstRes.data.partialEvaluation.gradingStatus, 'grading_incomplete')
  assert.equal(providerCalls, 1, 'First request must make at most 1 provider call')
  assert.equal(criteriaEvaluatedByProvider.length, 6, 'Batch 1 must evaluate exactly 6 semantic criteria')

  // 2. Closed criteria grade deterministically without provider:
  // 15 answered closed criteria + 1 blank closed (q20) + 1 blank semantic (q21) = 17 deterministic results!
  // Plus 6 from batch 1 = 23 accepted criteria in store.
  const gId = gradingIdentity(userId, identity)
  const jobAfterBatch1 = (await gradingStore.read(gId))!.job
  assert.equal(jobAfterBatch1.results['crit-21'].status, 'unanswered', 'Blank closed question 20 must be graded as unanswered deterministically')
  assert.equal(jobAfterBatch1.results['crit-21'].scorePercent, 0)
  assert.equal(jobAfterBatch1.results['crit-21'].gradedBy, 'deterministic')
  assert.equal(jobAfterBatch1.results['crit-22'].status, 'unanswered', 'Blank semantic question 21 must be graded as unanswered deterministically')
  assert.equal(jobAfterBatch1.results['crit-22'].scorePercent, 0)
  assert.equal(jobAfterBatch1.results['crit-22'].gradedBy, 'deterministic')

  // 3. Accepted results persist independently:
  assert.equal(Object.keys(jobAfterBatch1.results).length, 23, '17 deterministic + 6 batch1 accepted = 23')
  const pendingAfterBatch1 = jobAfterBatch1.work.filter(item => !jobAfterBatch1.results[item.criterion.criterionId])
  assert.equal(pendingAfterBatch1.length, 1, 'Exactly 1 criterion must remain unresolved')

  // --- Step B: Retry request with SAME answers ---
  // Retry uses same submissionId/identity and resumes unresolved criteria only
  const secondRes = await post({ mode: 'evaluate', sessionId, examId, answers, confidences })
  assert.equal(secondRes.status, 200, 'Second request completes the remaining 1 criterion and returns 200')
  assert.equal(secondRes.data.success, true)
  assert.equal(providerCalls, 2, 'Total provider calls should now be 2 (1 for batch 1, 1 for batch 2)')
  assert.equal(criteriaEvaluatedByProvider.length, 7, 'Total semantic criteria evaluated by provider should be 7')

  // Verify the 7th criterion was the ONLY one sent in batch 2 (no re-evaluation of batch 1)
  const batch2Evaluated = criteriaEvaluatedByProvider.slice(6)
  assert.equal(batch2Evaluated.length, 1, 'Batch 2 must contain only the 1 unresolved criterion')
  assert.equal(batch2Evaluated[0], pendingAfterBatch1[0].criterion.criterionId)

  // --- Step C: Verify evaluation structure and target evidence ---
  const evalResult = secondRes.data.evaluation
  assert.ok(evalResult, 'Evaluation must be present')
  assert.equal(evalResult.answeredCount, 21, 'Must report 21 answered')
  assert.equal(evalResult.skippedCount, 2, 'Must report 2 skipped')
  assert.equal(evalResult.criterionResults.length, 24, 'Must have 24 criterionResults')

  // Zero unassessed target contamination:
  const unassessedTarget = evalResult.targetEvidence.find((t: any) => t.targetId === 'target-unassessed')
  assert.ok(unassessedTarget, 'Unassessed target must be present in targetEvidence')
  assert.equal(unassessedTarget.status, 'not_assessed', 'Unassessed target must remain not_assessed')
  assert.equal(unassessedTarget.scorePercent, null, 'Unassessed target must have null scorePercent')
  assert.equal(unassessedTarget.sufficientEvidence, false)

  // --- Step D: Completed reopen / duplicate submit uses ZERO provider calls ---
  const callsBeforeReopen = providerCalls
  const thirdRes = await post({ mode: 'evaluate', sessionId, examId, answers, confidences })
  assert.equal(thirdRes.status, 200)
  assert.equal(providerCalls, callsBeforeReopen, 'Completed reopen must make 0 provider calls')

  // --- Step E: Submission immutability ---
  // A submit with different answers for the same exam identity must be rejected
  const tamperedAnswers = [...answers]
  tamperedAnswers[0] = 0 // change answer 0
  const tamperedRes = await post({ mode: 'evaluate', sessionId, examId, answers: tamperedAnswers, confidences })
  assert.equal(tamperedRes.status, 409, 'Submitting modified answers must reject with 409 EXAM_SUBMISSION_IMMUTABLE')
  assert.equal(tamperedRes.data.error, 'EXAM_SUBMISSION_IMMUTABLE')

  // --- Step F: Simulated CAS failure returns resumable state without corrupting submission ---
  const freshSessionId = 'session-fresh-' + Date.now()
  const freshExamId = 'exam-fresh-' + Date.now()
  const freshIdentity = examGenerationIdentity(freshSessionId, fingerprint, freshExamId)
  const freshManifest = { ...manifest, identity: freshIdentity, sessionId: freshSessionId, examId: freshExamId }
  const freshArtifact = { ...artifact, meta: { ...artifact.meta, identity: freshIdentity } }
  await examStore.saveManifest(freshIdentity, freshManifest)
  await examStore.saveArtifact(freshIdentity, freshArtifact)

  // Test failure during advanceExamGrading
  let casFailStore: ExamGradingStore = {
    async read(id: string) { return null },
    async cas(id: string, expected: string | null, job: ExamGradingJob) {
      throw new Error('SIMULATED_CAS_DISK_FAILURE')
    },
  }

  const initialTestJob: ExamGradingJob = {
    version: 1, identity: freshIdentity, userId, examId: freshExamId, answersHash: 'hash-test',
    results: {}, work: [{ criterion: questions[15].assessmentCriteria[0], questionId: 'q-15', prompt: 'P15', answer: 'Ans' }],
    attempts: {}, callsUsed: 0, callBudget: 10, status: 'pending', claim: null, diagnostics: [],
  }

  // When CAS throws, advanceExamGrading throws without corrupting submission
  await assert.rejects(
    () => advanceExamGrading(casFailStore, initialTestJob, async () => ({ judgments: [] })),
    /SIMULATED_CAS_DISK_FAILURE/,
  )
  // Work criterion must NOT be marked zero or accepted
  assert.equal(initialTestJob.results[questions[15].assessmentCriteria[0].criterionId], undefined, 'Unresolved criterion must NOT become zero on CAS failure')

  // --- Step G: Provider transport failure does NOT score unresolved criteria as 0 ---
  const memStore = new MemoryExamGradingStore()
  const jobBeforeTransportFailure: ExamGradingJob = {
    version: 1, identity: 'test-transport-fail', userId, examId: freshExamId, answersHash: 'hash-test-2',
    results: {}, work: [{ criterion: questions[15].assessmentCriteria[0], questionId: 'q-15', prompt: 'P15', answer: 'Ans' }],
    attempts: {}, callsUsed: 0, callBudget: 10, status: 'pending', claim: null, diagnostics: [],
  }

  const advancedAfterProviderError = await advanceExamGrading(memStore, jobBeforeTransportFailure, async () => {
    throw new Error('503 Service Unavailable')
  })
  assert.equal(advancedAfterProviderError.status, 'grading_incomplete')
  assert.equal(advancedAfterProviderError.diagnostics[0], 'provider_transport_failure')
  assert.equal(advancedAfterProviderError.results[questions[15].assessmentCriteria[0].criterionId], undefined, 'Unresolved criterion must remain unresolved, never scored 0')

  console.log('23-Question / 24-Criteria Grading Lifecycle test PASS')
}

async function main() {
  await testWorkerCasStrictAtomicContracts()
  await test23Question24CriteriaGradingLifecycle()
  console.log('\nEXAM_GRADING_PERSISTENCE_CONTRACTS_ALL_PASS')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
