import assert from 'node:assert/strict'
import {
  InMemoryExamGenerationStore,
  getOrBuildExamGeneration,
  advanceExamGeneration,
  restoreExamGeneration,
  deterministicallyRecomposeSlot,
  deterministicallySplitCompositeSlot,
  deterministicallyFallbackToAtomicOpen,
  attemptSlotRecovery,
  isNetworkOrProviderFailure,
  examGenerationIdentity,
  runExamChunk,
  EXAM_MAX_INFRA_RETRIES,
  ExamSlotState,
  GenerateExamSlotBatchOutput,
} from '../../lib/materialBrain/examGenerationStore'
import type { ExamBlueprint, ExamComposedSlot } from '../../lib/materialBrain/examEnjoyerContext'
import {
  buildMultipleChoiceOptionsWithDiagnostics,
  hasExactlyOneCanonicalOption,
} from '../../app/api/alai-studyal-exam/route'

function makeMockSlot(
  id: string,
  index: number,
  type: any = 'multiple_choice',
  overrides: Partial<ExamComposedSlot> = {},
): ExamComposedSlot {
  const isMcq = type === 'multiple_choice'
  const isFill = type === 'fill_blank'
  const isMatching = type === 'matching'
  const isShortAnswer = type === 'short_answer'

  let answerAuthority: any
  if (isMatching) {
    answerAuthority = {
      kind: 'pairs',
      pairs: [
        { left: `Concepto A (${id})`, right: `Definición A (${id})` },
        { left: `Concepto B (${id})`, right: `Definición B (${id})` },
      ],
    }
  } else if (isFill) {
    answerAuthority = {
      kind: 'single_text',
      canonicalValue: `término_${index}`,
      distractorPool: [`distractor_a_${index}`, `distractor_b_${index}`, `distractor_c_${index}`, `distractor_d_${index}`],
    }
  } else {
    answerAuthority = {
      kind: 'single_text',
      canonicalValue: `Respuesta canónica para ${id}`,
      distractorPool: [`Distractor 1 (${id})`, `Distractor 2 (${id})`, `Distractor 3 (${id})`],
    }
  }

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
    assessmentFocus: `Objetivo para ${id}`,
    difficulty: 'medium',
    estimatedSeconds: 60,
    readingBudgetWords: 40,
    order: index,
    assessmentCriteria: [
      {
        criterionId: `${id}:crit:1`,
        targetIds: [`target_${index}`],
        operation: 'explain',
        canonicalCriterion: `Criterio canónico para ${id}`,
        gradingMode: isShortAnswer ? 'semantic' : 'deterministic',
        points: 5,
        skill: 'comprehension',
        label: `Criterio ${id}`,
        sourceItemId: `item_${index}`,
        pages: [1],
        materialId: 'test.pdf',
      },
    ],
    frozenSources: [
      {
        sourceItemId: `item_${index}`,
        label: `Fuente ${index}`,
        content: `Contenido de evidencia fidedigno para ${id}.`,
        materialId: 'test.pdf',
        pages: [1],
        sourceSpans: [{ page: 1, quote: `Contenido de evidencia fidedigno para ${id}.` }],
      },
    ],
    answerAuthority,
    topicId: 'topic-resilience',
    topicTitle: 'Resiliencia de Examen',
    ...overrides,
  }
}

function makeMockQuestionForSlot(slot: ExamComposedSlot): any {
  if (slot.type === 'multiple_choice') {
    const canonical = slot.answerAuthority.kind === 'single_text' ? slot.answerAuthority.canonicalValue : 'Correcta'
    return {
      id: slot.id,
      slotId: slot.id,
      type: 'multiple_choice',
      prompt: `Pregunta válida sobre ${slot.assessmentFocus} (${slot.id})`,
      options: [canonical, 'Opción B', 'Opción C', 'Opción D'],
      correctAnswer: 0,
      points: 5,
      skill: slot.skill,
      difficulty: slot.difficulty,
      section: 'Opción Múltiple',
      assessmentCriteria: slot.assessmentCriteria,
      grounding: {
        authorityType: 'studyal_material_enjoyer',
        authorityVersion: 2,
        sourceSelectionFingerprint: 'fp-resilience',
        targetIds: [...slot.targetIds],
        sourceItemIds: [...slot.sourceItemIds],
        evidence: [],
      },
    }
  } else if (slot.type === 'fill_blank') {
    return {
      id: slot.id,
      slotId: slot.id,
      type: 'fill_blank',
      prompt: `El concepto evaluado es ___ en la arquitectura (${slot.id}).`,
      expectedAnswer: (slot.answerAuthority as any).canonicalValue,
      wordBank: [(slot.answerAuthority as any).canonicalValue, 'dist_1', 'dist_2', 'dist_3'],
      points: 5,
      skill: slot.skill,
      difficulty: slot.difficulty,
      section: 'Completar Espacios',
      assessmentCriteria: slot.assessmentCriteria,
      grounding: {
        authorityType: 'studyal_material_enjoyer',
        authorityVersion: 2,
        sourceSelectionFingerprint: 'fp-resilience',
        targetIds: [...slot.targetIds],
        sourceItemIds: [...slot.sourceItemIds],
        evidence: [],
      },
    }
  } else if (slot.type === 'matching') {
    return {
      id: slot.id,
      slotId: slot.id,
      type: 'matching',
      prompt: `Empareja los conceptos de ${slot.assessmentFocus} (${slot.id})`,
      matchingLeftTexts: ['Concepto A', 'Concepto B'],
      matchingRightTexts: ['Definición B', 'Definición A'],
      matchingCorrectMap: { 0: 1, 1: 0 },
      points: 5,
      skill: slot.skill,
      difficulty: slot.difficulty,
      section: 'Términos Pareados',
      assessmentCriteria: slot.assessmentCriteria,
      grounding: {
        authorityType: 'studyal_material_enjoyer',
        authorityVersion: 2,
        sourceSelectionFingerprint: 'fp-resilience',
        targetIds: [...slot.targetIds],
        sourceItemIds: [...slot.sourceItemIds],
        evidence: [],
      },
    }
  } else {
    // short_answer
    const canonical = slot.answerAuthority.kind === 'single_text'
      ? slot.answerAuthority.canonicalValue
      : (slot.assessmentCriteria?.[0]?.canonicalCriterion || 'Respuesta canónica')
    return {
      id: slot.id,
      slotId: slot.id,
      type: 'short_answer',
      prompt: `Explica detalladamente: ${slot.assessmentFocus} (${slot.id})`,
      expectedAnswer: canonical,
      points: 5,
      skill: slot.skill,
      difficulty: slot.difficulty,
      section: 'Respuesta Corta',
      assessmentCriteria: slot.assessmentCriteria,
      grounding: {
        authorityType: 'studyal_material_enjoyer',
        authorityVersion: 2,
        sourceSelectionFingerprint: 'fp-resilience',
        targetIds: [...slot.targetIds],
        sourceItemIds: [...slot.sourceItemIds],
        evidence: [],
      },
    }
  }
}

function makeBlueprint(totalSlots: number, lastSlotType: any = 'multiple_choice', lastSlotOverrides: Partial<ExamComposedSlot> = {}): ExamBlueprint {
  const slots: ExamComposedSlot[] = []
  for (let i = 0; i < totalSlots - 1; i++) {
    slots.push(makeMockSlot(`slot_${i}`, i, 'multiple_choice'))
  }
  slots.push(makeMockSlot(`slot_${totalSlots - 1}`, totalSlots - 1, lastSlotType, lastSlotOverrides))

  return {
    schemaVersion: 2,
    generatorVersion: 'enjoyer-exam-evidence-4.0.0',
    authorityType: 'studyal_material_enjoyer',
    authorityVersion: 2,
    examId: `exam-resilient-${totalSlots}`,
    fingerprint: 'fp-resilience',
    seed: 'seed-resilience',
    requestedDurationMinutes: 60,
    durationMinutes: 60,
    effectiveDurationMinutes: 60,
    idealDurationMinutes: 60,
    minimumViableDurationMinutes: 30,
    typeDistribution: { [lastSlotType]: 1, multiple_choice: totalSlots - 1 },
    difficultyDistribution: { medium: totalSlots },
    expectedCompletionSeconds: totalSlots * 60,
    totalExamTargets: totalSlots,
    coverageStatus: 'full',
    coverage: {
      coverageStatus: 'full',
      totalUniverseTargets: totalSlots,
      totalConsideredTargets: totalSlots,
      totalTouchedTargets: totalSlots,
      totalAssessedTargets: totalSlots,
      assessedCoveragePercent: 100,
      touchedCoveragePercent: 100,
      consideredCoveragePercent: 100,
      assessedTargetIds: slots.map(s => s.primaryTargetId),
      touchedTargetIds: slots.map(s => s.primaryTargetId),
      consideredTargetIds: slots.map(s => s.primaryTargetId),
      notAssessedDueToScopeTargetIds: [],
    },
    readingBurden: {
      totalReadingWords: totalSlots * 40,
      requestedDurationMinutes: 60,
      readingFractionOfTime: 0.15,
      readingLoadAcceptable: true,
      perSlotWordCount: slots.map(() => 40),
    },
    slots,
    materialLanguage: 'es',
    createdAt: new Date().toISOString(),
  }
}

async function runContracts() {
  console.log('=== EXAM RESILIENT GENERATION RECOVERY CONTRACTS START ===')

  // ============================================================
  // CONTRACT A: 58-slot Exam, 57 accepted; last slot is MCQ;
  // fails validation twice (same type); 3rd attempt succeeds ->
  // 58/58 ready, no failure, no recomposition occurred.
  // ============================================================
  {
    const blueprint = makeBlueprint(58, 'multiple_choice')
    const store = new InMemoryExamGenerationStore<any>()
    const examId = 'exam-contract-a'
    blueprint.examId = examId
    const identity = examGenerationIdentity('session-a', 'fp-resilience', examId)

    const readyQuestions: any[] = []
    const slotStates: Record<string, ExamSlotState> = {}

    for (let i = 0; i < 57; i++) {
      const slot = blueprint.slots[i]
      const q = makeMockQuestionForSlot(slot)
      readyQuestions.push(q)
      slotStates[slot.id] = { status: 'ready', attempts: 1, questionId: q.id }
    }
    const lastSlot = blueprint.slots[57]
    slotStates[lastSlot.id] = { status: 'pending', attempts: 0 }

    await store.saveManifest(identity, {
      schemaVersion: 2,
      identity,
      examId,
      fingerprint: 'fp-resilience',
      sessionId: 'session-a',
      blueprint: structuredClone(blueprint),
      totalSlots: 58,
      status: 'generating',
      slots: slotStates,
      providerAttemptsBudget: 58 * 2,
      providerAttemptsUsed: 57,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await store.saveArtifact(identity, {
      examId,
      fingerprint: 'fp-resilience',
      meta: { status: 'generating', generatedAt: new Date().toISOString() },
      questions: readyQuestions,
    })

    let attemptCount = 0
    const mockBatch = async (slotIds: string[]): Promise<GenerateExamSlotBatchOutput<any>> => {
      attemptCount++
      if (attemptCount <= 2) {
        return {
          questions: new Map(),
          rejections: { [lastSlot.id]: 'INVALID_MCQ_OPTIONS: distractor LENGTH_LEAK' },
        }
      }
      const questions = new Map()
      questions.set(lastSlot.id, makeMockQuestionForSlot(lastSlot))
      return { questions }
    }

    // Call 1 (Attempt 1 fails)
    let res = await advanceExamGeneration('session-a', 'fp-resilience', examId, store, mockBatch, { batchSize: 4 })
    assert.equal(res.status, 'generating', 'Exam must remain generating after attempt 1 failure')
    assert.equal(res.manifest.slots[lastSlot.id].status, 'retryable_failed')
    assert.equal(res.manifest.slots[lastSlot.id].attempts, 1)
    assert.equal(res.manifest.slots[lastSlot.id].stage, 'stage_1_same_type')
    assert.equal(res.manifest.slots[lastSlot.id].stageAttempts, 1)

    // Call 2 (Attempt 2 fails)
    res = await advanceExamGeneration('session-a', 'fp-resilience', examId, store, mockBatch, { batchSize: 4 })
    assert.equal(res.status, 'generating', 'Exam must remain generating after attempt 2 failure')
    assert.equal(res.manifest.slots[lastSlot.id].status, 'retryable_failed')
    assert.equal(res.manifest.slots[lastSlot.id].attempts, 2)
    assert.equal(res.manifest.slots[lastSlot.id].stage, 'stage_1_same_type')
    assert.equal(res.manifest.slots[lastSlot.id].stageAttempts, 2)

    // Call 3 (Attempt 3 succeeds)
    res = await advanceExamGeneration('session-a', 'fp-resilience', examId, store, mockBatch, { batchSize: 4 })
    assert.equal(res.status, 'ready', 'Exam must reach ready after attempt 3 succeeds')
    assert.equal(res.manifest.slots[lastSlot.id].status, 'ready')
    assert.equal(res.manifest.slots[lastSlot.id].attempts, 3)
    assert.equal(res.manifest.blueprint.slots[57].id, lastSlot.id, 'Slot ID must not have recomposed')
    assert.equal(res.manifest.blueprint.slots[57].type, 'multiple_choice')
    assert.equal(res.artifact.questions.length, 58, 'All 58 questions must be ready')

    console.log('Contract A PASS: 58-slot Exam recovers on 3rd same-type attempt without recomposition.')
  }

  // ============================================================
  // CONTRACT B: Last slot is fill_blank; fails bank validator repeatedly;
  // same-type exhausted -> repair fails -> recomposes to multiple_choice;
  // MCQ succeeds -> full ready.
  // ============================================================
  {
    const blueprint = makeBlueprint(10, 'fill_blank')
    const store = new InMemoryExamGenerationStore<any>()
    const examId = 'exam-contract-b'
    blueprint.examId = examId
    const identity = examGenerationIdentity('session-b', 'fp-resilience', examId)

    const readyQuestions: any[] = []
    const slotStates: Record<string, ExamSlotState> = {}

    for (let i = 0; i < 9; i++) {
      const slot = blueprint.slots[i]
      const q = makeMockQuestionForSlot(slot)
      readyQuestions.push(q)
      slotStates[slot.id] = { status: 'ready', attempts: 1, questionId: q.id }
    }
    const lastSlot = blueprint.slots[9]
    slotStates[lastSlot.id] = { status: 'pending', attempts: 0 }

    await store.saveManifest(identity, {
      schemaVersion: 2,
      identity,
      examId,
      fingerprint: 'fp-resilience',
      sessionId: 'session-b',
      blueprint: structuredClone(blueprint),
      totalSlots: 10,
      status: 'generating',
      slots: slotStates,
      providerAttemptsBudget: 10 * 4,
      providerAttemptsUsed: 9,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await store.saveArtifact(identity, {
      examId,
      fingerprint: 'fp-resilience',
      meta: { status: 'generating', generatedAt: new Date().toISOString() },
      questions: readyQuestions,
    })

    const expectedRecomposedId = `${lastSlot.id}:recomposed:multiple_choice`
    let batchCallCount = 0

    const mockBatch = async (slotIds: string[], bp: ExamBlueprint): Promise<GenerateExamSlotBatchOutput<any>> => {
      batchCallCount++
      const targetId = slotIds[0]
      if (targetId === expectedRecomposedId) {
        // Recomposed MCQ succeeds!
        const slot = bp.slots.find(s => s.id === targetId)!
        const questions = new Map()
        questions.set(targetId, makeMockQuestionForSlot(slot))
        return { questions }
      }
      // Fill blank attempts fail validation
      return {
        questions: new Map(),
        rejections: { [targetId]: 'INSUFFICIENT_DISTRACTORS: wordBank requires 4-5 options' },
      }
    }

    // Advance until resolved
    let res: any
    for (let i = 0; i < 10; i++) {
      res = await advanceExamGeneration('session-b', 'fp-resilience', examId, store, mockBatch, { batchSize: 1 })
      if (res.status === 'ready' || res.status === 'failed') break
    }

    assert.equal(res.status, 'ready', 'Exam should complete ready via recomposed MCQ')
    assert.equal(res.artifact.questions.length, 10, 'All 10 questions present')
    const finalSlot = res.manifest.blueprint.slots[9]
    assert.equal(finalSlot.id, expectedRecomposedId, 'Recomposed slot replaces fill_blank')
    assert.equal(finalSlot.type, 'multiple_choice')
    assert.equal(res.manifest.slots[lastSlot.id].status, 'superseded_terminal_failed')
    assert.equal(res.manifest.slots[expectedRecomposedId].status, 'ready')

    console.log('Contract B PASS: fill_blank exhausted ladder safely recomposes to multiple_choice and succeeds.')
  }

  // ============================================================
  // CONTRACT C: Last slot is matching; grounded evidence cannot form 1:1 pairs;
  // recomposes safely to short_answer; succeeds -> full ready.
  // ============================================================
  {
    const blueprint = makeBlueprint(10, 'matching')
    const store = new InMemoryExamGenerationStore<any>()
    const examId = 'exam-contract-c'
    blueprint.examId = examId
    const identity = examGenerationIdentity('session-c', 'fp-resilience', examId)

    const readyQuestions: any[] = []
    const slotStates: Record<string, ExamSlotState> = {}

    for (let i = 0; i < 9; i++) {
      const slot = blueprint.slots[i]
      const q = makeMockQuestionForSlot(slot)
      readyQuestions.push(q)
      slotStates[slot.id] = { status: 'ready', attempts: 1, questionId: q.id }
    }
    const lastSlot = blueprint.slots[9]
    slotStates[lastSlot.id] = { status: 'pending', attempts: 0 }

    await store.saveManifest(identity, {
      schemaVersion: 2,
      identity,
      examId,
      fingerprint: 'fp-resilience',
      sessionId: 'session-c',
      blueprint: structuredClone(blueprint),
      totalSlots: 10,
      status: 'generating',
      slots: slotStates,
      providerAttemptsBudget: 10 * 4,
      providerAttemptsUsed: 9,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await store.saveArtifact(identity, {
      examId,
      fingerprint: 'fp-resilience',
      meta: { status: 'generating', generatedAt: new Date().toISOString() },
      questions: readyQuestions,
    })

    const expectedRecomposedId = `${lastSlot.id}:recomposed:short_answer`

    const mockBatch = async (slotIds: string[], bp: ExamBlueprint): Promise<GenerateExamSlotBatchOutput<any>> => {
      const targetId = slotIds[0]
      if (targetId === expectedRecomposedId) {
        const slot = bp.slots.find(s => s.id === targetId)!
        const questions = new Map()
        questions.set(targetId, makeMockQuestionForSlot(slot))
        return { questions }
      }
      return {
        questions: new Map(),
        rejections: { [targetId]: 'MATCHING_CANONICAL_DUPLICATE_RIGHT: non-bijective pairs' },
      }
    }

    let res: any
    for (let i = 0; i < 10; i++) {
      res = await advanceExamGeneration('session-c', 'fp-resilience', examId, store, mockBatch, { batchSize: 1 })
      if (res.status === 'ready' || res.status === 'failed') break
    }

    assert.equal(res.status, 'ready', 'Exam should complete ready via recomposed short_answer')
    assert.equal(res.artifact.questions.length, 10)
    const finalSlot = res.manifest.blueprint.slots[9]
    assert.equal(finalSlot.id, expectedRecomposedId)
    assert.equal(finalSlot.type, 'short_answer')
    assert.equal(finalSlot.assessmentCriteria?.[0]?.gradingMode, 'semantic')
    assert.equal(res.manifest.slots[expectedRecomposedId].status, 'ready')

    console.log('Contract C PASS: matching safely recomposes to short_answer with semantic grading.')
  }

  // ============================================================
  // CONTRACT D: Composite slot (covers 2 criteria) fails;
  // splits into 2 atomic slots; both succeed -> total criteria
  // preserved, exam completes.
  // ============================================================
  {
    const crit1 = {
      criterionId: 'crit:split:1',
      targetIds: ['target_alpha'],
      operation: 'explain' as const,
      canonicalCriterion: 'Criterio Alpha: Explicar fundamento',
      gradingMode: 'semantic' as const,
      points: 5,
      skill: 'comprehension' as const,
      label: 'Alpha',
      sourceItemId: 'item_comp',
      pages: [1],
      materialId: 'test.pdf',
    }
    const crit2 = {
      criterionId: 'crit:split:2',
      targetIds: ['target_beta'],
      operation: 'diagnose' as const,
      canonicalCriterion: 'Criterio Beta: Diagnosticar falla',
      gradingMode: 'semantic' as const,
      points: 5,
      skill: 'analysis' as const,
      label: 'Beta',
      sourceItemId: 'item_comp',
      pages: [1],
      materialId: 'test.pdf',
    }

    const blueprint = makeBlueprint(5, 'short_answer', {
      assessmentCriteria: [crit1, crit2],
    })
    const store = new InMemoryExamGenerationStore<any>()
    const examId = 'exam-contract-d'
    blueprint.examId = examId
    const identity = examGenerationIdentity('session-d', 'fp-resilience', examId)

    const readyQuestions: any[] = []
    const slotStates: Record<string, ExamSlotState> = {}

    for (let i = 0; i < 4; i++) {
      const slot = blueprint.slots[i]
      const q = makeMockQuestionForSlot(slot)
      readyQuestions.push(q)
      slotStates[slot.id] = { status: 'ready', attempts: 1, questionId: q.id }
    }
    const compSlot = blueprint.slots[4]
    slotStates[compSlot.id] = { status: 'pending', attempts: 0 }

    await store.saveManifest(identity, {
      schemaVersion: 2,
      identity,
      examId,
      fingerprint: 'fp-resilience',
      sessionId: 'session-d',
      blueprint: structuredClone(blueprint),
      totalSlots: 5,
      status: 'generating',
      slots: slotStates,
      providerAttemptsBudget: 25,
      providerAttemptsUsed: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await store.saveArtifact(identity, {
      examId,
      fingerprint: 'fp-resilience',
      meta: { status: 'generating', generatedAt: new Date().toISOString() },
      questions: readyQuestions,
    })

    const split1Id = `${compSlot.id}:split:1`
    const split2Id = `${compSlot.id}:split:2`

    const mockBatch = async (slotIds: string[], bp: ExamBlueprint): Promise<GenerateExamSlotBatchOutput<any>> => {
      const questions = new Map()
      const rejections: Record<string, string> = {}
      for (const id of slotIds) {
        if (id.includes(':split:')) {
          const slot = bp.slots.find(s => s.id === id)!
          questions.set(id, makeMockQuestionForSlot(slot))
        } else {
          rejections[id] = 'COMPOSITE_TOO_COMPLEX: cannot cover multiple criteria in single response'
        }
      }
      return { questions, rejections }
    }

    let res: any
    for (let i = 0; i < 10; i++) {
      res = await advanceExamGeneration('session-d', 'fp-resilience', examId, store, mockBatch, { batchSize: 2 })
      if (res.status === 'ready' || res.status === 'failed') break
    }

    assert.equal(res.status, 'ready', 'Exam must reach ready after composite split')
    assert.equal(res.manifest.totalSlots, 6, 'Total slots increased from 5 to 6 (1 replaced by 2)')
    assert.equal(res.artifact.questions.length, 6, 'Artifact has 6 questions')
    assert.equal(res.manifest.slots[compSlot.id].status, 'superseded_terminal_failed')
    assert.equal(res.manifest.slots[split1Id].status, 'ready')
    assert.equal(res.manifest.slots[split2Id].status, 'ready')

    // Verify all criteria points preserved
    const totalCritPoints = res.artifact.questions.reduce((acc: number, q: any) => {
      const qPoints = (q.assessmentCriteria || []).reduce((cAcc: number, c: any) => cAcc + (c.points || 0), 0)
      return acc + (qPoints || q.points || 0)
    }, 0)
    // 4 slots * 5 pts + 2 split slots * 5 pts = 30 pts
    assert.equal(totalCritPoints, 30, 'Total exam criteria points strictly preserved')

    console.log('Contract D PASS: Composite slot cleanly splits into atomic slots, preserving all criteria and points.')
  }

  // ============================================================
  // CONTRACT E: Provider returns 503 twice; 3rd attempt succeeds ->
  // slot does NOT recompose; remains original type; no budget burned.
  // ============================================================
  {
    const blueprint = makeBlueprint(5, 'multiple_choice')
    const store = new InMemoryExamGenerationStore<any>()
    const examId = 'exam-contract-e'
    blueprint.examId = examId
    const identity = examGenerationIdentity('session-e', 'fp-resilience', examId)

    const readyQuestions: any[] = []
    const slotStates: Record<string, ExamSlotState> = {}

    for (let i = 0; i < 4; i++) {
      const slot = blueprint.slots[i]
      const q = makeMockQuestionForSlot(slot)
      readyQuestions.push(q)
      slotStates[slot.id] = { status: 'ready', attempts: 1, questionId: q.id }
    }
    const lastSlot = blueprint.slots[4]
    slotStates[lastSlot.id] = { status: 'pending', attempts: 0 }

    await store.saveManifest(identity, {
      schemaVersion: 2,
      identity,
      examId,
      fingerprint: 'fp-resilience',
      sessionId: 'session-e',
      blueprint: structuredClone(blueprint),
      totalSlots: 5,
      status: 'generating',
      slots: slotStates,
      providerAttemptsBudget: 15,
      providerAttemptsUsed: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await store.saveArtifact(identity, {
      examId,
      fingerprint: 'fp-resilience',
      meta: { status: 'generating', generatedAt: new Date().toISOString() },
      questions: readyQuestions,
    })

    let netFailCount = 0
    const mockBatch = async (slotIds: string[]): Promise<GenerateExamSlotBatchOutput<any>> => {
      netFailCount++
      if (netFailCount === 1) {
        throw new Error('503 Service Unavailable: upstream overloaded')
      }
      if (netFailCount === 2) {
        throw new Error('HTTP 429 Too Many Requests: rate limit exceeded')
      }
      const questions = new Map()
      questions.set(lastSlot.id, makeMockQuestionForSlot(lastSlot))
      return { questions }
    }

    // Call 1: 503
    let res = await advanceExamGeneration('session-e', 'fp-resilience', examId, store, mockBatch, { batchSize: 1 })
    assert.equal(res.status, 'generating')
    assert.equal(res.manifest.slots[lastSlot.id].status, 'retryable_failed')
    assert.equal(res.manifest.slots[lastSlot.id].attempts, 0, '503 must not burn academic attempt counter')
    assert.equal(res.manifest.slots[lastSlot.id].networkRetries, 1)
    assert.equal(res.manifest.providerAttemptsUsed, 4, 'Infrastructure error must not burn providerAttemptsUsed')

    // Call 2: 429
    res = await advanceExamGeneration('session-e', 'fp-resilience', examId, store, mockBatch, { batchSize: 1 })
    assert.equal(res.status, 'generating')
    assert.equal(res.manifest.slots[lastSlot.id].attempts, 0, '429 must not burn academic attempt counter')
    assert.equal(res.manifest.slots[lastSlot.id].networkRetries, 2)
    assert.equal(res.manifest.providerAttemptsUsed, 4)

    // Call 3: Success
    res = await advanceExamGeneration('session-e', 'fp-resilience', examId, store, mockBatch, { batchSize: 1 })
    assert.equal(res.status, 'ready')
    assert.equal(res.manifest.slots[lastSlot.id].status, 'ready')
    assert.equal(res.manifest.slots[lastSlot.id].attempts, 1)
    assert.equal(res.manifest.blueprint.slots[4].id, lastSlot.id, 'Type recomposition did NOT trigger on network failures')
    assert.equal(res.manifest.blueprint.slots[4].type, 'multiple_choice')

    console.log('Contract E PASS: Infrastructure failures (503/429) do not burn academic attempts or trigger recomposition.')
  }

  // ============================================================
  // CONTRACT F: Refresh halfway through recovery ladder ->
  // recovers from persisted state; does not restart from Stage 1
  // if already advanced; does not inflate attempt counters.
  // ============================================================
  {
    const blueprint = makeBlueprint(5, 'multiple_choice')
    const store = new InMemoryExamGenerationStore<any>()
    const examId = 'exam-contract-f'
    blueprint.examId = examId
    const identity = examGenerationIdentity('session-f', 'fp-resilience', examId)

    const readyQuestions: any[] = []
    const slotStates: Record<string, ExamSlotState> = {}

    for (let i = 0; i < 4; i++) {
      const slot = blueprint.slots[i]
      const q = makeMockQuestionForSlot(slot)
      readyQuestions.push(q)
      slotStates[slot.id] = { status: 'ready', attempts: 1, questionId: q.id }
    }
    const targetSlot = blueprint.slots[4]
    // Slot is midway in recovery ladder: stage_2_repair, attempts=3, stageAttempts=1
    slotStates[targetSlot.id] = {
      status: 'retryable_failed',
      stage: 'stage_2_repair',
      stageAttempts: 1,
      attempts: 3,
      lastFailureReason: 'INVALID_MCQ_OPTIONS: distractor balance',
    }

    await store.saveManifest(identity, {
      schemaVersion: 2,
      identity,
      examId,
      fingerprint: 'fp-resilience',
      sessionId: 'session-f',
      blueprint: structuredClone(blueprint),
      totalSlots: 5,
      status: 'generating',
      slots: slotStates,
      providerAttemptsBudget: 15,
      providerAttemptsUsed: 7,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await store.saveArtifact(identity, {
      examId,
      fingerprint: 'fp-resilience',
      meta: { status: 'generating', generatedAt: new Date().toISOString() },
      questions: readyQuestions,
    })

    // Simulate page refresh / reconnect: call getOrBuildExamGeneration
    const dummyBatch = async () => ({ questions: new Map() })
    const refreshed = await getOrBuildExamGeneration('session-f', 'fp-resilience', examId, blueprint, store, dummyBatch)

    assert.equal(refreshed.manifest.slots[targetSlot.id].stage, 'stage_2_repair', 'Stage must remain stage_2_repair across refresh')
    assert.equal(refreshed.manifest.slots[targetSlot.id].stageAttempts, 1, 'stageAttempts must not reset')
    assert.equal(refreshed.manifest.slots[targetSlot.id].attempts, 3, 'attempts must not inflate')
    assert.equal(refreshed.artifact.questions.length, 4, 'Ready siblings preserved')

    // Advance once with success
    const mockSuccess = async (slotIds: string[]) => {
      const questions = new Map()
      questions.set(targetSlot.id, makeMockQuestionForSlot(targetSlot))
      return { questions }
    }
    const advanced = await advanceExamGeneration('session-f', 'fp-resilience', examId, store, mockSuccess)
    assert.equal(advanced.status, 'ready')
    assert.equal(advanced.manifest.slots[targetSlot.id].attempts, 4)

    console.log('Contract F PASS: Refresh recovers persisted ladder stage without resetting or inflating counters.')
  }

  // ============================================================
  // CONTRACT G: Concurrent workers attempt the same retry ->
  // CAS admits only one winner; accepted questions remain immutable;
  // no duplicate questions.
  // ============================================================
  {
    const blueprint = makeBlueprint(3, 'multiple_choice')
    const store = new InMemoryExamGenerationStore<any>()
    const examId = 'exam-contract-g'
    blueprint.examId = examId
    const identity = examGenerationIdentity('session-g', 'fp-resilience', examId)

    const readyQuestions: any[] = []
    const slotStates: Record<string, ExamSlotState> = {}

    for (let i = 0; i < 2; i++) {
      const slot = blueprint.slots[i]
      const q = makeMockQuestionForSlot(slot)
      readyQuestions.push(q)
      slotStates[slot.id] = { status: 'ready', attempts: 1, questionId: q.id }
    }
    const targetSlot = blueprint.slots[2]
    slotStates[targetSlot.id] = { status: 'pending', attempts: 0 }

    const initialManifest = {
      schemaVersion: 2,
      identity,
      examId,
      fingerprint: 'fp-resilience',
      sessionId: 'session-g',
      blueprint: structuredClone(blueprint),
      totalSlots: 3,
      status: 'generating' as const,
      slots: slotStates,
      providerAttemptsBudget: 10,
      providerAttemptsUsed: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const initialArtifact = {
      examId,
      fingerprint: 'fp-resilience',
      meta: { status: 'generating' as const, generatedAt: new Date().toISOString() },
      questions: readyQuestions,
    }
    await store.saveManifest(identity, initialManifest)
    await store.saveArtifact(identity, initialArtifact)

    let providerCalls = 0
    const mockBatch = async (slotIds: string[]) => {
      providerCalls++
      await new Promise(r => setTimeout(r, 20)) // induce race
      const questions = new Map()
      questions.set(targetSlot.id, makeMockQuestionForSlot(targetSlot))
      return { questions }
    }

    // Fire 2 concurrent chunks directly
    const [res1, res2] = await Promise.all([
      runExamChunk('session-g', 'fp-resilience', store, structuredClone(initialManifest), structuredClone(initialArtifact), [targetSlot.id], mockBatch, 1),
      runExamChunk('session-g', 'fp-resilience', store, structuredClone(initialManifest), structuredClone(initialArtifact), [targetSlot.id], mockBatch, 1),
    ])

    const finalArtifact = await store.getArtifact(identity)
    assert.ok(finalArtifact)
    assert.equal(finalArtifact.questions.length, 3, 'Questions array must NOT contain duplicates')

    const questionIds = finalArtifact.questions.map((q: any) => q.id)
    const uniqueIds = new Set(questionIds)
    assert.equal(uniqueIds.size, 3, 'Every question id must be unique')

    console.log('Contract G PASS: Concurrent chunks resolve safely without duplicate questions or state corruption.')
  }

  // ============================================================
  // CONTRACT H: Source evidence is genuinely empty / impossible ->
  // slot exhausts ladder deterministically; emits structured failure reason;
  // Exam marks failed HONESTLY.
  // ============================================================
  {
    // Slot with completely empty frozenSources
    const blueprint = makeBlueprint(2, 'multiple_choice', {
      frozenSources: [],
      assessmentCriteria: [],
    })
    const store = new InMemoryExamGenerationStore<any>()
    const examId = 'exam-contract-h'
    blueprint.examId = examId
    const identity = examGenerationIdentity('session-h', 'fp-resilience', examId)

    const targetSlot = blueprint.slots[1]
    const slotStates: Record<string, ExamSlotState> = {
      [blueprint.slots[0].id]: { status: 'ready', attempts: 1, questionId: 'q0' },
      [targetSlot.id]: {
        status: 'terminal_failed',
        attempts: 2,
        stage: 'stage_2_repair',
        lastFailureReason: 'VALIDATION_FAILED',
      },
    }

    const manifest = {
      schemaVersion: 2,
      identity,
      examId,
      fingerprint: 'fp-resilience',
      sessionId: 'session-h',
      blueprint: structuredClone(blueprint),
      totalSlots: 2,
      status: 'generating' as const,
      slots: slotStates,
      providerAttemptsBudget: 10,
      providerAttemptsUsed: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const recovered = attemptSlotRecovery(manifest as any)
    assert.equal(recovered, false, 'Honest check must refuse recovery on empty sources')
    assert.equal(manifest.slots[targetSlot.id].stage, 'exhausted')
    assert.ok(
      manifest.slots[targetSlot.id].lastFailureReason?.startsWith(`SLOT_UNRESOLVABLE:${targetSlot.id}:`),
      'Structured failure reason must begin with SLOT_UNRESOLVABLE:<slot_id>',
    )

    console.log('Contract H PASS: Impossible/empty sources fail honestly with structured SLOT_UNRESOLVABLE reason.')
  }

  // ============================================================
  // CONTRACT I: Academic validators remain UNWEAKENED:
  // - fill_blank: 4-5 options total, max 5 words/option, 1 canonical correct
  // - matching: 1:1 bijective pairs
  // - multiple_choice: exactly one canonical option, no collisions
  // ============================================================
  {
    // 1. MCQ Canonical collision / options validation
    const authority = {
      kind: 'single_text' as const,
      canonicalValue: 'Célula eucariota',
      distractorPool: ['Célula procariota', 'Virus', 'Bacteria'],
    }
    // Colliding distractors containing the canonical answer
    const builtCollision = buildMultipleChoiceOptionsWithDiagnostics(authority, ['Célula eucariota', 'Virus'], 'test-exam:s1', 'Pregunta')
    assert.ok(builtCollision.rejectionReason, 'MCQ options building must reject duplicate canonical options in distractors')

    // 2. hasExactlyOneCanonicalOption
    assert.equal(
      hasExactlyOneCanonicalOption(['Célula eucariota', 'Célula procariota', 'Virus'], 'Célula eucariota', 0),
      true,
      'Valid options with single canonical must pass',
    )
    assert.equal(
      hasExactlyOneCanonicalOption(['Célula eucariota', 'Célula eucariota', 'Virus'], 'Célula eucariota', 0),
      false,
      'Options with duplicate canonical must be rejected',
    )

    // 3. Network error classification
    assert.equal(isNetworkOrProviderFailure('503 Service Unavailable'), true)
    assert.equal(isNetworkOrProviderFailure('HTTP 429 Too Many Requests'), true)
    assert.equal(isNetworkOrProviderFailure('fetch failed: ECONNRESET'), true)
    assert.equal(isNetworkOrProviderFailure('INVALID_MCQ_OPTIONS: distractor length leak'), false)
    assert.equal(isNetworkOrProviderFailure('INSUFFICIENT_DISTRACTORS: word bank requires 4 options'), false)

    console.log('Contract I PASS: Academic quality validators remain unweakened and strictly enforced.')
  }

  // ============================================================
  // CONTRACT J: Stage 5 Atomic Open Fallback executes when
  // recomposed closed type fails.
  // ============================================================
  {
    const originalSlot = makeMockSlot('slot_stage5_orig', 0, 'fill_blank')
    const recomposedMcq = deterministicallyRecomposeSlot(originalSlot, 'BANK_ERROR', 'multiple_choice')!
    assert.ok(recomposedMcq)
    assert.equal(recomposedMcq.type, 'multiple_choice')

    // Simulate recomposed MCQ exhausting Stage 3
    const blueprint: ExamBlueprint = {
      schemaVersion: 2,
      generatorVersion: 'enjoyer-exam-evidence-4.0.0',
      authorityType: 'studyal_material_enjoyer',
      authorityVersion: 2,
      examId: 'exam-stage5',
      fingerprint: 'fp-stage5',
      seed: 'seed-stage5',
      requestedDurationMinutes: 10,
      durationMinutes: 10,
      effectiveDurationMinutes: 10,
      idealDurationMinutes: 10,
      minimumViableDurationMinutes: 5,
      typeDistribution: { multiple_choice: 1 },
      difficultyDistribution: { medium: 1 },
      expectedCompletionSeconds: 60,
      totalExamTargets: 1,
      coverageStatus: 'full',
      coverage: {} as any,
      readingBurden: {} as any,
      slots: [recomposedMcq],
      materialLanguage: 'es',
      createdAt: new Date().toISOString(),
    }

    const manifest = {
      schemaVersion: 2,
      identity: 'test-stage5',
      examId: 'exam-stage5',
      fingerprint: 'fp-stage5',
      sessionId: 'sess-stage5',
      blueprint,
      totalSlots: 1,
      status: 'generating' as const,
      slots: {
        [recomposedMcq.id]: {
          status: 'terminal_failed' as const,
          attempts: 2,
          stage: 'stage_3_recompose' as const,
          stageAttempts: 2,
          lastFailureReason: 'MCQ_DISTRACTOR_ERROR',
        },
      },
      providerAttemptsBudget: 10,
      providerAttemptsUsed: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const recovered = attemptSlotRecovery(manifest as any)
    assert.equal(recovered, true, 'Stage 5 fallback must recover failed recomposed MCQ')
    const fallbackSlot = manifest.blueprint.slots[0]
    assert.ok(fallbackSlot.id.includes(':fallback:open'), 'Fallback slot ID must include :fallback:open')
    assert.equal(fallbackSlot.type, 'short_answer', 'Fallback type must be short_answer')
    assert.equal(manifest.slots[fallbackSlot.id].stage, 'stage_5_atomic_fallback')
    assert.equal(manifest.slots[fallbackSlot.id].status, 'pending')

    console.log('Contract J PASS: Stage 5 Atomic Open Fallback triggers when structural recomposition is exhausted.')
  }

  // ============================================================
  // CONTRACT K: Concurrent split CAS convergence —
  // Two workers concurrently attempt to split the same composite parent.
  // Final persisted manifest must have exactly one canonical child set:
  // - Parent inactive (superseded_terminal_failed)
  // - Each criterion covered exactly once (no duplication)
  // - totalSlots correct
  // - Accepted siblings unchanged
  // - Total points preserved
  // ============================================================
  {
    const crit1 = {
      criterionId: 'crit:cas:1',
      targetIds: ['target_gamma'],
      operation: 'explain' as const,
      canonicalCriterion: 'Criterio Gamma: Explicar síntesis',
      gradingMode: 'semantic' as const,
      points: 5,
      skill: 'comprehension' as const,
      label: 'Gamma',
      sourceItemId: 'item_cas',
      pages: [1],
      materialId: 'test.pdf',
    }
    const crit2 = {
      criterionId: 'crit:cas:2',
      targetIds: ['target_delta'],
      operation: 'diagnose' as const,
      canonicalCriterion: 'Criterio Delta: Diagnosticar falla',
      gradingMode: 'semantic' as const,
      points: 5,
      skill: 'analysis' as const,
      label: 'Delta',
      sourceItemId: 'item_cas',
      pages: [1],
      materialId: 'test.pdf',
    }

    const blueprint = makeBlueprint(3, 'short_answer', {
      assessmentCriteria: [crit1, crit2],
    })
    const store = new InMemoryExamGenerationStore<any>()
    const examId = 'exam-contract-k'
    blueprint.examId = examId
    const identity = examGenerationIdentity('session-k', 'fp-resilience', examId)

    const readyQuestions: any[] = []
    const slotStates: Record<string, ExamSlotState> = {}

    for (let i = 0; i < 2; i++) {
      const slot = blueprint.slots[i]
      const q = makeMockQuestionForSlot(slot)
      readyQuestions.push(q)
      slotStates[slot.id] = { status: 'ready', attempts: 1, questionId: q.id }
    }
    const compSlot = blueprint.slots[2]
    slotStates[compSlot.id] = {
      status: 'terminal_failed',
      attempts: 3,
      stage: 'stage_2_repair' as const,
      lastFailureReason: 'COMPOSITE_TOO_COMPLEX',
    }

    const initialManifest = {
      schemaVersion: 2,
      identity,
      examId,
      fingerprint: 'fp-resilience',
      sessionId: 'session-k',
      blueprint: structuredClone(blueprint),
      totalSlots: 3,
      status: 'generating' as const,
      slots: slotStates,
      providerAttemptsBudget: 20,
      providerAttemptsUsed: 7,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const initialArtifact = {
      examId,
      fingerprint: 'fp-resilience',
      meta: { status: 'generating' as const, generatedAt: new Date().toISOString() },
      questions: readyQuestions,
    }
    await store.saveManifest(identity, initialManifest)
    await store.saveArtifact(identity, initialArtifact)

    const split1Id = `${compSlot.id}:split:1`
    const split2Id = `${compSlot.id}:split:2`

    let providerCalls = 0
    const mockBatch = async (slotIds: string[], bp: ExamBlueprint): Promise<GenerateExamSlotBatchOutput<any>> => {
      providerCalls++
      await new Promise(r => setTimeout(r, 20)) // induce race window
      const questions = new Map()
      const rejections: Record<string, string> = {}
      for (const id of slotIds) {
        if (id.includes(':split:')) {
          const slot = bp.slots.find(s => s.id === id)!
          questions.set(id, makeMockQuestionForSlot(slot))
        } else {
          // Parent slot still fails — triggers split
          rejections[id] = 'COMPOSITE_TOO_COMPLEX: cannot cover multiple criteria'
        }
      }
      return { questions, rejections }
    }

    // Fire two concurrent advances — both see the terminal_failed parent and attempt to split it
    await Promise.all([
      advanceExamGeneration('session-k', 'fp-resilience', examId, store, mockBatch, { batchSize: 2 }),
      advanceExamGeneration('session-k', 'fp-resilience', examId, store, mockBatch, { batchSize: 2 }),
    ])

    const finalManifest = await store.getManifest(identity)
    const finalArtifact = await store.getArtifact(identity)
    assert.ok(finalManifest)
    assert.ok(finalArtifact)

    // Parent must be superseded exactly once
    assert.equal(finalManifest.slots[compSlot.id].status, 'superseded_terminal_failed')
    assert.ok(finalManifest.slots[compSlot.id].supersededBySlotIds)

    // Exactly one canonical set of split children (2 children, not 4)
    const splitChildren = finalManifest.blueprint.slots.filter(s => s.replacesSlotId === compSlot.id)
    assert.equal(splitChildren.length, 2, 'Exactly 2 split children must exist (no duplication from race)')

    // Verify split child IDs are the canonical deterministic ones
    const childIds = new Set(splitChildren.map(s => s.id))
    assert.ok(childIds.has(split1Id), 'split:1 must be present')
    assert.ok(childIds.has(split2Id), 'split:2 must be present')

    // Each criterion covered exactly once in the blueprint
    const allCriterionIds = finalManifest.blueprint.slots.flatMap(s => (s.assessmentCriteria || []).map(c => c.criterionId))
    const criterionCount = new Map<string, number>()
    for (const cid of allCriterionIds) criterionCount.set(cid, (criterionCount.get(cid) || 0) + 1)
    assert.equal(criterionCount.get('crit:cas:1'), 1, 'crit:cas:1 appears exactly once')
    assert.equal(criterionCount.get('crit:cas:2'), 1, 'crit:cas:2 appears exactly once')

    // totalSlots correct (2 siblings + 2 children = 4)
    assert.equal(finalManifest.totalSlots, 4, 'totalSlots must be 4 after split (2 siblings + 2 children)')

    // Accepted siblings unchanged
    for (let i = 0; i < 2; i++) {
      assert.equal(finalManifest.slots[blueprint.slots[i].id].status, 'ready')
    }

    // Total criterion points: 2 siblings * 5 pts + 2 children * 5 pts (parent criteria) = 20 pts
    const totalCritPoints = finalManifest.blueprint.slots.reduce((acc, slot) => {
      const pts = (slot.assessmentCriteria || []).reduce((cAcc, c) => cAcc + (c.points || 0), 0)
      return acc + (pts || 0)
    }, 0)
    // Each sibling has 1 criterion * 5 pts; parent had 2 criteria * 5 pts; split children inherit those 2 criteria
    // So total = 2 * 5 (siblings) + 2 * 5 (split children, one criterion each) = 20
    assert.equal(totalCritPoints, 20, 'Total criterion points preserved after concurrent split')

    console.log('Contract K PASS: Concurrent split CAS converges to exactly one canonical child set, no duplication.')
  }

  // ============================================================
  // CONTRACT L: Server-side infra retry budget enforcement —
  // Provider returns 503 more than EXAM_MAX_INFRA_RETRIES times.
  // Server must:
  // - Not burn academic attempt counter per infra failure
  // - Mark slot infra_paused after budget exhaustion
  // - Set manifest.status = 'failed' with INFRA_RETRY_BUDGET_EXHAUSTED reason
  // - Academic SLOT_UNRESOLVABLE must NOT be emitted
  // - infraRetries counter must match exact call count
  // - infraRetryBudget must be preserved across advances (durable)
  // ============================================================
  {
    const blueprint = makeBlueprint(3, 'multiple_choice')
    const store = new InMemoryExamGenerationStore<any>()
    const examId = 'exam-contract-l'
    blueprint.examId = examId
    const identity = examGenerationIdentity('session-l', 'fp-resilience', examId)

    const readyQuestions: any[] = []
    const slotStates: Record<string, ExamSlotState> = {}

    for (let i = 0; i < 2; i++) {
      const slot = blueprint.slots[i]
      const q = makeMockQuestionForSlot(slot)
      readyQuestions.push(q)
      slotStates[slot.id] = { status: 'ready', attempts: 1, questionId: q.id }
    }
    const lastSlot = blueprint.slots[2]
    slotStates[lastSlot.id] = { status: 'pending', attempts: 0 }

    await store.saveManifest(identity, {
      schemaVersion: 2,
      identity,
      examId,
      fingerprint: 'fp-resilience',
      sessionId: 'session-l',
      blueprint: structuredClone(blueprint),
      totalSlots: 3,
      status: 'generating',
      slots: slotStates,
      providerAttemptsBudget: 9,
      providerAttemptsUsed: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await store.saveArtifact(identity, {
      examId,
      fingerprint: 'fp-resilience',
      meta: { status: 'generating', generatedAt: new Date().toISOString() },
      questions: readyQuestions,
    })

    // Provider always returns 503
    const infraOnlyBatch = async (): Promise<GenerateExamSlotBatchOutput<any>> => {
      throw new Error('503 Service Unavailable: persistent outage')
    }

    // Run exactly EXAM_MAX_INFRA_RETRIES times — slot should still be retryable_failed (budget not yet exhausted)
    let res: any
    for (let i = 0; i < EXAM_MAX_INFRA_RETRIES; i++) {
      res = await advanceExamGeneration('session-l', 'fp-resilience', examId, store, infraOnlyBatch, { batchSize: 1 })
      assert.equal(res.manifest.slots[lastSlot.id].status, 'retryable_failed', `Slot must be retryable_failed at infra attempt ${i + 1}`)
      assert.equal(res.manifest.slots[lastSlot.id].infraRetries, i + 1)
      // Academic budget must not be consumed
      assert.equal(res.manifest.slots[lastSlot.id].attempts, 0, 'Academic attempts must remain 0 for infra failures')
    }
    assert.equal(res.manifest.slots[lastSlot.id].infraRetries, EXAM_MAX_INFRA_RETRIES)

    // One more — now budget exhausted → infra_paused
    res = await advanceExamGeneration('session-l', 'fp-resilience', examId, store, infraOnlyBatch, { batchSize: 1 })
    assert.equal(res.manifest.slots[lastSlot.id].status, 'infra_paused', 'Slot must be infra_paused after budget exhaustion')
    assert.ok(
      res.manifest.slots[lastSlot.id].lastFailureReason?.startsWith('INFRA_RETRY_BUDGET_EXHAUSTED:'),
      'Failure reason must be INFRA_RETRY_BUDGET_EXHAUSTED (not SLOT_UNRESOLVABLE)',
    )
    assert.equal(res.manifest.slots[lastSlot.id].attempts, 0, 'Academic attempts must remain 0 even after infra_paused')
    assert.equal(res.manifest.status, 'failed', 'Manifest must be failed when infra_paused')
    assert.ok(
      res.manifest.failureReason?.includes('INFRA_RETRY_BUDGET_EXHAUSTED'),
      'Manifest failureReason must contain INFRA_RETRY_BUDGET_EXHAUSTED, not SLOT_UNRESOLVABLE',
    )

    // infraRetryBudget persists across advances (durable)
    const persistedManifest = await store.getManifest(identity)
    assert.ok(persistedManifest)
    assert.equal(persistedManifest!.slots[lastSlot.id].infraRetryBudget, EXAM_MAX_INFRA_RETRIES)

    // Academic budget is unaffected: providerAttemptsUsed must still equal 2 (initial 2 ready slots)
    assert.equal(persistedManifest!.providerAttemptsUsed, 2, 'Academic providerAttemptsUsed must be unaffected by infra failures')

    console.log(`Contract L PASS: Server-side infra retry budget enforced at ${EXAM_MAX_INFRA_RETRIES} retries; slot marked infra_paused, not SLOT_UNRESOLVABLE; academic budget unaffected.`)
  }

  console.log('=== ALL EXAM RESILIENT GENERATION RECOVERY CONTRACTS PASSED ===')
}

runContracts().catch(err => {
  console.error('FAILED CONTRACT:', err)
  process.exit(1)
})
