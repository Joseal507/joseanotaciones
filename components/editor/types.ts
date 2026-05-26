export type BloqueTexto = {
  id: string;
  tipo: 'texto';
  html: string;
  x: number;
  y: number;
  width: number;
};

export type BloqueImagen = {
  id: string;
  tipo: 'imagen';
  src: string;
  width: number;
  x: number;
  y: number;
  label?: string;
  align: 'left' | 'center' | 'right';
  floating?: boolean;
  zIndex?: number;
};

export type BloqueTrazos = {
  id: string;
  tipo: 'trazos';
  dataUrl: string;
  width: number;
  height: number;
  align: 'left' | 'center' | 'right';
};

export type Bloque = BloqueTexto | BloqueImagen | BloqueTrazos;

export type Herramienta =
  | 'seleccion'
  | 'lasso'
  | 'texto'
  | 'boligrafo'
  | 'marcador'
  | 'lapiz'
  | 'borrador'
  | 'borrador_trazo'
  | 'regla'
  | 'forma_rect'
  | 'forma_circulo'
  | 'forma_triangulo'
  | 'imagen'
  | 'dibujo';

export const genId = () => Math.random().toString(36).substr(2, 9);

export interface Pagina {
  id: string;
  bloques: Bloque[];
  canvasData: string | null;
  // ✅ NUEVO: strokes como JSON para restaurar al cargar
  strokesData?: string | null;
  backgroundImage?: string;

  // ✅ plantilla por página
  paperStyle?: PaperStyle;
  paperColor?: 'white' | 'dark' | 'yellow';
  paperSize?: string;
}

export type PaperStyle = 'blank' | 'lined' | 'grid' | 'dotted';

export const parsePaginas = (contenido: string): Pagina[] => {
  if (!contenido) return [{ id: genId(), bloques: [], canvasData: null }];
  try {
    const p = JSON.parse(contenido);
    if (p && p.paginas && Array.isArray(p.paginas)) {
      return p.paginas.map((pg: any) => ({
        id: genId(),
        canvasData: pg.canvasData || null,
        strokesData: pg.strokesData || null,
        backgroundImage: pg.backgroundImage || undefined,
        paperStyle: pg.paperStyle || undefined,
        paperColor: pg.paperColor || undefined,
        paperSize: pg.paperSize || undefined,
        bloques: (pg.bloques || []).map((b: any) => ({
          ...b, id: genId(), x: b.x ?? 80, y: b.y ?? 20, width: b.width ?? 600,
        })),
      }));
    }
    if (p && p.bloques && Array.isArray(p.bloques)) {
      return [{
        id: genId(),
        canvasData: p.canvasData || null,
        strokesData: p.strokesData || null,
        paperStyle: p.paperStyle || undefined,
        paperColor: p.paperColor || undefined,
        paperSize: p.paperSize || undefined,
        bloques: p.bloques.map((b: any) => ({ ...b, id: genId(), x: b.x ?? 80, y: b.y ?? 20, width: b.width ?? 600 }))
      }];
    }
    if (Array.isArray(p)) {
      return [{
      id: genId(),
      canvasData: null,
      paperStyle: undefined,
      paperColor: undefined,
      paperSize: undefined,
      bloques: p.map((b: any) => ({ ...b, id: genId(), x: b.x ?? 80, y: b.y ?? 20, width: b.width ?? 600 }))
    }];
    }
  } catch {}
  if (contenido.trim()) {
    return [{ id: genId(), canvasData: null, bloques: [{ id: genId(), tipo: 'texto', html: contenido, x: 80, y: 20, width: 600 }] }];
  }
  return [{ id: genId(), bloques: [], canvasData: null }];
};