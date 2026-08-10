import { expect, test, type Page } from '@playwright/test'
import { buildAssessmentBlueprint } from '../../lib/adaptive/evaluation/assessmentBlueprint'
import { scoreQuestion } from '../../lib/adaptive/evaluation/scoring'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'

// AUDITORÍA ADVERSARIAL CODEX — Finding 1 (P0, CONFIRMED): el hint se
// renderiza automáticamente (sin interacción, sin tracking) siempre que
// currentQuestion.hint exista y el estudiante no haya terminado de responder.
// Ambos call sites que registran evidencia (recordNormalAnswerOutcome,
// recordRecoveryVerificationOutcome) hardcodeaban independent:true de forma
// incondicional — una respuesta correcta vista con pista contaba exactamente
// igual que una genuinamente independiente, pudiendo demostrar factKeys y
// resolver recovery sin evidencia real de comprensión autónoma.
//
// Fix: hintShownRef en page.tsx — solo se marca true cuando el bloque de
// pista REALMENTE se renderiza para la pregunta activa (misma condición que
// el JSX), se resetea en cada cambio de pregunta, y alimenta `independent`/
// `assistanceLevel` en ambos call sites en vez del literal hardcodeado.
//
// Este test prueba el camino NORMAL (no-recovery) end-to-end contra el
// pipeline real: Q1 tiene hint y se responde correctamente -> NO debe
// demostrar el factKey. Q2 (misma objective/factKey, SIN hint) se responde
// correctamente -> SÍ debe demostrarlo. Confirma también, como control
// empírico (no asumido), que el hint efectivamente se renderiza para Q1 y NO
// para Q2 en la UI real.

const temaId = 'e2e-hint-independence-tema'
const sessionId = 'e2e-hint-independence-session'
const stepId = 'node-hint-independence'
const sharedFactKey = 'fact-hint-independence-shared'
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

async function installHintIndependenceSession(page: Page) {
  const assessment = buildAssessmentBlueprint(
    [{ id: stepId, title: 'Concepto compartido', content: 'Contenido del concepto compartido.', keyPoints, factKeys: keyPoints, importance: 0.8 }],
    'chapter-hint', 2,
  )
  const objectiveIds = assessment.objectives.map(objective => objective.objectiveId)

  const questionWithHint: CanonicalQuestion = {
    id: 'q-with-hint', conceptId: stepId, conceptLabel: 'Concepto compartido', teachingBlockId: stepId,
    questionFamily: 'mcq_best_answer', variant: 'mcq_best_answer', difficulty: 'medium',
    targetDimension: 'comprehension', questionText: 'Primera pregunta — con pista visible.',
    explanation: 'Explicación 1.', hint: 'Esta es la pista visible para la primera pregunta.',
    estimatedSeconds: 30, evidencesNeeded: 1, factKey: sharedFactKey, factKeys: keyPoints,
    targetObjectiveIds: objectiveIds, evidenceProduced: objectiveIds, coveredStepIds: [stepId], coveredKeyPoints: keyPoints,
    format: 'multiple_choice', options: [{ id: 'a', text: 'Opción correcta uno' }, { id: 'b', text: 'Opción incorrecta uno' }], correctAnswer: 'a',
  } as CanonicalQuestion

  const questionWithoutHint: CanonicalQuestion = {
    id: 'q-without-hint', conceptId: stepId, conceptLabel: 'Concepto compartido', teachingBlockId: stepId,
    questionFamily: 'mcq_best_answer', variant: 'mcq_best_answer', difficulty: 'medium',
    targetDimension: 'comprehension', questionText: 'Segunda pregunta — sin pista.',
    explanation: 'Explicación 2.', hint: '',
    estimatedSeconds: 30, evidencesNeeded: 1, factKey: sharedFactKey, factKeys: keyPoints,
    targetObjectiveIds: objectiveIds, evidenceProduced: objectiveIds, coveredStepIds: [stepId], coveredKeyPoints: keyPoints,
    format: 'multiple_choice', options: [{ id: 'a', text: 'Opción correcta dos' }, { id: 'b', text: 'Opción incorrecta dos' }], correctAnswer: 'a',
  } as CanonicalQuestion

  const learning = {
    sessionId: 'chapter-hint', sessionTitle: 'Concepto compartido — aprendizaje', sessionNumber: 2,
    sessionKind: 'learning', materialType: 'general', academicDomain: 'general',
    sessionIntro: 'Aprendizaje del concepto compartido.',
    steps: [{ id: stepId, type: 'concept', title: 'Concepto compartido', content: 'Explicación del concepto compartido.', keyPoints, importance: 'critical', relatedBlockIds: ['block-real'] }],
    sessionClosing: 'Integración terminada.', totalSteps: 1, assessmentBlueprint: assessment,
    evaluationBlocks: [{ id: 'block-real', afterStepId: stepId, coveredStepIds: [stepId], coveredKeyPoints: keyPoints, questions: [questionWithHint, questionWithoutHint] }],
    evaluationProgress: {}, recoveryQueue: [],
  }

  await page.route('**/api/study-sessions**', route =>
    route.fulfill({ json: route.request().method() === 'GET' ? { success: true, sessions: [] } : { success: true } }))
  await page.route('**/api/adaptive/session-teach', route => route.fulfill({ json: { success: true, classContent: learning } }))
  // El scorer es el REAL de producto (mismo que session-check/route.ts) — el mock
  // de red solo reemplaza el transporte HTTP, no la lógica de corrección.
  await page.route('**/api/adaptive/session-check', route => {
    const body = route.request().postDataJSON()
    const result = scoreQuestion(body.question, body.answer)
    return route.fulfill({ json: { success: true, result: { outcome: result.outcome, correct: result.correct, score: result.score, feedback: result.correct ? 'Respuesta correcta.' : 'Respuesta incorrecta.', errorType: result.errorType } } })
  })
  await page.addInitScript(({ sessionId, temaId, learning }) => {
    const journey = { id: 'journey_hint_e2e', version: 4, chapters: [{ id: 'chapter-hint', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['block-real'], unitIds: ['unit-real'] }], totalChapters: 1 }
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['material-hint'], primaryMaterialId: 'material-hint', materialNames: ['Concepto compartido'],
      selectedPages: {}, adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80, evalPreference: 'mix_everything', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, academicDomain: 'general', blocks: [{ id: 'block-real' }], topics: [] },
      journey, currentSessionNumber: 2, currentStep: 0, completedSessionNumbers: [], status: 'in_progress', adaptiveState: 'studying',
      isProgramComplete: false, unresolvedMicroIds: [], sessionContent: { '2': learning }, recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId, learning })
}

test('hint visible en una pregunta correcta NO demuestra el factKey; una pregunta posterior sin pista correcta SÍ lo demuestra', async ({ page }) => {
  await installHintIndependenceSession(page)
  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Paso 1 de 1')).toBeVisible()
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()

  // La pista es opt-in: NO debe estar visible hasta que se pida
  // explícitamente (de lo contrario "asistido" sería el estado por defecto
  // de cualquier pregunta con hint, que es la inmensa mayoría del contenido
  // real generado).
  await expect(page.getByText('Esta es la pista visible para la primera pregunta.')).toHaveCount(0)
  await page.getByRole('button', { name: 'Ver pista' }).click()
  await expect(page.getByText('Esta es la pista visible para la primera pregunta.')).toBeVisible()

  await page.getByRole('button', { name: 'Opción correcta uno' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await expect(page.getByText('✅ ¡Correcto!')).toBeVisible()

  const afterHintedAnswer = await readAssessmentBlueprint(page)
  const objectiveAfterHint = afterHintedAnswer.objectives.find((o: any) => o.factKeys.includes(sharedFactKey))
  expect(objectiveAfterHint.demonstratedFactKeys, 'una respuesta correcta vista con pista NO debe demostrar el factKey').not.toContain(sharedFactKey)
  expect(afterHintedAnswer.demonstratedObjectiveIds, 'el objective tampoco debe quedar demostrado solo por una respuesta asistida').not.toContain(objectiveAfterHint.objectiveId)

  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()

  // Control empírico: Q2 NO tiene hint -> el bloque de pista no debe existir.
  await expect(page.getByText('💡')).toHaveCount(0)

  await page.getByRole('button', { name: 'Opción correcta dos' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await expect(page.getByText('✅ ¡Correcto!')).toBeVisible()

  const afterIndependentAnswer = await readAssessmentBlueprint(page)
  const objectiveAfterIndependent = afterIndependentAnswer.objectives.find((o: any) => o.factKeys.includes(sharedFactKey))
  expect(objectiveAfterIndependent.demonstratedFactKeys, 'una respuesta correcta SIN pista sí debe demostrar el factKey').toContain(sharedFactKey)
})
