'use client';

import { useRouter } from 'next/navigation';
import { awardXPEvent } from '../../lib/xpClient';
import { xpEventId } from '../../lib/xpEvents';
import { dispararXPToast } from '../../components/XPToast';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useIdioma } from '@/hooks/useIdioma';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useDarkMode } from '@/hooks/useDarkMode';
import NavbarMobile from '@/components/NavbarMobile';
import UserMenu from '@/components/UserMenu';
import Footer from '@/components/Footer';
import Link from 'next/link';
import PublicarComunidad from '@/components/PublicarComunidad';

const HAND = "'Caveat',cursive";
const BODY = "'Inter', system-ui, sans-serif";

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
  apunte:     { label: 'Apunte',     emoji: '📝', color: 'var(--gold)' },
  flashcards: { label: 'Flashcards', emoji: '🎴', color: '#a78bfa' },
  quiz:       { label: 'Quiz',       emoji: '🧠', color: '#34d399' },
  post:       { label: 'Post',       emoji: '💬', color: '#38bdf8' },
  video:      { label: 'Video',      emoji: '🎥', color: 'var(--red)' },
};

// Rotación estable por id
function rotForId(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 9) - 4) * 0.4; // -1.6 a +1.6
}

// ═══════════════════════════════════════════════════════════════════════════
// POST CARD
// ═══════════════════════════════════════════════════════════════════════════
function PostCard({ post, userId, onLike, onGuardar }: { post: Post; userId: string; onLike: (id: string) => void; onGuardar: (id: string) => void }) {
  const router = useRouter();
  const tipo = TIPO_LABELS[post.tipo];
  const lastTap = useRef(0);
  const clickTimer = useRef<any>(null);
  const [showHeart, setShowHeart] = useState(false);
  const rot = rotForId(post.id);

  const abrirPost = () => { router.push(`/comunidad/${post.id}`); };

  const handleSingleOpen = () => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(abrirPost, 220);
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
    if (now - lastTap.current < 280) handleDoubleLike(e);
    lastTap.current = now;
  };

  return (
    <div
      onClick={handleSingleOpen}
      onDoubleClick={handleDoubleLike}
      onTouchEnd={handleTouchEnd}
      style={{
        background: 'var(--bg-card)',
        border: '2.5px solid var(--text-primary)',
        borderRadius: 14,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
        breakInside: 'avoid',
        marginBottom: 16,
        display: 'inline-block',
        width: '100%',
        boxShadow: `4px 5px 0 ${post.materia_color || tipo.color}`,
        position: 'relative',
        transform: `rotate(${rot}deg)`,
      }}
      onMouseEnter={(e: any) => {
        (e.currentTarget as HTMLElement).style.transform = 'rotate(0deg) translateY(-4px)';
        (e.currentTarget as HTMLElement).style.boxShadow = `5px 7px 0 ${post.materia_color || tipo.color}`;
      }}
      onMouseLeave={(e: any) => {
        (e.currentTarget as HTMLElement).style.transform = `rotate(${rot}deg)`;
        (e.currentTarget as HTMLElement).style.boxShadow = `4px 5px 0 ${post.materia_color || tipo.color}`;
      }}
    >
      {/* Imagen o gradient */}
      <div style={{ position: 'relative' }}>
        {post.portada_url ? (
          <div style={{ position: 'relative', width: '100%', overflow: 'hidden', borderBottom: '2px solid var(--text-primary)' }}>
            <img src={post.portada_url} alt={post.titulo}
              style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: 500, minHeight: 180 }}
            />
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              height: '60%',
              background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, transparent 100%)',
              pointerEvents: 'none',
            }} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 14 }}>
              {post.materia_nombre && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: post.materia_color || tipo.color,
                    border: '1.5px solid #fff',
                    boxShadow: `0 0 6px ${post.materia_color || tipo.color}`,
                  }} />
                  <span style={{
                    fontFamily: HAND, fontSize: 13, fontWeight: 800,
                    color: 'rgba(255,255,255,0.9)', fontStyle: 'italic',
                  }}>
                    {post.materia_nombre}
                  </span>
                </div>
              )}
              <h3 style={{
                fontFamily: HAND, fontSize: 22, fontWeight: 900,
                color: '#fff', margin: 0, lineHeight: 1.15,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                textShadow: '0 1px 4px rgba(0,0,0,0.5)',
              }}>
                {post.titulo}
              </h3>
            </div>
            {/* Badge tipo - cinta scotch */}
            <div style={{
              position: 'absolute', top: 10, left: 10,
              transform: 'rotate(-3deg)',
            }}>
              <span style={{
                background: tipo.color, color: '#000',
                border: '2px solid var(--text-primary)',
                boxShadow: '2px 2px 0 var(--text-primary)',
                padding: '3px 10px', borderRadius: 6,
                fontFamily: HAND, fontSize: 14, fontWeight: 800,
              }}>
                {tipo.emoji} {tipo.label}
              </span>
            </div>
            {post.es_partner && (
              <div style={{
                position: 'absolute', top: 10, right: 10,
                transform: 'rotate(5deg)',
              }}>
                <span style={{
                  background: '#38bdf8', color: '#000',
                  border: '2px solid var(--text-primary)',
                  boxShadow: '2px 2px 0 var(--text-primary)',
                  padding: '3px 9px', borderRadius: 6,
                  fontFamily: HAND, fontSize: 14, fontWeight: 800,
                }}>✨</span>
              </div>
            )}
          </div>
        ) : (
          <div style={{
            height: 140,
            background: `linear-gradient(135deg, ${post.materia_color || tipo.color}40, ${post.materia_color || tipo.color}70)`,
            borderBottom: '2px solid var(--text-primary)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            position: 'relative', gap: 6,
          }}>
            <div style={{ fontSize: 48 }}>{post.materia_emoji || tipo.emoji}</div>
            <span style={{
              fontFamily: HAND, fontSize: 14, fontWeight: 800,
              color: post.materia_color || tipo.color,
              fontStyle: 'italic',
              background: 'var(--bg-card)',
              border: '2px solid var(--text-primary)',
              padding: '2px 10px', borderRadius: 6,
              boxShadow: '2px 2px 0 var(--text-primary)',
              transform: 'rotate(-2deg)',
            }}>
              {tipo.label}
            </span>
            {post.es_partner && (
              <div style={{
                position: 'absolute', top: 8, right: 8,
                transform: 'rotate(5deg)',
              }}>
                <span style={{
                  background: '#38bdf8', color: '#000',
                  border: '2px solid var(--text-primary)',
                  boxShadow: '2px 2px 0 var(--text-primary)',
                  padding: '2px 8px', borderRadius: 6,
                  fontFamily: HAND, fontSize: 13, fontWeight: 800,
                }}>✨</span>
              </div>
            )}
          </div>
        )}

        {/* Titulo sin portada */}
        {!post.portada_url && (
          <div style={{ padding: '12px 14px 4px', position: 'relative' }}>
            {/* margen rojo */}
            <div style={{
              position: 'absolute', top: 0, bottom: 0,
              left: 24, width: 1.5,
              background: '#ef4444', opacity: 0.2,
              pointerEvents: 'none',
            }}/>
            {post.materia_nombre && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: post.materia_color || '#888',
                  border: '1.5px solid var(--text-primary)',
                }} />
                <span style={{
                  fontFamily: HAND, fontSize: 13, fontWeight: 800,
                  color: 'var(--text-faint)', fontStyle: 'italic',
                }}>
                  {post.materia_nombre}
                </span>
              </div>
            )}
            <h3 style={{
              fontFamily: HAND, fontSize: 20, fontWeight: 800,
              color: 'var(--text-primary)', margin: 0, lineHeight: 1.2,
              display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {post.titulo}
            </h3>
          </div>
        )}

        {/* Heart animation */}
        {showHeart && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{
              fontSize: 72,
              animation: 'heartPopMini 0.7s ease forwards',
              textShadow: '0 8px 30px rgba(0,0,0,0.4)',
            }}>
              ❤️
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', gap: 8,
        borderTop: '2px dashed var(--border-color)',
      }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minWidth: 0 }}
          onClick={(e: any) => { e.preventDefault(); e.stopPropagation(); router.push(`/u/${encodeURIComponent(post.user_id)}`); }}
        >
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: post.materia_color || 'var(--gold)',
            border: '2px solid var(--text-primary)',
            boxShadow: '1px 1px 0 var(--text-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: HAND, fontSize: 14, fontWeight: 900, color: '#000',
            overflow: 'hidden', flexShrink: 0,
            transform: 'rotate(-4deg)',
          }}>
            {post.user_avatar
              ? <img src={post.user_avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
              : post.user_nombre?.[0]?.toUpperCase()}
          </div>
          <span style={{
            fontFamily: BODY, fontSize: 15, fontWeight: 700,
            color: 'var(--text-muted)', fontStyle: 'italic',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100,
          }}>
            {post.user_nombre}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button onClick={(e: any) => { e.preventDefault(); e.stopPropagation(); onLike(post.id); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: post.user_liked ? 'color-mix(in srgb,#ef4444 18%,transparent)' : 'transparent',
              border: post.user_liked ? '2px solid #ef4444' : '2px dashed var(--border-color)',
              borderRadius: 8, padding: '4px 10px',
              fontFamily: HAND, fontSize: 15, fontWeight: 800,
              cursor: 'pointer',
              color: post.user_liked ? '#ef4444' : 'var(--text-faint)',
              transition: 'all 0.15s',
              transform: 'rotate(-1deg)',
            }}>
            {post.user_liked ? '❤️' : '🤍'} {post.likes_count}
          </button>
          <button onClick={(e: any) => { e.preventDefault(); e.stopPropagation(); onGuardar(post.id); }}
            style={{
              display: 'flex', alignItems: 'center',
              background: post.guardado ? 'color-mix(in srgb,var(--gold) 18%,transparent)' : 'transparent',
              border: post.guardado ? '2px solid var(--gold)' : '2px dashed var(--border-color)',
              borderRadius: 8, padding: '4px 8px',
              fontFamily: BODY, fontSize: 15,
              cursor: 'pointer',
              color: post.guardado ? 'var(--gold)' : 'var(--text-faint)',
              transition: 'all 0.15s',
              transform: 'rotate(1deg)',
            }}>
            {post.guardado ? '🔖' : '🏷️'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PÁGINA COMUNIDAD
// ═══════════════════════════════════════════════════════════════════════════
export default function ComunidadPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const isMobile = useIsMobile();
  const { tr, idioma } = useIdioma();
  const { darkMode, toggle: toggleDark } = useDarkMode();
  const [userId, setUserId] = useState('');
  const [userNombre, setUserNombre] = useState('');
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [tipo, setTipo] = useState<string>('all');
  const [filtro, setFiltro] = useState<string>('todos');
  const [showPublicar, setShowPublicar] = useState(false);

  useEffect(() => {
    if (authStatus === 'loading') return;
    const user = session?.user as (typeof session.user & { id?: string }) | undefined;
    if (user?.id) {
        setUserId(user.id);
        const nombre = user.name || user.email?.split('@')[0] || 'Usuario';
        setUserNombre(nombre);
    } else {
      setUserId('');
      setUserNombre('');
    }
  }, [authStatus, session]);

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
    { key: 'all',        label: 'Todo',       emoji: '✨', color: 'var(--gold)' },
    { key: 'apunte',     label: 'Apuntes',    emoji: '📝', color: 'var(--gold)' },
    { key: 'flashcards', label: 'Flashcards', emoji: '🎴', color: '#a78bfa' },
    { key: 'quiz',       label: 'Quizzes',    emoji: '🧠', color: '#34d399' },
    { key: 'post',       label: 'Posts',      emoji: '💬', color: '#38bdf8' },
    { key: 'video',      label: 'Videos',     emoji: '🎥', color: 'var(--red)' },
  ];

  const filtroOpciones = [
    { key: 'todos',     label: tr('todosTipos'),                emoji: '🌍' },
    { key: 'partners',  label: tr('filtroPartners'),            emoji: '✨' },
    { key: 'mios',      label: 'Mis posts',                     emoji: '👤' },
    { key: 'guardados', label: tr('filtroGuardados'),           emoji: '🔖' },
  ];

  const cols = isMobile ? 1 : 3;
  const columnas: Post[][] = Array.from({ length: cols }, () => []);
  posts.forEach((p, i) => columnas[i % cols].push(p));

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', position: 'relative' }}>

      {/* Navbar */}
      {isMobile ? (
        <NavbarMobile darkMode={darkMode} onToggleDark={toggleDark} />
      ) : (
        <header style={{
          position: 'sticky', top: 0, zIndex: 100,
          background: 'color-mix(in srgb,var(--bg-primary) 92%,transparent)',
          backdropFilter: 'blur(14px)',
          borderBottom: '2.5px solid var(--text-primary)',
          padding: '12px 36px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button onClick={() => {
                try { (window as any).__showNavLoader?.('/'); } catch {}
                const fallback = setTimeout(() => { if (window.location.pathname !== '/') window.location.href = '/'; }, 700);
                try { router.push('/'); setTimeout(() => clearTimeout(fallback), 750); }
                catch { clearTimeout(fallback); window.location.href = '/'; }
              }}
              style={{
                background: 'var(--bg-card)',
                border: '2.5px solid var(--text-primary)',
                color: 'var(--text-primary)',
                padding: '8px 16px',
                borderRadius: 10,
                fontFamily: HAND, fontSize: 22, fontWeight: 900,
                cursor: 'pointer',
                boxShadow: '3px 3px 0 var(--text-primary)',
                transform: 'rotate(-1.5deg)',
              }}>
              <span style={{ color: 'var(--gold)' }}>Study</span><span style={{ color: 'var(--red)' }}>AL</span>
            </button>
            <span style={{ color: 'var(--text-faint)', fontSize: 18, fontWeight: 800 }}>›</span>
            <h1 style={{
              fontFamily: HAND, fontSize: 30, fontWeight: 900,
              color: 'var(--text-primary)', margin: 0, lineHeight: 1,
              transform: 'rotate(-1deg)', display: 'inline-block',
            }}>
              🌍 Comunidad
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => ((window as any).__showNavLoader?.('/materias'), router.push('/materias'))}
              style={{
                padding: '8px 16px', borderRadius: 10,
                border: '2.5px dashed var(--gold)',
                background: 'transparent', color: 'var(--gold)',
                fontFamily: HAND, fontSize: 17, fontWeight: 800,
                cursor: 'pointer',
                transform: 'rotate(1deg)',
              }}>
              📚 Materias
            </button>
            <button onClick={toggleDark}
              style={{
                padding: '8px 14px', borderRadius: 10,
                border: '2px dashed var(--border-color)',
                background: 'transparent', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: 16,
              }}>
              {darkMode ? '☀️' : '🌙'}
            </button>
            <UserMenu />
          </div>
        </header>
      )}

      {/* Línea rasgada */}
      <svg viewBox="0 0 1200 14" preserveAspectRatio="none" style={{
        display: 'block', width: '100%', height: 14,
      }}>
        <path
          d="M 0 7 Q 50 2 100 6 T 200 5 T 300 8 T 400 4 T 500 7 T 600 5 T 700 8 T 800 4 T 900 7 T 1000 5 T 1100 8 T 1200 6"
          fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" opacity="0.45"
        />
      </svg>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: isMobile ? 16 : '28px 36px' }}>

        {/* Header sección */}
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-end', marginBottom: 22,
          flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <h1 style={{
              fontFamily: HAND, fontSize: isMobile ? 36 : 44, fontWeight: 900,
              color: 'var(--text-primary)', margin: 0, lineHeight: 1,
              transform: 'rotate(-1.5deg)', display: 'inline-block',
            }}>
              🌍 Comunidad
            </h1>
            <svg width="240" height="6" style={{ display: 'block', marginTop: 2 }}>
              <path d="M2 3 Q 120 0 238 4" stroke="var(--gold)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
            </svg>
            <p style={{
              fontFamily: BODY, fontSize: 17, fontStyle: 'italic',
              color: 'var(--text-muted)', margin: '6px 0 0',
            }}>
              ~ aprende y comparte con otros estudiantes ~
            </p>
          </div>
          {userId && (
            <button onClick={() => setShowPublicar(true)}
              style={{
                padding: '12px 24px',
                borderRadius: 14,
                border: '2.5px solid var(--text-primary)',
                background: 'var(--gold)', color: '#000',
                fontFamily: HAND, fontSize: 22, fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '4px 5px 0 var(--text-primary)',
                transform: 'rotate(2deg)',
                transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
              }}
              onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-3px)';e.currentTarget.style.boxShadow='5px 7px 0 var(--text-primary)';}}
              onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(2deg)';e.currentTarget.style.boxShadow='4px 5px 0 var(--text-primary)';}}
            >
              ✨ Publicar
            </button>
          )}
        </div>

        {/* Modos de vista */}
        <div style={{
          display: 'flex', gap: 10, marginBottom: 18,
          flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{
              padding: '10px 16px',
              borderRadius: 12,
              border: '2.5px solid var(--text-primary)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontFamily: HAND, fontSize: 18, fontWeight: 800,
              boxShadow: '2px 3px 0 var(--text-primary)',
              transform: 'rotate(-1deg)',
            }}>
              📰 Feed
            </div>

            <Link href="/comunidad/blinks" style={{ textDecoration: 'none' }}>
              <div style={{
                padding: '10px 16px',
                borderRadius: 12,
                border: '2.5px dashed var(--red)',
                background: 'linear-gradient(135deg, color-mix(in srgb,var(--red) 18%,transparent), color-mix(in srgb,#a78bfa 18%,transparent))',
                color: 'var(--text-primary)',
                fontFamily: HAND, fontSize: 18, fontWeight: 800,
                cursor: 'pointer',
                transform: 'rotate(1deg)',
                transition: 'all 0.25s',
              }}
                onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';e.currentTarget.style.borderStyle='solid';}}
                onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(1deg)';e.currentTarget.style.borderStyle='dashed';}}
              >
                🎥 StudyAL Blinks
              </div>
            </Link>
          </div>

          <p style={{
            margin: 0,
            fontFamily: BODY, fontSize: 15, fontStyle: 'italic',
            color: 'var(--text-muted)',
          }}>
            ~ 📰 feed vertical · scroll para navegar ~
          </p>
        </div>

        {/* Filtros tipo */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {tipoFiltros.map((t, i) => {
            const active = tipo === t.key;
            return (
              <button key={t.key} onClick={() => setTipo(t.key)}
                style={{
                  padding: '8px 18px',
                  borderRadius: 10,
                  border: `2.5px ${active ? 'solid' : 'dashed'} ${active ? t.color : 'var(--border-color)'}`,
                  background: active ? t.color : 'var(--bg-card)',
                  color: active ? '#000' : 'var(--text-muted)',
                  fontFamily: HAND, fontSize: 17, fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: active ? `2px 3px 0 var(--text-primary)` : 'none',
                  transform: active
                    ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`
                    : `rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`,
                  transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                }}>
                {t.emoji} {t.label}
              </button>
            );
          })}
        </div>

        {/* Filtros secundarios */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
          {filtroOpciones.map((f, i) => {
            const active = filtro === f.key;
            return (
              <button key={f.key} onClick={() => setFiltro(f.key)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: `2px ${active ? 'solid' : 'dashed'} ${active ? 'var(--blue)' : 'var(--border-color)'}`,
                  background: active ? 'color-mix(in srgb,var(--blue) 18%,transparent)' : 'transparent',
                  color: active ? 'var(--blue)' : 'var(--text-muted)',
                  fontFamily: HAND, fontSize: 15, fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: active ? '2px 2px 0 var(--blue)' : 'none',
                  transform: active ? `rotate(${i % 2 === 0 ? -1 : 1}deg)` : `rotate(${i % 2 === 0 ? -0.3 : 0.3}deg)`,
                  fontStyle: 'italic',
                  transition: 'all 0.2s',
                }}>
                {f.emoji} {f.label}
              </button>
            );
          })}
        </div>

        {/* Feed */}
        {loading ? (
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '80px 0', gap: 14,
          }}>
            <div style={{ fontSize: 50, animation: 'spin 1.2s linear infinite' }}>⏳</div>
            <p style={{
              fontFamily: HAND, fontSize: 19, fontStyle: 'italic',
              color: 'var(--text-faint)', margin: 0,
            }}>
              ~ cargando posts ~
            </p>
          </div>
        ) : posts.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '60px 30px',
            background: 'var(--bg-card)',
            border: '2.5px dashed var(--border-color)',
            borderRadius: 16,
            transform: 'rotate(-0.5deg)',
            maxWidth: 520, margin: '60px auto 0',
          }}>
            <div style={{ fontSize: 70, marginBottom: 12 }}>🌵</div>
            <h2 style={{
              fontFamily: HAND, fontSize: 28, fontWeight: 900,
              color: 'var(--text-primary)', margin: '0 0 8px',
              transform: 'rotate(-1deg)', display: 'inline-block',
            }}>
              No hay posts aquí todavía
            </h2>
            <p style={{
              fontFamily: BODY, fontSize: 17, fontStyle: 'italic',
              color: 'var(--text-muted)', margin: 0,
            }}>
              ~ {filtro === 'guardados' ? tr('guardaPostes') : tr('seElPrimero')} ~
            </p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
            gap: 16, alignItems: 'start',
          }}>
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

      {/* Modal Publicar */}
      {showPublicar && (
        <PublicarComunidad
          onClose={() => setShowPublicar(false)}
          onPublicado={(postId) => {
            setShowPublicar(false);
            awardXPEvent({ eventId: xpEventId('community_post_created', postId), action: 'community_post_created', entityType: 'post', entityId: postId }).then(res => {
              dispararXPToast({
                xp: res.success ? res.awardedXP : 0,
                fuente: '🌍 Post publicado',
                emoji: '🌍',
                color: '#34d399',
                descripcion: 'Nuevo post en la comunidad',
              });
            });
            cargarPosts();
          }}
        />
      )}

      <style>{`
        @keyframes heartPopMini {
          0%   { transform: scale(0.2); opacity: 0; }
          30%  { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1); opacity: 0; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <Footer />
    </div>
  );
}
