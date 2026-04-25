'use client';

export default function PostCard({ post, userId }: { post: any, userId?: string }) {
  const color = post.color || '#f5c842';
  const autor = post.user_id === userId ? 'Tú' : (post.user_profiles?.nombre || 'Estudiante');
  const avatar = post.user_profiles?.avatar_url;
  const inicial = autor[0]?.toUpperCase() || '?';
  const isBot = post._bot;

  const tipoLabel = post.tipo === 'quiz' ? '🤓 Quiz' : post.tipo === 'flashcard' ? '🎴 Flashcards' : '📝 Apunte';
  const tipoColor = post.tipo === 'quiz' ? '#a78bfa' : post.tipo === 'flashcard' ? '#38bdf8' : color;

  const previewText = (() => {
    if (!post.contenido) return '';
    if (post.contenido.tipo === 'quiz') return (post.contenido.preguntas?.length || 0) + ' preguntas · ' + (post.contenido.dificultad === 'hard' ? '🔴 Difícil' : post.contenido.dificultad === 'easy' ? '🟢 Fácil' : '🟡 Medio');
    if (post.contenido.tipo === 'flashcard') return (post.contenido.flashcards?.length || 0) + ' tarjetas';
    if (post.contenido.paginas) return (post.contenido.paginas?.length || 0) + ' páginas';
    return post.descripcion || '';
  })();

  const fecha = post.created_at ? new Date(post.created_at).toLocaleDateString() : '';

  return (
    <div style={{
      background: 'var(--bg-card)', borderRadius: '16px', overflow: 'hidden',
      border: '1px solid var(--border-color)', cursor: 'pointer', transition: 'all 0.2s',
    }} className="post-card-hover">

      {/* Imagen o gradient */}
      {post.imagen_url ? (
        <div style={{ position: 'relative' }}>
          <img src={post.imagen_url} style={{ width: '100%', display: 'block', height: '140px', objectFit: 'cover' }} alt="" />
          <div style={{ position: 'absolute', top: '8px', left: '8px', background: tipoColor, color: '#000', padding: '3px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 800 }}>{tipoLabel}</div>
        </div>
      ) : (
        <div style={{ height: '90px', background: `linear-gradient(135deg, ${color}22, ${color}08)`, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <span style={{ fontSize: '36px', opacity: 0.6 }}>{post.emoji}</span>
          <div style={{ position: 'absolute', top: '8px', left: '8px', background: tipoColor + '20', border: '1px solid ' + tipoColor + '44', color: tipoColor, padding: '3px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 800 }}>{tipoLabel}</div>
        </div>
      )}

      <div style={{ padding: '12px 14px' }}>
        {/* Materia */}
        <div style={{ fontSize: '10px', color: color, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
          {post.emoji} {post.materia}
        </div>

        {/* Título */}
        <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
          {post.titulo}
        </h3>

        {/* Descripción/Preview */}
        {(post.descripcion || previewText) && (
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
            {post.descripcion || previewText}
          </p>
        )}

        {/* Author + Stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
          {avatar ? (
            <img src={avatar} style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }} alt="" />
          ) : (
            <div style={{ width: 20, height: 20, borderRadius: '50%', background: color, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 900 }}>{inicial}</div>
          )}
          <span onClick={(e) => { e.stopPropagation(); if (post.user_id && !post._bot) window.location.href = '/perfil?uid=' + post.user_id; }} style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: post._bot ? 'default' : 'pointer', textDecoration: post._bot ? 'none' : 'underline' }}>{autor}</span>
          <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--text-faint)' }}>
            <span>❤️ {post.likes || 0}</span>
            <span>⭐ {post.favorites || 0}</span>
          </div>
        </div>

        {fecha && <p style={{ fontSize: '9px', color: 'var(--text-faint)', margin: '6px 0 0', textAlign: 'right' }}>{fecha}</p>}
      </div>

      <style jsx>{`
        .post-card-hover:hover { transform: translateY(-3px); border-color: var(--border-color2); box-shadow: 0 8px 30px rgba(0,0,0,0.3); }
      `}</style>
    </div>
  );
}
