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

const UNIVERSIDADES = [
  'ULAT',
  'USMA',
  'UTP',
  'UP (Universidad de Panamá)',
  'UDELAS',
  'ISAE Universidad',
  'Universidad Latina de Panamá',
  'Columbus University',
  'Universidad del Istmo',
  'UMECIT',
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

const ESCUELAS_PANAMA = [
  // Públicas
  'Instituto Nacional (El Nacio)',
  'Artes y Oficios Melchor Lasso de la Vega',
  'Instituto Fermín Naudeau',
  'Instituto Profesional y Técnico de Panamá (IPTP)',
  'Escuela Secundaria Pedro Pablo Sánchez',
  'Colegio Secundario de Panamá',
  'Escuela Secundaria de la Chorrera',
  'Escuela Secundaria de Chitré',
  'Colegio Rubiano',
  // Particulares
  'Colegio Brader',
  'AIP (Academia Internacional de Panamá)',
  'Balboa Academy',
  'Metropolitan School',
  'Instituto Sun Yat Sen (ISP)',
  'Colegio Episcopal de Panamá (ECP)',
  'Colegio Real de Panamá (CRP)',
  'Colegio San Agustín',
  'Oxford School',
  'Colegio Javier',
  'Colegio La Salle',
  'Colegio De La Salle',
  'Colegio Isaac Rabin',
  'Colegio Hebreo',
  'Instituto Episcopal San Cristóbal',
  'Colegio Internacional de María Inmaculada',
  'Saint Mary School',
  'Colegio Internacional SEK Panamá',
  "King's College",
  'Colegio San Viator',
  'Instituto Panamericano (IPA)',
  'Colegio Las Esclavas',
  'Colegio María Inmaculada',
  'Colegio Madre Laura',
  'Saint John School',
  'Colegio Bilingüe Punta Pacífica',
  'Colegio Internacional de Panamá',
  'Colegio Alberto Einstein',
  'Boston School International',
  'St. George School',
  'Otra escuela',
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

  // Universitario
  const [universidad, setUniversidad] = useState('');
  const [universidadCustom, setUniversidadCustom] = useState('');
  const [carrera, setCarrera] = useState('');
  const [carreraCustom, setCarreraCustom] = useState('');

  // Escuela
  const [escuela, setEscuela] = useState('');
  const [escuelaCustom, setEscuelaCustom] = useState('');

  const [queQuieresEstudiar, setQueQuieresEstudiar] = useState('');
  const [guardando, setGuardando] = useState(false);

  const universidadFinal = universidad === 'Otra universidad' ? universidadCustom : universidad;
  const carreraFinal     = carrera === 'Otra carrera' ? carreraCustom : carrera;
  const escuelaFinal     = escuela === 'Otra escuela' ? escuelaCustom : escuela;

  // Tipos con detalles: universitario y escuela
  const tieneDetalles = tipoEstudiante === 'universitario' || tipoEstudiante === 'escuela';

  const steps: Step[] = tieneDetalles
    ? ['genero', 'tipo', 'detalles', 'meta']
    : ['genero', 'tipo', 'meta'];

  const stepIndex  = steps.indexOf(step);
  const totalSteps = steps.length;
  const progress   = ((stepIndex + 1) / totalSteps) * 100;

  const handleGuardar = async () => {
    setGuardando(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) { onComplete(); return; }

      const userId = session.user.id;
      localStorage.setItem(`josea_onboarding_done_${userId}`, 'true');

      const datosPerfil = {
        nombre,
        genero,
        tipo_estudiante: tipoEstudiante,
        universidad:  tipoEstudiante === 'universitario' ? universidadFinal : tipoEstudiante === 'escuela' ? escuelaFinal : null,
        carrera:      tipoEstudiante === 'universitario' ? carreraFinal     : null,
        que_quieres_estudiar: queQuieresEstudiar || null,
        onboarding_completo: true,
      };

      // Guardar via API
      await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify(datosPerfil),
      });

      // Guardar directo como backup
      const { error: updateErr } = await supabase
        .from('leaderboard')
        .update({
          genero:               datosPerfil.genero,
          tipo_estudiante:      datosPerfil.tipo_estudiante,
          universidad:          datosPerfil.universidad,
          carrera:              datosPerfil.carrera,
          que_quieres_estudiar: datosPerfil.que_quieres_estudiar,
          onboarding_completo:  true,
        })
        .eq('user_id', userId);

      if (updateErr) {
        await supabase.from('leaderboard').insert({
          user_id: userId,
          email: session.user.email,
          xp_total: 0, flashcards_estudiadas: 0,
          racha_actual: 0, mejor_racha: 0, precision_global: 0,
          ...datosPerfil,
        });
      }

      fetch('/api/notify-new-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...datosPerfil, email: session.user.email, es_nuevo: true }),
      }).catch(() => {});

      onComplete();
    } catch (err) {
      console.error('handleGuardar error:', err);
      onComplete();
    } finally {
      setGuardando(false);
    }
  };

  const goNext = () => {
    const idx = steps.indexOf(step);
    if (idx < steps.length - 1) setStep(steps[idx + 1]);
    else handleGuardar();
  };

  const goBack = () => {
    const idx = steps.indexOf(step);
    if (idx > 0) setStep(steps[idx - 1]);
  };

  const canContinue = () => {
    if (step === 'genero')   return genero !== '';
    if (step === 'tipo')     return tipoEstudiante !== '';
    if (step === 'detalles') {
      if (tipoEstudiante === 'universitario') return carreraFinal !== '' || carrera !== '';
      if (tipoEstudiante === 'escuela')       return escuelaFinal !== '' || escuela !== '';
    }
    return true;
  };

  const SelectStyle: React.CSSProperties = {
    width: '100%', padding: '12px 16px', borderRadius: '12px',
    border: '2px solid var(--border-color)', background: 'var(--bg-secondary)',
    color: 'var(--text-primary)', fontSize: '14px', outline: 'none', cursor: 'pointer',
  };
  const InputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 16px', borderRadius: '12px', marginTop: '8px',
    border: '2px solid var(--gold)', background: 'var(--bg-secondary)',
    color: 'var(--text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
  };
  const LabelStyle: React.CSSProperties = {
    fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)',
    display: 'block', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backdropFilter: 'blur(8px)' }}>
      <div style={{ width: '100%', maxWidth: '480px', background: 'var(--bg-card)', borderRadius: '24px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.6)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>

        {/* Barra progreso */}
        <div style={{ height: '4px', background: 'var(--bg-secondary)', flexShrink: 0 }}>
          <div style={{ height: '100%', width: `${progress}%`, background: 'var(--gold)', transition: 'width 0.4s ease', borderRadius: '0 4px 4px 0' }} />
        </div>

        <div style={{ padding: '32px', overflowY: 'auto', flex: 1 }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ fontSize: '40px', marginBottom: '8px' }}>
              {step === 'genero' ? '👋' : step === 'tipo' ? '🎓' : step === 'detalles' ? '🏫' : '✨'}
            </div>
            <h2 style={{ fontSize: '22px', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 6px' }}>
              {step === 'genero'   && `¡Hola, ${nombre}! 🎉`}
              {step === 'tipo'     && '¿Qué tipo de estudiante eres?'}
              {step === 'detalles' && (tipoEstudiante === 'escuela' ? '¿En qué escuela estudias?' : '¿Dónde estudias?')}
              {step === 'meta'     && '¿Qué quieres lograr aquí?'}
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
              {step === 'genero'   && 'Cuéntanos un poco sobre ti'}
              {step === 'tipo'     && 'Esto personaliza tu experiencia'}
              {step === 'detalles' && 'Otros estudiantes lo verán en el leaderboard'}
              {step === 'meta'     && 'Opcional — cuéntanos tus metas'}
            </p>
            <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '8px 0 0', fontWeight: 600 }}>
              Paso {stepIndex + 1} de {totalSteps}
            </p>
          </div>

          {/* ── GÉNERO ── */}
          {step === 'genero' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { id: 'hombre', label: 'Hombre',               emoji: '👦' },
                { id: 'mujer',  label: 'Mujer',                emoji: '👧' },
                { id: 'otro',   label: 'Otro / Prefiero no decir', emoji: '🌈' },
              ].map(opt => (
                <button key={opt.id} onClick={() => setGenero(opt.id)} style={{ padding: '14px 20px', borderRadius: '14px', border: genero === opt.id ? '2px solid var(--gold)' : '2px solid var(--border-color)', background: genero === opt.id ? 'var(--gold-dim)' : 'var(--bg-secondary)', color: genero === opt.id ? 'var(--gold)' : 'var(--text-primary)', fontSize: '15px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', transition: 'all 0.15s', textAlign: 'left' }}>
                  <span style={{ fontSize: '24px' }}>{opt.emoji}</span>
                  {opt.label}
                  {genero === opt.id && <span style={{ marginLeft: 'auto' }}>✓</span>}
                </button>
              ))}
            </div>
          )}

          {/* ── TIPO ── */}
          {step === 'tipo' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { id: 'escuela',       label: 'Estudiante de Escuela',  emoji: '🏫', desc: 'Estoy en escuela o pre-universitario' },
                { id: 'universitario', label: 'Universitario',          emoji: '🎓', desc: 'Estoy en la universidad o carrera técnica' },
                { id: 'profesional',   label: 'Profesional',            emoji: '💼', desc: 'Ya trabajo y sigo aprendiendo' },
                { id: 'autodidacta',   label: 'Autodidacta',            emoji: '🧠', desc: 'Aprendo por mi cuenta' },
              ].map(opt => (
                <button key={opt.id} onClick={() => setTipoEstudiante(opt.id)} style={{ padding: '14px 18px', borderRadius: '14px', border: tipoEstudiante === opt.id ? '2px solid var(--gold)' : '2px solid var(--border-color)', background: tipoEstudiante === opt.id ? 'var(--gold-dim)' : 'var(--bg-secondary)', color: tipoEstudiante === opt.id ? 'var(--gold)' : 'var(--text-primary)', fontSize: '14px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '14px', transition: 'all 0.15s', textAlign: 'left' }}>
                  <span style={{ fontSize: '26px' }}>{opt.emoji}</span>
                  <div>
                    <div>{opt.label}</div>
                    <div style={{ fontSize: '12px', fontWeight: 500, color: tipoEstudiante === opt.id ? 'var(--gold)' : 'var(--text-faint)', marginTop: '2px' }}>{opt.desc}</div>
                  </div>
                  {tipoEstudiante === opt.id && <span style={{ marginLeft: 'auto', fontSize: '18px' }}>✓</span>}
                </button>
              ))}
            </div>
          )}

          {/* ── DETALLES UNIVERSITARIO ── */}
          {step === 'detalles' && tipoEstudiante === 'universitario' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={LabelStyle}>🏫 Universidad</label>
                <select value={universidad} onChange={e => setUniversidad(e.target.value)} style={{ ...SelectStyle, border: universidad ? '2px solid var(--gold)' : '2px solid var(--border-color)', color: universidad ? 'var(--text-primary)' : 'var(--text-faint)' }}>
                  <option value="">Selecciona tu universidad</option>
                  {UNIVERSIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
                {universidad === 'Otra universidad' && (
                  <input type="text" value={universidadCustom} onChange={e => setUniversidadCustom(e.target.value)}
                    placeholder="Escribe tu universidad..." style={InputStyle} />
                )}
              </div>
              <div>
                <label style={LabelStyle}>📚 Carrera</label>
                <select value={carrera} onChange={e => setCarrera(e.target.value)} style={{ ...SelectStyle, border: carrera ? '2px solid var(--gold)' : '2px solid var(--border-color)', color: carrera ? 'var(--text-primary)' : 'var(--text-faint)' }}>
                  <option value="">Selecciona tu carrera</option>
                  {CARRERAS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {carrera === 'Otra carrera' && (
                  <input type="text" value={carreraCustom} onChange={e => setCarreraCustom(e.target.value)}
                    placeholder="Escribe tu carrera..." style={InputStyle} />
                )}
              </div>
            </div>
          )}

          {/* ── DETALLES ESCUELA ── */}
          {step === 'detalles' && tipoEstudiante === 'escuela' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ padding: '12px 16px', background: 'rgba(245,200,66,0.08)', borderRadius: '12px', border: '1px solid rgba(245,200,66,0.3)' }}>
                <p style={{ fontSize: '13px', color: 'var(--gold)', margin: 0, fontWeight: 600 }}>
                  🇵🇦 Escuelas de Panamá — si la tuya no está, selecciona &quot;Otra escuela&quot;
                </p>
              </div>
              <div>
                <label style={LabelStyle}>🏫 Escuela</label>
                <select value={escuela} onChange={e => setEscuela(e.target.value)} style={{ ...SelectStyle, border: escuela ? '2px solid var(--gold)' : '2px solid var(--border-color)', color: escuela ? 'var(--text-primary)' : 'var(--text-faint)' }}>
                  <option value="">Selecciona tu escuela</option>
                  <optgroup label="🏛️ Escuelas Públicas">
                    {['Instituto Nacional (El Nacio)','Artes y Oficios Melchor Lasso de la Vega','Instituto Fermín Naudeau','Instituto Profesional y Técnico de Panamá (IPTP)','Escuela Secundaria Pedro Pablo Sánchez','Colegio Secundario de Panamá','Escuela Secundaria de la Chorrera','Escuela Secundaria de Chitré','Colegio Rubiano'].map(e => <option key={e} value={e}>{e}</option>)}
                  </optgroup>
                  <optgroup label="🏫 Escuelas Particulares">
                    {['Colegio Brader','AIP (Academia Internacional de Panamá)','Balboa Academy','Metropolitan School','Instituto Sun Yat Sen (ISP)','Colegio Episcopal de Panamá (ECP)','Colegio Real de Panamá (CRP)','Colegio San Agustín','Oxford School','Colegio Javier','Colegio La Salle','Colegio De La Salle','Colegio Isaac Rabin','Colegio Hebreo','Instituto Episcopal San Cristóbal','Colegio Internacional de María Inmaculada','Saint Mary School','Colegio Internacional SEK Panamá',"King's College",'Colegio San Viator','Instituto Panamericano (IPA)','Colegio Las Esclavas','Colegio María Inmaculada','Colegio Madre Laura','Saint John School','Colegio Bilingüe Punta Pacífica','Colegio Internacional de Panamá','Colegio Alberto Einstein','Boston School International','St. George School'].map(e => <option key={e} value={e}>{e}</option>)}
                  </optgroup>
                  <option value="Otra escuela">Otra escuela</option>
                </select>
                {escuela === 'Otra escuela' && (
                  <input type="text" value={escuelaCustom} onChange={e => setEscuelaCustom(e.target.value)}
                    placeholder="Escribe tu escuela..." style={InputStyle} />
                )}
              </div>
            </div>
          )}

          {/* ── META ── */}
          {step === 'meta' && (
            <div>
              <label style={LabelStyle}>
                ✨ ¿Qué quieres lograr aquí? <span style={{ color: 'var(--text-faint)', fontWeight: 500, textTransform: 'none' }}>(opcional)</span>
              </label>
              <textarea value={queQuieresEstudiar} onChange={e => setQueQuieresEstudiar(e.target.value)}
                placeholder="Ej: Pasar mis exámenes, aprender programación..." rows={4}
                style={{ width: '100%', padding: '14px 16px', borderRadius: '14px', border: queQuieresEstudiar ? '2px solid var(--gold)' : '2px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', resize: 'vertical', lineHeight: '1.6', boxSizing: 'border-box', fontFamily: 'inherit' }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                onBlur={e => { if (!queQuieresEstudiar) e.currentTarget.style.borderColor = 'var(--border-color)'; }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                {['Pasar mis exámenes', 'Aprender programación', 'Mejorar mi promedio', 'Preparar tesis', 'Certificaciones', 'Aprender por placer'].map(s => (
                  <button key={s} onClick={() => setQueQuieresEstudiar(s)} style={{ padding: '6px 12px', borderRadius: '20px', border: '1px solid var(--border-color)', background: queQuieresEstudiar === s ? 'var(--gold-dim)' : 'transparent', color: queQuieresEstudiar === s ? 'var(--gold)' : 'var(--text-faint)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Botones nav */}
          <div style={{ display: 'flex', gap: '10px', marginTop: '28px' }}>
            {stepIndex > 0 && (
              <button onClick={goBack} style={{ padding: '13px 20px', borderRadius: '12px', border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '14px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>← Atrás</button>
            )}
            <button onClick={goNext} disabled={!canContinue() || guardando}
              style={{ flex: 1, padding: '13px 24px', borderRadius: '12px', border: 'none', background: canContinue() && !guardando ? 'var(--gold)' : 'var(--bg-secondary)', color: canContinue() && !guardando ? '#000' : 'var(--text-faint)', fontSize: '15px', fontWeight: 800, cursor: canContinue() && !guardando ? 'pointer' : 'not-allowed', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              {guardando
                ? <><div style={{ width: '14px', height: '14px', border: '2px solid #000', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Guardando...</>
                : step === 'meta' ? '🚀 ¡Empezar a estudiar!' : 'Continuar →'}
            </button>
          </div>

          {step === 'meta' && (
            <button onClick={handleGuardar} style={{ width: '100%', marginTop: '12px', padding: '10px', background: 'transparent', border: 'none', color: 'var(--text-faint)', fontSize: '13px', cursor: 'pointer', fontWeight: 600 }}>
              Saltar por ahora
            </button>
          )}
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
