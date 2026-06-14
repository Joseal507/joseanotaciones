'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSession } from 'next-auth/react';

const HAND = "'Caveat',cursive";
const BODY = "'Inter', system-ui, sans-serif";
const SERIF = "'Georgia','Times New Roman',serif";
const ADMIN_EMAIL = 'jose.alberto.deobaldia@gmail.com';

// 🔐 Pregunta secreta admin
const _q = ['C','u','a','l',' ','e','s',' ','t','u',' ','r','e','g','u','e','t','o','n','e','r','o',' ','f','a','v','o','r','i','t','o','?'].join('');
const _a = ['a','l','f','r','e','d','o',' ','m','e','r','c','u','r','i','o'].join('');

interface NewsItem {
  id: string;
  titulo: string;
  descripcion: string;
  contenido: string;
  tipo: 'foto' | 'video';
  media_url: string;
  categoria: string;
  destacada: boolean;
  autor: string;
  autor_email: string;
  created_at: string;
}

const CATEGORIAS = [
  { id: 'general',    label: 'GENERAL',    color: '#6b7280' },
  { id: 'producto',   label: 'PRODUCTO',   color: '#3b82f6' },
  { id: 'eventos',    label: 'EVENTOS',    color: '#a855f7' },
  { id: 'partners',   label: 'PARTNERS',   color: '#22c55e' },
  { id: 'comunidad',  label: 'COMUNIDAD',  color: '#f97316' },
  { id: 'anuncio',    label: 'ANUNCIO',    color: '#dc2626' },
];

export default function NewsPage() {
  const router = useRouter();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);

  // 🔐 Pregunta secreta state
  const [showSecret, setShowSecret] = useState(false);
  const [secretAnswer, setSecretAnswer] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [secretError, setSecretError] = useState(false);

  // Form
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [contenido, setContenido] = useState('');
  const [tipo, setTipo] = useState<'foto'|'video'>('foto');
  const [categoria, setCategoria] = useState('general');
  const [destacada, setDestacada] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    checkAdmin();
    loadNews();
    // Check si ya respondió la pregunta en esta sesión
    try {
      if (sessionStorage.getItem('_sk_news') === '1') setUnlocked(true);
    } catch {}
  }, []);

  const checkAdmin = async () => {
    const session: any = await getSession();
    if (session?.user?.email?.toLowerCase() === ADMIN_EMAIL) {
      setIsAdmin(true);
    }
  };

  const loadNews = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/news');
      const data = await res.json();
      if (data.success) setNews(data.news || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) {
      alert('Archivo muy grande. Máximo 50MB.');
      return;
    }
    if (f.type.startsWith('video/')) setTipo('video');
    else if (f.type.startsWith('image/')) setTipo('foto');
    else { alert('Solo imágenes o videos'); return; }
    setFile(f);
    const reader = new FileReader();
    reader.onload = (ev) => setFilePreview(ev.target?.result as string || '');
    reader.readAsDataURL(f);
  };

  const uploadFile = async (f: File): Promise<string> => {
    setUploadProgress(20);
    const form = new FormData();
    form.append('file', f);
    form.append('folder', 'news');
    const res = await fetch('/api/partner-upload', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || 'Error subiendo archivo');
    setUploadProgress(100);
    return data.url;
  };

  // 🔐 Click en publicar → primero pregunta secreta
  const attemptPublish = () => {
    if (unlocked) {
      handleSubmit();
    } else {
      setShowSecret(true);
      setSecretError(false);
      setSecretAnswer('');
    }
  };

  const checkSecret = () => {
    const ans = secretAnswer.trim().toLowerCase();
    if (ans === _a) {
      setUnlocked(true);
      setShowSecret(false);
      try { sessionStorage.setItem('_sk_news', '1'); } catch {}
      setTimeout(() => handleSubmit(), 200);
    } else {
      setSecretError(true);
      setTimeout(() => setSecretError(false), 1800);
    }
  };

  const handleSubmit = async () => {
    if (!titulo || !descripcion || !file) {
      alert('Completa título, descripción y selecciona un archivo');
      return;
    }
    setSaving(true);
    setUploadProgress(0);
    try {
      const mediaUrl = await uploadFile(file);
      const res = await fetch('/api/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ titulo, descripcion, contenido, tipo, media_url: mediaUrl, categoria, destacada }),
      });
      const data = await res.json();
      if (data.success) {
        setTitulo(''); setDescripcion(''); setContenido('');
        setFile(null); setFilePreview(''); setDestacada(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setShowForm(false);
        loadNews();
      } else {
        alert(data.error || 'Error al publicar');
      }
    } catch (e: any) {
      console.error(e);
      alert('Error: ' + e.message);
    }
    setSaving(false);
    setUploadProgress(0);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar esta noticia?')) return;
    try {
      const res = await fetch(`/api/news?id=${id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (data.success) loadNews();
      else alert(data.error || 'Error');
    } catch (e) { console.error(e); }
  };

  const destacadas = news.filter(n => n.destacada);
  const normales   = news.filter(n => !n.destacada);
  const principal  = destacadas[0] || normales[0];
  const secundarias = (destacadas.slice(1).length > 0 ? destacadas.slice(1) : normales.slice(1, 4));
  const restantes   = news.filter(n => n.id !== principal?.id && !secundarias.find(s => s.id === n.id));

  const catColor = (id: string) => CATEGORIAS.find(c => c.id === id)?.color || '#6b7280';
  const catLabel = (id: string) => CATEGORIAS.find(c => c.id === id)?.label || 'GENERAL';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '20px 16px 80px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        {/* Header newspaper */}
        <div style={{ textAlign: 'center', marginBottom: 24, paddingBottom: 16, borderBottom: '4px double var(--text-primary)' }}>
          <Link href="/" style={{ display: 'inline-block', marginBottom: 12, fontFamily: HAND, fontSize: 17, fontWeight: 700, color: 'var(--gold)', textDecoration: 'none', transform: 'rotate(-2deg)' }}>← volver al inicio</Link>
          <h1 style={{ fontFamily: SERIF, fontSize: 'clamp(36px, 6vw, 64px)', fontWeight: 900, color: 'var(--text-primary)', margin: 0, lineHeight: 1, letterSpacing: '-2px', textShadow: '2px 2px 0 var(--gold)' }}>
            THE STUDYAL TIMES
          </h1>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, padding: '6px 12px', borderTop: '2px solid var(--text-primary)', borderBottom: '1px solid var(--text-primary)', fontFamily: SERIF, fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', flexWrap: 'wrap', gap: 8 }}>
            <span>VOL. 1 · No. {news.length}</span>
            <span style={{ fontFamily: BODY, fontSize: 18, color: 'var(--gold)' }}>~ Noticias oficiales ~</span>
            <span>{new Date().toLocaleDateString('es-PA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
          </div>
        </div>

        {/* Admin button */}
        {isAdmin && (
          <div style={{ marginBottom: 20, textAlign: 'right' }}>
            <button onClick={() => setShowForm(!showForm)} style={{
              padding: '10px 18px', borderRadius: 10,
              border: '2.5px solid var(--text-primary)',
              background: showForm ? 'var(--red)' : 'var(--gold)',
              color: showForm ? '#fff' : '#000',
              fontFamily: HAND, fontSize: 18, fontWeight: 800,
              cursor: 'pointer', boxShadow: '3px 4px 0 var(--text-primary)',
              transform: 'rotate(-1deg)',
            }}>
              {showForm ? '✕ Cancelar' : '✏️ Nueva noticia'}
            </button>
          </div>
        )}

        {/* Form admin */}
        {isAdmin && showForm && (
          <div style={{
            background: 'var(--bg-card)', border: '2.5px solid var(--gold)',
            borderRadius: 12, padding: 24, marginBottom: 24,
            boxShadow: '4px 5px 0 var(--gold)', transform: 'rotate(-.3deg)',
          }}>
            <h2 style={{ fontFamily: HAND, fontSize: 28, fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 16px', transform: 'rotate(-1deg)', display: 'inline-block' }}>
              ✏️ Nueva noticia
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input value={titulo} onChange={(e: any) => setTitulo(e.target.value)} placeholder="Título" style={inputStyle} />
              <textarea value={descripcion} onChange={(e: any) => setDescripcion(e.target.value)} placeholder="Descripción corta (resumen)" rows={2} style={{ ...inputStyle, fontFamily: SERIF, resize: 'vertical' }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <select value={categoria} onChange={(e: any) => setCategoria(e.target.value)} style={inputStyle}>
                  {CATEGORIAS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', fontFamily: HAND, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={destacada} onChange={(e: any) => setDestacada(e.target.checked)} style={{ width: 18, height: 18 }} />
                  ⭐ Destacada (principal)
                </label>
              </div>

              {/* Upload */}
              <div style={{ border: '2.5px dashed var(--gold)', borderRadius: 10, padding: 16, background: 'color-mix(in srgb,var(--gold) 8%,transparent)', textAlign: 'center' }}>
                <input ref={fileInputRef} type="file" accept="image/*,video/*" onChange={handleFileChange} style={{ display: 'none' }} id="news-file-input" />
                {filePreview ? (
                  <div>
                    {tipo === 'video' ? (
                      <video src={filePreview} controls style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 8, marginBottom: 10 }} />
                    ) : (
                      <img src={filePreview} alt="" style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 8, marginBottom: 10 }} />
                    )}
                    <button onClick={() => { setFile(null); setFilePreview(''); if (fileInputRef.current) fileInputRef.current.value = ''; }} style={{
                      padding: '6px 14px', borderRadius: 7, border: '2px solid var(--red)',
                      background: 'transparent', color: 'var(--red)',
                      fontFamily: HAND, fontSize: 15, fontWeight: 800, cursor: 'pointer',
                    }}>🗑️ Quitar</button>
                  </div>
                ) : (
                  <label htmlFor="news-file-input" style={{ cursor: 'pointer', display: 'block' }}>
                    <div style={{ fontSize: 40, marginBottom: 8 }}>📎</div>
                    <p style={{ fontFamily: HAND, fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>
                      Selecciona imagen o video
                    </p>
                    <p style={{ fontFamily: HAND, fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)', margin: 0 }}>
                      ~ máximo 50MB ~
                    </p>
                  </label>
                )}
              </div>

              <textarea value={contenido} onChange={(e: any) => setContenido(e.target.value)} placeholder="Contenido completo (opcional, se muestra al abrir la noticia)" rows={6} style={{ ...inputStyle, fontFamily: SERIF, resize: 'vertical' }} />

              {uploadProgress > 0 && (
                <div style={{ height: 8, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden', border: '1.5px solid var(--text-primary)' }}>
                  <div style={{ width: `${uploadProgress}%`, height: '100%', background: 'var(--gold)', transition: 'width .3s' }} />
                </div>
              )}

              <button onClick={attemptPublish} disabled={saving} style={{
                padding: '12px', borderRadius: 10,
                border: '2.5px solid var(--text-primary)',
                background: 'var(--gold)', color: '#000',
                fontFamily: HAND, fontSize: 20, fontWeight: 800,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? .6 : 1,
                boxShadow: '3px 4px 0 var(--text-primary)',
              }}>
                {saving ? `⏳ Publicando... ${uploadProgress}%` : '📰 Publicar noticia'}
              </button>
            </div>
          </div>
        )}

        {/* 🔐 Modal pregunta secreta */}
        {showSecret && (
          <div onClick={() => setShowSecret(false)} style={{
            position: 'fixed', inset: 0, zIndex: 99999,
            background: 'rgba(0,0,0,.9)', backdropFilter: 'blur(10px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}>
            <div onClick={(e: any) => e.stopPropagation()} style={{
              width: '100%', maxWidth: 420,
              background: 'var(--bg-card)',
              border: `2.5px solid ${secretError ? '#dc2626' : 'var(--gold)'}`,
              borderRadius: 14, padding: '24px 22px',
              boxShadow: `5px 6px 0 ${secretError ? '#dc2626' : 'var(--gold)'}`,
              transform: secretError ? 'rotate(0deg)' : 'rotate(-1deg)',
              animation: secretError ? 'sShake .4s ease' : 'sPop .35s cubic-bezier(.34,1.4,.64,1)',
            }}>
              <style>{`
                @keyframes sShake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-10px)} 75%{transform:translateX(10px)} }
                @keyframes sPop { 0%{transform:scale(.85) rotate(0);opacity:0} 60%{transform:scale(1.03) rotate(-1deg);opacity:1} 100%{transform:scale(1) rotate(-1deg);opacity:1} }
              `}</style>

              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 48, marginBottom: 6 }}>🔐</div>
                <h2 style={{ fontFamily: HAND, fontSize: 26, fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 4px', transform: 'rotate(-1deg)', display: 'inline-block' }}>
                  Verificación admin
                </h2>
                <p style={{ fontFamily: HAND, fontSize: 14, fontStyle: 'italic', color: 'var(--text-muted)', margin: 0 }}>
                  ~ confirma que eres tú ~
                </p>
              </div>

              <p style={{ fontFamily: HAND, fontSize: 19, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center', margin: '0 0 12px' }}>
                {_q}
              </p>

              <input
                autoFocus
                value={secretAnswer}
                onChange={(e: any) => setSecretAnswer(e.target.value)}
                onKeyDown={(e: any) => { if (e.key === 'Enter') checkSecret(); }}
                placeholder="tu respuesta..."
                style={{
                  width: '100%',
                  padding: '12px 14px', borderRadius: 9,
                  border: `2.5px solid ${secretError ? '#dc2626' : 'var(--border-color)'}`,
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontFamily: HAND, fontSize: 19, fontWeight: 700,
                  outline: 'none', marginBottom: 12,
                  boxSizing: 'border-box',
                }}
              />

              {secretError && (
                <p style={{ fontFamily: BODY, fontSize: 15, color: '#dc2626', fontStyle: 'italic', textAlign: 'center', margin: '0 0 10px' }}>
                  ❌ ~ respuesta incorrecta ~
                </p>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={checkSecret} style={{
                  flex: 1, padding: 12, borderRadius: 9,
                  border: '2.5px solid var(--text-primary)',
                  background: 'var(--gold)', color: '#000',
                  fontFamily: HAND, fontSize: 18, fontWeight: 800, cursor: 'pointer',
                  boxShadow: '3px 4px 0 var(--text-primary)',
                  transform: 'rotate(-1deg)',
                }}>
                  ✅ Verificar
                </button>
                <button onClick={() => setShowSecret(false)} style={{
                  padding: '12px 18px', borderRadius: 9,
                  border: '2px dashed var(--border-color)',
                  background: 'transparent', color: 'var(--text-muted)',
                  fontFamily: HAND, fontSize: 17, fontWeight: 800, cursor: 'pointer',
                  transform: 'rotate(1deg)',
                }}>
                  ✕
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loading / Empty */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 50, marginBottom: 10 }}>📰</div>
            <p style={{ fontFamily: HAND, fontSize: 22, fontStyle: 'italic', color: 'var(--text-muted)' }}>~ cargando noticias ~</p>
          </div>
        ) : news.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px', background: 'var(--bg-card)', border: '2.5px dashed var(--border-color)', borderRadius: 12 }}>
            <div style={{ fontSize: 64, marginBottom: 14 }}>📰</div>
            <p style={{ fontFamily: HAND, fontSize: 26, color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
              ~ aún no hay noticias ~
            </p>
          </div>
        ) : (
          <>
            {/* HERO + SECUNDARIAS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 20, marginBottom: 24 }}>
              {principal && (
                <article onClick={() => setSelectedNews(principal)} style={{
                  gridColumn: secundarias.length > 0 ? 'span 1' : '1 / -1',
                  background: 'var(--bg-card)', border: '2.5px solid var(--text-primary)',
                  borderRadius: 12, overflow: 'hidden',
                  boxShadow: '4px 5px 0 var(--text-primary)',
                  cursor: 'pointer', transition: 'all .25s',
                }}
                  onMouseEnter={(e: any) => e.currentTarget.style.transform = 'translateY(-4px)'}
                  onMouseLeave={(e: any) => e.currentTarget.style.transform = 'translateY(0)'}
                >
                  {principal.tipo === 'video' ? (
                    <div style={{ aspectRatio: '16/9', background: '#000', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '2px solid var(--text-primary)' }}>
                      <video src={principal.media_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
                      <div style={{ position: 'absolute', fontSize: 60, opacity: .8 }}>▶️</div>
                    </div>
                  ) : (
                    <img src={principal.media_url} alt={principal.titulo} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderBottom: '2px solid var(--text-primary)' }} />
                  )}
                  <div style={{ padding: '18px 22px', position: 'relative' }}>
                    <span style={{ display: 'inline-block', padding: '3px 10px', background: catColor(principal.categoria), color: '#fff', fontFamily: SERIF, fontSize: 11, fontWeight: 900, letterSpacing: 1, marginBottom: 10 }}>{catLabel(principal.categoria)}</span>
                    <h2 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 8px', lineHeight: 1.15 }}>{principal.titulo}</h2>
                    <p style={{ fontFamily: SERIF, fontSize: 15, lineHeight: 1.5, color: 'var(--text-muted)', margin: 0 }}>{principal.descripcion}</p>
                    {isAdmin && (
                      <button onClick={(e: any) => { e.stopPropagation(); handleDelete(principal.id); }} style={delBtn}>🗑️</button>
                    )}
                  </div>
                </article>
              )}

              {secundarias.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {secundarias.map(n => (
                    <article key={n.id} onClick={() => setSelectedNews(n)} style={{
                      background: 'var(--bg-card)', border: '2px solid var(--text-primary)',
                      borderRadius: 10, overflow: 'hidden', boxShadow: '3px 3px 0 var(--text-primary)',
                      cursor: 'pointer', display: 'grid', gridTemplateColumns: '160px 1fr',
                      transition: 'all .25s', position: 'relative',
                    }}
                      onMouseEnter={(e: any) => e.currentTarget.style.transform = 'translateY(-3px)'}
                      onMouseLeave={(e: any) => e.currentTarget.style.transform = 'translateY(0)'}
                    >
                      {n.tipo === 'video' ? (
                        <div style={{ background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontSize: 30 }}>🎬</span>
                        </div>
                      ) : (
                        <img src={n.media_url} alt={n.titulo} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      )}
                      <div style={{ padding: '12px 14px', position: 'relative' }}>
                        <span style={{ display: 'inline-block', padding: '2px 7px', background: catColor(n.categoria), color: '#fff', fontFamily: SERIF, fontSize: 9, fontWeight: 900, letterSpacing: 1, marginBottom: 5 }}>{catLabel(n.categoria)}</span>
                        <h3 style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 4px', lineHeight: 1.2 }}>{n.titulo}</h3>
                        <p style={{ fontFamily: SERIF, fontSize: 12, lineHeight: 1.4, color: 'var(--text-muted)', margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.descripcion}</p>
                        {isAdmin && (
                          <button onClick={(e: any) => { e.stopPropagation(); handleDelete(n.id); }} style={delBtn}>🗑️</button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            {/* Grid restante */}
            {restantes.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
                  <div style={{ flex: 1, height: 1.5, background: 'var(--text-primary)' }} />
                  <span style={{ fontFamily: HAND, fontSize: 18, fontWeight: 800, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    ~ más noticias ~
                  </span>
                  <div style={{ flex: 1, height: 1.5, background: 'var(--text-primary)' }} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 18 }}>
                  {restantes.map((n, i) => (
                    <article key={n.id} onClick={() => setSelectedNews(n)} style={{
                      background: 'var(--bg-card)', border: '2px solid var(--text-primary)',
                      borderRadius: 10, overflow: 'hidden',
                      boxShadow: '3px 4px 0 var(--text-primary)',
                      cursor: 'pointer', transform: `rotate(${i % 2 === 0 ? -.3 : .3}deg)`,
                      transition: 'all .25s', position: 'relative',
                    }}
                      onMouseEnter={(e: any) => e.currentTarget.style.transform = 'rotate(0) translateY(-3px)'}
                      onMouseLeave={(e: any) => e.currentTarget.style.transform = `rotate(${i % 2 === 0 ? -.3 : .3}deg)`}
                    >
                      {n.tipo === 'video' ? (
                        <div style={{ aspectRatio: '16/9', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '2px solid var(--text-primary)' }}>
                          <span style={{ fontSize: 40 }}>🎬</span>
                        </div>
                      ) : (
                        <img src={n.media_url} alt={n.titulo} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderBottom: '2px solid var(--text-primary)' }} />
                      )}
                      <div style={{ padding: '12px 16px' }}>
                        <span style={{ display: 'inline-block', padding: '2px 8px', background: catColor(n.categoria), color: '#fff', fontFamily: SERIF, fontSize: 10, fontWeight: 900, letterSpacing: 1, marginBottom: 6 }}>{catLabel(n.categoria)}</span>
                        <h3 style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 4px', lineHeight: 1.2 }}>{n.titulo}</h3>
                        <p style={{ fontFamily: SERIF, fontSize: 12, color: 'var(--text-muted)', margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.descripcion}</p>
                        <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px dashed var(--border-color)', fontFamily: BODY, fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic', display: 'flex', justifyContent: 'space-between' }}>
                          <span>✍️ {n.autor}</span>
                          <span>{new Date(n.created_at).toLocaleDateString('es-PA', { month: 'short', day: 'numeric' })}</span>
                        </div>
                        {isAdmin && (
                          <button onClick={(e: any) => { e.stopPropagation(); handleDelete(n.id); }} style={delBtn}>🗑️</button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* Modal detalle */}
        {selectedNews && (
          <div onClick={() => setSelectedNews(null)} style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}>
            <div onClick={(e: any) => e.stopPropagation()} style={{
              width: '100%', maxWidth: 760, maxHeight: '92vh', overflowY: 'auto',
              background: 'var(--bg-card)', border: '2.5px solid var(--text-primary)',
              borderRadius: 14, boxShadow: '5px 6px 0 var(--gold)',
            }}>
              {selectedNews.tipo === 'video' ? (
                <video src={selectedNews.media_url} controls autoPlay style={{ width: '100%', display: 'block', background: '#000', maxHeight: 460 }} />
              ) : (
                <img src={selectedNews.media_url} alt={selectedNews.titulo} style={{ width: '100%', display: 'block', maxHeight: 460, objectFit: 'contain', background: '#000' }} />
              )}
              <div style={{ padding: '24px 28px' }}>
                <span style={{ display: 'inline-block', padding: '4px 12px', background: catColor(selectedNews.categoria), color: '#fff', fontFamily: SERIF, fontSize: 11, fontWeight: 900, letterSpacing: 1, marginBottom: 10 }}>{catLabel(selectedNews.categoria)}</span>
                <h2 style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 8px', lineHeight: 1.15 }}>{selectedNews.titulo}</h2>
                <p style={{ fontFamily: HAND, fontSize: 16, fontStyle: 'italic', color: 'var(--text-muted)', margin: '0 0 16px' }}>
                  por ✍️ {selectedNews.autor} · {new Date(selectedNews.created_at).toLocaleDateString('es-PA', { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
                <p style={{ fontFamily: SERIF, fontSize: 17, lineHeight: 1.5, color: 'var(--text-primary)', margin: '0 0 18px', fontWeight: 600 }}>{selectedNews.descripcion}</p>
                {selectedNews.contenido && (
                  <p style={{ fontFamily: SERIF, fontSize: 15, lineHeight: 1.75, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', margin: 0 }}>{selectedNews.contenido}</p>
                )}
                <button onClick={() => setSelectedNews(null)} style={{
                  marginTop: 22, padding: '10px 24px',
                  background: 'var(--gold)', color: '#000',
                  border: '2.5px solid var(--text-primary)', borderRadius: 10,
                  fontFamily: HAND, fontSize: 18, fontWeight: 800, cursor: 'pointer',
                  boxShadow: '3px 4px 0 var(--text-primary)',
                }}>← cerrar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: any = {
  padding: '10px 14px', borderRadius: 8,
  border: '2px solid var(--border-color)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  fontFamily: BODY, fontSize: 17, fontWeight: 600,
  outline: 'none',
};

const delBtn: any = {
  position: 'absolute', top: 8, right: 8,
  width: 28, height: 28, borderRadius: 6,
  background: 'var(--red)', color: '#fff',
  border: '2px solid var(--text-primary)',
  fontSize: 13, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  boxShadow: '1px 1px 0 var(--text-primary)',
};