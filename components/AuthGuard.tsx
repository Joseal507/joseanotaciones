'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

const HAND = "'Caveat',cursive";

interface Props {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: Props) {
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === 'unauthenticated') {
      try { (window as any).__showNavLoader?.('/landing'); } catch {}
      router.push('/landing');
    }
  }, [status, router]);

  if (status === 'loading') {
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

  if (status === 'unauthenticated') return null;

  return <>{children}</>;
}
