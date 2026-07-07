'use client'

import { useState } from 'react'

interface DiagnosticQuestion {
  id: string
  layer: string
  type: string
  prompt: string
  options?: string[]
  correctAnswer: any
  explanation: string
  difficulty: number
  evidenceWeight: number
  conceptNames: string[]
  falseConfidenceTrap: boolean
}

interface Props {
  questions: DiagnosticQuestion[]
  materialTitle: string
  onComplete: (result: {
    answers: Array<{ questionId: string; correct: boolean; layer: string; confidenceLevel: string }>
    falseConfidenceDetected: boolean
    estimatedLevel: 'zero' | 'basic' | 'intermediate' | 'advanced'
  }) => void
}

export default function AdaptiveDiagnosis({ questions, materialTitle, onComplete }: Props) {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [selectedOption, setSelectedOption] = useState<number | null>(null)
  const [shortAnswer, setShortAnswer] = useState('')
  const [confidence, setConfidence] = useState<'high' | 'medium' | 'low' | null>(null)
  const [showFeedback, setShowFeedback] = useState(false)
  const [answers, setAnswers] = useState<Array<{
    questionId: string
    correct: boolean
    layer: string
    confidenceLevel: string
    wasCorrect: boolean
  }>>([])

  const current = questions[currentIdx]
  if (!current) return null

  const handleSubmit = () => {
    if (!confidence) return
    let correct = false

    if (current.type === 'multiple_choice') {
      correct = selectedOption === current.correctAnswer
    } else if (current.type === 'true_false') {
      const correctIsTrue = current.correctAnswer === true || current.correctAnswer === 0
      correct = selectedOption === (correctIsTrue ? 0 : 1)
    } else if (current.type === 'short_answer') {
      const userText = shortAnswer.toLowerCase().trim()
      const correctText = String(current.correctAnswer || '').toLowerCase().trim()
      correct = userText.length > 5 && (
        userText.includes(correctText.slice(0, 10)) ||
        correctText.includes(userText.slice(0, 10))
      )
    }

    setAnswers(prev => [...prev, {
      questionId: current.id,
      correct,
      layer: current.layer,
      confidenceLevel: confidence,
      wasCorrect: correct,
    }])
    setShowFeedback(true)
  }

  const handleNext = () => {
    setShowFeedback(false)
    setSelectedOption(null)
    setShortAnswer('')
    setConfidence(null)

    if (currentIdx + 1 >= questions.length) {
      // Calcular resultado final
      const allAnswers = answers
      const correct = allAnswers.filter(a => a.correct).length
      const total = allAnswers.length
      const score = total > 0 ? correct / total : 0

      // Detectar falsa confianza
      const falseConfidence = allAnswers.some(
        a => !a.correct && a.confidenceLevel === 'high'
      )

      // Estimar nivel real
      let estimatedLevel: 'zero' | 'basic' | 'intermediate' | 'advanced' = 'basic'
      if (score >= 0.8) estimatedLevel = 'advanced'
      else if (score >= 0.6) estimatedLevel = 'intermediate'
      else if (score >= 0.3) estimatedLevel = 'basic'
      else estimatedLevel = 'zero'

      onComplete({ answers: allAnswers, falseConfidenceDetected: falseConfidence, estimatedLevel })
      return
    }

    setCurrentIdx(prev => prev + 1)
  }

  const canSubmit = (
    (current.type === 'multiple_choice' || current.type === 'true_false') && selectedOption !== null ||
    current.type === 'short_answer' && shortAnswer.trim().length > 2
  ) && confidence !== null

  const lastAnswer = answers[answers.length - 1]

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10, letterSpacing: 3, color: 'rgba(58,46,31,.5)', marginBottom: 6, fontWeight: 700 }}>
            DIAGNÓSTICO INICIAL · {materialTitle}
          </div>
          <div style={{ height: 3, background: 'rgba(58,46,31,.1)', borderRadius: 2 }}>
            <div style={{
              height: '100%',
              width: `${((currentIdx) / questions.length) * 100}%`,
              background: '#d6b26f',
              borderRadius: 2,
              transition: 'width .4s ease',
            }} />
          </div>
          <div style={{ fontSize: 11, color: 'rgba(58,46,31,.4)', marginTop: 6, textAlign: 'right' }}>
            {currentIdx + 1} de {questions.length}
          </div>
        </div>

        {!showFeedback ? (
          <>
            {/* Capa de dificultad */}
            <div style={{
              display: 'inline-block',
              fontSize: 9, fontWeight: 800, letterSpacing: 2,
              color: current.layer === 'application' || current.layer === 'transfer'
                ? '#a8854a' : 'rgba(58,46,31,.4)',
              background: current.layer === 'application' || current.layer === 'transfer'
                ? 'rgba(168,133,74,.12)' : 'rgba(58,46,31,.05)',
              padding: '3px 8px', borderRadius: 999, marginBottom: 16,
            }}>
              {current.layer === 'recognition' ? 'RECONOCIMIENTO' :
               current.layer === 'comprehension' ? 'COMPRENSIÓN' :
               current.layer === 'application' ? 'APLICACIÓN' : 'TRANSFERENCIA'}
            </div>

            <div style={{ fontSize: 16, fontWeight: 700, color: '#3a2e1f', marginBottom: 20, lineHeight: 1.5 }}>
              {current.prompt}
            </div>

            {/* Opciones */}
            {(current.type === 'multiple_choice') && (
              <div style={{ marginBottom: 20 }}>
                {(current.options || []).map((opt, i) => (
                  <button key={i} onClick={() => setSelectedOption(i)} style={{
                    width: '100%', padding: '12px 16px', marginBottom: 8, borderRadius: 8,
                    border: selectedOption === i ? '2px solid #3a2e1f' : '1.5px solid rgba(58,46,31,.2)',
                    background: selectedOption === i ? 'rgba(58,46,31,.08)' : 'rgba(255,255,255,.4)',
                    color: '#3a2e1f', fontFamily: 'Georgia, serif', fontSize: 14,
                    cursor: 'pointer', textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center',
                  }}>
                    <span style={{ fontWeight: 700, color: 'rgba(58,46,31,.4)', minWidth: 20 }}>
                      {String.fromCharCode(65 + i)}.
                    </span>
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {current.type === 'true_false' && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                {['Verdadero', 'Falso'].map((opt, i) => (
                  <button key={i} onClick={() => setSelectedOption(i)} style={{
                    flex: 1, padding: '14px', borderRadius: 8,
                    border: selectedOption === i ? '2px solid #3a2e1f' : '1.5px solid rgba(58,46,31,.2)',
                    background: selectedOption === i ? 'rgba(58,46,31,.08)' : 'rgba(255,255,255,.4)',
                    color: '#3a2e1f', fontFamily: 'Georgia, serif', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  }}>{i === 0 ? 'V' : 'F'} — {opt}</button>
                ))}
              </div>
            )}

            {current.type === 'short_answer' && (
              <textarea
                value={shortAnswer}
                onChange={e => setShortAnswer(e.target.value)}
                placeholder="Escribe tu respuesta..."
                rows={3}
                style={{
                  width: '100%', padding: 14, borderRadius: 8,
                  border: '1.5px solid rgba(58,46,31,.2)', background: 'rgba(255,255,255,.6)',
                  fontSize: 14, fontFamily: 'Georgia, serif', color: '#3a2e1f',
                  resize: 'vertical', outline: 'none', marginBottom: 16, boxSizing: 'border-box',
                }}
              />
            )}

            {/* Selector de confianza */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: 'rgba(58,46,31,.5)', marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>
                ¿QUÉ TAN SEGURO/A ESTÁS?
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { key: 'high', label: 'Muy seguro', emoji: '💪' },
                  { key: 'medium', label: 'Algo seguro', emoji: '🤔' },
                  { key: 'low', label: 'No estoy seguro', emoji: '😅' },
                ].map(opt => (
                  <button key={opt.key} onClick={() => setConfidence(opt.key as any)} style={{
                    flex: 1, padding: '8px 4px', borderRadius: 8,
                    border: confidence === opt.key ? '2px solid #d6b26f' : '1.5px solid rgba(58,46,31,.15)',
                    background: confidence === opt.key ? 'rgba(214,178,111,.15)' : 'transparent',
                    color: '#3a2e1f', fontFamily: 'Georgia, serif', fontSize: 11,
                    cursor: 'pointer', textAlign: 'center', lineHeight: 1.4,
                  }}>
                    <div style={{ fontSize: 18 }}>{opt.emoji}</div>
                    <div style={{ fontWeight: confidence === opt.key ? 700 : 500 }}>{opt.label}</div>
                  </button>
                ))}
              </div>
            </div>

            <button onClick={handleSubmit} disabled={!canSubmit} style={{
              ...btnPrimary,
              opacity: canSubmit ? 1 : .4,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              width: '100%',
            }}>
              Responder →
            </button>
          </>
        ) : (
          // Feedback
          <div>
            <div style={{
              padding: '14px 18px', borderRadius: 8, marginBottom: 16,
              background: lastAnswer?.correct ? 'rgba(90,138,58,.1)' : 'rgba(139,26,26,.08)',
              borderLeft: `4px solid ${lastAnswer?.correct ? '#5a8a3a' : '#8b1a1a'}`,
            }}>
              <div style={{
                fontSize: 13, fontWeight: 800, letterSpacing: 1,
                color: lastAnswer?.correct ? '#3a5a1e' : '#8b1a1a', marginBottom: 6,
              }}>
                {lastAnswer?.correct ? '✓ CORRECTO' : '✗ INCORRECTO'}
                {!lastAnswer?.correct && lastAnswer?.confidenceLevel === 'high' && (
                  <span style={{ marginLeft: 10, fontSize: 11, color: '#f97316' }}>
                    ⚠️ Estabas muy seguro/a — ALAI tomará nota
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, color: '#3a2e1f', lineHeight: 1.6 }}>
                {current.explanation}
              </div>
            </div>

            <button onClick={handleNext} style={{ ...btnPrimary, width: '100%' }}>
              {currentIdx + 1 >= questions.length ? 'Ver mi plan →' : 'Siguiente →'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 200,
  background: 'radial-gradient(ellipse at center, #1a1410 0%, #0a0806 100%)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 24, fontFamily: 'Georgia, serif',
}

const cardStyle: React.CSSProperties = {
  width: '100%', maxWidth: 620,
  background: 'linear-gradient(135deg, #f5ecd5 0%, #e8d9b0 100%)',
  borderRadius: 12, padding: '36px 44px',
  boxShadow: '0 30px 80px rgba(0,0,0,.7)',
}

const btnPrimary: React.CSSProperties = {
  padding: '13px 28px', background: '#3a2e1f', color: '#f5ecd5',
  border: 'none', borderRadius: 8, fontFamily: 'Georgia, serif',
  fontSize: 14, fontWeight: 700, cursor: 'pointer',
}
