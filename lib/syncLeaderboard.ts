import { supabase } from './supabase';
import { getPerfil } from './storage';
import { verificarRacha } from './racha';
import { savePerfilDB } from './db';
import { calcularXpFlashcards, calcularXpDiario } from './xpSystem';
import { getObjetivos } from './agenda';

export const syncLeaderboard = async () => {
  try {
    let session = (await supabase.auth.getSession()).data.session;
    if (!session) {
      const { data } = await supabase.auth.refreshSession();
      session = data.session;
    }
    if (!session) return;

    const perfil = getPerfil();
    const racha  = verificarRacha();
    const nombre = session.user.user_metadata?.nombre || session.user.email?.split('@')[0] || 'Usuario';

    // ── Avatar ──────────────────────────────────────────────
    let avatarUrl: string | null = null;
    try {
      const s = JSON.parse(localStorage.getItem('josea_settings') || '{}');
      if (s.fotoPerfil) avatarUrl = s.fotoPerfil;
    } catch {}

    // ── Stats flashcards ────────────────────────────────────
    const totalAcertadas = Object.values(perfil.flashcardsAcertadas || {})
      .reduce((a: number, b: any) => a + (typeof b === 'number' ? b : 0), 0);
    const totalFalladas = Object.values(perfil.flashcardsFalladas || {})
      .reduce((a: number, b: any) => a + (typeof b === 'number' ? b : 0), 0);
    const totalEstudiadas = totalAcertadas + totalFalladas;
    const precision = totalEstudiadas > 0
      ? Math.round((totalAcertadas / totalEstudiadas) * 100) : 0;

    // ── Stats quizzes ───────────────────────────────────────
    const totalQuizzes = Object.values(perfil.materiasStats || {})
      .reduce((acc: number, m: any) => acc + (m.quizzes || 0), 0);
    const totalQuizPuntuacion = Object.values(perfil.materiasStats || {})
      .reduce((acc: number, m: any) => acc + (m.quizPuntuacion || 0), 0);

    // ── XP por fuente ───────────────────────────────────────
    const { total: xpFlashcards } = calcularXpFlashcards({
      tarjetasRevisadas: totalEstudiadas,
      correctas: totalAcertadas,
    });

    const xpQuizzes = (totalQuizzes * 35) + Math.round(totalQuizPuntuacion * 0.5);

    const { total: xpDiario } = calcularXpDiario({
      login: true,
      rachaActual: racha.rachaActual,
    });

    // ── XP de objetivos completados ─────────────────────────
    const objetivos = getObjetivos();
    const xpObjetivos = objetivos
      .filter(o => o.completado)
      .reduce((acc, o) => acc + (o.xp || 0), 0);

    const xpCalculado = xpFlashcards + xpQuizzes + xpDiario + xpObjetivos;

    // ── Nunca bajar el XP que ya está en Supabase ───────────
    let xpFinal        = xpCalculado;
    let flashcardsFinal = totalEstudiadas;
    let mejorRachaFinal = racha.mejorRacha;

    try {
      const { data: current } = await supabase
        .from('leaderboard')
        .select('xp_total, flashcards_estudiadas, mejor_racha')
        .eq('user_id', session.user.id)
        .single();
      if (current) {
        if (current.xp_total            > xpCalculado)    xpFinal         = current.xp_total;
        if (current.flashcards_estudiadas > totalEstudiadas) flashcardsFinal = current.flashcards_estudiadas;
        if (current.mejor_racha          > racha.mejorRacha) mejorRachaFinal = current.mejor_racha;
      }
    } catch {}

    // ── POST al leaderboard ─────────────────────────────────
    const body: any = {
      nombre,
      xp_total:              xpFinal,
      flashcards_estudiadas: flashcardsFinal,
      racha_actual:          racha.rachaActual,
      mejor_racha:           mejorRachaFinal,
      precision_global:      precision,
    };
    if (avatarUrl) body.avatar_url = avatarUrl;

    await fetch('/api/leaderboard', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    await savePerfilDB(session.user.id, perfil);

  } catch (err) {
    console.error('Leaderboard sync error:', err);
  }
};
