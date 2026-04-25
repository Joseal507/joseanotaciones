'use client';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { Pagina } from '../editor/types';

const PAPER_SIZES: Record<string, { w: number; h: number }> = {
  normal: { w: 816, h: 1056 },
  a7: { w: 295, h: 420 },
  a6: { w: 420, h: 595 },
  a5: { w: 595, h: 842 },
  a4: { w: 842, h: 1191 },
  a3: { w: 1191, h: 1684 },
  letter: { w: 816, h: 1056 },
  tabloid: { w: 1056, h: 1632 },
  board: { w: 1400, h: 1000 },
};

interface Props {
  pagina: Pagina;
  postContenido: any;
}

export default function NoteRenderer({ pagina, postContenido }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const paperSize = pagina?.paperSize || postContenido?.paperSize || postContenido?.paperConfig?.paperSize || 'normal';
  const size = PAPER_SIZES[paperSize] || PAPER_SIZES.normal;
  const pageWidth = size.w;
  const pageHeight = size.h;

  useLayoutEffect(() => {
    const update = () => {
      if (containerRef.current) {
        const w = containerRef.current.offsetWidth || pageWidth;
        setScale(w / pageWidth);
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [pageWidth]);

  const pColor = pagina?.paperColor || postContenido?.paperColor || postContenido?.paperConfig?.paperColor || 'dark';
  const pStyle = pagina?.paperStyle || postContenido?.paperStyle || postContenido?.paperConfig?.paperStyle || 'grid';

  const pageBg =
    pColor === 'dark' ? '#111827' :
    pColor === 'yellow' ? '#fef7d7' :
    '#ffffff';

  const defaultTextColor =
    pColor === 'dark' ? '#f3f4f6' : '#111111';

  const gridColor =
    pColor === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';

  const bgImage =
    pStyle === 'grid'
      ? `linear-gradient(${gridColor} 1px, transparent 1px), linear-gradient(90deg, ${gridColor} 1px, transparent 1px)`
      : pStyle === 'lined'
      ? `linear-gradient(${gridColor} 1px, transparent 1px)`
      : pStyle === 'dotted'
      ? `radial-gradient(circle, ${gridColor} 1px, transparent 1px)`
      : 'none';

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: `${pageHeight * scale}px`,
        position: 'relative',
        borderRadius: '10px',
        overflow: 'hidden',
        marginBottom: '18px',
      }}
    >
      <div
        style={{
          width: `${pageWidth}px`,
          height: `${pageHeight}px`,
          background: pageBg,
          backgroundImage: bgImage,
          backgroundSize: '25px 25px',
          position: 'absolute',
          top: 0,
          left: 0,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          overflow: 'hidden',
          boxShadow: '0 8px 40px rgba(0,0,0,0.35)',
          pointerEvents: 'none',
        }}
      >
        {pagina?.canvasData && (
          <img
            src={pagina.canvasData}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'fill',
              zIndex: 1,
            }}
            alt=""
          />
        )}

        <div style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
          {pagina?.bloques?.map((b: any) => (
            <div
              key={b.id}
              style={{
                position: 'absolute',
                left: `${b.x}px`,
                top: `${b.y}px`,
                width: `${b.width}px`,
              }}
            >
              {b.tipo === 'texto' ? (
                <div
                  dangerouslySetInnerHTML={{ __html: b.html || '' }}
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                    margin: 0,
                    padding: 0,
                    color: defaultTextColor,
                    lineHeight: 1.35,
                    fontSize: '18px',
                  }}
                />
              ) : b.tipo === 'imagen' ? (
                <img
                  src={b.src || b.url || b.contenido}
                  style={{
                    width: '100%',
                    borderRadius: '8px',
                    display: 'block',
                  }}
                  alt={b.label || ''}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
