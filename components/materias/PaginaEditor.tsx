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
  onClickEditor,
  onTextInsert,
  registerCanvasExport,
  registerStrokesExport,
  registerUndoRedo,
  onPeterSauPeter,
}: Props) {
  return (
    <div style={{ marginBottom: '0px' }}>
      {/* Page number minimal */}
      {totalPaginas > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '6px 0' }}>
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)', fontWeight: 600 }}>
            {paginaIdx + 1} / {totalPaginas}
          </span>
          <button
            onClick={() => onEliminarPagina(pagina.id)}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.15)',
              fontSize: '10px',
              cursor: 'pointer',
              padding: '2px 6px',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Editor area */}
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
          background: paperColor === 'dark' ? '#111827' : paperColor === 'yellow' ? '#fef7d7' : '#ffffff',
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
        {/* Paper background */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
          <PaperBackground style={paperStyle} temaColor={temaColor} paperColor={paperColor} />
        </div>

        {/* Background image / PDF */}
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

        {/* Drawing canvas */}
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

        {/* Blocks layer */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            pointerEvents: 'none', // ← CLAVE: no bloquear clicks vacíos
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

        {/* Page number corner */}
        <div
          style={{
            position: 'absolute',
            bottom: 6,
            right: 10,
            fontSize: '10px',
            color: paperColor === 'dark' ? 'rgba(255,255,255,0.35)' : '#9ca3af',
            fontWeight: 500,
            pointerEvents: 'none',
            zIndex: 5,
            opacity: 0.5,
          }}
        >
          {paginaIdx + 1}
        </div>
      </div>

      {/* Add page */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
        <button
          onClick={() => onAgregarPagina(paginaIdx)}
          style={{
            padding: '8px 20px',
            borderRadius: '12px',
            border: '1px dashed rgba(255,255,255,0.12)',
            background: 'transparent',
            color: 'rgba(255,255,255,0.25)',
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'rgba(245,200,66,0.3)';
            e.currentTarget.style.color = '#f5c842';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
            e.currentTarget.style.color = 'rgba(255,255,255,0.25)';
          }}
        >
          + New page
        </button>
      </div>
    </div>
  );
}
