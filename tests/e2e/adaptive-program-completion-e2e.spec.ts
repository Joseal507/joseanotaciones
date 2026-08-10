import { expect, test, type Page } from '@playwright/test'
import { buildAssessmentBlueprint, recordAssessmentEvidence } from '../../lib/adaptive/evaluation/assessmentBlueprint'
import { deriveIsProgramComplete } from '../../lib/adaptive/resume'

// ═══════════════════════════════════════════════════════════════════════════
// PROGRAM COMPLETION — E2E EN PRODUCTO VIVO
//
// Objetivo (ver AGENTS.md): demostrar SESSION COMPLETE != PROGRAM COMPLETE
// end-to-end, con el servidor como autoridad, usando la FUNCIÓN REAL
// deriveIsProgramComplete (importada, no reimplementada) para decidir qué
// persiste el backend simulado — exactamente como exige app/api/study-sessions/route.ts.
//
// El "servidor" de estas pruebas es un stub de red (page.route) que reemplaza
// infraestructura externa (backend D1 + auth real, imposibles de levantar en
// CI) pero ejecuta la MISMA lógica de derivación que route.ts. Ningún otro
// código de producto (assessmentBlueprint, sessionFinalTransition,
// completeAdaptiveSession, page.tsx) está mockeado — corre real, en el
// navegador, exactamente como en producción.
//
// Para probar que el estado tras un reload viene del "servidor" y no de una
// simple retención de localStorage, cada prueba de restore limpia
// localStorage antes de recargar: lo único que puede repoblarlo es la
// respuesta GET de nuestro stub, construida a partir de lo que el propio
// producto persistió vía POST (derivado con la función real).
// ═══════════════════════════════════════════════════════════════════════════

function question(id: string, stepId: string, objectiveId: string, keyPoint: string) {
  return {
    id, conceptId: stepId, conceptLabel: keyPoint, teachingBlockId: stepId,
    questionFamily: id, variant: 'true_false_factual', difficulty: 'easy',
    targetDimension: 'comprehension', format: 'true_false',
    questionText: `${keyPoint} forma parte del contenido enseñado.`, options: null,
    correctAnswer: true, explanation: 'Coincide con el contenido.', hint: 'Usa el contenido visible.',
    estimatedSeconds: 15, evidencesNeeded: 1, factKey: `${stepId}:${id}`, factKeys: [`${stepId}:${id}`],
    targetObjectiveIds: [objectiveId], evidenceProduced: [objectiveId],
    coveredStepIds: [stepId], coveredKeyPoints: [keyPoint],
  }
}

// parsePreparedRecoveryRound (lib/adaptive/evaluation/preparedRecoveryRound.ts) exige
// que cada pregunta de recovery reproduzca EXACTAMENTE coveredStepIds/coveredKeyPointIds/
// factKeys/conceptId/targetDimension del `target` recibido en el POST — cualquier
// desvío ("drift") hace que el cliente descarte la ronda como técnicamente inválida.
//
// recordRecoveryCheck (lib/adaptive/evaluation/recoveryQueue.ts) además exige que las
// DOS preguntas de verificación de una ronda no sean detectadas como "repeatedQuestion"
// entre sí (similitud semántica de texto) — salvo que questionFamily empiece con
// 'deterministic_recovery_', el único escape explícito para fixtures deterministas
// (real, no inventado: así lo marca la propia función de producto).
function recoveryQuestion(id: string, round: number, n: number, objectiveId: string, keyPoint: string, target: {
  sourceStepIds: string[]; sourceKeyPointIds: string[]; sourceFactKeys: string[]; microId: string; cognitiveTarget: string
}) {
  return {
    ...question(id, target.sourceStepIds[0], objectiveId, keyPoint),
    variant: 'mcq_best_answer', format: 'multiple_choice',
    questionFamily: `deterministic_recovery_${round}_${n}`,
    questionText: `Ronda ${round}: pregunta ${n} de recuperación para ${keyPoint}.`,
    options: [{ id: 'a', text: 'Aplicación alineada' }, { id: 'b', text: 'Aplicación incompatible' }],
    correctAnswer: 'a',
    factKey: target.sourceFactKeys[0], factKeys: target.sourceFactKeys,
    coveredStepIds: target.sourceStepIds, coveredKeyPointIds: target.sourceKeyPointIds, coveredKeyPoints: [keyPoint],
    conceptId: target.microId, targetDimension: target.cognitiveTarget,
  }
}

function chapter(chapterNumber: number, id: string) {
  return { id, chapterNumber, kind: 'learning' as const, status: 'available' as const, blockIds: [`block-${chapterNumber}`], unitIds: [`unit-${chapterNumber}`] }
}

function learningContent(opts: { chapterId: string; sessionNumber: number; stepId: string; title: string; keyPoints: string[]; questions: ReturnType<typeof question>[]; blockId: string; factKeys?: string[] }) {
  // factKeys del step deben coincidir literalmente con los que declararán las
  // preguntas (stepId:questionId, ver question() arriba) — Demonstration
  // Coverage exige que question.factKeys intersecte objective.factKeys, no
  // solo que targetObjectiveIds coincida. Sin factKeys explícito, cae al
  // fallback relatedBlockIds=[blockId] (un solo factKey compartido, no
  // alineado con lo que cada pregunta declara individualmente).
  const assessment = buildAssessmentBlueprint(
    [{ id: opts.stepId, title: opts.title, content: `Contenido persistido de ${opts.title}.`, keyPoints: opts.keyPoints, factKeys: opts.factKeys, importance: 0.8 }],
    opts.chapterId, opts.sessionNumber,
  )
  return {
    sessionId: opts.chapterId, sessionTitle: `${opts.title} — aprendizaje`, sessionNumber: opts.sessionNumber,
    sessionKind: 'learning', materialType: 'general_conceptual', academicDomain: 'general_conceptual',
    sessionIntro: `Aprendizaje de ${opts.title}.`,
    steps: [{ id: opts.stepId, type: 'concept', title: opts.title, content: `Explicación verificable de ${opts.title}.`, keyPoints: opts.keyPoints, importance: 'critical', relatedBlockIds: [opts.blockId] }],
    sessionClosing: 'Integración terminada.', totalSteps: 1, assessmentBlueprint: assessment,
    evaluationBlocks: [{ id: `block-eval-${opts.sessionNumber}`, afterStepId: opts.stepId, coveredStepIds: [opts.stepId], coveredKeyPoints: opts.keyPoints, questions: opts.questions }],
    evaluationProgress: {}, recoveryQueue: [],
    objectiveIds: assessment.objectives.map(o => o.objectiveId),
  }
}

// Para simular un restore cross-browser hay que persistir un sessionContent cuyo
// assessmentBlueprint YA refleje evidencia demostrada — el objeto "pristino" que
// devuelve learningContent() no la tiene (nadie jugó esa sesión en ESTE test). Se
// construye con la función REAL recordAssessmentEvidence, no fabricando un shape a mano.
function withFullyDemonstratedAssessment<T extends { assessmentBlueprint: ReturnType<typeof buildAssessmentBlueprint>; objectiveIds: string[] }>(content: T): T {
  let assessment = content.assessmentBlueprint
  for (const objectiveId of content.objectiveIds) {
    const objective = assessment.objectives.find(candidate => candidate.objectiveId === objectiveId)
    assessment = recordAssessmentEvidence(assessment, [objectiveId], objective?.factKeys || [], { valid: true, correct: true, independent: true, evidenceId: `e2e-seed:${objectiveId}` })
  }
  return { ...content, assessmentBlueprint: assessment }
}

type FakeRow = Record<string, any>

interface FakeServerCalls {
  postCount: number
  prematureClaimsRejected: number
  programCompleteTransitions: number
}

// Stand-in de infraestructura externa (route.ts + backend D1 real, que exigen
// OAuth y una API remota imposibles de levantar en CI). La única lógica
// pedagógica/de autoridad que decide isProgramComplete es la función REAL
// deriveIsProgramComplete — igual que hace app/api/study-sessions/route.ts.
async function installFakeStudySessionsServer(page: Page, store: Record<string, FakeRow>, calls: FakeServerCalls) {
  await page.route('**/api/study-sessions**', async route => {
    const req = route.request()
    if (req.method() === 'GET') {
      const url = new URL(req.url())
      const sessionId = url.searchParams.get('sessionId')
      const temaId = url.searchParams.get('temaId')
      let sessions = Object.values(store)
      if (sessionId) sessions = sessions.filter(s => s.id === sessionId)
      else if (temaId) sessions = sessions.filter(s => s.temaId === temaId)
      return route.fulfill({ json: { success: true, sessions } })
    }
    const body = req.postDataJSON()
    const id = String(body.id)
    const previous = store[id] || {}
    const wasComplete = previous.isProgramComplete === true
    const merged: FakeRow = { ...previous, ...body }
    // ÚNICA fuente de verdad para isProgramComplete: la función real, nunca
    // body.isProgramComplete — igual invariante que app/api/study-sessions/route.ts.
    const derived = deriveIsProgramComplete({
      journey: body.journey ?? previous.journey,
      completedSessionNumbers: Array.isArray(body.completedSessionNumbers) ? body.completedSessionNumbers : (previous.completedSessionNumbers || []),
      unresolvedMicroIds: Array.isArray(body.unresolvedMicroIds) ? body.unresolvedMicroIds : (previous.unresolvedMicroIds || []),
    })
    if (body.isProgramComplete === true && !derived) calls.prematureClaimsRejected += 1
    merged.isProgramComplete = derived
    if (derived && !wasComplete) calls.programCompleteTransitions += 1
    store[id] = merged
    calls.postCount += 1
    return route.fulfill({ json: { success: true, session: merged } })
  })
}

async function installAdaptiveContentMocks(page: Page, contents: ReturnType<typeof learningContent>[]) {
  const byChapterId = new Map(contents.map(c => [c.sessionId, c]))
  const factKeyToObjective = new Map<string, string>()
  const factKeyToKeyPoint = new Map<string, string>()
  for (const c of contents) {
    for (const q of c.evaluationBlocks[0].questions) {
      factKeyToObjective.set(q.factKey, q.targetObjectiveIds[0])
      factKeyToKeyPoint.set(q.factKey, q.coveredKeyPoints[0])
    }
  }
  await page.route('**/api/adaptive/session-teach', route => {
    const body = route.request().postDataJSON()
    const content = byChapterId.get(body?.session?.id)
    if (!content) return route.fulfill({ status: 500, json: { success: false, error: 'unexpected session-teach call in E2E fixture' } })
    return route.fulfill({ json: { success: true, classContent: content } })
  })
  await page.route('**/api/adaptive/session-check', route => {
    const body = route.request().postDataJSON()
    const correct = body.answer === body.question.correctAnswer
    return route.fulfill({ json: { success: true, result: { outcome: correct ? 'correct' : 'incorrect', correct, score: correct ? 100 : 0, feedback: correct ? 'Respuesta correcta.' : 'Respuesta incorrecta.', errorType: correct ? null : 'conceptual' } } })
  })
  const reteachRounds = new Map<string, number>()
  await page.route('**/api/adaptive/session-reteach', route => {
    const body = route.request().postDataJSON()
    const round = (reteachRounds.get(body.recoveryId) || 0) + 1
    reteachRounds.set(body.recoveryId, round)
    const sourceFactKey = body.target.sourceFactKeys[0]
    const objectiveId = factKeyToObjective.get(sourceFactKey) || sourceFactKey
    const keyPoint = factKeyToKeyPoint.get(sourceFactKey) || sourceFactKey
    const q = (n: number) => recoveryQuestion(`recovery-${body.recoveryId}-${round}-${n}`, round, n, objectiveId, keyPoint, body.target)
    return route.fulfill({ json: {
      success: true, recoveryId: body.recoveryId, recoveryTargetId: body.recoveryTargetId,
      roundId: body.roundId, roundNumber: round,
      explanation: '**Reexplicación específica.** Corrige solamente la relación que falló.',
      questions: [q(1), q(2)], target: body.target,
      provider: 'openrouter', model: 'google/gemini-2.5-flash', generationKey: body.generationKey, preparedAt: Date.now(),
    } })
  })
}

async function seedJourneySession(page: Page, opts: {
  sessionId: string; temaId: string; chapters: ReturnType<typeof chapter>[]
  completedSessionNumbers: number[]; currentSessionNumber: number
  sessionContent: Record<string, ReturnType<typeof learningContent>>
}) {
  await page.addInitScript(({ sessionId, temaId, chapters, completedSessionNumbers, currentSessionNumber, sessionContent }) => {
    const journey = { id: 'journey_e2e_program_completion', version: 4, chapters, totalChapters: chapters.length }
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['material-e2e'], primaryMaterialId: 'material-e2e', materialNames: ['Material E2E Program Completion'],
      selectedPages: {}, adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80, evalPreference: 'quick_test', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, academicDomain: 'general_conceptual', blocks: chapters.map((c: any) => ({ id: c.blockIds[0] })), topics: [] },
      journey, currentSessionNumber, currentStep: 0, completedSessionNumbers, status: 'not_started', adaptiveState: 'ready',
      isProgramComplete: false, unresolvedMicroIds: [], sessionContent, recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey, sessionContent } }))
  }, { sessionId: opts.sessionId, temaId: opts.temaId, chapters: opts.chapters, completedSessionNumbers: opts.completedSessionNumbers, currentSessionNumber: opts.currentSessionNumber, sessionContent: opts.sessionContent })
}

async function waitForPersistOf(page: Page, sessionNumber: number) {
  // waitForResponse (no waitForRequest): la respuesta solo llega después de que
  // route.fulfill() se ejecutó, momento en el que el store ya quedó actualizado —
  // evita la carrera entre el evento 'request' y el handler async de page.route.
  await page.waitForResponse(res =>
    res.url().includes('/api/study-sessions') &&
    res.request().method() === 'POST' &&
    Boolean((res.request().postDataJSON()?.completedSessionNumbers || []).includes(sessionNumber)),
  )
}

async function resolveRecovery(page: Page, answerLabel: string) {
  await expect(page.getByText('📖 Reexplicación')).toBeVisible()
  await page.getByRole('button', { name: 'Verificar comprensión →' }).click()
  await page.getByRole('button', { name: answerLabel }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
}

test.describe.serial('program completion — multi-session E2E', () => {
  const temaId = 'e2e-program-completion-tema'
  const sessionId = 'e2e-program-completion-session'
  const store: Record<string, FakeRow> = {}
  const calls: FakeServerCalls = { postCount: 0, prematureClaimsRejected: 0, programCompleteTransitions: 0 }

  const chapters = [chapter(1, 'chapter-1'), chapter(2, 'chapter-2'), chapter(3, 'chapter-3')]

  const content2 = learningContent({
    chapterId: 'chapter-2', sessionNumber: 2, stepId: 'node-s2', title: 'Concepto de sesión 2',
    keyPoints: ['Concepto 2: punto único'], blockId: 'block-2',
    factKeys: ['node-s2:s2-q-correct'],
    questions: [],
  })
  content2.evaluationBlocks[0].questions = [question('s2-q-correct', 'node-s2', content2.objectiveIds[0], 'Concepto 2: punto único')]

  const content3 = learningContent({
    chapterId: 'chapter-3', sessionNumber: 3, stepId: 'node-s3', title: 'Concepto de sesión 3 (última)',
    keyPoints: ['Concepto 3: punto A', 'Concepto 3: punto B'], blockId: 'block-3',
    factKeys: ['node-s3:s3-q-correct', 'node-s3:s3-q-fail'],
    questions: [],
  })
  content3.evaluationBlocks[0].questions = [
    question('s3-q-correct', 'node-s3', content3.objectiveIds[0], 'Concepto 3: punto A'),
    question('s3-q-fail', 'node-s3', content3.objectiveIds[1], 'Concepto 3: punto B'),
  ]

  test.beforeEach(async ({ page }) => {
    await installFakeStudySessionsServer(page, store, calls)
    await installAdaptiveContentMocks(page, [content2, content3])
  })

  test('E2E1 — sesión intermedia completa: session complete true, program complete false, sobrevive reload', async ({ page }) => {
    await seedJourneySession(page, {
      sessionId, temaId, chapters, completedSessionNumbers: [1], currentSessionNumber: 2,
      sessionContent: { '2': content2, '3': content3 },
    })

    await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)
    await expect(page.getByText('Paso 1 de 1')).toBeVisible()
    await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
    await page.getByRole('button', { name: 'Verdadero' }).click()
    await page.getByRole('button', { name: 'Enviar respuesta' }).click()

    await expect(page.getByRole('button', { name: '🎉 Terminar' })).toBeVisible()
    await page.getByRole('button', { name: '🎉 Terminar' }).click()
    await expect(page.getByText('Sesión completada')).toBeVisible()
    // hasNextSession (chapter 3 existe) → debe ofrecer continuar, nunca un cierre global.
    await expect(page.getByRole('button', { name: 'Siguiente →' })).toBeVisible()

    await waitForPersistOf(page, 2)
    expect(store[sessionId].completedSessionNumbers.sort()).toEqual([1, 2])
    // ═══ AUTORIDAD DEL SERVIDOR (simulada con la función real) ═══
    // session complete === true, program complete === false: solo 2/3 capítulos.
    expect(store[sessionId].isProgramComplete).toBe(false)
    expect(calls.prematureClaimsRejected).toBe(0)
    expect(calls.programCompleteTransitions).toBe(0)

    // Reload forzando que el estado restaurado venga SOLO de la respuesta GET del
    // "servidor" — se borra localStorage por completo antes de recargar.
    await page.evaluate(() => localStorage.clear())
    const events: string[] = []
    page.on('console', message => events.push(message.text()))
    await page.reload()

    // Tras restaurar exclusivamente desde el GET del servidor: sigue mostrando la
    // sesión 2 como completada (sin re-jugarla), NUNCA vuelve a "pendiente".
    await expect(page.getByText('Sesión completada')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Siguiente →' })).toBeVisible()
    expect(events.some(line => line.includes('session_completion_started'))).toBe(false)
    expect(events.some(line => line.includes('session_completion_persisted'))).toBe(false)

    // Siguiente sesión sigue disponible y carga con normalidad (no bloqueada, no
    // pierde progreso) — y el programa sigue sin estar completo.
    await page.getByRole('button', { name: 'Siguiente →' }).click()
    await expect(page.getByText('Paso 1 de 1')).toBeVisible()
    expect(store[sessionId].isProgramComplete).toBe(false)
  })

  test('E2E2 — última sesión con recovery legítimo: session complete y program complete pasan a true en una sola transición', async ({ page }) => {
    await seedJourneySession(page, {
      sessionId, temaId, chapters, completedSessionNumbers: [1, 2], currentSessionNumber: 3,
      sessionContent: { '2': content2, '3': content3 },
    })
    // El estado del "servidor" ya refleja la sesión 2 completada (resultado de E2E1).
    store[sessionId] = {
      id: sessionId, temaId, processMode: 'adaptive', studyMode: 'adaptive',
      journey: { id: 'journey_e2e_program_completion', chapters, totalChapters: 3 },
      blueprint: { version: 1, academicDomain: 'general_conceptual', blocks: chapters.map(c => ({ id: c.blockIds[0] })), topics: [] },
      completedSessionNumbers: [1, 2], currentSessionNumber: 3, currentStep: 0,
      unresolvedMicroIds: [], isProgramComplete: false, sessionContent: { '2': content2, '3': content3 },
      adaptiveSetup: { completedAt: 1 }, lastOpenedAt: 1,
    }

    const events: string[] = []
    page.on('console', message => events.push(message.text()))

    await page.goto(`/materias/${temaId}/sesion/3?adaptiveSessionId=${sessionId}`)
    await expect(page.getByText('Paso 1 de 1')).toBeVisible()

    await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
    await page.getByRole('button', { name: 'Verdadero' }).click()
    await page.getByRole('button', { name: 'Enviar respuesta' }).click()
    await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
    await page.getByRole('button', { name: 'Falso' }).click()
    await page.getByRole('button', { name: 'Enviar respuesta' }).click()
    await page.getByRole('button', { name: 'Revisar conceptos →' }).click()

    // El fixture SÍ contiene recovery — debe resolverse legítimamente antes del cierre.
    await resolveRecovery(page, 'Aplicación alineada')
    await page.getByRole('button', { name: 'Continuar recuperación →' }).click()
    await page.getByRole('button', { name: 'Aplicación alineada' }).click()
    await page.getByRole('button', { name: 'Enviar respuesta' }).click()

    await expect(page.getByRole('button', { name: '🎉 Terminar' })).toBeVisible()
    await page.getByRole('button', { name: '🎉 Terminar' }).click()
    await expect(page.getByText('Sesión completada')).toBeVisible()
    // Última sesión (chapter 3, sin siguiente) → sin botón "Siguiente →".
    await expect(page.getByRole('button', { name: 'Siguiente →' })).toHaveCount(0)

    await waitForPersistOf(page, 3)
    expect(store[sessionId].completedSessionNumbers.sort()).toEqual([1, 2, 3])
    expect(store[sessionId].isProgramComplete).toBe(true)
    // Exactamente una transición global a completo — sin duplicados.
    expect(calls.programCompleteTransitions).toBe(1)
    expect(events.filter(line => line.includes('session_completion_persisted'))).toHaveLength(1)
    expect(calls.prematureClaimsRejected).toBe(0)
  })

  test('E2E3 — restore tras program complete: no recrea, no duplica, no reaparece recovery/pregunta', async ({ page }) => {
    // Estado ya legítimamente completo (resultado de E2E2), simulando cross-browser
    // restore: localStorage vacío, la ÚNICA fuente es el GET del "servidor".
    store[sessionId] = {
      id: sessionId, temaId, processMode: 'adaptive', studyMode: 'adaptive',
      journey: { id: 'journey_e2e_program_completion', chapters, totalChapters: 3 },
      blueprint: { version: 1, academicDomain: 'general_conceptual', blocks: chapters.map(c => ({ id: c.blockIds[0] })), topics: [] },
      completedSessionNumbers: [1, 2, 3], currentSessionNumber: 3, currentStep: 0,
      unresolvedMicroIds: [], isProgramComplete: true,
      sessionContent: { '2': withFullyDemonstratedAssessment(content2), '3': withFullyDemonstratedAssessment(content3) },
      adaptiveSetup: { completedAt: 1 }, status: 'completed', adaptiveState: 'completed', lastOpenedAt: 1,
    }
    const postCountBefore = calls.postCount

    const events: string[] = []
    page.on('console', message => events.push(message.text()))
    await page.goto(`/materias/${temaId}/sesion/3?adaptiveSessionId=${sessionId}`)

    await expect(page.getByText('Sesión completada')).toBeVisible()
    await expect(page.getByText('📖 Reexplicación')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '🎉 Terminar' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Enviar respuesta' })).toHaveCount(0)
    expect(events.some(line => line.includes('session_completion_started'))).toBe(false)
    expect(events.some(line => line.includes('session_completion_persisted'))).toBe(false)

    expect(store[sessionId].isProgramComplete).toBe(true)
    expect(store[sessionId].completedSessionNumbers.sort()).toEqual([1, 2, 3])
    // Ninguna escritura de persistencia adicional causada solo por restaurar/renderizar.
    expect(calls.postCount).toBe(postCountBefore)
  })
})

test('E2E4 — objetivo unresolved bloquea completion estructuralmente (Caso A, no B)', async ({ page }) => {
  const temaId = 'e2e-unresolved-tema'
  const sessionId = 'e2e-unresolved-session'
  const store: Record<string, FakeRow> = {}
  const calls: FakeServerCalls = { postCount: 0, prematureClaimsRejected: 0, programCompleteTransitions: 0 }
  await installFakeStudySessionsServer(page, store, calls)

  const chapters = [chapter(1, 'chapter-1')]
  const content = learningContent({
    chapterId: 'chapter-1', sessionNumber: 1, stepId: 'node-s1', title: 'Concepto irresoluble',
    keyPoints: ['Concepto U: punto único'], blockId: 'block-1', questions: [],
  })
  content.evaluationBlocks[0].questions = [question('u-q-fail', 'node-s1', content.objectiveIds[0], 'Concepto U: punto único')]
  await installAdaptiveContentMocks(page, [content])

  await seedJourneySession(page, {
    sessionId, temaId, chapters, completedSessionNumbers: [], currentSessionNumber: 1,
    sessionContent: { '1': content },
  })

  await page.goto(`/materias/${temaId}/sesion/1?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Paso 1 de 1')).toBeVisible()

  // Falla la única pregunta normal → dispara recovery.
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await page.getByRole('button', { name: 'Falso' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.getByRole('button', { name: 'Revisar conceptos →' }).click()

  // Y falla también AMBAS verificaciones de recovery (V1 y V2, requeridas para que la
  // ronda se considere completa) → el objetivo queda unresolved sin límite (mismo
  // mecanismo que el contrato "error NO recuperado" del invariant test).
  await resolveRecovery(page, 'Aplicación incompatible')
  await page.getByRole('button', { name: 'Continuar recuperación →' }).click()
  await page.getByRole('button', { name: 'Aplicación incompatible' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()

  await expect(page.getByRole('button', { name: 'Revisar de nuevo →' })).toBeVisible()
  await expect(page.getByRole('button', { name: '🎉 Terminar' })).toHaveCount(0)
  await expect(page.getByTestId('adaptive-session-root')).toHaveAttribute('data-unresolved-objectives', '1')

  // Ninguna interacción posible con un objetivo unresolved permite que
  // completedSessionNumbers avance — completeAdaptiveSession jamás se invoca.
  expect(calls.postCount === 0 || !(store[sessionId]?.completedSessionNumbers || []).includes(1)).toBe(true)
  expect(store[sessionId]?.isProgramComplete).not.toBe(true)
})
