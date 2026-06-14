import fs from "fs";

const p = "src/index.ts";
let s = fs.readFileSync(p, "utf8");

const marker = `      return json({ ok: false, error: "not_found" }, 404)`;

if (s.includes('url.pathname === "/comunidad-posts" && request.method === "GET"')) {
  console.log("social/news endpoints already patched");
  process.exit(0);
}

const insert = `
      // ===== COMUNIDAD FULL =====
      if (url.pathname === "/comunidad-posts" && request.method === "GET") {
        const tipo = url.searchParams.get("tipo")
        const filtro = url.searchParams.get("filtro")
        const userId = url.searchParams.get("userId")
        const ownerId = url.searchParams.get("ownerId")
        const viewerId = url.searchParams.get("viewerId") || userId
        const page = Math.max(1, Number(url.searchParams.get("page") || 1))
        const limit = 20
        const offset = (page - 1) * limit

        let sql = "SELECT * FROM comunidad_posts WHERE 1=1"
        const binds: any[] = []

        if (tipo && tipo !== "all") {
          sql += " AND tipo = ?"
          binds.push(tipo)
        }

        if (ownerId) {
          sql += " AND user_id = ?"
          binds.push(ownerId)
        } else if (filtro === "partners") {
          sql += " AND es_partner != 0"
        } else if (filtro === "mios" && userId) {
          sql += " AND user_id = ?"
          binds.push(userId)
        } else if (filtro === "guardados" && viewerId) {
          const saved = await env.DB.prepare("SELECT post_id FROM comunidad_guardados WHERE user_id = ?")
            .bind(viewerId).all()
          const ids = (saved.results || []).map((r: any) => r.post_id)
          if (ids.length === 0) return json({ posts: [], total: 0 })
          sql += " AND id IN (" + ids.map(() => "?").join(",") + ")"
          binds.push(...ids)
        }

        sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        binds.push(limit, offset)

        const rows = await env.DB.prepare(sql).bind(...binds).all()
        const posts = rows.results || []

        const enriched = await Promise.all(posts.map(async (post: any) => {
          const likes = await env.DB.prepare("SELECT user_id FROM comunidad_likes WHERE post_id = ?").bind(post.id).all()
          const ratings = await env.DB.prepare("SELECT rating, user_id FROM comunidad_ratings WHERE post_id = ?").bind(post.id).all()
          const comments = await env.DB.prepare("SELECT id FROM comunidad_comentarios WHERE post_id = ?").bind(post.id).all()
          const saved = viewerId
            ? await env.DB.prepare("SELECT id FROM comunidad_guardados WHERE post_id = ? AND user_id = ?").bind(post.id, viewerId).first()
            : null

          const ratingRows = ratings.results || []
          const avg = ratingRows.length
            ? ratingRows.reduce((a: number, r: any) => a + Number(r.rating || 0), 0) / ratingRows.length
            : 0

          return {
            ...post,
            contenido: safeJson(post.contenido, post.contenido),
            likes_count: (likes.results || []).length,
            user_liked: viewerId ? (likes.results || []).some((l: any) => l.user_id === viewerId) : false,
            avg_rating: Math.round(avg * 10) / 10,
            ratings_count: ratingRows.length,
            user_rating: viewerId ? (ratingRows.find((r: any) => r.user_id === viewerId)?.rating ?? null) : null,
            guardado: !!saved,
            comentarios_count: (comments.results || []).length,
          }
        }))

        return json({ posts: enriched, total: enriched.length })
      }

      if (url.pathname === "/comunidad-posts" && request.method === "POST") {
        const body = await readBody(request)
        const id = body.id || crypto.randomUUID()
        if (!body.user_id || !body.titulo || !body.tipo) return json({ error: "Faltan campos requeridos" }, 400)

        const contenidoSeguro = body.contenido ?? (
          body.tipo === "video"
            ? { tipo: "video", video_url: body.video_url || null }
            : body.tipo === "post"
              ? { texto: body.descripcion || "" }
              : {}
        )

        await env.DB.prepare(\`
          INSERT INTO comunidad_posts (
            id,user_id,tipo,titulo,descripcion,contenido,created_at,updated_at,views,comments_activos,
            es_partner,estudiados,materia_nombre,materia_color,materia_emoji,portada_url,user_avatar,user_nombre,video_url
          )
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 0, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
        \`).bind(
          id,
          body.user_id,
          body.tipo,
          body.titulo,
          body.descripcion || null,
          typeof contenidoSeguro === "string" ? contenidoSeguro : JSON.stringify(contenidoSeguro),
          body.comments_activos === false ? 0 : 1,
          body.es_partner ? 1 : 0,
          body.materia_nombre || null,
          body.materia_color || null,
          body.materia_emoji || null,
          body.portada_url || null,
          body.user_avatar || null,
          body.user_nombre || null,
          body.video_url || null
        ).run()

        const post = await env.DB.prepare("SELECT * FROM comunidad_posts WHERE id = ?").bind(id).first()
        return json({ post })
      }

      if (url.pathname === "/comunidad-posts" && request.method === "DELETE") {
        const postId = url.searchParams.get("postId")
        const userId = url.searchParams.get("userId")
        if (!postId || !userId) return json({ error: "missing_fields" }, 400)

        const post = await env.DB.prepare("SELECT user_id FROM comunidad_posts WHERE id = ?").bind(postId).first<any>()
        if (post?.user_id !== userId) return json({ error: "No autorizado" }, 403)

        await env.DB.prepare("DELETE FROM comunidad_posts WHERE id = ?").bind(postId).run()
        return json({ ok: true })
      }

      if (url.pathname === "/comunidad-posts" && request.method === "PATCH") {
        const body = await readBody(request)
        if (!body.postId || !body.userId) return json({ error: "Datos incompletos" }, 400)

        const post = await env.DB.prepare("SELECT user_id FROM comunidad_posts WHERE id = ?").bind(body.postId).first<any>()
        if (!post || post.user_id !== body.userId) return json({ error: "No autorizado" }, 403)

        await env.DB.prepare("UPDATE comunidad_posts SET titulo=?, descripcion=?, updated_at=datetime('now') WHERE id=?")
          .bind(body.titulo || "", body.descripcion || null, body.postId).run()

        return json({ ok: true })
      }

      if (url.pathname === "/comunidad-likes/toggle" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.post_id || !body.user_id) return json({ error: "missing_fields" }, 400)

        const existing = await env.DB.prepare("SELECT id FROM comunidad_likes WHERE post_id=? AND user_id=?")
          .bind(body.post_id, body.user_id).first<any>()

        if (existing) {
          await env.DB.prepare("DELETE FROM comunidad_likes WHERE id=?").bind(existing.id).run()
          return json({ liked: false })
        }

        await env.DB.prepare("INSERT INTO comunidad_likes (id, post_id, user_id, created_at) VALUES (?, ?, ?, datetime('now'))")
          .bind(crypto.randomUUID(), body.post_id, body.user_id).run()
        return json({ liked: true })
      }

      if (url.pathname === "/comunidad-comentarios" && request.method === "GET") {
        const postId = url.searchParams.get("post_id")
        if (!postId) return json({ comentarios: [] })
        const rows = await env.DB.prepare("SELECT * FROM comunidad_comentarios WHERE post_id=? ORDER BY created_at ASC")
          .bind(postId).all()
        return json({ comentarios: rows.results || [] })
      }

      if (url.pathname === "/comunidad-comentarios" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.post_id || !body.user_id || !body.contenido) return json({ error: "missing_fields" }, 400)

        const post = await env.DB.prepare("SELECT comments_activos FROM comunidad_posts WHERE id=?")
          .bind(body.post_id).first<any>()
        if (!post?.comments_activos) return json({ error: "Comentarios desactivados" }, 403)

        const id = crypto.randomUUID()
        await env.DB.prepare(\`
          INSERT INTO comunidad_comentarios (id,post_id,user_id,user_nombre,user_avatar,parent_id,contenido,created_at,updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        \`).bind(
          id,
          body.post_id,
          body.user_id,
          body.user_nombre || null,
          body.user_avatar || null,
          body.parent_id || null,
          body.contenido
        ).run()

        const comentario = await env.DB.prepare("SELECT * FROM comunidad_comentarios WHERE id=?").bind(id).first()
        return json({ comentario })
      }

      if (url.pathname === "/comunidad-comentarios" && request.method === "PATCH") {
        const body = await readBody(request)
        const com = await env.DB.prepare("SELECT user_id FROM comunidad_comentarios WHERE id=?").bind(body.id).first<any>()
        if (com?.user_id !== body.user_id) return json({ error: "No autorizado" }, 403)

        await env.DB.prepare("UPDATE comunidad_comentarios SET contenido=?, editado=1, updated_at=datetime('now') WHERE id=?")
          .bind(body.contenido || "", body.id).run()
        const comentario = await env.DB.prepare("SELECT * FROM comunidad_comentarios WHERE id=?").bind(body.id).first()
        return json({ comentario })
      }

      if (url.pathname === "/comunidad-comentarios" && request.method === "DELETE") {
        const id = url.searchParams.get("id")
        const userId = url.searchParams.get("userId")
        if (!id || !userId) return json({ error: "missing_fields" }, 400)

        const com = await env.DB.prepare("SELECT user_id, post_id FROM comunidad_comentarios WHERE id=?").bind(id).first<any>()
        const post = await env.DB.prepare("SELECT user_id FROM comunidad_posts WHERE id=?").bind(com?.post_id).first<any>()

        if (com?.user_id !== userId && post?.user_id !== userId) return json({ error: "No autorizado" }, 403)

        await env.DB.prepare("DELETE FROM comunidad_comentarios WHERE id=?").bind(id).run()
        return json({ ok: true })
      }

      if (url.pathname === "/news" && request.method === "GET") {
        const rows = await env.DB.prepare("SELECT * FROM news ORDER BY destacada DESC, created_at DESC").all()
        return json({ success: true, news: rows.results || [] })
      }

      if (url.pathname === "/news" && request.method === "POST") {
        const body = await readBody(request)
        const id = body.id || crypto.randomUUID()
        if (!body.titulo || !body.descripcion || !body.media_url) return json({ success: false, error: "Faltan campos requeridos" }, 400)

        await env.DB.prepare(\`
          INSERT INTO news (id,titulo,descripcion,contenido,tipo,media_url,categoria,destacada,autor,autor_email,created_at,updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        \`).bind(
          id,
          body.titulo,
          body.descripcion,
          body.contenido || "",
          body.tipo || "foto",
          body.media_url,
          body.categoria || "general",
          body.destacada ? 1 : 0,
          body.autor || "Joseal",
          body.autor_email || null
        ).run()

        const news = await env.DB.prepare("SELECT * FROM news WHERE id=?").bind(id).first()
        return json({ success: true, news })
      }

      if (url.pathname === "/news" && request.method === "DELETE") {
        const id = url.searchParams.get("id")
        if (!id) return json({ success: false, error: "id requerido" }, 400)
        await env.DB.prepare("DELETE FROM news WHERE id=?").bind(id).run()
        return json({ success: true })
      }

`;

s = s.replace(marker, insert + "\n" + marker);
fs.writeFileSync(p, s);
console.log("patched worker social/news endpoints");
