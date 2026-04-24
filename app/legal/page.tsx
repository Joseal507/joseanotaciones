'use client';

import { useState } from 'react';

type Tab = 'terms' | 'privacy' | 'cookies';

export default function LegalPage() {
  const [tab, setTab] = useState<Tab>('terms');

  const tabs = [
    { id: 'terms' as Tab, label: '📋 Términos de uso' },
    { id: 'privacy' as Tab, label: '🔒 Privacidad' },
    { id: 'cookies' as Tab, label: '🍪 Cookies' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif', padding: '40px 20px' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>

        <div style={{ marginBottom: '32px' }}>
          <a href="/" style={{ color: 'var(--gold)', fontSize: '13px', fontWeight: 700, textDecoration: 'none' }}>← Volver al inicio</a>
          <h1 style={{ fontSize: '28px', fontWeight: 900, color: 'var(--text-primary)', margin: '16px 0 4px' }}>Legal</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Última actualización: {new Date().toLocaleDateString('es-PA')}</p>
        </div>

        <div style={{ display: 'flex', gap: '6px', marginBottom: '28px', flexWrap: 'wrap' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', background: tab === t.id ? 'var(--gold)' : 'var(--bg-card)', color: tab === t.id ? '#000' : 'var(--text-muted)', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border-color)', padding: '28px', lineHeight: 1.8, color: 'var(--text-secondary)', fontSize: '14px' }}>

          {tab === 'terms' && <>
            <h2 style={{ color: 'var(--text-primary)', fontWeight: 800, margin: '0 0 16px' }}>Términos de Uso</h2>
            <p>Al usar StudyAL, aceptas estos términos. Por favor léelos cuidadosamente.</p>
            <h3 style={{ color: 'var(--text-primary)', marginTop: '20px' }}>1. Uso del servicio</h3>
            <p>StudyAL es una plataforma educativa para estudiantes. Puedes usarla para organizar tus apuntes, estudiar con flashcards, y acceder a herramientas de IA para mejorar tu aprendizaje.</p>
            <h3 style={{ color: 'var(--text-primary)', marginTop: '20px' }}>2. Cuenta de usuario</h3>
            <p>Eres responsable de mantener la seguridad de tu cuenta. No compartas tu contraseña con nadie. Debes proporcionar información veraz al registrarte.</p>
            <h3 style={{ color: 'var(--text-primary)', marginTop: '20px' }}>3. Contenido</h3>
            <p>Eres propietario del contenido que creas (apuntes, flashcards, etc.). Al usar el leaderboard, aceptas que ciertos datos de estudio (XP, racha, nombre) sean visibles para otros usuarios.</p>
            <h3 style={{ color: 'var(--text-primary)', marginTop: '20px' }}>4. Uso aceptable</h3>
            <p>No uses la plataforma para actividades ilegales, spam, o compartir contenido inapropiado. Nos reservamos el derecho de suspender cuentas que violen estos términos.</p>
            <h3 style={{ color: 'var(--text-primary)', marginTop: '20px' }}>5. Contacto</h3>
            <p>Para preguntas sobre estos términos: <a href="mailto:jose.alberto.deobaldia@gmail.com" style={{ color: 'var(--gold)' }}>jose.alberto.deobaldia@gmail.com</a></p>
          </>}

          {tab === 'privacy' && <>
            <h2 style={{ color: 'var(--text-primary)', fontWeight: 800, margin: '0 0 16px' }}>Política de Privacidad</h2>
            <p>Tu privacidad es importante para nosotros. Esta política explica qué datos recopilamos y cómo los usamos.</p>
            <h3 style={{ color: 'var(--text-primary)', marginTop: '20px' }}>Datos que recopilamos</h3>
            <ul style={{ paddingLeft: '20px' }}>
              <li><strong style={{ color: 'var(--text-primary)' }}>Cuenta:</strong> Email, nombre de usuario</li>
              <li><strong style={{ color: 'var(--text-primary)' }}>Perfil:</strong> Género, universidad, carrera (opcionales)</li>
              <li><strong style={{ color: 'var(--text-primary)' }}>Estudio:</strong> Apuntes, flashcards, estadísticas de estudio</li>
              <li><strong style={{ color: 'var(--text-primary)' }}>Documentos:</strong> PDFs y archivos que subes, almacenados en Cloudflare R2</li>
            </ul>
            <h3 style={{ color: 'var(--text-primary)', marginTop: '20px' }}>Cómo usamos tus datos</h3>
            <ul style={{ paddingLeft: '20px' }}>
              <li>Para proveer el servicio de estudio personalizado</li>
              <li>Para mostrar tu progreso en el leaderboard (si lo aceptas)</li>
              <li>Para mejorar la plataforma con estadísticas anónimas</li>
            </ul>
            <h3 style={{ color: 'var(--text-primary)', marginTop: '20px' }}>No compartimos</h3>
            <p>Nunca vendemos ni compartimos tu información personal con terceros.</p>
            <h3 style={{ color: 'var(--text-primary)', marginTop: '20px' }}>Tus derechos</h3>
            <p>Puedes solicitar la eliminación de tu cuenta y datos en cualquier momento desde Configuración o contactándonos.</p>
            <h3 style={{ color: 'var(--text-primary)', marginTop: '20px' }}>Contacto</h3>
            <p><a href="mailto:jose.alberto.deobaldia@gmail.com" style={{ color: 'var(--gold)' }}>jose.alberto.deobaldia@gmail.com</a></p>
          </>}

          {tab === 'cookies' && <>
            <h2 style={{ color: 'var(--text-primary)', fontWeight: 800, margin: '0 0 16px' }}>Política de Cookies</h2>
            <p>StudyAL usa cookies únicamente para funcionalidad esencial. <strong style={{ color: 'var(--text-primary)' }}>No usamos cookies de tracking ni publicidad.</strong></p>
            <h3 style={{ color: 'var(--text-primary)', marginTop: '20px' }}>Cookies que usamos</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr>
                    {['Cookie', 'Propósito', 'Duración'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 12px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontWeight: 800, borderRadius: h === 'Cookie' ? '6px 0 0 6px' : h === 'Duración' ? '0 6px 6px 0' : '' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: 'sb-auth-token', purpose: 'Sesión de usuario (Supabase)', duration: 'Sesión / 7 días' },
                    { name: 'studyal_settings', purpose: 'Preferencias de la app (tema, idioma)', duration: 'Permanente (localStorage)' },
                    { name: 'studyal_idioma', purpose: 'Idioma seleccionado', duration: 'Permanente (localStorage)' },
                    { name: 'studyal_perfil', purpose: 'Caché local del perfil de estudio', duration: 'Hasta cerrar sesión' },
                  ].map((row, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: 'var(--gold)', fontSize: '12px' }}>{row.name}</td>
                      <td style={{ padding: '10px 12px' }}>{row.purpose}</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{row.duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 style={{ color: 'var(--text-primary)', marginTop: '20px' }}>No usamos</h3>
            <ul style={{ paddingLeft: '20px' }}>
              <li>❌ Google Analytics</li>
              <li>❌ Facebook Pixel</li>
              <li>❌ Cookies publicitarias</li>
              <li>❌ Cookies de terceros para tracking</li>
            </ul>
            <h3 style={{ color: 'var(--text-primary)', marginTop: '20px' }}>Control</h3>
            <p>Puedes limpiar las cookies y datos locales en Configuración → Datos → Limpiar datos.</p>
          </>}
        </div>
      </div>
    </div>
  );
}
