'use client';

import { useCallback, useEffect } from 'react';
import type { MasteryEvent, ToolId } from '../lib/masteryEngine';

declare global {
  interface Window {
    __studyal_reportMasteryEvent?: (event: MasteryEvent) => void;
    __studyal_sessionKey?: string;
  }
}

export function useMasteryReporter() {
  const reportEvent = useCallback((
    tool: ToolId,
    data: {
      score?: number;
      correct?: boolean;
      confidence?: number;
      timeMs?: number;
      conceptsIdentified?: string[];
      conceptName?: string;
      explanationQuality?: number;
      coveragePercent?: number;
      mistakeTypes?: string[];
    }
  ) => {
    if (typeof window === 'undefined') return;

    const reporter = window.__studyal_reportMasteryEvent;
    const sessionKey = window.__studyal_sessionKey;

    if (!reporter || !sessionKey) {
      console.warn('Mastery Engine no está disponible');
      return;
    }

    const event: MasteryEvent = {
      tool,
      materialId: '', // se llena automáticamente
      sessionKey,
      timestamp: Date.now(),
      ...data,
    };

    reporter(event);
    console.log(
      '%c📈 Mastery Event',
      'background:#d6b26f;color:#000;padding:2px 6px;border-radius:4px;font-weight:900',
      tool,
      '| score:', data.score ?? '—',
      '| correct:', data.correct ?? '—',
      '| concepts:', data.conceptsIdentified?.length || 0,
      data.conceptsIdentified?.slice(0,3) || []
    );
  }, []);

  return { reportEvent };
}

// Helper para usar en cualquier componente
export function reportMasteryEvent(event: Partial<MasteryEvent>) {
  if (typeof window === 'undefined') return;
  const reporter = window.__studyal_reportMasteryEvent;
  if (reporter && event.tool) {
    reporter(event as MasteryEvent);
  }
}
