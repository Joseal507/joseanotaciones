// Implementación real del test de restart SERVER-ONLY (misión: verificación
// focalizada de persistencia server-side, no localStorage). Ejecuta las funciones
// POST/GET REALES de app/api/study-sessions/route.ts contra un backend externo
// SIMULADO (un Map en memoria haciendo de Cloudflare Worker) — la ÚNICA pieza
// mockeada es next-auth (autenticación, fuera del alcance de esta verificación).
// localStorage NUNCA se usa ni se importa en este archivo — PROCESO B lee
// EXCLUSIVAMENTE vía GET real.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

test('SERVER-ONLY RESTART RESTORE — vía /api/study-sessions real, sin localStorage', async () => {
  // Backend externo simulado: guarda EXACTAMENTE lo que el proxy real le envía
  // (snake_case, el esquema que /api/study-sessions POST construye), y en by-user
  // devuelve equivalentes camelCase — el propio código de GET (route.ts) da por
  // hecho que campos como temaId/currentSessionNumber llegan YA en camelCase desde
  // la API externa real (solo usa fallbacks snake_case para un subconjunto de
  // campos) — esta es la única asunción bajo la cual el código ya en producción es
  // coherente, dado que no tengo acceso al código fuente del Worker externo real.
  const snakeToCamel = (key: string) => key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
  const withCamelAliases = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...obj }
    for (const [key, value] of Object.entries(obj)) {
      const camel = snakeToCamel(key)
      if (camel !== key && !(camel in out)) out[camel] = value
    }
    return out
  }
  const fakeExternalWorker = new Map<string, Record<string, unknown>>()
  const realFetch = global.fetch
  global.fetch = (async (url: string | URL, init?: any) => {
    const u = String(url)
    if (u.includes('/study-sessions/upsert')) {
      const body = JSON.parse(init.body)
      const existing = fakeExternalWorker.get(body.id) || {}
      fakeExternalWorker.set(body.id, { ...existing, ...body })
      return { ok: true, json: async () => ({ session: body }) } as Response
    }
    if (u.includes('/study-sessions/by-user')) {
      return { ok: true, json: async () => ({ sessions: [...fakeExternalWorker.values()].map(withCamelAliases) }) } as Response
    }
    return { ok: true, json: async () => ({}) } as Response
  }) as typeof fetch
  process.env.STUDYAL_API_URL = 'https://fake-external-worker.test'
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-pretest'

  mock.module('next-auth', {
    namedExports: { getServerSession: async () => ({ user: { id: 'server-restart-user' } }) },
  })

  const { POST, GET } = await import('../../app/api/study-sessions/route')
  const { NextRequest } = await import('next/server')
  const { buildAssessmentBlueprint, recordAssessmentEvidence, canCompleteSessionFromAssessment } = await import('../../lib/adaptive/evaluation/assessmentBlueprint')

  const post = (body: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/study-sessions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  const getByTema = async (temaId: string) => {
    const res = await GET(new NextRequest(`http://localhost/api/study-sessions?temaId=${temaId}`))
    return res.json()
  }

  // ===========================================================================
  // PROCESO A — crear programa, preparar learning session, responder actividades,
  // producir EvidenceProfile real (mastered + unresolved), currentStep, recovery
  // queue, y sessionPreparation PARCIAL para la sesión 3 (simula un fallo de
  // preparación a mitad de camino en N+1) — TODO vía POST real.
  // ===========================================================================
  const temaId = 'server-restart-tema-1'
  const sessionId = 'server-restart-session-1'
  const journey = {
    id: 'journey-server-restart', version: 1, totalChapters: 3,
    chapters: [
      { id: 'chapter-1', chapterNumber: 1, kind: 'introduction', status: 'available', blockIds: [], unitIds: [] },
      { id: 'chapter-2', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['b1', 'b2'], unitIds: ['u1'] },
      { id: 'chapter-3', chapterNumber: 3, kind: 'learning', status: 'available', blockIds: ['b3'], unitIds: ['u2'] },
    ],
  }
  const teachingSteps = [
    { id: 'step-a', title: 'Concepto A', content: 'Contenido A', keyPoints: ['kp-a'], importance: 'important' as const, relatedBlockIds: [], microId: 'micro-a', factKeys: ['fact-a'] },
    { id: 'step-b', title: 'Concepto B', content: 'Contenido B', keyPoints: ['kp-b'], importance: 'important' as const, relatedBlockIds: [], microId: 'micro-b', factKeys: ['fact-b'] },
  ]
  const assessmentBlueprint = buildAssessmentBlueprint(teachingSteps.map(s => ({ ...s, importance: 0.7 })), sessionId, 1)
  const [objectiveA, objectiveB] = assessmentBlueprint.objectives

  // POST 1: crear programa (setup + blueprint + journey).
  const create = await post({
    id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive',
    materialIds: ['material-server-restart'], primaryMaterialId: 'material-server-restart',
    adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80, evalPreference: 'mix_everything' },
    blueprint: { version: 1, blocks: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }], topics: [] },
    journey, currentSessionNumber: 2, currentStep: 0, status: 'in_progress',
  })
  assert.equal(create.status, 200, 'PROCESO A: POST de creación de programa debe responder 200')

  // PROCESO A: micro-a MASTERED (independiente, correcto), micro-b UNRESOLVED
  // (recovery activo) — EvidenceProfile real con ambos casos exigidos.
  const blueprintAfterStudying = recordAssessmentEvidence(assessmentBlueprint, [objectiveA.objectiveId], ['fact-a'], {
    valid: true, correct: true, independent: true, evidenceId: 'ev-fact-a-mastered',
  })
  const classContent2 = {
    sessionId: 'chapter-2', sessionTitle: 'Sesión 2', sessionNumber: 2, sessionKind: 'learning',
    steps: teachingSteps, sessionIntro: 'Inicio', sessionClosing: 'Cierre', totalSteps: 2,
    evaluationBlocks: [{ id: 'block-1', afterStepId: 'step-b', coveredStepIds: ['step-a', 'step-b'], coveredKeyPoints: ['kp-a', 'kp-b'], questions: [] }],
    assessmentBlueprint: blueprintAfterStudying,
    evaluationProgress: { 'block-1': { status: 'in_progress', answeredCount: 1 } },
  }
  // sessionPreparation PARCIAL para la sesión 3 — simula el fallo de preparación
  // original (session_assembly_failed) que esta misión arregló: teachingContent
  // invalidado, preparationStatus='teaching_generation', listo para reanudar.
  const partialPreparationForSession3 = {
    preparationStatus: 'teaching_generation', currentGenerationStage: 'session_assembly_failed',
    teachingContent: undefined, generatedEvaluationBlocks: [], acceptedQuestions: [],
    lastTechnicalError: 'INVALID_ACADEMIC_FRAGMENT:content',
    lastDiagnostic: { errorCode: 'CONTENT_SANITIZATION_FAILED', validationErrors: ['INVALID_ACADEMIC_FRAGMENT:content'], unknownStepIds: [], unknownKeyPoints: [], missingStepIds: [] },
  }

  const study = await post({
    id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', materialIds: ['material-server-restart'],
    currentSessionNumber: 2, currentStep: 1, status: 'in_progress',
    sessionContent: { '2': classContent2 },
    sessionPreparation: { '3': partialPreparationForSession3 },
    recoveryQueues: { '2': [{ recoveryId: 'r1', status: 'unresolved', latestFactKeys: ['fact-b'], verificationRound: 1 }] },
  })
  assert.equal(study.status, 200, 'PROCESO A: POST de progreso de estudio debe responder 200')

  // Confirma que el "backend externo" simulado REALMENTE recibió sessionPreparation
  // (el gap que esta misión cerró) — si esto falla, la persistencia server-side
  // sigue rota y hay que arreglarla antes de continuar.
  const rawStored = fakeExternalWorker.get(sessionId)!
  assert.ok(rawStored.session_preparation, 'PERSISTENCIA SERVER-SIDE ROTA: session_preparation no llegó al backend externo')
  assert.ok(rawStored.session_content, 'PERSISTENCIA SERVER-SIDE ROTA: session_content no llegó al backend externo')

  // ===========================================================================
  // DESTRUIR TODO ESTADO EN MEMORIA DE PROCESO A: nunca se tocó localStorage (no
  // se importó ni usó en este archivo) — el único estado que existe es
  // `fakeExternalWorker` (el "servidor"). No hay Maps/caches de proceso de la app
  // involucrados en este camino (session-teach's preparationStore es un módulo
  // DISTINTO, no tocado aquí). Simula un runtime nuevo simplemente NO reutilizando
  // ninguna variable JS de arriba — PROCESO B solo puede usar `getByTema`/GET.
  // ===========================================================================

  // ===========================================================================
  // PROCESO B — runtime nuevo: reconstruir SOLO desde lo que el GET real devuelve.
  // ===========================================================================
  const restoredPayload = await getByTema(temaId)
  const restoredSession = restoredPayload.sessions.find((s: any) => s.id === sessionId)
  assert.ok(restoredSession, 'PROCESO B: GET real debe devolver la sesión — sin localStorage de por medio')

  // Igualdad pedagógica exigida explícitamente:
  assert.equal(restoredSession.id, sessionId, 'sessionId')
  assert.equal(restoredSession.temaId, temaId, 'programId/temaId')
  assert.equal(restoredSession.status, 'in_progress', 'status')
  assert.equal(restoredSession.currentStep, 1, 'currentStep')
  assert.equal(restoredSession.currentSessionNumber, 2, 'currentActivity/currentSessionNumber')

  const restoredContent = restoredSession.sessionContent['2']
  assert.ok(restoredContent, 'sessionContent')
  const restoredBlueprint = restoredContent.assessmentBlueprint
  assert.ok(restoredBlueprint, 'assessmentBlueprint (EvidenceProfile real de este codebase)')
  const restoredObjectiveA = restoredBlueprint.objectives.find((o: any) => o.objectiveId === objectiveA.objectiveId)
  const restoredObjectiveB = restoredBlueprint.objectives.find((o: any) => o.objectiveId === objectiveB.objectiveId)
  assert.equal(restoredObjectiveA.independentlyCorrect, true, 'micro mastered debe sobrevivir el restart SERVER-ONLY')
  assert.equal(restoredObjectiveB.independentlyCorrect, false, 'micro unresolved debe SEGUIR unresolved (no mastered falso)')
  assert.deepEqual(restoredObjectiveA.demonstratedFactKeys, ['fact-a'], 'demonstratedFactKeys exacto (EvidenceProfile)')
  assert.deepEqual(restoredContent.evaluationProgress, classContent2.evaluationProgress, 'evaluation progress relevante')

  assert.ok(restoredSession.sessionPreparation, 'sessionPreparation')
  // JSON no tiene `undefined` — un round-trip real (POST->fetch->JSON.stringify/parse
  // ->GET) legítimamente OMITE esa clave en vez de preservarla como undefined; se
  // compara contra la forma que un round-trip JSON real produce, no contra el
  // objeto JS original literal.
  const { teachingContent: _omittedByJson, ...expectedPreparationAfterJsonRoundTrip } = partialPreparationForSession3
  assert.deepEqual(restoredSession.sessionPreparation['3'], expectedPreparationAfterJsonRoundTrip, 'sessionPreparation parcial (reanudación de N+1) debe sobrevivir el restart SERVER-ONLY exactamente — este es el gap que esta misión cerró')

  const restoredRecoveryQueue = restoredSession.recoveryQueues['2']
  assert.equal(restoredRecoveryQueue[0].status, 'unresolved', 'recovery queue')
  assert.equal(restoredRecoveryQueue[0].verificationRound, 1, 'recovery queue detail (verificationRound)')

  assert.equal(
    canCompleteSessionFromAssessment(restoredBlueprint, restoredRecoveryQueue.filter((i: any) => i.status !== 'resolved').map((i: any) => i.recoveryId)),
    false,
    'mismo estado pedagógico (no completable) reproducido exactamente vía SOLO el GET real',
  )

  global.fetch = realFetch
  console.log('SERVER-ONLY RESTART RESTORE: PASS (POST/GET reales de /api/study-sessions, sin localStorage, solo next-auth mockeado)')
})
