const isBrowser = () => typeof window !== 'undefined';

export interface AppSettings {
  nombreApp: string;
  tema: 'default' | 'alai' | 'falcons' | 'raiders' | 'math';
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
  if (!isBrowser()) return DEFAULT_SETTINGS;
  try {
    const data = localStorage.getItem(KEY);
    return data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : DEFAULT_SETTINGS;
  } catch { return DEFAULT_SETTINGS; }
};

export const saveSettings = (settings: AppSettings) => {
  if (!isBrowser()) return;
  localStorage.setItem(KEY, JSON.stringify(settings));
};

export const applyTheme = (tema: AppSettings['tema']) => {
  if (!isBrowser()) return;
  document.documentElement.setAttribute('data-theme', tema);
};

export const limpiarDatosEstudio = () => {
  if (!isBrowser()) return;
  localStorage.removeItem('josea_racha');
  localStorage.removeItem('josea_perfil');
};