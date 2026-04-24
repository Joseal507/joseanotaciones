'use client';

type Screen = 'home' | 'upload' | 'document' | 'flashcards';

interface Props {
  screen: Screen;
  darkMode: boolean;
  onToggleDark: () => void;
  onSetScreen: (s: Screen) => void;
}

export default function Navbar({ screen, darkMode, onToggleDark, onSetScreen }: Props) {
  return (
    <>
      <header style={{
        background: 'var(--bg-card)',
        borderBottom: '3px solid var(--gold)',
        padding: '0 40px',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: '68px',
      }}>
        <div onClick={() => onSetScreen('home')} style={{ display: 'flex', alignItems: 'center', gap: '14px', cursor: 'pointer' }}>
          <img src="/logo.png" alt="Logo"
            style={{ width: '42px', height: '42px', borderRadius: '10px', objectFit: 'cover' }}
            onError={(e: any) => { e.target.style.display = 'none'; }}
          />
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 900, margin: 0 }}><span style={{ fontSize: '85%', fontWeight: 700, color: 'var(--text-primary)' }}>Study</span><span style={{ color: 'var(--gold)' }}>AL</span></h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0 }}>Tu plataforma de estudio definitiva</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {screen !== 'home' && (
            <>
              {[
                { id: 'upload', label: 'Subir', color: 'var(--gold)' },
                { id: 'document', label: 'Documento', color: 'var(--blue)' },
                { id: 'flashcards', label: 'Flashcards', color: 'var(--pink)' },
              ].map(tab => (
                <button key={tab.id} onClick={() => onSetScreen(tab.id as Screen)}
                  style={{
                    padding: '8px 16px', borderRadius: '8px',
                    border: screen === tab.id ? `2px solid ${tab.color}` : '2px solid transparent',
                    background: 'transparent',
                    color: screen === tab.id ? tab.color : 'var(--text-muted)',
                    fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                  }}>
                  {tab.label}
                </button>
              ))}
              <div style={{ width: '1px', height: '24px', background: 'var(--border-color)', margin: '0 4px' }} />
            </>
          )}
          <button onClick={() => window.location.href = '/materias'}
            style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--red)', background: 'transparent', color: 'var(--red)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
            📚 Materias
          </button>
          <button onClick={onToggleDark}
            style={{ padding: '8px 14px', borderRadius: '8px', border: '2px solid var(--gold)', background: 'transparent', color: 'var(--gold)', cursor: 'pointer', fontSize: '14px', fontWeight: 700 }}>
            {darkMode ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', height: '3px' }}>
        <div style={{ flex: 1, background: 'var(--gold)' }} />
        <div style={{ flex: 1, background: 'var(--red)' }} />
        <div style={{ flex: 1, background: 'var(--blue)' }} />
        <div style={{ flex: 1, background: 'var(--pink)' }} />
      </div>
    </>
  );
}