import { expect, test, type Page } from '@playwright/test'
import { buildAssessmentBlueprint } from '../../lib/adaptive/evaluation/assessmentBlueprint'
import { scoreQuestion } from '../../lib/adaptive/evaluation/scoring'

// AUDITORÍA ADVERSARIAL CODEX — Finding 3 (P1, CONFIRMED): prueba de
// integración end-to-end, complementaria a
// scripts/tests/lazy-hydration-target-authority-contracts.ts (que prueba la
// lógica en aislamiento). Aquí se ejercita el flujo REAL completo: un
// evaluation block LAZY (questions: []) se hidrata contra /session-eval real
// (interceptado solo en el transporte HTTP, para inspeccionar exactamente
// qué envía el cliente), y una respuesta correcta a la pregunta lazy
// resultante debe registrar evidencia real — el bug hacía que esto se
// perdiera en silencio (la UI avanzaba, pero demonstratedFactKeys nunca
// crecía).

const temaId = 'e2e-lazy-hydration-tema'
const sessionId = 'e2e-lazy-hydration-session'
const stepId = 'node-lazy-hydration'
const factKey = 'fact-lazy-hydration'
const keyPoints = [factKey]

async function installLazyHydrationSession(page: Page, capturedRequests: any[]) {
  const assessment = buildAssessmentBlueprint(
    [{ id: stepId, title: 'Concepto lazy', content: 'Contenido del concepto lazy.', keyPoints, factKeys: keyPoints, importance: 0.8 }],
    'chapter-lazy', 2,
  )
  const objectiveIds = assessment.objectives.map(objective => objective.objectiveId)

  const learning = {
    sessionId: 'chapter-lazy', sessionTitle: 'Concepto lazy — aprendizaje', sessionNumber: 2,
    sessionKind: 'learning', materialType: 'general', academicDomain: 'general',
    sessionIntro: 'Aprendizaje del concepto lazy.',
    steps: [{ id: stepId, type: 'concept', title: 'Concepto lazy', content: 'Explicación del concepto lazy.', keyPoints, importance: 'critical', relatedBlockIds: ['block-lazy'] }],
    sessionClosing: 'Integración terminada.', totalSteps: 1, assessmentBlueprint: assessment,
    // Bloque LAZY: questions vacío — se hidrata on-demand vía /session-eval.
    // createEvaluationBlockProgress marca status:'completed' por defecto
    // cuando questions.length===0 (bloque real ya trivialmente completo) —
    // un bloque genuinamente lazy necesita su progress sembrado como
    // 'answering' para que startEvaluationBlock alcance la rama de
    // hidratación en vez de saltarse la evaluación entera.
    evaluationBlocks: [{ id: 'block-lazy', afterStepId: stepId, coveredStepIds: [stepId], coveredKeyPoints: keyPoints, questions: [], lazyGeneration: true }],
    evaluationProgress: { 'block-lazy': { blockId: 'block-lazy', currentQuestionIndex: 0, answers: [], failedQuestionIds: [], pendingRecoveryIds: [], readyRecoveryIds: [], status: 'answering' } },
    recoveryQueue: [],
  }

  await page.route('**/api/study-sessions**', route =>
    route.fulfill({ json: route.request().method() === 'GET' ? { success: true, sessions: [] } : { success: true } }))
  await page.route('**/api/adaptive/session-teach', route => route.fulfill({ json: { success: true, classContent: learning } }))
  await page.route('**/api/adaptive/session-eval', route => {
    const body = route.request().postDataJSON()
    capturedRequests.push(body)
    // El modelo real declararía targetObjectiveIds — se simula devolviendo
    // exactamente el id que el plan autoritativo del cliente autorizó, para
    // ejercitar el camino "el modelo coincide con el plan" (el caso normal).
    // Se lee `context.partIndex ?? index === 0` -> plannedQuestions[0].
    const targetObjectiveIds = body.assessmentQuestionPlan?.plannedQuestions?.[0]?.targetObjectiveIds || []
    return route.fulfill({
      json: {
        success: true,
        questions: [{
          id: 'q-lazy-hydrated', conceptId: stepId, conceptLabel: 'Concepto lazy', teachingBlockId: stepId,
          questionFamily: 'mcq_best_answer', variant: 'mcq_best_answer', difficulty: 'medium',
          targetDimension: 'comprehension', questionText: 'Pregunta lazy hidratada dinámicamente.',
          explanation: 'Explicación.', hint: '',
          estimatedSeconds: 30, evidencesNeeded: 1, factKey, factKeys: keyPoints,
          targetObjectiveIds, evidenceProduced: targetObjectiveIds, coveredStepIds: [stepId], coveredKeyPoints: keyPoints,
          format: 'multiple_choice', options: [{ id: 'a', text: 'Opción correcta' }, { id: 'b', text: 'Opción incorrecta' }], correctAnswer: 'a',
        }],
      },
    })
  })
  await page.route('**/api/adaptive/session-check', route => {
    const body = route.request().postDataJSON()
    const result = scoreQuestion(body.question, body.answer)
    return route.fulfill({ json: { success: true, result: { outcome: result.outcome, correct: result.correct, score: result.score, feedback: result.correct ? 'Respuesta correcta.' : 'Respuesta incorrecta.', errorType: result.errorType } } })
  })
  await page.addInitScript(({ sessionId, temaId, learning }) => {
    const journey = { id: 'journey_lazy_e2e', version: 4, chapters: [{ id: 'chapter-lazy', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['block-lazy'], unitIds: ['unit-real'] }], totalChapters: 1 }
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['material-lazy'], primaryMaterialId: 'material-lazy', materialNames: ['Concepto lazy'],
      selectedPages: {}, adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80, evalPreference: 'mix_everything', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, academicDomain: 'general', blocks: [{ id: 'block-lazy' }], topics: [] },
      journey, currentSessionNumber: 2, currentStep: 0, completedSessionNumbers: [], status: 'in_progress', adaptiveState: 'studying',
      isProgramComplete: false, unresolvedMicroIds: [], sessionContent: { '2': learning }, recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId, learning })

  return objectiveIds
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

test('bloque lazy: la hidratación envía el plan autoritativo y una respuesta correcta demuestra el factKey', async ({ page }) => {
  const capturedRequests: any[] = []
  const objectiveIds = await installLazyHydrationSession(page, capturedRequests)

  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Paso 1 de 1')).toBeVisible()
  await page.getByRole('button', { name: 'Continuar →' }).click()
  await expect(page.getByText('Pregunta lazy hidratada dinámicamente.')).toBeVisible()

  expect(capturedRequests.length, 'la hidratación debe haber llamado a session-eval exactamente una vez').toBe(1)
  const sentPlan = capturedRequests[0].assessmentQuestionPlan
  expect(sentPlan, 'BUG DE CODEX SI FALLA: la petición de hidratación lazy debe incluir assessmentQuestionPlan').toBeTruthy()
  expect(sentPlan.plannedQuestions.length).toBeGreaterThan(0)
  expect(sentPlan.plannedQuestions[0].targetObjectiveIds).toEqual(objectiveIds)
  expect(capturedRequests[0].assessmentBlueprint, 'la petición debe incluir también el assessmentBlueprint real').toBeTruthy()

  await page.getByRole('button', { name: 'Opción correcta' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await expect(page.getByText('✅ ¡Correcto!')).toBeVisible()

  const afterAnswer = await readAssessmentBlueprint(page)
  const objective = afterAnswer.objectives.find((o: any) => objectiveIds.includes(o.objectiveId))
  expect(objective.demonstratedFactKeys, 'una pregunta lazy respondida correctamente SÍ debe registrar evidencia real — antes del fix, esto se perdía en silencio').toContain(factKey)
})
