import fs from "fs";

const CURRENT = 2;

function write(file, content) {
  fs.mkdirSync(file.split("/").slice(0, -1).join("/"), { recursive: true });
  fs.writeFileSync(file, content);
  console.log("wrote", file);
}

function patch(file, fn) {
  let s = fs.readFileSync(file, "utf8");
  const before = s;
  s = fn(s);
  fs.writeFileSync(file, s);
  console.log(before === s ? "unchanged" : "patched", file);
}

/* 1) D1 migration */
write("cloudflare/studyal-api/migrations/0003_premium_onboarding.sql", `
ALTER TABLE users ADD COLUMN onboarding_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;
ALTER TABLE users ADD COLUMN privacy_accepted_at TEXT;

ALTER TABLE profiles ADD COLUMN edad INTEGER;
ALTER TABLE profiles ADD COLUMN es_menor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN permiso_menor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN tipo_usuario TEXT;
ALTER TABLE profiles ADD COLUMN escuela TEXT;
ALTER TABLE profiles ADD COLUMN referral_source TEXT;
ALTER TABLE profiles ADD COLUMN objetivo TEXT;

UPDATE users SET onboarding_version = 0, onboarding_completed = 0;
UPDATE profiles SET onboarding_completo = 0;
`);

/* 2) Worker */
patch("cloudflare/studyal-api/src/index.ts", (s) => {
  s = s.replace(
    `const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first()`,
    `const user = await env.DB.prepare(\`
          SELECT
            u.*,
            p.nombre,
            p.avatar_url,
            p.tipo_usuario,
            p.tipo_estudiante,
            p.escuela,
            p.universidad,
            p.carrera,
            p.edad,
            p.es_menor,
            p.referral_source,
            p.objetivo
          FROM users u
          LEFT JOIN profiles p ON p.user_id = u.id
          WHERE u.email = ?
        \`).bind(email).first()`
  );

  s = s.replace(
    `INSERT INTO users (id, email, name, image, provider, provider_account_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(email) DO UPDATE SET
            name = excluded.name,
            image = excluded.image,
            provider = excluded.provider,
            provider_account_id = excluded.provider_account_id,
            updated_at = datetime('now')`,
    `INSERT INTO users (id, email, name, image, provider, provider_account_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(email) DO UPDATE SET
            name = excluded.name,
            image = excluded.image,
            provider = excluded.provider,
            provider_account_id = excluded.provider_account_id,
            updated_at = datetime('now')`
  );

  s = s.replace(
    `INSERT INTO profiles (user_id, nombre, email, avatar_url, onboarding_completo, updated_at)
          VALUES (?, ?, ?, ?, 1, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET`,
    `INSERT INTO profiles (user_id, nombre, email, avatar_url, onboarding_completo, updated_at)
          VALUES (?, ?, ?, ?, 0, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET`
  );

  s = s.replace(
    `if (url.pathname === "/profiles/by-user" && request.method === "GET") {`,
    `if (url.pathname === "/onboarding/complete" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.user_id) return json({ ok: false, error: "user_id_required" }, 400)

        const edad = Number(body.edad || 0)
        const esMenor = edad > 0 && edad < 18 ? 1 : 0

        if (!body.nombre || !edad || !body.tipo_usuario) {
          return json({ ok: false, error: "missing_required_fields" }, 400)
        }

        if (esMenor && !body.permiso_menor) {
          return json({ ok: false, error: "minor_permission_required" }, 400)
        }

        if (!body.accepted_terms || !body.accepted_privacy) {
          return json({ ok: false, error: "legal_acceptance_required" }, 400)
        }

        await env.DB.prepare(\`
          UPDATE users SET
            name = ?,
            onboarding_version = ?,
            onboarding_completed = 1,
            terms_accepted_at = datetime('now'),
            privacy_accepted_at = datetime('now'),
            updated_at = datetime('now')
          WHERE id = ?
        \`).bind(body.nombre, Number(body.onboarding_version || ${CURRENT}), body.user_id).run()

        await env.DB.prepare(\`
          INSERT INTO profiles (
            user_id, nombre, email, avatar_url, descripcion, genero,
            tipo_estudiante, universidad, carrera, onboarding_completo,
            edad, es_menor, permiso_menor, tipo_usuario, escuela,
            referral_source, objetivo, updated_at
          )
          VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET
            nombre = excluded.nombre,
            email = COALESCE(excluded.email, profiles.email),
            avatar_url = COALESCE(excluded.avatar_url, profiles.avatar_url),
            descripcion = COALESCE(excluded.descripcion, profiles.descripcion),
            genero = NULL,
            tipo_estudiante = excluded.tipo_estudiante,
            universidad = excluded.universidad,
            carrera = excluded.carrera,
            onboarding_completo = 1,
            edad = excluded.edad,
            es_menor = excluded.es_menor,
            permiso_menor = excluded.permiso_menor,
            tipo_usuario = excluded.tipo_usuario,
            escuela = excluded.escuela,
            referral_source = excluded.referral_source,
            objetivo = excluded.objetivo,
            updated_at = datetime('now')
        \`).bind(
          body.user_id,
          body.nombre,
          body.email || null,
          body.avatar_url || null,
          body.descripcion || null,
          body.tipo_usuario || null,
          body.universidad || null,
          body.carrera || null,
          edad,
          esMenor,
          body.permiso_menor ? 1 : 0,
          body.tipo_usuario || null,
          body.escuela || null,
          body.referral_source || null,
          body.objetivo || null
        ).run()

        await env.DB.prepare(\`
          INSERT INTO leaderboard (
            user_id, nombre, email, avatar_url, xp_total, flashcards_estudiadas,
            racha_actual, mejor_racha, precision_global, visible_leaderboard,
            descripcion, genero, tipo_estudiante, universidad, carrera, quizzes_completados, updated_at
          )
          VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, ?, NULL, NULL, ?, ?, ?, 0, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET
            nombre = excluded.nombre,
            email = COALESCE(excluded.email, leaderboard.email),
            avatar_url = COALESCE(excluded.avatar_url, leaderboard.avatar_url),
            visible_leaderboard = excluded.visible_leaderboard,
            genero = NULL,
            tipo_estudiante = excluded.tipo_estudiante,
            universidad = excluded.universidad,
            carrera = excluded.carrera,
            updated_at = datetime('now')
        \`).bind(
          body.user_id,
          body.nombre,
          body.email || null,
          body.avatar_url || null,
          body.visible_leaderboard ? 1 : 0,
          body.tipo_usuario || null,
          body.universidad || body.escuela || null,
          body.carrera || null
        ).run()

        const profile = await env.DB.prepare("SELECT * FROM profiles WHERE user_id = ?").bind(body.user_id).first()
        return json({ ok: true, profile })
      }

      if (url.pathname === "/profiles/by-user" && request.method === "GET") {`
  );

  s = s.replace(
    `tipo_estudiante, universidad, carrera, onboarding_completo, updated_at`,
    `tipo_estudiante, universidad, carrera, onboarding_completo, updated_at`
  );

  return s;
});

/* 3) Next API */
write("app/api/onboarding/route.ts", `
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../lib/auth/options';

const API = process.env.STUDYAL_API_URL || '';
export const CURRENT_ONBOARDING_VERSION = ${CURRENT};

export async function GET() {
  try {
    const session: any = await getServerSession(authOptions);
    const user = session?.user;
    if (!user?.id) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });

    if (!API) {
      return NextResponse.json({
        success: true,
        currentVersion: CURRENT_ONBOARDING_VERSION,
        needsOnboarding: false,
        user: { id: user.id, name: user.name, email: user.email, image: user.image },
      });
    }

    const res = await fetch(\`\${API}/users/by-email?email=\${encodeURIComponent(user.email || '')}\`, { cache: 'no-store' });
    const data = await res.json();
    const remoteUser = data.user || null;
    const version = Number(remoteUser?.onboarding_version || 0);
    const completed = Number(remoteUser?.onboarding_completed || 0) === 1;

    return NextResponse.json({
      success: true,
      currentVersion: CURRENT_ONBOARDING_VERSION,
      needsOnboarding: !completed || version < CURRENT_ONBOARDING_VERSION,
      user: {
        ...remoteUser,
        id: user.id,
        name: remoteUser?.name || user.name,
        email: user.email,
        image: remoteUser?.image || user.image,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Error interno' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session: any = await getServerSession(authOptions);
    const user = session?.user;
    if (!user?.id) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });

    const body = await req.json();

    if (!API) return NextResponse.json({ success: true });

    const payload = {
      ...body,
      user_id: user.id,
      email: user.email,
      avatar_url: user.image || body.avatar_url || null,
      onboarding_version: CURRENT_ONBOARDING_VERSION,
    };

    const res = await fetch(\`\${API}/onboarding/complete\`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || json.ok === false) {
      return NextResponse.json({ success: false, error: json.error || 'No se pudo guardar onboarding' }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: json.profile || null });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Error interno' }, { status: 500 });
  }
}
`);

/* 4) OnboardingCheck */
write("components/OnboardingCheck.tsx", `
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
`);

/* 5) Premium OnboardingModal */
write("components/OnboardingModal.tsx", `
'use client';

import { useMemo, useState } from 'react';

const UNIVERSIDADES = [
  'Universidad Latina de Panamá','Universidad de Panamá','Universidad Tecnológica de Panamá','USMA','UDELAS','UMECIT',
  'Universidad del Istmo','Columbus University','ISAE Universidad','Universidad Interamericana de Panamá',
  'Harvard','MIT','Stanford','Notre Dame','IE University','Universidad de Miami','TEC de Monterrey','Otra universidad',
];

const ESCUELAS = [
  'Colegio Javier','Colegio Brader','AIP','Balboa Academy','Metropolitan School','Colegio Episcopal de Panamá',
  'Colegio Real de Panamá','Colegio San Agustín','Oxford School','Colegio La Salle','Instituto Panamericano',
  'Instituto Nacional','Artes y Oficios','Instituto Fermín Naudeau','Colegio Internacional de Panamá','Otra escuela',
];

const CARRERAS = [
  'Medicina','Ingeniería en Sistemas','Ingeniería Civil','Derecho','Psicología','Administración de Empresas',
  'Contabilidad','Arquitectura','Diseño Gráfico','Marketing','Comunicación Social','Educación','Biología',
  'Química','Física','Matemáticas','Enfermería','Odontología','Fisioterapia','Farmacia','Otra carrera',
];

const REFERRALS = [
  ['google','🔎','Google'],
  ['tiktok','🎵','TikTok'],
  ['instagram','📸','Instagram'],
  ['youtube','▶️','YouTube'],
  ['amigos_familia','👥','Amigos / Familia'],
  ['dueno','👨‍💻','El fundador'],
  ['otro','✨','Otro'],
];

const OBJECTIVES = [
  ['mejorar_notas','📈','Mejorar mis notas'],
  ['aprobar_examen','🎯','Aprobar un examen'],
  ['entender_materias','🧠','Entender mejor mis materias'],
  ['habito_estudio','📚','Crear un hábito de estudio'],
  ['graduarme','🎓','Graduarme'],
  ['otro','✨','Otro'],
];

type Step = 'welcome' | 'name' | 'age' | 'type' | 'school' | 'university' | 'referral' | 'objective' | 'legal' | 'finish';

interface Props {
  nombre: string;
  onComplete: () => void;
}

function cx(active: boolean): React.CSSProperties {
  return {
    border: active ? '2px solid var(--gold)' : '2px solid var(--border-color)',
    background: active ? 'color-mix(in srgb, var(--gold) 15%, var(--bg-card))' : 'var(--bg-secondary)',
    color: active ? 'var(--gold)' : 'var(--text-primary)',
    boxShadow: active ? '0 0 0 4px color-mix(in srgb, var(--gold) 12%, transparent)' : 'none',
  };
}

export default function OnboardingModal({ nombre, onComplete }: Props) {
  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState(nombre || '');
  const [age, setAge] = useState('');
  const [minorPermission, setMinorPermission] = useState(false);
  const [type, setType] = useState('');
  const [school, setSchool] = useState('');
  const [schoolCustom, setSchoolCustom] = useState('');
  const [university, setUniversity] = useState('');
  const [universityCustom, setUniversityCustom] = useState('');
  const [career, setCareer] = useState('');
  const [careerCustom, setCareerCustom] = useState('');
  const [referral, setReferral] = useState('');
  const [referralOther, setReferralOther] = useState('');
  const [objective, setObjective] = useState('');
  const [objectiveOther, setObjectiveOther] = useState('');
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [leaderboard, setLeaderboard] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const schoolFinal = school === 'Otra escuela' ? schoolCustom.trim() : school;
  const universityFinal = university === 'Otra universidad' ? universityCustom.trim() : university;
  const careerFinal = career === 'Otra carrera' ? careerCustom.trim() : career;
  const referralFinal = referral === 'otro' ? referralOther.trim() : referral;
  const objectiveFinal = objective === 'otro' ? objectiveOther.trim() : objective;

  const isMinor = Number(age) > 0 && Number(age) < 18;

  const steps = useMemo<Step[]>(() => {
    const base: Step[] = ['welcome','name','age','type'];
    if (type === 'estudiante') base.push('school');
    if (type === 'universitario') base.push('university');
    base.push('referral','objective','legal','finish');
    return base;
  }, [type]);

  const index = Math.max(0, steps.indexOf(step));
  const progress = Math.round(((index + 1) / steps.length) * 100);

  const title = {
    welcome: 'Bienvenido a StudyAL.',
    name: '¿Cómo te llamas?',
    age: '¿Qué edad tienes?',
    type: '¿Quién eres?',
    school: '¿En qué escuela estudias?',
    university: '¿Dónde estudias?',
    referral: '¿Cómo conociste StudyAL?',
    objective: '¿Qué quieres lograr?',
    legal: 'Antes de entrar',
    finish: 'Todo listo.',
  }[step];

  function canContinue() {
    if (step === 'welcome') return true;
    if (step === 'name') return name.trim().length >= 2;
    if (step === 'age') return Number(age) > 0 && Number(age) < 120 && (!isMinor || minorPermission);
    if (step === 'type') return !!type;
    if (step === 'school') return !!schoolFinal;
    if (step === 'university') return !!universityFinal && !!careerFinal;
    if (step === 'referral') return !!referralFinal;
    if (step === 'objective') return !!objectiveFinal;
    if (step === 'legal') return terms && privacy;
    return true;
  }

  function next() {
    const i = steps.indexOf(step);
    if (step === 'legal') return save();
    if (i < steps.length - 1) setStep(steps[i + 1]);
  }

  function back() {
    const i = steps.indexOf(step);
    if (i > 0) setStep(steps[i - 1]);
  }

  async function save() {
    if (!canContinue()) return;
    setSaving(true);
    setErr('');

    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          nombre: name.trim(),
          edad: Number(age),
          permiso_menor: minorPermission,
          tipo_usuario: type,
          escuela: type === 'estudiante' ? schoolFinal : null,
          universidad: type === 'universitario' ? universityFinal : null,
          carrera: type === 'universitario' ? careerFinal : null,
          referral_source: referralFinal,
          objetivo: objectiveFinal,
          accepted_terms: terms,
          accepted_privacy: privacy,
          visible_leaderboard: leaderboard,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) throw new Error(json.error || 'No se pudo guardar');

      setStep('finish');
      setTimeout(onComplete, 1800);
    } catch (e: any) {
      setErr(e?.message || 'No se pudo guardar. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  const input: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    border: '2px solid var(--border-color)',
    borderRadius: 18,
    padding: '16px 18px',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    fontSize: 18,
    fontWeight: 800,
    outline: 'none',
  };

  const card: React.CSSProperties = {
    width: '100%',
    borderRadius: 18,
    padding: '16px 18px',
    cursor: 'pointer',
    textAlign: 'left',
    fontWeight: 900,
    transition: 'all .18s ease',
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 99999,
      background: 'radial-gradient(circle at 30% 20%, color-mix(in srgb, var(--gold) 18%, transparent), transparent 35%), var(--bg-primary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 18,
    }}>
      <div style={{
        width: '100%',
        maxWidth: 760,
        minHeight: 560,
        maxHeight: '92vh',
        overflow: 'hidden',
        borderRadius: 34,
        border: '2px solid var(--text-primary)',
        background: 'color-mix(in srgb, var(--bg-card) 92%, transparent)',
        boxShadow: '10px 10px 0 var(--text-primary), 0 30px 100px rgba(0,0,0,.45)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ padding: '18px 22px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img src="/logo.png" alt="StudyAL" style={{ width: 38, height: 38, objectFit: 'contain', transform: 'scale(1.8)' }} />
              <strong style={{ fontSize: 20, color: 'var(--text-primary)' }}>Study<span style={{ color: 'var(--gold)' }}>AL</span></strong>
            </div>
            <div style={{ color: 'var(--text-faint)', fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>
              Paso {index + 1} de {steps.length}
            </div>
          </div>
          <div style={{ height: 8, background: 'var(--bg-secondary)', borderRadius: 999, marginTop: 16, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: progress + '%', background: 'var(--gold)', transition: 'width .35s ease' }} />
          </div>
        </div>

        <div style={{ padding: '34px clamp(24px, 6vw, 58px)', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 'clamp(32px, 6vw, 56px)', lineHeight: .94, letterSpacing: '-2px', margin: 0, color: 'var(--text-primary)', fontWeight: 950 }}>
              {title}
            </h1>
            <p style={{ margin: '14px 0 0', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1.6, fontWeight: 650 }}>
              {step === 'welcome' && 'ALAI va a preparar tu experiencia para ayudarte a entender, practicar y dominar tus materias.'}
              {step === 'name' && 'Este será tu nombre visible en StudyAL.'}
              {step === 'age' && 'Tu edad nunca será pública. Solo la usamos para seguridad y experiencia.'}
              {step === 'type' && 'Así StudyAL adapta mejor tu espacio.'}
              {step === 'school' && 'Tu escuela puede aparecer en tu perfil público si decides salir en el leaderboard.'}
              {step === 'university' && 'Tu universidad y carrera pueden aparecer en tu perfil público si decides salir en el leaderboard.'}
              {step === 'referral' && 'Esto nos ayuda a saber qué canales están trayendo estudiantes reales.'}
              {step === 'objective' && 'ALAI usará esto para entender qué tipo de ayuda quieres recibir.'}
              {step === 'legal' && 'Acepta los términos y elige si quieres aparecer en el leaderboard público.'}
              {step === 'finish' && 'ALAI está preparando tu espacio de estudio.'}
            </p>
          </div>

          {step === 'welcome' && (
            <div style={{ display: 'grid', gap: 12 }}>
              {[
                ['📄','Subes tus materiales'],
                ['🧠','ALAI los entiende'],
                ['🎯','Sigues el proceso y dominas el tema'],
              ].map(([e,t]) => (
                <div key={t} style={{ padding: 18, borderRadius: 18, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', display: 'flex', gap: 14, alignItems: 'center', fontWeight: 900, color: 'var(--text-primary)' }}>
                  <span style={{ fontSize: 28 }}>{e}</span>{t}
                </div>
              ))}
            </div>
          )}

          {step === 'name' && <input style={input} autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Tu nombre" />}

          {step === 'age' && (
            <div>
              <input style={input} type="number" min={1} max={119} value={age} onChange={e => setAge(e.target.value)} placeholder="Edad" />
              {isMinor && (
                <label style={{ marginTop: 16, display: 'flex', gap: 12, padding: 16, borderRadius: 18, background: 'var(--bg-secondary)', border: '2px solid var(--gold)', color: 'var(--text-primary)', fontWeight: 800, cursor: 'pointer' }}>
                  <input type="checkbox" checked={minorPermission} onChange={e => setMinorPermission(e.target.checked)} />
                  Confirmo que tengo autorización de mi padre, madre o tutor para utilizar StudyAL.
                </label>
              )}
            </div>
          )}

          {step === 'type' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
              {[
                ['estudiante','🎒','Estudiante'],
                ['universitario','🎓','Universitario'],
                ['profesor','👨‍🏫','Profesor'],
                ['otro','✨','Otro'],
              ].map(([id, emoji, label]) => (
                <button key={id} onClick={() => setType(id)} style={{ ...card, ...cx(type === id), minHeight: 92 }}>
                  <span style={{ fontSize: 30, marginRight: 10 }}>{emoji}</span>{label}
                </button>
              ))}
            </div>
          )}

          {step === 'school' && (
            <Picker value={school} setValue={setSchool} custom={schoolCustom} setCustom={setSchoolCustom} options={ESCUELAS} customTrigger="Otra escuela" placeholder="Buscar escuela..." inputStyle={input} />
          )}

          {step === 'university' && (
            <div style={{ display: 'grid', gap: 16 }}>
              <Picker value={university} setValue={setUniversity} custom={universityCustom} setCustom={setUniversityCustom} options={UNIVERSIDADES} customTrigger="Otra universidad" placeholder="Buscar universidad..." inputStyle={input} />
              <Picker value={career} setValue={setCareer} custom={careerCustom} setCustom={setCareerCustom} options={CARRERAS} customTrigger="Otra carrera" placeholder="Buscar carrera..." inputStyle={input} />
            </div>
          )}

          {step === 'referral' && (
            <GridOptions items={REFERRALS} value={referral} onChange={setReferral} />
          )}
          {step === 'referral' && referral === 'otro' && <input style={{ ...input, marginTop: 14 }} value={referralOther} onChange={e => setReferralOther(e.target.value)} placeholder="Cuéntanos dónde" />}

          {step === 'objective' && (
            <GridOptions items={OBJECTIVES} value={objective} onChange={setObjective} />
          )}
          {step === 'objective' && objective === 'otro' && <input style={{ ...input, marginTop: 14 }} value={objectiveOther} onChange={e => setObjectiveOther(e.target.value)} placeholder="Escribe tu objetivo" />}

          {step === 'legal' && (
            <div style={{ display: 'grid', gap: 14 }}>
              <Check checked={terms} setChecked={setTerms}>Acepto los Términos y Condiciones de StudyAL.</Check>
              <Check checked={privacy} setChecked={setPrivacy}>Acepto la Política de Privacidad de StudyAL.</Check>
              <Check checked={leaderboard} setChecked={setLeaderboard}>Quiero aparecer en el leaderboard público de StudyAL.</Check>

              <div style={{ padding: 16, borderRadius: 18, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>Público si activas leaderboard:</strong>
                <p style={{ color: 'var(--text-muted)', margin: '8px 0 0', lineHeight: 1.6 }}>Nombre, tipo de usuario, escuela/universidad, avatar y estadísticas como XP, racha, flashcards, quizzes y exámenes.</p>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginTop: 12 }}>Nunca público:</strong>
                <p style={{ color: 'var(--text-muted)', margin: '8px 0 0', lineHeight: 1.6 }}>Edad, email, objetivo, cómo conociste StudyAL, permiso de menor e información privada.</p>
              </div>
            </div>
          )}

          {step === 'finish' && (
            <div style={{ display: 'grid', gap: 12 }}>
              {['Perfil creado','ALAI listo','Sistema adaptativo preparado','Estadísticas inicializadas','Espacio de estudio listo'].map(x => (
                <div key={x} style={{ color: 'var(--text-primary)', fontWeight: 900, padding: 14, borderRadius: 16, background: 'var(--bg-secondary)' }}>✓ {x}</div>
              ))}
            </div>
          )}

          {err && <p style={{ color: '#ef4444', fontWeight: 800, marginTop: 16 }}>{err}</p>}
        </div>

        {step !== 'finish' && (
          <div style={{ padding: '0 22px 22px', display: 'flex', gap: 12 }}>
            {index > 0 && (
              <button onClick={back} style={{ padding: '14px 20px', borderRadius: 16, border: '2px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontWeight: 900, cursor: 'pointer' }}>
                Atrás
              </button>
            )}
            <button disabled={!canContinue() || saving} onClick={next} style={{
              flex: 1,
              padding: '15px 22px',
              borderRadius: 16,
              border: 'none',
              background: canContinue() && !saving ? 'var(--gold)' : 'var(--bg-secondary)',
              color: canContinue() && !saving ? '#000' : 'var(--text-faint)',
              fontWeight: 950,
              cursor: canContinue() && !saving ? 'pointer' : 'not-allowed',
              fontSize: 15,
            }}>
              {saving ? 'Guardando...' : step === 'legal' ? 'Entrar a StudyAL' : index === 0 ? 'Comenzar' : 'Continuar'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function GridOptions({ items, value, onChange }: any) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
      {items.map(([id, emoji, label]: any) => (
        <button key={id} onClick={() => onChange(id)} style={{ borderRadius: 18, padding: 16, cursor: 'pointer', textAlign: 'left', fontWeight: 950, ...cx(value === id) }}>
          <span style={{ fontSize: 26, marginRight: 8 }}>{emoji}</span>{label}
        </button>
      ))}
    </div>
  );
}

function Picker({ value, setValue, custom, setCustom, options, customTrigger, placeholder, inputStyle }: any) {
  const [q, setQ] = useState('');
  const filtered = options.filter((o: string) => o.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  return (
    <div>
      <input style={inputStyle} value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} />
      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        {filtered.map((o: string) => (
          <button key={o} onClick={() => setValue(o)} style={{ padding: 12, borderRadius: 14, cursor: 'pointer', textAlign: 'left', fontWeight: 850, ...cx(value === o) }}>
            {o}
          </button>
        ))}
      </div>
      {value === customTrigger && (
        <input style={{ ...inputStyle, marginTop: 10 }} value={custom} onChange={e => setCustom(e.target.value)} placeholder="Escríbelo aquí" />
      )}
    </div>
  );
}

function Check({ checked, setChecked, children }: any) {
  return (
    <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 16, borderRadius: 18, background: 'var(--bg-secondary)', border: checked ? '2px solid var(--gold)' : '1px solid var(--border-color)', color: 'var(--text-primary)', fontWeight: 850, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} style={{ marginTop: 3 }} />
      <span>{children}</span>
    </label>
  );
}
`);

/* 6) user-profile API accepts new fields */
patch("app/api/user-profile/route.ts", (s) => {
  s = s.replace(
    `genero: body.genero || null,
      tipo_estudiante: body.tipo_estudiante || null,
      universidad: body.universidad || null,
      carrera: body.carrera || null,
      onboarding_completo: body.onboarding_completo ?? true,`,
    `genero: null,
      tipo_estudiante: body.tipo_estudiante || body.tipo_usuario || null,
      tipo_usuario: body.tipo_usuario || body.tipo_estudiante || null,
      universidad: body.universidad || null,
      escuela: body.escuela || null,
      carrera: body.carrera || null,
      edad: body.edad || null,
      es_menor: body.es_menor ?? null,
      permiso_menor: body.permiso_menor ?? null,
      referral_source: body.referral_source || null,
      objetivo: body.objetivo || null,
      onboarding_completo: body.onboarding_completo ?? true,`
  );
  return s;
});

console.log("\\n✅ StudyAL premium onboarding patch aplicado.");
console.log("Siguiente: aplicar migración D1, typecheck y build.");
