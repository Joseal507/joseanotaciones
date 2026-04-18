'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { syncLeaderboard } from '../lib/syncLeaderboard';
import { useIdioma } from '../hooks/useIdioma';

interface LeaderEntry {
  user_id: string;
  nombre: string;
  xp_total: number;
  flashcards_estudiadas: number;
  racha_actual: number;
  mejor_racha: number;
  precision_global: number;
  updated_at: string;
  // Del perfil
  avatar_url?: string;
  carrera?: string;
  universidad?: string;
  tipo_estudiante?: string;
}

interface UserProfileModalProps {
  entry: LeaderEntry;
  rank: number;
  onClose: () => void;
  temaColor: string;
}

function UserProfileModal({ entry, rank, onClose, temaColor }: UserProfileModalProps) {
  const getMedal = (r: number) => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px', backdropFilter: 'blur(6px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '360px',
          background: 'var(--bg-card)',
          borderRadius: '24px',
          border: '1px solid var(--border-color)',
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header con color */}
        <div style={{
          height: '80px',
          background: `linear-gradient(135deg, ${temaColor}40, ${temaColor}15)`,
          borderBottom: `2px solid ${temaColor}30`,
          display: 'flex', alignItems: 'flex-end',
          padding: '0 24px 0',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute', top: '12px', right: '12px',
            fontSize: '20px', fontWeight: 900,
            color: temaColor,
          }}>
            {getMedal(rank)}
          </div>
        </div>

        {/* Avatar */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '-36px', marginBottom: '12px' }}>
          <div style={{
            width: '72px', height: '72px',
            borderRadius: '50%',
            border: `3px solid ${temaColor}`,
            background: 'var(--bg-secondary)',
            overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '30px',
            boxShadow: `0 4px 20px ${temaColor}40`,
          }}>
            {entry.avatar_url ? (
              <img src={entry.avatar_url} alt={entry.nombre}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              entry.nombre?.[0]?.toUpperCase() || '?'
            )}
          </div>
        </div>

        <div style={{ padding: '0 24px 24px' }}>
          {/* Nombre */}
          <h2 style={{
            fontSize: '20px', fontWeight: 900,
            color: 'var(--text-primary)', margin: '0 0 4px',
            textAlign: 'center',
          }}>
            {entry.nombre}
          </h2>

          {/* Carrera */}
          {entry.carrera && (
            <p style={{
              fontSize: '13px', color: temaColor,
              fontWeight: 700, margin: '0 0 4px',
              textAlign: 'center',
            }}>
              📚 {entry.carrera}
            </p>
          )}
          {entry.universidad && (
            <p style={{
              fontSize: '12px', color: 'var(--text-faint)',
              margin: '0 0 20px', textAlign: 'center',
            }}>
              🏫 {entry.universidad}
            </p>
          )}
          {!entry.carrera && !entry.universidad && (
            <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: '0 0 20px', textAlign: 'center' }}>
              {entry.tipo_estudiante === 'universitario' ? '🎓 Universitario' : '🏫 Estudiante'}
            </p>
          )}

          {/* Stats */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '8px', marginBottom: '20px',
          }}>
            {[
              { label: 'XP', value: entry.xp_total, emoji: '⭐' },
              { label: 'Flashcards', value: entry.flashcards_estudiadas, emoji: '🎴' },
              { label: 'Racha', value: entry.racha_actual, emoji: '🔥' },
              { label: 'Mejor racha', value: entry.mejor_racha, emoji: '🏆' },
              { label: 'Precisión', value: `${entry.precision_global}%`, emoji: '🎯' },
              { label: 'Puesto', value: getMedal(rank), emoji: '' },
            ].map((s, i) => (
              <div key={i} style={{
                background: 'var(--bg-secondary)',
                borderRadius: '12px', padding: '10px 8px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '16px', marginBottom: '2px' }}>{s.emoji}</div>
                <div style={{ fontSize: '15px', fontWeight: 900, color: temaColor }}>{s.value}</div>
                <div style={{ fontSize: '9px', color: 'var(--text-faint)', fontWeight: 600 }}>{s.label}</div>
              </div>
            ))}
          </div>

          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '12px',
              borderRadius: '12px', border: 'none',
              background: temaColor, color: '#000',
              fontSize: '14px', fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Leaderboard() {
  const [entries, setEntries] = useState<LeaderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [myName, setMyName] = useState('');
  const [myRank, setMyRank] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<{ entry: LeaderEntry; rank: number } | null>(null);
  const { idioma } = useIdioma();

  const TEMA_COLOR = '#f5c842';

  const cargarLeaderboard = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();

      if (data.success) {
        let leaderData: LeaderEntry[] = data.data;

        // Cargar perfiles de usuario para foto y carrera
        try {
          const profileRes = await fetch('/api/user-profile-bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: leaderData.map((e: any) => e.user_id).filter(Boolean) }),
          });

          if (profileRes.ok) {
            const profileData = await profileRes.json();
            const profileMap: Record<string, any> = {};
            (profileData.data || []).forEach((p: any) => {
              profileMap[p.id] = p;
            });

            leaderData = leaderData.map(e => ({
              ...e,
              avatar_url: profileMap[e.user_id]?.avatar_url || null,
              carrera: profileMap[e.user_id]?.carrera || null,
              universidad: profileMap[e.user_id]?.universidad || null,
              tipo_estudiante: profileMap[e.user_id]?.tipo_estudiante || null,
            }));
          }
        } catch {}

        setEntries(leaderData);

        const { data: sessionData } = await supabase.auth.getUser();
        if (sessionData.user) {
          const name = sessionData.user.user_metadata?.nombre || sessionData.user.email?.split('@')[0] || '';
          setMyName(name);
          const myIdx = leaderData.findIndex((e: LeaderEntry) =>
            e.nombre.toLowerCase() === name.toLowerCase()
          );
          if (myIdx >= 0) setMyRank(myIdx + 1);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncLeaderboard();
      await cargarLeaderboard();
    } catch (err) {
      console.error(err);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      await syncLeaderboard();
      await cargarLeaderboard();
    };
    init();
  }, []);

  const getMedal = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  const getColor = (rank: number) => {
    if (rank === 1) return '#f5c842';
    if (rank === 2) return '#aaaaaa';
    if (rank === 3) return '#cd7f32';
    return 'var(--text-faint)';
  };

  return (
    <>
      {selectedEntry && (
        <UserProfileModal
          entry={selectedEntry.entry}
          rank={selectedEntry.rank}
          onClose={() => setSelectedEntry(null)}
          temaColor={TEMA_COLOR}
        />
      )}

      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <div style={{ height: '4px', background: 'var(--gold)' }} />
        <div style={{ padding: '20px' }}>

          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <h3 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 2px' }}>
                🏆 Leaderboard
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>
                {idioma === 'en' ? 'Top students by XP' : 'Top estudiantes por XP'}
                {myRank && (
                  <span style={{ color: 'var(--gold)', marginLeft: '8px', fontWeight: 700 }}>
                    · {idioma === 'en' ? 'Your rank' : 'Tu posición'}: #{myRank}
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={handleSync}
              disabled={syncing}
              style={{
                padding: '7px 14px', borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'transparent', color: 'var(--text-muted)',
                fontSize: '12px', fontWeight: 700,
                cursor: syncing ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              {syncing ? '⏳ ...' : '🔄 Sync'}
            </button>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px 0' }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>⏳</div>
              <p style={{ color: 'var(--text-faint)', fontSize: '14px', margin: 0 }}>
                {idioma === 'en' ? 'Loading...' : 'Cargando...'}
              </p>
            </div>
          ) : entries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0' }}>
              <div style={{ fontSize: '40px', marginBottom: '8px' }}>🏆</div>
              <p style={{ color: 'var(--text-faint)', fontSize: '14px', margin: '0 0 4px' }}>
                {idioma === 'en' ? 'Be the first on the leaderboard!' : '¡Sé el primero en el leaderboard!'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {entries.map((entry, i) => {
                const rank = i + 1;
                const isMe = entry.nombre.toLowerCase() === myName.toLowerCase();

                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '10px 14px', borderRadius: '12px',
                      background: isMe ? 'var(--gold-dim)' : rank <= 3 ? 'var(--bg-secondary)' : 'transparent',
                      border: isMe ? '2px solid var(--gold)' : rank <= 3 ? '1px solid var(--border-color)' : '1px solid transparent',
                      transition: 'all 0.2s',
                    }}
                  >
                    {/* Rank */}
                    <div style={{
                      width: '32px', height: '32px', borderRadius: '10px',
                      background: rank <= 3 ? getColor(rank) + '20' : 'var(--bg-secondary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: rank <= 3 ? '16px' : '12px', fontWeight: 900,
                      color: getColor(rank), flexShrink: 0,
                    }}>
                      {getMedal(rank)}
                    </div>

                    {/* Avatar clickeable */}
                    <div
                      onClick={() => setSelectedEntry({ entry, rank })}
                      style={{
                        width: '38px', height: '38px',
                        borderRadius: '50%',
                        background: 'var(--bg-secondary)',
                        border: `2px solid ${isMe ? 'var(--gold)' : getColor(rank)}`,
                        overflow: 'hidden',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '16px', fontWeight: 800,
                        color: 'var(--text-primary)',
                        flexShrink: 0,
                        cursor: 'pointer',
                        transition: 'transform 0.15s, box-shadow 0.15s',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.transform = 'scale(1.1)';
                        (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 12px ${getColor(rank)}40`;
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                      }}
                      title={`Ver perfil de ${entry.nombre}`}
                    >
                      {entry.avatar_url ? (
                        <img
                          src={entry.avatar_url}
                          alt={entry.nombre}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <span>{entry.nombre?.[0]?.toUpperCase() || '?'}</span>
                      )}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '1px' }}>
                        <p style={{
                          fontSize: '14px', fontWeight: 800,
                          color: 'var(--text-primary)', margin: 0,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {entry.nombre}
                        </p>
                        {isMe && (
                          <span style={{
                            fontSize: '10px', background: 'var(--gold)',
                            color: '#000', padding: '1px 6px',
                            borderRadius: '4px', fontWeight: 800, flexShrink: 0,
                          }}>
                            {idioma === 'en' ? 'YOU' : 'TÚ'}
                          </span>
                        )}
                      </div>

                      {/* Carrera */}
                      {entry.carrera && (
                        <p style={{
                          fontSize: '11px', color: TEMA_COLOR,
                          margin: '0 0 2px', fontWeight: 600,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {entry.carrera}
                        </p>
                      )}

                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>🎴 {entry.flashcards_estudiadas}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>🔥 {entry.racha_actual}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>🎯 {entry.precision_global}%</span>
                      </div>
                    </div>

                    {/* XP */}
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <p style={{ fontSize: '18px', fontWeight: 900, color: getColor(rank), margin: 0 }}>
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
            {idioma === 'en'
              ? 'Click on a profile picture to see more details'
              : 'Toca una foto de perfil para ver más detalles'}
          </p>
        </div>
      </div>
    </>
  );
}