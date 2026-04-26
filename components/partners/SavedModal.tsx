'use client';

import { useState } from 'react';
import { Message } from './types';
import { fmtTime, fmtSize } from './helpers';

const TABS = [
  { id: 'chat', emoji: '💬', label: 'Chat' },
  { id: 'foto', emoji: '🖼️', label: 'Fotos' },
  { id: 'audio', emoji: '🎵', label: 'Audio' },
  { id: 'doc', emoji: '📎', label: 'Docs' },
] as const;

type TabId = typeof TABS[number]['id'];

function filterByTab(msgs: Message[], tab: TabId): Message[] {
  switch (tab) {
    case 'chat': return msgs.filter(m => m.type === 'text' || m.type === 'profile_share');
    case 'foto': return msgs.filter(m => m.type === 'image');
    case 'audio': return msgs.filter(m => m.type === 'audio');
    case 'doc': return msgs.filter(m => m.type === 'file');
  }
}

export default function SavedModal({ savedMsgs, onGuardar, onViewImage, onClose }: {
  savedMsgs: Message[];
  onGuardar: (id: string) => void;
  onViewImage: (url: string, id: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabId>('chat');
  const filtered = filterByTab(savedMsgs, tab);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backdropFilter: 'blur(6px)' }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-card)', borderRadius: '24px', width: '100%', maxWidth: '520px',
        maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>

        {/* Header */}
        <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h3 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 2px' }}>📌 Guardados</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>{savedMsgs.length} items</p>
            </div>
            <button onClick={onClose} style={{ background: 'var(--bg-secondary)', border: 'none', color: 'var(--text-faint)', width: '32px', height: '32px', borderRadius: '50%', fontSize: '15px', cursor: 'pointer', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '6px', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
            {TABS.map(t => {
              const count = filterByTab(savedMsgs, t.id).length;
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  style={{
                    flex: 1, padding: '10px 4px', borderRadius: '12px', border: 'none',
                    background: active ? '#38bdf815' : 'var(--bg-secondary)',
                    color: active ? '#38bdf8' : 'var(--text-faint)',
                    cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                    fontWeight: active ? 800 : 500, fontSize: '12px',
                    outline: active ? '2px solid #38bdf8' : 'none',
                  }}>
                  <span style={{ fontSize: '18px' }}>{t.emoji}</span>
                  <span>{t.label}</span>
                  {count > 0 && <span style={{ background: active ? '#38bdf8' : 'var(--border-color)', color: active ? '#000' : 'var(--text-faint)', borderRadius: '8px', padding: '0px 6px', fontSize: '10px', fontWeight: 900 }}>{count}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content — scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px' }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-faint)' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>{TABS.find(t => t.id === tab)?.emoji}</div>
              <p style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 4px', color: 'var(--text-muted)' }}>Nada guardado</p>
              <p style={{ fontSize: '12px', margin: 0 }}>Mantén presionado un mensaje para guardar</p>
            </div>
          ) : tab === 'foto' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
              {filtered.map(m => (
                <div key={m.id} style={{ position: 'relative', aspectRatio: '1', borderRadius: '12px', overflow: 'hidden', cursor: 'pointer' }}
                  onClick={() => { onClose(); onViewImage(m.file_url!, m.id); }}>
                  <img src={m.file_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(transparent 60%, rgba(0,0,0,0.6))' }} />
                  <div style={{ position: 'absolute', bottom: '6px', left: '6px', fontSize: '9px', color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>{fmtTime(m.created_at)}</div>
                  <button onClick={e => { e.stopPropagation(); onGuardar(m.id); }}
                    style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(0,0,0,0.5)', border: 'none', color: '#f5c842', borderRadius: '50%', width: '26px', height: '26px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📌</button>
                </div>
              ))}
            </div>
          ) : tab === 'audio' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filtered.map(m => (
                <div key={m.id} style={{ padding: '14px 16px', background: 'var(--bg-secondary)', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'linear-gradient(135deg, #a78bfa, #38bdf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>🎵</div>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Mensaje de voz</p>
                      <p style={{ fontSize: '10px', color: 'var(--text-faint)', margin: '2px 0 0' }}>{fmtTime(m.created_at)}</p>
                    </div>
                    <button onClick={() => onGuardar(m.id)} style={{ padding: '6px 8px', borderRadius: '8px', border: 'none', background: '#f5c84222', color: '#f5c842', fontSize: '14px', cursor: 'pointer' }}>📌</button>
                  </div>
                  <audio controls src={m.file_url} preload="metadata" style={{ width: '100%', height: '36px' }} />
                </div>
              ))}
            </div>
          ) : tab === 'doc' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filtered.map(m => (
                <div key={m.id} onClick={() => window.open(m.file_url!, '_blank')}
                  style={{ padding: '14px 16px', background: 'var(--bg-secondary)', borderRadius: '16px', border: '1px solid var(--border-color)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'linear-gradient(135deg, #f5c842, #ff6b6b)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>📎</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.file_name}</p>
                    <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: 0 }}>{fmtSize(m.file_size)} · {fmtTime(m.created_at)}</p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); onGuardar(m.id); }} style={{ padding: '6px 8px', borderRadius: '8px', border: 'none', background: '#f5c84222', color: '#f5c842', fontSize: '14px', cursor: 'pointer', flexShrink: 0 }}>📌</button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filtered.map(m => (
                <div key={m.id} style={{ padding: '14px 16px', background: 'var(--bg-secondary)', borderRadius: '16px', border: '1px solid var(--border-color)', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#38bdf815', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0, marginTop: '2px' }}>💬</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '14px', color: 'var(--text-primary)', margin: '0 0 4px', lineHeight: 1.5, wordBreak: 'break-word' }}>{m.content}</p>
                    <p style={{ fontSize: '10px', color: 'var(--text-faint)', margin: 0 }}>{fmtTime(m.created_at)}</p>
                  </div>
                  <button onClick={() => onGuardar(m.id)} style={{ padding: '6px 8px', borderRadius: '8px', border: 'none', background: '#f5c84222', color: '#f5c842', fontSize: '14px', cursor: 'pointer', flexShrink: 0, marginTop: '2px' }}>📌</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
