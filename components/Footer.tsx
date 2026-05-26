'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useIdioma } from '../hooks/useIdioma';

const BODY = "var(--font-body)";

export default function Footer() {
  const { idioma } = useIdioma();
  const [showSugerencia, setShowSugerencia] = useState(false);
  const [sugerencia, setSugerencia] = useState('');
  const [enviado, setEnviado] = useState(false);

  const enviarSugerencia = async () => {
    if (!sugerencia.trim()) return;
    try {
      await fetch('/api/sugerencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensaje: sugerencia }),
      });
    } catch {}
    setEnviado(true);
    setSugerencia('');
    setTimeout(() => { setEnviado(false); setShowSugerencia(false); }, 2000);
  };

  return (
    <>
      <style>{`
        .nb-footer-link {
          display: inline-block;
          font-family: ${BODY};
          font-size: 14px;
          font-weight: 500;
          color: var(--text-secondary);
          text-decoration: none;
          margin: 0 0 4px;
          padding: 2px 0;
          transition: all 0.2s;
          position: relative;
        }
        .nb-footer-link:hover {
          color: var(--gold);
          transform: translateX(4px);
        }
        .nb-footer-link::after {
          content: '';
          position: absolute;
          left: 0; right: 0; bottom: 0;
          height: 1.5px;
          background: var(--gold);
          transform: scaleX(0);
          transform-origin: left;
          transition: transform 0.25s;
          border-radius: 2px;
        }
        .nb-footer-link:hover::after {
          transform: scaleX(1);
        }
        .nb-footer-social {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-family: ${BODY};
          font-size: 14px;
          font-weight: 500;
          color: var(--text-secondary);
          text-decoration: none;
          margin: 0 0 6px;
          padding: 4px 8px;
          border-radius: 8px;
          transition: all 0.2s;
        }
        .nb-footer-social:hover {
          transform: translateX(4px);
          background: color-mix(in srgb, var(--gold) 8%, transparent);
        }
        .nb-footer-title {
          font-family: ${BODY};
          font-size: 14px;
          font-weight: 800;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          color: var(--text-primary);
          margin: 0 0 10px;
          display: inline-block;
          position: relative;
        }
        .nb-footer-title::after {
          content: '';
          position: absolute;
          left: 0; right: 0;
          bottom: -3px;
          height: 2px;
          background: var(--accent, var(--gold));
          border-radius: 2px;
          opacity: 0.7;
        }
      `}</style>

      {/* Modal sugerencia */}
      {showSugerencia && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(6px)',
          zIndex: 9000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
        }}>
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: 16,
            border: '2.5px solid var(--text-primary)',
            boxShadow: '6px 7px 0 var(--text-primary), 0 16px 40px rgba(0,0,0,0.4)',
            width: '100%', maxWidth: 460, padding: 28,
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute', top: -12, left: '50%',
              transform: 'translateX(-50%) rotate(-3deg)',
              width: 80, height: 22,
              background: 'color-mix(in srgb, var(--gold) 55%, transparent)',
              border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)',
              boxShadow: '0 2px 4px rgba(0,0,0,0.18)',
            }} />

            <h3 style={{
              fontFamily: BODY, fontSize: 24, fontWeight: 800,
              color: 'var(--text-primary)', margin: '4px 0 12px',
              textAlign: 'center',
            }}>
              💡 {idioma === 'en' ? 'Suggestion Box' : 'Buzón de Sugerencias'}
            </h3>
            <svg width="200" height="6" style={{ display: 'block', margin: '0 auto 16px' }}>
              <path d="M2 3 Q 100 0 198 4" stroke="var(--gold)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
            </svg>

            {enviado ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 50, marginBottom: 8 }}>✅</div>
                <p style={{
                  fontFamily: BODY, fontSize: 18, color: 'var(--gold)',
                  fontWeight: 800, margin: 0,
                }}>
                  {idioma === 'en' ? '¡Thanks for your feedback!' : '¡Gracias por tu sugerencia!'}
                </p>
              </div>
            ) : (
              <>
                <textarea
                  value={sugerencia}
                  onChange={(e: any) => setSugerencia(e.target.value)}
                  placeholder={idioma === 'en' ? 'Tell us how we can improve...' : 'Cuéntanos cómo podemos mejorar...'}
                  rows={4}
                  style={{
                    width: '100%', padding: 14, borderRadius: 10,
                    border: '2px dashed var(--text-faint)',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    fontFamily: BODY, fontSize: 15, fontWeight: 500,
                    resize: 'vertical', outline: 'none',
                    boxSizing: 'border-box', lineHeight: 1.4,
                    transition: 'border-color 0.2s',
                  }}
                  onFocus={(e: any) => e.currentTarget.style.borderColor = 'var(--gold)'}
                  onBlur={(e: any) => e.currentTarget.style.borderColor = 'var(--text-faint)'}
                />
                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                  <button onClick={() => setShowSugerencia(false)}
                    style={{
                      flex: 1, padding: 12, borderRadius: 10,
                      border: '2px solid var(--text-faint)',
                      background: 'transparent', color: 'var(--text-muted)',
                      fontFamily: BODY, fontSize: 15, fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ✕ {idioma === 'en' ? 'Cancel' : 'Cancelar'}
                  </button>
                  <button onClick={enviarSugerencia} disabled={!sugerencia.trim()}
                    style={{
                      flex: 2, padding: 12, borderRadius: 10, border: 'none',
                      background: sugerencia.trim() ? 'var(--gold)' : 'var(--bg-card2)',
                      color: sugerencia.trim() ? '#000' : 'var(--text-faint)',
                      fontFamily: BODY, fontSize: 15, fontWeight: 700,
                      cursor: sugerencia.trim() ? 'pointer' : 'not-allowed',
                      boxShadow: sugerencia.trim() ? '0 4px 0 rgba(184,134,11,.5)' : 'none',
                    }}
                  >
                    📤 {idioma === 'en' ? 'Send' : 'Enviar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer style={{
        position: 'relative',
        marginTop: 60,
        paddingTop: 28,
        background: 'transparent',
      }}>
        <svg viewBox="0 0 1200 14" preserveAspectRatio="none" style={{
          display: 'block', width: '100%', height: 14, marginBottom: 18,
        }}>
          <path
            d="M 0 7 Q 50 2 100 6 T 200 5 T 300 8 T 400 4 T 500 7 T 600 5 T 700 8 T 800 4 T 900 7 T 1000 5 T 1100 8 T 1200 6"
            fill="none"
            stroke="var(--text-primary)"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.5"
          />
        </svg>

        <div style={{
          maxWidth: 1100, margin: '0 auto',
          padding: '0 24px 32px',
          position: 'relative',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'flex-start', flexWrap: 'wrap',
            gap: 36, marginBottom: 32,
          }}>
            {/* Brand */}
            <div style={{ maxWidth: 280 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <img
                  src="/logo.png" alt="Logo"
                  style={{
                    width: 38, height: 38,
                    borderRadius: 8, objectFit: 'cover',
                    border: '2px solid var(--text-primary)',
                    boxShadow: '2px 2px 0 var(--text-primary)',
                  }}
                  onError={(e: any) => { e.target.style.display = 'none'; }}
                />
                <span className="brand-studyal" style={{ fontSize: '26px', fontWeight: 900 }}>
                  <span className="brand-study" style={{ color: 'var(--text-primary)' }}>Study</span><span className="brand-al">AL</span>
                </span>
              </div>
              <p style={{
                fontFamily: BODY, fontSize: 13, fontWeight: 500,
                color: 'var(--text-muted)',
                margin: 0, lineHeight: 1.4,
              }}>
                {idioma === 'en'
                  ? 'Your complete study platform. Unlock the potential within you ✨'
                  : 'Tu plataforma de estudio completa. Despierta el potencial que llevas dentro ✨'}
              </p>
              <svg width="180" height="6" style={{ display: 'block', marginTop: 8 }}>
                <path d="M2 3 Q 90 0 178 4" stroke="var(--gold)" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".6"/>
              </svg>
            </div>

            {/* Columnas */}
            <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
              <div>
                <p className="nb-footer-title" style={{ ['--accent' as any]: 'var(--gold)' }}>
                  {idioma === 'en' ? 'Product' : 'Producto'}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {[
                    { label: idioma === 'en' ? 'Subjects' : 'Materias', href: '/materias' },
                    { label: 'ChapBot', href: '/chap' },
                    { label: idioma === 'en' ? 'Schedule' : 'Horario', href: '/horario' },
                    { label: idioma === 'en' ? 'Planner' : 'Agenda', href: '/agenda' },
                  ].map(link => (
                    <Link key={link.href} href={link.href} className="nb-footer-link">
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>

              <div>
                <p className="nb-footer-title" style={{ ['--accent' as any]: 'var(--pink)' }}>
                  Legal
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {[
                    { label: idioma === 'en' ? 'Terms of Service' : 'Términos de uso', href: '/terminos' },
                    { label: idioma === 'en' ? 'Privacy Policy' : 'Política de privacidad', href: '/terminos#sec-9' },
                    { label: idioma === 'en' ? 'Cookie Policy' : 'Política de cookies', href: '/terminos#sec-10' },
                  ].map(link => (
                    <Link key={link.href} href={link.href} className="nb-footer-link">
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>

              <div>
                <p className="nb-footer-title" style={{ ['--accent' as any]: 'var(--blue)' }}>
                  {idioma === 'en' ? 'Support' : 'Soporte'}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button onClick={() => setShowSugerencia(true)}
                    style={{
                      background: 'none', border: 'none', padding: '2px 0',
                      fontFamily: BODY, fontSize: 14, fontWeight: 500,
                      color: 'var(--gold)', cursor: 'pointer',
                      textAlign: 'left', display: 'inline-block',
                      transition: 'transform 0.2s',
                    }}
                    onMouseEnter={(e: any) => e.currentTarget.style.transform = 'translateX(4px)'}
                    onMouseLeave={(e: any) => e.currentTarget.style.transform = 'none'}
                  >
                    💡 {idioma === 'en' ? 'Suggestion Box' : 'Sugerencias'}
                  </button>
                  <a href="mailto:studyal496@gmail.com" className="nb-footer-link">
                    📧 {idioma === 'en' ? 'Contact' : 'Contacto'}
                  </a>
                  <a href="/settings" className="nb-footer-link">
                    ⚙️ {idioma === 'en' ? 'Settings' : 'Configuración'}
                  </a>
                </div>
              </div>

              <div>
                <p className="nb-footer-title" style={{ ['--accent' as any]: 'var(--red)' }}>
                  {idioma === 'en' ? 'Follow Us' : 'Síguenos'}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <a href="https://www.tiktok.com/@studyal.app" target="_blank" rel="noopener noreferrer"
                    className="nb-footer-social"
                    onMouseEnter={(e: any) => e.currentTarget.style.color = '#ff0050'}
                    onMouseLeave={(e: any) => e.currentTarget.style.color = 'var(--text-secondary)'}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.52a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V9.03a8.35 8.35 0 004.76 1.49V7.07a4.85 4.85 0 01-1-.38z"/>
                    </svg>
                    TikTok
                  </a>
                  <a href="https://www.instagram.com/studyal.app" target="_blank" rel="noopener noreferrer"
                    className="nb-footer-social"
                    onMouseEnter={(e: any) => e.currentTarget.style.color = '#e1306c'}
                    onMouseLeave={(e: any) => e.currentTarget.style.color = 'var(--text-secondary)'}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204 013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                    </svg>
                    Instagram
                  </a>
                </div>
              </div>
            </div>
          </div>

          <svg viewBox="0 0 1100 8" preserveAspectRatio="none" style={{
            display: 'block', width: '100%', height: 8, marginBottom: 14,
          }}>
            <path
              d="M 5 4 Q 100 1 200 5 T 400 4 T 600 5 T 800 3 T 1000 5 T 1095 4"
              fill="none"
              stroke="var(--text-faint)"
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity="0.5"
              strokeDasharray="6 4"
            />
          </svg>

          <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', flexWrap: 'wrap', gap: 8,
          }}>
            <p style={{
              fontFamily: BODY, fontSize: 13, fontWeight: 600,
              color: 'var(--text-faint)', margin: 0,
            }}>
              © {new Date().getFullYear()} StudyAL · {idioma === 'en' ? 'all rights reserved' : 'todos los derechos reservados'}
            </p>
            <p style={{
              fontFamily: BODY, fontSize: 13, fontWeight: 700,
              color: 'var(--text-muted)', margin: 0,
            }}>
              {idioma === 'en' ? 'empowering students' : 'impulsando estudiantes'} <span style={{ color: 'var(--red)', fontSize: 15 }}>✨</span>
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
