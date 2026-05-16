'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useIsMobile } from '../../hooks/useIsMobile';
import NavbarMobile from '../../components/NavbarMobile';
import Leaderboard from '../../components/Leaderboard';

const HAND = "'Caveat',cursive";

export default function LeaderboardPage() {
  const isMobile = useIsMobile();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) window.location.href = '/landing';
      else setChecking(false);
    });
  }, []);

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontFamily: HAND, fontSize: 22, fontStyle: 'italic', color: 'var(--text-muted)' }}>~ cargando ~</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', position: 'relative' }}>
      {isMobile ? <NavbarMobile /> : (
        <header style={{
          position: 'sticky', top: 0, zIndex: 100,
          background: 'color-mix(in srgb,var(--bg-primary) 92%,transparent)',
          backdropFilter: 'blur(14px)',
          borderBottom: '2.5px solid var(--text-primary)',
          padding: '12px 36px',
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <button onClick={() => window.location.href = '/'}
            style={{
              background: 'var(--bg-card)',
              border: '2.5px solid var(--text-primary)',
              color: 'var(--text-primary)',
              padding: '8px 16px',
              borderRadius: 10,
              fontFamily: HAND, fontSize: 17, fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '3px 3px 0 var(--text-primary)',
              transform: 'rotate(-1.5deg)',
            }}>
            ← Inicio
          </button>
          <div>
            <h1 style={{
              fontFamily: HAND, fontSize: 32, fontWeight: 900,
              color: 'var(--text-primary)', margin: 0, lineHeight: 1,
              transform: 'rotate(-1deg)', display: 'inline-block',
            }}>
              🏆 Leaderboard
            </h1>
            <svg width="160" height="6" style={{ display: 'block', marginTop: 2 }}>
              <path d="M2 3 Q 80 0 158 4" stroke="var(--gold)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".7"/>
            </svg>
          </div>
        </header>
      )}

      <svg viewBox="0 0 1200 14" preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: 14 }}>
        <path d="M 0 7 Q 50 2 100 6 T 200 5 T 300 8 T 400 4 T 500 7 T 600 5 T 700 8 T 800 4 T 900 7 T 1000 5 T 1100 8 T 1200 6"
          fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" opacity="0.45"/>
      </svg>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: isMobile ? 16 : '28px 36px 60px' }}>
        <Leaderboard />
      </div>
    </div>
  );
}
