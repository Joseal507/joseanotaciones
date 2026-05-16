'use client';

import { useState, useRef } from 'react';
import { Message, PartnerInfo } from './types';
import { Av, fmtTime, fmtSize } from './helpers';

export default function MessageBubble({
  msg,
  esMio,
  partner,
  miInfo,
  isMobile,
  isSavedMsg,
  onGuardar,
  onBorrar,
  onEditar,
  onReply,
  onCopy,
  onViewImage,
  onShowProfile,
  onJumpToMessage,
  registerRef,
  jumped,
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
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTouchMove = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  if (msg.deleted_at) {
    return (
      <div ref={registerRef} data-message-id={msg.id} style={{ display: 'flex', justifyContent: esMio ? 'flex-end' : 'flex-start', marginBottom: '4px' }}>
        <div style={{ padding: '6px 12px', borderRadius: '12px', background: 'var(--bg-secondary)', opacity: 0.5 }}>
          <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0, fontStyle: 'italic' }}>🚫 Eliminado</p>
        </div>
      </div>
    );
  }

  const replyPreview = msg.metadata?.reply_preview;
  const replyToId = msg.metadata?.reply_to;

  const bubbleBorder = jumped
    ? '2px solid #38bdf8'
    : isSavedMsg
      ? '2px solid #f5c842'
      : esMio
        ? 'none'
        : '1px solid var(--border-color)';

  const bubbleShadow = jumped
    ? '0 0 0 4px rgba(56,189,248,0.20), 0 0 18px rgba(56,189,248,0.30)'
    : isSavedMsg
      ? '0 0 12px rgba(245,200,66,0.25)'
      : undefined;

  const bubble: any = {
    padding: '10px 14px',
    borderRadius: esMio ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
    background: esMio ? '#38bdf8' : 'var(--bg-card)',
    position: 'relative',
    maxWidth: '100%',
    border: bubbleBorder,
    boxShadow: bubbleShadow,
    transition: 'box-shadow 0.25s ease, border-color 0.25s ease',
    userSelect: 'none' as const,
    WebkitUserSelect: 'none' as const,
  };

  const actions: { label: string; icon: string; fn: () => void; color?: string; danger?: boolean }[] = [];

  if (msg.type === 'text') {
    actions.push({ label: 'Copiar', icon: '📋', fn: () => { onCopy(msg.content); closeActions(); } });
    if (esMio) {
      actions.push({ label: 'Editar', icon: '✏️', fn: () => { setEditing(true); setEditVal(msg.content); closeActions(); } });
    }
  }

  actions.push({
    label: isSavedMsg ? 'Guardado' : 'Guardar',
    icon: '📌',
    fn: () => { onGuardar(msg.id); closeActions(); },
    color: isSavedMsg ? '#f5c842' : undefined,
  });

  actions.push({
    label: 'Responder',
    icon: '↩️',
    fn: () => { onReply(msg); closeActions(); },
  });

  if (esMio) {
    actions.push({
      label: 'Borrar',
      icon: '🗑️',
      fn: () => { onBorrar(msg.id); closeActions(); },
      danger: true,
    });
  }

  return (
    <div
      ref={registerRef}
      data-message-id={msg.id}
      style={{ display: 'flex', justifyContent: esMio ? 'flex-end' : 'flex-start', gap: '6px', alignItems: 'flex-end', marginBottom: '8px', position: 'relative' }}
    >
      {!esMio && <Av user={partner} size={24} onClick={onShowProfile} />}

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
            <div style={{ position: 'absolute', bottom: '100%', left: esMio ? 'auto' : '0', right: esMio ? '0' : 'auto', zIndex: 50, paddingBottom: '6px', animation: 'fadeUp 0.12s ease-out' }}>
              <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}`}</style>
              <div style={{ display: 'flex', gap: '2px', background: 'var(--bg-card)', padding: '4px 6px', borderRadius: '12px', boxShadow: '0 4px 24px rgba(0,0,0,0.5)', border: '1px solid var(--border-color)' }}>
                {actions.map((a, i) => (
                  <button
                    key={i}
                    onClick={e => { e.stopPropagation(); a.fn(); }}
                    title={a.label}
                    style={{
                      padding: isMobile ? '8px 12px' : '5px 8px',
                      borderRadius: '8px',
                      border: 'none',
                      background: a.danger ? 'rgba(255,77,109,0.12)' : a.color ? `${a.color}22` : 'transparent',
                      color: a.danger ? 'var(--red)' : a.color || 'var(--text-primary)',
                      fontSize: isMobile ? '16px' : '13px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span>{a.icon}</span>
                    {!isMobile && <span style={{ fontSize: '11px' }}>{a.label}</span>}
                  </button>
                ))}
                {isMobile && (
                  <button onClick={closeActions} style={{ padding: '8px 10px', borderRadius: '8px', border: 'none', background: 'var(--bg-secondary)', color: 'var(--text-faint)', fontSize: '14px', cursor: 'pointer' }}>✕</button>
                )}
              </div>
            </div>
          </>
        )}

        {replyPreview && (
          <div
            onClick={e => {
              e.stopPropagation();
              if (replyToId) onJumpToMessage(replyToId);
            }}
            style={{
              padding: '5px 10px',
              marginBottom: '3px',
              borderLeft: '3px solid #38bdf8',
              background: 'rgba(56,189,248,0.08)',
              borderRadius: '4px 8px 8px 4px',
              fontSize: '11px',
              color: 'var(--text-faint)',
              cursor: replyToId ? 'pointer' : 'default',
            }}
          >
            ↩️ {replyPreview}
          </div>
        )}

        {editing ? (
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              autoFocus
              value={editVal}
              onChange={e => setEditVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  onEditar(msg.id, editVal);
                  setEditing(false);
                }
                if (e.key === 'Escape') setEditing(false);
              }}
              style={{ flex: 1, padding: '8px 12px', borderRadius: '10px', border: '2px solid #38bdf8', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }}
            />
            <button onClick={() => { onEditar(msg.id, editVal); setEditing(false); }} style={{ padding: '8px 12px', borderRadius: '10px', border: 'none', background: '#38bdf8', color: '#000', fontWeight: 800, cursor: 'pointer' }}>✓</button>
            <button onClick={() => setEditing(false)} style={{ padding: '8px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer' }}>✕</button>
          </div>
        ) : msg.type === 'image' && msg.file_url ? (
          <div style={{ ...bubble, padding: '4px', overflow: 'hidden', cursor: 'pointer' }} onDoubleClick={() => onViewImage(msg.file_url!, msg.id)}>
            <img src={msg.file_url} alt="" style={{ maxWidth: '250px', maxHeight: '250px', objectFit: 'contain', display: 'block', borderRadius: '14px', pointerEvents: 'none' }} />
            {isSavedMsg && <div style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.6)', borderRadius: '50%', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}>📌</div>}
          </div>
        ) : msg.type === 'audio' && msg.file_url ? (
          <div style={{ ...bubble, minWidth: '220px' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, color: esMio ? '#000' : 'var(--text-faint)', margin: '0 0 6px' }}>🎵 Audio</p>
            <audio controls src={msg.file_url} preload="metadata" style={{ width: '100%', height: '36px' }} />
          </div>
        ) : msg.type === 'file' && msg.file_url ? (
          <div style={{ ...bubble, cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }} onClick={() => window.open(msg.file_url!, '_blank')}>
              <span style={{ fontSize: '24px' }}>📎</span>
              <div>
                <p style={{ fontSize: '13px', fontWeight: 700, color: esMio ? '#000' : 'var(--text-primary)', margin: 0 }}>{msg.file_name}</p>
                <p style={{ fontSize: '11px', color: esMio ? '#00000088' : 'var(--text-faint)', margin: 0 }}>{fmtSize(msg.file_size)}</p>
              </div>
            </div>
          </div>
        ) : msg.type === 'profile_share' && msg.metadata?.url ? (
          <div onClick={() => window.location.href = msg.metadata.url} style={{ ...bubble, cursor: 'pointer' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, color: esMio ? '#000' : '#38bdf8', margin: '0 0 4px' }}>🌐 Perfil</p>
            <p style={{ fontSize: '14px', fontWeight: 800, color: esMio ? '#000' : 'var(--text-primary)', margin: 0 }}>{msg.metadata.nombre} →</p>
          </div>
        ) : (
          <div style={bubble}>
            <p style={{ fontSize: '14px', color: esMio ? '#000' : 'var(--text-primary)', margin: 0, lineHeight: 1.5, wordBreak: 'break-word' }}>{msg.content}</p>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: esMio ? 'flex-end' : 'flex-start', alignItems: 'center', gap: '6px', margin: '2px 4px 0' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>
            {fmtTime(msg.created_at)}{msg.edited_at ? ' · editado' : ''}{esMio && msg.read_at ? ' · visto' : ''}
          </span>
          {isSavedMsg && <span style={{ fontSize: '10px', color: '#f5c842' }}>📌</span>}
          {msg.expires_at && !isSavedMsg && <span style={{ fontSize: '10px', color: 'var(--red)' }}>⏳</span>}
        </div>
      </div>

      {esMio && <Av user={miInfo} size={24} />}
    </div>
  );
}
