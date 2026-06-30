'use client'

import { useState } from 'react'
import type { AdaptiveProgramSetup } from '../../../lib/adaptive'
import { getExamDateLabel } from '../../../lib/adaptive'

interface Props {
  onComplete: (setup: AdaptiveProgramSetup) => void | Promise<void>
  onCancel: () => void
}

type Step = 1 | 2 | 3

const KNOWLEDGE_OPTIONS = [
  {
    key: 'zero' as const,
    title: 'Nunca lo he visto',
    desc: 'Es un tema completamente nuevo para mí.',
    emoji: '🌱',
  },
  {
    key: 'some' as const,
    title: 'Lo conozco un poco',
    desc: 'He visto algo pero no lo tengo claro.',
    emoji: '📖',
  },
  {
    key: 'review' as const,
    title: 'Quiero repasarlo',
    desc: 'Ya lo estudié antes y necesito refrescarlo.',
    emoji: '🔄',
  },
  {
    key: 'practice' as const,
    title: 'Ya lo domino, quiero practicar',
    desc: 'Me sé el tema, solo quiero consolidarlo.',
    emoji: '🎯',
  },
]

const EXAM_DATE_OPTIONS = [
  { key: 'today', label: 'Hoy', sub: 'Modo rescate' },
  { key: 'tomorrow', label: 'Mañana', sub: 'Intensivo' },
  { key: 'in_3_days', label: 'En 3 días', sub: 'Rápido' },
  { key: 'in_1_week', label: 'En 1 semana', sub: 'Normal' },
  { key: 'in_2_weeks', label: 'En 2 semanas', sub: 'Completo' },
  { key: 'in_1_month', label: 'En 1 mes', sub: 'Profundo' },
  { key: 'no_exam', label: 'Sin examen', sub: 'Solo estudiar' },
]

const DAILY_OPTIONS = [
  { value: 15, label: '15 min', sub: 'Muy poco tiempo' },
  { value: 30, label: '30 min', sub: 'Sesión corta' },
  { value: 45, label: '45 min', sub: 'Sesión normal' },
  { value: 60, label: '1 hora', sub: 'Sesión completa' },
  { value: 90, label: '90 min', sub: 'Sesión larga' },
]

export default function AdaptiveProgramSetup({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>(1)
  const [knowledgeLevel, setKnowledgeLevel] = useState<AdaptiveProgramSetup['initialKnowledgeLevel'] | null>(null)
  const [examDate, setExamDate] = useState<string | null>(null)
  const [targetScore, setTargetScore] = useState(80)
  // dailyMinutes ya no se pregunta — default interno
  const dailyMinutes = 45
  
  const canContinue =
    (step === 1 && knowledgeLevel !== null) ||
    (step === 2 && examDate !== null) ||
    step === 3

  const handleContinue = () => {
    if (step < 3) {
      setStep((prev) => (prev + 1) as Step)
      return
    }

    // Paso final → enviar setup y cerrar (la generación pasa después)
    if (!knowledgeLevel || !examDate) return
    onComplete({
      initialKnowledgeLevel: knowledgeLevel,
      targetScore,
      examDate,
      dailyMinutes,
    })
  }

  const scoreLabel =
    targetScore >= 95 ? 'Perfecto' :
    targetScore >= 85 ? 'Sobresaliente' :
    targetScore >= 75 ? 'Notable' :
    targetScore >= 65 ? 'Bien' : 'Aprobar'

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-faint)', letterSpacing: 1, marginBottom: 8 }}>
            PROGRAMA ADAPTATIVO · PASO {step} DE 3
          </div>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${(step / 3) * 100}%` }} />
          </div>
        </div>

        {/* PASO 1 — Nivel de conocimiento */}
        {step === 1 && (
          <div>
            <div style={styles.stepTitle}>
              ¿Qué tanto sabes de este tema?
            </div>
            <div style={styles.stepSub}>
              ALAI ajustará el punto de partida según tu respuesta.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
              {KNOWLEDGE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setKnowledgeLevel(opt.key)}
                  style={{
                    ...styles.optionBtn,
                    borderColor: knowledgeLevel === opt.key ? 'var(--gold)' : 'var(--border-color2)',
                    background: knowledgeLevel === opt.key
                      ? 'color-mix(in srgb, var(--gold) 10%, transparent)'
                      : 'transparent',
                  }}
                >
                  <span style={{ fontSize: 22 }}>{opt.emoji}</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{
                      fontSize: 14,
                      fontWeight: 900,
                      color: knowledgeLevel === opt.key ? 'var(--gold)' : 'var(--text-primary)',
                    }}>
                      {opt.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
                      {opt.desc}
                    </div>
                  </div>
                  {knowledgeLevel === opt.key && (
                    <span style={{ marginLeft: 'auto', color: 'var(--gold)', fontSize: 18 }}>✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* PASO 2 — Fecha de examen */}
        {step === 2 && (
          <div>
            <div style={styles.stepTitle}>
              ¿Cuándo es tu examen?
            </div>
            <div style={styles.stepSub}>
              Esto determina cuántas sesiones tendrá tu programa y su intensidad.
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
              marginTop: 20,
            }}>
              {EXAM_DATE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setExamDate(opt.key)}
                  style={{
                    ...styles.optionBtnSmall,
                    borderColor: examDate === opt.key ? 'var(--gold)' : 'var(--border-color2)',
                    background: examDate === opt.key
                      ? 'color-mix(in srgb, var(--gold) 10%, transparent)'
                      : 'transparent',
                  }}
                >
                  <div style={{
                    fontSize: 14,
                    fontWeight: 900,
                    color: examDate === opt.key ? 'var(--gold)' : 'var(--text-primary)',
                  }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                    {opt.sub}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* PASO 3 — Nota objetivo */}
        {step === 3 && (
          <div>
            <div style={styles.stepTitle}>
              ¿Qué nota quieres sacar?
            </div>
            <div style={styles.stepSub}>
              ALAI calibrará la profundidad del programa a este objetivo.
            </div>
            <div style={{
              marginTop: 28,
              padding: '24px 20px',
              borderRadius: 14,
              border: '1.5px solid var(--border-color2)',
              background: 'rgba(255,255,255,0.02)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 56, fontWeight: 900, color: 'var(--gold)', lineHeight: 1 }}>
                {targetScore}
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-secondary)', marginTop: 4 }}>
                {scoreLabel}
              </div>
              <input
                type="range"
                min={60}
                max={100}
                step={5}
                value={targetScore}
                onChange={(e) => setTargetScore(Number(e.target.value))}
                style={{ width: '100%', marginTop: 20, accentColor: '#d6b26f' }}
              />
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 11,
                color: 'var(--text-faint)',
                marginTop: 8,
              }}>
                <span>60 · Aprobar</span>
                <span>80 · Notable</span>
                <span>100 · Perfecto</span>
              </div>
            </div>
          </div>
        )}

        {/* PASO 4 eliminado — ALAI decide cuánto necesita cada sesión */}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28, gap: 12 }}>
          <button
            onClick={step === 1 ? onCancel : () => setStep((prev) => (prev - 1) as Step)}
            style={styles.btnSecondary}
          >
            {step === 1 ? 'Cancelar' : '← Atrás'}
          </button>
          <button
            onClick={handleContinue}
            disabled={!canContinue}
            style={{
              ...styles.btnPrimary,
              opacity: canContinue ? 1 : 0.4,
              cursor: canContinue ? 'pointer' : 'not-allowed',
            }}
          >
            Siguiente →
          </button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    zIndex: 999,
    background: 'rgba(0,0,0,0.80)',
    backdropFilter: 'blur(10px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: 'min(520px, 100%)',
    background: 'var(--bg-card)',
    border: '2px solid var(--gold)',
    borderRadius: 20,
    boxShadow: '0 32px 80px rgba(0,0,0,.5)',
    padding: 28,
    maxHeight: '90vh',
    overflowY: 'auto' as const,
  },
  stepTitle: {
    fontSize: 22,
    fontWeight: 900,
    color: 'var(--text-primary)',
    lineHeight: 1.2,
    marginBottom: 8,
  },
  stepSub: {
    fontSize: 13,
    color: 'var(--text-muted)',
    lineHeight: 1.5,
  },
  progressBar: {
    height: 4,
    borderRadius: 999,
    background: 'var(--border-color2)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: 'var(--gold)',
    borderRadius: 999,
    transition: 'width 0.3s ease',
  },
  optionBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 16px',
    borderRadius: 14,
    border: '2px solid',
    cursor: 'pointer',
    textAlign: 'left' as const,
    transition: 'all 0.15s ease',
  },
  optionBtnSmall: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-start',
    padding: '12px 14px',
    borderRadius: 12,
    border: '2px solid',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  optionBtnRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '12px 16px',
    borderRadius: 12,
    border: '2px solid',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  btnPrimary: {
    padding: '12px 22px',
    borderRadius: 12,
    border: '2px solid var(--gold)',
    background: 'var(--gold)',
    color: '#111',
    fontWeight: 900,
    fontSize: 14,
    transition: 'all 0.15s ease',
  },
  btnSecondary: {
    padding: '12px 18px',
    borderRadius: 12,
    border: '1.5px solid var(--border-color2)',
    background: 'transparent',
    color: 'var(--text-faint)',
    fontWeight: 800,
    fontSize: 13,
    cursor: 'pointer',
  },
  loader: {
    marginTop: 28,
    height: 4,
    borderRadius: 999,
    background: 'var(--border-color2)',
    overflow: 'hidden',
  },
  loaderBar: {
    height: '100%',
    width: '40%',
    background: 'var(--gold)',
    borderRadius: 999,
    animation: 'loaderSlide 1.2s ease infinite',
  },
}
