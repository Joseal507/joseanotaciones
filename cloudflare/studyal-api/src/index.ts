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
        const user = await env.DB.prepare(`
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
        `).bind(email).first()
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
          VALUES (?, ?, ?, ?, 0, datetime('now'))
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

      if (url.pathname === "/onboarding/complete" && request.method === "POST") {
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

        await env.DB.prepare(`
          UPDATE users SET
            name = ?,
            onboarding_version = ?,
            onboarding_completed = 1,
            terms_accepted_at = datetime('now'),
            privacy_accepted_at = datetime('now'),
            updated_at = datetime('now')
          WHERE id = ?
        `).bind(body.nombre, Number(body.onboarding_version || 2), body.user_id).run()

        await env.DB.prepare(`
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
        `).bind(
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

        await env.DB.prepare(`
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
        `).bind(
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
        const row = await env.DB.prepare("SELECT datos, revision FROM materias WHERE user_id = ?").bind(userId).first<{ datos?: string; revision?: number }>()
        return json({ ok: true, materias: safeJson(row?.datos, []), revision: Number(row?.revision || 0) })
      }

      if (url.pathname === "/materias/upsert" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.user_id || !Number.isInteger(body.expected_revision) || body.expected_revision < 0) {
          return json({ ok: false, error: "user_id_expected_revision_required" }, 400)
        }

        const write = await env.DB.prepare(`
          INSERT INTO materias (user_id, datos, updated_at, revision)
          VALUES (?, ?, datetime('now'), 1)
          ON CONFLICT(user_id) DO UPDATE SET
            datos = excluded.datos,
            updated_at = datetime('now'),
            revision = materias.revision + 1
          WHERE materias.revision = ?
        `).bind(body.user_id, JSON.stringify(body.materias || []), body.expected_revision).run()

        if (Number(write.meta?.changes || 0) !== 1) {
          const current = await env.DB.prepare("SELECT datos, revision FROM materias WHERE user_id = ?")
            .bind(body.user_id).first<{ datos?: string; revision?: number }>()
          return json({ ok: false, error: "VERSION_CONFLICT", materias: safeJson(current?.datos, []), revision: Number(current?.revision || 0) }, 409)
        }

        const current = await env.DB.prepare("SELECT revision FROM materias WHERE user_id = ?")
          .bind(body.user_id).first<{ revision?: number }>()
        return json({ ok: true, revision: Number(current?.revision || 1) })
      }


      if (url.pathname === "/study-sessions/by-user" && request.method === "GET") {
        const userId = url.searchParams.get("userId")
        const temaId = url.searchParams.get("temaId")
        if (!userId) return json({ ok: false, error: "userId_required" }, 400)

        let query = `
          SELECT *
          FROM study_sessions
          WHERE user_id = ?
        `
        const binds: any[] = [userId]

        if (temaId) {
          query += " AND tema_id = ?"
          binds.push(temaId)
        }

        query += " ORDER BY last_opened_at DESC LIMIT 100"

        const rows = await env.DB.prepare(query).bind(...binds).all()

        const sessions = (rows.results || []).map(mapStudySessionRow)

        return json({ ok: true, sessions })
      }

      if (url.pathname === "/study-sessions/upsert" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.user_id) return json({ ok: false, error: "user_id_required" }, 400)
        if (!body.tema_id) return json({ ok: false, error: "tema_id_required" }, 400)
        if (!body.enfoque) return json({ ok: false, error: "enfoque_required" }, 400)

        const id = body.id || crypto.randomUUID()
        const now = Number(body.last_opened_at || Date.now())
        const createdAt = Number(body.created_at || now)
        const mode = body.process_mode || body.study_mode || 'free'

        // Asegurar columnas existen (ALTER TABLE seguro)
        const newCols = [
          ["process_mode", "TEXT DEFAULT 'free'"],
          ["study_mode", "TEXT DEFAULT 'free'"],
          ["adaptive_program", "TEXT"],
          ["process_style", "TEXT"],
          ["target_score", "INTEGER"],
          ["exam_date", "TEXT"],
          ["exam_date_custom", "TEXT"],
          ["material_blueprint", "TEXT"],
          ["mastery_snapshot", "TEXT"],
          ["adaptive_setup", "TEXT"],
          ["setup_hash", "TEXT"],
          // AUDITORÍA (StudyAL_Visual_System_Stress_Test, Layer B GAP
          // persistence): route.ts ya construye y envía estos 3 campos en
          // cada upsert dando por hecho que sobreviven un restore
          // server-authoritative — antes de esta ronda no existía ninguna
          // columna para ellos, así que se descartaban en silencio.
          ["current_session_number", "INTEGER"],
          ["status", "TEXT"],
          ["adaptive_state", "TEXT"],
          // AUDITORÍA (misma misión, hallazgo posterior al de arriba: al
          // construir persistence-cross-device-round-trip-contracts.ts con
          // el mapeo REAL del Worker en vez de un fake permisivo, current_step
          // y el resto de este bloque resultaron ser el MISMO patrón de
          // pérdida silenciosa — route.ts los construye y envía en cada
          // upsert, pero ninguno tenía columna. "sesión actual" sobrevivía
          // pero "progreso dentro de la sesión" y "evidencia de recovery/
          // preparación" NO, exactamente lo que un restore cross-device real
          // necesita para no regenerar ni perder trabajo.
          ["primary_material_id", "TEXT"],
          ["mastery_material_key", "TEXT"],
          ["current_step", "INTEGER"],
          ["completed_session_numbers", "TEXT"],
          ["replay_session_number", "INTEGER"],
          ["replay_attempt", "INTEGER"],
          ["session_content", "TEXT"],
          ["session_preparation", "TEXT"],
          ["is_program_complete", "INTEGER"],
          ["unresolved_micro_ids", "TEXT"],
          ["active_study_ms", "INTEGER"],
          ["break_hours_acknowledged", "INTEGER"],
          ["material_names", "TEXT"],
          ["recovery_queues", "TEXT"],
        ]
        for (const [col, def] of newCols) {
          try {
            await env.DB.prepare(`ALTER TABLE study_sessions ADD COLUMN ${col} ${def}`).run()
          } catch (_) {}
        }

        await env.DB.prepare(`
          INSERT INTO study_sessions (
            id, user_id, tema_id, enfoque, process_mode, study_mode,
            material_ids, selected_pages,
            flashcards, notes, material_text, current_phase,
            adaptive_program, process_style, target_score, exam_date, exam_date_custom,
            material_blueprint, mastery_snapshot, adaptive_setup, setup_hash,
            current_session_number, status, adaptive_state,
            primary_material_id, mastery_material_key, current_step, completed_session_numbers,
            replay_session_number, replay_attempt, session_content, session_preparation,
            is_program_complete, unresolved_micro_ids, active_study_ms, break_hours_acknowledged,
            material_names, recovery_queues,
            created_at, last_opened_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            tema_id = excluded.tema_id,
            enfoque = excluded.enfoque,
            process_mode = excluded.process_mode,
            study_mode = excluded.study_mode,
            material_ids = excluded.material_ids,
            selected_pages = excluded.selected_pages,
            flashcards = COALESCE(excluded.flashcards, study_sessions.flashcards),
            notes = COALESCE(excluded.notes, study_sessions.notes),
            material_text = COALESCE(excluded.material_text, study_sessions.material_text),
            current_phase = COALESCE(excluded.current_phase, study_sessions.current_phase),
            adaptive_program = COALESCE(excluded.adaptive_program, study_sessions.adaptive_program),
            process_style = COALESCE(excluded.process_style, study_sessions.process_style),
            target_score = COALESCE(excluded.target_score, study_sessions.target_score),
            exam_date = COALESCE(excluded.exam_date, study_sessions.exam_date),
            exam_date_custom = COALESCE(excluded.exam_date_custom, study_sessions.exam_date_custom),
            material_blueprint = COALESCE(excluded.material_blueprint, study_sessions.material_blueprint),
            mastery_snapshot = COALESCE(excluded.mastery_snapshot, study_sessions.mastery_snapshot),
            adaptive_setup = COALESCE(excluded.adaptive_setup, study_sessions.adaptive_setup),
            setup_hash = COALESCE(excluded.setup_hash, study_sessions.setup_hash),
            current_session_number = COALESCE(excluded.current_session_number, study_sessions.current_session_number),
            status = COALESCE(excluded.status, study_sessions.status),
            adaptive_state = COALESCE(excluded.adaptive_state, study_sessions.adaptive_state),
            primary_material_id = COALESCE(excluded.primary_material_id, study_sessions.primary_material_id),
            mastery_material_key = COALESCE(excluded.mastery_material_key, study_sessions.mastery_material_key),
            current_step = COALESCE(excluded.current_step, study_sessions.current_step),
            completed_session_numbers = COALESCE(excluded.completed_session_numbers, study_sessions.completed_session_numbers),
            replay_session_number = COALESCE(excluded.replay_session_number, study_sessions.replay_session_number),
            replay_attempt = COALESCE(excluded.replay_attempt, study_sessions.replay_attempt),
            session_content = COALESCE(excluded.session_content, study_sessions.session_content),
            session_preparation = COALESCE(excluded.session_preparation, study_sessions.session_preparation),
            is_program_complete = COALESCE(excluded.is_program_complete, study_sessions.is_program_complete),
            unresolved_micro_ids = COALESCE(excluded.unresolved_micro_ids, study_sessions.unresolved_micro_ids),
            active_study_ms = COALESCE(excluded.active_study_ms, study_sessions.active_study_ms),
            break_hours_acknowledged = COALESCE(excluded.break_hours_acknowledged, study_sessions.break_hours_acknowledged),
            material_names = COALESCE(excluded.material_names, study_sessions.material_names),
            recovery_queues = COALESCE(excluded.recovery_queues, study_sessions.recovery_queues),
            last_opened_at = excluded.last_opened_at,
            updated_at = datetime('now')
        `).bind(
          id,
          body.user_id,
          body.tema_id,
          body.enfoque,
          mode,
          mode,
          JSON.stringify(body.material_ids || []),
          body.selected_pages ? JSON.stringify(body.selected_pages) : null,
          body.flashcards ? JSON.stringify(body.flashcards) : null,
          body.notes ? JSON.stringify(body.notes) : null,
          body.material_text || null,
          body.current_phase || null,
          body.adaptive_program ? JSON.stringify(body.adaptive_program) : null,
          body.process_style || null,
          body.target_score ?? null,
          body.exam_date || null,
          body.exam_date_custom || null,
          body.material_blueprint ? JSON.stringify(body.material_blueprint) : null,
          body.mastery_snapshot ? JSON.stringify(body.mastery_snapshot) : null,
          body.adaptive_setup ? JSON.stringify(body.adaptive_setup) : null,
          body.setup_hash || null,
          body.current_session_number ?? null,
          body.status || null,
          body.adaptive_state || null,
          body.primary_material_id || null,
          body.mastery_material_key || null,
          body.current_step ?? null,
          body.completed_session_numbers ? JSON.stringify(body.completed_session_numbers) : null,
          body.replay_session_number ?? null,
          body.replay_attempt ?? null,
          body.session_content ? JSON.stringify(body.session_content) : null,
          body.session_preparation ? JSON.stringify(body.session_preparation) : null,
          body.is_program_complete === true ? 1 : (body.is_program_complete === false ? 0 : null),
          body.unresolved_micro_ids ? JSON.stringify(body.unresolved_micro_ids) : null,
          body.active_study_ms ?? null,
          body.break_hours_acknowledged ?? null,
          body.material_names ? JSON.stringify(body.material_names) : null,
          body.recovery_queues ? JSON.stringify(body.recovery_queues) : null,
          createdAt,
          now
        ).run()

        return json({ ok: true, session: { id, processMode: mode, studyMode: mode } })
      }

      if (url.pathname === "/study-sessions/delete" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.user_id) return json({ ok: false, error: "user_id_required" }, 400)
        if (!body.id) return json({ ok: false, error: "id_required" }, 400)

        await env.DB.prepare("DELETE FROM study_sessions WHERE user_id = ? AND id = ?")
          .bind(body.user_id, body.id)
          .run()

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
          0,
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

      if (url.pathname === "/xp/events" && request.method === "POST") {
        const body = await readBody(request)
        const userId = String(body.user_id || "")
        const eventId = String(body.event_id || "")
        const source = String(body.source || "")
        const action = String(body.action || "")
        const amount = Number(body.amount)
        if (!userId || !eventId || !source || !action || !Number.isInteger(amount) || amount === 0) {
          return json({ ok: false, error: "invalid_xp_event" }, 400)
        }

        const results = await env.DB.batch([
          env.DB.prepare(`
            INSERT OR IGNORE INTO xp_events (
              user_id, event_id, source, action, entity_type, entity_id,
              amount, metadata, occurred_at, applied
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 0)
          `).bind(
            userId, eventId, source, action, body.entity_type || null,
            body.entity_id || null, amount, JSON.stringify(body.metadata || {})
          ),
          env.DB.prepare(`
            INSERT OR IGNORE INTO leaderboard (
              user_id, nombre, email, avatar_url, xp_total, updated_at
            ) VALUES (?, ?, ?, ?, 0, datetime('now'))
          `).bind(userId, body.nombre || null, body.email || null, body.avatar_url || null),
          env.DB.prepare(`
            UPDATE leaderboard
            SET xp_total = MAX(0, COALESCE(xp_total, 0) + ?),
                xp_breakdown = json_set(
                  COALESCE(xp_breakdown, '{}'),
                  '$.' || ?,
                  COALESCE(json_extract(COALESCE(xp_breakdown, '{}'), '$.' || ?), 0) + ?
                ),
                updated_at = datetime('now')
            WHERE user_id = ?
              AND EXISTS (
                SELECT 1 FROM xp_events
                WHERE user_id = ? AND event_id = ? AND applied = 0
              )
          `).bind(amount, source, source, amount, userId, userId, eventId),
          env.DB.prepare(`
            UPDATE xp_events SET applied = 1
            WHERE user_id = ? AND event_id = ? AND applied = 0
          `).bind(userId, eventId),
        ])

        const entry = await env.DB.prepare("SELECT xp_total FROM leaderboard WHERE user_id = ?").bind(userId).first()
        return json({
          ok: true,
          applied: Number(results[2]?.meta?.changes || 0) === 1,
          event_id: eventId,
          total_xp: Number((entry as any)?.xp_total || 0),
        })
      }


      // ===== MATERIALS =====
      if (url.pathname === "/materials/by-user" && request.method === "GET") {
        const userId = url.searchParams.get("userId")
        const temaId = url.searchParams.get("temaId")
        const id = url.searchParams.get("id")
        if (!userId) return json({ ok: false, error: "userId_required" }, 400)

        if (id) {
          const material = await env.DB.prepare("SELECT * FROM materials WHERE id = ? AND user_id = ? AND upload_status != 'deleted'")
            .bind(id, userId).first()
          return json({ ok: true, material: material || null })
        }

        let rows
        if (temaId) {
          rows = await env.DB.prepare(`
            SELECT * FROM materials
            WHERE user_id = ? AND tema_id = ? AND upload_status != 'deleted'
            ORDER BY created_at DESC
          `).bind(userId, temaId).all()
        } else {
          rows = await env.DB.prepare(`
            SELECT * FROM materials
            WHERE user_id = ? AND upload_status != 'deleted'
            ORDER BY created_at DESC
          `).bind(userId).all()
        }

        return json({ ok: true, materials: rows.results || [] })
      }

      if (url.pathname === "/materials/upsert" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.id || !body.user_id) return json({ ok: false, error: "id_user_id_required" }, 400)

        await env.DB.prepare(`
          INSERT INTO materials (
            id,user_id,tema_id,materia_id,nombre,extension,mime_type,size_bytes,storage_key,kind,
            upload_status,text_status,extracted_chars,pages_count,content_hash,last_error,created_at,updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            tema_id=excluded.tema_id,
            materia_id=excluded.materia_id,
            nombre=excluded.nombre,
            extension=excluded.extension,
            mime_type=excluded.mime_type,
            size_bytes=excluded.size_bytes,
            storage_key=excluded.storage_key,
            kind=excluded.kind,
            upload_status=excluded.upload_status,
            text_status=excluded.text_status,
            extracted_chars=excluded.extracted_chars,
            pages_count=excluded.pages_count,
            content_hash=excluded.content_hash,
            last_error=excluded.last_error,
            updated_at=datetime('now')
          WHERE materials.user_id = excluded.user_id
        `).bind(
          body.id,
          body.user_id,
          body.tema_id || "",
          body.materia_id || "",
          body.nombre || "",
          body.extension || "",
          body.mime_type || "",
          Number(body.size_bytes || 0),
          body.storage_key || "",
          body.kind || "file",
          body.upload_status || "uploaded",
          body.text_status || "pending",
          body.extracted_chars ?? null,
          body.pages_count ?? null,
          body.content_hash ?? null,
          body.last_error ?? null,
          body.created_at ?? null
        ).run()

        const material = await env.DB.prepare("SELECT * FROM materials WHERE id = ? AND user_id = ?").bind(body.id, body.user_id).first()
        if (!material) return json({ ok: false, error: "material_owner_conflict" }, 409)
        return json({ ok: true, material })
      }

      if (url.pathname === "/materials/update" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.id || !body.user_id) return json({ ok: false, error: "id_user_id_required" }, 400)

        await env.DB.prepare(`
          UPDATE materials SET
            upload_status = COALESCE(?, upload_status),
            text_status = COALESCE(?, text_status),
            extracted_chars = COALESCE(?, extracted_chars),
            pages_count = COALESCE(?, pages_count),
            last_error = COALESCE(?, last_error),
            updated_at = datetime('now')
          WHERE id = ? AND user_id = ?
        `).bind(
          body.upload_status ?? null,
          body.text_status ?? null,
          body.extracted_chars ?? null,
          body.pages_count ?? null,
          body.last_error ?? null,
          body.id,
          body.user_id
        ).run()

        return json({ ok: true })
      }

      if (url.pathname === "/materials/delete" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.id || !body.user_id) return json({ ok: false, error: "id_user_id_required" }, 400)
        await env.DB.prepare("UPDATE materials SET upload_status='deleted', updated_at=datetime('now') WHERE id=? AND user_id=?")
          .bind(body.id, body.user_id).run()
        return json({ ok: true })
      }

      if (url.pathname === "/material-texts/by-material" && request.method === "GET") {
        const materialId = url.searchParams.get("materialId")
        if (!materialId) return json({ ok: false, error: "materialId_required" }, 400)
        const row = await env.DB.prepare("SELECT * FROM material_texts WHERE material_id = ?").bind(materialId).first()
        return json({ ok: true, text: row || null })
      }

      if (url.pathname === "/material-texts/upsert" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.material_id) return json({ ok: false, error: "material_id_required" }, 400)
        await env.DB.prepare(`
          INSERT INTO material_texts (material_id, text, chunks, created_at, updated_at)
          VALUES (?, ?, ?, COALESCE(?, datetime('now')), datetime('now'))
          ON CONFLICT(material_id) DO UPDATE SET
            text=excluded.text,
            chunks=excluded.chunks,
            updated_at=datetime('now')
        `).bind(
          body.material_id,
          body.text ?? body.raw_text ?? null,
          typeof body.chunks === "string" ? body.chunks : JSON.stringify(body.chunks ?? null),
          body.created_at ?? null
        ).run()
        return json({ ok: true })
      }

      // ===== MATERIAL RESULTS / JOBS =====
      if (url.pathname === "/material-results/by-material" && request.method === "GET") {
        const materialId = url.searchParams.get("materialId")
        const enfoque = url.searchParams.get("enfoque")
        const resultType = url.searchParams.get("resultType")
        if (!materialId) return json({ ok: false, error: "materialId_required" }, 400)
        const row = await env.DB.prepare(`
          SELECT * FROM material_results
          WHERE material_id = ?
            AND (? IS NULL OR enfoque = ?)
            AND (? IS NULL OR result_type = ?)
          ORDER BY created_at DESC
          LIMIT 1
        `).bind(materialId, enfoque, enfoque, resultType, resultType).first()
        return json({ ok: true, result: row || null })
      }

      if (url.pathname === "/material-results/upsert" && request.method === "POST") {
        const body = await readBody(request)
        const id = body.id || ("res_" + crypto.randomUUID())
        if (!body.material_id || !body.enfoque || !body.result_type) {
          return json({ ok: false, error: "missing_fields" }, 400)
        }
        await env.DB.prepare(`
          INSERT INTO material_results (id, material_id, enfoque, result_type, payload, content_hash, created_at)
          VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
          ON CONFLICT(id) DO UPDATE SET
            payload=excluded.payload,
            content_hash=excluded.content_hash
        `).bind(
          id,
          body.material_id,
          body.enfoque,
          body.result_type,
          typeof body.payload === "string" ? body.payload : JSON.stringify(body.payload ?? {}),
          body.content_hash ?? null,
          body.created_at ?? null
        ).run()
        const result = await env.DB.prepare("SELECT * FROM material_results WHERE id = ?").bind(id).first()
        return json({ ok: true, result })
      }

      if (url.pathname === "/material-jobs/upsert" && request.method === "POST") {
        const body = await readBody(request)
        const id = body.id || ("job_" + crypto.randomUUID())
        if (!body.material_id || !body.type) return json({ ok: false, error: "missing_fields" }, 400)
        await env.DB.prepare(`
          INSERT INTO material_jobs (id, material_id, type, status, error, attempts, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            status=excluded.status,
            error=excluded.error,
            attempts=excluded.attempts,
            updated_at=datetime('now')
        `).bind(
          id,
          body.material_id,
          body.type,
          body.status || "pending",
          body.error ?? null,
          Number(body.attempts || 0),
          body.created_at ?? null
        ).run()
        const job = await env.DB.prepare("SELECT * FROM material_jobs WHERE id = ?").bind(id).first()
        return json({ ok: true, job })
      }

      // ===== FLASHCARD DECKS =====
      if (url.pathname === "/flashcard-decks/upsert" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.id || !body.user_id) return json({ ok: false, error: "id_user_id_required" }, 400)
        await env.DB.prepare(`
          INSERT INTO flashcard_decks (
            id,user_id,nombre,fecha_creacion,flashcards,materia_nombre,materia_color,tema_color,created_at,updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            nombre=excluded.nombre,
            flashcards=excluded.flashcards,
            materia_nombre=excluded.materia_nombre,
            materia_color=excluded.materia_color,
            tema_color=excluded.tema_color,
            updated_at=datetime('now')
        `).bind(
          body.id,
          body.user_id,
          body.nombre || "",
          body.fecha_creacion || null,
          typeof body.flashcards === "string" ? body.flashcards : JSON.stringify(body.flashcards || []),
          body.materia_nombre || null,
          body.materia_color || null,
          body.tema_color || null,
          body.created_at || null
        ).run()
        return json({ ok: true })
      }

      // ===== COMUNIDAD =====
      if (url.pathname === "/comunidad-posts/upsert" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.id) return json({ ok: false, error: "id_required" }, 400)
        await env.DB.prepare(`
          INSERT INTO comunidad_posts (
            id,user_id,tipo,titulo,descripcion,contenido,created_at,updated_at,views,comments_activos,
            es_partner,estudiados,materia_nombre,materia_color,materia_emoji,portada_url,user_avatar,user_nombre,video_url
          )
          VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            titulo=excluded.titulo,
            descripcion=excluded.descripcion,
            contenido=excluded.contenido,
            views=excluded.views,
            comments_activos=excluded.comments_activos,
            es_partner=excluded.es_partner,
            estudiados=excluded.estudiados,
            updated_at=datetime('now')
        `).bind(
          body.id,
          body.user_id || null,
          body.tipo || "post",
          body.titulo || "",
          body.descripcion || null,
          body.contenido || "",
          body.created_at || null,
          Number(body.views || 0),
          body.comments_activos === false ? 0 : 1,
          body.es_partner ? 1 : 0,
          Number(body.estudiados || 0),
          body.materia_nombre || null,
          body.materia_color || null,
          body.materia_emoji || null,
          body.portada_url || null,
          body.user_avatar || null,
          body.user_nombre || null,
          body.video_url || null
        ).run()
        return json({ ok: true })
      }

      // ===== PARTNERS =====
      if (url.pathname === "/partners/by-user" && request.method === "GET") {
        const userId = url.searchParams.get("userId")
        if (!userId) return json({ ok: false, error: "userId_required" }, 400)
        const rows = await env.DB.prepare(`
          SELECT * FROM partners
          WHERE sender_id = ? OR receiver_id = ?
          ORDER BY created_at DESC
        `).bind(userId, userId).all()
        return json({ ok: true, partners: rows.results || [] })
      }

      if (url.pathname === "/partners/upsert" && request.method === "POST") {
        const body = await readBody(request)
        const id = body.id || crypto.randomUUID()
        if (!body.sender_id || !body.receiver_id) return json({ ok: false, error: "sender_receiver_required" }, 400)
        await env.DB.prepare(`
          INSERT INTO partners (id,sender_id,receiver_id,status,created_at,updated_at)
          VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            sender_id=excluded.sender_id,
            receiver_id=excluded.receiver_id,
            status=excluded.status,
            updated_at=datetime('now')
        `).bind(id, body.sender_id, body.receiver_id, body.status || "pending", body.created_at || null).run()
        const partner = await env.DB.prepare("SELECT * FROM partners WHERE id = ?").bind(id).first()
        return json({ ok: true, partner })
      }

      if (url.pathname === "/partners/update" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.id) return json({ ok: false, error: "id_required" }, 400)
        await env.DB.prepare("UPDATE partners SET status=?, updated_at=datetime('now') WHERE id=?")
          .bind(body.status || "pending", body.id).run()
        const partner = await env.DB.prepare("SELECT * FROM partners WHERE id = ?").bind(body.id).first()
        return json({ ok: true, partner })
      }

      if (url.pathname === "/partners/delete-between" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.user_id || !body.other_id) return json({ ok: false, error: "missing_fields" }, 400)
        await env.DB.prepare(`
          DELETE FROM partners
          WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)
        `).bind(body.user_id, body.other_id, body.other_id, body.user_id).run()
        return json({ ok: true })
      }

      if (url.pathname === "/partner-blocks/upsert" && request.method === "POST") {
        const body = await readBody(request)
        const id = body.id || crypto.randomUUID()
        if (!body.blocker_id || !body.blocked_id) return json({ ok: false, error: "missing_fields" }, 400)
        await env.DB.prepare(`
          INSERT OR IGNORE INTO partner_blocks (id, blocker_id, blocked_id, created_at)
          VALUES (?, ?, ?, datetime('now'))
        `).bind(id, body.blocker_id, body.blocked_id).run()
        return json({ ok: true })
      }

      if (url.pathname === "/partner-blocks/check" && request.method === "GET") {
        const blockerId = url.searchParams.get("blockerId")
        const blockedId = url.searchParams.get("blockedId")
        if (!blockerId || !blockedId) return json({ ok: false, error: "missing_fields" }, 400)
        const row = await env.DB.prepare("SELECT id FROM partner_blocks WHERE blocker_id=? AND blocked_id=?")
          .bind(blockerId, blockedId).first()
        return json({ ok: true, blocked: !!row })
      }

      if (url.pathname === "/partner-reports/upsert" && request.method === "POST") {
        const body = await readBody(request)
        const id = body.id || crypto.randomUUID()
        if (!body.reporter_id || !body.reported_id || !body.motivo) return json({ ok: false, error: "missing_fields" }, 400)
        await env.DB.prepare(`
          INSERT INTO partner_reports (id, reporter_id, reported_id, motivo, detalles, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `).bind(id, body.reporter_id, body.reported_id, body.motivo, body.detalles || null).run()
        return json({ ok: true })
      }

      if (url.pathname === "/partner-chats/upsert" && request.method === "POST") {
        const body = await readBody(request)
        const id = body.id || crypto.randomUUID()
        if (!body.user1_id || !body.user2_id) return json({ ok: false, error: "missing_fields" }, 400)
        await env.DB.prepare(`
          INSERT INTO partner_chats (
            id,user1_id,user2_id,last_message,last_message_at,created_at,user1_deleted_at,user2_deleted_at,wallpaper_url,wallpaper_set_by
          )
          VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            last_message=excluded.last_message,
            last_message_at=excluded.last_message_at,
            user1_deleted_at=excluded.user1_deleted_at,
            user2_deleted_at=excluded.user2_deleted_at,
            wallpaper_url=excluded.wallpaper_url,
            wallpaper_set_by=excluded.wallpaper_set_by
        `).bind(
          id,
          body.user1_id,
          body.user2_id,
          body.last_message || null,
          body.last_message_at || null,
          body.created_at || null,
          body.user1_deleted_at || null,
          body.user2_deleted_at || null,
          body.wallpaper_url || null,
          body.wallpaper_set_by || null
        ).run()
        return json({ ok: true })
      }

      if (url.pathname === "/partner-messages/upsert" && request.method === "POST") {
        const body = await readBody(request)
        const id = body.id || crypto.randomUUID()
        if (!body.chat_id || !body.sender_id) return json({ ok: false, error: "missing_fields" }, 400)
        await env.DB.prepare(`
          INSERT INTO partner_messages (id,chat_id,sender_id,content,type,metadata,created_at,duration,expires_at)
          VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            content=excluded.content,
            type=excluded.type,
            metadata=excluded.metadata,
            duration=excluded.duration,
            expires_at=excluded.expires_at
        `).bind(
          id,
          body.chat_id,
          body.sender_id,
          body.content || "",
          body.type || null,
          typeof body.metadata === "string" ? body.metadata : JSON.stringify(body.metadata ?? null),
          body.created_at || null,
          body.duration ?? null,
          body.expires_at || null
        ).run()
        return json({ ok: true })
      }



      if (url.pathname === "/partner-chats/by-user" && request.method === "GET") {
        const userId = url.searchParams.get("userId")
        if (!userId) return json({ ok: false, error: "userId_required" }, 400)
        const rows = await env.DB.prepare(`
          SELECT * FROM partner_chats
          WHERE user1_id = ? OR user2_id = ?
          ORDER BY COALESCE(last_message_at, created_at) DESC
        `).bind(userId, userId).all()
        return json({ ok: true, chats: rows.results || [] })
      }

      if (url.pathname === "/partner-chats/by-id" && request.method === "GET") {
        const chatId = url.searchParams.get("chatId")
        if (!chatId) return json({ ok: false, error: "chatId_required" }, 400)
        const chat = await env.DB.prepare("SELECT * FROM partner_chats WHERE id = ?").bind(chatId).first()
        return json({ ok: true, chat: chat || null })
      }

      if (url.pathname === "/partner-chats/by-users" && request.method === "GET") {
        const user1 = url.searchParams.get("user1")
        const user2 = url.searchParams.get("user2")
        if (!user1 || !user2) return json({ ok: false, error: "users_required" }, 400)
        const a = user1 < user2 ? user1 : user2
        const b = user1 < user2 ? user2 : user1
        const chat = await env.DB.prepare("SELECT * FROM partner_chats WHERE user1_id = ? AND user2_id = ?")
          .bind(a, b).first()
        return json({ ok: true, chat: chat || null })
      }

      if (url.pathname === "/partner-chats/create-between" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.user1_id || !body.user2_id) return json({ ok: false, error: "users_required" }, 400)
        const a = body.user1_id < body.user2_id ? body.user1_id : body.user2_id
        const b = body.user1_id < body.user2_id ? body.user2_id : body.user1_id
        const existing = await env.DB.prepare("SELECT * FROM partner_chats WHERE user1_id = ? AND user2_id = ?").bind(a, b).first()
        if (existing) return json({ ok: true, chat: existing })

        const id = crypto.randomUUID()
        await env.DB.prepare(`
          INSERT INTO partner_chats (id,user1_id,user2_id,created_at)
          VALUES (?, ?, ?, datetime('now'))
        `).bind(id, a, b).run()
        const chat = await env.DB.prepare("SELECT * FROM partner_chats WHERE id = ?").bind(id).first()
        return json({ ok: true, chat })
      }

      if (url.pathname === "/partner-chats/update" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.id) return json({ ok: false, error: "id_required" }, 400)

        await env.DB.prepare(`
          UPDATE partner_chats SET
            last_message = COALESCE(?, last_message),
            last_message_at = COALESCE(?, last_message_at),
            user1_deleted_at = CASE WHEN ? = 1 THEN ? ELSE user1_deleted_at END,
            user2_deleted_at = CASE WHEN ? = 1 THEN ? ELSE user2_deleted_at END,
            wallpaper_url = CASE WHEN ? = 1 THEN ? ELSE wallpaper_url END,
            wallpaper_set_by = CASE WHEN ? = 1 THEN ? ELSE wallpaper_set_by END
          WHERE id = ?
        `).bind(
          body.last_message ?? null,
          body.last_message_at ?? null,
          body.set_user1_deleted_at ? 1 : 0,
          body.user1_deleted_at ?? null,
          body.set_user2_deleted_at ? 1 : 0,
          body.user2_deleted_at ?? null,
          body.set_wallpaper_url ? 1 : 0,
          body.wallpaper_url ?? null,
          body.set_wallpaper_set_by ? 1 : 0,
          body.wallpaper_set_by ?? null,
          body.id
        ).run()

        return json({ ok: true })
      }

      if (url.pathname === "/partner-messages/by-chat" && request.method === "GET") {
        const chatId = url.searchParams.get("chatId")
        if (!chatId) return json({ ok: false, error: "chatId_required" }, 400)
        const rows = await env.DB.prepare(`
          SELECT * FROM partner_messages
          WHERE chat_id = ? AND deleted_at IS NULL
          ORDER BY created_at ASC
          LIMIT 200
        `).bind(chatId).all()
        return json({ ok: true, messages: rows.results || [] })
      }

      if (url.pathname === "/partner-messages/expire" && request.method === "POST") {
        await env.DB.prepare(`
          UPDATE partner_messages
          SET deleted_at=datetime('now'), content='Mensaje expirado'
          WHERE expires_at IS NOT NULL AND expires_at < datetime('now') AND deleted_at IS NULL
        `).run()
        return json({ ok: true })
      }

      if (url.pathname === "/partner-messages/mark-read" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.chat_id || !body.user_id) return json({ ok: false, error: "missing_fields" }, 400)
        await env.DB.prepare(`
          UPDATE partner_messages
          SET read_at=datetime('now')
          WHERE chat_id=? AND sender_id != ? AND read_at IS NULL AND deleted_at IS NULL
        `).bind(body.chat_id, body.user_id).run()
        return json({ ok: true })
      }

      if (url.pathname === "/partner-messages/unread-count" && request.method === "GET") {
        const chatId = url.searchParams.get("chatId")
        const userId = url.searchParams.get("userId")
        if (!chatId || !userId) return json({ ok: false, error: "missing_fields" }, 400)
        const row = await env.DB.prepare(`
          SELECT COUNT(*) AS count FROM partner_messages
          WHERE chat_id=? AND sender_id != ? AND read_at IS NULL AND deleted_at IS NULL
        `).bind(chatId, userId).first<any>()
        return json({ ok: true, count: row?.count || 0 })
      }

      if (url.pathname === "/partner-messages/update" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.id) return json({ ok: false, error: "id_required" }, 400)
        await env.DB.prepare(`
          UPDATE partner_messages SET
            content = COALESCE(?, content),
            edited_at = CASE WHEN ? = 1 THEN datetime('now') ELSE edited_at END,
            deleted_at = CASE WHEN ? = 1 THEN datetime('now') ELSE deleted_at END,
            expires_at = CASE WHEN ? = 1 THEN ? ELSE expires_at END
          WHERE id = ?
        `).bind(
          body.content ?? null,
          body.set_edited_at ? 1 : 0,
          body.set_deleted_at ? 1 : 0,
          body.set_expires_at ? 1 : 0,
          body.expires_at ?? null,
          body.id
        ).run()
        return json({ ok: true })
      }

      if (url.pathname === "/partner-messages/by-id" && request.method === "GET") {
        const id = url.searchParams.get("id")
        if (!id) return json({ ok: false, error: "id_required" }, 400)
        const msg = await env.DB.prepare("SELECT * FROM partner_messages WHERE id = ?").bind(id).first()
        return json({ ok: true, message: msg || null })
      }

      if (url.pathname === "/partner-saved-messages/count" && request.method === "GET") {
        const chatId = url.searchParams.get("chatId")
        const userId = url.searchParams.get("userId")
        if (!chatId || !userId) return json({ ok: false, error: "missing_fields" }, 400)
        const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM partner_saved_messages WHERE user_id=? AND chat_id=?")
          .bind(userId, chatId).first<any>()
        return json({ ok: true, count: row?.count || 0 })
      }

      if (url.pathname === "/partner-saved-messages/by-chat" && request.method === "GET") {
        const chatId = url.searchParams.get("chatId")
        const userId = url.searchParams.get("userId")
        if (!chatId || !userId) return json({ ok: false, error: "missing_fields" }, 400)
        const rows = await env.DB.prepare("SELECT message_id FROM partner_saved_messages WHERE user_id=? AND chat_id=?")
          .bind(userId, chatId).all()
        return json({ ok: true, saved: (rows.results || []).map((r: any) => r.message_id) })
      }

      if (url.pathname === "/partner-saved-messages/toggle" && request.method === "POST") {
        const body = await readBody(request)
        if (!body.user_id || !body.message_id || !body.chat_id) return json({ ok: false, error: "missing_fields" }, 400)

        const existing = await env.DB.prepare("SELECT id FROM partner_saved_messages WHERE user_id=? AND message_id=?")
          .bind(body.user_id, body.message_id).first<any>()

        if (existing) {
          await env.DB.prepare("DELETE FROM partner_saved_messages WHERE id=?").bind(existing.id).run()
          return json({ ok: true, saved: false })
        }

        await env.DB.prepare(`
          INSERT INTO partner_saved_messages (id,user_id,message_id,chat_id,created_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).bind(crypto.randomUUID(), body.user_id, body.message_id, body.chat_id).run()

        return json({ ok: true, saved: true })
      }



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

        await env.DB.prepare(`
          INSERT INTO comunidad_posts (
            id,user_id,tipo,titulo,descripcion,contenido,created_at,updated_at,views,comments_activos,
            es_partner,estudiados,materia_nombre,materia_color,materia_emoji,portada_url,user_avatar,user_nombre,video_url
          )
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 0, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
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
        await env.DB.prepare(`
          INSERT INTO comunidad_comentarios (id,post_id,user_id,user_nombre,user_avatar,parent_id,contenido,created_at,updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `).bind(
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

        await env.DB.prepare(`
          INSERT INTO news (id,titulo,descripcion,contenido,tipo,media_url,categoria,destacada,autor,autor_email,created_at,updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `).bind(
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

        await env.DB.prepare(`
          INSERT INTO comunidad_ratings (id, post_id, user_id, rating, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(post_id, user_id) DO UPDATE SET
            rating=excluded.rating,
            updated_at=datetime('now')
        `).bind(crypto.randomUUID(), body.post_id, body.user_id, body.rating).run()

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

// export: extraído del mapeo inline de GET /study-sessions/by-user para
// poder probarse directamente con un objeto plano que simula una fila D1
// (sin necesitar wrangler/miniflare/D1 real) — ver
// scripts/tests/study-sessions-worker-row-mapping-contracts.ts (StudyAL_
// Visual_System_Stress_Test, Layer B GAP "persistence — una prueba final").
//
// AUDITORÍA (misma misión, hallazgo posterior a adaptive_setup/setup_hash):
// route.ts (el proxy Next.js) construye y envía current_session_number,
// status y adaptive_state en CADA POST a /study-sessions/upsert (ver
// app/api/study-sessions/route.ts) dando por hecho que se persisten — pero
// ni el INSERT/bind() de /study-sessions/upsert ni este mapeo de GET los
// mencionaban en absoluto. El cliente cree que "sesión actual" sobrevive un
// restore server-authoritative real (dispositivo distinto, caché borrada),
// pero silenciosamente NUNCA se guardaba. Corregido igual que adaptive_setup
// (ALTER TABLE dinámico + columna en INSERT/bind + COALESCE en UPDATE +
// campo en este mapeo).
export function mapStudySessionRow(row: any): Record<string, unknown> {
  const mode = row.process_mode || row.study_mode || 'free'
  return {
    id: row.id,
    temaId: row.tema_id,
    enfoque: row.enfoque,
    processMode: mode,
    studyMode: mode,
    materialIds: safeJson(row.material_ids, []),
    selectedPages: safeJson(row.selected_pages, undefined),
    flashcards: safeJson(row.flashcards, undefined),
    notes: safeJson(row.notes, undefined),
    materialText: row.material_text || undefined,
    currentPhase: row.current_phase || undefined,
    // ── Estado adaptive completo ──
    adaptiveProgram: safeJson(row.adaptive_program, undefined),
    processStyle: row.process_style || undefined,
    targetScore: row.target_score != null ? Number(row.target_score) : undefined,
    examDate: row.exam_date || undefined,
    examDateCustom: row.exam_date_custom || undefined,
    materialBlueprint: safeJson(row.material_blueprint, undefined),
    masterySnapshot: safeJson(row.mastery_snapshot, undefined),
    // AUDITORÍA (StudyAL_Visual_System_Stress_Test, Bug 1): adaptive_setup
    // y setup_hash ya se insertan/actualizan (ver /study-sessions/upsert
    // más abajo) pero nunca se devolvían en el GET — el cliente restauraba
    // blueprint/journey pero perdía el setup asociado, degradando el
    // estado de restauración de forma silenciosa.
    adaptiveSetup: safeJson(row.adaptive_setup, undefined),
    setupHash: row.setup_hash || undefined,
    // AUDITORÍA (misma misión, hallazgo GAP persistence): idéntico patrón de
    // pérdida silenciosa que adaptive_setup/setup_hash, para los campos que
    // determinan "sesión actual" tras un restore server-authoritative real.
    currentSessionNumber: row.current_session_number != null ? Number(row.current_session_number) : undefined,
    status: row.status || undefined,
    adaptiveState: row.adaptive_state || undefined,
    // AUDITORÍA (misma misión, hallazgo posterior: construir
    // persistence-cross-device-round-trip-contracts.ts con el mapeo REAL
    // del Worker, en vez del fake permisivo de la prueba pre-existente,
    // reveló que route.ts ya construía y enviaba TODOS estos campos en cada
    // upsert dando por hecho que sobrevivían — ninguno tenía columna.
    // "sesión actual" sobrevivía (adaptiveState/currentSessionNumber, fix
    // anterior) pero el PROGRESO dentro de la sesión y la evidencia de
    // recovery/preparación no, exactamente lo que un restore cross-device
    // real necesita para no regenerar ni perder trabajo del estudiante.
    primaryMaterialId: row.primary_material_id || undefined,
    masteryMaterialKey: row.mastery_material_key || undefined,
    currentStep: row.current_step != null ? Number(row.current_step) : undefined,
    completedSessionNumbers: safeJson(row.completed_session_numbers, undefined),
    replaySessionNumber: row.replay_session_number != null ? Number(row.replay_session_number) : undefined,
    replayAttempt: row.replay_attempt != null ? Number(row.replay_attempt) : undefined,
    sessionContent: safeJson(row.session_content, undefined),
    sessionPreparation: safeJson(row.session_preparation, undefined),
    isProgramComplete: row.is_program_complete === 1 || row.is_program_complete === true,
    unresolvedMicroIds: safeJson(row.unresolved_micro_ids, undefined),
    activeStudyMs: row.active_study_ms != null ? Number(row.active_study_ms) : undefined,
    breakHoursAcknowledged: row.break_hours_acknowledged != null ? Number(row.break_hours_acknowledged) : undefined,
    materialNames: safeJson(row.material_names, undefined),
    recoveryQueues: safeJson(row.recovery_queues, undefined),
    createdAt: Number(row.created_at || Date.now()),
    lastOpenedAt: Number(row.last_opened_at || Date.now()),
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
