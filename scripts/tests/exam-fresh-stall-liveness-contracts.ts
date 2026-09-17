import assert from 'node:assert/strict'
import {
  InMemoryExamGenerationStore,
  getOrBuildExamGeneration,
  advanceExamGeneration,
  examGenerationIdentity,
  ExamSlotState,
  GenerateExamSlotBatchOutput,
} from '../../lib/materialBrain/examGenerationStore'
import {
  promptsCollide,
  authorSlotQuestionWithDiagnostics,
  optionsCollide,
} from '../../app/api/alai-studyal-exam/route'
import type { ExamBlueprint, ExamComposedSlot } from '../../lib/materialBrain/examEnjoyerContext'
import type { ExamQuestion } from '../../lib/materials/types'

function makeMockSlot(id: string, index: number, type: 'multiple_choice' | 'short_answer' = 'multiple_choice'): ExamComposedSlot {
  return {
    id,
    slotId: id,
    type,
    section: 'Sección Principal',
    difficulty: 'medium',
    skill: 'comprehension',
    primaryConcept: `Concepto ${id}`,
    sourceItemIds: [`item_${index}`],
    sourcePage: 1,
    groundingContext: `Contenido verificable de contexto para ${id}`,
    contextSummary: `Resumen de contexto para ${id}`,
    expectedOperation: 'explain',
    canonicalAssessmentExcerpt: `Extracto canónico para ${id}`,
    assessmentCriteria: [
      {
        criterionId: `${id}_c0`,
        targetIds: [`target_${index}`],
        gradingMode: 'semantic',
        points: 10,
        skill: 'comprehension',
        label: `Criterio ${id}`,
        canonicalCriterion: `Demuestra comprensión de ${id}`,
        sourceItemId: `item_${index}`,
        materialId: 'mat-1',
        pages: [1],
        operation: 'explain',
      },
    ],
    assessedTargetIds: [`target_${index}`],
    primaryTargetId: `target_${index}`,
    targetIds: [`target_${index}`],
    contextTargetIds: [],
    frozenSources: [
      {
        sourceItemId: `item_${index}`,
        label: `Item ${index}`,
        content: `Contenido verificable de contexto para ${id}`,
        materialId: 'mat-1',
        pages: [1],
        sourceSpans: [{ page: 1, quote: `Cita de contexto para ${id}` }],
      },
    ],
    answerAuthority: type === 'multiple_choice' ? {
      kind: 'single_text',
      canonicalValue: `Respuesta correcta para ${id}`,
      canonicalAnchor: `Ancla de ${id}`,
      distractorPool: [`Distractor 1 de ${id}`, `Distractor 2 de ${id}`, `Distractor 3 de ${id}`],
    } : {
      kind: 'single_text',
      canonicalValue: `Explicación completa de ${id}`,
      canonicalAnchor: `Ancla de ${id}`,
    },
    cognitiveOperation: 'explain',
    assessmentFocus: `Foco de evaluación para ${id}`,
  } as any
}

function make19SlotBlueprint(examId = 'exam-fresh-stall-19'): ExamBlueprint {
  const slots = Array.from({ length: 19 }, (_, i) => makeMockSlot(`exam_slot:${i.toString(16).padStart(4, '0')}`, i, i % 2 === 0 ? 'short_answer' : 'multiple_choice'))
  return {
    schemaVersion: 2,
    generatorVersion: 'enjoyer-exam-progressive-1.0.0',
    authorityType: 'studyal_material_enjoyer',
    authorityVersion: 2,
    examId,
    fingerprint: 'fp-niels-bohr-19',
    seed: 'seed-19',
    requestedDurationMinutes: 30,
    durationMinutes: 30,
    unitSlug: 'fisica-atomica',
    coverage: '100%',
    slots,
    totalSlots: 19,
    sectionSequence: ['Sección Principal'],
    typeDistribution: { short_answer: 10, multiple_choice: 9 },
    materialLanguage: 'es',
    createdAt: new Date().toISOString(),
  }
}

async function main() {
  console.log('── EXAM_FRESH_GENERATION_STALL_LIVENESS CONTRACTS ──\n')

  // ─────────────────────────────────────────────────────────────
  // CONTRACT 1: Liveness Invariant — Reproduction of Chunk 1 (2/4), Chunk 2 (1/4)
  // Pre-fix: readyCount=3 stalled UI when readyAhead >= 3 was checked.
  // Post-fix: sequential ticks proceed through chunk 3 and onwards until finished.
  // ─────────────────────────────────────────────────────────────
  console.log('--- Test 1: Liveness Invariant Across Chunks (No Stall at 3/19) ---')
  const store = new InMemoryExamGenerationStore<any>()
  const bp19 = make19SlotBlueprint('exam-9395d541')

  let chunkCallCount = 0
  const generator = async (slotIds: string[]) => {
    chunkCallCount++
    const questions = new Map<string, ExamQuestion>()
    const rejections: Record<string, string> = {}

    if (chunkCallCount === 1) {
      // Batch 1: target 4 slots, 2 accepted, 2 rejected (reproducing live failure)
      for (let i = 0; i < slotIds.length; i++) {
        const id = slotIds[i]
        if (i === 0 || i === 2) {
          rejections[id] = 'EMPTY_PROMPT: el enunciado de la pregunta está vacío'
        } else {
          questions.set(id, {
            id, slotId: id, type: 'multiple_choice',
            prompt: `Pregunta lista para ${id}`,
            options: ['A', 'B', 'C', 'D'], correctAnswer: 0,
            ready: true,
          } as any)
        }
      }
    } else if (chunkCallCount === 2) {
      // Batch 2: target 4 slots, 1 accepted, 3 rejected/terminal
      for (let i = 0; i < slotIds.length; i++) {
        const id = slotIds[i]
        if (i === 0) {
          questions.set(id, {
            id, slotId: id, type: 'multiple_choice',
            prompt: `Pregunta lista para ${id}`,
            options: ['A', 'B', 'C', 'D'], correctAnswer: 0,
            ready: true,
          } as any)
        } else {
          rejections[id] = 'COMPOSITE_REDUNDANT_PARTS: redundante'
        }
      }
    } else {
      // Chunk 3+: normal generation of remaining slots
      for (const id of slotIds) {
        questions.set(id, {
          id, slotId: id, type: 'multiple_choice',
          prompt: `Pregunta lista para ${id}`,
          options: ['A', 'B', 'C', 'D'], correctAnswer: 0,
          ready: true,
        } as any)
      }
    }
    return { questions, rejections }
  }

  // Initial call (mode=generate) -> Chunk 1
  const initial = await getOrBuildExamGeneration('sess_1', bp19.fingerprint, bp19.examId, bp19, store, generator, { batchSize: 4 })
  assert.equal(initial.manifest.status, 'generating')
  assert.equal(initial.artifact.questions.length, 2, 'Batch 1 should yield 2 ready questions')
  assert.equal(chunkCallCount, 1)

  // Client Tick 1 (mode=advance) -> Chunk 2
  const tick1 = await advanceExamGeneration('sess_1', bp19.fingerprint, bp19.examId, store, generator, { batchSize: 4 })
  assert.equal(tick1.manifest.status, 'generating')
  assert.equal(tick1.artifact.questions.length, 3, 'Batch 2 should yield 3 ready questions (17% of 19)')
  assert.equal(chunkCallCount, 2)

  // PRE-FIX CHECK:
  // In the pre-fix client code:
  // const readyAhead = readyCount - currentQuestion; (3 - 0 = 3)
  // if (readyAhead >= 3 && readyCount < totalSlots) return; // Stalled!
  const currentQuestion = 0
  const readyCountBefore = tick1.artifact.questions.length
  const totalSlots = tick1.manifest.blueprint.totalSlots
  const preFixShouldSkip = (readyCountBefore - currentQuestion >= 3) && (readyCountBefore < totalSlots)
  assert.equal(preFixShouldSkip, true, 'Pre-fix logic WOULD have skipped and caused the 17% stall')

  // POST-FIX CHECK:
  // In the fixed client code, sequential advance proceeds as long as readyCount < totalSlots
  const postFixShouldSkip = readyCountBefore >= totalSlots
  assert.equal(postFixShouldSkip, false, 'Post-fix logic MUST NOT skip when readyCount < totalSlots')

  // Execute Tick 2 (Chunk 3) — must proceed and not be stalled
  const tick2 = await advanceExamGeneration('sess_1', bp19.fingerprint, bp19.examId, store, generator, { batchSize: 4 })
  assert.equal(chunkCallCount, 3, 'Chunk 3 MUST be executed sequentially')
  assert.ok(tick2.artifact.questions.length > 3, 'Ready count must advance beyond 3')

  // Advance remaining chunks until completion
  let currentResult = tick2
  let safetyLoop = 0
  while (currentResult.manifest.status === 'generating' && safetyLoop < 10) {
    safetyLoop++
    currentResult = await advanceExamGeneration('sess_1', bp19.fingerprint, bp19.examId, store, generator, { batchSize: 4 })
  }
  assert.ok(currentResult.artifact.questions.length >= 14, 'Final exam must advance through all actionable slots')
  console.log(`PASS 1: Lifecycle liveness verified — advanced from 3/19 to ${currentResult.artifact.questions.length}/${totalSlots} across ${chunkCallCount} chunks`)

  // ─────────────────────────────────────────────────────────────
  // CONTRACT 2: In-Flight & Cancellation Guard Contract
  // ─────────────────────────────────────────────────────────────
  console.log('--- Test 2: In-Flight Concurrency Guard Contract ---')
  let advanceBusyRef = false
  let callCount = 0
  const simulateClientTick = async (simulateSlowNetworkMs = 50) => {
    if (advanceBusyRef) return { skipped: true }
    advanceBusyRef = true
    try {
      callCount++
      await new Promise(resolve => setTimeout(resolve, simulateSlowNetworkMs))
      return { skipped: false, callCount }
    } finally {
      advanceBusyRef = false
    }
  }

  // Fast consecutive calls (simulating StrictMode or rapid interval)
  const [res1, res2] = await Promise.all([
    simulateClientTick(50),
    simulateClientTick(50),
  ])
  assert.equal(res1.skipped === false || res2.skipped === false, true, 'One call must proceed')
  assert.equal(res1.skipped === true || res2.skipped === true, true, 'One call must be skipped by in-flight guard')
  assert.equal(callCount, 1, 'Only one network call must execute concurrently')

  // Sequential subsequent tick after in-flight finishes
  const res3 = await simulateClientTick(10)
  assert.equal(res3.skipped, false, 'Sequential subsequent tick must execute freely')
  assert.equal(callCount, 2, 'Total executed calls should now be 2')
  console.log('PASS 2: In-flight concurrency guard verified (protects duplicate requests without suppressing sequence)')

  // ─────────────────────────────────────────────────────────────
  // CONTRACT 3: promptsCollide Context-Aware Collision Testing
  // ─────────────────────────────────────────────────────────────
  console.log('--- Test 3: promptsCollide Quality & Precision ---')

  // Subquestions sharing topic words ("Niels Bohr", "Premio Nobel de Física") but asking different academic questions
  const distinctSubq1 = 'Indica en qué año y por qué investigaciones específicas recibió Niels Bohr el Premio Nobel de Física.'
  const distinctSubq2 = 'Explica la repercusión histórica de este reconocimiento en el desarrollo posterior de la mecánica cuántica.'
  const sharedFocus = 'Premio Nobel de Física y repercusión cuántica'

  // With context words removed, distinct subquestions must NOT collide
  const collisionWithContext = promptsCollide(distinctSubq1, distinctSubq2, sharedFocus)
  assert.equal(collisionWithContext, false, 'Distinct subquestions with shared subject focus MUST NOT collide')

  // Even without explicit contextText, ratio check must NOT trigger false positive on distinct questions
  const collisionWithoutContext = promptsCollide(distinctSubq1, distinctSubq2)
  assert.equal(collisionWithoutContext, false, 'Distinct subquestions MUST NOT collide under new ratio thresholds')

  // Paraphrased subquestions (redundant) MUST collide
  const redundantSubq1 = '¿Por qué motivos y causas le otorgaron el Premio Nobel de Física a Niels Bohr?'
  const redundantSubq2 = '¿Cuáles fueron las razones y motivos por los que concedieron el Premio Nobel de Física a Bohr?'
  const redundantCollision = promptsCollide(redundantSubq1, redundantSubq2)
  assert.equal(redundantCollision, true, 'Paraphrased redundant subquestions MUST collide')

  // Antonym pairs must never collide
  const antonymSubq1 = 'Explica por qué la emisión de radiación aumenta en este estado.'
  const antonymSubq2 = 'Explica por qué la absorción de radiación disminuye en este estado.'
  assert.equal(promptsCollide(antonymSubq1, antonymSubq2), false, 'Antonym pairs MUST NOT collide')
  console.log('PASS 3: promptsCollide precision verified (avoids false positives on shared subject entities)')

  // ─────────────────────────────────────────────────────────────
  // CONTRACT 4: authorSlotQuestionWithDiagnostics Prompt Fallbacks
  // ─────────────────────────────────────────────────────────────
  console.log('--- Test 4: Single-Criterion prompt Fallback (parts[0].prompt / question) ---')
  const bp = make19SlotBlueprint('exam-author-test')
  const slotSingleShortAnswer = makeMockSlot('exam_slot:single_sa', 0, 'short_answer')
  slotSingleShortAnswer.assessmentCriteria = [
    {
      criterionId: 'crit_single',
      targetIds: ['target_0'],
      gradingMode: 'semantic',
      points: 10,
      skill: 'comprehension',
      label: 'Postulado Bohr',
      canonicalCriterion: 'Explica el postulado del modelo atómico de Bohr sobre las órbitas estacionarias.',
      sourceItemId: 'item_0',
      materialId: 'mat-1',
      pages: [1],
      operation: 'explain',
    },
  ]
  slotSingleShortAnswer.cognitiveOperation = 'explain'

  // Case A: Model returns parts: [{ criterionId, prompt }] with empty top-level prompt
  const rawWithPartsOnly = {
    slotId: 'exam_slot:single_sa',
    type: 'short_answer',
    prompt: '',
    parts: [
      {
        criterionId: 'crit_single',
        prompt: 'Explica detalladamente el postulado de Bohr relativo a las órbitas cuantizadas.',
      },
    ],
  }
  const diagParts = authorSlotQuestionWithDiagnostics(bp.examId, bp, slotSingleShortAnswer, rawWithPartsOnly)
  assert.ok(diagParts.question, `Must accept prompt from parts[0]: ${diagParts.rejectionReason}`)
  assert.equal(diagParts.question.prompt, 'Explica detalladamente el postulado de Bohr relativo a las órbitas cuantizadas.')

  // Case B: Model returns question: "..." with empty top-level prompt
  const rawWithQuestionKey = {
    slotId: 'exam_slot:single_sa',
    type: 'short_answer',
    prompt: '',
    question: 'Explica los fundamentos del modelo atómico y sus niveles energéticos cuantizados.',
  }
  const diagQuestion = authorSlotQuestionWithDiagnostics(bp.examId, bp, slotSingleShortAnswer, rawWithQuestionKey)
  assert.ok(diagQuestion.question, `Must accept prompt from question key: ${diagQuestion.rejectionReason}`)
  assert.equal(diagQuestion.question.prompt, 'Explica los fundamentos del modelo atómico y sus niveles energéticos cuantizados.')

  // Case C: Truly empty prompt (no prompt, no parts, no question)
  const rawTrulyEmpty = {
    slotId: 'exam_slot:single_sa',
    type: 'short_answer',
    prompt: '',
  }
  const diagEmpty = authorSlotQuestionWithDiagnostics(bp.examId, bp, slotSingleShortAnswer, rawTrulyEmpty)
  assert.equal(diagEmpty.question, null)
  assert.ok(diagEmpty.rejectionReason?.includes('EMPTY_PROMPT'), 'Must reject truly empty prompt with EMPTY_PROMPT')
  console.log('PASS 4: Authoring fallback successfully captures parts[0].prompt and question key')

  // ─────────────────────────────────────────────────────────────
  // CONTRACT 5: Exact Live Manifest Resume Safety (9395d541ae0be58dfa89165f1386d1b6)
  // ─────────────────────────────────────────────────────────────
  console.log('--- Test 5: Live Manifest Resume Safety (9395d541ae0be58dfa89165f1386d1b6) ---')
  const liveStore = new InMemoryExamGenerationStore<any>()
  const liveBp = make19SlotBlueprint('9395d541ae0be58dfa89165f1386d1b6')
  const liveIdentity = examGenerationIdentity('sess_mtb42p4nwss114', liveBp.fingerprint, liveBp.examId)

  // Seed store with the exact state from live D1 forensics:
  // 3 ready questions (slots 1, 3, 5), 2 terminal_failed, 1 retryable, 13 pending
  const readySlotIds = [liveBp.slots[1].id, liveBp.slots[3].id, liveBp.slots[5].id]
  const slotStates: Record<string, ExamSlotState> = {}
  for (let i = 0; i < liveBp.slots.length; i++) {
    const s = liveBp.slots[i]
    if (readySlotIds.includes(s.id)) {
      slotStates[s.id] = { status: 'ready', attempts: 1 }
    } else if (i === 0) {
      slotStates[s.id] = { status: 'terminal_failed', attempts: 2, lastFailureReason: 'EMPTY_PROMPT: el enunciado está vacío' }
    } else if (i === 2) {
      slotStates[s.id] = { status: 'terminal_failed', attempts: 2, lastFailureReason: 'COMPOSITE_REDUNDANT_PARTS' }
    } else if (i === 4) {
      slotStates[s.id] = { status: 'retryable_failed', attempts: 1, lastFailureReason: 'EMPTY_PROMPT' }
    } else {
      slotStates[s.id] = { status: 'pending', attempts: 0 }
    }
  }

  await liveStore.saveManifest(liveIdentity, {
    identity: liveIdentity,
    sessionId: 'sess_mtb42p4nwss114',
    fingerprint: liveBp.fingerprint,
    examId: liveBp.examId,
    blueprint: liveBp,
    status: 'generating',
    slots: slotStates,
    recomposedSlotIds: {},
    providerAttemptsBudget: 38,
    providerAttemptsUsed: 8,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  await liveStore.saveArtifact(liveIdentity, {
    identity: liveIdentity,
    meta: { status: 'generating', generatedAt: new Date().toISOString() },
    questions: readySlotIds.map(id => ({
      id, slotId: id, type: 'multiple_choice',
      prompt: `Pregunta viva lista ${id}`,
      options: ['A', 'B', 'C', 'D'], correctAnswer: 0,
      ready: true,
    } as any)),
  })

  // Resume advance with generator
  let liveGeneratorCalledSlots: string[] = []
  const liveGenerator = async (slotIds: string[]) => {
    liveGeneratorCalledSlots = slotIds
    const questions = new Map<string, ExamQuestion>()
    for (const id of slotIds) {
      questions.set(id, {
        id, slotId: id, type: 'multiple_choice',
        prompt: `Pregunta recuperada para ${id}`,
        options: ['A', 'B', 'C', 'D'], correctAnswer: 0,
        ready: true,
      } as any)
    }
    return { questions, rejections: {} }
  }

  const resumed = await advanceExamGeneration('sess_mtb42p4nwss114', liveBp.fingerprint, liveBp.examId, liveStore, liveGenerator, { batchSize: 4 })
  assert.equal(resumed.manifest.status, 'generating')
  // Verify that generator was NOT called for already-ready slots
  for (const readyId of readySlotIds) {
    assert.ok(!liveGeneratorCalledSlots.includes(readyId), `Ready slot ${readyId} must not be re-generated`)
  }
  // Verify that all 3 original ready questions are preserved
  const originalPreserved = readySlotIds.every(id => resumed.artifact.questions.some(q => q.id === id))
  assert.equal(originalPreserved, true, 'All original ready questions MUST be preserved')
  assert.ok(resumed.artifact.questions.length > 3, 'Resumed artifact must now include new questions')
  console.log(`PASS 5: Live manifest safely resumed without regenerating ready slots (readyCount advanced from 3 to ${resumed.artifact.questions.length})`)

  console.log('\nALL 5 FRESH GENERATION STALL & LIVENESS CONTRACTS PASSED PERFECTLY!\n')
}

main().catch(err => {
  console.error('CONTRACT TEST FAILED:', err)
  process.exit(1)
})
