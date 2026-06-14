const KEY = 'josea_racha';
const isBrowser = () => typeof window !== 'undefined';

export interface RachaData {
  rachaActual: number;
  mejorRacha: number;
  ultimoDia: string;
  diasEstudiados: string[];
}

const empty: RachaData = {
  rachaActual: 0,
  mejorRacha: 0,
  ultimoDia: '',
  diasEstudiados: [],
};

export const getHoyStr = (): string => {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
};

export const getAyerStr = (): string => {
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  return `${ayer.getFullYear()}-${String(ayer.getMonth() + 1).padStart(2, '0')}-${String(ayer.getDate()).padStart(2, '0')}`;
};

export const getRacha = (): RachaData => {
  if (!isBrowser()) return empty;
  try {
    const data = localStorage.getItem(KEY);
    return data ? JSON.parse(data) : empty;
  } catch {
    return empty;
  }
};

export const saveRacha = (data: RachaData): void => {
  if (!isBrowser()) return;
  localStorage.setItem(KEY, JSON.stringify(data));
};

export const syncRachaADB = async (racha: RachaData): Promise<void> => {
  if (!isBrowser()) return;
  try {
    await fetch('/api/racha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        racha_actual: racha.rachaActual,
        mejor_racha: racha.mejorRacha,
        ultimo_dia: racha.ultimoDia,
        dias_estudiados: racha.diasEstudiados,
      }),
    });
  } catch {}
};

export const cargarRachaDesdeDB = async (): Promise<RachaData> => {
  if (!isBrowser()) return empty;
  try {
    const res = await fetch('/api/racha', {
      credentials: 'same-origin',
    });

    if (!res.ok) return getRacha();
    const json = await res.json();
    if (!json.ok) return getRacha();

    const rachaDB: RachaData = {
      rachaActual: json.racha_actual ?? 0,
      mejorRacha: json.mejor_racha ?? 0,
      ultimoDia: json.ultimo_dia ?? '',
      diasEstudiados: json.dias_estudiados ?? [],
    };

    const local = getRacha();

    // ✅ Merge inteligente — quedarse con el mejor
    const merged: RachaData = {
      rachaActual: Math.max(local.rachaActual, rachaDB.rachaActual),
      mejorRacha: Math.max(local.mejorRacha, rachaDB.mejorRacha),
      ultimoDia: local.ultimoDia > rachaDB.ultimoDia ? local.ultimoDia : rachaDB.ultimoDia,
      diasEstudiados: Array.from(
        new Set([...local.diasEstudiados, ...rachaDB.diasEstudiados])
      ).slice(-60),
    };

    saveRacha(merged);
    return merged;
  } catch {
    return getRacha();
  }
};

export const verificarRacha = (): RachaData => {
  if (!isBrowser()) return empty;
  const racha = getRacha();
  const hoy = getHoyStr();
  const ayer = getAyerStr();

  // ✅ Solo resetear si ultimoDia es pasado (anterior a ayer)
  // NO resetear si ultimoDia es futuro (puede ser un bug de timezone)
  if (
    racha.ultimoDia &&
    racha.ultimoDia < ayer &&
    racha.ultimoDia !== hoy
  ) {
    racha.rachaActual = 0;
    saveRacha(racha);
    syncRachaADB(racha).catch(() => {});
  }

  return racha;
};

export const registrarEstudioHoy = async (): Promise<RachaData> => {
  if (!isBrowser()) return empty;

  const racha = getRacha();
  const hoy = getHoyStr();
  const ayer = getAyerStr();

  if (racha.ultimoDia === hoy) return racha;

  if (racha.ultimoDia === ayer || racha.ultimoDia > ayer) {
    racha.rachaActual += 1;
  } else {
    racha.rachaActual = 1;
  }

  racha.ultimoDia = hoy;

  if (racha.rachaActual > racha.mejorRacha) {
    racha.mejorRacha = racha.rachaActual;
  }

  if (!racha.diasEstudiados.includes(hoy)) {
    racha.diasEstudiados.push(hoy);
    if (racha.diasEstudiados.length > 60) {
      racha.diasEstudiados = racha.diasEstudiados.slice(-60);
    }
  }

  saveRacha(racha);
  darXPPorRacha(racha.rachaActual).catch(() => {});
  syncRachaADB(racha).catch(() => {});

  import('./syncLeaderboard').then(({ syncLeaderboard }) => {
    syncLeaderboard();
  }).catch(() => {});

  return racha;
};

const darXPPorRacha = async (rachaActual: number): Promise<void> => {
  if (!isBrowser()) return;
  try {
    const { darXP } = await import('./xpClient');

    let xpBase = 0;
    if (rachaActual >= 30) xpBase = 150;
    else if (rachaActual >= 7) xpBase = 50;
    else if (rachaActual >= 3) xpBase = 20;
    else xpBase = 10;

    const hitosXP: Record<number, number> = {
      3: 30, 7: 75, 14: 100, 30: 200, 60: 350, 100: 500,
    };

    const xpHito = hitosXP[rachaActual] ?? 0;
    const xpTotal = xpBase + xpHito;

    await darXP('racha', xpTotal, {
      rachaActual,
      esHito: xpHito > 0,
      xpBase,
      xpHito,
    });
  } catch {}
};
