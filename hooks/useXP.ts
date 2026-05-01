'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { registrarEstudioHoy } from '../lib/racha';
import {
  getLevelFromXp,
  getLevelProgress,
  getXpNeededForNextLevel,
  getXpInCurrentLevel,
  getLevelTitle,
} from '../lib/xpSystem';

export type FuenteXP = 'timer' | 'flashcards' | 'quiz' | 'post' | 'objetivo' | 'login' | 'racha' | 'comunidad';

export interface XPResult {
  xpGanado: number;
  xpTotal: number;
  nivelAnterior: number;
  nivelNuevo: number;
  subioNivel: boolean;
}

interface XPState {
  xpTotal: number;
  nivel: number;
  xpEnNivel: number;
  xpParaSiguiente: number;
  progreso: number;
  titulo: { titulo: string; color: string; emoji: string };
  breakdown: Record<string, number>;
  cargando: boolean;
}

let _cache: { xpTotal: number; nivel: number; breakdown: Record<string, number>; ts: number } | null = null;
const CACHE_TTL = 60_000;

export function useXP() {
  const [state, setState] = useState<XPState>(() => {
    const xp = _cache?.xpTotal ?? 0;
    const nivel = _cache?.nivel ?? 1;
    return {
      xpTotal: xp,
      nivel,
      xpEnNivel: getXpInCurrentLevel(xp),
      xpParaSiguiente: getXpNeededForNextLevel(xp),
      progreso: getLevelProgress(xp),
      titulo: getLevelTitle(nivel),
      breakdown: _cache?.breakdown ?? {},
      cargando: !_cache,
    };
  });

  const tokenRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const getToken = useCallback(async (): Promise<string | null> => {
    if (tokenRef.current) return tokenRef.current;

    const { data } = await supabase.auth.getSession();
    tokenRef.current = data.session?.access_token ?? null;

    supabase.auth.onAuthStateChange((_e, session) => {
      tokenRef.current = session?.access_token ?? null;
    });

    return tokenRef.current;
  }, []);

  const actualizarEstado = useCallback((xpTotal: number, nivel: number, breakdown: Record<string, number>) => {
    if (!mountedRef.current) return;

    _cache = { xpTotal, nivel, breakdown, ts: Date.now() };

    setState({
      xpTotal,
      nivel,
      xpEnNivel: getXpInCurrentLevel(xpTotal),
      xpParaSiguiente: getXpNeededForNextLevel(xpTotal),
      progreso: getLevelProgress(xpTotal),
      titulo: getLevelTitle(nivel),
      breakdown,
      cargando: false,
    });
  }, []);

  const recargar = useCallback(async () => {
    if (_cache && Date.now() - _cache.ts < CACHE_TTL) {
      if (mountedRef.current) {
        setState(prev => ({ ...prev, cargando: false }));
      }
      return;
    }

    try {
      const token = await getToken();

      if (!token) {
        if (mountedRef.current) {
          setState(prev => ({ ...prev, cargando: false }));
        }
        return;
      }

      const res = await fetch('/api/xp', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        if (mountedRef.current) {
          setState(prev => ({ ...prev, cargando: false }));
        }
        return;
      }

      const data = await res.json();

      if (data.ok) {
        actualizarEstado(data.xp_total, data.nivel, data.xp_breakdown ?? {});
      }
    } catch {
    }

    if (mountedRef.current) {
      setState(prev => ({ ...prev, cargando: false }));
    }
  }, [getToken, actualizarEstado]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const marcarEstudioSiAplica = useCallback((fuente: FuenteXP) => {
    if (fuente === 'racha') return;
    registrarEstudioHoy().catch(() => {});
  }, []);

  const darXP = useCallback(async (fuente: FuenteXP, cantidad: number, meta?: any): Promise<XPResult> => {
    const nivelAnterior = state.nivel;
    const xpAnterior = state.xpTotal;

    if (cantidad <= 0) {
      return {
        xpGanado: 0,
        xpTotal: xpAnterior,
        nivelAnterior,
        nivelNuevo: nivelAnterior,
        subioNivel: false,
      };
    }

    const xpOptimista = xpAnterior + cantidad;
    const nivelOptimista = getLevelFromXp(xpOptimista);

    actualizarEstado(xpOptimista, nivelOptimista, {
      ...(state.breakdown),
      [fuente]: (state.breakdown[fuente] ?? 0) + cantidad,
    });

    try {
      const token = await getToken();

      if (!token) {
        marcarEstudioSiAplica(fuente);
        return {
          xpGanado: cantidad,
          xpTotal: xpOptimista,
          nivelAnterior,
          nivelNuevo: nivelOptimista,
          subioNivel: nivelOptimista > nivelAnterior,
        };
      }

      const res = await fetch('/api/xp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fuente, cantidad, meta }),
      });

      if (!res.ok) {
        actualizarEstado(xpAnterior, nivelAnterior, state.breakdown);
        return {
          xpGanado: 0,
          xpTotal: xpAnterior,
          nivelAnterior,
          nivelNuevo: nivelAnterior,
          subioNivel: false,
        };
      }

      const data = await res.json();

      if (!data.ok) {
        actualizarEstado(xpAnterior, nivelAnterior, state.breakdown);
        return {
          xpGanado: 0,
          xpTotal: xpAnterior,
          nivelAnterior,
          nivelNuevo: nivelAnterior,
          subioNivel: false,
        };
      }

      actualizarEstado(data.xp_total, data.nivel, {
        ...(state.breakdown),
        [fuente]: (state.breakdown[fuente] ?? 0) + data.xp_ganado,
      });

      marcarEstudioSiAplica(fuente);

      return {
        xpGanado: data.xp_ganado,
        xpTotal: data.xp_total,
        nivelAnterior,
        nivelNuevo: data.nivel,
        subioNivel: data.subio_nivel,
      };
    } catch {
      marcarEstudioSiAplica(fuente);
      return {
        xpGanado: cantidad,
        xpTotal: xpOptimista,
        nivelAnterior,
        nivelNuevo: nivelOptimista,
        subioNivel: nivelOptimista > nivelAnterior,
      };
    }
  }, [state, getToken, actualizarEstado, marcarEstudioSiAplica]);

  return { ...state, darXP, recargar };
}
