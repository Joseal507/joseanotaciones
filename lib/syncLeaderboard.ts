import { supabase } from './supabase';
import { getPerfil } from './storage';
import { verificarRacha } from './racha';

export const syncLeaderboard = async () => {
  try {
    let session = (await supabase.auth.getSession()).data.session;
    if (!session) {
      const { data } = await supabase.auth.refreshSession();
      session = data.session;
    }
    if (!session) return;

    const perfil = getPerfil();
    const racha = verificarRacha();
    const nombre = session.user.user_metadata?.nombre || session.user.email?.split('@')[0] || 'Usuario';

    const totalAcertadas = Object.values(perfil.flashcardsAcertadas || {}).reduce((a: number, b: any) => a + b, 0);
    const totalFalladas = Object.values(perfil.flashcardsFalladas || {}).reduce((a: number, b: any) => a + b, 0);
    const total = totalAcertadas + totalFalladas;
    const precision = total > 0 ? Math.round((totalAcertadas / total) * 100) : 0;
    const xpTotal = Object.values(perfil.materiasStats || {}).reduce((acc: number, m: any) => acc + m.totalFlashcards, 0);

    await fetch('/api/leaderboard', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nombre,
        xp_total: xpTotal,
        flashcards_estudiadas: total,
        racha_actual: racha.rachaActual,
        mejor_racha: racha.mejorRacha,
        precision_global: precision,
      }),
    });
  } catch (err) {
    console.error('Leaderboard sync error:', err);
  }
};