import fs from "fs";

function patch(file, fn) {
  let s = fs.readFileSync(file, "utf8");
  const before = s;
  s = fn(s);
  fs.writeFileSync(file, s);
  console.log((s === before ? "unchanged" : "patched"), file);
}

/* PARTNERS */
patch("app/partners/page.tsx", (s) => {
  s = s.replace("import { supabase } from '../../lib/supabase';\n", "import { useSession } from 'next-auth/react';\n");
  s = s.replace("  const { tr, idioma } = useIdioma();", "  const { tr, idioma } = useIdioma();\n  const { data: session, status } = useSession();");
  s = s.replace("  const [token, setToken] = useState('');", "  const [token, setToken] = useState('nextauth');");

  s = s.replace(/  useEffect\(\(\) => \{\n    const init = async \(\) => \{[\s\S]*?    init\(\);\n  \}, \[\]\);/, `  useEffect(() => {
    if (status === 'loading') return;
    const u: any = session?.user;
    if (!u?.id) {
      try { (window as any).__showNavLoader?.('/landing'); } catch {}
      router.push('/landing');
      return;
    }

    setMiUserId(u.id);
    setToken('nextauth');
    setMiInfo({
      user_id: u.id,
      nombre: u.name || u.email?.split('@')[0] || '',
      avatar_url: u.image || undefined,
    });

    fetch('/api/leaderboard', { cache: 'no-store', credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => {
        const lb = (d.data || []).find((x: any) => x.user_id === u.id);
        if (lb) setMiInfo(p => ({
          ...p,
          nombre: lb.nombre || p.nombre,
          avatar_url: lb.avatar_url || p.avatar_url,
          carrera: lb.carrera || p.carrera,
        }));
      })
      .catch(() => {});
  }, [session, status, router]);`);

  s = s.replace(/  useEffect\(\(\) => \{\n    if \(!miUserId\) return;\n    supabase\.from\('leaderboard'\)[\s\S]*?  \}, \[miUserId\]\);/, `  useEffect(() => {
    if (!miUserId) return;
    fetch('/api/leaderboard', { cache: 'no-store', credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => {
        const users = (d.data || [])
          .filter((u: any) => u.visible_leaderboard !== false && u.visible_leaderboard !== 0 && u.user_id !== miUserId)
          .sort((a: any, b: any) => Number(b.xp_total || 0) - Number(a.xp_total || 0))
          .slice(0, 50);
        setTodosUsers(users);
      })
      .catch(() => {});
  }, [miUserId]);`);

  s = s.replace(/  const buscar = useCallback\(async \(q: string\) => \{[\s\S]*?  \}, \[miUserId\]\);/, `  const buscar = useCallback(async (q: string) => {
    if (!q.trim()) { setResultados([]); return; }
    setBuscando(true);
    try {
      const res = await fetch('/api/leaderboard', { cache: 'no-store', credentials: 'same-origin' });
      const d = await res.json();
      const term = q.trim().toLowerCase();
      const users = (d.data || [])
        .filter((u: any) =>
          u.visible_leaderboard !== false &&
          u.visible_leaderboard !== 0 &&
          u.user_id !== miUserId &&
          String(u.nombre || '').toLowerCase().includes(term)
        )
        .slice(0, 20);
      setResultados(users);
    } catch {
      setResultados([]);
    }
    setBuscando(false);
  }, [miUserId]);`);

  s = s.replaceAll("headers: { Authorization: `Bearer ${token}` }", "credentials: 'same-origin'");
  s = s.replaceAll("headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }", "headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin'");
  return s;
});

/* SETTINGS */
patch("app/settings/page.tsx", (s) => {
  s = s.replace("import { supabase } from '../../lib/supabase';\n", "");

  s = s.replace(/      try \{\n        const \{ data: lb \} = await supabase\n          \.from\('leaderboard'\)[\s\S]*?      \} catch \{\}\n\n      try \{\n        const \{ data: lb \} = await supabase\n          \.from\('leaderboard'\)[\s\S]*?      \} catch \{\}\n/, `      try {
        const res = await fetch('/api/leaderboard', { cache: 'no-store', credentials: 'same-origin' });
        const json = await res.json();
        const lb = (json.data || []).find((x: any) => x.user_id === data.user.id);
        if (lb) {
          setDescripcion(lb.descripcion || '');
          setGenero(lb.genero || '');
          setTipoEstudiante(lb.tipo_estudiante || '');
          setVisibleLeaderboard(lb.visible_leaderboard !== false && lb.visible_leaderboard !== 0);
          if (lb.tipo_estudiante === 'universitario') {
            setUniversidad(lb.universidad || '');
            setCarrera(lb.carrera || '');
          } else if (lb.tipo_estudiante === 'escuela') {
            setEscuela(lb.universidad || '');
          }
        }
      } catch {}

`);

  s = s.replace(/      try \{\n        const \{ data: lb \} = await supabase\n          \.from\('leaderboard'\)[\s\S]*?      \} catch \{\}\n      setCargando\(false\);/, `      try {
        const res = await fetch('/api/leaderboard', { cache: 'no-store', credentials: 'same-origin' });
        const json = await res.json();
        const lb = (json.data || []).find((x: any) => x.user_id === data.user.id);
        if (lb?.avatar_url) {
          setSettings(prev => ({ ...prev, fotoPerfil: lb.avatar_url }));
          saveSettings({ ...localSettings, fotoPerfil: lb.avatar_url });
        }
      } catch {}
      setCargando(false);`);

  s = s.replace(/      const \{ error \} = await supabase\.auth\.updateUser\(\{ data: \{ nombre \} \}\);\n      if \(error\) throw error;\n\n      const \{ data: sessionData \} = await supabase\.auth\.getSession\(\);\n      const token = sessionData\.session\?\.access_token;\n      if \(token\) \{([\s\S]*?)      \}/, `      {
$1      }`);

  s = s.replaceAll("'Authorization': `Bearer ${token}`", "");
  s = s.replaceAll(", 'Authorization': `Bearer ${session.access_token}`", "");
  s = s.replaceAll(", 'Authorization': `Bearer ${s.session.access_token}`", "");

  s = s.replace(/        const \{ data: sessionData \} = await supabase\.auth\.getSession\(\);\n        const session = sessionData\.session;\n        if \(session\) \{([\s\S]*?)        \}/, `        {
$1        }`);

  s = s.replace(/                          const \{ data: s \} = await supabase\.auth\.getSession\(\);\n                          if \(s\.session\) \{([\s\S]*?)                          \}/, `                          {
$1                          }`);

  s = s.replace(/                  if \(userId\) \{\n                    try \{\n                      await supabase\.from\('leaderboard'\)\.update\(\{ visible_leaderboard: newVal \}\)\.eq\('user_id', userId\);\n                    \} catch \{\}\n                  \}/, `                  try {
                    await fetch('/api/leaderboard', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'same-origin',
                      body: JSON.stringify({ visible_leaderboard: newVal }),
                    });
                  } catch {}`);

  s = s.replace(/                <SecondaryBtn onClick=\{async \(\) => \{\n                  const \{ data \} = await supabase\.auth\.getUser\(\);\n                  if \(data\.user\?\.id\) \{ const uid = data\.user\.id; \(window as any\)\.__showNavLoader\?\.\(`\/u\/\$\{uid\}`\); router\.push\(`\/u\/\$\{uid\}`\); \}\n                \}\} color="var\(--blue\)">/, `                <SecondaryBtn onClick={async () => {
                  if (userId) { const uid = userId; (window as any).__showNavLoader?.(\`/u/\${uid}\`); router.push(\`/u/\${uid}\`); }
                }} color="var(--blue)">`);

  s = s.replaceAll("Supabase (cloud) ✅", "Cloudflare D1 ✅");
  return s;
});

/* ONBOARDING CHECK */
patch("components/OnboardingCheck.tsx", (s) => {
  s = s.replace("import { supabase } from '../lib/supabase';\n", "import { useSession } from 'next-auth/react';\n");
  s = s.replace("  const [checked, setChecked] = useState(false);", "  const [checked, setChecked] = useState(false);\n  const { data: session, status } = useSession();");

  s = s.replace(/  useEffect\(\(\) => \{\n    const check = async \(\) => \{[\s\S]*?    check\(\);\n  \}, \[\]\);/, `  useEffect(() => {
    const check = async () => {
      try {
        if (status === 'loading') return;
        const user: any = session?.user;
        if (!user?.id) { setChecked(true); return; }

        const userId = user.id;
        const userName = user.name || user.email?.split('@')[0] || '';

        const res = await fetch('/api/leaderboard', { cache: 'no-store', credentials: 'same-origin' });
        const json = await res.json().catch(() => ({}));
        const entry = (json.data || []).find((x: any) => x.user_id === userId);

        if (entry?.genero && entry?.tipo_estudiante) {
          if (!entry.user_agreement) {
            setNombre(userName);
            setShowAgreement(true);
          }
          setChecked(true);
          return;
        }

        const localDone = localStorage.getItem(\`josea_onboarding_done_\${userId}\`);
        if (localDone === 'true') {
          setChecked(true);
          return;
        }

        setNombre(userName);
        setShowOnboarding(true);
      } catch (err) {
        console.error('OnboardingCheck error:', err);
        setChecked(true);
      } finally {
        setChecked(true);
      }
    };

    check();
  }, [session, status]);`);

  s = s.replace(/                  const \{ data \} = await supabase\.auth\.getSession\(\);\n                  if \(data\.session\) \{\n                    await supabase\.from\('leaderboard'\)\.update\(\{\n                      user_agreement: true,\n                      user_agreement_date: new Date\(\)\.toISOString\(\),\n                      visible_leaderboard: true,\n                    \}\)\.eq\('user_id', data\.session\.user\.id\);\n                  \}/, `                  await fetch('/api/leaderboard', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                      user_agreement: true,
                      user_agreement_date: new Date().toISOString(),
                      visible_leaderboard: true,
                    }),
                  });`);

  s = s.replace(/                  const \{ data \} = await supabase\.auth\.getSession\(\);\n                  if \(data\.session\) \{\n                    await supabase\.from\('leaderboard'\)\.update\(\{\n                      user_agreement: false,\n                      user_agreement_date: new Date\(\)\.toISOString\(\),\n                      visible_leaderboard: false,\n                    \}\)\.eq\('user_id', data\.session\.user\.id\);\n                  \}/, `                  await fetch('/api/leaderboard', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                      user_agreement: false,
                      user_agreement_date: new Date().toISOString(),
                      visible_leaderboard: false,
                    }),
                  });`);

  return s;
});

/* ONBOARDING MODAL */
patch("components/OnboardingModal.tsx", (s) => {
  s = s.replace("import { supabase } from '../lib/supabase';\n", "import { getSession } from 'next-auth/react';\n");

  s = s.replace(/      const \{ data: sessionData \} = await supabase\.auth\.getSession\(\);\n      const session = sessionData\.session;\n      if \(!session\) \{ onComplete\(\); return; \}/, `      const session: any = await getSession();
      if (!session?.user?.id) { onComplete(); return; }`);

  s = s.replace("      const userId = session.user.id;", "      const userId = session.user.id;");
  s = s.replace(/      const \{ error: updateErr \} = await supabase\.from\('leaderboard'\)\.update\(\{[\s\S]*?      if \(updateErr\) \{\n        await supabase\.from\('leaderboard'\)\.insert\(\{[\s\S]*?        \}\);\n      \}\n/, "");

  s = s.replaceAll("'Authorization': `Bearer ${session.access_token}`", "");
  return s;
});

/* PUBLICAR COMUNIDAD: avatar desde /api/leaderboard */
patch("components/PublicarComunidad.tsx", (s) => {
  s = s.replace(/      \/\/ Buscar avatar real desde leaderboard[\s\S]*?      \} catch \{\}/, `      // Buscar avatar real desde leaderboard en D1
      try {
        const res = await fetch('/api/leaderboard', { cache: 'no-store', credentials: 'same-origin' });
        const json = await res.json();
        const lb = (json.data || []).find((x: any) => x.user_id === userId);
        if (lb?.avatar_url) avatar = lb.avatar_url;
      } catch {}`);
  return s;
});
