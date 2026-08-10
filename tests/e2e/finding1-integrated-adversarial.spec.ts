import { expect, test, type Page } from '@playwright/test'
import { buildAssessmentBlueprint } from '../../lib/adaptive/evaluation/assessmentBlueprint'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'

// FASE C — escenario adversarial integrado (post-7a3c3f7, Findings 1/2/3/4).
// Cadena completa en una sola sesión real:
//   enseñanza → assessment (asistencia+refresh no cuenta como independiente,
//   siguiente pregunta sin ayuda sí cuenta) → recovery (asistencia+refresh
//   en la V1 no resuelve, V2 independiente sí resuelve) → finalización SOLO
//   cuando el motor confirma isProgramComplete, nunca antes.
//
// OBJETIVO A (post-319a5bc): el chat ya no se renderiza durante evaluación
// ni reevaluación independiente (isIndependentEvaluationActive en
// page.tsx), así que dejó de ser alcanzable vía UI en las dos preguntas de
// este escenario que están activas en esos estados (q-shared-assisted y la
// V1 de recovery) — se usa la pista (Ver pista) en su lugar para disparar
// "asistido", con aserciones explícitas de que el chat no existe en el DOM
// en esos puntos. El chat solo se usa donde sigue siendo legítimo (fuera de
// este escenario concreto; ver tests/e2e/alai-chat-visibility.spec.ts para
// la cobertura dedicada de dónde el chat debe/no debe existir).

const temaId = 'e2e-f1-integrated-tema'
const sessionId = 'e2e-f1-integrated-session'
const sharedStepId = 'node-integrated-shared'
const sharedFactKey = 'fk-integrated-shared'
const baseFactKey = 'fk-integrated-base'
const failFactKey = 'fk-integrated-fail'

function mcq(id: string, stepId: string, factKey: string, targetObjectiveIds: string[], keyPoint: string, correctId: string): CanonicalQuestion {
  return {
    id, conceptId: stepId, conceptLabel: keyPoint, teachingBlockId: stepId,
    questionFamily: 'mcq_best_answer', variant: 'mcq_best_answer', difficulty: 'medium',
    targetDimension: 'comprehension', questionText: `Pregunta ${id}.`,
    explanation: 'Explicación.', hint: '',
    estimatedSeconds: 30, evidencesNeeded: 1, factKey, factKeys: [factKey],
    targetObjectiveIds, evidenceProduced: targetObjectiveIds, coveredStepIds: [stepId], coveredKeyPoints: [keyPoint],
    format: 'multiple_choice', options: [{ id: correctId, text: 'Opción correcta' }, { id: correctId === 'a' ? 'b' : 'a', text: 'Opción incorrecta' }],
    correctAnswer: correctId,
  } as CanonicalQuestion
}

function trueFalse(id: string, stepId: string, factKey: string, targetObjectiveIds: string[], keyPoint: string) {
  return {
    id, conceptId: stepId, conceptLabel: keyPoint, teachingBlockId: stepId,
    questionFamily: id, variant: 'true_false_factual', difficulty: 'easy',
    targetDimension: 'comprehension', format: 'true_false',
    questionText: `${keyPoint} forma parte del contenido enseñado.`, options: null,
    correctAnswer: true, explanation: 'Coincide con el contenido.', hint: 'Usa el contenido visible.',
    estimatedSeconds: 15, evidencesNeeded: 1, factKey, factKeys: [factKey],
    targetObjectiveIds, evidenceProduced: targetObjectiveIds,
    coveredStepIds: [stepId], coveredKeyPoints: [keyPoint],
  }
}

async function readAssessmentBlueprint(page: Page) {
  return page.evaluate(({ sessionId }) => {
    const raw = localStorage.getItem('studyal_adaptive_artifacts_v1')
    if (!raw) return null
    const artifacts = JSON.parse(raw)
    const sessionContent = artifacts?.[sessionId]?.sessionContent
    const key = Object.keys(sessionContent || {})[0]
    return sessionContent?.[key]?.assessmentBlueprint ?? null
  }, { sessionId })
}

async function readRecoveryQueue(page: Page) {
  return page.evaluate(({ sessionId }) => {
    const raw = localStorage.getItem('studyal_sessions_v4')
    if (!raw) return null
    const sessions = JSON.parse(raw)
    return sessions?.[sessionId]?.recoveryQueues?.['2'] ?? null
  }, { sessionId })
}

async function installIntegratedSession(page: Page) {
  const sharedKeyPoint = 'Concepto integrado: parte compartida'
  const baseKeyPoint = 'Concepto integrado: base'
  const failKeyPoint = 'Concepto integrado: punto que falla'

  // Un único step de enseñanza (calcado del patrón probado en
  // session-completion-edge-cases.spec.ts): coveredStepIds debe apuntar
  // exclusivamente a steps realmente declarados en `steps`, o la navegación
  // post-recovery puede desviarse a un step "fantasma".
  const assessment = buildAssessmentBlueprint(
    [{ id: sharedStepId, title: 'Concepto integrado', content: 'Contenido del concepto integrado.', keyPoints: [sharedKeyPoint, baseKeyPoint, failKeyPoint], factKeys: [sharedFactKey, baseFactKey, failFactKey], importance: 0.8 }],
    'chapter-f1-integrated', 1,
  )
  const sharedObjectiveId = assessment.objectives.find(o => o.factKeys.includes(sharedFactKey))!.objectiveId
  const baseObjectiveId = assessment.objectives.find(o => o.factKeys.includes(baseFactKey))!.objectiveId
  const failObjectiveId = assessment.objectives.find(o => o.factKeys.includes(failFactKey))!.objectiveId

  const qSharedAssisted = { ...mcq('q-shared-assisted', sharedStepId, sharedFactKey, [sharedObjectiveId], sharedKeyPoint, 'a'), hint: 'Pista visible para q-shared-assisted.' }
  const qSharedIndependent = mcq('q-shared-independent', sharedStepId, sharedFactKey, [sharedObjectiveId], sharedKeyPoint, 'a')
  const qBase = trueFalse('q-base', sharedStepId, baseFactKey, [baseObjectiveId], baseKeyPoint)
  const qFail = trueFalse('q-fail', sharedStepId, failFactKey, [failObjectiveId], failKeyPoint)

  const learning = {
    sessionId: 'chapter-f1-integrated', sessionTitle: 'Concepto integrado — aprendizaje', sessionNumber: 2,
    sessionKind: 'learning', materialType: 'general_conceptual', academicDomain: 'general_conceptual',
    sessionIntro: 'Aprendizaje del concepto integrado.',
    steps: [{ id: sharedStepId, type: 'concept', title: 'Concepto integrado', content: 'Explicación del concepto integrado.', keyPoints: [sharedKeyPoint, baseKeyPoint, failKeyPoint], importance: 'critical', relatedBlockIds: ['block-real'] }],
    sessionClosing: 'Integración terminada.', totalSteps: 1, assessmentBlueprint: assessment,
    evaluationBlocks: [{ id: 'block-real', afterStepId: sharedStepId, coveredStepIds: [sharedStepId], coveredKeyPoints: [sharedKeyPoint, baseKeyPoint, failKeyPoint], questions: [qSharedAssisted, qSharedIndependent, qBase, qFail] }],
    evaluationProgress: {}, recoveryQueue: [],
  }

  const counters = { reteach: 0, completionPersisted: 0 }
  await page.route('**/api/study-sessions**', route =>
    route.fulfill({ json: route.request().method() === 'GET' ? { success: true, sessions: [] } : { success: true } }))
  await page.route('**/api/adaptive/session-teach', route => route.fulfill({ json: { success: true, classContent: learning } }))
  await page.route('**/api/adaptive/session-check', route => {
    const body = route.request().postDataJSON()
    const correct = body.answer === body.question.correctAnswer
    return route.fulfill({ json: { success: true, result: { outcome: correct ? 'correct' : 'incorrect', correct, score: correct ? 100 : 0, feedback: correct ? 'Respuesta correcta.' : 'Respuesta incorrecta.', errorType: correct ? null : 'conceptual' } } })
  })
  await page.route('**/api/adaptive/session-chat', route => {
    const body = route.request().postDataJSON()
    return route.fulfill({ json: { success: true, reply: `ALAI responde: "${body.message}"`, references: [], usedExternalKnowledge: false } })
  })
  await page.route('**/api/adaptive/session-reteach', route => {
    counters.reteach += 1
    const body = route.request().postDataJSON()
    const round = counters.reteach
    const sourceFactKey = body.target.sourceFactKeys?.[0] || failFactKey
    const recoveryQuestion = (n: number) => ({
      id: `recovery-${round}-${n}`, conceptId: sharedStepId, conceptLabel: failKeyPoint, teachingBlockId: sharedStepId,
      questionFamily: `deterministic_recovery_${round}_${n}`, variant: 'mcq_best_answer', difficulty: 'easy',
      targetDimension: 'comprehension', format: 'multiple_choice',
      questionText: `Ronda ${round}: verificación ${n}.`,
      options: [{ id: 'a', text: 'Aplicación alineada' }, { id: 'b', text: 'Aplicación incompatible' }], correctAnswer: 'a',
      explanation: 'Explicación.', hint: 'Pista.',
      estimatedSeconds: 30, evidencesNeeded: 1, factKey: sourceFactKey, factKeys: body.target.sourceFactKeys || [sourceFactKey],
      targetObjectiveIds: [failObjectiveId], evidenceProduced: [failObjectiveId],
      coveredStepIds: [sharedStepId], coveredKeyPoints: body.target.sourceKeyPoints || [failKeyPoint],
      coveredKeyPointIds: body.target.sourceKeyPointIds,
    })
    return route.fulfill({ json: {
      success: true, recoveryId: body.recoveryId, recoveryTargetId: body.recoveryTargetId,
      roundId: body.roundId, roundNumber: round,
      explanation: `**Reexplicación ronda ${round}.**`,
      questions: [recoveryQuestion(1), recoveryQuestion(2)], target: body.target,
      provider: 'openrouter', model: 'google/gemini-2.5-flash', generationKey: body.generationKey, preparedAt: Date.now(),
    } })
  })
  await page.addInitScript(({ sessionId, temaId, learning }) => {
    const existingSessions = JSON.parse(localStorage.getItem('studyal_sessions_v4') || '{}')
    if (existingSessions[sessionId]) return
    const journey = { id: 'journey_f1_integrated_e2e', version: 4, chapters: [{ id: 'chapter-f1-integrated', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['block-real'], unitIds: ['unit-real'] }], totalChapters: 1 }
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['material-f1-integrated'], primaryMaterialId: 'material-f1-integrated', materialNames: ['Concepto integrado'],
      selectedPages: {}, adaptiveSetup: { knowledgeLevel: 'want_review', examDateType: 'just_studying', targetScore: 80, evalPreference: 'quick_test', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, academicDomain: 'general', blocks: [{ id: 'block-real' }], topics: [] },
      journey, currentSessionNumber: 2, currentStep: 0, completedSessionNumbers: [], status: 'in_progress', adaptiveState: 'studying',
      isProgramComplete: false, unresolvedMicroIds: [], sessionContent: { '2': learning }, recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId, learning })

  return { counters }
}

test('escenario integrado: enseñanza → assessment asistida+refresh → independiente → recovery asistida+refresh → recovery independiente → finalización solo confirmada por el motor', async ({ page }) => {
  const events: string[] = []
  page.on('console', message => events.push(message.text()))

  await installIntegratedSession(page)
  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Paso 1 de 1')).toBeVisible()
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()

  // ── ASSESSMENT: pregunta 1, ayuda vía pista (OBJETIVO A: el chat ya no
  // existe en el DOM durante evaluación), refresh ANTES de responder ──
  await expect(page.getByText('Pregunta q-shared-assisted')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Preguntar a ALAI' }), 'OBJETIVO A: el chat no debe existir durante evaluación').toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Chat con ALAI' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Ver pista' }).click()
  await expect(page.getByText('Pista visible para q-shared-assisted.')).toBeVisible()

  await page.reload()
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await expect(page.getByText('Pregunta q-shared-assisted')).toBeVisible()
  await page.getByRole('button', { name: 'Opción correcta' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await expect(page.getByText('✅ ¡Correcto!')).toBeVisible()

  const afterAssisted = await readAssessmentBlueprint(page)
  const sharedObjectiveAfterAssisted = afterAssisted.objectives.find((o: any) => o.factKeys.includes(sharedFactKey))
  expect(sharedObjectiveAfterAssisted.demonstratedFactKeys, 'asistencia (pista)+refresh en assessment NO debe contar como independiente').not.toContain(sharedFactKey)

  // ── ASSESSMENT: pregunta 2, MISMO factKey, SIN ayuda → debe demostrar independientemente ──
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await expect(page.getByText('Pregunta q-shared-independent')).toBeVisible()
  await page.getByRole('button', { name: 'Opción correcta' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await expect(page.getByText('✅ ¡Correcto!')).toBeVisible()

  const afterIndependent = await readAssessmentBlueprint(page)
  const sharedObjectiveAfterIndependent = afterIndependent.objectives.find((o: any) => o.factKeys.includes(sharedFactKey))
  expect(sharedObjectiveAfterIndependent.demonstratedFactKeys, 'sin ayuda, la siguiente pregunta SÍ debe demostrar el factKey — la asistencia previa no debe contaminarla').toContain(sharedFactKey)

  // ── q-base: correcta, sin incidentes, para llegar a q-fail (dispara recovery) ──
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await expect(page.getByText('base forma parte del contenido enseñado.')).toBeVisible()
  await page.getByRole('button', { name: 'Verdadero' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await expect(page.getByText('✅ ¡Correcto!')).toBeVisible()
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()

  // ── q-fail: se falla deliberadamente para disparar recovery ──
  await expect(page.getByText('punto que falla forma parte del contenido enseñado.')).toBeVisible()
  await page.getByRole('button', { name: 'Falso' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.getByRole('button', { name: 'Revisar conceptos →' }).click()
  await expect(page.getByText('📖 Reexplicación')).toBeVisible()

  // ── RECOVERY ronda 1 (V1): ayuda vía pista (OBJETIVO A: el chat ya no
  // existe en el DOM durante una reevaluación independiente), refresh ANTES
  // de responder ──
  await page.getByRole('button', { name: 'Verificar comprensión →' }).click()
  await expect(page.getByText('Ronda 1: verificación 1.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Preguntar a ALAI' }), 'OBJETIVO A: el chat no debe existir durante una verificación de recovery').toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Chat con ALAI' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Ver pista' }).click()
  await expect(page.getByText('Pista.')).toBeVisible()

  const queueBeforeRefresh = await readRecoveryQueue(page)
  const successfulBeforeRefresh = queueBeforeRefresh?.[0]?.successfulIndependentChecks ?? 0

  await page.reload()
  await expect(page.getByText('Ronda 1: verificación 1.')).toBeVisible()
  await page.getByRole('button', { name: 'Aplicación alineada' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.waitForTimeout(500)

  const queueAfterAssistedRound = await readRecoveryQueue(page)
  const successfulAfterAssistedRound = queueAfterAssistedRound?.[0]?.successfulIndependentChecks ?? 0
  expect(successfulAfterAssistedRound, 'asistencia (pista)+refresh en recovery NO debe incrementar successfulIndependentChecks').toBe(successfulBeforeRefresh)
  expect(queueAfterAssistedRound?.[0]?.status, 'la recovery no debe resolverse por una verificación assisted').not.toBe('resolved')

  // ── RECOVERY V2 (misma ronda, segunda verificación): sin ayuda → SÍ debe contar como independiente ──
  await page.getByRole('button', { name: 'Continuar recuperación →' }).click()
  await expect(page.getByText('Ronda 1: verificación 2.')).toBeVisible()
  await page.getByRole('button', { name: 'Aplicación alineada' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.waitForTimeout(500)

  const queueAfterMixedRound = await readRecoveryQueue(page)
  const successfulAfterMixedRound = queueAfterMixedRound?.[0]?.successfulIndependentChecks ?? 0
  expect(successfulAfterMixedRound, 'sin ayuda, la verificación SÍ debe contar como independiente').toBeGreaterThan(successfulAfterAssistedRound)
  // V1 de esta ronda estuvo contaminada por assisted: aunque V2 sea
  // independiente, la ronda completa NO puede resolver la recovery — exige
  // una ronda genuinamente nueva con AMBAS verificaciones independientes.
  // Este es precisamente el comportamiento "false mastery = 0" que Finding 1
  // debía garantizar: la ayuda nunca compra una resolución de recovery.
  expect(queueAfterMixedRound?.[0]?.status, 'una ronda con V1 assisted (aunque V2 sea independiente) NO debe resolver la recovery').not.toBe('resolved')

  // ── RECOVERY ronda 2 (nueva, generada tras la ronda mixta): AMBAS verificaciones sin ayuda ──
  await page.getByRole('button', { name: 'Revisar de nuevo →' }).click()
  await expect(page.getByText('📖 Reexplicación')).toBeVisible()
  await page.getByRole('button', { name: 'Verificar comprensión →' }).click()
  await expect(page.getByText('Ronda 2: verificación 1.')).toBeVisible()
  await page.getByRole('button', { name: 'Aplicación alineada' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.getByRole('button', { name: 'Continuar recuperación →' }).click()
  await expect(page.getByText('Ronda 2: verificación 2.')).toBeVisible()
  await page.getByRole('button', { name: 'Aplicación alineada' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.waitForTimeout(500)

  const queueAfterCleanRound = await readRecoveryQueue(page)
  expect(queueAfterCleanRound?.[0]?.status, 'con una ronda completa de verificaciones independientes, la recovery debe resolverse').toBe('resolved')

  // ── Finalización SOLO cuando el motor confirma — nunca antes de que el
  // usuario complete la navegación explícita, y nunca por el simple hecho de
  // haber demostrado 3/3 objetivos (eso YA era cierto un paso atrás y la
  // sesión seguía sin "Sesión completada" visible). Se avanza por los
  // "Continuar →" intermedios (revisión de contenido) hasta llegar al gate
  // final, que puede ser un botón explícito "🎉 Terminar" o, si no aparece,
  // la propia pantalla de "Sesión completada" ya renderizada.
  await expect(page.getByText('Sesión completada')).toHaveCount(0)
  events.length = 0

  for (let i = 0; i < 5; i += 1) {
    if (await page.getByText('Sesión completada').isVisible()) break
    const terminar = page.getByRole('button', { name: '🎉 Terminar' })
    if (await terminar.isVisible()) {
      await terminar.click()
      break
    }
    const continuar = page.getByRole('button', { name: 'Continuar →' })
    await expect(continuar).toBeVisible()
    await continuar.click()
  }

  await expect(page.getByText('Sesión completada')).toBeVisible()
  expect(events.filter(line => line.includes('session_completion_persisted'))).toHaveLength(1)

  const finalSessions = await page.evaluate(({ sessionId }) => {
    const raw = localStorage.getItem('studyal_sessions_v4')
    if (!raw) return null
    return JSON.parse(raw)?.[sessionId] ?? null
  }, { sessionId })
  expect(finalSessions?.isProgramComplete, 'la finalización solo debe reflejarse tras la confirmación explícita del motor').toBe(true)
})
