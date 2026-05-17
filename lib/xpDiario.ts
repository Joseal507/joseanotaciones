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


/**
 * Devuelve XP acumulado mostrando la EVOLUCIÓN desde 0 hasta el total.
 * - Si hay datos diarios reales: usa esos para los últimos días.
 * - Para días sin datos: distribuye el XP base de forma creciente (simulada).
 *
 * Resultado: línea que SIEMPRE sube desde 0 → totalServidor
 */
export const getXpAcumuladoConTotal = (
  totalServidor: number,
  dias: number = 30
): { fecha: string; xpAcumulado: number; xpDia: number }[] => {
  const data = getXpDiario();
  const hoy = new Date();
  const fechasRango: string[] = [];

  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(hoy);
    d.setDate(d.getDate() - i);
    fechasRango.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }

  // XP real ganado dentro del rango (de localStorage)
  const xpEnRango = fechasRango.reduce((sum, f) => sum + (data[f] || 0), 0);

  // XP base = lo que tenías ANTES del rango (a distribuir)
  const xpBase = Math.max(0, totalServidor - xpEnRango);

  // Distribuir xpBase entre los días del rango con una curva ascendente
  // Usa curva sqrt para que crezca más rápido al principio y se estabilice
  const result: { fecha: string; xpAcumulado: number; xpDia: number }[] = [];

  // Si no hay XP base (usuario nuevo), solo usar datos reales
  if (xpBase === 0) {
    let acum = 0;
    for (const fecha of fechasRango) {
      const xpDia = data[fecha] || 0;
      acum += xpDia;
      result.push({ fecha, xpAcumulado: acum, xpDia });
    }
    return result;
  }

  // Hay XP base — distribuirlo con curva ascendente
  // Cada día base = xpBase * (sqrt(i+1)/sqrt(dias))
  const totalPesos = Array.from({ length: dias }, (_, i) => Math.sqrt(i + 1)).reduce((a, b) => a + b, 0);

  let acumBase = 0;
  for (let i = 0; i < fechasRango.length; i++) {
    const fecha = fechasRango[i];
    // Porción del XP base correspondiente a este día (creciente)
    const pesoDia = Math.sqrt(i + 1) / totalPesos;
    const baseDia = Math.round(xpBase * pesoDia);

    // XP real ganado ese día
    const xpRealDia = data[fecha] || 0;

    acumBase += baseDia + xpRealDia;
    result.push({
      fecha,
      xpAcumulado: acumBase,
      xpDia: baseDia + xpRealDia
    });
  }

  // Asegurar que el último valor coincida con el total real
  if (result.length > 0) {
    const ultimo = result[result.length - 1];
    const ajuste = totalServidor - ultimo.xpAcumulado;
    if (Math.abs(ajuste) > 0) {
      ultimo.xpAcumulado = totalServidor;
      ultimo.xpDia += ajuste;
    }
  }

  return result;
};
