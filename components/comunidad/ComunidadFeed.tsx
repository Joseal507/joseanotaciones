'use client';
import { useEffect, useMemo, useState } from 'react';
import PinterestCard from './PinterestCard';
import PostViewer from './PostViewer';
import './PinterestLayout.css';

const BOT_POSTS = [
  { id: 'bot-1', _bot: true, tipo: 'apunte', titulo: 'Mitocondria - Resumen Completo', materia: 'Biología', emoji: '🧬', color: '#4ade80', likes: 47, favorites: 12, descripcion: 'Todo lo que necesitas saber sobre la mitocondria y la respiración celular', created_at: '2025-04-20T10:00:00Z', contenido: { paginas: [] }, user_profiles: { nombre: 'María García', avatar_url: null }, imagen_url: '' },
  { id: 'bot-2', _bot: true, tipo: 'quiz', titulo: 'Quiz: Derivadas e Integrales', materia: 'Cálculo II', emoji: '📐', color: '#a78bfa', likes: 89, favorites: 34, descripcion: 'Ponte a prueba con 15 preguntas de derivadas', created_at: '2025-04-19T15:30:00Z', contenido: { tipo: 'quiz', nombre: 'Derivadas', preguntas: [{ pregunta: '¿Cuál es la derivada de x²?', opciones: ['2x','x','x²','2'], correcta: 0, explicacion: 'La regla de la potencia' }], dificultad: 'medium', total: 15 }, user_profiles: { nombre: 'Carlos López', avatar_url: null }, imagen_url: '' },
  { id: 'bot-3', _bot: true, tipo: 'flashcards', titulo: 'Flashcards - Tabla Periódica', materia: 'Química General', emoji: '⚗️', color: '#38bdf8', likes: 156, favorites: 67, descripcion: 'Los 30 elementos más importantes', created_at: '2025-04-18T08:00:00Z', contenido: { tipo: 'flashcard', flashcards: [{question:'¿Símbolo del Oro?',answer:'Au'}], total: 30 }, user_profiles: { nombre: 'Ana Rodríguez', avatar_url: null }, imagen_url: '' },
];

const RECENT_KEY = 'community_recent_searches';

export default function ComunidadFeed({ tipo, userId, token }: any) {
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState<any>(null);
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      setRecent(raw ? JSON.parse(raw) : []);
    } catch {
      setRecent([]);
    }
  }, []);

  const saveRecent = (q: string) => {
    const val = q.trim();
    if (!val) return;
    const next = [val, ...recent.filter(x => x !== val)].slice(0, 6);
    setRecent(next);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  };

  const cargar = async () => {
    setLoading(true);
    try {
      const url = '/api/comunidad?tipo=' + tipo + '&t=' + Date.now();
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json();
      let lista = json.data || [];

      if (tipo === 'mis_posts') {
        // Filtrar por userId del lado cliente
        lista = lista.filter((p: any) => p.user_id === userId);
        // Cargar contenido completo de cada post
        const postsConContenido = await Promise.all(
          lista.map(async (p: any) => {
            try {
              const r = await fetch('/api/comunidad/post?id=' + p.id);
              if (r.ok) { const d = await r.json(); return d.data || p; }
            } catch {}
            return p;
          })
        );
        setPosts(postsConContenido);
        setLoading(false);
        return;
      }

      let bots = BOT_POSTS;
      if (tipo !== 'todo') {
        bots = bots.filter((b: any) =>
          b.tipo === tipo ||
          (tipo === 'flashcards' && (b.tipo === 'flashcards' || b.tipo === 'flashcard'))
        );
      }

      lista = [...lista, ...bots];
      setPosts(lista);
    } catch (e) {
      setPosts(tipo !== 'mis_posts' ? BOT_POSTS : []);
    }
    setLoading(false);
  };

  useEffect(() => { cargar(); }, [tipo, userId]);

  const filteredPosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return posts;

    return posts.filter((p: any) => {
      const autor = p.user_profiles?.nombre || '';
      const desc = p.descripcion || '';
      const materia = p.materia || '';
      const titulo = p.titulo || '';
      return (
        titulo.toLowerCase().includes(q) ||
        desc.toLowerCase().includes(q) ||
        materia.toLowerCase().includes(q) ||
        autor.toLowerCase().includes(q)
      );
    });
  }, [posts, search]);

  const handleLike = async (post: any) => {
    if (post._bot) {
      const next = new Set(likedPosts);
      if (next.has(post.id)) {
        next.delete(post.id);
        setPosts(posts.map(p => p.id === post.id ? { ...p, likes: Math.max(0, (p.likes || 1) - 1) } : p));
      } else {
        next.add(post.id);
        setPosts(posts.map(p => p.id === post.id ? { ...p, likes: (p.likes || 0) + 1 } : p));
      }
      setLikedPosts(next);
      return;
    }

    try {
      const res = await fetch('/api/comunidad/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ post_id: post.id }),
      });
      const data = await res.json();
      const next = new Set(likedPosts);
      if (data.liked) next.add(post.id);
      else next.delete(post.id);
      setLikedPosts(next);
      setPosts(posts.map(p => p.id === post.id ? { ...p, likes: data.liked ? (p.likes || 0) + 1 : Math.max(0, (p.likes || 1) - 1) } : p));
    } catch {}
  };

  if (loading) {
    return (
      <div style={{ padding: '60px', textAlign: 'center' }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>⏳</div>
        <p style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Cargando publicaciones...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px' }}>
      {/* Searchbar */}
      <div style={{ maxWidth: '900px', margin: '0 auto 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '12px 14px' }}>
          <span style={{ fontSize: '18px', color: 'var(--text-faint)' }}>🔍</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveRecent(search); }}
            placeholder="Buscar por título, materia, descripción o usuario..."
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '14px' }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '14px' }}>✕</button>
          )}
        </div>

        {recent.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
            {recent.map((r, i) => (
              <button
                key={i}
                onClick={() => setSearch(r)}
                style={{ padding: '6px 12px', borderRadius: '20px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer' }}
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>

      {filteredPosts.length === 0 ? (
        <div style={{ padding: '80px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔎</div>
          <h3 style={{ color: 'var(--text-primary)', marginTop: '12px', fontWeight: 800 }}>No encontramos resultados</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Prueba con otro término de búsqueda.</p>
        </div>
      ) : (
        <div className="masonry-grid">
          {Array.from({ length: typeof window !== 'undefined' ? (window.innerWidth < 640 ? 2 : window.innerWidth < 1024 ? 3 : 4) : 3 }).map((_, ci) => {
            const col = filteredPosts.filter((_, i) => i % (typeof window !== 'undefined' ? (window.innerWidth < 640 ? 2 : window.innerWidth < 1024 ? 3 : 4) : 3) === ci);
            return (
              <div key={ci} className="masonry-grid_column" style={{ flex: 1 }}>
                {col.map((post: any) => (
                  <div key={post.id} style={{ marginBottom: '16px' }}>
                    <PinterestCard
                      post={post}
                      userId={userId}
                      liked={likedPosts.has(post.id)}
                      onLike={() => handleLike(post)}
                      onClick={() => {
                        if (search.trim()) saveRecent(search);
                        setSelectedPost(post);
                      }}
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {selectedPost && (
        <PostViewer
          post={selectedPost}
          userId={userId}
          onClose={() => setSelectedPost(null)}
          onDelete={(id: string) => setPosts(posts.filter(p => p.id !== id))}
        />
      )}
    </div>
  );
}
