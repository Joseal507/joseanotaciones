'use client'

// ═══════════════════════════════════════════════════════════════
// AdaptiveBookPage — Renderer visual del sistema v2
// 
// Renderiza cualquier BookPage con cualquier tipo de contenido
// e interacción. Mantiene la estética libro premium.
// ═══════════════════════════════════════════════════════════════

import React, { useState, useEffect } from 'react'
import type {
  BookPage,
  ContentBlock,
  Interaction,
  PageType,
} from '../../../../lib/adaptive/v2/types'

interface Props {
  page: BookPage
  onSubmitAnswer: (answer: any, confidence?: string, responseTimeSeconds?: number) => void
  onContinue: () => void
  disabled?: boolean
}

export default function AdaptiveBookPage({ page, onSubmitAnswer, onContinue, disabled }: Props) {
  const [startTime] = useState(() => Date.now())
  const [confidence, setConfidence] = useState<string>('medium')

  const handleSubmit = (answer: any) => {
    if (disabled) return
    const responseTime = Math.round((Date.now() - startTime) / 1000)
    onSubmitAnswer(answer, confidence, responseTime)
  }

  return (
    <div style={pageContainerStyle}>
      {/* Header con tipo de página */}
      <PageHeader pageType={page.pageType} title={page.title} isReteach={page.isReteach} />

      {/* Mensaje del tutor si existe */}
      {page.content.tutorMessage && (
        <TutorMessage text={page.content.tutorMessage} />
      )}

      {/* Bloques de contenido */}
      <div style={{ marginBottom: 20 }}>
        {(page.content.blocks || []).map((block, i) => (
          <BlockRenderer key={i} block={block} />
        ))}
      </div>

      {/* Idea clave */}
      {page.content.keyIdea && (
        <KeyIdeaCard text={page.content.keyIdea} />
      )}

      {/* Interacción o botón continuar */}
      {page.interaction ? (
        <InteractionRenderer
          interaction={page.interaction}
          onSubmit={handleSubmit}
          confidence={confidence}
          onConfidenceChange={setConfidence}
          disabled={disabled}
        />
      ) : (
        <button onClick={onContinue} disabled={disabled} style={btnPrimary}>
          Entendido, continuar →
        </button>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// PAGE HEADER
// ═══════════════════════════════════════════════════════════════
function PageHeader({ pageType, title, isReteach }: { pageType: PageType; title?: string; isReteach?: boolean }) {
  const label = PAGE_TYPE_LABELS[pageType] || '✦ ACTIVIDAD'
  const color = PAGE_TYPE_COLORS[pageType] || '#3a2e1f'

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 8,
      }}>
        <div style={{
          fontSize: 10, letterSpacing: 3, color,
          fontWeight: 700, textTransform: 'uppercase',
        }}>
          {label}
        </div>
        {isReteach && (
          <div style={{
            fontSize: 9, letterSpacing: 2, color: '#a8854a',
            background: 'rgba(214,178,111,.15)',
            padding: '3px 8px', borderRadius: 999, fontWeight: 700,
          }}>
            🔄 REEXPLICACIÓN
          </div>
        )}
      </div>
      {title && (
        <div style={{
          fontSize: 20, fontWeight: 700, color: '#3a2e1f',
          lineHeight: 1.2, marginBottom: 4,
        }}>
          {title}
        </div>
      )}
      <div style={{ height: 2, background: color, opacity: 0.3, borderRadius: 1 }} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// TUTOR MESSAGE
// ═══════════════════════════════════════════════════════════════
function TutorMessage({ text }: { text: string }) {
  return (
    <div style={{
      padding: '10px 14px',
      background: 'rgba(58,46,31,.05)',
      borderLeft: '2px solid rgba(58,46,31,.2)',
      borderRadius: 4,
      marginBottom: 16,
      fontSize: 13, color: '#5a4a2f',
      fontStyle: 'italic', lineHeight: 1.5,
    }}>
      {text}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// KEY IDEA CARD
// ═══════════════════════════════════════════════════════════════
function KeyIdeaCard({ text }: { text: string }) {
  return (
    <div style={{
      padding: '12px 16px',
      background: 'linear-gradient(135deg, rgba(214,178,111,.15), rgba(214,178,111,.08))',
      borderLeft: '3px solid #d6b26f',
      borderRadius: 6,
      marginBottom: 20,
      fontSize: 13.5, color: '#3a2e1f',
      fontWeight: 600, lineHeight: 1.5,
    }}>
      💡 Para recordar: {text}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// BLOCK RENDERER — Renderiza cada tipo de bloque de contenido
// ═══════════════════════════════════════════════════════════════
function BlockRenderer({ block }: { block: ContentBlock }) {
  const cleanText = (t: string) => String(t || '').replace(/\*\*/g, '').replace(/\*/g, '').trim()

  switch (block.type) {
    case 'text':
      return (
        <p style={{
          fontSize: 14.5, lineHeight: 1.85, color: '#3a2e1f',
          marginBottom: 14,
        }}>
          {cleanText(block.text)}
        </p>
      )

    case 'heading': {
      const size = block.level === 1 ? 20 : block.level === 2 ? 16 : 14
      return (
        <div style={{
          fontSize: size, fontWeight: 700, color: '#3a2e1f',
          marginTop: 16, marginBottom: 10,
        }}>
          {cleanText(block.text)}
        </div>
      )
    }

    case 'formula':
      return (
        <div style={{
          padding: '14px 18px',
          background: 'rgba(58,46,31,.05)',
          border: '1.5px dashed rgba(58,46,31,.2)',
          borderRadius: 8, marginBottom: 14,
          textAlign: 'center',
        }}>
          <div style={{
            fontFamily: 'Georgia, serif',
            fontSize: 18, fontWeight: 600, color: '#3a2e1f',
            marginBottom: block.explanation ? 8 : 0,
          }}>
            {block.plain}
          </div>
          {block.explanation && (
            <div style={{ fontSize: 12, color: 'rgba(58,46,31,.6)', fontStyle: 'italic' }}>
              {block.explanation}
            </div>
          )}
        </div>
      )

    case 'example':
      return (
        <div style={{
          padding: '14px 16px',
          background: 'rgba(214,178,111,.08)',
          borderLeft: '3px solid #a8854a',
          borderRadius: 6, marginBottom: 14,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: '#a8854a', marginBottom: 8 }}>
            ✦ EJEMPLO
          </div>
          <div style={{ fontSize: 13.5, color: '#3a2e1f', lineHeight: 1.6, marginBottom: block.solution ? 10 : 0 }}>
            {cleanText(block.description)}
          </div>
          {block.solution && (
            <div style={{
              padding: '10px 12px', background: 'rgba(255,255,255,.6)',
              borderRadius: 4, fontSize: 13, color: '#3a2e1f',
              fontFamily: 'Georgia, serif', lineHeight: 1.6,
            }}>
              <strong>Solución:</strong> {cleanText(block.solution)}
            </div>
          )}
        </div>
      )

    case 'steps':
      return (
        <div style={{ marginBottom: 14 }}>
          {block.steps.map((step, i) => (
            <div key={i} style={{
              display: 'flex', gap: 12, marginBottom: 10,
              padding: '10px 14px', background: 'rgba(255,255,255,.4)',
              borderRadius: 6, border: '1px solid rgba(58,46,31,.1)',
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%',
                background: '#3a2e1f', color: '#f5ecd5',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, flexShrink: 0,
              }}>{step.label}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, color: '#3a2e1f', lineHeight: 1.5 }}>
                  {cleanText(step.content)}
                </div>
                {step.explanation && (
                  <div style={{ fontSize: 12, color: 'rgba(58,46,31,.55)', fontStyle: 'italic', marginTop: 4 }}>
                    {cleanText(step.explanation)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )

    case 'comparison':
      return (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.min(block.items.length, 3)}, 1fr)`,
          gap: 10, marginBottom: 14,
        }}>
          {block.items.map((item, i) => (
            <div key={i} style={{
              padding: '12px', background: 'rgba(255,255,255,.5)',
              border: '1.5px solid rgba(58,46,31,.15)', borderRadius: 6,
            }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#3a2e1f', marginBottom: 6 }}>
                {cleanText(item.label)}
              </div>
              <div style={{ fontSize: 12.5, color: 'rgba(58,46,31,.7)', lineHeight: 1.5 }}>
                {cleanText(item.description)}
              </div>
            </div>
          ))}
        </div>
      )

    case 'callout': {
      const colors: Record<string, { bg: string; border: string; text: string; icon: string }> = {
        info: { bg: 'rgba(59,130,246,.08)', border: '#3b82f6', text: '#1e40af', icon: 'ℹ️' },
        warning: { bg: 'rgba(245,158,11,.08)', border: '#f59e0b', text: '#78350f', icon: '⚠️' },
        success: { bg: 'rgba(34,197,94,.08)', border: '#22c55e', text: '#14532d', icon: '✓' },
        insight: { bg: 'rgba(214,178,111,.12)', border: '#d6b26f', text: '#7c5a0e', icon: '💡' },
      }
      const c = colors[block.variant] || colors.info
      return (
        <div style={{
          padding: '12px 14px', background: c.bg,
          borderLeft: `3px solid ${c.border}`,
          borderRadius: 6, marginBottom: 14,
          fontSize: 13, color: c.text, lineHeight: 1.6,
        }}>
          <span style={{ marginRight: 8 }}>{c.icon}</span>
          {cleanText(block.text)}
        </div>
      )
    }

    case 'code':
      return (
        <pre style={{
          padding: '12px 14px', background: '#2d2416',
          color: '#f5ecd5', borderRadius: 6,
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 13, lineHeight: 1.6, marginBottom: 14,
          overflow: 'auto', whiteSpace: 'pre-wrap',
        }}>
          <code>{block.code}</code>
        </pre>
      )

    case 'diagram':
      return (
        <div style={{
          padding: '14px', background: 'rgba(58,46,31,.03)',
          border: '1.5px dashed rgba(58,46,31,.2)', borderRadius: 8,
          marginBottom: 14,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#a8854a', letterSpacing: 1, marginBottom: 8 }}>
            📊 DIAGRAMA
          </div>
          {block.ascii ? (
            <pre style={{ fontFamily: 'monospace', fontSize: 12, color: '#3a2e1f', margin: 0 }}>
              {block.ascii}
            </pre>
          ) : (
            <div style={{ fontSize: 13, color: '#3a2e1f', lineHeight: 1.6, fontStyle: 'italic' }}>
              {cleanText(block.description)}
            </div>
          )}
        </div>
      )

    case 'list':
      return block.ordered ? (
        <ol style={{ marginBottom: 14, paddingLeft: 20, color: '#3a2e1f' }}>
          {block.items.map((item, i) => (
            <li key={i} style={{ fontSize: 13.5, lineHeight: 1.7, marginBottom: 4 }}>
              {cleanText(item)}
            </li>
          ))}
        </ol>
      ) : (
        <ul style={{ marginBottom: 14, paddingLeft: 20, color: '#3a2e1f', listStyle: 'none' }}>
          {block.items.map((item, i) => (
            <li key={i} style={{ fontSize: 13.5, lineHeight: 1.7, marginBottom: 4 }}>
              <span style={{ color: '#a8854a', marginRight: 8 }}>•</span>
              {cleanText(item)}
            </li>
          ))}
        </ul>
      )

    case 'quote':
      return (
        <blockquote style={{
          margin: '0 0 14px 0', padding: '12px 16px',
          background: 'rgba(58,46,31,.04)',
          borderLeft: '3px solid rgba(58,46,31,.3)',
          fontSize: 14, color: '#3a2e1f', fontStyle: 'italic',
          lineHeight: 1.6,
        }}>
          "{cleanText(block.text)}"
          {block.source && (
            <div style={{ fontSize: 11, color: 'rgba(58,46,31,.5)', marginTop: 6, fontStyle: 'normal' }}>
              — {block.source}
            </div>
          )}
        </blockquote>
      )

    case 'tutor_note':
      return (
        <div style={{
          padding: '10px 14px', background: 'rgba(214,178,111,.08)',
          borderLeft: '2px solid #d6b26f', borderRadius: 4,
          marginBottom: 14, fontSize: 12.5, color: '#5a4a2f',
          fontStyle: 'italic', lineHeight: 1.55,
        }}>
          <span style={{ marginRight: 6, opacity: 0.7 }}>—</span>
          {cleanText(block.text)}
        </div>
      )

    default:
      return null
  }
}

// ═══════════════════════════════════════════════════════════════
// INTERACTION RENDERER — Renderiza cada tipo de interacción
// ═══════════════════════════════════════════════════════════════
function InteractionRenderer({
  interaction, onSubmit, confidence, onConfidenceChange, disabled,
}: {
  interaction: Interaction
  onSubmit: (answer: any) => void
  confidence: string
  onConfidenceChange: (c: string) => void
  disabled?: boolean
}) {
  const [textAnswer, setTextAnswer] = useState('')
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [selectedIdxs, setSelectedIdxs] = useState<number[]>([])
  const [pairAnswers, setPairAnswers] = useState<Record<number, number>>({})
  const [orderAnswers, setOrderAnswers] = useState<number[]>([])
  const [stepAnswers, setStepAnswers] = useState<Record<number, string>>({})

  const data: any = interaction.data

  // ── PROMPT (siempre visible) ───────────────────────────────
  const PromptBlock = () => (
    <div style={{
      fontSize: 15, fontWeight: 700, color: '#3a2e1f',
      lineHeight: 1.5, marginBottom: 18,
    }}>
      {interaction.prompt}
    </div>
  )

  // ── CONFIDENCE SELECTOR ────────────────────────────────────
  const ConfidencePicker = () => interaction.requiresConfidence ? (
    <div style={{ marginTop: 12, marginBottom: 12 }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: 'rgba(58,46,31,.5)', fontWeight: 700, marginBottom: 8 }}>
        ¿QUÉ TAN SEGURO/A ESTÁS?
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {[
          { key: 'high', label: '💪 Seguro' },
          { key: 'medium', label: '🤔 Algo' },
          { key: 'low', label: '😅 Poco' },
        ].map(opt => (
          <button key={opt.key} onClick={() => onConfidenceChange(opt.key)}
            style={{
              flex: 1, padding: '8px', borderRadius: 6,
              border: confidence === opt.key ? '2px solid #d6b26f' : '1.5px solid rgba(58,46,31,.15)',
              background: confidence === opt.key ? 'rgba(214,178,111,.15)' : 'transparent',
              color: '#3a2e1f', fontFamily: 'Georgia, serif',
              fontSize: 11, cursor: 'pointer',
              fontWeight: confidence === opt.key ? 700 : 400,
            }}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  ) : null

  // ═══════════════════════════════════════════════════════════
  // TIPOS DE INTERACCIÓN
  // ═══════════════════════════════════════════════════════════

  // MULTIPLE CHOICE
  if (interaction.interactionType === 'multiple_choice') {
    return (
      <div>
        <PromptBlock />
        {(data.options || []).map((opt: string, i: number) => (
          <button key={i} onClick={() => { setSelectedIdx(i); onSubmit(i) }}
            disabled={disabled}
            style={{
              width: '100%', padding: '13px 16px', marginBottom: 8,
              borderRadius: 6, border: '1.5px solid rgba(58,46,31,.25)',
              background: 'rgba(255,255,255,.4)', color: '#3a2e1f',
              fontFamily: 'Georgia, serif', fontSize: 13.5,
              cursor: 'pointer', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 12,
              transition: 'all .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(214,178,111,.1)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.4)' }}
          >
            <span style={{ fontWeight: 700, color: 'rgba(58,46,31,.4)', minWidth: 20 }}>
              {String.fromCharCode(65 + i)}.
            </span>
            {opt}
          </button>
        ))}
      </div>
    )
  }

  // TRUE FALSE
  if (interaction.interactionType === 'true_false') {
    return (
      <div>
        <PromptBlock />
        {data.statement && (
          <div style={{
            padding: '12px 16px', background: 'rgba(58,46,31,.05)',
            borderRadius: 6, marginBottom: 12, fontSize: 14, color: '#3a2e1f',
          }}>
            {data.statement}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            { label: 'Verdadero ✓', value: true },
            { label: 'Falso ✗', value: false },
          ].map(opt => (
            <button key={String(opt.value)} onClick={() => onSubmit(opt.value)}
              disabled={disabled}
              style={{
                flex: 1, padding: '16px', borderRadius: 6,
                border: '1.5px solid rgba(58,46,31,.25)',
                background: 'rgba(255,255,255,.4)', color: '#3a2e1f',
                fontFamily: 'Georgia, serif', fontSize: 14, fontWeight: 600,
                cursor: 'pointer',
              }}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // FILL BLANK / FILL BLANK BANK
  if (interaction.interactionType === 'fill_blank' || interaction.interactionType === 'fill_blank_bank') {
    const hasBank = interaction.interactionType === 'fill_blank_bank' && Array.isArray(data.bank)
    return (
      <div>
        <PromptBlock />
        {data.template && (
          <div style={{
            padding: '14px 16px', background: 'rgba(255,255,255,.5)',
            border: '1.5px dashed rgba(58,46,31,.2)', borderRadius: 6,
            marginBottom: 14, fontSize: 14, color: '#3a2e1f', lineHeight: 1.7,
          }}>
            {data.template.replace(/___/g, '_______')}
          </div>
        )}
        <input value={textAnswer} onChange={e => setTextAnswer(e.target.value)}
          placeholder="Escribe la respuesta..." disabled={disabled}
          onKeyDown={e => { if (e.key === 'Enter' && textAnswer.trim()) onSubmit(textAnswer) }}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 6,
            border: '2px solid rgba(58,46,31,.2)',
            background: 'rgba(255,255,255,.8)',
            fontSize: 14, fontFamily: 'Georgia, serif', color: '#3a2e1f',
            outline: 'none', marginBottom: 12, boxSizing: 'border-box',
          }} />
        {hasBank && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {data.bank.map((w: string) => (
              <button key={w} onClick={() => setTextAnswer(w)}
                style={{
                  padding: '6px 12px', borderRadius: 6,
                  background: textAnswer === w ? '#3a2e1f' : '#fff',
                  color: textAnswer === w ? '#f5ecd5' : '#3a2e1f',
                  border: `1.5px solid ${textAnswer === w ? '#3a2e1f' : 'rgba(58,46,31,.2)'}`,
                  fontSize: 12, cursor: 'pointer', fontFamily: 'Georgia, serif',
                }}>
                {w}
              </button>
            ))}
          </div>
        )}
        <ConfidencePicker />
        <button onClick={() => onSubmit(textAnswer)} disabled={disabled || !textAnswer.trim()}
          style={{ ...btnPrimary, opacity: !textAnswer.trim() ? 0.4 : 1 }}>
          Responder →
        </button>
      </div>
    )
  }

  // OPEN RESPONSE / QUICK CHECK / EXPLAIN WHY / TEACH BACK
  if (['open_response', 'quick_check', 'explain_why', 'teach_back', 'final_reflection', 'mini_challenge'].includes(interaction.interactionType)) {
    return (
      <div>
        <PromptBlock />
        <textarea value={textAnswer} onChange={e => setTextAnswer(e.target.value)}
          placeholder="Escribe tu respuesta..." rows={5} disabled={disabled}
          style={{
            width: '100%', padding: '14px', borderRadius: 6,
            border: '1.5px solid rgba(58,46,31,.25)',
            background: 'rgba(255,255,255,.6)',
            fontSize: 14, fontFamily: 'Georgia, serif', color: '#3a2e1f',
            outline: 'none', resize: 'vertical', boxSizing: 'border-box',
            lineHeight: 1.6, marginBottom: 12,
          }} />
        <ConfidencePicker />
        <button onClick={() => onSubmit(textAnswer)} disabled={disabled || !textAnswer.trim()}
          style={{ ...btnPrimary, opacity: !textAnswer.trim() ? 0.4 : 1 }}>
          Enviar respuesta →
        </button>
      </div>
    )
  }

  // MATCHING
  if (interaction.interactionType === 'matching' && Array.isArray(data.pairs)) {
    const [leftSelected, setLeftSelected] = useState<number | null>(null)
    const [connections, setConnections] = useState<Record<number, number>>({})
    
    const handleLeft = (i: number) => setLeftSelected(leftSelected === i ? null : i)
    const handleRight = (i: number) => {
      if (leftSelected === null) return
      setConnections({ ...connections, [leftSelected]: i })
      setLeftSelected(null)
    }
    
    return (
      <div>
        <PromptBlock />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 14 }}>
          <div>
            {data.pairs.map((p: any, i: number) => (
              <button key={i} onClick={() => handleLeft(i)} disabled={disabled}
                style={{
                  width: '100%', padding: '10px 12px', marginBottom: 8,
                  borderRadius: 6, border: leftSelected === i ? '2px solid #d6b26f' : '1.5px solid rgba(58,46,31,.2)',
                  background: connections[i] !== undefined ? 'rgba(90,138,58,.15)' : 'rgba(255,255,255,.5)',
                  fontFamily: 'Georgia, serif', fontSize: 13, color: '#3a2e1f',
                  cursor: 'pointer', textAlign: 'left',
                }}>
                {p.left}
              </button>
            ))}
          </div>
          <div>
            {data.pairs.map((p: any, i: number) => {
              const isConnected = Object.values(connections).includes(i)
              return (
                <button key={i} onClick={() => handleRight(i)} disabled={disabled}
                  style={{
                    width: '100%', padding: '10px 12px', marginBottom: 8,
                    borderRadius: 6, border: '1.5px solid rgba(58,46,31,.2)',
                    background: isConnected ? 'rgba(90,138,58,.15)' : 'rgba(255,255,255,.5)',
                    fontFamily: 'Georgia, serif', fontSize: 13, color: '#3a2e1f',
                    cursor: 'pointer', textAlign: 'left',
                  }}>
                  {p.right}
                </button>
              )
            })}
          </div>
        </div>
        <ConfidencePicker />
        <button onClick={() => onSubmit(connections)}
          disabled={disabled || Object.keys(connections).length < data.pairs.length}
          style={{
            ...btnPrimary,
            opacity: Object.keys(connections).length < data.pairs.length ? 0.4 : 1,
          }}>
          Verificar conexiones →
        </button>
      </div>
    )
  }

  // ORDERING
  if (interaction.interactionType === 'ordering' && Array.isArray(data.items)) {
    const [order, setOrder] = useState<number[]>(data.items.map((_: any, i: number) => i))
    
    const move = (from: number, to: number) => {
      const newOrder = [...order]
      const [item] = newOrder.splice(from, 1)
      newOrder.splice(to, 0, item)
      setOrder(newOrder)
    }
    
    return (
      <div>
        <PromptBlock />
        <div style={{ marginBottom: 14 }}>
          {order.map((idx, pos) => (
            <div key={idx} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', marginBottom: 6,
              background: 'rgba(255,255,255,.5)',
              border: '1.5px solid rgba(58,46,31,.2)',
              borderRadius: 6,
            }}>
              <span style={{ fontWeight: 700, color: 'rgba(58,46,31,.4)', minWidth: 20 }}>
                {pos + 1}.
              </span>
              <span style={{ flex: 1, fontSize: 13, color: '#3a2e1f' }}>{data.items[idx]}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button onClick={() => pos > 0 && move(pos, pos - 1)}
                  disabled={pos === 0 || disabled}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(58,46,31,.4)', fontSize: 12, opacity: pos === 0 ? .3 : 1 }}>▲</button>
                <button onClick={() => pos < order.length - 1 && move(pos, pos + 1)}
                  disabled={pos === order.length - 1 || disabled}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(58,46,31,.4)', fontSize: 12, opacity: pos === order.length - 1 ? .3 : 1 }}>▼</button>
              </div>
            </div>
          ))}
        </div>
        <ConfidencePicker />
        <button onClick={() => onSubmit(order)} disabled={disabled} style={btnPrimary}>
          Confirmar orden →
        </button>
      </div>
    )
  }

  // STEP BY STEP SOLVER
  if (interaction.interactionType === 'step_by_step_solver') {
    const numSteps = data.expectedSteps?.length || 3
    return (
      <div>
        <PromptBlock />
        {data.problem && (
          <div style={{
            padding: '12px 16px', background: 'rgba(214,178,111,.1)',
            borderLeft: '3px solid #d6b26f', borderRadius: 6,
            marginBottom: 14, fontSize: 13.5, color: '#3a2e1f',
          }}>
            📝 {data.problem}
          </div>
        )}
        {Array.from({ length: numSteps }, (_, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(58,46,31,.5)', marginBottom: 4 }}>
              PASO {i + 1}
            </div>
            <textarea value={stepAnswers[i] || ''} onChange={e => setStepAnswers({ ...stepAnswers, [i]: e.target.value })}
              placeholder={`Escribe el paso ${i + 1}...`} rows={2} disabled={disabled}
              style={{
                width: '100%', padding: '10px', borderRadius: 4,
                border: '1.5px solid rgba(58,46,31,.2)',
                background: 'rgba(255,255,255,.6)', fontSize: 13,
                fontFamily: 'Georgia, serif', color: '#3a2e1f',
                outline: 'none', boxSizing: 'border-box',
              }} />
          </div>
        ))}
        <ConfidencePicker />
        <button onClick={() => onSubmit(stepAnswers)}
          disabled={disabled || Object.keys(stepAnswers).length < numSteps}
          style={{ ...btnPrimary, opacity: Object.keys(stepAnswers).length < numSteps ? 0.4 : 1 }}>
          Enviar solución →
        </button>
      </div>
    )
  }

  // FIND THE ERROR
  if (interaction.interactionType === 'find_the_error' && Array.isArray(data.workedSolution)) {
    return (
      <div>
        <PromptBlock />
        <div style={{ marginBottom: 14 }}>
          {data.workedSolution.map((step: string, i: number) => (
            <button key={i} onClick={() => onSubmit(i)} disabled={disabled}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '10px 14px', marginBottom: 6,
                background: 'rgba(255,255,255,.5)',
                border: '1.5px solid rgba(58,46,31,.2)',
                borderRadius: 6, fontFamily: 'Georgia, serif',
                fontSize: 13, color: '#3a2e1f', cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(139,26,26,.08)'; e.currentTarget.style.borderColor = '#8b1a1a' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.5)'; e.currentTarget.style.borderColor = 'rgba(58,46,31,.2)' }}
            >
              <span style={{ fontWeight: 700, color: 'rgba(58,46,31,.4)', marginRight: 8 }}>
                {i + 1}.
              </span>
              {step}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(58,46,31,.5)', fontStyle: 'italic', textAlign: 'center' }}>
          Toca el paso donde crees que está el error
        </div>
      </div>
    )
  }

  // CHOOSE BEST PROCEDURE / CHOOSE NEXT STEP
  if (['choose_best_procedure', 'choose_next_step'].includes(interaction.interactionType)) {
    return (
      <div>
        <PromptBlock />
        {data.scenario && (
          <div style={{
            padding: '12px 16px', background: 'rgba(214,178,111,.08)',
            borderLeft: '3px solid #a8854a', borderRadius: 6,
            marginBottom: 14, fontSize: 13.5, color: '#3a2e1f', lineHeight: 1.6,
          }}>
            {data.scenario}
          </div>
        )}
        {(data.options || []).map((opt: string, i: number) => (
          <button key={i} onClick={() => onSubmit(i)} disabled={disabled}
            style={{
              width: '100%', padding: '12px 16px', marginBottom: 8,
              borderRadius: 6, border: '1.5px solid rgba(58,46,31,.25)',
              background: 'rgba(255,255,255,.4)', color: '#3a2e1f',
              fontFamily: 'Georgia, serif', fontSize: 13.5,
              cursor: 'pointer', textAlign: 'left',
            }}>
            <span style={{ fontWeight: 700, color: 'rgba(58,46,31,.4)', marginRight: 8 }}>
              {String.fromCharCode(65 + i)}.
            </span>
            {opt}
          </button>
        ))}
      </div>
    )
  }

  // CONTINUE (sin pregunta)
  if (interaction.interactionType === 'continue') {
    return (
      <div>
        <PromptBlock />
        <button onClick={() => onSubmit('__continue__')} disabled={disabled} style={btnPrimary}>
          Continuar →
        </button>
      </div>
    )
  }

  // FALLBACK: cualquier otro tipo → textarea
  return (
    <div>
      <PromptBlock />
      <div style={{
        padding: '10px 14px', background: 'rgba(139,26,26,.05)',
        borderLeft: '3px solid #8b1a1a', borderRadius: 6,
        marginBottom: 12, fontSize: 12, color: '#3a2e1f',
      }}>
        Escribe tu respuesta:
      </div>
      <textarea value={textAnswer} onChange={e => setTextAnswer(e.target.value)}
        placeholder="Tu respuesta..." rows={4} disabled={disabled}
        style={{
          width: '100%', padding: '14px', borderRadius: 6,
          border: '1.5px solid rgba(58,46,31,.25)',
          background: 'rgba(255,255,255,.6)',
          fontSize: 14, fontFamily: 'Georgia, serif', color: '#3a2e1f',
          outline: 'none', resize: 'vertical', boxSizing: 'border-box',
          marginBottom: 12,
        }} />
      <ConfidencePicker />
      <button onClick={() => onSubmit(textAnswer)} disabled={disabled || !textAnswer.trim()}
        style={{ ...btnPrimary, opacity: !textAnswer.trim() ? 0.4 : 1 }}>
        Responder →
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════

const PAGE_TYPE_LABELS: Record<PageType, string> = {
  theory: '✦ TEORÍA',
  warmup: '✦ INTRODUCCIÓN',
  insight: '💡 IDEA CLAVE',
  connection: '🔗 CONEXIÓN',
  example: '✦ EJEMPLO',
  guided_solution: '✦ SOLUCIÓN GUIADA',
  formula_board: '🧮 FÓRMULA',
  diagram: '📊 DIAGRAMA',
  practice: '✦ PRÁCTICA',
  challenge: '🎯 RETO',
  mini_challenge: '⚡ MINI RETO',
  error: '⚠️ CORRECCIÓN',
  rescue: '🔄 REEXPLICACIÓN',
  checkpoint: '✦ VERIFICACIÓN',
  exam_simulation: '📝 SIMULACRO',
  summary: '📌 RESUMEN',
  reflection: '🧠 REFLEXIÓN',
  session_close: '🏁 CIERRE',
}

const PAGE_TYPE_COLORS: Record<PageType, string> = {
  theory: '#3a2e1f',
  warmup: '#a8854a',
  insight: '#d6b26f',
  connection: '#7c5a0e',
  example: '#a8854a',
  guided_solution: '#5a8a3a',
  formula_board: '#3b82f6',
  diagram: '#7c5a0e',
  practice: '#5a8a3a',
  challenge: '#c66d3c',
  mini_challenge: '#d6b26f',
  error: '#8b1a1a',
  rescue: '#a8854a',
  checkpoint: '#3a2e1f',
  exam_simulation: '#8b1a1a',
  summary: '#3a2e1f',
  reflection: '#5a4a2f',
  session_close: '#5a8a3a',
}

// ═══════════════════════════════════════════════════════════════
// ESTILOS
// ═══════════════════════════════════════════════════════════════

const pageContainerStyle: React.CSSProperties = {
  width: '100%',
  fontFamily: 'Georgia, serif',
  color: '#3a2e1f',
}

const btnPrimary: React.CSSProperties = {
  padding: '12px 28px',
  background: '#3a2e1f',
  color: '#f5ecd5',
  border: 'none',
  borderRadius: 6,
  fontFamily: 'Georgia, serif',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  transition: 'all .15s',
}
