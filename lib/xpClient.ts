import { registrarXpDiario } from './xpDiario';
import type { XPEventRequest, XPEventResult } from './xpEvents';

export async function awardXPEvent(event: XPEventRequest): Promise<XPEventResult> {
  try {
    const res = await fetch('/api/xp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(event),
    });

    if (!res.ok) return { success: false, applied: false, eventId: event.eventId, awardedXP: 0, totalXP: 0, nivel: 1, subioNivel: false };

    const data = await res.json();
    const xpGanado = data.awardedXP ?? 0;

    if (xpGanado > 0) {
      registrarXpDiario(xpGanado);
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('xp:ganada', { detail: { xp: xpGanado } }));
        }
      } catch {}
    }

    return {
      success: data.success ?? false,
      applied: data.applied ?? false,
      eventId: data.eventId ?? event.eventId,
      awardedXP: xpGanado,
      totalXP: data.totalXP ?? 0,
      nivel: data.nivel ?? 1,
      subioNivel: data.subioNivel ?? false,
    };
  } catch {
    return { success: false, applied: false, eventId: event.eventId, awardedXP: 0, totalXP: 0, nivel: 1, subioNivel: false };
  }
}
