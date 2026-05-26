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

const limpiarPaginasParaGuardar = (paginas: PaginaParaGuardar[]): PaginaParaGuardar[] => {
  return paginas.map(pg => ({
    ...pg,
    canvasData: pg.canvasData || null,
    backgroundImage: pg.backgroundImage
      ? (pg.backgroundImage.length > 500_000 ? comprimirBase64(pg.backgroundImage) : pg.backgroundImage)
      : undefined,
    bloques: (pg.bloques || []).map((b: any) => {
      if (b.tipo === 'imagen' && b.src?.startsWith('data:') && b.src.length > 500_000) {
        return { ...b, src: comprimirBase64(b.src) };
      }
      return b;
    }),
  }));
};

function comprimirBase64(dataUrl: string): string {
  try {
    if (typeof document === 'undefined') return dataUrl;
    const img = new Image();
    img.src = dataUrl;
    const canvas = document.createElement('canvas');
    const maxW = 800;
    const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1;
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch {
    return dataUrl.substring(0, 500_000);
  }
}

export function useGuardar({
  getPaginas,
  syncCache,
  onGuardar,
  setGuardando,
  setGuardado,
}: Opts) {
  const autoSaveTimer = useRef<any>(null);
  const lastSavedRef = useRef<string>('');
  const dirtyRef = useRef(false);

  const getPaginasRef = useRef(getPaginas);
  const syncCacheRef = useRef(syncCache);
  const onGuardarRef = useRef(onGuardar);

  useEffect(() => { getPaginasRef.current = getPaginas; }, [getPaginas]);
  useEffect(() => { syncCacheRef.current = syncCache; }, [syncCache]);
  useEffect(() => { onGuardarRef.current = onGuardar; }, [onGuardar]);

  const markDirty = useCallback(() => {
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      setGuardado(false);
    }
  }, [setGuardado]);

  const ejecutarGuardado = useCallback(() => {
    syncCacheRef.current();
    const paginas = getPaginasRef.current();
    const paginasLimpias = limpiarPaginasParaGuardar(paginas);
    const contenidoFinal = JSON.stringify({ paginas: paginasLimpias });

    if (contenidoFinal === lastSavedRef.current) {
      dirtyRef.current = false;
      setGuardado(true);
      return false;
    }

    lastSavedRef.current = contenidoFinal;
    onGuardarRef.current(contenidoFinal);
    dirtyRef.current = false;
    setGuardado(true);
    return true;
  }, [setGuardado]);

  const guardarAhora = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    ejecutarGuardado();
  }, [ejecutarGuardado]);

  // Guardado manual con spinner
  const guardar = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);

    setGuardando(true);
    try {
      ejecutarGuardado();
    } finally {
      setTimeout(() => {
        setGuardando(false);
        setGuardado(true);
      }, 350);
    }
  }, [ejecutarGuardado, setGuardando, setGuardado]);

  // Guardado silencioso para autosave
  const guardarSilencioso = useCallback(() => {
    ejecutarGuardado();
  }, [ejecutarGuardado]);

  // Autosave general (texto/bloques/etc.)
  const triggerAutoSave = useCallback(() => {
    markDirty();
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      guardarSilencioso();
    }, 5000);
  }, [guardarSilencioso, markDirty]);

  // Autosave de canvas: más tarde, para evitar guardar entre trazos
  const triggerCanvasAutoSave = useCallback(() => {
    markDirty();
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      guardarSilencioso();
    }, 10000);
  }, [guardarSilencioso, markDirty]);

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
      try {
        syncCacheRef.current();
        const paginas = getPaginasRef.current();
        const paginasLimpias = limpiarPaginasParaGuardar(paginas);
        const contenidoFinal = JSON.stringify({ paginas: paginasLimpias });
        onGuardarRef.current(contenidoFinal);
      } catch (err) {
        console.error('[useGuardar] Error al guardar al salir:', err);
      }
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      try {
        syncCacheRef.current();
        const paginas = getPaginasRef.current();
        const paginasLimpias = limpiarPaginasParaGuardar(paginas);
        const contenidoFinal = JSON.stringify({ paginas: paginasLimpias });

        if (contenidoFinal !== lastSavedRef.current) {
          onGuardarRef.current(contenidoFinal);
          e.preventDefault();
          e.returnValue = '';
        }
      } catch {}
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        try {
          syncCacheRef.current();
          const paginas = getPaginasRef.current();
          const paginasLimpias = limpiarPaginasParaGuardar(paginas);
          const contenidoFinal = JSON.stringify({ paginas: paginasLimpias });
          if (contenidoFinal !== lastSavedRef.current) {
            lastSavedRef.current = contenidoFinal;
            dirtyRef.current = false;
            onGuardarRef.current(contenidoFinal);
          }
        } catch {}
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  return {
    guardar,
    guardarAhora,
    triggerAutoSave,
    triggerCanvasAutoSave,
  };
}
