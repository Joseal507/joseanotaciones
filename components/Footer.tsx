'use client';

import { useState } from 'react';
import { useIdioma } from '../hooks/useIdioma';

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
      {/* Suggestion modal */}
      {showSugerencia && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
          zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px',
        }}>
          <div style={{
            background: 'var(--bg-card)', borderRadius: '20px',
            border: '1px solid var(--border-color)', width: '100%', maxWidth: '440px',
            padding: '28px',
          }}>
            <h3 style={{ fontSize: '18px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 16px' }}>
              💡 {idioma === 'en' ? 'Suggestion Box' : 'Buzón de Sugerencias'}
            </h3>
            {enviado ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: '40px', marginBottom: '8px' }}>✅</div>
                <p style={{ color: 'var(--gold)', fontWeight: 700 }}>
                  {idioma === 'en' ? 'Thanks for your feedback!' : '¡Gracias por tu sugerencia!'}
                </p>
              </div>
            ) : (
              <>
                <textarea
                  value={sugerencia}
                  onChange={e => setSugerencia(e.target.value)}
                  placeholder={idioma === 'en' ? 'Tell us how we can improve...' : 'Cuéntanos cómo podemos mejorar...'}
                  rows={4}
                  style={{
                    width: '100%', padding: '12px', borderRadius: '12px',
                    border: '2px solid var(--border-color)', background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)', fontSize: '14px', resize: 'vertical',
                    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button onClick={() => setShowSugerencia(false)}
                    style={{ flex: 1, padding: '11px', borderRadius: '10px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 700, cursor: 'pointer' }}>
                    {idioma === 'en' ? 'Cancel' : 'Cancelar'}
                  </button>
                  <button onClick={enviarSugerencia} disabled={!sugerencia.trim()}
                    style={{ flex: 2, padding: '11px', borderRadius: '10px', border: 'none', background: sugerencia.trim() ? 'var(--gold)' : 'var(--bg-card2)', color: sugerencia.trim() ? '#000' : 'var(--text-faint)', fontWeight: 800, cursor: sugerencia.trim() ? 'pointer' : 'not-allowed' }}>
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
        background: 'var(--bg-card)',
        borderTop: '1px solid var(--border-color)',
        padding: '32px 20px 24px',
        marginTop: '48px',
      }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          {/* Top section */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            flexWrap: 'wrap', gap: '24px', marginBottom: '24px',
          }}>
            {/* Brand */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <img src="/logo.png" alt="Logo" style={{ width: '28px', height: '28px', borderRadius: '6px', objectFit: 'cover' }}
                  onError={(e: any) => { e.target.style.display = 'none'; }} />
                <span style={{ fontSize: '16px', fontWeight: 900 }}><span style={{ fontSize: '85%', fontWeight: 700, color: 'var(--text-primary)' }}>Study</span><span style={{ color: 'var(--gold)' }}>AL</span></span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-faint)', margin: 0, maxWidth: '280px' }}>
                {idioma === 'en'
                  ? 'AI-powered study platform. Notes, flashcards, Peter SauPeter & more.'
                  : 'Tu plataforma de estudio definitiva definitiva. Apuntes, flashcards, herramientas AI y más.'}
              </p>
            </div>

            {/* Links */}
            <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
              <div>
                <p style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 8px' }}>
                  {idioma === 'en' ? 'Product' : 'Producto'}
                </p>
                {[
                  { label: idioma === 'en' ? 'Subjects' : 'Materias', href: '/materias' },
                  { label: 'ChapBot', href: '/chat' },
                  { label: idioma === 'en' ? 'Schedule' : 'Horario', href: '/horario' },
                  { label: idioma === 'en' ? 'Planner' : 'Agenda', href: '/agenda' },
                ].map(link => (
                  <a key={link.href} href={link.href} style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', textDecoration: 'none', margin: '0 0 6px', fontWeight: 600 }}>
                    {link.label}
                  </a>
                ))}
              </div>

              <div>
                <p style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 8px' }}>
                  {idioma === 'en' ? 'Legal' : 'Legal'}
                </p>
                {[
                  { label: idioma === 'en' ? 'Terms of Service' : 'Términos de uso', href: '#terms' },
                  { label: idioma === 'en' ? 'Privacy Policy' : 'Política de privacidad', href: '#privacy' },
                  { label: idioma === 'en' ? 'Cookie Policy' : 'Política de cookies', href: '#cookies' },
                ].map(link => (
                  <a key={link.href} href={link.href} style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', textDecoration: 'none', margin: '0 0 6px', fontWeight: 600 }}>
                    {link.label}
                  </a>
                ))}
              </div>

              <div>
                <p style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 8px' }}>
                  {idioma === 'en' ? 'Support' : 'Soporte'}
                </p>
                <button onClick={() => setShowSugerencia(true)} style={{ display: 'block', fontSize: '13px', color: 'var(--gold)', background: 'none', border: 'none', padding: 0, margin: '0 0 6px', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>
                  💡 {idioma === 'en' ? 'Suggestion Box' : 'Buzón de sugerencias'}
                </button>
                <a href="mailto:studyal496@gmail.com" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', textDecoration: 'none', margin: '0 0 6px', fontWeight: 600 }}>
                  📧 {idioma === 'en' ? 'Contact' : 'Contacto'}
                </a>
                <a href="/settings" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', textDecoration: 'none', margin: '0 0 6px', fontWeight: 600 }}>
                  ⚙️ {idioma === 'en' ? 'Settings' : 'Configuración'}
                </a>
              </div>

              <div>
                <p style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 8px' }}>
                  {idioma === 'en' ? 'Follow Us' : 'Síguenos'}
                </p>
                <a href="https://www.tiktok.com/@studyal.app" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)', textDecoration: 'none', margin: '0 0 8px', fontWeight: 600, transition: 'color 0.2s' }}
                  onMouseEnter={(e: any) => e.currentTarget.style.color = '#ff0050'}
                  onMouseLeave={(e: any) => e.currentTarget.style.color = 'var(--text-secondary)'}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.52a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V9.03a8.35 8.35 0 004.76 1.49V7.07a4.85 4.85 0 01-1-.38z"/></svg>
                  TikTok
                </a>
                <a href="https://www.instagram.com/studyal.app" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)', textDecoration: 'none', margin: '0 0 8px', fontWeight: 600, transition: 'color 0.2s' }}
                  onMouseEnter={(e: any) => e.currentTarget.style.color = '#e1306c'}
                  onMouseLeave={(e: any) => e.currentTarget.style.color = 'var(--text-secondary)'}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
                  Instagram
                </a>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: '1px', background: 'var(--border-color)', marginBottom: '16px' }} />

          {/* Bottom */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: 0 }}>
              © {new Date().getFullYear()} StudyAL. {idioma === 'en' ? 'All rights reserved.' : 'Todos los derechos reservados.'}
            </p>
            <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: 0 }}>
              {idioma === 'en' ? 'Made with' : 'Hecho con'} 💛 {idioma === 'en' ? 'for students' : 'para estudiantes'}
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
