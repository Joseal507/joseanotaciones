'use client';

import { useState, useEffect } from 'react';
import { getPerfil, PerfilEstudio } from '../lib/storage';
import { useIdioma } from '../hooks/useIdioma';

interface DiaData {
  dia: string;
  fecha: string;
  total: number;
}

export default function GraficasEstudio() {
  const [perfil, setPerfil] = useState<PerfilEstudio | null>(null);
  const [rachaData, setRachaData] = useState<{ fecha: string; estudió: boolean }[]>([]);
  const [tab, setTab] = useState<'semana' | 'materias' | 'racha'>('semana');
  const { tr, idioma } = useIdioma();

  useEffect(() => {
    setPerfil(getPerfil());
    try {
      const r = localStorage.getItem('josea_racha');
      if (r) {
        const racha = JSON.parse(r);
        const dias = [];
        for (let i = 29; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          dias.push({ fecha: str, estudió: racha.diasEstudiados?.includes(str) || false });
        }
        setRachaData(dias);
      }
    } catch {}
  }, []);

  if (!perfil) return null;

  const totalAcertadas = Object.values(perfil.flashcardsAcertadas || {}).reduce((a, b) => a + b, 0);
  const totalFalladas = Object.values(perfil.flashcardsFalladas || {}).reduce((a, b) => a + b, 0);
  const total = totalAcertadas + totalFalladas;
  const porcentaje = total > 0 ? Math.round((totalAcertadas / total) * 100) : 0;

  const materiasArr = Object.entries(perfil.materiasStats || {})
    .map(([id, s]) => ({ id, ...s }))
    .filter(m => m.totalFlashcards > 0)
    .sort((a, b) => b.totalFlashcards - a.totalFlashcards)
    .slice(0, 6);

  const maxTotal = Math.max(...materiasArr.map(m => m.totalFlashcards), 1);

  const diasNombresEs = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const diasNombresEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const diasNombres = idioma === 'en' ? diasNombresEn : diasNombresEs;

  const diasSemana: DiaData[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const sesiones = perfil.sesiones?.filter(s => s.fecha === str) || [];
    diasSemana.push({ dia: diasNombres[d.getDay()], fecha: str, total: sesiones.length });
  }

  const maxSesiones = Math.max(...diasSemana.map(d => d.total), 1);
  const diasConActividad = diasSemana.filter(d => rachaData.find(r => r.fecha === d.fecha && r.estudió)).length;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <div style={{ width: '4px', height: '28px', background: 'var(--blue)', borderRadius: '2px' }} />
        <h2 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
          {tr('tuProgresoGraficas')}
        </h2>
      </div>

      {/* Stats rápidas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: 'var(--border-color)', borderRadius: '14px', overflow: 'hidden', marginBottom: '20px' }}>
        {[
          { label: tr('totalEstudiadas'), value: total, color: 'var(--gold)', emoji: '📚' },
          { label: tr('acertadas'), value: totalAcertadas, color: '#4ade80', emoji: '✅' },
          { label: tr('falladas'), value: totalFalladas, color: 'var(--red)', emoji: '❌' },
          { label: tr('precision'), value: `${porcentaje}%`, color: 'var(--blue)', emoji: '🎯' },
        ].map((s, i) => (
          <div key={i} style={{ background: 'var(--bg-card)', padding: '16px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: '18px', marginBottom: '4px' }}>{s.emoji}</div>
            <div style={{ fontSize: '22px', fontWeight: 900, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, marginTop: '2px' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        {[
          { id: 'semana', label: tr('estaSemana') },
          { id: 'materias', label: tr('porMateria') },
          { id: 'racha', label: tr('racha30') },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            style={{ padding: '8px 16px', borderRadius: '10px', border: `2px solid ${tab === t.id ? 'var(--blue)' : 'var(--border-color)'}`, background: tab === t.id ? 'var(--blue-dim)' : 'transparent', color: tab === t.id ? 'var(--blue)' : 'var(--text-muted)', fontSize: '13px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ===== SEMANA ===== */}
      {tab === 'semana' && (
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ height: '4px', background: 'var(--blue)' }} />
          <div style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '8px', height: '160px' }}>
              {diasSemana.map((dia, i) => {
                const esHoy = i === 6;
                const estudióEseDia = rachaData.find(r => r.fecha === dia.fecha && r.estudió);
                const altura = maxSesiones > 0 ? Math.max(8, (dia.total / maxSesiones) * 120) : 8;
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                    {dia.total > 0 && (
                      <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--blue)' }}>{dia.total}</span>
                    )}
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '120px' }}>
                      <div style={{
                        width: '100%',
                        height: dia.total > 0 ? `${altura}px` : '4px',
                        background: esHoy ? 'var(--gold)' : estudióEseDia ? 'var(--blue)' : 'var(--border-color)',
                        borderRadius: '6px 6px 0 0',
                        transition: 'height 0.5s ease',
                        opacity: dia.total === 0 ? 0.3 : 1,
                      }} />
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: esHoy ? 800 : 600, color: esHoy ? 'var(--gold)' : 'var(--text-muted)' }}>
                      {dia.dia}
                    </span>
                    {estudióEseDia && !esHoy && <span style={{ fontSize: '10px' }}>🔥</span>}
                    {esHoy && <span style={{ fontSize: '10px', color: 'var(--gold)', fontWeight: 800 }}>{idioma === 'en' ? 'TODAY' : 'HOY'}</span>}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: '20px', padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: '10px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
              <div>
                <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{tr('estaSemana')}</span>
                <p style={{ fontSize: '18px', fontWeight: 900, color: 'var(--blue)', margin: 0 }}>
                  {diasConActividad} {tr('diasActivos')}
                </p>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{tr('sesionesTotales')}</span>
                <p style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
                  {diasSemana.reduce((a, d) => a + d.total, 0)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== MATERIAS ===== */}
      {tab === 'materias' && (
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ height: '4px', background: 'var(--gold)' }} />
          <div style={{ padding: '24px' }}>
            {materiasArr.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>📚</div>
                <p style={{ color: 'var(--text-faint)', fontSize: '14px', margin: 0 }}>{tr('estudiaFlashcards')}</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {materiasArr.map((m, i) => {
                  const precision = m.totalFlashcards > 0 ? Math.round((m.acertadas / m.totalFlashcards) * 100) : 0;
                  const barWidth = Math.round((m.totalFlashcards / maxTotal) * 100);
                  return (
                    <div key={i}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>{m.nombre}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', color: '#4ade80' }}>✓ {m.acertadas}</span>
                          <span style={{ fontSize: '11px', color: 'var(--red)' }}>✗ {m.falladas}</span>
                          <span style={{ fontSize: '13px', fontWeight: 800, color: precision >= 70 ? '#4ade80' : precision >= 50 ? 'var(--gold)' : 'var(--red)' }}>
                            {precision}%
                          </span>
                        </div>
                      </div>
                      <div style={{ background: 'var(--bg-secondary)', borderRadius: '8px', height: '12px', overflow: 'hidden', position: 'relative' }}>
                        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${barWidth}%`, display: 'flex', borderRadius: '8px', overflow: 'hidden' }}>
                          <div style={{ background: '#4ade80', width: `${(m.acertadas / m.totalFlashcards) * 100}%`, transition: 'width 0.8s' }} />
                          <div style={{ background: 'var(--red)', flex: 1, opacity: 0.7 }} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>{m.totalFlashcards} {tr('flashcardsEstudiadas')}</span>
                        {m.quizzes > 0 && (
                          <span style={{ fontSize: '10px', color: '#a78bfa' }}>🤓 {m.quizzes} {tr('quizzes')}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== RACHA 30 DÍAS ===== */}
      {tab === 'racha' && (
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{ height: '4px', background: 'var(--red)' }} />
          <div style={{ padding: '24px' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 16px' }}>
              {tr('ultimos30')}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: '4px', marginBottom: '20px' }}>
              {rachaData.map((d, i) => {
                const esHoy = i === rachaData.length - 1;
                return (
                  <div key={i} title={`${d.fecha}${d.estudió ? ' 🔥' : ''}`}
                    style={{ aspectRatio: '1', borderRadius: '6px', background: d.estudió ? 'var(--gold)' : 'var(--bg-secondary)', border: esHoy ? '2px solid var(--gold)' : '1px solid var(--border-color)', cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px' }}>
                    {d.estudió && <span>🔥</span>}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              {[
                { label: tr('diasActivosLabel'), value: rachaData.filter(d => d.estudió).length, color: 'var(--gold)' },
                { label: tr('diasInactivos'), value: rachaData.filter(d => !d.estudió).length, color: 'var(--text-faint)' },
                { label: tr('actividad'), value: `${Math.round((rachaData.filter(d => d.estudió).length / 30) * 100)}%`, color: 'var(--blue)' },
              ].map((s, i) => (
                <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '22px', fontWeight: 900, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginTop: '2px' }}>{s.label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '16px', marginTop: '16px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '14px', height: '14px', borderRadius: '4px', background: 'var(--gold)' }} />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{tr('diaActivo')}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '14px', height: '14px', borderRadius: '4px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{tr('sinActividad')}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}