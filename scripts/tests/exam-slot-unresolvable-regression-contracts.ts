import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import {
  InMemoryExamGenerationStore,
  getOrBuildExamGeneration,
  advanceExamGeneration,
  examGenerationIdentity,
  ExamSlotState,
  GenerateExamSlotBatchOutput,
} from '../../lib/materialBrain/examGenerationStore'
import { POST, __routeDeps, buildGroundedExamPrompt } from '../../app/api/alai-studyal-exam/route'
import { MemoryExamGradingStore } from '../../lib/materialBrain/examGrading'
import type { ExamBlueprint, ExamSlotBlueprint } from '../../lib/materialBrain/examEnjoyerContext'

function makeMockSlot(id: string, index: number): ExamSlotBlueprint {
  return {
    id,
    type: 'multiple_choice',
    section: 'Sección Principal',
    difficulty: 'medium',
    skill: 'recall',
    primaryConcept: `Concepto ${id}`,
    sourceItemIds: [`item_${index}`],
    sourcePage: 1,
    groundingContext: `Contenido verificable de contexto para ${id}`,
    contextSummary: `Resumen de contexto para ${id}`,
    expectedOperation: 'Verificar la definición correcta',
    canonicalAssessmentExcerpt: `Extracto canónico para ${id}`,
    assessmentCriteria: [
      {
        criterionId: `${id}_c0`,
        targetId: `target_${index}`,
        gradingMode: 'deterministic',
        points: 5,
        skill: 'recall',
        expectation: `Demuestra comprensión de ${id}`,
        canonicalAnchor: `Ancla de ${id}`,
      },
    ],
    assessedTargetIds: [`target_${index}`],
    relatedTargetIds: [],
    frozenSources: [
      {
        sourceItemId: `item_${index}`,
        label: `Item ${index}`,
        content: `Contenido verificable de contexto para ${id}`,
        materialId: 'mat-1',
        pages: [1],
      },
    ],
    answerAuthority: {
      kind: 'single_text',
      canonicalValue: `Extracto canónico para ${id}`,
      canonicalAnchor: `Ancla de ${id}`,
    },
  } as any
}

function make14SlotBlueprint(examId = 'exam-14-slots'): ExamBlueprint {
  const slots = Array.from({ length: 14 }, (_, i) => makeMockSlot(`exam_slot:${i.toString(16).padStart(4, '0')}`, i))
  return {
    schemaVersion: 2,
    generatorVersion: 'enjoyer-exam-progressive-1.0.0',
    authorityType: 'studyal_material_enjoyer',
    authorityVersion: 2,
    examId,
    fingerprint: 'fp-falcons-14',
    seed: 'seed-14',
    requestedDurationMinutes: 30,
    durationMinutes: 30,
    effectiveDurationMinutes: 30,
    idealDurationMinutes: 30,
    minimumViableDurationMinutes: 15,
    typeDistribution: { multiple_choice: 14 },
    difficultyDistribution: { medium: 14 },
    expectedCompletionSeconds: 1800,
    totalExamTargets: 14,
    coverageStatus: 'full',
    coverage: {
      coverageStatus: 'full',
      coveragePercent: 100,
      assessedCoveragePercent: 100,
      totalUniverseTargets: 14,
      totalAssessableTargets: 14,
      assessedTargetIds: slots.map(s => s.assessedTargetIds[0]),
      contextOnlyTargetIds: [],
      notAssessedDueToScopeTargetIds: [],
      representedTargetIds: slots.map(s => s.assessedTargetIds[0]),
      omittedTargetIds: [],
      unsupportedTargetIds: [],
      unsupportedReasons: {},
      targetsByMateria: {},
      targetsByTema: {},
    },
    slots,
  }
}

function makeMockQuestion(slot: ExamSlotBlueprint) {
  return {
    id: slot.id,
    slotId: slot.id,
    type: slot.type,
    section: slot.section,
    prompt: `¿Pregunta validada para ${slot.id}?`,
    points: 5,
    skill: slot.skill,
    difficulty: slot.difficulty,
    sourceItemIds: slot.sourceItemIds,
    sourcePage: slot.sourcePage,
    options: ['Opción A correcta', 'Opción B', 'Opción C', 'Opción D'],
    correctAnswer: 0,
    ready: true,
  }
}

async function runTests() {
  console.log('[REGRESSION TEST START] Testing slot unresolvable and informed retry...')

  // ============================================================
  // CONTRACT 1: 14-slot live failure reproduction.
  // One terminal-failed slot does NOT abandon unrelated pending slots.
  // ============================================================
  {
    const store = new InMemoryExamGenerationStore<any>()
    const blueprint = make14SlotBlueprint('exam-live-repro')
    blueprint.slots[1].type = 'short_answer'
    const failingSlotId = blueprint.slots[1].id // slot 1 fails repeatedly

    let batchCallCount = 0
    const generator = async (
      targetSlotIds: string[],
      bp: ExamBlueprint,
      _seed: string,
      slotStates?: Record<string, ExamSlotState>,
    ): Promise<GenerateExamSlotBatchOutput<any>> => {
      batchCallCount++
      const questions = new Map<string, any>()
      const rejections: Record<string, string> = {}

      for (const id of targetSlotIds) {
        const slot = bp.slots.find(s => s.id === id)!
        if (id === failingSlotId) {
          // slot 1 repeatedly fails validation with a diagnostic reason
          rejections[id] = 'LENGTH_LEAK: distractor con longitud significativamente disonante'
        } else {
          questions.set(id, makeMockQuestion(slot))
        }
      }
      return { questions, rejections }
    }

    // Step 1: Initial creation (Batch 1: initialBatch targets first slots)
    const init = await getOrBuildExamGeneration(
      'sess-repro', 'fp-falcons-14', 'exam-live-repro', blueprint,
      store, generator, { batchSize: 4 },
    )
    assert.equal(init.status, 'generating')
    assert.equal(init.manifest.slots[failingSlotId].attempts, 1)
    assert.equal(init.manifest.slots[failingSlotId].status, 'retryable_failed')
    assert.equal(
      init.manifest.slots[failingSlotId].lastFailureReason,
      'LENGTH_LEAK: distractor con longitud significativamente disonante',
    )
    const initialReady = init.artifact.questions.length
    assert.ok(initialReady >= 3, `Initial ready questions: ${initialReady}`)

    // Step 2: Second advance (Batch 2: retryable slot 1 is prioritized and retried)
    const step2 = await advanceExamGeneration(
      'sess-repro', 'fp-falcons-14', 'exam-live-repro',
      store, generator, { batchSize: 4 },
    )
    assert.equal(step2.manifest.slots[failingSlotId].attempts, 2)
    assert.equal(
      step2.manifest.slots[failingSlotId].status,
      'terminal_failed',
      'Slot 1 must become terminal_failed after reaching 2 attempts',
    )
    // P0 INVARIANT: One terminal-failed slot must NOT cancel the entire generation when untouched pending slots remain!
    assert.equal(
      step2.status,
      'generating',
      'Manifest must remain GENERATING after slot 1 exhaustion because pending slots remain',
    )

    // Advance until all slots are processed
    let current = step2
    let safetyGuard = 0
    while (current.status === 'generating' && safetyGuard++ < 10) {
      current = await advanceExamGeneration(
        'sess-repro', 'fp-falcons-14', 'exam-live-repro',
        store, generator, { batchSize: 4 },
      )
    }

    // Final state assertions:
    assert.equal(
      current.status,
      'failed',
      'Manifest becomes failed only when all slots have been attempted to conclusion',
    )
    assert.equal(current.artifact.questions.length, 13, 'All 13 resolvable slots must be ready')
    assert.ok(
      current.manifest.failureReason?.includes(`SLOT_UNRESOLVABLE:${failingSlotId}`),
      `Failure reason must specify the unresolvable slot: ${current.manifest.failureReason}`,
    )
    console.log('Contract 1 PASS: 14-slot live failure reproduction — remaining slots never abandoned.')
  }

  // ============================================================
  // CONTRACT 2: Informed retry mechanism.
  // The retry prompt instructs the model with the exact failure reason,
  // enabling successful authoring on attempt 2.
  // ============================================================
  {
    const blueprint = make14SlotBlueprint('exam-informed-retry')
    const retrySlot = blueprint.slots[0]

    // Verify buildGroundedExamPrompt injects the informed retry instruction
    const failedSlotStates: Record<string, ExamSlotState> = {
      [retrySlot.id]: {
        status: 'retryable_failed',
        attempts: 1,
        lastFailureReason: 'OPERATION_MISMATCH: no evalúa el verbo esperado',
      },
    }
    const prompt = buildGroundedExamPrompt([retrySlot as any], 'es', failedSlotStates)
    assert.ok(
      prompt.includes('REINTENTO INFORMADO — EL INTENTO ANTERIOR FALLÓ POR:'),
      'Prompt must contain informed retry header',
    )
    assert.ok(
      prompt.includes('OPERATION_MISMATCH: no evalúa el verbo esperado'),
      'Prompt must contain the specific failure reason',
    )
    assert.ok(
      prompt.includes('los criterios y la autoridad de respuesta canónica'),
      'Prompt must instruct to preserve criteria while fixing the issue',
    )

    // Verify multi-batch recovery with informed retry
    const store = new InMemoryExamGenerationStore<any>()
    let attemptCount = 0
    const generator = async (
      targetSlotIds: string[],
      bp: ExamBlueprint,
      _seed: string,
      slotStates?: Record<string, ExamSlotState>,
    ): Promise<GenerateExamSlotBatchOutput<any>> => {
      const questions = new Map<string, any>()
      const rejections: Record<string, string> = {}

      for (const id of targetSlotIds) {
        const slot = bp.slots.find(s => s.id === id)!
        if (id === retrySlot.id) {
          attemptCount++
          if (attemptCount === 1) {
            // Attempt 1: fails
            rejections[id] = 'OPERATION_MISMATCH: no evalúa el verbo esperado'
          } else {
            // Attempt 2: informed retry succeeds because model corrected the issue
            assert.equal(
              slotStates?.[id]?.lastFailureReason,
              'OPERATION_MISMATCH: no evalúa el verbo esperado',
              'Generator must receive lastFailureReason in slotStates',
            )
            questions.set(id, makeMockQuestion(slot))
          }
        } else {
          questions.set(id, makeMockQuestion(slot))
        }
      }
      return { questions, rejections }
    }

    const init = await getOrBuildExamGeneration(
      'sess-retry', 'fp-falcons-14', 'exam-informed-retry', blueprint,
      store, generator, { batchSize: 4 },
    )
    assert.equal(init.manifest.slots[retrySlot.id].status, 'retryable_failed')

    const step2 = await advanceExamGeneration(
      'sess-retry', 'fp-falcons-14', 'exam-informed-retry',
      store, generator, { batchSize: 4 },
    )
    assert.equal(
      step2.manifest.slots[retrySlot.id].status,
      'ready',
      'Retryable slot must succeed and transition to ready on informed retry',
    )
    assert.equal(step2.manifest.slots[retrySlot.id].attempts, 2)
    console.log('Contract 2 PASS: Informed retry context injected and enables recovery.')
  }

  // ============================================================
  // CONTRACT 3: Route level failure response and honest coverage.
  // When manifest is 'failed', route returns status 200 with honest metrics.
  // ============================================================
  {
    const originalDeps = { ...__routeDeps }
    try {
      const blueprint = make14SlotBlueprint('exam-route-failed')
      blueprint.slots[1].type = 'short_answer'
      const failingSlotId = blueprint.slots[1].id
      const store = new InMemoryExamGenerationStore<any>()

      // Pre-seed store with a failed manifest where 13 slots are ready and 1 is terminal_failed
      const readyQuestions: any[] = []
      const slotStates: Record<string, ExamSlotState> = {}
      for (const slot of blueprint.slots) {
        if (slot.id === failingSlotId) {
          slotStates[slot.id] = {
            status: 'terminal_failed',
            attempts: 2,
            lastFailureReason: 'CANONICAL_COLLISION: distractor idéntico al ancla canónica',
          }
        } else {
          const q = makeMockQuestion(slot)
          readyQuestions.push(q)
          slotStates[slot.id] = {
            status: 'ready',
            attempts: 1,
            questionId: q.id,
          }
        }
      }

      const identity = examGenerationIdentity('sess-route', 'fp-falcons-14', 'exam-route-failed')
      await store.saveManifest(identity, {
        schemaVersion: 2,
        identity,
        examId: 'exam-route-failed',
        fingerprint: 'fp-falcons-14',
        sessionId: 'sess-route',
        blueprint,
        totalSlots: 14,
        status: 'failed',
        failureReason: `SLOT_UNRESOLVABLE:${failingSlotId}`,
        slots: slotStates,
        providerAttemptsBudget: 28,
        providerAttemptsUsed: 15,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      await store.saveArtifact(identity, {
        examId: 'exam-route-failed',
        fingerprint: 'fp-falcons-14',
        meta: { status: 'failed', generatedAt: new Date().toISOString() },
        questions: readyQuestions,
      })

      Object.assign(__routeDeps, {
        getServerSession: async () => ({ user: { id: 'user-route' } }),
        getAuthoritativeFreeSession: async (sId: string, uId: string) => {
          if (sId !== 'sess-route') return null
          return {
            id: sId,
            userId: uId,
            processMode: 'free',
            sourceSelection: {
              materialIds: ['mat-1'],
              selectedPages: { 'mat-1': [1, 2] },
              fingerprint: 'fp-falcons-14',
            },
          }
        },
        lookupStudyalMaterialEnjoyer: async () => ({
          sourceSelectionFingerprint: 'fp-falcons-14',
          materialIds: ['mat-1'],
          selectedPages: { 'mat-1': [1, 2] },
          topicsIndex: [],
          globalOrderedAnalysis: [],
          uniqueConceptsIndex: [],
        }),
        examStore: store,
        gradingStore: new MemoryExamGradingStore(),
        generateValidatedLegacyJson: async () => { throw new Error('NO_PROVIDER_CALLS') },
      })

      const req = new NextRequest('http://localhost/api/alai-studyal-exam', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'advance', sessionId: 'sess-route', examId: 'exam-route-failed' }),
      })
      const res = await POST(req)
      assert.equal(res.status, 200, 'Failed exam generation must return HTTP 200 with diagnostic payload')
      const data = await res.json()
      assert.equal(data.success, false)
      assert.equal(data.status, 'failed')
      assert.equal(data.error, 'EXAM_GENERATION_FAILED')
      assert.equal(data.readyCount, 13)
      assert.equal(data.totalSlots, 14)
      assert.equal(data.failureReason, `SLOT_UNRESOLVABLE:${failingSlotId}`)
      assert.ok(data.exam, 'Exam payload must be delivered so client has ready questions')
      assert.equal(data.exam.questions.length, 14)
      assert.equal(data.exam.questions.filter((q: any) => q.ready).length, 13)
      // Honest coverage metric:
      assert.ok(
        data.exam.coverage.includes('13/14 objetivos listos'),
        `Coverage must disclose honest ready count (13/14), got: ${data.exam.coverage}`,
      )
      console.log('Contract 3 PASS: Route level failure response returns HTTP 200 with honest coverage.')
    } finally {
      Object.assign(__routeDeps, originalDeps)
    }
  }

  // ============================================================
  // CONTRACT 4: Per-slot attempt accounting isolation.
  // Repeated failures on Slot A do NOT increment or exhaust Slot B.
  // ============================================================
  {
    const store = new InMemoryExamGenerationStore<any>()
    const blueprint = make14SlotBlueprint('exam-isolation')
    const slot0 = blueprint.slots[0].id
    const slot1 = blueprint.slots[1].id

    // Generator fails slot 0, succeeds slot 1
    const gen = async (targets: string[], bp: ExamBlueprint) => {
      const questions = new Map<string, any>()
      const rejections: Record<string, string> = {}
      for (const id of targets) {
        if (id === slot0) {
          rejections[id] = 'FAIL_SLOT_0'
        } else {
          questions.set(id, makeMockQuestion(bp.slots.find(s => s.id === id)!))
        }
      }
      return { questions, rejections }
    }

    const init = await getOrBuildExamGeneration(
      'sess-iso', 'fp-falcons-14', 'exam-isolation', blueprint,
      store, gen, { batchSize: 2 },
    )
    assert.equal(init.manifest.slots[slot0].attempts, 1)
    assert.equal(init.manifest.slots[slot0].status, 'retryable_failed')
    assert.equal(init.manifest.slots[slot1].attempts, 1)
    assert.equal(init.manifest.slots[slot1].status, 'ready')

    // Next chunk targets slot 0 and another pending slot
    const step2 = await advanceExamGeneration(
      'sess-iso', 'fp-falcons-14', 'exam-isolation',
      store, gen, { batchSize: 2 },
    )
    assert.equal(step2.manifest.slots[slot0].attempts, 2)
    assert.equal(step2.manifest.slots[slot0].status, 'terminal_failed')
    // Slot 1 remains untouched and ready with attempts=1
    assert.equal(step2.manifest.slots[slot1].attempts, 1)
    assert.equal(step2.manifest.slots[slot1].status, 'ready')
    console.log('Contract 4 PASS: Attempt accounting is strictly per-slot, isolated.')
  }

  console.log('[ALL REGRESSION CONTRACTS PASSED]')
}

runTests().catch(err => {
  console.error('[REGRESSION CONTRACT FAILED]', err)
  process.exit(1)
})
