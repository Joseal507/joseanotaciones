'use client';

import { useRouter } from 'next/navigation';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

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
  video_url?: string;
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

const TIPO: Record<Post['tipo'], { label: string; color: string; emoji: string }> = {
  apunte:     { label: 'Apunte',     color: 'var(--gold)', emoji: '📝' },
  flashcards: { label: 'Flashcards', color: '#a78bfa', emoji: '🎴' },
  quiz:       { label: 'Quiz',       color: '#34d399', emoji: '🧠' },
  post:       { label: 'Post',       color: '#38bdf8', emoji: '💬' },
  video:      { label: 'Video',      color: 'var(--red)', emoji: '🎥' },
};

export default function StudyALBlinks({
  userId,
  topOffset = 0,
}: {
  userId: string;
  topOffset?: number;
}) {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [current, setCurrent] = useState(0);
  const [filter, setFilter] = useState<'all' | 'video' | 'apunte' | 'flashcards' | 'quiz'>('all');
  const [mutedMap, setMutedMap] = useState<Record<string, boolean>>({});
  const [likeAnimId, setLikeAnimId] = useState<string | null>(null);
  const [saveAnimId, setSaveAnimId] = useState<string | null>(null);
  const [heartId, setHeartId] = useState<string | null>(null);
  const [videoHint, setVideoHint] = useState<{ id: string; text: string } | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const loadedPages = useRef<Set<string>>(new Set());
  const viewedPosts = useRef<Set<string>>(new Set());
  const tapRef = useRef<{ key: string; time: number }>({ key: '', time: 0 });

  const tiempoAtras = (createdAt: string) => {
    const diff = Date.now() - new Date(createdAt).getTime();
    const m = Math.floor(diff / 60000);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d`;
    if (h > 0) return `${h}h`;
    if (m > 0) return `${m}m`;
    return 'ahora';
  };

  const cargar = useCallback(async (pageToLoad = 1, filtroActual = filter, replace = false) => {
    const key = `${filtroActual}-${pageToLoad}`;
    if (loadedPages.current.has(key)) return;

    try {
      loadedPages.current.add(key);

      const params = new URLSearchParams({
        tipo: filtroActual === 'all' ? 'all' : filtroActual,
        filtro: 'todos',
        userId,
        page: String(pageToLoad),
      });

      const res = await fetch(`/api/comunidad/posts?${params}`);
      const data = await res.json();
      const nuevos: Post[] = data.posts || [];

      if (replace || pageToLoad === 1) {
        setPosts(nuevos);
      } else {
        setPosts(prev => {
          const ids = new Set(prev.map(p => p.id));
          return [...prev, ...nuevos.filter(p => !ids.has(p.id))];
        });
      }

      setHasMore(nuevos.length === 20);
      setPage(pageToLoad);
    } catch (err) {
      console.error('Error cargando blinks:', err);
    } finally {
      setLoading(false);
    }
  }, [filter, userId]);

  useEffect(() => {
    loadedPages.current.clear();
    viewedPosts.current.clear();
    setPosts([]);
    setCurrent(0);
    setPage(1);
    setHasMore(true);
    setLoading(true);
    void cargar(1, filter, true);
  }, [filter, userId, cargar]);

  useEffect(() => {
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    return () => {
      document.documentElement.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, []);

  useEffect(() => {
    if (!posts.length || !scrollerRef.current) return;

    const observer = new IntersectionObserver(
      entries => {
        const visibles = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (!visibles.length) return;
        const id = visibles[0].target.getAttribute('data-id');
        if (!id) return;

        const idx = posts.findIndex(p => p.id === id);
        if (idx >= 0) setCurrent(idx);
      },
      {
        root: scrollerRef.current,
        threshold: [0.55, 0.75, 0.95],
      }
    );

    posts.forEach(post => {
      const el = itemRefs.current[post.id];
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [posts]);

  useEffect(() => {
    posts.forEach((post, idx) => {
      const v = videoRefs.current[post.id];
      if (!v) return;

      if (idx === current) {
        v.muted = mutedMap[post.id] ?? true;
        void v.play().catch(() => {});
      } else {
        v.pause();
      }
    });

    const post = posts[current];
    if (!post) return;

    if (!viewedPosts.current.has(post.id)) {
      viewedPosts.current.add(post.id);

      setPosts(prev =>
        prev.map(p =>
          p.id === post.id ? { ...p, views: (p.views || 0) + 1 } : p
        )
      );

      void supabase
        .from('comunidad_posts')
        .update({ views: (post.views || 0) + 1 })
        .eq('id', post.id);
    }

    if (hasMore && current >= posts.length - 4) {
      void cargar(page + 1, filter, false);
    }
  }, [current, posts, hasMore, page, filter, cargar, mutedMap]);

  const scrollToIndex = (idx: number) => {
    const post = posts[idx];
    if (!post) return;
    itemRefs.current[post.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') scrollToIndex(Math.min(current + 1, posts.length - 1));
      if (e.key === 'ArrowUp') scrollToIndex(Math.max(current - 1, 0));

      const currentPost = posts[current];
      if (!currentPost?.video_url) return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekVideo(currentPost.id, 10);
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekVideo(currentPost.id, -10);
      }
      if (e.key === ' ') {
        e.preventDefault();
        togglePlayPause(currentPost.id);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, posts]);

  const toggleLike = async (post: Post, forceLike = false) => {
    const liked = forceLike ? false : post.user_liked;

    setPosts(prev =>
      prev.map(p =>
        p.id === post.id
          ? {
              ...p,
              user_liked: !liked,
              likes_count: liked ? Math.max(0, p.likes_count - 1) : p.likes_count + 1,
            }
          : p
      )
    );

    try {
      if (liked) {
        await supabase.from('comunidad_likes').delete().eq('post_id', post.id).eq('user_id', userId);
        await supabase.from('comunidad_posts').update({ likes_count: Math.max(0, post.likes_count - 1) }).eq('id', post.id);
      } else {
        await supabase.from('comunidad_likes').upsert({ post_id: post.id, user_id: userId });
        await supabase.from('comunidad_posts').update({ likes_count: post.likes_count + 1 }).eq('id', post.id);
      }
    } catch (e) {
      console.error('Error like:', e);
    }
  };

  const triggerLike = async (post: Post) => {
    setLikeAnimId(post.id);
    setHeartId(post.id);
    setTimeout(() => setLikeAnimId(null), 220);
    setTimeout(() => setHeartId(null), 800);

    if (!post.user_liked) {
      await toggleLike(post, true);
    }
  };

  const toggleGuardar = async (post: Post) => {
    const guardado = post.guardado;
    setSaveAnimId(post.id);
    setTimeout(() => setSaveAnimId(null), 220);

    setPosts(prev =>
      prev.map(p => p.id === post.id ? { ...p, guardado: !guardado } : p)
    );

    try {
      if (guardado) {
        await supabase.from('comunidad_guardados').delete().eq('post_id', post.id).eq('user_id', userId);
      } else {
        await supabase.from('comunidad_guardados').upsert({ post_id: post.id, user_id: userId });
      }
    } catch (e) {
      console.error('Error guardar:', e);
    }
  };

  const toggleMute = async (postId: string) => {
    const nextMuted = !(mutedMap[postId] ?? true);
    setMutedMap(prev => ({ ...prev, [postId]: nextMuted }));

    const v = videoRefs.current[postId];
    if (!v) return;

    try {
      v.muted = nextMuted;
      v.defaultMuted = nextMuted;
      v.volume = nextMuted ? 0 : 1;

      if (!nextMuted) {
        await v.play().catch(() => {});
      }
    } catch (err) {
      console.error('toggleMute error:', err);
    }
  };

  const showHint = (id: string, text: string) => {
    setVideoHint({ id, text });
    setTimeout(() => {
      setVideoHint(prev => (prev?.id === id ? null : prev));
    }, 600);
  };

  const seekVideo = (postId: string, seconds: number) => {
    const v = videoRefs.current[postId];
    if (!v) return;

    try {
      const duration = Number.isFinite(v.duration) ? v.duration : 0;
      const next = Math.max(0, Math.min(duration || 999999, v.currentTime + seconds));
      v.currentTime = next;
      showHint(postId, seconds > 0 ? '+10s' : '-10s');
    } catch {}
  };

  const togglePlayPause = (postId: string) => {
    const v = videoRefs.current[postId];
    if (!v) return;

    if (v.paused) {
      void v.play().catch(() => {});
      showHint(postId, '▶');
    } else {
      v.pause();
      showHint(postId, '⏸');
    }
  };

  const handleZoneTap = (post: Post, zone: 'left' | 'center' | 'right') => {
    if (!post.video_url) return;

    if (zone === 'center') {
      togglePlayPause(post.id);
      return;
    }

    const key = `${post.id}-${zone}`;
    const now = Date.now();

    if (tapRef.current.key === key && now - tapRef.current.time < 300) {
      seekVideo(post.id, zone === 'right' ? 10 : -10);
      tapRef.current = { key: '', time: 0 };
      return;
    }

    tapRef.current = { key, time: now };
  };

  const handleDoubleTapLikeNonVideo = (post: Post) => {
    if (post.video_url) return;
    void triggerLike(post);
  };

  if (loading && posts.length === 0) {
    return (
      <div style={{
        position: 'fixed',
        top: topOffset, left: 0, right: 0, bottom: 0,
        background: '#000',
        display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 14,
        color: '#fff',
      }}>
        <div style={{ fontSize: 50, animation: 'spinBlink 1.2s linear infinite' }}>⏳</div>
        <p style={{
          fontFamily: HAND, fontSize: 20, fontStyle: 'italic',
          color: 'rgba(255,255,255,0.75)', margin: 0,
        }}>
          ~ cargando Blinks ~
        </p>
        <style>{`@keyframes spinBlink{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      top: topOffset, left: 0, right: 0, bottom: 0,
      background: '#000',
      overflow: 'hidden',
      zIndex: 1,
    }}>

      {/* Filtros con vibra cuaderno */}
      <div style={{
        position: 'absolute',
        top: 12, left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        display: 'flex',
        gap: 6,
        padding: '8px 12px',
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(14px)',
        border: '2px solid rgba(255,255,255,0.18)',
        borderRadius: 14,
        boxShadow: '3px 4px 0 rgba(255,255,255,0.1)',
        maxWidth: '92vw',
        overflowX: 'auto',
      }}>
        {[
          { id: 'all',        label: 'Todo',       color: '#fff' },
          { id: 'video',      label: 'Videos',     color: 'var(--red)' },
          { id: 'apunte',     label: 'Apuntes',    color: 'var(--gold)' },
          { id: 'flashcards', label: 'Flashcards', color: '#a78bfa' },
          { id: 'quiz',       label: 'Quizzes',    color: '#34d399' },
        ].map((f, i) => {
          const active = filter === f.id;
          return (
            <button key={f.id}
              onClick={() => setFilter(f.id as any)}
              style={{
                padding: '6px 13px',
                borderRadius: 8,
                border: `2px ${active ? 'solid' : 'dashed'} ${active ? f.color : 'rgba(255,255,255,0.25)'}`,
                background: active ? f.color : 'rgba(255,255,255,0.05)',
                color: active ? '#000' : '#fff',
                fontFamily: HAND, fontSize: 16, fontWeight: 800,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                boxShadow: active ? `2px 2px 0 rgba(0,0,0,0.5)` : 'none',
                transform: active
                  ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)`
                  : `rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`,
                transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
              }}>
              {f.label}
            </button>
          );
        })}
      </div>

      <div
        ref={scrollerRef}
        style={{
          height: '100%',
          overflowY: 'auto',
          scrollSnapType: 'y mandatory',
          WebkitOverflowScrolling: 'touch',
          overscrollBehaviorY: 'contain',
        }}
      >
        {posts.map((post, idx) => {
          const info = TIPO[post.tipo];
          const esVideo = !!post.video_url;
          const muted = mutedMap[post.id] ?? true;

          return (
            <section
              key={post.id}
              data-id={post.id}
              ref={el => { itemRefs.current[post.id] = el; }}
              onDoubleClick={() => handleDoubleTapLikeNonVideo(post)}
              style={{
                height: '100%', width: '100%',
                position: 'relative',
                scrollSnapAlign: 'start',
                scrollSnapStop: 'always',
                overflow: 'hidden',
                background: '#000',
              }}
            >
              {esVideo ? (
                <>
                  <video
                    ref={el => { videoRefs.current[post.id] = el; }}
                    src={post.video_url}
                    muted={muted}
                    loop
                    playsInline
                    preload="auto"
                    style={{
                      position: 'absolute', inset: 0,
                      width: '100%', height: '100%',
                      objectFit: 'cover',
                      background: '#000',
                    }}
                  />

                  <div style={{ position: 'absolute', inset: 0, display: 'flex', zIndex: 2 }}>
                    <div style={{ flex: 1 }} onClick={(e: any) => { e.stopPropagation(); handleZoneTap(post, 'left'); }} />
                    <div style={{ flex: 1 }} onClick={(e: any) => { e.stopPropagation(); handleZoneTap(post, 'center'); }} />
                    <div style={{ flex: 1 }} onClick={(e: any) => { e.stopPropagation(); handleZoneTap(post, 'right'); }} />
                  </div>
                </>
              ) : post.portada_url ? (
                <img
                  src={post.portada_url}
                  alt={post.titulo}
                  style={{
                    position: 'absolute', inset: 0,
                    width: '100%', height: '100%',
                    objectFit: 'cover',
                  }}
                />
              ) : (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: `linear-gradient(135deg, ${post.materia_color || info.color}44 0%, #0b0b0b 100%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 100,
                  opacity: 0.6,
                }}>
                  {post.materia_emoji || info.emoji}
                </div>
              )}

              {/* Gradient oscuro */}
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.08) 28%, rgba(0,0,0,0.82) 100%)',
              }} />

              {/* Heart anim */}
              {heartId === post.id && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  pointerEvents: 'none', zIndex: 4,
                }}>
                  <div style={{ fontSize: 90, animation: 'blinkHeart 0.8s ease forwards' }}>❤️</div>
                </div>
              )}

              {/* Video hint */}
              {videoHint?.id === post.id && (
                <div style={{
                  position: 'absolute',
                  top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%) rotate(-3deg)',
                  zIndex: 4,
                  background: 'rgba(0,0,0,0.7)',
                  border: '2.5px solid rgba(255,255,255,0.3)',
                  color: '#fff',
                  borderRadius: 12,
                  padding: '12px 22px',
                  fontFamily: HAND, fontSize: 26, fontWeight: 900,
                  pointerEvents: 'none',
                  boxShadow: '3px 4px 0 rgba(255,255,255,0.15)',
                  animation: 'hintFade 0.6s ease forwards',
                }}>
                  {videoHint.text}
                </div>
              )}

              {/* Info izquierda */}
              <div style={{
                position: 'absolute',
                left: 0, right: 88, bottom: 0,
                padding: '18px 18px 26px',
                zIndex: 3,
              }}>
                {/* Avatar + nombre */}
                <div
                  onClick={(e: any) => {
                    e.stopPropagation();
                    router.push(`/u/${post.user_id}`);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    marginBottom: 10, cursor: 'pointer',
                  }}
                >
                  <div style={{
                    width: 42, height: 42, borderRadius: '50%',
                    overflow: 'hidden',
                    background: post.materia_color || info.color,
                    border: '2.5px solid rgba(255,255,255,0.4)',
                    boxShadow: '2px 2px 0 rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#000',
                    fontFamily: HAND, fontSize: 19, fontWeight: 900,
                    flexShrink: 0,
                    transform: 'rotate(-4deg)',
                  }}>
                    {post.user_avatar
                      ? <img src={post.user_avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : (post.user_nombre?.[0]?.toUpperCase() || '?')}
                  </div>
                  <div>
                    <div style={{
                      color: '#fff',
                      fontFamily: HAND, fontSize: 19, fontWeight: 900,
                      textShadow: '0 1px 4px rgba(0,0,0,0.6)',
                      lineHeight: 1.05,
                    }}>{post.user_nombre}</div>
                    <div style={{
                      color: 'rgba(255,255,255,0.65)',
                      fontFamily: HAND, fontSize: 14, fontStyle: 'italic',
                    }}>
                      ~ hace {tiempoAtras(post.created_at)} ~
                    </div>
                  </div>
                </div>

                {/* Badges */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  <span style={{
                    background: info.color, color: '#000',
                    border: '2px solid var(--text-primary)',
                    boxShadow: '2px 2px 0 rgba(0,0,0,0.4)',
                    padding: '3px 10px', borderRadius: 8,
                    fontFamily: HAND, fontSize: 14, fontWeight: 800,
                    fontStyle: 'italic',
                    transform: 'rotate(-2deg)',
                    display: 'inline-block',
                  }}>
                    {info.emoji} {info.label}
                  </span>

                  {post.materia_nombre && (
                    <span style={{
                      background: 'rgba(255,255,255,0.15)',
                      color: '#fff',
                      border: '2px dashed rgba(255,255,255,0.35)',
                      padding: '3px 10px', borderRadius: 8,
                      fontFamily: HAND, fontSize: 14, fontWeight: 700,
                      fontStyle: 'italic',
                      transform: 'rotate(1.5deg)',
                      display: 'inline-block',
                    }}>
                      {post.materia_emoji} {post.materia_nombre}
                    </span>
                  )}
                </div>

                {/* Título handwritten */}
                <h2 style={{
                  color: '#fff',
                  fontFamily: HAND, fontWeight: 900,
                  fontSize: 28, lineHeight: 1.15,
                  margin: '0 0 8px',
                  textShadow: '0 2px 12px rgba(0,0,0,0.8)',
                  transform: 'rotate(-0.8deg)',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {post.titulo}
                </h2>

                {post.descripcion && (
                  <p style={{
                    color: 'rgba(255,255,255,0.85)',
                    fontFamily: BODY, fontSize: 17, fontStyle: 'italic',
                    lineHeight: 1.4,
                    margin: '0 0 12px',
                    textShadow: '0 1px 4px rgba(0,0,0,0.6)',
                    display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    ~ {post.descripcion} ~
                  </p>
                )}

                {/* Botón ver post */}
                <Link href={`/comunidad/${post.id}`} style={{ textDecoration: 'none' }}>
                  <button
                    onClick={(e: any) => e.stopPropagation()}
                    style={{
                      padding: '8px 18px',
                      borderRadius: 10,
                      border: '2.5px solid rgba(255,255,255,0.4)',
                      background: 'rgba(0,0,0,0.5)',
                      color: '#fff',
                      fontFamily: HAND, fontSize: 17, fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: '3px 3px 0 rgba(255,255,255,0.15)',
                      transform: 'rotate(-1.5deg)',
                      transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                    }}
                    onMouseEnter={(e:any)=>{
                      e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';
                      e.currentTarget.style.background='rgba(0,0,0,0.7)';
                    }}
                    onMouseLeave={(e:any)=>{
                      e.currentTarget.style.transform='rotate(-1.5deg)';
                      e.currentTarget.style.background='rgba(0,0,0,0.5)';
                    }}
                  >
                    📖 Ver post
                  </button>
                </Link>
              </div>

              {/* Botones derecha */}
              <div style={{
                position: 'absolute',
                right: 14, bottom: 96,
                display: 'flex', flexDirection: 'column',
                gap: 18, alignItems: 'center',
                zIndex: 3,
              }}>
                {/* Like */}
                <button onClick={(e: any) => { e.stopPropagation(); void triggerLike(post); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <div style={{
                    width: 54, height: 54, borderRadius: '50%',
                    background: post.user_liked ? 'var(--red)' : 'rgba(0,0,0,0.55)',
                    border: post.user_liked ? '2.5px solid #fff' : '2.5px solid rgba(255,255,255,0.25)',
                    boxShadow: post.user_liked ? '2px 3px 0 rgba(0,0,0,0.5), 0 0 16px var(--red)88' : '2px 3px 0 rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 24,
                    transform: likeAnimId === post.id ? 'scale(1.2) rotate(-8deg)' : 'rotate(-3deg)',
                    transition: 'transform 0.2s cubic-bezier(.34,1.4,.64,1)',
                  }}>
                    {post.user_liked ? '❤️' : '🤍'}
                  </div>
                  <div style={{
                    color: '#fff',
                    fontFamily: HAND, fontSize: 14, fontWeight: 800,
                    marginTop: 4, textAlign: 'center',
                    textShadow: '0 1px 3px rgba(0,0,0,0.7)',
                  }}>
                    {post.likes_count}
                  </div>
                </button>

                {/* Guardar */}
                <button onClick={(e: any) => { e.stopPropagation(); void toggleGuardar(post); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <div style={{
                    width: 54, height: 54, borderRadius: '50%',
                    background: post.guardado ? 'var(--gold)' : 'rgba(0,0,0,0.55)',
                    border: post.guardado ? '2.5px solid #fff' : '2.5px solid rgba(255,255,255,0.25)',
                    boxShadow: post.guardado ? '2px 3px 0 rgba(0,0,0,0.5), 0 0 16px color-mix(in srgb, var(--gold) 55%, transparent)' : '2px 3px 0 rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 24,
                    transform: saveAnimId === post.id ? 'scale(1.18) rotate(5deg)' : 'rotate(3deg)',
                    transition: 'transform 0.2s cubic-bezier(.34,1.4,.64,1)',
                  }}>
                    {post.guardado ? '🔖' : '📌'}
                  </div>
                  <div style={{
                    color: '#fff',
                    fontFamily: HAND, fontSize: 12, fontStyle: 'italic',
                    marginTop: 4, textAlign: 'center',
                    textShadow: '0 1px 3px rgba(0,0,0,0.7)',
                  }}>
                    ~ guardar ~
                  </div>
                </button>
              </div>

              {/* Mute video */}
              {esVideo && (
                <button onClick={(e: any) => { e.stopPropagation(); void toggleMute(post.id); }}
                  style={{
                    position: 'absolute',
                    top: 68, right: 14,
                    zIndex: 3,
                    width: 46, height: 46, borderRadius: '50%',
                    border: '2.5px solid rgba(255,255,255,0.3)',
                    background: 'rgba(0,0,0,0.55)',
                    color: '#fff',
                    fontSize: 20,
                    cursor: 'pointer',
                    boxShadow: '2px 3px 0 rgba(0,0,0,0.5)',
                    transform: 'rotate(-3deg)',
                    transition: 'transform 0.2s',
                  }}
                  onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) scale(1.1)';}}
                  onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-3deg)';}}
                >
                  {muted ? '🔇' : '🔊'}
                </button>
              )}

              {/* Indicador lateral de posición */}
              <div style={{
                position: 'absolute',
                left: 12, top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex', flexDirection: 'column',
                gap: 4, zIndex: 3,
              }}>
                {posts.slice(Math.max(0, current - 3), current + 5).map((p, i) => {
                  const realIndex = Math.max(0, current - 3) + i;
                  const active = realIndex === current;
                  return (
                    <div key={p.id}
                      onClick={(e: any) => { e.stopPropagation(); scrollToIndex(realIndex); }}
                      style={{
                        width: active ? 5 : 4,
                        height: active ? 28 : 9,
                        borderRadius: 999,
                        background: active ? '#fff' : 'rgba(255,255,255,0.3)',
                        cursor: 'pointer',
                        transition: 'all 0.2s cubic-bezier(.25,.8,.25,1)',
                        boxShadow: active ? '0 0 8px rgba(255,255,255,0.5)' : 'none',
                      }}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <style>{`
        @keyframes blinkHeart {
          0%   { transform: scale(0.25) rotate(-10deg); opacity: 0; }
          30%  { transform: scale(1.2) rotate(5deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 0; }
        }

        @keyframes hintFade {
          0%   { opacity: 1; transform: translate(-50%, -50%) rotate(-3deg) scale(0.9); }
          20%  { opacity: 1; transform: translate(-50%, -50%) rotate(0deg) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -50%) rotate(-3deg) scale(0.95); }
        }

        @keyframes spinBlink {
          to { transform: rotate(360deg); }
        }

        *::-webkit-scrollbar {
          width: 0;
          height: 0;
        }
      `}</style>
    </div>
  );
}