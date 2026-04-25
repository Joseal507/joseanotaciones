'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import NavbarMobile from '../../components/NavbarMobile';
import { useIsMobile } from '../../hooks/useIsMobile';
import PostViewer from '../../components/comunidad/PostViewer';

export default function PerfilPublicoPage() {
  const isMobile = useIsMobile();
  const [uid, setUid] = useState('');
  const [myId, setMyId] = useState('');
  const [token, setToken] = useState('');
  const [profile, setProfile] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [selectedPost, setSelectedPost] = useState<any>(null);
  const [showReport, setShowReport] = useState(false);
  const [reportMotivo, setReportMotivo] = useState('');
  const [reportSent, setReportSent] = useState(false);
  const [tab, setTab] = useState<'posts' | 'info'>('posts');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const u = params.get('uid') || '';
    setUid(u);
    supabase.auth.getSession().then(({ data }) => {
      setMyId(data.session?.user.id || '');
      setToken(data.session?.access_token || '');
    });
  }, []);

  const cargar = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    const res = await fetch('/api/user/profile?uid=' + uid);
    const d = await res.json();
    setProfile(d.profile);
    setPosts(d.posts || []);
    setLoading(false);
  }, [uid]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    if (!uid || !myId || !token || uid === myId) return;
    supabase.from('user_follows').select('id').eq('follower_id', myId).eq('following_id', uid).maybeSingle()
      .then(({ data }) => setFollowing(!!data));
    supabase.from('user_blocks').select('id').eq('blocker_id', myId).eq('blocked_id', uid).maybeSingle()
      .then(({ data }) => setBlocked(!!data));
  }, [uid, myId, token]);

  const handleFollow = async () => {
    const res = await fetch('/api/user/follow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ target_id: uid }),
    });
    const d = await res.json();
    setFollowing(d.following);
    setProfile((p: any) => p ? {
      ...p,
      followers_count: d.following ? (p.followers_count || 0) + 1 : Math.max(0, (p.followers_count || 1) - 1)
    } : p);
  };

  const handleBlock = async () => {
    if (!confirm(blocked ? '¿Desbloquear a este usuario?' : '¿Bloquear a este usuario?')) return;
    const res = await fetch('/api/user/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ target_id: uid }),
    });
    const d = await res.json();
    setBlocked(d.blocked);
  };

  const handleReport = async () => {
    await fetch('/api/user/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ reported_user_id: uid, motivo: reportMotivo }),
    });
    setReportSent(true);
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>👤</div>
        <p style={{ color: 'var(--text-muted)' }}>Cargando perfil...</p>
      </div>
    </div>
  );

  if (!profile) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '12px' }}>😕</div>
        <p style={{ color: 'var(--text-muted)' }}>Perfil no encontrado</p>
        <button onClick={() => window.history.back()} style={{ marginTop: '16px', padding: '10px 20px', borderRadius: '10px', border: '2px solid var(--gold)', background: 'transparent', color: 'var(--gold)', fontWeight: 700, cursor: 'pointer' }}>← Volver</button>
      </div>
    </div>
  );

  const isMe = myId === uid;
  const inicial = (profile.nombre || 'E')[0].toUpperCase();
  const tipoLabel = (tipo: string) => tipo === 'quiz' ? '🤓 Quiz' : tipo === 'flashcard' || tipo === 'flashcards' ? '🎴 Flash' : '📝 Apunte';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>
      {isMobile && <NavbarMobile />}

      {!isMobile && (
        <>
          <header style={{ background: 'var(--bg-card)', borderBottom: '3px solid var(--gold)', padding: '0 40px', height: '68px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <button onClick={() => window.history.back()}
                style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '8px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                ← Volver
              </button>
              <h1 style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
                👤 Perfil Social
              </h1>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {isMe && (
                <>
                  <button onClick={() => window.location.href = '/perfil'}
                    style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--gold)', background: 'transparent', color: 'var(--gold)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                    📊 Mis Stats
                  </button>
                  <button onClick={() => window.location.href = '/settings'}
                    style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                    ⚙️ Editar perfil
                  </button>
                </>
              )}
            </div>
          </header>
          <div style={{ display: 'flex', height: '3px' }}>
            {['var(--gold)', 'var(--red)', 'var(--blue)', 'var(--pink)'].map((c, i) => (
              <div key={i} style={{ flex: 1, background: c }} />
            ))}
          </div>
        </>
      )}

      <div style={{ maxWidth: '860px', margin: '0 auto', padding: isMobile ? '80px 16px 40px' : '40px 24px' }}>

        {/* CARD PERFIL */}
        <div style={{ background: 'var(--bg-card)', borderRadius: '24px', border: '1px solid var(--border-color)', overflow: 'hidden', marginBottom: '24px' }}>
          {/* Banner */}
          <div style={{ height: isMobile ? '90px' : '120px', background: 'linear-gradient(135deg, var(--gold)44 0%, var(--blue)33 50%, var(--pink)22 100%)', position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,0.03) 10px, rgba(255,255,255,0.03) 20px)' }} />
          </div>

          <div style={{ padding: isMobile ? '0 16px 20px' : '0 28px 28px' }}>
            {/* Avatar + acciones */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: isMobile ? '-36px' : '-44px', marginBottom: '16px' }}>
              {/* Avatar */}
              <div style={{ position: 'relative' }}>
                <div style={{ width: isMobile ? 70 : 88, height: isMobile ? 70 : 88, borderRadius: '50%', border: '4px solid var(--bg-card)', overflow: 'hidden', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isMobile ? '26px' : '34px', fontWeight: 900, color: '#000' }}>
                  {profile.foto_url
                    ? <img src={profile.foto_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : inicial}
                </div>
                {isMe && (
                  <div style={{ position: 'absolute', bottom: 2, right: 2, width: 22, height: 22, borderRadius: '50%', background: '#4ade80', border: '2px solid var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px' }}>✓</div>
                )}
              </div>

              {/* Botones */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {isMe ? (
                  <>
                    <button onClick={() => window.location.href = '/perfil'}
                      style={{ padding: '8px 14px', borderRadius: '10px', border: '2px solid var(--gold)', background: 'transparent', color: 'var(--gold)', fontWeight: 800, fontSize: '12px', cursor: 'pointer' }}>
                      📊 Mis Stats
                    </button>
                    <button onClick={() => window.location.href = '/settings'}
                      style={{ padding: '8px 14px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}>
                      ✏️ Editar
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={handleFollow}
                      style={{ padding: '8px 18px', borderRadius: '10px', border: following ? '2px solid var(--border-color)' : 'none', background: following ? 'transparent' : 'var(--gold)', color: following ? 'var(--text-muted)' : '#000', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
                      {following ? '✓ Siguiendo' : '+ Seguir'}
                    </button>
                    <button onClick={handleBlock}
                      style={{ padding: '8px 12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer' }}>
                      {blocked ? '🔓' : '🚫'}
                    </button>
                    <button onClick={() => setShowReport(true)}
                      style={{ padding: '8px 12px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer' }}>
                      ⚑
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Nombre y datos */}
            <div style={{ marginBottom: '16px' }}>
              <h1 style={{ fontSize: isMobile ? '20px' : '26px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 6px' }}>
                {profile.nombre || 'Estudiante'}
                {isMe && <span style={{ fontSize: '12px', color: 'var(--gold)', fontWeight: 700, marginLeft: '8px', background: 'var(--gold-dim)', padding: '2px 8px', borderRadius: '6px' }}>Tú</span>}
              </h1>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                {profile.carrera && (
                  <span style={{ fontSize: '12px', color: 'var(--gold)', fontWeight: 700, background: 'var(--gold-dim)', padding: '4px 12px', borderRadius: '20px', border: '1px solid var(--gold-border)' }}>
                    📚 {profile.carrera}
                  </span>
                )}
                {profile.universidad && (
                  <span style={{ fontSize: '12px', color: 'var(--blue)', fontWeight: 700, background: 'var(--blue-dim)', padding: '4px 12px', borderRadius: '20px', border: '1px solid var(--blue-border)' }}>
                    🏫 {profile.universidad}
                  </span>
                )}
                {profile.tipo_estudiante && (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, background: 'var(--bg-secondary)', padding: '4px 12px', borderRadius: '20px', border: '1px solid var(--border-color)' }}>
                    🎓 {profile.tipo_estudiante}
                  </span>
                )}
              </div>

              {profile.bio && (
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, maxWidth: '560px' }}>
                  {profile.bio}
                </p>
              )}

              {isMe && !profile.bio && (
                <p style={{ fontSize: '13px', color: 'var(--text-faint)', fontStyle: 'italic', margin: 0 }}>
                  Sin bio ·{' '}
                  <span onClick={() => window.location.href = '/settings'} style={{ color: 'var(--gold)', cursor: 'pointer', fontStyle: 'normal', fontWeight: 700 }}>
                    Agregar en Settings
                  </span>
                </p>
              )}
            </div>

            {/* Stats sociales */}
            <div style={{ display: 'flex', gap: isMobile ? '16px' : '28px', flexWrap: 'wrap' }}>
              {[
                { label: 'Seguidores', value: profile.followers_count || 0, color: 'var(--blue)' },
                { label: 'Siguiendo',  value: profile.following_count || 0, color: 'var(--pink)' },
                { label: 'Posts',      value: posts.length,                 color: '#22c55e' },
              ].map((s, i) => (
                <div key={i} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: isMobile ? '20px' : '24px', fontWeight: 900, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-faint)', fontWeight: 600 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* TABS */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {[
            { id: 'posts', label: '📌 Publicaciones' },
            { id: 'info',  label: '📋 Información'  },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              style={{ padding: '10px 20px', borderRadius: '10px', border: tab === t.id ? 'none' : '1px solid var(--border-color)', background: tab === t.id ? 'var(--gold)' : 'var(--bg-card)', color: tab === t.id ? '#000' : 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* TAB POSTS */}
        {tab === 'posts' && (
          <>
            {posts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px', background: 'var(--bg-card)', borderRadius: '20px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>📭</div>
                <h3 style={{ color: 'var(--text-primary)', margin: '0 0 8px', fontWeight: 800 }}>Sin publicaciones aún</h3>
                <p style={{ color: 'var(--text-faint)', fontSize: '13px', margin: 0 }}>
                  {isMe ? 'Comparte tus apuntes, quizzes o flashcards con la comunidad' : 'Este usuario no ha publicado nada aún'}
                </p>
                {isMe && (
                  <button onClick={() => window.location.href = '/comunidad'}
                    style={{ marginTop: '16px', padding: '10px 20px', borderRadius: '10px', border: 'none', background: 'var(--gold)', color: '#000', fontWeight: 800, cursor: 'pointer' }}>
                    🌍 Ir a Comunidad
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: '12px' }}>
                {posts.map((post: any) => (
                  <div key={post.id}
                    onClick={() => setSelectedPost({ ...post, user_profiles: { nombre: profile.nombre, avatar_url: profile.foto_url } })}
                    style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden', cursor: 'pointer', transition: 'all 0.2s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)'; (e.currentTarget as HTMLElement).style.borderColor = post.color || 'var(--gold)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color)'; }}
                  >
                    <div style={{ height: '4px', background: post.color || 'var(--gold)' }} />
                    {post.imagen_url ? (
                      <img src={post.imagen_url} style={{ width: '100%', height: '100px', objectFit: 'cover' }} alt="" />
                    ) : (
                      <div style={{ height: '70px', background: `linear-gradient(135deg, ${post.color || '#f5c842'}22, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px' }}>
                        {post.emoji}
                      </div>
                    )}
                    <div style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '10px', color: post.color || 'var(--gold)', fontWeight: 700, background: (post.color || '#f5c842') + '20', padding: '2px 6px', borderRadius: '6px' }}>
                          {tipoLabel(post.tipo)}
                        </span>
                      </div>
                      <p style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {post.titulo}
                      </p>
                      <div style={{ display: 'flex', gap: '8px', fontSize: '10px', color: 'var(--text-faint)' }}>
                        <span>❤️ {post.likes || 0}</span>
                        <span>👁️ {post.views || 0}</span>
                        {post.rating_count > 0 && <span>⭐ {(post.rating_sum / post.rating_count).toFixed(1)}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* TAB INFO */}
        {tab === 'info' && (
          <div style={{ background: 'var(--bg-card)', borderRadius: '20px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <div style={{ height: '4px', background: 'var(--gold)' }} />
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>📋 Información</h3>
              {[
                { label: '👤 Nombre',       value: profile.nombre || '—' },
                { label: '📚 Carrera',       value: profile.carrera || '—' },
                { label: '🏫 Universidad',   value: profile.universidad || '—' },
                { label: '🎓 Tipo',          value: profile.tipo_estudiante || '—' },
                { label: '📅 Miembro desde', value: profile.created_at ? new Date(profile.created_at).toLocaleDateString('es-ES', { year: 'numeric', month: 'long' }) : '—' },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: '10px' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>{item.label}</span>
                  <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 700 }}>{item.value}</span>
                </div>
              ))}
              {isMe && (
                <button onClick={() => window.location.href = '/settings'}
                  style={{ padding: '12px', borderRadius: '10px', border: '2px solid var(--gold)', background: 'transparent', color: 'var(--gold)', fontWeight: 800, cursor: 'pointer', fontSize: '13px' }}>
                  ✏️ Editar mi información
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal reporte */}
      {showReport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}>
          <div style={{ background: 'var(--bg-card)', borderRadius: '20px', padding: '24px', width: '100%', maxWidth: '380px', border: '1px solid var(--border-color)' }}>
            {reportSent ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
                <h3 style={{ color: 'var(--text-primary)', margin: '0 0 8px' }}>Reporte enviado</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 0 16px' }}>Gracias, revisaremos el caso.</p>
                <button onClick={() => { setShowReport(false); setReportSent(false); }} style={{ padding: '10px 24px', borderRadius: '10px', border: 'none', background: 'var(--gold)', color: '#000', fontWeight: 800, cursor: 'pointer' }}>Cerrar</button>
              </div>
            ) : (
              <>
                <h3 style={{ color: 'var(--text-primary)', margin: '0 0 16px', fontWeight: 800 }}>🚨 Reportar usuario</h3>
                {['Contenido inapropiado', 'Spam', 'Acoso', 'Información falsa', 'Otro'].map(m => (
                  <button key={m} onClick={() => setReportMotivo(m)}
                    style={{ display: 'block', width: '100%', padding: '10px', borderRadius: '8px', border: '2px solid ' + (reportMotivo === m ? '#ef4444' : 'var(--border-color)'), background: reportMotivo === m ? '#ef444415' : 'transparent', color: reportMotivo === m ? '#ef4444' : 'var(--text-primary)', fontWeight: 600, cursor: 'pointer', marginBottom: '6px', textAlign: 'left' }}>
                    {m}
                  </button>
                ))}
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button onClick={() => setShowReport(false)} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
                  <button onClick={handleReport} disabled={!reportMotivo} style={{ flex: 2, padding: '10px', borderRadius: '10px', border: 'none', background: reportMotivo ? '#ef4444' : 'var(--bg-secondary)', color: reportMotivo ? '#fff' : 'var(--text-faint)', fontWeight: 800, cursor: reportMotivo ? 'pointer' : 'not-allowed' }}>Reportar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {selectedPost && (
        <PostViewer
          post={selectedPost}
          userId={myId}
          onClose={() => setSelectedPost(null)}
          onDelete={(id: string) => { setPosts(posts.filter(p => p.id !== id)); setSelectedPost(null); }}
        />
      )}
    </div>
  );
}
