/**
 * syncLeaderboard.ts
 * Solo sincroniza stats de actividad (flashcards, racha, precisión).
 * El XP se maneja ÚNICAMENTE en /api/xp — nunca se recalcula aquí.
 */
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

    const perfil  = getPerfil();
    const racha   = verificarRacha();
    const nombre  = session.user.user_metadata?.nombre
      || session.user.email?.split('@')[0]
      || 'Usuario';

    // Avatar desde settings
    let avatarUrl: string | null = null;
    try {
      const s = JSON.parse(localStorage.getItem('josea_settings') || '{}');
      if (s.fotoPerfil) avatarUrl = s.fotoPerfil;
    } catch {}

    // Stats flashcards desde localStorage
    const totalAcertadas = Object.values(perfil.flashcardsAcertadas || {})
      .reduce((a: number, b: any) => a + (typeof b === 'number' ? b : 0), 0);
    const totalFalladas = Object.values(perfil.flashcardsFalladas || {})
      .reduce((a: number, b: any) => a + (typeof b === 'number' ? b : 0), 0);
    const totalEstudiadas = totalAcertadas + totalFalladas;
    const precision = totalEstudiadas > 0
      ? Math.round((totalAcertadas / totalEstudiadas) * 100) : 0;

    // Leer valores actuales en Supabase para nunca bajar nada
    const { data: current } = await supabase
      .from('leaderboard')
      .select('xp_total, mejor_racha, flashcards_estudiadas, nivel')
      .eq('user_id', session.user.id)
      .single();

    const body: Record<string, any> = {
      nombre,
      // Stats que SÍ sincronizamos desde local
      flashcards_estudiadas: Math.max(totalEstudiadas, current?.flashcards_estudiadas ?? 0),
      racha_actual:          racha.rachaActual,
      mejor_racha:           Math.max(racha.mejorRacha, current?.mejor_racha ?? 0),
      precision_global:      precision,
      // XP y nivel NUNCA los tocamos — son responsabilidad de /api/xp
    };

    if (avatarUrl) body.avatar_url = avatarUrl;

    await fetch('/api/leaderboard', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    await savePerfilDB(session.user.id, perfil);
  } catch (err) {
    console.error('Leaderboard sync error:', err);
  }
};
