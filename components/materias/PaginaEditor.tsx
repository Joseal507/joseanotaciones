'use client';

import { useState } from 'react';
import { Bloque, BloqueImagen, BloqueTexto, Herramienta, Pagina, PaperStyle } from '../editor/types';
import EditorCanvas from '../editor/EditorCanvas';
import PaperBackground from '../editor/PaperBackground';
import TextBlock from '../editor/TextBlock';
import ImageBlock from '../editor/ImageBlock';

interface Props {
  pagina: Pagina;
  paginaIdx: number;
  totalPaginas: number;
  temaColor: string;
  paperStyle: PaperStyle;
  paperColor: 'white' | 'dark' | 'yellow';
  herramienta: Herramienta;
  brushColor: string;
  brushSize: number;
  isDrawingMode: boolean;
  isDrawing: boolean;
  isSelecting: boolean;
  newBlockId: string | null;
  isMobile: boolean;
  pageWidth: number;
  pageHeight: number;
  externalScale: React.MutableRefObject<number>;
  textRefs: React.MutableRefObject<{ [id: string]: HTMLDivElement | null }>;
  htmlCache: React.MutableRefObject<{ [id: string]: string }>;
  onBloques: (id: string, bloques: Bloque[]) => void;
  onCanvasChange: () => void;
  onEliminarBloque: (paginaId: string, bloqueId: string) => void;
  onFinishNew: () => void;
  onEliminarPagina: (id: string) => void;
  onAgregarPagina: (despuesDeIdx: number) => void;
  onInsertarPaginaAntes?: (idx: number) => void;
  onDuplicarPagina?: (id: string, idx: number) => void;
  onCambiarPlantillaPagina?: (
    paginaId: string,
    data: {
      paperStyle?: PaperStyle;
      paperColor?: 'white' | 'dark' | 'yellow';
      paperSize?: string;
    }
  ) => void;
  onIrAPagina?: (n: number) => void;
  onClickEditor: (e: React.MouseEvent<HTMLDivElement>, paginaId: string) => void;
  onTextInsert: (text: string, canvasY: number, paginaId: string) => void;
  registerCanvasExport: (paginaId: string, fn: () => string | null) => void;
  registerStrokesExport: (paginaId: string, fn: () => string | null) => void;
  registerUndoRedo: (paginaId: string, undo: () => void, redo: () => void) => void;
  onPeterSauPeter?: (imageBase64: string, imageMime: string) => void;
}

export default function PaginaEditor({
  pagina,
  paginaIdx,
  totalPaginas,
  temaColor,
  paperStyle,
  paperColor,
  herramienta,
  brushColor,
  brushSize,
  isDrawingMode,
  isDrawing,
  isSelecting,
  newBlockId,
  isMobile,
  pageWidth,
  pageHeight,
  externalScale,
  textRefs,
  htmlCache,
  onBloques,
  onCanvasChange,
  onEliminarBloque,
  onFinishNew,
  onEliminarPagina,
  onAgregarPagina,
  onInsertarPaginaAntes,
  onDuplicarPagina,
  onCambiarPlantillaPagina,
  onIrAPagina,
  onClickEditor,
  onTextInsert,
  registerCanvasExport,
  registerStrokesExport,
  registerUndoRedo,
  onPeterSauPeter,
}: Props) {
  const [menuOpen, setMenuOpen] = useState<'closed'|'main'|'plantilla'>('closed');

  const effectivePaperStyle = pagina.paperStyle || paperStyle;
  const effectivePaperColor = pagina.paperColor || paperColor;

  const pageBg =
    effectivePaperColor === 'dark'
      ? '#111827'
      : effectivePaperColor === 'yellow'
        ? '#fef7d7'
        : '#ffffff';

  return (
    <div style={{ marginBottom: '0px', position: 'relative' }}>
      {/* Top bar de página */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 4px',
        }}
      >
        <button
          onClick={() => onIrAPagina?.(paginaIdx + 1)}
          title="Ir a esta página"
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.35)',
            fontSize: '10px',
            fontWeight: 700,
            cursor: 'pointer',
            padding: '4px 8px',
            borderRadius: '8px',
          }}
        >
          Página {paginaIdx + 1}
        </button>

        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            onClick={() => setMenuOpen(prev => prev === 'closed' ? 'main' : 'closed')}
            title="Opciones de página"
            style={{
              height: '26px',
              padding: '0 8px',
              borderRadius: '8px',
              border: 'none',
              background: menuOpen !== 'closed' ? 'rgba(245,200,66,0.15)' : 'rgba(255,255,255,0.04)',
              color: menuOpen !== 'closed' ? '#f5c842' : 'rgba(255,255,255,0.3)',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            ⋯
          </button>

          {menuOpen !== 'closed' && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: 'calc(100% + 4px)',
                background: '#1a1a2e',
                borderRadius: '12px',
                border: '1px solid rgba(245,200,66,0.15)',
                boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
                padding: '6px',
                zIndex: 400,
                display: 'flex',
                gap: '4px',
              }}
            >
              {/* Submenu plantilla */}
              {menuOpen === 'plantilla' && (
                <div style={{ minWidth: '130px' }}>
                  <button onClick={() => setMenuOpen('main')}
                    style={{ width: '100%', textAlign: 'left', padding: '6px 10px', borderRadius: '8px', border: 'none', background: 'transparent', color: '#f5c842', fontSize: '11px', fontWeight: 700, cursor: 'pointer', marginBottom: '4px' }}>
                    ← Volver
                  </button>
                  {[
                    { id: 'lined' as PaperStyle, label: 'Con líneas', icon: '─' },
                    { id: 'grid' as PaperStyle, label: 'Cuadrícula', icon: '▦' },
                    { id: 'dotted' as PaperStyle, label: 'Puntos', icon: '⠿' },
                    { id: 'blank' as PaperStyle, label: 'Limpio', icon: '▢' },
                  ].map(s => (
                    <button key={s.id}
                      onClick={() => { onCambiarPlantillaPagina?.(pagina.id, { paperStyle: s.id }); setMenuOpen('closed'); }}
                      style={{
                        width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: '8px', border: 'none',
                        background: effectivePaperStyle === s.id ? 'rgba(245,200,66,0.1)' : 'transparent',
                        color: effectivePaperStyle === s.id ? '#f5c842' : '#d4d4d8',
                        fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = effectivePaperStyle === s.id ? 'rgba(245,200,66,0.1)' : 'transparent'; }}
                    >
                      <span style={{ fontSize: '14px', opacity: 0.6 }}>{s.icon}</span> {s.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Main menu */}
              {menuOpen === 'main' && (
                <div style={{ minWidth: '190px' }}>
                  {[
                    { label: '➕ Agregar antes', action: () => { onInsertarPaginaAntes?.(paginaIdx); setMenuOpen('closed'); } },
                    { label: '➕ Agregar después', action: () => { onAgregarPagina(paginaIdx); setMenuOpen('closed'); } },
                    { label: '📄 Duplicar página', action: () => { onDuplicarPagina?.(pagina.id, paginaIdx); setMenuOpen('closed'); } },
                    { label: '🎨 Cambiar plantilla →', action: () => setMenuOpen('plantilla') },
                    { label: '🔢 Ir a página...', action: () => {
                      const val = prompt('Ir a página número:');
                      const n = Number(val);
                      if (!Number.isNaN(n) && n >= 1 && n <= totalPaginas) onIrAPagina?.(n);
                      setMenuOpen('closed');
                    }},
                  ].map(item => (
                    <button key={item.label} onClick={item.action}
                      style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: '8px', border: 'none', background: 'transparent', color: '#d4d4d8', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >{item.label}</button>
                  ))}
                  <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />
                  <button onClick={() => { onEliminarPagina(pagina.id); setMenuOpen('closed'); }}
                    style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: '8px', border: 'none', background: 'transparent', color: '#ef4444', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >🗑️ Borrar página</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Área del editor */}
      <div
        className="editor-area-principal"
        onClick={(e) => {
          if (!isDrawingMode && herramienta === 'texto') {
            onClickEditor(e, pagina.id);
          }
        }}
        style={{
          position: 'relative',
          width: `${pageWidth}px`,
          height: `${pageHeight}px`,
          background: pageBg,
          borderRadius: '6px',
          border: isSelecting
            ? '2px solid #6366f1'
            : isDrawing
              ? `1px solid ${temaColor}40`
              : '1px solid rgba(0,0,0,0.08)',
          overflow: 'visible',
          boxShadow: '0 4px 24px rgba(0,0,0,0.15), 0 1px 4px rgba(0,0,0,0.08)',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        {/* Fondo papel */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
          <PaperBackground
            style={effectivePaperStyle}
            temaColor={temaColor}
            paperColor={effectivePaperColor}
          />
        </div>

        {/* Fondo PDF / imagen */}
        {pagina.backgroundImage && (
          <img
            src={pagina.backgroundImage}
            alt="Fondo"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              objectPosition: 'top',
              zIndex: 1,
              pointerEvents: 'none',
              opacity: 0.92,
            }}
          />
        )}

        {/* Canvas */}
        <EditorCanvas
          herramienta={herramienta}
          brushColor={brushColor}
          brushSize={brushSize}
          temaColor={temaColor}
          onChange={onCanvasChange}
          initialCanvasData={pagina.canvasData}
          initialStrokesData={pagina.strokesData}
          onTextInsert={(text, y) => onTextInsert(text, y, pagina.id)}
          onRegisterExport={(fn) => registerCanvasExport(pagina.id, fn)}
          onRegisterStrokesExport={(fn) => registerStrokesExport(pagina.id, fn)}
          onRegisterUndoRedo={(undo, redo) => registerUndoRedo(pagina.id, undo, redo)}
          externalScale={externalScale}
          onPeterSauPeter={onPeterSauPeter}
        />

        {/* Bloques */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          {pagina.bloques.map((b) => {
            if (b.tipo === 'texto') {
              return (
                <TextBlock
                  key={b.id}
                  bloque={b as BloqueTexto}
                  temaColor={temaColor}
                  isNew={newBlockId === b.id}
                  onUpdate={(changes) => {
                    onBloques(
                      pagina.id,
                      pagina.bloques.map((bl) =>
                        bl.id === b.id ? ({ ...bl, ...changes } as Bloque) : bl
                      )
                    );
                  }}
                  onDelete={() => onEliminarBloque(pagina.id, b.id)}
                  onFinishNew={onFinishNew}
                />
              );
            }

            if (b.tipo === 'imagen') {
              const img = b as BloqueImagen;
              return (
                <ImageBlock
                  key={b.id}
                  bloque={img}
                  temaColor={temaColor}
                  onUpdate={(changes) => {
                    onBloques(
                      pagina.id,
                      pagina.bloques.map((bl) =>
                        bl.id === b.id ? ({ ...bl, ...changes } as Bloque) : bl
                      )
                    );
                  }}
                  onDelete={() => onEliminarBloque(pagina.id, b.id)}
                />
              );
            }

            return null;
          })}
        </div>

        {/* Número de esquina */}
        <div
          style={{
            position: 'absolute',
            bottom: 6,
            right: 10,
            fontSize: '10px',
            color: effectivePaperColor === 'dark' ? 'rgba(255,255,255,0.35)' : '#9ca3af',
            fontWeight: 500,
            pointerEvents: 'none',
            zIndex: 5,
            opacity: 0.5,
          }}
        >
          {paginaIdx + 1}
        </div>
      </div>

      {/* separador entre páginas */}
      <div style={{ height: '8px' }} />
    </div>
  );
}
