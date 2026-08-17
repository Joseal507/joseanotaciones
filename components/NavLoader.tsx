'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import StudyLoader from './StudyLoader';

// Autoridad global de navegación full-page. Antes esto era un componente
// muerto (`return null`) — 27 call sites en toda la app ya llamaban
// `window.__showNavLoader?.(href)` antes de `router.push(href)`, pero como
// nadie asignaba esa función, la llamada no hacía nada. Resultado: entre el
// click y que Next.js resolviera la navegación (y su `loading.tsx` de ruta
// entrara), la página anterior seguía pintada — exactamente el "Página A →
// [flash] → loader → Página B" que no queríamos.
//
// Esto muestra el mismo StudyLoader canónico de forma SÍNCRONA en el click
// (antes incluso de que router.push empiece a resolver), y lo oculta en
// cuanto el pathname real coincide con el destino. Next.js puede seguir
// mostrando su propio loading.tsx de ruta por debajo mientras tanto — es
// visualmente idéntico, así que no hay parpadeo perceptible.

const LABELS: Record<string, string> = {
  '/': 'StudyAL',
  '/landing': 'StudyAL',
  '/auth': 'StudyAL',
  '/materias': 'Materias',
  '/horario': 'Horario',
  '/agenda': 'Agenda',
  '/perfil': 'Perfil',
  '/settings': 'Settings',
  '/leaderboard': 'Leaderboard',
  '/comunidad': 'Comunidad',
  '/partners': 'Partners',
  '/chat': 'Chat',
  '/chap': 'ChapBot',
  '/pomodoro': 'Timer',
  '/news': 'Noticias',
};

function labelFor(href: string): string {
  try {
    const path = href.split('?')[0].split('#')[0];
    if (LABELS[path]) return LABELS[path];
    if (path.startsWith('/u/')) return 'Perfil';
    if (path.startsWith('/materias')) return 'Materias';
    if (path.startsWith('/comunidad')) return 'Comunidad';
    const seg = path.split('/').filter(Boolean)[0];
    if (seg) return seg.charAt(0).toUpperCase() + seg.slice(1);
  } catch {}
  return 'StudyAL';
}

// Tiempo máximo que el loader puede quedar visible si la navegación nunca
// resuelve (error de red, ruta cancelada) -- no queremos un loader pegado.
const SAFETY_TIMEOUT_MS = 10000;

export default function NavLoader() {
  const pathname = usePathname();
  const [label, setLabel] = useState<string | null>(null);
  const targetPathRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (window as any).__showNavLoader = (href: string) => {
      if (!href) return;
      const targetPath = href.split('?')[0].split('#')[0];
      if (targetPath === window.location.pathname) return; // ya estamos ahí
      targetPathRef.current = targetPath;
      setLabel(labelFor(href));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        targetPathRef.current = null;
        setLabel(null);
      }, SAFETY_TIMEOUT_MS);
    };
    return () => {
      try { delete (window as any).__showNavLoader; } catch {}
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // La navegación real ya llegó a destino -> el contenido nuevo ya está
  // montado detrás nuestro, ocultar.
  useEffect(() => {
    if (targetPathRef.current && pathname === targetPathRef.current) {
      targetPathRef.current = null;
      setLabel(null);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  }, [pathname]);

  if (!label) return null;
  return <StudyLoader label={label} />;
}
