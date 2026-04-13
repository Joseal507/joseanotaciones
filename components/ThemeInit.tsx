'use client';

import { useEffect } from 'react';

export default function ThemeInit() {
  useEffect(() => {
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
        if (parsed.tema && parsed.tema !== 'gold') {
          document.documentElement.setAttribute('data-theme', parsed.tema);
        }
      }
    } catch {}
  }, []);

  return null;
}