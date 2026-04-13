export type BloqueTexto = {
  id: string;
  tipo: 'texto';
  html: string;
};

export type BloqueImagen = {
  id: string;
  tipo: 'imagen';
  src: string;
  width: number;
  align: 'left' | 'center' | 'right';
  label?: string;
  x?: number;
  y?: number;
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
  | 'texto'
  | 'boligrafo'
  | 'marcador'
  | 'lapiz'
  | 'borrador'
  | 'imagen'
  | 'dibujo';

export const genId = () => Math.random().toString(36).substr(2, 9);