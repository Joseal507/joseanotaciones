import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import ALAIStudyALExams from '../../components/materias/ALAIStudyALExams'
import ReactDOMServer from 'react-dom/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  InMemoryExamGenerationStore,
  examGenerationIdentity,
  restoreExamGeneration,
  examAnswersHash,
} from '../../lib/materialBrain/examGenerationStore'
import { MemoryExamGradingStore } from '../../lib/materialBrain/examGrading'
import { POST, __routeDeps } from '../../app/api/alai-studyal-exam/route'
import {
  ResultsView,
  computeExamLetterGrade,
} from '../../components/materias/ALAIStudyALExams'
class FakeLocalStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null }
  setItem(key: string, value: string): void { this.store.set(key, String(value)) }
  removeItem(key: string): void { this.store.delete(key) }
  clear(): void { this.store.clear() }
}
;(global as any).window = (global as any).window || {}
;(global as any).localStorage = new FakeLocalStorage()
;(global as any).fetch = (async () => ({ ok: true, json: async () => ({ success: true }) }))

import {
  readFreeToolState,
  writeFreeToolState,
  clearFreeToolState,
} from '../../lib/freeToolState'
import { getSessionById, updateSessionById, upsertSession } from '../../lib/studySessions'

console.log('\n── EXAM_NEW_ATTEMPT_LIFECYCLE_CONTRACTS ──\n')

async function main() {
  const selection = {
    ...buildSourceSelectionSnapshot(['mat-bohr'], { 'mat-bohr': [1, 2] }),
    fingerprint: 'fp-bohr-lifecycle',
  }

  const enjoyerUniverse = {
    sourceSelectionFingerprint: 'fp-bohr-lifecycle',
    materialIds: ['mat-bohr'],
    selectedPages: { 'mat-bohr': [1, 2] },
    topicsIndex: [{ id: 'topic-bohr', title: 'Modelo Atómico de Bohr' }],
    globalOrderedAnalysis: [
      {
        id: 'bohr-fact-1',
        kind: 'fact',
        name: 'Postulado 1 de Bohr',
        content: 'Los electrones orbitan en estados estacionarios discretos sin radiar energía.',
        importance: 'high',
        difficulty: 'medium',
        examTypes: ['multiple_choice', 'true_false'],
        topicId: 'topic-bohr',
        materialId: 'mat-bohr',
        pages: [1],
        sourceSpans: [{ page: 1, quote: 'electrones orbitan en estados estacionarios' }],
      },
      {
        id: 'bohr-fact-2',
        kind: 'fact',
        name: 'Postulado 2 de Bohr',
        content: 'La emisión o absorción de radiación ocurre sólo en transiciones cuánticas entre órbitas.',
        importance: 'high',
        difficulty: 'medium',
        examTypes: ['multiple_choice', 'short_answer'],
        topicId: 'topic-bohr',
        materialId: 'mat-bohr',
        pages: [2],
        sourceSpans: [{ page: 2, quote: 'transiciones cuánticas entre órbitas' }],
      },
      {
        id: 'bohr-fact-3',
        kind: 'concept',
        name: 'Cuantización del momento angular',
        content: 'El momento angular orbital del electrón está cuantizado en múltiplos enteros de h-barra.',
        importance: 'high',
        difficulty: 'advanced',
        examTypes: ['multiple_choice', 'short_answer'],
        topicId: 'topic-bohr',
        materialId: 'mat-bohr',
        pages: [1, 2],
        sourceSpans: [{ page: 1, quote: 'momento angular cuantizado' }],
      },
      {
        id: 'bohr-fact-4',
        kind: 'fact',
        name: 'Espectro del Hidrógeno',
        content: 'El modelo de Bohr explica con exactitud las líneas de la serie de Balmer del hidrógeno.',
        importance: 'medium',
        difficulty: 'medium',
        examTypes: ['true_false', 'multiple_choice'],
        topicId: 'topic-bohr',
        materialId: 'mat-bohr',
        pages: [2],
        sourceSpans: [{ page: 2, quote: 'serie de Balmer del hidrógeno' }],
      },
    ],
    uniqueConceptsIndex: [],
  }

  const examStore = new InMemoryExamGenerationStore<any>()
  const gradingStore = new MemoryExamGradingStore()

  let materialReanalysisCalls = 0
  let examGenerationProviderCalls = 0
  let semanticGradingCalls = 0

  const originalDeps = { ...__routeDeps }

  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'user-lifecycle-1' } }) as any,
    getAuthoritativeFreeSession: async () => ({
      id: 'session-lifecycle-1',
      userId: 'user-lifecycle-1',
      processMode: 'free',
      sourceSelection: selection,
    }) as any,
    getMaterial: async () => ({ id: 'mat-bohr', nombre: 'Física Cuántica Bohr' }) as any,
    lookupStudyalMaterialEnjoyer: async (fp: string) => {
      // Must only lookup existing persisted enjoyer, never call reanalysis
      if (fp === selection.fingerprint) {
        return enjoyerUniverse
      }
      materialReanalysisCalls++
      return null
    },
    materialEnjoyerStore: {} as any,
    gradingStore,
    examStore,
    generateValidatedLegacyJson: async ({ prompt, validate, telemetryContext, beforeProviderAttempt }: any) => {
      if (telemetryContext?.phase === 'semantic_grade') {
        semanticGradingCalls++
        await beforeProviderAttempt?.()
        const work = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)) as Array<{criterion:{criterionId:string}}>
        return { judgments: work.map(item => ({ criterionId: item.criterion.criterionId, scorePercent: 100, status: 'correct', feedback: 'Correcto' })) }
      }
      examGenerationProviderCalls++
      return prompt.split(/\n(?=\d+\.\s+slotId=)/).filter((block: string) => /^\d+\.\s+slotId=/.test(block)).map((block: string) => {
        const slotId = block.match(/slotId=(\S+)/)?.[1] || 'slot-unknown'
        const type = block.match(/type=(\S+)/)?.[1] || 'multiple_choice'
        const canonMatch = block.match(/canonicalValue":\s*"([^"]+)"/) || block.match(/canonicalCriterion":\s*"([^"]+)"/)
        const canon = canonMatch?.[1] || 'Respuesta canónica evaluada'
        const distractors = [
          'Alternativa alfa incorrecta respecto al postulado evaluado en esta materia',
          'Alternativa beta incorrecta respecto al postulado evaluado en esta materia',
          'Alternativa gamma incorrecta respecto al postulado evaluado en esta materia',
        ]
        return {
          slotId,
          type,
          sourceItemIds: (block.match(/sourceItemIds=([^\n]+)/)?.[1] || '').split(',').map((v: string) => v.trim()).filter(Boolean),
          prompt: `¿Cuál es el significado de ${slotId}?`,
          distractors: type === 'multiple_choice' ? distractors : undefined,
          expectedAnswer: type === 'short_answer' ? canon : undefined,
          options: type === 'multiple_choice' ? [canon, ...distractors] : undefined,
          correctAnswer: type === 'multiple_choice' ? 0 : true,
          wordBank: type === 'fill_blank' ? distractors : undefined,
        }
      })
    },
  })

  async function post(body: unknown) {
    const response = await POST(new NextRequest('http://localhost/api/alai-studyal-exam', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
    return { status: response.status, data: await response.json() }
  }

  try {
    // ═══════════════════════════════════════════════════════════════
    // STAGE 1: COMPLETE EXAM A
    // ═══════════════════════════════════════════════════════════════
    console.log('--- Stage 1: Starting and completing Exam A ---')
    const startA = await post({
      mode: 'generate',
      sessionId: 'session-lifecycle-1',
      durationMinutes: 30,
      attemptId: 'attempt-A-100',
    })
    assert.equal(startA.status, 200, 'Start Exam A must succeed')
    const examA = startA.data.exam
    const examIdA = examA.id
    assert.ok(examIdA, 'Exam A must have an examId')
    const providerCallsAfterA = examGenerationProviderCalls
    assert.ok(providerCallsAfterA > 0, 'Exam A initial generation must make provider calls')

    // Advance Exam A until ready
    let currentExamA = examA
    let readyCountA = startA.data.readyCount
    const totalSlotsA = startA.data.totalSlots
    let advAttempts = 0
    while (readyCountA < totalSlotsA && advAttempts < 10) {
      advAttempts++
      const adv = await post({
        mode: 'advance',
        sessionId: 'session-lifecycle-1',
        examId: examIdA,
      })
      assert.equal(adv.status, 200)
      if (adv.data.genStatus === 'failed' || adv.data.status === 'failed') {
        throw new Error(`Advance failed: ${adv.data.failureReason || 'unknown'}`)
      }
      currentExamA = adv.data.exam
      readyCountA = adv.data.readyCount
    }
    assert.equal(readyCountA, totalSlotsA, 'Exam A must be fully generated')

    // Submit Exam A
    const answersA = currentExamA.questions.map((q: any) => q.correctAnswer ?? 0)
    const confidencesA = currentExamA.questions.map(() => 'very_high')
    const evalA = await post({
      mode: 'evaluate',
      sessionId: 'session-lifecycle-1',
      examId: examIdA,
      answers: answersA,
      confidences: confidencesA,
      questionTimes: currentExamA.questions.map(() => 15000),
    })
    assert.equal(evalA.status, 200, 'Exam A evaluation must succeed')
    assert.ok(evalA.data.evaluation, 'Exam A evaluation must be present')
    console.log(`Exam A completed successfully with examId: ${examIdA}`)

    // ═══════════════════════════════════════════════════════════════
    // CONTRACT A: "Hacer otro examen" creates a brand new examId
    // Even with same material and same duration
    // ═══════════════════════════════════════════════════════════════
    console.log('--- Contract A: Starting Exam B with same material and same duration ---')
    const beforeB = examGenerationProviderCalls
    const startB = await post({
      mode: 'generate',
      sessionId: 'session-lifecycle-1',
      durationMinutes: 30,
      attemptId: 'attempt-B-200',
    })
    assert.equal(startB.status, 200, 'Start Exam B must succeed')
    const examB = startB.data.exam
    const examIdB = examB.id
    assert.ok(examIdB, 'Exam B must have an examId')
    assert.notEqual(examIdB, examIdA, 'CRITICAL: examId B must NOT equal examId A!')
    console.log(`PASS Contract A: examId B (${examIdB}) !== examId A (${examIdA})`)

    // ═══════════════════════════════════════════════════════════════
    // CONTRACT B: Exam B starts with no accepted questions from A
    // ═══════════════════════════════════════════════════════════════
    console.log('--- Contract B: Exam B starts from fresh generation, not ready state of A ---')
    const manifestB = await examStore.getManifest(examGenerationIdentity('session-lifecycle-1', selection.fingerprint, examIdB))
    assert.ok(manifestB, 'Manifest for Exam B must exist')
    assert.equal(manifestB.examId, examIdB)
    assert.notEqual(manifestB.createdAt, '')
    // Initial ready count of B must only reflect B's initial batch, never inheriting A's 100% completion
    assert.ok(
      startB.data.readyCount <= 5,
      `Exam B initial readyCount (${startB.data.readyCount}) must be bounded initial batch size, not inherited from A (${totalSlotsA})`
    )
    console.log('PASS Contract B: Exam B starts fresh without inheriting accepted questions from A')

    // ═══════════════════════════════════════════════════════════════
    // CONTRACT C: Questions/artifact IDs are not inherited from A
    // ═══════════════════════════════════════════════════════════════
    console.log('--- Contract C: Question IDs and slot IDs of B are distinct from A ---')
    const slotIdsA = new Set(Object.keys(manifestB.slots))
    const manifestA = await examStore.getManifest(examGenerationIdentity('session-lifecycle-1', selection.fingerprint, examIdA))
    assert.ok(manifestA, 'Manifest for Exam A must still exist')
    const slotIdsOriginalA = new Set(Object.keys(manifestA.slots))

    // Check intersection between slot IDs of A and B
    for (const sId of slotIdsOriginalA) {
      assert.ok(
        !slotIdsA.has(sId),
        `Slot ID ${sId} from Exam A must NOT appear in Exam B`
      )
    }

    const questionIdsA = new Set(currentExamA.questions.map((q: any) => q.id))
    for (const qB of examB.questions) {
      assert.ok(
        !questionIdsA.has(qB.id),
        `Question ID ${qB.id} from Exam B must NOT match any question in Exam A`
      )
    }
    console.log('PASS Contract C: Question and slot IDs in B are completely disjoint from A')

    // ═══════════════════════════════════════════════════════════════
    // CONTRACT E: Exam A can still reopen unchanged after B exists
    // ═══════════════════════════════════════════════════════════════
    console.log('--- Contract E: Exam A reopens unchanged after B is created ---')
    const reopenedA = await restoreExamGeneration(
      'session-lifecycle-1',
      selection.fingerprint,
      examIdA,
      examStore,
    )
    assert.ok(reopenedA, 'Exam A must be restorable via restoreExamGeneration')
    assert.equal(reopenedA.manifest.examId, examIdA)
    assert.equal(reopenedA.artifact.questions.length, totalSlotsA)
    assert.equal(reopenedA.manifest.status, 'ready')

    // Verify result of Exam A is still restorable
    const answersHashA = examAnswersHash(answersA)
    const resultRecordA = await examStore.getResult(
      examGenerationIdentity('session-lifecycle-1', selection.fingerprint, examIdA),
      answersHashA,
    )
    assert.ok(resultRecordA, 'Exam A evaluation record must remain in store')
    assert.equal(resultRecordA.examId, examIdA)
    console.log('PASS Contract E: Exam A restores exactly as completed after B exists')

    // ═══════════════════════════════════════════════════════════════
    // CONTRACT F: Same Enjoyer is reused with 0 material reanalysis
    // ═══════════════════════════════════════════════════════════════
    console.log('--- Contract F: Enjoyer reuse with 0 reanalysis calls ---')
    assert.equal(
      materialReanalysisCalls,
      0,
      'Enjoyer lookup must reuse persisted enjoyer with ZERO reanalysis calls'
    )
    console.log('PASS Contract F: Same Enjoyer reused with 0 material reanalysis calls')

    // ═══════════════════════════════════════════════════════════════
    // CONTRACT G: New Exam generation provider calls ARE made for B
    // ═══════════════════════════════════════════════════════════════
    console.log('--- Contract G: Provider called for new generation of B ---')
    assert.ok(
      examGenerationProviderCalls > beforeB,
      `Exam B must make new provider calls for slot authoring (${examGenerationProviderCalls} > ${providerCallsAfterA})`
    )
    console.log(`PASS Contract G: New generation provider calls were made for B (calls: ${examGenerationProviderCalls - beforeB})`)

    // ═══════════════════════════════════════════════════════════════
    // CONTRACT I: Creating B does not overwrite A's store records
    // ═══════════════════════════════════════════════════════════════
    console.log('--- Contract I: Immutability of A in store ---')
    const storedManifestA = await examStore.getManifest(examGenerationIdentity('session-lifecycle-1', selection.fingerprint, examIdA))
    const storedArtifactA = await examStore.getArtifact(examGenerationIdentity('session-lifecycle-1', selection.fingerprint, examIdA))
    const storedManifestB = await examStore.getManifest(examGenerationIdentity('session-lifecycle-1', selection.fingerprint, examIdB))
    const storedArtifactB = await examStore.getArtifact(examGenerationIdentity('session-lifecycle-1', selection.fingerprint, examIdB))

    assert.ok(storedManifestA, 'Manifest A must exist')
    assert.ok(storedArtifactA, 'Artifact A must exist')
    assert.ok(storedManifestB, 'Manifest B must exist')
    assert.ok(storedArtifactB, 'Artifact B must exist')
    assert.equal(storedManifestA.examId, examIdA)
    assert.equal(storedManifestB.examId, examIdB)
    assert.notEqual(storedManifestA.identity, storedManifestB.identity)
    console.log('PASS Contract I: Creating B does not overwrite A manifest, artifact, or identity')

    // ═══════════════════════════════════════════════════════════════
    // CONTRACT J: Button copy is exactly "Hacer otro examen"
    // ═══════════════════════════════════════════════════════════════
    console.log('--- Contract J: Student-facing button copy ---')
    let resetClicked = false
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(ResultsView, {
        exam: currentExamA,
        evaluation: evalA.data.evaluation,
        answers: answersA,
        confidences: confidencesA,
        questionTimes: currentExamA.questions.map(() => 15000),
        resultsTab: 'questions',
        setResultsTab: () => {},
        onReset: () => { resetClicked = true },
        onBack: () => {},
      })
    )

    assert.ok(
      html.includes('Hacer otro examen'),
      'Completed exam view must have button with copy "Hacer otro examen"'
    )
    assert.ok(
      html.includes('data-testid="hacer-otro-examen-btn"'),
      'Button must have data-testid="hacer-otro-examen-btn"'
    )
    assert.ok(
      !html.includes('Repetir examen'),
      'Completed exam view must NOT contain "Repetir examen"'
    )

    // Verify across all TS/TSX source code in components and app
    const clientSource = fs.readFileSync(path.resolve(__dirname, '../../components/materias/ALAIStudyALExams.tsx'), 'utf8')
    assert.ok(
      !clientSource.includes('>Repetir examen<'),
      'No student-facing "Repetir examen" button may remain in ALAIStudyALExams.tsx'
    )
    assert.ok(
      clientSource.includes('>Hacer otro examen<'),
      'ALAIStudyALExams.tsx must contain ">Hacer otro examen<"'
    )
    console.log('PASS Contract J: Button copy is exactly "Hacer otro examen", 0 "Repetir examen" occurrences')

    await testClientLifecycle(currentExamA, evalA.data.evaluation)
    console.log('\nNEW ATTEMPT SERVER AND CLIENT CONTRACTS PASSED\n')
  } finally {
    Object.assign(__routeDeps, originalDeps)
  }
}


async function testClientLifecycle(examA: unknown, evaluation: unknown) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>')
  Object.assign(globalThis, { window, document, React, IS_REACT_ACT_ENVIRONMENT: true })
  window.HTMLElement.prototype.scrollIntoView = () => {}
  const session = upsertSession({
    id: 'client-attempt-test', processMode: 'free', enfoque: 'mixto',
    materialIds: ['mat-bohr'], selectedPages: { 'mat-bohr': [1, 2] }, temaId: 'bohr',
    notes: { freeTools: {} },
  })
  const fp = session.sourceSelectionFingerprint!
  for (const tool of ['quiz', 'repasar', 'flashcards'] as const) {
    writeFreeToolState(session.id, fp, tool, { preserved: tool })
  }
  const siblings = JSON.stringify(['quiz', 'repasar', 'flashcards'].map(tool =>
    getSessionById(session.id)?.notes?.freeTools?.[tool]))
  writeFreeToolState(session.id, fp, 'exam', {
    phase: 'results', exam: examA, evaluation, examId: 'A', attemptId: 'attempt-A',
    duration: 90, examMode: 'closed', adaptive: true, answers: [], confidences: [],
    questionTimes: [], readyCount: 4, totalSlots: 4, genStatus: 'ready',
  })
  type Intent = { attemptId: string; examId: string | null; exam: { questions: unknown[] } | null; phase: string; duration: number }
  const read = () => readFreeToolState<Intent>(session.id, fp, 'exam')!.state
  const requests: Array<{mode: string; attemptId?: string; examId?: string; durationMinutes?: number}> = []
  let resolveGeneration: ((response: Response) => void) | undefined
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || '{}'))
    if (body.mode) requests.push(body)
    if (body.mode === 'generate') return new Promise<Response>(resolve => { resolveGeneration = resolve })
    if (body.mode === 'recommend') return Response.json({ success: true, idealDurationMinutes: 30 })
    return Response.json({ success: false })
  }
  const container = document.getElementById('root')!
  let root = createRoot(container)
  const props = {
    materiales: [{ id: 'mat-bohr', nombre: 'Same material' }], tema: { id: 'bohr' },
    materia: { nombre: 'Physics' }, onBack: () => {}, sessionId: session.id,
    sourceSelection: buildSourceSelectionSnapshot(['mat-bohr'], { 'mat-bohr': [1, 2] }),
  }
  const mount = async () => { await act(async () => { root.render(React.createElement(ALAIStudyALExams, props)) }) }
  const remount = async () => {
    await act(async () => root.unmount())
    root = createRoot(container)
    await mount()
  }
  const start = async () => {
    const button = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('COMENZAR EXAMEN'))
    assert.ok(button)
    await act(async () => button.click())
  }
  try {
    await mount()
    const reset = container.querySelector<HTMLButtonElement>('[data-testid="hacer-otro-examen-btn"]')
    assert.ok(reset, 'Mount actual completed A results')
    await act(async () => reset.click())
    assert.equal(requests.filter(r => r.mode === 'generate').length, 0)
    assert.equal(read().exam, null)
    const resetState = readFreeToolState<{answers: unknown[]; confidences: unknown[]; evaluation: unknown}>(session.id, fp, 'exam')!.state
    assert.deepEqual(resetState.answers, [])
    assert.deepEqual(resetState.confidences, [])
    assert.equal(resetState.evaluation, null)
    const attemptB = read().attemptId
    assert.notEqual(attemptB, 'attempt-A')
    assert.equal(JSON.stringify(['quiz', 'repasar', 'flashcards'].map(tool =>
      getSessionById(session.id)?.notes?.freeTools?.[tool])), siblings)
    await remount()
    assert.equal(read().attemptId, attemptB, 'Stale A save must not resurrect on unmount')
    assert.equal(container.querySelector('[data-testid="hacer-otro-examen-btn"]'), null)
    await start()
    assert.equal(read().phase, 'generating')
    assert.equal(read().attemptId, attemptB)
    assert.equal(requests.filter(r => r.mode === 'generate').length, 1)
    await remount()
    assert.equal(read().attemptId, attemptB)
    assert.equal(read().duration, 90, 'Recommendation cannot replace pending attempt configuration')
    await start()
    const generates = requests.filter(r => r.mode === 'generate')
    assert.deepEqual(generates.map(r => r.attemptId), [attemptB, attemptB])
    assert.deepEqual(generates.map(r => r.durationMinutes), [90, 90])
    const partial = { id: 'B', title: 'B', totalPoints: 10, questions: [
      { id: 'B-slot', type: 'true_false', prompt: 'Frozen B question', points: 10, skill: 'retention', difficulty: 'basic', section: 'I' },
    ], sections: [] }
    await act(async () => resolveGeneration!(Response.json({
      success: true, exam: partial, status: 'generating', readyCount: 1, totalSlots: 63,
      blueprint: { requestedDurationMinutes: 90, durationMinutes: 90 },
    })))
    await remount()
    assert.equal(read().examId, 'B')
    assert.equal(read().attemptId, attemptB)
    assert.deepEqual(read().exam?.questions, partial.questions)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1650)) })
    assert.ok(requests.some(r => r.mode === 'advance' && r.examId === 'B'))
    assert.equal(requests.filter(r => r.mode === 'generate').length, 2, 'Partial restore advances B without new generation')
    console.log('PASS production component reset, pending refresh, partial refresh and sibling isolation')
  } finally {
    await act(async () => root.unmount())
    globalThis.fetch = previousFetch
  }
}

main().catch(err => {
  console.error('CONTRACT FAILURE:', err)
  process.exit(1)
})
