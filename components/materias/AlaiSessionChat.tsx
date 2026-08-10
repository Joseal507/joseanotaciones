"use client"

import { useEffect, useRef, useState } from "react"

export interface AlaiChatReference {
  stepId: string
  stepTitle: string
}

export interface AlaiChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  references?: AlaiChatReference[]
  usedExternalKnowledge?: boolean
  timestamp: number
}

export const ALAI_CHAT_PANEL_WIDTH = 400

interface AlaiSessionChatProps {
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  messages: AlaiChatMessage[]
  onSendMessage: (message: string) => Promise<void>
  isSending: boolean
  disclaimerVisible: boolean
  onReferenceClick: (stepId: string) => void
  taughtStepIds: string[]
}

// PARTE B — chat ALAI dentro de la sesión. Componente puramente
// presentacional: no llama a la API ni decide asistencia — eso vive
// enteramente en page.tsx (mismo patrón que hintShownRef), este componente
// solo recibe mensajes ya resueltos y notifica intención de envío/apertura.
export function AlaiSessionChat({
  isOpen,
  onOpen,
  onClose,
  messages,
  onSendMessage,
  isSending,
  disclaimerVisible,
  onReferenceClick,
  taughtStepIds,
}: AlaiSessionChatProps) {
  const [draft, setDraft] = useState("")
  const listRef = useRef<HTMLDivElement | null>(null)
  const taughtStepIdSet = new Set(taughtStepIds)

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages.length, isOpen])

  const handleSend = async () => {
    const text = draft.trim()
    if (!text || isSending) return
    setDraft("")
    await onSendMessage(text)
  }

  return (
    <>
      <style>{`
        .alai-chat-panel {
          position: fixed; top: 0; right: 0; height: 100vh; width: ${ALAI_CHAT_PANEL_WIDTH}px;
          max-width: 100vw; background: #0f172a; border-left: 1px solid rgba(148,163,184,0.2);
          box-shadow: -8px 0 24px rgba(0,0,0,0.35); z-index: 1200; display: flex; flex-direction: column;
          transform: translateX(100%); transition: transform .25s ease, visibility 0s linear .25s;
          visibility: hidden;
        }
        .alai-chat-panel[data-open="true"] { transform: translateX(0); visibility: visible; transition: transform .25s ease; }
        .alai-chat-floating-button {
          position: fixed; bottom: 24px; right: 24px; z-index: 1150;
          background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff; border: 0; border-radius: 999px;
          font-weight: 700; font-size: 14px; cursor: pointer;
          box-shadow: 0 8px 24px rgba(99,102,241,0.4); display: flex; align-items: center; gap: 8px;
        }
        @media (max-width: 900px) {
          .alai-chat-panel {
            top: auto; bottom: 0; left: 0; right: 0; width: 100%; height: 60vh;
            border-left: none; border-top: 1px solid rgba(148,163,184,0.2); border-radius: 16px 16px 0 0;
            transform: translateY(100%);
          }
          .alai-chat-panel[data-open="true"] { transform: translateY(0); }
        }
        @media (min-width: 1300px) {
          .alai-session-shell[data-chat-open="true"] { margin-right: ${ALAI_CHAT_PANEL_WIDTH}px; }
        }
      `}</style>

      {!isOpen && (
        <button className="alai-chat-floating-button" onClick={onOpen} style={{ padding: "14px 20px" }}>
          💬 Preguntar a ALAI
        </button>
      )}

      <div className="alai-chat-panel" data-open={isOpen} role="dialog" aria-label="Chat con ALAI">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderBottom: "1px solid rgba(148,163,184,0.15)" }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#e2e8f0" }}>💬 ALAI</div>
          <button onClick={onClose} aria-label="Cerrar chat" style={{ background: "transparent", border: 0, color: "#94a3b8", fontSize: 18, cursor: "pointer", padding: 4 }}>✕</button>
        </div>

        {disclaimerVisible && (
          <div style={{ margin: "12px 16px 0", padding: "10px 12px", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 10, fontSize: 12.5, color: "#fbbf24", lineHeight: 1.4 }}>
            Puedes preguntarle a ALAI. Esta respuesta te ayudará a aprender, pero este intento no contará como una demostración independiente.
          </div>
        )}

        <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
          {messages.length === 0 && (
            <div style={{ fontSize: 13, color: "#64748b", textAlign: "center", marginTop: 24 }}>
              Pregúntale a ALAI sobre lo que ya viste en esta sesión.
            </div>
          )}
          {messages.map(message => (
            <div key={message.id} style={{ alignSelf: message.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%" }}>
              <div style={{
                padding: "10px 14px", borderRadius: 14,
                background: message.role === "user" ? "rgba(99,102,241,0.25)" : "rgba(30,41,59,0.7)",
                border: message.role === "user" ? "1px solid rgba(99,102,241,0.4)" : "1px solid rgba(148,163,184,0.15)",
                color: "#e2e8f0", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap",
              }}>
                {message.content}
              </div>
              {message.usedExternalKnowledge && message.role === "assistant" && (
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>ℹ️ Incluye conocimiento general, no solo del material.</div>
              )}
              {message.references && message.references.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {message.references.map(reference => {
                    const clickable = taughtStepIdSet.has(reference.stepId)
                    return (
                      <button
                        key={reference.stepId}
                        disabled={!clickable}
                        onClick={() => clickable && onReferenceClick(reference.stepId)}
                        style={{
                          fontSize: 11.5, padding: "4px 10px", borderRadius: 999,
                          background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.3)",
                          color: "#93c5fd", cursor: clickable ? "pointer" : "default", opacity: clickable ? 1 : 0.5,
                        }}
                      >
                        📍 {reference.stepTitle}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
          {isSending && (
            <div style={{ alignSelf: "flex-start", fontSize: 13, color: "#94a3b8" }}>ALAI está escribiendo…</div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid rgba(148,163,184,0.15)" }}>
          <input
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); handleSend() } }}
            placeholder="Escribe tu pregunta..."
            disabled={isSending}
            style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(148,163,184,0.25)", background: "rgba(15,23,42,0.6)", color: "#e2e8f0", fontSize: 14 }}
          />
          <button
            onClick={handleSend}
            disabled={isSending || !draft.trim()}
            style={{ padding: "10px 16px", borderRadius: 10, border: 0, background: isSending || !draft.trim() ? "rgba(99,102,241,0.3)" : "#6366f1", color: "#fff", fontWeight: 700, cursor: isSending || !draft.trim() ? "default" : "pointer", fontSize: 14 }}
          >
            Enviar
          </button>
        </div>
      </div>
    </>
  )
}
