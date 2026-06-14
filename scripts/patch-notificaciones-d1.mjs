import fs from "fs";

const p = "components/NotificacionesPanel.tsx";
let s = fs.readFileSync(p, "utf8");

s = s.replace("import { supabase } from '../lib/supabase';\n", "import { getSession } from 'next-auth/react';\n");

s = s.replace(/      const \{ data: \{ user \} \} = await supabase\.auth\.getUser\(\);\n      if \(!user\) \{ setNotifs\(\[\]\); setLoading\(false\); return; \}\n      \/\/ Obtener token con timeout \(evita locks colgados\)[\s\S]*?\n      \/\/ \(daily reward removido del buzón\)/, `      const session: any = await getSession();
      const user = session?.user;
      if (!user?.id) { setNotifs([]); setLoading(false); return; }

      // (daily reward removido del buzón)`);

s = s.replace(/        if \(token\) \{\n          const res = await fetch\('\/api\/partners', \{\n            headers: \{ 'Authorization': 'Bearer ' \+ token \},\n          \}\);/, `        {
          const res = await fetch('/api/partners', { credentials: 'same-origin' });`);

s = s.replace(/        if \(token\) \{\n          const res = await fetch\('\/api\/notif-unread', \{\n            headers: \{ 'Authorization': 'Bearer ' \+ token \},\n          \}\);/, `        {
          const res = await fetch('/api/notif-unread', { credentials: 'same-origin' });`);

s = s.replace(/      \/\/ ── 4\) Comentarios en mis posts ──[\s\S]*?      \/\/ ── 5\) Posts de mis partners \(últimas 72h\) ──/, `      // ── 4) Comentarios en mis posts ──
      try {
        const postsRes = await fetch('/api/comunidad/posts?ownerId=' + encodeURIComponent(user.id), { credentials: 'same-origin' });
        const postsPayload = await postsRes.json().catch(() => ({}));
        const misPosts = postsPayload.posts || [];

        for (const post of misPosts.slice(0, 30)) {
          const commentsRes = await fetch('/api/comunidad/comentarios?post_id=' + encodeURIComponent(post.id), { credentials: 'same-origin' });
          const commentsPayload = await commentsRes.json().catch(() => ({}));
          const comments = commentsPayload.comentarios || [];

          comments
            .filter((c: any) => c.user_id !== user.id)
            .slice(0, 20)
            .forEach((c: any) => {
              const id = 'com-' + c.id;
              const nombreComentador = c.user_nombre || c.usuario_nombre || 'Alguien';
              out.push({
                id, tipo: 'comunidad',
                titulo: '💬 ' + nombreComentador + ' comentó',
                desc: 'En "' + (post.titulo || 'tu post') + '": ' + (c.contenido || '').substring(0, 50),
                emoji: '💬', color: '#a855f7',
                href: '/comunidad/' + post.id, fecha: c.created_at,
                leida: leidas.has(id),
              });
            });
        }
      } catch {}

      // ── 5) Posts de mis partners (últimas 72h) ──`);

s = s.replace(/          const \{ data: posts \} = await supabase\n            \.from\('comunidad_posts'\)[\s\S]*?            \.limit\(5\);/, `          const postsRes = await fetch('/api/comunidad/posts?filtro=all', { credentials: 'same-origin' });
          const postsPayload = await postsRes.json().catch(() => ({}));
          const posts = (postsPayload.posts || [])
            .filter((p: any) => partnerIds.includes(p.user_id))
            .filter((p: any) => new Date(p.created_at).getTime() >= hace3d.getTime())
            .slice(0, 5);`);

s = s.replace(/      \/\/ ── 6\) News recientes \(48h\) ──[\s\S]*?      \} catch \{\}/, `      // ── 6) News recientes (48h) ──
      try {
        const hace48h = new Date();
        hace48h.setHours(hace48h.getHours() - 48);
        const newsRes = await fetch('/api/news', { credentials: 'same-origin' });
        const newsPayload = await newsRes.json().catch(() => ({}));
        const news = (newsPayload.news || [])
          .filter((n: any) => new Date(n.created_at).getTime() >= hace48h.getTime())
          .slice(0, 3);

        news.forEach((n: any) => {
          const id = 'news-' + n.id;
          out.push({
            id, tipo: 'news',
            titulo: '📰 Nueva noticia',
            desc: n.titulo || 'Actualización de StudyAL',
            emoji: '📰', color: '#f97316',
            href: '/news', fecha: n.created_at,
            leida: leidas.has(id),
          });
        });
      } catch {}`);

fs.writeFileSync(p, s);
console.log("patched components/NotificacionesPanel.tsx");
