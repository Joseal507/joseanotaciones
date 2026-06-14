import fs from "fs";

function patch(file, fn) {
  let s = fs.readFileSync(file, "utf8");
  const before = s;
  s = fn(s);
  fs.writeFileSync(file, s);
  console.log((s === before ? "unchanged" : "patched"), file);
}

/* NEWS: NextAuth admin + no Bearer */
patch("app/news/page.tsx", (s) => {
  s = s.replace("import { supabase } from '../../lib/supabase';", "import { getSession } from 'next-auth/react';\nimport { supabase } from '../../lib/supabase';");

  s = s.replace(
`  const checkAdmin = async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user?.email?.toLowerCase() === ADMIN_EMAIL) {
      setIsAdmin(true);
    }
  };`,
`  const checkAdmin = async () => {
    const session: any = await getSession();
    if (session?.user?.email?.toLowerCase() === ADMIN_EMAIL) {
      setIsAdmin(true);
    }
  };`
  );

  s = s.replace(
`      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/news', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': \`Bearer \${token}\` } : {}),
        },
        body: JSON.stringify({ titulo, descripcion, contenido, tipo, media_url: mediaUrl, categoria, destacada }),
      });`,
`      const res = await fetch('/api/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ titulo, descripcion, contenido, tipo, media_url: mediaUrl, categoria, destacada }),
      });`
  );

  s = s.replace(
`      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(\`/api/news?id=\${id}\`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': \`Bearer \${token}\` } : {},
      });`,
`      const res = await fetch(\`/api/news?id=\${id}\`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });`
  );

  return s;
});

/* PUBLICAR COMUNIDAD: NextAuth user + leaderboard D1 + no Bearer */
patch("components/PublicarComunidad.tsx", (s) => {
  s = s.replace("import { supabase } from '../lib/supabase';", "import { getSession } from 'next-auth/react';\nimport { supabase } from '../lib/supabase';");

  s = s.replace(
`      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      setUserNombre(user.user_metadata?.nombre || user.email?.split('@')[0] || 'Usuario');
      // Buscar avatar real desde leaderboard
      setUserAvatar(user.user_metadata?.avatar_url || '');
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
        const { data: lb } = await sb
          .from('leaderboard')
          .select('avatar_url')
          .eq('user_id', user.id)
          .single();
        if (lb?.avatar_url) setUserAvatar(lb.avatar_url);
      } catch {}`,
`      const session: any = await getSession();
      const user = session?.user;
      if (!user?.id) return;
      setUserId(user.id);
      setUserNombre(user.name || user.email?.split('@')[0] || 'Usuario');
      setUserAvatar(user.image || '');
      try {
        const res = await fetch('/api/leaderboard', { cache: 'no-store', credentials: 'same-origin' });
        const json = await res.json();
        const lb = (json.data || []).find((x: any) => x.user_id === user.id);
        if (lb?.avatar_url) setUserAvatar(lb.avatar_url);
      } catch {}`
  );

  s = s.replace(
`        const session = (await supabase.auth.getSession()).data.session;
        if (session) {
          const res  = await fetch('/api/materias', { headers: { 'Authorization': \`Bearer \${session.access_token}\` } });
          const data = await res.json();
          if (data.success && data.materias?.length > 0) setMaterias(data.materias);
        }`,
`        const res  = await fetch('/api/materias', { credentials: 'same-origin' });
        const data = await res.json();
        if (data.success && data.materias?.length > 0) setMaterias(data.materias);`
  );

  return s;
});

/* MATERIAS PAGE: delete material sin Supabase token */
patch("app/materias/page.tsx", (s) => {
  s = s.replace(
`      const session = (await import('../../lib/supabase').then(m => m.supabase.auth.getSession())).data.session;
      await fetch(\`/api/materials/\${materialId}\`, {
        method: 'DELETE',
        headers: session?.access_token ? { Authorization: \`Bearer \${session.access_token}\` } : {},
      });`,
`      await fetch(\`/api/materials/\${materialId}\`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });`
  );
  return s;
});

/* MATERIAL COMPONENTS: quitar Authorization tokens */
const materialFiles = [
  "components/materias/FlashcardsPage.tsx",
  "components/materias/SeleccionPaginas.tsx",
  "components/materias/RepasarViewer.tsx",
  "components/materias/FlashcardSourceViewer.tsx",
  "components/materias/QuizPage.tsx",
  "components/materias/AnalisisTeorico.tsx",
];

for (const file of materialFiles) {
  if (!fs.existsSync(file)) continue;
  patch(file, (s) => {
    s = s.replace(/import \{ supabase \} from ['"]\.\.\/\.\.\/lib\/supabase['"];?\n/g, "");
    s = s.replace(/import \{ supabase \} from ['"]@\/lib\/supabase['"];?\n/g, "");

    s = s.replace(/const session = \(await supabase\.auth\.getSession\(\)\)\.data\.session;\n\s*/g, "");
    s = s.replace(/const s = \(await supabase\.auth\.getSession\(\)\)\.data\.session;\n\s*/g, "");

    s = s.replace(/headers:\s*session\?\.access_token\s*\?\s*\{\s*Authorization:\s*`Bearer \$\{session\.access_token\}`\s*\}\s*:\s*\{\s*\},?/g, "credentials: 'same-origin',");
    s = s.replace(/headers:\s*s\?\.access_token\s*\?\s*\{\s*Authorization:\s*`Bearer \$\{s\.access_token\}`\s*\}\s*:\s*\{\s*\},?/g, "credentials: 'same-origin',");

    s = s.replace(/'Authorization':\s*`Bearer \$\{session\.access_token\}`,?/g, "");
    s = s.replace(/Authorization:\s*`Bearer \$\{session\.access_token\}`,?/g, "");
    s = s.replace(/'Authorization':\s*`Bearer \$\{s\.access_token\}`,?/g, "");
    s = s.replace(/Authorization:\s*`Bearer \$\{s\.access_token\}`,?/g, "");

    return s;
  });
}
