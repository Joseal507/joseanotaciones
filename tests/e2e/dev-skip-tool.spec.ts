import { expect, test, type Page } from '@playwright/test'
import { buildAssessmentBlueprint } from '../../lib/adaptive/evaluation/assessmentBlueprint'
import { scoreQuestion } from '../../lib/adaptive/evaluation/scoring'
import { gradeVisualInteraction } from '../../lib/adaptive/visual/visualGrading'

// Herramienta DEV-ONLY "⏭ Omitir / responder correctamente" — recorrido rápido de
// sesiones para QA/UX. Estos E2E prueban el botón real en el DOM, a través del
// pipeline real: session-check se mockea SOLO en la capa HTTP (mismo patrón ya
// establecido en legacy-assessment-blueprint-restore.spec.ts /
// session-completion-edge-cases.spec.ts) pero internamente llama a scoreQuestion/
// gradeVisualInteraction REALES — nunca una copia paralela de "correcto".

const temaId = 'e2e-dev-skip-tema'
const sessionId = 'e2e-dev-skip-session'
const stepId = 'node-dev-skip'

// factKeys/keyPoints ANTES de construir las preguntas — buildAssessmentBlueprint
// crea un objective POR factKey (mismo patrón que session-completion-edge-cases.
// spec.ts); las preguntas deben apuntar a los objectiveId REALMENTE generados, no
// a ids inventados, o recordAssessmentEvidence los descarta como objetivos
// desconocidos y la evidencia nunca se registra.
const keyPoints = ['punto mcq', 'punto matching', 'punto ordering', 'punto numeric', 'punto short']
const factKeys = ['q-mcq', 'q-matching', 'q-ordering', 'q-numeric', 'q-short'].map(id => `${stepId}:${id}`)
const assessment = buildAssessmentBlueprint(
  [{ id: stepId, title: 'Concepto dev-skip', content: 'Contenido enseñado.', keyPoints, factKeys, importance: 0.8 }],
  sessionId, 1,
)
const objectiveIds = assessment.objectives.map(o => o.objectiveId)

const mcq = {
  id: 'q-mcq', conceptId: stepId, conceptLabel: 'MCQ', teachingBlockId: stepId,
  questionFamily: 'mcq_best_answer', variant: 'mcq_best_answer', difficulty: 'medium',
  targetDimension: 'comprehension', format: 'multiple_choice',
  questionText: '¿Cuál es la opción correcta?', explanation: 'Explicación.', hint: '',
  estimatedSeconds: 20, evidencesNeeded: 1, factKey: factKeys[0], factKeys: [factKeys[0]],
  targetObjectiveIds: [objectiveIds[0]], evidenceProduced: [objectiveIds[0]], coveredStepIds: [stepId], coveredKeyPoints: [keyPoints[0]],
  options: [{ id: 'a', text: 'Correcta' }, { id: 'b', text: 'Incorrecta' }], correctAnswer: 'a',
}
const matching = {
  id: 'q-matching', conceptId: stepId, conceptLabel: 'Matching', teachingBlockId: stepId,
  questionFamily: 'matching_term_function', variant: 'matching_term_function', difficulty: 'medium',
  targetDimension: 'comprehension', format: 'matching',
  questionText: 'Relaciona cada término.', explanation: 'Explicación.', hint: '',
  estimatedSeconds: 30, evidencesNeeded: 1, factKey: factKeys[1], factKeys: [factKeys[1]],
  targetObjectiveIds: [objectiveIds[1]], evidenceProduced: [objectiveIds[1]], coveredStepIds: [stepId], coveredKeyPoints: [keyPoints[1]],
  options: [
    { id: 'l1', left: 'Término 1', rightId: 'r1', right: 'Definición 1' },
    { id: 'l2', left: 'Término 2', rightId: 'r2', right: 'Definición 2' },
  ],
  correctAnswer: { l1: 'r1', l2: 'r2' }, matchingSemantics: 'bijective', matchingOptionOrder: ['r2', 'r1'],
}
const ordering = {
  id: 'q-ordering', conceptId: stepId, conceptLabel: 'Ordering', teachingBlockId: stepId,
  questionFamily: 'ordering_steps', variant: 'ordering_steps', difficulty: 'medium',
  targetDimension: 'comprehension', format: 'ordering',
  questionText: 'Ordena los pasos.', explanation: 'Explicación.', hint: '',
  estimatedSeconds: 30, evidencesNeeded: 1, factKey: factKeys[2], factKeys: [factKeys[2]],
  targetObjectiveIds: [objectiveIds[2]], evidenceProduced: [objectiveIds[2]], coveredStepIds: [stepId], coveredKeyPoints: [keyPoints[2]],
  options: [{ id: 's1', text: 'Paso 1' }, { id: 's2', text: 'Paso 2' }, { id: 's3', text: 'Paso 3' }],
  correctAnswer: ['s1', 's2', 's3'],
}
const numeric = {
  id: 'q-numeric', conceptId: stepId, conceptLabel: 'Numeric', teachingBlockId: stepId,
  questionFamily: 'problem_solve', variant: 'problem_solve', difficulty: 'medium',
  targetDimension: 'application', format: 'numeric_problem',
  questionText: 'Calcula el valor.', explanation: 'Explicación.', hint: '',
  estimatedSeconds: 30, evidencesNeeded: 1, factKey: factKeys[3], factKeys: [factKeys[3]],
  targetObjectiveIds: [objectiveIds[3]], evidenceProduced: [objectiveIds[3]], coveredStepIds: [stepId], coveredKeyPoints: [keyPoints[3]],
  options: null, correctAnswer: { value: 42, tolerance: 0.5, unit: 'kg' },
}
const shortResponse = {
  id: 'q-short', conceptId: stepId, conceptLabel: 'Short', teachingBlockId: stepId,
  questionFamily: 'short_answer_define', variant: 'short_answer_define', difficulty: 'medium',
  targetDimension: 'comprehension', format: 'short_response',
  questionText: 'Explica el concepto.', explanation: 'Explicación.', hint: '',
  estimatedSeconds: 30, evidencesNeeded: 1, factKey: factKeys[4], factKeys: [factKeys[4]],
  targetObjectiveIds: [objectiveIds[4]], evidenceProduced: [objectiveIds[4]], coveredStepIds: [stepId], coveredKeyPoints: [keyPoints[4]],
  options: null, correctAnswer: 'Definición canónica esperada de la respuesta',
}
const allQuestions = [mcq, matching, ordering, numeric, shortResponse]

const visualSpec = {
  id: 'visual-dev-skip', requirementId: 'req-dev-skip', microId: 'micro-visual',
  engine: 'graph_2d' as const, representation: 'graph', conceptual: false,
  sourceGrounding: { sourceSpans: [], factKeys: [] },
  data: { expression: '2x+1', domain: [-5, 5] as [number, number], points: [{ x: 2, y: 5 }] },
}

function buildLearning() {
  return {
    sessionId: 'chapter-dev-skip', sessionTitle: 'Sesión dev-skip', sessionNumber: 2,
    sessionKind: 'learning', materialType: 'general', academicDomain: 'general',
    sessionIntro: 'Inicio.',
    steps: [
      { id: `${stepId}-1`, type: 'intro', title: 'Paso sin visual', content: 'Contenido del paso uno.', keyPoints: ['punto uno'], importance: 'important', relatedBlockIds: [] },
      {
        id: `${stepId}-2`, type: 'concept', title: 'Paso con visual requerido', content: 'Contenido del paso dos.',
        keyPoints: ['punto dos'], importance: 'critical', relatedBlockIds: [], microId: 'micro-visual',
        factKeys: ['fact-visual'], visualSpec, visualEvidenceKind: 'visual_interpretation',
      },
    ],
    sessionClosing: 'Cierre.', totalSteps: 2, assessmentBlueprint: assessment,
    evaluationBlocks: [{ id: 'block-dev-skip', afterStepId: `${stepId}-2`, coveredStepIds: [`${stepId}-2`], coveredKeyPoints: keyPoints, questions: allQuestions }],
    evaluationProgress: {}, recoveryQueue: [],
  }
}

async function installSession(page: Page) {
  const learning = buildLearning()
  await page.route('**/api/study-sessions**', route =>
    route.fulfill({ json: route.request().method() === 'GET' ? { success: true, sessions: [] } : { success: true } }))
  await page.route('**/api/adaptive/session-teach', route => route.fulfill({ json: { success: true, classContent: learning } }))
  await page.route('**/api/adaptive/session-check', route => {
    const body = route.request().postDataJSON()
    const result = scoreQuestion(body.question, body.answer)
    return route.fulfill({ json: { success: true, result: { outcome: result.outcome, correct: result.correct, score: result.score, feedback: result.correct ? 'Respuesta correcta.' : 'Respuesta incorrecta.', errorType: result.errorType } } })
  })
  await page.route('**/api/adaptive/visual-check', route => {
    const body = route.request().postDataJSON()
    const result = gradeVisualInteraction(body.visualSpec, body.submission)
    return route.fulfill({ json: { success: true, result } })
  })
  await page.addInitScript(({ sessionId, temaId, learning }) => {
    // Guard contra reload: addInitScript se re-ejecuta en CADA navegación —
    // sin este guard, un page.reload() en un test de restore volvería a pisar
    // el localStorage con el estado prístino inicial, borrando evidencia real
    // ya acumulada (mismo patrón que session-completion-edge-cases.spec.ts).
    const existingSessions = JSON.parse(localStorage.getItem('studyal_sessions_v4') || '{}')
    if (existingSessions[sessionId]) return
    const journey = {
      id: 'journey_dev_skip', version: 1,
      chapters: [{ id: 'chapter-dev-skip', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['block-real'], unitIds: ['unit-real'] }],
      totalChapters: 1,
    }
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['material-dev-skip'], primaryMaterialId: 'material-dev-skip', materialNames: ['Material dev-skip'],
      selectedPages: {}, adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80, evalPreference: 'mix_everything', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, academicDomain: 'general', blocks: [{ id: 'block-real' }], topics: [] },
      journey, currentSessionNumber: 2, currentStep: 0, completedSessionNumbers: [], status: 'in_progress', adaptiveState: 'studying',
      isProgramComplete: false, unresolvedMicroIds: [], sessionContent: { '2': learning }, recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId, learning })
}

async function readAssessmentBlueprint(page: Page) {
  return page.evaluate(({ sessionId }) => {
    const raw = localStorage.getItem('studyal_adaptive_artifacts_v1')
    if (!raw) return null
    const artifacts = JSON.parse(raw)
    const sessionContent = artifacts?.[sessionId]?.sessionContent
    return sessionContent?.['2']?.assessmentBlueprint ?? null
  }, { sessionId })
}

test('1: botón dev visible en development; 3-7: cada formato usa la respuesta canónica real; 9: evidencia se registra normalmente; 10: mastery nunca se fija a mano', async ({ page }) => {
  await installSession(page)
  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)

  // 1: visible en development.
  await expect(page.getByTestId('dev-skip-teaching-step')).toBeVisible()
  await expect(page.getByText('Paso sin visual')).toBeVisible()
  await page.getByTestId('dev-skip-teaching-step').click()

  // Visual required_for_mastery: "Siguiente (dev)" debe quedar deshabilitado hasta
  // resolver el visual — nunca bypass del gating.
  await expect(page.getByText('Paso con visual requerido')).toBeVisible()
  await expect(page.getByTestId('dev-skip-teaching-step')).toBeDisabled()
  await expect(page.getByTestId('session-primary-action')).toBeDisabled()
  await page.getByTestId('dev-resolve-visual').click()
  await expect(page.getByTestId('dev-skip-teaching-step')).toBeEnabled()
  await page.getByTestId('dev-skip-teaching-step').click()

  const blueprintBefore = await readAssessmentBlueprint(page)
  const objectivesBefore = blueprintBefore.objectives.filter((o: any) => o.demonstratedFactKeys?.length)
  expect(objectivesBefore.length, '10: antes de resolver ninguna pregunta con dev-skip, mastery/evidence debe seguir en cero — nada se fija a mano al cargar').toBe(0)

  // 3-7: MCQ, matching, ordering, numeric, short_response — dev-resolve cada una.
  for (let i = 0; i < allQuestions.length; i++) {
    await expect(page.getByTestId('dev-resolve-question')).toBeVisible()
    await page.getByTestId('dev-resolve-question').click()
    await expect(page.getByText('✅ ¡Correcto!')).toBeVisible()
    if (i < allQuestions.length - 1) {
      await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
    }
  }

  // 9: evidencia registrada normalmente — EXACTAMENTE los 5 factKeys demostrados,
  // ni de más (mastery inflada) ni de menos (evidencia perdida).
  const blueprintAfter = await readAssessmentBlueprint(page)
  const demonstrated = new Set(blueprintAfter.objectives.flatMap((o: any) => o.demonstratedFactKeys || []))
  expect([...demonstrated].sort()).toEqual([...factKeys].sort())

  // 11: la sesión NO se completa sola — sigue exigiendo la transición real
  // (evaluateSessionCompletion/deriveNextSessionAction vía el botón "🎉 Terminar").
  await expect(page.getByText('Sesión completada')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '🎉 Terminar' })).toBeVisible()
  await page.getByRole('button', { name: '🎉 Terminar' }).click()
  await expect(page.getByText('Sesión completada')).toBeVisible()
})

test('13: restore después de dev-skip conserva el progreso (evidencia + paso)', async ({ page }) => {
  await installSession(page)
  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)
  await page.getByTestId('dev-skip-teaching-step').click()
  await page.getByTestId('dev-resolve-visual').click()
  await page.getByTestId('dev-skip-teaching-step').click()
  await page.getByTestId('dev-resolve-question').click()
  await expect(page.getByText('✅ ¡Correcto!')).toBeVisible()

  const blueprintBeforeReload = await readAssessmentBlueprint(page)
  const demonstratedBefore = new Set(blueprintBeforeReload.objectives.flatMap((o: any) => o.demonstratedFactKeys || []))
  expect(demonstratedBefore.has(mcq.factKey)).toBe(true)

  await page.reload()
  await expect(page.getByText('Siguiente pregunta →').or(page.getByText('✅ ¡Correcto!'))).toBeVisible({ timeout: 10000 }).catch(() => {})
  const blueprintAfterReload = await readAssessmentBlueprint(page)
  const demonstratedAfter = new Set(blueprintAfterReload.objectives.flatMap((o: any) => o.demonstratedFactKeys || []))
  expect(demonstratedAfter.has(mcq.factKey), '13: el factKey demostrado por dev-skip antes del reload debe sobrevivir el restore').toBe(true)
})

// ===========================================================================
// 12 — recovery se puede recorrer sin romper state. Dispara UNA recovery real
// (fallo genuino, click real — no dev tool, para no fabricar el trigger) y luego
// usa el botón dev SOLO para resolver la verificación de recovery — mismo
// currentQuestion/submitAnswer/activeRecoveryId que la ruta normal (ver
// isIndependentEvaluationActive en page.tsx, que ya trata evaluación normal y
// recovery de forma unificada). Fixture modelada sobre
// session-completion-edge-cases.spec.ts (failingCount:1).
// ===========================================================================
function recoveryQuestion(id: string, correctAnswer: string) {
  const recStepId = 'node-dev-skip-recovery'
  return {
    id, conceptId: recStepId, conceptLabel: 'Recovery', teachingBlockId: recStepId,
    questionFamily: id, variant: 'mcq_best_answer', difficulty: 'easy',
    targetDimension: 'comprehension', format: 'multiple_choice',
    questionText: `Pregunta ${id}.`, explanation: 'Explicación.', hint: '',
    estimatedSeconds: 20, evidencesNeeded: 1, factKey: `${recStepId}:${id}`, factKeys: [`${recStepId}:${id}`],
    targetObjectiveIds: [], evidenceProduced: [], coveredStepIds: [recStepId], coveredKeyPoints: ['punto recovery'],
    options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctAnswer,
  }
}

test('12: recovery se puede recorrer con el botón dev sin romper el state', async ({ page }) => {
  const recSessionId = 'e2e-dev-skip-recovery-session'
  const recTemaId = 'e2e-dev-skip-recovery-tema'
  const recStepId = 'node-dev-skip-recovery'
  const recAssessment = buildAssessmentBlueprint(
    [{ id: recStepId, title: 'Concepto recovery', content: 'Contenido enseñado.', keyPoints: ['punto recovery'], factKeys: [`${recStepId}:q-fail`], importance: 0.8 }],
    recSessionId, 1,
  )
  const recObjectiveId = recAssessment.objectives[0].objectiveId
  const failingQuestion = { ...recoveryQuestion('q-fail', 'a'), targetObjectiveIds: [recObjectiveId], evidenceProduced: [recObjectiveId] }
  const recoveryLearning = {
    sessionId: 'chapter-dev-skip-recovery', sessionTitle: 'Sesión recovery dev-skip', sessionNumber: 2,
    sessionKind: 'learning', materialType: 'general', academicDomain: 'general',
    sessionIntro: 'Inicio.',
    steps: [{ id: recStepId, type: 'concept', title: 'Concepto recovery', content: 'Contenido enseñado.', keyPoints: ['punto recovery'], importance: 'critical', relatedBlockIds: [] }],
    sessionClosing: 'Cierre.', totalSteps: 1, assessmentBlueprint: recAssessment,
    evaluationBlocks: [{ id: 'block-recovery', afterStepId: recStepId, coveredStepIds: [recStepId], coveredKeyPoints: ['punto recovery'], questions: [failingQuestion] }],
    evaluationProgress: {}, recoveryQueue: [],
  }

  let reteachCalls = 0
  await page.route('**/api/study-sessions**', route =>
    route.fulfill({ json: route.request().method() === 'GET' ? { success: true, sessions: [] } : { success: true } }))
  await page.route('**/api/adaptive/session-teach', route => route.fulfill({ json: { success: true, classContent: recoveryLearning } }))
  await page.route('**/api/adaptive/session-check', route => {
    const body = route.request().postDataJSON()
    const result = scoreQuestion(body.question, body.answer)
    return route.fulfill({ json: { success: true, result: { outcome: result.outcome, correct: result.correct, score: result.score, feedback: result.correct ? 'Respuesta correcta.' : 'Respuesta incorrecta.', errorType: result.errorType } } })
  })
  await page.route('**/api/adaptive/session-reteach', route => {
    reteachCalls += 1
    const body = route.request().postDataJSON()
    const round = reteachCalls
    const verify = (n: number) => ({
      ...recoveryQuestion(`recovery-${round}-${n}`, 'a'),
      factKey: body.target.sourceFactKeys[0], factKeys: body.target.sourceFactKeys,
      coveredKeyPoints: body.target.sourceKeyPoints, coveredKeyPointIds: body.target.sourceKeyPointIds,
      targetObjectiveIds: [recObjectiveId], evidenceProduced: [recObjectiveId],
    })
    return route.fulfill({ json: {
      success: true, recoveryId: body.recoveryId, recoveryTargetId: body.recoveryTargetId,
      roundId: body.roundId, roundNumber: round,
      explanation: 'Reexplicación específica del punto fallado.',
      questions: [verify(1), verify(2)], target: body.target,
      provider: 'openrouter', model: 'google/gemini-2.5-flash', generationKey: body.generationKey, preparedAt: Date.now(),
    } })
  })
  await page.addInitScript(({ sessionId, temaId, learning }) => {
    const existingSessions = JSON.parse(localStorage.getItem('studyal_sessions_v4') || '{}')
    if (existingSessions[sessionId]) return
    const journey = {
      id: 'journey_dev_skip_recovery', version: 1,
      chapters: [{ id: 'chapter-dev-skip-recovery', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['block-real'], unitIds: ['unit-real'] }],
      totalChapters: 1,
    }
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['material-dev-skip-recovery'], primaryMaterialId: 'material-dev-skip-recovery', materialNames: ['Material recovery'],
      selectedPages: {}, adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80, evalPreference: 'quick_test', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, academicDomain: 'general', blocks: [{ id: 'block-real' }], topics: [] },
      journey, currentSessionNumber: 2, currentStep: 0, completedSessionNumbers: [], status: 'in_progress', adaptiveState: 'studying',
      isProgramComplete: false, unresolvedMicroIds: [], sessionContent: { '2': learning }, recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey, sessionContent: session.sessionContent } }))
  }, { sessionId: recSessionId, temaId: recTemaId, learning: recoveryLearning })

  await page.goto(`/materias/${recTemaId}/sesion/2?adaptiveSessionId=${recSessionId}`)

  // Transición real teaching -> evaluating (proceedToNextStep detecta el bloque
  // de evaluación pendiente tras el único step de este fixture).
  await page.getByTestId('session-primary-action').click()

  // Falla REAL (click genuino del usuario, no dev tool) para disparar recovery
  // por el camino real — el dev tool solo debe intervenir DESPUÉS, en la
  // verificación, nunca en la generación/disparo de la recovery misma.
  // failingQuestion.correctAnswer === 'a' ("A"), así que "B" es la opción incorrecta.
  await page.getByRole('button', { name: 'B' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.getByRole('button', { name: 'Revisar conceptos →' }).click()
  await expect(page.getByText('📖 Reexplicación')).toBeVisible()
  await page.getByRole('button', { name: 'Verificar comprensión →' }).click()

  // Ahora sí: el botón dev resuelve la verificación de recovery.
  await expect(page.getByTestId('dev-resolve-question')).toBeVisible()
  await page.getByTestId('dev-resolve-question').click()
  await expect(page.getByText('✅ ¡Correcto!')).toBeVisible()

  // El state no se rompió: la sesión sigue siendo usable y llega a un estado
  // terminal real (Terminar) sin errores ni pantallas rotas.
  await expect(page.getByText('Algo salió mal')).toHaveCount(0)
  await expect(page.getByText('No pudimos preparar esta sesión')).toHaveCount(0)
})
