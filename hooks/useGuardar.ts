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
      ? pg.backgroundImage
      : undefined,
    bloques: (pg.bloques || []).map((b: any) => {
      if (b.tipo === 'imagen' && b.src?.startsWith('data:') && b.src.length > 2_000_000) {
        return { ...b, src: '' };
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
  // ✅ Refs estables para el cleanup
  const getPaginasRef = useRef(getPaginas);
  const syncCacheRef = useRef(syncCache);
  const onGuardarRef = useRef(onGuardar);

  // Mantener refs actualizadas sin re-crear callbacks
  useEffect(() => { getPaginasRef.current = getPaginas; }, [getPaginas]);
  useEffect(() => { syncCacheRef.current = syncCache; }, [syncCache]);
  useEffect(() => { onGuardarRef.current = onGuardar; }, [onGuardar]);

  // ✅ Función base de guardado (usa refs para ser estable)
  const ejecutarGuardado = useCallback((mostrarSpinner = false) => {
    syncCacheRef.current();
    const paginas = getPaginasRef.current();
    const paginasLimpias = limpiarPaginasParaGuardar(paginas);
    const contenidoFinal = JSON.stringify({ paginas: paginasLimpias });

    if (contenidoFinal === lastSavedRef.current) {
      if (mostrarSpinner) setGuardado(true);
      return false; // no hubo cambios
    }

    lastSavedRef.current = contenidoFinal;
    onGuardarRef.current(contenidoFinal);
    return true; // hubo cambios y se guardó
  }, [setGuardado]);

  const guardarAhora = useCallback(() => {
    ejecutarGuardado(false);
    setGuardado(true);
  }, [ejecutarGuardado, setGuardado]);

  const guardar = useCallback(() => {
    const huboCambios = ejecutarGuardado(true);
    if (!huboCambios) {
      setGuardado(true);
      return;
    }
    setGuardando(true);
    setTimeout(() => {
      setGuardando(false);
      setGuardado(true);
    }, 600);
  }, [ejecutarGuardado, setGuardando, setGuardado]);

  const triggerAutoSave = useCallback(() => {
    setGuardado(false);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => guardar(), 5000);
  }, [guardar, setGuardado]);

  // ✅ Ctrl+S / Cmd+S
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

  // ✅ FIX PRINCIPAL: Guardar al desmontar el componente (salir del apunte)
  useEffect(() => {
    return () => {
      // Cancelar autosave pendiente
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);

      // Guardar inmediatamente con los refs (que siempre tienen el valor más reciente)
      try {
        syncCacheRef.current();
        const paginas = getPaginasRef.current();
        const paginasLimpias = limpiarPaginasParaGuardar(paginas);
        const contenidoFinal = JSON.stringify({ paginas: paginasLimpias });

        // Guardar aunque sea igual al último (por si acaso)
        onGuardarRef.current(contenidoFinal);
      } catch (err) {
        console.error('[useGuardar] Error al guardar al salir:', err);
      }
    };
  }, []); // ✅ Array vacío - solo se ejecuta al desmontar, usa refs internamente

  // ✅ Guardar antes de cerrar/recargar la pestaña
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Intentar guardar sincrónicamente
      try {
        syncCacheRef.current();
        const paginas = getPaginasRef.current();
        const paginasLimpias = limpiarPaginasParaGuardar(paginas);
        const contenidoFinal = JSON.stringify({ paginas: paginasLimpias });
        if (contenidoFinal !== lastSavedRef.current) {
          onGuardarRef.current(contenidoFinal);
          // Mostrar diálogo de "¿salir sin guardar?" solo si hay cambios
          e.preventDefault();
          e.returnValue = '';
        }
      } catch {}
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []); // ✅ Array vacío - usa refs

  // ✅ Guardar cuando la pestaña se oculta (cambio de tab, minimize)
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
            onGuardarRef.current(contenidoFinal);
          }
        } catch {}
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []); // ✅ Array vacío - usa refs

  return { guardar, guardarAhora, triggerAutoSave };
}