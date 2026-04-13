'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Props {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: Props) {
  const [checking, setChecking] = useState(true);
  const [logueado, setLogueado] = useState(false);
  const [usuario, setUsuario] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setLogueado(true);
        setUsuario(data.session.user);
      } else {
        window.location.href = '/auth';
      }
      setChecking(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        window.location.href = '/auth';
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📚</div>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Cargando JoseAnotaciones...</p>
        </div>
      </div>
    );
  }

  if (!logueado) return null;

  return <>{children}</>;
}