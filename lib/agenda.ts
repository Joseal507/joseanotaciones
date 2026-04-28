const KEY_ASIG = 'josea_asignaciones';
const KEY_OBJ  = 'josea_objetivos';
const isBrowser = () => typeof window !== 'undefined';

export type TipoAsignacion  = 'tarea' | 'examen' | 'proyecto' | 'otro';
export type TamañoObjetivo  = 'pequeño' | 'mediano' | 'grande';
export type CategoriaObjetivo = 'estudio' | 'personal' | 'materia' | 'asignacion';

export interface Asignacion {
  id: string;
  titulo: string;
  materia: string;
  materiaColor: string;
  fecha: string;          // YYYY-MM-DD límite
  completada: boolean;
  tipo: TipoAsignacion;
  tamaño: TamañoObjetivo; // determina el XP
  xp: number;
  vencida: boolean;       // true si pasó la fecha sin completar
  fechaCompletada?: string;
}

export interface ObjetivoAgenda {
  id: string;
  titulo: string;
  completado: boolean;
  xp: number;
  categoria: CategoriaObjetivo;
  materiaColor?: string;
  fechaCreacion: string;
  fechaLimite?: string;
  tamaño?: TamañoObjetivo;
  asignacionId?: string;  // vinculado a una asignación
}

export const XP_TAMAÑO: Record<TamañoObjetivo, number> = {
  pequeño: 50,
  mediano: 120,
  grande:  250,
};

export const genId = () =>
  Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

export const getAsignaciones = (): Asignacion[] => {
  if (!isBrowser()) return [];
  try { return JSON.parse(localStorage.getItem(KEY_ASIG) || '[]'); } catch { return []; }
};
export const saveAsignaciones = (d: Asignacion[]) => {
  if (isBrowser()) localStorage.setItem(KEY_ASIG, JSON.stringify(d));
};

export const getObjetivos = (): ObjetivoAgenda[] => {
  if (!isBrowser()) return [];
  try { return JSON.parse(localStorage.getItem(KEY_OBJ) || '[]'); } catch { return []; }
};
export const saveObjetivos = (d: ObjetivoAgenda[]) => {
  if (isBrowser()) localStorage.setItem(KEY_OBJ, JSON.stringify(d));
};

// ── Crea un objetivo ligado a una asignación ──────────────────
export const objetivoDesdeAsignacion = (a: Asignacion): ObjetivoAgenda => ({
  id: genId(),
  titulo: a.titulo,
  completado: false,
  xp: a.xp,
  categoria: 'asignacion',
  materiaColor: a.materiaColor,
  fechaCreacion: new Date().toISOString().slice(0, 10),
  fechaLimite: a.fecha,
  tamaño: a.tamaño,
  asignacionId: a.id,
});

// ── Marca asignaciones vencidas y retira el objetivo asociado ─
export const procesarVencidas = (
  asigs: Asignacion[],
  objs: ObjetivoAgenda[],
): { asigs: Asignacion[]; objs: ObjetivoAgenda[]; cambio: boolean } => {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  let cambio = false;

  const nuevasAsigs = asigs.map(a => {
    if (a.completada || a.vencida) return a;
    const limite = new Date(a.fecha + 'T23:59:59');
    if (hoy > limite) { cambio = true; return { ...a, vencida: true }; }
    return a;
  });

  // Si una asignación venció, des-completar su objetivo (no debería estar completado,
  // pero por si acaso) y marcarlo bloqueado via titulo con prefijo
  const nuevosObjs = objs.map(o => {
    if (!o.asignacionId) return o;
    const asig = nuevasAsigs.find(a => a.id === o.asignacionId);
    if (asig?.vencida && !asig.completada && o.completado) {
      cambio = true;
      return { ...o, completado: false };
    }
    return o;
  });

  return { asigs: nuevasAsigs, objs: nuevosObjs, cambio };
};
