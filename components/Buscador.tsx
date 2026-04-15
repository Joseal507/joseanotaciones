'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { getMateriasDB } from '../lib/db';
import { useIdioma } from '../hooks/useIdioma';

interface Resultado {
  tipo: 'apunte' | 'documento' | 'materia' | 'tema' | 'pagina';
  titulo: string;
  subtitulo?: string;
  materia?: string;
  materiaColor?: string;
  tema?: string;
  preview?: string;
  href?: string;
  materiaId?: string;
  temaId?: string;
  id?: string;
  emoji?: string;
}

interface Props {
  onClose: () => void;
}

export default function Buscador({ onClose }: Props) {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [cargando, setCargando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { tr, idioma } = useIdioma();

  const PAGINAS = [
    { titulo: tr('misMaterias'), subtitulo: idioma === 'en' ? 'View all your subjects' : 'Ver todas tus materias', emoji: '📚', href: '/materias', keywords: ['materia', 'materias', 'temas', 'apuntes', 'subject', 'subjects'] },
    { titulo: tr('agenda'), subtitulo: tr('calendarioYObjetivos'), emoji: '📅', href: '/agenda', keywords: ['agenda', 'calendario', 'asignacion', 'tareas', 'calendar', 'assignments'] },
    { titulo: tr('horario'), subtitulo: idioma === 'en' ? 'Class schedule' : 'Horario de clases', emoji: '🗓️', href: '/horario', keywords: ['horario', 'clases', 'schedule', 'class'] },
    { titulo: 'AlciBot', subtitulo: idioma === 'en' ? 'Chat with AI' : 'Chat con AI', emoji: '🤖', href: '/chat', keywords: ['alcibot', 'chat', 'ai', 'bot'] },
    { titulo: tr('perfil'), subtitulo: idioma === 'en' ? 'Study stats' : 'Stats de estudio', emoji: '📊', href: '/perfil', keywords: ['perfil', 'stats', 'profile', 'progress'] },
    { titulo: tr('quizzes'), subtitulo: idioma === 'en' ? 'Saved study materials' : 'Materiales de estudio guardados', emoji: '🎓', href: '/quizzes', keywords: ['quiz', 'quizzes', 'flashcard', 'deck'] },
  ];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    if (!query.trim()) { setResultados([]); return; }
    setCargando(true);
    const timer = setTimeout(async () => {
      await buscar(query.trim().toLowerCase());
      setCargando(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const buscar = async (q: string) => {
    try {
      const encontrados: Resultado[] = [];

      PAGINAS.forEach(pagina => {
        const match = pagina.titulo.toLowerCase().includes(q) ||
          pagina.subtitulo.toLowerCase().includes(q) ||
          pagina.keywords.some(k => k.includes(q));
        if (match) {
          encontrados.push({ tipo: 'pagina', titulo: pagina.titulo, subtitulo: pagina.subtitulo, emoji: pagina.emoji, href: pagina.href });
        }
      });

      try {
        const { getQuizzesGuardados, getFlashcardDecks } = await import('../lib/quizStorage');
        getQuizzesGuardados().forEach(quiz => {
          if (quiz.nombre.toLowerCase().includes(q) || quiz.materiaNombre?.toLowerCase().includes(q)) {
            encontrados.push({ tipo: 'pagina', titulo: quiz.nombre, subtitulo: `🤓 ${quiz.preguntas.length} ${idioma === 'en' ? 'questions' : 'preguntas'}${quiz.materiaNombre ? ` · ${quiz.materiaNombre}` : ''}`, emoji: '🤓', href: '/quizzes' });
          }
        });
        getFlashcardDecks().forEach(deck => {
          if (deck.nombre.toLowerCase().includes(q) || deck.materiaNombre?.toLowerCase().includes(q)) {
            encontrados.push({ tipo: 'pagina', titulo: deck.nombre, subtitulo: `🎴 ${deck.flashcards.length} flashcards${deck.materiaNombre ? ` · ${deck.materiaNombre}` : ''}`, emoji: '🎴', href: '/quizzes' });
          }
        });
      } catch {}

      const { data } = await supabase.auth.getUser();
      if (!data.user) { setResultados(encontrados); return; }

      const materias = await getMateriasDB(data.user.id);
      materias.forEach(materia => {
        if (materia.nombre.toLowerCase().includes(q)) {
          encontrados.push({ tipo: 'materia', titulo: materia.nombre, subtitulo: `${materia.temas.length} ${tr('temas')}`, emoji: materia.emoji, materiaColor: materia.color, href: '/materias' });
        }
        materia.temas.forEach(tema => {
          if (tema.nombre.toLowerCase().includes(q)) {
            encontrados.push({ tipo: 'tema', titulo: tema.nombre, subtitulo: `${tema.apuntes.length} ${tr('apuntes').toLowerCase()} · ${tema.documentos.length} docs`, materia: materia.nombre, materiaColor: materia.color, href: '/materias' });
          }
          tema.apuntes.forEach(apunte => {
            const textoPlano = apunte.contenido ? apunte.contenido.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
            if (apunte.titulo.toLowerCase().includes(q) || textoPlano.toLowerCase().includes(q)) {
              const idx = textoPlano.toLowerCase().indexOf(q);
              const preview = idx >= 0 ? '...' + textoPlano.substring(Math.max(0, idx - 60), Math.min(textoPlano.length, idx + 100)) + '...' : textoPlano.substring(0, 120);
              encontrados.push({ tipo: 'apunte', titulo: apunte.titulo, materia: materia.nombre, materiaColor: materia.color, tema: tema.nombre, preview, materiaId: materia.id, temaId: tema.id, id: apunte.id });
            }
          });
          tema.documentos.forEach(doc => {
            if (doc.nombre.toLowerCase().includes(q) || doc.contenido?.toLowerCase().includes(q) || doc.analisis?.keywords?.some(k => k.toLowerCase().includes(q)) || doc.analisis?.summary?.toLowerCase().includes(q)) {
              const preview = doc.analisis?.summary?.substring(0, 120) || doc.contenido?.substring(0, 120) || '';
              encontrados.push({ tipo: 'documento', titulo: doc.nombre, materia: materia.nombre, materiaColor: materia.color, tema: tema.nombre, preview, materiaId: materia.id, temaId: tema.id, id: doc.id });
            }
          });
        });
      });

      setResultados(encontrados);
    } catch (err) { console.error(err); }
  };

  const abrirResultado = (r: Resultado) => {
    if (r.tipo === 'apunte' || r.tipo === 'documento') {
      localStorage.setItem('josea_search_result', JSON.stringify({ tipo: r.tipo, materiaId: r.materiaId, temaId: r.temaId, id: r.id }));
    }
    window.location.href = r.href || '/materias';
    onClose();
  };

  const highlightQuery = (texto: string) => {
    if (!query.trim()) return texto;
    const regex = new RegExp(`(${query.trim()})`, 'gi');
    const partes = texto.split(regex);
    return partes.map((parte, i) =>
      regex.test(parte)
        ? <mark key={i} style={{ background: 'var(--gold)', color: '#000', borderRadius: '3px', padding: '0 2px', fontWeight: 700 }}>{parte}</mark>
        : parte
    );
  };

  const getTipoInfo = (tipo: Resultado['tipo']) => {
    switch (tipo) {
      case 'pagina': return { label: idioma === 'en' ? 'Page' : 'Página', color: 'var(--blue)' };
      case 'materia': return { label: idioma === 'en' ? 'Subject' : 'Materia', color: 'var(--gold)' };
      case 'tema': return { label: idioma === 'en' ? 'Topic' : 'Tema', color: 'var(--pink)' };
      case 'apunte': return { label: idioma === 'en' ? 'Note' : 'Apunte', color: '#4ade80' };
      case 'documento': return { label: idioma === 'en' ? 'Document' : 'Documento', color: 'var(--blue)' };
      default: return { label: tipo, color: 'var(--text-muted)' };
    }
  };

  const getIcono = (r: Resultado) => {
    if (r.emoji) return r.emoji;
    switch (r.tipo) {
      case 'materia': return '📚';
      case 'tema': return '📁';
      case 'apunte': return '✏️';
      case 'documento': return '📄';
      default: return '🔗';
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 3000, padding: '60px 20px 20px' }}
      onClick={onClose}>
      <div style={{ width: '100%', maxWidth: '680px', background: 'var(--bg-card)', borderRadius: '20px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}
        onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '20px', flexShrink: 0 }}>🔍</span>
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            placeholder={tr('buscarPlaceholder')}
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: '17px', color: 'var(--text-primary)', fontFamily: 'inherit' }}
          />
          {cargando && <span style={{ fontSize: '13px', color: 'var(--text-faint)' }}>{tr('buscando')}</span>}
          <button onClick={onClose}
            style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '12px', padding: '3px 8px' }}>
            ESC
          </button>
        </div>

        {!query.trim() && (
          <div style={{ padding: '16px 20px' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 12px' }}>
              {idioma === 'en' ? 'Quick access' : 'Accesos rápidos'}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {PAGINAS.map((p, i) => (
                <button key={i} onClick={() => window.location.href = p.href}
                  style={{ padding: '8px 14px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.15s' }}
                  onMouseEnter={(e: any) => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.color = 'var(--gold)'; }}
                  onMouseLeave={(e: any) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                  {p.emoji} {p.titulo}
                </button>
              ))}
            </div>
          </div>
        )}

        {query.trim() && !cargando && resultados.length === 0 && (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>😕</div>
            <p style={{ color: 'var(--text-faint)', fontSize: '14px', margin: 0 }}>
              {tr('sinResultados')} &quot;{query}&quot;
            </p>
          </div>
        )}

        {resultados.length > 0 && (
          <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
            <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
              <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0, fontWeight: 600 }}>
                {resultados.length} {resultados.length !== 1 ? tr('resultados') : tr('resultado')} &quot;{query}&quot;
              </p>
            </div>

            {resultados.map((r, i) => {
              const tipoInfo = getTipoInfo(r.tipo);
              return (
                <div key={i} onClick={() => abrirResultado(r)}
                  style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer', display: 'flex', gap: '14px', alignItems: 'flex-start', transition: 'background 0.15s' }}
                  onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                  onMouseLeave={(e: any) => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: (r.materiaColor || tipoInfo.color) + '20', border: `1px solid ${(r.materiaColor || tipoInfo.color)}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
                    {getIcono(r)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px', flexWrap: 'wrap' }}>
                      <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                        {highlightQuery(r.titulo)}
                      </h3>
                      <span style={{ fontSize: '10px', background: r.materiaColor || tipoInfo.color, color: '#000', padding: '2px 7px', borderRadius: '5px', fontWeight: 700, flexShrink: 0 }}>
                        {tipoInfo.label}
                      </span>
                    </div>
                    {(r.materia || r.subtitulo) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px', flexWrap: 'wrap' }}>
                        {r.materia && (
                          <>
                            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: r.materiaColor, flexShrink: 0 }} />
                            <span style={{ fontSize: '11px', color: r.materiaColor, fontWeight: 600 }}>{r.materia}</span>
                          </>
                        )}
                        {r.tema && <><span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>→</span><span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{r.tema}</span></>}
                        {r.subtitulo && !r.materia && <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{r.subtitulo}</span>}
                      </div>
                    )}
                    {r.preview && (
                      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                        {highlightQuery(r.preview)}
                      </p>
                    )}
                  </div>
                  <div style={{ color: 'var(--text-faint)', fontSize: '16px', flexShrink: 0, alignSelf: 'center' }}>→</div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ padding: '10px 20px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '16px' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>{tr('abrir')}</span>
          <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>{tr('cerrarBuscador')}</span>
          <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>{tr('abrirBuscador')}</span>
        </div>
      </div>
    </div>
  );
}