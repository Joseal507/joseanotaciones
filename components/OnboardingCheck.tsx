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

        // ✅ Check localStorage primero — instantáneo
        const localKey = `josea_onboarding_done_${userId}`;
        if (localStorage.getItem(localKey) === 'true') {
          setChecked(true);
          return;
        }

        // ✅ Check en leaderboard directamente con anon key
        const { data: entry } = await supabase
          .from('leaderboard')
          .select('onboarding_completo, genero')
          .eq('user_id', userId)
          .single();

        console.log('Leaderboard entry:', entry);

        if (entry?.onboarding_completo) {
          localStorage.setItem(localKey, 'true');
          setChecked(true);
          return;
        }

        // No completó onboarding
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
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          localStorage.setItem(`josea_onboarding_done_${data.session.user.id}`, 'true');
        }
        setShowOnboarding(false);
      }}
    />
  );
}