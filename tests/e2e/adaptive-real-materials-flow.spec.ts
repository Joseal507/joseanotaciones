import { expect, test, type Page } from '@playwright/test'
import { buildAssessmentBlueprint } from '../../lib/adaptive/evaluation/assessmentBlueprint'

const materials = [
  { slug: 'conceptual-short', title: 'Historia de un equipo', domain: 'general_conceptual', pages: 2, learningSessions: 1, steps: 1 },
  { slug: 'chemistry-mixed', title: 'Equilibrio químico y tabla ICE', domain: 'chemistry_quantitative', pages: 18, learningSessions: 3, steps: 5 },
  { slug: 'physics', title: 'Fuerzas y torque', domain: 'physics_quantitative', pages: 12, learningSessions: 2, steps: 2 },
  { slug: 'calculus', title: 'Derivadas y aplicaciones', domain: 'mathematics', pages: 24, learningSessions: 4, steps: 12 },
  { slug: 'medicine', title: 'Sistema cardiovascular', domain: 'medicine', pages: 16, learningSessions: 3, steps: 5 },
  { slug: 'law', title: 'Principios constitucionales', domain: 'law', pages: 22, learningSessions: 4, steps: 5 },
  { slug: 'long-document', title: 'Tratado interdisciplinario', domain: 'mixed', pages: 64, learningSessions: 8, steps: 27 },
  { slug: 'minimum', title: 'Concepto esencial', domain: 'general_conceptual', pages: 1, learningSessions: 1, steps: 1 },
] as const

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

async function installMaterial(page: Page, material: typeof materials[number]) {
  const sessionId = `e2e-real-flow-${material.slug}`
  const temaId = `e2e-real-tema-${material.slug}`
  const counters = { teach: 0, reteach: 0, persist: 0, checks: 0 }
  const stepId = `node-${material.slug}`
  const keyPoints = [`${material.title}: base`, `${material.title}: relación`]
  // factKeys deben coincidir literalmente con los que declararán las preguntas
  // (stepId:questionId, ver question() arriba) — Demonstration Coverage exige
  // que question.factKeys intersecte objective.factKeys, no solo que
  // targetObjectiveIds coincida.
  const assessment = buildAssessmentBlueprint([{
    id: stepId, title: material.title, content: `Contenido persistido de ${material.title}.`,
    keyPoints, factKeys: [`${stepId}:normal-correct`, `${stepId}:normal-failure`], importance: 0.8,
  }], sessionId, 1)
  const [objectiveA, objectiveB] = assessment.objectives.map(objective => objective.objectiveId)
  const learning = {
    sessionId: 'chapter-2', sessionTitle: `${material.title} — aprendizaje`, sessionNumber: 2,
    sessionKind: 'learning', materialType: material.domain, academicDomain: material.domain,
    sessionIntro: `Aprendizaje de ${material.title}.`,
    steps: [{ id: stepId, type: 'concept', title: material.title, content: `Explicación verificable de ${material.title}.`, keyPoints, importance: 'critical', relatedBlockIds: ['block-real'] }],
    sessionClosing: 'Integración terminada.', totalSteps: 1, assessmentBlueprint: assessment,
    evaluationBlocks: [{
      id: 'block-real', afterStepId: stepId, coveredStepIds: [stepId], coveredKeyPoints: keyPoints,
      questions: [question('normal-correct', stepId, objectiveA, keyPoints[0]), question('normal-failure', stepId, objectiveB, keyPoints[1])],
    }], evaluationProgress: {}, recoveryQueue: [],
  }
  const simpleContent = (number: number, kind: 'introduction' | 'final_review', title: string, count: number) => ({
    sessionId: `chapter-${number}`, sessionTitle: title, sessionNumber: number, sessionKind: kind,
    materialType: material.domain, academicDomain: material.domain, sessionIntro: title,
    steps: Array.from({ length: count }, (_, index) => ({ id: `${kind}-${index}`, type: 'concept', title: `${title} ${index + 1}`, content: `Orientación ${index + 1} de ${material.title}.`, keyPoints: [], importance: 'supporting', relatedBlockIds: [] })),
    sessionClosing: `Cierre ${title}.`, totalSteps: count, evaluationBlocks: [], evaluationProgress: {}, recoveryQueue: [],
  })

  await page.route('**/api/study-sessions**', route => {
    if (route.request().method() !== 'GET') counters.persist += 1
    return route.fulfill({ json: route.request().method() === 'GET' ? { success: true, sessions: [] } : { success: true } })
  })
  await page.route('**/api/adaptive/session-teach', route => {
    counters.teach += 1
    return route.fulfill({ json: { success: true, classContent: learning } })
  })
  await page.route('**/api/adaptive/session-check', route => {
    counters.checks += 1
    const body = route.request().postDataJSON()
    const correct = body.answer === body.question.correctAnswer
    return route.fulfill({ json: { success: true, result: { outcome: correct ? 'correct' : 'incorrect', correct, score: correct ? 100 : 0, feedback: correct ? 'Respuesta correcta.' : 'Respuesta incorrecta.', errorType: correct ? null : 'conceptual' } } })
  })
  await page.route('**/api/adaptive/session-reteach', route => {
    counters.reteach += 1
    const body = route.request().postDataJSON()
    const round = counters.reteach
    const recoveryQuestion = (number: number) => ({
      ...question(`recovery-${round}-${number}`, stepId, objectiveB, keyPoints[1]),
      questionFamily: `deterministic_recovery_${round}_${number}`, variant: 'mcq_best_answer', format: 'multiple_choice',
      questionText: number === 1
        ? `Ronda ${round}: identifica el principio central de ${material.title}.`
        : `Ronda ${round}: aplica la relación de ${material.title} en un caso nuevo.`,
      options: [{ id: 'a', text: 'Aplicación alineada' }, { id: 'b', text: 'Aplicación incompatible' }], correctAnswer: 'a',
      factKey: body.target.sourceFactKeys[0], factKeys: body.target.sourceFactKeys,
      coveredKeyPoints: body.target.sourceKeyPoints,
      coveredKeyPointIds: body.target.sourceKeyPointIds,
    })
    return route.fulfill({ json: {
      success: true, recoveryId: body.recoveryId, recoveryTargetId: body.recoveryTargetId,
      roundId: body.roundId, roundNumber: round,
      // Auditoría adversarial (Codex, Reteach #3.1): recordRecoveryReteachContent
      // ahora rechaza correctamente contenido duplicado entre rondas — cada
      // ronda real de producción genera una explicación distinta (nueva
      // llamada al LLM). `round` distingue la explicación aquí igual que ya
      // distinguía el texto de las preguntas, para no disparar el guard de
      // duplicados en un fixture que antes reutilizaba el mismo texto en
      // cada ronda.
      explanation: `**Reexplicación específica de ${material.title} — ronda ${round}.** Corrige solamente la relación que falló.`,
      questions: [recoveryQuestion(1), recoveryQuestion(2)], target: body.target,
      provider: 'openrouter', model: 'google/gemini-2.5-flash', generationKey: body.generationKey, preparedAt: Date.now(),
    } })
  })
  await page.addInitScript(({ sessionId, temaId, material, intro, learning, review }) => {
    const existingSessions = JSON.parse(localStorage.getItem('studyal_sessions_v4') || '{}')
    if (existingSessions[sessionId]) return
    const chapters = [
      { id: 'chapter-1', chapterNumber: 1, kind: 'introduction', status: 'available', blockIds: [], unitIds: [], arcRole: 'orientation' },
      { id: 'chapter-2', chapterNumber: 2, kind: 'learning', status: 'locked', blockIds: ['block-real'], unitIds: ['unit-real'], arcRole: 'mechanism' },
      { id: 'chapter-3', chapterNumber: 3, kind: 'final_review', status: 'locked', blockIds: [], unitIds: [], arcRole: 'final_review' },
    ]
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: [`material-${material.slug}`], primaryMaterialId: `material-${material.slug}`, materialNames: [material.title],
      selectedPages: { [`material-${material.slug}`]: Array.from({ length: material.pages }, (_, index) => index + 1) },
      adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80, evalPreference: 'quick_test', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, academicDomain: material.domain, blocks: [{ id: 'block-real' }], topics: [] },
      journey: { id: `journey-${material.slug}`, version: 4, chapters, totalChapters: 3 },
      currentSessionNumber: 1, currentStep: 0, completedSessionNumbers: [], status: 'in_progress', adaptiveState: 'studying',
      isProgramComplete: true, unresolvedMicroIds: [], sessionContent: { '1': intro, '2': learning, '3': review }, recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey: session.journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId, material, learning, intro: simpleContent(1, 'introduction', `Orientación ${material.title}`, 3), review: simpleContent(3, 'final_review', `Integración ${material.title}`, 2) })
  return { sessionId, temaId, counters }
}

for (const material of materials) {
  test(`${material.slug}: flujo adaptativo visible completo`, async ({ page }) => {
    const { sessionId, temaId, counters } = await installMaterial(page, material)
    await page.goto(`/materias/${temaId}/sesion/1?adaptiveSessionId=${sessionId}`)
    await expect(page.getByTestId('adaptive-session-root')).toHaveAttribute('data-session-kind', 'introduction')
    await expect(page.getByText('Sesión sin evaluación.')).toBeVisible()
    for (let index = 1; index < 3; index += 1) await page.getByRole('button', { name: 'Continuar →' }).click()
    await page.getByRole('button', { name: '🎉 Terminar' }).click()
    await page.evaluate(async () => {
      await fetch('/api/adaptive/session-teach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    })
    await page.getByRole('button', { name: 'Siguiente →' }).click()
    await expect(page.getByTestId('adaptive-session-root')).toHaveAttribute('data-session-kind', 'learning')
    expect(counters.teach).toBe(1)

    await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
    await page.getByRole('button', { name: 'Verdadero' }).click()
    await page.getByRole('button', { name: 'Enviar respuesta' }).click()
    await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
    await page.getByRole('button', { name: 'Falso' }).click()
    await page.getByRole('button', { name: 'Enviar respuesta' }).click()
    await page.getByRole('button', { name: 'Revisar conceptos →' }).click()
    await expect(page.getByText('📖 Reexplicación')).toBeVisible()
    await page.getByRole('button', { name: 'Verificar comprensión →' }).click()
    await expect(page.getByText(`Ronda 1: identifica el principio central de ${material.title}.`)).toBeVisible()
    await page.getByRole('button', { name: 'Aplicación alineada' }).click()
    await page.getByRole('button', { name: 'Enviar respuesta' }).click()
    await page.getByRole('button', { name: 'Continuar recuperación →' }).click()
    await page.getByRole('button', { name: 'Aplicación incompatible' }).click()
    await page.getByRole('button', { name: 'Enviar respuesta' }).click()
    await page.getByRole('button', { name: 'Revisar de nuevo →' }).click()
    await page.getByRole('button', { name: 'Verificar comprensión →' }).click()
    for (let verification = 0; verification < 2; verification += 1) {
      await page.getByRole('button', { name: 'Aplicación alineada' }).click()
      await page.getByRole('button', { name: 'Enviar respuesta' }).click()
      if (verification === 0) await page.getByRole('button', { name: 'Continuar recuperación →' }).click()
    }
    await expect(page.getByRole('button', { name: '🎉 Terminar' })).toBeVisible()
    await page.getByRole('button', { name: '🎉 Terminar' }).dblclick()
    await expect(page.getByText('Sesión completada')).toBeVisible()
    expect(counters.reteach).toBe(2)
    expect(counters.persist).toBeGreaterThan(0)

    await page.goto(`/materias/${temaId}/sesion/3?adaptiveSessionId=${sessionId}`)
    await expect(page.getByTestId('adaptive-session-root')).toHaveAttribute('data-session-kind', 'final_review')
    await expect(page.getByText('Sesión sin evaluación.')).toBeVisible()
    await page.getByRole('button', { name: 'Continuar →' }).click()
    await expect.poll(() => page.evaluate(id => {
      const sessions = JSON.parse(localStorage.getItem('studyal_sessions_v4') || '{}')
      return sessions[id]?.currentSessionNumber === 3 ? sessions[id]?.currentStep : -1
    }, sessionId)).toBe(1)
    await page.reload()
    await expect(page.getByText('Paso 2 de 2')).toBeVisible()
    await page.getByRole('button', { name: '🎉 Terminar' }).click()
    await page.getByRole('button', { name: '📋 Plan' }).click()
    await expect(page).toHaveURL(/adaptiveView=plan/)
    console.log(JSON.stringify({ event: 'adaptive_real_material_result', ...material, blocks: 1, normalQuestions: 2, recoveries: 1, rounds: 2, coverage: 100, restore: 'PASS', closure: 'PASS' }))
  })
}
