import { expect, test, type Page } from '@playwright/test'
import { buildAssessmentBlueprint } from '../../lib/adaptive/evaluation/assessmentBlueprint'

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

async function installSession(page: Page, opts: { slug: string; failingCount: 1 | 2 }) {
  const sessionId = `e2e-completion-edge-${opts.slug}`
  const temaId = `e2e-completion-edge-tema-${opts.slug}`
  const counters = { reteach: 0, persist: 0, completionPersisted: 0 }
  const stepId = `node-${opts.slug}`
  const title = 'Concepto de prueba'
  const keyPoints = Array.from({ length: opts.failingCount + 1 }, (_, index) => `${title}: punto ${index + 1}`)
  const assessment = buildAssessmentBlueprint([{
    id: stepId, title, content: `Contenido persistido de ${title}.`, keyPoints, importance: 0.8,
  }], sessionId, 1)
  const objectiveIds = assessment.objectives.map(objective => objective.objectiveId)
  const questions = [
    question('q-correct', stepId, objectiveIds[0], keyPoints[0]),
    ...Array.from({ length: opts.failingCount }, (_, index) =>
      question(`q-fail-${index + 1}`, stepId, objectiveIds[index + 1], keyPoints[index + 1])),
  ]
  const factKeyToObjective = Object.fromEntries(questions.map(q => [q.factKey, q.targetObjectiveIds[0]]))
  const factKeyToKeyPoint = Object.fromEntries(questions.map(q => [q.factKey, q.coveredKeyPoints[0]]))

  const learning = {
    sessionId: 'chapter-2', sessionTitle: `${title} — aprendizaje`, sessionNumber: 2,
    sessionKind: 'learning', materialType: 'general_conceptual', academicDomain: 'general_conceptual',
    sessionIntro: `Aprendizaje de ${title}.`,
    steps: [{ id: stepId, type: 'concept', title, content: `Explicación verificable de ${title}.`, keyPoints, importance: 'critical', relatedBlockIds: ['block-real'] }],
    sessionClosing: 'Integración terminada.', totalSteps: 1, assessmentBlueprint: assessment,
    evaluationBlocks: [{ id: 'block-real', afterStepId: stepId, coveredStepIds: [stepId], coveredKeyPoints: keyPoints, questions }],
    evaluationProgress: {}, recoveryQueue: [],
  }

  await page.route('**/api/study-sessions**', route => {
    if (route.request().method() !== 'GET') counters.persist += 1
    return route.fulfill({ json: route.request().method() === 'GET' ? { success: true, sessions: [] } : { success: true } })
  })
  await page.route('**/api/adaptive/session-teach', route => route.fulfill({ json: { success: true, classContent: learning } }))
  await page.route('**/api/adaptive/session-check', route => {
    const body = route.request().postDataJSON()
    const correct = body.answer === body.question.correctAnswer
    return route.fulfill({ json: { success: true, result: { outcome: correct ? 'correct' : 'incorrect', correct, score: correct ? 100 : 0, feedback: correct ? 'Respuesta correcta.' : 'Respuesta incorrecta.', errorType: correct ? null : 'conceptual' } } })
  })
  await page.route('**/api/adaptive/session-reteach', route => {
    counters.reteach += 1
    const body = route.request().postDataJSON()
    const round = counters.reteach
    const sourceFactKey = body.target.sourceFactKeys[0]
    const objectiveId = factKeyToObjective[sourceFactKey] || objectiveIds[1]
    const keyPoint = factKeyToKeyPoint[sourceFactKey] || keyPoints[1]
    const recoveryQuestion = (number: number) => ({
      ...question(`recovery-${round}-${number}`, stepId, objectiveId, keyPoint),
      questionFamily: `deterministic_recovery_${round}_${number}`, variant: 'mcq_best_answer', format: 'multiple_choice',
      questionText: `Ronda ${round}: pregunta ${number} de recuperación para ${keyPoint}.`,
      options: [{ id: 'a', text: 'Aplicación alineada' }, { id: 'b', text: 'Aplicación incompatible' }], correctAnswer: 'a',
      factKey: sourceFactKey, factKeys: body.target.sourceFactKeys,
      coveredKeyPoints: body.target.sourceKeyPoints,
      coveredKeyPointIds: body.target.sourceKeyPointIds,
    })
    return route.fulfill({ json: {
      success: true, recoveryId: body.recoveryId, recoveryTargetId: body.recoveryTargetId,
      roundId: body.roundId, roundNumber: round,
      explanation: `**Reexplicación específica.** Corrige solamente la relación que falló.`,
      questions: [recoveryQuestion(1), recoveryQuestion(2)], target: body.target,
      provider: 'openrouter', model: 'google/gemini-2.5-flash', generationKey: body.generationKey, preparedAt: Date.now(),
    } })
  })
  await page.addInitScript(({ sessionId, temaId, learning }) => {
    const existingSessions = JSON.parse(localStorage.getItem('studyal_sessions_v4') || '{}')
    if (existingSessions[sessionId]) return
    const journey = {
      id: 'journey_edge', version: 4,
      chapters: [{ id: 'chapter-2', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['block-real'], unitIds: ['unit-real'], arcRole: 'mechanism' }],
      totalChapters: 1,
    }
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['material-edge'], primaryMaterialId: 'material-edge', materialNames: ['Concepto de prueba'],
      selectedPages: {}, adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80, evalPreference: 'quick_test', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, academicDomain: 'general_conceptual', blocks: [{ id: 'block-real' }], topics: [] },
      journey, currentSessionNumber: 2, currentStep: 0, completedSessionNumbers: [], status: 'in_progress', adaptiveState: 'studying',
      isProgramComplete: false, unresolvedMicroIds: [], sessionContent: { '2': learning }, recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId, learning })
  return { sessionId, temaId, counters }
}

async function resolveOneRecovery(page: Page) {
  await expect(page.getByText('📖 Reexplicación')).toBeVisible()
  await page.getByRole('button', { name: 'Verificar comprensión →' }).click()
  await page.getByRole('button', { name: 'Aplicación alineada' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
}

test('refresh justo antes de pulsar Terminar mantiene complete_session sin auto-completar', async ({ page }) => {
  const { sessionId, temaId } = await installSession(page, { slug: 'refresh', failingCount: 1 })
  const events: string[] = []
  page.on('console', message => events.push(message.text()))

  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Paso 1 de 1')).toBeVisible()

  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await page.getByRole('button', { name: 'Verdadero' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await page.getByRole('button', { name: 'Falso' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.getByRole('button', { name: 'Revisar conceptos →' }).click()

  await resolveOneRecovery(page)
  await page.getByRole('button', { name: 'Continuar recuperación →' }).click()
  await page.getByRole('button', { name: 'Aplicación alineada' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()

  // La última recuperación ya se resolvió (V1+V2 correctas). Antes de dar el click
  // que confirma la finalización, el usuario refresca la página.
  await expect(page.getByRole('button', { name: '🎉 Terminar' })).toBeVisible()
  await expect(page.getByText('Sesión completada')).toHaveCount(0)
  events.length = 0

  await page.reload()

  // Tras restaurar: debe volver exactamente al mismo estado complete_session,
  // NUNCA auto-completar por el solo hecho de recargar.
  await expect(page.getByText('Sesión completada')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continuar →' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Revisar error →' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '🎉 Terminar' })).toBeVisible()
  expect(events.filter(line => line.includes('session_completion_persisted'))).toHaveLength(0)

  await page.getByRole('button', { name: '🎉 Terminar' }).click()
  await expect(page.getByText('Sesión completada')).toBeVisible()
  expect(events.filter(line => line.includes('session_completion_persisted'))).toHaveLength(1)
})

test('dos recoveries independientes: Terminar solo aparece tras resolver ambas', async ({ page }) => {
  const { sessionId, temaId } = await installSession(page, { slug: 'dual-recovery', failingCount: 2 })
  const events: string[] = []
  page.on('console', message => events.push(message.text()))

  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Paso 1 de 1')).toBeVisible()

  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await page.getByRole('button', { name: 'Verdadero' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()

  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await page.getByRole('button', { name: 'Falso' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()

  await page.getByRole('button', { name: 'Falso' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.getByRole('button', { name: 'Revisar conceptos →' }).click()

  // Primera recuperación.
  await resolveOneRecovery(page)
  await page.getByRole('button', { name: 'Continuar recuperación →' }).click()
  await page.getByRole('button', { name: 'Aplicación alineada' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()

  // Al resolver la primera, todavía debe quedar pendiente la segunda —
  // NUNCA debe verse "🎉 Terminar" aquí. El botón de feedback debe decir
  // "Continuar →" (hay otra recovery pendiente), no "🎉 Terminar".
  await expect(page.getByRole('button', { name: '🎉 Terminar' })).toHaveCount(0)
  await expect(page.getByText('Sesión completada')).toHaveCount(0)
  await page.getByRole('button', { name: 'Continuar →' }).click()

  // Segunda recuperación.
  await resolveOneRecovery(page)
  await page.getByRole('button', { name: 'Continuar recuperación →' }).click()
  await page.getByRole('button', { name: 'Aplicación alineada' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()

  await expect(page.getByRole('button', { name: '🎉 Terminar' })).toBeVisible()
  await expect(page.getByText('Sesión completada')).toHaveCount(0)

  await page.getByRole('button', { name: '🎉 Terminar' }).click()
  await expect(page.getByText('Sesión completada')).toBeVisible()
  expect(events.filter(line => line.includes('session_completion_persisted'))).toHaveLength(1)
})
