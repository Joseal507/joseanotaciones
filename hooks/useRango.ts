'use client';

import { useState, useEffect, useRef } from 'react';
import { getRango, Rango } from '../lib/xpSystem';
import { useXP } from './useXP';

export function useRango() {
  const { xpTotal, cargando } = useXP();
  const [rangoAnterior, setRangoAnterior] = useState<Rango | null>(null);
  const [rangoNuevo, setRangoNuevo] = useState<Rango | null>(null);
  const [mostrarAnimacion, setMostrarAnimacion] = useState(false);
  const xpAnteriorRef = useRef<number | null>(null);
  const inicializadoRef = useRef(false);

  useEffect(() => {
    if (cargando || xpTotal === 0) return;

    if (!inicializadoRef.current) {
      // Primera carga: guardar estado inicial sin mostrar animación
      xpAnteriorRef.current = xpTotal;
      inicializadoRef.current = true;
      return;
    }

    const xpPrev = xpAnteriorRef.current ?? xpTotal;
    if (xpTotal <= xpPrev) {
      xpAnteriorRef.current = xpTotal;
      return;
    }

    const rangoPrev = getRango(xpPrev);
    const rangoActual = getRango(xpTotal);

    if (rangoPrev.id !== rangoActual.id) {
      setRangoAnterior(rangoPrev);
      setRangoNuevo(rangoActual);
      setMostrarAnimacion(true);
    }

    xpAnteriorRef.current = xpTotal;
  }, [xpTotal, cargando]);

  const cerrarAnimacion = () => {
    setMostrarAnimacion(false);
    setRangoAnterior(null);
    setRangoNuevo(null);
  };

  return {
    rangoActual: getRango(xpTotal),
    mostrarAnimacion,
    rangoAnterior,
    rangoNuevo,
    cerrarAnimacion,
  };
}
