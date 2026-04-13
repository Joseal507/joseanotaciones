import { useState, useEffect } from 'react';

export function useDarkMode() {
  const [darkMode, setDarkMode] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('josea_darkmode');
    const isDark = saved !== 'light';
    setDarkMode(isDark);
    if (isDark) {
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
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

  return { darkMode, toggle, mounted };
}