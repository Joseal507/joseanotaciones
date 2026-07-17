'use client'

import { useState } from 'react'
import type { AdaptiveProgramSetup, SessionLength } from '../../../lib/adaptive'
import { getExamDateLabel } from '../../../lib/adaptive'

interface Props {
  onComplete: (setup: AdaptiveProgramSetup) => void | Promise<void>
  onCancel: () => void
}

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

const KNOWLEDGE_OPTIONS = [
  { key: 'zero' as const, title: 'Nunca lo he visto', desc: 'Es un tema completamente nuevo para mí.', emoji: '🌱' },
  { key: 'some' as const, title: 'Lo conozco un poco', desc: 'He visto algo pero no lo tengo claro.', emoji: '📖' },
  { key: 'review' as const, title: 'Quiero repasarlo', desc: 'Ya lo estudié antes y necesito refrescarlo.', emoji: '🔄' },
  { key: 'practice' as const, title: 'Ya lo domino, quiero practicar', desc: 'Me sé el tema, solo quiero consolidarlo.', emoji: '🎯' },
]

const SESSION_LENGTH_OPTIONS: { key: SessionLength; title: string; desc: string; emoji: string; sub: string }[] = [
  {
    key: 'short',
    title: 'Cortas',
    desc: 'Explicaciones concisas, más sesiones',
    emoji: '⚡',
    sub: '~12 min · ritmo ágil',
  },
  {
    key: 'medium',
    title: 'Medias',
    desc: 'Balance entre explicación y práctica',
    emoji: '⚖️',
    sub: '~22 min · ritmo equilibrado',
  },
  {
    key: 'long',
    title: 'Largas',
    desc: 'Profundas, menos cambios entre sesiones',
    emoji: '🌊',
    sub: '~35 min · profundidad máxima',
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

export default function AdaptiveProgramSetupComponent({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>(1)
  const [knowledgeLevel, setKnowledgeLevel] = useState<AdaptiveProgramSetup['initialKnowledgeLevel'] | null>(null)
  const [sessionLength, setSessionLength] = useState<SessionLength | null>(null)
  const [examDate, setExamDate] = useState<string | null>(null)
  const [targetScore, setTargetScore] = useState(80)
  const [dailyMinutes, setDailyMinutes] = useState(45)
  const [examDateTime, setExamDateTime] = useState('')
  const [examFormat, setExamFormat] = useState<NonNullable<AdaptiveProgramSetup['examFormat']>>('unknown')
  const [availableDays, setAvailableDays] = useState([0, 1, 2, 3, 4, 5, 6])
  const [prioritiesText, setPrioritiesText] = useState('')
  const exactExamIsFuture = !examDateTime || new Date(examDateTime).getTime() > Date.now()

  const [evalPreference, setEvalPreference] = useState<'quick_test' | 'write_explain' | 'mix_everything' | null>(null)

  const canContinue =
    (step === 1 && knowledgeLevel !== null) ||
    (step === 2 && sessionLength !== null) ||
    (step === 3 && examDate !== null && exactExamIsFuture) ||
    (step === 4) ||
    (step === 5 && evalPreference !== null) ||
    (step === 6 && examFormat !== null) ||
    (step === 7 && dailyMinutes > 0 && availableDays.length > 0) ||
    step === 8

  const handleContinue = () => {
    if (step < 8) {
      setStep((prev) => (prev + 1) as Step)
      return
    }
    if (!knowledgeLevel || !sessionLength || !examDate) return
    onComplete({
      initialKnowledgeLevel: knowledgeLevel,
      sessionLength,
      targetScore,
      examDate,
      dailyMinutes,
      evalPreference: evalPreference || 'mix_everything',
      examDateTime: examDateTime && exactExamIsFuture ? new Date(examDateTime).toISOString() : undefined,
      examFormat,
      availability: { dailyMinutes, availableDays },
      priorities: prioritiesText.split(',').map(value => value.trim()).filter(Boolean),
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
            PROGRAMA ADAPTATIVO · PASO {step} DE 8
          </div>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${(step / 8) * 100}%` }} />
          </div>
        </div>

        {/* PASO 1 — Nivel de conocimiento */}
        {step === 1 && (
          <div>
            <div style={styles.stepTitle}>¿Qué tanto sabes de este tema?</div>
            <div style={styles.stepSub}>ALAI ajustará el punto de partida según tu respuesta.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
              {KNOWLEDGE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setKnowledgeLevel(opt.key)}
                  style={{
                    ...styles.optionBtn,
                    borderColor: knowledgeLevel === opt.key ? 'var(--gold)' : 'var(--border-color2)',
                    background: knowledgeLevel === opt.key ? 'color-mix(in srgb, var(--gold) 10%, transparent)' : 'transparent',
                  }}
                >
                  <span style={{ fontSize: 22 }}>{opt.emoji}</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: knowledgeLevel === opt.key ? 'var(--gold)' : 'var(--text-primary)' }}>
                      {opt.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>{opt.desc}</div>
                  </div>
                  {knowledgeLevel === opt.key && (
                    <span style={{ marginLeft: 'auto', color: 'var(--gold)', fontSize: 18 }}>✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* PASO 2 — Duración de sesión (NUEVO) */}
        {step === 2 && (
          <div>
            <div style={styles.stepTitle}>¿Cómo te gustaría que fueran tus sesiones?</div>
            <div style={styles.stepSub}>
              Esto solo cambia el ritmo y la extensión. El dominio final será el mismo en cualquier opción.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
              {SESSION_LENGTH_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setSessionLength(opt.key)}
                  style={{
                    ...styles.optionBtn,
                    borderColor: sessionLength === opt.key ? 'var(--gold)' : 'var(--border-color2)',
                    background: sessionLength === opt.key ? 'color-mix(in srgb, var(--gold) 10%, transparent)' : 'transparent',
                  }}
                >
                  <span style={{ fontSize: 28 }}>{opt.emoji}</span>
                  <div style={{ textAlign: 'left', flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: sessionLength === opt.key ? 'var(--gold)' : 'var(--text-primary)' }}>
                      {opt.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{opt.desc}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4, fontStyle: 'italic' }}>{opt.sub}</div>
                  </div>
                  {sessionLength === opt.key && (
                    <span style={{ marginLeft: 'auto', color: 'var(--gold)', fontSize: 18 }}>✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* PASO 3 — Fecha de examen */}
        {step === 3 && (
          <div>
            <div style={styles.stepTitle}>¿Cuándo es tu examen?</div>
            <div style={styles.stepSub}>
              Esto determina cuántas sesiones tendrá tu programa y su intensidad.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 20 }}>
              {EXAM_DATE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setExamDate(opt.key)}
                  style={{
                    ...styles.optionBtnSmall,
                    borderColor: examDate === opt.key ? 'var(--gold)' : 'var(--border-color2)',
                    background: examDate === opt.key ? 'color-mix(in srgb, var(--gold) 10%, transparent)' : 'transparent',
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 900, color: examDate === opt.key ? 'var(--gold)' : 'var(--text-primary)' }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{opt.sub}</div>
                </button>
              ))}
            </div>
            <label style={{ display: 'block', marginTop: 14, fontSize: 12, color: 'var(--text-muted)' }}>
              Fecha y hora exactas (opcional)
              <input data-testid="exam-date-time" aria-describedby="exam-timezone exam-date-error" type="datetime-local" value={examDateTime} onChange={event => setExamDateTime(event.target.value)} style={{ width: '100%', marginTop: 6, padding: 10, borderRadius: 8 }} />
              <span id="exam-timezone" style={{ display: 'block', marginTop: 5, color: 'var(--text-faint)' }}>Hora local · {Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
              {!exactExamIsFuture && <span id="exam-date-error" role="alert" style={{ display: 'block', marginTop: 5, color: '#ef4444' }}>La fecha y hora deben estar en el futuro.</span>}
            </label>
          </div>
        )}

        {/* PASO 4 — Nota objetivo */}
        {step === 4 && (
          <div>
            <div style={styles.stepTitle}>¿Qué nota quieres sacar?</div>
            <div style={styles.stepSub}>ALAI calibrará la profundidad del programa a este objetivo.</div>
            <div style={{
              marginTop: 28, padding: '24px 20px', borderRadius: 14,
              border: '1.5px solid var(--border-color2)', background: 'rgba(255,255,255,0.02)', textAlign: 'center',
            }}>
              <div style={{ fontSize: 56, fontWeight: 900, color: 'var(--gold)', lineHeight: 1 }}>{targetScore}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-secondary)', marginTop: 4 }}>{scoreLabel}</div>
              <input
                type="range"
                min={60} max={100} step={5}
                value={targetScore}
                onChange={(e) => setTargetScore(Number(e.target.value))}
                style={{ width: '100%', marginTop: 20, accentColor: '#d6b26f' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-faint)', marginTop: 8 }}>
                <span>60 · Aprobar</span>
                <span>80 · Notable</span>
                <span>100 · Perfecto</span>
              </div>
            </div>
          </div>
        )}

        {/* PASO 5 — Preferencia de evaluación */}
        {step === 5 && (
          <div>
            <div style={styles.stepTitle}>¿Cómo prefieres que te evalúen?</div>
            <div style={styles.stepSub}>Esto ayuda a ALAI a elegir el tipo de actividades que más te funcionan.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
              {[
                {
                  key: 'quick_test' as const,
                  title: 'Evaluaciones rápidas',
                  desc: 'Opción múltiple, verdadero/falso, completar, relacionar. Rápido y directo.',
                  emoji: '⚡',
                },
                {
                  key: 'write_explain' as const,
                  title: 'Explicar con mis palabras',
                  desc: 'Escribir explicaciones, respuestas abiertas, enseñar conceptos. Más profundo.',
                  emoji: '✍️',
                },
                {
                  key: 'mix_everything' as const,
                  title: 'Mezcla de todo',
                  desc: 'ALAI decide qué usar en cada momento. Variedad completa de formatos.',
                  emoji: '🎯',
                },
              ].map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setEvalPreference(opt.key)}
                  style={{
                    ...styles.optionBtn,
                    borderColor: evalPreference === opt.key ? 'var(--gold)' : 'var(--border-color2)',
                    background: evalPreference === opt.key ? 'color-mix(in srgb, var(--gold) 10%, transparent)' : 'transparent',
                  }}
                >
                  <span style={{ fontSize: 22 }}>{opt.emoji}</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: evalPreference === opt.key ? 'var(--gold)' : 'var(--text-primary)' }}>
                      {opt.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>{opt.desc}</div>
                  </div>
                  {evalPreference === opt.key && (
                    <span style={{ marginLeft: 'auto', color: 'var(--gold)', fontSize: 18 }}>✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 6 && (
          <div>
            <div style={styles.stepTitle}>¿Cómo será tu examen?</div>
            <div style={styles.stepSub}>La simulación final y la evidencia se alinearán con este formato.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 20 }}>
              {([['multiple_choice','Selección múltiple'],['development','Desarrollo'],['mixed','Mixto'],['mathematical','Matemático / problemas'],['practical','Práctico'],['unknown','No lo sé']] as const).map(([key, label]) => (
                <button key={key} data-testid={`exam-format-${key}`} onClick={() => setExamFormat(key)} style={{ ...styles.optionBtnSmall, borderColor: examFormat === key ? 'var(--gold)' : 'var(--border-color2)', background: 'transparent' }}>{label}</button>
              ))}
            </div>
          </div>
        )}

        {step === 7 && (
          <div>
            <div style={styles.stepTitle}>¿Cuánto tiempo tienes?</div>
            <div style={styles.stepSub}>Es una preferencia para organizar el plan. Puedes estudiar más, adelantar sesiones y continuar el mismo día.</div>
            <label style={{ display: 'block', marginTop: 20, color: 'var(--text-muted)', fontSize: 12 }}>Minutos por día: {dailyMinutes}
              <input data-testid="daily-minutes" type="range" min={10} max={180} step={5} value={dailyMinutes} onChange={event => setDailyMinutes(Number(event.target.value))} style={{ width: '100%', marginTop: 8 }} />
            </label>
            <div style={{ display: 'flex', gap: 5, marginTop: 16 }}>
              {['D','L','M','X','J','V','S'].map((label, day) => <button key={label} aria-pressed={availableDays.includes(day)} onClick={() => setAvailableDays(current => current.includes(day) ? current.filter(value => value !== day) : [...current, day])} style={{ flex: 1, padding: 9, borderRadius: 8, border: `1px solid ${availableDays.includes(day) ? 'var(--gold)' : 'var(--border-color2)'}`, background: 'transparent', color: 'var(--text-primary)' }}>{label}</button>)}
            </div>
          </div>
        )}

        {step === 8 && (
          <div>
            <div style={styles.stepTitle}>¿Qué temas te preocupan?</div>
            <div style={styles.stepSub}>Opcional. ALAI los prioriza sin eliminar el resto del material.</div>
            <textarea data-testid="study-priorities" value={prioritiesText} onChange={event => setPrioritiesText(event.target.value)} placeholder="Ej.: estructura atómica, cálculos, errores comunes" style={{ width: '100%', minHeight: 110, marginTop: 20, padding: 12, borderRadius: 10 }} />
          </div>
        )}

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
            style={{ ...styles.btnPrimary, opacity: canContinue ? 1 : 0.4, cursor: canContinue ? 'pointer' : 'not-allowed' }}
          >
            {step === 8 ? 'Generar mi plan →' : 'Siguiente →'}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed' as const, inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.80)',
    backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  card: {
    width: 'min(520px, 100%)', background: 'var(--bg-card)', border: '2px solid var(--gold)',
    borderRadius: 20, boxShadow: '0 32px 80px rgba(0,0,0,.5)', padding: 28, maxHeight: '90vh', overflowY: 'auto' as const,
  },
  stepTitle: { fontSize: 22, fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1.2, marginBottom: 8 },
  stepSub: { fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 },
  progressBar: { height: 4, borderRadius: 999, background: 'var(--border-color2)', overflow: 'hidden' },
  progressFill: { height: '100%', background: 'var(--gold)', borderRadius: 999, transition: 'width 0.3s ease' },
  optionBtn: {
    display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 14,
    border: '2px solid', cursor: 'pointer', textAlign: 'left' as const, transition: 'all 0.15s ease',
  },
  optionBtnSmall: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-start', padding: '12px 14px',
    borderRadius: 12, border: '2px solid', cursor: 'pointer', transition: 'all 0.15s ease',
  },
  btnPrimary: {
    padding: '12px 22px', borderRadius: 12, border: '2px solid var(--gold)', background: 'var(--gold)',
    color: '#111', fontWeight: 900, fontSize: 14, transition: 'all 0.15s ease',
  },
  btnSecondary: {
    padding: '12px 18px', borderRadius: 12, border: '1.5px solid var(--border-color2)',
    background: 'transparent', color: 'var(--text-faint)', fontWeight: 800, fontSize: 13, cursor: 'pointer',
  },
}
