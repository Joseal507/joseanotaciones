export interface AppSettings {
  nombreApp: string;
  tema: 'default' | 'playero' | 'falcons' | 'raiders' | 'math';
  fotoPerfil: string;
  notifAsignaciones: boolean;
  notifRacha: boolean;
  notifLogros: boolean;
}

const KEY = 'josea_settings';

export const DEFAULT_SETTINGS: AppSettings = {
  nombreApp: 'JoseAnotaciones',
  tema: 'default',
  fotoPerfil: '',
  notifAsignaciones: true,
  notifRacha: true,
  notifLogros: true,
};

export const getSettings = (): AppSettings => {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const data = localStorage.getItem(KEY);
    return data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : DEFAULT_SETTINGS;
  } catch { return DEFAULT_SETTINGS; }
};

export const saveSettings = (settings: AppSettings) => {
  localStorage.setItem(KEY, JSON.stringify(settings));
};

export const applyTheme = (tema: AppSettings['tema']) => {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', tema);
};

export const limpiarDatosEstudio = () => {
  localStorage.removeItem('josea_racha');
  localStorage.removeItem('josea_perfil');
};