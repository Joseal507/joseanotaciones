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
  avatar_url?: string;
  carrera?: string;
  universidad?: string;
  tipo_estudiante?: string;
  genero?: string;
  fecha_registro?: string;
}

function formatFecha(fecha: string | undefined) {
  if (!fecha) return '';
  try {
    const d = new Date(fecha);
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${d.getDate()} ${meses[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return ''; }
}

function UserProfileModal({ entry, rank, onClose }: { entry: LeaderEntry; rank: number; onClose: () => void }) {
  const getMedal = (r: number) => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`;
  const getColor = (r: number) => r === 1 ? '#f5c842' : r === 2 ? '#aaaaaa' : r === 3 ? '#cd7f32' : 'var(--text-faint)';

  const generoLabel: Record<string, string> = {
    hombre: '👦 Hombre',
    mujer: '👧 Mujer',
    otro: '🌈 Otro',
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px', backdropFilter: 'blur(6px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '380px',
          background: 'var(--bg-card)',
          borderRadius: '24px',
          border: '1px solid var(--border-color)',
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header gradient */}
        <div style={{
          height: '80px',
          background: `linear-gradient(135deg, ${getColor(rank)}40, ${getColor(rank)}10)`,
          borderBottom: `2px solid ${getColor(rank)}30`,
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute', top: '12px', right: '16px',
            fontSize: '22px', fontWeight: 900,
          }}>
            {getMedal(rank)}
          </div>
          <button
            onClick={onClose}
            style={{
              position: 'absolute', top: '12px', left: '16px',
              background: 'rgba(0,0,0,0.3)', border: 'none',
              color: '#fff', width: '28px', height: '28px',
              borderRadius: '50%', cursor: 'pointer',
              fontSize: '14px', fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>

        {/* Avatar */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '-38px', marginBottom: '12px' }}>
          <div style={{
            width: '76px', height: '76px', borderRadius: '50%',
            border: `3px solid ${getColor(rank)}`,
            background: 'var(--bg-secondary)',
            overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '32px', fontWeight: 800, color: 'var(--text-primary)',
            boxShadow: `0 4px 20px ${getColor(rank)}40`,
          }}>
            {entry.avatar_url ? (
              <img src={entry.avatar_url} alt={entry.nombre} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              entry.nombre?.[0]?.toUpperCase() || '?'
            )}
          </div>
        </div>

        <div style={{ padding: '0 24px 24px' }}>
          {/* Nombre */}
          <h2 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 4px', textAlign: 'center' }}>
            {entry.nombre}
          </h2>

          {/* Info del perfil */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center', marginBottom: '20px' }}>
            {entry.carrera && (
              <p style={{ fontSize: '13px', color: getColor(rank), fontWeight: 700, margin: 0 }}>
                📚 {entry.carrera}
              </p>
            )}
            {entry.universidad && (
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                🏫 {entry.universidad}
              </p>
            )}
            {entry.genero && (
              <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>
                {generoLabel[entry.genero] || entry.genero}
              </p>
            )}
            {!entry.carrera && !entry.universidad && (
              <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>
                {entry.tipo_estudiante === 'universitario' ? '🎓 Universitario' : '🏫 Estudiante'}
              </p>
            )}
            {entry.fecha_registro && (
              <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '4px 0 0' }}>
                Miembro desde {formatFecha(entry.fecha_registro)}
              </p>
            )}
          </div>

          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '20px' }}>
            {[
              { label: 'XP', value: entry.xp_total, emoji: '⭐', color: '#f5c842' },
              { label: 'Flashcards', value: entry.flashcards_estudiadas, emoji: '🎴', color: '#f472b6' },
              { label: 'Racha', value: entry.racha_actual, emoji: '🔥', color: '#ef4444' },
              { label: 'Mejor racha', value: entry.mejor_racha, emoji: '🏆', color: '#f5c842' },
              { label: 'Precisión', value: `${entry.precision_global}%`, emoji: '🎯', color: '#38bdf8' },
              { label: 'Puesto', value: getMedal(rank), emoji: '', color: getColor(rank) },
            ].map((s, i) => (
              <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: '12px', padding: '10px 6px', textAlign: 'center' }}>
                <div style={{ fontSize: '14px', marginBottom: '2px' }}>{s.emoji}</div>
                <div style={{ fontSize: '16px', fontWeight: 900, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: '9px', color: 'var(--text-faint)', fontWeight: 600, marginTop: '2px' }}>{s.label}</div>
              </div>
            ))}
          </div>

          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '12px', borderRadius: '12px', border: 'none',
              background: getColor(rank), color: '#000',
              fontSize: '14px', fontWeight: 800, cursor: 'pointer',
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

  const cargarLeaderboard = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      if (data.success) {
        setEntries(data.data || []);
        const { data: sessionData } = await supabase.auth.getUser();
        if (sessionData.user) {
          const name = sessionData.user.user_metadata?.nombre || sessionData.user.email?.split('@')[0] || '';
          setMyName(name);
          const myIdx = (data.data || []).findIndex((e: LeaderEntry) =>
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
    } catch (err) { console.error(err); }
    finally { setSyncing(false); }
  };

  useEffect(() => {
    const init = async () => {
      await syncLeaderboard();
      await cargarLeaderboard();
    };
    init();
  }, []);

  const getMedal = (rank: number) => rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
  const getColor = (rank: number) => rank === 1 ? '#f5c842' : rank === 2 ? '#aaaaaa' : rank === 3 ? '#cd7f32' : 'var(--text-faint)';

  return (
    <>
      {selectedEntry && (
        <UserProfileModal
          entry={selectedEntry.entry}
          rank={selectedEntry.rank}
          onClose={() => setSelectedEntry(null)}
        />
      )}

      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <div style={{ height: '4px', background: 'var(--gold)' }} />
        <div style={{ padding: '20px' }}>

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
            <button onClick={handleSync} disabled={syncing}
              style={{ padding: '7px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 700, cursor: syncing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
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
                {idioma === 'en' ? 'Be the first!' : '¡Sé el primero!'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {entries.map((entry, i) => {
                const rank = i + 1;
                const isMe = entry.nombre.toLowerCase() === myName.toLowerCase();

                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '10px 14px', borderRadius: '12px',
                    background: isMe ? 'var(--gold-dim)' : rank <= 3 ? 'var(--bg-secondary)' : 'transparent',
                    border: isMe ? '2px solid var(--gold)' : rank <= 3 ? '1px solid var(--border-color)' : '1px solid transparent',
                    transition: 'all 0.2s',
                  }}>
                    {/* Rank */}
                    <div style={{
                      width: '30px', height: '30px', borderRadius: '8px',
                      background: rank <= 3 ? getColor(rank) + '20' : 'var(--bg-secondary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: rank <= 3 ? '15px' : '11px', fontWeight: 900,
                      color: getColor(rank), flexShrink: 0,
                    }}>
                      {getMedal(rank)}
                    </div>

                    {/* Avatar clickeable */}
                    <div
                      onClick={() => setSelectedEntry({ entry, rank })}
                      style={{
                        width: '38px', height: '38px', borderRadius: '50%',
                        background: 'var(--bg-secondary)',
                        border: `2px solid ${isMe ? 'var(--gold)' : getColor(rank)}`,
                        overflow: 'hidden',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)',
                        flexShrink: 0, cursor: 'pointer',
                        transition: 'transform 0.15s, box-shadow 0.15s',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.transform = 'scale(1.12)';
                        (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 12px ${getColor(rank)}40`;
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                      }}
                      title={`Ver perfil de ${entry.nombre}`}
                    >
                      {entry.avatar_url ? (
                        <img src={entry.avatar_url} alt={entry.nombre} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
                          <span style={{ fontSize: '9px', background: 'var(--gold)', color: '#000', padding: '1px 6px', borderRadius: '4px', fontWeight: 800, flexShrink: 0 }}>
                            TÚ
                          </span>
                        )}
                      </div>

                      {/* ✅ Carrera al lado del nombre */}
                      {entry.carrera && (
                        <p style={{
                          fontSize: '11px', color: getColor(rank), fontWeight: 600,
                          margin: '0 0 2px',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          📚 {entry.carrera}
                        </p>
                      )}

                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>🎴 {entry.flashcards_estudiadas}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>🔥 {entry.racha_actual}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>🎯 {entry.precision_global}%</span>
                        {/* ✅ Fecha de registro */}
                        {entry.fecha_registro && (
                          <span style={{ fontSize: '10px', color: 'var(--text-faint)', opacity: 0.6 }}>
                            · {formatFecha(entry.fecha_registro)}
                          </span>
                        )}
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
              ? 'Click on a profile picture to see details'
              : 'Toca una foto de perfil para ver detalles'}
          </p>
        </div>
      </div>
    </>
  );
}