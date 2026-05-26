'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import StudyLoader from './StudyLoader';

type LoaderArg = string | { href?: string; label?: string } | undefined;

const LABELS: Record<string, string> = {
  '/': 'Inicio',
  '/leaderboard': 'Leaderboard',
  '/settings': 'Configuración',
  '/perfil': 'Mi Perfil',
  '/materias': 'Materias',
  '/comunidad': 'Comunidad',
  '/partners': 'Partners',
  '/news': 'News',
  '/agenda': 'Agenda',
  '/horario': 'Horario',
  '/chat': 'Chat',
  '/chap': 'CHAP',
};

function normalizePath(arg?: LoaderArg) {
  let href = '';
  if (typeof arg === 'string') href = arg;
  else href = arg?.href || '';
  if (!href) return '';
  try {
    const url = new URL(href, window.location.origin);
    href = url.pathname;
  } catch {
    href = href.split('?')[0];
  }
  if (href.startsWith('/u/')) return '/perfil';
  return href.split('?')[0];
}

function getLabel(arg?: LoaderArg) {
  if (typeof arg === 'object' && arg?.label) return arg.label;
  const path = normalizePath(arg);
  if (LABELS[path]) return LABELS[path];
  if (!path) return 'Página';
  const clean = path.replace(/^\/+/, '').replace(/[-_]/g, ' ').trim();
  if (!clean) return 'Página';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

declare global {
  interface Window {
    __showNavLoader?: (arg?: LoaderArg) => void;
    __hideNavLoader?: () => void;
  }
}

export default function NavLoader() {
  const pathname = usePathname();
  const prevPath = useRef(pathname);
  const showTimerRef = useRef<any>(null);
  const maxTimerRef = useRef<any>(null);

  const [visible, setVisible] = useState(false);
  const [label, setLabel] = useState('Página');

  const clearAll = () => {
    if (showTimerRef.current) { clearTimeout(showTimerRef.current); showTimerRef.current = null; }
    if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
  };

  const show = (arg?: LoaderArg) => {
    clearAll();
    setLabel(getLabel(arg));
    // Solo aparece si nav tarda >300ms (evita parpadeo)
    showTimerRef.current = setTimeout(() => setVisible(true), 300);
    // Máximo 5s para no quedarse pegado
    maxTimerRef.current = setTimeout(() => {
      clearAll();
      setVisible(false);
    }, 5000);
  };

  const hide = () => {
    clearAll();
    setVisible(false);
  };

  // Detectar cambio de ruta y ocultar
  useEffect(() => {
    if (prevPath.current !== pathname) {
      prevPath.current = pathname;
      hide();
    }
  }, [pathname]);

  useEffect(() => {
    window.__showNavLoader = show;
    window.__hideNavLoader = hide;

    const onClickCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const link = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link) return;
      const href = link.getAttribute('href') || '';
      if (!href.startsWith('/') || href.startsWith('//')) return;
      // Si es el mismo pathname, no mostrar
      try {
        const url = new URL(href, window.location.origin);
        if (url.pathname === window.location.pathname) return;
      } catch {}
      show(href);
    };

    document.addEventListener('click', onClickCapture, true);

    return () => {
      delete window.__showNavLoader;
      delete window.__hideNavLoader;
      document.removeEventListener('click', onClickCapture, true);
      clearAll();
    };
  }, []);

  if (!visible) return null;

  return <StudyLoader label={label} />;
}
