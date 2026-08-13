'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSession } from 'next-auth/react';
import { registrarEstudioHoy } from '../lib/racha';
import { awardXPEvent } from '../lib/xpClient';
import type { XPEventRequest } from '../lib/xpEvents';
import {
  getLevelProgress,
  getXpNeededForNextLevel,
  getXpInCurrentLevel,
  getLevelTitle,
} from '../lib/xpSystem';

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

  const mountedRef = useRef(true);
  const [authStatus, setAuthStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');

  useEffect(() => {
    let active = true;
    getSession().then(session => {
      if (active) setAuthStatus(session?.user ? 'authenticated' : 'unauthenticated');
    }).catch(() => {
      if (active) setAuthStatus('unauthenticated');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
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
      if (authStatus !== 'authenticated') {
        if (mountedRef.current) {
          setState(prev => ({ ...prev, cargando: false }));
        }
        return;
      }

      const res = await fetch('/api/xp', { credentials: 'same-origin' });

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
  }, [authStatus, actualizarEstado]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const marcarEstudioSiAplica = useCallback((action: XPEventRequest['action']) => {
    if (action === 'daily_streak' || action === 'daily_reward_claimed') return;
    registrarEstudioHoy().catch(() => {});
  }, []);

  const darXP = useCallback(async (event: XPEventRequest): Promise<XPResult> => {
    const nivelAnterior = state.nivel;
    const xpAnterior = state.xpTotal;

    try {
      if (authStatus !== 'authenticated') {
        return {
          xpGanado: 0,
          xpTotal: xpAnterior,
          nivelAnterior,
          nivelNuevo: nivelAnterior,
          subioNivel: false,
        };
      }
      const data = await awardXPEvent(event);
      if (!data.success) {
        return {
          xpGanado: 0,
          xpTotal: xpAnterior,
          nivelAnterior,
          nivelNuevo: nivelAnterior,
          subioNivel: false,
        };
      }
      actualizarEstado(data.totalXP, data.nivel, state.breakdown);
      marcarEstudioSiAplica(event.action);

      return {
        xpGanado: data.awardedXP,
        xpTotal: data.totalXP,
        nivelAnterior,
        nivelNuevo: data.nivel,
        subioNivel: data.subioNivel,
      };
    } catch {
      return {
        xpGanado: 0,
        xpTotal: xpAnterior,
        nivelAnterior,
        nivelNuevo: nivelAnterior,
        subioNivel: false,
      };
    }
  }, [state, authStatus, actualizarEstado, marcarEstudioSiAplica]);

  return { ...state, darXP, recargar };
}
