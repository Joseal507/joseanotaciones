import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import {
  InMemoryExamGenerationStore,
  getOrBuildExamGeneration,
  advanceExamGeneration,
  restoreExamGeneration,
  examGenerationIdentity,
  ExamSlotState,
  GenerateExamSlotBatchOutput,
} from '../../lib/materialBrain/examGenerationStore'
import { POST, __routeDeps } from '../../app/api/alai-studyal-exam/route'
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

function make14SlotBlueprint(examId = 'exam-stale-repro'): ExamBlueprint {
  const slots = Array.from({ length: 14 }, (_, i) => makeMockSlot(`slot_${i}`, i))
  return {
    schemaVersion: 2,
    generatorVersion: 'enjoyer-exam-evidence-4.0.0',
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
  console.log('[STALE FAILED RESTORE REGRESSION START]')

  // ============================================================
  // CONTRACT 1 & 3: Stale failed manifest self-heals on restore and advance
  // Fixture: status=failed, totalSlots=14, ready=6, slot_6=terminal_failed (attempts=2), remaining untouched=7
  // ============================================================
  {
    const store = new InMemoryExamGenerationStore<any>()
    const blueprint = make14SlotBlueprint('exam-stale-repro')
    blueprint.slots[6].type = 'short_answer'
    const identity = examGenerationIdentity('sess-stale', 'fp-falcons-14', 'exam-stale-repro')

    // Prepare 6 ready questions
    const readyQuestions: any[] = []
    const slotStates: Record<string, ExamSlotState> = {}

    // Slots 0..5: ready
    for (let i = 0; i < 6; i++) {
      const slot = blueprint.slots[i]
      const q = makeMockQuestion(slot)
      readyQuestions.push(q)
      slotStates[slot.id] = { status: 'ready', attempts: 1, questionId: q.id }
    }

    // Slot 6: terminal_failed (Slot X)
    slotStates['slot_6'] = {
      status: 'terminal_failed',
      attempts: 2,
      lastFailureReason: 'LENGTH_LEAK: distractor con longitud significativamente disonante',
    }

    // Slots 7..13: untouched pending
    for (let i = 7; i < 14; i++) {
      slotStates[`slot_${i}`] = { status: 'pending', attempts: 0 }
    }

    // Persist the PRE-FIX failed manifest into store
    await store.saveManifest(identity, {
      schemaVersion: 2,
      identity,
      examId: 'exam-stale-repro',
      fingerprint: 'fp-falcons-14',
      sessionId: 'sess-stale',
      blueprint,
      totalSlots: 14,
      status: 'failed',
      failureReason: 'SLOT_UNRESOLVABLE:slot_6',
      slots: slotStates,
      providerAttemptsBudget: 28,
      providerAttemptsUsed: 8,
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:01:00.000Z',
    })
    await store.saveArtifact(identity, {
      examId: 'exam-stale-repro',
      fingerprint: 'fp-falcons-14',
      meta: { status: 'failed', generatedAt: '2026-09-08T00:00:00.000Z' },
      questions: readyQuestions,
    })

    // STEP 1: restoreExamGeneration must self-heal to 'generating'
    const restored = await restoreExamGeneration('sess-stale', 'fp-falcons-14', 'exam-stale-repro', store)
    assert.ok(restored !== null, 'Restore must find the manifest')
    assert.equal(restored.manifest.status, 'generating', 'Restore must NOT immediately return global terminal failure')
    assert.equal(restored.artifact.questions.length, 6, 'Ready 6 questions remain immutable')
    assert.equal(restored.manifest.slots['slot_6'].status, 'terminal_failed', 'Slot X history remains intact')
    assert.equal(restored.manifest.slots['slot_6'].attempts, 2, 'Attempt counters must not reset')
    assert.equal(
      restored.manifest.slots['slot_6'].lastFailureReason,
      'LENGTH_LEAK: distractor con longitud significativamente disonante',
      'Failure reason preserved',
    )
    assert.equal(restored.manifest.slots['slot_0'].attempts, 1)
    assert.equal(restored.manifest.slots['slot_0'].status, 'ready')
    for (let i = 7; i < 14; i++) {
      assert.equal(restored.manifest.slots[`slot_${i}`].status, 'pending', `Untouched slot_${i} must be actionable (pending)`)
    }

    // STEP 2: getOrBuildExamGeneration on resume must return 'generating' (never failed)
    const resumed = await getOrBuildExamGeneration(
      'sess-stale', 'fp-falcons-14', 'exam-stale-repro', blueprint,
      store, async () => { throw new Error('NO_CALL_ON_RESUME') },
    )
    assert.equal(resumed.status, 'generating', 'Resume returns generating')
    assert.equal(resumed.artifact.questions.length, 6)

    // STEP 3: advanceExamGeneration targets ONLY the untouched pending slots
    const generatedSlots: string[] = []
    const generator = async (
      targetSlotIds: string[],
      bp: ExamBlueprint,
      _seed: string,
    ): Promise<GenerateExamSlotBatchOutput<any>> => {
      generatedSlots.push(...targetSlotIds)
      const questions = new Map<string, any>()
      for (const id of targetSlotIds) {
        questions.set(id, makeMockQuestion(bp.slots.find(s => s.id === id)!))
      }
      return questions
    }

    const step1Advance = await advanceExamGeneration(
      'sess-stale', 'fp-falcons-14', 'exam-stale-repro',
      store, generator, { batchSize: 4 },
    )

    // Assert advance targeted ONLY untouched pending slots (slots 7..10)
    assert.deepEqual(generatedSlots, ['slot_7', 'slot_8', 'slot_9', 'slot_10'])
    assert.equal(step1Advance.artifact.questions.length, 10, 'Ready count grows from 6 to 10')
    assert.equal(step1Advance.status, 'generating', 'Manifest remains generating')

    // Verify original 6 questions are completely unchanged
    for (let i = 0; i < 6; i++) {
      assert.deepEqual(step1Advance.artifact.questions[i], readyQuestions[i], `Question ${i} must remain identical`)
    }

    // Next advance finishes slots 11..13
    const step2Advance = await advanceExamGeneration(
      'sess-stale', 'fp-falcons-14', 'exam-stale-repro',
      store, generator, { batchSize: 4 },
    )
    assert.equal(step2Advance.artifact.questions.length, 13, 'All 13 resolvable slots are now ready')
    assert.equal(step2Advance.status, 'failed', 'All slots now exhausted -> honestly transitions to failed')
    assert.equal(step2Advance.manifest.slots['slot_6'].status, 'terminal_failed')
    console.log('Contract 1 & 3 PASS: Stale failed manifest self-healed, ready 6 preserved, untouched slots completed.')
  }

  // ============================================================
  // CONTRACT 2: Route level start and UI presentation
  // ============================================================
  {
    const originalDeps = { ...__routeDeps }
    try {
      const blueprint = make14SlotBlueprint('exam-route-stale')
      const identity = examGenerationIdentity('sess-route-stale', 'fp-falcons-14', 'exam-route-stale')
      const store = new InMemoryExamGenerationStore<any>()

      // Pre-seed 6 ready + 1 terminal_failed + 7 pending
      const readyQuestions: any[] = []
      const slotStates: Record<string, ExamSlotState> = {}
      for (let i = 0; i < 6; i++) {
        const q = makeMockQuestion(blueprint.slots[i])
        readyQuestions.push(q)
        slotStates[`slot_${i}`] = { status: 'ready', attempts: 1, questionId: q.id }
      }
      slotStates['slot_6'] = { status: 'terminal_failed', attempts: 2, lastFailureReason: 'REJECT' }
      for (let i = 7; i < 14; i++) slotStates[`slot_${i}`] = { status: 'pending', attempts: 0 }

      await store.saveManifest(identity, {
        schemaVersion: 2, identity, examId: 'exam-route-stale', fingerprint: 'fp-falcons-14', sessionId: 'sess-route-stale',
        blueprint, totalSlots: 14, status: 'failed', failureReason: 'SLOT_UNRESOLVABLE:slot_6',
        slots: slotStates, providerAttemptsBudget: 28, providerAttemptsUsed: 8, createdAt: '', updatedAt: '',
      })
      await store.saveArtifact(identity, {
        examId: 'exam-route-stale', fingerprint: 'fp-falcons-14',
        meta: { status: 'failed', generatedAt: '' }, questions: readyQuestions,
      })

      Object.assign(__routeDeps, {
        getServerSession: async () => ({ user: { id: 'u1' } }),
        getAuthoritativeFreeSession: async (sId: string, uId: string) => ({
          id: sId, userId: uId, processMode: 'free',
          sourceSelection: { materialIds: ['mat-1'], selectedPages: { 'mat-1': [1, 2] }, fingerprint: 'fp-falcons-14' },
        }),
        lookupStudyalMaterialEnjoyer: async () => ({
          sourceSelectionFingerprint: 'fp-falcons-14', materialIds: ['mat-1'], selectedPages: { 'mat-1': [1, 2] },
          topicsIndex: [], globalOrderedAnalysis: [], uniqueConceptsIndex: [],
        }),
        examStore: store,
        gradingStore: new MemoryExamGradingStore(),
        generateValidatedLegacyJson: async () => { throw new Error('NO_PROVIDER_CALLS') },
      })

      // Calling advance on the stale failed exam:
      // Must NOT return EXAM_GENERATION_FAILED!
      const req = new NextRequest('http://localhost/api/alai-studyal-exam', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'advance', sessionId: 'sess-route-stale', examId: 'exam-route-stale' }),
      })
      const res = await POST(req)
      assert.equal(res.status, 200)
      const data = await res.json()
      // Because generateValidatedLegacyJson throws NO_PROVIDER_CALLS in this mock,
      // runExamChunk marks the target batch retryable_failed and stays generating!
      assert.equal(data.success, true, 'Route must succeed and return exam object')
      assert.equal(data.status, 'generating', 'Status must be generating, not immediately failed')
      assert.equal(data.readyCount, 6)
      assert.equal(data.totalSlots, 14)
      assert.ok(
        data.exam.coverage.includes('6/14 objetivos listos'),
        `Lobby coverage shows ready / planned: ${data.exam.coverage}`,
      )
      console.log('Contract 2 PASS: Route advance self-heals and renders generating UI state.')
    } finally {
      Object.assign(__routeDeps, originalDeps)
    }
  }

  // ============================================================
  // CONTRACT 4: Genuinely exhausted failed manifest REMAINS failed
  // ============================================================
  {
    const store = new InMemoryExamGenerationStore<any>()
    const blueprint = make14SlotBlueprint('exam-exhausted')
    blueprint.slots[13].type = 'short_answer'
    const identity = examGenerationIdentity('sess-exhausted', 'fp-falcons-14', 'exam-exhausted')

    // 13 ready, 1 terminal_failed, 0 pending
    const readyQuestions: any[] = []
    const slotStates: Record<string, ExamSlotState> = {}
    for (let i = 0; i < 13; i++) {
      const q = makeMockQuestion(blueprint.slots[i])
      readyQuestions.push(q)
      slotStates[`slot_${i}`] = { status: 'ready', attempts: 1, questionId: q.id }
    }
    slotStates['slot_13'] = { status: 'terminal_failed', attempts: 2, lastFailureReason: 'SLOT_UNRESOLVABLE:slot_13' }

    await store.saveManifest(identity, {
      schemaVersion: 2, identity, examId: 'exam-exhausted', fingerprint: 'fp-falcons-14', sessionId: 'sess-exhausted',
      blueprint, totalSlots: 14, status: 'failed', failureReason: 'SLOT_UNRESOLVABLE:slot_13',
      slots: slotStates, providerAttemptsBudget: 28, providerAttemptsUsed: 15, createdAt: '', updatedAt: '',
    })
    await store.saveArtifact(identity, {
      examId: 'exam-exhausted', fingerprint: 'fp-falcons-14',
      meta: { status: 'failed', generatedAt: '' }, questions: readyQuestions,
    })

    // Restore on genuinely exhausted manifest
    const restored = await restoreExamGeneration('sess-exhausted', 'fp-falcons-14', 'exam-exhausted', store)
    assert.equal(restored?.manifest.status, 'failed', 'Genuinely exhausted manifest must remain failed')
    assert.equal(restored?.manifest.failureReason, 'SLOT_UNRESOLVABLE:slot_13')

    // getOrBuild on genuinely exhausted manifest
    let providerCalls = 0
    const resumed = await getOrBuildExamGeneration(
      'sess-exhausted', 'fp-falcons-14', 'exam-exhausted', blueprint,
      store, async () => { providerCalls++; return new Map() },
    )
    assert.equal(resumed.status, 'failed', 'getOrBuild returns failed')
    assert.equal(resumed.cacheStatus, 'hit')
    assert.equal(providerCalls, 0, 'Zero provider calls on genuinely exhausted manifest')

    // advance on genuinely exhausted manifest
    const advanced = await advanceExamGeneration(
      'sess-exhausted', 'fp-falcons-14', 'exam-exhausted',
      store, async () => { providerCalls++; return new Map() },
    )
    assert.equal(advanced.status, 'failed', 'advance returns failed')
    assert.equal(advanced.cacheStatus, 'hit')
    assert.equal(providerCalls, 0, 'Zero provider calls on genuinely exhausted manifest')
    console.log('Contract 4 PASS: Genuinely exhausted failed manifest remains failed with 0 provider calls.')
  }

  console.log('[ALL STALE FAILED RESTORE CONTRACTS PASSED]')
}

runTests().catch(err => {
  console.error('[TEST FAILED]', err)
  process.exit(1)
})
