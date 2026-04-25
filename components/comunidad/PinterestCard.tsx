'use client';

const TIPO_CONFIG: Record<string, { color: string; label: string; emoji: string; bg: string }> = {
  apunte:     { color: '#38bdf8', label: 'Apunte',     emoji: '📝', bg: 'linear-gradient(135deg,#1e3a5f,#0f2035)' },
  flashcards: { color: '#f472b6', label: 'Flashcards', emoji: '🎴', bg: 'linear-gradient(135deg,#3d1a4a,#1f0d2a)' },
  quiz:       { color: '#a78bfa', label: 'Quiz',       emoji: '🎮', bg: 'linear-gradient(135deg,#1a1a4a,#0d0d2a)' },
};

export default function PinterestCard({ post, userId, liked, onLike, onClick }: any) {
  const cfg = TIPO_CONFIG[post.tipo] || { color: '#f5c842', label: post.tipo, emoji: '📚', bg: '#1a1a2e' };
  const perfil = post.user_profiles;
  const isOwner = post.user_id === userId;

  const preguntas  = post.contenido?.preguntas  || post.contenido?.quiz        || [];
  const flashcards = post.contenido?.flashcards || [];
  const count = post.tipo === 'quiz' ? preguntas.length : post.tipo === 'flashcards' ? flashcards.length : 0;

  return (
    <div
      onClick={onClick}
      style={{
        breakInside: 'avoid',
        marginBottom: '10px',
        borderRadius: '16px',
        overflow: 'hidden',
        cursor: 'pointer',
        position: 'relative',
        border: '1px solid rgba(255,255,255,0.06)',
        transition: 'transform 0.2s, box-shadow 0.2s',
        display: 'block',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1.02)';
        (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 32px ${cfg.color}30`;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
      }}
    >
      {/* IMAGEN O PLACEHOLDER */}
      <div style={{
        width: '100%',
        minHeight: '120px',
        background: post.imagen_url ? 'transparent' : cfg.bg,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {post.imagen_url ? (
          <img
            src={post.imagen_url}
            alt={post.titulo}
            style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: '260px' }}
          />
        ) : (
          <div style={{
            padding: '28px 16px',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: '8px',
            width: '100%',
          }}>
            <div style={{ fontSize: '48px', opacity: 0.4 }}>{cfg.emoji}</div>
            <div style={{
              fontSize: '11px', fontWeight: 900,
              color: cfg.color, opacity: 0.7,
              letterSpacing: '3px', textTransform: 'uppercase',
              background: cfg.color + '15',
              padding: '4px 12px', borderRadius: '20px',
              border: `1px solid ${cfg.color}30`,
            }}>
              {cfg.label}
            </div>
            {count > 0 && (
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>
                {count} {post.tipo === 'quiz' ? 'preguntas' : 'cards'}
              </div>
            )}
          </div>
        )}

        {/* OVERLAY al hover */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.7) 100%)',
        }} />

        {/* BADGE TIPO */}
        <div style={{
          position: 'absolute', top: '8px', left: '8px',
          background: cfg.color + '25', border: `1px solid ${cfg.color}50`,
          borderRadius: '20px', padding: '3px 8px',
          fontSize: '10px', fontWeight: 800, color: cfg.color,
        }}>
          {cfg.emoji} {cfg.label}
        </div>

        {/* LIKE BTN */}
        <button
          onClick={e => { e.stopPropagation(); onLike(); }}
          style={{
            position: 'absolute', top: '8px', right: '8px',
            background: 'rgba(0,0,0,0.5)', border: 'none',
            borderRadius: '20px', padding: '4px 10px',
            fontSize: '12px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '4px',
            color: liked ? '#ef4444' : 'rgba(255,255,255,0.8)',
            fontWeight: 700,
          }}
        >
          {liked ? '❤️' : '🤍'} {post.likes || 0}
        </button>
      </div>

      {/* INFO ABAJO */}
      <div style={{
        background: 'var(--bg-card)',
        padding: '10px 12px',
      }}>
        <p style={{
          fontSize: '13px', fontWeight: 800,
          color: 'var(--text-primary)', margin: '0 0 4px',
          lineHeight: 1.3,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical' as any,
          overflow: 'hidden',
        }}>
          {post.titulo}
        </p>

        {post.descripcion && (
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 6px', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden' }}>
            {post.descripcion}
          </p>
        )}

        {post.materia && (
          <p style={{ fontSize: '11px', color: cfg.color, margin: '0 0 6px', fontWeight: 700 }}>
            {post.emoji} {post.materia}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{
            width: 20, height: 20, borderRadius: '50%',
            background: cfg.color + '30', border: `1.5px solid ${cfg.color}`,
            overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '10px', fontWeight: 800, color: 'var(--text-primary)', flexShrink: 0,
          }}>
            {perfil?.avatar_url
              ? <img src={perfil.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : perfil?.nombre?.[0]?.toUpperCase()
            }
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-faint)', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {perfil?.nombre || 'Usuario'}
          </span>
          {isOwner && (
            <span style={{ fontSize: '9px', background: 'var(--gold-dim)', color: 'var(--gold)', padding: '1px 5px', borderRadius: '4px', fontWeight: 800 }}>TÚ</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>❤️ {post.likes || 0}</span>
          <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>⭐ {post.favorites || 0}</span>
          {(post.views || 0) > 0 && <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>👁️ {post.views || 0}</span>}
          {(post.estudios || 0) > 0 && <span style={{ fontSize: '10px', color: '#4ade80' }}>📚 {post.estudios || 0}</span>}
        </div>
      </div>
    </div>
  );
}
