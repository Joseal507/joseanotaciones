'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import OnboardingModal from './OnboardingModal';

export default function OnboardingCheck() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [nombre, setNombre] = useState('');
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData.session;
        if (!session) { setChecked(true); return; }

        const userId = session.user.id;
        const userName = session.user.user_metadata?.nombre
          || session.user.email?.split('@')[0]
          || '';

        // ✅ Verificar directamente en Supabase sin pasar por API
        // para evitar fallos de SUPABASE_SERVICE_ROLE_KEY
        const { createClient } = await import('@supabase/supabase-js');
        const client = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { global: { headers: { Authorization: `Bearer ${session.access_token}` } } }
        );

        const { data: profile } = await client
          .from('user_profiles')
          .select('onboarding_completo')
          .eq('id', userId)
          .single();

        console.log('Perfil encontrado:', profile);

        if (!profile || !profile.onboarding_completo) {
          setNombre(userName);
          setShowOnboarding(true);
        }
      } catch (err) {
        console.error('OnboardingCheck error:', err);
      } finally {
        setChecked(true);
      }
    };

    check();
  }, []);

  if (!checked || !showOnboarding) return null;

  return (
    <OnboardingModal
      nombre={nombre}
      onComplete={() => setShowOnboarding(false)}
    />
  );
}