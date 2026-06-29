'use client'

import { useState, useEffect } from 'react'
import type { AdaptiveSession } from '../../../../lib/adaptive'
import { buildAdaptiveContext, serializeAdaptiveContext } from '../../../../lib/adaptive/adaptiveContext'
import { useDiagnosticSession } from '../../../../hooks/useDiagnosticSession'

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

export default function DiagnosticSessionRunner({
  session,
  materialContent,
  masteryContext,
  onSessionComplete,
  onClose,
}: Props) {
  const [userInput, setUserInput] = useState('')
  const [evaluating, setEvaluating] = useState(false)

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
      name: n, definition: '', importance: 'major' as const, difficulty: 50, practiceType: 'recall' as const,
    })),
    difficulty: 50,
    importance: 70,
  }

  const ds = useDiagnosticSession({
    adaptiveContext: adaptiveCtx,
    topic,
    materialSlice: adaptiveCtx.materialSlice,
    totalStagesPlanned: 7,
  })

  // Cargar primera micro-acción al montar
  useEffect(() => {
    ds.nextMicroAction()
  }, [])

  // Cuando se completa la sesión
  useEffect(() => {
    if (ds.isSessionComplete && !ds.loading) {
      const result = {
        domainGain: Math.round((ds.sessionSummary.avgScore / 100) * (session.expectedDomainGain || 10)),
        conceptsImproved: ds.sessionSummary.conceptsImproved,
        stepResults: [{ stepId: session.steps[0]?.id || '0', score: ds.sessionSummary.avgScore, correct: ds.sessionSummary.avgScore >= 60 }],
      }
      setTimeout(() => onSessionComplete(result), 1500)
    }
  }, [ds.isSessionComplete, ds.loading])

  const handleSubmitAnswer = async () => {
    if (!userInput.trim() || !ds.microAction?.questionToAsk) return

    setEvaluating(true)

    // Evaluar respuesta con el chat
    let score = 60
    try {
      const res = await fetch('/api/adaptive/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...serializeAdaptiveContext(adaptiveCtx),
          message: userInput,
          context: `El estudiante respondió a "${ds.microAction.questionToAsk}". Concepto evaluado: ${ds.microAction.conceptBeingTested || 'general'}. Evalúa de 0-100.`,
          evaluateOnly: true,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const num = parseInt(String(data.message).match(/\d+/)?.[0] || '60')
        score = isNaN(num) ? 60 : Math.min(100, Math.max(0, num))
      }
    } catch {}

    // Pedir siguiente micro-acción con esta respuesta
    await ds.nextMicroAction({
      questionAsked: ds.microAction.questionToAsk,
      answerGiven: userInput,
      score,
      conceptTested: ds.microAction.conceptBeingTested,
    })

    setUserInput('')
    setEvaluating(false)
  }

  const handleContinue = async () => {
    setUserInput('')
    await ds.nextMicroAction()
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
        boxShadow: '0 30px 80px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(58,46,31,0.08)',
        overflow: 'hidden',
      }}>
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
        }}>
          <span style={{ display: 'inline-block', width: 24, height: 1, background: 'rgba(58,46,31,0.4)' }} />
          THE STUDYAL PROCESS
          <span style={{ opacity: 0.5 }}>·</span>
          <span>SESIÓN {String(session.sessionNumber).padStart(2, '0')}</span>
        </div>

        {/* Título */}
        <div style={{
          fontSize: 28,
          fontWeight: 700,
          lineHeight: 1.2,
          marginBottom: 8,
          color: '#1f1610',
        }}>
          {session.topicTitle || session.title}
        </div>

        {/* Hipótesis actual (visible al estudiante como cita pequeña) */}
        {ds.hypothesis && (
          <div style={{
            fontSize: 11,
            color: 'rgba(168,133,74,0.9)',
            fontStyle: 'italic',
            marginBottom: 24,
            paddingLeft: 12,
            borderLeft: '2px solid rgba(168,133,74,0.4)',
            lineHeight: 1.5,
          }}>
            ALAI cree: "{ds.hypothesis.belief}"
            <br />
            <span style={{ fontSize: 9, opacity: 0.7 }}>
              confianza {ds.hypothesis.confidence}% · {ds.hypothesis.status}
            </span>
          </div>
        )}

        {/* Loading */}
        {ds.loading && (
          <div style={{
            textAlign: 'center',
            padding: '60px 0',
            color: 'rgba(58,46,31,0.5)',
            fontStyle: 'italic',
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✦</div>
            ALAI está pensando...
          </div>
        )}

        {/* Micro-acción actual */}
        {!ds.loading && ds.microAction && (
          <div style={{ animation: 'fadeIn 0.4s ease-out' }}>
            <style>{`
              @keyframes fadeIn {
                0% { opacity: 0; transform: translateY(10px); }
                100% { opacity: 1; transform: translateY(0); }
              }
            `}</style>

            {/* "Lo que ALAI piensa" */}
            {ds.microAction.thought && (
              <div style={{
                fontSize: 12,
                color: 'rgba(168,133,74,0.85)',
                fontStyle: 'italic',
                marginBottom: 18,
                padding: '10px 14px',
                background: 'rgba(214,178,111,0.08)',
                borderRadius: 6,
                borderLeft: '2px solid #a8854a',
                lineHeight: 1.5,
              }}>
                <span style={{
                  fontSize: 9,
                  letterSpacing: 1.5,
                  color: '#a8854a',
                  fontWeight: 700,
                  fontStyle: 'normal',
                  display: 'block',
                  marginBottom: 4,
                }}>
                  ALAI PENSANDO
                </span>
                "{ds.microAction.thought}"
              </div>
            )}

            {/* Contenido principal */}
            <div style={{
              fontSize: 15,
              lineHeight: 1.75,
              color: '#3a2e1f',
              marginBottom: 24,
              whiteSpace: 'pre-wrap',
            }}>
              {ds.microAction.content}
            </div>

            {/* Si espera respuesta */}
            {ds.microAction.expectAnswer && ds.microAction.questionToAsk && (
              <>
                <div style={{
                  fontSize: 16,
                  fontWeight: 600,
                  marginBottom: 14,
                  color: '#1f1610',
                  lineHeight: 1.5,
                }}>
                  {ds.microAction.questionToAsk}
                </div>
                <textarea
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  placeholder="Tu respuesta..."
                  rows={5}
                  disabled={evaluating}
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
                <button
                  onClick={handleSubmitAnswer}
                  disabled={!userInput.trim() || evaluating}
                  style={{
                    padding: '12px 24px',
                    background: '#3a2e1f',
                    color: '#f5ecd5',
                    border: 'none',
                    borderRadius: 6,
                    fontFamily: 'Georgia, serif',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: userInput.trim() ? 'pointer' : 'not-allowed',
                    opacity: userInput.trim() && !evaluating ? 1 : 0.4,
                  }}
                >
                  {evaluating ? 'Evaluando...' : 'Enviar respuesta →'}
                </button>
              </>
            )}

            {/* Si NO espera respuesta */}
            {!ds.microAction.expectAnswer && (
              <button
                onClick={handleContinue}
                style={{
                  padding: '12px 24px',
                  background: '#3a2e1f',
                  color: '#f5ecd5',
                  border: 'none',
                  borderRadius: 6,
                  fontFamily: 'Georgia, serif',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Continuar →
              </button>
            )}
          </div>
        )}

        {/* Diagnóstico */}
        {ds.diagnosis && (
          <div style={{
            marginTop: 24,
            padding: '10px 14px',
            background: 'rgba(90,138,58,0.08)',
            borderLeft: '2px solid rgba(90,138,58,0.4)',
            borderRadius: 4,
            fontSize: 11,
            color: '#3a5a1e',
            fontStyle: 'italic',
          }}>
            <strong style={{ fontStyle: 'normal' }}>Diagnóstico:</strong> {ds.diagnosis}
          </div>
        )}

        {/* Progreso */}
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
          <span>Etapa {ds.stagesCompleted} · {ds.currentAction?.type?.replace('_', ' ') || '—'}</span>
          <span>{session.sessionNumber}</span>
        </div>
      </div>
    </div>
  )
}
