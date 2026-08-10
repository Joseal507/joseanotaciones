import { expect, test, type Page } from '@playwright/test'
import { buildAssessmentBlueprint } from '../../lib/adaptive/evaluation/assessmentBlueprint'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'

// AUDITORÍA ADVERSARIAL (post-7a3c3f7, Finding 1 CONFIRMADO): hintShownRef y
// chatAssistedRef eran refs efímeros en memoria — un refresh a mitad de una
// pregunta/verificación ya asistida los reseteaba a false SIN resetear la
// pregunta en sí (el bloque/recovery persistido re-presenta la MISMA
// pregunta), permitiendo que una respuesta correcta posterior al refresh
// contara como independent:true. Fix: la asistencia se persiste por
// identidad de intento (questionId, o recoveryId+ronda en recovery) y solo
// se restaura si coincide exactamente con el intento reactivado.
//
// FASE B — items 1, 2, 3 del reporte de regresión obligatorio:
//   1. assessment chat -> academic help -> refresh -> correct => assisted, NO demonstrated factKey
//   2. recovery chat -> academic help -> refresh -> correct => NO successfulIndependentCheck
//   3. assistance no se filtra a la pregunta siguiente
//
// OBJETIVO A (post-319a5bc): el chat ya no se renderiza durante evaluación
// ni reevaluación independiente (ver isIndependentEvaluationActive en
// page.tsx) — dejó de ser alcanzable vía UI exactamente en los puntos donde
// estos dos tests lo usaban para disparar "asistido". Se reemplaza por la
// pista (Ver pista), la única vía de asistencia que SIGUE disponible ahí,
// preservando exactamente las mismas aserciones sobre persistencia por
// intento — el mecanismo probado (persistPendingAssistance/
// restoredAssistanceRef) es el mismo para ambas fuentes de asistencia. Cada
// test añade además una aserción explícita de que el chat no existe en el
// DOM en ese punto, cubriendo así también el propio OBJETIVO A.

const temaId = 'e2e-f1-refresh-tema'
const sessionId = 'e2e-f1-refresh-session'
const stepId = 'node-f1-refresh'
const sharedFactKey = 'fact-f1-refresh-shared'
const keyPoints = [sharedFactKey]

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

function question(id: string, factKey: string, targetObjectiveIds: string[], correctId: string, format: 'multiple_choice' = 'multiple_choice', hint = ''): CanonicalQuestion {
  return {
    id, conceptId: stepId, conceptLabel: 'Concepto compartido', teachingBlockId: stepId,
    questionFamily: 'mcq_best_answer', variant: 'mcq_best_answer', difficulty: 'medium',
    targetDimension: 'comprehension', questionText: `Pregunta ${id}.`,
    explanation: 'Explicación.', hint,
    estimatedSeconds: 30, evidencesNeeded: 1, factKey, factKeys: [factKey],
    targetObjectiveIds, evidenceProduced: targetObjectiveIds, coveredStepIds: [stepId], coveredKeyPoints: keyPoints,
    format, options: [{ id: correctId, text: 'Opción correcta' }, { id: correctId === 'a' ? 'b' : 'a', text: 'Opción incorrecta' }],
    correctAnswer: correctId,
  } as CanonicalQuestion
}

async function installAssessmentRefreshSession(page: Page) {
  const assessment = buildAssessmentBlueprint(
    [{ id: stepId, title: 'Concepto compartido', content: 'Contenido del concepto compartido.', keyPoints, factKeys: keyPoints, importance: 0.8 }],
    'chapter-f1-refresh', 2,
  )
  const objectiveIds = assessment.objectives.map(o => o.objectiveId)

  // q1 necesita hint no vacío: OBJETIVO A quita el chat del DOM durante
  // evaluación, así que la pista es la única vía de asistencia alcanzable
  // vía UI para reproducir "asistido + refresh no cuenta como independiente".
  const q1 = question('q-f1-assisted', sharedFactKey, objectiveIds, 'a', 'multiple_choice', 'Pista visible para q-f1-assisted.')
  const q2 = question('q-f1-independent', sharedFactKey, objectiveIds, 'a')

  const learning = {
    sessionId: 'chapter-f1-refresh', sessionTitle: 'Concepto compartido — aprendizaje', sessionNumber: 2,
    sessionKind: 'learning', materialType: 'general', academicDomain: 'general',
    sessionIntro: 'Aprendizaje del concepto compartido.',
    steps: [{ id: stepId, type: 'concept', title: 'Concepto compartido', content: 'Explicación del concepto compartido.', keyPoints, importance: 'critical', relatedBlockIds: ['block-real'] }],
    sessionClosing: 'Integración terminada.', totalSteps: 1, assessmentBlueprint: assessment,
    evaluationBlocks: [{ id: 'block-real', afterStepId: stepId, coveredStepIds: [stepId], coveredKeyPoints: keyPoints, questions: [q1, q2] }],
    evaluationProgress: {}, recoveryQueue: [],
  }

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
  await page.addInitScript(({ sessionId, temaId, learning }) => {
    const existingSessions = JSON.parse(localStorage.getItem('studyal_sessions_v4') || '{}')
    if (existingSessions[sessionId]) return
    const journey = { id: 'journey_f1_refresh_e2e', version: 4, chapters: [{ id: 'chapter-f1-refresh', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['block-real'], unitIds: ['unit-real'] }], totalChapters: 1 }
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['material-f1-refresh'], primaryMaterialId: 'material-f1-refresh', materialNames: ['Concepto compartido'],
      selectedPages: {}, adaptiveSetup: { knowledgeLevel: 'want_review', examDateType: 'just_studying', targetScore: 80, evalPreference: 'mix_everything', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, academicDomain: 'general', blocks: [{ id: 'block-real' }], topics: [] },
      journey, currentSessionNumber: 2, currentStep: 0, completedSessionNumbers: [], status: 'in_progress', adaptiveState: 'studying',
      isProgramComplete: false, unresolvedMicroIds: [], sessionContent: { '2': learning }, recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId, learning })
}

test('item 1 y 3 — assessment: chat + refresh antes de responder no cuenta como independiente, y no contamina la siguiente pregunta', async ({ page }) => {
  await installAssessmentRefreshSession(page)
  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Paso 1 de 1')).toBeVisible()
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await expect(page.getByText('Pregunta q-f1-assisted')).toBeVisible()

  // OBJETIVO A (post-319a5bc): el chat ya no existe en el DOM durante una
  // pregunta de evaluación — se verifica explícitamente, y se usa la pista
  // (única vía de asistencia alcanzable aquí) para reproducir el mismo
  // invariante de persistencia por intento que antes se probaba con chat.
  await expect(page.getByRole('button', { name: 'Preguntar a ALAI' }), 'OBJETIVO A: el chat no debe existir durante evaluación').toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Chat con ALAI' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Ver pista' }).click()
  await expect(page.getByText('Pista visible para q-f1-assisted.')).toBeVisible()

  // REFRESH antes de responder — hintShownRef (en memoria) se pierde, pero
  // el registro persistido debe sobrevivir y aplicarse al restaurar.
  await page.reload()
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await expect(page.getByText('Pregunta q-f1-assisted')).toBeVisible()

  await page.getByRole('button', { name: 'Opción correcta' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await expect(page.getByText('✅ ¡Correcto!')).toBeVisible()

  const afterAssisted = await readAssessmentBlueprint(page)
  const objective = afterAssisted.objectives.find((o: any) => o.factKeys.includes(sharedFactKey))
  expect(objective.demonstratedFactKeys, 'ITEM 1 — BUG DE ORIGEN SI FALLA: chat + refresh antes de responder NO debe contar como independiente').not.toContain(sharedFactKey)

  // ITEM 3: la siguiente pregunta (misma factKey, SIN ningún uso de chat/hint)
  // debe demostrar el factKey normalmente — la asistencia de Q1 no debe
  // haberse filtrado a Q2.
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await expect(page.getByText('Pregunta q-f1-independent')).toBeVisible()
  await page.getByRole('button', { name: 'Opción correcta' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await expect(page.getByText('✅ ¡Correcto!')).toBeVisible()

  const afterIndependent = await readAssessmentBlueprint(page)
  const objectiveAfter = afterIndependent.objectives.find((o: any) => o.factKeys.includes(sharedFactKey))
  expect(objectiveAfter.demonstratedFactKeys, 'ITEM 3 — BUG DE ORIGEN SI FALLA: la asistencia de la pregunta anterior no debe contaminar esta pregunta, sin chat/hint debe demostrar el factKey').toContain(sharedFactKey)
})

// ═══ Item 2: recovery + chat + refresh ═══
// Estructura del bloque calcada de session-completion-edge-cases.spec.ts
// (probada y funcionando): una pregunta true_false que se responde correcta
// PRIMERO (q-correct) y otra que se falla deliberadamente (q-fail) para
// disparar recovery — un bloque de una sola pregunta no dispara el flujo de
// reteach inline de la misma forma.
function trueFalseQuestion(id: string, tfStepId: string, objectiveId: string, keyPoint: string) {
  return {
    id, conceptId: tfStepId, conceptLabel: keyPoint, teachingBlockId: tfStepId,
    questionFamily: id, variant: 'true_false_factual', difficulty: 'easy',
    targetDimension: 'comprehension', format: 'true_false',
    questionText: `${keyPoint} forma parte del contenido enseñado.`, options: null,
    correctAnswer: true, explanation: 'Coincide con el contenido.', hint: 'Usa el contenido visible.',
    estimatedSeconds: 15, evidencesNeeded: 1, factKey: `${tfStepId}:${id}`, factKeys: [`${tfStepId}:${id}`],
    targetObjectiveIds: [objectiveId], evidenceProduced: [objectiveId],
    coveredStepIds: [tfStepId], coveredKeyPoints: [keyPoint],
  }
}

async function installRecoveryRefreshSession(page: Page) {
  const title = 'Concepto de prueba'
  const recoveryKeyPoints = [`${title}: punto 1`, `${title}: punto 2`]
  const assessment = buildAssessmentBlueprint(
    [{ id: stepId, title, content: `Contenido persistido de ${title}.`, keyPoints: recoveryKeyPoints, factKeys: [`${stepId}:q-correct`, `${stepId}:q-fail`], importance: 0.8 }],
    'chapter-f1-recovery', 1,
  )
  const objectiveIds = assessment.objectives.map(o => o.objectiveId)
  const questions = [
    trueFalseQuestion('q-correct', stepId, objectiveIds[0], recoveryKeyPoints[0]),
    trueFalseQuestion('q-fail', stepId, objectiveIds[1], recoveryKeyPoints[1]),
  ]
  const failFactKey = `${stepId}:q-fail`
  const failObjectiveId = objectiveIds[1]

  const learning = {
    sessionId: 'chapter-f1-recovery', sessionTitle: `${title} — aprendizaje`, sessionNumber: 2,
    sessionKind: 'learning', materialType: 'general_conceptual', academicDomain: 'general_conceptual',
    sessionIntro: `Aprendizaje de ${title}.`,
    steps: [{ id: stepId, type: 'concept', title, content: `Explicación verificable de ${title}.`, keyPoints: recoveryKeyPoints, importance: 'critical', relatedBlockIds: ['block-real'] }],
    sessionClosing: 'Integración terminada.', totalSteps: 1, assessmentBlueprint: assessment,
    evaluationBlocks: [{ id: 'block-real', afterStepId: stepId, coveredStepIds: [stepId], coveredKeyPoints: recoveryKeyPoints, questions }],
    evaluationProgress: {}, recoveryQueue: [],
  }

  const counters = { reteach: 0 }
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
      id: `recovery-${round}-${n}`, conceptId: stepId, conceptLabel: recoveryKeyPoints[1], teachingBlockId: stepId,
      questionFamily: `deterministic_recovery_${round}_${n}`, variant: 'mcq_best_answer', difficulty: 'easy',
      targetDimension: 'comprehension', format: 'multiple_choice',
      questionText: `Ronda ${round}: verificación ${n}.`,
      options: [{ id: 'a', text: 'Aplicación alineada' }, { id: 'b', text: 'Aplicación incompatible' }], correctAnswer: 'a',
      explanation: 'Explicación.', hint: 'Pista.',
      estimatedSeconds: 30, evidencesNeeded: 1, factKey: sourceFactKey, factKeys: body.target.sourceFactKeys || [sourceFactKey],
      targetObjectiveIds: [failObjectiveId], evidenceProduced: [failObjectiveId],
      coveredStepIds: [stepId], coveredKeyPoints: body.target.sourceKeyPoints || [recoveryKeyPoints[1]],
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
    const journey = { id: 'journey_f1_recovery_e2e', version: 4, chapters: [{ id: 'chapter-f1-recovery', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['block-real'], unitIds: ['unit-real'] }], totalChapters: 1 }
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['material-f1-recovery'], primaryMaterialId: 'material-f1-recovery', materialNames: ['Concepto compartido'],
      selectedPages: {}, adaptiveSetup: { knowledgeLevel: 'want_review', examDateType: 'just_studying', targetScore: 80, evalPreference: 'quick_test', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, academicDomain: 'general', blocks: [{ id: 'block-real' }], topics: [] },
      journey, currentSessionNumber: 2, currentStep: 0, completedSessionNumbers: [], status: 'in_progress', adaptiveState: 'studying',
      isProgramComplete: false, unresolvedMicroIds: [], sessionContent: { '2': learning }, recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId, learning })
}

test('item 2 — recovery: chat + refresh antes de responder no resuelve la verificación como independiente', async ({ page }) => {
  await installRecoveryRefreshSession(page)
  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Paso 1 de 1')).toBeVisible()
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()

  // q-correct primero, respondida correctamente (true_false).
  await expect(page.getByText('punto 1 forma parte del contenido enseñado.')).toBeVisible()
  await page.getByRole('button', { name: 'Verdadero' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await expect(page.getByText('✅ ¡Correcto!')).toBeVisible()
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()

  // q-fail: fallar deliberadamente para disparar recovery.
  await expect(page.getByText('punto 2 forma parte del contenido enseñado.')).toBeVisible()
  await page.getByRole('button', { name: 'Falso' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.getByRole('button', { name: 'Revisar conceptos →' }).click()
  await expect(page.getByText('📖 Reexplicación')).toBeVisible()
  await page.getByRole('button', { name: 'Verificar comprensión →' }).click()
  await expect(page.getByText('Ronda 1: verificación 1.')).toBeVisible()

  // OBJETIVO A (post-319a5bc): el chat ya no existe en el DOM durante una
  // verificación de recovery activa (reevaluación independiente) — se
  // verifica explícitamente, y se usa la pista (ya declarada en el fixture,
  // 'Pista.') como única vía de asistencia alcanzable aquí.
  await expect(page.getByRole('button', { name: 'Preguntar a ALAI' }), 'OBJETIVO A: el chat no debe existir durante una verificación de recovery').toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Chat con ALAI' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Ver pista' }).click()
  await expect(page.getByText('Pista.')).toBeVisible()

  const queueBeforeRefresh = await readRecoveryQueue(page)
  const successfulBefore = queueBeforeRefresh?.[0]?.successfulIndependentChecks ?? 0

  await page.reload()
  await expect(page.getByText('Ronda 1: verificación 1.')).toBeVisible()

  await page.getByRole('button', { name: 'Aplicación alineada' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()

  await page.waitForTimeout(500)
  const queueAfter = await readRecoveryQueue(page)
  const successfulAfter = queueAfter?.[0]?.successfulIndependentChecks ?? 0
  expect(successfulAfter, 'ITEM 2 — BUG DE ORIGEN SI FALLA: chat + refresh antes de responder NO debe incrementar successfulIndependentChecks').toBe(successfulBefore)
  expect(queueAfter?.[0]?.status, 'la recovery no debe resolverse por una verificación assisted').not.toBe('resolved')
})
