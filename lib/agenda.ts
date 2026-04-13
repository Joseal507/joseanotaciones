export interface Asignacion {
  id: string;
  titulo: string;
  materia: string;
  materiaColor: string;
  fecha: string;
  completada: boolean;
  tipo: 'tarea' | 'examen' | 'proyecto' | 'otro';
}

export interface ObjetivoAgenda {
  id: string;
  titulo: string;
  completado: boolean;
  xp: number;
  categoria: 'estudio' | 'personal' | 'materia';
  materiaColor?: string;
  fechaCreacion: string;
}

const KEY_ASIG = 'josea_asignaciones';
const KEY_OBJ = 'josea_objetivos';

export const getAsignaciones = (): Asignacion[] => {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(KEY_ASIG) || '[]'); } catch { return []; }
};

export const saveAsignaciones = (data: Asignacion[]) => {
  localStorage.setItem(KEY_ASIG, JSON.stringify(data));
};

export const getObjetivos = (): ObjetivoAgenda[] => {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(KEY_OBJ) || '[]'); } catch { return []; }
};

export const saveObjetivos = (data: ObjetivoAgenda[]) => {
  localStorage.setItem(KEY_OBJ, JSON.stringify(data));
};

export const genId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 5);