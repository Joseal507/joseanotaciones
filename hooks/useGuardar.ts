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

export function useGuardar({
  getPaginas,
  syncCache,
  onGuardar,
  setGuardando,
  setGuardado,
}: Opts) {
  const autoSaveTimer = useRef<any>(null);

  const guardarAhora = useCallback(() => {
    syncCache();
    const paginasConCanvas = getPaginas();
    const contenidoFinal = JSON.stringify({ paginas: paginasConCanvas });
    onGuardar(contenidoFinal);
    setGuardado(true);
  }, [getPaginas, syncCache, onGuardar, setGuardado]);

  const guardar = useCallback(() => {
    syncCache();
    const paginasConCanvas = getPaginas();
    const contenidoFinal = JSON.stringify({ paginas: paginasConCanvas });
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
    autoSaveTimer.current = setTimeout(() => guardar(), 3000);
  }, [guardar, setGuardado]);

  // Ctrl+S / Cmd+S
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

  // Guardar al desmontar
  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      try { guardarAhora(); } catch {}
    };
  }, [guardarAhora]);

  return { guardar, guardarAhora, triggerAutoSave };
}