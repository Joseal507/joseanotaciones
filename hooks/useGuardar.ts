import { useRef, useCallback, useEffect } from 'react';

export interface PaginaParaGuardar {
  bloques: any[];
  canvasData: string | null;
  backgroundImage?: string;
}

interface Opts {
  getPaginas: () => PaginaParaGuardar[];
  syncCache: () => void;
  onGuardar: (contenido: string) => void;
  setGuardando: (v: boolean) => void;
  setGuardado: (v: boolean) => void;
}

// ✅ Limpiar base64 pesado antes de serializar
const limpiarPaginasParaGuardar = (paginas: PaginaParaGuardar[]): PaginaParaGuardar[] => {
  return paginas.map(pg => ({
    ...pg,
    // ✅ canvasData se guarda tal cual (es el dibujo del usuario)
    // pero si es null o string vacío, dejarlo null
    canvasData: pg.canvasData || null,
    // ✅ backgroundImage: si es base64 muy largo (>100KB) truncar
    // Las URLs de Supabase Storage son cortas (~100 chars)
    backgroundImage: pg.backgroundImage
      ? pg.backgroundImage.length > 500_000
        ? pg.backgroundImage // mantener aunque sea pesado, es necesario para el usuario
        : pg.backgroundImage
      : undefined,
    // ✅ Limpiar bloques
    bloques: (pg.bloques || []).map((b: any) => {
      if (b.tipo === 'imagen' && b.src?.startsWith('data:') && b.src.length > 2_000_000) {
        return { ...b, src: '' }; // imagen demasiado pesada
      }
      return b;
    }),
  }));
};

export function useGuardar({
  getPaginas,
  syncCache,
  onGuardar,
  setGuardando,
  setGuardado,
}: Opts) {
  const autoSaveTimer = useRef<any>(null);
  const lastSavedRef = useRef<string>('');

  const guardarAhora = useCallback(() => {
    syncCache();
    const paginas = getPaginas();
    const paginasLimpias = limpiarPaginasParaGuardar(paginas);
    const contenidoFinal = JSON.stringify({ paginas: paginasLimpias });

    // ✅ No guardar si no hay cambios
    if (contenidoFinal === lastSavedRef.current) return;
    lastSavedRef.current = contenidoFinal;

    onGuardar(contenidoFinal);
    setGuardado(true);
  }, [getPaginas, syncCache, onGuardar, setGuardado]);

  const guardar = useCallback(() => {
    syncCache();
    const paginas = getPaginas();
    const paginasLimpias = limpiarPaginasParaGuardar(paginas);
    const contenidoFinal = JSON.stringify({ paginas: paginasLimpias });

    // ✅ No guardar si no hay cambios
    if (contenidoFinal === lastSavedRef.current) {
      setGuardado(true);
      return;
    }
    lastSavedRef.current = contenidoFinal;

    setGuardando(true);
    onGuardar(contenidoFinal);
    setTimeout(() => {
      setGuardando(false);
      setGuardado(true);
    }, 600);
  }, [getPaginas, syncCache, onGuardar, setGuardando, setGuardado]);

  const triggerAutoSave = useCallback(() => {
    setGuardado(false);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    // ✅ 5 segundos en vez de 3 para menos requests
    autoSaveTimer.current = setTimeout(() => guardar(), 5000);
  }, [guardar, setGuardado]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        guardar();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [guardar]);

  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      try { guardarAhora(); } catch {}
    };
  }, [guardarAhora]);

  return { guardar, guardarAhora, triggerAutoSave };
}