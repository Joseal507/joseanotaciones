'use client';

type Screen = 'home' | 'upload' | 'document' | 'flashcards';

interface Analysis {
  keywords: string[];
  important_phrases: string[];
  summary: string;
}

interface Props {
  documentContent: string;
  flashcards: any[];
  analysis: Analysis | null;
  onSetScreen: (s: Screen) => void;
}

export default function HomeScreen({ documentContent, flashcards, analysis, onSetScreen }: Props) {
  const cards = [
    { color: 'var(--gold)', emoji: '📄', title: 'Analizar Documentos', desc: 'Sube un PDF, Word o TXT y la IA lo analiza, encuentra palabras clave y frases importantes.', btn: 'Subir documento →', action: () => onSetScreen('upload') },
    { color: 'var(--pink)', emoji: '🎴', title: 'Flashcards', desc: 'Genera tarjetas de estudio automáticamente desde tu documento. Elige cuántas quieres.', btn: 'Ver flashcards →', action: () => onSetScreen('flashcards') },
    { color: 'var(--blue)', emoji: '📖', title: 'Ver Documento', desc: 'Visualiza tu documento con highlights de palabras clave y frases importantes marcadas.', btn: 'Ver documento →', action: () => onSetScreen('document') },
    { color: 'var(--red)', emoji: '📚', title: 'Materias', desc: 'Organiza tus materias, temas, apuntes y documentos en un solo lugar estructurado.', btn: 'Mis materias →', action: () => window.location.href = '/materias' },
  ];

  const stats = [
    { label: 'Documentos', value: documentContent ? '1' : '0', color: 'var(--gold)' },
    { label: 'Flashcards', value: flashcards.length.toString(), color: 'var(--pink)' },
    { label: 'Palabras clave', value: analysis?.keywords?.length?.toString() || '0', color: 'var(--blue)' },
    { label: 'Frases', value: analysis?.important_phrases?.length?.toString() || '0', color: 'var(--red)' },
  ];

  const features = [
    { icon: '🔍', text: 'Análisis inteligente', color: 'var(--gold)' },
    { icon: '✍️', text: 'Highlights automáticos', color: 'var(--blue)' },
    { icon: '🎴', text: 'Flashcards ilimitadas', color: 'var(--pink)' },
    { icon: '📊', text: 'Resumen del contenido', color: 'var(--red)' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '70px 40px 60px', textAlign: 'center' }}>

      {/* Logo */}
      <div style={{ width: '110px', height: '110px', borderRadius: '28px', border: '3px solid var(--gold)', overflow: 'hidden', marginBottom: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-card)', fontSize: '48px' }}>
        <img src="/logo.png" alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={(e: any) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '📚'; }} />
      </div>

      {/* Título */}
      <h1 style={{ fontSize: '60px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 8px 0', letterSpacing: '-2px', lineHeight: 1 }}>
        JOSEANOTACIONES
      </h1>

      {/* Línea colores */}
      <div style={{ display: 'flex', gap: '6px', margin: '16px 0 20px' }}>
        {['var(--gold)', 'var(--red)', 'var(--blue)', 'var(--pink)'].map((c, i) => (
          <div key={i} style={{ width: '40px', height: '4px', background: c, borderRadius: '2px' }} />
        ))}
      </div>

      <p style={{ fontSize: '20px', color: 'var(--text-muted)', margin: '0 0 52px 0', maxWidth: '460px' }}>
        Mi plataforma para tirar estudio 💪
      </p>

      {/* Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '20px', maxWidth: '920px', width: '100%', marginBottom: '52px' }}>
        {cards.map((card, i) => (
          <div key={i} onClick={card.action}
            style={{ background: 'var(--bg-card)', borderRadius: '20px', border: '1px solid var(--border-color)', overflow: 'hidden', cursor: 'pointer', transition: 'all 0.25s ease', textAlign: 'left' }}
            onMouseEnter={(e: any) => { e.currentTarget.style.transform = 'translateY(-6px)'; e.currentTarget.style.borderColor = card.color; }}
            onMouseLeave={(e: any) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
          >
            <div style={{ height: '5px', background: card.color }} />
            <div style={{ padding: '24px' }}>
              <div style={{ width: '50px', height: '50px', borderRadius: '14px', background: card.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', marginBottom: '14px' }}>
                {card.emoji}
              </div>
              <h3 style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px 0' }}>{card.title}</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 18px 0', lineHeight: 1.6 }}>{card.desc}</p>
              <div style={{ display: 'inline-flex', alignItems: 'center', background: card.color, color: '#000', padding: '7px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 800 }}>
                {card.btn}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '1px', background: 'var(--border-color)', borderRadius: '16px', overflow: 'hidden', maxWidth: '680px', width: '100%', marginBottom: '40px' }}>
        {stats.map((stat, i) => (
          <div key={i} style={{ flex: 1, background: 'var(--bg-card)', padding: '18px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: '26px', fontWeight: 900, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, marginTop: '4px' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Botón */}
      <button onClick={() => onSetScreen('upload')}
        style={{ padding: '16px 44px', borderRadius: '14px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '17px', fontWeight: 900, cursor: 'pointer', letterSpacing: '0.5px', transition: 'all 0.2s ease' }}
        onMouseEnter={(e: any) => e.currentTarget.style.transform = 'scale(1.05)'}
        onMouseLeave={(e: any) => e.currentTarget.style.transform = 'scale(1)'}>
        🚀 EMPEZAR AHORA
      </button>

      {/* Features */}
      <div style={{ display: 'flex', gap: '28px', marginTop: '40px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {features.map((feat, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: feat.color }} />
            <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>{feat.icon} {feat.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}