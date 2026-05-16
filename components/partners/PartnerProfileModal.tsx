'use client';

import { useRouter } from 'next/navigation';

import { PartnerInfo, Message } from './types';
import { Av, getTipoLabel } from './helpers';

const HAND = "'Caveat',cursive";

export default function PartnerProfileModal({ partner, savedMsgs, onOpenSaved, onClose }: {
  partner: PartnerInfo;
  savedMsgs: Message[];
  onOpenSaved: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const savedByType = {
    chat: savedMsgs.filter(m => m.type === 'text' || m.type === 'profile_share').length,
    foto: savedMsgs.filter(m => m.type === 'image').length,
    audio: savedMsgs.filter(m => m.type === 'audio').length,
    doc: savedMsgs.filter(m => m.type === 'file').length,
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.78)',
      backdropFilter: 'blur(6px)',
      zIndex: 9999,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: 0,
      overflowY: 'auto',
    }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{
        background: 'var(--bg-card)',
        width: '100%', maxWidth: 500,
        borderRadius: '0 0 24px 24px',
        border: '2.5px solid var(--text-primary)',
        borderTop: 'none',
        overflow: 'hidden',
        animation: 'slideDownPart 0.3s cubic-bezier(.34,1.4,.64,1)',
        boxShadow: '6px 7px 0 var(--gold), 0 20px 60px rgba(0,0,0,0.5)',
        position: 'relative',
      }}>
        <style>{`
          @keyframes slideDownPart {
            from { transform: translateY(-100%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
        `}</style>

        {/* Banner gradient */}
        <div style={{
          height: 110,
          background: 'linear-gradient(135deg, color-mix(in srgb,#38bdf8 35%,transparent) 0%, color-mix(in srgb,#a78bfa 35%,transparent) 50%, color-mix(in srgb,#f5c842 35%,transparent) 100%)',
          borderBottom: '2.5px solid var(--text-primary)',
          position: 'relative',
        }}>
          <button onClick={onClose} style={{
            position: 'absolute', top: 14, right: 16,
            background: 'rgba(0,0,0,0.5)',
            border: '2.5px solid var(--text-primary)',
            color: '#fff',
            width: 36, height: 36,
            borderRadius: 8,
            cursor: 'pointer',
            fontFamily: HAND, fontSize: 17, fontWeight: 900,
            backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '2px 2px 0 var(--text-primary)',
            transform: 'rotate(3deg)',
          }}>
            ✕
          </button>
        </div>

        <div style={{ padding: '0 24px 28px', marginTop: -48 }}>

          {/* Avatar + Name */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 20 }}>
            <div style={{
              border: '4px solid var(--bg-card)',
              borderRadius: '50%',
              boxShadow: '3px 4px 0 var(--gold)',
              transform: 'rotate(-4deg)',
            }}>
              <Av user={partner} size={84} />
            </div>
            <div style={{ paddingBottom: 6 }}>
              <h2 style={{
                fontFamily: HAND, fontSize: 30, fontWeight: 900,
                color: 'var(--text-primary)',
                margin: '0 0 4px', lineHeight: 1.1,
                transform: 'rotate(-1deg)', display: 'inline-block',
              }}>
                {partner.nombre}
              </h2>
              {partner.descripcion && (
                <p style={{
                  fontFamily: HAND, fontSize: 15, fontStyle: 'italic',
                  color: 'var(--text-muted)',
                  margin: 0, lineHeight: 1.4,
                }}>
                  "{partner.descripcion}"
                </p>
              )}
            </div>
          </div>

          {/* Info pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
            {partner.tipo_estudiante && (
              <InfoPill emoji={partner.tipo_estudiante === 'universitario' ? '🎓' : partner.tipo_estudiante === 'escuela' ? '🏫' : partner.tipo_estudiante === 'profesional' ? '💼' : '🧠'} text={getTipoLabel(partner.tipo_estudiante)} rot={-1} />
            )}
            {partner.carrera && <InfoPill emoji="📚" text={partner.carrera} rot={1} />}
            {partner.universidad && <InfoPill emoji="🏫" text={partner.universidad} rot={-0.5} />}
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
            {[
              { l: 'XP',         v: partner.xp_total || 0,                  c: 'var(--gold)', rot: -1.5 },
              { l: 'Racha',      v: `${partner.racha_actual || 0}🔥`,       c: 'var(--red)', rot: 1.5 },
              { l: 'Flashcards', v: partner.flashcards_estudiadas || 0,     c: '#38bdf8', rot: -1 },
            ].map((s, i) => (
              <div key={i} style={{
                background: `color-mix(in srgb,${s.c} 12%,var(--bg-secondary))`,
                border: `2px dashed ${s.c}`,
                borderRadius: 12,
                padding: '14px 8px',
                textAlign: 'center',
                transform: `rotate(${s.rot}deg)`,
                transition: 'transform 0.2s',
              }}
                onMouseEnter={(e:any)=>e.currentTarget.style.transform='rotate(0deg) scale(1.05)'}
                onMouseLeave={(e:any)=>e.currentTarget.style.transform=`rotate(${s.rot}deg)`}
              >
                <div style={{
                  fontFamily: HAND, fontSize: 22, fontWeight: 900,
                  color: s.c, lineHeight: 1,
                }}>{s.v}</div>
                <div style={{
                  fontFamily: HAND, fontSize: 12, fontStyle: 'italic',
                  color: 'var(--text-faint)', marginTop: 4,
                }}>~ {s.l} ~</div>
              </div>
            ))}
          </div>

          {/* Saved preview */}
          <div style={{
            borderTop: '1.5px dashed var(--border-color)',
            paddingTop: 18,
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginBottom: 12,
            }}>
              <h3 style={{
                fontFamily: HAND, fontSize: 22, fontWeight: 900,
                color: 'var(--text-primary)',
                margin: 0, lineHeight: 1,
                transform: 'rotate(-0.8deg)', display: 'inline-block',
              }}>
                📌 Guardados
              </h3>
              <button onClick={onOpenSaved}
                style={{
                  padding: '6px 14px',
                  borderRadius: 10,
                  border: '2px dashed #38bdf8',
                  background: 'color-mix(in srgb,#38bdf8 14%,transparent)',
                  color: '#38bdf8',
                  fontFamily: HAND, fontSize: 15, fontWeight: 800,
                  cursor: 'pointer',
                  transform: 'rotate(2deg)',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e:any)=>{e.currentTarget.style.borderStyle='solid';e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';}}
                onMouseLeave={(e:any)=>{e.currentTarget.style.borderStyle='dashed';e.currentTarget.style.transform='rotate(2deg)';}}
              >
                Ver todo →
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {[
                { emoji: '💬', label: 'Chat',  count: savedByType.chat,  rot: -1 },
                { emoji: '🖼️', label: 'Fotos', count: savedByType.foto,  rot: 1 },
                { emoji: '🎵', label: 'Audio', count: savedByType.audio, rot: -1.5 },
                { emoji: '📎', label: 'Docs',  count: savedByType.doc,   rot: 1.5 },
              ].map((item, i) => (
                <div key={i} onClick={onOpenSaved}
                  style={{
                    padding: '12px 4px',
                    background: 'var(--bg-secondary)',
                    border: `2px ${item.count > 0 ? 'solid' : 'dashed'} ${item.count > 0 ? 'var(--text-primary)' : 'var(--border-color)'}`,
                    borderRadius: 10,
                    textAlign: 'center',
                    cursor: 'pointer',
                    boxShadow: item.count > 0 ? '2px 2px 0 var(--text-primary)' : 'none',
                    transform: `rotate(${item.rot}deg)`,
                    transition: 'all 0.2s cubic-bezier(.25,.8,.25,1)',
                  }}
                  onMouseEnter={(e:any)=>{
                    e.currentTarget.style.transform = 'rotate(0deg) translateY(-2px)';
                    e.currentTarget.style.borderColor = '#38bdf8';
                  }}
                  onMouseLeave={(e:any)=>{
                    e.currentTarget.style.transform = `rotate(${item.rot}deg)`;
                    e.currentTarget.style.borderColor = item.count > 0 ? 'var(--text-primary)' : 'var(--border-color)';
                  }}
                >
                  <div style={{ fontSize: 22, marginBottom: 2 }}>{item.emoji}</div>
                  <div style={{
                    fontFamily: HAND, fontSize: 22, fontWeight: 900,
                    color: item.count > 0 ? 'var(--text-primary)' : 'var(--text-faint)',
                    lineHeight: 1,
                  }}>{item.count}</div>
                  <div style={{
                    fontFamily: HAND, fontSize: 12, fontStyle: 'italic',
                    color: 'var(--text-faint)',
                    marginTop: 3,
                  }}>{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Public profile button */}
          <button onClick={() => router.push(`/u/${partner.user_id}`)}
            style={{
              width: '100%', padding: 14,
              marginTop: 20,
              borderRadius: 14,
              border: '2.5px solid var(--text-primary)',
              background: 'linear-gradient(135deg, #38bdf8, #a78bfa)',
              color: '#fff',
              fontFamily: HAND, fontSize: 20, fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '3px 4px 0 var(--text-primary)',
              textShadow: '0 1px 2px rgba(0,0,0,0.3)',
              transform: 'rotate(-1deg)',
              transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
            }}
            onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';e.currentTarget.style.boxShadow='4px 6px 0 var(--text-primary)';}}
            onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-1deg)';e.currentTarget.style.boxShadow='3px 4px 0 var(--text-primary)';}}
          >
            🌐 Ver Perfil Público
          </button>
        </div>

        {/* Handle bar */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 14px' }}>
          <div style={{
            width: 50, height: 5,
            borderRadius: 3,
            background: 'var(--text-primary)',
            opacity: 0.3,
          }} />
        </div>
      </div>
    </div>
  );
}

function InfoPill({ emoji, text, rot }: { emoji: string; text: string; rot: number }) {
  return (
    <div style={{
      padding: '7px 14px',
      background: 'var(--bg-secondary)',
      border: '2px dashed var(--border-color)',
      borderRadius: 10,
      display: 'flex', alignItems: 'center', gap: 8,
      transform: `rotate(${rot}deg)`,
    }}>
      <span style={{ fontSize: 16 }}>{emoji}</span>
      <span style={{
        fontFamily: HAND, fontSize: 16, fontWeight: 800,
        color: 'var(--text-primary)',
        fontStyle: 'italic',
      }}>{text}</span>
    </div>
  );
}