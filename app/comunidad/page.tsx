'use client';
import { darXP } from '../../lib/xpClient';
import { dispararXPToast } from '../../components/XPToast';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useDarkMode } from '@/hooks/useDarkMode';
import NavbarMobile from '@/components/NavbarMobile';
import UserMenu from '@/components/UserMenu';
import Footer from '@/components/Footer';
import Link from 'next/link';
import PublicarComunidad from '@/components/PublicarComunidad';

interface Post {
  id: string;
  user_id: string;
  user_nombre: string;
  user_avatar?: string;
  tipo: 'apunte' | 'flashcards' | 'quiz' | 'post' | 'video';
  titulo: string;
  descripcion?: string;
  portada_url?: string;
  materia_nombre?: string;
  materia_color?: string;
  materia_emoji?: string;
  es_partner: boolean;
  likes_count: number;
  user_liked: boolean;
  avg_rating: number;
  ratings_count: number;
  guardado: boolean;
  comentarios_count: number;
  views: number;
  estudiados: number;
  video_url?: string;
  created_at: string;
}

const TIPO_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  apunte: { label: 'Apunte', emoji: '📝', color: '#f5c842' },
  flashcards: { label: 'Flashcards', emoji: '🎴', color: '#a78bfa' },
  quiz: { label: 'Quiz', emoji: '🧠', color: '#34d399' },
  post: { label: 'Post', emoji: '💬', color: '#38bdf8' },
  video: { label: 'Video', emoji: '🎥', color: '#ff4d6d' },
};

function StarRating({ avg, count }: { avg: number; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      {[1,2,3,4,5].map(s => (
        <span key={s} style={{ fontSize: '12px', color: s <= Math.round(avg) ? '#f5c842' : 'var(--border-color)' }}>★</span>
      ))}
      {count > 0 && <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '2px' }}>{avg} ({count})</span>}
    </div>
  );
}

function PostCard({ post, userId, onLike, onGuardar }: { post: Post; userId: string; onLike: (id: string) => void; onGuardar: (id: string) => void }) {
  const tipo = TIPO_LABELS[post.tipo];
  const lastTap = useRef(0);
  const clickTimer = useRef<any>(null);
  const [showHeart, setShowHeart] = useState(false);

  const abrirPost = () => {
    window.location.href = `/comunidad/${post.id}`;
  };

  const handleSingleOpen = () => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      abrirPost();
    }, 220);
  };

  const handleDoubleLike = (e?: any) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (clickTimer.current) clearTimeout(clickTimer.current);

    setShowHeart(true);
    setTimeout(() => setShowHeart(false), 700);

    if (!post.user_liked) onLike(post.id);
  };

  const handleTouchEnd = (e: any) => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      handleDoubleLike(e);
    }
    lastTap.current = now;
  };

  return (
    <div
      onClick={handleSingleOpen}
      onDoubleClick={handleDoubleLike}
      onTouchEnd={handleTouchEnd}
      style={{
        background: 'var(--bg-card)',
        borderRadius: '20px',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        breakInside: 'avoid',
        marginBottom: '14px',
        display: 'inline-block',
        width: '100%',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        border: '1px solid var(--border-color)',
        position: 'relative',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)';
        (e.currentTarget as HTMLElement).style.boxShadow = '0 16px 48px rgba(0,0,0,0.18)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
        (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
      }}
    >
      {/* Imagen o gradiente */}
      <div style={{ display: 'block', textDecoration: 'none', position: 'relative' }}>
        {post.portada_url ? (
          <div style={{ position: 'relative', width: '100%', overflow: 'hidden' }}>
            <img
              src={post.portada_url}
              alt={post.titulo}
              style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: '500px', minHeight: '180px' }}
            />
            {/* Gradiente oscuro abajo para leer el texto */}
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              height: '60%',
              background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)',
              pointerEvents: 'none',
            }} />
            {/* Titulo encima de la imagen */}
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '14px' }}>
              {post.materia_nombre && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: post.materia_color || tipo.color }} />
                  <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.75)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{post.materia_nombre}</span>
                </div>
              )}
              <h3 style={{ fontSize: '14px', fontWeight: 900, color: '#fff', margin: 0, lineHeight: 1.3,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                textShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>
                {post.titulo}
              </h3>
            </div>
            {/* Badge tipo */}
            <div style={{ position: 'absolute', top: '10px', left: '10px' }}>
              <span style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', color: '#fff', padding: '3px 9px', borderRadius: '20px', fontSize: '10px', fontWeight: 800 }}>
                {tipo.emoji} {tipo.label}
              </span>
            </div>
            {post.es_partner && (
              <div style={{ position: 'absolute', top: '10px', right: '10px' }}>
                <span style={{ background: '#38bdf8', color: '#000', padding: '3px 9px', borderRadius: '20px', fontSize: '10px', fontWeight: 800 }}>
                  ✨
                </span>
              </div>
            )}
          </div>
        ) : (
          <div style={{
            height: '120px',
            background: `linear-gradient(135deg, ${post.materia_color || tipo.color}30, ${post.materia_color || tipo.color}60)`,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            position: 'relative', gap: '6px',
          }}>
            <div style={{ fontSize: '40px' }}>{post.materia_emoji || tipo.emoji}</div>
            <span style={{ fontSize: '10px', fontWeight: 800, color: post.materia_color || tipo.color, textTransform: 'uppercase', letterSpacing: '1px' }}>
              {tipo.label}
            </span>
            {post.es_partner && (
              <div style={{ position: 'absolute', top: '8px', right: '8px' }}>
                <span style={{ background: '#38bdf8', color: '#000', padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 800 }}>✨</span>
              </div>
            )}
          </div>
        )}

        {/* Titulo (solo si no hay portada) */}
        {!post.portada_url && (
          <div style={{ padding: '12px 14px 4px' }}>
            {post.materia_nombre && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: post.materia_color || '#888' }} />
                <span style={{ fontSize: '10px', color: 'var(--text-faint)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{post.materia_nombre}</span>
              </div>
            )}
            <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', margin: 0, lineHeight: 1.35,
              display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {post.titulo}
            </h3>
          </div>
        )}
        {showHeart && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{
              fontSize: '68px',
              animation: 'heartPopMini 0.7s ease forwards',
              textShadow: '0 8px 30px rgba(0,0,0,0.35)',
            }}>
              ❤️
            </div>
          </div>
        )}
      </div>

      {/* Footer minimalista: avatar + like + guardar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px',
        gap: '8px',
      }}>
        {/* Avatar + nombre */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', minWidth: 0 }}
          onClick={e => { e.preventDefault(); e.stopPropagation(); window.location.href = `/u/${encodeURIComponent(post.user_id)}`; }}
        >
          <div style={{
            width: '26px', height: '26px', borderRadius: '50%',
            background: post.materia_color || 'var(--gold)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '11px', fontWeight: 800, color: '#000', overflow: 'hidden', flexShrink: 0,
          }}>
            {post.user_avatar
              ? <img src={post.user_avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
              : post.user_nombre?.[0]?.toUpperCase()}
          </div>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80px' }}>
            {post.user_nombre}
          </span>
        </div>

        {/* Like + Guardar */}
        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); onLike(post.id); }}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              background: post.user_liked ? '#ef444420' : 'transparent',
              border: 'none', borderRadius: '20px', padding: '5px 10px',
              fontSize: '12px', cursor: 'pointer', fontWeight: 700,
              color: post.user_liked ? '#ef4444' : 'var(--text-faint)',
              transition: 'all 0.15s',
            }}>
            {post.user_liked ? '❤️' : '🤍'} {post.likes_count}
          </button>
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); onGuardar(post.id); }}
            style={{
              display: 'flex', alignItems: 'center',
              background: post.guardado ? '#f5c84220' : 'transparent',
              border: 'none', borderRadius: '20px', padding: '5px 8px',
              fontSize: '13px', cursor: 'pointer',
              color: post.guardado ? '#f5c842' : 'var(--text-faint)',
              transition: 'all 0.15s',
            }}>
            {post.guardado ? '🔖' : '🏷️'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ComunidadPage() {
  const isMobile = useIsMobile();
  const { darkMode, toggle: toggleDark } = useDarkMode();
  const [userId, setUserId] = useState('');
  const [userNombre, setUserNombre] = useState('');
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [tipo, setTipo] = useState<string>('all');
  const [filtro, setFiltro] = useState<string>('todos');
  const [showPublicar, setShowPublicar] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserId(data.user.id);
        const nombre = data.user.user_metadata?.nombre || data.user.email?.split('@')[0] || 'Usuario';
        setUserNombre(nombre);
      }
    });
  }, []);

  const cargarPosts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ tipo, filtro });
      if (userId) params.append('userId', userId);
      const res = await fetch(`/api/comunidad/posts?${params}`);
      const data = await res.json();
      setPosts(data.posts || []);
    } finally {
      setLoading(false);
    }
  }, [tipo, filtro, userId]);

  useEffect(() => { cargarPosts(); }, [cargarPosts]);

  const handleLike = async (postId: string) => {
    if (!userId) return;
    await fetch('/api/comunidad/likes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_id: postId, user_id: userId }),
    });
    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p;
      const liked = !p.user_liked;
      return { ...p, user_liked: liked, likes_count: p.likes_count + (liked ? 1 : -1) };
    }));
  };

  const handleGuardar = async (postId: string) => {
    if (!userId) return;
    await fetch('/api/comunidad/guardados', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_id: postId, user_id: userId }),
    });
    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p;
      return { ...p, guardado: !p.guardado };
    }));
  };

  const tipoFiltros = [
    { key: 'all', label: 'Todo', emoji: '' },
    { key: 'apunte', label: 'Apuntes', emoji: '' },
    { key: 'flashcards', label: 'Flashcards', emoji: '' },
    { key: 'quiz', label: 'Quizzes', emoji: '' },
    { key: 'post', label: 'Posts', emoji: '' },
    { key: 'video', label: 'Videos', emoji: '' },
  ];

  const filtroOpciones = [
    { key: 'todos', label: 'Todos' },
    { key: 'partners', label: '✨ Partners' },
    { key: 'mios', label: 'Mis posts' },
    { key: 'guardados', label: '🔖 Guardados' },
  ];

  // Columnas para Pinterest
  const cols = isMobile ? 1 : 3;
  const columnas: Post[][] = Array.from({ length: cols }, () => []);
  posts.forEach((p, i) => columnas[i % cols].push(p));

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>
      {/* Navbar */}
      {isMobile ? (
        <NavbarMobile darkMode={darkMode} onToggleDark={toggleDark} />
      ) : (
        <>
          <header style={{ background: 'var(--bg-card)', borderBottom: '3px solid var(--gold)', padding: '0 40px', position: 'sticky', top: 0, zIndex: 100, display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '68px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <button onClick={() => window.location.href = '/'} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '22px', fontWeight: 900, color: 'var(--text-primary)' }}>
                <span style={{ color: 'var(--gold)' }}>Study</span><span style={{ color: 'var(--red)' }}>AL</span>
              </button>
              <span style={{ color: 'var(--border-color)' }}>›</span>
              <span style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>Comunidad</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button onClick={() => window.location.href = '/materias'} style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--gold)', background: 'transparent', color: 'var(--gold)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>📚 Materias</button>
              <button onClick={toggleDark} style={{ padding: '8px 14px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>{darkMode ? '☀️' : '🌙'}</button>
              <UserMenu />
            </div>
          </header>
          <div style={{ display: 'flex', height: '3px' }}>
            {['var(--gold)', 'var(--red)', 'var(--blue)', 'var(--pink)'].map((c, i) => (
              <div key={i} style={{ flex: 1, background: c }} />
            ))}
          </div>
        </>
      )}

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: isMobile ? '16px' : '32px 40px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ fontSize: isMobile ? '24px' : '32px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 4px' }}>
              Comunidad
            </h1>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
              Aprende y comparte con otros estudiantes
            </p>
          </div>
          {userId && (
            <button
              onClick={() => setShowPublicar(true)}
              style={{ padding: '12px 24px', borderRadius: '14px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '14px', fontWeight: 900, cursor: 'pointer' }}>
              ✨ Publicar
            </button>
          )}
        </div>

        {/* Modos de vista */}
        <div style={{
          display: 'flex',
          gap: '10px',
          marginBottom: '18px',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{
              padding: '10px 14px',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: '13px',
              fontWeight: 800,
            }}>
              📰 Feed
            </div>

            <Link href="/comunidad/blinks" style={{ textDecoration: 'none' }}>
              <div style={{
                padding: '10px 14px',
                borderRadius: '12px',
                border: '1px solid #ff4d6d55',
                background: 'linear-gradient(135deg, #ff4d6d22, #a78bfa22)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 900,
                cursor: 'pointer',
              }}>
                🎥 StudyAL Blinks
              </div>
            </Link>
          </div>

          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
            📰 Feed vertical de estudio · swipe o scroll para navegar
          </p>
        </div>

        {/* Filtros tipo */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {tipoFiltros.map(t => (
            <button key={t.key} onClick={() => setTipo(t.key)} style={{
              padding: '8px 16px', borderRadius: '20px', border: '2px solid',
              borderColor: tipo === t.key ? 'var(--gold)' : 'var(--border-color)',
              background: tipo === t.key ? 'var(--gold)' : 'transparent',
              color: tipo === t.key ? '#000' : 'var(--text-muted)',
              fontSize: '13px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s',
            }}>
              {t.emoji} {t.label}
            </button>
          ))}
        </div>

        {/* Filtros secundarios */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '24px', flexWrap: 'wrap' }}>
          {filtroOpciones.map(f => (
            <button key={f.key} onClick={() => setFiltro(f.key)} style={{
              padding: '6px 14px', borderRadius: '20px', border: '1px solid',
              borderColor: filtro === f.key ? 'var(--blue)' : 'var(--border-color)',
              background: filtro === f.key ? '#38bdf822' : 'transparent',
              color: filtro === f.key ? '#38bdf8' : 'var(--text-muted)',
              fontSize: '12px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
            }}>
              {f.label}
            </button>
          ))}
        </div>

        {/* 📰 Feed Pinterest */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: '40px', animation: 'spin 1s linear infinite' }}>⏳</div>
          </div>
        ) : posts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: '60px', marginBottom: '16px' }}>📭</div>
            <h2 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px' }}>
              No hay posts aquí todavía
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
              {filtro === 'guardados' ? 'Guarda posts para verlos aquí' : '¡Sé el primero en publicar!'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '16px', alignItems: 'start' }}>
            {columnas.map((col, ci) => (
              <div key={ci}>
                {col.map(post => (
                  <PostCard key={post.id} post={post} userId={userId} onLike={handleLike} onGuardar={handleGuardar} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal Publicar — conectado con materias */}
      {showPublicar && (
        <PublicarComunidad
          onClose={() => setShowPublicar(false)}
          onPublicado={() => { setShowPublicar(false); darXP('post', 15, { tipo: 'publicacion' }).then(res => {
        dispararXPToast({
          xp: res.ok ? res.xpGanado : 15,
          fuente: '🌍 Post publicado',
          emoji: '🌍',
          color: '#34d399',
          descripcion: 'Nuevo post en la comunidad',
        });
      });
      cargarPosts(); }}
        />
      )}

      <style>{`
        @keyframes heartPopMini {
          0%   { transform: scale(0.2); opacity: 0; }
          30%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 0; }
        }
      `}</style>

      <Footer />
    </div>
  );
}

