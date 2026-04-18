'use client';

import { useState } from 'react';
import { supabase } from '../lib/supabase';

const CARRERAS = [
  'Ingeniería en Sistemas / Informática',
  'Ingeniería Civil',
  'Ingeniería Mecánica',
  'Ingeniería Eléctrica',
  'Medicina',
  'Enfermería',
  'Odontología',
  'Psicología',
  'Derecho',
  'Administración de Empresas',
  'Contaduría / Contabilidad',
  'Economía',
  'Arquitectura',
  'Diseño Gráfico',
  'Marketing / Publicidad',
  'Comunicación Social',
  'Educación / Pedagogía',
  'Biología',
  'Química',
  'Física',
  'Matemáticas',
  'Filosofía',
  'Historia',
  'Sociología',
  'Trabajo Social',
  'Nutrición / Dietética',
  'Fisioterapia',
  'Farmacia',
  'Veterinaria',
  'Agronomía',
  'Otra carrera',
];

const UNIVERSIDADES_POPULARES = [
  'ULAT',
  'USMA',
  'UTP',
  'UP (Universidad de Panamá)',
  'UDELAS',
  'Harvard',
  'MIT',
  'Stanford',
  'Notre Dame',
  'IE University',
  'UM (Universidad de Miami)',
  'TEC de Monterrey',
  'MU',
  'Otra universidad',
];

interface Props {
  nombre: string;
  onComplete: () => void;
}

type Step = 'genero' | 'tipo' | 'detalles' | 'meta';

export default function OnboardingModal({ nombre, onComplete }: Props) {
  const [step, setStep] = useState<Step>('genero');
  const [genero, setGenero] = useState('');
  const [tipoEstudiante, setTipoEstudiante] = useState('');
  const [universidad, setUniversidad] = useState('');
  const [universidadCustom, setUniversidadCustom] = useState('');
  const [carrera, setCarrera] = useState('');
  const [carreraCustom, setCarreraCustom] = useState('');
  const [queQuieresEstudiar, setQueQuieresEstudiar] = useState('');
  const [guardando, setGuardando] = useState(false);

  const universidadFinal = universidad === 'Otra universidad' ? universidadCustom : universidad;
  const carreraFinal = carrera === 'Otra carrera' ? carreraCustom : carrera;

 const handleGuardar = async () => {
  setGuardando(true);
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) { onComplete(); return; }

    const userId = session.user.id;

    // ✅ Guardar en localStorage PRIMERO antes de cualquier cosa
    localStorage.setItem(`josea_onboarding_done_${userId}`, 'true');

    // ✅ Intentar guardar en DB (en background, no bloqueante)
    fetch('/api/user-profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        nombre,
        genero,
        tipo_estudiante: tipoEstudiante,
        universidad: tipoEstudiante === 'universitario' ? universidadFinal : null,
        carrera: tipoEstudiante === 'universitario' ? carreraFinal : null,
        que_quieres_estudiar: queQuieresEstudiar || null,
        es_nuevo: true,
      }),
    }).then(r => r.json()).then(d => {
      console.log('Perfil guardado en DB:', d);
    }).catch(err => {
      console.error('Error guardando en DB (no crítico):', err);
    });

    // ✅ Enviar email directo desde el cliente también como backup
    fetch('/api/notify-new-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre,
        email: session.user.email,
        genero,
        tipo_estudiante: tipoEstudiante,
        universidad: tipoEstudiante === 'universitario' ? universidadFinal : null,
        carrera: tipoEstudiante === 'universitario' ? carreraFinal : null,
        que_quieres_estudiar: queQuieresEstudiar || null,
        es_nuevo: true,
      }),
    }).catch(() => {});

    // ✅ Continuar inmediatamente sin esperar la DB
    onComplete();

  } catch (err) {
    console.error('handleGuardar error:', err);
    onComplete();
  } finally {
    setGuardando(false);
  }
};

  const steps: Step[] = tipoEstudiante === 'universitario'
    ? ['genero', 'tipo', 'detalles', 'meta']
    : ['genero', 'tipo', 'meta'];

  const stepIndex = steps.indexOf(step);
  const totalSteps = steps.length;
  const progress = ((stepIndex + 1) / totalSteps) * 100;

  const goNext = () => {
    const idx = steps.indexOf(step);
    if (idx < steps.length - 1) {
      setStep(steps[idx + 1]);
    } else {
      handleGuardar();
    }
  };

  const goBack = () => {
    const idx = steps.indexOf(step);
    if (idx > 0) setStep(steps[idx - 1]);
  };

  const canContinue = () => {
    if (step === 'genero') return genero !== '';
    if (step === 'tipo') return tipoEstudiante !== '';
    if (step === 'detalles') return carreraFinal !== '' || carrera !== '';
    if (step === 'meta') return true;
    return true;
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{
        width: '100%', maxWidth: '480px',
        background: 'var(--bg-card)',
        borderRadius: '24px',
        border: '1px solid var(--border-color)',
        overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
      }}>
        {/* Barra de progreso */}
        <div style={{ height: '4px', background: 'var(--bg-secondary)' }}>
          <div style={{
            height: '100%',
            width: `${progress}%`,
            background: 'var(--gold)',
            transition: 'width 0.4s ease',
            borderRadius: '0 4px 4px 0',
          }} />
        </div>

        <div style={{ padding: '32px' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ fontSize: '40px', marginBottom: '8px' }}>
              {step === 'genero' ? '👋' : step === 'tipo' ? '🎓' : step === 'detalles' ? '📚' : '✨'}
            </div>
            <h2 style={{
              fontSize: '22px', fontWeight: 900,
              color: 'var(--text-primary)', margin: '0 0 6px',
            }}>
              {step === 'genero' && `¡Hola, ${nombre}! 🎉`}
              {step === 'tipo' && '¿Qué tipo de estudiante eres?'}
              {step === 'detalles' && '¿Dónde estudias?'}
              {step === 'meta' && '¿Qué quieres lograr aquí?'}
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
              {step === 'genero' && 'Cuéntanos un poco sobre ti para personalizar tu experiencia'}
              {step === 'tipo' && 'Esto nos ayuda a darte mejores herramientas'}
              {step === 'detalles' && 'Ayuda a otros estudiantes a conocerte en el leaderboard'}
              {step === 'meta' && 'Opcional — cuéntanos tus metas de estudio'}
            </p>
            <p style={{
              fontSize: '11px', color: 'var(--text-faint)',
              margin: '8px 0 0', fontWeight: 600,
            }}>
              Paso {stepIndex + 1} de {totalSteps}
            </p>
          </div>

          {/* ─── Step: Género ─── */}
          {step === 'genero' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { id: 'hombre', label: 'Hombre', emoji: '👦' },
                { id: 'mujer', label: 'Mujer', emoji: '👧' },
                { id: 'otro', label: 'Otro / Prefiero no decir', emoji: '🌈' },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setGenero(opt.id)}
                  style={{
                    padding: '14px 20px',
                    borderRadius: '14px',
                    border: genero === opt.id ? '2px solid var(--gold)' : '2px solid var(--border-color)',
                    background: genero === opt.id ? 'var(--gold-dim)' : 'var(--bg-secondary)',
                    color: genero === opt.id ? 'var(--gold)' : 'var(--text-primary)',
                    fontSize: '15px', fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '12px',
                    transition: 'all 0.15s',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: '24px' }}>{opt.emoji}</span>
                  {opt.label}
                  {genero === opt.id && (
                    <span style={{ marginLeft: 'auto', fontSize: '16px' }}>✓</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* ─── Step: Tipo de estudiante ─── */}
          {step === 'tipo' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                {
                  id: 'secundaria',
                  label: 'Estudiante (Bachillerato / Secundaria)',
                  emoji: '🏫',
                  desc: 'Estoy en prepa o secundaria',
                },
                {
                  id: 'universitario',
                  label: 'Universitario',
                  emoji: '🎓',
                  desc: 'Estoy en la universidad o carrera técnica',
                },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setTipoEstudiante(opt.id)}
                  style={{
                    padding: '16px 20px',
                    borderRadius: '14px',
                    border: tipoEstudiante === opt.id ? '2px solid var(--gold)' : '2px solid var(--border-color)',
                    background: tipoEstudiante === opt.id ? 'var(--gold-dim)' : 'var(--bg-secondary)',
                    color: tipoEstudiante === opt.id ? 'var(--gold)' : 'var(--text-primary)',
                    fontSize: '15px', fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '14px',
                    transition: 'all 0.15s',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: '28px' }}>{opt.emoji}</span>
                  <div>
                    <div>{opt.label}</div>
                    <div style={{ fontSize: '12px', fontWeight: 500, color: tipoEstudiante === opt.id ? 'var(--gold)' : 'var(--text-faint)', marginTop: '2px' }}>
                      {opt.desc}
                    </div>
                  </div>
                  {tipoEstudiante === opt.id && (
                    <span style={{ marginLeft: 'auto', fontSize: '18px' }}>✓</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* ─── Step: Detalles (solo universitarios) ─── */}
          {step === 'detalles' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Universidad */}
              <div>
                <label style={{
                  fontSize: '12px', fontWeight: 700,
                  color: 'var(--text-muted)', display: 'block',
                  marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px',
                }}>
                  🏫 Universidad
                </label>
                <select
                  value={universidad}
                  onChange={e => setUniversidad(e.target.value)}
                  style={{
                    width: '100%', padding: '12px 16px',
                    borderRadius: '12px',
                    border: universidad ? '2px solid var(--gold)' : '2px solid var(--border-color)',
                    background: 'var(--bg-secondary)',
                    color: universidad ? 'var(--text-primary)' : 'var(--text-faint)',
                    fontSize: '14px', outline: 'none', cursor: 'pointer',
                  }}
                >
                  <option value="">Selecciona tu universidad</option>
                  {UNIVERSIDADES_POPULARES.map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
                {universidad === 'Otra universidad' && (
                  <input
                    type="text"
                    value={universidadCustom}
                    onChange={e => setUniversidadCustom(e.target.value)}
                    placeholder="Escribe tu universidad..."
                    style={{
                      width: '100%', padding: '12px 16px',
                      borderRadius: '12px', marginTop: '8px',
                      border: '2px solid var(--gold)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      fontSize: '14px', outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                )}
              </div>

              {/* Carrera */}
              <div>
                <label style={{
                  fontSize: '12px', fontWeight: 700,
                  color: 'var(--text-muted)', display: 'block',
                  marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px',
                }}>
                  📚 Carrera
                </label>
                <select
                  value={carrera}
                  onChange={e => setCarrera(e.target.value)}
                  style={{
                    width: '100%', padding: '12px 16px',
                    borderRadius: '12px',
                    border: carrera ? '2px solid var(--gold)' : '2px solid var(--border-color)',
                    background: 'var(--bg-secondary)',
                    color: carrera ? 'var(--text-primary)' : 'var(--text-faint)',
                    fontSize: '14px', outline: 'none', cursor: 'pointer',
                  }}
                >
                  <option value="">Selecciona tu carrera</option>
                  {CARRERAS.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {carrera === 'Otra carrera' && (
                  <input
                    type="text"
                    value={carreraCustom}
                    onChange={e => setCarreraCustom(e.target.value)}
                    placeholder="Escribe tu carrera..."
                    style={{
                      width: '100%', padding: '12px 16px',
                      borderRadius: '12px', marginTop: '8px',
                      border: '2px solid var(--gold)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      fontSize: '14px', outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {/* ─── Step: Meta ─── */}
          {step === 'meta' && (
            <div>
              <label style={{
                fontSize: '12px', fontWeight: 700,
                color: 'var(--text-muted)', display: 'block',
                marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px',
              }}>
                ✨ ¿Qué quieres lograr aquí? <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>(opcional)</span>
              </label>
              <textarea
                value={queQuieresEstudiar}
                onChange={e => setQueQuieresEstudiar(e.target.value)}
                placeholder="Ej: Pasar mis exámenes finales, aprender programación, mejorar en matemáticas..."
                rows={4}
                style={{
                  width: '100%', padding: '14px 16px',
                  borderRadius: '14px',
                  border: queQuieresEstudiar ? '2px solid var(--gold)' : '2px solid var(--border-color)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '14px', outline: 'none',
                  resize: 'vertical',
                  lineHeight: '1.6',
                  boxSizing: 'border-box',
                  fontFamily: 'inherit',
                  transition: 'border 0.2s',
                }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                onBlur={e => {
                  if (!queQuieresEstudiar) e.currentTarget.style.borderColor = 'var(--border-color)';
                }}
              />

              {/* Sugerencias rápidas */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                {[
                  'Pasar mis exámenes',
                  'Aprender programación',
                  'Mejorar mi promedio',
                  'Estudiar medicina',
                  'Aprender inglés',
                  'Preparar tesis',
                ].map(sugerencia => (
                  <button
                    key={sugerencia}
                    onClick={() => setQueQuieresEstudiar(sugerencia)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '20px',
                      border: '1px solid var(--border-color)',
                      background: queQuieresEstudiar === sugerencia ? 'var(--gold-dim)' : 'transparent',
                      color: queQuieresEstudiar === sugerencia ? 'var(--gold)' : 'var(--text-faint)',
                      fontSize: '12px', fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {sugerencia}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Botones de navegación */}
          <div style={{
            display: 'flex', gap: '10px',
            marginTop: '28px',
          }}>
            {stepIndex > 0 && (
              <button
                onClick={goBack}
                style={{
                  padding: '13px 20px',
                  borderRadius: '12px',
                  border: '2px solid var(--border-color)',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  fontSize: '14px', fontWeight: 700,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                ← Atrás
              </button>
            )}
            <button
              onClick={goNext}
              disabled={!canContinue() || guardando}
              style={{
                flex: 1,
                padding: '13px 24px',
                borderRadius: '12px',
                border: 'none',
                background: canContinue() && !guardando ? 'var(--gold)' : 'var(--bg-secondary)',
                color: canContinue() && !guardando ? '#000' : 'var(--text-faint)',
                fontSize: '15px', fontWeight: 800,
                cursor: canContinue() && !guardando ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s',
                display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '8px',
              }}
            >
              {guardando ? (
                <>
                  <div style={{
                    width: '14px', height: '14px',
                    border: '2px solid #000',
                    borderTopColor: 'transparent',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  Guardando...
                </>
              ) : step === 'meta' ? (
                '🚀 ¡Empezar a estudiar!'
              ) : (
                'Continuar →'
              )}
            </button>
          </div>

          {/* Skip */}
          {step === 'meta' && (
            <button
              onClick={onComplete}
              style={{
                width: '100%', marginTop: '12px',
                padding: '10px',
                background: 'transparent', border: 'none',
                color: 'var(--text-faint)',
                fontSize: '13px', cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Saltar por ahora
            </button>
          )}
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}