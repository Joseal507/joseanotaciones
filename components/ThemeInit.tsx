'use client';

import { useEffect } from 'react';

const VALID_THEMES = ['default', 'alai', 'falcons', 'raiders', 'math'];

export default function ThemeInit() {
  useEffect(() => {
    // Dark mode
    const darkMode =
      localStorage.getItem('studyal_darkmode') ||
      localStorage.getItem('josea_darkmode');

    if (darkMode === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }

    // Theme settings — primero key nueva, luego vieja
    try {
      const raw =
        localStorage.getItem('studyal_settings') ||
        localStorage.getItem('josea_settings');

      if (raw) {
        const parsed = JSON.parse(raw);

        if (parsed.tema && VALID_THEMES.includes(parsed.tema)) {
          document.documentElement.setAttribute('data-theme', parsed.tema);

          // migrar key vieja → nueva
          localStorage.setItem('studyal_settings', JSON.stringify(parsed));
        } else {
          document.documentElement.setAttribute('data-theme', 'default');
        }
      } else {
        document.documentElement.setAttribute('data-theme', 'default');
      }
    } catch {
      document.documentElement.setAttribute('data-theme', 'default');
    }
  }, []);

  // Auto-limpiar localStorage si está casi lleno
  useEffect(() => {
    try {
      const used = JSON.stringify(localStorage).length;
      const limit = 4.5 * 1024 * 1024; // ~4.5MB
      if (used > limit * 0.9) {
        console.warn('localStorage casi lleno:', (used/1024/1024).toFixed(1) + 'MB');
        // Limpiar caches grandes
        const keysToCheck = Object.keys(localStorage);
        keysToCheck.forEach(key => {
          const val = localStorage.getItem(key) || '';
          if (val.length > 500_000 && key.includes('materias')) {
            // No borrar, pero comprimir
            console.log('Key grande:', key, (val.length/1024).toFixed(0) + 'KB');
          }
        });
      }
    } catch {}
  }, []);

  return null;
}
