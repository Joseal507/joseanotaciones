'use client';

interface Props {
  pasoActual: number;
  temaColor: string;
  esImagen: boolean;
  idioma: string;
}

export default function BannerCargando({ pasoActual, temaColor, esImagen, idioma }: Props) {
  const pasos = [
    {
      step: 1,
      label: esImagen
        ? (idioma === 'en' ? '🖼️ Extracting text and visual elements...' : '🖼️ Extrayendo texto y elementos visuales...')
        : (idioma === 'en' ? '🔍 Analyzing document with deep AI...' : '🔍 Analizando documento con AI profunda...'),
    },
    { step: 2, label: idioma === 'en' ? '🤖 AI calculating optimal flashcard count...' : '🤖 AI calculando el número óptimo de flashcards...' },
    { step: 3, label: idioma === 'en' ? '🎴 Generating unique flashcards...' : '🎴 Generando flashcards únicas...' },
  ];

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: '14px', border: `2px solid ${temaColor}44`, padding: '20px', marginBottom: '20px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {pasos.map((s) => {
          const done = pasoActual > s.step;
          const active = pasoActual === s.step;
          return (
            <div key={s.step} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '10px', background: done ? '#4ade8015' : active ? `${temaColor}15` : 'transparent', border: `1px solid ${done ? '#4ade8044' : active ? `${temaColor}44` : 'var(--border-color)'}`, transition: 'all 0.4s ease' }}>
              <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: done ? '#4ade80' : active ? temaColor : 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: done ? '14px' : '12px', fontWeight: 800, color: done || active ? '#000' : 'var(--text-faint)', flexShrink: 0, transition: 'all 0.4s ease' }}>
                {done ? '✓' : s.step}
              </div>
              <p style={{ fontSize: '13px', margin: 0, flex: 1, color: done ? '#4ade80' : active ? temaColor : 'var(--text-faint)', fontWeight: done || active ? 700 : 400, transition: 'all 0.4s ease' }}>
                {s.label}
              </p>
              {active && (
                <div style={{ display: 'flex', gap: '3px' }}>
                  {[0, 1, 2].map(j => (
                    <div key={j} style={{ width: '6px', height: '6px', borderRadius: '50%', background: temaColor, animation: `stepBounce 1s ${j * 0.2}s infinite` }} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: '14px', background: 'var(--bg-secondary)', borderRadius: '8px', height: '6px', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: '8px', background: pasoActual >= 4 ? '#4ade80' : temaColor, width: `${Math.min(100, (pasoActual / 3) * 100)}%`, transition: 'width 0.6s ease, background 0.4s ease' }} />
      </div>
      <style>{`@keyframes stepBounce { 0%,100%{transform:translateY(0);opacity:0.5} 50%{transform:translateY(-4px);opacity:1} }`}</style>
    </div>
  );
}