import { supabase } from './supabase';
import { getPerfil } from './storage';

export const syncLeaderboard = async () => {
  try {
    let session = (await supabase.auth.getSession()).data.session;
    if (!session) {
      const { data } = await supabase.auth.refreshSession();
      session = data.session;
    }
    if (!session) return;

    const perfil = getPerfil();

    const totalAcertadas = Object.values(perfil.flashcardsAcertadas || {}).reduce((a: number, b: any) => a + b, 0);
    const totalFalladas = Object.values(perfil.flashcardsFalladas || {}).reduce((a: number, b: any) => a + b, 0);
    const total = totalAcertadas + totalFalladas;
    const precision = total > 0 ? Math.round((totalAcertadas / total) * 100) : 0;

    // Calcular quizzes completados
    const quizzesTotales = Object.values(perfil.materiasStats || {}).reduce(
      (a: number, m: any) => a + (m.quizzes || 0), 0
    );

    const { data: current } = await supabase
      .from('leaderboard')
      .select('flashcards_estudiadas, mejor_racha, racha_actual')
      .eq('user_id', session.user.id)
      .single();

    // ✅ NUNCA bajar las flashcards — solo subir (acumulativo)
    const flashcardsActuales = current?.flashcards_estudiadas || 0;
    const flashcardsNuevas = Math.max(flashcardsActuales, total);

    // Racha: leer del localStorage
    let rachaActual = 0;
    let mejorRacha = current?.mejor_racha || 0;
    try {
      const rachaData = JSON.parse(localStorage.getItem('josea_racha') || '{}');
      rachaActual = rachaData.rachaActual || 0;
      mejorRacha = Math.max(mejorRacha, rachaData.mejorRacha || 0, rachaActual);
    } catch {}

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
