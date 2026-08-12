// StudyAL_Visual_System_Stress_Test — Layer B GAP "persistence final"
// (pedido explícito del usuario, sección 8: "WRITE -> READ -> deep equality
// pedagógica"). A diferencia de session-persistence-server-restart-
// contracts.impl.mts (que ya existía, y sigue siendo válido para
// sessionContent/sessionPreparation/recoveryQueues/assessmentBlueprint),
// este archivo usa el mapeo REAL del Worker (mapStudySessionRow, importado
// directamente de cloudflare/studyal-api/src/index.ts) en el "backend
// externo simulado" — no un echo permisivo. Esta es precisamente la
// diferencia que hubiera atrapado el bug real de esta misión
// (currentSessionNumber/status/adaptiveState silenciosamente descartados
// por el Worker pese a que route.ts los enviaba): un fake permisivo nunca
// puede detectar una columna faltante en el INSERT/mapeo real.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

test('PERSISTENCE CROSS-DEVICE ROUND TRIP — WRITE -> READ vía mapStudySessionRow REAL -> deep equality pedagógica', async () => {
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-pretest'

  const { mapStudySessionRow } = await import('../../cloudflare/studyal-api/src/index')

  // Backend externo simulado: aplica el MISMO patrón COALESCE que el SQL real
  // del Worker (upsert.ON CONFLICT ... COALESCE(excluded.x, tabla.x)) — un
  // campo ausente en un POST parcial nunca borra un valor ya guardado — y
  // en GET aplica mapStudySessionRow REAL sobre la fila almacenada.
  // Columnas TEXT que el Worker real serializa con JSON.stringify() antes de
  // bind() (ver /study-sessions/upsert) — una fila D1 real SIEMPRE las
  // guarda como string, nunca como objeto. Sin este paso, mapStudySessionRow
  // (que hace JSON.parse vía safeJson) recibiría un objeto donde espera un
  // string y devolvería undefined — un fake D1 "de más" ocultaría bugs
  // reales de serialización tan fácilmente como uno permisivo los oculta.
  const JSON_COLUMNS = new Set([
    'material_ids', 'selected_pages', 'flashcards', 'notes', 'adaptive_program',
    'material_blueprint', 'mastery_snapshot', 'adaptive_setup',
    'completed_session_numbers', 'session_content', 'session_preparation',
    'unresolved_micro_ids', 'material_names', 'recovery_queues',
  ])
  const fakeD1 = new Map<string, Record<string, unknown>>()
  const realFetch = global.fetch
  global.fetch = (async (url: string | URL, init?: any) => {
    const u = String(url)
    if (u.includes('/study-sessions/upsert')) {
      const body = JSON.parse(init.body)
      const existing = fakeD1.get(body.id) || {}
      const merged: Record<string, unknown> = { ...existing }
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined || value === null) continue
        merged[key] = JSON_COLUMNS.has(key) ? JSON.stringify(value) : value
      }
      fakeD1.set(body.id, merged)
      return { ok: true, json: async () => ({ session: { id: body.id } }) } as Response
    }
    if (u.includes('/study-sessions/by-user')) {
      const rows = [...fakeD1.values()]
      return { ok: true, json: async () => ({ sessions: rows.map(mapStudySessionRow) }) } as Response
    }
    return { ok: true, json: async () => ({}) } as Response
  }) as typeof fetch
  process.env.STUDYAL_API_URL = 'https://fake-external-worker-round-trip.test'

  mock.module('next-auth', {
    namedExports: { getServerSession: async () => ({ user: { id: 'cross-device-user' } }) },
  })

  const { POST, GET } = await import('../../app/api/study-sessions/route')
  const { NextRequest } = await import('next/server')

  const post = (body: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/study-sessions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  const getByTema = async (temaId: string) => {
    const res = await GET(new NextRequest(`http://localhost/api/study-sessions?temaId=${temaId}`))
    return res.json()
  }

  // ===========================================================================
  // CLIENTE A — estudia hasta la sesión 3, con blueprint/journey completos.
  // ===========================================================================
  const temaId = 'cross-device-tema'
  const sessionId = 'cross-device-session'
  const originalBlueprint = { version: 1, blocks: [{ id: 'b1' }, { id: 'b2' }], topics: [{ id: 't1', title: 'Topic', pages: [1] }] }
  const originalJourney = { id: 'journey-cross-device', version: 1, totalChapters: 3, chapters: [{ id: 'chapter-3', chapterNumber: 3, kind: 'learning' }] }
  const originalSetup = {
    knowledgeLevel: 'want_review', examDateType: 'this_week', targetScore: 90,
    mainConcern: 'derivadas', professorExamStyle: ['problemas largos'], evalPreference: 'mixed', planView: 'book', completedAt: 555,
  }

  const originalSessionPreparation = { '4': { preparationStatus: 'teaching_generation', currentGenerationStage: 'session_assembly_failed', generatedEvaluationBlocks: [], acceptedQuestions: [] } }
  const originalRecoveryQueues = { '3': [{ recoveryId: 'r1', status: 'unresolved', latestFactKeys: ['fact-a'], verificationRound: 1 }] }
  const originalSessionContent = { '3': { sessionId: 'chapter-3', sessionTitle: 'Sesión 3', steps: [{ id: 'step-a', title: 'A', content: 'Contenido A' }] } }

  const create = await post({
    id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive',
    materialIds: ['material-cross-device'], primaryMaterialId: 'material-cross-device',
    adaptiveSetup: originalSetup, blueprint: originalBlueprint, journey: originalJourney,
    currentSessionNumber: 3, currentStep: 1, status: 'in_progress', adaptiveState: 'ready',
    completedSessionNumbers: [1, 2],
    sessionContent: originalSessionContent,
    sessionPreparation: originalSessionPreparation,
    recoveryQueues: originalRecoveryQueues,
    unresolvedMicroIds: ['micro-b'],
  })
  assert.equal(create.status, 200, 'CLIENTE A: POST inicial debe responder 200')

  // Actualización posterior — solo currentStep cambia, el resto debe
  // sobrevivir por COALESCE (mismo patrón que un sync parcial real).
  const advance = await post({
    id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', materialIds: ['material-cross-device'],
    currentSessionNumber: 3, currentStep: 2, status: 'in_progress',
  })
  assert.equal(advance.status, 200, 'CLIENTE A: POST de avance debe responder 200')

  // ===========================================================================
  // DESTRUIR TODO ESTADO DE CLIENTE A: ningún localStorage se usó ni se
  // importó en este archivo — el único estado real es `fakeD1` (el
  // "servidor"). No se reutiliza ninguna variable de progreso de A.
  // ===========================================================================

  // ===========================================================================
  // CLIENTE B — runtime/dispositivo distinto: reconstruye SOLO desde el GET
  // real, que pasa por mapStudySessionRow REAL (no un echo).
  // ===========================================================================
  const restored = await getByTema(temaId)
  const session = restored.sessions.find((s: any) => s.id === sessionId)
  assert.ok(session, 'CLIENTE B: GET real debe devolver la sesión')

  // Deep equality pedagógica — exactamente los campos que la misión de esta
  // ronda encontró rotos o ya había arreglado.
  assert.deepEqual(session.blueprint, originalBlueprint, 'blueprint debe sobrevivir IDÉNTICO')
  assert.deepEqual(session.journey, originalJourney, 'journey debe sobrevivir IDÉNTICO')
  assert.deepEqual(session.adaptiveSetup, originalSetup, 'adaptiveSetup debe sobrevivir IDÉNTICO')
  assert.equal(session.currentSessionNumber, 3, 'currentSessionNumber debe sobrevivir (hallazgo de esta ronda)')
  assert.equal(session.currentStep, 2, 'currentStep debe reflejar el avance más reciente')
  assert.equal(session.status, 'in_progress', 'status debe sobrevivir (hallazgo de esta ronda)')
  assert.equal(session.adaptiveState, 'ready', 'adaptiveState debe sobrevivir (hallazgo de esta ronda, crítico para restoreGapAfterReady)')
  assert.deepEqual(session.completedSessionNumbers, [1, 2], 'completedSessionNumbers debe sobrevivir (hallazgo de esta ronda)')
  assert.deepEqual(session.sessionContent, originalSessionContent, 'sessionContent debe sobrevivir IDÉNTICO (hallazgo de esta ronda)')
  assert.deepEqual(session.sessionPreparation, originalSessionPreparation, 'sessionPreparation debe sobrevivir IDÉNTICO — evidencia de reanudación de N+1 (hallazgo de esta ronda)')
  assert.deepEqual(session.recoveryQueues, originalRecoveryQueues, 'recoveryQueues debe sobrevivir IDÉNTICO (hallazgo de esta ronda)')
  assert.deepEqual(session.unresolvedMicroIds, ['micro-b'], 'unresolvedMicroIds debe sobrevivir (hallazgo de esta ronda)')

  global.fetch = realFetch
  console.log('persistence-cross-device-round-trip: WRITE -> READ vía mapStudySessionRow REAL -> deep equality pedagógica (blueprint/journey/setup/currentSessionNumber/status/adaptiveState) PASS')
})
