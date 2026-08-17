"use client";

const HAND = "var(--font-hand)";
const BODY = "var(--font-body)";

interface Props {
  materiales: any[];
  temaId?: string;
  onClose: () => void;
}

export default function StudyALManual({ materiales, temaId, onClose }: Props) {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg-primary)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: HAND, zIndex: 9999,
    }}>
      <div style={{
        textAlign: 'center',
        maxWidth: 500,
        padding: 40,
      }}>
        <div style={{ fontSize: 80, marginBottom: 20 }}>🎯</div>
        <h1 style={{
          fontSize: 48, fontWeight: 900,
          color: '#a78bfa', margin: '0 0 12px',
          textShadow: '0 0 30px rgba(167,139,250,0.4)',
        }}>
          Modo Manual
        </h1>
        <p style={{
          fontSize: 20, color: 'var(--text-muted)',
          marginBottom: 8,
        }}>
          aquí va a estar el modo manual
        </p>
        <p style={{
          fontSize: 15, color: 'var(--text-faint)',
          fontFamily: BODY, lineHeight: 1.5,
          marginBottom: 32,
        }}>
          Vos definís el orden, las herramientas y los tiempos.
          Control total del proceso de estudio. Próximamente.
        </p>
        <div style={{
          fontSize: 14, color: 'var(--text-faint)',
          fontFamily: BODY, marginBottom: 32,
        }}>
          📄 {materiales.length} {materiales.length === 1 ? 'material' : 'materiales'} seleccionado{materiales.length !== 1 ? 's' : ''}
        </div>
        <button
          onClick={onClose}
          style={{
            padding: '12px 28px',
            background: '#a78bfa',
            color: '#000',
            border: '2.5px solid var(--text-primary)',
            borderRadius: 14,
            fontFamily: HAND,
            fontSize: 22, fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '3px 4px 0 var(--text-primary)',
          }}
        >
          ← volver al mapa
        </button>
      </div>
    </div>
  );
}
