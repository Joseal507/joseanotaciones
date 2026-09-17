'use client'

import MathText from '../MathText'

export interface EnjoyerQuizRenderableQuestion {
  type: string
  question: string
  wordBank?: string[]
}

export function EnjoyerQuizQuestionPrompt({ question }: {
  question: EnjoyerQuizRenderableQuestion
  slot: number
}) {
  return <MathText text={question.question} />
}
