'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Apunte, Materia, Tema } from '../../lib/storage';
import { Bloque, BloqueImagen, Herramienta, genId } from '../editor/types';
import Toolbar from '../editor/Toolbar';
import ImageBlock from '../editor/ImageBlock';
import EditorCanvas from '../editor/EditorCanvas';
import DrawingCanvas from '../editor/DrawingCanvas';
import ImageInserter from '../editor/ImageInserter';
import ExportMenu from '../editor/ExportMenu';

interface Props {
  apunte: Apunte;
  materia: Materia;
  tema: Tema;
  onBack: () => void;
  onBackMateria: () => void;
  onBackTema: () => void;
  onGuardar: (contenido: string) => void;
}

const parseBloques = (contenido: string): Bloque[] => {
  if (!contenido) return [{ id: genId(), tipo: 'texto', html: '' }];
  try {
    const p = JSON.parse(contenido);
    if (Array.isArray(p)) return p.map(b => ({ ...b, id: genId() }));
  } catch {}
  return [{ id: genId(), tipo: 'texto', html: contenido }];
};

export default function ApunteEditor({
  apunte, materia, tema,
  onBack, onBackMateria, onBackTema, onGuardar,
}: Props) {
  const [bloques, setBloques] = useState<Bloque[]>(() => parseBloques(apunte.contenido));
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(true);
  const [herramienta, setHerramienta] = useState<Herramienta>('texto');
  const [brushColor, setBrushColor] = useState('#f5c842');
  const [brushSize, setBrushSize] = useState(3);
  const [showDrawingCanvas, setShowDrawingCanvas] = useState(false);
  const [showImage, setShowImage] = useState(false);

  const textRefs = useRef<{ [id: string]: HTMLDivElement | null }>({});
  const htmlCache = useRef<{ [id: string]: string }>({});
  const editorRef = useRef<HTMLDivElement>(null);
  const canvasHeight = 800;

  const isDrawing = ['boligrafo', 'marcador', 'lapiz', 'borrador'].includes(herramienta);

  const syncCache = useCallback(() => {
    Object.keys(textRefs.current).forEach(id => {
      const el = textRefs.current[id];
      if (el) htmlCache.current[id] = el.innerHTML;
    });
  }, []);

  const guardar = useCallback(() => {
    syncCache();
    const synced = bloques.map(b => {
      if (b.tipo === 'texto') {
        return { ...b, html: htmlCache.current[b.id] ?? (b as any).html ?? '' };
      }
      return b;
    });
    setGuardando(true);
    onGuardar(JSON.stringify(synced));
    setTimeout(() => { setGuardando(false); setGuardado(true); }, 600);
  }, [bloques, onGuardar, syncCache]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); guardar(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { (window as any).__editorUndo?.(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') { (window as any).__editorRedo?.(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [guardar]);

  const addTexto = (afterIdx: number) => {
    syncCache();
    const id = genId();
    htmlCache.current[id] = '';
    setBloques(prev => {
      const next = [...prev];
      next.splice(afterIdx + 1, 0, { id, tipo: 'texto', html: '' });
      return next;
    });
    setGuardado(false);
    setTimeout(() => textRefs.current[id]?.focus(), 50);
  };

  const addImagen = (src: string, label?: string) => {
    syncCache();
    setBloques(prev => [
      ...prev,
      {
        id: genId(),
        tipo: 'imagen',
        src,
        width: 500,
        align: 'center',
        label,
        floating: false,
        zIndex: 2,
        x: 0,
        y: 0,
      } as BloqueImagen,
      { id: genId(), tipo: 'texto', html: '' },
    ]);
    setGuardado(false);
    setShowImage(false);
    setShowDrawingCanvas(false);
  };

  const eliminarBloque = (id: string) => {
    syncCache();
    setBloques(prev => {
      const f = prev.filter(b => b.id !== id);
      return f.length === 0 ? [{ id: genId(), tipo: 'texto', html: '' }] : f;
    });
    setGuardado(false);
  };

  const updateImagen = (id: string, changes: Partial<BloqueImagen>) => {
    setBloques(prev => prev.map(b => b.id === id ? { ...b, ...changes } as Bloque : b));
    setGuardado(false);
  };

  const exec = (cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    setGuardado(false);
  };

  const insertHtml = (html: string) => {
    document.execCommand('insertHTML', false, html);
    setGuardado(false);
  };

  const handleHerramienta = (h: Herramienta) => {
    syncCache();
    setHerramienta(h);
  };

  return (
    <>
      {showDrawingCanvas && (
        <DrawingCanvas
          color={tema.color}
          onSave={(d) => addImagen(d, '🎨 Dibujo')}
          onClose={() => setShowDrawingCanvas(false)}
        />
      )}
      {showImage && (
        <ImageInserter
          color={tema.color}
          onInsert={(src) => addImagen(src)}
          onClose={() => setShowImage(false)}
        />
      )}

      <div style={{ maxWidth: '1080px', margin: '0 auto' }}>

        {/* BREADCRUMB */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <button onClick={onBack}
            style={{ background: 'none', border: 'none', color: 'var(--gold)', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>
            📚 Materias
          </button>
          <span style={{ color: 'var(--text-faint)' }}>/</span>
          <button onClick={onBackMateria}
            style={{ background: 'none', border: 'none', color: materia.color, fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>
            {materia.emoji} {materia.nombre}
          </button>
          <span style={{ color: 'var(--text-faint)' }}>/</span>
          <button onClick={onBackTema}
            style={{ background: 'none', border: 'none', color: tema.color, fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>
            📁 {tema.nombre}
          </button>
          <span style={{ color: 'var(--text-faint)' }}>/</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>✏️ {apunte.titulo}</span>
        </div>

        {/* HEADER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '4px', height: '32px', background: tema.color, borderRadius: '2px' }} />
            <h1 style={{ fontSize: '22px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
              {apunte.titulo}
            </h1>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {isDrawing && (
              <div style={{ background: tema.color + '25', padding: '6px 14px', borderRadius: '10px', border: `1px solid ${tema.color}`, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: tema.color }} />
                <span style={{ fontSize: '12px', color: tema.color, fontWeight: 700 }}>Modo dibujo</span>
                <button
                  onClick={() => handleHerramienta('texto')}
                  style={{ background: tema.color, border: 'none', color: '#000', padding: '3px 10px', borderRadius: '6px', fontWeight: 800, fontSize: '12px', cursor: 'pointer' }}>
                  ✅ Listo
                </button>
              </div>
            )}

            <span style={{ fontSize: '12px', color: guardado ? 'var(--text-faint)' : 'var(--gold)', fontWeight: 600 }}>
              {guardando ? '💾 Guardando...' : guardado ? '✓ Guardado' : '● Sin guardar'}
            </span>

            <ExportMenu
              bloques={bloques}
              titulo={apunte.titulo}
              temaColor={tema.color}
              textRefs={textRefs}
              htmlCache={htmlCache}
            />

            <button onClick={guardar}
              style={{ padding: '9px 20px', borderRadius: '10px', border: 'none', background: tema.color, color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
              💾 Guardar
            </button>
          </div>
        </div>

        {/* EDITOR */}
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: '16px',
          border: `2px solid ${isDrawing ? tema.color : 'var(--border-color)'}`,
          overflow: 'visible',
          boxShadow: isDrawing ? `0 0 0 4px ${tema.color}30` : '0 8px 40px rgba(0,0,0,0.15)',
          transition: 'all 0.3s',
        }}>
          <div style={{ height: '4px', background: tema.color, borderRadius: '14px 14px 0 0' }} />

          {/* TOOLBAR */}
          <Toolbar
            temaColor={tema.color}
            herramientaActiva={herramienta}
            onHerramienta={handleHerramienta}
            brushColor={brushColor}
            onBrushColor={setBrushColor}
            brushSize={brushSize}
            onBrushSize={setBrushSize}
            onExecCmd={exec}
            onInsertHtml={insertHtml}
            onInsertImagen={() => { syncCache(); setShowImage(true); }}
            onInsertDibujo={() => { syncCache(); setShowDrawingCanvas(true); }}
            onUndo={() => (window as any).__editorUndo?.()}
            onRedo={() => (window as any).__editorRedo?.()}
          />

          {/* ESTILOS */}
          <style>{`
            .ebloque { outline: none; min-height: 28px; }
            .ebloque:empty:before {
              content: 'Escribe aquí...';
              color: #aaaaaa;
              font-style: italic;
              pointer-events: none;
            }
            .ebloque h1 {
              font-size: 28px; font-weight: 900;
              color: ${tema.color}; margin: 16px 0 8px;
            }
            .ebloque h2 {
              font-size: 22px; font-weight: 800;
              color: #111111; margin: 14px 0 6px;
              padding-bottom: 6px;
              border-bottom: 3px solid ${tema.color}44;
            }
            .ebloque h3 {
              font-size: 17px; font-weight: 800;
              color: #111111; margin: 12px 0 4px;
            }
            .ebloque p { margin: 4px 0; line-height: 1.8; color: #333333; }
            .ebloque ul { padding-left: 20px; margin: 6px 0; }
            .ebloque ol { padding-left: 20px; margin: 6px 0; }
            .ebloque li { color: #333333; padding: 2px 0; line-height: 1.7; }
            .ebloque b, .ebloque strong { color: #111111; font-weight: 800; }
            .ebloque i, .ebloque em { color: #111111; }
            .ebloque u { text-decoration-color: ${tema.color}; }
            .ebloque hr {
              border: none;
              border-top: 2px solid #dddddd;
              margin: 16px 0;
            }
            .ebloque blockquote {
              border-left: 4px solid ${tema.color};
              padding: 8px 16px; margin: 8px 0;
              color: #555555; font-style: italic;
              border-radius: 0 8px 8px 0;
              background: #f8f8f8;
            }
          `}</style>

          {/* ÁREA PRINCIPAL - FONDO BLANCO */}
          <div
            ref={editorRef}
            style={{
              position: 'relative',
              minHeight: canvasHeight + 'px',
              background: '#ffffff',
              borderRadius: '0 0 14px 14px',
            }}
          >
            {/* Canvas de trazos - SIEMPRE ENCIMA */}
            <EditorCanvas
              herramienta={herramienta}
              brushColor={brushColor}
              brushSize={brushSize}
              temaColor={tema.color}
              width={editorRef.current?.clientWidth || 1000}
              height={canvasHeight}
              onChange={() => setGuardado(false)}
            />

            {/* Bloques */}
            <div style={{
              padding: '28px 44px',
              pointerEvents: isDrawing ? 'none' : 'all',
              position: 'relative',
              zIndex: 1,
              background: '#ffffff',
              minHeight: canvasHeight + 'px',
            }}>
              {bloques.map((bloque, idx) => (
                <div
                  key={bloque.id}
                  style={{
                    position: 'relative',
                    zIndex: bloque.tipo === 'imagen'
                      ? ((bloque as BloqueImagen).zIndex ?? 2)
                      : 1,
                  }}
                >
                  {/* TEXTO */}
                  {bloque.tipo === 'texto' && (
                    <div
                      ref={el => {
                        textRefs.current[bloque.id] = el;
                        if (el && el.innerHTML === '') {
                          el.innerHTML = htmlCache.current[bloque.id] ?? (bloque as any).html ?? '';
                        }
                      }}
                      contentEditable
                      suppressContentEditableWarning
                      className="ebloque"
                      onInput={e => {
                        htmlCache.current[bloque.id] = (e.currentTarget as HTMLDivElement).innerHTML;
                        setGuardado(false);
                      }}
                      style={{
                        fontFamily: 'Georgia, serif',
                        fontSize: '16px',
                        lineHeight: 1.8,
                        color: '#333333',
                        padding: '2px 0',
                        width: '100%',
                      }}
                    />
                  )}

                  {/* IMAGEN */}
                  {bloque.tipo === 'imagen' && (
                    <ImageBlock
                      bloque={bloque as BloqueImagen}
                      temaColor={tema.color}
                      onUpdate={(changes) => updateImagen(bloque.id, changes)}
                      onDelete={() => eliminarBloque(bloque.id)}
                    />
                  )}
                </div>
              ))}

              {/* Botones al final */}
              <div
                style={{ marginTop: '60px', display: 'flex', alignItems: 'center', gap: '8px', opacity: 0, transition: 'opacity 0.3s' }}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.opacity = '1'}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.opacity = '0'}
              >
                <div style={{ flex: 1, height: '1px', background: '#dddddd' }} />
                <button
                  onClick={() => addTexto(bloques.length - 1)}
                  style={{ padding: '4px 14px', borderRadius: '8px', border: `1px solid ${tema.color}`, background: 'transparent', color: tema.color, fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>
                  + texto
                </button>
                <button
                  onClick={() => { syncCache(); setShowImage(true); }}
                  style={{ padding: '4px 14px', borderRadius: '8px', border: '1px solid #cccccc', background: 'transparent', color: '#888888', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                  + imagen
                </button>
                <button
                  onClick={() => { syncCache(); setShowDrawingCanvas(true); }}
                  style={{ padding: '4px 14px', borderRadius: '8px', border: '1px solid #cccccc', background: 'transparent', color: '#888888', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                  + dibujo
                </button>
                <div style={{ flex: 1, height: '1px', background: '#dddddd' }} />
              </div>
            </div>
          </div>

          {/* FOOTER */}
          <div style={{
            padding: '10px 20px',
            borderTop: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderRadius: '0 0 14px 14px',
          }}>
            <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>
              {bloques.length} bloques · {bloques.filter(b => b.tipo === 'imagen').length} imágenes
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-faint)' }}>
              Cmd+S guardar · Cmd+Z deshacer · Cmd+Y rehacer
            </span>
          </div>
        </div>
      </div>
    </>
  );
}