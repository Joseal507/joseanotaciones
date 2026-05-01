import { supabase } from './supabase';
import { getPerfil } from './storage';
import { getRacha } from './racha';

export const syncLeaderboard = async () => {
  try {
    let session = (await supabase.auth.getSession()).data.session;
    if (!session) {
      const { data } = await supabase.auth.refreshSession();
      session = data.session;
    }
    if (!session) return;

    const perfil = getPerfil();

    const totalAcertadas = Object.values(perfil.flashcardsAcertadas || {}).reduce(
      (a: number, b: any) => a + b, 0
    );
    const totalFalladas = Object.values(perfil.flashcardsFalladas || {}).reduce(
      (a: number, b: any) => a + b, 0
    );
    const total = totalAcertadas + totalFalladas;
    const precision = total > 0 ? Math.round((totalAcertadas / total) * 100) : 0;

    const quizzesTotales = Object.values(perfil.materiasStats || {}).reduce(
      (a: number, m: any) => a + (m.quizzes || 0), 0
    );

    const { data: current } = await supabase
      .from('leaderboard')
      .select('flashcards_estudiadas, mejor_racha')
      .eq('user_id', session.user.id)
      .single();

    // ✅ flashcards NUNCA bajan
    const flashcardsActuales = current?.flashcards_estudiadas || 0;
    const flashcardsNuevas = Math.max(flashcardsActuales, total);

    // ✅ Racha desde lib/racha (no hardcodeado desde localStorage)
    const rachaData = getRacha();
    const rachaActual = rachaData.rachaActual;
    const mejorRacha = Math.max(
      current?.mejor_racha || 0,
      rachaData.mejorRacha,
      rachaActual
    );

    await fetch('/api/leaderboard', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        flashcards_estudiadas: flashcardsNuevas,
        precision_global: precision,
        racha_actual: rachaActual,
        mejor_racha: mejorRacha,
        quizzes_completados: quizzesTotales,
      }),
    });
  } catch (err) {
    console.error('syncLeaderboard error:', err);
  }
};
