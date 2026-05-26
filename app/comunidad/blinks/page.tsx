'use client';

import { useRouter } from 'next/navigation';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useIsMobile } from '@/hooks/useIsMobile';
import NavbarMobile from '@/components/NavbarMobile';
import UserMenu from '@/components/UserMenu';
import StudyALBlinks from '@/components/comunidad/StudyALBlinks';

const HAND = "'Caveat',cursive";
const BODY = "'Inter', system-ui, sans-serif";

export default function BlinksPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        ((window as any).__showNavLoader?.('/auth'), router.push('/auth'));
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
        gap: 16,
        color: '#fff',
      }}>
        <div style={{ fontSize: 50, animation: 'spinBlink 1.2s linear infinite' }}>⏳</div>
        <p style={{
          fontFamily: HAND, fontSize: 22, fontStyle: 'italic',
          color: 'rgba(255,255,255,0.75)', margin: 0,
        }}>
          ~ cargando Blinks ~
        </p>
        <style>{`@keyframes spinBlink{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (!userId) return null;

  const topOffset = isMobile ? 63 : 60;

  return (
    <div style={{ minHeight: '100vh', background: '#000' }}>
      {isMobile ? (
        <NavbarMobile />
      ) : (
        <header style={{
          position: 'fixed',
          top: 0, left: 0, right: 0,
          zIndex: 200,
          height: 60,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px',
          background: 'rgba(0,0,0,0.72)',
          backdropFilter: 'blur(18px)',
          borderBottom: '2.5px solid rgba(255,255,255,0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button
              onClick={() => ((window as any).__showNavLoader?.('/comunidad'), router.push('/comunidad'))}
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '2.5px solid rgba(255,255,255,0.25)',
                color: '#fff',
                padding: '7px 14px',
                borderRadius: 10,
                fontFamily: HAND, fontSize: 17, fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '3px 3px 0 rgba(255,255,255,0.15)',
                transform: 'rotate(-1.5deg)',
                transition: 'all 0.25s cubic-bezier(.25,.8,.25,1)',
              }}
              onMouseEnter={(e:any)=>{e.currentTarget.style.transform='rotate(0deg) translateY(-2px)';e.currentTarget.style.background='rgba(255,255,255,0.15)';}}
              onMouseLeave={(e:any)=>{e.currentTarget.style.transform='rotate(-1.5deg)';e.currentTarget.style.background='rgba(255,255,255,0.08)';}}
            >
              ← Comunidad
            </button>
            <div>
              <h1 style={{
                margin: 0,
                fontFamily: HAND, fontSize: 26, fontWeight: 900,
                color: '#fff', lineHeight: 1,
                transform: 'rotate(-1deg)', display: 'inline-block',
                textShadow: '0 2px 8px rgba(0,0,0,0.5)',
              }}>
                🎥 StudyAL Blinks
              </h1>
              <svg width="180" height="6" style={{ display: 'block', marginTop: 1 }}>
                <path d="M2 3 Q 90 0 178 4" stroke="var(--red)" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".85"/>
              </svg>
            </div>
          </div>
          <UserMenu />
        </header>
      )}

      <StudyALBlinks userId={userId} topOffset={topOffset} />
    </div>
  );
}