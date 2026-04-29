'use client';

import { useEffect } from 'react';

const VALID_THEMES = ['default', 'playa', 'executive', 'sunset', 'neon', 'custom'];

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

          // Aplicar colores custom si es tema personalizado
          if (parsed.tema === 'custom' && parsed.customTheme) {
            const root = document.documentElement;
            const ct = parsed.customTheme;
            const hex2rgba = (hex: string, a: number) => {
              const r = parseInt(hex.slice(1,3),16);
              const g = parseInt(hex.slice(3,5),16);
              const b = parseInt(hex.slice(5,7),16);
              return 'rgba('+r+','+g+','+b+','+a+')';
            };
            if (ct.gold) { root.style.setProperty('--gold', ct.gold); root.style.setProperty('--gold-dim', hex2rgba(ct.gold,0.15)); root.style.setProperty('--gold-border', hex2rgba(ct.gold,0.35)); }
            if (ct.red) { root.style.setProperty('--red', ct.red); root.style.setProperty('--red-dim', hex2rgba(ct.red,0.15)); root.style.setProperty('--red-border', hex2rgba(ct.red,0.3)); }
            if (ct.blue) { root.style.setProperty('--blue', ct.blue); root.style.setProperty('--blue-dim', hex2rgba(ct.blue,0.15)); root.style.setProperty('--blue-border', hex2rgba(ct.blue,0.3)); }
            if (ct.pink) { root.style.setProperty('--pink', ct.pink); root.style.setProperty('--pink-dim', hex2rgba(ct.pink,0.15)); root.style.setProperty('--pink-border', hex2rgba(ct.pink,0.3)); }
          }

          // migrar key vieja → nueva
          localStorage.setItem('studyal_settings', JSON.stringify(parsed));
        } else {
          // Si tiene tema viejo, migrar a default
          if (parsed.tema && !VALID_THEMES.includes(parsed.tema)) {
            parsed.tema = 'default';
            localStorage.setItem('studyal_settings', JSON.stringify(parsed));
          }
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
