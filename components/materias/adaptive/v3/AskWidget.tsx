'use client'

// ═══════════════════════════════════════════════════════════════
// AskWidget — Chat contextual "Tengo una duda"
//
// Botón flotante que se muestra cuando el estudiante está en una
// página de enseñanza (sin pregunta activa). Al abrir, permite
// chatear con la AI sobre el concepto actual.
// ═══════════════════════════════════════════════════════════════

import React, { useState, useRef, useEffect } from 'react'
import MathText from '../../../MathText'
import { autoMath } from '../../../../lib/adaptive/v3/ui/autoMath'

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

interface Props {
  microName: string
  microDefinition?: string
  microExamples?: any[]
  microFormulas?: any[]
}

export default function AskWidget({
  microName,
  microDefinition = '',
  microExamples = [],
  microFormulas = [],
}: Props) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Scroll al fondo cuando llegan mensajes nuevos
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  // Reset cuando cambia el micro (nuevo concepto = nuevo contexto)
  useEffect(() => {
    setMessages([])
    setInput('')
    setError(null)
  }, [microName])

  const send = async () => {
    const q = input.trim()
    if (!q || loading) return
    setInput('')
    setError(null)
    const newMessages: ChatMessage[] = [...messages, { role: 'user', text: q }]
    setMessages(newMessages)
    setLoading(true)
    try {
      const res = await fetch('/api/adaptive/v3/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          microName,
          microDefinition,
          microExamples,
          microFormulas,
          question: q,
          history: messages,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Error del servidor')
      setMessages([...newMessages, { role: 'assistant', text: data.answer }])
    } catch (err: any) {
      setError(err.message)
      setMessages(newMessages)  // Revertir mensaje sin respuesta
    } finally {
      setLoading(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  // ─── Botón cerrado ───
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          bottom: 24, right: 24,
          padding: '12px 20px',
          background: 'linear-gradient(135deg, #d6b26f, #b8944f)',
          color: '#2a1f14',
          border: 'none',
          borderRadius: 999,
          fontFamily: 'Georgia, serif',
          fontSize: 14, fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(42,31,20,.2)',
          zIndex: 100,
          display: 'flex', alignItems: 'center', gap: 8,
        }}
        aria-label="Tengo una duda"
      >
        <span style={{ fontSize: 18 }}>❓</span>
        Tengo una duda
      </button>
    )
  }

  // ─── Panel abierto ───
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24, right: 24,
        width: 380, maxWidth: 'calc(100vw - 48px)',
        maxHeight: 'min(560px, calc(100vh - 100px))',
        background: '#f5ecd5',
        borderRadius: 14,
        boxShadow: '0 8px 32px rgba(42,31,20,.25)',
        display: 'flex', flexDirection: 'column',
        zIndex: 100,
        border: '1px solid rgba(42,31,20,.1)',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '14px 18px',
        borderBottom: '1px solid rgba(42,31,20,.08)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'linear-gradient(135deg, rgba(214,178,111,.15), rgba(214,178,111,.05))',
        borderRadius: '14px 14px 0 0',
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#2a1f14' }}>
            Pregúntame sobre esto
          </div>
          <div style={{ fontSize: 11, color: '#5a4a2f', marginTop: 2 }}>
            {microName}
          </div>
        </div>
        <button
          onClick={() => setOpen(false)}
          style={{
            background: 'transparent', border: 'none',
            fontSize: 22, cursor: 'pointer', color: '#5a4a2f',
            lineHeight: 1, padding: 0, width: 28, height: 28,
          }}
          aria-label="Cerrar chat"
        >
          ×
        </button>
      </div>

      {/* Mensajes */}
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: 'auto',
          padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}
      >
        {messages.length === 0 && (
          <div style={{
            fontSize: 13, color: '#5a4a2f', fontStyle: 'italic',
            padding: '10px 14px', background: 'rgba(255,255,255,.4)',
            borderRadius: 8, textAlign: 'center', lineHeight: 1.5,
          }}>
            Escribe cualquier duda sobre <strong>{microName}</strong> y te la resuelvo.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%',
            padding: '10px 14px',
            background: m.role === 'user' ? '#2a1f14' : 'rgba(255,255,255,.7)',
            color: m.role === 'user' ? '#f5ecd5' : '#2a1f14',
            borderRadius: 12,
            fontSize: 14, lineHeight: 1.5,
          }}>
            {m.role === 'assistant'
              ? <MathText text={autoMath(m.text)} fontSize={14} color="#2a1f14" lineHeight={1.5} />
              : m.text
            }
          </div>
        ))}
        {loading && (
          <div style={{
            alignSelf: 'flex-start',
            padding: '10px 14px', background: 'rgba(255,255,255,.7)',
            borderRadius: 12, fontSize: 13, color: '#5a4a2f', fontStyle: 'italic',
          }}>
            Pensando…
          </div>
        )}
        {error && (
          <div style={{
            padding: '8px 12px', background: 'rgba(139,26,26,.08)',
            borderRadius: 8, fontSize: 12, color: '#8b1a1a',
          }}>
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{
        padding: '10px 14px 14px',
        borderTop: '1px solid rgba(42,31,20,.08)',
        display: 'flex', gap: 8,
      }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escribe tu duda…"
          rows={1}
          disabled={loading}
          style={{
            flex: 1, padding: '10px 12px',
            border: '1.5px solid rgba(42,31,20,.15)',
            borderRadius: 8, fontSize: 14,
            fontFamily: 'inherit', resize: 'none',
            background: '#fff', color: '#2a1f14',
            outline: 'none', minHeight: 40, maxHeight: 100,
          }}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={{
            padding: '10px 16px',
            background: input.trim() && !loading ? '#2a1f14' : 'rgba(42,31,20,.3)',
            color: '#f5ecd5', border: 'none', borderRadius: 8,
            fontSize: 14, fontWeight: 700, cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
          }}
        >
          Enviar
        </button>
      </div>
    </div>
  )
}
