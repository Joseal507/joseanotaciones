import { supabase } from './supabase';

export type FuenteXP = 'timer' | 'flashcards' | 'quiz' | 'post' | 'objetivo' | 'login' | 'racha' | 'comunidad';

export async function darXP(
  fuente: FuenteXP,
  cantidad: number,
  meta?: Record<string, any>
): Promise<{ ok: boolean; xpGanado: number; xpTotal: number; nivel: number; subioNivel: boolean }> {
  try {
    if (cantidad === 0) return { ok: false, xpGanado: 0, xpTotal: 0, nivel: 1, subioNivel: false };

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return { ok: false, xpGanado: 0, xpTotal: 0, nivel: 1, subioNivel: false };

    const res = await fetch('/api/xp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fuente, cantidad, meta }),
    });

    if (!res.ok) return { ok: false, xpGanado: 0, xpTotal: 0, nivel: 1, subioNivel: false };

    const data = await res.json();
    return {
      ok: data.ok ?? false,
      xpGanado: data.xp_ganado ?? 0,
      xpTotal: data.xp_total ?? 0,
      nivel: data.nivel ?? 1,
      subioNivel: data.subio_nivel ?? false,
    };
  } catch {
    return { ok: false, xpGanado: 0, xpTotal: 0, nivel: 1, subioNivel: false };
  }
}
