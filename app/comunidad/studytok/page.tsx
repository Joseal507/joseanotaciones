'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useIsMobile } from '@/hooks/useIsMobile';
import NavbarMobile from '@/components/NavbarMobile';
import UserMenu from '@/components/UserMenu';
import TikTokEstudio from '@/components/comunidad/TikTokEstudio';

export default function StudyTokPage() {
  const isMobile = useIsMobile();
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cargar = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!data.user) {
          window.location.href = '/auth';
          return;
        }
        setUserId(data.user.id);
      } catch {
        window.location.href = '/auth';
        return;
      } finally {
        setLoading(false);
      }
    };
    cargar();
  }, []);

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '14px',
        fontFamily: '-apple-system, sans-serif',
      }}>
        <div style={{ fontSize: '52px' }}>🎬</div>
        <p style={{ color: 'var(--text-muted)', fontWeight: 700 }}>Cargando StudyTok...</p>
      </div>
    );
  }

  if (!userId) return null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>
      {isMobile ? (
        <NavbarMobile />
      ) : (
        <header style={{
          background: 'var(--bg-card)',
          borderBottom: '3px solid var(--pink)',
          padding: '0 28px',
          height: '62px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => window.location.href = '/comunidad'}
              style={{
                background: 'none',
                border: '2px solid var(--pink)',
                color: 'var(--pink)',
                padding: '7px 16px',
                borderRadius: '10px',
                fontWeight: 800,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              ← Comunidad
            </button>
            <h1 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
              🎬 StudyTok
            </h1>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Flashcards, quizzes, apuntes y posts en vertical
            </span>
          </div>
          <UserMenu />
        </header>
      )}

      <div style={{ display: 'flex', height: '3px' }}>
        <div style={{ flex: 1, background: 'var(--gold)' }} />
        <div style={{ flex: 1, background: 'var(--red)' }} />
        <div style={{ flex: 1, background: 'var(--blue)' }} />
        <div style={{ flex: 1, background: 'var(--pink)' }} />
      </div>

      {!isMobile && (
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '16px 24px 0' }}>
          <div style={{
            background: 'linear-gradient(135deg, #ff4d6d18, #a78bfa18)',
            border: '1px solid #a78bfa33',
            borderRadius: '18px',
            padding: '14px 16px',
            marginBottom: '12px',
          }}>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)', fontWeight: 700 }}>
              ↑↓ Usa scroll, flechas o swipe para navegar
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
              Doble tap para like · Guarda contenido · Abre el post completo cuando quieras
            </p>
          </div>
        </div>
      )}

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: isMobile ? '0' : '0 24px 24px' }}>
        <TikTokEstudio userId={userId} />
      </div>
    </div>
  );
}
