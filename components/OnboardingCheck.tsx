
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import OnboardingModal from './OnboardingModal';

export default function OnboardingCheck() {
  const { data: session, status } = useSession();
  const [checked, setChecked] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [initialName, setInitialName] = useState('');

  useEffect(() => {
    let alive = true;

    async function check() {
      try {
        if (status === 'loading') return;
        const user: any = session?.user;
        if (!user?.id) {
          if (alive) setChecked(true);
          return;
        }

        const res = await fetch('/api/onboarding', {
          cache: 'no-store',
          credentials: 'same-origin',
        });

        const json = await res.json().catch(() => ({}));
        const needs = json?.needsOnboarding === true;

        if (!alive) return;

        setInitialName(json?.user?.nombre || json?.user?.name || user.name || user.email?.split('@')[0] || '');
        setShowOnboarding(needs);
        setChecked(true);
      } catch (err) {
        console.error('OnboardingCheck error:', err);
        if (alive) setChecked(true);
      }
    }

    check();

    return () => { alive = false; };
  }, [session, status]);

  if (!checked || !showOnboarding) return null;

  return (
    <OnboardingModal
      nombre={initialName}
      onComplete={() => {
        setShowOnboarding(false);
        try { window.dispatchEvent(new Event('studyal:onboarding-complete')); } catch {}
      }}
    />
  );
}
