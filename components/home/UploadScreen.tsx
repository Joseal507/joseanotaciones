'use client';

interface Props {
  file: File | null;
  loading: boolean;
  message: string;
  loadingStep: number;
  flashcardCount: number;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onUpload: () => void;
  onSetCount: (n: number) => void;
  onVerDocumento: () => void;
}

const steps = [
  { label: '📤 Subiendo archivo...', step: 1 },
  { label: '🔍 Analizando contenido...', step: 2 },
  { label: '🎴 Generando flashcards...', step: 3 },
];

export default function UploadScreen({ file, loading, message, loadingStep, flashcardCount, onFileChange, onUpload, onSetCount, onVerDocumento }: Props) {
  return (
    <div style={{ maxWidth: '580px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
        <div style={{ width: '6px', height: '40px', background: 'var(--gold)', borderRadius: '3px' }} />
        <div>
          <h2 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Subir Documento</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>PDF, Word o TXT</p>
        </div>
      </div>

      <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <div style={{ height: '4px', background: 'var(--gold)' }} />
        <div style={{ padding: '32px' }}>

          {/* Zona carga */}
          <label htmlFor="file-upload" style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            border: `2px dashed ${file ? 'var(--gold)' : 'var(--border-color)'}`,
            borderRadius: '12px', padding: '48px 32px', cursor: 'pointer',
            background: file ? 'var(--gold-dim)' : 'var(--bg-secondary)', transition: 'all 0.3s ease',
          }}>
            <input type="file" accept=".pdf,.doc,.docx,.txt" onChange={onFileChange} style={{ display: 'none' }} id="file-upload" />
            <div style={{ width: '64px', height: '64px', borderRadius: '16px', background: file ? 'var(--gold)' : 'var(--bg-card2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', marginBottom: '16px' }}>
              {file ? '📎' : '📄'}
            </div>
            <p style={{ fontSize: '16px', color: file ? 'var(--gold)' : 'var(--text-muted)', fontWeight: 600, textAlign: 'center', margin: '0 0 4px 0' }}>
              {file ? file.name : 'Haz clic para seleccionar'}
            </p>
            <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0 }}>PDF, Word o TXT</p>
          </label>

          {/* Selector flashcards */}
          <div style={{ marginTop: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ width: '4px', height: '18px', background: 'var(--blue)', borderRadius: '2px' }} />
              <p style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 700, margin: 0 }}>¿Cuántas flashcards?</p>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[5, 8, 10, 15, 20, 25, 30].map(num => (
                <button key={num} onClick={() => onSetCount(num)}
                  style={{ padding: '8px 14px', borderRadius: '8px', border: `2px solid ${flashcardCount === num ? 'var(--blue)' : 'var(--border-color)'}`, cursor: 'pointer', fontSize: '14px', fontWeight: 700, background: flashcardCount === num ? 'var(--blue)' : 'transparent', color: flashcardCount === num ? '#000' : 'var(--text-muted)', transition: 'all 0.15s ease' }}>
                  {num}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
              <span style={{ color: 'var(--text-faint)', fontSize: '12px' }}>Personalizado:</span>
              <input type="number" min={1} max={50} value={flashcardCount}
                onChange={e => onSetCount(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
                style={{ width: '70px', padding: '8px 12px', borderRadius: '8px', border: '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 700, textAlign: 'center' }}
              />
              <span style={{ color: 'var(--text-faint)', fontSize: '12px' }}>tarjetas</span>
            </div>
          </div>

          {/* Botón */}
          <button onClick={onUpload} disabled={!file || loading}
            style={{ width: '100%', marginTop: '24px', padding: '16px', borderRadius: '12px', border: 'none', cursor: file && !loading ? 'pointer' : 'not-allowed', fontSize: '16px', fontWeight: 800, color: file && !loading ? '#000' : 'var(--text-faint)', background: file && !loading ? 'var(--gold)' : 'var(--bg-card2)', transition: 'all 0.2s ease' }}>
            {loading ? '⏳ PROCESANDO...' : `🚀 ANALIZAR Y GENERAR ${flashcardCount} FLASHCARDS`}
          </button>

          {/* Pasos */}
          {loading && (
            <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {steps.map(s => (
                <div key={s.step} style={{ padding: '12px 16px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '10px', background: loadingStep >= s.step ? 'var(--gold-dim)' : 'transparent', border: `1px solid ${loadingStep >= s.step ? 'var(--gold)' : 'var(--border-color)'}`, color: loadingStep >= s.step ? 'var(--gold)' : 'var(--text-faint)', fontWeight: loadingStep >= s.step ? 700 : 400, fontSize: '14px', transition: 'all 0.4s ease' }}>
                  <span>{loadingStep > s.step ? '✅' : loadingStep === s.step ? '⏳' : '⭕'}</span>
                  {s.label}
                </div>
              ))}
            </div>
          )}

          {/* Mensaje */}
          {message && !loading && (
            <div style={{ marginTop: '16px', padding: '14px 16px', borderRadius: '10px', textAlign: 'center', fontSize: '14px', fontWeight: 700, background: message.includes('✅') ? 'var(--blue)' : message.includes('❌') ? 'var(--red)' : 'var(--gold)', color: '#000' }}>
              {message}
              {message.includes('✅') && (
                <button onClick={onVerDocumento}
                  style={{ marginLeft: '12px', padding: '5px 12px', borderRadius: '6px', border: 'none', background: '#000', color: 'var(--blue)', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>
                  Ver documento →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}