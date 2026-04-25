'use client';
import { useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export default function MiPerfilPage() {
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { window.location.href = '/auth'; return; }
      window.location.href = '/perfil-publico?uid=' + data.session.user.id;
    });
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Cargando tu perfil...</p>
    </div>
  );
}
