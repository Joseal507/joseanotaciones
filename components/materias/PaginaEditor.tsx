'use client';

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
  onClickEditor: (e: React.MouseEvent<HTMLDivElement>, paginaId: string) => void;
  onTextInsert: (text: string, canvasY: number, paginaId: string) => void;
  registerCanvasExport: (paginaId: string, fn: () => string | null) => void;
  registerStrokesExport: (paginaId: string, fn: () => string | null) => void;
  registerUndoRedo: (paginaId: string, undo: () => void, redo: () => void) => void;
}

export default function PaginaEditor({
  pagina, paginaIdx, totalPaginas, temaColor, paperStyle,
  herramienta, brushColor, brushSize, isDrawingMode, isDrawing, isSelecting,
  newBlockId, isMobile, pageWidth, pageHeight, externalScale,
  textRefs, htmlCache,
  onBloques, onCanvasChange, onEliminarBloque, onFinishNew,
  onEliminarPagina, onAgregarPagina, onClickEditor, onTextInsert,
  registerCanvasExport, registerStrokesExport, registerUndoRedo,
}: Props) {
  return (
    <div style={{ marginBottom: '0px' }}>
      {/* Header página */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', paddingLeft: '4px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-faint)', fontWeight: 600, letterSpacing: '1px' }}>
          Página {paginaIdx + 1}
        </span>
        {totalPaginas > 1 && (
          <button
            onClick={() => onEliminarPagina(pagina.id)}
            style={{
              background: 'none',
              border: '1px solid #fca5a5',
              color: '#ef4444',
              borderRadius: '6px',
              padding: '1px 8px',
              fontSize: '10px',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            ✕ Eliminar
          </button>
        )}
      </div>

      {/* Área del editor */}
      <div
        className="editor-area-principal"
        style={{
          position: 'relative',
          width: `${pageWidth}px`,
          height: `${pageHeight}px`,
          background: 'white',
          borderRadius: '12px',
          border: isSelecting
            ? '2px solid #6366f1'
            : isDrawing
              ? `2px solid ${temaColor}`
              : '1px solid #e5e7eb',
          overflow: 'hidden',
          boxShadow: isSelecting
            ? '0 0 0 3px #6366f120'
            : isDrawing
              ? `0 0 0 3px ${temaColor}20`
              : '0 2px 8px rgba(0,0,0,0.06)',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        {/* Fondo paper */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
          <PaperBackground style={paperStyle} temaColor={temaColor} />
        </div>

        {/* Fondo PDF/imagen */}
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

        {/* Canvas de dibujo */}
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
        />

        {/* Bloques de texto e imágenes */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            pointerEvents: isDrawingMode ? 'none' : 'all',
          }}
          onClick={(e) => onClickEditor(e, pagina.id)}
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

        {/* Número de página */}
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            right: 12,
            fontSize: '11px',
            color: '#d1d5db',
            fontWeight: 600,
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          {paginaIdx + 1} / {totalPaginas}
        </div>
      </div>

      {/* Botón agregar página */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '12px 0' }}>
        <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
        <button
          onClick={() => onAgregarPagina(paginaIdx)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 16px',
            borderRadius: '20px',
            border: `2px dashed ${temaColor}`,
            background: 'transparent',
            color: temaColor,
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = temaColor + '15';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          }}
        >
          + Agregar página
        </button>
        <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
      </div>
    </div>
  );
}