import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { FillBlankPresentation, type FillBlankOption } from '../../components/quiz/FillBlankPresentation'
import MatchingInteractionCore from '../../components/quiz/MatchingInteractionCore'
import { FillBlankRenderer } from '../../components/materias/ALAIStudyALExams'
import { runPersistedParityContracts } from './exam-parity-persisted-contracts'
import MatchingCanvas from '../../components/materias/MatchingCanvas'
import {
  authorSlotQuestion,
  authorSlotQuestionWithDiagnostics,
  sanitizeExamAnswerQuestion,
  toPublicExamQuestion,
  toPublicCriterionResult,
  gradeObjectiveQuestion,
  __routeDeps,
} from '../../app/api/alai-studyal-exam/route'
import type { ExamComposedSlot, ExamAnswerAuthority } from '../../lib/materialBrain/examEnjoyerContext'

// ══════════════════════════════════════════════════════════════════════════════
// 1. FILL BLANK PRESENTATION INTERACTION TEST
// ══════════════════════════════════════════════════════════════════════════════

function FillBlankHarness({ prompt, bank, initialValue = '', onChange }: { prompt: string; bank: string[]; initialValue?: string; onChange: (v: string) => void }) {
  const [val, setVal] = useState(initialValue)
  return <FillBlankRenderer q={{ id: 'ui', type: 'fill_blank', prompt, wordBank: bank, section: 'I', points: 10, skill: 'retention', difficulty: 'basic' }}
    value={val} onChange={(next: string) => { setVal(next); onChange(next) }} />
}

async function testFillBlankInteraction(root: ReturnType<typeof createRoot>, container: HTMLElement) {
  let selected = ''
  const prompt = 'El postulado cuántico de Bohr afirma que el momento angular está cuantizado en múltiplos de _____.'
  const bank = ['h/(2π)', 'c²', 'kT', 'mc²']

  await act(async () => {
    root.render(<FillBlankHarness prompt={prompt} bank={bank} onChange={(v) => { selected = v }} />)
  })

  // Verify prompt and word bank rendered
  const promptEl = container.querySelector('[data-fill-blank-prompt]')
  assert.ok(promptEl, 'Prompt container must exist')
  assert.match(promptEl.textContent || '', /_____/, 'Unfilled blank must display placeholder')

  const buttons = [...container.querySelectorAll('[data-fill-blank-word-bank] button')] as HTMLButtonElement[]
  assert.equal(buttons.length, 4, 'Must render 4 word bank buttons')

  // Click first button 'h/(2π)'
  const hBarBtn = buttons.find(b => b.textContent?.includes('h/(2π)'))
  assert.ok(hBarBtn, 'Target word button must exist')
  await act(async () => { hBarBtn.click() })

  assert.equal(selected, 'h/(2π)', 'onChange must receive selected word')
  assert.match(promptEl.textContent || '', /h\/\(2π\)/, 'Prompt must display filled word')
  assert.equal(hBarBtn.disabled, true, 'Selected word bank button must be disabled')

  // Click the blank to clear
  const blankSlot = container.querySelector('[data-fill-blank-slot="0"]') as HTMLElement
  assert.ok(blankSlot, 'Blank slot must be found')
  await act(async () => { blankSlot.click() })

  assert.equal(selected, '', 'Clicking filled blank must clear answer')
  assert.match(promptEl.textContent || '', /_____/, 'Cleared blank must show placeholder again')
  assert.equal(hBarBtn.disabled, false, 'Cleared word bank button must be re-enabled')

  for (const legacyBank of [[], ['one'], ['one', 'two'], ['one', 'two', 'three'], ['one','ONE','two','three']]) {
    await act(async () => root.render(<FillBlankHarness prompt={prompt} bank={legacyBank} onChange={() => {}} />))
    assert.ok(container.querySelector('input'), 'Invalid legacy bank uses production free text')
    assert.equal(container.querySelector('[data-fill-blank-presentation]'), null)
  }
  await act(async () => root.render(<FillBlankHarness prompt={prompt}
    bank={['a','b','c','d','e','f','g','h']} onChange={() => {}} />))
  assert.equal(container.querySelectorAll('[data-fill-blank-word-bank] button').length, 8)
  console.log('✓ testFillBlankInteraction passed')
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. MATCHING INTERACTION CORE TEST
// ══════════════════════════════════════════════════════════════════════════════

function MatchingHarness({ lefts, rights, onChange }: { lefts: string[]; rights: string[]; onChange: (conn: Record<number, number>) => void }) {
  const [connections, setConnections] = useState<Record<number, number>>({})
  const leftItems = lefts.map((text, id) => ({ id, text }))
  const rightItems = rights.map((text, id) => ({ id, text }))

  return (
    <MatchingInteractionCore
      leftItems={leftItems}
      rightItems={rightItems}
      connections={connections}
      allowToggleDisconnect={true}
      onConnectionsChange={(next) => {
        const num: Record<number, number> = {}
        for (const [k, v] of Object.entries(next)) num[Number(k)] = Number(v)
        setConnections(num)
        onChange(num)
      }}
    />
  )
}

async function testMatchingInteraction(root: ReturnType<typeof createRoot>, container: HTMLElement) {
  let lastConnections: Record<number, number> = {}
  const lefts = ['Bohr', 'Rutherford', 'Planck']
  const rights = ['Modelo planetario', 'Cuantización de energía', 'Niveles estacionarios']

  await act(async () => {
    root.render(<MatchingHarness lefts={lefts} rights={rights} onChange={(c) => { lastConnections = c }} />)
  })

  const leftCards = [...container.querySelectorAll('.matching-card-left')] as HTMLButtonElement[]
  const rightCards = [...container.querySelectorAll('.matching-card-right')] as HTMLButtonElement[]

  assert.equal(leftCards.length, 3, 'Must have 3 left cards')
  assert.equal(rightCards.length, 3, 'Must have 3 right cards')

  // Click left 0 (Bohr), then right 2 (Niveles estacionarios)
  await act(async () => { leftCards[0].click() })
  await act(async () => { rightCards[2].click() })

  assert.deepEqual(lastConnections, { 0: 2 }, 'Connection 0 -> 2 must be established')

  // Click left 1 (Rutherford), then right 0 (Modelo planetario)
  await act(async () => { leftCards[1].click() })
  await act(async () => { rightCards[0].click() })

  assert.deepEqual(lastConnections, { 0: 2, 1: 0 }, 'Connections {0:2, 1:0} must exist')

  // Toggle disconnect: Click left 0 (Bohr), then click right 2 again
  await act(async () => { leftCards[0].click() })
  await act(async () => { rightCards[2].click() })

  assert.deepEqual(lastConnections, { 1: 0 }, 'Connection 0 -> 2 must be removed via toggle')

  console.log('✓ testMatchingInteraction passed')
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. QUIZ MATCHING CANVAS COMPATIBILITY TEST
// ══════════════════════════════════════════════════════════════════════════════

async function testQuizMatchingCanvasCompatibility(root: ReturnType<typeof createRoot>, container: HTMLElement) {
  let value: Record<number, number> = {}
  const pairs = [
    { left: 'Hidrógeno', right: 'Z = 1' },
    { left: 'Helio', right: 'Z = 2' },
    { left: 'Litio', right: 'Z = 3' },
  ]

  function QuizHarness({ locked = false }: { locked?: boolean }) {
    const [val, setVal] = useState<Record<number, number>>({ 0: 0, 1: 1 })
    return (
      <MatchingCanvas
        pairs={pairs}
        value={val}
        onChange={(next) => {
          setVal(next)
          value = next
        }}
        locked={locked}
        themeColor="#7c3aed"
      />
    )
  }

  await act(async () => { root.render(<QuizHarness locked={false} />) })
  assert.match(container.textContent || '', /Conecta los conceptos/, 'Unlocked Quiz canvas must show instruction header')

  // Render locked
  await act(async () => { root.render(<QuizHarness locked={true} />) })
  assert.match(container.textContent || '', /2\/3 correctas/, 'Locked Quiz canvas must show score header')
  assert.match(container.textContent || '', /Hidrógeno\s*→\s*Z\s*=\s*1/, 'Locked breakdown must show pair analysis')

  console.log('✓ testQuizMatchingCanvasCompatibility passed')
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. MATCHING INTERACTION CORE NEUTRALITY TEST (BLOCKER 3)
// ══════════════════════════════════════════════════════════════════════════════

async function testMatchingInteractionCoreNeutrality(root: ReturnType<typeof createRoot>, container: HTMLElement) {
  const targetPath = existsSync('components/quiz/MatchingInteractionCore.tsx')
    ? 'components/quiz/MatchingInteractionCore.tsx'
    : path.resolve(__dirname, '../../components/quiz/MatchingInteractionCore.tsx')
  const coreSource = readFileSync(targetPath, 'utf8')
  assert.doesNotMatch(coreSource, /isConnectionCorrect|correctCount|connections\[i\] === i|matchingCorrectMap/)
  const lefts = [{ id: 'L0', text: 'Left 0' }]
  const rights = [{ id: 'R0', text: 'Right 0' }]
  const connections = { L0: 'R0' }

  // Neutral core must use presentation styling overrides without any answer keys or evaluation logic
  await act(async () => {
    root.render(
      <MatchingInteractionCore
        leftItems={lefts}
        rightItems={rights}
        connections={connections}
        connectionColors={{ L0: '#2563eb' }}
        leftItemStyles={{ L0: { borderColor: '#2563eb', backgroundColor: '#eff6ff' } }}
        rightItemStyles={{ R0: { borderColor: '#2563eb', backgroundColor: '#eff6ff' } }}
        disabled={true}
      />
    )
  })

  const leftCard = container.querySelector('.matching-card-left') as HTMLElement
  assert.ok(leftCard, 'Left card must exist')
  assert.match(leftCard.style.border, /#2563eb/, 'Left card border must use leftItemStyles override')
  assert.match(leftCard.style.background, /#eff6ff/, 'Left card background must use leftItemStyles override')

  const rightCard = container.querySelector('.matching-card-right') as HTMLElement
  assert.ok(rightCard, 'Right card must exist')
  assert.match(rightCard.style.border, /#2563eb/, 'Right card border must use rightItemStyles override')
  assert.match(rightCard.style.background, /#eff6ff/, 'Right card background must use rightItemStyles override')

  const leftDot = [...leftCard.querySelectorAll('span')].find(s => s.textContent?.trim() === '●') as HTMLElement
  assert.ok(leftDot, 'Left dot must exist')
  assert.equal(leftDot.style.color, '#2563eb', 'Left dot must use connectionColors override')

  const rightDot = [...rightCard.querySelectorAll('span')].find(s => s.textContent?.trim() === '●') as HTMLElement
  assert.ok(rightDot, 'Right dot must exist')
  assert.equal(rightDot.style.color, '#2563eb', 'Right dot must use connectionColors override')

  console.log('✓ testMatchingInteractionCoreNeutrality passed')
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. EXAM AUTHORING & PRIVACY (FILL BLANK & MATCHING)
// ══════════════════════════════════════════════════════════════════════════════

function testExamFillBlankAuthoringAndPrivacy() {
  const baseSlot: ExamComposedSlot = {
    id: 'slot_fb_1',
    type: 'fill_blank',
    skill: 'retention',
    difficulty: 'basic',
    points: 10,
    assessedTargetIds: ['t1'],
    contextTargetIds: [],
    cognitiveOperation: 'retrieve',
    evidenceRequirement: { minimumDemonstrationCount: 1, requiresIndependentVerification: true, requiresDistractorDiscrimination: true },
    answerAuthority: {
      kind: 'single_text',
      canonicalValue: 'cuantizado',
      distractorPool: ['continuo', 'relativista', 'indeterminado', 'ondulatorio', 'estacionario'],
    },
    suggestedFormat: 'fill_blank',
    sourceItemIds: ['item_1'],
    frozenSources: [{ materialId: 'm1', pages: [1], label: 'Bohr', content: 'cuantizado' }],
  }

  const blueprint = { examId: 'exam_123', slots: [baseSlot] } as any

  // A. Valid authoring (bank size 4..8, canonical appears exactly once)
  const raw = {
    type: 'fill_blank',
    prompt: 'Indica el estado del momento angular según Bohr: el momento angular está ___',
    wordBank: ['cuantizado', 'continuo', 'clásico'],
  }

  const authoredResult = authorSlotQuestionWithDiagnostics('exam_123', blueprint, baseSlot, raw)
  assert.ok(authoredResult.question, `Authoring must succeed, got rejection: ${authoredResult.rejectionReason}`)
  const q = authoredResult.question!

  assert.equal(q.type, 'fill_blank')
  assert.equal(q.expectedAnswer, 'cuantizado', 'expectedAnswer must be canonical')
  assert.ok(Array.isArray(q.wordBank), 'wordBank must be authored')
  assert.ok(q.wordBank.length >= 4 && q.wordBank.length <= 8, `wordBank length ${q.wordBank.length} must be in [4, 8]`)
  assert.equal(q.wordBank.filter((w: string) => w.toLowerCase() === 'cuantizado').length, 1, 'Canonical must appear exactly once')
  assert.equal(new Set(q.wordBank.map((w: string) => w.toLowerCase())).size, q.wordBank.length, 'wordBank items must be distinct after case-insensitive normalization')

  // B. Insufficient distractors (< 3) MUST REJECT authoring (Blocker 1)
  const slotNoDistractors: ExamComposedSlot = {
    ...baseSlot,
    id: 'slot_fb_insufficient',
    answerAuthority: {
      kind: 'single_text',
      canonicalValue: 'cuantizado',
      distractorPool: [], // empty pool
    },
  }

  // 1. Only 1 distractor provided in raw
  const rej1 = authorSlotQuestionWithDiagnostics('exam_123', blueprint, slotNoDistractors, {
    type: 'fill_blank',
    prompt: 'El momento está ___',
    wordBank: ['cuantizado', 'continuo'], // only 1 distractor
  })
  assert.equal(rej1.question, null, 'Must reject when fewer than 3 distractors exist')
  assert.match(rej1.rejectionReason || '', /INSUFFICIENT_DISTRACTORS/, 'Rejection reason must specify INSUFFICIENT_DISTRACTORS')

  // 2. Distractor matching canonical must be filtered out and NOT count
  const rej2 = authorSlotQuestionWithDiagnostics('exam_123', blueprint, slotNoDistractors, {
    type: 'fill_blank',
    prompt: 'El momento está ___',
    wordBank: ['cuantizado', 'Cuantizado', 'CUANTIZADO  ', 'continuo', 'ondulatorio'], // only 2 distinct distractors
  })
  assert.equal(rej2.question, null, 'Must reject when canonical collisions reduce distractors below 3')
  assert.match(rej2.rejectionReason || '', /INSUFFICIENT_DISTRACTORS/)

  // 3. Duplicate distractors must be normalized and deduplicated
  const rej3 = authorSlotQuestionWithDiagnostics('exam_123', blueprint, slotNoDistractors, {
    type: 'fill_blank',
    prompt: 'El momento está ___',
    wordBank: ['cuantizado', 'continuo', 'CONTINUO', ' continuo '], // only 1 unique distractor
  })
  assert.equal(rej3.question, null, 'Must reject when duplicates reduce distractors below 3')
  assert.match(rej3.rejectionReason || '', /INSUFFICIENT_DISTRACTORS/)

  // C. Distractor capping (max 8 items: 1 canonical + 7 distractors)
  const slotManyDistractors: ExamComposedSlot = {
    ...baseSlot,
    id: 'slot_fb_many',
    answerAuthority: {
      kind: 'single_text',
      canonicalValue: 'cuantizado',
      distractorPool: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10'],
    },
  }
  const capResult = authorSlotQuestionWithDiagnostics('exam_123', blueprint, slotManyDistractors, {
    type: 'fill_blank',
    prompt: 'El momento está ___',
    wordBank: ['cuantizado'],
  })
  assert.ok(capResult.question)
  assert.equal(capResult.question!.wordBank?.length, 5, 'Word bank must be capped at 5 items (4-5 product rule)')

  // D. Sanitization guards: bank < 4 or > 8 is not attached to base.wordBank (falls back to text input)
  const undersizedAuthored = { ...q, wordBank: ['cuantizado', 'continuo'] } // only 2 items
  const sanitizedUndersized = sanitizeExamAnswerQuestion(undersizedAuthored, 'I. Retención')
  assert.ok(sanitizedUndersized)
  assert.equal(sanitizedUndersized.wordBank, undefined, 'Sanitization must omit undersized wordBank to trigger clean text input fallback')

  const validSanitized = sanitizeExamAnswerQuestion(q, 'I. Retención')
  assert.ok(validSanitized)
  assert.ok(validSanitized.wordBank && validSanitized.wordBank.length >= 4, 'Sanitization must preserve valid wordBank')

  // E. Public DTO privacy
  const pub = toPublicExamQuestion(validSanitized)
  assert.equal((pub as any).expectedAnswer, undefined, 'expectedAnswer MUST be stripped from public DTO')
  assert.ok(Array.isArray(pub.wordBank), 'wordBank MUST be preserved on public DTO')
  assert.equal(pub.wordBank.length, validSanitized.wordBank.length)

  console.log('✓ testExamFillBlankAuthoringAndPrivacy passed')
}

function testExamMatchingAuthoringAndPrivacy() {
  const slot: ExamComposedSlot = {
    id: 'slot_match_1',
    type: 'matching',
    skill: 'relation',
    difficulty: 'medium',
    points: 12,
    assessedTargetIds: ['t1', 't2', 't3'],
    contextTargetIds: [],
    cognitiveOperation: 'compare',
    evidenceRequirement: { minimumDemonstrationCount: 3, requiresIndependentVerification: true, requiresDistractorDiscrimination: false },
    answerAuthority: {
      kind: 'pairs',
      pairs: [
        { left: 'Bohr', right: 'Órbitas circulares cuantizadas' },
        { left: 'Rutherford', right: 'Núcleo denso con electrones dispersos' },
        { left: 'Thomson', right: 'Pudín de pasas con cargas embebidas' },
        { left: 'Dalton', right: 'Esferas macizas indivisibles' },
      ],
    },
    suggestedFormat: 'matching',
    sourceItemIds: ['item_1'],
    frozenSources: [{ materialId: 'm1', pages: [1], label: 'Modelos atómicos', content: 'Modelos atómicos históricos' }],
  }

  const blueprint = { examId: 'exam_456', slots: [slot] } as any
  const raw = {
    type: 'matching',
    prompt: 'Compara y relaciona cada científico con su postulado del modelo atómico.',
  }

  // Deterministic test inputs to the production entropy boundary, not a flaky sampling test.
  const originalDraw = __routeDeps.matchingRandomInt
  try {
    __routeDeps.matchingRandomInt = max => max - 1
    const identity = authorSlotQuestionWithDiagnostics('exam_456', blueprint, slot, raw).question!
    assert.deepEqual(identity.matchingCorrectMap, { 0: 0, 1: 1, 2: 2, 3: 3 })
    __routeDeps.matchingRandomInt = () => 0
    const nonidentity = authorSlotQuestionWithDiagnostics('exam_456', blueprint, slot, raw).question!
    assert.notDeepEqual(nonidentity.matchingCorrectMap, identity.matchingCorrectMap)
  } finally { __routeDeps.matchingRandomInt = originalDraw }

  const authoredResult = authorSlotQuestionWithDiagnostics('exam_456', blueprint, slot, raw)
  const q = authoredResult.question!

  assert.equal(q.type, 'matching')
  assert.ok(Array.isArray(q.matchingLeftTexts), 'matchingLeftTexts must exist')
  assert.ok(Array.isArray(q.matchingRightTexts), 'matchingRightTexts must exist')
  assert.ok(q.matchingCorrectMap, 'matchingCorrectMap must exist')

  assert.equal(q.matchingLeftTexts.length, 4)
  assert.equal(q.matchingRightTexts.length, 4)
  assert.equal(Object.keys(q.matchingCorrectMap).length, 4)

  // Verify correctness correspondence in private artifact
  for (let i = 0; i < 4; i++) {
    const rightColIdx = q.matchingCorrectMap[i]
    assert.equal(q.matchingRightTexts[rightColIdx], q.pairs![i].right, 'matchingCorrectMap must point to the true right text')
  }

  // B. Public DTO privacy
  const pub = toPublicExamQuestion(q)
  assert.equal((pub as any).pairs, undefined, 'pairs MUST be stripped from public question')
  assert.equal((pub as any).matchingCorrectMap, undefined, 'matchingCorrectMap MUST be stripped from public question')
  assert.ok(Array.isArray(pub.matchingLeftTexts), 'matchingLeftTexts MUST be preserved on public question')
  assert.ok(Array.isArray(pub.matchingRightTexts), 'matchingRightTexts MUST be preserved on public question')

  // Client knowing examId, slotId, and public DTO cannot reconstruct matchingCorrectMap
  assert.equal((pub as any).entropy, undefined, 'Private entropy must never be leaked')
  assert.equal((pub as any).seed, undefined, 'Seed must never be leaked')

  console.log('✓ testExamMatchingAuthoringAndPrivacy passed')
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. RESULT DTO PRIVACY TEST (BLOCKER 4)
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// 7. EXAM EVALUATION & SCORING CONTRACTS (NO 50% FALLBACK, HONEST CRITERIA)
// ══════════════════════════════════════════════════════════════════════════════

async function testExamEvaluationScoring() {
  const qFillBlank = {
    id: 'q1',
    slotId: 'slot_1',
    section: 'I',
    type: 'fill_blank' as const,
    prompt: 'Bohr postuló que el momento angular está ___',
    expectedAnswer: 'cuantizado',
    points: 10,
    skill: 'retention' as const,
    difficulty: 'basic' as const,
    assessmentCriteria: [{ id: 'c1', description: 'Uso del término correcto', targetId: 't1', weight: 1.0 }],
  }

  const qMatching = {
    id: 'q2',
    slotId: 'slot_2',
    section: 'II',
    type: 'matching' as const,
    prompt: 'Relaciona',
    matchingLeftTexts: ['L0', 'L1'],
    matchingRightTexts: ['R1', 'R0'], // Shuffled: L0 -> R0 (index 1), L1 -> R1 (index 0)
    matchingCorrectMap: { 0: 1, 1: 0 },
    points: 10,
    skill: 'relation' as const,
    difficulty: 'medium' as const,
    assessmentCriteria: [
      { id: 'c2_0', description: 'Par 0', targetId: 't2', weight: 0.5 },
      { id: 'c2_1', description: 'Par 1', targetId: 't3', weight: 0.5 },
    ],
  }

  // 1. Fill Blank Scoring
  assert.equal(gradeObjectiveQuestion(qFillBlank, 'cuantizado'), true, 'Exact fill blank match must be correct')
  assert.equal(gradeObjectiveQuestion(qFillBlank, 'CUANTIZADO'), true, 'Case-insensitive fill blank match must be correct')
  assert.equal(gradeObjectiveQuestion(qFillBlank, 'continuo'), false, 'Wrong fill blank must be incorrect')
  assert.equal(gradeObjectiveQuestion(qFillBlank, ''), false, 'Empty fill blank must be incorrect')
  assert.equal(gradeObjectiveQuestion(qFillBlank, null), false, 'Unanswered fill blank must be incorrect')

  // 2. Matching Scoring
  assert.equal(gradeObjectiveQuestion(qMatching, { 0: 1, 1: 0 }), true, 'Fully correct matching must be true')
  assert.equal(gradeObjectiveQuestion(qMatching, { 0: 1, 1: 1 }), false, 'Partially correct matching is not whole-question true')
  assert.equal(gradeObjectiveQuestion(qMatching, { 0: 0, 1: 1 }), false, 'Fully wrong matching must be false')
  assert.equal(gradeObjectiveQuestion(qMatching, {}), false, 'Empty matching must be false')
  assert.equal(gradeObjectiveQuestion(qMatching, null), false, 'Unanswered matching must be false')

  // 3. Other closed types regression check (must be unaffected)
  const mcq = { type: 'multiple_choice' as const, correctAnswer: 2 } as any
  assert.equal(gradeObjectiveQuestion(mcq, 2), true)
  assert.equal(gradeObjectiveQuestion(mcq, 0), false)

  const tf = { type: 'true_false' as const, correctAnswer: false } as any
  assert.equal(gradeObjectiveQuestion(tf, false), true)
  assert.equal(gradeObjectiveQuestion(tf, true), false)

  const ms = { type: 'multi_select' as const, correctAnswers: [0, 2] } as any
  assert.equal(gradeObjectiveQuestion(ms, [0, 2]), true)
  assert.equal(gradeObjectiveQuestion(ms, [2, 0]), true)
  assert.equal(gradeObjectiveQuestion(ms, [0]), false)

  console.log('✓ testExamEvaluationScoring passed')
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  const { document, window } = parseHTML('<html><body><div id="root"></div></body></html>')
  Object.assign(globalThis, { React, window, document, IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.getElementById('root') as HTMLElement
  const root = createRoot(container)

  console.log('Running exam-quiz-interaction-parity-contracts...')
  await testFillBlankInteraction(root, container)
  await testMatchingInteraction(root, container)
  await testMatchingInteractionCoreNeutrality(root, container)
  await testQuizMatchingCanvasCompatibility(root, container)
  testExamFillBlankAuthoringAndPrivacy()
  testExamMatchingAuthoringAndPrivacy()
  await runPersistedParityContracts()
  await testExamEvaluationScoring()

  await act(async () => { root.unmount() })
  console.log('ALL EXAM-QUIZ INTERACTION PARITY CONTRACTS PASSED!')
}

main().catch((err) => {
  console.error('Test failure:', err)
  process.exit(1)
})

