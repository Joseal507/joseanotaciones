// ============================================================
// XP DIARIO - Tracking local de XP ganado por día
// ============================================================

const KEY = 'josea_xp_diario';
const isBrowser = () => typeof window !== 'undefined';

export interface XpDiarioData {
  // formato: { "2025-01-15": 45, "2025-01-16": 80 }
  [fecha: string]: number;
}

export const getHoyStr = (): string => {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
};

export const getXpDiario = (): XpDiarioData => {
  if (!isBrowser()) return {};
  try {
    const data = localStorage.getItem(KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
};

export const registrarXpDiario = (cantidad: number): void => {
  if (!isBrowser() || cantidad <= 0) return;
  try {
    const data = getXpDiario();
    const hoy = getHoyStr();
    data[hoy] = (data[hoy] || 0) + cantidad;
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {}
};

/**
 * Devuelve el XP de los últimos N días (más reciente al final)
 * Formato: [{ fecha: '2025-01-10', xp: 45, dia: 'L' }, ...]
 */
export const getXpUltimosDias = (dias: number = 7): { fecha: string; xp: number; diaCorto: string; diaCompleto: string; esHoy: boolean }[] => {
  const data = getXpDiario();
  const result: { fecha: string; xp: number; diaCorto: string; diaCompleto: string; esHoy: boolean }[] = [];
  const hoy = new Date();
  const hoyStr = getHoyStr();
  const cortos = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  const completos = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(hoy);
    d.setDate(d.getDate() - i);
    const fecha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    result.push({
      fecha,
      xp: data[fecha] || 0,
      diaCorto: cortos[d.getDay()],
      diaCompleto: completos[d.getDay()],
      esHoy: fecha === hoyStr,
    });
  }
  return result;
};

/**
 * Devuelve el XP acumulado por día (gráfica lineal)
 * Útil para mostrar el crecimiento total
 */
export const getXpAcumuladoUltimosDias = (dias: number = 30): { fecha: string; xpAcumulado: number; xpDia: number }[] => {
  const data = getXpDiario();
  const fechasOrdenadas = Object.keys(data).sort();
  const result: { fecha: string; xpAcumulado: number; xpDia: number }[] = [];
  const hoy = new Date();

  let acumulado = 0;
  // Calcular acumulado total desde el inicio
  const allFechas = new Set<string>();
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(hoy);
    d.setDate(d.getDate() - i);
    const fecha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    allFechas.add(fecha);
  }

  // Acumulado previo al rango
  for (const f of fechasOrdenadas) {
    if (!allFechas.has(f)) acumulado += data[f];
    else break;
  }

  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(hoy);
    d.setDate(d.getDate() - i);
    const fecha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const xpDia = data[fecha] || 0;
    acumulado += xpDia;
    result.push({ fecha, xpAcumulado: acumulado, xpDia });
  }
  return result;
};

export const getXpTotalRegistrado = (): number => {
  const data = getXpDiario();
  return Object.values(data).reduce((sum, v) => sum + v, 0);
};
