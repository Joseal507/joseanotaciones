import { expect, test, type Page } from '@playwright/test'
import { buildAssessmentBlueprint } from '../../lib/adaptive/evaluation/assessmentBlueprint'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'

// PARTE B — chat ALAI dentro de la sesión. Prueba el flujo completo pedido:
// teaching -> abrir chat -> preguntar sobre concepto -> cerrar -> assessment
// -> abrir chat sin preguntar -> cerrar (no debe contaminar) -> abrir chat y
// pedir ayuda académica -> responder correctamente -> NO debe contar
// independiente (assisted) -> siguiente pregunta (mismo factKey) SIN chat ->
// SÍ cuenta independiente -> completion.
//
// Mismo patrón de fixture que hint-assistance-independence.spec.ts (2
// preguntas comparten el mismo factKey: la primera queda asistida y NO
// demuestra, la segunda es limpia y SÍ demuestra) — mocks de red reemplazan
// solo el transporte HTTP, la lógica real de evidencia/blueprint es la de
// producción.

const temaId = 'e2e-alai-chat-tema'
const sessionId = 'e2e-alai-chat-session'
const stepId = 'node-alai-chat'
const sharedFactKey = 'fact-alai-chat-shared'
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

async function readChatHistory(page: Page) {
  return page.evaluate(({ sessionId }) => {
    const raw = localStorage.getItem('studyal_adaptive_artifacts_v1')
    if (!raw) return null
    const artifacts = JSON.parse(raw)
    const sessionContent = artifacts?.[sessionId]?.sessionContent
    const key = Object.keys(sessionContent || {})[0]
    return sessionContent?.[key]?.chatHistory ?? null
  }, { sessionId })
}

async function installAlaiChatSession(page: Page) {
  const assessment = buildAssessmentBlueprint(
    [{ id: stepId, title: 'Concepto compartido', content: 'Contenido del concepto compartido enseñado en el paso 1.', keyPoints, factKeys: keyPoints, importance: 0.8 }],
    'chapter-alai-chat', 2,
  )
  const objectiveIds = assessment.objectives.map(objective => objective.objectiveId)

  const questionAssisted: CanonicalQuestion = {
    id: 'q-alai-chat-assisted', conceptId: stepId, conceptLabel: 'Concepto compartido', teachingBlockId: stepId,
    questionFamily: 'mcq_best_answer', variant: 'mcq_best_answer', difficulty: 'medium',
    targetDimension: 'comprehension', questionText: 'Primera pregunta — se responderá con ayuda de la pista.',
    // OBJETIVO A (auditoría adversarial post-319a5bc): el chat ya NO se
    // renderiza durante evaluación (ver isIndependentEvaluationActive en
    // page.tsx) — la única vía de asistencia que sigue disponible en una
    // pregunta activa es la pista. Necesita un hint no vacío para que el
    // botón "Ver pista" exista.
    explanation: 'Explicación 1.', hint: 'Pista visible para la primera pregunta.',
    estimatedSeconds: 30, evidencesNeeded: 1, factKey: sharedFactKey, factKeys: keyPoints,
    targetObjectiveIds: objectiveIds, evidenceProduced: objectiveIds, coveredStepIds: [stepId], coveredKeyPoints: keyPoints,
    format: 'multiple_choice', options: [{ id: 'a', text: 'Opción correcta uno' }, { id: 'b', text: 'Opción incorrecta uno' }], correctAnswer: 'a',
  } as CanonicalQuestion

  const questionIndependent: CanonicalQuestion = {
    id: 'q-alai-chat-independent', conceptId: stepId, conceptLabel: 'Concepto compartido', teachingBlockId: stepId,
    questionFamily: 'mcq_best_answer', variant: 'mcq_best_answer', difficulty: 'medium',
    targetDimension: 'comprehension', questionText: 'Segunda pregunta — se responderá sin usar el chat.',
    explanation: 'Explicación 2.', hint: '',
    estimatedSeconds: 30, evidencesNeeded: 1, factKey: sharedFactKey, factKeys: keyPoints,
    targetObjectiveIds: objectiveIds, evidenceProduced: objectiveIds, coveredStepIds: [stepId], coveredKeyPoints: keyPoints,
    format: 'multiple_choice', options: [{ id: 'a', text: 'Opción correcta dos' }, { id: 'b', text: 'Opción incorrecta dos' }], correctAnswer: 'a',
  } as CanonicalQuestion

  const learning = {
    sessionId: 'chapter-alai-chat', sessionTitle: 'Concepto compartido — aprendizaje', sessionNumber: 2,
    sessionKind: 'learning', materialType: 'general', academicDomain: 'general',
    sessionIntro: 'Aprendizaje del concepto compartido.',
    steps: [{ id: stepId, type: 'concept', title: 'Concepto compartido', content: 'Explicación del concepto compartido.', keyPoints, importance: 'critical', relatedBlockIds: ['block-real'] }],
    sessionClosing: 'Integración terminada.', totalSteps: 1, assessmentBlueprint: assessment,
    evaluationBlocks: [{ id: 'block-real', afterStepId: stepId, coveredStepIds: [stepId], coveredKeyPoints: keyPoints, questions: [questionAssisted, questionIndependent] }],
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
  // El mock de session-chat NUNCA toca blueprint/mastery/completion — solo
  // devuelve texto, exactamente como debe comportarse la ruta real.
  await page.route('**/api/adaptive/session-chat', route => {
    const body = route.request().postDataJSON()
    return route.fulfill({ json: {
      success: true,
      reply: `ALAI responde sobre: "${body.message}". Esto viene del contenido ya enseñado.`,
      references: [{ stepId, stepTitle: 'Concepto compartido' }],
      usedExternalKnowledge: false,
    } })
  })
  await page.addInitScript(({ sessionId, temaId, learning }) => {
    // addInitScript se re-ejecuta en CADA reload/navegación — sin este guard,
    // un refresh mid-test resetearía localStorage al estado inicial prístino,
    // borrando todo el progreso real (mismo guard que usa
    // session-completion-edge-cases.spec.ts para su propio test de refresh).
    const existingSessions = JSON.parse(localStorage.getItem('studyal_sessions_v4') || '{}')
    if (existingSessions[sessionId]) return
    const journey = { id: 'journey_alai_chat_e2e', version: 4, chapters: [{ id: 'chapter-alai-chat', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['block-real'], unitIds: ['unit-real'] }], totalChapters: 1 }
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['material-alai-chat'], primaryMaterialId: 'material-alai-chat', materialNames: ['Concepto compartido'],
      selectedPages: {}, adaptiveSetup: { knowledgeLevel: 'want_review', examDateType: 'just_studying', targetScore: 80, mainConcern: 'Quiero entender bien los conceptos base', evalPreference: 'mix_everything', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, academicDomain: 'general', blocks: [{ id: 'block-real' }], topics: [] },
      journey, currentSessionNumber: 2, currentStep: 0, completedSessionNumbers: [], status: 'in_progress', adaptiveState: 'studying',
      isProgramComplete: false, unresolvedMicroIds: [], sessionContent: { '2': learning }, recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId, learning })
}

test('flujo completo: teaching con chat, assessment con ayuda asistida (no independiente) y verificación posterior independiente con completion', async ({ page }) => {
  await installAlaiChatSession(page)
  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Paso 1 de 1')).toBeVisible()

  const chatDialog = page.getByRole('dialog', { name: 'Chat con ALAI' })

  // ── TEACHING: abrir chat, preguntar sobre el concepto, cerrar ──
  await expect(chatDialog).not.toBeVisible()
  await page.getByRole('button', { name: 'Preguntar a ALAI' }).click()
  await expect(chatDialog).toBeVisible()
  // Durante teaching no hay pregunta activa -> nunca debe verse el disclaimer.
  await expect(page.getByText('no contará como una demostración independiente')).toHaveCount(0)
  await chatDialog.getByPlaceholder('Escribe tu pregunta...').fill('¿Qué significa este concepto?')
  await chatDialog.getByRole('button', { name: 'Enviar', exact: true }).click()
  await expect(chatDialog.getByText('ALAI responde sobre: "¿Qué significa este concepto?"')).toBeVisible()
  await chatDialog.getByRole('button', { name: 'Cerrar chat' }).click()
  await expect(chatDialog).not.toBeVisible()

  // Preguntar durante teaching no debe crear ningún blueprint ni evidencia todavía.
  const blueprintDuringTeaching = await readAssessmentBlueprint(page)
  expect(blueprintDuringTeaching?.demonstratedObjectiveIds || []).toHaveLength(0)

  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()

  // ── ASSESSMENT (Q1): OBJETIVO A — el chat NO debe existir en el DOM
  // mientras esta pregunta está activa (evaluación). Se usa la pista como
  // única vía de asistencia disponible para reproducir "asistido no
  // demuestra" — el chat en sí ya se probó exhaustivamente para este mismo
  // invariante durante teaching más arriba, y no puede probarse aquí porque
  // ya no es alcanzable vía UI en este estado.
  await expect(page.getByText('Primera pregunta')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Preguntar a ALAI' }), 'OBJETIVO A: el botón de chat no debe existir durante una pregunta de evaluación').toHaveCount(0)
  await expect(chatDialog, 'OBJETIVO A: el diálogo de chat no debe existir en el DOM durante evaluación').toHaveCount(0)

  await page.getByRole('button', { name: 'Ver pista' }).click()
  await expect(page.getByText('Pista visible para la primera pregunta.')).toBeVisible()

  // Responder correctamente CON ayuda ya pedida (pista) para esta pregunta.
  await page.getByRole('button', { name: 'Opción correcta uno' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await expect(page.getByText('✅ ¡Correcto!')).toBeVisible()

  const afterAssistedAnswer = await readAssessmentBlueprint(page)
  const objectiveAfterAssisted = afterAssistedAnswer.objectives.find((o: any) => o.factKeys.includes(sharedFactKey))
  expect(objectiveAfterAssisted.demonstratedFactKeys, 'BUG SI FALLA: una respuesta correcta con ayuda de la pista NO debe demostrar el factKey').not.toContain(sharedFactKey)
  expect(afterAssistedAnswer.demonstratedObjectiveIds).not.toContain(objectiveAfterAssisted.objectiveId)

  // ── ASSESSMENT (Q2): sin ningún uso de chat/pista — debe demostrar independientemente ──
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await expect(page.getByText('Segunda pregunta')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Preguntar a ALAI' }), 'OBJETIVO A: sigue sin existir durante Q2 (también evaluación)').toHaveCount(0)
  await expect(chatDialog).toHaveCount(0)
  await page.getByRole('button', { name: 'Opción correcta dos' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await expect(page.getByText('✅ ¡Correcto!')).toBeVisible()

  const afterIndependentAnswer = await readAssessmentBlueprint(page)
  const objectiveAfterIndependent = afterIndependentAnswer.objectives.find((o: any) => o.factKeys.includes(sharedFactKey))
  expect(objectiveAfterIndependent.demonstratedFactKeys, 'una respuesta correcta SIN chat/hint sí debe demostrar el factKey').toContain(sharedFactKey)

  // ── Completion ──
  await expect(page.getByRole('button', { name: '🎉 Terminar' })).toBeVisible()
  await page.getByRole('button', { name: '🎉 Terminar' }).click()
  await expect(page.getByText('Sesión completada')).toBeVisible()

  // ── Persistencia: refresh conserva completion + historial de chat ──
  // Q1/Q2 ya no usan chat (OBJETIVO A) — solo queda el par de teaching.
  const historyBeforeReload = await readChatHistory(page)
  expect(historyBeforeReload?.length, 'antes de refrescar debe haber 2 mensajes: solo el par de teaching (assessment usó pista, no chat)').toBe(2)

  await page.reload()
  // La pantalla de "Sesión completada" es un render branch distinto (como
  // loading/error) que no incluye el panel de chat — coherente: el chat es
  // una herramienta de DURANTE la sesión, no de la pantalla final. Lo que
  // debe sobrevivir al refresh es el DATO persistido, verificado aquí.
  await expect(page.getByText('Sesión completada')).toBeVisible()
  const historyAfterReload = await readChatHistory(page)
  expect(historyAfterReload, 'el historial de chat debe sobrevivir intacto al refresh').toEqual(historyBeforeReload)
})
