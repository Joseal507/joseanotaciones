export interface Env {
  DB: D1Database
  APP_ENV: string
}

type AnyBody = Record<string, any>

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (request.method === "OPTIONS") return cors()

      if (url.pathname === "/health") {
        return json({ ok: true, service: "studyal-api", env: env.APP_ENV })
      }

      if (url.pathname === "/users/by-email" && request.method === "GET") {
        const email = url.searchParams.get("email")?.toLowerCase().trim()
        if (!email) return json({ ok: false, error: "email_required" }, 400)
        const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first()
        return json({ ok: true, user: user || null })
      }

      if (url.pathname === "/users/upsert" && request.method === "POST") {
        const body = await readBody(request)
        const email = String(body.email || "").toLowerCase().trim()
        if (!email) return json({ ok: false, error: "email_required" }, 400)

        const id = body.id || crypto.randomUUID()

        await env.DB.prepare(`
          INSERT INTO users (id, email, name, image, provider, provider_account_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(email) DO UPDATE SET
            name = excluded.name,
            image = excluded.image,
            provider = excluded.provider,
            provider_account_id = excluded.provider_account_id,
            updated_at = datetime('now')
        `).bind(
          id,
          email,
          body.name || null,
          body.image || null,
          body.provider || "google",
          body.providerAccountId || null
        ).run()

        const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first()

        await env.DB.prepare(`
          INSERT INTO profiles (user_id, nombre, email, avatar_url, onboarding_completo, updated_at)
          VALUES (?, ?, ?, ?, 1, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET
            nombre = COALESCE(profiles.nombre, excluded.nombre),
            email = COALESCE(profiles.email, excluded.email),
            avatar_url = COALESCE(profiles.avatar_url, excluded.avatar_url),
            updated_at = datetime('now')
        `).bind(
          (user as any)?.id || id,
          body.name || null,
          email,
          body.image || null
        ).run()

        return json({ ok: true, user })
      }

      if (url.pathname === "/profiles/by-user" && request.method === "GET") {
        const userId = url.searchParams.get("userId")
        if (!userId) return json({ ok: false, error: "userId_required" }, 400)
        const profile = await env.DB.prepare("SELECT * FROM profiles WHERE user_id = ?").bind(userId).first()
        return json({ ok: true, profile: profile || null })
      }

      if (url.pathname === "/profiles/upsert" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.user_id) return json({ ok: false, error: "user_id_required" }, 400)

        await env.DB.prepare(`
          INSERT INTO profiles (
            user_id, nombre, email, avatar_url, descripcion, genero,
            tipo_estudiante, universidad, carrera, onboarding_completo, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET
            nombre = excluded.nombre,
            email = excluded.email,
            avatar_url = excluded.avatar_url,
            descripcion = excluded.descripcion,
            genero = excluded.genero,
            tipo_estudiante = excluded.tipo_estudiante,
            universidad = excluded.universidad,
            carrera = excluded.carrera,
            onboarding_completo = excluded.onboarding_completo,
            updated_at = datetime('now')
        `).bind(
          body.user_id,
          body.nombre || null,
          body.email || null,
          body.avatar_url || null,
          body.descripcion || null,
          body.genero || null,
          body.tipo_estudiante || null,
          body.universidad || null,
          body.carrera || null,
          body.onboarding_completo ? 1 : 0
        ).run()

        const profile = await env.DB.prepare("SELECT * FROM profiles WHERE user_id = ?").bind(body.user_id).first()
        return json({ ok: true, profile })
      }

      if (url.pathname === "/materias/by-user" && request.method === "GET") {
        const userId = url.searchParams.get("userId")
        if (!userId) return json({ ok: false, error: "userId_required" }, 400)
        const row = await env.DB.prepare("SELECT datos FROM materias WHERE user_id = ?").bind(userId).first<{ datos?: string }>()
        return json({ ok: true, materias: safeJson(row?.datos, []) })
      }

      if (url.pathname === "/materias/upsert" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.user_id) return json({ ok: false, error: "user_id_required" }, 400)

        await env.DB.prepare(`
          INSERT INTO materias (user_id, datos, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET
            datos = excluded.datos,
            updated_at = datetime('now')
        `).bind(body.user_id, JSON.stringify(body.materias || [])).run()

        return json({ ok: true })
      }

      if (url.pathname === "/settings/by-user" && request.method === "GET") {
        const userId = url.searchParams.get("userId")
        if (!userId) return json({ ok: false, error: "userId_required" }, 400)
        const row = await env.DB.prepare("SELECT datos FROM settings WHERE user_id = ?").bind(userId).first<{ datos?: string }>()
        return json({ ok: true, settings: safeJson(row?.datos, null) })
      }

      if (url.pathname === "/settings/upsert" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.user_id) return json({ ok: false, error: "user_id_required" }, 400)

        await env.DB.prepare(`
          INSERT INTO settings (user_id, datos, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET
            datos = excluded.datos,
            updated_at = datetime('now')
        `).bind(body.user_id, JSON.stringify(body.settings || {})).run()

        return json({ ok: true })
      }

      if (url.pathname === "/study-profiles/by-user" && request.method === "GET") {
        const userId = url.searchParams.get("userId")
        if (!userId) return json({ ok: false, error: "userId_required" }, 400)
        const row = await env.DB.prepare("SELECT datos FROM study_profiles WHERE user_id = ?").bind(userId).first<{ datos?: string }>()
        return json({ ok: true, profile: safeJson(row?.datos, null) })
      }

      if (url.pathname === "/study-profiles/upsert" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.user_id) return json({ ok: false, error: "user_id_required" }, 400)

        await env.DB.prepare(`
          INSERT INTO study_profiles (user_id, datos, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET
            datos = excluded.datos,
            updated_at = datetime('now')
        `).bind(body.user_id, JSON.stringify(body.profile || {})).run()

        return json({ ok: true })
      }

      if (url.pathname === "/agenda/by-user" && request.method === "GET") {
        const userId = url.searchParams.get("userId")
        if (!userId) return json({ ok: false, error: "userId_required" }, 400)
        const row = await env.DB.prepare("SELECT asignaciones, objetivos FROM agenda WHERE user_id = ?").bind(userId).first<any>()
        return json({
          ok: true,
          asignaciones: safeJson(row?.asignaciones, []),
          objetivos: safeJson(row?.objetivos, []),
        })
      }

      if (url.pathname === "/agenda/upsert" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.user_id) return json({ ok: false, error: "user_id_required" }, 400)

        await env.DB.prepare(`
          INSERT INTO agenda (user_id, asignaciones, objetivos, updated_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET
            asignaciones = excluded.asignaciones,
            objetivos = excluded.objetivos,
            updated_at = datetime('now')
        `).bind(
          body.user_id,
          JSON.stringify(body.asignaciones || []),
          JSON.stringify(body.objetivos || [])
        ).run()

        return json({ ok: true })
      }

      if (url.pathname === "/horario/by-user" && request.method === "GET") {
        const userId = url.searchParams.get("userId")
        if (!userId) return json({ ok: false, error: "userId_required" }, 400)
        const row = await env.DB.prepare("SELECT datos FROM horario WHERE user_id = ?").bind(userId).first<{ datos?: string }>()
        return json({ ok: true, horario: safeJson(row?.datos, null) })
      }

      if (url.pathname === "/horario/upsert" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.user_id) return json({ ok: false, error: "user_id_required" }, 400)

        await env.DB.prepare(`
          INSERT INTO horario (user_id, datos, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET
            datos = excluded.datos,
            updated_at = datetime('now')
        `).bind(body.user_id, JSON.stringify(body.horario || {})).run()

        return json({ ok: true })
      }

      if (url.pathname === "/leaderboard" && request.method === "GET") {
        const rows = await env.DB.prepare(`
          SELECT *
          FROM leaderboard
          WHERE visible_leaderboard != 0
          ORDER BY xp_total DESC, updated_at DESC
          LIMIT 100
        `).all()

        return json({ ok: true, data: rows.results || [] })
      }

      if (url.pathname === "/leaderboard/by-user" && request.method === "GET") {
        const userId = url.searchParams.get("userId")
        if (!userId) return json({ ok: false, error: "userId_required" }, 400)
        const row = await env.DB.prepare("SELECT * FROM leaderboard WHERE user_id = ?").bind(userId).first()
        return json({ ok: true, entry: row || null })
      }

      if (url.pathname === "/leaderboard/upsert" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.user_id) return json({ ok: false, error: "user_id_required" }, 400)

        await env.DB.prepare(`
          INSERT INTO leaderboard (
            user_id, nombre, email, avatar_url, xp_total, flashcards_estudiadas,
            racha_actual, mejor_racha, precision_global, visible_leaderboard,
            descripcion, genero, tipo_estudiante, universidad, carrera,
            quizzes_completados, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET
            nombre = COALESCE(excluded.nombre, leaderboard.nombre),
            email = COALESCE(excluded.email, leaderboard.email),
            avatar_url = COALESCE(excluded.avatar_url, leaderboard.avatar_url),
            xp_total = COALESCE(excluded.xp_total, leaderboard.xp_total),
            flashcards_estudiadas = COALESCE(excluded.flashcards_estudiadas, leaderboard.flashcards_estudiadas),
            racha_actual = COALESCE(excluded.racha_actual, leaderboard.racha_actual),
            mejor_racha = COALESCE(excluded.mejor_racha, leaderboard.mejor_racha),
            precision_global = COALESCE(excluded.precision_global, leaderboard.precision_global),
            visible_leaderboard = COALESCE(excluded.visible_leaderboard, leaderboard.visible_leaderboard),
            descripcion = COALESCE(excluded.descripcion, leaderboard.descripcion),
            genero = COALESCE(excluded.genero, leaderboard.genero),
            tipo_estudiante = COALESCE(excluded.tipo_estudiante, leaderboard.tipo_estudiante),
            universidad = COALESCE(excluded.universidad, leaderboard.universidad),
            carrera = COALESCE(excluded.carrera, leaderboard.carrera),
            quizzes_completados = COALESCE(excluded.quizzes_completados, leaderboard.quizzes_completados),
            updated_at = datetime('now')
        `).bind(
          body.user_id,
          body.nombre ?? null,
          body.email ?? null,
          body.avatar_url ?? null,
          body.xp_total ?? null,
          body.flashcards_estudiadas ?? null,
          body.racha_actual ?? null,
          body.mejor_racha ?? null,
          body.precision_global ?? null,
          body.visible_leaderboard === undefined ? null : (body.visible_leaderboard ? 1 : 0),
          body.descripcion ?? null,
          body.genero ?? null,
          body.tipo_estudiante ?? null,
          body.universidad ?? null,
          body.carrera ?? null,
          body.quizzes_completados ?? null
        ).run()

        const entry = await env.DB.prepare("SELECT * FROM leaderboard WHERE user_id = ?").bind(body.user_id).first()
        return json({ ok: true, entry })
      }

      return json({ ok: false, error: "not_found" }, 404)
    } catch (error) {
      return json({
        ok: false,
        error: "worker_exception",
        message: error instanceof Error ? error.message : String(error),
      }, 500)
    }
  },
}

async function readBody(request: Request): Promise<AnyBody> {
  return (await request.json().catch(() => ({}))) as AnyBody
}

function safeJson(value: unknown, fallback: any) {
  if (!value || typeof value !== "string") return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function cors() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "content-type": "application/json" },
  })
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
  }
}
