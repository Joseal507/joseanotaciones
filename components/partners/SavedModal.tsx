'use client';

import { useState } from 'react';
import { Message } from './types';
import { fmtTime, fmtSize } from './helpers';

const HAND = "'Caveat',cursive";
const BODY = "'Inter', system-ui, sans-serif";

const TABS = [
  { id: 'chat',  emoji: '💬', label: 'Chat' },
  { id: 'foto',  emoji: '🖼️', label: 'Fotos' },
  { id: 'audio', emoji: '🎵', label: 'Audio' },
  { id: 'doc',   emoji: '📎', label: 'Docs' },
] as const;

type TabId = typeof TABS[number]['id'];

function filterByTab(msgs: Message[], tab: TabId): Message[] {
  switch (tab) {
    case 'chat':  return msgs.filter(m => m.type === 'text' || m.type === 'profile_share');
    case 'foto':  return msgs.filter(m => m.type === 'image');
    case 'audio': return msgs.filter(m => m.type === 'audio');
    case 'doc':   return msgs.filter(m => m.type === 'file');
  }
}

export default function SavedModal({ savedMsgs, onGuardar, onViewImage, onClose }: {
  savedMsgs: Message[];
  onGuardar: (id: string) => void;
  onViewImage: (url: string, id: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabId>('chat');
  const filtered = filterByTab(savedMsgs, tab);

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.78)',
      backdropFilter: 'blur(6px)',
      zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{
        background: 'var(--bg-card)',
        border: '2.5px solid var(--text-primary)',
        borderRadius: 16,
        width: '100%', maxWidth: 540,
        maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '6px 7px 0 var(--gold), 0 20px 60px rgba(0,0,0,0.5)',
        transform: 'rotate(-0.4deg)',
        position: 'relative',
        animation: 'savedPop 0.4s cubic-bezier(.34,1.4,.64,1)',
      }}>
        <style>{`
          @keyframes savedPop {
            0% { transform: rotate(0deg) scale(0.85); opacity: 0; }
            60% { transform: rotate(-0.4deg) scale(1.02); opacity: 1; }
            100% { transform: rotate(-0.4deg) scale(1); opacity: 1; }
          }
        `}</style>

        {/* Cinta scotch */}
        <div style={{
          position: 'absolute', top: -10, left: '50%',
          transform: 'translateX(-50%) rotate(-3deg)',
          width: 90, height: 18,
          background: 'color-mix(in srgb, var(--gold) 55%, transparent)',
          border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)',
          boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
          zIndex: 5,
        }}/>

        {/* Banda título */}
        <div style={{
          background: 'var(--gold)',
          padding: '10px 24px',
          borderBottom: '2px solid var(--text-primary)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <div>
            <h3 style={{
              fontFamily: HAND, fontSize: 26, fontWeight: 900,
              color: '#000', margin: 0, lineHeight: 1.05,
              transform: 'rotate(-0.8deg)', display: 'inline-block',
              fontStyle: 'italic',
            }}>
              📌 Guardados
            </h3>
            <p style={{
              fontFamily: HAND, fontSize: 14, fontStyle: 'italic',
              color: 'rgba(0,0,0,0.75)',
              margin: 0,
            }}>
              ~ {savedMsgs.length} items ~
            </p>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(0,0,0,0.3)',
            border: '2px solid var(--text-primary)',
            color: '#fff',
            width: 36, height: 36,
            borderRadius: 8,
            fontFamily: HAND, fontSize: 18, fontWeight: 900,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '2px 2px 0 var(--text-primary)',
            transform: 'rotate(3deg)',
          }}>
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          padding: '14px 20px 12px',
          borderBottom: '2px dashed var(--border-color)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {TABS.map((t, i) => {
              const count = filterByTab(savedMsgs, t.id).length;
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  style={{
                    flex: 1, padding: '10px 4px',
                    borderRadius: 10,
                    border: `2.5px ${active ? 'solid' : 'dashed'} ${active ? '#38bdf8' : 'var(--border-color)'}`,
                    background: active ? 'color-mix(in srgb,#38bdf8 18%,transparent)' : 'var(--bg-secondary)',
                    color: active ? '#38bdf8' : 'var(--text-faint)',
                    cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                    fontFamily: HAND,
                    fontWeight: 800, fontSize: 14,
                    boxShadow: active ? '2px 3px 0 #38bdf8' : 'none',
                    transform: active ? `rotate(${i % 2 === 0 ? -1.5 : 1.5}deg)` : `rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`,
                    transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                  }}>
                  <span style={{ fontSize: 20 }}>{t.emoji}</span>
                  <span>{t.label}</span>
                  {count > 0 && (
                    <span style={{
                      background: active ? '#38bdf8' : 'var(--border-color)',
                      color: active ? '#000' : 'var(--text-faint)',
                      border: '1.5px solid var(--text-primary)',
                      borderRadius: 6,
                      padding: '0 8px',
                      fontFamily: HAND, fontSize: 13, fontWeight: 900,
                    }}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 22px 22px' }}>
          {filtered.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '48px 20px',
              background: 'var(--bg-secondary)',
              border: '2px dashed var(--border-color)',
              borderRadius: 14,
              transform: 'rotate(-0.5deg)',
            }}>
              <div style={{ fontSize: 50, marginBottom: 12 }}>{TABS.find(t => t.id === tab)?.emoji}</div>
              <p style={{
                fontFamily: HAND, fontSize: 22, fontWeight: 900,
                color: 'var(--text-muted)',
                margin: '0 0 6px',
                transform: 'rotate(-1deg)', display: 'inline-block',
              }}>
                ~ nada guardado ~
              </p>
              <p style={{
                fontFamily: BODY, fontSize: 15, fontStyle: 'italic',
                color: 'var(--text-faint)', margin: 0,
              }}>
                ~ mantén presionado un mensaje para guardar ~
              </p>
            </div>
          ) : tab === 'foto' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {filtered.map((m, i) => (
                <div key={m.id} style={{
                  position: 'relative',
                  aspectRatio: '1',
                  borderRadius: 10,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  border: '2px solid var(--text-primary)',
                  boxShadow: '2px 2px 0 var(--text-primary)',
                  transform: `rotate(${(i % 3 - 1) * 1.5}deg)`,
                  transition: 'transform 0.25s',
                }}
                  onClick={() => { onClose(); onViewImage(m.file_url!, m.id); }}
                  onMouseEnter={(e:any)=>e.currentTarget.style.transform='rotate(0deg) scale(1.05)'}
                  onMouseLeave={(e:any)=>e.currentTarget.style.transform=`rotate(${(i % 3 - 1) * 1.5}deg)`}
                >
                  <img src={m.file_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(transparent 60%, rgba(0,0,0,0.7))',
                  }} />
                  <div style={{
                    position: 'absolute', bottom: 6, left: 6,
                    fontFamily: HAND, fontSize: 12, fontStyle: 'italic',
                    color: 'rgba(255,255,255,0.9)', fontWeight: 700,
                  }}>
                    {fmtTime(m.created_at)}
                  </div>
                  <button onClick={(e: any) => { e.stopPropagation(); onGuardar(m.id); }}
                    style={{
                      position: 'absolute', top: 6, right: 6,
                      background: 'var(--gold)',
                      border: '2px solid var(--text-primary)',
                      color: '#000',
                      borderRadius: 6,
                      width: 28, height: 28,
                      fontFamily: HAND, fontSize: 14,
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '1px 1px 0 var(--text-primary)',
                      transform: 'rotate(-5deg)',
                    }}>
                    📌
                  </button>
                </div>
              ))}
            </div>
          ) : tab === 'audio' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.map((m, i) => (
                <div key={m.id} style={{
                  padding: '14px 16px',
                  background: 'var(--bg-secondary)',
                  border: '2.5px solid var(--text-primary)',
                  borderRadius: 12,
                  boxShadow: '3px 4px 0 #a78bfa',
                  transform: `rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <div style={{
                      width: 44, height: 44,
                      borderRadius: 10,
                      background: 'linear-gradient(135deg, #a78bfa, #38bdf8)',
                      border: '2px solid var(--text-primary)',
                      boxShadow: '2px 2px 0 var(--text-primary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 20, flexShrink: 0,
                      transform: 'rotate(-4deg)',
                    }}>🎵</div>
                    <div style={{ flex: 1 }}>
                      <p style={{
                        fontFamily: HAND, fontSize: 17, fontWeight: 800,
                        color: 'var(--text-primary)', margin: 0,
                      }}>Mensaje de voz</p>
                      <p style={{
                        fontFamily: BODY, fontSize: 13, fontStyle: 'italic',
                        color: 'var(--text-faint)', margin: '2px 0 0',
                      }}>~ {fmtTime(m.created_at)} ~</p>
                    </div>
                    <button onClick={() => onGuardar(m.id)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '2px solid var(--text-primary)',
                        background: 'var(--gold)', color: '#000',
                        fontFamily: HAND, fontSize: 16,
                        cursor: 'pointer',
                        boxShadow: '1px 2px 0 var(--text-primary)',
                        transform: 'rotate(3deg)',
                      }}>📌</button>
                  </div>
                  <audio controls src={m.file_url} preload="metadata" style={{ width: '100%', height: 36 }} />
                </div>
              ))}
            </div>
          ) : tab === 'doc' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.map((m, i) => (
                <div key={m.id} onClick={() => window.open(m.file_url!, '_blank')}
                  style={{
                    padding: '14px 16px',
                    background: 'var(--bg-secondary)',
                    border: '2.5px solid var(--text-primary)',
                    borderRadius: 12,
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 12,
                    boxShadow: '3px 4px 0 var(--gold)',
                    transform: `rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`,
                    transition: 'transform 0.2s',
                  }}
                  onMouseEnter={(e:any)=>e.currentTarget.style.transform='rotate(0deg) translateX(3px)'}
                  onMouseLeave={(e:any)=>e.currentTarget.style.transform=`rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`}
                >
                  <div style={{
                    width: 46, height: 46,
                    borderRadius: 10,
                    background: 'linear-gradient(135deg, var(--gold), #ff6b6b)',
                    border: '2px solid var(--text-primary)',
                    boxShadow: '2px 2px 0 var(--text-primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 22, flexShrink: 0,
                    transform: 'rotate(-4deg)',
                  }}>📎</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontFamily: HAND, fontSize: 17, fontWeight: 800,
                      color: 'var(--text-primary)',
                      margin: '0 0 2px',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{m.file_name}</p>
                    <p style={{
                      fontFamily: BODY, fontSize: 13, fontStyle: 'italic',
                      color: 'var(--text-faint)', margin: 0,
                    }}>~ {fmtSize(m.file_size)} · {fmtTime(m.created_at)} ~</p>
                  </div>
                  <button onClick={(e: any) => { e.stopPropagation(); onGuardar(m.id); }}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '2px solid var(--text-primary)',
                      background: 'var(--gold)', color: '#000',
                      fontFamily: HAND, fontSize: 16,
                      cursor: 'pointer',
                      flexShrink: 0,
                      boxShadow: '1px 2px 0 var(--text-primary)',
                      transform: 'rotate(3deg)',
                    }}>📌</button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.map((m, i) => (
                <div key={m.id} style={{
                  padding: '14px 16px',
                  background: 'var(--bg-secondary)',
                  border: '2.5px solid var(--text-primary)',
                  borderRadius: 12,
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                  boxShadow: '3px 4px 0 #38bdf8',
                  transform: `rotate(${i % 2 === 0 ? -0.4 : 0.4}deg)`,
                }}>
                  <div style={{
                    width: 38, height: 38,
                    borderRadius: 10,
                    background: 'color-mix(in srgb,#38bdf8 16%,transparent)',
                    border: '2px solid var(--text-primary)',
                    boxShadow: '1px 2px 0 var(--text-primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 17, flexShrink: 0, marginTop: 2,
                    transform: 'rotate(-3deg)',
                  }}>💬</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontFamily: BODY, fontSize: 18, fontWeight: 600,
                      color: 'var(--text-primary)',
                      margin: '0 0 4px', lineHeight: 1.4,
                      wordBreak: 'break-word',
                    }}>{m.content}</p>
                    <p style={{
                      fontFamily: BODY, fontSize: 13, fontStyle: 'italic',
                      color: 'var(--text-faint)', margin: 0,
                    }}>~ {fmtTime(m.created_at)} ~</p>
                  </div>
                  <button onClick={() => onGuardar(m.id)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '2px solid var(--text-primary)',
                      background: 'var(--gold)', color: '#000',
                      fontFamily: HAND, fontSize: 16,
                      cursor: 'pointer',
                      flexShrink: 0, marginTop: 2,
                      boxShadow: '1px 2px 0 var(--text-primary)',
                      transform: 'rotate(3deg)',
                    }}>📌</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}