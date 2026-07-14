'use client'

// ═══════════════════════════════════════════════════════════════
// AskWidget v2 — Chat contextual integrado en la sesión
// Solo aparece durante las fases de ENSEÑANZA (no en evaluación)
// Diseño limpio, no flotante — se integra en el flujo
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
  const [expanded, setExpanded] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  useEffect(() => {
    setMessages([])
    setInput('')
    setError(null)
    setExpanded(false)
  }, [microName])

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus()
    }
  }, [expanded])

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
      if (!data.success) throw new Error(data.error || 'Error')
      setMessages([...newMessages, { role: 'assistant', text: data.answer }])
    } catch (err: any) {
      setError(err.message)
      setMessages(newMessages)
    } finally {
      setLoading(false)
    }
  }

  if (!expanded) {
    return (
      <div style={{
        marginTop: 16, marginBottom: 8,
        padding: '10px 16px',
        background: 'rgba(214,178,111,.08)',
        border: '1px dashed rgba(214,178,111,.3)',
        borderRadius: 10,
        display: 'flex', alignItems: 'center', gap: 10,
        cursor: 'pointer',
      }}
        onClick={() => setExpanded(true)}
      >
        <span style={{ fontSize: 16 }}>💬</span>
        <span style={{
          fontSize: 13, color: '#5a4a2f',
          fontFamily: 'Georgia, serif', fontStyle: 'italic',
        }}>
          ¿Tienes alguna duda sobre {microName}? Pregúntame aquí.
        </span>
      </div>
    )
  }

  return (
    <div style={{
      marginTop: 16, marginBottom: 8,
      background: 'rgba(214,178,111,.06)',
      border: '1px solid rgba(214,178,111,.25)',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'rgba(214,178,111,.1)',
        borderBottom: '1px solid rgba(214,178,111,.15)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#3a2e1f', fontFamily: 'Georgia, serif' }}>
          💬 Pregunta sobre {microName}
        </div>
        <button onClick={() => setExpanded(false)} style={{
          background: 'transparent', border: 'none',
          fontSize: 18, cursor: 'pointer', color: '#5a4a2f', padding: 0,
        }}>×</button>
      </div>

      {/* Mensajes */}
      <div ref={scrollRef} style={{
        maxHeight: 200, overflowY: 'auto', padding: '10px 14px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {messages.length === 0 && (
          <div style={{
            fontSize: 12, color: '#5a4a2f', fontStyle: 'italic',
            padding: '6px 10px', background: 'rgba(255,255,255,.4)',
            borderRadius: 6, textAlign: 'center',
          }}>
            Escribe tu duda y te la resuelvo.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%', padding: '8px 12px',
            background: m.role === 'user' ? '#2a1f14' : 'rgba(255,255,255,.7)',
            color: m.role === 'user' ? '#f5ecd5' : '#2a1f14',
            borderRadius: 10, fontSize: 13, lineHeight: 1.5,
          }}>
            {m.role === 'assistant'
              ? <MathText text={autoMath(m.text)} fontSize={13} color="#2a1f14" lineHeight={1.5} />
              : m.text}
          </div>
        ))}
        {loading && (
          <div style={{
            alignSelf: 'flex-start', padding: '8px 12px',
            background: 'rgba(255,255,255,.7)', borderRadius: 10,
            fontSize: 12, color: '#5a4a2f', fontStyle: 'italic',
          }}>Pensando…</div>
        )}
        {error && (
          <div style={{
            padding: '6px 10px', background: 'rgba(139,26,26,.08)',
            borderRadius: 6, fontSize: 11, color: '#8b1a1a',
          }}>{error}</div>
        )}
      </div>

      {/* Input */}
      <div style={{
        padding: '8px 12px 12px', borderTop: '1px solid rgba(214,178,111,.12)',
        display: 'flex', gap: 6,
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Escribe tu duda…"
          rows={1}
          disabled={loading}
          style={{
            flex: 1, padding: '8px 10px', border: '1.5px solid rgba(42,31,20,.12)',
            borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'none',
            background: '#fff', color: '#2a1f14', outline: 'none',
            minHeight: 36, maxHeight: 80,
          }}
        />
        <button onClick={send} disabled={loading || !input.trim()} style={{
          padding: '8px 14px',
          background: input.trim() && !loading ? '#2a1f14' : 'rgba(42,31,20,.2)',
          color: '#f5ecd5', border: 'none', borderRadius: 8,
          fontSize: 13, fontWeight: 700, cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
        }}>→</button>
      </div>
    </div>
  )
}
