export interface Env {
  DB: D1Database
  APP_ENV: string
}

type UpsertUserBody = {
  id?: string
  email?: string
  name?: string
  image?: string
  provider?: string
  providerAccountId?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url)

      if (request.method === "OPTIONS") return cors()

      if (url.pathname === "/health") {
        return json({ ok: true, service: "studyal-api", env: env.APP_ENV })
      }

      if (url.pathname === "/users/upsert" && request.method === "POST") {
        const body = (await request.json().catch(() => null)) as UpsertUserBody | null

        if (!body || !body.email) {
          return json({ ok: false, error: "email_required" }, 400)
        }

        const id = body.id || crypto.randomUUID()
        const email = String(body.email).toLowerCase().trim()
        const name = body.name ? String(body.name) : null
        const image = body.image ? String(body.image) : null
        const provider = body.provider ? String(body.provider) : "google"
        const providerAccountId = body.providerAccountId ? String(body.providerAccountId) : null

        await env.DB.prepare(`
          INSERT INTO users (id, email, name, image, provider, provider_account_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(email) DO UPDATE SET
            name = excluded.name,
            image = excluded.image,
            provider = excluded.provider,
            provider_account_id = excluded.provider_account_id,
            updated_at = datetime('now')
        `).bind(id, email, name, image, provider, providerAccountId).run()

        const user = await env.DB.prepare(`
          SELECT id, email, name, image, provider, provider_account_id, created_at, updated_at
          FROM users
          WHERE email = ?
        `).bind(email).first()

        return json({ ok: true, user })
      }

      if (url.pathname === "/users/by-email" && request.method === "GET") {
        const email = url.searchParams.get("email")?.toLowerCase().trim()
        if (!email) return json({ ok: false, error: "email_required" }, 400)

        const user = await env.DB.prepare(`
          SELECT id, email, name, image, provider, provider_account_id, created_at, updated_at
          FROM users
          WHERE email = ?
        `).bind(email).first()

        return json({ ok: true, user: user || null })
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

function cors() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  })
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      "content-type": "application/json",
    },
  })
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
  }
}
