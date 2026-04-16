import { supabase } from './supabase';
import { getPerfil } from './storage';
import { verificarRacha } from './racha';
import { savePerfilDB } from './db';

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

    // ✅ Calcular stats reales
    const totalAcertadas = Object.values(perfil.flashcardsAcertadas || {}).reduce(
      (a: number, b: any) => a + (typeof b === 'number' ? b : 0), 0
    );
    const totalFalladas = Object.values(perfil.flashcardsFalladas || {}).reduce(
      (a: number, b: any) => a + (typeof b === 'number' ? b : 0), 0
    );
    const totalEstudiadas = totalAcertadas + totalFalladas;
    const precision = totalEstudiadas > 0 ? Math.round((totalAcertadas / totalEstudiadas) * 100) : 0;

    // ✅ XP real: acertadas valen más, quizzes dan bonus
    const totalQuizzes = Object.values(perfil.materiasStats || {}).reduce(
      (acc: number, m: any) => acc + (m.quizzes || 0), 0
    );
    const totalQuizPuntuacion = Object.values(perfil.materiasStats || {}).reduce(
      (acc: number, m: any) => acc + (m.quizPuntuacion || 0), 0
    );

    const xpTotal = (totalAcertadas * 10) + (totalFalladas * 2) + (totalQuizzes * 25) + Math.round(totalQuizPuntuacion * 5) + (racha.mejorRacha * 15);

    // ✅ Sync leaderboard
    await fetch('/api/leaderboard', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nombre,
        xp_total: xpTotal,
        flashcards_estudiadas: totalEstudiadas,
        racha_actual: racha.rachaActual,
        mejor_racha: racha.mejorRacha,
        precision_global: precision,
      }),
    });

    // ✅ También sync perfil a Supabase (para que no esté vacío)
    await savePerfilDB(session.user.id, perfil);

  } catch (err) {
    console.error('Leaderboard sync error:', err);
  }
};