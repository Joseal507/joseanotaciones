'use client'

import { AcademicContent } from '../academic/AcademicContent'
import { toLatexSafeText } from '../../lib/academic-content/composition'

export interface FillBlankOption {
  id: string
  text: string
}

export function FillBlankPresentation({
  prompt,
  options,
  answerIds,
  onAnswerIdsChange,
  disabled = false,
  emptyBlank = '_____',
}: {
  prompt: string
  options: FillBlankOption[]
  answerIds: string[]
  onAnswerIdsChange: (answers: string[]) => void
  disabled?: boolean
  emptyBlank?: string
}) {
  let blankIndex = -1
  const nextBlankAnswer = () => {
    // Quiz currently has one authoritative fill-blank slot. AcademicContent
    // may invoke different blank render callbacks while composing the same
    // prompt, so a mutable callback counter must not move that single answer
    // away from slot 0.
    const index = answerIds.length === 1 ? 0 : ++blankIndex
    const answerId = answerIds[index] || ''
    const answerLabel = options.find(option => option.id === answerId)?.text || ''
    return { index, answerId, answerLabel }
  }
  const clearAnswer = (index: number) => {
    if (disabled) return
    const next = [...answerIds]
    next[index] = ''
    onAnswerIdsChange(next)
  }

  return (
    <div data-fill-blank-presentation>
      <div data-fill-blank-prompt style={{ fontSize: 17, lineHeight: 2, marginBottom: 20, padding: 16, background: 'rgba(15,23,42,0.05)', borderRadius: 12, border: '1px solid rgba(148,163,184,0.2)' }}>
        <AcademicContent
          content={prompt}
          renderBlank={() => {
            const { index, answerId, answerLabel } = nextBlankAnswer()
            return (
              <span
                data-fill-blank-slot={index}
                style={{ display: 'inline-block', minWidth: 100, padding: '4px 12px', margin: '0 4px', background: answerId ? 'rgba(59,130,246,0.2)' : 'rgba(148,163,184,0.1)', border: answerId ? '2px solid #60a5fa' : '2px dashed rgba(148,163,184,0.3)', borderRadius: 8, textAlign: 'center', color: answerId ? '#2563eb' : '#64748b', fontWeight: 600, cursor: answerId && !disabled ? 'pointer' : 'default', fontSize: 15 }}
                onClick={() => { if (answerId) clearAnswer(index) }}
              >
                {answerLabel ? <AcademicContent content={answerLabel} inline /> : emptyBlank}
              </span>
            )
          }}
          renderMathBlank={() => {
            const { index, answerId, answerLabel } = nextBlankAnswer()
            return {
              latex: toLatexSafeText(answerLabel),
              onClick: answerId && !disabled ? () => clearAnswer(index) : undefined,
            }
          }}
        />
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 10, textTransform: 'uppercase' }}>Banco de palabras</div>
      <div data-fill-blank-word-bank style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {options.map(option => {
          const isUsed = answerIds.includes(option.id)
          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled || isUsed}
              onClick={() => {
                const firstEmpty = answerIds.findIndex(answer => answer === '')
                const targetIndex = firstEmpty >= 0
                  ? firstEmpty
                  : answerIds.length === 1 ? 0 : -1
                if (targetIndex === -1) return
                const next = [...answerIds]
                next[targetIndex] = option.id
                onAnswerIdsChange(next)
              }}
              style={{ padding: '10px 18px', background: isUsed ? 'rgba(148,163,184,0.05)' : 'rgba(59,130,246,0.12)', color: isUsed ? '#64748b' : '#2563eb', border: isUsed ? '1px solid rgba(148,163,184,0.1)' : '1px solid rgba(59,130,246,0.3)', borderRadius: 999, cursor: disabled || isUsed ? 'default' : 'pointer', fontSize: 15, fontWeight: 600, opacity: isUsed ? 0.4 : 1, textDecoration: isUsed ? 'line-through' : 'none' }}
            >
              <AcademicContent content={option.text} inline />
            </button>
          )
        })}
      </div>
    </div>
  )
}
