'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getPerfil } from '../lib/storage';
import { verificarRacha } from '../lib/racha';
import { useIdioma } from '../hooks/useIdioma';

interface LeaderEntry {
  nombre: string;
  xp_total: number;
  flashcards_estudiadas: number;
  racha_actual: number;
  mejor_racha: number;
  precision_global: number;
  updated_at: string;
}

export default function Leaderboard() {
  const [entries, setEntries] = useState<LeaderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const { idioma } = useIdioma();

  const syncMyStats = async () => {
    setSyncing(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      let session = sessionData.session;
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

      await cargarLeaderboard();
    } catch (err) {
      console.error(err);
    } finally {
      setSyncing(false);
    }
  };

  const cargarLeaderboard = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      if (data.success) {
        setEntries(data.data);

        // Encontrar mi posición
        const { data: sessionData } = await supabase.auth.getUser();
        if (sessionData.user) {
          const myName = sessionData.user.user_metadata?.nombre || sessionData.user.email?.split('@')[0];
          const myIdx = data.data.findIndex((e: LeaderEntry) => e.nombre === myName);
          if (myIdx >= 0) setMyRank(myIdx + 1);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarLeaderboard();
    syncMyStats();
  }, []);

  const getMedal = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  const getColor = (rank: number) => {
    if (rank === 1) return '#f5c842';
    if (rank === 2) return '#aaa';
    if (rank === 3) return '#cd7f32';
    return 'var(--text-faint)';
  };

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
      <div style={{ height: '4px', background: 'var(--gold)' }} />
      <div style={{ padding: '20px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h3 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 2px' }}>
              🏆 {idioma === 'en' ? 'Leaderboard' : 'Leaderboard'}
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>
              {idioma === 'en' ? 'Top students by XP' : 'Top estudiantes por XP'}
              {myRank && <span style={{ color: 'var(--gold)', marginLeft: '8px', fontWeight: 700 }}>· {idioma === 'en' ? 'Your rank' : 'Tu posición'}: #{myRank}</span>}
            </p>
          </div>
          <button onClick={syncMyStats} disabled={syncing}
            style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: syncing ? 'not-allowed' : 'pointer' }}>
            {syncing ? '⏳ ...' : '🔄 Sync'}
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <p style={{ color: 'var(--text-faint)', fontSize: '14px' }}>Cargando...</p>
          </div>
        ) : entries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{ fontSize: '40px', marginBottom: '8px' }}>🏆</div>
            <p style={{ color: 'var(--text-faint)', fontSize: '14px', margin: '0 0 12px' }}>
              {idioma === 'en' ? 'Be the first on the leaderboard!' : '¡Sé el primero en el leaderboard!'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {entries.map((entry, i) => {
              const rank = i + 1;
              const isMe = rank === myRank;
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '10px 14px', borderRadius: '12px',
                  background: isMe ? 'var(--gold-dim)' : rank <= 3 ? 'var(--bg-secondary)' : 'transparent',
                  border: isMe ? '2px solid var(--gold)' : rank <= 3 ? '1px solid var(--border-color)' : '1px solid transparent',
                  transition: 'all 0.2s',
                }}>
                  {/* Rank */}
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: rank <= 3 ? getColor(rank) + '20' : 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: rank <= 3 ? '18px' : '13px', fontWeight: 900, color: getColor(rank), flexShrink: 0 }}>
                    {getMedal(rank)}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <p style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.nombre}
                      </p>
                      {isMe && (
                        <span style={{ fontSize: '10px', background: 'var(--gold)', color: '#000', padding: '1px 6px', borderRadius: '4px', fontWeight: 800, flexShrink: 0 }}>
                          {idioma === 'en' ? 'YOU' : 'TÚ'}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '2px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>🎴 {entry.flashcards_estudiadas}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>🔥 {entry.racha_actual}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>🎯 {entry.precision_global}%</span>
                    </div>
                  </div>

                  {/* XP */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: '16px', fontWeight: 900, color: getColor(rank), margin: 0 }}>
                      {entry.xp_total}
                    </p>
                    <p style={{ fontSize: '10px', color: 'var(--text-faint)', margin: 0 }}>XP</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '12px 0 0', textAlign: 'center' }}>
          {idioma === 'en' ? 'Updates when you study flashcards' : 'Se actualiza cuando estudias flashcards'}
        </p>
      </div>
    </div>
  );
}