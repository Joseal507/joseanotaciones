import fs from "fs";

const p = "src/index.ts";
let s = fs.readFileSync(p, "utf8");

if (s.includes('url.pathname === "/comunidad-guardados/toggle"')) {
  console.log("worker community extra already patched");
  process.exit(0);
}

const marker = `      return json({ ok: false, error: "not_found" }, 404)`;

const insert = `
      if (url.pathname === "/comunidad-guardados/toggle" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.post_id || !body.user_id) return json({ error: "missing_fields" }, 400)

        const existing = await env.DB.prepare("SELECT id FROM comunidad_guardados WHERE post_id=? AND user_id=?")
          .bind(body.post_id, body.user_id).first<any>()

        if (existing) {
          await env.DB.prepare("DELETE FROM comunidad_guardados WHERE id=?").bind(existing.id).run()
          return json({ guardado: false })
        }

        await env.DB.prepare("INSERT INTO comunidad_guardados (id, post_id, user_id, created_at) VALUES (?, ?, ?, datetime('now'))")
          .bind(crypto.randomUUID(), body.post_id, body.user_id).run()

        return json({ guardado: true })
      }

      if (url.pathname === "/comunidad-ratings/upsert" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.post_id || !body.user_id || typeof body.rating !== "number") return json({ error: "missing_fields" }, 400)

        await env.DB.prepare(\`
          INSERT INTO comunidad_ratings (id, post_id, user_id, rating, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(post_id, user_id) DO UPDATE SET
            rating=excluded.rating,
            updated_at=datetime('now')
        \`).bind(crypto.randomUUID(), body.post_id, body.user_id, body.rating).run()

        return json({ ok: true })
      }

      if (url.pathname === "/comunidad-views/increment" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.post_id) return json({ error: "post_id_required" }, 400)

        const row = await env.DB.prepare("SELECT views, estudiados FROM comunidad_posts WHERE id=?")
          .bind(body.post_id).first<any>()

        const nextViews = Number(row?.views || 0) + 1
        const nextEstudiados = body.estudiado ? Number(row?.estudiados || 0) + 1 : Number(row?.estudiados || 0)

        await env.DB.prepare("UPDATE comunidad_posts SET views=?, estudiados=? WHERE id=?")
          .bind(nextViews, nextEstudiados, body.post_id).run()

        return json({ ok: true, views: nextViews, estudiados: nextEstudiados })
      }

`;

s = s.replace(marker, insert + "\n" + marker);
fs.writeFileSync(p, s);
console.log("patched worker community extra endpoints");
