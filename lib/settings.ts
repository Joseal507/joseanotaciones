const isBrowser = () => typeof window !== 'undefined';

export interface AppSettings {
  nombreApp: string;
  tema: 'default' | 'playa' | 'executive' | 'sunset' | 'neon' | 'custom';
  customTheme?: { name: string; gold: string; red: string; blue: string; pink: string };
  fotoPerfil: string;
  notifAsignaciones: boolean;
  notifRacha: boolean;
  notifLogros: boolean;
  timerEnabled: boolean;
  chatEnabled: boolean;
  timerCorner: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  chatCorner: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

const KEY = 'studyal_settings';

export const DEFAULT_SETTINGS: AppSettings = {
  nombreApp: 'StudyAL',
  tema: 'default',
  fotoPerfil: '',
  notifAsignaciones: true,
  notifRacha: true,
  notifLogros: true,
  timerEnabled: true,
  chatEnabled: true,
  timerCorner: 'bottom-right',
  chatCorner: 'bottom-right',
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

export const applyTheme = (tema: AppSettings['tema'], customTheme?: AppSettings['customTheme']) => {
  if (!isBrowser()) return;
  if (tema === 'custom' && customTheme) {
    document.documentElement.setAttribute('data-theme', 'custom');
    const root = document.documentElement;
    root.style.setProperty('--gold', customTheme.gold);
    root.style.setProperty('--gold-dim', hexToRgba(customTheme.gold, 0.15));
    root.style.setProperty('--gold-border', hexToRgba(customTheme.gold, 0.35));
    root.style.setProperty('--red', customTheme.red);
    root.style.setProperty('--red-dim', hexToRgba(customTheme.red, 0.15));
    root.style.setProperty('--red-border', hexToRgba(customTheme.red, 0.3));
    root.style.setProperty('--blue', customTheme.blue);
    root.style.setProperty('--blue-dim', hexToRgba(customTheme.blue, 0.15));
    root.style.setProperty('--blue-border', hexToRgba(customTheme.blue, 0.3));
    root.style.setProperty('--pink', customTheme.pink);
    root.style.setProperty('--pink-dim', hexToRgba(customTheme.pink, 0.15));
    root.style.setProperty('--pink-border', hexToRgba(customTheme.pink, 0.3));
  } else {
    document.documentElement.setAttribute('data-theme', tema);
    // Limpiar custom properties si existían
    const root = document.documentElement;
    ['--gold','--gold-dim','--gold-border','--red','--red-dim','--red-border','--blue','--blue-dim','--blue-border','--pink','--pink-dim','--pink-border'].forEach(p => root.style.removeProperty(p));
  }
};

const hexToRgba = (hex: string, alpha: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

export const limpiarDatosEstudio = () => {
  if (!isBrowser()) return;
  localStorage.removeItem('studyal_racha');
  localStorage.removeItem('studyal_perfil');
};