import { registrarXpDiario } from './xpDiario';

export type FuenteXP = 'timer' | 'flashcards' | 'quiz' | 'post' | 'objetivo' | 'login' | 'racha' | 'comunidad' | 'daily_reward';

export async function darXP(
  fuente: FuenteXP,
  cantidad: number,
  meta?: Record<string, any>
): Promise<{ ok: boolean; xpGanado: number; xpTotal: number; nivel: number; subioNivel: boolean }> {
  try {
    if (cantidad === 0) return { ok: false, xpGanado: 0, xpTotal: 0, nivel: 1, subioNivel: false };

    const res = await fetch('/api/xp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ fuente, cantidad, meta }),
    });

    if (!res.ok) return { ok: false, xpGanado: 0, xpTotal: 0, nivel: 1, subioNivel: false };

    const data = await res.json();
    const xpGanado = data.xp_ganado ?? 0;

    if (xpGanado > 0) {
      registrarXpDiario(xpGanado);
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('xp:ganada', { detail: { xp: xpGanado } }));
        }
      } catch {}
    }

    return {
      ok: data.ok ?? false,
      xpGanado,
      xpTotal: data.xp_total ?? 0,
      nivel: data.nivel ?? 1,
      subioNivel: data.subio_nivel ?? false,
    };
  } catch {
    return { ok: false, xpGanado: 0, xpTotal: 0, nivel: 1, subioNivel: false };
  }
}

