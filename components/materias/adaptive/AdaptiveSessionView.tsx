'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { AdaptiveSession } from '../../../lib/adaptive'
import MatchingCanvas from './book/MatchingCanvas'

// ═══════════════════════════════════════════════════════════════
// AdaptiveSessionView v2 — Cerebro Pedagógico Real
// Motor: microconcepto → evidencia → decisión → siguiente paso
// El plan dice QUÉ cubrir. Este motor decide CÓMO y CUÁNDO.
// ═══════════════════════════════════════════════════════════════

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

type Phase =
  | 'loading'
  | 'teaching'
  | 'answering'
  | 'feedback'
  | 'recalling'
  | 'recall_feedback'
  | 'completing'
  | 'error'

const genId = () => Math.random().toString(36).slice(2, 10)
const ts = () => Date.now()

function normStr(s: string) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ').trim()
}

function interactionLabel(format?: string): string {
  const map: Record<string, string> = {
    explain: '✦ EXPLICACIÓN', analogy: '✦ ANALOGÍA',
    context: '✦ CONTEXTO', worked_example: '✦ EJEMPLO RESUELTO',
    step_by_step: '✦ PASO A PASO', example: '✦ EJEMPLO',
    multiple_choice: '✦ EVALUACIÓN', true_false: '✦ VERDADERO O FALSO',
    fill_blank: '✦ COMPLETAR', matching: '✦ RELACIONAR',
    ordering: '✦ ORDENAR', comparison: '✦ COMPARACIÓN',
    cause_effect: '✦ CAUSA Y EFECTO', case_study: '✦ CASO PRÁCTICO',
    short_answer: '✦ RESPUESTA CORTA', active_recall: '✦ RECALL ACTIVO',
    error_detection: '✦ DETECTAR ERROR', harder_problem: '✦ RETO',
  }
  return map[format || ''] || '✦ ACTIVIDAD'
}

export default function AdaptiveSessionView({
  session, materialContent, masteryContext, onSessionComplete, onClose,
}: Props) {
  // ── Estado del cerebro ────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('loading')
  const [loadingMsg, setLoadingMsg] = useState('ALAI está preparando tu sesión...')
  const [errorMsg, setErrorMsg] = useState('')

  // ── Sesión viva ───────────────────────────────────────────────
  const [sessionState, setSessionState] = useState<any>(null)
  const [currentInteraction, setCurrentInteraction] = useState<any>(null)
  const [evaluation, setEvaluation] = useState<any>(null)
  const [sessionObjectives, setSessionObjectives] = useState<string[]>([])
  const [totalUnits, setTotalUnits] = useState(0)

  // ── Inputs del estudiante ─────────────────────────────────────
  const [selectedOption, setSelectedOption] = useState<number | null>(null)
  const [selectedOptions, setSelectedOptions] = useState<number[]>([])
  const [fillAnswer, setFillAnswer] = useState('')
  const [shortAnswer, setShortAnswer] = useState('')
  const [matchingAnswer, setMatchingAnswer] = useState<Record<number, number>>({})
  const [orderAnswer, setOrderAnswer] = useState<number[]>([])
  const [confidence, setConfidence] = useState<string>('medium')
  const [showConfidence, setShowConfidence] = useState(false)

  // ── Recall ────────────────────────────────────────────────────
  const [recallText, setRecallText] = useState('')
  const [recallLoading, setRecallLoading] = useState(false)

  // ── Métricas ──────────────────────────────────────────────────
  const [interactions, setInteractions] = useState<any[]>([])
  const [allScores, setAllScores] = useState<number[]>([])
  const [conceptsImproved, setConceptsImproved] = useState<string[]>([])
  const [conceptEvidences, setConceptEvidences] = useState<Record<string, any>>({})
  const [currentStrategy, setCurrentStrategy] = useState<any>(null)
  const [conceptStatus, setConceptStatus] = useState<any>(null)
  const [stepStartTime, setStepStartTime] = useState(ts())

  // ── Control ───────────────────────────────────────────────────
  const [finalizing, setFinalizing] = useState(false)
  const [showCelebration, setShowCelebration] = useState(false)
  const hasStarted = useRef(false)
  const sessionStateRef = useRef<any>(null)
  useEffect(() => { sessionStateRef.current = sessionState }, [sessionState])

  // ── Contexto del material ─────────────────────────────────────
  const analysisData = (masteryContext as any)?.materialAnalysis || null
  const subjectArea = analysisData?.subjectArea || 'general'
  const materialTitle = (masteryContext as any)?.materialTitle || session.topicTitle || session.title || 'el tema'
  const sessionLength = (masteryContext as any)?.sessionLength ||
    (masteryContext as any)?.setup?.sessionLength || 'medium'
  const studentLevel = (masteryContext as any)?.setup?.initialKnowledgeLevel || 'some'

  // Unidades de cobertura para esta sesión
  const getCoverageUnits = useCallback(() => {
    const allUnits = analysisData?.totalCoverageUnits || []
    const sessionUnitIds: string[] = (session as any).coverageUnitIds || []

    if (sessionUnitIds.length > 0 && allUnits.length > 0) {
      const filtered = allUnits.filter((u: any) => sessionUnitIds.includes(u.id))
      if (filtered.length > 0) return filtered
    }

    // Fallback: usar topics del blueprint
    const blueprintTopics = (masteryContext as any)?.materialBlueprint?.topics || []
    const sessionTopicIds = (session as any).groupedTopicIds || [session.topicId].filter(Boolean)
    const filtered = blueprintTopics.filter((t: any) =>
      sessionTopicIds.includes(t.id) || t.title === session.topicTitle
    )

    if (filtered.length > 0) {
      return filtered.map((t: any) => ({
        id: t.id,
        title: t.title,
        importance: 'high',
        knowledgeType: 'conceptual',
        rawTextReference: materialContent.slice(0, 2000),
        keyFacts: (t.concepts || []).map((c: any) => c.name),
        learningObjectives: [`Aprender sobre ${t.title}`],
      }))
    }

    // Último fallback: crear unidad desde la sesión misma
    return [{
      id: session.id || 'unit_1',
      title: session.topicTitle || session.title,
      importance: 'high',
      knowledgeType: 'conceptual',
      rawTextReference: materialContent.slice(0, 3000),
      keyFacts: session.targetConcepts || [],
      learningObjectives: [`Aprender sobre ${session.topicTitle || session.title}`],
    }]
  }, [analysisData, session, masteryContext, materialContent])

  // ═══════════════════════════════════════════════════════════════
  // INICIAR SESIÓN
  // ═══════════════════════════════════════════════════════════════
  const startSession = useCallback(async () => {
    setPhase('loading')
    setLoadingMsg('ALAI está preparando tu sesión...')

    try {
      const units = getCoverageUnits()

      const res = await fetch('/api/adaptive/start-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: { id: session.id, title: session.title, purpose: session.purpose },
          materialText: materialContent.slice(0, 8000),
          materialTitle,
          subjectArea,
          coverageUnits: units,
          studentLevel,
          sessionLength,
        }),
      })

      if (!res.ok) throw new Error(`start-session ${res.status}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Error iniciando sesión')

      setSessionState(data.sessionState)
      setCurrentInteraction(data.firstInteraction)
      setSessionObjectives(data.sessionObjectives || [])
      setTotalUnits(data.totalUnits || units.length)
      setStepStartTime(ts())
      setPhase('teaching')

    } catch (err: any) {
      console.error('[startSession]', err.message)
      setErrorMsg(err.message)
      setPhase('error')
    }
  }, [session, materialContent, materialTitle, subjectArea, studentLevel, sessionLength, getCoverageUnits])

  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true
    startSession()
  }, [])

  // ═══════════════════════════════════════════════════════════════
  // PROCESAR RESPUESTA → CEREBRO PEDAGÓGICO
  // ═══════════════════════════════════════════════════════════════
  const processAnswer = useCallback(async (studentAnswer: any, conf?: string) => {
    const state = sessionStateRef.current
    if (!state || !currentInteraction) return

    setPhase('loading')
    setLoadingMsg('ALAI está analizando tu respuesta...')

    const responseTime = Math.round((ts() - stepStartTime) / 1000)
    const usedConfidence = conf || confidence

    try {
      const res = await fetch('/api/adaptive/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionState: state,
          studentAnswer,
          confidence: usedConfidence,
          responseTimeSeconds: responseTime,
          currentInteraction,
          materialText: materialContent.slice(0, 4000),
          materialTitle,
          subjectArea,
          evidenceHistory: state.evidenceHistory || [],
          recentFormats: state.recentFormats || [],
          consecutiveFailures: state.consecutiveFailures || 0,
          remainingUnits: state.remainingUnits || [],
          coveredUnits: state.coveredUnits || [],
        }),
      })

      if (!res.ok) throw new Error(`respond ${res.status}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error)

      const { evaluation: eval_, decision, nextInteraction, updatedState, strategy, conceptStatus: cStatus, isConceptMastered: mastered } = data

      // Guardar estrategia y evidencia
      if (strategy) setCurrentStrategy(strategy)
      if (cStatus) setConceptStatus(cStatus)
      if (updatedState?.conceptEvidences) setConceptEvidences(updatedState.conceptEvidences)
      
      // Detectar si el próximo paso es una reenseñanza
      if (updatedState?.isReteachStep && nextInteraction) {
        nextInteraction.isReteach = true
      }

      // Registrar interacción
      const interactionRecord = {
        id: genId(),
        format: currentInteraction.format,
        concept: currentInteraction.concept,
        correct: decision.wasCorrect,
        score: decision.score,
        confidence: usedConfidence,
        responseTime,
        timestamp: ts(),
      }

      setInteractions(prev => [...prev, interactionRecord])

      if (!currentInteraction.isTeaching) {
        setAllScores(prev => [...prev, decision.score])
      }

      if (decision.wasCorrect && decision.score >= 70 && currentInteraction.concept) {
        setConceptsImproved(prev =>
          prev.includes(currentInteraction.concept) ? prev : [...prev, currentInteraction.concept]
        )
      }

      // Actualizar estado de sesión
      const newState = {
        ...state,
        coveredUnits: updatedState.coveredUnits,
        remainingUnits: updatedState.remainingUnits,
        consecutiveFailures: decision.consecutiveFailures,
        recentFormats: [...(state.recentFormats || []), nextInteraction?.format || ''].slice(-6),
        evidenceHistory: [
          ...(state.evidenceHistory || []),
          {
            objective: currentInteraction.objective,
            correct: decision.wasCorrect,
            confidence: usedConfidence,
            format: currentInteraction.format,
            concept: currentInteraction.concept,
            wasReteach: currentInteraction.isReteach || false,
          },
        ].slice(-20),
        totalInteractions: (state.totalInteractions || 0) + 1,
      }
      setSessionState(newState)

      // ── Decidir qué mostrar ──────────────────────────────────
      if (currentInteraction.isTeaching || studentAnswer === '__teaching_acknowledged__') {
        // Era explicación → ir a la siguiente interacción directamente SIN feedback
        setCurrentInteraction(nextInteraction)
        setEvaluation(null)
        resetInputs()
        setStepStartTime(ts())
        setShowConfidence(false)

        const nextIsRecall = nextInteraction?.format === 'active_recall' ||
          nextInteraction?.type === 'active_recall'
        const nextIsTeaching = nextInteraction?.isTeaching ||
          ['explain', 'analogy', 'context', 'worked_example', 'step_by_step', 'example'].includes(nextInteraction?.format)
        setPhase(nextIsRecall ? 'recalling' : nextIsTeaching ? 'teaching' : 'answering')

      } else {
        // Era evaluación → mostrar feedback
        setEvaluation(eval_)
        setCurrentInteraction(nextInteraction)
        setStepStartTime(ts())

        if (updatedState.isSessionComplete) {
          setPhase('feedback')
          // Cerrar sesión después del último feedback
        } else {
          setPhase('feedback')
        }
      }

      // Cerrar sesión si está completa
      if (updatedState.isSessionComplete && currentInteraction.isFinalRecall) {
        setTimeout(() => finishSession(newState), 500)
      }

    } catch (err: any) {
      console.error('[processAnswer]', err.message)
      // En caso de error, avanzar de todas formas
      setEvaluation(null)
      setPhase('answering')
    }
  }, [currentInteraction, stepStartTime, confidence, materialContent, materialTitle, subjectArea])

  // ═══════════════════════════════════════════════════════════════
  // CONTINUAR DESPUÉS DEL FEEDBACK
  // ═══════════════════════════════════════════════════════════════
  const continueAfterFeedback = useCallback(() => {
    const state = sessionStateRef.current
    if (!currentInteraction) return

    resetInputs()
    setEvaluation(null)
    setConfidence('medium')
    setShowConfidence(false)
    setStepStartTime(ts())

    // ¿Sesión completa?
    if (!currentInteraction || state?.remainingUnits?.length === 0) {
      // Verificar si ya hicimos recall final
      const hadFinalRecall = state?.evidenceHistory?.some(
        (e: any) => e.objective === 'synthesis'
      )
      if (hadFinalRecall) {
        finishSession(state)
        return
      }
    }

    const nextFormat = currentInteraction?.format
    const isRecall = nextFormat === 'active_recall' || nextFormat === 'short_answer'

    if (currentInteraction?.isFinalRecall || isRecall) {
      setPhase('recalling')
    } else if (currentInteraction?.isTeaching) {
      setPhase('teaching')
    } else {
      setPhase('answering')
    }
  }, [currentInteraction])

  // ═══════════════════════════════════════════════════════════════
  // RECALL ACTIVO
  // ═══════════════════════════════════════════════════════════════
  const submitRecall = useCallback(async () => {
    if (!recallText.trim()) return
    setRecallLoading(true)

    await processAnswer(recallText, confidence)
    setRecallText('')
    setRecallLoading(false)
  }, [recallText, confidence, processAnswer])

  // ═══════════════════════════════════════════════════════════════
  // SUBMIT DE EVALUACIÓN
  // ═══════════════════════════════════════════════════════════════
  const submitAnswer = useCallback(async (directAnswer?: any) => {
    // Si directAnswer es un evento del DOM, ignorarlo
    if (directAnswer && typeof directAnswer === 'object' && (directAnswer.nativeEvent || directAnswer.target?.tagName)) {
      directAnswer = undefined
    }

    const format = currentInteraction?.format || currentInteraction?.type

    let answer: any
    if (directAnswer !== undefined) {
      answer = directAnswer
    } else if (format === 'multiple_choice') {
      answer = selectedOption
    } else if (format === 'true_false') {
      answer = selectedOption === 0 ? true : false
    } else if (format === 'fill_blank') {
      answer = fillAnswer
    } else if (format === 'short_answer') {
      answer = shortAnswer
    } else if (format === 'matching') {
      answer = matchingAnswer
    } else if (format === 'ordering') {
      answer = orderAnswer
    } else if (format === 'comparison' || format === 'cause_effect' || format === 'case_study') {
      answer = shortAnswer
    } else {
      answer = shortAnswer || fillAnswer || selectedOption
    }

    await processAnswer(answer, confidence)
  }, [currentInteraction, selectedOption, fillAnswer, shortAnswer, matchingAnswer, orderAnswer, confidence, processAnswer])

  // ═══════════════════════════════════════════════════════════════
  // FINISH SESSION
  // ═══════════════════════════════════════════════════════════════
  const finishSession = useCallback((state?: any) => {
    if (finalizing) return
    setFinalizing(true)
    setShowCelebration(true)

    const scores = allScores.length > 0 ? allScores : [65]
    const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)

    const baseGain = session.expectedDomainGain || 15
    const mult = avgScore >= 80 ? 1.2 : avgScore >= 60 ? 1.0 : avgScore >= 40 ? 0.6 : 0.1
    const domainGain = Math.max(avgScore >= 40 ? 4 : 0, Math.round((avgScore / 100) * baseGain * mult))

    const finalConcepts = conceptsImproved.length > 0
      ? conceptsImproved
      : (session.targetConcepts || []).slice(0, 3)

    setTimeout(() => {
      setShowCelebration(false)
      onSessionComplete({
        domainGain,
        conceptsImproved: finalConcepts,
        stepResults: interactions.map((int, i) => ({
          stepId: int.id || String(i),
          score: int.score,
          correct: (int.score || 0) >= 60,
        })),
      })
    }, 1800)
  }, [finalizing, allScores, conceptsImproved, session, interactions, onSessionComplete])

  // ── Reset inputs ─────────────────────────────────────────────
  function resetInputs() {
    setSelectedOption(null)
    setSelectedOptions([])
    setFillAnswer('')
    setShortAnswer('')
    setMatchingAnswer({})
    setOrderAnswer([])
    setConfidence('medium')
  }

  // ── Calcular progreso ─────────────────────────────────────────
  const coveredCount = sessionState?.coveredUnits?.length || 0
  const progressPct = totalUnits > 0 ? Math.round((coveredCount / totalUnits) * 100) : 0
  const interactionCount = sessionState?.totalInteractions || 0

  // ═══════════════════════════════════════════════════════════════
  // RENDER LOADING
  // ═══════════════════════════════════════════════════════════════
  if (phase === 'loading') {
    return (
      <div style={overlayStyle}>
        <div style={{ fontSize: 52, animation: 'pulse 1.5s ease-in-out infinite' }}>📖</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#f5e6b8', marginBottom: 8, textAlign: 'center' }}>
          {loadingMsg}
        </div>
        <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.7;transform:scale(1.05)}}`}</style>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div style={overlayStyle}>
        <div style={{ fontSize: 44, marginBottom: 16 }}>😓</div>
        <div style={{ fontSize: 15, color: '#f5e6b8', marginBottom: 8 }}>ALAI está ocupado</div>
        <div style={{ fontSize: 13, color: '#a8854a', marginBottom: 24 }}>{errorMsg}</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => { hasStarted.current = false; startSession() }} style={btnGold}>🔄 Reintentar</button>
          <button onClick={onClose} style={btnOutline}>← Volver</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div style={overlayStyle}>
        <button onClick={onClose} style={{
          position: 'absolute', top: 20, left: 24,
          background: 'rgba(214,178,111,0.08)', border: '1px solid rgba(214,178,111,0.3)',
          color: 'rgba(214,178,111,0.9)', padding: '8px 16px', borderRadius: 999,
          fontSize: 11, cursor: 'pointer', letterSpacing: 1.5, fontFamily: 'Georgia, serif', zIndex: 200,
        }}>← VOLVER AL LIBRO</button>

        {/* Barra de progreso */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'rgba(214,178,111,0.15)' }}>
          <div style={{ height: '100%', width: `${progressPct}%`, background: 'linear-gradient(90deg,#d6b26f,#a8854a)', transition: 'width .5s ease' }} />
        </div>

        {/* Celebración */}
        {showCelebration && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,8,6,.95)', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
            <div style={{ fontSize: 60 }}>✨</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#d6b26f', fontFamily: 'Georgia, serif' }}>Sesión completada</div>
          </div>
        )}

        {!showCelebration && !finalizing && (
          <div style={cardStyle}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 10, letterSpacing: 3, color: 'rgba(58,46,31,.5)', fontWeight: 700 }}>
                {interactionLabel(currentInteraction?.format || currentInteraction?.type)}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(58,46,31,.4)' }}>
                {interactionCount > 0 ? `${interactionCount} interacciones` : ''}
              </div>
            </div>

            {/* Barra de cobertura de la sesión */}
            <div style={{ height: 3, background: 'rgba(58,46,31,.1)', borderRadius: 2, marginBottom: 16, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPct}%`, background: '#d6b26f', transition: 'width .5s' }} />
            </div>

            {/* Concepto actual */}
            <div style={{ fontSize: 11, color: 'rgba(58,46,31,.4)', marginBottom: 4, fontWeight: 600, letterSpacing: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{currentInteraction?.concept || session.topicTitle || session.title}</span>
              {conceptStatus && conceptStatus.label && (
                <span style={{
                  fontSize: 9, padding: '2px 8px', borderRadius: 999,
                  background: `${conceptStatus.color}15`,
                  color: conceptStatus.color,
                  fontWeight: 700, letterSpacing: 0.5,
                }}>
                  {conceptStatus.label}
                </span>
              )}
            </div>

            {/* Objetivos de la sesión — solo al inicio */}
            {sessionObjectives.length > 0 && interactionCount === 0 && (
              <div style={{ background: 'rgba(214,178,111,.08)', borderLeft: '3px solid #d6b26f', borderRadius: 4, padding: '10px 14px', marginBottom: 16 }}>
                <div style={{ fontSize: 9, letterSpacing: 2, color: '#a8854a', fontWeight: 800, marginBottom: 6 }}>HOY LOGRARÁS</div>
                {sessionObjectives.slice(0, 4).map((obj, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#3a2e1f', lineHeight: 1.5, display: 'flex', gap: 6 }}>
                    <span style={{ color: '#5a8a3a' }}>○</span> {obj}
                  </div>
                ))}
              </div>
            )}

            {/* ── TEACHING ─────────────────────────────────────── */}
            {phase === 'teaching' && currentInteraction && (
              <TeachingBlock
                interaction={currentInteraction}
                onContinue={() => {
                  // Después de enseñar → procesar como "visto" y pasar al siguiente
                  processAnswer('__teaching_acknowledged__', 'medium')
                }}
              />
            )}

            {/* ── ANSWERING ─────────────────────────────────────── */}
            {phase === 'answering' && currentInteraction && (
              <AnsweringBlock
                interaction={currentInteraction}
                selectedOption={selectedOption}
                selectedOptions={selectedOptions}
                fillAnswer={fillAnswer}
                shortAnswer={shortAnswer}
                matchingAnswer={matchingAnswer}
                orderAnswer={orderAnswer}
                confidence={confidence}
                showConfidence={showConfidence}
                onSelectOption={(i: number) => {
                  setSelectedOption(i)
                  setShowConfidence(true)
                }}
                onToggleOption={(i: number) => setSelectedOptions(prev =>
                  prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]
                )}
                onFillChange={setFillAnswer}
                onShortChange={setShortAnswer}
                onMatchingChange={setMatchingAnswer}
                onOrderChange={setOrderAnswer}
                onConfidenceChange={setConfidence}
                onSubmit={submitAnswer}
                onDirectSubmit={(answer: any) => submitAnswer(answer)}
              />
            )}

            {/* ── FEEDBACK ─────────────────────────────────────── */}
            {phase === 'feedback' && evaluation && (
              <FeedbackBlock
                evaluation={evaluation}
                onContinue={continueAfterFeedback}
                isLastInteraction={sessionState?.remainingUnits?.length === 0}
              />
            )}

            {/* ── RECALL ───────────────────────────────────────── */}
            {phase === 'recalling' && (
              <RecallBlock
                interaction={currentInteraction}
                text={recallText}
                loading={recallLoading}
                confidence={confidence}
                onTextChange={setRecallText}
                onConfidenceChange={setConfidence}
                onSubmit={submitRecall}
              />
            )}
          </div>
        )}
      </div>

      {/* Terminar sesión */}
      {!finalizing && !showCelebration && (
        <button
          onClick={() => { if (confirm('¿Terminar sesión ahora?')) finishSession(sessionState) }}
          style={{
            position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
            background: 'rgba(245,200,66,.15)', border: '1.5px solid rgba(245,200,66,.5)',
            color: '#f5c842', padding: '10px 18px', borderRadius: 12,
            fontSize: 13, fontWeight: 700, cursor: 'pointer', backdropFilter: 'blur(8px)',
          }}
        >✓ Terminar sesión</button>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
// TEACHING BLOCK
// ═══════════════════════════════════════════════════════════════
function TeachingBlock({ interaction, onContinue }: { interaction: any; onContinue: () => void }) {
  const content = String(interaction?.content || '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/#{1,6}\s/g, '')
  const keyIdea = String(interaction?.keyIdea || '').replace(/Para recordar:\s*/i, '').trim()
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim())
  const isReteach = interaction?.isReteach
  const format = interaction?.format || interaction?.type

  return (
    <div>
      {/* Banner de reenseñanza */}
      {isReteach && (
        <div style={{ 
          padding: '12px 16px', 
          background: 'rgba(214,178,111,0.12)', 
          borderLeft: '3px solid #d6b26f', 
          borderRadius: 6, 
          marginBottom: 20, 
          fontSize: 13, 
          color: '#3a2e1f',
          lineHeight: 1.5,
        }}>
          🔄 <strong>Vamos a verlo diferente.</strong> {
            format === 'analogy' ? 'Con una analogía para que sea más claro.' :
            format === 'worked_example' ? 'Con un ejemplo resuelto paso a paso.' :
            format === 'step_by_step' ? 'Descompuesto en pasos simples.' :
            'Desde otro ángulo.'
          }
        </div>
      )}
      
      {paragraphs.map((p, i) => (
        <p key={i} style={{ fontSize: 14.5, lineHeight: 1.85, color: '#3a2e1f', marginBottom: 16 }}>
          {p.trim()}
        </p>
      ))}
      {keyIdea && (
        <div style={{ padding: '12px 16px', background: 'rgba(214,178,111,0.12)', borderLeft: '3px solid #d6b26f', borderRadius: 6, marginBottom: 24, fontSize: 13.5, color: '#3a2e1f', fontWeight: 600, lineHeight: 1.5 }}>
          💡 Para recordar: {keyIdea}
        </div>
      )}
      <button onClick={onContinue} style={btnPrimary}>Entendido, continuar →</button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// ANSWERING BLOCK — todos los tipos de pregunta
// ═══════════════════════════════════════════════════════════════
function AnsweringBlock({
  interaction, selectedOption, selectedOptions, fillAnswer, shortAnswer,
  matchingAnswer, orderAnswer, confidence, showConfidence,
  onSelectOption, onToggleOption, onFillChange, onShortChange,
  onMatchingChange, onOrderChange, onConfidenceChange, onSubmit, onDirectSubmit,
}: any) {
  const format = interaction?.format || interaction?.type
  const [showWordBank, setShowWordBank] = useState(false)

  const ConfidenceSelector = () => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: 'rgba(58,46,31,.45)', marginBottom: 8, fontWeight: 700 }}>¿QUÉ TAN SEGURO/A ESTÁS?</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {[
          { key: 'high', label: '💪 Seguro', },
          { key: 'medium', label: '🤔 Algo', },
          { key: 'low', label: '😅 Poco', },
        ].map(opt => (
          <button key={opt.key} onClick={() => onConfidenceChange(opt.key)}
            style={{ flex: 1, padding: '7px 4px', borderRadius: 6, border: confidence === opt.key ? '2px solid #d6b26f' : '1.5px solid rgba(58,46,31,.15)', background: confidence === opt.key ? 'rgba(214,178,111,.15)' : 'transparent', color: '#3a2e1f', fontFamily: 'Georgia, serif', fontSize: 11, cursor: 'pointer', fontWeight: confidence === opt.key ? 700 : 400 }}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )

  const questionText = interaction?.question || interaction?.prompt || interaction?.content || `Responde sobre "${interaction?.concept || 'el tema'}"`
  
  // Detectar si el bloque específico va a renderizar algo
  const hasSpecificRender = 
    (format === 'multiple_choice' && Array.isArray(interaction?.options) && interaction.options.length > 0) ||
    (format === 'true_false' && interaction?.correctAnswer !== undefined) ||
    (format === 'fill_blank' && (interaction?.answer || interaction?.wordBank)) ||
    (format === 'matching' && Array.isArray(interaction?.pairs) && interaction.pairs.length > 0) ||
    (format === 'ordering' && Array.isArray(interaction?.items) && interaction.items.length > 0) ||
    (format === 'short_answer') ||
    (format === 'cause_effect' || format === 'comparison' || format === 'case_study' || 
     format === 'harder_volpe' || format === 'transfer_case' || format === 'inverse_teaching')
  
  // Si no hay render específico, usar el fallback universal
  const needsUniversalFallback = !hasSpecificRender

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 20, lineHeight: 1.5, color: '#3a2e1f' }}>
        {questionText}
      </div>
      
      {/* Debug badge — solo dev */}
      {process.env.NODE_ENV === 'development' && (
        <div style={{ fontSize: 9, color: '#a8854a', marginBottom: 8, fontFamily: 'monospace' }}>
          format={format} | hasQuestion={!!interaction?.question} | fallback={needsUniversalFallback ? 'YES' : 'NO'}
        </div>
      )}

      {/* MULTIPLE CHOICE */}
      {format === 'multiple_choice' && (
        <div style={{ marginBottom: 16 }}>
          {(interaction?.options || []).map((opt: string, i: number) => (
            <button key={i} onClick={() => onDirectSubmit(i)}
              style={{ width: '100%', padding: '12px 16px', marginBottom: 8, borderRadius: 6, border: '1.5px solid rgba(58,46,31,.25)', background: 'rgba(255,255,255,.4)', color: '#3a2e1f', fontFamily: 'Georgia, serif', fontSize: 13.5, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, transition: 'all .15s ease' }}>
              <span style={{ fontWeight: 700, color: 'rgba(58,46,31,.4)', minWidth: 20 }}>{String.fromCharCode(65 + i)}.</span>
              {opt}
            </button>
          ))}
        </div>
      )}

      {/* TRUE FALSE */}
      {format === 'true_false' && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          {['Verdadero ✓', 'Falso ✗'].map((opt, i) => (
            <button key={i} onClick={() => onDirectSubmit(i === 0)}
              style={{ flex: 1, padding: '16px', borderRadius: 6, border: '1.5px solid rgba(58,46,31,.25)', background: 'rgba(255,255,255,.4)', color: '#3a2e1f', fontFamily: 'Georgia, serif', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              {opt}
            </button>
          ))}
        </div>
      )}

      {/* FILL BLANK — siempre renderizar input, aunque falte wordBank */}
      {(format === 'fill_blank' || format === 'completar' || format === 'complete') && (
        <div style={{ marginBottom: 16 }}>
          {interaction?.wordBank?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <button onClick={() => setShowWordBank(!showWordBank)}
                style={{ fontSize: 11, color: '#a8854a', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Georgia, serif', fontWeight: 700 }}>
                📦 Banco de palabras {showWordBank ? '▲' : '▼'}
              </button>
              {showWordBank && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {interaction.wordBank.map((w: string) => (
                    <button key={w} onClick={() => onFillChange(w)}
                      style={{ padding: '5px 12px', borderRadius: 6, background: fillAnswer === w ? '#3a2e1f' : '#fff', color: fillAnswer === w ? '#f5ecd5' : '#3a2e1f', border: '1.5px solid rgba(58,46,31,.2)', fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif' }}>
                      {w}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <input value={fillAnswer} onChange={e => onFillChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && fillAnswer.trim()) { e.preventDefault(); onSubmit() } }}
            placeholder="Escribe la respuesta..."
            style={{ width: '100%', padding: '14px', borderRadius: 8, border: '2px solid rgba(58,46,31,.2)', background: 'rgba(255,255,255,.8)', fontSize: 15, fontFamily: 'Georgia, serif', color: '#3a2e1f', outline: 'none', boxSizing: 'border-box', marginBottom: 10 }} />
          <button onClick={() => onSubmit()} disabled={!fillAnswer.trim()}
            style={{ ...btnPrimary, opacity: !fillAnswer.trim() ? .4 : 1 }}>
            Responder →
          </button>
        </div>
      )}

      {/* CAUSE EFFECT / COMPARISON / CASE_STUDY — textarea con área específica */}
      {(format === 'cause_effect' || format === 'comparison' || format === 'case_study' || format === 'harder_problem' || format === 'transfer_case' || format === 'inverse_teaching') && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ padding: '12px 16px', background: 'rgba(214,178,111,.1)', borderLeft: '3px solid #d6b26f', borderRadius: 6, marginBottom: 14, fontSize: 13, color: '#3a2e1f', lineHeight: 1.6 }}>
            💡 Escribe tu respuesta con la información del material
          </div>
          <textarea value={shortAnswer} onChange={e => onShortChange(e.target.value)}
            placeholder="Escribe tu respuesta aquí..." rows={4}
            style={{ width: '100%', padding: 14, borderRadius: 8, border: '2px solid rgba(58,46,31,.2)', background: 'rgba(255,255,255,.8)', fontSize: 14, fontFamily: 'Georgia, serif', color: '#3a2e1f', outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5, marginBottom: 12 }} />
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {['high', 'medium', 'low'].map(c => (
              <button key={c} onClick={() => onConfidenceChange(c)}
                style={{ flex: 1, padding: '7px', borderRadius: 6, border: confidence === c ? '2px solid #d6b26f' : '1.5px solid rgba(58,46,31,.15)', background: confidence === c ? 'rgba(214,178,111,.15)' : 'transparent', color: '#3a2e1f', fontFamily: 'Georgia, serif', fontSize: 11, cursor: 'pointer', fontWeight: confidence === c ? 700 : 400 }}>
                {c === 'high' ? '💪 Seguro' : c === 'medium' ? '🤔 Algo' : '😅 Poco'}
              </button>
            ))}
          </div>
          <button onClick={() => onSubmit()} disabled={!shortAnswer.trim()}
            style={{ ...btnPrimary, opacity: !shortAnswer.trim() ? .4 : 1 }}>
            Responder →
          </button>
        </div>
      )}

      {/* SHORT ANSWER */}
      {format === 'short_answer' && (
        <div style={{ marginBottom: 16 }}>
          <textarea value={shortAnswer} onChange={e => onShortChange(e.target.value)}
            placeholder="Escribe tu respuesta..." rows={4}
            style={{ width: '100%', padding: 14, borderRadius: 8, border: '2px solid rgba(58,46,31,.2)', background: 'rgba(255,255,255,.8)', fontSize: 14, fontFamily: 'Georgia, serif', color: '#3a2e1f', outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5 }} />
          <ConfidenceSelector />
          <button onClick={() => onSubmit()} disabled={!shortAnswer.trim()}
            style={{ ...btnPrimary, marginTop: 4, opacity: !shortAnswer.trim() ? .4 : 1 }}>
            Responder →
          </button>
        </div>
      )}

      {/* MATCHING — solo si tiene pairs válidos */}
      {format === 'matching' && interaction?.pairs && interaction.pairs.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <MatchingCanvas pairs={interaction.pairs} value={matchingAnswer || {}} onChange={onMatchingChange} locked={false} themeColor="#d6b26f" />
          <button onClick={() => onSubmit()}
            disabled={!matchingAnswer || Object.keys(matchingAnswer).length < (interaction.pairs?.length || 0)}
            style={{ ...btnPrimary, marginTop: 16, opacity: Object.keys(matchingAnswer || {}).length < (interaction.pairs?.length || 0) ? .4 : 1 }}>
            Verificar →
          </button>
        </div>
      )}

      {/* FALLBACK universal — se activa cuando ningún bloque específico va a renderizar */}
      {needsUniversalFallback && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ padding: '10px 14px', background: 'rgba(214,178,111,.1)', borderLeft: '3px solid #d6b26f', borderRadius: 6, marginBottom: 12, fontSize: 12, color: '#3a2e1f' }}>
            Escribe tu respuesta:
          </div>
          <textarea value={shortAnswer} onChange={e => onShortChange(e.target.value)}
            placeholder="Escribe aquí..." rows={4}
            style={{ width: '100%', padding: 14, borderRadius: 8, border: '2px solid rgba(58,46,31,.2)', background: 'rgba(255,255,255,.8)', fontSize: 14, fontFamily: 'Georgia, serif', color: '#3a2e1f', outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5, marginBottom: 12 }} />
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {['high', 'medium', 'low'].map(c => (
              <button key={c} onClick={() => onConfidenceChange(c)}
                style={{ flex: 1, padding: '7px', borderRadius: 6, border: confidence === c ? '2px solid #d6b26f' : '1.5px solid rgba(58,46,31,.15)', background: confidence === c ? 'rgba(214,178,111,.15)' : 'transparent', color: '#3a2e1f', fontFamily: 'Georgia, serif', fontSize: 11, cursor: 'pointer', fontWeight: confidence === c ? 700 : 400 }}>
                {c === 'high' ? '💪 Seguro' : c === 'medium' ? '🤔 Algo' : '😅 Poco'}
              </button>
            ))}
          </div>
          <button onClick={() => onSubmit()} disabled={!shortAnswer.trim()}
            style={{ ...btnPrimary, opacity: !shortAnswer.trim() ? .4 : 1 }}>
            Responder →
          </button>
        </div>
      )}

      {/* ABSOLUTE FALLBACK — si por alguna razón ningún bloque renderiza, garantizar respuesta */}
      {!hasSpecificRender && !needsUniversalFallback && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ padding: '10px 14px', background: 'rgba(139,26,26,.05)', borderLeft: '3px solid #8b1a1a', borderRadius: 6, marginBottom: 12, fontSize: 12, color: '#3a2e1f' }}>
            ⚠️ Formato de pregunta no reconocido. Responde con tus palabras:
          </div>
          <textarea value={shortAnswer} onChange={e => onShortChange(e.target.value)}
            placeholder="Escribe aquí..." rows={4}
            style={{ width: '100%', padding: 14, borderRadius: 8, border: '2px solid rgba(58,46,31,.2)', background: 'rgba(255,255,255,.8)', fontSize: 14, fontFamily: 'Georgia, serif', color: '#3a2e1f', outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5, marginBottom: 12 }} />
          <button onClick={() => onSubmit()} disabled={!shortAnswer.trim()}
            style={{ ...btnPrimary, opacity: !shortAnswer.trim() ? .4 : 1 }}>
            Responder →
          </button>
        </div>
      )}

      {/* ORDERING — solo si tiene items válidos */}
      {format === 'ordering' && interaction?.items && interaction.items.length > 0 && (
        <OrderingBlock
          items={interaction.items}
          value={orderAnswer}
          onChange={onOrderChange}
          onSubmit={onSubmit}
        />
      )}
    </div>
  )
}

// ── Ordering interactivo ─────────────────────────────────────────
function OrderingBlock({ items, value, onChange, onSubmit }: any) {
  const [order, setOrder] = useState<number[]>(() => items.map((_: any, i: number) => i))
  const [dragging, setDragging] = useState<number | null>(null)

  const moveItem = (from: number, to: number) => {
    const newOrder = [...order]
    const [removed] = newOrder.splice(from, 1)
    newOrder.splice(to, 0, removed)
    setOrder(newOrder)
    onChange(newOrder)
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: 'rgba(58,46,31,.5)', marginBottom: 12 }}>
        Arrastra o usa ↑↓ para ordenar
      </div>
      {order.map((itemIdx, position) => (
        <div key={itemIdx} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', marginBottom: 6,
          background: 'rgba(255,255,255,.5)', border: '1.5px solid rgba(58,46,31,.2)',
          borderRadius: 6, cursor: 'grab',
        }}>
          <span style={{ color: 'rgba(58,46,31,.4)', fontWeight: 700, minWidth: 20 }}>{position + 1}.</span>
          <span style={{ flex: 1, fontSize: 13, color: '#3a2e1f' }}>{items[itemIdx]}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button onClick={() => position > 0 && moveItem(position, position - 1)}
              disabled={position === 0}
              style={{ background: 'none', border: 'none', cursor: position === 0 ? 'default' : 'pointer', color: 'rgba(58,46,31,.4)', fontSize: 12, opacity: position === 0 ? .3 : 1 }}>▲</button>
            <button onClick={() => position < order.length - 1 && moveItem(position, position + 1)}
              disabled={position === order.length - 1}
              style={{ background: 'none', border: 'none', cursor: position === order.length - 1 ? 'default' : 'pointer', color: 'rgba(58,46,31,.4)', fontSize: 12, opacity: position === order.length - 1 ? .3 : 1 }}>▼</button>
          </div>
        </div>
      ))}
      <button onClick={() => onSubmit()} style={{ ...btnPrimary, marginTop: 8 }}>
        Confirmar orden →
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// FEEDBACK BLOCK
// ═══════════════════════════════════════════════════════════════
function FeedbackBlock({ evaluation, onContinue, isLastInteraction }: any) {
  if (!evaluation) return null

  const isGood = evaluation.correct || evaluation.score >= 70
  const isMedium = !evaluation.correct && evaluation.score >= 45

  // Mostrar qué conceptos identificó vs cuáles faltaron
  const identified = evaluation.conceptsIdentified || []
  const missing = evaluation.conceptsMissing || []

  return (
    <div>
      {/* Resultado */}
      <div style={{ padding: '14px 18px', borderRadius: 8, marginBottom: 14, background: isGood ? 'rgba(90,138,58,.1)' : 'rgba(139,26,26,.08)', borderLeft: `4px solid ${isGood ? '#5a8a3a' : '#8b1a1a'}` }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: isGood ? '#3a5a1e' : '#8b1a1a', marginBottom: 4, letterSpacing: 0.5 }}>
          {isGood ? '✓ CORRECTO' : isMedium ? '◎ CASI' : '✗ INCORRECTO'}
          {evaluation.falseConfidence && (
            <span style={{ marginLeft: 10, fontSize: 10, color: '#f97316' }}>⚠️ Tenías alta confianza pero estaba incorrecto</span>
          )}
        </div>
        {evaluation.score !== undefined && (
          <div style={{ fontSize: 11, color: 'rgba(58,46,31,.5)' }}>{evaluation.score}/100</div>
        )}
      </div>

      {/* Qué identificó vs qué faltó */}
      {(identified.length > 0 || missing.length > 0) && (
        <div style={{ marginBottom: 12 }}>
          {identified.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {identified.map((c: string) => (
                <div key={c} style={{ fontSize: 12, color: '#3a5a1e', display: 'flex', gap: 6, marginBottom: 3 }}>
                  <span>✓</span><span>{c}</span>
                </div>
              ))}
            </div>
          )}
          {missing.length > 0 && (
            <div>
              <div style={{ fontSize: 9, letterSpacing: 1.5, color: '#8b1a1a', fontWeight: 700, marginBottom: 4 }}>NO ENCONTRÉ</div>
              {missing.map((c: string) => (
                <div key={c} style={{ fontSize: 12, color: '#8b1a1a', display: 'flex', gap: 6, marginBottom: 3 }}>
                  <span>✗</span><span>{c}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Qué faltó */}
      {evaluation.whatWasMissing && !isGood && (
        <div style={{ padding: '12px 16px', background: 'rgba(139,26,26,.05)', borderLeft: '3px solid #8b1a1a', borderRadius: 6, marginBottom: 12, fontSize: 13, color: '#3a2e1f', lineHeight: 1.6 }}>
          <div style={{ fontSize: 9, letterSpacing: 1.5, color: '#8b1a1a', fontWeight: 800, marginBottom: 4 }}>LO QUE FALTÓ</div>
          {evaluation.whatWasMissing}
        </div>
      )}

      {/* Explicación correcta */}
      {evaluation.correctExplanation && (
        <div style={{ padding: '12px 16px', background: 'rgba(214,178,111,.1)', borderLeft: '3px solid #d6b26f', borderRadius: 6, marginBottom: 20, fontSize: 13, color: '#3a2e1f', lineHeight: 1.6 }}>
          <div style={{ fontSize: 9, letterSpacing: 1.5, color: '#a8854a', fontWeight: 800, marginBottom: 4 }}>✦ LA EXPLICACIÓN CORRECTA</div>
          {evaluation.correctExplanation}
        </div>
      )}

      <button onClick={onContinue} style={btnPrimary}>
        {isLastInteraction ? 'Cerrar sesión →' : isGood ? 'Continuar →' : 'Entendido, seguimos →'}
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// RECALL BLOCK
// ═══════════════════════════════════════════════════════════════
function RecallBlock({ interaction, text, loading, confidence, onTextChange, onConfidenceChange, onSubmit }: any) {
  return (
    <div>
      <div style={{ padding: '14px 18px', background: 'rgba(58,46,31,.06)', borderLeft: '3px solid #d6b26f', borderRadius: 6, marginBottom: 18, fontSize: 14, lineHeight: 1.6, color: '#3a2e1f', fontWeight: 500 }}>
        {interaction?.question || interaction?.prompt || `Explica "${interaction?.concept}" con tus propias palabras.`}
      </div>
      <textarea value={text} onChange={e => onTextChange(e.target.value)}
        placeholder="Escribe aquí tu respuesta..." rows={5}
        style={{ width: '100%', padding: 14, borderRadius: 6, border: '1.5px solid rgba(58,46,31,.25)', background: 'rgba(255,255,255,.6)', fontSize: 14, fontFamily: 'Georgia, serif', lineHeight: 1.6, resize: 'vertical', outline: 'none', marginBottom: 14, color: '#3a2e1f', boxSizing: 'border-box' }} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {['high', 'medium', 'low'].map(c => (
          <button key={c} onClick={() => onConfidenceChange(c)}
            style={{ flex: 1, padding: '7px', borderRadius: 6, border: confidence === c ? '2px solid #d6b26f' : '1.5px solid rgba(58,46,31,.15)', background: confidence === c ? 'rgba(214,178,111,.15)' : 'transparent', color: '#3a2e1f', fontFamily: 'Georgia, serif', fontSize: 11, cursor: 'pointer', fontWeight: confidence === c ? 700 : 400 }}>
            {c === 'high' ? '💪 Seguro' : c === 'medium' ? '🤔 Algo' : '😅 Poco'}
          </button>
        ))}
      </div>
      <button onClick={() => onSubmit()} disabled={!text.trim() || loading}
        style={{ ...btnPrimary, opacity: !text.trim() || loading ? .4 : 1 }}>
        {loading ? 'Evaluando...' : 'Enviar →'}
      </button>
    </div>
  )
}

// ── Estilos ──────────────────────────────────────────────────────
const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 100,
  background: 'radial-gradient(ellipse at center, #1a1410 0%, #0a0806 100%)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  padding: 24, overflow: 'auto', fontFamily: 'Georgia, serif',
}

const cardStyle: React.CSSProperties = {
  width: '100%', maxWidth: 720, minHeight: 440,
  background: 'linear-gradient(135deg, #f5ecd5 0%, #e8d9b0 100%)',
  borderRadius: 8, padding: '36px 48px',
  fontFamily: 'Georgia, serif', color: '#3a2e1f',
  boxShadow: '0 30px 80px rgba(0,0,0,.7)',
}

const btnPrimary: React.CSSProperties = {
  padding: '12px 28px', background: '#3a2e1f', color: '#f5ecd5',
  border: 'none', borderRadius: 6, fontFamily: 'Georgia, serif',
  fontSize: 13, fontWeight: 700, cursor: 'pointer',
}

const btnGold: React.CSSProperties = {
  padding: '12px 24px', borderRadius: 8, border: '1.5px solid #d4a544',
  background: '#d4a544', color: '#1a1410', fontFamily: 'Georgia, serif',
  fontSize: 14, fontWeight: 700, cursor: 'pointer',
}

const btnOutline: React.CSSProperties = {
  padding: '12px 24px', borderRadius: 8, border: '1.5px solid #a8854a',
  background: 'transparent', color: '#a8854a', fontFamily: 'Georgia, serif',
  fontSize: 14, fontWeight: 700, cursor: 'pointer',
}
