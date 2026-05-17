'use client';

import { useState, useRef } from 'react';
import { Message, PartnerInfo } from './types';
import { Av, fmtTime, fmtSize } from './helpers';

const HAND = "'Caveat',cursive";

export default function MessageBubble({
  msg, esMio, partner, miInfo, isMobile, isSavedMsg,
  onGuardar, onBorrar, onEditar, onReply, onCopy, onViewImage, onShowProfile,
  onJumpToMessage, registerRef, jumped,
}: {
  msg: Message;
  esMio: boolean;
  partner: PartnerInfo;
  miInfo: PartnerInfo;
  isMobile: boolean;
  isSavedMsg: boolean;
  onGuardar: (id: string) => void;
  onBorrar: (id: string) => void;
  onEditar: (id: string, content: string) => void;
  onReply: (msg: Message) => void;
  onCopy: (text: string) => void;
  onViewImage: (url: string, id: string) => void;
  onShowProfile: () => void;
  onJumpToMessage: (id: string) => void;
  registerRef: (el: HTMLDivElement | null) => void;
  jumped: boolean;
}) {
  const [showActions, setShowActions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState('');
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openActions = () => setShowActions(true);
  const closeActions = () => setShowActions(false);

  const handleTouchStart = () => {
    if (!isMobile) return;
    longPressTimer.current = setTimeout(openActions, 500);
  };
  const handleTouchEnd = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };
  const handleTouchMove = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  if (msg.deleted_at) {
    return (
      <div ref={registerRef} data-message-id={msg.id} style={{
        display: 'flex', justifyContent: esMio ? 'flex-end' : 'flex-start', marginBottom: 4,
      }}>
        <div style={{
          padding: '6px 14px',
          borderRadius: 12,
          background: 'var(--bg-secondary)',
          border: '2px dashed var(--border-color)',
          opacity: 0.55,
          transform: 'rotate(-0.5deg)',
        }}>
          <p style={{
            fontFamily: HAND, fontSize: 15, fontStyle: 'italic',
            color: 'var(--text-faint)', margin: 0,
          }}>
            🚫 ~ eliminado ~
          </p>
        </div>
      </div>
    );
  }

  const replyPreview = msg.metadata?.reply_preview;
  const replyToId = msg.metadata?.reply_to;

  const bubbleRot = esMio ? -0.4 : 0.4;
  const shadowColor = jumped ? '#38bdf8' : isSavedMsg ? 'var(--gold)' : esMio ? '#38bdf8' : 'var(--text-primary)';

  const bubble: any = {
    padding: '10px 14px',
    borderRadius: esMio ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
    background: esMio ? '#38bdf8' : 'var(--bg-card)',
    position: 'relative',
    maxWidth: '100%',
    border: `2px ${isSavedMsg ? 'solid' : esMio ? 'solid' : 'solid'} ${jumped ? '#38bdf8' : isSavedMsg ? 'var(--gold)' : 'var(--text-primary)'}`,
    boxShadow: `2px 3px 0 ${shadowColor}${jumped ? ', 0 0 0 4px rgba(56,189,248,0.15), 0 0 18px rgba(56,189,248,0.3)' : isSavedMsg ? ', 0 0 12px color-mix(in srgb, var(--gold) 25%, transparent)' : ''}`,
    transition: 'box-shadow 0.25s ease, border-color 0.25s ease, transform 0.2s',
    userSelect: 'none' as const,
    WebkitUserSelect: 'none' as const,
    transform: `rotate(${bubbleRot}deg)`,
  };

  const actions: { label: string; icon: string; fn: () => void; color?: string; danger?: boolean }[] = [];

  if (msg.type === 'text') {
    actions.push({ label: 'Copiar', icon: '📋', fn: () => { onCopy(msg.content); closeActions(); } });
    if (esMio) actions.push({ label: 'Editar', icon: '✏️', fn: () => { setEditing(true); setEditVal(msg.content); closeActions(); } });
  }
  actions.push({
    label: isSavedMsg ? 'Guardado' : 'Guardar',
    icon: '📌',
    fn: () => { onGuardar(msg.id); closeActions(); },
    color: isSavedMsg ? 'var(--gold)' : undefined,
  });
  actions.push({ label: 'Responder', icon: '↩️', fn: () => { onReply(msg); closeActions(); } });
  if (esMio) actions.push({ label: 'Borrar', icon: '🗑️', fn: () => { onBorrar(msg.id); closeActions(); }, danger: true });

  return (
    <div
      ref={registerRef}
      data-message-id={msg.id}
      style={{
        display: 'flex', justifyContent: esMio ? 'flex-end' : 'flex-start',
        gap: 6, alignItems: 'flex-end', marginBottom: 10, position: 'relative',
      }}
    >
      {!esMio && <Av user={partner} size={26} onClick={onShowProfile} />}

      <div
        style={{ maxWidth: '75%', position: 'relative' }}
        onMouseEnter={() => { if (!isMobile && !editing) openActions(); }}
        onMouseLeave={() => { if (!isMobile) closeActions(); }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
      >
        {showActions && !editing && (
          <>
            {isMobile && (
              <div onClick={closeActions} style={{ position: 'fixed', inset: 0, zIndex: 49, background: 'rgba(0,0,0,0.25)' }} />
            )}
            <div style={{
              position: 'absolute', bottom: '100%',
              left: esMio ? 'auto' : 0, right: esMio ? 0 : 'auto',
              zIndex: 50, paddingBottom: 6,
              animation: 'fadeUpAct 0.18s cubic-bezier(.34,1.4,.64,1)',
            }}>
              <style>{`@keyframes fadeUpAct{from{opacity:0;transform:translateY(8px) rotate(-2deg)}to{opacity:1;transform:translateY(0) rotate(-1deg)}}`}</style>
              <div style={{
                display: 'flex', gap: 3,
                background: 'var(--bg-card)',
                padding: '5px 7px',
                borderRadius: 12,
                border: '2.5px solid var(--text-primary)',
                boxShadow: '3px 4px 0 var(--text-primary)',
                transform: 'rotate(-1deg)',
              }}>
                {actions.map((a, i) => (
                  <button key={i}
                    onClick={(e: any) => { e.stopPropagation(); a.fn(); }}
                    title={a.label}
                    style={{
                      padding: isMobile ? '8px 12px' : '6px 10px',
                      borderRadius: 8,
                      border: 'none',
                      background: a.danger ? 'color-mix(in srgb,var(--red) 16%,transparent)'
                        : a.color ? `${a.color}22` : 'transparent',
                      color: a.danger ? 'var(--red)' : a.color || 'var(--text-primary)',
                      fontFamily: HAND,
                      fontSize: isMobile ? 17 : 14,
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 4,
                      fontWeight: 800,
                      whiteSpace: 'nowrap',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e:any)=>{e.currentTarget.style.background = a.danger ? 'color-mix(in srgb,var(--red) 28%,transparent)' : a.color ? `${a.color}44` : 'var(--bg-secondary)';}}
                    onMouseLeave={(e:any)=>{e.currentTarget.style.background = a.danger ? 'color-mix(in srgb,var(--red) 16%,transparent)' : a.color ? `${a.color}22` : 'transparent';}}
                  >
                    <span>{a.icon}</span>
                    {!isMobile && <span>{a.label}</span>}
                  </button>
                ))}
                {isMobile && (
                  <button onClick={closeActions}
                    style={{
                      padding: '8px 10px', borderRadius: 8,
                      border: 'none', background: 'var(--bg-secondary)',
                      color: 'var(--text-faint)',
                      fontFamily: HAND, fontSize: 17, fontWeight: 800,
                      cursor: 'pointer',
                    }}>
                    ✕
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {replyPreview && (
          <div
            onClick={(e: any) => { e.stopPropagation(); if (replyToId) onJumpToMessage(replyToId); }}
            style={{
              padding: '6px 12px',
              marginBottom: 4,
              borderLeft: '3px solid #38bdf8',
              borderTop: '1.5px dashed #38bdf855',
              borderRight: '1.5px dashed #38bdf855',
              borderBottom: '1.5px dashed #38bdf855',
              background: 'color-mix(in srgb,#38bdf8 12%,transparent)',
              borderRadius: '4px 10px 10px 4px',
              fontFamily: HAND, fontSize: 14, fontStyle: 'italic',
              color: 'var(--text-muted)',
              cursor: replyToId ? 'pointer' : 'default',
              transform: 'rotate(-0.4deg)',
            }}
          >
            ↩️ ~ {replyPreview} ~
          </div>
        )}

        {editing ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              autoFocus
              value={editVal}
              onChange={(e: any) => setEditVal(e.target.value)}
              onKeyDown={(e: any) => {
                if (e.key === 'Enter') { onEditar(msg.id, editVal); setEditing(false); }
                if (e.key === 'Escape') setEditing(false);
              }}
              style={{
                flex: 1, padding: '8px 12px',
                borderRadius: 10,
                border: '2.5px solid #38bdf8',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                fontFamily: HAND, fontSize: 17, fontWeight: 600,
                outline: 'none',
                boxShadow: '2px 2px 0 #38bdf8',
              }}
            />
            <button onClick={() => { onEditar(msg.id, editVal); setEditing(false); }}
              style={{
                padding: '8px 14px',
                borderRadius: 10,
                border: '2px solid var(--text-primary)',
                background: '#38bdf8', color: '#000',
                fontFamily: HAND, fontSize: 17, fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '2px 2px 0 var(--text-primary)',
              }}>
              ✓
            </button>
            <button onClick={() => setEditing(false)}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: '2px dashed var(--text-faint)',
                background: 'transparent', color: 'var(--text-faint)',
                fontFamily: HAND, fontSize: 16, fontWeight: 800,
                cursor: 'pointer',
              }}>
              ✕
            </button>
          </div>
        ) : msg.type === 'image' && msg.file_url ? (
          <div style={{ ...bubble, padding: 5, overflow: 'hidden', cursor: 'pointer' }} onDoubleClick={() => onViewImage(msg.file_url!, msg.id)}>
            <img src={msg.file_url} alt=""
              style={{
                maxWidth: 250, maxHeight: 250,
                objectFit: 'contain', display: 'block',
                borderRadius: 12, pointerEvents: 'none',
              }} />
            {isSavedMsg && (
              <div style={{
                position: 'absolute', top: 10, right: 10,
                background: 'var(--gold)',
                border: '2px solid var(--text-primary)',
                boxShadow: '1px 2px 0 var(--text-primary)',
                borderRadius: 8,
                padding: '2px 7px',
                fontFamily: HAND, fontSize: 14, fontWeight: 900,
                color: '#000',
                transform: 'rotate(-5deg)',
              }}>
                📌
              </div>
            )}
          </div>
        ) : msg.type === 'audio' && msg.file_url ? (
          <div style={{ ...bubble, minWidth: 220 }}>
            <p style={{
              fontFamily: HAND, fontSize: 14, fontWeight: 800,
              color: esMio ? '#000' : 'var(--text-faint)',
              fontStyle: 'italic',
              margin: '0 0 6px',
            }}>
              🎵 ~ audio ~
            </p>
            <audio controls src={msg.file_url} preload="metadata" style={{ width: '100%', height: 36 }} />
          </div>
        ) : msg.type === 'file' && msg.file_url ? (
          <div style={{ ...bubble, cursor: 'pointer' }} onClick={() => window.open(msg.file_url!, '_blank')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 26 }}>📎</span>
              <div>
                <p style={{
                  fontFamily: HAND, fontSize: 17, fontWeight: 800,
                  color: esMio ? '#000' : 'var(--text-primary)',
                  margin: 0, lineHeight: 1.1,
                }}>
                  {msg.file_name}
                </p>
                <p style={{
                  fontFamily: HAND, fontSize: 13, fontStyle: 'italic',
                  color: esMio ? 'rgba(0,0,0,0.6)' : 'var(--text-faint)',
                  margin: 0,
                }}>
                  ~ {fmtSize(msg.file_size)} ~
                </p>
              </div>
            </div>
          </div>
        ) : msg.type === 'profile_share' && msg.metadata?.url ? (
          <div onClick={() => window.location.href = msg.metadata.url} style={{ ...bubble, cursor: 'pointer' }}>
            <p style={{
              fontFamily: HAND, fontSize: 14, fontWeight: 800,
              color: esMio ? '#000' : '#38bdf8',
              fontStyle: 'italic',
              margin: '0 0 4px',
            }}>
              🌐 ~ perfil ~
            </p>
            <p style={{
              fontFamily: HAND, fontSize: 19, fontWeight: 900,
              color: esMio ? '#000' : 'var(--text-primary)',
              margin: 0,
            }}>
              {msg.metadata.nombre} →
            </p>
          </div>
        ) : (
          <div style={bubble}>
            <p style={{
              fontFamily: HAND, fontSize: 19, fontWeight: 600,
              color: esMio ? '#000' : 'var(--text-primary)',
              margin: 0, lineHeight: 1.35,
              wordBreak: 'break-word',
            }}>
              {msg.content}
            </p>
          </div>
        )}

        <div style={{
          display: 'flex', justifyContent: esMio ? 'flex-end' : 'flex-start',
          alignItems: 'center', gap: 6, margin: '3px 4px 0',
        }}>
          <span style={{
            fontFamily: HAND, fontSize: 12, fontStyle: 'italic',
            color: 'var(--text-faint)',
          }}>
            ~ {fmtTime(msg.created_at)}{msg.edited_at ? ' · editado' : ''}{esMio && msg.read_at ? ' · ✓✓' : ''} ~
          </span>
          {isSavedMsg && <span style={{ fontSize: 12, color: 'var(--gold)' }}>📌</span>}
          {msg.expires_at && !isSavedMsg && <span style={{ fontSize: 12, color: 'var(--red)' }}>⏳</span>}
        </div>
      </div>

      {esMio && <Av user={miInfo} size={26} />}
    </div>
  );
}