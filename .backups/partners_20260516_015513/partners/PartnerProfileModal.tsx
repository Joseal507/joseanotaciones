'use client';

import { PartnerInfo, Message } from './types';
import { Av, fmtTime, getTipoLabel } from './helpers';

export default function PartnerProfileModal({ partner, savedMsgs, onOpenSaved, onClose }: {
  partner: PartnerInfo;
  savedMsgs: Message[];
  onOpenSaved: () => void;
  onClose: () => void;
}) {
  const savedByType = {
    chat: savedMsgs.filter(m => m.type === 'text' || m.type === 'profile_share').length,
    foto: savedMsgs.filter(m => m.type === 'image').length,
    audio: savedMsgs.filter(m => m.type === 'audio').length,
    doc: savedMsgs.filter(m => m.type === 'file').length,
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '0', backdropFilter: 'blur(6px)', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-card)', width: '100%', maxWidth: '480px',
        borderRadius: '0 0 24px 24px',
        overflow: 'hidden',
        animation: 'slideDown 0.25s ease-out',
        border: '1px solid var(--border-color)', borderTop: 'none',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <style>{`@keyframes slideDown{from{transform:translateY(-100%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>

        {/* Banner gradient */}
        <div style={{ height: '100px', background: 'linear-gradient(135deg, #38bdf830 0%, #a78bfa30 50%, #f5c84230 100%)', position: 'relative' }}>
          <button onClick={onClose} style={{ position: 'absolute', top: '12px', right: '14px', background: 'rgba(0,0,0,0.4)', border: 'none', color: '#fff', width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer', fontSize: '14px', fontWeight: 800, backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>

        <div style={{ padding: '0 24px 28px', marginTop: '-44px' }}>

          {/* Avatar + Name */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '16px', marginBottom: '20px' }}>
            <div style={{ border: '4px solid var(--bg-card)', borderRadius: '50%' }}>
              <Av user={partner} size={80} />
            </div>
            <div style={{ paddingBottom: '4px' }}>
              <h2 style={{ fontSize: '22px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 2px', lineHeight: 1.2 }}>{partner.nombre}</h2>
              {partner.descripcion && (
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, fontStyle: 'italic', lineHeight: 1.4 }}>&ldquo;{partner.descripcion}&rdquo;</p>
              )}
            </div>
          </div>

          {/* Info pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
            {partner.tipo_estudiante && (
              <div style={{ padding: '8px 14px', background: 'var(--bg-secondary)', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '16px' }}>{partner.tipo_estudiante === 'universitario' ? '🎓' : partner.tipo_estudiante === 'escuela' ? '🏫' : partner.tipo_estudiante === 'profesional' ? '💼' : '🧠'}</span>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>{getTipoLabel(partner.tipo_estudiante)}</span>
              </div>
            )}
            {partner.carrera && (
              <div style={{ padding: '8px 14px', background: 'var(--bg-secondary)', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--border-color)' }}>
                <span>📚</span>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>{partner.carrera}</span>
              </div>
            )}
            {partner.universidad && (
              <div style={{ padding: '8px 14px', background: 'var(--bg-secondary)', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--border-color)' }}>
                <span>🏫</span>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>{partner.universidad}</span>
              </div>
            )}
          </div>

          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '20px' }}>
            {[
              { l: 'XP', v: partner.xp_total || 0, c: 'var(--gold)', bg: 'rgba(245,200,66,0.1)' },
              { l: 'Racha', v: `${partner.racha_actual || 0}🔥`, c: 'var(--red)', bg: 'rgba(255,77,109,0.1)' },
              { l: 'Flashcards', v: partner.flashcards_estudiadas || 0, c: '#38bdf8', bg: 'rgba(56,189,248,0.1)' },
            ].map((s, i) => (
              <div key={i} style={{ background: s.bg, borderRadius: '14px', padding: '14px 8px', textAlign: 'center', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '20px', fontWeight: 900, color: s.c }}>{s.v}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-faint)', fontWeight: 700, marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.l}</div>
              </div>
            ))}
          </div>

          {/* Saved preview — click opens SavedModal */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>📌 Guardados</h3>
              <button onClick={onOpenSaved}
                style={{ padding: '6px 14px', borderRadius: '10px', border: '1px solid #38bdf8', background: '#38bdf810', color: '#38bdf8', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                Ver todo →
              </button>
            </div>

            {/* Quick counts by type */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
              {[
                { emoji: '💬', label: 'Chat', count: savedByType.chat },
                { emoji: '🖼️', label: 'Fotos', count: savedByType.foto },
                { emoji: '🎵', label: 'Audio', count: savedByType.audio },
                { emoji: '📎', label: 'Docs', count: savedByType.doc },
              ].map((item, i) => (
                <div key={i} onClick={onOpenSaved}
                  style={{ padding: '12px 4px', background: 'var(--bg-secondary)', borderRadius: '12px', textAlign: 'center', cursor: 'pointer', border: '1px solid var(--border-color)', transition: 'border-color 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#38bdf8')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}>
                  <div style={{ fontSize: '20px', marginBottom: '2px' }}>{item.emoji}</div>
                  <div style={{ fontSize: '18px', fontWeight: 900, color: item.count > 0 ? 'var(--text-primary)' : 'var(--text-faint)' }}>{item.count}</div>
                  <div style={{ fontSize: '9px', color: 'var(--text-faint)', fontWeight: 600, marginTop: '2px' }}>{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Public profile button */}
          <button onClick={() => window.location.href = `/u/${partner.user_id}`}
            style={{ width: '100%', padding: '14px', borderRadius: '14px', border: 'none', background: 'linear-gradient(135deg, #38bdf8, #a78bfa)', color: '#fff', fontWeight: 800, fontSize: '14px', cursor: 'pointer', marginTop: '20px', letterSpacing: '0.3px' }}>
            🌐 Ver Perfil Público
          </button>
        </div>

        {/* Handle bar bottom */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 12px' }}>
          <div style={{ width: '36px', height: '4px', borderRadius: '2px', background: 'var(--border-color)' }} />
        </div>
      </div>
    </div>
  );
}
