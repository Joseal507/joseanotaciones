import assert from 'node:assert/strict'
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { normalizeGeneratedQuestion } from '../../lib/adaptive/evaluation/questionContract'
import { mapEnjoyerQuizQuestionsForUi } from '../../lib/quiz/fillBlankContract'
import { parseAcademicContent } from '../../lib/academic-content/parser'
import { FillBlankPresentation } from '../../components/quiz/FillBlankPresentation'
import { QuestionCard } from '../../components/materias/ALAIStudyALQuizzes'
import { scoreQuestion } from '../../lib/adaptive/evaluation/scoring'
import { isCanonicalQuizWrittenAnswerCorrect } from '../../lib/quiz/enjoyerProgressiveUi'

const fixtures = [
  'Para los gases en un sistema cerrado, la presión es directamente proporcional a la _____.',
  'El equilibrio químico sucede cuando una reacción y su reacción inversa proceden a la misma _____.',
]
const words = ['temperatura', 'presión', 'volumen', 'cantidad']
const options = words.map((text, index) => ({ id: `w${index + 1}`, text }))

function shape(value: string) {
  return {
    hasDollar1: value.includes('$1'),
    rawUnderscoreRuns: (value.match(/(?<!\\)_+/g) || []).map(run => run.length),
    escapedUnderscoreRuns: (value.match(/(?:\\_)+/g) || []).map(run => run.length / 2),
  }
}

function blankNodes(value: string) {
  const document = parseAcademicContent(value)
  let count = 0
  const walk = (nodes: any[]) => nodes.forEach(node => {
    if (node.type === 'blank') count += 1
    if (node.children) walk(node.children)
    if (node.items) node.items.forEach((item: any) => walk(item.nodes))
  })
  walk(document.nodes)
  return count
}

function AdaptiveProductionBranch({ prompt }: { prompt: string }) {
  const [answers, setAnswers] = useState([''])
  return <FillBlankPresentation prompt={prompt} options={options} answerIds={answers} onAnswerIdsChange={setAnswers} />
}

function FreeProductionBranch({ question }: { question: any }) {
  const [answer, setAnswer] = useState('')
  return <QuestionCard question={question} index={0} total={1} themeColor="#7c3aed" userAnswer={answer}
    setUserAnswer={setAnswer} isLocked={false} lastEntry={null} showWordBank setShowWordBank={() => {}}
    onVerify={() => {}} isEvaluating={false} onNext={() => {}} isLast helpEffects={[]} />
}

async function main() {
  const { document, window } = parseHTML('<html><body><div id="root"></div></body></html>')
  Object.assign(globalThis, { React, window, document, IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.getElementById('root') as HTMLElement
  const root = createRoot(container)

  for (const [fixtureIndex, fixture] of fixtures.entries()) {
    const adaptive = normalizeGeneratedQuestion({
      variant: 'word_bank_fill', targetDimension: 'recognition', difficulty: 'medium', questionText: fixture,
      conceptId: 'c1', conceptLabel: 'Gases', options, correctAnswer: ['w1'], explanation: '', hint: '',
    }, { activeConceptId: 'c1', activeConceptLabel: 'Gases', teachingBlockId: 'b1', targetDimension: 'recognition' } as any, `adaptive-q-${fixtureIndex}`)
    assert.ok(adaptive && adaptive.format === 'word_bank', 'Adaptive production normalization must accept fixture')
    const free = mapEnjoyerQuizQuestionsForUi([{ id: `free-q-${fixtureIndex}`, type: 'fill_blank', question: fixture, wordBank: words,
      acceptedAnswers: ['temperatura'], correctAnswer: 'temperatura' }])[0]

    await act(async () => root.render(<AdaptiveProductionBranch prompt={adaptive.questionText} />))
    const adaptiveDom = container.querySelector('[data-fill-blank-prompt]')?.textContent || ''
    const adaptiveRows = {
      input: shape(fixture), normalized: shape(adaptive.questionText), presentation: shape(adaptive.questionText),
      academic: shape(adaptive.questionText), parsedBlankNodes: blankNodes(adaptive.questionText), dom: shape(adaptiveDom),
    }

    await act(async () => root.render(<FreeProductionBranch question={free} />))
    const freeDom = container.querySelector('[data-fill-blank-prompt]')?.textContent || ''
    const freeRows = {
      input: shape(fixture), normalized: shape(String(free.question)), presentation: shape(String(free.question)),
      academic: shape(String(free.question)), parsedBlankNodes: blankNodes(String(free.question)), dom: shape(freeDom),
    }

    assert.deepEqual(freeRows, adaptiveRows, 'Adaptive and Free production boundaries must remain structurally identical')
    assert.equal(adaptiveRows.parsedBlankNodes, 1)
    assert.equal(adaptiveDom, fixture)
    assert.equal(freeDom, fixture)
    assert.equal(adaptiveDom.includes('$1'), false)
    assert.equal(freeDom.includes('$1'), false)
    assert.equal(container.querySelectorAll('[data-fill-blank-word-bank] button').length, words.length)
    console.log(JSON.stringify({ fixtureIndex, adaptiveRows, freeRows }, null, 2))
  }

  const adaptiveScore = scoreQuestion({ format: 'word_bank', options, correctAnswer: ['w1'] } as any, ['w1'])
  assert.equal(adaptiveScore.correct, true)
  assert.equal(isCanonicalQuizWrittenAnswerCorrect(['temperatura'], 'temperatura'), true)
  assert.equal(isCanonicalQuizWrittenAnswerCorrect(['temperatura'], 'presión'), false)
  await act(async () => root.unmount())
  console.log('quiz-fill-blank-mode-boundary-contracts: PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
