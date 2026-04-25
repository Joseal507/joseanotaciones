'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { getSettings } from '../../lib/settings';
import { useIsMobile } from '../../hooks/useIsMobile';

export default function PerfilPublicoWidget() {
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

  useEffect(() => {
    const cargar = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const user = sessionData.session?.user;
        if (!user) return;

        const res = await fetch('/api/user/profile?uid=' + user.id);
        const d = await res.json();
        setProfile(d.profile);

        const { data: lb } = await supabase
          .from('leaderboard')
          .select('xp, racha, nivel, nombre')
          .eq('user_id', user.id)
          .single();
        setStats(lb);

        const settings = getSettings();
        if (settings.fotoPerfil) {
          setProfile((p: any) => p ? { ...p, foto_url: p.foto_url || settings.fotoPerfil } : { foto_url: settings.fotoPerfil });
        }
      } catch {}
      setLoading(false);
    };
    cargar();
  }, []);

  if (loading || !profile) return null;

  const nombre = profile.nombre || 'Estudiante';
  const inicial = nombre[0]?.toUpperCase() || '?';
  const settings = getSettings();
  const foto = profile.foto_url || settings.fotoPerfil || null;

  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: '20px',
      border: '1px solid var(--border-color)',
      overflow: 'hidden',
      marginBottom: isMobile ? '28px' : '48px',
    }}>
      {/* Banner */}
      <div style={{
        height: '90px',
        background: 'linear-gradient(135deg, var(--gold)33 0%, var(--blue)22 50%, var(--pink)22 100%)',
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-end',
        padding: '12px 16px',
      }}>
        <span style={{
          background: 'var(--gold)',
          color: '#000',
          fontSize: '11px',
          fontWeight: 800,
          padding: '4px 12px',
          borderRadius: '20px',
        }}>
          👤 Mi Perfil Público
        </span>
      </div>

      <div style={{ padding: '0 24px 24px' }}>
        {/* Avatar + botón editar */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginTop: '-36px',
          marginBottom: '16px',
        }}>
          <div style={{
            width: 72, height: 72,
            borderRadius: '50%',
            border: '4px solid var(--bg-card)',
            overflow: 'hidden',
            background: 'var(--gold)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '28px', fontWeight: 900, color: '#000',
            flexShrink: 0,
          }}>
            {foto
              ? <img src={foto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : inicial
            }
          </div>
          <button
            onClick={() => window.location.href = '/settings'}
            style={{
              padding: '7px 14px', borderRadius: '10px',
              border: '2px solid var(--border-color)',
              background: 'transparent', color: 'var(--text-muted)',
              fontSize: '12px', fontWeight: 700, cursor: 'pointer',
            }}>
            ✏️ Editar perfil
          </button>
        </div>

        {/* Info */}
        <div style={{ marginBottom: '16px' }}>
          <h2 style={{ fontSize: isMobile ? '18px' : '22px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 4px' }}>
            {nombre}
          </h2>

          {profile.carrera && (
            <p style={{ color: 'var(--gold)', fontSize: '13px', fontWeight: 700, margin: '0 0 2px' }}>
              📚 {profile.carrera}
            </p>
          )}
          {profile.universidad && (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 0 6px' }}>
              🏫 {profile.universidad}
            </p>
          )}
          {profile.bio && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.6, margin: '0 0 4px', maxWidth: '560px' }}>
              {profile.bio}
            </p>
          )}

          {!profile.carrera && !profile.universidad && !profile.bio && (
            <p style={{ color: 'var(--text-faint)', fontSize: '13px', margin: '4px 0', fontStyle: 'italic' }}>
              ✨ Agrega tu carrera, universidad y bio en{' '}
              <span
                onClick={() => window.location.href = '/settings'}
                style={{ color: 'var(--gold)', cursor: 'pointer', textDecoration: 'underline', fontStyle: 'normal', fontWeight: 700 }}>
                Configuración
              </span>
            </p>
          )}
        </div>

        {/* Stats */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
          gap: '8px',
          marginBottom: '16px',
        }}>
          {[
            { label: 'Seguidores', value: profile.followers_count || 0, color: 'var(--blue)' },
            { label: 'Siguiendo',  value: profile.following_count || 0, color: 'var(--pink)' },
            { label: 'Nivel',      value: stats?.nivel || 1,            color: 'var(--gold)' },
            { label: 'Racha',      value: (stats?.racha || 0) + ' 🔥',  color: 'var(--red)'  },
          ].map((s, i) => (
            <div key={i} style={{
              background: 'var(--bg-secondary)',
              borderRadius: '12px',
              padding: '12px 10px',
              textAlign: 'center',
              border: '1px solid var(--border-color)',
            }}>
              <div style={{ fontSize: isMobile ? '17px' : '20px', fontWeight: 900, color: s.color }}>
                {s.value}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-faint)', fontWeight: 600, marginTop: '2px' }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Botones */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={async () => {
              const { data } = await supabase.auth.getUser();
              if (data.user) window.location.href = '/perfil-publico?uid=' + data.user.id;
            }}
            style={{
              padding: '10px 20px', borderRadius: '10px',
              border: 'none', background: 'var(--gold)',
              color: '#000', fontSize: '13px', fontWeight: 800, cursor: 'pointer',
            }}>
            🌍 Ver mi perfil público
          </button>
          <button
            onClick={() => window.location.href = '/perfil'}
            style={{
              padding: '10px 20px', borderRadius: '10px',
              border: '2px solid var(--border-color)',
              background: 'transparent', color: 'var(--text-muted)',
              fontSize: '13px', fontWeight: 700, cursor: 'pointer',
            }}>
            📊 Stats de estudio
          </button>
        </div>
      </div>
    </div>
  );
}
