'use client';

import { useEffect, useState } from 'react';
import { getIdioma } from '../../lib/i18n';
import MathRenderer, { cleanMath } from './MathRenderer';

interface Paso {
  numero: number;
  titulo: string;
  explicacion: string;
  operacion: string;
  resultado: string;
}

interface Resultado {
  problema: string;
  tipo: string;
  dificultad: string;
  pasos: Paso[];
  respuesta_final: string;
  respuesta_texto: string;
  verificacion?: string;
  consejo?: string;
}

interface Props {
  imageBase64: string;
  imageMime?: string;
  temaColor: string;
  onClose: () => void;
  onInsertarSolucion: (html: string) => void;
}

const PETER_GOLD = '#f5c842';
const PETER_RED = '#ff4d6d';
const PETER_EMOJI = '👨🏿‍🏫';

const TIPO_EMOJI: Record<string, string> = {
  algebra: '📐',
  calculo: '∫',
  geometria: '📏',
  aritmetica: '🔢',
  trigonometria: '📐',
  estadistica: '📊',
  otro: '🧮',
  calculus: '∫',
  geometry: '📏',
  arithmetic: '🔢',
  trigonometry: '📐',
  statistics: '📊',
  other: '🧮',
};

const DIFICULTAD_COLOR: Record<string, string> = {
  basico: '#4ade80',
  basic: '#4ade80',
  intermedio: PETER_GOLD,
  intermediate: PETER_GOLD,
  avanzado: PETER_RED,
  advanced: PETER_RED,
};

export default function PeterSauPeter({
  imageBase64,
  imageMime = 'image/png',
  temaColor: _temaColor,
  onClose,
  onInsertarSolucion,
}: Props) {
  const idioma = getIdioma();
  const [cargando, setCargando] = useState(true);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState('');
  const [pasoActivo, setPasoActivo] = useState(0);
  const [textoManual, setTextoManual] = useState('');
  const [modoManual, setModoManual] = useState(false);

  useEffect(() => {
    resolverImagen();
  }, []);

  const resolverImagen = async () => {
    setCargando(true);
    setError('');
    setResultado(null);
    try {
      const res = await fetch('/api/petersaupeter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, imageMime, idioma }),
      });
      const data = await res.json();
      if (data.success) {
        setResultado(data.resultado);
        setPasoActivo(0);
      } else {
        setError(data.error || 'Error resolviendo');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  };

  const resolverManual = async () => {
    if (!textoManual.trim()) return;
    setCargando(true);
    setError('');
    setResultado(null);
    try {
      const res = await fetch('/api/petersaupeter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: textoManual, idioma }),
      });
      const data = await res.json();
      if (data.success) {
        setResultado(data.resultado);
        setPasoActivo(0);
        setModoManual(false);
      } else {
        setError(data.error || 'Error resolviendo');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  };

  const insertar = () => {
    if (!resultado) return;

    const pasos = resultado.pasos.map(p => `
      <div style="margin:10px 0;padding:10px 12px;border-radius:10px;background:#fff7db;border:1px solid rgba(245,200,66,0.35)">
        <p style="margin:0 0 4px;font-weight:800;color:#b45309">${p.numero}. ${p.titulo}</p>
        <p style="margin:0 0 6px;color:#1f2937">${p.explicacion}</p>
        <p style="margin:0;padding:6px 10px;border-radius:8px;background:#ffffff;border:1px solid #f3e3a2;font-family:monospace;color:#111827">
          ${p.operacion} = ${p.resultado}
        </p>
      </div>
    `).join('');

    const html = `
      <div style="margin:10px 0;padding:14px 16px;border-radius:14px;border:2px solid ${PETER_GOLD};background:linear-gradient(135deg, rgba(245,200,66,0.12), rgba(255,77,109,0.06))">
        <p style="margin:0 0 6px;font-weight:900;color:${PETER_RED};font-size:15px">${PETER_EMOJI} Peter SauPeter</p>
        <p style="margin:0 0 10px;font-style:italic;color:#374151">${resultado.problema}</p>
        ${pasos}
        <div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:${PETER_GOLD}22;border:1px solid ${PETER_GOLD}">
          <p style="margin:0;font-weight:900;color:#111827">✅ Respuesta: ${resultado.respuesta_final}</p>
        </div>
        ${resultado.consejo ? `<p style="margin:10px 0 0;color:#6b7280;font-size:13px">💡 ${resultado.consejo}</p>` : ''}
      </div>
    `;

    onInsertarSolucion(html);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.88)',
        zIndex: 5000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        fontFamily: '-apple-system, sans-serif',
      }}
    >
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: '26px',
          border: `2px solid ${PETER_GOLD}`,
          width: '100%',
          maxWidth: '700px',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: `0 28px 90px rgba(0,0,0,0.55), 0 0 40px rgba(245,200,66,0.15), 0 0 20px rgba(255,77,109,0.12)`,
          animation: 'slideUp 0.28s ease',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            background: `linear-gradient(135deg, rgba(245,200,66,0.22), rgba(255,77,109,0.14))`,
            borderBottom: `2px solid rgba(245,200,66,0.35)`,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: '50px',
              height: '50px',
              borderRadius: '14px',
              background: `linear-gradient(135deg, ${PETER_GOLD}, ${PETER_RED})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '26px',
              flexShrink: 0,
              boxShadow: `0 8px 24px rgba(245,200,66,0.25)`,
            }}
          >
            {PETER_EMOJI}
          </div>

          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
              Peter SauPeter
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
              {idioma === 'en'
                ? 'Elite math solver — step by step'
                : 'Resolutor matemático élite — paso a paso'}
            </p>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              color: 'var(--text-muted)',
              fontSize: '14px',
              cursor: 'pointer',
              padding: '8px 10px',
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Imagen */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <img
              src={`data:${imageMime};base64,${imageBase64}`}
              alt="Ecuación seleccionada"
              style={{
                maxWidth: '100%',
                maxHeight: '170px',
                borderRadius: '14px',
                border: `2px solid rgba(245,200,66,0.3)`,
                objectFit: 'contain',
                background: '#fff',
                padding: '10px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              }}
            />
          </div>

          {/* Loading */}
          {cargando && (
            <div style={{ textAlign: 'center', padding: '36px 0' }}>
              <div style={{ fontSize: '42px', marginBottom: '12px' }}>{PETER_EMOJI}</div>
              <p style={{ fontSize: '16px', fontWeight: 800, color: PETER_GOLD, margin: '0 0 6px' }}>
                {idioma === 'en' ? 'Peter is solving...' : 'Peter está resolviendo...'}
              </p>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 16px' }}>
                {idioma === 'en'
                  ? 'Reading the equation and generating steps'
                  : 'Leyendo la ecuación y generando pasos'}
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '6px' }}>
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: i % 2 === 0 ? PETER_GOLD : PETER_RED,
                      animation: `bounce 0.8s ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && !cargando && !modoManual && (
            <div style={{ padding: '16px', borderRadius: '14px', background: 'rgba(255,77,109,0.1)', border: '1px solid rgba(255,77,109,0.35)' }}>
              <p style={{ color: PETER_RED, fontSize: '14px', margin: '0 0 12px', fontWeight: 700 }}>❌ {error}</p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={resolverImagen}
                  style={{
                    padding: '9px 16px',
                    borderRadius: '10px',
                    border: 'none',
                    background: PETER_GOLD,
                    color: '#000',
                    fontWeight: 800,
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
                  🔄 {idioma === 'en' ? 'Try again' : 'Reintentar'}
                </button>
                <button
                  onClick={() => setModoManual(true)}
                  style={{
                    padding: '9px 16px',
                    borderRadius: '10px',
                    border: `2px solid ${PETER_RED}`,
                    background: 'transparent',
                    color: PETER_RED,
                    fontWeight: 800,
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
                  ⌨️ {idioma === 'en' ? 'Type problem' : 'Escribir problema'}
                </button>
              </div>
            </div>
          )}

          {/* Manual mode */}
          {modoManual && !resultado && !cargando && (
            <div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 10px' }}>
                {idioma === 'en'
                  ? 'Type the math problem exactly:'
                  : 'Escribe el problema matemático exactamente:'}
              </p>
              <textarea
                value={textoManual}
                onChange={e => setTextoManual(e.target.value)}
                placeholder={idioma === 'en' ? 'Example: x^2 + 5x + 6 = 0' : 'Ejemplo: x^2 + 5x + 6 = 0'}
                rows={3}
                autoFocus
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '12px',
                  border: `2px solid ${PETER_GOLD}`,
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '15px',
                  fontFamily: 'Georgia, serif',
                  resize: 'none',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <button
                  onClick={() => setModoManual(false)}
                  style={{
                    padding: '10px 16px',
                    borderRadius: '10px',
                    border: '2px solid var(--border-color)',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
                  ← {idioma === 'en' ? 'Back' : 'Volver'}
                </button>
                <button
                  onClick={resolverManual}
                  disabled={!textoManual.trim()}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '10px',
                    border: 'none',
                    background: textoManual.trim() ? PETER_GOLD : 'var(--bg-card2)',
                    color: textoManual.trim() ? '#000' : 'var(--text-faint)',
                    fontWeight: 900,
                    cursor: textoManual.trim() ? 'pointer' : 'not-allowed',
                    fontSize: '14px',
                  }}
                >
                  {PETER_EMOJI} {idioma === 'en' ? 'Solve' : 'Resolver'}
                </button>
              </div>
            </div>
          )}

          {/* Resultado */}
          {resultado && !cargando && (
            <>
              {/* Tags */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ padding: '4px 12px', borderRadius: '20px', background: 'rgba(245,200,66,0.16)', color: '#d97706', fontSize: '12px', fontWeight: 800 }}>
                  {TIPO_EMOJI[resultado.tipo] || '🧮'} {resultado.tipo}
                </span>
                <span style={{ padding: '4px 12px', borderRadius: '20px', background: (DIFICULTAD_COLOR[resultado.dificultad] || '#888') + '20', color: DIFICULTAD_COLOR[resultado.dificultad] || '#888', fontSize: '12px', fontWeight: 800 }}>
                  {resultado.dificultad}
                </span>
              </div>

              {/* Problema */}
              <div style={{ background: 'var(--bg-secondary)', borderRadius: '14px', padding: '14px 16px', border: '1px solid var(--border-color)' }}>
                <p style={{ fontSize: '11px', color: PETER_RED, fontWeight: 800, textTransform: 'uppercase', margin: '0 0 4px', letterSpacing: '1px' }}>
                  Problema detectado
                </p>
                <p style={{ fontSize: '16px', color: 'var(--text-primary)', margin: 0, fontFamily: 'Georgia, serif', fontWeight: 700 }}>
                  {resultado.problema}
                </p>
              </div>

              {/* Respuesta final */}
              <div
                style={{
                  background: 'linear-gradient(135deg, rgba(245,200,66,0.18), rgba(255,77,109,0.08))',
                  border: `2px solid ${PETER_GOLD}`,
                  borderRadius: '18px',
                  padding: '18px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  boxShadow: '0 10px 30px rgba(245,200,66,0.12)',
                }}
              >
                <div style={{ fontSize: '34px' }}>{PETER_EMOJI}</div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: '11px', fontWeight: 900, color: PETER_RED, textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 4px' }}>
                    Respuesta Final
                  </p>
                  <div style={{ fontSize: '26px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
                    <MathRenderer math={cleanMath(resultado.respuesta_final)} display={true} />
                  </div>
                  {resultado.respuesta_texto && (
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '6px 0 0' }}>
                      {resultado.respuesta_texto}
                    </p>
                  )}
                </div>
              </div>

              {/* Pasos */}
              <div>
                <p style={{ fontSize: '12px', fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 10px' }}>
                  📋 {resultado.pasos.length} {idioma === 'en' ? 'Steps' : 'Pasos'}
                </p>

                <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', overflowX: 'auto', paddingBottom: '4px' }}>
                  {resultado.pasos.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setPasoActivo(i)}
                      style={{
                        minWidth: '34px',
                        height: '34px',
                        borderRadius: '50%',
                        border: `2px solid ${pasoActivo === i ? PETER_RED : 'var(--border-color)'}`,
                        background: pasoActivo === i ? PETER_GOLD : 'transparent',
                        color: pasoActivo === i ? '#000' : 'var(--text-muted)',
                        fontSize: '13px',
                        fontWeight: 900,
                        cursor: 'pointer',
                        flexShrink: 0,
                        transition: 'all 0.2s',
                      }}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>

                {resultado.pasos[pasoActivo] && (
                  <div
                    style={{
                      background: 'var(--bg-secondary)',
                      borderRadius: '18px',
                      border: `2px solid rgba(245,200,66,0.35)`,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        padding: '12px 16px',
                        background: 'linear-gradient(135deg, rgba(245,200,66,0.18), rgba(255,77,109,0.08))',
                        borderBottom: '1px solid rgba(245,200,66,0.22)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                      }}
                    >
                      <div
                        style={{
                          width: '30px',
                          height: '30px',
                          borderRadius: '50%',
                          background: PETER_GOLD,
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '13px',
                          fontWeight: 900,
                          color: '#000',
                        }}
                      >
                        {resultado.pasos[pasoActivo].numero}
                      </div>
                      <p style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                        {resultado.pasos[pasoActivo].titulo}
                      </p>
                    </div>

                    <div style={{ padding: '16px' }}>
                      <p style={{ fontSize: '14px', color: 'var(--text-primary)', margin: '0 0 14px', lineHeight: 1.7 }}>
                        {resultado.pasos[pasoActivo].explicacion}
                      </p>

                      {resultado.pasos[pasoActivo].operacion && (
                        <div style={{ background: 'var(--bg-card)', borderRadius: '10px', padding: '10px 14px', marginBottom: '10px', border: '1px solid var(--border-color)' }}>
                          <p style={{ fontSize: '10px', color: PETER_RED, fontWeight: 800, textTransform: 'uppercase', margin: '0 0 4px' }}>
                            Operación
                          </p>
                          <div style={{ fontSize: '18px', color: 'var(--text-primary)', margin: 0, overflowX: 'auto' }}>
                            <MathRenderer math={cleanMath(resultado.pasos[pasoActivo].operacion)} display={true} />
                          </div>
                        </div>
                      )}

                      {resultado.pasos[pasoActivo].resultado && (
                        <div style={{ background: 'rgba(245,200,66,0.14)', borderRadius: '10px', padding: '10px 14px', border: `1px solid rgba(245,200,66,0.4)` }}>
                          <p style={{ fontSize: '10px', color: '#b45309', fontWeight: 800, textTransform: 'uppercase', margin: '0 0 4px' }}>
                            Resultado
                          </p>
                          <div style={{ fontSize: '20px', color: 'var(--text-primary)', margin: 0, fontWeight: 700, overflowX: 'auto' }}>
                            <MathRenderer math={cleanMath(resultado.pasos[pasoActivo].resultado)} display={true} />
                          </div>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', borderTop: '1px solid rgba(245,200,66,0.18)' }}>
                      <button
                        onClick={() => setPasoActivo(Math.max(0, pasoActivo - 1))}
                        disabled={pasoActivo === 0}
                        style={{
                          flex: 1,
                          padding: '10px',
                          border: 'none',
                          background: 'transparent',
                          color: pasoActivo === 0 ? 'var(--text-faint)' : PETER_RED,
                          fontWeight: 700,
                          cursor: pasoActivo === 0 ? 'not-allowed' : 'pointer',
                          fontSize: '13px',
                          borderRight: '1px solid rgba(245,200,66,0.18)',
                        }}
                      >
                        ← Anterior
                      </button>
                      <button
                        onClick={() => setPasoActivo(Math.min(resultado.pasos.length - 1, pasoActivo + 1))}
                        disabled={pasoActivo === resultado.pasos.length - 1}
                        style={{
                          flex: 1,
                          padding: '10px',
                          border: 'none',
                          background: 'transparent',
                          color: pasoActivo === resultado.pasos.length - 1 ? 'var(--text-faint)' : PETER_RED,
                          fontWeight: 700,
                          cursor: pasoActivo === resultado.pasos.length - 1 ? 'not-allowed' : 'pointer',
                          fontSize: '13px',
                        }}
                      >
                        Siguiente →
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {resultado.verificacion && (
                <div style={{ background: 'rgba(255,77,109,0.08)', border: '1px solid rgba(255,77,109,0.2)', borderRadius: '12px', padding: '12px 14px' }}>
                  <p style={{ fontSize: '11px', fontWeight: 900, color: PETER_RED, margin: '0 0 4px', textTransform: 'uppercase' }}>
                    🔍 Verificación
                  </p>
                  <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: 0 }}>{resultado.verificacion}</p>
                </div>
              )}

              {resultado.consejo && (
                <div style={{ background: 'rgba(245,200,66,0.12)', border: '1px solid rgba(245,200,66,0.25)', borderRadius: '12px', padding: '12px 14px' }}>
                  <p style={{ fontSize: '11px', fontWeight: 900, color: '#b45309', margin: '0 0 4px', textTransform: 'uppercase' }}>
                    💡 Consejo
                  </p>
                  <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: 0 }}>{resultado.consejo}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {resultado && !cargando && (
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '8px', flexShrink: 0, background: 'var(--bg-secondary)' }}>
            <button
              onClick={resolverImagen}
              style={{
                padding: '10px 16px',
                borderRadius: '10px',
                border: `2px solid ${PETER_RED}`,
                background: 'transparent',
                color: PETER_RED,
                fontWeight: 800,
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              🔄 Reintentar
            </button>
            <button
              onClick={insertar}
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: '10px',
                border: 'none',
                background: PETER_GOLD,
                color: '#000',
                fontWeight: 900,
                cursor: 'pointer',
                fontSize: '14px',
                boxShadow: '0 8px 20px rgba(245,200,66,0.16)',
              }}
            >
              📝 Insertar en apuntes
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideUp { from { opacity:0; transform:translateY(20px) } to { opacity:1; transform:translateY(0) } }
        @keyframes bounce { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-6px) } }
      `}</style>
    </div>
  );
}
