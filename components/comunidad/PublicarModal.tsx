'use client';
import { useMemo, useState } from 'react';
import { getMaterias } from '../../lib/storage';
import { supabase } from '../../lib/supabase';

const TIPOS = [
  { id: 'apunte', emoji: '📝', label: 'Apunte' },
  { id: 'flashcard', emoji: '🎴', label: 'Flashcards' },
  { id: 'quiz', emoji: '🤓', label: 'Quiz' },
];

function safeParse(key: string) {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export default function PublicarModal({
  onClose,
  onPublicado,
  tipoInicial,
  itemInicial,
  directPost,
}: any) {
  const isDirect = !!directPost;

  const [tipo, setTipo] = useState(directPost?.tipo || tipoInicial || 'apunte');
  const [titulo, setTitulo] = useState(directPost?.titulo || '');
  const [materiaId, setMateriaId] = useState('');
  const [itemId, setItemId] = useState(itemInicial || '');
  const [loading, setLoading] = useState(false);
  const [descripcion, setDescripcion] = useState('');
  const [publicado, setPublicado] = useState(false);
  const [portada, setPortada] = useState<File | null>(null);
  const [portadaPreview, setPortadaPreview] = useState('');

  const materias = getMaterias();
  const matActual = materias.find((m: any) => m.id === materiaId);

  const opciones = useMemo(() => {
    if (!matActual || isDirect) return [];

    if (tipo === 'apunte') {
      return (matActual.temas || [])
        .flatMap((t: any) =>
          (t.apuntes || []).map((a: any) => ({
            id: a.id,
            label: a.titulo || 'Apunte sin título',
            raw: a,
          }))
        );
    }

    if (tipo === 'flashcard') {
      const docsConFlashcards = (matActual.temas || []).flatMap((t: any) =>
        (t.documentos || [])
          .filter((d: any) => Array.isArray(d.flashcards) && d.flashcards.length > 0)
          .map((d: any) => ({
            id: `doc-${d.id}`,
            label: `${d.nombre || 'Documento'} · ${d.flashcards.length} tarjetas`,
            raw: d,
          }))
      );

      const decks = [
        ...safeParse('decks'),
        ...safeParse('flashcard_decks'),
        ...safeParse('flashcards_decks'),
      ]
        .filter((d: any) =>
          d?.materiaId === materiaId ||
          d?.materiaNombre === matActual.nombre ||
          d?.materiaColor === matActual.color
        )
        .map((d: any) => ({
          id: `deck-${d.id}`,
          label: `${d.nombre || 'Deck'} · ${(d.flashcards || []).length} tarjetas`,
          raw: d,
        }));

      const unicos = new Map();
      [...docsConFlashcards, ...decks].forEach((x: any) => unicos.set(x.id, x));
      return Array.from(unicos.values());
    }

    if (tipo === 'quiz') {
      const quizzes = [
        ...safeParse('quizzes_v2'),
        ...safeParse('quizzes'),
      ].filter((q: any) =>
        q?.materiaId === materiaId ||
        q?.materiaNombre === matActual.nombre ||
        q?.materiaColor === matActual.color
      );

      const unicos = new Map();
      quizzes.forEach((q: any) => {
        unicos.set(q.id, {
          id: q.id,
          label: `${q.nombre || 'Quiz'} · ${(q.preguntas || []).length} preguntas`,
          raw: q,
        });
      });

      return Array.from(unicos.values());
    }

    return [];
  }, [tipo, materiaId, matActual, isDirect]);

  const handlePortada = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return alert('Máximo 5MB');
    setPortada(f);
    setPortadaPreview(URL.createObjectURL(f));
  };

  const handleSelectItem = (val: string) => {
    setItemId(val);
    const found = opciones.find((o: any) => o.id === val);
    if (found && !titulo.trim()) {
      const limpio = String(found.label || '').split('·')[0].trim();
      setTitulo(limpio);
    }
  };

  const handlePublicar = async () => {
    if (!titulo.trim()) return alert('El título es obligatorio');

    setLoading(true);
    try {
      // Subir portada si existe
      let imageUrl = '';
      if (portada) {
        const name = Date.now() + '_' + portada.name.replace(/\s/g, '_');
        const { error: upErr } = await supabase.storage.from('comunidad').upload(name, portada);
        if (!upErr) imageUrl = supabase.storage.from('comunidad').getPublicUrl(name).data.publicUrl;
      }

      let payload: any;

      if (isDirect) {
        payload = {
          tipo: directPost.tipo || tipo,
          titulo: titulo.trim() || directPost.titulo || 'Publicación',
          materia: directPost.materia || directPost.materiaNombre || 'General',
          color: directPost.color || directPost.materiaColor || '#f5c842',
          emoji: directPost.emoji || directPost.materiaEmoji || '📚',
          imagen_url: imageUrl,
          descripcion: descripcion,
          contenido: directPost.contenido || {},
        };
      } else {
        if (!materiaId) return alert('Selecciona una materia');
        if (!itemId) return alert('Selecciona el contenido a compartir');

        const seleccionado = opciones.find((o: any) => o.id === itemId)?.raw;
        if (!seleccionado) return alert('No se encontró el contenido seleccionado');

        let contenido: any = {};

        if (tipo === 'apunte') {
          let raw = seleccionado.contenido;
          if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch {}
          }
          contenido = raw || {};
        }

        if (tipo === 'flashcard') {
          contenido = {
            tipo: 'flashcard',
            nombre: seleccionado.nombre || seleccionado.titulo || 'Flashcards',
            flashcards: seleccionado.flashcards || [],
            total: (seleccionado.flashcards || []).length,
            materiaNombre: matActual?.nombre,
            materiaColor: matActual?.color,
            materiaEmoji: matActual?.emoji,
          };
        }

        if (tipo === 'quiz') {
          contenido = {
            tipo: 'quiz',
            nombre: seleccionado.nombre || titulo,
            preguntas: seleccionado.preguntas || [],
            intentos: seleccionado.intentos || [],
            dificultad: seleccionado.dificultad || 'medium',
            total: (seleccionado.preguntas || []).length,
            materiaNombre: matActual?.nombre,
            materiaColor: matActual?.color,
            materiaEmoji: matActual?.emoji,
          };
        }

        payload = {
          tipo,
          titulo,
          materia: matActual?.nombre || 'General',
          color: matActual?.color || '#f5c842',
          emoji: matActual?.emoji || '📚',
          imagen_url: imageUrl,
          descripcion: descripcion,
          contenido,
        };
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const authToken = sessionData.session?.access_token || '';
      if (!authToken) {
        throw new Error('Debes iniciar sesión para publicar');
      }

      const res = await fetch('/api/comunidad', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || 'Error al publicar');
      }

      setPublicado(true);
      setTimeout(() => {
        onPublicado?.();
        onClose?.();
      }, 2500);
    } catch (e: any) {
      alert('Error: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      {publicado ? (
        <div style={{ background: '#111', width: '100%', maxWidth: '420px', borderRadius: '24px', border: '1px solid #333', overflow: 'hidden', textAlign: 'center', padding: '48px 32px' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px', animation: 'pulse 0.5s ease' }}>🎉</div>
          <h2 style={{ color: '#fff', margin: '0 0 12px', fontSize: '24px', fontWeight: 900 }}>
            {isDirect && directPost?.tipo === 'quiz' ? '¡Quiz publicado!' : isDirect && directPost?.tipo === 'flashcard' ? '¡Flashcards publicadas!' : '¡Publicado con éxito!'}
          </h2>
          <p style={{ color: '#4ade80', fontSize: '15px', fontWeight: 700, margin: '0 0 8px' }}>
            Gracias por apoyar a la comunidad 💚
          </p>
          <p style={{ color: '#888', fontSize: '13px', margin: '0 0 24px' }}>
            Tu contenido ya está disponible para todos los estudiantes
          </p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
            <div style={{ background: '#4ade8020', border: '1px solid #4ade8044', borderRadius: '12px', padding: '12px 20px' }}>
              <span style={{ fontSize: '20px' }}>{isDirect && directPost?.tipo === 'quiz' ? '🤓' : isDirect && directPost?.tipo === 'flashcard' ? '🎴' : '📝'}</span>
              <p style={{ color: '#4ade80', fontSize: '11px', fontWeight: 700, margin: '4px 0 0' }}>
                {isDirect && directPost?.tipo === 'quiz' ? 'Quiz' : isDirect && directPost?.tipo === 'flashcard' ? 'Flashcards' : 'Anotación'}
              </p>
            </div>
            <div style={{ background: '#f5c84220', border: '1px solid #f5c84244', borderRadius: '12px', padding: '12px 20px' }}>
              <span style={{ fontSize: '20px' }}>🌟</span>
              <p style={{ color: '#f5c842', fontSize: '11px', fontWeight: 700, margin: '4px 0 0' }}>Comunidad</p>
            </div>
          </div>
        </div>
      ) : (
      <div style={{ background: '#111', width: '100%', maxWidth: '420px', borderRadius: '24px', border: '1px solid #333', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ color: '#fff', margin: 0, fontSize: '18px', fontWeight: 800 }}>🚀 Publicar en Comunidad</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: '20px', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {!isDirect && (
            <>
              <div>
                <p style={{ color: '#888', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', margin: '0 0 8px' }}>Tipo de contenido</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                  {TIPOS.map(t => (
                    <button
                      key={t.id}
                      onClick={() => { setTipo(t.id); setItemId(''); }}
                      style={{
                        padding: '10px 4px',
                        borderRadius: '10px',
                        border: `2px solid ${tipo === t.id ? '#f5c842' : '#333'}`,
                        background: tipo === t.id ? '#f5c84220' : 'transparent',
                        color: tipo === t.id ? '#f5c842' : '#888',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <span style={{ fontSize: '18px' }}>{t.emoji}</span>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {isDirect && (
            <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: '14px', padding: '14px' }}>
              <p style={{ color: '#f5c842', fontSize: '12px', fontWeight: 800, margin: '0 0 6px' }}>
                {directPost?.tipo === 'quiz' ? '🤓 Quiz actual' : directPost?.tipo === 'flashcard' ? '🎴 Flashcards actuales' : '📝 Contenido actual'}
              </p>
              <p style={{ color: '#fff', fontSize: '14px', fontWeight: 700, margin: '0 0 4px' }}>
                {directPost?.titulo || 'Contenido actual'}
              </p>
              <p style={{ color: '#888', fontSize: '12px', margin: 0 }}>
                {directPost?.materia || directPost?.materiaNombre || 'General'}
              </p>
            </div>
          )}

          <div>
            <p style={{ color: '#888', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', margin: '0 0 8px' }}>Título</p>
            <input
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              placeholder="Dale un título a tu publicación..."
              style={{ width: '100%', padding: '12px', borderRadius: '10px', background: '#1a1a1a', color: '#fff', border: '1px solid #333', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {!isDirect && (
            <>
              <div>
                <p style={{ color: '#888', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', margin: '0 0 8px' }}>Materia</p>
                <select
                  value={materiaId}
                  onChange={e => { setMateriaId(e.target.value); setItemId(''); }}
                  style={{ width: '100%', padding: '12px', borderRadius: '10px', background: '#1a1a1a', color: '#fff', border: '1px solid #333', fontSize: '14px', outline: 'none' }}
                >
                  <option value="">Selecciona una materia...</option>
                  {materias.map((m: any) => (
                    <option key={m.id} value={m.id}>{m.emoji} {m.nombre}</option>
                  ))}
                </select>
              </div>

              {materiaId && (
                <div>
                  <p style={{ color: '#888', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', margin: '0 0 8px' }}>
                    {tipo === 'apunte' ? 'Apunte a compartir' : tipo === 'flashcard' ? 'Flashcards a compartir' : 'Quiz a compartir'}
                  </p>

                  {opciones.length === 0 ? (
                    <p style={{ color: '#666', fontSize: '13px', margin: 0 }}>
                      {tipo === 'apunte'
                        ? 'No hay apuntes en esta materia'
                        : tipo === 'flashcard'
                        ? 'No hay flashcards en esta materia'
                        : 'No hay quizzes en esta materia'}
                    </p>
                  ) : (
                    <select
                      value={itemId}
                      onChange={e => handleSelectItem(e.target.value)}
                      style={{ width: '100%', padding: '12px', borderRadius: '10px', background: '#1a1a1a', color: '#fff', border: '1px solid #333', fontSize: '14px', outline: 'none' }}
                    >
                      <option value="">Selecciona...</option>
                      {opciones.map((o: any) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </>
          )}

          {/* Imagen de portada */}
          <div>
            <p style={{ color: '#888', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', margin: '0 0 8px' }}>Descripción (opcional)</p>
            <textarea
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              placeholder="Describe tu publicación..."
              rows={2}
              style={{ width: '100%', padding: '10px', borderRadius: '10px', background: '#1a1a1a', color: '#fff', border: '1px solid #333', fontSize: '13px', outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          <div>
            <p style={{ color: '#888', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', margin: '0 0 8px' }}>📸 Imagen de portada (opcional)</p>
            {portadaPreview ? (
              <div style={{ position: 'relative', marginBottom: '8px' }}>
                <img src={portadaPreview} alt="Portada" style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '12px', border: '2px solid #333' }} />
                <button onClick={() => { setPortada(null); setPortadaPreview(''); }} style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', borderRadius: '50%', width: '28px', height: '28px', cursor: 'pointer', fontSize: '14px' }}>✕</button>
              </div>
            ) : (
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '16px', borderRadius: '12px', border: '2px dashed #333', background: '#1a1a1a', cursor: 'pointer', color: '#666', fontSize: '13px', fontWeight: 600 }}>
                📷 Seleccionar imagen
                <input type="file" accept="image/*" onChange={handlePortada} style={{ display: 'none' }} />
              </label>
            )}
          </div>

          <button
            onClick={handlePublicar}
            disabled={loading}
            style={{ width: '100%', padding: '15px', borderRadius: '14px', background: loading ? '#333' : '#f5c842', color: loading ? '#666' : '#000', fontWeight: 900, fontSize: '15px', cursor: loading ? 'not-allowed' : 'pointer', border: 'none', marginTop: '4px' }}
          >
            {loading ? '⏳ Publicando...' : '🚀 PUBLICAR AHORA'}
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
