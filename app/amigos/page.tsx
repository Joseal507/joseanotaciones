'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useIsMobile } from '../../hooks/useIsMobile';
import NavbarMobile from '../../components/NavbarMobile';
import { BetaBadge, BetaBanner } from '../../components/BetaBanner';

export default function AmigosPage() {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<'amigos' | 'pendientes' | 'buscar'>('amigos');
  const [loading, setLoading] = useState(true);
  const [amistades, setAmistades] = useState<any[]>([]);
  const [perfiles, setPerfiles] = useState<Record<string, any>>({});
  const [sugerencias, setSugerencias] = useState<any[]>([]);
  const [myId, setMyId] = useState('');
  const [token, setToken] = useState('');
  const [enviando, setEnviando] = useState<string | null>(null);

  const cargar = async () => {
    setLoading(true);
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) { window.location.href = '/auth'; return; }
    setToken(session.session.access_token);

    const res = await fetch('/api/amigos', {
      headers: { 'Authorization': `Bearer ${session.session.access_token}` },
    });
    const data = await res.json();
    if (data.success) {
      setAmistades(data.amistades || []);
      setPerfiles(data.perfiles || {});
      setSugerencias(data.sugerencias || []);
      setMyId(data.myId);
    }
    setLoading(false);
  };

  useEffect(() => { cargar(); }, []);

  const hacerAccion = async (amigoId: string, accion: string) => {
    setEnviando(amigoId);
    await fetch('/api/amigos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ amigo_id: amigoId, accion }),
    });
    await cargar();
    setEnviando(null);
  };

  const aceptados = amistades.filter(a => a.estado === 'aceptado');
  const pendientesRecibidas = amistades.filter(a => a.estado === 'pendiente' && a.amigo_id === myId);
  const pendientesEnviadas = amistades.filter(a => a.estado === 'pendiente' && a.user_id === myId);
  const amigosIds = new Set([
    ...amistades.map(a => a.user_id),
    ...amistades.map(a => a.amigo_id),
  ]);

  const sugerenciasFiltradas = sugerencias.filter(s => !amigosIds.has(s.user_id) && s.user_id !== myId);

  const getPerfilAmigo = (amistad: any) => {
    const otherId = amistad.user_id === myId ? amistad.amigo_id : amistad.user_id;
    return { id: otherId, ...(perfiles[otherId] || { nombre: 'Usuario' }) };
  };

  const UserCard = ({ user, actions }: { user: any; actions: React.ReactNode }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px',
      background: 'var(--bg-card)', borderRadius: '14px',
      border: '1px solid var(--border-color)', padding: '14px',
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: '50%',
        background: 'var(--bg-secondary)', border: '2px solid var(--gold)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '18px', fontWeight: 800, overflow: 'hidden', flexShrink: 0,
      }}>
        {user.avatar_url
          ? <img src={user.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ color: 'var(--text-primary)' }}>{user.nombre?.[0]?.toUpperCase() || '?'}</span>
        }
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
          {user.nombre || 'Usuario'}
        </p>
        {user.carrera && (
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '2px 0 0' }}>📚 {user.carrera}</p>
        )}
        <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
          {user.xp_total != null && <span style={{ fontSize: '11px', color: 'var(--gold)', fontWeight: 700 }}>⭐ {user.xp_total} XP</span>}
          {user.racha_actual != null && <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: 700 }}>🔥 {user.racha_actual}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
        {actions}
      </div>
    </div>
  );

  const Btn = ({ onClick, label, color, disabled }: { onClick: () => void; label: string; color: string; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}
      style={{
        padding: '8px 14px', borderRadius: '8px', border: 'none',
        background: color, color: '#000', fontSize: '12px', fontWeight: 800,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      }}>
      {label}
    </button>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', fontFamily: '-apple-system, sans-serif' }}>
      {isMobile ? <NavbarMobile /> : (
        <>
          <header style={{
            background: 'var(--bg-card)', borderBottom: '3px solid var(--gold)',
            padding: '0 40px', height: '68px', position: 'sticky', top: 0, zIndex: 100,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <button onClick={() => window.location.href = '/'}
                style={{ background: 'none', border: '2px solid var(--gold)', color: 'var(--gold)', padding: '8px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
                ← Inicio
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h1 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>👥 Partners de Estudio</h1>
                <BetaBadge />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => window.location.href = '/comunidad'}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid #22c55e', background: 'transparent', color: '#22c55e', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                🌍 Comunidad
              </button>
            </div>
          </header>
          <div style={{ display: 'flex', height: '3px' }}>
            {['var(--gold)', 'var(--red)', 'var(--blue)', 'var(--pink)'].map((c, i) => (
              <div key={i} style={{ flex: 1, background: c }} />
            ))}
          </div>
        </>
      )}

      <div style={{ maxWidth: '700px', margin: '0 auto', padding: isMobile ? '16px' : '24px 40px' }}>
        <BetaBanner />

        {/* TABS */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '20px' }}>
          {[
            { id: 'amigos', label: `👥 Amigos (${aceptados.length})` },
            { id: 'pendientes', label: `📩 Pendientes (${pendientesRecibidas.length})` },
            { id: 'buscar', label: '🔍 Buscar' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              style={{
                flex: 1, padding: '10px', borderRadius: '10px', border: 'none',
                background: tab === t.id ? 'var(--gold)' : 'var(--bg-card)',
                color: tab === t.id ? '#000' : 'var(--text-muted)',
                fontSize: '13px', fontWeight: 700, cursor: 'pointer',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <p style={{ color: 'var(--text-faint)' }}>⏳ Cargando...</p>
          </div>
        ) : (
          <>
            {/* AMIGOS */}
            {tab === 'amigos' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {aceptados.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0' }}>
                    <div style={{ fontSize: '50px', marginBottom: '12px' }}>👥</div>
                    <p style={{ color: 'var(--text-muted)', fontWeight: 700 }}>Aún no tienes partners</p>
                    <p style={{ color: 'var(--text-faint)', fontSize: '13px' }}>Busca estudiantes y envía solicitudes</p>
                    <button onClick={() => setTab('buscar')}
                      style={{ marginTop: '12px', padding: '10px 20px', borderRadius: '10px', border: 'none', background: 'var(--gold)', color: '#000', fontWeight: 800, cursor: 'pointer' }}>
                      🔍 Buscar partners
                    </button>
                  </div>
                ) : (
                  aceptados.map(a => {
                    const p = getPerfilAmigo(a);
                    return (
                      <UserCard key={a.id} user={p} actions={
                        <Btn onClick={() => hacerAccion(p.id, 'eliminar')} label="Eliminar" color="#ef444420" disabled={enviando === p.id} />
                      } />
                    );
                  })
                )}
              </div>
            )}

            {/* PENDIENTES */}
            {tab === 'pendientes' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {pendientesRecibidas.length === 0 && pendientesEnviadas.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0' }}>
                    <div style={{ fontSize: '50px', marginBottom: '12px' }}>📩</div>
                    <p style={{ color: 'var(--text-muted)', fontWeight: 700 }}>No hay solicitudes pendientes</p>
                  </div>
                ) : (
                  <>
                    {pendientesRecibidas.length > 0 && (
                      <>
                        <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--gold)', margin: '0 0 8px' }}>📩 Solicitudes recibidas</p>
                        {pendientesRecibidas.map(a => {
                          const p = getPerfilAmigo(a);
                          return (
                            <UserCard key={a.id} user={p} actions={<>
                              <Btn onClick={() => hacerAccion(p.id, 'aceptar')} label="✓ Aceptar" color="#22c55e" disabled={enviando === p.id} />
                              <Btn onClick={() => hacerAccion(p.id, 'rechazar')} label="✗" color="#ef444440" disabled={enviando === p.id} />
                            </>} />
                          );
                        })}
                      </>
                    )}
                    {pendientesEnviadas.length > 0 && (
                      <>
                        <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', margin: '12px 0 8px' }}>📤 Enviadas</p>
                        {pendientesEnviadas.map(a => {
                          const p = getPerfilAmigo(a);
                          return (
                            <UserCard key={a.id} user={p} actions={
                              <span style={{ fontSize: '11px', color: 'var(--text-faint)', fontWeight: 600 }}>Esperando...</span>
                            } />
                          );
                        })}
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* BUSCAR */}
            {tab === 'buscar' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 8px' }}>
                  🔍 Estudiantes en StudyAL ({sugerenciasFiltradas.length})
                </p>
                {sugerenciasFiltradas.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0' }}>
                    <p style={{ color: 'var(--text-faint)' }}>No hay más estudiantes para agregar</p>
                  </div>
                ) : (
                  sugerenciasFiltradas.map(s => (
                    <UserCard key={s.user_id} user={{ ...s, id: s.user_id }} actions={
                      <Btn onClick={() => hacerAccion(s.user_id, 'enviar')} label="+ Agregar" color="var(--gold)" disabled={enviando === s.user_id} />
                    } />
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
