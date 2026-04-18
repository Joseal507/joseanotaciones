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

        // No hay sesión → no mostrar nada
        if (!session) { setChecked(true); return; }

        const userId = session.user.id;
        const userName = session.user.user_metadata?.nombre
          || session.user.email?.split('@')[0]
          || '';

        // Verificar si ya completó onboarding
        const res = await fetch(`/api/user-profile?userId=${userId}`);
        const data = await res.json();

        if (!data.data || !data.data.onboarding_completo) {
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