const KEY = 'josea_notas_rapidas';

export interface NotaRapida {
  id: string;
  contenido: string;
  fecha: string;
  color: string;
}

const COLORES = ['#f5c842', '#ff4d6d', '#38bdf8', '#f472b6', '#4ade80', '#a78bfa'];

export const getNotas = (): NotaRapida[] => {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(KEY);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
};

export const saveNotas = (notas: NotaRapida[]) => {
  localStorage.setItem(KEY, JSON.stringify(notas));
};

export const crearNota = (contenido: string): NotaRapida => {
  const notas = getNotas();
  const nueva: NotaRapida = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    contenido,
    fecha: new Date().toLocaleDateString('es-ES'),
    color: COLORES[notas.length % COLORES.length],
  };
  saveNotas([nueva, ...notas]);
  return nueva;
};

export const eliminarNota = (id: string) => {
  saveNotas(getNotas().filter(n => n.id !== id));
};

export const actualizarNota = (id: string, contenido: string) => {
  saveNotas(getNotas().map(n => n.id === id ? { ...n, contenido } : n));
};