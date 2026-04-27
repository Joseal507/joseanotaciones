'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ApuntePageReadOnly from './ApuntePageReadOnly';

const PAGE_W = 794;
const PAGE_H = 1123;

type ParsedApunte = {
  raw: any;
  paginas: any[];
  defaultPaperStyle?: 'blank' | 'lined' | 'grid' | 'dotted';
  defaultPaperColor?: 'white' | 'dark' | 'yellow';
  defaultPaperSize?: string;
};

function extraerRaw(contenido: any) {
  try {
    if (contenido?.contenido && typeof contenido.contenido === 'string') {
      return JSON.parse(contenido.contenido);
    }
    if (contenido?.contenido && typeof contenido.contenido === 'object') {
      return contenido.contenido;
    }
    if (typeof contenido === 'string') {
      return JSON.parse(contenido);
    }
    if (contenido && typeof contenido === 'object') {
      return contenido;
    }
  } catch {}
  return null;
}

function parsearContenido(contenido: any): ParsedApunte {
  const raw = extraerRaw(contenido) || {};

  const defaultPaperStyle =
    raw?.paperStyle ??
    contenido?.paperStyle ??
    contenido?.paper_style ??
    'blank';

  const defaultPaperColor =
    raw?.paperColor ??
    contenido?.paperColor ??
    contenido?.paper_color ??
    'white';

  const defaultPaperSize =
    raw?.paperSize ??
    contenido?.paperSize ??
    contenido?.paper_size ??
    'letter';

  let paginas: any[] = [];

  if (Array.isArray(raw?.paginas)) {
    paginas = raw.paginas.map((pg: any) => ({
      ...pg,
      paperStyle: pg?.paperStyle ?? defaultPaperStyle,
      paperColor: pg?.paperColor ?? defaultPaperColor,
      paperSize: pg?.paperSize ?? defaultPaperSize,
      backgroundImage:
        pg?.backgroundImage ??
        raw?.backgroundImage ??
        raw?.paperConfig?.backgroundImage ??
        null,
    }));
  } else if (Array.isArray(raw?.bloques)) {
    paginas = [{
      ...raw,
      bloques: raw.bloques,
      paperStyle: raw?.paperStyle ?? defaultPaperStyle,
      paperColor: raw?.paperColor ?? defaultPaperColor,
      paperSize: raw?.paperSize ?? defaultPaperSize,
      backgroundImage: raw?.backgroundImage ?? null,
    }];
  }

  return {
    raw,
    paginas,
    defaultPaperStyle,
    defaultPaperColor,
    defaultPaperSize,
  };
}

export default function ApuntePagesViewer({ contenido }: { contenido: any }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(PAGE_W);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => setContainerWidth(el.clientWidth || PAGE_W);
    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const parsed = useMemo(() => parsearContenido(contenido), [contenido]);
  const paginas = parsed.paginas;
  const scale = Math.min(containerWidth / PAGE_W, 1);

  const hayContenido = paginas.some((pg: any) =>
    (pg?.bloques || []).length > 0 || pg?.canvasData || pg?.backgroundImage
  );

  if (!hayContenido) {
    const textoPlano =
      typeof contenido?.texto === 'string'
        ? contenido.texto
        : typeof contenido === 'string'
          ? contenido
          : '';

    if (textoPlano) {
      return (
        <div style={{ fontSize: '15px', color: 'var(--text-primary)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
          {textoPlano}
        </div>
      );
    }

    return (
      <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: '48px', marginBottom: '12px' }}>📝</div>
        <p style={{ margin: 0 }}>Este apunte no tiene contenido visible</p>
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      {paginas.map((pg: any, pgIdx: number) => (
        <div key={pgIdx} style={{ marginBottom: pgIdx < paginas.length - 1 ? '20px' : '0' }}>
          {paginas.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 12px' }}>
              <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
              <span style={{ fontSize: '11px', color: 'var(--text-faint)', fontWeight: 700 }}>
                Página {pgIdx + 1} de {paginas.length}
              </span>
              <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
            </div>
          )}

          <ApuntePageReadOnly
            pagina={pg}
            scale={scale}
            pageWidth={PAGE_W}
            pageHeight={PAGE_H}
            pageNumber={pgIdx + 1}
            defaultPaperStyle={parsed.defaultPaperStyle}
            defaultPaperColor={parsed.defaultPaperColor}
          />
        </div>
      ))}
    </div>
  );
}
