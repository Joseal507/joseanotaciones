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
  | 'texto'
  | 'boligrafo'
  | 'marcador'
  | 'lapiz'
  | 'borrador'
  | 'imagen'
  | 'dibujo';

export const genId = () => Math.random().toString(36).substr(2, 9);