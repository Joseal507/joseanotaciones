'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

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

const TIPO: Record<Post['tipo'], { label: string; color: string }> = {
  apunte: { label: 'Apunte', color: '#f5c842' },
  flashcards: { label: 'Flashcards', color: '#a78bfa' },
  quiz: { label: 'Quiz', color: '#34d399' },
  post: { label: 'Post', color: '#38bdf8' },
  video: { label: 'Video', color: '#ff4d6d' },
};

export default function StudyALBlinks({
  userId,
  topOffset = 0,
}: {
  userId: string;
  topOffset?: number;
}) {
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
        top: topOffset,
        left: 0,
        right: 0,
        bottom: 0,
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontWeight: 700,
      }}>
        Cargando Blinks...
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      top: topOffset,
      left: 0,
      right: 0,
      bottom: 0,
      background: '#000',
      overflow: 'hidden',
      zIndex: 1,
    }}>
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        display: 'flex',
        gap: '8px',
        padding: '8px 12px',
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '999px',
        maxWidth: '92vw',
        overflowX: 'auto',
      }}>
        {[
          { id: 'all', label: 'Todo' },
          { id: 'video', label: 'Videos' },
          { id: 'apunte', label: 'Apuntes' },
          { id: 'flashcards', label: 'Flashcards' },
          { id: 'quiz', label: 'Quizzes' },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id as any)}
            style={{
              padding: '7px 12px',
              borderRadius: '999px',
              border: 'none',
              background: filter === f.id ? '#fff' : 'rgba(255,255,255,0.08)',
              color: filter === f.id ? '#000' : '#fff',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {f.label}
          </button>
        ))}
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
                height: '100%',
                width: '100%',
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
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      background: '#000',
                    }}
                  />

                  <div style={{ position: 'absolute', inset: 0, display: 'flex', zIndex: 2 }}>
                    <div
                      style={{ flex: 1 }}
                      onClick={e => { e.stopPropagation(); handleZoneTap(post, 'left'); }}
                    />
                    <div
                      style={{ flex: 1 }}
                      onClick={e => { e.stopPropagation(); handleZoneTap(post, 'center'); }}
                    />
                    <div
                      style={{ flex: 1 }}
                      onClick={e => { e.stopPropagation(); handleZoneTap(post, 'right'); }}
                    />
                  </div>
                </>
              ) : post.portada_url ? (
                <img
                  src={post.portada_url}
                  alt={post.titulo}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
              ) : (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  background: `linear-gradient(135deg, ${post.materia_color || info.color}33 0%, #0b0b0b 100%)`,
                }} />
              )}

              <div style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.08) 28%, rgba(0,0,0,0.82) 100%)',
              }} />

              {heartId === post.id && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                  zIndex: 4,
                }}>
                  <div style={{ fontSize: '86px', animation: 'blinkHeart 0.8s ease forwards' }}>❤️</div>
                </div>
              )}

              {videoHint?.id === post.id && (
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  zIndex: 4,
                  background: 'rgba(0,0,0,0.55)',
                  color: '#fff',
                  borderRadius: '999px',
                  padding: '12px 18px',
                  fontSize: '20px',
                  fontWeight: 900,
                  pointerEvents: 'none',
                  animation: 'hintFade 0.6s ease forwards',
                }}>
                  {videoHint.text}
                </div>
              )}

              <div style={{
                position: 'absolute',
                left: 0,
                right: '88px',
                bottom: 0,
                padding: '18px 18px 26px',
                zIndex: 3,
              }}>
                <div
                  onClick={e => {
                    e.stopPropagation();
                    window.location.href = `/u/${post.user_id}`;
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    marginBottom: '10px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '999px',
                    overflow: 'hidden',
                    background: post.materia_color || info.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#000',
                    fontWeight: 900,
                    border: '2px solid rgba(255,255,255,0.3)',
                    flexShrink: 0,
                  }}>
                    {post.user_avatar
                      ? <img src={post.user_avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : (post.user_nombre?.[0]?.toUpperCase() || '?')}
                  </div>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 800, fontSize: '13px' }}>{post.user_nombre}</div>
                    <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '10px' }}>{tiempoAtras(post.created_at)}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  <span style={{
                    background: 'rgba(0,0,0,0.35)',
                    border: `1px solid ${info.color}88`,
                    color: '#fff',
                    padding: '3px 8px',
                    borderRadius: '999px',
                    fontSize: '11px',
                    fontWeight: 700,
                  }}>
                    {info.label}
                  </span>

                  {post.materia_nombre && (
                    <span style={{
                      background: 'rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.82)',
                      padding: '3px 8px',
                      borderRadius: '999px',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}>
                      {post.materia_emoji} {post.materia_nombre}
                    </span>
                  )}
                </div>

                <h2 style={{
                  color: '#fff',
                  fontWeight: 900,
                  fontSize: '20px',
                  lineHeight: 1.24,
                  margin: '0 0 8px',
                  textShadow: '0 2px 12px rgba(0,0,0,0.7)',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  {post.titulo}
                </h2>

                {post.descripcion && (
                  <p style={{
                    color: 'rgba(255,255,255,0.78)',
                    fontSize: '13px',
                    lineHeight: 1.5,
                    margin: '0 0 12px',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                    {post.descripcion}
                  </p>
                )}

                <Link href={`/comunidad/${post.id}`} style={{ textDecoration: 'none' }}>
                  <button
                    onClick={e => e.stopPropagation()}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '999px',
                      border: '1px solid rgba(255,255,255,0.2)',
                      background: 'rgba(0,0,0,0.35)',
                      color: '#fff',
                      fontSize: '12px',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    Ver post
                  </button>
                </Link>
              </div>

              <div style={{
                position: 'absolute',
                right: '14px',
                bottom: '92px',
                display: 'flex',
                flexDirection: 'column',
                gap: '18px',
                alignItems: 'center',
                zIndex: 3,
              }}>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    void triggerLike(post);
                  }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <div style={{
                    width: '50px',
                    height: '50px',
                    borderRadius: '999px',
                    background: post.user_liked ? '#ff4d6d' : 'rgba(0,0,0,0.46)',
                    border: '2px solid rgba(255,255,255,0.18)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '22px',
                    transform: likeAnimId === post.id ? 'scale(1.16)' : 'scale(1)',
                    transition: 'transform 0.18s ease',
                  }}>
                    {post.user_liked ? '❤️' : '🤍'}
                  </div>
                  <div style={{ color: '#fff', fontSize: '11px', fontWeight: 800, marginTop: '4px', textAlign: 'center' }}>
                    {post.likes_count}
                  </div>
                </button>

                <button
                  onClick={e => {
                    e.stopPropagation();
                    void toggleGuardar(post);
                  }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <div style={{
                    width: '50px',
                    height: '50px',
                    borderRadius: '999px',
                    background: post.guardado ? '#f5c842' : 'rgba(0,0,0,0.46)',
                    border: '2px solid rgba(255,255,255,0.18)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '22px',
                    transform: saveAnimId === post.id ? 'scale(1.14)' : 'scale(1)',
                    transition: 'transform 0.18s ease',
                  }}>
                    {post.guardado ? '🔖' : '📌'}
                  </div>
                  <div style={{ color: '#fff', fontSize: '10px', fontWeight: 800, marginTop: '4px', textAlign: 'center' }}>
                    Guardar
                  </div>
                </button>
              </div>

              {esVideo && (
                <button
                  onClick={e => {
                    e.stopPropagation();
                    void toggleMute(post.id);
                  }}
                  style={{
                    position: 'absolute',
                    top: '64px',
                    right: '14px',
                    zIndex: 3,
                    width: '44px',
                    height: '44px',
                    borderRadius: '999px',
                    border: '2px solid rgba(255,255,255,0.18)',
                    background: 'rgba(0,0,0,0.46)',
                    color: '#fff',
                    fontSize: '18px',
                    cursor: 'pointer',
                  }}
                >
                  {muted ? '🔇' : '🔊'}
                </button>
              )}

              <div style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                zIndex: 3,
              }}>
                {posts.slice(Math.max(0, current - 3), current + 5).map((p, i) => {
                  const realIndex = Math.max(0, current - 3) + i;
                  const active = realIndex === current;
                  return (
                    <div
                      key={p.id}
                      onClick={e => {
                        e.stopPropagation();
                        scrollToIndex(realIndex);
                      }}
                      style={{
                        width: active ? '4px' : '3px',
                        height: active ? '26px' : '8px',
                        borderRadius: '999px',
                        background: active ? '#fff' : 'rgba(255,255,255,0.28)',
                        cursor: 'pointer',
                        transition: 'all 0.18s ease',
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
          0% { transform: scale(0.25); opacity: 0; }
          30% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 0; }
        }

        @keyframes hintFade {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }

        *::-webkit-scrollbar {
          width: 0;
          height: 0;
        }
      `}</style>
    </div>
  );
}
