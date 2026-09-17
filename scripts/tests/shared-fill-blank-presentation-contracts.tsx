import assert from 'node:assert/strict'
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { FillBlankPresentation } from '../../components/quiz/FillBlankPresentation'
import { QuestionCard } from '../../components/materias/ALAIStudyALQuizzes'
import { scoreQuestion } from '../../lib/adaptive/evaluation/scoring'
import { isCanonicalQuizWrittenAnswerCorrect } from '../../lib/quiz/enjoyerProgressiveUi'

const prompt = 'El equilibrio químico se define como el estado en el que una reacción química y su reacción inversa ocurren a la misma _____.'
const words = ['velocidad', 'presión', 'temperatura', 'concentración']
const options = words.map((text, index) => ({ id: `w${index + 1}`, text }))

function AdaptiveHarness() {
  const [answers, setAnswers] = useState([''])
  return <FillBlankPresentation prompt={prompt} options={options} answerIds={answers} onAnswerIdsChange={setAnswers} />
}

function FreeHarness() {
  const [answer, setAnswer] = useState('')
  return <QuestionCard {...({
    question: { id: 'free-fill', type: 'fill_blank', question: prompt, wordBank: words,
      acceptedAnswers: ['velocidad'], correctAnswer: 'velocidad' },
    index: 0, total: 1, themeColor: '#7c3aed', userAnswer: answer, setUserAnswer: setAnswer,
    isLocked: false, lastEntry: null, showWordBank: true, setShowWordBank: () => undefined,
    onVerify: () => undefined, isEvaluating: false, onNext: () => undefined, isLast: true,
    helpEffects: [],
  } as any)} />
}

async function renderAndSelect(root: ReturnType<typeof createRoot>, container: HTMLElement, element: React.ReactElement, expectedButton: string) {
  await act(async () => { root.render(element) })
  const initialPrompt = container.querySelector('[data-fill-blank-prompt]')?.textContent || ''
  assert.equal(initialPrompt, prompt)
  assert.doesNotMatch(container.textContent || '', /\$1/)
  assert.equal((initialPrompt.match(/_{3,}/g) || []).length, 1)
  const buttons = [...container.querySelectorAll('[data-fill-blank-word-bank] button')]
  assert.equal(buttons.length, 4)
  const answerButton = buttons.find(button => button.textContent === expectedButton) as HTMLElement | undefined
  assert.ok(answerButton)
  await act(async () => { answerButton.click() })
  assert.match(container.querySelector('[data-fill-blank-prompt]')?.textContent || '', /velocidad/)
  assert.doesNotMatch(container.textContent || '', /\$1/)
}

async function main() {
  const { document, window } = parseHTML('<html><body><div id="root"></div></body></html>')
  Object.assign(globalThis, { React, window, document, IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.getElementById('root') as HTMLElement
  const root = createRoot(container)

  await renderAndSelect(root, container, <AdaptiveHarness />, 'velocidad')
  const adaptiveScore = scoreQuestion({
    id: 'adaptive-fill', format: 'word_bank', questionText: prompt,
    options, correctAnswer: ['w1'],
  } as any, ['w1'])
  assert.equal(adaptiveScore.correct, true)

  await renderAndSelect(root, container, <FreeHarness />, 'velocidad')
  assert.equal(isCanonicalQuizWrittenAnswerCorrect(['velocidad'], 'velocidad'), true)
  assert.equal(isCanonicalQuizWrittenAnswerCorrect(['velocidad'], 'presión'), false)

  await act(async () => { root.unmount() })
  console.log('shared-fill-blank-presentation-contracts: PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
