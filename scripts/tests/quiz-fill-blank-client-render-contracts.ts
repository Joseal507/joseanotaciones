import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { QuestionCard } from '../../components/materias/ALAIStudyALQuizzes'
import { mapEnjoyerQuizResponseQuestions } from '../../lib/quiz/enjoyerProgressiveUi'

const bank = ['constante', 'variable', 'cero', 'infinita']

function assertSingleVisibleBlank(value: string) {
  assert.equal((value.match(/_{3,}/g) || []).length, 1)
  assert.doesNotMatch(value, /\$1/)
}

async function main() {
  const { document, window } = parseHTML('<html><body><div id="root"></div></body></html>')
  Object.assign(globalThis, { React, window, document, IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.getElementById('root')
  assert.ok(container)
  const root = createRoot(container)
  const renderProductionQuestion = async (
    question: Record<string, unknown>,
    userAnswer: string | null = null,
  ) => {
    await act(async () => {
      root.render(React.createElement(QuestionCard as React.ComponentType<any>, {
        question: { id: 'fill-blank-runtime-contract', acceptedAnswers: ['velocidad'],
          correctAnswer: 'velocidad', ...question },
        index: 0, total: 1, themeColor: '#7c3aed', userAnswer,
        setUserAnswer: () => undefined, isLocked: false, lastEntry: null,
        showWordBank: true, setShowWordBank: () => undefined, onVerify: () => undefined,
        isEvaluating: false, onNext: () => undefined, isLast: true, helpEffects: [],
      }))
    })
    return container.querySelector('[data-fill-blank-prompt]')?.textContent || ''
  }

  const canonical = mapEnjoyerQuizResponseQuestions([{ type: 'fill_blank', question: 'formación de _____', wordBank: bank }])
  assert.equal(canonical[0].wordBank.length, 4)
  assert.equal(await renderProductionQuestion(canonical[0]), 'formación de _____')
  assertSingleVisibleBlank(container.querySelector('[data-fill-blank-prompt]')?.textContent || '')

  for (const sentence of [
    'La ley de velocidad representa la concentración del reactivo _____.',
    'Las concentraciones de reactivos y productos permanecen _____.',
  ]) {
    const mapped = mapEnjoyerQuizResponseQuestions([{ type: 'fill_blank', question: sentence, wordBank: bank }])
    assert.equal(await renderProductionQuestion(mapped[0]), sentence)
    assertSingleVisibleBlank(container.querySelector('[data-fill-blank-prompt]')?.textContent || '')
    assert.equal(mapped[0].wordBank.length, bank.length)
  }

  const productionBranchQuestion = {
    id: 'fill-blank-runtime-contract',
    type: 'fill_blank',
    question: 'El equilibrio químico se define como el estado en el que una reacción química y su reacción inversa ocurren a la misma _____.',
    wordBank: ['velocidad', 'presión', 'temperatura', 'concentración'],
    acceptedAnswers: ['velocidad'],
    correctAnswer: 'velocidad',
  }
  const productionPrompt = await renderProductionQuestion(productionBranchQuestion)
  assert.equal(productionPrompt, productionBranchQuestion.question)
  assertSingleVisibleBlank(productionPrompt)

  // A selected bank answer must replace the visible blank inline.
  const selectedPrompt = await renderProductionQuestion(productionBranchQuestion, 'velocidad')
  assert.equal(selectedPrompt, productionBranchQuestion.question.replace('_____', 'velocidad'))
  assert.doesNotMatch(selectedPrompt, /_{3,}/)

  const legacy = mapEnjoyerQuizResponseQuestions([{ type: 'fill_blank', question: 'formación de$1 ___', wordBank: bank }])
  assert.equal(legacy[0].wordBank.length, 4)
  assert.equal(await renderProductionQuestion(legacy[0]), 'formación de _____')
  assertSingleVisibleBlank(container.querySelector('[data-fill-blank-prompt]')?.textContent || '')

  // The real failure: AcademicContent's degraded fallback used a nonexistent
  // replacement capture while processing the underscores in the blank.
  const degradedMath = await renderProductionQuestion({ type: 'fill_blank', question: 'Kc = $x; formación de _____', wordBank: bank })
  assert.doesNotMatch(degradedMath, /\$1/)
  assert.equal(degradedMath, 'Kc = x; formación de _____')
  await act(async () => { root.unmount() })
  console.log('quiz-fill-blank-client-render-contracts: PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
