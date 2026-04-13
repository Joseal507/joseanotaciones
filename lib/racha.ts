const KEY = 'josea_racha';

export interface RachaData {
  rachaActual: number;
  mejorRacha: number;
  ultimoDia: string;
  diasEstudiados: string[];
}

export const getRacha = (): RachaData => {
  if (typeof window === 'undefined') return { rachaActual: 0, mejorRacha: 0, ultimoDia: '', diasEstudiados: [] };
  try {
    const data = localStorage.getItem(KEY);
    return data ? JSON.parse(data) : { rachaActual: 0, mejorRacha: 0, ultimoDia: '', diasEstudiados: [] };
  } catch {
    return { rachaActual: 0, mejorRacha: 0, ultimoDia: '', diasEstudiados: [] };
  }
};

export const saveRacha = (data: RachaData) => {
  localStorage.setItem(KEY, JSON.stringify(data));
};

export const getHoyStr = () => {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
};

export const getAyerStr = () => {
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  return `${ayer.getFullYear()}-${String(ayer.getMonth() + 1).padStart(2, '0')}-${String(ayer.getDate()).padStart(2, '0')}`;
};

export const registrarEstudioHoy = (): RachaData => {
  const racha = getRacha();
  const hoy = getHoyStr();
  const ayer = getAyerStr();
  if (racha.ultimoDia === hoy) return racha;
  if (racha.ultimoDia === ayer) {
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
  return racha;
};

export const verificarRacha = (): RachaData => {
  const racha = getRacha();
  const hoy = getHoyStr();
  const ayer = getAyerStr();
  if (racha.ultimoDia && racha.ultimoDia !== hoy && racha.ultimoDia !== ayer) {
    racha.rachaActual = 0;
    saveRacha(racha);
  }
  return racha;
};
