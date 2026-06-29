'use client'

import { useState, useEffect, useRef } from 'react'
import type { AdaptiveSession, AdaptiveStep } from '../../../lib/adaptive'
import { STEP_TYPE_INSTRUCTION, getSessionTopicContext } from '../../../lib/adaptive'
import { buildAdaptiveContext, serializeAdaptiveContext, buildFocusInstruction } from '../../../lib/adaptive/adaptiveContext'

interface Props {
  session: AdaptiveSession
  materialContent: string
  masteryContext: any
  onSessionComplete: (result: {
    domainGain: number
    conceptsImproved: string[]
    stepResults: Array<{ stepId: string; score?: number; correct?: boolean }>
  }) => void
  onClose: () => void
}

interface StepContent {
  type: 'loading' | 'text' | 'flashcards' | 'quiz' | 'input' | 'feedback'
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
}

export default function AdaptiveSessionRunner({
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
  const [totalCorrect, setTotalCorrect] = useState(0)
  const [totalAnswered, setTotalAnswered] = useState(0)
  const correctRef = useRef(0)
  const answeredRef = useRef(0)
  const [finishing, setFinishing] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const currentStep = session.steps[currentStepIndex]
  const totalSteps = session.steps.length
  const progressPercent = Math.round((currentStepIndex / totalSteps) * 100)

  // ── Contexto de topic — se pasa a todas las APIs ─────────────
  const topicCtx = getSessionTopicContext(session)

  // ── AdaptiveContext universal — mismo formato para todas las APIs ─
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

  // Legacy: mantener enrichedMasteryContext para compatibilidad con APIs existentes
  const enrichedMasteryContext = {
    ...(masteryContext || {}),
    topicTitle: adaptiveCtx.topicTitle,
    targetConcepts: adaptiveCtx.targetConcepts,
    sourcePages: adaptiveCtx.sourcePages,
    evidenceGoal: adaptiveCtx.evidenceGoal,
    hasBlueprintContext: topicCtx.hasBlueprintContext,
    focusInstruction: buildFocusInstruction(adaptiveCtx),
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
    setTotalCorrect(0)
    setTotalAnswered(0)

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    loadStepContent(currentStep, abortRef.current.signal)

    return () => abortRef.current?.abort()
  }, [currentStepIndex])

  // ── Contenido del material: si hay sourcePages, intentar filtrar ──
  function getMaterialSlice(): string {
    // Si adaptiveCtx ya calculó el slice inteligente, usarlo
    if (adaptiveCtx?.materialSlice && adaptiveCtx.materialSlice.length > 100) {
      return adaptiveCtx.materialSlice;
    }
    const pages = topicCtx.sourcePages;
    // Si hay sourcePages del blueprint, intentar extraer solo esas páginas
    if (pages && pages.length > 0) {
      // Estimado: ~1600 chars por página
      const charsPerPage = 1600;
      const minPage = Math.min(...pages);
      const maxPage = Math.max(...pages);
      const startChar = Math.max(0, (minPage - 1) * charsPerPage);
      const endChar = Math.min(materialContent.length, maxPage * charsPerPage + 800);
      const pageSlice = materialContent.slice(startChar, endChar);
      // Si el slice es razonable (>500 chars), usarlo + prefijo del material
      if (pageSlice.length > 500) {
        const prefix = materialContent.slice(0, 800); // contexto inicial siempre
        const combined = prefix + '\n\n[...páginas ' + pages.join(',') + '...]\n\n' + pageSlice;
        return combined.slice(0, 8000);
      }
    }
    return materialContent.slice(0, 8000);
  }

  function makeAdaptivePayload(extra: Record<string, unknown> = {}) {
    return {
      ...serializeAdaptiveContext(adaptiveCtx),
      ...extra,
    }
  }

  async function loadStepContent(step: AdaptiveStep, signal: AbortSignal) {
    const materialSlice = getMaterialSlice()

    try {
      switch (step.type) {
        case 'explain': {
          const res = await fetch('/api/adaptive/explain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              makeAdaptivePayload({
                mode: 'adaptive_explain',
                maxLength: 'short',
              })
            ),
            signal,
          })
          if (!res.ok) throw new Error('API error')
          const data = await res.json()
          setStepContent({
            type: 'text',
            content: data.analysis || data.content || data.explanation ||
              'No se pudo cargar la explicación.',
          })
          break
        }

        case 'active_recall': {
          setStepContent({
            type: 'input',
            content: topicCtx.hasBlueprintContext
              ? `Sobre "${topicCtx.topicTitle}": ${step.instruction}`
              : step.instruction,
          })
          break
        }

        case 'micro_flashcards': {
          const res = await fetch('/api/adaptive/flashcards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              makeAdaptivePayload({
                count: 5,
              })
            ),
            signal,
          })
          if (!res.ok) throw new Error('API error')
          const data = await res.json()
          const cards = (data.cards || data.flashcards || []).slice(0, 5)
          setStepContent({ type: 'flashcards', cards })
          break
        }

        case 'micro_quiz': {
          const res = await fetch('/api/adaptive/quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              makeAdaptivePayload({
                count: 3,
              })
            ),
            signal,
          })
          if (!res.ok) throw new Error('API error')
          const data = await res.json()
          const rawQ = data.questions || data.quizzes || data.preguntas || []
          const questions = rawQ.slice(0, 3).map((q: any, i: number) => ({
            id: String(i),
            question: q.question || q.pregunta || q.texto || '',
            options: q.options || q.opciones || q.choices || [],
            correctAnswer: q.correctAnswer || q.respuestaCorrecta || q.correct || q.respuesta || '',
            type: 'multiple_choice' as const,
          }))
          setStepContent({ type: 'quiz', questions })
          break
        }

        case 'mini_exam': {
      const res = await fetch('/api/adaptive/exam', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              makeAdaptivePayload({
                count: 6,
              })
            ),
            signal,
          })
          if (!res.ok) throw new Error('API error')
          const data = await res.json()
          const rawQuestions =
            data.questions || data.quizzes ||
            data.exam?.questions || data.examen?.questions ||
            data.preguntas || []
          const questions = rawQuestions.slice(0, 6).map((q: any, i: number) => ({
            id: String(i),
            question: q.question || q.pregunta || q.texto || '',
            options: q.options || q.opciones || q.choices || [],
            correctAnswer: q.correctAnswer || q.respuestaCorrecta || q.correct || q.respuesta || '',
            type: 'multiple_choice' as const,
          }))
          setStepContent({ type: 'quiz', questions })
          break
        }

        case 'coach_feedback': {
          setStepContent({
            type: 'feedback',
            feedbackMessage: generateFeedback(stepResults, totalCorrect, totalAnswered),
          })
          break
        }

        case 'repair': {
          // Usar targetConcepts del topic si están disponibles
          const weak = topicCtx.targetConcepts.length > 0
            ? topicCtx.targetConcepts.slice(0, 3).join(', ')
            : masteryContext?.weakConcepts?.slice(0, 3)?.join(', ') || 'los conceptos que fallaron'

          const topicPrefix = topicCtx.hasBlueprintContext
            ? `En el tema "${topicCtx.topicTitle}", `
            : ''

          setStepContent({
            type: 'input',
            content: `${topicPrefix}vamos a trabajar específicamente: **${weak}**.\n\nExplícame con tus propias palabras qué entiendes de esto.`,
          })
          break
        }

        default:
          setStepContent({ type: 'text', content: step.instruction })
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      setStepContent({
        type: 'text',
        content: step.instruction + '\n\n(No se pudo cargar el contenido. Puedes continuar de todas formas.)',
      })
    }
  }

  function generateFeedback(
    results: Array<{ stepId: string; score?: number; correct?: boolean }>,
    correct: number,
    answered: number,
  ): string {
    if (answered === 0) return 'Completaste esta parte. Continuemos con lo siguiente.'
    const pct = Math.round((correct / answered) * 100)
    const topicSuffix = topicCtx.topicTitle ? ` sobre "${topicCtx.topicTitle}"` : ''
    if (pct >= 80) return `Excelente. Respondiste bien ${correct} de ${answered} preguntas${topicSuffix} (${pct}%). Tu comprensión es sólida.`
    if (pct >= 60) return `Bien. Respondiste ${correct} de ${answered} correctamente${topicSuffix} (${pct}%). Hay algunos puntos para reforzar.`
    return `Respondiste ${correct} de ${answered} correctamente${topicSuffix} (${pct}%). Necesitamos trabajar más estos puntos del material.`
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
          context: topicCtx.hasBlueprintContext
            ? `Evalúa si esta respuesta demuestra comprensión de "${topicCtx.topicTitle}". ` +
              (topicCtx.targetConcepts.length > 0
                ? `Conceptos evaluados: ${topicCtx.targetConcepts.join(', ')}. `
                : '') +
              `Responde SOLO con un número del 0 al 100. Sin texto adicional.`
            : `Evalúa si esta respuesta demuestra comprensión del tema. Responde SOLO con un número del 0 al 100. Sin texto adicional.`,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const text = data.message || data.content || ''
        const num = parseInt(text.match(/\d+/)?.[0] || '60')
        score = isNaN(num) ? 60 : Math.min(100, Math.max(0, num))
      }
    } catch {}

    const result = { stepId: currentStep.id, score, correct: score >= 60 }
    setStepResults(prev => [...prev, result])
    if (score >= 60) setTotalCorrect(prev => prev + 1)
    setTotalAnswered(prev => prev + 1)
    advanceStep(result)
  }

  function handleAnswerSelect(answer: string) {
    if (answerSubmitted) return
    setSelectedAnswer(answer)
    setAnswerSubmitted(true)

    const questions = stepContent.questions || []
    const current = questions[questionIndex]
    const isCorrect = answer === current?.correctAnswer

    answeredRef.current += 1
    if (isCorrect) correctRef.current += 1
    setTotalAnswered(answeredRef.current)
    setTotalCorrect(correctRef.current)
  }

  function handleNextQuestion() {
    const questions = stepContent.questions || []
    setSelectedAnswer(null)
    setAnswerSubmitted(false)

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
    const cards = stepContent.cards || []
    answeredRef.current += 1
    if (knew) correctRef.current += 1
    setTotalAnswered(answeredRef.current)
    setTotalCorrect(correctRef.current)
    setCardFlipped(false)

    if (cardIndex + 1 < cards.length) {
      setCardIndex(prev => prev + 1)
    } else {
      const score = Math.round((correctRef.current / Math.max(1, answeredRef.current)) * 100)
      const result = { stepId: currentStep.id, score, correct: score >= 60 }
      setStepResults(prev => [...prev, result])
      advanceStep(result)
    }
  }

  function advanceStep(result: { stepId: string; score?: number; correct?: boolean }) {
    const nextIndex = currentStepIndex + 1
    if (nextIndex < totalSteps) {
      setCurrentStepIndex(nextIndex)
    } else {
      finishSession([...stepResults, result])
    }
  }

  function finishSession(results: Array<{ stepId: string; score?: number; correct?: boolean }>) {
    setFinishing(true)

    const evidenceResults = results.filter(r => (r.score ?? 0) > 0)
    const scores = evidenceResults.map(r => r.score ?? 0)
    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0

    const domainGain = avgScore > 0
      ? Math.round((avgScore / 100) * session.expectedDomainGain)
      : 0

    const highScoreSteps = evidenceResults.filter(r => (r.score ?? 0) >= 70)

    // Usar targetConcepts del topic si están disponibles
    const targetConcepts = topicCtx.targetConcepts.length > 0
      ? topicCtx.targetConcepts
      : [
          ...(masteryContext?.criticalConcepts?.slice(0, 2) || []),
          ...(masteryContext?.weakConcepts?.slice(0, 4) || []),
        ]

    const conceptsImproved = highScoreSteps.length > 0
      ? targetConcepts.slice(0, highScoreSteps.length)
      : []

    setTimeout(() => {
      onSessionComplete({
        domainGain,
        conceptsImproved,
        stepResults: results,
      })
    }, 800)
  }

  function handleContinueText() {
    const result = { stepId: currentStep.id, score: 0, correct: undefined }
    setStepResults(prev => [...prev, result])
    advanceStep(result)
  }

  // ── Estilos ──────────────────────────────────────────────────
  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'var(--bg-primary)',
    zIndex: 100,
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
  }

  const btnPrimary: React.CSSProperties = {
    width: '100%',
    padding: '14px',
    borderRadius: 12,
    border: '2px solid var(--gold)',
    background: 'var(--gold)',
    color: '#111',
    fontWeight: 900,
    fontSize: 15,
    cursor: 'pointer',
  }

  const btnGhost: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-faint)',
    fontWeight: 800,
    fontSize: 18,
    cursor: 'pointer',
    padding: '4px 8px',
  }

  const btnOption: React.CSSProperties = {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 10,
    border: '1.5px solid var(--border-color2)',
    background: 'var(--bg-card)',
    color: 'var(--text-primary)',
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
    textAlign: 'left',
    marginBottom: 8,
    transition: 'all 0.15s ease',
  }

  if (finishing) {
    return (
      <div style={overlayStyle}>
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--gold)' }}>
            Guardando progreso...
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={overlayStyle}>
      {/* Topbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 20px',
        borderBottom: '1px solid var(--border-color2)',
        flexShrink: 0,
      }}>
        <button onClick={onClose} style={btnGhost}>✕</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--text-primary)' }}>
            {session.title}
          </div>
          {topicCtx.topicTitle && (
            <div style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 700 }}>
              {topicCtx.topicTitle}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            Paso {currentStepIndex + 1} de {totalSteps}
          </div>
        </div>
        <div style={{ width: 32 }} />
      </div>

      {/* Barra de progreso */}
      <div style={{ height: 3, background: 'var(--border-color2)', flexShrink: 0 }}>
        <div style={{
          height: '100%',
          width: `${progressPercent}%`,
          background: 'var(--gold)',
          transition: 'width 0.4s ease',
        }} />
      </div>

      {/* Contenido */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '24px 20px',
        maxWidth: 560,
        margin: '0 auto',
        width: '100%',
      }}>
        {/* Instrucción del paso */}
        <div style={{
          fontSize: 11,
          fontWeight: 800,
          color: 'var(--gold)',
          letterSpacing: 0.5,
          marginBottom: 8,
        }}>
          {STEP_TYPE_INSTRUCTION[currentStep?.type || 'explain']}
        </div>

        {/* Topic badge — solo si hay contexto de blueprint */}
        {topicCtx.hasBlueprintContext && topicCtx.targetConcepts.length > 0 && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginBottom: 16,
          }}>
            {topicCtx.targetConcepts.slice(0, 4).map(concept => (
              <span key={concept} style={{
                fontSize: 10,
                fontWeight: 800,
                color: 'var(--gold)',
                background: 'color-mix(in srgb, var(--gold) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)',
                borderRadius: 999,
                padding: '2px 8px',
                letterSpacing: 0.3,
              }}>
                {concept}
              </span>
            ))}
          </div>
        )}

        {/* Loading */}
        {stepContent.type === 'loading' && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>🤖</div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 700 }}>
              {topicCtx.topicTitle
                ? `Preparando contenido de "${topicCtx.topicTitle}"...`
                : 'Preparando tu contenido...'}
            </div>
          </div>
        )}

        {/* Text / Explicación */}
        {stepContent.type === 'text' && (
          <div>
            <div style={{
              background: 'var(--bg-card)',
              border: '1.5px solid var(--border-color2)',
              borderRadius: 14,
              padding: '20px',
              fontSize: 14,
              lineHeight: 1.7,
              color: 'var(--text-primary)',
              whiteSpace: 'pre-wrap',
              marginBottom: 24,
            }}>
              {stepContent.content}
            </div>
            <button onClick={handleContinueText} style={btnPrimary}>
              Entendido, continuar →
            </button>
          </div>
        )}

        {/* Input / Active Recall */}
        {stepContent.type === 'input' && (
          <div>
            <div style={{
              fontSize: 15,
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginBottom: 16,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}>
              {stepContent.content}
            </div>
            <textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="Escribe tu respuesta aquí..."
              rows={5}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: 12,
                border: '1.5px solid var(--border-color2)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                fontSize: 14,
                lineHeight: 1.6,
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <button
              onClick={handleInputSubmit}
              disabled={!userInput.trim()}
              style={{
                ...btnPrimary,
                marginTop: 12,
                opacity: userInput.trim() ? 1 : 0.4,
                cursor: userInput.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              Enviar respuesta →
            </button>
          </div>
        )}

        {/* Flashcards */}
        {stepContent.type === 'flashcards' && (() => {
          const cards = stepContent.cards || []
          const card = cards[cardIndex]
          if (!card) return null
          return (
            <div>
              <div style={{
                fontSize: 12,
                color: 'var(--text-faint)',
                fontWeight: 700,
                marginBottom: 12,
                textAlign: 'center',
              }}>
                {cardIndex + 1} / {cards.length}
              </div>
              <div
                onClick={() => setCardFlipped(!cardFlipped)}
                style={{
                  background: 'var(--bg-card)',
                  border: '2px solid var(--border-color2)',
                  borderRadius: 16,
                  padding: '32px 24px',
                  minHeight: 180,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  cursor: 'pointer',
                  marginBottom: 20,
                  fontSize: 15,
                  fontWeight: cardFlipped ? 700 : 800,
                  color: cardFlipped ? 'var(--gold)' : 'var(--text-primary)',
                  lineHeight: 1.5,
                  transition: 'all 0.2s ease',
                }}
              >
                {cardFlipped ? card.back : card.front}
                {!cardFlipped && (
                  <div style={{
                    position: 'absolute',
                    bottom: 12,
                    fontSize: 11,
                    color: 'var(--text-faint)',
                    fontWeight: 700,
                  }}>
                    Toca para ver la respuesta
                  </div>
                )}
              </div>
              {cardFlipped && (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => handleCardAnswer(false)}
                    style={{
                      ...btnOption,
                      flex: 1,
                      textAlign: 'center',
                      border: '2px solid #ef4444',
                      color: '#ef4444',
                    }}
                  >
                    ✗ No lo sabía
                  </button>
                  <button
                    onClick={() => handleCardAnswer(true)}
                    style={{
                      ...btnOption,
                      flex: 1,
                      textAlign: 'center',
                      border: '2px solid #4ade80',
                      color: '#4ade80',
                    }}
                  >
                    ✓ Lo sabía
                  </button>
                </div>
              )}
            </div>
          )
        })()}

        {/* Quiz */}
        {stepContent.type === 'quiz' && (() => {
          const questions = stepContent.questions || []
          const q = questions[questionIndex]
          if (!q) return null
          return (
            <div>
              <div style={{
                fontSize: 12,
                color: 'var(--text-faint)',
                fontWeight: 700,
                marginBottom: 12,
                textAlign: 'center',
              }}>
                Pregunta {questionIndex + 1} / {questions.length}
              </div>
              <div style={{
                fontSize: 15,
                fontWeight: 800,
                color: 'var(--text-primary)',
                marginBottom: 20,
                lineHeight: 1.5,
              }}>
                {q.question}
              </div>
              <div>
                {(q.options || []).map((option, i) => {
                  let borderColor = 'var(--border-color2)'
                  let bgColor = 'var(--bg-card)'
                  let textColor = 'var(--text-primary)'

                  if (answerSubmitted) {
                    if (option === q.correctAnswer) {
                      borderColor = '#4ade80'
                      bgColor = 'color-mix(in srgb, #4ade80 10%, var(--bg-card))'
                      textColor = '#4ade80'
                    } else if (option === selectedAnswer && option !== q.correctAnswer) {
                      borderColor = '#ef4444'
                      bgColor = 'color-mix(in srgb, #ef4444 10%, var(--bg-card))'
                      textColor = '#ef4444'
                    }
                  }

                  return (
                    <button
                      key={i}
                      onClick={() => handleAnswerSelect(option)}
                      disabled={answerSubmitted}
                      style={{
                        ...btnOption,
                        borderColor,
                        background: bgColor,
                        color: textColor,
                        opacity: answerSubmitted && option !== selectedAnswer && option !== q.correctAnswer ? 0.5 : 1,
                      }}
                    >
                      {option}
                    </button>
                  )
                })}
              </div>
              {answerSubmitted && (
                <button onClick={handleNextQuestion} style={{ ...btnPrimary, marginTop: 12 }}>
                  {questionIndex + 1 < questions.length ? 'Siguiente →' : 'Terminar →'}
                </button>
              )}
            </div>
          )
        })()}

        {/* Feedback */}
        {stepContent.type === 'feedback' && (
          <div>
            <div style={{
              background: 'var(--bg-card)',
              border: '1.5px solid var(--border-color2)',
              borderRadius: 14,
              padding: '20px',
              fontSize: 14,
              lineHeight: 1.7,
              color: 'var(--text-primary)',
              marginBottom: 24,
            }}>
              {stepContent.feedbackMessage}
            </div>
            <button onClick={handleContinueText} style={btnPrimary}>
              Continuar →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
