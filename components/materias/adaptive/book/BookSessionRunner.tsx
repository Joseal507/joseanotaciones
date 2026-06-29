'use client'

import { useState, useEffect, useRef } from 'react'
import type { AdaptiveSession, AdaptiveStep } from '../../../../lib/adaptive'
import { STEP_TYPE_INSTRUCTION, getSessionTopicContext } from '../../../../lib/adaptive'
import { buildAdaptiveContext, serializeAdaptiveContext, buildFocusInstruction } from '../../../../lib/adaptive/adaptiveContext'

// ── Markdown ligero para texto del libro ────────────────────────
function renderMarkdownText(text: string): React.ReactNode[] {
  if (!text) return []
  const lines = text.split('\n')
  return lines.map((line, lineIdx) => {
    if (!line.trim()) return <br key={`br-${lineIdx}`} />

    // Headings tipo **texto** que aparecen solos en la línea
    const fullBold = line.match(/^\*\*(.+?)\*\*$/)
    if (fullBold) {
      return (
        <h3 key={lineIdx} style={{
          fontSize: 17,
          fontWeight: 700,
          color: '#3a2e1f',
          marginTop: lineIdx > 0 ? 18 : 0,
          marginBottom: 8,
          fontFamily: 'Georgia, serif',
          letterSpacing: 0.2,
        }}>
          {fullBold[1]}
        </h3>
      )
    }

    // Línea normal con posibles **negritas** inline
    const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
    return (
      <p key={lineIdx} style={{
        margin: '0 0 10px 0',
        fontSize: 14.5,
        lineHeight: 1.75,
        color: '#3a2e1f',
        fontFamily: 'Georgia, "Times New Roman", serif',
        letterSpacing: 0.1,
      }}>
        {parts.map((part, i) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i} style={{ fontWeight: 700, color: '#1f1610' }}>{part.slice(2, -2)}</strong>
          }
          if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
            return <em key={i} style={{ fontStyle: 'italic' }}>{part.slice(1, -1)}</em>
          }
          return <span key={i}>{part}</span>
        })}
      </p>
    )
  })
}



interface Props {
  session: AdaptiveSession
  materialContent: string
  masteryContext: any
  onSessionComplete: (result: {
    domainGain: number
    conceptsImproved: string[]
    stepResults: Array<{ stepId: string; score?: number; correct?: boolean }>
  }) => void
  onClose: () => void  // vuelve al libro
}

interface StepContent {
  type: 'loading' | 'text' | 'lesson' | 'flashcards' | 'quiz' | 'input' | 'feedback'
  content?: string
  cards?: Array<{ front: string; back: string }>
  questions?: Array<{
    id: string
    question: string
    options?: string[]
    correctAnswer?: string
    type: 'multiple_choice' | 'open'
  }>
  feedbackMessage?: string
  // Nueva estructura: mini clase guiada
  lesson?: {
    hook: string
    sessionGoal: string
    whyItMatters: string
    priorKnowledgeBridge: string
    explanationBlocks: Array<{
      title: string
      content: string
      analogy?: string
      example?: string
      checkQuestion?: string
    }>
    firstCheckpoint?: {
      question: string
      expectedIdea: string
      feedbackIfWrong: string
      alternativeExplanation?: string
    }
    checkpoints?: Array<{
      question: string
      questionType?: string
      expectedIdea: string
      feedbackIfWrong: string
      alternativeExplanation?: string
    }>
    intentDeclaration?: string
    closingSummary?: string
    closing?: string
    nextStepReason?: string
    nextStepHint?: string
  }
  reasoning?: any
  lessonStage?: string
}

export default function BookSessionRunner({
  session,
  materialContent,
  masteryContext,
  onSessionComplete,
  onClose,
}: Props) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [stepContent, setStepContent] = useState<StepContent>({ type: 'loading' })
  const [userInput, setUserInput] = useState('')
  const [stepResults, setStepResults] = useState<Array<{ stepId: string; score?: number; correct?: boolean }>>([])
  const [cardIndex, setCardIndex] = useState(0)
  const [cardFlipped, setCardFlipped] = useState(false)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null)
  const [answerSubmitted, setAnswerSubmitted] = useState(false)
  const correctRef = useRef(0)
  const answeredRef = useRef(0)
  const [finishing, setFinishing] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const currentStep = session.steps[currentStepIndex]
  const totalSteps = session.steps.length
  const progressPercent = Math.round((currentStepIndex / totalSteps) * 100)
  const topicCtx = getSessionTopicContext(session)

  const adaptiveCtx = buildAdaptiveContext({
    session: {
      topicId: session.topicId,
      topicTitle: session.topicTitle,
      targetConcepts: session.targetConcepts,
      evidenceGoal: session.evidenceGoal,
      sourcePages: session.sourcePages,
      sessionNumber: session.sessionNumber,
      purpose: session.purpose,
    },
    step: { type: currentStep?.type ?? 'explain' },
    materialContent,
    materialTitle: (masteryContext as any)?.materialTitle ?? '',
    masterySnapshot: masteryContext as any,
  })

  function makeAdaptivePayload(extra: Record<string, unknown> = {}) {
    return { ...serializeAdaptiveContext(adaptiveCtx), ...extra }
  }

  useEffect(() => {
    if (!currentStep) return
    setStepContent({ type: 'loading' })
    setUserInput('')
    setCardIndex(0)
    setCardFlipped(false)
    setQuestionIndex(0)
    setSelectedAnswer(null)
    setAnswerSubmitted(false)
    correctRef.current = 0
    answeredRef.current = 0
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    loadStepContent(currentStep, abortRef.current.signal)
    return () => abortRef.current?.abort()
  }, [currentStepIndex])

  async function loadStepContent(step: AdaptiveStep, signal: AbortSignal) {
    try {
      switch (step.type) {
        case 'explain': {
          const isFirst = session.sessionNumber === 1 && currentStepIndex === 0
          const res = await fetch('/api/adaptive/explain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...makeAdaptivePayload(),
              isFirstSession: isFirst,
            }),
            signal,
          })
          if (!res.ok) throw new Error('API error')
          const data = await res.json()
          if (data.lesson && data.lesson.hook) {
            setStepContent({
              type: 'lesson',
              lesson: data.lesson,
              reasoning: data.reasoning,
              lessonStage: data.lesson.intentDeclaration ? 'intent' : 'hook',
            })
          } else {
            setStepContent({ type: 'text', content: data.content || data.analysis || 'Cargando...' })
          }
          break
        }
        case 'active_recall':
        case 'repair': {
          // Generar pregunta REAL desde ALAI, no usar instruction genérico
          try {
            const res = await fetch('/api/adaptive/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...makeAdaptivePayload(),
                message: `Genera UNA sola pregunta abierta, profunda y específica sobre "${topicCtx.topicTitle}" enfocada en estos conceptos: ${(topicCtx.targetConcepts || []).slice(0,3).join(', ')}. La pregunta debe obligar al estudiante a pensar, no a recordar. Responde SOLO con la pregunta, sin texto extra.`,
              }),
              signal,
            })
            if (res.ok) {
              const data = await res.json()
              const question = (data.message || data.content || step.instruction || '').trim()
              setStepContent({ type: 'input', content: question })
            } else {
              setStepContent({ type: 'input', content: step.instruction })
            }
          } catch {
            setStepContent({ type: 'input', content: step.instruction })
          }
          break
        }
        case 'micro_flashcards': {
          const res = await fetch('/api/adaptive/flashcards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(makeAdaptivePayload({ count: 5 })),
            signal,
          })
          if (!res.ok) throw new Error('API error')
          const data = await res.json()
          setStepContent({ type: 'flashcards', cards: (data.cards || data.flashcards || []).slice(0, 5) })
          break
        }
        case 'micro_quiz':
        case 'mini_exam': {
          const endpoint = step.type === 'mini_exam' ? '/api/adaptive/exam' : '/api/adaptive/quiz'
          const count = step.type === 'mini_exam' ? 6 : 3
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(makeAdaptivePayload({ count })),
            signal,
          })
          if (!res.ok) throw new Error('API error')
          const data = await res.json()
          const rawQ = data.questions || data.quizzes || data.preguntas || []
          const questions = rawQ.slice(0, count).map((q: any, i: number) => ({
            id: String(i),
            question: q.question || q.pregunta || '',
            options: q.options || q.opciones || [],
            correctAnswer: q.correctAnswer || q.respuestaCorrecta || '',
            type: 'multiple_choice' as const,
          }))
          setStepContent({ type: 'quiz', questions })
          break
        }
        case 'coach_feedback': {
          setStepContent({ type: 'feedback', feedbackMessage: generateFeedback(stepResults) })
          break
        }
        default:
          setStepContent({ type: 'text', content: step.instruction })
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      setStepContent({ type: 'text', content: step.instruction + '\n\n(Continúa de todas formas.)' })
    }
  }

  function generateFeedback(results: Array<{ score?: number }>): string {
    const scores = results.map(r => r.score ?? 0).filter(s => s > 0)
    if (scores.length === 0) return 'Completaste esta parte. Sigamos.'
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    if (avg >= 80) return `Excelente. Promedio: ${avg}%. Tu comprensión es sólida.`
    if (avg >= 60) return `Bien. Promedio: ${avg}%. Hay puntos para reforzar.`
    return `Promedio: ${avg}%. Necesitamos trabajar más estos puntos.`
  }

  async function handleInputSubmit() {
    if (!userInput.trim()) return
    let score = 60
    try {
      const res = await fetch('/api/adaptive/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...makeAdaptivePayload(),
          message: userInput,
          evaluateOnly: true,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const num = parseInt(String(data.message).match(/\d+/)?.[0] || '60')
        score = isNaN(num) ? 60 : Math.min(100, Math.max(0, num))
      }
    } catch {}
    const result = { stepId: currentStep.id, score, correct: score >= 60 }
    setStepResults(prev => [...prev, result])
    advanceStep(result)
  }

  function handleAnswerSelect(answer: string) {
    if (answerSubmitted) return
    setSelectedAnswer(answer)
    setAnswerSubmitted(true)
    const q = stepContent.questions?.[questionIndex]
    answeredRef.current += 1
    if (answer === q?.correctAnswer) correctRef.current += 1
  }

  function handleNextQuestion() {
    setSelectedAnswer(null)
    setAnswerSubmitted(false)
    const questions = stepContent.questions || []
    if (questionIndex + 1 < questions.length) {
      setQuestionIndex(prev => prev + 1)
    } else {
      const score = Math.round((correctRef.current / Math.max(1, answeredRef.current)) * 100)
      const result = { stepId: currentStep.id, score, correct: score >= 60 }
      setStepResults(prev => [...prev, result])
      advanceStep(result)
    }
  }

  function handleCardAnswer(knew: boolean) {
    answeredRef.current += 1
    if (knew) correctRef.current += 1
    setCardFlipped(false)
    const cards = stepContent.cards || []
    if (cardIndex + 1 < cards.length) {
      setCardIndex(prev => prev + 1)
    } else {
      const score = Math.round((correctRef.current / Math.max(1, answeredRef.current)) * 100)
      const result = { stepId: currentStep.id, score, correct: score >= 60 }
      setStepResults(prev => [...prev, result])
      advanceStep(result)
    }
  }

  function advanceStep(result: any) {
    const next = currentStepIndex + 1
    if (next < totalSteps) setCurrentStepIndex(next)
    else finishSession([...stepResults, result])
  }

  function finishSession(results: any[]) {
    setFinishing(true)
    const scores = results.map(r => r.score ?? 0).filter(s => s > 0)
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
    const domainGain = Math.round((avgScore / 100) * session.expectedDomainGain)
    setTimeout(() => {
      onSessionComplete({
        domainGain,
        conceptsImproved: session.targetConcepts || [],
        stepResults: results,
      })
    }, 800)
  }

  function handleContinueText() {
    const result = { stepId: currentStep.id, score: 0, correct: undefined }
    setStepResults(prev => [...prev, result])
    advanceStep(result)
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'radial-gradient(ellipse at center, #1a1410 0%, #0a0806 100%)',
      zIndex: 100,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      overflow: 'auto',
    }}>
      {/* Botón volver al libro */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 20,
          left: 24,
          background: 'rgba(214,178,111,0.08)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(214,178,111,0.3)',
          color: 'rgba(214,178,111,0.9)',
          padding: '10px 18px',
          borderRadius: 999,
          fontSize: 11,
          cursor: 'pointer',
          letterSpacing: 1.5,
          fontFamily: 'Georgia, serif',
          zIndex: 200,
        }}
      >
        ← VOLVER AL LIBRO
      </button>

      {finishing && (
        <div style={{ textAlign: 'center', color: '#d6b26f', fontFamily: 'Georgia, serif' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📖</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Guardando tu progreso...</div>
        </div>
      )}

      {!finishing && (
        <div style={{
          width: '100%',
          maxWidth: 720,
          minHeight: 600,
          background: 'linear-gradient(135deg, #f5ecd5 0%, #e8d9b0 100%)',
          borderRadius: 8,
          padding: '50px 60px',
          fontFamily: 'Georgia, serif',
          color: '#3a2e1f',
          position: 'relative',
          boxShadow: `
            0 30px 80px rgba(0,0,0,0.7),
            inset 0 0 0 1px rgba(58,46,31,0.08),
            inset 8px 0 20px rgba(0,0,0,0.1)
          `,
          overflow: 'hidden',
        }}>
          {/* Textura papel */}
          <div style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `
              radial-gradient(circle at 30% 20%, rgba(139,69,19,0.04) 0%, transparent 50%),
              radial-gradient(circle at 70% 80%, rgba(139,69,19,0.05) 0%, transparent 50%)
            `,
            pointerEvents: 'none',
          }} />

          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 28,
            fontSize: 10,
            letterSpacing: 3.5,
            color: 'rgba(58,46,31,0.5)',
            fontWeight: 600,
            fontFamily: 'Georgia, "Times New Roman", serif',
          }}>
            <span style={{
              display: 'inline-block',
              width: 24,
              height: 1,
              background: 'rgba(58,46,31,0.4)',
            }} />
            THE STUDYAL PROCESS
            <span style={{ opacity: 0.5 }}>·</span>
            <span>SESIÓN {String(session.sessionNumber).padStart(2, '0')}</span>
          </div>

          {/* Título del topic */}
          <div style={{
            fontSize: 30,
            fontWeight: 700,
            lineHeight: 1.2,
            marginBottom: 10,
            color: '#1f1610',
            fontFamily: 'Georgia, "Times New Roman", serif',
            letterSpacing: -0.3,
          }}>
            {session.topicTitle || session.title}
          </div>

          <div style={{
            fontSize: 13,
            color: 'rgba(58,46,31,0.7)',
            fontStyle: 'italic',
            marginBottom: 28,
            letterSpacing: 0.3,
            fontFamily: 'Georgia, "Times New Roman", serif',
            fontWeight: 400,
          }}>
            {STEP_TYPE_INSTRUCTION[currentStep?.type || 'explain']}
          </div>

          {/* Línea ornamental */}
          <div style={{
            width: '100%',
            height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(58,46,31,0.3), transparent)',
            marginBottom: 28,
          }} />

          {/* Barra de progreso */}
          <div style={{
            height: 4,
            background: 'rgba(58,46,31,0.15)',
            borderRadius: 2,
            marginBottom: 32,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${progressPercent}%`,
              background: 'linear-gradient(90deg, #d6b26f, #a8854a)',
              transition: 'width 0.5s ease',
              boxShadow: '0 0 8px rgba(214,178,111,0.5)',
            }} />
          </div>

          {/* Contenido del paso */}
          <div style={{ minHeight: 280, position: 'relative' }}>
            {stepContent.type === 'loading' && (
              <div style={{
                textAlign: 'center',
                padding: '60px 0',
                color: 'rgba(58,46,31,0.5)',
                fontStyle: 'italic',
              }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>✍️</div>
                Preparando tu contenido...
              </div>
            )}

            {stepContent.type === 'lesson' && stepContent.lesson && (
              <LessonView
                lesson={stepContent.lesson}
                stage={stepContent.lessonStage || 'hook'}
                onAdvance={(nextStage: any) => {
                  setStepContent(prev => ({ ...prev, lessonStage: nextStage }))
                }}
                onCheckpointAnswer={async (answer: string) => {
                  // Evaluar la respuesta del checkpoint
                  let score = 60
                  try {
                    const res = await fetch('/api/adaptive/chat', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        ...makeAdaptivePayload(),
                        message: answer,
                        context: `El estudiante respondió a esta pregunta: "${stepContent.lesson!.firstCheckpoint.question}". La idea esperada es: "${stepContent.lesson!.firstCheckpoint.expectedIdea}". Evalúa qué tan cerca está. Responde SOLO con un número del 0 al 100.`,
                        evaluateOnly: true,
                      }),
                    })
                    if (res.ok) {
                      const data = await res.json()
                      const num = parseInt(String(data.message).match(/\d+/)?.[0] || '60')
                      score = isNaN(num) ? 60 : Math.min(100, Math.max(0, num))
                    }
                  } catch {}

                  const result = { stepId: currentStep.id, score, correct: score >= 60 }
                  setStepResults(prev => [...prev, result])

                  // Si falla → mostrar alternative explanation
                  if (score < 60 && stepContent.lesson!.firstCheckpoint.alternativeExplanation) {
                    setStepContent(prev => ({ ...prev, lessonStage: 'closing' }))
                    setTimeout(() => advanceStep(result), 8000)
                  } else {
                    advanceStep(result)
                  }
                }}
              />
            )}

            {stepContent.type === 'text' && (
              <>
                <div style={{
                  marginBottom: 32,
                  color: '#3a2e1f',
                }}>
                  {renderMarkdownText(stepContent.content || '')}
                </div>
                <BookButton onClick={handleContinueText}>
                  Entendido, continuar →
                </BookButton>
              </>
            )}

            {stepContent.type === 'input' && (
              <>
                <div style={{
                  fontSize: 14,
                  fontWeight: 600,
                  marginBottom: 16,
                  lineHeight: 1.5,
                  color: '#3a2e1f',
                }}>
                  {stepContent.content}
                </div>
                <textarea
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  placeholder="Escribe tu respuesta aquí..."
                  rows={6}
                  style={{
                    width: '100%',
                    padding: '14px',
                    borderRadius: 6,
                    border: '1.5px solid rgba(58,46,31,0.3)',
                    background: 'rgba(255,255,255,0.5)',
                    color: '#3a2e1f',
                    fontSize: 14,
                    fontFamily: 'Georgia, serif',
                    lineHeight: 1.6,
                    resize: 'vertical',
                    outline: 'none',
                    marginBottom: 16,
                  }}
                />
                <BookButton onClick={handleInputSubmit} disabled={!userInput.trim()}>
                  Enviar respuesta →
                </BookButton>
              </>
            )}

            {stepContent.type === 'flashcards' && (() => {
              const cards = stepContent.cards || []
              const card = cards[cardIndex]
              if (!card) return null
              return (
                <>
                  <div style={{
                    fontSize: 11,
                    color: 'rgba(58,46,31,0.5)',
                    marginBottom: 12,
                    textAlign: 'center',
                    fontStyle: 'italic',
                  }}>
                    Tarjeta {cardIndex + 1} de {cards.length}
                  </div>
                  <div
                    onClick={() => setCardFlipped(!cardFlipped)}
                    style={{
                      background: 'rgba(255,255,255,0.5)',
                      border: '1.5px solid rgba(58,46,31,0.25)',
                      borderRadius: 8,
                      padding: '40px 24px',
                      minHeight: 180,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      textAlign: 'center',
                      cursor: 'pointer',
                      marginBottom: 16,
                      fontSize: 16,
                      fontWeight: cardFlipped ? 500 : 600,
                      color: '#3a2e1f',
                      lineHeight: 1.5,
                      fontFamily: 'Georgia, serif',
                    }}
                  >
                    {cardFlipped ? card.back : card.front}
                  </div>
                  {cardFlipped && (
                    <div style={{ display: 'flex', gap: 10 }}>
                      <BookButton onClick={() => handleCardAnswer(false)} variant="danger" fullWidth>
                        ✗ No lo sabía
                      </BookButton>
                      <BookButton onClick={() => handleCardAnswer(true)} variant="success" fullWidth>
                        ✓ Lo sabía
                      </BookButton>
                    </div>
                  )}
                </>
              )
            })()}

            {stepContent.type === 'quiz' && (() => {
              const questions = stepContent.questions || []
              const q = questions[questionIndex]
              if (!q) return null
              return (
                <>
                  <div style={{
                    fontSize: 11,
                    color: 'rgba(58,46,31,0.5)',
                    marginBottom: 12,
                    fontStyle: 'italic',
                  }}>
                    Pregunta {questionIndex + 1} de {questions.length}
                  </div>
                  <div style={{
                    fontSize: 15,
                    fontWeight: 700,
                    marginBottom: 20,
                    lineHeight: 1.5,
                    color: '#3a2e1f',
                  }}>
                    {q.question}
                  </div>
                  <div>
                    {(q.options || []).map((option, i) => {
                      let bg = 'rgba(255,255,255,0.4)'
                      let border = 'rgba(58,46,31,0.25)'
                      let color = '#3a2e1f'
                      if (answerSubmitted) {
                        if (option === q.correctAnswer) {
                          bg = 'rgba(90,138,58,0.15)'
                          border = '#5a8a3a'
                          color = '#3a5a1e'
                        } else if (option === selectedAnswer) {
                          bg = 'rgba(139,26,26,0.1)'
                          border = '#8b1a1a'
                          color = '#8b1a1a'
                        }
                      }
                      return (
                        <button
                          key={i}
                          onClick={() => handleAnswerSelect(option)}
                          disabled={answerSubmitted}
                          style={{
                            width: '100%',
                            padding: '12px 16px',
                            borderRadius: 6,
                            border: `1.5px solid ${border}`,
                            background: bg,
                            color,
                            fontFamily: 'Georgia, serif',
                            fontSize: 13,
                            cursor: answerSubmitted ? 'default' : 'pointer',
                            textAlign: 'left',
                            marginBottom: 8,
                            transition: 'all 0.2s ease',
                          }}
                        >
                          {option}
                        </button>
                      )
                    })}
                  </div>
                  {answerSubmitted && (
                    <BookButton onClick={handleNextQuestion}>
                      {questionIndex + 1 < questions.length ? 'Siguiente →' : 'Terminar →'}
                    </BookButton>
                  )}
                </>
              )
            })()}

            {stepContent.type === 'feedback' && (
              <>
                <div style={{
                  background: 'rgba(255,255,255,0.5)',
                  border: '1px dashed rgba(58,46,31,0.3)',
                  borderRadius: 6,
                  padding: '20px',
                  fontSize: 14,
                  lineHeight: 1.6,
                  marginBottom: 24,
                  color: '#3a2e1f',
                }}>
                  {stepContent.feedbackMessage}
                </div>
                <BookButton onClick={handleContinueText}>
                  Continuar →
                </BookButton>
              </>
            )}
          </div>

          {/* Footer */}
          <div style={{
            position: 'absolute',
            bottom: 20,
            left: 60,
            right: 60,
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 10,
            color: 'rgba(58,46,31,0.4)',
            fontStyle: 'italic',
          }}>
            <span>Paso {currentStepIndex + 1} de {totalSteps}</span>
            <span>{session.sessionNumber}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function BookButton({
  onClick,
  children,
  disabled,
  variant = 'primary',
  fullWidth,
}: {
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
  variant?: 'primary' | 'success' | 'danger'
  fullWidth?: boolean
}) {
  const colors = {
    primary: { bg: '#3a2e1f', color: '#f5ecd5', border: '#3a2e1f' },
    success: { bg: '#5a8a3a', color: '#fff', border: '#5a8a3a' },
    danger: { bg: '#8b1a1a', color: '#fff', border: '#8b1a1a' },
  }[variant]

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '14px 28px',
        borderRadius: 6,
        background: colors.bg,
        color: colors.color,
        border: `1.5px solid ${colors.border}`,
        fontFamily: 'Georgia, serif',
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: 0.5,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        width: fullWidth ? '100%' : 'auto',
        transition: 'all 0.2s ease',
        boxShadow: '0 2px 8px rgba(58,46,31,0.2)',
      }}
    >
      {children}
    </button>
  )
}


// ═══════════════════════════════════════════════════════════════
// LESSON VIEW — muestra la mini clase etapa por etapa
// ═══════════════════════════════════════════════════════════════
function LessonView({
  lesson,
  stage,
  onAdvance,
  onCheckpointAnswer,
}: {
  lesson: any
  stage: string
  onAdvance: (next: string) => void
  onCheckpointAnswer: (answer: string) => void
}) {
  const [checkpointAnswer, setCheckpointAnswer] = useState('')

  // Construir stages dinámicamente
  const hasIntent = !!lesson.intentDeclaration
  const checkpoints = lesson.checkpoints || (lesson.firstCheckpoint ? [lesson.firstCheckpoint] : [])
  const blocks = lesson.explanationBlocks || []

  const stages: string[] = []
  if (hasIntent) stages.push('intent')
  stages.push('hook')
  if (lesson.sessionGoal) stages.push('goal')
  if (lesson.whyItMatters) stages.push('why')
  if (lesson.priorKnowledgeBridge) stages.push('bridge')
  blocks.forEach((_: any, i: number) => stages.push('block' + i))
  checkpoints.forEach((_: any, i: number) => stages.push('checkpoint' + i))
  stages.push('closing')

  const currentIdx = stages.indexOf(stage)
  const isLastStage = currentIdx === stages.length - 1
  const nextStage = stages[currentIdx + 1] || 'closing'

  return (
    <div style={{ animation: 'lessonFadeIn 0.5s ease-out' }}>
      <style>{`
        @keyframes lessonFadeIn {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* INTENT — declaración pedagógica del profesor */}
      {stage === 'intent' && (
        <div>
          <div style={{
            fontSize: 10,
            letterSpacing: 2.5,
            color: 'rgba(168,133,74,0.8)',
            marginBottom: 14,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span style={{ fontSize: 14 }}>✦</span>
            DECISIÓN DE TU PROFESOR
          </div>
          <div style={{
            background: 'rgba(214,178,111,0.1)',
            borderLeft: '3px solid #a8854a',
            padding: '20px 24px',
            borderRadius: 4,
            marginBottom: 28,
            fontSize: 15,
            lineHeight: 1.6,
            color: '#3a2e1f',
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
          }}>
            "{lesson.intentDeclaration}"
          </div>
          <BookButton onClick={() => onAdvance(nextStage)}>
            Empezamos →
          </BookButton>
        </div>
      )}

      {/* HOOK — pregunta inicial que engancha */}
      {stage === 'hook' && (
        <div>
          <div style={{
            fontSize: 11,
            letterSpacing: 2,
            color: 'rgba(58,46,31,0.5)',
            marginBottom: 16,
            fontWeight: 600,
          }}>
            PARA EMPEZAR
          </div>
          <div style={{
            fontSize: 22,
            lineHeight: 1.4,
            color: '#1f1610',
            fontFamily: 'Georgia, "Times New Roman", serif',
            fontStyle: 'italic',
            marginBottom: 32,
            fontWeight: 500,
          }}>
            "{lesson.hook}"
          </div>
          <BookButton onClick={() => onAdvance(nextStage)}>
            Continuar →
          </BookButton>
        </div>
      )}

      {/* SESSION GOAL — objetivo claro */}
      {stage === 'goal' && (
        <div>
          <div style={{
            fontSize: 11,
            letterSpacing: 2,
            color: 'rgba(58,46,31,0.5)',
            marginBottom: 16,
            fontWeight: 600,
          }}>
            OBJETIVO DE HOY
          </div>
          <div style={{
            background: 'rgba(214,178,111,0.12)',
            borderLeft: '3px solid #a8854a',
            padding: '20px 24px',
            borderRadius: 4,
            marginBottom: 24,
            fontSize: 15,
            lineHeight: 1.6,
            color: '#3a2e1f',
          }}>
            {lesson.sessionGoal}
          </div>
          <BookButton onClick={() => onAdvance(nextStage)}>
            Entendido, continuar →
          </BookButton>
        </div>
      )}

      {/* WHY IT MATTERS */}
      {stage === 'why' && (
        <div>
          <div style={{
            fontSize: 11,
            letterSpacing: 2,
            color: 'rgba(58,46,31,0.5)',
            marginBottom: 16,
            fontWeight: 600,
          }}>
            POR QUÉ IMPORTA
          </div>
          <div style={{
            fontSize: 15,
            lineHeight: 1.7,
            color: '#3a2e1f',
            marginBottom: 28,
            fontFamily: 'Georgia, serif',
          }}>
            {lesson.whyItMatters}
          </div>
          <BookButton onClick={() => onAdvance(nextStage)}>
            Vamos →
          </BookButton>
        </div>
      )}

      {/* PRIOR KNOWLEDGE BRIDGE */}
      {stage === 'bridge' && (
        <div>
          <div style={{
            fontSize: 11,
            letterSpacing: 2,
            color: 'rgba(58,46,31,0.5)',
            marginBottom: 16,
            fontWeight: 600,
          }}>
            CONECTEMOS CON LO QUE YA SABES
          </div>
          <div style={{
            fontSize: 15,
            lineHeight: 1.7,
            color: '#3a2e1f',
            marginBottom: 28,
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
          }}>
            {lesson.priorKnowledgeBridge}
          </div>
          <BookButton onClick={() => onAdvance(nextStage)}>
            Sigamos →
          </BookButton>
        </div>
      )}

      {/* EXPLANATION BLOCKS */}
      {stage.startsWith('block') && (() => {
        const blockIdx = parseInt(stage.replace('block', ''))
        const block = lesson.explanationBlocks[blockIdx]
        if (!block) return null
        return (
          <div>
            <div style={{
              fontSize: 11,
              letterSpacing: 2,
              color: 'rgba(58,46,31,0.5)',
              marginBottom: 12,
              fontWeight: 600,
            }}>
              IDEA {blockIdx + 1} DE {lesson.explanationBlocks.length}
            </div>
            <div style={{
              fontSize: 19,
              fontWeight: 700,
              color: '#1f1610',
              marginBottom: 14,
              fontFamily: 'Georgia, serif',
            }}>
              {block.title}
            </div>
            <div style={{
              fontSize: 14.5,
              lineHeight: 1.75,
              color: '#3a2e1f',
              marginBottom: 16,
              fontFamily: 'Georgia, serif',
              whiteSpace: 'pre-wrap',
            }}>
              {block.content}
            </div>

            {block.analogy && (
              <div style={{
                background: 'rgba(214,178,111,0.08)',
                borderRadius: 6,
                padding: '14px 18px',
                marginBottom: 14,
                fontSize: 13,
                lineHeight: 1.6,
                color: '#3a2e1f',
                fontStyle: 'italic',
              }}>
                <span style={{ fontSize: 10, letterSpacing: 1.5, color: '#a8854a', fontWeight: 700, fontStyle: 'normal' }}>
                  ANALOGÍA · </span>
                {block.analogy}
              </div>
            )}

            {block.example && (
              <div style={{
                background: 'rgba(58,46,31,0.05)',
                borderRadius: 6,
                padding: '14px 18px',
                marginBottom: 24,
                fontSize: 13,
                lineHeight: 1.6,
                color: '#3a2e1f',
              }}>
                <span style={{ fontSize: 10, letterSpacing: 1.5, color: '#5a8a3a', fontWeight: 700 }}>
                  EJEMPLO · </span>
                {block.example}
              </div>
            )}

            <BookButton onClick={() => onAdvance(nextStage)}>
              {blockIdx === lesson.explanationBlocks.length - 1 ? 'Probemos →' : 'Siguiente idea →'}
            </BookButton>
          </div>
        )
      })()}

      {/* CHECKPOINTS dinámicos */}
      {stage.startsWith('checkpoint') && (() => {
        const cpIdx = parseInt(stage.replace('checkpoint', ''))
        const checkpoint = checkpoints[cpIdx]
        if (!checkpoint) return null
        const qType = checkpoint.questionType || 'open_essay'
        return (
          <CheckpointView
            checkpoint={checkpoint}
            questionType={qType}
            onAnswer={onCheckpointAnswer}
          />
        )
      })()}

      {/* CHECKPOINT legacy (compatibilidad) */}
      {stage === 'checkpoint' && (
        <div>
          <div style={{
            fontSize: 11,
            letterSpacing: 2,
            color: 'rgba(58,46,31,0.5)',
            marginBottom: 16,
            fontWeight: 600,
          }}>
            AHORA TE TOCA A TI
          </div>
          <div style={{
            fontSize: 17,
            lineHeight: 1.5,
            color: '#1f1610',
            fontFamily: 'Georgia, serif',
            marginBottom: 20,
            fontWeight: 600,
          }}>
            {lesson.firstCheckpoint.question}
          </div>
          <textarea
            value={checkpointAnswer}
            onChange={(e) => setCheckpointAnswer(e.target.value)}
            placeholder="Tómate tu tiempo. Piensa, no memorices..."
            rows={6}
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: 6,
              border: '1.5px solid rgba(58,46,31,0.3)',
              background: 'rgba(255,255,255,0.5)',
              color: '#3a2e1f',
              fontSize: 14,
              fontFamily: 'Georgia, serif',
              lineHeight: 1.6,
              resize: 'vertical',
              outline: 'none',
              marginBottom: 16,
            }}
          />
          <BookButton
            onClick={() => onCheckpointAnswer(checkpointAnswer)}
            disabled={!checkpointAnswer.trim()}
          >
            Enviar respuesta →
          </BookButton>
        </div>
      )}

      {/* CLOSING */}
      {stage === 'closing' && (
        <div>
          <div style={{
            fontSize: 11,
            letterSpacing: 2,
            color: 'rgba(58,46,31,0.5)',
            marginBottom: 16,
            fontWeight: 600,
          }}>
            PARA CERRAR
          </div>
          <div style={{
            fontSize: 15,
            lineHeight: 1.7,
            color: '#3a2e1f',
            marginBottom: 20,
            fontFamily: 'Georgia, serif',
          }}>
            {lesson.closingSummary}
          </div>
          <div style={{
            fontSize: 12,
            color: 'rgba(58,46,31,0.6)',
            fontStyle: 'italic',
            marginBottom: 24,
            fontFamily: 'Georgia, serif',
          }}>
            → {lesson.nextStepReason}
          </div>
        </div>
      )}
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════
// CHECKPOINT VIEW — cambia según questionType
// ═══════════════════════════════════════════════════════════════
function CheckpointView({
  checkpoint,
  questionType,
  onAnswer,
}: {
  checkpoint: any
  questionType: string
  onAnswer: (answer: string) => void
}) {
  const [answer, setAnswer] = useState('')

  const labels: Record<string, string> = {
    open_essay: 'EXPLICA CON TUS PALABRAS',
    multiple_choice: 'ELIGE LA CORRECTA',
    apply_scenario: 'RESUELVE ESTE CASO',
    predict_outcome: '¿QUÉ PASARÍA SI...?',
    explain_why: 'JUSTIFICA EL PORQUÉ',
    find_error: 'ENCUENTRA EL ERROR',
    compare_two: 'COMPARA',
    fill_blank: 'COMPLETA',
    true_false: 'VERDADERO O FALSO',
  }
  const label = labels[questionType] || 'TU TURNO'

  return (
    <div>
      <div style={{
        fontSize: 10,
        letterSpacing: 2.5,
        color: 'rgba(168,133,74,0.9)',
        marginBottom: 14,
        fontWeight: 700,
      }}>
        ✦ {label}
      </div>
      <div style={{
        fontSize: 17,
        lineHeight: 1.5,
        color: '#1f1610',
        fontFamily: 'Georgia, serif',
        marginBottom: 20,
        fontWeight: 600,
      }}>
        {checkpoint.question}
      </div>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder={
          questionType === 'open_essay' ? 'Tómate tu tiempo. Piensa, no memorices...' :
          questionType === 'predict_outcome' ? 'Imagina qué pasaría...' :
          questionType === 'explain_why' ? 'Explica el porqué...' :
          questionType === 'find_error' ? 'Identifica qué está mal y corrige...' :
          'Tu respuesta...'
        }
        rows={6}
        style={{
          width: '100%',
          padding: '14px',
          borderRadius: 6,
          border: '1.5px solid rgba(58,46,31,0.3)',
          background: 'rgba(255,255,255,0.5)',
          color: '#3a2e1f',
          fontSize: 14,
          fontFamily: 'Georgia, serif',
          lineHeight: 1.6,
          resize: 'vertical',
          outline: 'none',
          marginBottom: 16,
        }}
      />
      <BookButton
        onClick={() => onAnswer(answer)}
        disabled={!answer.trim()}
      >
        Enviar respuesta →
      </BookButton>
    </div>
  )
}
