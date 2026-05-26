import { useEffect } from 'react';

export function applyThemeFromStorage() {
  if (typeof window === 'undefined') return;

  // Dark mode
  const darkMode = localStorage.getItem('josea_darkmode');
  if (darkMode === 'light') {
    document.documentElement.classList.add('light');
  } else {
    document.documentElement.classList.remove('light');
  }

  // Color theme
  try {
    const settings = localStorage.getItem('josea_settings');
    if (settings) {
      const parsed = JSON.parse(settings);
      if (parsed.tema) {
        document.documentElement.setAttribute('data-theme', parsed.tema);
      }
    }
  } catch {}
}

export function useTheme() {
  useEffect(() => {
    applyThemeFromStorage();
  }, []);
}