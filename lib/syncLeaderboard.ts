import { getPerfil } from './storage';
import { getRacha } from './racha';

export const syncLeaderboard = async () => {
  try {
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

    const currentRes = await fetch('/api/leaderboard', { cache: 'no-store', credentials: 'same-origin' });
    const currentData = await currentRes.json().catch(() => ({}));
    const sessionRes = await fetch('/api/auth/session', { cache: 'no-store' });
    const session = await sessionRes.json().catch(() => ({}));
    const userId = session?.user?.id;

    const current = (currentData?.data || []).find((x: any) => x.user_id === userId) || {};

    const flashcardsActuales = current?.flashcards_estudiadas || 0;
    const flashcardsNuevas = Math.max(flashcardsActuales, total);

    const rachaData = getRacha();
    const rachaActual = rachaData.rachaActual;
    const mejorRacha = Math.max(
      current?.mejor_racha || 0,
      rachaData.mejorRacha,
      rachaActual
    );

    await fetch('/api/leaderboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
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

