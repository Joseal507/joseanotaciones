'use client';

import { useState } from 'react';
import { PartnerInfo } from './types';

const HAND = "'Caveat',cursive";
const BODY = "'Inter', system-ui, sans-serif";

// ─── QR MODAL ───
export function QRModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [c, setC] = useState(false);
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.78)',
      backdropFilter: 'blur(8px)',
      zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      animation: 'qrFade 0.25s ease',
    }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{
        background: 'var(--bg-card)',
        border: '2.5px solid var(--text-primary)',
        borderRadius: 16,
        padding: '28px 24px',
        maxWidth: 380, width: '100%',
        textAlign: 'center',
        boxShadow: '6px 7px 0 #38bdf8, 0 16px 50px rgba(0,0,0,0.4)',
        transform: 'rotate(-0.5deg)',
        position: 'relative',
        animation: 'qrPop 0.4s cubic-bezier(.34,1.4,.64,1)',
      }}>
        {/* Cinta scotch */}
        <div style={{
          position: 'absolute', top: -10, left: '50%',
          transform: 'translateX(-50%) rotate(-4deg)',
          width: 80, height: 18,
          background: 'rgba(56,189,248,0.55)',
          border: '1px solid rgba(56,189,248,0.3)',
          boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
        }}/>

        <h3 style={{
          fontFamily: HAND, fontSize: 26, fontWeight: 900,
          color: 'var(--text-primary)', margin: '6px 0 4px',
          transform: 'rotate(-1deg)', display: 'inline-block',
        }}>
          📱 Mi Perfil
        </h3>
        <p style={{
          fontFamily: BODY, fontSize: 16, fontStyle: 'italic',
          color: 'var(--text-muted)', margin: '0 0 18px',
        }}>
          ~ escanea para ir a tu perfil público ~
        </p>

        {/* QR estilo polaroid */}
        <div style={{
          background: '#fff',
          border: '2.5px solid var(--text-primary)',
          borderRadius: 8,
          padding: 14, paddingBottom: 24,
          display: 'inline-block',
          marginBottom: 18,
          boxShadow: '4px 5px 0 #38bdf8',
          transform: 'rotate(-2deg)',
        }}>
          <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`} alt="QR"
            style={{ width: 200, height: 200, display: 'block' }} />
        </div>

        <div style={{
          display: 'flex', gap: 10,
          paddingTop: 14,
          borderTop: '1.5px dashed var(--border-color)',
        }}>
          <button onClick={() => { navigator.clipboard.writeText(url); setC(true); setTimeout(() => setC(false), 2000); }}
            style={{
              flex: 1, padding: 12,
              borderRadius: 12,
              border: '2.5px solid var(--text-primary)',
              background: c ? '#4ade80' : '#38bdf8',
              color: '#000',
              fontFamily: HAND, fontSize: 18, fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '3px 4px 0 var(--text-primary)',
              transform: 'rotate(-1deg)',
            }}>
            {c ? '✅ Copiado' : '📋 Copiar link'}
          </button>
          <button onClick={onClose}
            style={{
              padding: '12px 18px',
              borderRadius: 12,
              border: '2.5px dashed var(--text-faint)',
              background: 'transparent', color: 'var(--text-muted)',
              fontFamily: HAND, fontSize: 18, fontWeight: 800,
              cursor: 'pointer',
              transform: 'rotate(1deg)',
            }}>
            ✕
          </button>
        </div>
      </div>

      <style>{`
        @keyframes qrFade { from{opacity:0} to{opacity:1} }
        @keyframes qrPop {
          0% { transform: rotate(0deg) scale(0.85); opacity: 0; }
          60% { transform: rotate(-0.5deg) scale(1.02); opacity: 1; }
          100% { transform: rotate(-0.5deg) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─── REPORT MODAL ───
export function ReportModal({ partner, token, onClose }: { partner: PartnerInfo; token: string; onClose: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [det, setDet] = useState('');
  const [ok, setOk] = useState(false);
  const [e, setE] = useState(false);
  const MOTIVOS = ['Acoso', 'Contenido inapropiado', 'Spam', 'Información falsa', 'Comportamiento ofensivo', 'Otro'];

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.78)',
      backdropFilter: 'blur(8px)',
      zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      animation: 'qrFade 0.25s ease',
    }}>
      <div onClick={ev => ev.stopPropagation()} style={{
        background: 'var(--bg-card)',
        border: '2.5px solid var(--text-primary)',
        borderRadius: 16,
        maxWidth: 440, width: '100%',
        overflow: 'hidden',
        boxShadow: '6px 7px 0 var(--red), 0 16px 50px rgba(0,0,0,0.4)',
        transform: 'rotate(-0.5deg)',
        position: 'relative',
        animation: 'qrPop 0.4s cubic-bezier(.34,1.4,.64,1)',
      }}>
        {/* Cinta scotch */}
        <div style={{
          position: 'absolute', top: -10, left: '50%',
          transform: 'translateX(-50%) rotate(-4deg)',
          width: 80, height: 18,
          background: 'color-mix(in srgb, var(--red) 55%, transparent)',
          border: '1px solid color-mix(in srgb, var(--red) 30%, transparent)',
          boxShadow: '0 2px 5px rgba(0,0,0,0.18)',
          zIndex: 5,
        }}/>

        {/* Banda título */}
        <div style={{
          background: 'var(--red)',
          padding: '12px 26px',
          borderBottom: '2px solid var(--text-primary)',
        }}>
          <h3 style={{
            fontFamily: HAND, fontSize: 24, fontWeight: 900,
            color: '#fff', margin: 0,
            textShadow: '0 1px 3px rgba(0,0,0,0.35)',
            fontStyle: 'italic',
            transform: 'rotate(-0.8deg)', display: 'inline-block',
          }}>
            🚨 Reportar a {partner.nombre}
          </h3>
        </div>

        <div style={{ padding: 24 }}>
          {ok ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 54, marginBottom: 12 }}>✅</div>
              <p style={{
                fontFamily: HAND, fontSize: 22, fontWeight: 800,
                color: '#16a34a', margin: 0,
              }}>
                ~ reporte enviado ~
              </p>
            </div>
          ) : (
            <>
              <p style={{
                fontFamily: HAND, fontSize: 15, fontWeight: 800,
                color: 'var(--text-muted)', fontStyle: 'italic',
                margin: '0 0 8px',
              }}>
                ✏️ Motivo:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                {MOTIVOS.map((m, i) => {
                  const active = motivo === m;
                  return (
                    <button key={m} onClick={() => setMotivo(m)}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 10,
                        border: `2.5px ${active ? 'solid' : 'dashed'} ${active ? 'var(--red)' : 'var(--border-color)'}`,
                        background: active ? 'color-mix(in srgb,var(--red) 14%,transparent)' : 'transparent',
                        color: active ? 'var(--red)' : 'var(--text-primary)',
                        fontFamily: HAND, fontSize: 17, fontWeight: 800,
                        cursor: 'pointer',
                        textAlign: 'left',
                        boxShadow: active ? '2px 3px 0 var(--red)' : 'none',
                        transform: active ? `rotate(${i % 2 === 0 ? -1 : 1}deg)` : `rotate(${i % 2 === 0 ? -0.3 : 0.3}deg)`,
                        transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
                      }}>
                      {m}
                    </button>
                  );
                })}
              </div>

              <p style={{
                fontFamily: HAND, fontSize: 15, fontWeight: 800,
                color: 'var(--text-muted)', fontStyle: 'italic',
                margin: '0 0 6px',
              }}>
                ✏️ Detalles (opcional):
              </p>
              <textarea value={det} onChange={ev => setDet(ev.target.value)} placeholder="Cuéntanos más..." rows={2}
                style={{
                  width: '100%', padding: 10,
                  borderRadius: 10,
                  border: '2.5px solid var(--text-primary)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontFamily: BODY, fontSize: 17, fontWeight: 600,
                  outline: 'none', resize: 'vertical', boxSizing: 'border-box',
                  marginBottom: 14,
                  boxShadow: '3px 3px 0 var(--text-primary)',
                  transform: 'rotate(-0.3deg)',
                }} />

              <div style={{
                display: 'flex', gap: 10,
                paddingTop: 12,
                borderTop: '1.5px dashed var(--border-color)',
              }}>
                <button
                  onClick={async () => {
                    setE(true);
                    await fetch('/api/partners', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ action: 'report', reported_id: partner.user_id, motivo, detalles: det }),
                    });
                    setOk(true);
                    setE(false);
                    setTimeout(onClose, 2000);
                  }}
                  disabled={!motivo || e}
                  style={{
                    flex: 1, padding: 12,
                    borderRadius: 12,
                    border: '2.5px solid var(--text-primary)',
                    background: motivo ? 'var(--red)' : 'var(--bg-secondary)',
                    color: motivo ? '#fff' : 'var(--text-faint)',
                    fontFamily: HAND, fontSize: 19, fontWeight: 800,
                    cursor: motivo ? 'pointer' : 'not-allowed',
                    boxShadow: motivo ? '3px 4px 0 var(--text-primary)' : 'none',
                    textShadow: motivo ? '0 1px 2px rgba(0,0,0,0.3)' : 'none',
                    transform: 'rotate(-1deg)',
                  }}>
                  {e ? '⏳' : '🚨 Enviar'}
                </button>
                <button onClick={onClose}
                  style={{
                    padding: '12px 18px',
                    borderRadius: 12,
                    border: '2.5px dashed var(--text-faint)',
                    background: 'transparent', color: 'var(--text-muted)',
                    fontFamily: HAND, fontSize: 18, fontWeight: 800,
                    cursor: 'pointer',
                    transform: 'rotate(1deg)',
                  }}>
                  ✕ Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── IMAGE VIEWER ───
export function ImageViewer({ src, messageId, isSaved, onSave, onClose }: { src: string; messageId: string; isSaved: boolean; onSave: (id: string) => void; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.95)',
      zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, cursor: 'zoom-out',
    }}>
      <div style={{
        position: 'absolute', top: 20, right: 20,
        display: 'flex', gap: 10,
      }}>
        <button onClick={(e: any) => { e.stopPropagation(); onSave(messageId); }}
          style={{
            background: isSaved ? 'var(--gold)' : 'rgba(255,255,255,0.2)',
            border: '2.5px solid var(--text-primary)',
            color: isSaved ? '#000' : '#fff',
            padding: '8px 16px',
            borderRadius: 10,
            fontFamily: HAND, fontSize: 17, fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '2px 3px 0 var(--text-primary)',
            transform: 'rotate(-2deg)',
            transition: 'all 0.2s',
          }}>
          {isSaved ? '📌 Guardado' : '📌 Guardar'}
        </button>
        <button onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.2)',
            border: '2.5px solid var(--text-primary)',
            color: '#fff',
            width: 44, height: 44,
            borderRadius: 10,
            fontFamily: HAND, fontSize: 22, fontWeight: 900,
            cursor: 'pointer',
            boxShadow: '2px 3px 0 var(--text-primary)',
            transform: 'rotate(2deg)',
          }}>
          ✕
        </button>
      </div>
      <img src={src} onClick={(e: any) => e.stopPropagation()} alt=""
        style={{
          maxWidth: '90vw', maxHeight: '90vh',
          objectFit: 'contain',
          borderRadius: 12,
          cursor: 'default',
          border: '3px solid #fff',
          boxShadow: '0 0 40px rgba(255,255,255,0.2)',
        }} />
    </div>
  );
}