import { useMemo } from 'react';
import {
  getLevelFromXp,
  getLevelProgress,
  getXpInCurrentLevel,
  getXpNeededForNextLevel,
  getLevelTitle,
} from '../lib/xpSystem';

export const useNivel = (xpTotal: number) => {
  return useMemo(() => {
    const nivel = getLevelFromXp(xpTotal);
    const progreso = getLevelProgress(xpTotal);
    const xpActual = getXpInCurrentLevel(xpTotal);
    const xpSiguiente = getXpNeededForNextLevel(xpTotal);
    const { titulo, color, emoji } = getLevelTitle(nivel);

    return {
      nivel,
      progreso,
      xpActual,
      xpSiguiente,
      titulo,
      color,
      emoji,
    };
  }, [xpTotal]);
};
