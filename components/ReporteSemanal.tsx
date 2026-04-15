'use client';

import { useState } from 'react';
import { getPerfil } from '../lib/storage';
import { useIdioma } from '../hooks/useIdioma';
import { getIdioma } from '../lib/i18n';

export default function ReporteSemanal() {
  const [generando, setGenerando] = useState(false);
  const [reporte, setReporte] = useState('');
  const [stats, setStats] = useState<any>(null);
  const [copiado, setCopiado] = useState(false);
  const { tr } = useIdioma();

  const generarReporte = async () => {
    setGenerando(true);
    setReporte('');
    try {
      const perfil = getPerfil();
      const rachaData = JSON.parse(localStorage.getItem('josea_racha') || '{}');
      const idioma = getIdioma();

      const res = await fetch('/api/reporte', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ perfil, racha: rachaData, idioma }),
      });
      const data = await res.json();
      if (data.success) {
        setReporte(data.reporte);
        setStats(data.stats);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setGenerando(false);
    }
  };

  const copiarReporte = () => {
    if (!reporte) return;
    navigator.clipboard.writeText(reporte);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  const compartirEmail = () => {
    if (!reporte) return;
    const asunto = encodeURIComponent(tr('reporteSemanal'));
    const cuerpo = encodeURIComponent(reporte);
    window.open(`mailto:?subject=${asunto}&body=${cuerpo}`);
  };

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
      <div style={{ height: '4px', background: 'var(--blue)' }} />
      <div style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>
              {tr('reporteSemanal')}
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
              {tr('resumenProgreso')}
            </p>
          </div>
          <button onClick={generarReporte} disabled={generando}
            style={{ padding: '10px 20px', borderRadius: '10px', border: 'none', background: generando ? 'var(--bg-card2)' : 'var(--blue)', color: generando ? 'var(--text-faint)' : '#000', fontSize: '13px', fontWeight: 800, cursor: generando ? 'not-allowed' : 'pointer', flexShrink: 0 }}>
            {generando ? tr('generandoReporte') : tr('generarReporte')}
          </button>
        </div>

        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '16px' }}>
            {[
              { label: tr('totalEstudiadas'), value: stats.total, color: 'var(--gold)' },
              { label: tr('acertadas'), value: stats.totalAcertadas, color: '#4ade80' },
              { label: tr('falladas'), value: stats.totalFalladas, color: 'var(--red)' },
              { label: tr('precision'), value: `${stats.precision}%`, color: 'var(--blue)' },
            ].map((s, i) => (
              <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: 900, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-faint)', fontWeight: 600 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {reporte && (
          <div>
            <div style={{ background: 'var(--bg-secondary)', borderRadius: '12px', padding: '20px', border: '1px solid var(--border-color)', marginBottom: '12px', lineHeight: 1.7, fontSize: '14px', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
              {reporte}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={copiarReporte}
                style={{ padding: '9px 16px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                {copiado ? tr('copiado') : tr('copiar')}
              </button>
              <button onClick={compartirEmail}
                style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: 'var(--blue)', color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
                {tr('enviarEmail')}
              </button>
              <button onClick={generarReporte} disabled={generando}
                style={{ padding: '9px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                {tr('regenerar')}
              </button>
            </div>
          </div>
        )}

        {!reporte && !generando && (
          <div style={{ textAlign: 'center', padding: '24px', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px dashed var(--border-color)' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📊</div>
            <p style={{ fontSize: '13px', color: 'var(--text-faint)', margin: 0 }}>
              {tr('tocaGenerar')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}