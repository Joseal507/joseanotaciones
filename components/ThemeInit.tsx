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

  return null;
}
