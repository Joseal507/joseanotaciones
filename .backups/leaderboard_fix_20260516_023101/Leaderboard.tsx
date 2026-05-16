'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { syncLeaderboard } from '../lib/syncLeaderboard';
import { useIdioma } from '../hooks/useIdioma';

const HAND = "'Caveat',cursive";

interface LeaderEntry {
  user_id: string;
  nombre: string;
  xp_total: number;
  flashcards_estudiadas: number;
  racha_actual: number;
  mejor_racha: number;
  precision_global: number;
  updated_at: string;
  created_at?: string;
  avatar_url?: string;
  carrera?: string;
  universidad?: string;
  tipo_estudiante?: string;
  genero?: string;
  onboarding_completo?: boolean;
}

function formatFecha(fecha: string | undefined) {
  if (!fecha) return '';
  try {
    const d = new Date(fecha);
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${d.getDate()} ${meses[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return ''; }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL PERFIL
// ═══════════════════════════════════════════════════════════════════════════
function UserProfileModal({ entry, rank, onClose }: { entry: LeaderEntry; rank: number; onClose: () => void }) {
  const getMedal = (r: number) => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`;
  const getColor = (r: number) => r === 1 ? '#f5c842' : r === 2 ? '#aaaaaa' : r === 3 ? '#cd7f32' : '#94a3b8';

  const generoLabel: Record<string, string> = {
    hombre: '👦 Hombre',
    mujer: '👧 Mujer',
    otro: '🌈 Otro / No especificado',
  };

  const color = getColor(rank);

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(0,0,0,0.78)',
      backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      animation: 'lbFade 0.25s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 400,
        background: 'var(--bg-card)',
        border: '2.5px solid var(--text-primary)',
        borderRadius: 16,
        boxShadow: `6px 7px 0 ${color}, 0 16px 50px rgba(0,0,0,0.45)`,
        overflow: 'hidden',
        transform: 'rotate(-0.5deg)',
        position: 'relative',
        animation: 'lbPop 0.4s cubic-bezier(.34,1.4,.64,1)',
      }}>
        {/* Cinta scotch */}
        <div style={{
          position: 'absolute', top: -10, left: '50%',
          transform: 'translateX(-50%) rotate(-4deg)',
          width: 90, height: 18,
          background: `color-mix(in srgb,${color} 55%,transparent)`,
          border: `1px solid color-mix(in srgb,${color} 30%,transparent)`,
          boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
          zIndex: 5,
        }}/>

        {/* Header con medalla */}
        <div style={{
          height: 90,
          background: `linear-gradient(135deg, ${color} 0%, color-mix(in srgb,${color} 50%,var(--bg-card)) 100%)`,
          borderBottom: '2px solid var(--text-primary)',
          position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{
            fontSize: 44,
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
            transform: 'rotate(-5deg)', display: 'inline-block',
          }}>{getMedal(rank)}</span>
          <button onClick={onClose} style={{
            position: 'absolute', top: 12, right: 14,
            background: 'rgba(0,0,0,0.4)',
            border: '2px solid var(--text-primary)',
            color: '#fff',
            width: 30, height: 30, borderRadius: 8,
            cursor: 'pointer',
            fontFamily: HAND, fontSize: 17, fontWeight: 900,
            boxShadow: '2px 2px 0 var(--text-primary)',
            transform: 'rotate(3deg)',
          }}>✕</button>
        </div>

        {/* Avatar polaroid */}
        <div style={{
          display: 'flex', justifyContent: 'center',
          marginTop: -40, marginBottom: 12,
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            border: '3px solid var(--text-primary)',
            background: 'var(--bg-secondary)',
            boxShadow: `3px 4px 0 ${color}`,
            overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: HAND, fontSize: 34, fontWeight: 900, color: 'var(--text-primary)',
            transform: 'rotate(-4deg)',
            position: 'relative', zIndex: 2,
          }}>
            {entry.avatar_url ? (
              <img
                src={`${entry.avatar_url}${entry.avatar_url.includes('?') ? '&' : '?'}v=${encodeURIComponent(entry.updated_at || entry.created_at || Date.now())}`}
                alt={entry.nombre}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e: any) => {
                  e.currentTarget.style.display = 'none';
                  const fallback = e.currentTarget.parentElement?.querySelector('[data-avatar-fallback]');
                  if (fallback) (fallback as HTMLElement).style.display = 'flex';
                }}
              />
            ) : null}
            <span data-avatar-fallback="true" style={{
              display: entry.avatar_url ? 'none' : 'flex',
              width: '100%', height: '100%',
              alignItems: 'center', justifyContent: 'center',
            }}>
              {entry.nombre?.[0]?.toUpperCase() || '?'}
            </span>
          </div>
        </div>

        <div style={{ padding: '0 24px 24px' }}>
          {/* Nombre */}
          <h2 style={{
            fontFamily: HAND, fontSize: 30, fontWeight: 900,
            color: 'var(--text-primary)', margin: '0 0 14px',
            textAlign: 'center', lineHeight: 1.05,
            transform: 'rotate(-1deg)',
          }}>
            {entry.nombre}
          </h2>

          {/* Datos personales */}
          <div style={{
            background: 'var(--bg-secondary)',
            border: '2px dashed var(--border-color)',
            borderRadius: 12,
            padding: '14px 16px',
            marginBottom: 14,
            display: 'flex', flexDirection: 'column', gap: 10,
            transform: 'rotate(-0.4deg)',
          }}>
            {entry.genero && (
              <InfoRow emoji="⚧" label="Género" value={generoLabel[entry.genero] || entry.genero} color="var(--text-primary)" />
            )}
            {entry.tipo_estudiante && (
              <InfoRow
                emoji={entry.tipo_estudiante === 'universitario' ? '🎓' : '🏫'}
                label="Tipo"
                value={entry.tipo_estudiante === 'universitario' ? 'Universitario' : 'Bachillerato / Secundaria'}
                color="var(--text-primary)"
              />
            )}
            {entry.carrera && <InfoRow emoji="📚" label="Carrera" value={entry.carrera} color={color} />}
            {entry.universidad && <InfoRow emoji="🏫" label="Universidad" value={entry.universidad} color="var(--text-primary)" />}
            {entry.created_at && <InfoRow emoji="📅" label="Se registró" value={formatFecha(entry.created_at)} color="var(--text-primary)" />}
          </div>

          {/* Stats grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 8, marginBottom: 16,
          }}>
            {[
              { label: 'XP',         value: entry.xp_total,                    emoji: '⭐', color: '#f5c842', rot: -1.5 },
              { label: 'Flashcards', value: entry.flashcards_estudiadas,       emoji: '🎴', color: '#f472b6', rot: 1.5 },
              { label: 'Racha',      value: entry.racha_actual,                emoji: '🔥', color: '#ef4444', rot: -1 },
              { label: 'Mejor',      value: entry.mejor_racha,                 emoji: '🏆', color: '#f5c842', rot: 1 },
              { label: 'Precisión',  value: `${entry.precision_global}%`,      emoji: '🎯', color: '#38bdf8', rot: -1.5 },
              { label: 'Puesto',     value: getMedal(rank),                    emoji: '',   color, rot: 1.5 },
            ].map((s, i) => (
              <div key={i} style={{
                background: 'var(--bg-secondary)',
                border: `2px dashed ${s.color}`,
                borderRadius: 10,
                padding: '8px 4px',
                textAlign: 'center',
                transform: `rotate(${s.rot}deg)`,
                transition: 'transform 0.2s',
              }}
                onMouseEnter={(e:any)=>e.currentTarget.style.transform='rotate(0deg) scale(1.05)'}
                onMouseLeave={(e:any)=>e.currentTarget.style.transform=`rotate(${s.rot}deg)`}
              >
                {s.emoji && <div style={{ fontSize: 14, marginBottom: 1 }}>{s.emoji}</div>}
                <div style={{
                  fontFamily: HAND, fontSize: 19, fontWeight: 900,
                  color: s.color, lineHeight: 1,
                }}>{s.value}</div>
                <div style={{
                  fontFamily: HAND, fontSize: 11, fontStyle: 'italic',
                  color: 'var(--text-faint)',
                }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Acciones */}
          <div style={{
            display: 'flex', gap: 10,
            paddingTop: 12,
            borderTop: '1.5px dashed var(--border-color)',
          }}>
            <button onClick={() => window.location.href = '/u/' + entry.user_id}
              style={{
                flex: 1, padding: 12,
                borderRadius: 12,
                border: '2.5px solid var(--text-primary)',
                background: color, color: '#000',
                fontFamily: HAND, fontSize: 19, fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '3px 4px 0 var(--text-primary)',
                transform: 'rotate(-1deg)',
                transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
              }}
              onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';e.currentTarget.style.boxShadow='4px 6px 0 var(--text-primary)';}}
              onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-1deg)';e.currentTarget.style.boxShadow='3px 4px 0 var(--text-primary)';}}
            >
              🌐 Ver Perfil
            </button>
            <button onClick={onClose}
              style={{
                padding: '12px 18px',
                borderRadius: 12,
                border: '2.5px dashed var(--text-faint)',
                background: 'transparent', color: 'var(--text-muted)',
                fontFamily: HAND, fontSize: 19, fontWeight: 800,
                cursor: 'pointer',
                transform: 'rotate(1deg)',
              }}>
              ✕
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes lbFade { from{opacity:0} to{opacity:1} }
        @keyframes lbPop {
          0% { transform: rotate(0deg) scale(0.85); opacity: 0; }
          60% { transform: rotate(-0.5deg) scale(1.02); opacity: 1; }
          100% { transform: rotate(-0.5deg) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function InfoRow({ emoji, label, value, color }: { emoji: string; label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 18 }}>{emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: HAND, fontSize: 12, fontWeight: 700,
          color: 'var(--text-faint)', fontStyle: 'italic',
          textTransform: 'uppercase', letterSpacing: 0.5,
        }}>{label}</div>
        <div style={{
          fontFamily: HAND, fontSize: 17, fontWeight: 800,
          color, lineHeight: 1.1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{value}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LEADERBOARD PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════
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
          const name = sessionData.user.user_metadata?.nombre
            || sessionData.user.email?.split('@')[0] || '';
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

      <div style={{
        background: 'var(--bg-card)',
        border: '2.5px solid var(--text-primary)',
        borderRadius: 14,
        boxShadow: '4px 5px 0 var(--gold)',
        transform: 'rotate(-0.3deg)',
        overflow: 'hidden',
      }}>
        {/* Banda título */}
        <div style={{
          background: 'var(--gold)',
          padding: '10px 22px',
          borderBottom: '2px solid var(--text-primary)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 12, flexWrap: 'wrap',
        }}>
          <div>
            <h3 style={{
              fontFamily: HAND, fontSize: 26, fontWeight: 900,
              color: '#000', margin: 0, lineHeight: 1,
              fontStyle: 'italic',
              transform: 'rotate(-0.8deg)', display: 'inline-block',
            }}>
              🏆 Leaderboard
            </h3>
            <p style={{
              fontFamily: HAND, fontSize: 14, fontStyle: 'italic',
              color: 'rgba(0,0,0,0.75)',
              margin: '2px 0 0',
            }}>
              ~ {idioma === 'en' ? 'Top students by XP' : 'top estudiantes por XP'}
              {myRank && (
                <span style={{ fontWeight: 800, marginLeft: 6 }}>
                  · tu posición: #{myRank}
                </span>
              )} ~
            </p>
          </div>
          <button onClick={handleSync} disabled={syncing}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: '2px solid var(--text-primary)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontFamily: HAND, fontSize: 16, fontWeight: 800,
              cursor: syncing ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              boxShadow: '2px 2px 0 var(--text-primary)',
              transform: 'rotate(2deg)',
              transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
            }}
            onMouseEnter={(e:any)=>{if(!syncing){e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';e.currentTarget.style.boxShadow='3px 3px 0 var(--text-primary)';}}}
            onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(2deg)';e.currentTarget.style.boxShadow='2px 2px 0 var(--text-primary)';}}
          >
            {syncing ? '⏳ ...' : '🔄 Sync'}
          </button>
        </div>

        <div style={{ padding: '18px 20px', position: 'relative' }}>
          {/* Margen rojo cuaderno */}
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: 38, width: 1.5,
            background: '#ef4444', opacity: 0.2,
            pointerEvents: 'none',
          }}/>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <p style={{
                fontFamily: HAND, fontSize: 19, fontStyle: 'italic',
                color: 'var(--text-faint)', margin: 0,
              }}>
                ⏳ ~ cargando ranking ~
              </p>
            </div>
          ) : entries.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '36px 20px',
              background: 'var(--bg-secondary)',
              border: '2px dashed var(--border-color)',
              borderRadius: 12,
              transform: 'rotate(-0.4deg)',
            }}>
              <div style={{ fontSize: 50, marginBottom: 8 }}>🏆</div>
              <p style={{
                fontFamily: HAND, fontSize: 20, fontStyle: 'italic',
                color: 'var(--text-faint)', margin: 0,
              }}>
                ~ ¡sé el primero! ~
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
              {entries.map((entry, i) => {
                const rank = i + 1;
                const isMe = entry.nombre.toLowerCase() === myName.toLowerCase();
                const color = getColor(rank);
                const rot = isMe
                  ? 0
                  : rank === 1 ? -1.2 : rank === 2 ? 1 : rank === 3 ? -0.8
                  : (i % 2 === 0 ? -0.3 : 0.3);

                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px',
                    borderRadius: 12,
                    background: isMe
                      ? 'color-mix(in srgb,var(--gold) 18%,var(--bg-card))'
                      : rank <= 3
                        ? 'var(--bg-secondary)'
                        : 'var(--bg-secondary)',
                    border: isMe
                      ? '2.5px solid var(--gold)'
                      : rank <= 3
                        ? `2px solid ${color}66`
                        : '1.5px dashed var(--border-color)',
                    boxShadow: isMe
                      ? '3px 4px 0 var(--gold)'
                      : rank <= 3
                        ? `2px 3px 0 ${color}`
                        : 'none',
                    transform: `rotate(${rot}deg)`,
                    transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                  }}
                    onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateX(3px)';}}
                    onMouseLeave={(e:any)=>{e.currentTarget.style.transform=`rotate(${rot}deg)`;}}
                  >
                    {/* Rank */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 8,
                      background: rank <= 3 ? color : 'var(--bg-card)',
                      border: '2.5px solid var(--text-primary)',
                      boxShadow: '2px 2px 0 var(--text-primary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: HAND, fontSize: rank <= 3 ? 18 : 14, fontWeight: 900,
                      color: rank <= 3 ? '#000' : color,
                      flexShrink: 0,
                      transform: rank <= 3 ? `rotate(${rank === 1 ? -5 : rank === 2 ? 5 : -3}deg)` : 'rotate(-2deg)',
                    }}>
                      {getMedal(rank)}
                    </div>

                    {/* Avatar */}
                    <div
                      onClick={() => window.location.href = '/u/' + entry.user_id}
                      title={`Ver perfil de ${entry.nombre}`}
                      style={{
                        width: 42, height: 42, borderRadius: '50%',
                        background: 'var(--bg-secondary)',
                        border: `2.5px solid var(--text-primary)`,
                        boxShadow: `2px 2px 0 ${isMe ? 'var(--gold)' : color}`,
                        overflow: 'hidden',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: HAND, fontSize: 18, fontWeight: 900,
                        color: 'var(--text-primary)',
                        flexShrink: 0, cursor: 'pointer',
                        transform: 'rotate(-4deg)',
                        transition: 'transform 0.2s cubic-bezier(.25,.8,.25,1)',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.transform = 'rotate(0deg) scale(1.12)';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.transform = 'rotate(-4deg)';
                      }}
                    >
                      {entry.avatar_url
                        ? <img src={entry.avatar_url} alt={entry.nombre} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span>{entry.nombre?.[0]?.toUpperCase() || '?'}</span>
                      }
                    </div>

                    {/* Info principal */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <p style={{
                          fontFamily: HAND, fontSize: 19, fontWeight: 900,
                          color: 'var(--text-primary)', margin: 0,
                          lineHeight: 1.05,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {entry.nombre}
                        </p>
                        {isMe && (
                          <span style={{
                            fontFamily: HAND, fontSize: 12, fontWeight: 900,
                            background: 'var(--gold)', color: '#000',
                            border: '1.5px solid var(--text-primary)',
                            boxShadow: '1px 1px 0 var(--text-primary)',
                            padding: '1px 7px', borderRadius: 5,
                            transform: 'rotate(-3deg)',
                            flexShrink: 0,
                          }}>TÚ</span>
                        )}
                      </div>

                      {entry.carrera ? (
                        <p style={{
                          fontFamily: HAND, fontSize: 14, fontWeight: 700,
                          color, fontStyle: 'italic',
                          margin: '2px 0',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          📚 {entry.carrera}
                        </p>
                      ) : entry.tipo_estudiante ? (
                        <p style={{
                          fontFamily: HAND, fontSize: 14, fontStyle: 'italic',
                          color: 'var(--text-faint)', margin: '2px 0',
                        }}>
                          {entry.tipo_estudiante === 'universitario' ? '🎓 Universitario' : '🏫 Estudiante'}
                        </p>
                      ) : null}

                      <div style={{
                        display: 'flex', gap: 10, alignItems: 'center',
                        flexWrap: 'wrap',
                        fontFamily: HAND, fontSize: 13, fontWeight: 700,
                      }}>
                        <span style={{ color: 'var(--text-faint)' }}>🎴 {entry.flashcards_estudiadas}</span>
                        <span style={{ color: 'var(--text-faint)' }}>🔥 {entry.racha_actual}</span>
                        <span style={{ color: 'var(--text-faint)' }}>🎯 {entry.precision_global}%</span>
                        {entry.created_at && (
                          <span style={{
                            color: 'var(--text-faint)', opacity: 0.6,
                            fontStyle: 'italic',
                          }}>
                            · desde {formatFecha(entry.created_at)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* XP */}
                    <div style={{
                      textAlign: 'right', flexShrink: 0,
                      padding: '4px 10px',
                      background: rank <= 3 ? `color-mix(in srgb,${color} 18%,transparent)` : 'transparent',
                      border: rank <= 3 ? `1.5px dashed ${color}` : 'none',
                      borderRadius: 8,
                      transform: rank <= 3 ? `rotate(${rank === 1 ? 2 : -2}deg)` : 'none',
                    }}>
                      <p style={{
                        fontFamily: HAND, fontSize: 22, fontWeight: 900,
                        color, margin: 0, lineHeight: 1,
                      }}>
                        {entry.xp_total}
                      </p>
                      <p style={{
                        fontFamily: HAND, fontSize: 12, fontStyle: 'italic',
                        color: 'var(--text-faint)', margin: 0,
                      }}>XP</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p style={{
            fontFamily: HAND, fontSize: 14, fontStyle: 'italic',
            color: 'var(--text-faint)',
            margin: '14px 0 0', textAlign: 'center',
          }}>
            ~ toca un avatar para ver más detalles ~
          </p>
        </div>
      </div>
    </>
  );
}
