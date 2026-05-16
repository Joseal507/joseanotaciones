'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Materia, Tema, Apunte, Documento } from '../../lib/storage';
import { useIdioma } from '../../hooks/useIdioma';
import { useIsMobile } from '../../hooks/useIsMobile';

const HAND = "'Caveat',cursive";

interface Vec2 { x: number; y: number; }

interface TemaNode {
  id: string;
  x: number;
  y: number;
  emoji: string;
  label: string;
  sublabel: string;
  color: string;
  type: 'apunte' | 'documento' | 'action' | 'info';
  data?: any;
  size?: 'sm' | 'md' | 'lg';
  rot?: number;
}

interface Props {
  materia: Materia;
  tema: Tema;
  onBack: () => void;
  onBackMateria: () => void;
  onAbrirApunte: (a: Apunte) => void;
  onAbrirDocumento: (d: Documento) => void;
  onEliminarApunte: (id: string) => void;
  onEliminarDocumento: (id: string) => void;
  onNuevoApunte: () => void;
  onSubirDocumento: (e: React.ChangeEvent<HTMLInputElement>) => void;
  subiendoDoc: boolean;
  onAgregarYoutube?: (doc: Documento) => void;
}

const NODE_SIZE = { lg: 160, md: 130, sm: 110 };

// Rotación pseudo-aleatoria estable por id
function rotForId(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 11) - 5) * 0.7; // -3.5 a +3.5 grados
}

export default function TemaView({
  materia, tema,
  onBack, onBackMateria,
  onAbrirApunte, onAbrirDocumento,
  onEliminarApunte, onEliminarDocumento,
  onNuevoApunte, onSubirDocumento, subiendoDoc,
  onAgregarYoutube,
}: Props) {
  const { tr, idioma } = useIdioma();
  const isMobile = useIsMobile();
  const fileRef = useRef<HTMLInputElement>(null);

  const [pan, setPan] = useState<Vec2>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.9);
  const isDragging = useRef(false);
  const lastPos = useRef<Vec2>({ x: 0, y: 0 });
  const targetPan = useRef<Vec2>({ x: 0, y: 0 });
  const targetZoom = useRef(0.9);
  const currentPan = useRef<Vec2>({ x: 0, y: 0 });
  const currentZoom = useRef(0.9);
  const animRef = useRef<number>();
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ node: TemaNode; x: number; y: number } | null>(null);

  const buildTemaNodes = (): TemaNode[] => {
    const nodes: TemaNode[] = [];

    nodes.push({
      id: 'tema-center',
      x: 0, y: 0,
      emoji: '🗂️',
      label: tema.nombre,
      sublabel: `${tema.apuntes.length} apuntes · ${tema.documentos.length} docs`,
      color: tema.color || materia.color,
      type: 'info',
      size: 'lg',
      rot: -2,
    });

    nodes.push({
      id: 'new-apunte',
      x: -280, y: -160,
      emoji: '✏️',
      label: idioma === 'en' ? 'New Note' : 'Nuevo Apunte',
      sublabel: idioma === 'en' ? 'write freely' : 'escribe libremente',
      color: 'var(--gold)',
      type: 'action',
      size: 'sm',
      rot: -4,
    });

    nodes.push({
      id: 'upload-doc',
      x: 280, y: -160,
      emoji: '📎',
      label: idioma === 'en' ? 'Upload' : 'Subir',
      sublabel: 'PDF, PPT, img...',
      color: 'var(--blue)',
      type: 'action',
      size: 'sm',
      rot: 4,
    });

    const apuntesCount = tema.apuntes.length;
    tema.apuntes.forEach((apunte, i) => {
      const baseX = -340;
      const offsetY = apuntesCount === 1 ? 60 : (i - (apuntesCount - 1) / 2) * (apuntesCount > 3 ? 100 : 120);
      nodes.push({
        id: `apunte-${apunte.id}`,
        x: baseX,
        y: offsetY + 60,
        emoji: '📝',
        label: apunte.titulo.length > 18 ? apunte.titulo.slice(0, 18) + '…' : apunte.titulo,
        sublabel: apunte.fechaModificacion,
        color: 'var(--gold)',
        type: 'apunte',
        data: apunte,
        size: 'sm',
        rot: rotForId(apunte.id),
      });
    });

    const docsCount = tema.documentos.length;
    tema.documentos.forEach((doc, i) => {
      const docEmoji = doc.tipo === 'pdf' ? '📄'
        : doc.tipo === 'imagen' ? '🖼️'
        : doc.tipo === 'word' ? '📃'
        : doc.tipo === 'ppt' ? '📊'
        : doc.tipo === 'youtube' ? '▶️'
        : '📁';
      const offsetY = docsCount === 1 ? 60 : (i - (docsCount - 1) / 2) * (docsCount > 3 ? 100 : 120);
      nodes.push({
        id: `doc-${doc.id}`,
        x: 340,
        y: offsetY + 60,
        emoji: docEmoji,
        label: doc.nombre.length > 16 ? doc.nombre.slice(0, 16) + '…' : doc.nombre,
        sublabel: doc.fechaSubida,
        color: 'var(--blue)',
        type: 'documento',
        data: doc,
        size: 'sm',
        rot: rotForId(doc.id),
      });
    });

    return nodes;
  };

  const [nodes, setNodes] = useState<TemaNode[]>(buildTemaNodes());

  useEffect(() => {
    setNodes(buildTemaNodes());
  }, [tema]);

  useEffect(() => {
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const tick = () => {
      currentPan.current.x = lerp(currentPan.current.x, targetPan.current.x, 0.1);
      currentPan.current.y = lerp(currentPan.current.y, targetPan.current.y, 0.1);
      currentZoom.current = lerp(currentZoom.current, targetZoom.current, 0.1);
      const dx = Math.abs(currentPan.current.x - targetPan.current.x);
      const dy = Math.abs(currentPan.current.y - targetPan.current.y);
      const dz = Math.abs(currentZoom.current - targetZoom.current);
      if (dx > 0.1 || dy > 0.1 || dz > 0.001) {
        setPan({ x: currentPan.current.x, y: currentPan.current.y });
        setZoom(currentZoom.current);
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-node]')) return;
    isDragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    targetPan.current = { x: targetPan.current.x + dx, y: targetPan.current.y + dy };
  }, []);

  const onMouseUp = useCallback(() => { isDragging.current = false; }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    targetZoom.current = Math.min(Math.max(targetZoom.current * delta, 0.25), 3);
  }, []);

  const handleNodeClick = (node: TemaNode) => {
    if (node.id === 'tema-center') return;
    if (node.id === 'new-apunte') { onNuevoApunte(); return; }
    if (node.id === 'upload-doc') { fileRef.current?.click(); return; }
    if (node.type === 'apunte') { onAbrirApunte(node.data); return; }
    if (node.type === 'documento') { onAbrirDocumento(node.data); return; }
  };

  const handleNodeRightClick = (e: React.MouseEvent, node: TemaNode) => {
    if (node.type !== 'apunte' && node.type !== 'documento') return;
    e.preventDefault();
    setContextMenu({ node, x: e.clientX, y: e.clientY });
  };

  const resetView = () => {
    targetPan.current = { x: 0, y: 0 };
    targetZoom.current = 0.9;
  };

  const connections = [
    { from: 'tema-center', to: 'new-apunte' },
    { from: 'tema-center', to: 'upload-doc' },
    ...tema.apuntes.map(a => ({ from: 'new-apunte', to: `apunte-${a.id}` })),
    ...tema.documentos.map(d => ({ from: 'upload-doc', to: `doc-${d.id}` })),
  ];

  // ─── MOBILE ──
  if (isMobile) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '0 0 80px' }}>
        <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onSubirDocumento}
          accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.webp,.mp3,.wav,.m4a" />

        {/* Header mobile */}
        <div style={{
          padding: 16,
          background: 'var(--bg-card)',
          borderBottom: '2.5px solid var(--text-primary)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            marginBottom: 12, flexWrap: 'wrap',
            fontFamily: HAND,
          }}>
            <button onClick={onBack} style={mobileBreadBtn}>← {tr('inicio')}</button>
            <span style={{ color: 'var(--text-faint)', fontWeight: 800 }}>›</span>
            <button onClick={onBackMateria} style={mobileBreadBtn}>{materia.emoji} {materia.nombre}</button>
            <span style={{ color: 'var(--text-faint)', fontWeight: 800 }}>›</span>
            <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', fontStyle: 'italic' }}>{tema.nombre}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onNuevoApunte}
              style={{
                flex: 1, padding: '12px',
                borderRadius: 12,
                border: '2.5px solid var(--text-primary)',
                background: 'var(--gold)', color: '#000',
                fontFamily: HAND, fontSize: 19, fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '3px 4px 0 var(--text-primary)',
                transform: 'rotate(-1.5deg)',
              }}>
              ✏️ {idioma === 'en' ? 'New Note' : 'Nuevo Apunte'}
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={subiendoDoc}
              style={{
                flex: 1, padding: '12px',
                borderRadius: 12,
                border: '2.5px solid var(--text-primary)',
                background: 'var(--blue)', color: '#000',
                fontFamily: HAND, fontSize: 19, fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '3px 4px 0 var(--text-primary)',
                transform: 'rotate(1.5deg)',
              }}>
              {subiendoDoc ? '⏳' : '📎'} {idioma === 'en' ? 'Upload' : 'Subir'}
            </button>
          </div>
        </div>

        {/* Apuntes */}
        {tema.apuntes.length > 0 && (
          <div style={{ padding: 16 }}>
            <h3 style={{
              fontFamily: HAND, fontSize: 22, fontWeight: 900,
              color: 'var(--gold)', margin: '0 0 10px',
              transform: 'rotate(-1deg)', display: 'inline-block',
            }}>
              ✏️ {idioma === 'en' ? 'Notes' : 'Apuntes'} ({tema.apuntes.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {tema.apuntes.map((apunte, i) => (
                <div key={apunte.id} style={{
                  background: 'var(--bg-card)',
                  border: '2.5px solid var(--text-primary)',
                  borderRadius: 12,
                  boxShadow: '3px 4px 0 var(--gold)',
                  display: 'flex', alignItems: 'center',
                  overflow: 'hidden',
                  transform: `rotate(${rotForId(apunte.id) * 0.5}deg)`,
                }}>
                  <div style={{ width: 5, alignSelf: 'stretch', background: 'var(--gold)', flexShrink: 0 }} />
                  <div onClick={() => onAbrirApunte(apunte)}
                    style={{ flex: 1, padding: '12px 14px', cursor: 'pointer' }}>
                    <div style={{
                      fontFamily: HAND, fontSize: 19, fontWeight: 800,
                      color: 'var(--text-primary)', marginBottom: 2, lineHeight: 1.1,
                    }}>📝 {apunte.titulo}</div>
                    <div style={{
                      fontFamily: HAND, fontSize: 13, fontStyle: 'italic',
                      color: 'var(--text-faint)',
                    }}>{apunte.fechaModificacion}</div>
                  </div>
                  <button onClick={() => onEliminarApunte(apunte.id)}
                    style={{
                      padding: '14px 16px', background: 'transparent',
                      border: 'none', color: 'var(--red)',
                      cursor: 'pointer', fontSize: 16,
                    }}>🗑</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Documentos */}
        {tema.documentos.length > 0 && (
          <div style={{ padding: '0 16px 16px' }}>
            <h3 style={{
              fontFamily: HAND, fontSize: 22, fontWeight: 900,
              color: 'var(--blue)', margin: '0 0 10px',
              transform: 'rotate(-1deg)', display: 'inline-block',
            }}>
              📎 {idioma === 'en' ? 'Documents' : 'Documentos'} ({tema.documentos.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {tema.documentos.map((doc, i) => {
                const emoji = doc.tipo === 'pdf' ? '📄' : doc.tipo === 'imagen' ? '🖼️' : doc.tipo === 'youtube' ? '▶️' : '📁';
                return (
                  <div key={doc.id} style={{
                    background: 'var(--bg-card)',
                    border: '2.5px solid var(--text-primary)',
                    borderRadius: 12,
                    boxShadow: '3px 4px 0 var(--blue)',
                    display: 'flex', alignItems: 'center',
                    overflow: 'hidden',
                    transform: `rotate(${rotForId(doc.id) * 0.5}deg)`,
                  }}>
                    <div style={{ width: 5, alignSelf: 'stretch', background: 'var(--blue)', flexShrink: 0 }} />
                    <div onClick={() => onAbrirDocumento(doc)}
                      style={{ flex: 1, padding: '12px 14px', cursor: 'pointer' }}>
                      <div style={{
                        fontFamily: HAND, fontSize: 19, fontWeight: 800,
                        color: 'var(--text-primary)', marginBottom: 2, lineHeight: 1.1,
                      }}>{emoji} {doc.nombre}</div>
                      <div style={{
                        fontFamily: HAND, fontSize: 13, fontStyle: 'italic',
                        color: 'var(--text-faint)',
                      }}>{doc.fechaSubida}</div>
                    </div>
                    <button onClick={() => onEliminarDocumento(doc.id)}
                      style={{
                        padding: '14px 16px', background: 'transparent',
                        border: 'none', color: 'var(--red)',
                        cursor: 'pointer', fontSize: 16,
                      }}>🗑</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty */}
        {tema.apuntes.length === 0 && tema.documentos.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '60px 20px',
            margin: 16,
            background: 'var(--bg-card)',
            border: '2.5px dashed var(--border-color)',
            borderRadius: 14,
            transform: 'rotate(-0.5deg)',
          }}>
            <div style={{ fontSize: 56, marginBottom: 10 }}>🗺️</div>
            <p style={{
              fontFamily: HAND, fontSize: 20, fontWeight: 700,
              color: 'var(--text-muted)', fontStyle: 'italic', margin: 0,
            }}>
              ~ {idioma === 'en' ? 'this topic is empty' : 'tema vacío'} ~
            </p>
          </div>
        )}
      </div>
    );
  }

  // ─── DESKTOP CANVAS ──
  return (
    <div style={{
      width: '100%', height: 'calc(100vh - 80px)',
      position: 'relative', overflow: 'hidden',
      background: 'var(--bg-primary)',
    }}>

      <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onSubirDocumento}
        accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.webp,.mp3,.wav,.m4a" />

      {/* Context menu vibra cuaderno */}
      {contextMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setContextMenu(null)} />
          <div style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 200,
            background: 'var(--bg-card)',
            border: '2.5px solid var(--text-primary)',
            borderRadius: 12,
            boxShadow: '4px 5px 0 var(--text-primary), 0 8px 32px rgba(0,0,0,0.4)',
            padding: 6, minWidth: 170,
            transform: 'rotate(-1.5deg)',
            animation: 'fadeInCm 0.2s cubic-bezier(.34,1.4,.64,1)',
          }}>
            <button
              onClick={() => { handleNodeClick(contextMenu.node); setContextMenu(null); }}
              style={cmBtn('var(--text-primary)')}
              onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--bg-secondary)'}
              onMouseLeave={(e: any) => e.currentTarget.style.background = 'transparent'}>
              👁️ {idioma === 'en' ? 'Open' : 'Abrir'}
            </button>
            <button
              onClick={() => {
                if (contextMenu.node.type === 'apunte') onEliminarApunte(contextMenu.node.data.id);
                else onEliminarDocumento(contextMenu.node.data.id);
                setContextMenu(null);
              }}
              style={cmBtn('var(--red)')}
              onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--red-dim)'}
              onMouseLeave={(e: any) => e.currentTarget.style.background = 'transparent'}>
              🗑️ {idioma === 'en' ? 'Delete' : 'Eliminar'}
            </button>
          </div>
        </>
      )}

      {/* BREADCRUMB */}
      <div style={{
        position: 'absolute', top: 14, left: 14, zIndex: 100,
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'color-mix(in srgb, var(--bg-card) 92%, transparent)',
        backdropFilter: 'blur(14px)',
        border: '2.5px solid var(--text-primary)',
        borderRadius: 12,
        padding: '7px 14px',
        boxShadow: '3px 3px 0 var(--text-primary)',
        transform: 'rotate(-1.5deg)',
        fontFamily: HAND,
      }}>
        <button onClick={onBack} style={breadBtn} title="Inicio">🏠</button>
        <span style={{ color: 'var(--text-faint)', fontSize: 16, fontWeight: 800 }}>›</span>
        <button onClick={onBackMateria} style={breadBtn}
          onMouseEnter={(e: any) => { e.currentTarget.style.color = materia.color; }}
          onMouseLeave={(e: any) => { e.currentTarget.style.color = 'var(--text-faint)'; }}>
          {materia.emoji} {materia.nombre}
        </button>
        <span style={{ color: 'var(--text-faint)', fontSize: 16, fontWeight: 800 }}>›</span>
        <span style={{
          fontSize: 17, fontWeight: 900, color: 'var(--text-primary)',
          fontStyle: 'italic',
        }}>
          {tema.nombre}
        </span>
      </div>

      {/* HINT */}
      <div style={{
        position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%) rotate(-0.5deg)',
        zIndex: 100, display: 'flex', gap: 6, flexWrap: 'wrap',
      }}>
        {[
          { txt: '🖱️ scroll → zoom', rot: -2 },
          { txt: '✋ drag → mover', rot: 1.5 },
          { txt: '👆 click → abrir', rot: -1.5 },
          { txt: '🔧 click derecho → opciones', rot: 2 },
        ].map((h, i) => (
          <span key={i} style={{
            padding: '3px 10px',
            borderRadius: 8,
            background: 'color-mix(in srgb, var(--bg-card) 90%, transparent)',
            backdropFilter: 'blur(12px)',
            border: '1.5px dashed var(--border-color)',
            fontFamily: HAND, fontSize: 13,
            color: 'var(--text-muted)', fontStyle: 'italic',
            transform: `rotate(${h.rot}deg)`,
          }}>{h.txt}</span>
        ))}
      </div>

      {/* CANVAS */}
      <div
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        style={{
          width: '100%', height: '100%',
          cursor: isDragging.current ? 'grabbing' : 'grab',
          userSelect: 'none',
        }}
      >
        {/* Fondo rayado tipo cuaderno */}
        <svg style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%', pointerEvents: 'none',
        }}>
          <defs>
            <pattern id="tema-lines"
              x={0}
              y={((pan.y % (32 * zoom)) + 32 * zoom) % (32 * zoom)}
              width={1} height={32 * zoom} patternUnits="userSpaceOnUse">
              <line x1="0" y1={32 * zoom - 0.5} x2="100%" y2={32 * zoom - 0.5}
                stroke="var(--border-color2)" strokeWidth="0.5" opacity="0.45"/>
            </pattern>
            <pattern id="tema-margin"
              x={((pan.x % 1) + 1) % 1}
              y={0}
              width={1} height={1} patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="100%"
                stroke="#ef4444" strokeWidth="1.5" opacity="0.18"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#tema-lines)" />
        </svg>

        {/* Margen rojo cuaderno fijo */}
        <div style={{
          position: 'absolute',
          left: 80, top: 0, bottom: 0,
          width: 1.5, background: '#ef4444', opacity: 0.18,
          pointerEvents: 'none',
        }}/>

        {/* Transform layer */}
        <div style={{
          position: 'absolute', left: '50%', top: '50%',
          transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}>
          {/* Conexiones tipo trazos a lápiz */}
          <svg style={{ position: 'absolute', overflow: 'visible', pointerEvents: 'none', top: 0, left: 0 }}>
            {connections.map((conn, i) => {
              const fromNode = nodes.find(n => n.id === conn.from);
              const toNode = nodes.find(n => n.id === conn.to);
              if (!fromNode || !toNode) return null;
              const isHovered = hoveredNode === conn.from || hoveredNode === conn.to;
              const angle = Math.atan2(toNode.y - fromNode.y, toNode.x - fromNode.x);
              const mx = (fromNode.x + toNode.x) / 2;
              const my = (fromNode.y + toNode.y) / 2;
              const curve = 50;
              const cx = mx - Math.sin(angle) * curve;
              const cy = my + Math.cos(angle) * curve;
              return (
                <path key={i}
                  d={`M ${fromNode.x} ${fromNode.y} Q ${cx} ${cy} ${toNode.x} ${toNode.y}`}
                  fill="none"
                  stroke={isHovered ? (fromNode.color !== 'var(--text-faint)' ? fromNode.color : toNode.color) : 'var(--text-faint)'}
                  strokeWidth={isHovered ? 2.5 : 1.8}
                  strokeDasharray={isHovered ? 'none' : '6 5'}
                  strokeLinecap="round"
                  opacity={isHovered ? 0.85 : 0.4}
                  style={{ transition: 'all 0.25s ease' }}
                />
              );
            })}
          </svg>

          {/* Nodes como post-its rotados */}
          {nodes.map((node) => {
            const size = NODE_SIZE[node.size || 'md'];
            const isHovered = hoveredNode === node.id;
            const isCenter = node.id === 'tema-center';
            const isAction = node.type === 'action';
            const baseRot = node.rot ?? 0;

            return (
              <div
                key={node.id}
                data-node="true"
                onClick={() => handleNodeClick(node)}
                onContextMenu={(e: any) => handleNodeRightClick(e, node)}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                style={{
                  position: 'absolute',
                  left: node.x - size / 2,
                  top: node.y - size / 2,
                  width: size,
                  height: size,
                  borderRadius: isCenter ? 16 : 12,
                  background: isHovered
                    ? `color-mix(in srgb, ${node.color} 22%, var(--bg-card))`
                    : isAction
                      ? `color-mix(in srgb, ${node.color} 12%, var(--bg-card))`
                      : 'var(--bg-card)',
                  border: `2.5px solid var(--text-primary)`,
                  boxShadow: isHovered
                    ? `5px 6px 0 ${node.color}, 0 8px 24px ${node.color}25`
                    : `4px 5px 0 ${node.color}`,
                  cursor: node.id === 'tema-center' ? 'default' : 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  padding: '12px 10px',
                  transition: 'all 0.3s cubic-bezier(0.34, 1.4, 0.64, 1)',
                  transform: isHovered && !isCenter
                    ? `rotate(0deg) translateY(-4px) scale(1.05)`
                    : `rotate(${baseRot}deg)`,
                  zIndex: isHovered ? 10 : isCenter ? 5 : 1,
                  overflow: 'hidden',
                }}
              >
                {/* Cinta scotch arriba */}
                <div style={{
                  position: 'absolute',
                  top: -6, left: '50%',
                  transform: 'translateX(-50%) rotate(-3deg)',
                  width: isCenter ? 60 : 40, height: 14,
                  background: `color-mix(in srgb, ${node.color} 50%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${node.color} 30%, transparent)`,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
                  zIndex: 5,
                }}/>

                {/* Loading overlay */}
                {node.id === 'upload-doc' && subiendoDoc && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'color-mix(in srgb, var(--blue) 18%, var(--bg-card))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 12,
                  }}>
                    <span style={{ fontSize: 26 }}>⏳</span>
                  </div>
                )}

                <span style={{
                  fontSize: isCenter ? 38 : node.size === 'sm' ? 26 : 30,
                  lineHeight: 1,
                  filter: isHovered ? `drop-shadow(0 0 6px ${node.color}88)` : 'none',
                  transition: 'filter 0.2s',
                }}>
                  {node.emoji}
                </span>
                <span style={{
                  fontFamily: HAND,
                  fontSize: isCenter ? 22 : node.size === 'sm' ? 16 : 19,
                  fontWeight: 900,
                  color: isHovered ? node.color : 'var(--text-primary)',
                  textAlign: 'center',
                  lineHeight: 1.1,
                  padding: '0 4px',
                  transition: 'color 0.2s',
                }}>
                  {node.label}
                </span>
                {(isHovered || isCenter) && (
                  <span style={{
                    fontFamily: HAND,
                    fontSize: 13, color: 'var(--text-faint)',
                    fontStyle: 'italic',
                    textAlign: 'center', lineHeight: 1.2, padding: '0 4px',
                    animation: 'fadeInTv 0.25s ease',
                  }}>
                    ~ {node.sublabel} ~
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* CONTROLES */}
      <div style={{
        position: 'absolute', bottom: 24, right: 24, zIndex: 100,
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {[
          { label: '+', action: () => { targetZoom.current = Math.min(targetZoom.current * 1.2, 3); }, rot: -3 },
          { label: '−', action: () => { targetZoom.current = Math.max(targetZoom.current * 0.8, 0.25); }, rot: 3 },
          { label: '⌖', action: resetView, rot: -2 },
        ].map((btn, i) => (
          <button key={i} onClick={btn.action}
            style={{
              width: 40, height: 40, borderRadius: 10,
              border: '2.5px solid var(--text-primary)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontFamily: HAND, fontSize: 22, fontWeight: 800,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '3px 3px 0 var(--text-primary)',
              transform: `rotate(${btn.rot}deg)`,
              transition: 'all 0.2s cubic-bezier(.25,.8,.25,1)',
            }}
            onMouseEnter={(e: any) => {
              e.currentTarget.style.transform = 'rotate(0deg) scale(1.08)';
              e.currentTarget.style.borderColor = tema.color || materia.color;
            }}
            onMouseLeave={(e: any) => {
              e.currentTarget.style.transform = `rotate(${btn.rot}deg)`;
              e.currentTarget.style.borderColor = 'var(--text-primary)';
            }}>
            {btn.label}
          </button>
        ))}
      </div>

      {/* Acciones rápidas */}
      <div style={{
        position: 'absolute', bottom: 24, left: 16, zIndex: 100,
        display: 'flex', gap: 10,
      }}>
        <button onClick={onNuevoApunte}
          style={{
            padding: '10px 18px',
            borderRadius: 12,
            border: '2.5px solid var(--text-primary)',
            background: 'var(--gold)', color: '#000',
            fontFamily: HAND, fontSize: 18, fontWeight: 800,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            boxShadow: '3px 4px 0 var(--text-primary)',
            transform: 'rotate(-1.5deg)',
            transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
          }}
          onMouseEnter={(e:any)=>{
            e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
            e.currentTarget.style.boxShadow = '4px 6px 0 var(--text-primary)';
          }}
          onMouseLeave={(e:any)=>{
            e.currentTarget.style.transform = 'rotate(-1.5deg)';
            e.currentTarget.style.boxShadow = '3px 4px 0 var(--text-primary)';
          }}
        >
          ✏️ {idioma === 'en' ? 'New Note' : 'Nuevo Apunte'}
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={subiendoDoc}
          style={{
            padding: '10px 18px',
            borderRadius: 12,
            border: '2.5px solid var(--text-primary)',
            background: 'var(--blue)', color: '#000',
            fontFamily: HAND, fontSize: 18, fontWeight: 800,
            cursor: subiendoDoc ? 'not-allowed' : 'pointer',
            opacity: subiendoDoc ? 0.6 : 1,
            display: 'flex', alignItems: 'center', gap: 6,
            boxShadow: '3px 4px 0 var(--text-primary)',
            transform: 'rotate(1.5deg)',
            transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
          }}
          onMouseEnter={(e:any)=>{
            if (!subiendoDoc) {
              e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
              e.currentTarget.style.boxShadow = '4px 6px 0 var(--text-primary)';
            }
          }}
          onMouseLeave={(e:any)=>{
            e.currentTarget.style.transform = 'rotate(1.5deg)';
            e.currentTarget.style.boxShadow = '3px 4px 0 var(--text-primary)';
          }}
        >
          {subiendoDoc ? '⏳ subiendo...' : '📎 ' + (idioma === 'en' ? 'Upload Material' : 'Subir Material')}
        </button>
      </div>

      {/* ZOOM INDICATOR */}
      <div style={{
        position: 'absolute', bottom: 26, left: '50%',
        transform: 'translateX(-50%) rotate(-1deg)',
        zIndex: 100,
        background: 'color-mix(in srgb, var(--bg-card) 90%, transparent)',
        backdropFilter: 'blur(12px)',
        border: '2px solid var(--text-primary)',
        borderRadius: 10, padding: '4px 12px',
        fontFamily: HAND, fontSize: 15, fontWeight: 800,
        color: 'var(--text-muted)',
        boxShadow: '2px 2px 0 var(--text-primary)',
      }}>
        🔍 {Math.round(zoom * 100)}%
      </div>

      <style>{`
        @keyframes fadeInTv {
          from { opacity: 0; transform: translateY(3px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInCm {
          from { opacity: 0; transform: rotate(0deg) scale(0.9); }
          to   { opacity: 1; transform: rotate(-1.5deg) scale(1); }
        }
      `}</style>
    </div>
  );
}

// ── Helpers de estilos ──
const breadBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-faint)',
  fontFamily: HAND, fontSize: 17, fontWeight: 800,
  cursor: 'pointer',
  padding: '2px 6px', borderRadius: 6,
  fontStyle: 'italic',
  transition: 'all 0.2s',
};

const mobileBreadBtn: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 8,
  border: '1.5px dashed var(--border-color)',
  background: 'transparent',
  color: 'var(--text-muted)',
  fontFamily: HAND, fontSize: 15, fontWeight: 700,
  cursor: 'pointer',
  fontStyle: 'italic',
};

const cmBtn = (color: string): React.CSSProperties => ({
  width: '100%', padding: '10px 14px',
  borderRadius: 8,
  border: 'none', background: 'transparent',
  color, fontFamily: HAND, fontSize: 18, fontWeight: 800,
  cursor: 'pointer', textAlign: 'left',
  display: 'flex', alignItems: 'center', gap: 8,
  fontStyle: 'italic',
});