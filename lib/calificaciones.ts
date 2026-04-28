// lib/calificaciones.ts

export type EscalaNotas = '1-100' | '1-10' | '1-5' | '0-4' | 'letras';

export const ESCALAS: { id: EscalaNotas; label: string; min: number; max: number; aprobatorio: number }[] = [
  { id: '1-100', label: '1 — 100', min: 1, max: 100, aprobatorio: 71 },
  { id: '1-10', label: '1 — 10', min: 1, max: 10, aprobatorio: 6 },
  { id: '1-5', label: '1 — 5 (Panama)', min: 1, max: 5, aprobatorio: 3 },
  { id: '0-4', label: '0 — 4 (GPA)', min: 0, max: 4, aprobatorio: 2 },
  { id: 'letras', label: 'A — F (Letras)', min: 0, max: 100, aprobatorio: 60 },
];

export const getEscalaInfo = (id: EscalaNotas) => ESCALAS.find(e => e.id === id) || ESCALAS[0];

export const letraAValor = (letra: string): number | null => {
  const map: Record<string, number> = {
    'A+': 100, 'A': 95, 'A-': 90,
    'B+': 87, 'B': 83, 'B-': 80,
    'C+': 77, 'C': 73, 'C-': 70,
    'D+': 67, 'D': 63, 'D-': 60,
    'F': 40,
  };
  return map[letra.toUpperCase().trim()] ?? null;
};

export const valorALetra = (valor: number): string => {
  if (valor >= 97) return 'A+';
  if (valor >= 93) return 'A';
  if (valor >= 90) return 'A-';
  if (valor >= 87) return 'B+';
  if (valor >= 83) return 'B';
  if (valor >= 80) return 'B-';
  if (valor >= 77) return 'C+';
  if (valor >= 73) return 'C';
  if (valor >= 70) return 'C-';
  if (valor >= 67) return 'D+';
  if (valor >= 63) return 'D';
  if (valor >= 60) return 'D-';
  return 'F';
};

export interface Nota {
  id: string;
  valor: number;
  fecha: string;
  etiqueta?: string;
}

export interface Evaluacion {
  id: string;
  nombre: string;
  porcentaje: number;
  notas: Nota[];
}

export interface CalificacionesMateria {
  notaObjetivo: number;
  evaluaciones: Evaluacion[];
  escala: EscalaNotas;
  configurado: boolean;
}

export const calcularPromedio = (valores: number[]): number | null => {
  if (!valores.length) return null;
  return valores.reduce((a, b) => a + b, 0) / valores.length;
};

export const promedioEvaluacion = (ev: Evaluacion): number | null => {
  return calcularPromedio(ev.notas.map(n => n.valor));
};

export const contribucionEvaluacion = (ev: Evaluacion): number | null => {
  const prom = promedioEvaluacion(ev);
  if (prom === null) return null;
  return (prom * ev.porcentaje) / 100;
};

export interface ResumenCalificaciones {
  promedioActual: number | null;
  porcentajeCubierto: number;
  porcentajePendiente: number;
  notaObjetivo: number;
  necesitaParaAprobar: number | null;
  yaAprobado: boolean;
  imposibleAprobar: boolean;
  evaluacionesConNota: Evaluacion[];
  evaluacionesSinNota: Evaluacion[];
  totalPorcentaje: number;
  escala: EscalaNotas;
}

export const calcularResumen = (cal: CalificacionesMateria): ResumenCalificaciones => {
  const { evaluaciones, notaObjetivo, escala } = cal;

  const conNota = evaluaciones.filter(e => e.notas.length > 0);
  const sinNota = evaluaciones.filter(e => e.notas.length === 0);

  const porcentajeCubierto = conNota.reduce((a, e) => a + e.porcentaje, 0);
  const porcentajePendiente = sinNota.reduce((a, e) => a + e.porcentaje, 0);
  const totalPorcentaje = evaluaciones.reduce((a, e) => a + e.porcentaje, 0);

  let sumaActual = 0;
  for (const ev of conNota) {
    const contrib = contribucionEvaluacion(ev);
    if (contrib !== null) sumaActual += contrib;
  }

  const promedioActual = conNota.length > 0 ? sumaActual : null;

  let necesitaParaAprobar: number | null = null;
  let yaAprobado = false;
  let imposibleAprobar = false;

  const maxEscala = getEscalaInfo(escala).max;

  if (porcentajePendiente === 0) {
    yaAprobado = promedioActual !== null && promedioActual >= notaObjetivo;
    imposibleAprobar = promedioActual !== null && promedioActual < notaObjetivo;
  } else {
    const puntosFaltantes = notaObjetivo - sumaActual;
    const necesita = puntosFaltantes / (porcentajePendiente / 100);

    if (promedioActual !== null && promedioActual >= notaObjetivo) {
      yaAprobado = true;
    } else if (necesita > maxEscala) {
      imposibleAprobar = true;
      necesitaParaAprobar = Math.round(necesita * 10) / 10;
    } else {
      necesitaParaAprobar = Math.round(Math.max(0, necesita) * 10) / 10;
    }
  }

  return {
    promedioActual: promedioActual !== null ? Math.round(promedioActual * 10) / 10 : null,
    porcentajeCubierto,
    porcentajePendiente,
    notaObjetivo,
    necesitaParaAprobar,
    yaAprobado,
    imposibleAprobar,
    evaluacionesConNota: conNota,
    evaluacionesSinNota: sinNota,
    totalPorcentaje,
    escala,
  };
};

export type NivelFeedback = 'bajo' | 'medio' | 'alto' | 'aprobado' | 'imposible' | 'sin_datos';

export const getFeedback = (resumen: ResumenCalificaciones): {
  nivel: NivelFeedback;
  mensaje: string;
  emoji: string;
  color: string;
} => {
  const escala = resumen.escala;
  const formatNota = (val: number | null) => {
    if (val === null) return '—';
    if (escala === 'letras') return valorALetra(val);
    return String(val);
  };

  if (resumen.yaAprobado) {
    return { nivel: 'aprobado', mensaje: 'Ya superaste el objetivo!', emoji: '🏆', color: '#4ade80' };
  }
  if (resumen.imposibleAprobar) {
    return {
      nivel: 'imposible',
      mensaje: `Matematicamente dificil. Necesitarias ${formatNota(resumen.necesitaParaAprobar)} en lo que falta.`,
      emoji: '💪',
      color: '#f87171',
    };
  }
  if (resumen.promedioActual === null) {
    return { nivel: 'sin_datos', mensaje: 'Agrega tus notas para ver tu progreso', emoji: '📊', color: '#94a3b8' };
  }

  const ratio = resumen.promedioActual / resumen.notaObjetivo;

  if (ratio >= 1) {
    return { nivel: 'alto', mensaje: 'Excelente rendimiento, estas por encima del objetivo', emoji: '🌟', color: '#4ade80' };
  } else if (ratio >= 0.85) {
    return { nivel: 'medio', mensaje: `Vas bien. Necesitas ${formatNota(resumen.necesitaParaAprobar)} en lo que resta`, emoji: '📈', color: '#fbbf24' };
  } else {
    return { nivel: 'bajo', mensaje: `Necesitas mejorar. Apunta a ${formatNota(resumen.necesitaParaAprobar)} en lo que falta`, emoji: '⚠️', color: '#f87171' };
  }
};

export const validarPorcentajes = (evaluaciones: Evaluacion[], excludeId?: string): number => {
  return evaluaciones
    .filter(e => e.id !== excludeId)
    .reduce((a, e) => a + e.porcentaje, 0);
};

export const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
