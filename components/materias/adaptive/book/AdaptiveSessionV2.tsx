'use client'

import { useState, useEffect, useRef } from 'react'
import type { AdaptiveSession } from '../../../../lib/adaptive'
import { buildAdaptiveContext, serializeAdaptiveContext } from '../../../../lib/adaptive/adaptiveContext'

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

type ActionType =
  | 'explain'
  | 'flashcards'
  | 'quiz_multiple_choice'
  | 'quiz_true_false'
  | 'quiz_open'
  | 'quiz_apply'
  | 'comparison'
  | 'recall'
  | 'repair'
  | 'synthesis'
  | 'close'

interface Action {
  type: ActionType
  topic: string
  concepts?: string[]
  concept?: string
  count?: number
  questionType?: string
  reason: string
}

interface ContentBlock {
  type: ActionType
  data: any  // contenido devuelto por la herramienta
}

export default function AdaptiveSessionV2({
  session,
  materialContent,
  masteryContext,
  onSessionComplete,
  onClose,
}: Props) {
  const [studentModel, setStudentModel] = useState<any>(null)
  const [currentAction, setCurrentAction] = useState<Action | null>(null)
  const [currentContent, setCurrentContent] = useState<ContentBlock | null>(null)
  const [completedSteps, setCompletedSteps] = useState<string[]>([])
  const [history, setHistory] = useState<any[]>([])
  const [conceptProgress, setConceptProgress] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [blocksCompleted, setBlocksCompleted] = useState(0)
  const [allScores, setAllScores] = useState<number[]>([])
  const [conceptsImproved, setConceptsImproved] = useState<string[]>([])
  const [finalizing, setFinalizing] = useState(false)
  const [showCelebration, setShowCelebration] = useState(false)
  const [summary, setSummary] = useState<any>(null)

  // Interactivity state
  const [userInput, setUserInput] = useState('')
  const [selectedOption, setSelectedOption] = useState<number | null>(null)
  const [flashcardIdx, setFlashcardIdx] = useState(0)
  const [flashcardFlipped, setFlashcardFlipped] = useState(false)
  const [quizIdx, setQuizIdx] = useState(0)
  const [quizAnswers, setQuizAnswers] = useState<Array<{ selectedIdx: number; isCorrect: boolean; question: any }>>([])
  const [showFeedback, setShowFeedback] = useState(false)
  const [explainContinued, setExplainContinued] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

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
    step: { type: 'explain' },
    materialContent,
    materialTitle: (masteryContext as any)?.materialTitle ?? '',
    masterySnapshot: masteryContext as any,
  })

  const topic = {
    id: session.topicId || 'unknown',
    title: session.topicTitle || session.title,
    concepts: (session.targetConcepts || []).map(n => ({
      name: n, definition: '', importance: 'major', difficulty: 50, practiceType: 'recall',
    })),
    difficulty: 50,
    importance: 70,
  }

  // ═══════════════════════════════════════════════════════════════
  // ORQUESTADOR: pide la próxima acción
  // ═══════════════════════════════════════════════════════════════
  const requestNextAction = async (lastInteraction?: any) => {
    setLoading(true)
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/adaptive/think', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adaptiveContext: adaptiveCtx,
          topic,
          studentModel,
          lastInteraction,
          blocksCompleted,
          completedSteps,
          history,
          initialKnowledgeLevel: (masteryContext as any)?.initialKnowledgeLevel,
        }),
        signal: abortRef.current.signal,
      })

      if (!res.ok) throw new Error('API error')
      const data = await res.json()

      if (!data.success) {
        finishSession()
        return
      }

      setStudentModel(data.model)

      // Actualizar progreso por concepto
      if (data.progress?.conceptScores) {
        setConceptProgress(data.progress.conceptScores)
      }

      if (data.sessionComplete) {
        finishSession(data.model, data.summary)
        return
      }

      if (data.action) {
        await executeAction(data.action)
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('Action request failed:', err)
        setCurrentAction(null)
      }
    } finally {
      setLoading(false)
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EJECUTA la acción llamando a la herramienta correcta
  // ═══════════════════════════════════════════════════════════════
  const executeAction = async (action: Action) => {
    setCurrentAction(action)
    setUserInput('')
    setSelectedOption(null)
    setFlashcardIdx(0)
    setFlashcardFlipped(false)
    setQuizIdx(0)
    setQuizAnswers([])
    setShowFeedback(false)
    setExplainContinued(false)

    const payload = {
      ...serializeAdaptiveContext(adaptiveCtx),
      topicTitle: action.topic,
      targetConcepts: action.concepts || (action.concept ? [action.concept] : []),
      count: action.count,
      questionTypes: action.questionType ? [action.questionType] : undefined,
    }

    try {
      let endpoint = ''
      let extraPayload: any = {}

      switch (action.type) {
        case 'explain':
        case 'synthesis':
          endpoint = '/api/adaptive/explain'
          break
        case 'flashcards':
          endpoint = '/api/adaptive/flashcards'
          break
        case 'quiz_multiple_choice':
          endpoint = '/api/adaptive/quiz'
          extraPayload = { questionTypes: ['multiple_choice'], count: 3 }
          break
        case 'quiz_true_false':
          endpoint = '/api/adaptive/quiz'
          extraPayload = { questionTypes: ['true_false'], count: 3 }
          break
        case 'quiz_open':
          endpoint = '/api/adaptive/quiz'
          extraPayload = { questionTypes: ['open_essay', 'explain_why'], count: 1 }
          break
        case 'quiz_apply':
          endpoint = '/api/adaptive/quiz'
          extraPayload = { questionTypes: ['apply_scenario'], count: 1 }
          break
        case 'comparison':
          endpoint = '/api/adaptive/explain'
          extraPayload = { mode: 'comparison' }
          break
        case 'repair':
        case 'recall':
          endpoint = '/api/adaptive/explain'
          extraPayload = { mode: action.type }
          break
        case 'close':
          finishSession()
          return
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, ...extraPayload }),
      })

      if (!res.ok) throw new Error(`Tool ${action.type} failed`)
      const data = await res.json()

      setCurrentContent({ type: action.type, data })
    } catch (err: any) {
      console.error('Tool execution failed:', err)
      setCurrentAction(null)
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // HANDLERS de cada tipo de interacción
  // ═══════════════════════════════════════════════════════════════
  const handleCompleteStep = async (stepType: string, score: number = 80, conceptName?: string) => {
    setCompletedSteps(prev => [...prev, stepType])
    setBlocksCompleted(prev => prev + 1)
    setAllScores(prev => [...prev, score])

    // Guardar en historial
    setHistory(prev => [...prev, {
      type: stepType,
      score,
      concept: conceptName,
      timestamp: Date.now(),
    }])

    if (score >= 70 && conceptName && !conceptsImproved.includes(conceptName)) {
      setConceptsImproved(prev => [...prev, conceptName])
    }

    setCurrentContent(null)
    setCurrentAction(null)
    await requestNextAction({ score, conceptTested: conceptName })
  }

  const handleExplainContinue = () => {
    handleCompleteStep(currentAction?.type || 'explain', 75, currentAction?.concepts?.[0])
  }

  const handleFlashcardAnswer = (knew: boolean) => {
    const cards = currentContent?.data?.cards || currentContent?.data?.flashcards || []
    setFlashcardFlipped(false)
    if (flashcardIdx + 1 < cards.length) {
      setFlashcardIdx(prev => prev + 1)
    } else {
      const knownCount = knew ? cards.length - flashcardIdx : 0
      const score = Math.round((knownCount / cards.length) * 100)
      handleCompleteStep('flashcards', score, currentAction?.concepts?.[0])
    }
  }

  const handleQuizAnswer = (selectedIdx: number) => {
    const questions = currentContent?.data?.questions || []
    const q = questions[quizIdx]
    if (!q) return

    // Guardar respuesta con índice y si fue correcta
    const isCorrect = selectedIdx === q.correctAnswer
    const newAnswers = [...quizAnswers, { selectedIdx, isCorrect, question: q }]
    setQuizAnswers(newAnswers)

    // Mostrar feedback inmediato de esta pregunta
    setShowFeedback(true)
  }

  const advanceQuizAfterFeedback = () => {
    const questions = currentContent?.data?.questions || []
    setShowFeedback(false)
    setSelectedOption(null)

    if (quizIdx + 1 < questions.length) {
      setQuizIdx(prev => prev + 1)
    } else {
      // Calcular score final
      const correct = quizAnswers.filter((a: any) => a.isCorrect).length
      const score = Math.round((correct / questions.length) * 100)
      handleCompleteStep(currentAction?.type || 'quiz', score, currentAction?.concept)
    }
  }

  const handleRecallSubmit = async () => {
    if (!userInput.trim()) return
    // Evaluar recall con chat
    let score = 65
    try {
      const res = await fetch('/api/adaptive/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...serializeAdaptiveContext(adaptiveCtx),
          message: userInput,
          context: `Evalúa qué tan bien el estudiante recordó "${currentAction?.concept}". 0-100.`,
          evaluateOnly: true,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const num = parseInt(String(data.message).match(/\d+/)?.[0] || '65')
        score = isNaN(num) ? 65 : Math.min(100, Math.max(0, num))
      }
    } catch {}

    handleCompleteStep('recall', score, currentAction?.concept)
  }

  // ═══════════════════════════════════════════════════════════════
  // FIN DE SESIÓN
  // ═══════════════════════════════════════════════════════════════
  const finishSession = (model?: any, finalSummary?: any) => {
    setShowCelebration(true)
    setTimeout(() => {
      setShowCelebration(false)
      setSummary(finalSummary || { masteredConcepts: conceptsImproved })
    }, 1500)
  }

  const handleCloseFinal = () => {
    setFinalizing(true)
    const avgScore = allScores.length > 0
      ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
      : 0
    const domainGain = Math.round((avgScore / 100) * (session.expectedDomainGain || 10))

    setTimeout(() => {
      onSessionComplete({
        domainGain,
        conceptsImproved: summary?.masteredConcepts || conceptsImproved,
        stepResults: [{
          stepId: session.steps[0]?.id || '0',
          score: avgScore,
          correct: avgScore >= 60,
        }],
      })
    }, 500)
  }

  // ═══════════════════════════════════════════════════════════════
  // ARRANCAR
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!materialContent || materialContent.trim().length < 50) {
      console.error('No material loaded')
      return
    }
    requestNextAction()
    return () => abortRef.current?.abort()
  }, [])

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  const dominatedCount = conceptProgress.filter(c => c.dominated).length
  const totalConcepts = conceptProgress.length || 1
  const progress = Math.round((dominatedCount / totalConcepts) * 100)

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
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 20, left: 24,
          background: 'rgba(214,178,111,0.08)',
          border: '1px solid rgba(214,178,111,0.3)',
          color: 'rgba(214,178,111,0.9)',
          padding: '10px 18px', borderRadius: 999, fontSize: 11,
          cursor: 'pointer', letterSpacing: 1.5, fontFamily: 'Georgia, serif',
          zIndex: 200,
        }}
      >
        ← VOLVER AL LIBRO
      </button>

      {/* CELEBRACIÓN */}
      {showCelebration && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(10,8,6,0.95)',
          zIndex: 200, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 24,
        }}>
          <div style={{ fontSize: 64, animation: 'pulse 1s ease-in-out infinite' }}>✨</div>
          <div style={{
            fontSize: 28, fontWeight: 700, color: '#d6b26f',
            fontFamily: 'Georgia, serif',
          }}>
            Sesión completada
          </div>
        </div>
      )}

      {/* RESUMEN FINAL */}
      {summary && !showCelebration && !finalizing && (
        <div style={{
          width: '100%', maxWidth: 600,
          background: 'linear-gradient(135deg, #f5ecd5 0%, #e8d9b0 100%)',
          borderRadius: 8, padding: '40px 50px',
          fontFamily: 'Georgia, serif', color: '#3a2e1f',
          boxShadow: '0 30px 80px rgba(0,0,0,0.7)',
        }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: 'rgba(58,46,31,0.5)', fontWeight: 700, marginBottom: 16 }}>
            SESIÓN {session.sessionNumber} COMPLETADA
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>
            ✓ {session.topicTitle || session.title}
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 28 }}>
            <Stat label="DOMINIO" value={`+${Math.round((allScores.reduce((a,b)=>a+b,0)/Math.max(1,allScores.length))/100 * (session.expectedDomainGain || 10))} pts`} />
            <Stat label="CONCEPTOS" value={String(conceptsImproved.length)} />
            <Stat label="PASOS" value={`${completedSteps.length}/5`} />
          </div>

          {conceptsImproved.length > 0 && (
            <div style={{ marginBottom: 24, padding: 16, background: 'rgba(90,138,58,0.1)', borderLeft: '3px solid #5a8a3a', borderRadius: 4 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: '#3a5a1e', fontWeight: 700, marginBottom: 8 }}>
                LO QUE DOMINASTE
              </div>
              {conceptsImproved.map((c, i) => (
                <div key={i} style={{ fontSize: 14, marginBottom: 4 }}>· {c}</div>
              ))}
            </div>
          )}

          <button
            onClick={handleCloseFinal}
            style={{
              width: '100%', padding: '14px 24px',
              background: 'linear-gradient(135deg, #d6b26f 0%, #a8854a 100%)',
              color: '#1a130d', border: 'none', borderRadius: 8,
              fontFamily: 'Georgia, serif', fontSize: 14, fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            ✓ Volver al libro
          </button>
        </div>
      )}

      {/* CONTENIDO PRINCIPAL */}
      {!summary && !showCelebration && !finalizing && (
        <div style={{
          width: '100%', maxWidth: 720, minHeight: 500,
          background: 'linear-gradient(135deg, #f5ecd5 0%, #e8d9b0 100%)',
          borderRadius: 8, padding: '40px 50px',
          fontFamily: 'Georgia, serif', color: '#3a2e1f',
          boxShadow: '0 30px 80px rgba(0,0,0,0.7)',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: 'rgba(58,46,31,0.5)', fontWeight: 700 }}>
              {currentAction ? actionLabel(currentAction.type) : 'PREPARANDO...'}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(58,46,31,0.6)' }}>
              {dominatedCount} / {totalConcepts} conceptos
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ height: 4, background: 'rgba(58,46,31,0.15)', borderRadius: 2, marginBottom: 28, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${progress}%`,
              background: 'linear-gradient(90deg, #d6b26f, #a8854a)',
              transition: 'width 0.5s ease',
            }} />
          </div>

          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 12, lineHeight: 1.2 }}>
            {session.topicTitle || session.title}
          </div>

          {/* Estado de los conceptos del topic */}
          {conceptProgress.length > 0 && (
            <div style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              marginBottom: 20,
            }}>
              {conceptProgress.map((cp: any, i: number) => (
                <div
                  key={i}
                  style={{
                    fontSize: 11,
                    padding: '4px 10px',
                    borderRadius: 999,
                    background: cp.dominated
                      ? 'rgba(90,138,58,0.15)'
                      : cp.score >= 40
                      ? 'rgba(214,178,111,0.15)'
                      : 'rgba(58,46,31,0.08)',
                    border: cp.dominated
                      ? '1px solid rgba(90,138,58,0.4)'
                      : cp.score >= 40
                      ? '1px solid rgba(214,178,111,0.4)'
                      : '1px solid rgba(58,46,31,0.15)',
                    color: cp.dominated ? '#3a5a1e' : cp.score >= 40 ? '#a8854a' : 'rgba(58,46,31,0.5)',
                    fontWeight: 600,
                  }}
                >
                  {cp.dominated ? '✓ ' : cp.score >= 40 ? '◐ ' : '○ '}
                  {cp.name}
                </div>
              ))}
            </div>
          )}

          {/* LOADING */}
          {loading && (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📖</div>
              <div style={{ fontSize: 14, fontStyle: 'italic', color: 'rgba(58,46,31,0.6)' }}>
                Preparando...
              </div>
            </div>
          )}

          {/* EXPLAIN / SYNTHESIS / RECALL / REPAIR */}
          {!loading && currentContent && ['explain', 'synthesis', 'recall', 'repair', 'comparison'].includes(currentContent.type) && (
            <ExplainView
              data={currentContent.data}
              type={currentContent.type}
              userInput={userInput}
              onChange={setUserInput}
              onSubmit={currentContent.type === 'recall' ? handleRecallSubmit : handleExplainContinue}
            />
          )}

          {/* FLASHCARDS */}
          {!loading && currentContent?.type === 'flashcards' && (
            <FlashcardView
              cards={currentContent.data?.cards || currentContent.data?.flashcards || []}
              currentIdx={flashcardIdx}
              flipped={flashcardFlipped}
              onFlip={() => setFlashcardFlipped(!flashcardFlipped)}
              onAnswer={handleFlashcardAnswer}
            />
          )}

          {/* QUIZ (todos los tipos) */}
          {!loading && currentContent && currentContent.type.startsWith('quiz') && (
            <QuizView
              questions={currentContent.data?.questions || []}
              currentIdx={quizIdx}
              selectedOption={selectedOption}
              onSelect={setSelectedOption}
              onSubmit={handleQuizAnswer}
              showFeedback={showFeedback}
              answers={quizAnswers}
              onAdvance={advanceQuizAfterFeedback}
            />
          )}

          {/* Razón de la acción (debug visible) */}
          {currentAction && (
            <div style={{
              marginTop: 24, fontSize: 10, color: 'rgba(58,46,31,0.4)',
              fontStyle: 'italic', textAlign: 'center',
            }}>
              {currentAction.reason}
            </div>
          )}
        </div>
      )}

      {finalizing && (
        <div style={{ color: '#d6b26f', fontFamily: 'Georgia, serif', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📖</div>
          <div>Guardando progreso...</div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// SUB-COMPONENTES
// ═══════════════════════════════════════════════════════════════

function actionLabel(type: ActionType): string {
  return {
    explain: '✦ EXPLICACIÓN',
    flashcards: '✦ FLASHCARDS',
    quiz_multiple_choice: '✦ OPCIÓN MÚLTIPLE',
    quiz_true_false: '✦ VERDADERO O FALSO',
    quiz_open: '✦ PREGUNTA ABIERTA',
    quiz_apply: '✦ APLICACIÓN',
    comparison: '✦ COMPARANDO IDEAS',
    recall: '✦ RECALL ACTIVO',
    repair: '✦ REFORZANDO',
    synthesis: '✦ SÍNTESIS FINAL',
    close: '✓ CERRANDO',
  }[type] || '✦ ' + type.toUpperCase()
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      flex: 1, padding: '12px 16px',
      background: 'rgba(214,178,111,0.1)', borderRadius: 6,
      border: '1px solid rgba(168,133,74,0.2)',
    }}>
      <div style={{ fontSize: 9, letterSpacing: 1.5, color: 'rgba(58,46,31,0.6)', fontWeight: 700, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#3a2e1f' }}>{value}</div>
    </div>
  )
}

function ExplainView({ data, type, userInput, onChange, onSubmit }: any) {
  const content = data?.lesson?.hook
    ? `${data.lesson.hook}\n\n${(data.lesson.explanationBlocks || []).map((b: any) => `${b.title ? `**${b.title}**\n` : ''}${b.content}`).join('\n\n')}`
    : data?.content || data?.analysis || data?.explanation || 'Cargando...'

  const isRecall = type === 'recall'

  return (
    <div>
      <div style={{
        fontSize: 14.5, lineHeight: 1.7, color: '#3a2e1f',
        marginBottom: 24, whiteSpace: 'pre-wrap',
      }}>
        {content}
      </div>

      {isRecall && (
        <textarea
          value={userInput}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Tu respuesta..."
          rows={5}
          style={{
            width: '100%', padding: 14, borderRadius: 6,
            border: '1.5px solid rgba(58,46,31,0.3)',
            background: 'rgba(255,255,255,0.5)', fontSize: 14,
            fontFamily: 'Georgia, serif', lineHeight: 1.6,
            resize: 'vertical', outline: 'none', marginBottom: 16,
          }}
        />
      )}

      <button
        onClick={onSubmit}
        disabled={isRecall && !userInput.trim()}
        style={{
          padding: '12px 24px', background: '#3a2e1f', color: '#f5ecd5',
          border: 'none', borderRadius: 6, fontFamily: 'Georgia, serif',
          fontSize: 13, fontWeight: 700, cursor: 'pointer',
          opacity: isRecall && !userInput.trim() ? 0.4 : 1,
        }}
      >
        {isRecall ? 'Enviar →' : 'Entendido, continuar →'}
      </button>
    </div>
  )
}

function FlashcardView({ cards, currentIdx, flipped, onFlip, onAnswer }: any) {
  const card = cards[currentIdx]
  if (!card) return <div>No hay flashcards</div>

  return (
    <div>
      <div style={{
        fontSize: 11, color: 'rgba(58,46,31,0.5)',
        marginBottom: 12, textAlign: 'center', fontStyle: 'italic',
      }}>
        Tarjeta {currentIdx + 1} de {cards.length}
      </div>
      <div
        onClick={onFlip}
        style={{
          background: 'rgba(255,255,255,0.5)',
          border: '1.5px solid rgba(58,46,31,0.25)',
          borderRadius: 8, padding: '40px 24px', minHeight: 180,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          textAlign: 'center', cursor: 'pointer', marginBottom: 16,
          fontSize: 16, fontWeight: flipped ? 500 : 600,
          color: '#3a2e1f', lineHeight: 1.5,
        }}
      >
        {flipped ? card.back : card.front}
      </div>
      {flipped && (
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => onAnswer(false)} style={btnDanger}>✗ No la sabía</button>
          <button onClick={() => onAnswer(true)} style={btnSuccess}>✓ La sabía</button>
        </div>
      )}
      {!flipped && (
        <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(58,46,31,0.5)' }}>
          Toca la tarjeta para ver la respuesta
        </div>
      )}
    </div>
  )
}

function QuizView({ questions, currentIdx, selectedOption, onSelect, onSubmit, showFeedback, answers, onAdvance }: any) {
  const q = questions[currentIdx]
  if (!q) return <div>Cargando quiz...</div>

  // ═══ FEEDBACK INMEDIATO POR PREGUNTA ═══
  if (showFeedback) {
    const lastAnswer = answers[answers.length - 1]
    if (!lastAnswer) return null

    const isCorrect = lastAnswer.isCorrect
    const userIdx = lastAnswer.selectedIdx
    const correctIdx = q.correctAnswer
    const correctText = q.options?.[correctIdx] ?? (q.booleanAnswer ? 'Verdadero' : 'Falso')
    const userText = q.options?.[userIdx] ?? '—'

    return (
      <div>
        {/* Pregunta original */}
        <div style={{
          fontSize: 13, color: 'rgba(58,46,31,0.6)',
          marginBottom: 10, fontStyle: 'italic',
        }}>
          Pregunta {currentIdx + 1} de {questions.length}
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 20, lineHeight: 1.5 }}>
          {q.question}
        </div>

        {/* Resultado */}
        <div style={{
          padding: '16px 20px',
          background: isCorrect ? 'rgba(90,138,58,0.1)' : 'rgba(139,26,26,0.1)',
          borderLeft: `4px solid ${isCorrect ? '#5a8a3a' : '#8b1a1a'}`,
          borderRadius: 6,
          marginBottom: 16,
        }}>
          <div style={{
            fontSize: 12, fontWeight: 700,
            color: isCorrect ? '#3a5a1e' : '#8b1a1a',
            marginBottom: 8, letterSpacing: 1,
          }}>
            {isCorrect ? '✓ CORRECTO' : '✗ INCORRECTO'}
          </div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            <strong>Tu respuesta:</strong> {userText}
          </div>
          {!isCorrect && (
            <div style={{ fontSize: 13, color: '#3a5a1e' }}>
              <strong>Respuesta correcta:</strong> {correctText}
            </div>
          )}
        </div>

        {/* Explicación educativa */}
        {q.explanation && (
          <div style={{
            padding: '16px 20px',
            background: 'rgba(214,178,111,0.1)',
            borderLeft: '4px solid #a8854a',
            borderRadius: 6,
            marginBottom: 20,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
              color: '#a8854a', marginBottom: 8,
            }}>
              ✦ POR QUÉ
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.6, color: '#3a2e1f' }}>
              {q.explanation}
            </div>
          </div>
        )}

        <button
          onClick={onAdvance}
          style={{
            padding: '12px 24px', background: '#3a2e1f', color: '#f5ecd5',
            border: 'none', borderRadius: 6, fontFamily: 'Georgia, serif',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          {currentIdx + 1 < questions.length ? 'Siguiente pregunta →' : 'Terminar quiz →'}
        </button>
      </div>
    )
  }

  // ═══ MOSTRAR PREGUNTA ═══
  const options = q.options || (q.type === 'true_false' ? ['Verdadero', 'Falso'] : [])

  return (
    <div>
      <div style={{
        fontSize: 11, color: 'rgba(58,46,31,0.5)',
        marginBottom: 12, fontStyle: 'italic',
      }}>
        Pregunta {currentIdx + 1} de {questions.length}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 20, lineHeight: 1.5 }}>
        {q.question}
      </div>
      <div style={{ marginBottom: 16 }}>
        {options.map((opt: string, i: number) => (
          <button
            key={i}
            onClick={() => onSelect(i)}
            style={{
              width: '100%', padding: '12px 16px', marginBottom: 8,
              borderRadius: 6,
              border: selectedOption === i ? '2px solid #3a2e1f' : '1.5px solid rgba(58,46,31,0.25)',
              background: selectedOption === i ? 'rgba(58,46,31,0.08)' : 'rgba(255,255,255,0.4)',
              color: '#3a2e1f', fontFamily: 'Georgia, serif',
              fontSize: 13.5, cursor: 'pointer', textAlign: 'left',
            }}
          >
            {opt}
          </button>
        ))}
      </div>
      <button
        onClick={() => selectedOption !== null && onSubmit(selectedOption)}
        disabled={selectedOption === null}
        style={{
          padding: '12px 24px', background: '#3a2e1f', color: '#f5ecd5',
          border: 'none', borderRadius: 6, fontFamily: 'Georgia, serif',
          fontSize: 13, fontWeight: 700, cursor: 'pointer',
          opacity: selectedOption === null ? 0.4 : 1,
        }}
      >
        Responder →
      </button>
    </div>
  )
}

const btnSuccess: React.CSSProperties = {
  flex: 1, padding: '12px 16px', borderRadius: 6,
  border: '1.5px solid #5a8a3a', background: 'rgba(90,138,58,0.15)',
  color: '#3a5a1e', fontFamily: 'Georgia, serif', fontSize: 13,
  fontWeight: 700, cursor: 'pointer',
}

const btnDanger: React.CSSProperties = {
  flex: 1, padding: '12px 16px', borderRadius: 6,
  border: '1.5px solid #8b1a1a', background: 'rgba(139,26,26,0.1)',
  color: '#8b1a1a', fontFamily: 'Georgia, serif', fontSize: 13,
  fontWeight: 700, cursor: 'pointer',
}
