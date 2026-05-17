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
  '/quizzes': 'Quizzes',
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
  }
}

export default function NavLoader() {
  const pathname = usePathname();
  const prevPath = useRef(pathname);
  const hideRef = useRef<any>(null);

  const [visible, setVisible] = useState(false);
  const [label, setLabel] = useState('Página');

  const clearHide = () => {
    if (hideRef.current) clearTimeout(hideRef.current);
    hideRef.current = null;
  };

  const show = (arg?: LoaderArg) => {
    clearHide();
    setLabel(getLabel(arg));
    setVisible(true);
    hideRef.current = setTimeout(() => setVisible(false), 8000);
  };

  const hide = () => {
    clearHide();
    hideRef.current = setTimeout(() => setVisible(false), 120);
  };

  useEffect(() => {
    if (prevPath.current !== pathname) {
      const previousPath = prevPath.current;
      prevPath.current = pathname;
      // Solo ocultar si llegamos al destino que pedimos
      // Si nos redirigieron a otra ruta (ej: por falta de auth), seguir mostrando
      hide();
    }
  }, [pathname]);

  useEffect(() => {
    window.__showNavLoader = (arg?: LoaderArg) => show(arg);

    const onClickCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const link = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link) return;

      const href = link.getAttribute('href') || '';
      if (!href.startsWith('/') || href.startsWith('//')) return;

      show(href);
    };

    const origPushState = window.history.pushState;
    const origReplaceState = window.history.replaceState;

    window.history.pushState = function (state: any, unused: string, url?: string | URL | null) {
      try {
        const href = typeof url === 'string' ? url : url?.toString?.() || '';
        if (href && href.startsWith('/')) show(href);
      } catch {}
      return origPushState.apply(window.history, [state, unused, url as any]);
    } as any;

    window.history.replaceState = function (state: any, unused: string, url?: string | URL | null) {
      try {
        const href = typeof url === 'string' ? url : url?.toString?.() || '';
        if (href && href.startsWith('/')) show(href);
      } catch {}
      return origReplaceState.apply(window.history, [state, unused, url as any]);
    } as any;

    document.addEventListener('click', onClickCapture, true);

    return () => {
      delete window.__showNavLoader;
      document.removeEventListener('click', onClickCapture, true);
      window.history.pushState = origPushState;
      window.history.replaceState = origReplaceState;
      clearHide();
    };
  }, []);

  if (!visible) return null;

  return <StudyLoader label={label} />;
}