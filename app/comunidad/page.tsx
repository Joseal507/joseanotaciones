'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import NavbarMobile from '../../components/NavbarMobile';
import { useIsMobile } from '../../hooks/useIsMobile';
import ComunidadFeed from '../../components/comunidad/ComunidadFeed';
import PublicarModal from '../../components/comunidad/PublicarModal';

export default function ComunidadPage() {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<'mis_posts' | 'todo' | 'apunte' | 'flashcards' | 'quiz'>('todo');
  const [showPublicar, setShowPublicar] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { window.location.href = '/auth'; return; }
      setUserId(data.session.user.id);
      setToken(data.session.access_token);
    });
  }, []);

  const TABS = [{ id: 'mis_posts', label: '👤 Mis Post' }, 
    { id: 'todo', label: '✨ Todo' },
    { id: 'apunte', label: '📝 Apuntes' },
    { id: 'flashcards', label: '🎴 Flashcards' },
    { id: 'quiz', label: '🎮 Quizzes' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>

      {isMobile ? <NavbarMobile /> : (
        <>
          <header style={{
            background: 'var(--bg-card)', borderBottom: '3px solid var(--gold)',
            padding: '0 40px', height: '68px', position: 'sticky', top: 0, zIndex: 100,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <button onClick={() => window.location.href = '/'}
                style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '8px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                ← Inicio
              </button>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
                  🌍 Comunidad
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0 }}>
                  Descubre apuntes, quizzes y flashcards de otros estudiantes
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => window.location.href = '/amigos'}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid var(--blue)', background: 'transparent', color: 'var(--blue)', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                👥 Partners
              </button>
              <button onClick={() => setShowPublicar(true)}
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
                + Publicar
              </button>
            </div>
          </header>
          <div style={{ display: 'flex', height: '3px' }}>
            {['var(--gold)', 'var(--red)', 'var(--blue)', 'var(--pink)'].map((c, i) => (
              <div key={i} style={{ flex: 1, background: c }} />
            ))}
          </div>
        </>
      )}

      {/* TABS */}
      <div style={{
        display: 'flex', gap: '4px', padding: isMobile ? '12px 16px' : '16px 40px',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-card)', position: 'sticky',
        top: isMobile ? '60px' : '71px', zIndex: 90,
        overflowX: 'auto',
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            style={{
              padding: '8px 16px', borderRadius: '10px', border: 'none',
              background: tab === t.id ? 'var(--gold)' : 'var(--bg-secondary)',
              color: tab === t.id ? '#000' : 'var(--text-muted)',
              fontSize: '13px', fontWeight: 700, cursor: 'pointer',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}>
            {t.label}
          </button>
        ))}

        {isMobile && (
          <button onClick={() => setShowPublicar(true)}
            style={{ marginLeft: 'auto', padding: '8px 16px', borderRadius: '10px', border: 'none', background: 'var(--gold)', color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
            + Publicar
          </button>
        )}
      </div>

      {/* FEED */}
      <div style={{ width: '100%', maxWidth: isMobile ? '100%' : 'min(96vw, 1800px)', margin: '0 auto', padding: isMobile ? '0 8px' : '24px 20px' }}>
        {userId && token && (
          <ComunidadFeed tipo={tab} userId={userId} />
        )}
      </div>

      {/* MODAL PUBLICAR */}
      {showPublicar && token && (
        <PublicarModal
          onClose={() => setShowPublicar(false)}
          onPublicado={() => { setShowPublicar(false); window.location.reload(); }}
        />
      )}
    </div>
  );
}
