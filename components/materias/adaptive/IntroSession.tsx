'use client'

import { useState, useEffect } from 'react'

interface Props {
  materialTitle: string
  materialText: string
  topicsFound?: string[]
  isReady: boolean
  onReady: () => void
  planSummary?: {
    microCount: number
    sessionCount: number
    estimatedMinutes: number
    examAt?: string
    planType: 'rescate' | 'intensivo' | 'normal' | 'profundo'
    feasibilityMessage?: string
    rationale?: string
  }
}

export default function IntroSession({
  materialTitle,
  materialText,
  topicsFound = [],
  isReady,
  onReady,
  planSummary,
}: Props) {
  const [step, setStep] = useState(0)
  const [statusText, setStatusText] = useState('Preparando...')

  useEffect(() => {
    if (isReady) {
      setStatusText('¡Todo listo!')
      return
    }
    const msgs = [
      'Leyendo tu material...',
      'Identificando conceptos clave...',
      'Creando preguntas personalizadas...',
      'Organizando las sesiones...',
      'Finalizando...',
    ]
    let i = 0
    const interval = setInterval(() => {
      i++
      if (i < msgs.length) setStatusText(msgs[i])
    }, 6000)
    return () => clearInterval(interval)
  }, [isReady])

  const cleanTitle = materialTitle.replace(/\.pdf$/i, '').replace(/\.docx$/i, '').replace(/\.pptx?$/i, '')
  const wordCount = materialText.split(/\s+/).length
  const urgency = planSummary?.examAt ? new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(planSummary.examAt)) : 'sin fecha límite'

  const steps = [
    // Paso 1: Bienvenida
    {
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, padding: '20px 0' }}>
          <div style={{ fontSize: 64 }}>📖</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#f5ecd5', lineHeight: 1.3, textAlign: 'center' }}>
            Tu plan {planSummary?.planType || 'personalizado'} para {planSummary?.planType === 'intensivo' ? 'mañana' : cleanTitle}
          </div>
          <div style={{ fontSize: 14, color: 'rgba(214,178,111,.6)', letterSpacing: 1 }}>
            {planSummary ? `${planSummary.microCount} conceptos · ${planSummary.sessionCount} sesiones · ${Math.ceil(planSummary.estimatedMinutes / 60)} h estimadas` : `${wordCount} palabras`}
          </div>
          <div style={{
            fontSize: 16, color: 'rgba(245,236,213,.7)', lineHeight: 1.7,
            textAlign: 'center', maxWidth: 400,
          }}>
            Material detectado: <strong data-testid="intro-material-title">{cleanTitle}</strong><br />Examen: {urgency}. {planSummary?.planType === 'intensivo' ? 'Puedes completar todas las sesiones hoy.' : 'El calendario recomienda un ritmo, pero nunca limita cuánto puedes avanzar.'}
          </div>
        </div>
      ),
    },
    // Paso 2: Cómo funciona
    {
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#f5ecd5', textAlign: 'center' }}>
            Por qué el plan está ordenado así
          </div>
          {[
            { emoji: '🌱', title: 'Fundamentos primero', desc: planSummary?.rationale || 'Empezamos por prerrequisitos y construimos hacia las ideas más exigentes.' },
            { emoji: '🧠', title: 'Evidencia progresiva', desc: 'Reconocerás, distinguirás, recuperarás y aplicarás; un acierto obvio no equivale a dominio.' },
            { emoji: '💡', title: 'Feedback antes de avanzar', desc: 'Cada respuesta se corrige y las dificultades cambian la siguiente estrategia.' },
            { emoji: '⏱️', title: 'Tu tiempo es una preferencia', desc: 'Puedes adelantar sesiones y estudiar más de lo previsto sin bloqueos.' },
            { emoji: '✅', title: 'Cierre contractual', desc: 'El programa termina únicamente cuando el motor confirma cobertura y dominio requeridos.' },
          ].map((item, i) => (
            <div key={i} style={{
              display: 'flex', gap: 16, alignItems: 'center',
              padding: '14px 18px',
              background: 'rgba(214,178,111,.05)',
              border: '1px solid rgba(214,178,111,.1)',
              borderRadius: 10,
            }}>
              <span style={{ fontSize: 26, flexShrink: 0 }}>{item.emoji}</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#f5ecd5', marginBottom: 3 }}>
                  {item.title}
                </div>
                <div style={{ fontSize: 13, color: 'rgba(245,236,213,.55)', lineHeight: 1.5 }}>
                  {item.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      ),
    },
    // Paso 3: Topics + estado
    {
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#f5ecd5', textAlign: 'center' }}>
            {topicsFound.length > 0 ? 'Lo que vas a dominar' : statusText}
          </div>

          {topicsFound.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {topicsFound.map((topic, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 18px',
                  background: 'rgba(214,178,111,.06)',
                  border: '1px solid rgba(214,178,111,.15)',
                  borderRadius: 10,
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: 'rgba(214,178,111,.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 800, color: '#d6b26f', flexShrink: 0,
                  }}>
                    {i + 1}
                  </div>
                  <span style={{ fontSize: 15, color: '#f5ecd5' }}>{topic}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{
              padding: '40px 20px', textAlign: 'center',
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                border: '3px solid rgba(214,178,111,.3)',
                borderTopColor: '#d6b26f',
                margin: '0 auto 16px',
                animation: 'introSpin 1s linear infinite',
              }} />
              <div style={{
                fontSize: 14, color: 'rgba(245,236,213,.5)', fontStyle: 'italic',
              }}>
                {statusText}
              </div>
            </div>
          )}

          {isReady && (
            <div style={{
              padding: '16px 20px', textAlign: 'center',
              background: 'rgba(74,222,128,.1)',
              border: '1px solid rgba(74,222,128,.3)',
              borderRadius: 12,
              fontSize: 16, fontWeight: 800, color: '#4ade80',
            }}>
              ✅ Tu programa está listo
            </div>
          )}
          {planSummary?.feasibilityMessage && <div data-testid="intro-feasibility" style={{ padding: '12px 16px', border: '1px solid rgba(214,178,111,.25)', borderRadius: 10, color: '#d6b26f' }}>{planSummary.feasibilityMessage}</div>}
        </div>
      ),
    },
  ]

  return (
    <div data-testid="intro-session" style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'radial-gradient(ellipse at center, #1a1410 0%, #0a0806 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 24, fontFamily: 'Georgia, serif',
    }}>
      <style>{`@keyframes introSpin { to { transform: rotate(360deg) } }`}</style>

      <div style={{
        width: '100%', maxWidth: 620,
        display: 'flex', flexDirection: 'column', gap: 24,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 11, fontWeight: 800, letterSpacing: 2,
          color: 'rgba(214,178,111,.4)',
        }}>
          <span>SESIÓN INTRODUCTORIA</span>
          <span>{step + 1} / {steps.length}</span>
        </div>

        {/* Contenido */}
        <div style={{
          background: 'rgba(214,178,111,.03)',
          border: '1px solid rgba(214,178,111,.1)',
          borderRadius: 16, padding: '32px 36px',
          minHeight: 380,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
          {steps[step].content}
        </div>

        {/* Navegación */}
        <div style={{ display: 'flex', gap: 12 }}>
          {step > 0 && (
            <button
              onClick={() => setStep(s => s - 1)}
              style={{
                padding: '16px 24px', borderRadius: 12,
                border: '1px solid rgba(214,178,111,.2)',
                background: 'transparent', color: 'rgba(214,178,111,.7)',
                fontFamily: 'Georgia, serif', fontSize: 15,
                fontWeight: 700, cursor: 'pointer', flex: 1,
              }}
            >
              ← Anterior
            </button>
          )}
          <button
            data-testid={step === steps.length - 1 ? 'intro-enter-program' : 'intro-next'}
            onClick={() => {
              if (step < steps.length - 1) setStep(s => s + 1)
              else if (isReady) onReady()
            }}
            disabled={step === steps.length - 1 && !isReady}
            style={{
              padding: '16px 28px', borderRadius: 12,
              border: 'none', flex: step > 0 ? 1 : undefined, width: step > 0 ? undefined : '100%',
              background: step === steps.length - 1 && isReady
                ? 'linear-gradient(135deg, #4ade80, #22c55e)'
                : step === steps.length - 1
                ? 'rgba(214,178,111,.1)'
                : 'linear-gradient(135deg, #d6b26f, #a8854a)',
              color: step === steps.length - 1 && isReady
                ? '#0a2e14'
                : step === steps.length - 1
                ? 'rgba(214,178,111,.4)'
                : '#1a130d',
              fontFamily: 'Georgia, serif', fontSize: 16,
              fontWeight: 800,
              cursor: step === steps.length - 1 && !isReady ? 'wait' : 'pointer',
              boxShadow: step === steps.length - 1 && isReady ? '0 6px 24px rgba(74,222,128,.3)' : 'none',
              transition: 'all 0.3s ease',
            }}
          >
            {step === steps.length - 1
              ? isReady ? '¡Comenzar a estudiar! →' : statusText
              : 'Siguiente →'}
          </button>
        </div>
      </div>
    </div>
  )
}
