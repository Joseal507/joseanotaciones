'use client'

// ═══════════════════════════════════════════════════════════════
// PaginatedBookPage v2 — Premium, legible, sin cortes
// 
// Cambios vs v1:
// - Scroll interno suave (no cortar contenido)
// - Texto grande y legible
// - Jerarquía visual clara entre bloques
// - Botón siempre visible (sticky bottom)
// - Sin telemetría interna
// ═══════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef } from 'react'
import MatchingCanvas from '../book/MatchingCanvas'
import MathText from '../../../MathText'
import { autoMath } from '../../../../lib/adaptive/v3/ui/autoMath'
import 'katex/dist/katex.min.css'

interface Props {
  page: any
  onSubmitAnswer: (answer: any) => void
  onContinue: () => void
  disabled?: boolean
  evaluation?: {
    outcome: 'correct' | 'partial' | 'incorrect'
    whatWasCorrect?: string
    whatWasMissing?: string
    correctAnswer?: string
  } | null
}

export default function PaginatedBookPage({ page, onSubmitAnswer, onContinue, disabled, evaluation }: Props) {
  const contentRef = useRef<HTMLDivElement>(null)
  const feedbackRef = useRef<HTMLDivElement>(null)

  // Scroll al tope cuando cambia la página
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0
    }
  }, [page?.id])

  // Scroll automático al feedback cuando aparece
  useEffect(() => {
    if (evaluation && feedbackRef.current) {
      setTimeout(() => {
        feedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 150)
    }
  }, [evaluation])

  const hasInteraction = !!page?.interaction
  const blocks = page?.content?.blocks || []
  const tutorMessage = page?.content?.tutorMessage
  const keyIdea = page?.content?.keyIdea

  return (
    <div style={containerStyle}>
      {/* Área scrollable de contenido */}
      <div ref={contentRef} style={scrollAreaStyle}>
        {/* Mensaje del tutor */}
        {tutorMessage && (
          <div style={tutorStyle}>
            <MathText text={autoMath(tutorMessage)} color="#5a4a2f" fontSize={17} weight="inherit" lineHeight={1.6} />
          </div>
        )}

        {/* Bloques de contenido */}
        {blocks.map((block: any, i: number) => (
          <ContentBlock key={i} block={block} />
        ))}

        {/* Idea clave */}
        {keyIdea && (
          <div style={keyIdeaStyle}>
            <span style={{ fontWeight: 800, color: '#a8854a' }}>💡 Para recordar:</span>{' '}
            <MathText text={autoMath(keyIdea)} color="inherit" fontSize="inherit" weight="inherit" />
          </div>
        )}

        {/* Interacción — se deshabilita cuando hay feedback */}
        {hasInteraction && (
          <div style={{
            ...interactionContainerStyle,
            opacity: evaluation ? 0.5 : 1,
            pointerEvents: evaluation ? 'none' : 'auto',
          }}>
            <InteractionWidget
              interaction={page.interaction}
              onSubmit={onSubmitAnswer}
              disabled={disabled || !!evaluation}
            />
          </div>
        )}

        {/* Feedback inline — aparece debajo de la interacción con scroll automático */}
        {evaluation && (
          <div ref={feedbackRef} style={{
            marginTop: 20,
            padding: '18px 22px',
            background: evaluation.outcome === 'correct' ? 'rgba(90,138,58,.08)' :
              evaluation.outcome === 'partial' ? 'rgba(214,178,111,.08)' :
              'rgba(139,26,26,.06)',
            borderLeft: `4px solid ${evaluation.outcome === 'correct' ? '#5a8a3a' :
              evaluation.outcome === 'partial' ? '#d6b26f' : '#8b1a1a'}`,
            borderRadius: '0 10px 10px 0',
          }}>
            <div style={{
              fontSize: 16, fontWeight: 800, marginBottom: 10,
              color: evaluation.outcome === 'correct' ? '#3a5a1e' :
                evaluation.outcome === 'partial' ? '#a8854a' : '#8b1a1a',
            }}>
              {evaluation.outcome === 'correct' ? '✓ Correcto' :
                evaluation.outcome === 'partial' ? '◐ Casi' : '✗ Incorrecto'}
            </div>
            {evaluation.whatWasCorrect && evaluation.outcome === 'correct' && (
              <div style={{ fontSize: 15, color: '#2a1f14', lineHeight: 1.6, marginBottom: 12 }}>
                {evaluation.whatWasCorrect}
              </div>
            )}
            {evaluation.whatWasMissing && evaluation.outcome !== 'correct' && (
              <div style={{ fontSize: 15, color: '#2a1f14', lineHeight: 1.6, marginBottom: 12 }}>
                {evaluation.whatWasMissing}
              </div>
            )}
            {evaluation.correctAnswer && evaluation.outcome !== 'correct' && (
              <div style={{
                padding: '14px 16px', marginBottom: 14,
                background: 'rgba(255,255,255,.5)', borderRadius: 8,
                fontSize: 15, color: '#2a1f14', lineHeight: 1.6,
                border: '1px solid rgba(42,31,20,.06)',
              }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#a8854a', marginBottom: 6, letterSpacing: 1 }}>
                  RESPUESTA CORRECTA
                </div>
                {evaluation.correctAnswer}
              </div>
            )}
            <button
              onClick={onContinue}
              style={{
                width: '100%', padding: '14px',
                background: '#2a1f14', color: '#f5ecd5',
                border: 'none', borderRadius: 10,
                fontFamily: 'Georgia, serif',
                fontSize: 16, fontWeight: 700, cursor: 'pointer',
                marginTop: 4,
              }}
            >
              {evaluation.outcome === 'correct' ? 'Continuar →' : 'Entendido, seguimos →'}
            </button>
          </div>
        )}
      </div>

      {/* Botón sticky en la parte inferior — solo cuando no hay interacción ni feedback */}
      {!hasInteraction && !evaluation && (
        <div style={stickyFooterStyle}>
          <button onClick={onContinue} disabled={disabled} style={btnContinueStyle}>
            Entendido, continuar →
          </button>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// CONTENT BLOCK RENDERER
// ═══════════════════════════════════════════════════════════════
function ContentBlock({ block }: { block: any }) {
  if (!block) return null

  switch (block.type) {
    case 'text':
      return <div style={textStyle}><MathText text={autoMath(block.text)} color="#2a1f14" fontSize={17} lineHeight={1.75} /></div>

    case 'heading': {
      const sizes: Record<number, number> = { 1: 28, 2: 22, 3: 18 }
      return (
        <h2 style={{
          fontSize: sizes[block.level] || 22,
          fontWeight: 800,
          color: '#2a1f14',
          margin: '20px 0 12px 0',
          lineHeight: 1.3,
        }}>
          {block.text}
        </h2>
      )
    }

    case 'formula': {
      // Prioridad: 1) latex explícito → 2) plain procesado por autoMath
      // NO forzar $$...$$ porque plain puede contener múltiples fragmentos $...$
      const raw = String(block.plain || block.expression || '')
      const rendered = block.latex
        ? '$$' + block.latex + '$$'
        : autoMath(raw)
      return (
        <div style={formulaBoxStyle}>
          <div style={{
            fontSize: 22, fontWeight: 700, color: '#2a1f14',
            textAlign: 'center', marginBottom: block.explanation ? 8 : 0,
          }}>
            <MathText text={rendered} textAlign="center" fontSize={22} weight={700} color="#2a1f14" />
          </div>
          {block.explanation && (
            <div style={{ fontSize: 14, color: '#5a4a2f', textAlign: 'center', fontStyle: 'italic' }}>
              <MathText text={autoMath(block.explanation)} textAlign="center" fontSize={14} />
            </div>
          )}
        </div>
      )
    }

    case 'example':
      return (
        <div style={exampleBoxStyle}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: '#a8854a', marginBottom: 10 }}>
            EJEMPLO
          </div>
          <div style={{ fontSize: 16, color: '#2a1f14', lineHeight: 1.7, marginBottom: block.solution ? 12 : 0 }}>
            {block.description}
          </div>
          {block.solution && (
            <div style={{
              padding: '12px 16px',
              background: 'rgba(255,255,255,.7)',
              borderRadius: 6,
              fontSize: 15, color: '#2a1f14', lineHeight: 1.6,
              borderLeft: '3px solid #a8854a',
            }}>
              <span style={{ fontWeight: 700 }}>→</span> {block.solution}
            </div>
          )}
        </div>
      )

    case 'steps':
      return (
        <div style={{ margin: '16px 0' }}>
          {(block.steps || []).map((step: any, i: number) => (
            <div key={i} style={stepRowStyle}>
              <div style={stepNumberStyle}>{step.label || i + 1}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#2a1f14', lineHeight: 1.5 }}>
                  {step.content}
                </div>
                {step.explanation && (
                  <div style={{ fontSize: 14, color: '#7a6a4f', marginTop: 4, fontStyle: 'italic' }}>
                    {step.explanation}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )

    case 'callout': {
      const variants: Record<string, { bg: string; border: string; icon: string }> = {
        info: { bg: 'rgba(52,152,219,.06)', border: '#3498db', icon: 'ℹ️' },
        warning: { bg: 'rgba(230,126,34,.06)', border: '#e67e22', icon: '⚠️' },
        success: { bg: 'rgba(46,204,113,.06)', border: '#27ae60', icon: '✓' },
        insight: { bg: 'rgba(214,178,111,.1)', border: '#d6b26f', icon: '💡' },
      }
      const v = variants[block.variant] || variants.info
      return (
        <div style={{
          padding: '14px 18px',
          background: v.bg,
          borderLeft: `4px solid ${v.border}`,
          borderRadius: 6,
          margin: '14px 0',
          fontSize: 16,
          lineHeight: 1.65,
          color: '#2a1f14',
        }}>
          <span style={{ marginRight: 8 }}>{v.icon}</span>{block.text}
        </div>
      )
    }

    case 'list':
      return (
        <ul style={{ margin: '12px 0', padding: 0, listStyle: 'none' }}>
          {(block.items || []).map((item: string, i: number) => (
            <li key={i} style={{
              fontSize: 16, color: '#2a1f14', lineHeight: 1.7,
              padding: '4px 0', display: 'flex', gap: 10,
            }}>
              <span style={{ color: '#a8854a', flexShrink: 0 }}>
                {block.ordered ? `${i + 1}.` : '•'}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )

    case 'quote':
      return (
        <blockquote style={{
          borderLeft: '4px solid #d6b26f',
          padding: '12px 18px',
          margin: '16px 0',
          background: 'rgba(214,178,111,.06)',
          borderRadius: '0 6px 6px 0',
        }}>
          <div style={{ fontSize: 17, color: '#3a2e1f', fontStyle: 'italic', lineHeight: 1.7 }}>
            "{block.text}"
          </div>
          {block.source && (
            <div style={{ fontSize: 13, color: '#a8854a', marginTop: 6 }}>— {block.source}</div>
          )}
        </blockquote>
      )

    case 'comparison':
      return (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.min((block.items || []).length, 3)}, 1fr)`,
          gap: 12, margin: '16px 0',
        }}>
          {(block.items || []).map((item: any, i: number) => (
            <div key={i} style={{
              padding: '14px 16px',
              background: 'rgba(214,178,111,.08)',
              border: '1px solid rgba(214,178,111,.25)',
              borderRadius: 8,
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#a8854a', marginBottom: 6 }}>
                {item.label}
              </div>
              <div style={{ fontSize: 15, color: '#2a1f14', lineHeight: 1.5 }}>
                {item.description}
              </div>
            </div>
          ))}
        </div>
      )

    default:
      if (block.text) return <p style={textStyle}>{block.text}</p>
      return null
  }
}

// ═══════════════════════════════════════════════════════════════
// INTERACTION WIDGET
// ═══════════════════════════════════════════════════════════════
function InteractionWidget({ interaction, onSubmit, disabled }: any) {
  const [textAnswer, setTextAnswer] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [matchAnswer, setMatchAnswer] = useState<Record<number, number>>({})
  const [orderAnswer, setOrderAnswer] = useState<number[]>([])

  // Reset cuando cambia la interacción
  useEffect(() => {
    setTextAnswer('')
    setSelected(null)
    setMatchAnswer({})
    setOrderAnswer([])
  }, [interaction?.id])

  const type = interaction?.interactionType || interaction?.type || 'open_response'
  const data = interaction?.data || {}
  const prompt = interaction?.prompt || ''

  // ── MULTIPLE CHOICE ────────────────────────────────────────
  if (type === 'multiple_choice' && Array.isArray(data.options)) {
    return (
      <div>
        <div style={questionStyle}><MathText text={autoMath(prompt)} fontSize={18} weight={700} color="#2a1f14" /></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.options.map((opt: string, i: number) => (
            <button key={i} onClick={() => { setSelected(i); onSubmit(i) }} disabled={disabled}
              style={{
                ...optionBtnStyle,
                borderColor: selected === i ? '#2a1f14' : 'rgba(42,31,20,.15)',
                background: selected === i ? 'rgba(42,31,20,.05)' : '#fff',
              }}>
              <span style={optionLetterStyle}>{String.fromCharCode(65 + i)}</span>
              <span style={{ fontSize: 16, color: '#2a1f14', flex: 1 }}><MathText text={autoMath(opt)} fontSize={16} color="#2a1f14" /></span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── TRUE FALSE ─────────────────────────────────────────────
  if (type === 'true_false') {
    return (
      <div>
        <div style={questionStyle}><MathText text={autoMath(prompt)} fontSize={18} weight={700} color="#2a1f14" /></div>
        {data.statement && (
          <div style={{
            padding: '14px 18px', background: 'rgba(214,178,111,.08)',
            borderRadius: 8, marginBottom: 16, fontSize: 17,
            color: '#2a1f14', fontStyle: 'italic', lineHeight: 1.6,
          }}>
            <MathText text={'"' + autoMath(data.statement) + '"'} fontSize={17} color="#2a1f14" />
          </div>
        )}
        <div style={{ display: 'flex', gap: 12 }}>
          {[
            { label: '✓ Verdadero', value: true },
            { label: '✗ Falso', value: false },
          ].map(opt => (
            <button key={String(opt.value)} onClick={() => onSubmit(opt.value)} disabled={disabled}
              style={{ ...optionBtnStyle, flex: 1, justifyContent: 'center', fontSize: 17, fontWeight: 700 }}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── FILL BLANK ─────────────────────────────────────────────
  if (type === 'fill_blank' || type === 'fill_blank_bank') {
    return (
      <div>
        <div style={questionStyle}><MathText text={autoMath(prompt)} fontSize={18} weight={700} color="#2a1f14" /></div>
        {data.template && (
          <div style={{
            padding: '14px 18px', background: 'rgba(214,178,111,.08)',
            borderRadius: 8, marginBottom: 16, fontSize: 18,
            color: '#2a1f14', textAlign: 'center', lineHeight: 1.6,
          }}>
            <MathText text={autoMath(String(data.template))} fontSize={18} color="#2a1f14" textAlign="center" />
          </div>
        )}
        {data.template && (
          <div style={{
            padding: '14px 18px', background: 'rgba(42,31,20,.04)',
            borderRadius: 8, marginBottom: 14, fontSize: 17,
            color: '#2a1f14', lineHeight: 1.7,
          }}>
            {data.template}
          </div>
        )}
        <input type="text" value={textAnswer} onChange={e => setTextAnswer(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && textAnswer.trim() && onSubmit(textAnswer.trim())}
          placeholder="Escribe tu respuesta..." disabled={disabled}
          style={inputStyle} autoFocus />
        {data.bank && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {data.bank.map((w: string, i: number) => (
              <button key={i} onClick={() => setTextAnswer(w)} disabled={disabled}
                style={{
                  padding: '8px 16px', borderRadius: 999,
                  background: textAnswer === w ? '#2a1f14' : 'rgba(214,178,111,.15)',
                  color: textAnswer === w ? '#f5ecd5' : '#5a4a2f',
                  border: 'none', fontSize: 14, cursor: 'pointer',
                  fontFamily: 'Georgia, serif', fontWeight: 600,
                }}>
                {w}
              </button>
            ))}
          </div>
        )}
        <button onClick={() => textAnswer.trim() && onSubmit(textAnswer.trim())}
          disabled={disabled || !textAnswer.trim()}
          style={{ ...btnSubmitStyle, marginTop: 16, opacity: textAnswer.trim() ? 1 : 0.4 }}>
          Responder →
        </button>
      </div>
    )
  }

  // ── MATCHING ───────────────────────────────────────────────
  if (type === 'matching' && Array.isArray(data.pairs)) {
    return (
      <div>
        <div style={questionStyle}><MathText text={autoMath(prompt)} fontSize={18} weight={700} color="#2a1f14" /></div>
        <MatchingCanvas pairs={data.pairs} value={matchAnswer} onChange={setMatchAnswer} themeColor="#d6b26f" />
        <button onClick={() => onSubmit(matchAnswer)}
          disabled={disabled || Object.keys(matchAnswer).length < data.pairs.length}
          style={{ ...btnSubmitStyle, marginTop: 16, opacity: Object.keys(matchAnswer).length >= data.pairs.length ? 1 : 0.4 }}>
          Verificar conexiones →
        </button>
      </div>
    )
  }

  // ── ORDERING ───────────────────────────────────────────────
  if (type === 'ordering' && Array.isArray(data.items)) {
    const items = data.items
    // (prompt se renderiza abajo con MathText)
    const currentOrder = orderAnswer.length === items.length ? orderAnswer : items.map((_: any, i: number) => i)

    const move = (from: number, to: number) => {
      const newOrder = [...currentOrder]
      const [removed] = newOrder.splice(from, 1)
      newOrder.splice(to, 0, removed)
      setOrderAnswer(newOrder)
    }

    return (
      <div>
        <div style={questionStyle}><MathText text={autoMath(prompt)} fontSize={18} weight={700} color="#2a1f14" /></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {currentOrder.map((idx: number, pos: number) => (
            <div key={idx} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px', background: '#fff',
              border: '1.5px solid rgba(42,31,20,.12)', borderRadius: 8,
            }}>
              <span style={{ ...optionLetterStyle, fontSize: 13 }}>{pos + 1}</span>
              <span style={{ flex: 1, fontSize: 15, color: '#2a1f14' }}><MathText text={autoMath(String(items[idx]))} fontSize={15} color="#2a1f14" /></span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => pos > 0 && move(pos, pos - 1)} disabled={pos === 0}
                  style={arrowBtnStyle}>↑</button>
                <button onClick={() => pos < currentOrder.length - 1 && move(pos, pos + 1)}
                  disabled={pos === currentOrder.length - 1} style={arrowBtnStyle}>↓</button>
              </div>
            </div>
          ))}
        </div>
        <button onClick={() => onSubmit(currentOrder)} disabled={disabled}
          style={{ ...btnSubmitStyle, marginTop: 16 }}>
          Confirmar orden →
        </button>
      </div>
    )
  }

  // ── FIND THE ERROR ─────────────────────────────────────────
  // Muestra pasos numerados; el usuario clickea el paso INCORRECTO
  if (type === 'find_the_error' && Array.isArray(data.workedSolution || data.steps)) {
    const steps: string[] = data.workedSolution || data.steps || []
    return (
      <div>
        <div style={questionStyle}><MathText text={autoMath(prompt || 'Encuentra el paso incorrecto')} fontSize={18} weight={700} color="#2a1f14" /></div>
        <div style={{
          padding: '10px 14px', marginBottom: 14,
          background: 'rgba(139,26,26,.05)', borderLeft: '3px solid #8b1a1a',
          borderRadius: '0 6px 6px 0', fontSize: 13, color: '#8b1a1a', fontWeight: 600,
        }}>
          Haz clic en el paso donde está el error
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {steps.map((step: string, i: number) => (
            <button key={i} onClick={() => { setSelected(i); onSubmit(i) }} disabled={disabled}
              style={{
                ...optionBtnStyle,
                borderColor: selected === i ? '#8b1a1a' : 'rgba(42,31,20,.15)',
                background: selected === i ? 'rgba(139,26,26,.06)' : '#fff',
                textAlign: 'left', alignItems: 'flex-start',
              }}>
              <span style={{ ...optionLetterStyle, background: '#f0e4c8', color: '#2a1f14' }}>{i + 1}</span>
              <span style={{ fontSize: 15, color: '#2a1f14', flex: 1 }}>
                <MathText text={autoMath(String(step))} fontSize={15} color="#2a1f14" />
              </span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── COMPLETE REACTION OR FORMULA ────────────────────────────
  // Como fill_blank pero con más énfasis visual en la fórmula
  if (type === 'complete_reaction_or_formula') {
    return (
      <div>
        <div style={questionStyle}><MathText text={autoMath(prompt || 'Completa la reacción o fórmula')} fontSize={18} weight={700} color="#2a1f14" /></div>
        {(data.template || data.equation) && (
          <div style={{
            padding: '20px 24px', marginBottom: 16,
            background: 'linear-gradient(135deg, rgba(214,178,111,.15), rgba(214,178,111,.05))',
            border: '2px solid rgba(214,178,111,.3)', borderRadius: 10,
            textAlign: 'center',
          }}>
            <MathText text={autoMath(String(data.template || data.equation))} fontSize={22} weight={700} color="#2a1f14" textAlign="center" />
          </div>
        )}
        <input type="text" value={textAnswer} onChange={e => setTextAnswer(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && textAnswer.trim() && onSubmit(textAnswer.trim())}
          placeholder="Escribe lo que falta..." disabled={disabled}
          style={{ ...inputStyle, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 18 }} autoFocus />
        {data.bank && Array.isArray(data.bank) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {data.bank.map((w: string, i: number) => (
              <button key={i} onClick={() => setTextAnswer(w)} disabled={disabled}
                style={{
                  padding: '8px 16px', borderRadius: 999,
                  background: textAnswer === w ? '#2a1f14' : 'rgba(214,178,111,.15)',
                  color: textAnswer === w ? '#f5ecd5' : '#5a4a2f',
                  border: 'none', fontSize: 14, cursor: 'pointer',
                  fontFamily: 'ui-monospace, monospace', fontWeight: 600,
                }}>
                {w}
              </button>
            ))}
          </div>
        )}
        <button onClick={() => textAnswer.trim() && onSubmit(textAnswer.trim())}
          disabled={disabled || !textAnswer.trim()}
          style={{ ...btnSubmitStyle, marginTop: 16, opacity: textAnswer.trim() ? 1 : 0.4 }}>
          Verificar →
        </button>
      </div>
    )
  }

  // ── STEP BY STEP SOLVER ─────────────────────────────────────
  // Problema + textarea para escribir la solución paso a paso
  if (type === 'step_by_step_solver') {
    return (
      <div>
        <div style={questionStyle}><MathText text={autoMath(prompt || 'Resuelve paso a paso')} fontSize={18} weight={700} color="#2a1f14" /></div>
        {data.problem && (
          <div style={{
            padding: '16px 20px', marginBottom: 14,
            background: 'rgba(214,178,111,.08)', borderLeft: '4px solid #d6b26f',
            borderRadius: '0 8px 8px 0',
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: '#a8854a', marginBottom: 6 }}>
              PROBLEMA
            </div>
            <MathText text={autoMath(String(data.problem))} fontSize={16} color="#2a1f14" />
          </div>
        )}
        <div style={{ fontSize: 13, color: '#5a4a2f', marginBottom: 8, fontStyle: 'italic' }}>
          Escribe tu solución paso a paso. Sé claro con cada operación.
        </div>
        <textarea value={textAnswer} onChange={e => setTextAnswer(e.target.value)}
          placeholder="Paso 1: ...
Paso 2: ...
Paso 3: ..."
          disabled={disabled}
          style={{ ...textareaStyle, fontFamily: 'ui-monospace, monospace', minHeight: 140 }} rows={6} autoFocus />
        <button onClick={() => textAnswer.trim() && onSubmit(textAnswer.trim())}
          disabled={disabled || !textAnswer.trim()}
          style={{ ...btnSubmitStyle, marginTop: 14, opacity: textAnswer.trim() ? 1 : 0.4 }}>
          Enviar solución →
        </button>
      </div>
    )
  }

  // ── OPEN RESPONSE / TEACH BACK / EXPLAIN WHY ──────────────
  return (
    <div>
      <div style={questionStyle}><MathText text={autoMath(prompt)} fontSize={18} weight={700} color="#2a1f14" /></div>
      <textarea value={textAnswer} onChange={e => setTextAnswer(e.target.value)}
        placeholder="Escribe tu respuesta..." disabled={disabled}
        style={textareaStyle} rows={4} autoFocus />
      <button onClick={() => textAnswer.trim() && onSubmit(textAnswer.trim())}
        disabled={disabled || !textAnswer.trim()}
        style={{ ...btnSubmitStyle, marginTop: 14, opacity: textAnswer.trim() ? 1 : 0.4 }}>
        Enviar respuesta →
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// ESTILOS — Premium, legible, claro
// ═══════════════════════════════════════════════════════════════

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
}

const scrollAreaStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  minHeight: 0,
  paddingBottom: 8,
  scrollbarWidth: 'thin',
  scrollbarColor: 'rgba(214,178,111,.3) transparent',
}

const tutorStyle: React.CSSProperties = {
  fontSize: 17,
  color: '#5a4a2f',
  fontStyle: 'italic',
  lineHeight: 1.6,
  padding: '14px 20px',
  background: 'linear-gradient(135deg, rgba(214,178,111,.1), rgba(214,178,111,.04))',
  borderLeft: '4px solid #d6b26f',
  borderRadius: '0 8px 8px 0',
  marginBottom: 20,
}

const textStyle: React.CSSProperties = {
  fontSize: 17,
  lineHeight: 1.75,
  color: '#2a1f14',
  margin: '0 0 14px 0',
}

const formulaBoxStyle: React.CSSProperties = {
  padding: '20px 24px',
  background: 'linear-gradient(135deg, rgba(214,178,111,.12), rgba(214,178,111,.04))',
  border: '2px solid rgba(214,178,111,.35)',
  borderRadius: 10,
  margin: '18px 0',
}

const exampleBoxStyle: React.CSSProperties = {
  padding: '18px 20px',
  background: 'rgba(42,31,20,.03)',
  border: '1px solid rgba(42,31,20,.08)',
  borderRadius: 10,
  margin: '18px 0',
}

const stepRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 14,
  alignItems: 'flex-start',
  marginBottom: 12,
}

const stepNumberStyle: React.CSSProperties = {
  minWidth: 32, height: 32,
  borderRadius: '50%',
  background: '#2a1f14',
  color: '#f5ecd5',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 14, fontWeight: 800, flexShrink: 0,
}

const keyIdeaStyle: React.CSSProperties = {
  padding: '16px 20px',
  background: 'linear-gradient(135deg, rgba(214,178,111,.15), rgba(214,178,111,.06))',
  borderLeft: '4px solid #d6b26f',
  borderRadius: '0 8px 8px 0',
  margin: '20px 0',
  fontSize: 16,
  color: '#2a1f14',
  lineHeight: 1.6,
}

const interactionContainerStyle: React.CSSProperties = {
  padding: '20px 0 16px 0',
  borderTop: '1px solid rgba(42,31,20,.08)',
  marginTop: 16,
}

const questionStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: '#2a1f14',
  marginBottom: 18,
  lineHeight: 1.5,
}

const optionBtnStyle: React.CSSProperties = {
  padding: '14px 18px',
  background: '#fff',
  border: '2px solid rgba(42,31,20,.12)',
  borderRadius: 10,
  fontFamily: 'Georgia, serif',
  fontSize: 16,
  color: '#2a1f14',
  cursor: 'pointer',
  textAlign: 'left',
  display: 'flex', alignItems: 'center', gap: 14,
  transition: 'all .15s',
  width: '100%',
}

const optionLetterStyle: React.CSSProperties = {
  minWidth: 32, height: 32,
  borderRadius: '50%',
  background: 'rgba(214,178,111,.2)',
  color: '#5a4a2f',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 14, fontWeight: 800, flexShrink: 0,
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '14px 18px',
  fontFamily: 'Georgia, serif', fontSize: 17,
  border: '2px solid rgba(42,31,20,.15)',
  borderRadius: 10, outline: 'none',
  background: '#fff', color: '#2a1f14',
  boxSizing: 'border-box',
}

const textareaStyle: React.CSSProperties = {
  width: '100%', padding: '14px 18px',
  fontFamily: 'Georgia, serif', fontSize: 17,
  border: '2px solid rgba(42,31,20,.15)',
  borderRadius: 10, outline: 'none',
  background: '#fff', color: '#2a1f14',
  boxSizing: 'border-box', resize: 'vertical',
  lineHeight: 1.6, minHeight: 100,
}

const btnSubmitStyle: React.CSSProperties = {
  padding: '14px 28px',
  background: '#2a1f14', color: '#f5ecd5',
  border: 'none', borderRadius: 10,
  fontFamily: 'Georgia, serif',
  fontSize: 16, fontWeight: 700, cursor: 'pointer',
  width: '100%',
  letterSpacing: 0.5,
}

const btnContinueStyle: React.CSSProperties = {
  padding: '16px 28px',
  background: '#2a1f14', color: '#f5ecd5',
  border: 'none', borderRadius: 10,
  fontFamily: 'Georgia, serif',
  fontSize: 16, fontWeight: 700, cursor: 'pointer',
  width: '100%',
  letterSpacing: 0.5,
}

const stickyFooterStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: '16px 0 8px 0',
  borderTop: '1px solid rgba(42,31,20,.08)',
  background: 'linear-gradient(135deg, #f0e4c8, #e8d9b0)',
}

const arrowBtnStyle: React.CSSProperties = {
  width: 30, height: 30,
  background: 'rgba(42,31,20,.06)',
  border: '1px solid rgba(42,31,20,.1)',
  borderRadius: 6, cursor: 'pointer',
  fontSize: 16, color: '#2a1f14',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
