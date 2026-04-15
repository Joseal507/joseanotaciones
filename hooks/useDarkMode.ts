import { useState, useEffect } from 'react';

export function useDarkMode() {
  const [darkMode, setDarkMode] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('josea_darkmode');

    if (saved === 'auto' || !saved) {
      // Auto mode: claro de 6am-6pm, oscuro de noche
      const hour = new Date().getHours();
      const isDark = hour < 6 || hour >= 18;
      setDarkMode(isDark);
      if (isDark) {
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.add('light');
      }
      // Re-check cada minuto
      const interval = setInterval(() => {
        const h = new Date().getHours();
        const shouldBeDark = h < 6 || h >= 18;
        setDarkMode(shouldBeDark);
        if (shouldBeDark) {
          document.documentElement.classList.remove('light');
        } else {
          document.documentElement.classList.add('light');
        }
      }, 60000);
      return () => clearInterval(interval);
    } else {
      const isDark = saved !== 'light';
      setDarkMode(isDark);
      if (isDark) {
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.add('light');
      }
    }
  }, []);

  const toggle = () => {
    const newDark = !darkMode;
    setDarkMode(newDark);
    if (newDark) {
      document.documentElement.classList.remove('light');
      localStorage.setItem('josea_darkmode', 'dark');
    } else {
      document.documentElement.classList.add('light');
      localStorage.setItem('josea_darkmode', 'light');
    }
  };

  const setAuto = () => {
    localStorage.setItem('josea_darkmode', 'auto');
    const hour = new Date().getHours();
    const isDark = hour < 6 || hour >= 18;
    setDarkMode(isDark);
    if (isDark) {
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
    }
  };

  return { darkMode, toggle, setAuto, mounted };
}