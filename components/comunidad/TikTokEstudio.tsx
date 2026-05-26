'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

interface Post {
  id: string;
  user_id: string;
  user_nombre: string;
  user_avatar?: string;
  tipo: 'apunte' | 'flashcards' | 'quiz' | 'post';
  titulo: string;
  descripcion?: string;
  portada_url?: string;
  materia_nombre?: string;
  materia_color?: string;
  materia_emoji?: string;
  likes_count: number;
  user_liked: boolean;
  guardado: boolean;
  comentarios_count: number;
  views: number;
  created_at: string;
}

const TIPO_INFO: Record<string, { emoji: string; label: string; color: string }> = {
  apunte:     { emoji: '📝', label: 'Apunte',     color: 'var(--gold)' },
  flashcards: { emoji: '🎴', label: 'Flashcards', color: '#a78bfa' },
  quiz:       { emoji: '🧠', label: 'Quiz',       color: '#34d399' },
  post:       { emoji: '💬', label: 'Post',       color: '#38bdf8' },
};

interface Props {
  userId: string;
}

export default function TikTokEstudio({ userId }: Props) {
  const [posts, setPosts]         = useState<Post[]>([]);
  const [current, setCurrent]     = useState(0);
  const [loading, setLoading]     = useState(true);
  const [page, setPage]           = useState(1);
  const [hasMore, setHasMore]     = useState(true);
  const [likeAnim, setLikeAnim]   = useState(false);
  const [saveAnim, setSaveAnim]   = useState(false);
  const [showHeart, setShowHeart] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartY  = useRef<number>(0);
  const lastTap      = useRef<number>(0);

  // ── Cargar posts ──────────────────────────────────────────
  const cargar = useCallback(async (p = 1) => {
    try {
      const res = await fetch(
        `/api/comunidad/posts?tipo=all&filtro=todos&userId=${userId}&page=${p}`
      );
      const data = await res.json();
      const nuevos: Post[] = data.posts || [];
      if (p === 1) setPosts(nuevos);
      else setPosts(prev => [...prev, ...nuevos]);
      setHasMore(nuevos.length === 20);
    } catch {}
    setLoading(false);
  }, [userId]);

  useEffect(() => { cargar(1); }, [cargar]);

  // ── Navegar ───────────────────────────────────────────────
  const goNext = useCallback(() => {
    if (current < posts.length - 1) {
      setCurrent(c => c + 1);
      if (current >= posts.length - 4 && hasMore) {
        const next = page + 1;
        setPage(next);
        cargar(next);
      }
    }
  }, [current, posts.length, hasMore, page, cargar]);

  const goPrev = useCallback(() => {
    if (current > 0) setCurrent(c => c - 1);
  }, [current]);

  // ── Teclado ───────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowUp'   || e.key === 'ArrowLeft')  goPrev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev]);

  // ── Touch swipe ───────────────────────────────────────────
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    // Doble tap → like
    const now = Date.now();
    if (now - lastTap.current < 300) handleLike();
    lastTap.current = now;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartY.current - e.changedTouches[0].clientY;
    if (Math.abs(diff) < 50) return;
    if (diff > 0) goNext();
    else goPrev();
  };

  // ── Like ──────────────────────────────────────────────────
  const handleLike = async () => {
    const post = posts[current];
    if (!post || !userId) return;

    setLikeAnim(true);
    setShowHeart(true);
    setTimeout(() => { setLikeAnim(false); setShowHeart(false); }, 1000);

    const liked = post.user_liked;
    setPosts(prev => prev.map((p, i) =>
      i === current
        ? { ...p, user_liked: !liked, likes_count: liked ? p.likes_count - 1 : p.likes_count + 1 }
        : p
    ));

    try {
      if (liked) {
        await supabase.from('comunidad_likes')
          .delete().eq('post_id', post.id).eq('user_id', userId);
        await supabase.from('comunidad_posts')
          .update({ likes_count: post.likes_count - 1 }).eq('id', post.id);
      } else {
        await supabase.from('comunidad_likes')
          .upsert({ post_id: post.id, user_id: userId });
        await supabase.from('comunidad_posts')
          .update({ likes_count: post.likes_count + 1 }).eq('id', post.id);
      }
    } catch {}
  };

  // ── Guardar ───────────────────────────────────────────────
  const handleGuardar = async () => {
    const post = posts[current];
    if (!post || !userId) return;

    setSaveAnim(true);
    setTimeout(() => setSaveAnim(false), 600);

    const guardado = post.guardado;
    setPosts(prev => prev.map((p, i) =>
      i === current ? { ...p, guardado: !guardado } : p
    ));

    try {
      if (guardado) {
        await supabase.from('comunidad_guardados')
          .delete().eq('post_id', post.id).eq('user_id', userId);
      } else {
        await supabase.from('comunidad_guardados')
          .upsert({ post_id: post.id, user_id: userId });
      }
    } catch {}
  };

  // ── Contar view al cambiar de post ───────────────────────
  useEffect(() => {
    const post = posts[current];
    if (!post?.id) return;

    const key = `studytok_view_${post.id}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');

    setPosts(prev => prev.map((p, i) =>
      i === current ? { ...p, views: (p.views || 0) + 1 } : p
    ));

    void supabase
      .from('comunidad_posts')
      .update({ views: (post.views || 0) + 1 })
      .eq('id', post.id);
  }, [current, posts]);

  // ── Wheel scroll ─────────────────────────────────────────
  const wheelTimeout = useRef<any>(null);
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (wheelTimeout.current) return;
    if (e.deltaY > 30) goNext();
    else if (e.deltaY < -30) goPrev();
    wheelTimeout.current = setTimeout(() => { wheelTimeout.current = null; }, 600);
  };

  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
      <div style={{ fontSize: '48px', animation: 'spin 1s linear infinite' }}>🎬</div>
      <p style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Cargando StudyTok...</p>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (posts.length === 0) return (
    <div style={{ height: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px' }}>
      <div style={{ fontSize: '56px' }}>🌵</div>
      <p style={{ color: 'var(--text-muted)', fontWeight: 700, fontSize: '18px' }}>No hay contenido todavía</p>
      <p style={{ color: 'var(--text-faint)', fontSize: '14px' }}>Sé el primero en publicar</p>
    </div>
  );

  const post = posts[current];
  const tipo = TIPO_INFO[post.tipo] || TIPO_INFO.post;
  const tiempoAtras = (() => {
    const diff = Date.now() - new Date(post.created_at).getTime();
    const m = Math.floor(diff / 60000);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d`;
    if (h > 0) return `${h}h`;
    if (m > 0) return `${m}m`;
    return 'ahora';
  })();

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onWheel={onWheel}
      style={{
        height: 'calc(100vh - 120px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {/* ── Card principal ── */}
      <div
        key={post.id}
        style={{
          width: '100%',
          maxWidth: '480px',
          height: '100%',
          maxHeight: '780px',
          borderRadius: '24px',
          overflow: 'hidden',
          position: 'relative',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.3)',
          animation: 'fadeUp 0.3s ease',
        }}
      >
        {/* Portada */}
        {post.portada_url ? (
          <div style={{ position: 'absolute', inset: 0 }}>
            <img
              src={post.portada_url}
              alt={post.titulo}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            {/* Gradiente sobre imagen */}
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, transparent 30%, transparent 50%, rgba(0,0,0,0.85) 100%)',
            }} />
          </div>
        ) : (
          /* Sin portada — fondo de color */
          <div style={{
            position: 'absolute', inset: 0,
            background: `linear-gradient(135deg, ${post.materia_color || tipo.color}22 0%, var(--bg-card) 100%)`,
          }}>
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '100px', opacity: 0.08,
            }}>
              {tipo.emoji}
            </div>
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.6) 100%)',
            }} />
          </div>
        )}

        {/* ── Contenido bottom ── */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '24px 16px 24px 20px',
          display: 'flex', gap: '12px', alignItems: 'flex-end',
        }}>
          {/* Info izquierda */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Avatar + nombre */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '50%',
                background: post.materia_color || tipo.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '16px', fontWeight: 900, color: '#000',
                flexShrink: 0, border: '2px solid rgba(255,255,255,0.3)',
                overflow: 'hidden',
              }}>
                {post.user_avatar
                  ? <img src={post.user_avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : post.user_nombre?.[0]?.toUpperCase() || '?'
                }
              </div>
              <div>
                <p style={{ fontSize: '13px', fontWeight: 800, color: '#fff', margin: 0, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                  {post.user_nombre}
                </p>
                <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', margin: 0 }}>{tiempoAtras}</p>
              </div>
            </div>

            {/* Tipo badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              background: tipo.color + '33', border: `1px solid ${tipo.color}66`,
              borderRadius: '6px', padding: '2px 8px', marginBottom: '8px',
            }}>
              <span style={{ fontSize: '11px' }}>{tipo.emoji}</span>
              <span style={{ fontSize: '10px', fontWeight: 700, color: tipo.color }}>{tipo.label}</span>
              {post.materia_nombre && (
                <>
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '10px' }}>·</span>
                  <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.7)' }}>
                    {post.materia_emoji} {post.materia_nombre}
                  </span>
                </>
              )}
            </div>

            {/* Título */}
            <h2 style={{
              fontSize: '18px', fontWeight: 900, color: '#fff', margin: '0 0 6px',
              lineHeight: 1.3, textShadow: '0 2px 8px rgba(0,0,0,0.5)',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {post.titulo}
            </h2>

            {/* Descripción */}
            {post.descripcion && (
              <p style={{
                fontSize: '13px', color: 'rgba(255,255,255,0.8)', margin: 0,
                lineHeight: 1.5, textShadow: '0 1px 4px rgba(0,0,0,0.5)',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {post.descripcion}
              </p>
            )}

            {/* Botón abrir */}
            <Link href={`/comunidad/${post.id}`} style={{ textDecoration: 'none' }}>
              <button style={{
                marginTop: '12px', padding: '8px 18px', borderRadius: '20px',
                border: 'none', background: tipo.color, color: '#000',
                fontSize: '12px', fontWeight: 800, cursor: 'pointer',
              }}>
                Ver {tipo.label} →
              </button>
            </Link>
          </div>

          {/* Acciones derecha */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center', flexShrink: 0 }}>

            {/* Like */}
            <button
              onClick={handleLike}
              style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}
            >
              <div style={{
                width: '44px', height: '44px', borderRadius: '50%',
                background: post.user_liked ? 'var(--red)' : 'rgba(0,0,0,0.4)',
                border: `2px solid ${post.user_liked ? 'var(--red)' : 'rgba(255,255,255,0.2)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '20px',
                transform: likeAnim ? 'scale(1.4)' : 'scale(1)',
                transition: 'all 0.2s',
              }}>
                {post.user_liked ? '❤️' : '🤍'}
              </div>
              <span style={{ fontSize: '11px', color: '#fff', fontWeight: 700, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                {post.likes_count}
              </span>
            </button>

            {/* Comentarios */}
            <Link href={`/comunidad/${post.id}`} style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
              <div style={{
                width: '44px', height: '44px', borderRadius: '50%',
                background: 'rgba(0,0,0,0.4)',
                border: '2px solid rgba(255,255,255,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '20px',
              }}>
                💬
              </div>
              <span style={{ fontSize: '11px', color: '#fff', fontWeight: 700, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                {post.comentarios_count}
              </span>
            </Link>

            {/* Guardar */}
            <button
              onClick={handleGuardar}
              style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}
            >
              <div style={{
                width: '44px', height: '44px', borderRadius: '50%',
                background: post.guardado ? 'var(--gold)' : 'rgba(0,0,0,0.4)',
                border: `2px solid ${post.guardado ? 'var(--gold)' : 'rgba(255,255,255,0.2)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '20px',
                transform: saveAnim ? 'scale(1.3)' : 'scale(1)',
                transition: 'all 0.2s',
              }}>
                {post.guardado ? '🔖' : '📌'}
              </div>
              <span style={{ fontSize: '11px', color: '#fff', fontWeight: 700, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                {post.guardado ? 'Guardado' : 'Guardar'}
              </span>
            </button>

            {/* Views */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
              <div style={{
                width: '44px', height: '44px', borderRadius: '50%',
                background: 'rgba(0,0,0,0.4)',
                border: '2px solid rgba(255,255,255,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '18px',
              }}>
                👁️
              </div>
              <span style={{ fontSize: '11px', color: '#fff', fontWeight: 700, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                {post.views || 0}
              </span>
            </div>
          </div>
        </div>

        {/* Corazón animado al doble tap */}
        {showHeart && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{ fontSize: '100px', animation: 'heartPop 0.8s ease forwards' }}>❤️</div>
          </div>
        )}
      </div>

      {/* ── Indicador progreso lateral ── */}
      <div style={{
        position: 'absolute', right: 'calc(50% - 260px)', top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex', flexDirection: 'column', gap: '4px',
      }}>
        {posts.slice(Math.max(0, current - 2), current + 5).map((_, i) => {
          const realIdx = Math.max(0, current - 2) + i;
          return (
            <div key={realIdx} style={{
              width: realIdx === current ? '4px' : '3px',
              height: realIdx === current ? '24px' : '8px',
              borderRadius: '2px',
              background: realIdx === current ? 'var(--gold)' : 'rgba(255,255,255,0.2)',
              transition: 'all 0.2s',
            }} />
          );
        })}
      </div>

      {/* ── Flechas navegación ── */}
      <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: '12px', display: 'flex', gap: '12px' }}>
        <button onClick={goPrev} disabled={current === 0}
          style={{ padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: current === 0 ? 'var(--text-faint)' : 'var(--text-primary)', cursor: current === 0 ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 700 }}>
          ↑
        </button>
        <span style={{ padding: '8px 14px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
          {current + 1} / {posts.length}{hasMore ? '+' : ''}
        </span>
        <button onClick={goNext} disabled={current === posts.length - 1 && !hasMore}
          style={{ padding: '8px 16px', borderRadius: '20px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: (current === posts.length - 1 && !hasMore) ? 'var(--text-faint)' : 'var(--text-primary)', cursor: (current === posts.length - 1 && !hasMore) ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 700 }}>
          ↓
        </button>
      </div>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(30px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes heartPop {
          0%   { transform: scale(0); opacity: 1; }
          50%  { transform: scale(1.3); opacity: 1; }
          100% { transform: scale(1); opacity: 0; }
        }
      `}</style>
    </div>
  );
}