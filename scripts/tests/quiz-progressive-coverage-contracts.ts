import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  advanceEnjoyerQuizGeneration,
  buildEnjoyerAssessmentUniverse,
  normalizeEnjoyerQuizConfig,
  startEnjoyerQuizGeneration,
  type EnjoyerQuizArtifact,
  type EnjoyerQuizGenerationManifest,
  type EnjoyerQuizProvider,
  type EnjoyerQuizStore,
} from '../../lib/materialBrain/quiz/enjoyer'
import {
  buildQuizCompletionResult,
  composeProgressiveQuizScope,
  deriveQuizProgressiveCoverage,
  quizCoverageScopeFingerprint,
  quizUniverseFingerprint,
  serializePublicQuizCoverage,
  type QuizCompletionResult,
  type QuizCompletionStore,
} from '../../lib/materialBrain/quiz/progressiveCoverage'
import { POST, __routeDeps } from '../../app/api/alai-studyal-quizzes/route'

const selection = buildSourceSelectionSnapshot(['m'], { m: [1] })

function fixturePayload(count: number, fingerprint = selection.fingerprint) {
  return {
    sourceSelectionFingerprint: fingerprint,
    enjoyerAcademicVersion: 2,
    topicsIndex: Array.from({ length: Math.min(8, Math.max(1, Math.ceil(count / 10))) }, (_, index) => ({
      id: `topic-${index}`, title: `Topic ${index}`, order: index,
    })),
    globalOrderedAnalysis: Array.from({ length: count }, (_, index) => ({
      id: `target-${index}`,
      name: `Concept ${index}`,
      summary: `Concept ${index} is the authoritative supported statement ${index}.`,
      kind: 'fact',
      importance: 100 - (index % 7),
      materialId: 'm', pages: [1], globalOrder: index,
      topicId: `topic-${index % Math.min(8, Math.max(1, Math.ceil(count / 10)))}`,
      sourceSpans: [{ page: 1, quote: `Concept ${index} is the authoritative supported statement ${index}.` }],
    })),
  }
}

class ArtifactStore implements EnjoyerQuizStore {
  artifact: EnjoyerQuizArtifact | null = null
  manifest: EnjoyerQuizGenerationManifest | null = null
  async get() { return this.artifact && structuredClone(this.artifact) }
  async getManifest() { return this.manifest && structuredClone(this.manifest) }
  async save(_identity: string, artifact: EnjoyerQuizArtifact) { this.artifact = structuredClone(artifact) }
  async saveManifest(_identity: string, manifest: EnjoyerQuizGenerationManifest) { this.manifest = structuredClone(manifest) }
}

class CompletionStore implements QuizCompletionStore {
  private rows = new Map<string, QuizCompletionResult>()
  writes = 0
  async list(scope: string) {
    return [...this.rows.values()].filter(result => result.scopeFingerprint === scope).map(result => structuredClone(result))
  }
  async insert(result: QuizCompletionResult) {
    const key = `${result.scopeFingerprint}:${result.artifactIdentity}`
    const current = this.rows.get(key)
    if (current) return { applied: false, result: structuredClone(current) }
    this.rows.set(key, structuredClone(result)); this.writes++
    return { applied: true, result: structuredClone(result) }
  }
}

function completionFor(universe: ReturnType<typeof buildEnjoyerAssessmentUniverse>, userId: string,
  artifactIdentity: string, targets: string[], outcomes: Array<'correct' | 'partial' | 'incorrect' | 'unresolved'> = []) {
  const completedAt = new Date(1_700_000_000_000 + Number(artifactIdentity.replace(/\D/g, '') || 0) * 1000).toISOString()
  return {
    schemaVersion: 'quiz-completion-1' as const,
    coverageContractVersion: 1,
    scopeFingerprint: quizCoverageScopeFingerprint(userId, universe),
    sourceSelectionFingerprint: universe.fingerprint,
    universeFingerprint: quizUniverseFingerprint(universe),
    artifactIdentity,
    generationId: artifactIdentity,
    submissionHash: artifactIdentity.padEnd(64, '0').slice(0, 64),
    completedAt,
    evidence: targets.map((targetId, index) => ({
      questionId: `${artifactIdentity}:q:${index}`, targetId, questionType: 'multiple_choice' as const,
      answered: true as const,
      score: outcomes[index] === 'unresolved' ? null : outcomes[index] === 'incorrect' ? 0
        : outcomes[index] === 'partial' ? 50 : 100,
      outcome: outcomes[index] || 'correct',
    })),
  }
}

const mcqAuthor: EnjoyerQuizProvider = async request => ({
  questions: (request.requiredSlots || []).map(slot => {
    const target = request.universe.targets.find(candidate => candidate.id === slot.primaryTargetId)!
    return {
      slotId: slot.slotId, type: slot.type,
      question: `Which statement identifies ${target.title} for slot ${slot.slotId}?`,
      explanation: target.content,
      options: [target.title, 'Unsupported alternative'], correctAnswer: 0,
    }
  }),
})

let passed = 0
async function test(name: string, run: () => void | Promise<void>) {
  await run(); passed++; console.log(`PASS ${passed}: ${name}`)
}

async function main() {
  const savedFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN') }
  const routeOriginal = { ...__routeDeps }
  try {
    const universe15 = buildEnjoyerAssessmentUniverse(fixturePayload(15), selection)
    const coverage15 = deriveQuizProgressiveCoverage(universe15, 'user', [])

    // A & C. Small Material Semantics (15 targets / request 100 -> exactly 100 questions via practice reuse)
    await test('15 targets / request 10 selects ten distinct first-pass targets', () => {
      const config = normalizeEnjoyerQuizConfig({ questionCount: 10, difficulty: 'medium', questionTypes: ['multiple_choice'] })
      const plan = composeProgressiveQuizScope({ universe: universe15, coverage: coverage15, config, generationId: 'g15-10' })
      assert.equal(plan.slots.length, 10)
      assert.equal(new Set(plan.slots.map(slot => slot.primaryTargetId)).size, 10)
      assert.ok(plan.slots.every(slot => slot.phase === 'first_pass'))
    })

    await test('15 targets / request 100 generates EXACTLY 100 slots via practice variants with distinct coverage = 15', () => {
      const config = normalizeEnjoyerQuizConfig({ questionCount: 100, difficulty: 'medium', questionTypes: ['multiple_choice'] })
      const plan = composeProgressiveQuizScope({ universe: universe15, coverage: coverage15, config, generationId: 'g15-100' })
      assert.equal(plan.slots.length, 100)
      assert.equal(plan.completionReason, 'requested_limit_reached')
      const targetIds = new Set(plan.slots.map(s => s.primaryTargetId))
      assert.equal(targetIds.size, 15)
      // Completing this 100-question quiz still yields exactly 15 distinct covered targets
      const completion = completionFor(universe15, 'user', 'att-100', plan.slots.map(s => s.primaryTargetId))
      const after = deriveQuizProgressiveCoverage(universe15, 'user', [completion])
      assert.equal(after.coveredTargetCount, 15)
      assert.equal(after.totalTargets, 15)
      assert.equal(after.coveragePercent, 100)
    })

    const universe80 = buildEnjoyerAssessmentUniverse(fixturePayload(80), selection)
    await test('80 targets progress monotonically across completed quizzes', () => {
      const first = completionFor(universe80, 'user', 'attempt1', universe80.targets.slice(0, 20).map(target => target.id))
      const second = completionFor(universe80, 'user', 'attempt2', universe80.targets.slice(20, 40).map(target => target.id))
      const afterOne = deriveQuizProgressiveCoverage(universe80, 'user', [first])
      const afterTwo = deriveQuizProgressiveCoverage(universe80, 'user', [first, second])
      assert.equal(afterOne.coveredTargetCount, 20)
      assert.equal(afterTwo.coveredTargetCount, 40)
      assert.ok(afterOne.coveredTargetIds.every(id => afterTwo.coveredTargetIds.includes(id)))
    })

    const universe299 = buildEnjoyerAssessmentUniverse(fixturePayload(299), selection)
    // D. 299 / request 20 produces exactly 20
    await test('299 / request 20 selects 20 uncovered atomic targets', () => {
      const config = normalizeEnjoyerQuizConfig({ questionCount: 20, difficulty: 'medium', questionTypes: ['multiple_choice'] })
      const plan = composeProgressiveQuizScope({ universe: universe299,
        coverage: deriveQuizProgressiveCoverage(universe299, 'user', []), config, generationId: 'g299-20' })
      assert.equal(plan.slots.length, 20)
      assert.equal(new Set(plan.slots.map(slot => slot.primaryTargetId)).size, 20)
      assert.equal(plan.completionReason, 'requested_limit_reached')
    })

    // E. 299 / request 100 produces exactly 100
    await test('299 / request 100 stays at cap and produces exactly 100', () => {
      const config = normalizeEnjoyerQuizConfig({ questionCount: 100, difficulty: 'medium', questionTypes: ['multiple_choice'] })
      const plan = composeProgressiveQuizScope({ universe: universe299,
        coverage: deriveQuizProgressiveCoverage(universe299, 'user', []), config, generationId: 'g299-100' })
      assert.equal(plan.slots.length, 100)
      assert.equal(new Set(plan.slots.map(slot => slot.primaryTargetId)).size, 100)
      assert.equal(universe299.targets.length - plan.slots.length, 199)
    })

    // I. Second Quiz skips completed targets while uncovered remain
    await test('second quiz excludes covered targets while uncovered targets remain', () => {
      const covered = universe299.targets.slice(0, 20).map(target => target.id)
      const coverage = deriveQuizProgressiveCoverage(universe299, 'user', [completionFor(universe299, 'user', 'attempt3', covered)])
      const config = normalizeEnjoyerQuizConfig({ questionCount: 20, difficulty: 'medium', questionTypes: ['multiple_choice'] })
      const plan = composeProgressiveQuizScope({ universe: universe299, coverage, config, generationId: 'next' })
      assert.ok(plan.slots.every(slot => !covered.includes(slot.primaryTargetId) && slot.phase === 'first_pass'))
    })

    await test('all covered enters practice and ranks incorrect before correct', () => {
      const ids = universe15.targets.map(target => target.id)
      const outcomes = ids.map((_, index) => index === 7 ? 'incorrect' as const : 'correct' as const)
      const coverage = deriveQuizProgressiveCoverage(universe15, 'user', [completionFor(universe15, 'user', 'attempt4', ids, outcomes)])
      assert.equal(coverage.mode, 'practice')
      const config = normalizeEnjoyerQuizConfig({ questionCount: 5, difficulty: 'medium', questionTypes: ['multiple_choice'] })
      const plan = composeProgressiveQuizScope({ universe: universe15, coverage, config, generationId: 'practice' })
      assert.equal(plan.coverageMode, 'practice')
      assert.equal(plan.slots[0].primaryTargetId, ids[7])
    })

    await test('practice ranks incorrect, partial, unresolved, correct and avoids a recent type', () => {
      const ids = universe15.targets.map(target => target.id)
      const outcomes = ids.map((_, index) => index === 0 ? 'incorrect' as const : index === 1 ? 'partial' as const
        : index === 2 ? 'unresolved' as const : 'correct' as const)
      const completion = completionFor(universe15, 'user', 'practice-ranking', ids, outcomes)
      completion.evidence[0].questionType = 'multiple_choice'
      const coverage = deriveQuizProgressiveCoverage(universe15, 'user', [completion])
      const config = normalizeEnjoyerQuizConfig({ questionCount: 4, difficulty: 'medium',
        questionTypes: ['multiple_choice', 'true_false'] })
      const plan = composeProgressiveQuizScope({ universe: universe15, coverage, config, generationId: 'practice-ranking' })
      assert.deepEqual(plan.slots.slice(0, 4).map(slot => coverage.targets[slot.primaryTargetId].latestOutcome),
        ['incorrect', 'partial', 'unresolved', 'correct'])
      assert.equal(plan.slots[0].type, 'true_false')
    })

    await test('progressive generation batches at most 8 and never gives author the 299-target universe', async () => {
      const config = normalizeEnjoyerQuizConfig({ questionCount: 20, difficulty: 'medium', questionTypes: ['multiple_choice'] })
      const coverage = deriveQuizProgressiveCoverage(universe299, 'user', [])
      const scopePlan = composeProgressiveQuizScope({ universe: universe299, coverage, config, generationId: 'bounded' })
      const store = new ArtifactStore()
      const seenSizes: number[] = []
      const provider: EnjoyerQuizProvider = async request => {
        seenSizes.push(request.universe.targets.length)
        assert.ok((request.requiredSlots?.length || 0) <= 8)
        return mcqAuthor(request)
      }
      let generated = await startEnjoyerQuizGeneration({ payload: fixturePayload(299), selection, sessionId: 's',
        config, scopePlan, generationId: 'bounded', store, provider })
      while (generated.status === 'generating') generated = await advanceEnjoyerQuizGeneration({
        universe: universe299, sessionId: 's', config, generationId: 'bounded', store, provider,
      })
      assert.equal(generated.artifact.questions.length, 20)
      assert.ok(seenSizes.length >= 3 && seenSizes.every(size => size > 0 && size <= 8))
      assert.ok(generated.artifact.questions.every(question => question.grounding.assessmentTargetIds.length === 1))
    })

    // A & J. Failed slot replacement maintains exact count and preserves accepted siblings
    await test('A & J: failed slot is replaced deterministically to reach EXACT count 20 without shrinking', async () => {
      const config = normalizeEnjoyerQuizConfig({ questionCount: 20, difficulty: 'medium', questionTypes: ['multiple_choice'] })
      const coverage = deriveQuizProgressiveCoverage(universe299, 'user', [])
      const scopePlan = composeProgressiveQuizScope({ universe: universe299, coverage, config, generationId: 'replace-test-20' })
      const rejectedSlotId = scopePlan.slots[0].slotId
      const store = new ArtifactStore()
      const provider: EnjoyerQuizProvider = async request => ({
        questions: (request.requiredSlots || [])
          .filter(slot => slot.slotId !== rejectedSlotId)
          .map(slot => {
            const target = request.universe.targets.find(candidate => candidate.id === slot.primaryTargetId)!
            return {
              slotId: slot.slotId, type: slot.type,
              question: `Which statement identifies ${target.title} in ${slot.slotId}?`, explanation: target.content,
              options: [target.title, 'Unsupported alternative'], correctAnswer: 0,
            }
          }),
      })
      let generated = await startEnjoyerQuizGeneration({ payload: fixturePayload(299), selection, sessionId: 's', config,
        scopePlan, generationId: 'replace-test-20', store, provider })
      while (generated.status === 'generating') {
        generated = await advanceEnjoyerQuizGeneration({
          universe: universe299, sessionId: 's', config, generationId: 'replace-test-20', store, provider,
        })
      }
      assert.equal(generated.status, 'ready')
      assert.equal(generated.artifact.questions.length, 20)
      assert.equal(generated.manifest.totalSlots, 20)
      assert.ok(generated.manifest.retiredSlotIds?.includes(rejectedSlotId))
      assert.ok(!generated.artifact.questions.some(q => q.grounding.slotId === rejectedSlotId))
    })

    // Mixed-type recovery: an academically impossible multi_select must not shrink the Quiz.
    // The replacement may use another user-selected defensible type.
    await test('mixed 6-question quiz recovers exhausted multi_select slots without ready-short output', async () => {
      const config = normalizeEnjoyerQuizConfig({
        questionCount: 6,
        difficulty: 'medium',
        questionTypes: ['multiple_choice', 'multi_select', 'fill_blank'],
      })
      const coverage = deriveQuizProgressiveCoverage(universe299, 'user', [])
      const scopePlan = composeProgressiveQuizScope({
        universe: universe299,
        coverage,
        config,
        generationId: 'mixed-recovery-6',
      })
      const store = new ArtifactStore()

      const provider: EnjoyerQuizProvider = async request => ({
        questions: (request.requiredSlots || []).flatMap(slot => {
          const target = request.universe.targets.find(candidate => candidate.id === slot.primaryTargetId)!
          if (slot.type === 'multi_select') return []

          if (slot.type === 'fill_blank') {
            return [{
              slotId: slot.slotId,
              type: slot.type,
              question: `${target.title} is the authoritative supported statement ${target.sourceOrder}.`,
              explanation: target.content,
              answer: target.title,
              wordBank: [target.title, 'Alpha', 'Beta', 'Gamma'],
            }]
          }

          return [{
            slotId: slot.slotId,
            type: slot.type,
            question: `Which statement identifies ${target.title} for ${slot.slotId}?`,
            explanation: target.content,
            options: [target.title, 'Unsupported alternative'],
            correctAnswer: 0,
          }]
        }),
      })

      let generated = await startEnjoyerQuizGeneration({
        payload: fixturePayload(299),
        selection,
        sessionId: 's',
        config,
        scopePlan,
        generationId: 'mixed-recovery-6',
        store,
        provider,
      })

      let advances = 0
      while (generated.status === 'generating' && advances++ < 40) {
        generated = await advanceEnjoyerQuizGeneration({
          universe: universe299,
          sessionId: 's',
          config,
          generationId: 'mixed-recovery-6',
          store,
          provider,
        })
      }

      assert.equal(generated.status, 'ready')
      assert.equal(generated.artifact.questions.length, 6)
      assert.equal(generated.manifest.totalSlots, 6)
      assert.ok(generated.artifact.questions.every(question =>
        ['multiple_choice', 'fill_blank'].includes(question.type)))
      assert.ok((generated.manifest.retiredSlotIds || []).length > 0)
    })

    // B. Multiple failed slots: either exact 20 or honest recoverable failure, NEVER ready-short (19)
    await test('B: multiple failed slots never produce ready-short artifact', async () => {
      const config = normalizeEnjoyerQuizConfig({ questionCount: 20, difficulty: 'medium', questionTypes: ['multiple_choice'] })
      const coverage = deriveQuizProgressiveCoverage(universe299, 'user', [])
      const scopePlan = composeProgressiveQuizScope({ universe: universe299, coverage, config, generationId: 'never-ready-short' })
      const store = new ArtifactStore()
      // Provider that rejects all replacement slots to exhaust replacement budget
      let attempts = 0
      const provider: EnjoyerQuizProvider = async request => {
        attempts++
        if (attempts > 2) return { questions: [] } // fail all subsequent slots
        return mcqAuthor(request)
      }
      let generated = await startEnjoyerQuizGeneration({ payload: fixturePayload(299), selection, sessionId: 's', config,
        scopePlan, generationId: 'never-ready-short', store, provider })
      while (generated.status === 'generating') {
        generated = await advanceEnjoyerQuizGeneration({
          universe: universe299, sessionId: 's', config, generationId: 'never-ready-short', store, provider,
        })
      }
      // Must NOT be ready with < 20 questions!
      if (generated.status === 'ready') {
        assert.equal(generated.artifact.questions.length, 20)
      } else {
        assert.equal(generated.status, 'failed')
        assert.equal(generated.manifest.failureReason, 'INSUFFICIENT_VALID_QUESTIONS')
      }
    })

    await test('wrong answer is covered but not mastered; unanswered abandoned work adds no coverage', async () => {
      const config = normalizeEnjoyerQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'] })
      const coverage = deriveQuizProgressiveCoverage(universe15, 'user', [])
      const scopePlan = composeProgressiveQuizScope({ universe: universe15, coverage, config, generationId: 'grade' })
      const store = new ArtifactStore()
      const generated = await startEnjoyerQuizGeneration({ payload: fixturePayload(15), selection, sessionId: 's', config,
        scopePlan, generationId: 'grade', store, provider: mcqAuthor })
      assert.equal(generated.status, 'ready')
      assert.throws(() => buildQuizCompletionResult({ userId: 'user', universe: universe15, artifact: generated.artifact,
        artifactIdentity: generated.manifest.identity, answers: [] }), /EMPTY_QUIZ_SUBMISSION/)
      assert.equal(deriveQuizProgressiveCoverage(universe15, 'user', []).coveredTargetCount, 0)
      const result = buildQuizCompletionResult({ userId: 'user', universe: universe15, artifact: generated.artifact,
        artifactIdentity: generated.manifest.identity,
        answers: [{ questionId: generated.artifact.questions[0].id, answer: 1 }] })
      assert.equal(result.evidence[0].outcome, 'incorrect')
      const after = deriveQuizProgressiveCoverage(universe15, 'user', [result])
      assert.equal(after.coveredTargetCount, 1)
      assert.equal(after.targets[result.evidence[0].targetId].recentScore, 0)
    })

    await test('completion insert is idempotent and concurrent attempts have one immutable winner', async () => {
      const store = new CompletionStore()
      const one = completionFor(universe15, 'user', 'same-artifact', [universe15.targets[0].id])
      const two = structuredClone(one); two.submissionHash = 'f'.repeat(64); two.evidence[0].score = 0; two.evidence[0].outcome = 'incorrect'
      const [left, right] = await Promise.all([store.insert(one), store.insert(two)])
      assert.equal([left.applied, right.applied].filter(Boolean).length, 1)
      assert.equal(store.writes, 1)
      assert.equal((await store.list(one.scopeFingerprint)).length, 1)
      const duplicate = await store.insert(one)
      assert.equal(duplicate.applied, false)
    })

    await test('coverage is isolated by user, source/universe fingerprint, and ignores duplicate artifacts', () => {
      const result = completionFor(universe15, 'user', 'isolation', [universe15.targets[0].id])
      assert.equal(deriveQuizProgressiveCoverage(universe15, 'other-user', [result]).coveredTargetCount, 0)
      const otherSelection = buildSourceSelectionSnapshot(['m'], { m: [1, 2] })
      const otherUniverse = buildEnjoyerAssessmentUniverse(fixturePayload(15, otherSelection.fingerprint), otherSelection)
      assert.equal(deriveQuizProgressiveCoverage(otherUniverse, 'user', [result]).coveredTargetCount, 0)
      const duplicate = structuredClone(result); duplicate.evidence.push({ ...duplicate.evidence[0], questionId: 'other' })
      assert.equal(deriveQuizProgressiveCoverage(universe15, 'user', [result, duplicate]).targets[result.evidence[0].targetId].attempts, 1)
    })

    // G & H. Canonical Public Coverage DTO across Preview and Completion
    await test('G & H: preview and completion share canonical PublicQuizCoverageDto with no undefined denominator', async () => {
      const artifactStore = new ArtifactStore()
      const completionStore = new CompletionStore()
      Object.assign(__routeDeps, {
        getServerSession: async () => ({ user: { id: 'route-user' } }),
        getAuthoritativeFreeSession: async () => ({ sourceSelection: selection }),
        getMaterial: async () => ({ id: 'm' }),
        lookupEnjoyer: async () => fixturePayload(15),
        createStore: () => artifactStore,
        createCompletionStore: () => completionStore,
        startGeneration: (params: Parameters<typeof startEnjoyerQuizGeneration>[0]) =>
          startEnjoyerQuizGeneration({ ...params, provider: mcqAuthor }),
      })
      const request = (body: object) => POST(new NextRequest('http://localhost/api/alai-studyal-quizzes', {
        method: 'POST', body: JSON.stringify({ sessionId: 's', sourceSelectionFingerprint: selection.fingerprint,
          config: { questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'] }, ...body }),
      }))
      const previewRes = await request({ mode: 'coverage' })
      const previewBody = await previewRes.json()
      assert.equal(previewRes.status, 200)
      assert.equal(typeof previewBody.coverage.totalAssessableTargets, 'number')
      assert.equal(typeof previewBody.coverage.coveredTargetCount, 'number')
      assert.equal(typeof previewBody.coverage.uncoveredTargetCount, 'number')
      assert.equal(typeof previewBody.coverage.estimatedCoveragePercent, 'number')
      assert.ok(['first_pass', 'practice'].includes(previewBody.coverage.mode))
      assert.ok(!Number.isNaN(previewBody.coverage.totalAssessableTargets))
      assert.ok(previewBody.coverage.totalAssessableTargets > 0)

      // Start & complete
      const started = await request({ intent: 'new', generationId: 'dto-canonical-gen' })
      const startedBody = await started.json()
      assert.equal(started.status, 200)

      const completeRes = await request({
        mode: 'complete', generationId: 'dto-canonical-gen',
        answers: [{ questionId: startedBody.quiz[0].id, answer: 0 }],
      })
      const completeBody = await completeRes.json()
      assert.equal(completeRes.status, 200)
      assert.equal(typeof completeBody.coverage.totalAssessableTargets, 'number')
      assert.equal(typeof completeBody.coverage.coveredTargetCount, 'number')
      assert.equal(typeof completeBody.coverage.uncoveredTargetCount, 'number')
      assert.equal(typeof completeBody.coverage.estimatedCoveragePercent, 'number')
      assert.ok(['first_pass', 'practice'].includes(completeBody.coverage.mode))
      assert.ok(!Number.isNaN(completeBody.coverage.totalAssessableTargets))
      assert.equal(completeBody.coverage.totalAssessableTargets, 15)
      assert.equal(completeBody.coverage.coveredTargetCount, 1)
    })

    // F. Request 101 rejected
    await test('F: request 101 is rejected with INVALID_CONFIG', () => {
      assert.throws(() => normalizeEnjoyerQuizConfig({ questionCount: 101, difficulty: 'medium', questionTypes: ['multiple_choice'] }), /INVALID_CONFIG/)
      const worker = readFileSync('cloudflare/studyal-api/src/index.ts', 'utf8')
      assert.match(worker, /material-results\/quiz-result-insert/)
      assert.match(worker, /ON CONFLICT\(id\) DO NOTHING/)
      assert.match(worker, /NOT IN \('exam_artifact', 'exam_manifest', 'quiz_result'\)/)
    })

    console.log(`quiz-progressive-coverage-contracts: ${passed} PASS; live provider calls=0; D1 mutations=0`)
  } finally {
    globalThis.fetch = savedFetch
    Object.assign(__routeDeps, routeOriginal)
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
