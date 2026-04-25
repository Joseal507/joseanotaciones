'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useIsMobile } from '../../hooks/useIsMobile';
import NavbarMobile from '../../components/NavbarMobile';
import PostViewer from '../../components/comunidad/PostViewer';

export default function GuardadosPage() {
  const isMobile = useIsMobile();
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState('');
  const [token, setToken] = useState('');
  const [selectedPost, setSelectedPost] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { window.location.href = '/auth'; return; }
      setUserId(data.session.user.id);
      setToken(data.session.access_token);
    });
  }, []);

  useEffect(() => {
    if (!token) return;
    fetch('/api/comunidad/save', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(r => r.json())
      .then(d => { setPosts(d.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token]);

  const tipoLabel = (tipo: string) => tipo === 'quiz' ? '🤓 Quiz' : (tipo === 'flashcard' || tipo === 'flashcards') ? '🎴 Flashcards' : '📝 Apunte';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>
      {isMobile ? <NavbarMobile /> : (
        <>
          <header style={{ background: 'var(--bg-card)', borderBottom: '3px solid var(--gold)', padding: '0 40px', height: '68px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <button onClick={() => window.history.back()}
                style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '8px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                ← Volver
              </button>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>📌 Posts Guardados</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0 }}>Posts que guardaste para ver después</p>
              </div>
            </div>
            <button onClick={() => window.location.href = '/comunidad'}
              style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid #22c55e', background: 'transparent', color: '#22c55e', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
              🌍 Comunidad
            </button>
          </header>
          <div style={{ display: 'flex', height: '3px' }}>
            {['var(--gold)', 'var(--red)', 'var(--blue)', 'var(--pink)'].map((c, i) => <div key={i} style={{ flex: 1, background: c }} />)}
          </div>
        </>
      )}

      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: isMobile ? '80px 16px 40px' : '40px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>⏳</div>
            <p style={{ color: 'var(--text-faint)' }}>Cargando...</p>
          </div>
        ) : posts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', background: 'var(--bg-card)', borderRadius: '20px', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>📌</div>
            <h2 style={{ color: 'var(--text-primary)', margin: '0 0 8px', fontWeight: 800 }}>No has guardado nada aún</h2>
            <p style={{ color: 'var(--text-faint)', fontSize: '14px', margin: '0 0 24px' }}>
              Guarda posts de la comunidad para verlos aquí
            </p>
            <button onClick={() => window.location.href = '/comunidad'}
              style={{ padding: '12px 24px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontWeight: 800, cursor: 'pointer', fontSize: '14px' }}>
              🌍 Explorar comunidad
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
              <div style={{ width: '4px', height: '28px', background: 'var(--gold)', borderRadius: '2px' }} />
              <h2 style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
                {posts.length} post{posts.length !== 1 ? 's' : ''} guardado{posts.length !== 1 ? 's' : ''}
              </h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
              {posts.map((post: any) => (
                <div key={post.id} onClick={() => setSelectedPost({ ...post, _saved: true })}
                  style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden', cursor: 'pointer', transition: 'all 0.2s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)'; (e.currentTarget as HTMLElement).style.borderColor = post.color || 'var(--gold)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color)'; }}>
                  <div style={{ height: '4px', background: post.color || 'var(--gold)' }} />
                  {post.imagen_url
                    ? <img src={post.imagen_url} style={{ width: '100%', height: '120px', objectFit: 'cover' }} alt="" />
                    : <div style={{ height: '80px', background: `linear-gradient(135deg, ${post.color || '#f5c842'}22, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px' }}>{post.emoji}</div>
                  }
                  <div style={{ padding: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '10px', color: post.color || 'var(--gold)', fontWeight: 800, background: (post.color || '#f5c842') + '20', padding: '2px 8px', borderRadius: '6px' }}>
                        {tipoLabel(post.tipo)}
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>{post.emoji} {post.materia}</span>
                    </div>
                    <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px', lineHeight: 1.3 }}>{post.titulo}</h3>
                    {post.descripcion && (
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                        {post.descripcion}
                      </p>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>por {post.user_profiles?.nombre || 'Estudiante'}</span>
                      <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--text-faint)' }}>
                        <span>❤️ {post.likes || 0}</span>
                        {post.rating_count > 0 && <span>⭐ {(post.rating_sum / post.rating_count).toFixed(1)}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {selectedPost && (
        <PostViewer
          post={selectedPost}
          userId={userId}
          onClose={() => setSelectedPost(null)}
          onDelete={(id: string) => { setPosts(posts.filter(p => p.id !== id)); setSelectedPost(null); }}
          onUnsave={(id: string) => { setPosts(posts.filter(p => p.id !== id)); setSelectedPost(null); }}
        />
      )}
    </div>
  );
}
