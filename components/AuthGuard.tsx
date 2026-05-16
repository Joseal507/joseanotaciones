'use client';

import { useRouter } from 'next/navigation';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const HAND = "'Caveat',cursive";

interface Props {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: Props) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [logueado, setLogueado] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setLogueado(true);
      } else {
        ((window as any).__showNavLoader?.('/landing'), router.push('/landing'));
      }
      setChecking(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        ((window as any).__showNavLoader?.('/landing'), router.push('/landing'));
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (checking) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: 56, marginBottom: 16,
            animation: 'authSpin 1.5s ease-in-out infinite',
            display: 'inline-block',
          }}>📚</div>
          <p style={{
            fontFamily: HAND, fontSize: 22, fontStyle: 'italic',
            color: 'var(--text-muted)', margin: 0,
          }}>
            ~ cargando StudyAL ~
          </p>
        </div>
        <style>{`
          @keyframes authSpin {
            0%, 100% { transform: rotate(-10deg); }
            50% { transform: rotate(10deg); }
          }
        `}</style>
      </div>
    );
  }

  if (!logueado) return null;

  return <>{children}</>;
}