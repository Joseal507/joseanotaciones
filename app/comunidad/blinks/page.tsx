'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useIsMobile } from '@/hooks/useIsMobile';
import NavbarMobile from '@/components/NavbarMobile';
import UserMenu from '@/components/UserMenu';
import StudyALBlinks from '@/components/comunidad/StudyALBlinks';

export default function BlinksPage() {
  const isMobile = useIsMobile();
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        window.location.href = '/auth';
        return;
      }
      setUserId(data.user.id);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '12px',
        fontFamily: '-apple-system, sans-serif',
        color: '#fff',
      }}>
        <div style={{ fontSize: '40px' }}>Cargando Blinks...</div>
      </div>
    );
  }

  if (!userId) return null;

  const topOffset = isMobile ? 63 : 56;

  return (
    <div style={{ minHeight: '100vh', background: '#000', fontFamily: '-apple-system, sans-serif' }}>
      {isMobile ? (
        <NavbarMobile />
      ) : (
        <header style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 200,
          height: '56px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 22px',
          background: 'rgba(0,0,0,0.72)',
          backdropFilter: 'blur(18px)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => window.location.href = '/comunidad'}
              style={{
                background: 'none',
                border: '1px solid rgba(255,255,255,0.18)',
                color: 'rgba(255,255,255,0.75)',
                padding: '6px 12px',
                borderRadius: '999px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ← Comunidad
            </button>
            <h1 style={{ margin: 0, fontSize: '16px', fontWeight: 900, color: '#fff' }}>
              🎥 StudyAL Blinks
            </h1>
          </div>
          <UserMenu />
        </header>
      )}

      <StudyALBlinks userId={userId} topOffset={topOffset} />
    </div>
  );
}
