'use client';

import { useState, useEffect, useRef } from 'react';
import { getMaterias, Materia } from '../lib/storage';

interface Resultado {
  tipo: 'apunte' | 'documento';
  titulo: string;
  materia: string;
  materiaColor: string;
  tema: string;
  preview: string;
  materiaId: string;
  temaId: string;
  id: string;
}

interface Props {
  onClose: () => void;
}

export default function Buscador({ onClose }: Props) {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [cargando, setCargando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (!query.trim()) {
      setResultados([]);
      return;
    }

    setCargando(true);
    const timer = setTimeout(() => {
      buscar(query.trim().toLowerCase());
      setCargando(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const buscar = (q: string) => {
    const materias = getMaterias();
    const encontrados: Resultado[] = [];

    materias.forEach(materia => {
      materia.temas.forEach(tema => {

        // Buscar en apuntes
        tema.apuntes.forEach(apunte => {
          const tituloMatch = apunte.titulo.toLowerCase().includes(q);

          // Extraer texto plano del HTML del contenido
          const textoPlano = apunte.contenido
            ? apunte.contenido.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
            : '';
          const contenidoMatch = textoPlano.toLowerCase().includes(q);

          if (tituloMatch || contenidoMatch) {
            // Encontrar el contexto donde aparece la búsqueda
            let preview = '';
            if (contenidoMatch && textoPlano) {
              const idx = textoPlano.toLowerCase().indexOf(q);
              const start = Math.max(0, idx - 60);
              const end = Math.min(textoPlano.length, idx + 100);
              preview = (start > 0 ? '...' : '') + textoPlano.substring(start, end) + (end < textoPlano.length ? '...' : '');
            } else {
              preview = textoPlano.substring(0, 120) + (textoPlano.length > 120 ? '...' : '');
            }

            encontrados.push({
              tipo: 'apunte',
              titulo: apunte.titulo,
              materia: materia.nombre,
              materiaColor: materia.color,
              tema: tema.nombre,
              preview,
              materiaId: materia.id,
              temaId: tema.id,
              id: apunte.id,
            });
          }
        });

        // Buscar en documentos
        tema.documentos.forEach(doc => {
          const nombreMatch = doc.nombre.toLowerCase().includes(q);
          const contenidoMatch = doc.contenido?.toLowerCase().includes(q);
          const keywordsMatch = doc.analisis?.keywords?.some(k => k.toLowerCase().includes(q));
          const summaryMatch = doc.analisis?.summary?.toLowerCase().includes(q);

          if (nombreMatch || contenidoMatch || keywordsMatch || summaryMatch) {
            let preview = '';
            if (contenidoMatch && doc.contenido) {
              const idx = doc.contenido.toLowerCase().indexOf(q);
              const start = Math.max(0, idx - 60);
              const end = Math.min(doc.contenido.length, idx + 100);
              preview = (start > 0 ? '...' : '') + doc.contenido.substring(start, end) + (end < doc.contenido.length ? '...' : '');
            } else if (doc.analisis?.summary) {
              preview = doc.analisis.summary.substring(0, 120) + '...';
            }

            encontrados.push({
              tipo: 'documento',
              titulo: doc.nombre,
              materia: materia.nombre,
              materiaColor: materia.color,
              tema: tema.nombre,
              preview,
              materiaId: materia.id,
              temaId: tema.id,
              id: doc.id,
            });
          }
        });
      });
    });

    setResultados(encontrados);
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

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 3000, padding: '60px 20px 20px' }}
      onClick={onClose}
    >
      <div
        style={{ width: '100%', maxWidth: '680px', background: 'var(--bg-card)', borderRadius: '20px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Input búsqueda */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '20px', flexShrink: 0 }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar en apuntes y documentos..."
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: '17px', color: 'var(--text-primary)', fontFamily: 'inherit' }}
          />
          {cargando && (
            <div style={{ fontSize: '13px', color: 'var(--text-faint)' }}>Buscando...</div>
          )}
          <button
            onClick={onClose}
            style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '12px', padding: '3px 8px' }}>
            ESC
          </button>
        </div>

        {/* Resultados */}
        <div style={{ maxHeight: '520px', overflowY: 'auto' }}>

          {/* Sin query */}
          {!query.trim() && (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔍</div>
              <p style={{ color: 'var(--text-faint)', fontSize: '14px', margin: 0 }}>
                Escribe para buscar en tus apuntes y documentos
              </p>
            </div>
          )}

          {/* Sin resultados */}
          {query.trim() && !cargando && resultados.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>😕</div>
              <p style={{ color: 'var(--text-faint)', fontSize: '14px', margin: 0 }}>
                No se encontró nada para "<strong>{query}</strong>"
              </p>
            </div>
          )}

          {/* Resultados encontrados */}
          {resultados.length > 0 && (
            <div>
              {/* Header con cantidad */}
              <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0, fontWeight: 600 }}>
                  {resultados.length} resultado{resultados.length !== 1 ? 's' : ''} para "{query}"
                </p>
              </div>

              {/* Lista de resultados */}
              {resultados.map((r, i) => (
                <div
                  key={i}
                  onClick={() => {
                    // Guardar en localStorage para que materias page lo abra
                    localStorage.setItem('josea_search_result', JSON.stringify({
                      tipo: r.tipo,
                      materiaId: r.materiaId,
                      temaId: r.temaId,
                      id: r.id,
                    }));
                    window.location.href = '/materias';
                  }}
                  style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                    display: 'flex',
                    gap: '14px',
                    alignItems: 'flex-start',
                  }}
                  onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                  onMouseLeave={(e: any) => e.currentTarget.style.background = 'transparent'}
                >
                  {/* Icono tipo */}
                  <div style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    background: r.tipo === 'apunte' ? r.materiaColor + '20' : 'var(--blue-dim)',
                    border: `1px solid ${r.tipo === 'apunte' ? r.materiaColor + '44' : 'var(--blue-border)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '18px',
                    flexShrink: 0,
                  }}>
                    {r.tipo === 'apunte' ? '✏️' : '📄'}
                  </div>

                  {/* Contenido */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                      <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                        {highlightQuery(r.titulo)}
                      </h3>
                      <span style={{ fontSize: '10px', background: r.tipo === 'apunte' ? r.materiaColor : 'var(--blue)', color: '#000', padding: '2px 7px', borderRadius: '5px', fontWeight: 700, flexShrink: 0 }}>
                        {r.tipo === 'apunte' ? 'Apunte' : 'Documento'}
                      </span>
                    </div>

                    {/* Ruta */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px' }}>
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: r.materiaColor, flexShrink: 0 }} />
                      <span style={{ fontSize: '11px', color: r.materiaColor, fontWeight: 600 }}>{r.materia}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>→</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{r.tema}</span>
                    </div>

                    {/* Preview */}
                    {r.preview && (
                      <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                        {highlightQuery(r.preview)}
                      </p>
                    )}
                  </div>

                  {/* Flecha */}
                  <div style={{ color: 'var(--text-faint)', fontSize: '16px', flexShrink: 0, alignSelf: 'center' }}>
                    →
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 20px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '16px' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>↵ Abrir</span>
          <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>ESC Cerrar</span>
        </div>
      </div>
    </div>
  );
}