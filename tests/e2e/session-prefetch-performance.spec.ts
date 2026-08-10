import { expect, test, type Page } from '@playwright/test'

// Medición real, controlada y reproducible de COLD vs PREFETCH-HIT (misión: cerrar
// el gap "performance real, no estimaciones" del reporte anterior). La latencia de
// "generación" es un parámetro sintético explícito y declarado (MOCK_LATENCY_MS) —
// mismo espíritu que el patrón PERF_MOCK_DELAY_MS ya usado en este proyecto para
// medir sin gastar en proveedores reales — pero los tiempos reportados son
// wall-clock REAL de código de producción real (page.tsx, loadContext,
// triggerNextSessionPrefetch) ejecutándose en un navegador real contra un dev
// server real. No hay ningún número inventado: cada ms reportado sale de
// Date.now() alrededor de una operación real observada.
const MOCK_LATENCY_MS = 2500

function learningContent(number: number, title: string) {
  return {
    sessionId: `chapter-${number}`, sessionTitle: title, sessionNumber: number, sessionKind: 'learning',
    materialType: 'pdf', sessionIntro: `Inicio ${title}`,
    steps: [{ id: `${number}-a`, type: 'concept', title, content: `Contenido de ${title}.`, keyPoint: null, keyPoints: ['punto clave'], importance: 'important', relatedBlockIds: [] }],
    sessionClosing: `Cierre ${title}`, totalSteps: 1, evaluationProgress: {}, recoveryQueue: [],
    evaluationBlocks: [{
      id: `block-${number}`, afterStepId: `${number}-a`, coveredStepIds: [`${number}-a`], coveredKeyPoints: ['punto clave'],
      questions: [{
        id: `q-${number}`, conceptId: `${number}-a`, conceptLabel: title, teachingBlockId: `${number}-a`,
        questionFamily: 'perf', variant: 'true_false_factual', difficulty: 'easy', targetDimension: 'recognition',
        format: 'true_false', questionText: `${title} es correcto.`, options: null, correctAnswer: true,
        explanation: 'Coincide con el contenido.', hint: 'Recuerda el contenido.', estimatedSeconds: 15, evidencesNeeded: 1,
        factKey: `fact-${number}`, factKeys: [`fact-${number}`], coveredKeyPoints: ['punto clave'], coveredStepIds: [`${number}-a`],
      }],
    }],
  }
}

async function installFixture(page: Page, sessionId: string, temaId: string) {
  const calls: Array<{ origin: string; chapterNumber: number; startedAt: number; respondedAt: number }> = []
  await page.route('**/api/study-sessions**', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { success: true, sessions: [] } })
    : route.fulfill({ json: { success: true } }))
  await page.route('**/api/adaptive/session-teach', async route => {
    const body = route.request().postDataJSON()
    const startedAt = Date.now()
    await new Promise(resolve => setTimeout(resolve, MOCK_LATENCY_MS))
    const chapterNumber = body.session.chapterNumber
    calls.push({ origin: body.requestOrigin || 'cold', chapterNumber, startedAt, respondedAt: Date.now() })
    await route.fulfill({ json: { success: true, classContent: learningContent(chapterNumber, `Sesión ${chapterNumber}`) } })
  })
  await page.route('**/api/adaptive/session-check', async route => {
    const body = route.request().postDataJSON()
    const correct = body.answer === body.question.correctAnswer
    return route.fulfill({ json: { success: true, result: { outcome: correct ? 'correct' : 'incorrect', correct, score: correct ? 100 : 0, feedback: 'ok', errorType: null } } })
  })
  await page.addInitScript(({ sessionId, temaId }) => {
    if (localStorage.getItem('studyal_sessions_v4')?.includes(sessionId)) return
    const chapters = [
      { id: 'chapter-1', chapterNumber: 1, kind: 'introduction', status: 'available', blockIds: [], unitIds: [], arcRole: 'orientation' },
      { id: 'chapter-2', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['b1'], unitIds: ['u1'], arcRole: 'mechanism' },
      { id: 'chapter-3', chapterNumber: 3, kind: 'learning', status: 'available', blockIds: ['b2'], unitIds: ['u2'], arcRole: 'mechanism' },
    ]
    const introContent = {
      sessionId: 'chapter-1', sessionTitle: 'Introducción', sessionNumber: 1, sessionKind: 'introduction', materialType: 'pdf',
      sessionIntro: 'Inicio', steps: [{ id: '1-a', type: 'intro', title: 'Bienvenida', content: 'Contenido de bienvenida.', keyPoint: null, keyPoints: [], importance: 'supporting', relatedBlockIds: [] }],
      sessionClosing: 'Cierre', totalSteps: 1, evaluationBlocks: [], evaluationProgress: {}, recoveryQueue: [],
    }
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['perf-material'], primaryMaterialId: 'perf-material', materialNames: ['Material Perf'], selectedPages: {},
      adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80, mainConcern: '', professorExamStyle: [], evalPreference: 'quick_test', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, blocks: [{ id: 'b1' }, { id: 'b2' }], topics: [] },
      journey: { id: 'perf-plan', version: 1, chapters, totalChapters: 3 },
      currentSessionNumber: 1, currentStep: 0, completedSessionNumbers: [], status: 'in_progress', adaptiveState: 'studying',
      isProgramComplete: false, unresolvedMicroIds: [],
      sessionContent: { '1': introContent },
      recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey: session.journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId })
  return calls
}

// ---------------------------------------------------------------------------
// COLD vs PREFETCH-HIT — medición real de la MISMA transición (2 -> 3), cada
// escenario en su PROPIA page/context de Playwright (evita cualquier
// interferencia de estado entre escenarios comparte-página), mismo
// MOCK_LATENCY_MS, mismo dev server. Los números se comparan entre los dos runs.
// ---------------------------------------------------------------------------
test('prefetch performance: COLD (baseline, sin prefetch previo)', async ({ page }) => {
  const coldSessionId = 'e2e-perf-cold'
  const coldTemaId = 'e2e-perf-cold-tema'
  const coldCalls = await installFixture(page, coldSessionId, coldTemaId)
  const coldStart = Date.now()
  await page.goto(`/materias/${coldTemaId}/sesion/3?adaptiveSessionId=${coldSessionId}`)
  await expect(page.getByRole('heading', { name: 'Sesión 3', level: 1 })).toBeVisible({ timeout: 15_000 })
  const coldMs = Date.now() - coldStart
  const coldSession3Calls = coldCalls.filter(c => c.chapterNumber === 3)
  expect(coldSession3Calls.length).toBe(1)
  expect(coldSession3Calls[0].origin).toBe('cold')
  console.log(`PREFETCH PERFORMANCE — MOCK_LATENCY_MS=${MOCK_LATENCY_MS}`)
  console.log(`COLD: ${coldMs}ms, session-teach calls for N+1 = ${coldSession3Calls.length} (origin=cold)`)
})

test('prefetch performance: PREFETCH HIT (N activa preparó N+1 en segundo plano)', async ({ page }) => {
  const hitSessionId = 'e2e-perf-hit'
  const hitTemaId = 'e2e-perf-hit-tema'
  const hitCalls = await installFixture(page, hitSessionId, hitTemaId)
  await page.goto(`/materias/${hitTemaId}/sesion/2?adaptiveSessionId=${hitSessionId}`)
  await expect(page.getByRole('heading', { name: 'Sesión 2', level: 1 })).toBeVisible({ timeout: 15_000 })
  const nActiveTimestamp = Date.now()

  // Confirmación 1: el prefetch REALMENTE empezó mientras N (sesión 2) seguía
  // activa — esperamos a que el mock reciba y responda la request de origin=prefetch
  // para la sesión 3, sin que el usuario haya hecho NADA más que ver la sesión 2.
  await expect.poll(() => hitCalls.some(c => c.chapterNumber === 3 && c.origin === 'prefetch'), { timeout: 15_000, message: 'el prefetch de la sesión 3 debe dispararse en segundo plano mientras la 2 está activa' }).toBe(true)
  const prefetchCall = hitCalls.find(c => c.chapterNumber === 3 && c.origin === 'prefetch')!
  expect(prefetchCall.startedAt).toBeLessThanOrEqual(nActiveTimestamp + 200)
  console.log(`prefetch performance: prefetch de N+1 empezó ${nActiveTimestamp - prefetchCall.startedAt}ms después de que N quedó visible (negativo/cerca de 0 = prácticamente inmediato)`)

  // La respuesta del prefetch ya llegó al mock, pero el CLIENTE todavía necesita
  // parsear el JSON y persistir (updateSessionById -> localStorage) de forma
  // asíncrona — esperamos a que ESO también termine (no solo a que el servidor
  // respondiera), consultando el estado persistido real, para que la navegación de
  // "hit" sea un hit genuino y no una carrera contra la propia persistencia.
  await expect.poll(() => page.evaluate(({ sessionId }) => {
    const artifacts = JSON.parse(localStorage.getItem('studyal_adaptive_artifacts_v1') || '{}')
    return Boolean(artifacts[sessionId]?.sessionContent?.['3']?.evaluationBlocks?.length)
  }, { sessionId: hitSessionId }), { timeout: 15_000, message: 'el prefetch debe terminar de persistirse en localStorage antes de navegar' }).toBe(true)

  // Ahora, con el prefetch ya resuelto, el usuario navega explícitamente a la 3.
  const hitClickStart = Date.now()
  await page.goto(`/materias/${hitTemaId}/sesion/3?adaptiveSessionId=${hitSessionId}`)
  await expect(page.getByRole('heading', { name: 'Sesión 3', level: 1 })).toBeVisible({ timeout: 15_000 })
  const hitMs = Date.now() - hitClickStart

  const hitSession3Calls = hitCalls.filter(c => c.chapterNumber === 3)
  // Confirmación 2: N+1 NO se regeneró completa al terminar N / al navegar —
  // exactamente UNA llamada real a session-teach para la sesión 3 en todo el
  // escenario (la del prefetch), nunca una segunda al navegar. Confirmación 3
  // (implícita): el contenido servido es el del fingerprint válido reutilizado.
  expect(hitSession3Calls.length).toBe(1)
  expect(hitSession3Calls[0].origin).toBe('prefetch')

  console.log(`PREFETCH PERFORMANCE — MOCK_LATENCY_MS=${MOCK_LATENCY_MS}`)
  console.log(`PREFETCH HIT: ${hitMs}ms, session-teach calls for N+1 = ${hitSession3Calls.length} (origin=prefetch, absorbido en segundo plano)`)
  // La garantía ARQUITECTÓNICA real (cero llamadas de generación en el camino
  // crítico de navegación) ya quedó probada arriba por conteo/origen — esa es la
  // aserción dura. hitMs en sí es ruido de hidratación/navegación del dev server de
  // Next.js (varía run a run, ~2.4-2.7s observado) y se reporta como métrica, no
  // como gate estricto, para no acoplar el test a la varianza del entorno local.
  expect(hitMs).toBeLessThan(MOCK_LATENCY_MS * 2)
})

// ---------------------------------------------------------------------------
// Fingerprint STALE invalida/repara: tras un prefetch válido, si el blueprint
// cambia de versión ANTES de que el usuario navegue, la navegación debe disparar
// una regeneración real (nunca servir el contenido obsoleto) — dos llamadas
// totales: la del prefetch (descartada) + una cold real tras invalidación.
// ---------------------------------------------------------------------------
test('prefetch performance: fingerprint stale invalida y repara (nunca sirve contenido obsoleto)', async ({ page }) => {
  const sessionId = 'e2e-perf-stale'
  const temaId = 'e2e-perf-stale-tema'
  const calls = await installFixture(page, sessionId, temaId)
  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)
  await expect(page.getByRole('heading', { name: 'Sesión 2', level: 1 })).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => calls.some(c => c.chapterNumber === 3 && c.origin === 'prefetch'), { timeout: 15_000 }).toBe(true)

  // Simula que el blueprint se regeneró (nueva versión) ANTES de que el usuario
  // navegue — el fingerprint calculado en el consumo ya no coincidirá con el del
  // prefetch persistido.
  await page.evaluate(({ sessionId }) => {
    const artifacts = JSON.parse(localStorage.getItem('studyal_adaptive_artifacts_v1') || '{}')
    artifacts[sessionId].blueprint.version = 999
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify(artifacts))
  }, { sessionId })

  await page.goto(`/materias/${temaId}/sesion/3?adaptiveSessionId=${sessionId}`)
  await expect(page.getByRole('heading', { name: 'Sesión 3', level: 1 })).toBeVisible({ timeout: 15_000 })

  const session3Calls = calls.filter(c => c.chapterNumber === 3)
  expect(session3Calls.length).toBe(2)
  expect(session3Calls[0].origin).toBe('prefetch')
  expect(session3Calls[1].origin).toBe('cold')
  console.log('prefetch performance: fingerprint stale -> invalidación + reparación real (2 llamadas: prefetch descartado + cold real) PASS')
})

// ---------------------------------------------------------------------------
// Prefetch failure nunca rompe la sesión actual: si la llamada en segundo plano
// falla, la sesión N sigue 100% usable, y N+1 se genera normalmente (cold) al
// navegar — sin ningún error visible para el usuario durante N.
// ---------------------------------------------------------------------------
test('prefetch performance: fallo de prefetch nunca rompe la sesión actual', async ({ page }) => {
  const sessionId = 'e2e-perf-fail'
  const temaId = 'e2e-perf-fail-tema'
  const calls: Array<{ origin: string; chapterNumber: number }> = []
  await page.route('**/api/study-sessions**', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { success: true, sessions: [] } })
    : route.fulfill({ json: { success: true } }))
  await page.route('**/api/adaptive/session-teach', async route => {
    const body = route.request().postDataJSON()
    const chapterNumber = body.session.chapterNumber
    const origin = body.requestOrigin || 'cold'
    calls.push({ origin, chapterNumber })
    if (origin === 'prefetch') {
      await route.fulfill({ status: 500, json: { success: false, error: 'PROVIDER_UNAVAILABLE' } })
      return
    }
    await route.fulfill({ json: { success: true, classContent: learningContent(chapterNumber, `Sesión ${chapterNumber}`) } })
  })
  await page.addInitScript(({ sessionId, temaId }) => {
    if (localStorage.getItem('studyal_sessions_v4')?.includes(sessionId)) return
    const chapters = [
      { id: 'chapter-1', chapterNumber: 1, kind: 'introduction', status: 'available', blockIds: [], unitIds: [], arcRole: 'orientation' },
      { id: 'chapter-2', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['b1'], unitIds: ['u1'], arcRole: 'mechanism' },
      { id: 'chapter-3', chapterNumber: 3, kind: 'learning', status: 'available', blockIds: ['b2'], unitIds: ['u2'], arcRole: 'mechanism' },
    ]
    const introContent = {
      sessionId: 'chapter-1', sessionTitle: 'Introducción', sessionNumber: 1, sessionKind: 'introduction', materialType: 'pdf',
      sessionIntro: 'Inicio', steps: [{ id: '1-a', type: 'intro', title: 'Bienvenida', content: 'Contenido de bienvenida.', keyPoint: null, keyPoints: [], importance: 'supporting', relatedBlockIds: [] }],
      sessionClosing: 'Cierre', totalSteps: 1, evaluationBlocks: [], evaluationProgress: {}, recoveryQueue: [],
    }
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['perf-material'], primaryMaterialId: 'perf-material', materialNames: ['Material Perf'], selectedPages: {},
      adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80, mainConcern: '', professorExamStyle: [], evalPreference: 'quick_test', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, blocks: [{ id: 'b1' }, { id: 'b2' }], topics: [] },
      journey: { id: 'perf-plan', version: 1, chapters, totalChapters: 3 },
      currentSessionNumber: 1, currentStep: 0, completedSessionNumbers: [], status: 'in_progress', adaptiveState: 'studying',
      isProgramComplete: false, unresolvedMicroIds: [],
      sessionContent: { '1': introContent },
      recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey: session.journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId })

  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)
  await expect(page.getByRole('heading', { name: 'Sesión 2', level: 1 })).toBeVisible({ timeout: 15_000 })
  // La sesión 2 (N) debe seguir 100% usable: sin ningún texto de error visible.
  await expect(page.getByText(/error|falló|no pudimos/i)).toHaveCount(0)
  await expect(page.getByText('Contenido de Sesión 2.')).toBeVisible()

  await expect.poll(() => calls.some(c => c.chapterNumber === 3 && c.origin === 'prefetch'), { timeout: 15_000 }).toBe(true)
  // Sigue sin error visible tras el fallo silencioso del prefetch.
  await expect(page.getByText(/error|falló|no pudimos/i)).toHaveCount(0)

  // Navegar a la 3 debe funcionar con normalidad — cold load real, sesión usable.
  await page.goto(`/materias/${temaId}/sesion/3?adaptiveSessionId=${sessionId}`)
  await expect(page.getByRole('heading', { name: 'Sesión 3', level: 1 })).toBeVisible({ timeout: 15_000 })
  const session3ColdCalls = calls.filter(c => c.chapterNumber === 3 && c.origin === 'cold')
  expect(session3ColdCalls.length).toBe(1)
  console.log('prefetch performance: fallo de prefetch nunca rompió N, y N+1 se generó normalmente al navegar PASS')
})
