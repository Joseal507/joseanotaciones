'use client';

import { useState } from 'react';
import { PartnerInfo } from './types';

export function QRModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [c, setC] = useState(false);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backdropFilter: 'blur(8px)' }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: '24px', padding: '32px', maxWidth: '360px', width: '100%', border: '1px solid var(--border-color)', textAlign: 'center' }}>
        <h3 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px' }}>📱 Mi Perfil</h3>
        <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: '0 0 20px' }}>Escanea para ir a tu perfil público</p>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '16px', display: 'inline-block', marginBottom: '20px' }}>
          <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`} alt="QR" style={{ width: '200px', height: '200px', display: 'block' }} />
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => { navigator.clipboard.writeText(url); setC(true); setTimeout(() => setC(false), 2000); }} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: c ? '#4ade80' : '#38bdf8', color: '#000', fontWeight: 800, cursor: 'pointer' }}>{c ? '✅ Copiado' : '📋 Copiar link'}</button>
          <button onClick={onClose} style={{ padding: '12px 18px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer' }}>✕</button>
        </div>
      </div>
    </div>
  );
}

export function ReportModal({ partner, token, onClose }: { partner: PartnerInfo; token: string; onClose: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [det, setDet] = useState('');
  const [ok, setOk] = useState(false);
  const [e, setE] = useState(false);
  const MOTIVOS = ['Acoso', 'Contenido inapropiado', 'Spam', 'Información falsa', 'Comportamiento ofensivo', 'Otro'];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backdropFilter: 'blur(8px)' }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: '24px', maxWidth: '420px', width: '100%', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <div style={{ height: '4px', background: 'var(--red)' }} />
        <div style={{ padding: '28px' }}>
          {ok ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
              <p style={{ fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Reporte enviado</p>
            </div>
          ) : (
            <>
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--red)', margin: '0 0 16px' }}>🚨 Reportar a {partner.nombre}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                {MOTIVOS.map(m => (
                  <button key={m} onClick={() => setMotivo(m)} style={{ padding: '10px 14px', borderRadius: '10px', border: `2px solid ${motivo === m ? 'var(--red)' : 'var(--border-color)'}`, background: motivo === m ? 'rgba(255,77,109,0.1)' : 'transparent', color: motivo === m ? 'var(--red)' : 'var(--text-primary)', fontSize: '14px', fontWeight: motivo === m ? 700 : 400, cursor: 'pointer', textAlign: 'left' }}>{m}</button>
                ))}
              </div>
              <textarea value={det} onChange={ev => setDet(ev.target.value)} placeholder="Detalles (opcional)" rows={2} style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: '14px' }} />
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={async () => { setE(true); await fetch('/api/partners', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'report', reported_id: partner.user_id, motivo, detalles: det }) }); setOk(true); setE(false); setTimeout(onClose, 2000); }} disabled={!motivo || e} style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: motivo ? 'var(--red)' : 'var(--bg-secondary)', color: motivo ? '#fff' : 'var(--text-faint)', fontWeight: 800, cursor: motivo ? 'pointer' : 'not-allowed' }}>{e ? '⏳' : '🚨 Enviar'}</button>
                <button onClick={onClose} style={{ padding: '12px 18px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ImageViewer({ src, messageId, isSaved, onSave, onClose }: { src: string; messageId: string; isSaved: boolean; onSave: (id: string) => void; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', cursor: 'zoom-out' }}>
      <div style={{ position: 'absolute', top: '20px', right: '20px', display: 'flex', gap: '12px' }}>
        <button onClick={e => { e.stopPropagation(); onSave(messageId); }} style={{ background: isSaved ? '#f5c842' : 'rgba(255,255,255,0.2)', border: 'none', color: isSaved ? '#000' : '#fff', padding: '8px 16px', borderRadius: '20px', fontSize: '14px', cursor: 'pointer', fontWeight: 800 }}>{isSaved ? '📌 Guardado' : '📌 Guardar'}</button>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', width: '40px', height: '40px', borderRadius: '50%', fontSize: '18px', cursor: 'pointer', fontWeight: 900 }}>✕</button>
      </div>
      <img src={src} onClick={e => e.stopPropagation()} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: '12px', cursor: 'default' }} />
    </div>
  );
}
