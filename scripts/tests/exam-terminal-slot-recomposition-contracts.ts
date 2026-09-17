import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import {
  InMemoryExamGenerationStore,
  getOrBuildExamGeneration,
  advanceExamGeneration,
  restoreExamGeneration,
  normalizeActionableExamManifest,
  deterministicallyRecomposeSlot,
  examGenerationIdentity,
  ExamSlotState,
  GenerateExamSlotBatchOutput,
} from '../../lib/materialBrain/examGenerationStore'
import { POST, __routeDeps } from '../../app/api/alai-studyal-exam/route'
import { MemoryExamGradingStore } from '../../lib/materialBrain/examGrading'
import type { ExamBlueprint, ExamComposedSlot } from '../../lib/materialBrain/examEnjoyerContext'

function makeMockComposedSlot(id: string, index: number, type: any = 'multiple_choice'): ExamComposedSlot {
  return {
    id,
    type,
    primaryTargetId: `target_${index}`,
    contextTargetIds: [],
    targetIds: [`target_${index}`],
    assessedTargetIds: [`target_${index}`],
    sourceItemIds: [`item_${index}`],
    cognitiveLevel: 'comprehension',
    cognitiveOperation: 'explain',
    skill: 'comprehension',
    assessmentFocus: `Objetivo de evaluación para ${id}`,
    difficulty: 'medium',
    estimatedSeconds: 60,
    readingBudgetWords: 45,
    order: index,
    assessmentCriteria: [
      {
        criterionId: `${id}:criterion:item_${index}`,
        targetIds: [`target_${index}`],
        operation: 'explain',
        canonicalCriterion: `Matt Ryan aportó estabilidad inmediata a los Falcons en 2008 (${id})`,
        gradingMode: type === 'short_answer' ? 'semantic' : 'deterministic',
        points: 5,
        skill: 'comprehension',
        label: `Criterio ${id}`,
        sourceItemId: `item_${index}`,
        pages: [1],
        materialId: 'falcons.pdf',
      },
    ],
    frozenSources: [
      {
        sourceItemId: `item_${index}`,
        label: `Item ${index}`,
        content: `Matt Ryan aportó estabilidad inmediata a los Falcons en 2008 tras su selección en el draft (${id}).`,
        materialId: 'falcons.pdf',
        pages: [1],
        sourceSpans: [{ page: 1, quote: `Matt Ryan aportó estabilidad (${id})` }],
      },
    ],
    answerAuthority: {
      kind: 'single_text',
      canonicalValue: `Matt Ryan aportó estabilidad inmediata a los Falcons en 2008 (${id})`,
      distractorPool: ['Distractor 1', 'Distractor 2'],
    },
    topicId: 'falcons-history',
    topicTitle: 'Historia de los Falcons',
  }
}

function makeMockQuestion(slot: ExamComposedSlot): any {
  if (slot.type === 'multiple_choice') {
    const canonical = slot.answerAuthority.kind === 'single_text' ? slot.answerAuthority.canonicalValue : 'Correcto'
    return {
      id: slot.id,
      slotId: slot.id,
      type: 'multiple_choice',
      prompt: `Pregunta sobre ${slot.id}`,
      options: [canonical, 'Opción 2', 'Opción 3', 'Opción 4'],
      correctAnswer: 0,
      points: 5,
      skill: slot.skill,
      difficulty: slot.difficulty,
      section: 'Opción Múltiple',
      assessmentCriteria: slot.assessmentCriteria,
      grounding: {
        authorityType: 'studyal_material_enjoyer',
        authorityVersion: 2,
        sourceSelectionFingerprint: 'fp-falcons-14',
        targetIds: [...slot.targetIds],
        sourceItemIds: [...slot.sourceItemIds],
        evidence: [],
      },
    }
  } else {
    // short_answer
    const canonical = slot.answerAuthority.kind === 'single_text' ? slot.answerAuthority.canonicalValue : 'Respuesta'
    return {
      id: slot.id,
      slotId: slot.id,
      type: 'short_answer',
      prompt: `Explica el impacto de ${slot.assessmentFocus}`,
      expectedAnswer: canonical,
      points: 5,
      skill: slot.skill,
      difficulty: slot.difficulty,
      section: 'Respuesta Corta',
      assessmentCriteria: slot.assessmentCriteria,
      grounding: {
        authorityType: 'studyal_material_enjoyer',
        authorityVersion: 2,
        sourceSelectionFingerprint: 'fp-falcons-14',
        targetIds: [...slot.targetIds],
        sourceItemIds: [...slot.sourceItemIds],
        evidence: [],
      },
    }
  }
}

function make14SlotFalconsBlueprint(examId = '70c9b0ed2a93dc6a4ac44119ea737a3b'): ExamBlueprint {
  const slots: ExamComposedSlot[] = []
  // Slot 0: exam_slot:f2a34bdc
  slots.push(makeMockComposedSlot('exam_slot:f2a34bdc', 0))
  // Slot 1: exam_slot:555855a6 (the problem slot)
  slots.push(makeMockComposedSlot('exam_slot:555855a6', 1))
  // Slot 2: exam_slot:a12f469
  slots.push(makeMockComposedSlot('exam_slot:a12f469', 2))
  // Slot 3: exam_slot:9493be27
  slots.push(makeMockComposedSlot('exam_slot:9493be27', 3))
  // Remaining 10 slots
  for (let i = 4; i < 14; i++) {
    slots.push(makeMockComposedSlot(`exam_slot:s${i.toString(16).padStart(4, '0')}`, i))
  }

  return {
    schemaVersion: 2,
    generatorVersion: 'enjoyer-exam-evidence-4.0.0',
    authorityType: 'studyal_material_enjoyer',
    authorityVersion: 2,
    examId,
    fingerprint: 'fp-falcons-14',
    seed: 'seed-falcons-14',
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
      totalUniverseTargets: 14,
      totalConsideredTargets: 14,
      totalTouchedTargets: 14,
      totalAssessedTargets: 14,
      assessedCoveragePercent: 100,
      touchedCoveragePercent: 100,
      consideredCoveragePercent: 100,
      assessedTargetIds: slots.map(s => s.primaryTargetId),
      touchedTargetIds: slots.map(s => s.primaryTargetId),
      consideredTargetIds: slots.map(s => s.primaryTargetId),
      notAssessedDueToScopeTargetIds: [],
    },
    readingBurden: {
      totalReadingWords: 600,
      requestedDurationMinutes: 30,
      readingFractionOfTime: 0.15,
      readingLoadAcceptable: true,
      perSlotWordCount: slots.map(() => 45),
    },
    slots,
    materialLanguage: 'es',
    createdAt: new Date().toISOString(),
  }
}

async function runTests() {
  console.log('[EXAM TERMINAL SLOT RECOMPOSITION CONTRACTS START]')

  const EXAM_ID = '70c9b0ed2a93dc6a4ac44119ea737a3b'
  const PROBLEM_SLOT_ID = 'exam_slot:555855a6'
  const FINGERPRINT = 'fp-falcons-14'
  const SESSION_ID = 'sess-falcons-live'
  const IDENTITY = examGenerationIdentity(SESSION_ID, FINGERPRINT, EXAM_ID)

  // ============================================================
  // CONTRACT 1: Deterministic recomposition transforms the terminal
  // failed slot into short_answer, preserving criteria and attempts.
  // ============================================================
  {
    const blueprint = make14SlotFalconsBlueprint(EXAM_ID)
    const store = new InMemoryExamGenerationStore<any>()

    // Setup fixture: 13 slots ready, exam_slot:555855a6 terminal_failed
    const readyQuestions: any[] = []
    const slotStates: Record<string, ExamSlotState> = {}

    for (const slot of blueprint.slots) {
      if (slot.id === PROBLEM_SLOT_ID) {
        slotStates[slot.id] = {
          status: 'terminal_failed',
          attempts: 2,
          lastFailureReason: 'INVALID_MCQ_OPTIONS: distractor LENGTH_LEAK y desbalance de opciones',
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

    await store.saveManifest(IDENTITY, {
      schemaVersion: 2,
      identity: IDENTITY,
      examId: EXAM_ID,
      fingerprint: FINGERPRINT,
      sessionId: SESSION_ID,
      blueprint: structuredClone(blueprint),
      totalSlots: 14,
      status: 'failed',
      failureReason: `SLOT_UNRESOLVABLE:${PROBLEM_SLOT_ID}`,
      slots: slotStates,
      providerAttemptsBudget: 28,
      providerAttemptsUsed: 15,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await store.saveArtifact(IDENTITY, {
      examId: EXAM_ID,
      fingerprint: FINGERPRINT,
      meta: { status: 'failed', generatedAt: new Date().toISOString() },
      questions: readyQuestions,
    })

    // 1. Assert restore triggers deterministic self-heal
    const restored = await restoreExamGeneration(SESSION_ID, FINGERPRINT, EXAM_ID, store)
    assert.ok(restored, 'Manifest must be restored')
    assert.equal(restored.manifest.status, 'generating', 'Manifest self-heals to generating')
    assert.equal(restored.manifest.failureReason, undefined, 'Failure reason cleared')

    const expectedRecomposedId = `${PROBLEM_SLOT_ID}:recomposed:short_answer`

    // 2. Assert original slot state is superseded_terminal_failed with attempts=2 preserved
    const origState = restored.manifest.slots[PROBLEM_SLOT_ID]
    assert.equal(origState.status, 'superseded_terminal_failed')
    assert.equal(origState.attempts, 2, 'Original attempts must be preserved')
    assert.equal(origState.supersededBySlotId, expectedRecomposedId)

    // 3. Assert replacement slot state is pending with attempts=0 and linked replacesSlotId
    const repState = restored.manifest.slots[expectedRecomposedId]
    assert.ok(repState, 'Recomposed slot must be registered in manifest.slots')
    assert.equal(repState.status, 'pending')
    assert.equal(repState.attempts, 0)
    assert.equal(repState.replacesSlotId, PROBLEM_SLOT_ID)

    // 4. Assert blueprint.slots replaced the slot in-place preserving total count
    assert.equal(restored.manifest.blueprint.slots.length, 14)
    const slotAtIdx1 = restored.manifest.blueprint.slots[1]
    assert.equal(slotAtIdx1.id, expectedRecomposedId)
    assert.equal(slotAtIdx1.type, 'short_answer')
    assert.equal(slotAtIdx1.replacesSlotId, PROBLEM_SLOT_ID)
    assert.equal(slotAtIdx1.answerAuthority.canonicalValue, blueprint.slots[1].answerAuthority.canonicalValue)
    assert.equal(slotAtIdx1.assessmentCriteria?.[0].gradingMode, 'semantic')

    console.log('Contract 1 PASS: Deterministic recomposition correctly self-heals persisted failed manifest.')
  }

  // ============================================================
  // CONTRACT 2: Author ONLY the replacement slot and validate normally.
  // Success produces 14/14 ready questions and manifest becomes 'ready'.
  // ============================================================
  {
    const blueprint = make14SlotFalconsBlueprint(EXAM_ID)
    const store = new InMemoryExamGenerationStore<any>()

    const readyQuestions: any[] = []
    const slotStates: Record<string, ExamSlotState> = {}

    for (const slot of blueprint.slots) {
      if (slot.id === PROBLEM_SLOT_ID) {
        slotStates[slot.id] = {
          status: 'terminal_failed',
          attempts: 2,
          lastFailureReason: 'INVALID_MCQ_OPTIONS: distractor LENGTH_LEAK',
        }
      } else {
        const q = makeMockQuestion(slot)
        readyQuestions.push(q)
        slotStates[slot.id] = { status: 'ready', attempts: 1, questionId: q.id }
      }
    }

    await store.saveManifest(IDENTITY, {
      schemaVersion: 2,
      identity: IDENTITY,
      examId: EXAM_ID,
      fingerprint: FINGERPRINT,
      sessionId: SESSION_ID,
      blueprint: structuredClone(blueprint),
      totalSlots: 14,
      status: 'failed',
      failureReason: `SLOT_UNRESOLVABLE:${PROBLEM_SLOT_ID}`,
      slots: slotStates,
      providerAttemptsBudget: 28,
      providerAttemptsUsed: 15,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    await store.saveArtifact(IDENTITY, {
      examId: EXAM_ID,
      fingerprint: FINGERPRINT,
      meta: { status: 'failed', generatedAt: new Date().toISOString() },
      questions: readyQuestions,
    })

    const targetedSlots: string[] = []
    const generator = async (
      targetSlotIds: string[],
      bp: ExamBlueprint,
      _seed: string,
    ): Promise<GenerateExamSlotBatchOutput<any>> => {
      targetedSlots.push(...targetSlotIds)
      const questions = new Map<string, any>()
      for (const id of targetSlotIds) {
        const slot = bp.slots.find(s => s.id === id)
        if (slot) questions.set(id, makeMockQuestion(slot))
      }
      return questions
    }

    const advanceResult = await advanceExamGeneration(
      SESSION_ID, FINGERPRINT, EXAM_ID, store, generator, { batchSize: 4 },
    )

    const expectedRecomposedId = `${PROBLEM_SLOT_ID}:recomposed:short_answer`

    // Assert ONLY the replacement slot was authored
    assert.deepEqual(targetedSlots, [expectedRecomposedId], 'Must author ONLY the replacement slot')

    // Assert final exam status is ready with 14/14
    assert.equal(advanceResult.status, 'ready')
    assert.equal(advanceResult.manifest.status, 'ready')
    assert.equal(advanceResult.artifact.meta.status, 'ready')
    assert.equal(advanceResult.artifact.questions.length, 14, 'Artifact must have 14 ready questions')

    // Assert original slot is superseded_terminal_failed and replacement slot is ready
    assert.equal(advanceResult.manifest.slots[PROBLEM_SLOT_ID].status, 'superseded_terminal_failed')
    assert.equal(advanceResult.manifest.slots[expectedRecomposedId].status, 'ready')

    // Presentation order: slot at index 1 is the replacement short_answer question
    assert.equal(advanceResult.artifact.questions[1].id, expectedRecomposedId)
    assert.equal(advanceResult.artifact.questions[1].type, 'short_answer')

    console.log('Contract 2 PASS: Replacement slot authored and validated, exam reaches 14/14 ready.')
  }

  // ============================================================
  // CONTRACT 3: Honest failure when no legitimate recomposition exists.
  // ============================================================
  {
    // Case A: slot is already short_answer
    const slotA = makeMockComposedSlot('slot_sa', 0, 'short_answer')
    assert.equal(deterministicallyRecomposeSlot(slotA), null, 'short_answer cannot be recomposed')

    // Case B: slot is already recomposed (max 1 recomposition pass)
    const slotB = makeMockComposedSlot('slot_recomp', 0, 'multiple_choice')
    slotB.replacesSlotId = 'slot_orig'
    assert.equal(deterministicallyRecomposeSlot(slotB), null, 'Already recomposed slot cannot be recomposed again')

    // Case C: slot missing frozen sources
    const slotC = makeMockComposedSlot('slot_no_sources', 0, 'multiple_choice')
    slotC.frozenSources = []
    assert.equal(deterministicallyRecomposeSlot(slotC), null, 'Slot missing sources cannot be recomposed')

    // Case D: slot missing assessment criteria
    const slotD = makeMockComposedSlot('slot_no_crit', 0, 'multiple_choice')
    slotD.assessmentCriteria = []
    assert.equal(deterministicallyRecomposeSlot(slotD), null, 'Slot missing criteria cannot be recomposed')

    // Case E: Genuinely unrecomposable failed manifest remains failed with zero provider calls
    const store = new InMemoryExamGenerationStore<any>()
    const bp = make14SlotFalconsBlueprint('exam-unrecomposable')
    bp.slots[1].type = 'short_answer' // Unrecomposable

    const readyQuestions: any[] = []
    const slotStates: Record<string, ExamSlotState> = {}
    for (const slot of bp.slots) {
      if (slot.id === bp.slots[1].id) {
        slotStates[slot.id] = { status: 'terminal_failed', attempts: 2, lastFailureReason: 'SHORT_ANSWER_VALIDATION_FAILED' }
      } else {
        const q = makeMockQuestion(slot)
        readyQuestions.push(q)
        slotStates[slot.id] = { status: 'ready', attempts: 1, questionId: q.id }
      }
    }

    const id = examGenerationIdentity('sess-unrec', 'fp-falcons-14', 'exam-unrecomposable')
    await store.saveManifest(id, {
      schemaVersion: 2, identity: id, examId: 'exam-unrecomposable', fingerprint: 'fp-falcons-14', sessionId: 'sess-unrec',
      blueprint: bp, totalSlots: 14, status: 'failed', failureReason: `SLOT_UNRESOLVABLE:${bp.slots[1].id}`,
      slots: slotStates, providerAttemptsBudget: 28, providerAttemptsUsed: 15,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    await store.saveArtifact(id, {
      examId: 'exam-unrecomposable', fingerprint: 'fp-falcons-14',
      meta: { status: 'failed', generatedAt: new Date().toISOString() }, questions: readyQuestions,
    })

    let calls = 0
    const resumed = await getOrBuildExamGeneration(
      'sess-unrec', 'fp-falcons-14', 'exam-unrecomposable', bp, store, async () => { calls++; return new Map() },
    )
    assert.equal(resumed.status, 'failed')
    assert.equal(calls, 0, 'Zero provider calls on honestly unrecomposable terminal failure')

    console.log('Contract 3 PASS: Honest failure preserved when recomposition is impossible.')
  }

  // ============================================================
  // CONTRACT 4: Route level integration — advance produces HTTP 200
  // with 14/14 ready questions and full coverage metric.
  // ============================================================
  {
    const originalDeps = { ...__routeDeps }
    try {
      const blueprint = make14SlotFalconsBlueprint(EXAM_ID)
      const store = new InMemoryExamGenerationStore<any>()

      const readyQuestions: any[] = []
      const slotStates: Record<string, ExamSlotState> = {}
      for (const slot of blueprint.slots) {
        if (slot.id === PROBLEM_SLOT_ID) {
          slotStates[slot.id] = {
            status: 'terminal_failed',
            attempts: 2,
            lastFailureReason: 'INVALID_MCQ_OPTIONS: distractor LENGTH_LEAK',
          }
        } else {
          const q = makeMockQuestion(slot)
          readyQuestions.push(q)
          slotStates[slot.id] = { status: 'ready', attempts: 1, questionId: q.id }
        }
      }

      await store.saveManifest(IDENTITY, {
        schemaVersion: 2, identity: IDENTITY, examId: EXAM_ID, fingerprint: FINGERPRINT, sessionId: SESSION_ID,
        blueprint: structuredClone(blueprint), totalSlots: 14, status: 'failed',
        failureReason: `SLOT_UNRESOLVABLE:${PROBLEM_SLOT_ID}`, slots: slotStates,
        providerAttemptsBudget: 28, providerAttemptsUsed: 15,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      })
      await store.saveArtifact(IDENTITY, {
        examId: EXAM_ID, fingerprint: FINGERPRINT,
        meta: { status: 'failed', generatedAt: new Date().toISOString() }, questions: readyQuestions,
      })

      const expectedRecomposedId = `${PROBLEM_SLOT_ID}:recomposed:short_answer`

      Object.assign(__routeDeps, {
        getServerSession: async () => ({ user: { id: 'user-falcons' } }),
        getAuthoritativeFreeSession: async () => ({
          sessionId: SESSION_ID,
          userId: 'user-falcons',
          sourceSelection: {
            materialIds: ['falcons.pdf'],
            selectedPages: { 'falcons.pdf': [1, 2] },
            fingerprint: FINGERPRINT,
          },
        }),
        lookupStudyalMaterialEnjoyer: async () => ({
          sourceSelectionFingerprint: FINGERPRINT,
          materialIds: ['falcons.pdf'],
          selectedPages: { 'falcons.pdf': [1, 2] },
          topicsIndex: [],
          globalOrderedAnalysis: [],
          uniqueConceptsIndex: [],
        }),
        examStore: store,
        gradingStore: new MemoryExamGradingStore(),
        generateValidatedLegacyJson: async (options: any) => {
          // Provider returns short_answer question for the recomposed slot
          return [
            {
              slotId: expectedRecomposedId,
              type: 'short_answer',
              prompt: 'Explica el impacto de Matt Ryan en la estabilidad inmediata de los Falcons en 2008.',
            },
          ]
        },
      })

      const req = new NextRequest('http://localhost/api/alai-studyal-exam', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'advance', sessionId: SESSION_ID, examId: EXAM_ID }),
      })

      const res = await POST(req)
      assert.equal(res.status, 200)
      const data = await res.json()

      assert.equal(data.success, true)
      assert.equal(data.status, 'ready')
      assert.equal(data.readyCount, 14)
      assert.equal(data.totalSlots, 14)
      assert.ok(data.exam)
      assert.equal(data.exam.questions.length, 14)
      assert.equal(data.exam.questions.filter((q: any) => q.ready).length, 14)
      assert.ok(
        data.exam.coverage.includes('14/14 objetivos con criterios de evaluación'),
        `Coverage must report 14/14, got: ${data.exam.coverage}`,
      )

      console.log('Contract 4 PASS: Route advance finishes exam with 14/14 ready questions and 100% coverage.')
    } finally {
      Object.assign(__routeDeps, originalDeps)
    }
  }

  // ============================================================
  // CONTRACT 5: Fresh manifest lifecycle auto-advance (total=22, ready=18, batch=A+X+B+C)
  // Newly terminal slot X immediately transitions to recomposition without reload.
  // Also verifies that an unrecomposable terminal slot ends honestly in failed.
  // ============================================================
  {
    const totalSlots = 22
    const blueprint: ExamBlueprint = {
      schemaVersion: 2,
      generatorVersion: 'enjoyer-exam-evidence-4.0.0',
      authorityType: 'studyal_material_enjoyer',
      authorityVersion: 2,
      examId: 'exam-fresh-22',
      fingerprint: 'fp-bohr-22',
      seed: 'seed-22',
      requestedDurationMinutes: 30,
      durationMinutes: 30,
      effectiveDurationMinutes: 30,
      idealDurationMinutes: 30,
      minimumViableDurationMinutes: 15,
      typeDistribution: { multiple_choice: 22 },
      difficultyDistribution: { medium: 22 },
      expectedCompletionSeconds: 1800,
      totalExamTargets: 22,
      coverageStatus: 'full',
      coverage: {
        coverageStatus: 'full',
        totalUniverseTargets: 22,
        totalConsideredTargets: 22,
        totalTouchedTargets: 22,
        totalAssessedTargets: 22,
        assessedCoveragePercent: 100,
        touchedCoveragePercent: 100,
        consideredCoveragePercent: 100,
        assessedTargetIds: Array.from({ length: 22 }, (_, i) => `target_${i}`),
        touchedTargetIds: Array.from({ length: 22 }, (_, i) => `target_${i}`),
        consideredTargetIds: Array.from({ length: 22 }, (_, i) => `target_${i}`),
        notAssessedDueToScopeTargetIds: [],
      },
      readingBurden: {
        totalReadingWords: 800,
        requestedDurationMinutes: 30,
        readingFractionOfTime: 0.15,
        readingLoadAcceptable: true,
        perSlotWordCount: Array.from({ length: 22 }, () => 40),
      },
      slots: Array.from({ length: 22 }, (_, i) => makeMockComposedSlot(`slot_${i}`, i)),
      materialLanguage: 'es',
      createdAt: new Date().toISOString(),
    }

    const store = new InMemoryExamGenerationStore<any>()
    const id = examGenerationIdentity('sess-fresh', 'fp-bohr-22', 'exam-fresh-22')

    // Initial fresh state: 18 ready questions
    const readyQuestions: any[] = []
    const slotStates: Record<string, ExamSlotState> = {}
    for (let i = 0; i < 18; i++) {
      const q = makeMockQuestion(blueprint.slots[i])
      readyQuestions.push(q)
      slotStates[`slot_${i}`] = { status: 'ready', attempts: 1, questionId: q.id }
    }

    // Slots 18 (A), 19 (X), 20 (B), 21 (C)
    const slotA = blueprint.slots[18].id
    const slotX = blueprint.slots[19].id
    const slotB = blueprint.slots[20].id
    const slotC = blueprint.slots[21].id

    slotStates[slotA] = { status: 'pending', attempts: 0 }
    // Slot X already had attempts fail up to repair stage, so next failure exhausts repair and triggers recomposition
    slotStates[slotX] = { status: 'retryable_failed', attempts: 1, stage: 'stage_2_repair', stageAttempts: 1, lastFailureReason: 'INVALID_MCQ_OPTIONS: distractor LENGTH_LEAK' }
    slotStates[slotB] = { status: 'pending', attempts: 0 }
    slotStates[slotC] = { status: 'pending', attempts: 0 }

    await store.saveManifest(id, {
      schemaVersion: 2, identity: id, examId: 'exam-fresh-22', fingerprint: 'fp-bohr-22', sessionId: 'sess-fresh',
      blueprint: structuredClone(blueprint), totalSlots: 22, status: 'generating',
      slots: slotStates, providerAttemptsBudget: 44, providerAttemptsUsed: 19,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    await store.saveArtifact(id, {
      examId: 'exam-fresh-22', fingerprint: 'fp-bohr-22',
      meta: { status: 'generating', generatedAt: new Date().toISOString() }, questions: readyQuestions,
    })

    const targetedInChunk1: string[] = []
    const generator = async (
      targetSlotIds: string[],
      bp: ExamBlueprint,
      _seed: string,
    ): Promise<GenerateExamSlotBatchOutput<any>> => {
      targetedInChunk1.push(...targetSlotIds)
      const questions = new Map<string, any>()
      const rejections: Record<string, string> = {}
      for (const targetId of targetSlotIds) {
        if (targetId === slotX) {
          // X rejected terminally
          rejections[targetId] = 'INVALID_MCQ_OPTIONS: distractor LENGTH_LEAK'
        } else {
          const slot = bp.slots.find(s => s.id === targetId)
          if (slot) questions.set(targetId, makeMockQuestion(slot))
        }
      }
      return { questions, rejections }
    }

    // Run batch A + X + B + C
    const chunk1Result = await advanceExamGeneration(
      'sess-fresh', 'fp-bohr-22', 'exam-fresh-22',
      store, generator, { batchSize: 4 },
    )

    // Assert batch targeted A, X, B, C
    assert.deepEqual(targetedInChunk1, [slotA, slotX, slotB, slotC])

    // Assert that the SAME lifecycle does NOT return terminal global failure!
    assert.equal(chunk1Result.status, 'generating', 'Lifecycle must return generating (never failed) when X is recomposable')
    assert.equal(chunk1Result.manifest.status, 'generating')
    assert.equal(chunk1Result.artifact.meta.status, 'generating')
    assert.equal(chunk1Result.artifact.questions.length, 21, 'Must have 21 ready questions')

    const expectedRecomposedX = `${slotX}:recomposed:short_answer`

    // Assert persisted state
    const persisted = await store.getManifest(id)
    assert.ok(persisted)
    assert.equal(persisted.slots[slotX].status, 'superseded_terminal_failed', 'Original X must be superseded_terminal_failed')
    assert.equal(persisted.slots[slotX].attempts, 2, 'Original attempts must be preserved')
    assert.equal(persisted.slots[expectedRecomposedX].status, 'pending', 'Replacement X must be pending')
    assert.equal(persisted.slots[expectedRecomposedX].attempts, 0, 'Replacement attempts starts at 0')
    assert.equal(persisted.slots[expectedRecomposedX].replacesSlotId, slotX)
    assert.equal(persisted.status, 'generating')

    // Next advance: must target ONLY [replacement X]
    const targetedInChunk2: string[] = []
    const generator2 = async (
      targetSlotIds: string[],
      bp: ExamBlueprint,
      _seed: string,
    ): Promise<GenerateExamSlotBatchOutput<any>> => {
      targetedInChunk2.push(...targetSlotIds)
      const questions = new Map<string, any>()
      for (const targetId of targetSlotIds) {
        const slot = bp.slots.find(s => s.id === targetId)
        if (slot) questions.set(targetId, makeMockQuestion(slot))
      }
      return questions
    }

    const chunk2Result = await advanceExamGeneration(
      'sess-fresh', 'fp-bohr-22', 'exam-fresh-22',
      store, generator2, { batchSize: 4 },
    )

    assert.deepEqual(targetedInChunk2, [expectedRecomposedX], 'Next advance must target ONLY replacement slot')
    assert.equal(chunk2Result.status, 'ready', 'Exam must reach status ready')
    assert.equal(chunk2Result.manifest.status, 'ready')
    assert.equal(chunk2Result.artifact.questions.length, 22, 'Exam must reach 22/22 ready questions')
    assert.equal(chunk2Result.manifest.slots[expectedRecomposedX].status, 'ready')
    assert.equal(chunk2Result.manifest.slots[slotX].status, 'superseded_terminal_failed')

    // ─── Unrecomposable terminal slot test ───────────────────────
    // Repeat with slot X as short_answer (not legitimately recomposable).
    // Must end honestly in failed.
    const storeUnrec = new InMemoryExamGenerationStore<any>()
    const bpUnrec = structuredClone(blueprint)
    bpUnrec.slots[19].type = 'short_answer' // Unrecomposable
    const idUnrec = examGenerationIdentity('sess-fresh', 'fp-bohr-22', 'exam-fresh-unrec')

    await storeUnrec.saveManifest(idUnrec, {
      schemaVersion: 2, identity: idUnrec, examId: 'exam-fresh-unrec', fingerprint: 'fp-bohr-22', sessionId: 'sess-fresh',
      blueprint: bpUnrec, totalSlots: 22, status: 'generating',
      slots: structuredClone(slotStates), providerAttemptsBudget: 44, providerAttemptsUsed: 19,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    await storeUnrec.saveArtifact(idUnrec, {
      examId: 'exam-fresh-unrec', fingerprint: 'fp-bohr-22',
      meta: { status: 'generating', generatedAt: new Date().toISOString() }, questions: structuredClone(readyQuestions),
    })

    const unrecResult = await advanceExamGeneration(
      'sess-fresh', 'fp-bohr-22', 'exam-fresh-unrec',
      storeUnrec, generator, { batchSize: 4 },
    )

    assert.equal(unrecResult.status, 'failed', 'Unrecomposable slot must honestly transition to failed')
    assert.equal(unrecResult.manifest.status, 'failed')
    assert.ok(unrecResult.manifest.failureReason?.includes(`SLOT_UNRESOLVABLE:${slotX}`))
    assert.equal(unrecResult.artifact.questions.length, 21)

    console.log('Contract 5 PASS: Fresh generation lifecycle auto-advances to recomposition and completes 22/22; unrecomposable honestly fails.')
  }

  console.log('[ALL EXAM TERMINAL SLOT RECOMPOSITION CONTRACTS PASSED]')
}

runTests().catch(err => {
  console.error('[TEST FAILED]', err)
  process.exit(1)
})
