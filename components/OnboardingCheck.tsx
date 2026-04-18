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

        // ✅ Primero check localStorage — instantáneo y confiable
        const localKey = `josea_onboarding_done_${userId}`;
        if (localStorage.getItem(localKey) === 'true') {
          setChecked(true);
          return;
        }

        // ✅ Luego check en DB
        try {
          const res = await fetch(`/api/user-profile?userId=${userId}`);
          const data = await res.json();
          if (data.data?.onboarding_completo) {
            // Guardar en localStorage para próximas veces
            localStorage.setItem(localKey, 'true');
            setChecked(true);
            return;
          }
        } catch {}

        // No completó onboarding → mostrar modal
        setNombre(userName);
        setShowOnboarding(true);
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
      onComplete={async () => {
        // ✅ Guardar en localStorage inmediatamente al completar
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          localStorage.setItem(`josea_onboarding_done_${data.session.user.id}`, 'true');
        }
        setShowOnboarding(false);
      }}
    />
  );
}