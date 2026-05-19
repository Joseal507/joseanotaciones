export type TipoCuaderno = 'apuntes' | 'presentacion' | 'ensayo' | 'compartido';

export interface MaterialArchivo {
  id: string;
  nombre: string;
  url: string;
  tipo: string;
  size?: number;
}

export interface MaterialTema {
  id: string;
  titulo: string;
  archivos: MaterialArchivo[];
  fechaCreacion: string;
}

export type EnfoqueEstudio = 'teorico' | 'matematico' | 'teorico_practico';
