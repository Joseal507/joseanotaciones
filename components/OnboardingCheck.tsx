'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import OnboardingModal from './OnboardingModal';

export default function OnboardingCheck() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showAgreement, setShowAgreement] = useState(false);
  const [nombre, setNombre] = useState('');
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData.session;
        if (!session) { setChecked(true); return; }

        const userId = session.user.id;
        const userName = session.user.user_metadata?.nombre || session.user.email?.split('@')[0] || '';

        // Check en Supabase SOLAMENTE — no localStorage
        const { data: entry } = await supabase
          .from('leaderboard')
          .select('onboarding_completo, genero, tipo_estudiante, user_agreement')
          .eq('user_id', userId)
          .single();

        // Si tiene genero Y tipo_estudiante → onboarding completo
        if (entry?.genero && entry?.tipo_estudiante) {
          // Verificar si falta el user agreement
          if (!entry?.user_agreement) {
            setNombre(userName);
            setShowAgreement(true);
          }
          setChecked(true);
          return;
        }

        // No tiene datos → mostrar onboarding
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

  if (!checked) return null;

  // User Agreement modal
  if (showAgreement) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px', backdropFilter: 'blur(8px)',
      }}>
        <div style={{
          width: '100%', maxWidth: '480px',
          background: 'var(--bg-card)', borderRadius: '24px',
          border: '1px solid var(--border-color)',
          overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}>
          <div style={{ height: '4px', background: 'var(--gold)' }} />
          <div style={{ padding: '32px' }}>
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div style={{ fontSize: '40px', marginBottom: '8px' }}>📋</div>
              <h2 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 8px' }}>
                Términos del Leaderboard
              </h2>
              <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
                Necesitamos tu consentimiento para continuar
              </p>
            </div>

            <div style={{
              background: 'var(--bg-secondary)', borderRadius: '14px',
              padding: '16px', marginBottom: '20px',
              maxHeight: '200px', overflowY: 'auto',
              border: '1px solid var(--border-color)',
            }}>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>
                Al usar StudyAL, aceptas que:
              </p>
              <ul style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.7, paddingLeft: '20px', margin: '8px 0 0' }}>
                <li>Tu nombre, universidad y carrera pueden mostrarse en el <strong>leaderboard público</strong>.</li>
                <li>Tus estadísticas de estudio (XP, racha, flashcards) son visibles para otros usuarios.</li>
                <li>Tus datos de perfil se almacenan de forma segura en nuestros servidores.</li>
                <li>Puedes solicitar la eliminación de tus datos en cualquier momento desde Configuración.</li>
                <li>No compartimos tu información con terceros.</li>
                <li>Tu email nunca se muestra públicamente.</li>
              </ul>
            </div>

            <button
              onClick={async () => {
                try {
                  const { data } = await supabase.auth.getSession();
                  if (data.session) {
                    await supabase
                      .from('leaderboard')
                      .update({
                        user_agreement: true,
                        user_agreement_date: new Date().toISOString(),
                        visible_leaderboard: true,
                      })
                      .eq('user_id', data.session.user.id);
                  }
                } catch {}
                setShowAgreement(false);
              }}
              style={{
                width: '100%', padding: '14px', borderRadius: '12px',
                border: 'none', background: 'var(--gold)', color: '#000',
                fontSize: '15px', fontWeight: 900, cursor: 'pointer',
              }}
            >
              ✅ Acepto — Mostrar mi perfil en el Leaderboard
            </button>

            <button
              onClick={async () => {
                try {
                  const { data } = await supabase.auth.getSession();
                  if (data.session) {
                    await supabase
                      .from('leaderboard')
                      .update({
                        user_agreement: false,
                        user_agreement_date: new Date().toISOString(),
                        visible_leaderboard: false,
                      })
                      .eq('user_id', data.session.user.id);
                  }
                } catch {}
                setShowAgreement(false);
              }}
              style={{
                width: '100%', padding: '12px', borderRadius: '12px', marginTop: '8px',
                border: '2px solid var(--border-color)', background: 'transparent',
                color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer',
              }}
            >
              ❌ No acepto — No aparecer en el Leaderboard
            </button>

            <p style={{ fontSize: '11px', color: 'var(--text-faint)', textAlign: 'center', margin: '12px 0 0' }}>
              Puedes cambiar esta decisión en Configuración
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!showOnboarding) return null;

  return (
    <OnboardingModal
      nombre={nombre}
      onComplete={() => setShowOnboarding(false)}
    />
  );
}
