'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Materia, Tema, Apunte, Documento } from '../../lib/storage';
import { useIdioma } from '../../hooks/useIdioma';
import { useIsMobile } from '../../hooks/useIsMobile';

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

const NODE_SIZE = { lg: 150, md: 120, sm: 96 };

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

  // Canvas state
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

  // Build nodes from tema data
  const buildTemaNodes = (): TemaNode[] => {
    const nodes: TemaNode[] = [];

    // Nodo central del tema
    nodes.push({
      id: 'tema-center',
      x: 0, y: 0,
      emoji: '🗂️',
      label: tema.nombre,
      sublabel: `${tema.apuntes.length} apuntes · ${tema.documentos.length} docs`,
      color: tema.color || materia.color,
      type: 'info',
      size: 'lg',
    });

    // Nodo "Nuevo Apunte"
    nodes.push({
      id: 'new-apunte',
      x: -280, y: -160,
      emoji: '✏️',
      label: idioma === 'en' ? 'New Note' : 'Nuevo Apunte',
      sublabel: idioma === 'en' ? 'Write freely' : 'Escribe libremente',
      color: 'var(--gold)',
      type: 'action',
      size: 'sm',
    });

    // Nodo "Subir Material"
    nodes.push({
      id: 'upload-doc',
      x: 280, y: -160,
      emoji: '📎',
      label: idioma === 'en' ? 'Upload Material' : 'Subir Material',
      sublabel: 'PDF, PPT, imagen...',
      color: 'var(--blue)',
      type: 'action',
      size: 'sm',
    });

    // Apuntes existentes — distribuir en arco izquierdo
    const apuntesCount = tema.apuntes.length;
    tema.apuntes.forEach((apunte, i) => {
      const angle = (Math.PI * 0.6) + (i / Math.max(apuntesCount - 1, 1)) * (Math.PI * 0.8) - Math.PI * 0.4;
      const radius = apuntesCount <= 2 ? 280 : apuntesCount <= 4 ? 310 : 340;
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
      });
    });

    // Documentos existentes — distribuir en arco derecho
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
      });
    });

    return nodes;
  };

  const [nodes, setNodes] = useState<TemaNode[]>(buildTemaNodes());

  useEffect(() => {
    setNodes(buildTemaNodes());
  }, [tema]);

  // Smooth animation loop
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

  // Connections
  const connections = [
    { from: 'tema-center', to: 'new-apunte' },
    { from: 'tema-center', to: 'upload-doc' },
    ...tema.apuntes.map(a => ({ from: 'new-apunte', to: `apunte-${a.id}` })),
    ...tema.documentos.map(d => ({ from: 'upload-doc', to: `doc-${d.id}` })),
  ];

  // ─── MOBILE ──────────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '0 0 80px' }}>
        <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onSubirDocumento}
          accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.webp,.mp3,.wav,.m4a" />

        {/* Header mobile */}
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
            <button onClick={onBack} style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer' }}>← {tr('inicio')}</button>
            <span style={{ color: 'var(--text-faint)', fontSize: '12px' }}>›</span>
            <button onClick={onBackMateria} style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', cursor: 'pointer' }}>{materia.emoji} {materia.nombre}</button>
            <span style={{ color: 'var(--text-faint)', fontSize: '12px' }}>›</span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>{tema.nombre}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onNuevoApunte}
              style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
              ✏️ {idioma === 'en' ? 'New Note' : 'Nuevo Apunte'}
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={subiendoDoc}
              style={{ flex: 1, padding: '12px', borderRadius: '12px', border: '1.5px solid var(--blue)', background: 'transparent', color: 'var(--blue)', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
              {subiendoDoc ? '⏳' : '📎'} {idioma === 'en' ? 'Upload' : 'Subir'}
            </button>
          </div>
        </div>

        {/* Apuntes */}
        {tema.apuntes.length > 0 && (
          <div style={{ padding: '16px' }}>
            <p style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px' }}>
              ✏️ {idioma === 'en' ? 'Notes' : 'Apuntes'} ({tema.apuntes.length})
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {tema.apuntes.map(apunte => (
                <div key={apunte.id}
                  style={{ background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
                  <div style={{ width: '4px', alignSelf: 'stretch', background: 'var(--gold)', flexShrink: 0 }} />
                  <div onClick={() => onAbrirApunte(apunte)}
                    style={{ flex: 1, padding: '14px', cursor: 'pointer' }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2px' }}>📝 {apunte.titulo}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{apunte.fechaModificacion}</div>
                  </div>
                  <button onClick={() => onEliminarApunte(apunte.id)}
                    style={{ padding: '14px 16px', background: 'transparent', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: '16px' }}>🗑</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Documentos */}
        {tema.documentos.length > 0 && (
          <div style={{ padding: '0 16px 16px' }}>
            <p style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px' }}>
              📎 {idioma === 'en' ? 'Documents' : 'Documentos'} ({tema.documentos.length})
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {tema.documentos.map(doc => {
                const emoji = doc.tipo === 'pdf' ? '📄' : doc.tipo === 'imagen' ? '🖼️' : doc.tipo === 'youtube' ? '▶️' : '📁';
                return (
                  <div key={doc.id}
                    style={{ background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
                    <div style={{ width: '4px', alignSelf: 'stretch', background: 'var(--blue)', flexShrink: 0 }} />
                    <div onClick={() => onAbrirDocumento(doc)}
                      style={{ flex: 1, padding: '14px', cursor: 'pointer' }}>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2px' }}>{emoji} {doc.nombre}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{doc.fechaSubida}</div>
                    </div>
                    <button onClick={() => onEliminarDocumento(doc.id)}
                      style={{ padding: '14px 16px', background: 'transparent', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: '16px' }}>🗑</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty */}
        {tema.apuntes.length === 0 && tema.documentos.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🗺️</div>
            <p style={{ color: 'var(--text-muted)', fontWeight: 700, marginBottom: '20px' }}>
              {idioma === 'en' ? 'This topic is empty. Start creating!' : 'Este tema está vacío. ¡Empieza a crear!'}
            </p>
          </div>
        )}
      </div>
    );
  }

  // ─── DESKTOP CANVAS ───────────────────────────────────────────────────────────
  return (
    <div style={{ width: '100%', height: 'calc(100vh - 80px)', position: 'relative', overflow: 'hidden', background: 'var(--bg-primary)' }}>

      <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onSubirDocumento}
        accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.webp,.mp3,.wav,.m4a" />

      {/* Context menu */}
      {contextMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setContextMenu(null)} />
          <div style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 200,
            background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            padding: '6px', minWidth: '160px',
            animation: 'fade-in 0.15s ease',
          }}>
            <button
              onClick={() => { handleNodeClick(contextMenu.node); setContextMenu(null); }}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 700, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
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
              style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: 'none', background: 'transparent', color: 'var(--red)', fontSize: '13px', fontWeight: 700, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}
              onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--red-dim)'}
              onMouseLeave={(e: any) => e.currentTarget.style.background = 'transparent'}>
              🗑️ {idioma === 'en' ? 'Delete' : 'Eliminar'}
            </button>
          </div>
        </>
      )}

      {/* ── BREADCRUMB flotante ── */}
      <div style={{
        position: 'absolute', top: '16px', left: '16px', zIndex: 100,
        display: 'flex', alignItems: 'center', gap: '6px',
        background: 'color-mix(in srgb, var(--bg-card) 90%, transparent)',
        backdropFilter: 'blur(16px)',
        border: '1px solid var(--border-color)',
        borderRadius: '12px', padding: '8px 14px',
        boxShadow: '0 2px 16px rgba(0,0,0,0.3)',
      }}>
        <button onClick={onBack}
          style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: '12px', fontWeight: 700, cursor: 'pointer', padding: '2px 4px', borderRadius: '4px' }}
          onMouseEnter={(e: any) => { e.currentTarget.style.color = 'var(--gold)'; }}
          onMouseLeave={(e: any) => { e.currentTarget.style.color = 'var(--text-faint)'; }}>
          🏠
        </button>
        <span style={{ color: 'var(--border-color2)', fontSize: '12px' }}>›</span>
        <button onClick={onBackMateria}
          style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: '12px', fontWeight: 700, cursor: 'pointer', padding: '2px 4px', borderRadius: '4px' }}
          onMouseEnter={(e: any) => { e.currentTarget.style.color = materia.color; }}
          onMouseLeave={(e: any) => { e.currentTarget.style.color = 'var(--text-faint)'; }}>
          {materia.emoji} {materia.nombre}
        </button>
        <span style={{ color: 'var(--border-color2)', fontSize: '12px' }}>›</span>
        <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text-primary)' }}>
          {tema.nombre}
        </span>
      </div>

      {/* ── HINT ── */}
      <div style={{
        position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)', zIndex: 100,
        display: 'flex', gap: '6px',
      }}>
        {['Scroll → zoom', 'Drag → mover', 'Click → abrir', 'Clic derecho → opciones'].map((h, i) => (
          <span key={i} style={{ padding: '3px 8px', borderRadius: '20px', background: 'color-mix(in srgb, var(--bg-card) 85%, transparent)', backdropFilter: 'blur(12px)', border: '1px solid var(--border-color)', fontSize: '10px', color: 'var(--text-faint)', fontWeight: 600 }}>{h}</span>
        ))}
      </div>

      {/* ── CANVAS ── */}
      <div
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        style={{ width: '100%', height: '100%', cursor: isDragging.current ? 'grabbing' : 'grab', userSelect: 'none' }}
      >
        {/* Grid dots */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <defs>
            <pattern id="tema-dots"
              x={((pan.x % (24 * zoom)) + 24 * zoom) % (24 * zoom)}
              y={((pan.y % (24 * zoom)) + 24 * zoom) % (24 * zoom)}
              width={24 * zoom} height={24 * zoom} patternUnits="userSpaceOnUse">
              <circle cx={1} cy={1} r={0.8} fill="var(--border-color2)" opacity="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#tema-dots)" />
        </svg>

        {/* Transform layer */}
        <div style={{
          position: 'absolute', left: '50%', top: '50%',
          transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}>
          {/* SVG Connections */}
          <svg style={{ position: 'absolute', overflow: 'visible', pointerEvents: 'none', top: 0, left: 0 }}>
            {connections.map((conn, i) => {
              const fromNode = nodes.find(n => n.id === conn.from);
              const toNode = nodes.find(n => n.id === conn.to);
              if (!fromNode || !toNode) return null;
              const isHovered = hoveredNode === conn.from || hoveredNode === conn.to;
              const angle = Math.atan2(toNode.y - fromNode.y, toNode.x - fromNode.x);
              const mx = (fromNode.x + toNode.x) / 2;
              const my = (fromNode.y + toNode.y) / 2;
              const curve = 40;
              const cx = mx - Math.sin(angle) * curve;
              const cy = my + Math.cos(angle) * curve;
              return (
                <path key={i}
                  d={`M ${fromNode.x} ${fromNode.y} Q ${cx} ${cy} ${toNode.x} ${toNode.y}`}
                  fill="none"
                  stroke={isHovered ? (fromNode.color !== 'var(--text-faint)' ? fromNode.color : toNode.color) : 'var(--border-color2)'}
                  strokeWidth={isHovered ? 2 : 1}
                  strokeDasharray={isHovered ? 'none' : '4 5'}
                  opacity={isHovered ? 0.8 : 0.35}
                  style={{ transition: 'all 0.25s ease' }}
                />
              );
            })}
          </svg>

          {/* Nodes */}
          {nodes.map((node) => {
            const size = NODE_SIZE[node.size || 'md'];
            const isHovered = hoveredNode === node.id;
            const isCenter = node.id === 'tema-center';
            const isAction = node.type === 'action';

            return (
              <div
                key={node.id}
                data-node="true"
                onClick={() => handleNodeClick(node)}
                onContextMenu={(e) => handleNodeRightClick(e, node)}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                style={{
                  position: 'absolute',
                  left: node.x - size / 2,
                  top: node.y - size / 2,
                  width: size,
                  height: size,
                  borderRadius: isCenter ? '32px' : '20px',
                  background: isHovered
                    ? `color-mix(in srgb, ${node.color} 18%, var(--bg-card))`
                    : isAction
                      ? `color-mix(in srgb, ${node.color} 8%, var(--bg-card))`
                      : 'var(--bg-card)',
                  border: `${isHovered ? 2 : 1.5}px solid ${isHovered ? node.color : isAction ? `color-mix(in srgb, ${node.color} 50%, var(--border-color))` : 'var(--border-color)'}`,
                  boxShadow: isHovered
                    ? `0 0 0 4px ${node.color}18, 0 8px 32px ${node.color}25, 0 2px 8px rgba(0,0,0,0.4)`
                    : isCenter
                      ? `0 0 40px ${node.color}20, 0 4px 20px rgba(0,0,0,0.3)`
                      : '0 2px 10px rgba(0,0,0,0.25)',
                  cursor: node.id === 'tema-center' ? 'default' : 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '5px',
                  padding: '10px 8px',
                  transition: 'all 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  transform: isHovered && !isCenter ? 'scale(1.1) translateY(-3px)' : 'scale(1)',
                  zIndex: isHovered ? 10 : isCenter ? 5 : 1,
                  overflow: 'hidden',
                }}
              >
                {/* Top accent */}
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: isCenter ? '4px' : '3px', background: node.color, borderRadius: '20px 20px 0 0' }} />

                {/* Pulse ring para centro */}
                {isCenter && (
                  <div style={{
                    position: 'absolute', inset: '-8px', borderRadius: '40px',
                    border: `2px solid ${node.color}`,
                    opacity: 0.25,
                    animation: 'pulse-ring 2.5s ease-in-out infinite',
                    pointerEvents: 'none',
                  }} />
                )}

                {/* Loading overlay */}
                {node.id === 'upload-doc' && subiendoDoc && (
                  <div style={{ position: 'absolute', inset: 0, background: 'color-mix(in srgb, var(--blue) 15%, var(--bg-card))', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '20px' }}>
                    <span style={{ fontSize: '20px' }}>⏳</span>
                  </div>
                )}

                <span style={{ fontSize: isCenter ? '32px' : node.size === 'sm' ? '20px' : '26px', lineHeight: 1 }}>
                  {node.emoji}
                </span>
                <span style={{
                  fontSize: isCenter ? '12px' : '10px',
                  fontWeight: 800,
                  color: isHovered ? node.color : 'var(--text-primary)',
                  textAlign: 'center',
                  lineHeight: 1.2,
                  padding: '0 4px',
                  transition: 'color 0.2s',
                }}>
                  {node.label}
                </span>
                {(isHovered || isCenter) && (
                  <span style={{
                    fontSize: '9px', color: 'var(--text-faint)',
                    textAlign: 'center', lineHeight: 1.3, padding: '0 4px',
                    animation: 'fade-in 0.2s ease',
                  }}>
                    {node.sublabel}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CONTROLES ── */}
      <div style={{ position: 'absolute', bottom: '24px', right: '24px', zIndex: 100, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {[
          { label: '+', action: () => { targetZoom.current = Math.min(targetZoom.current * 1.2, 3); } },
          { label: '−', action: () => { targetZoom.current = Math.max(targetZoom.current * 0.8, 0.25); } },
          { label: '⌖', action: resetView },
        ].map((btn, i) => (
          <button key={i} onClick={btn.action}
            style={{
              width: '36px', height: '36px', borderRadius: '8px',
              border: '1.5px solid var(--border-color2)',
              background: 'color-mix(in srgb, var(--bg-card) 92%, transparent)',
              backdropFilter: 'blur(12px)',
              color: 'var(--text-primary)', fontSize: '16px', fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}
            onMouseEnter={(e: any) => { e.currentTarget.style.borderColor = tema.color || materia.color; }}
            onMouseLeave={(e: any) => { e.currentTarget.style.borderColor = 'var(--border-color2)'; }}>
            {btn.label}
          </button>
        ))}
      </div>

      {/* ── ACCIONES rápidas ── */}
      <div style={{
        position: 'absolute', bottom: '24px', left: '16px', zIndex: 100,
        display: 'flex', gap: '8px',
      }}>
        <button onClick={onNuevoApunte}
          style={{
            padding: '10px 18px', borderRadius: '12px', border: 'none',
            background: 'var(--gold)', color: '#000',
            fontSize: '13px', fontWeight: 800, cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(245,200,66,0.3)',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}>
          ✏️ {idioma === 'en' ? 'New Note' : 'Nuevo Apunte'}
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={subiendoDoc}
          style={{
            padding: '10px 18px', borderRadius: '12px',
            border: '1.5px solid var(--blue)',
            background: 'color-mix(in srgb, var(--blue) 10%, var(--bg-card))',
            backdropFilter: 'blur(12px)',
            color: 'var(--blue)', fontSize: '13px', fontWeight: 800, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}>
          {subiendoDoc ? '⏳ Subiendo...' : '📎 ' + (idioma === 'en' ? 'Upload Material' : 'Subir Material')}
        </button>
      </div>

      {/* ── ZOOM INDICATOR ── */}
      <div style={{
        position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
        zIndex: 100,
        background: 'color-mix(in srgb, var(--bg-card) 85%, transparent)',
        backdropFilter: 'blur(12px)',
        border: '1px solid var(--border-color)',
        borderRadius: '20px', padding: '5px 12px',
        fontSize: '11px', color: 'var(--text-faint)', fontWeight: 600,
      }}>
        {Math.round(zoom * 100)}%
      </div>

      <style>{`
        @keyframes pulse-ring {
          0%, 100% { transform: scale(1); opacity: 0.25; }
          50% { transform: scale(1.06); opacity: 0.5; }
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(3px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
