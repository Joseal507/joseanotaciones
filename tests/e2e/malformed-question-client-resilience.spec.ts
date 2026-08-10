import { expect, test, type Page } from '@playwright/test'
import { buildAssessmentBlueprint } from '../../lib/adaptive/evaluation/assessmentBlueprint'

// AUDITORÍA FINAL (misión de cierre del modo Adaptativo) — sección 13 (null/
// shape fuzzing) + sección 21 (UX funcional) + P0 de sección 12 (fail-closed):
// "una pregunta malformada nunca debe tumbar toda la sesión con un
// TypeError". El ciclo anterior arregló exactamente este patrón en el
// SERVIDOR (choiceText/validateQuestion/presentAnswer, cuando options=null
// para classify). Esta auditoría encontró el MISMO patrón, sin arreglar,
// en el CLIENTE: page.tsx renderizaba currentQuestion.options.items sin
// ningún guard (a diferencia de matching, que sí comprueba
// Array.isArray(currentQuestion.options) antes de usarlo).
//
// La generación normal ya está protegida por normalizeGeneratedQuestion +
// validateQuestion (un classify malformado nunca llega al cliente por esa
// vía) — pero sesiones restauradas desde estado anterior a este hardening, o
// cualquier futura regresión que reintroduzca el problema, sí pueden colocar
// un classify con options=null directamente en localStorage/sessionContent.
// Este test simula EXACTAMENTE ese caso: intercepta session-teach para
// entregar un classify con options=null tal cual — sin pasar por ninguna
// validación de servidor (el mock reemplaza el transporte HTTP completo,
// igual que el resto de fixtures E2E de este repo) — y confirma que la
// pantalla de sesión NO crashea (cero pageerror sin capturar) y sigue
// mostrando la interfaz de la pregunta.

const temaId = 'e2e-malformed-classify-tema'
const sessionId = 'e2e-malformed-classify-session'
const stepId = 'node-clasificacion'
const keyPoints = ['Ácidos fuertes se disocian completamente en agua']

async function installMalformedClassifySession(page: Page) {
  const assessment = buildAssessmentBlueprint(
    [{ id: stepId, title: 'Ácidos fuertes', content: 'Contenido de ácidos fuertes.', keyPoints, factKeys: keyPoints, importance: 0.8 }],
    'chapter-malformed', 2,
  )
  const objectiveIds = assessment.objectives.map(objective => objective.objectiveId)
  const malformedClassifyQuestion = {
    id: 'q-malformed-classify', conceptId: stepId, conceptLabel: 'Ácidos fuertes', teachingBlockId: stepId,
    questionFamily: 'classify_category', variant: 'classify_category', difficulty: 'medium',
    targetDimension: 'comprehension', questionText: 'Clasifica cada sustancia según corresponda.',
    explanation: 'x', hint: '', estimatedSeconds: 30, evidencesNeeded: 1, factKey: keyPoints[0], factKeys: keyPoints,
    targetObjectiveIds: objectiveIds, evidenceProduced: objectiveIds, coveredStepIds: [stepId], coveredKeyPoints: keyPoints,
    // Forma real del bug encontrado en producto: normalizeClassifyOptionsForFamily
    // falla y factoryQuestions() deja options=null (correctAnswer:null también,
    // pero aquí forzamos solo options=null para aislar el crash de renderizado).
    format: 'classify', options: null, correctAnswer: null,
  }
  const learning = {
    sessionId: 'chapter-malformed', sessionTitle: 'Clasificación — aprendizaje', sessionNumber: 2,
    sessionKind: 'learning', materialType: 'chemistry', academicDomain: 'chemistry',
    sessionIntro: 'Aprendizaje de ácidos fuertes.',
    steps: [{ id: stepId, type: 'concept', title: 'Ácidos fuertes', content: 'Explicación de ácidos fuertes.', keyPoints, importance: 'critical', relatedBlockIds: ['block-real'] }],
    sessionClosing: 'Integración terminada.', totalSteps: 1, assessmentBlueprint: assessment,
    evaluationBlocks: [{ id: 'block-real', afterStepId: stepId, coveredStepIds: [stepId], coveredKeyPoints: keyPoints, questions: [malformedClassifyQuestion] }],
    evaluationProgress: {}, recoveryQueue: [],
  }
  await page.route('**/api/study-sessions**', route =>
    route.fulfill({ json: route.request().method() === 'GET' ? { success: true, sessions: [] } : { success: true } }))
  await page.route('**/api/adaptive/session-teach', route => route.fulfill({ json: { success: true, classContent: learning } }))
  await page.addInitScript(({ sessionId, temaId, learning }) => {
    const journey = { id: 'journey_malformed_e2e', version: 4, chapters: [{ id: 'chapter-malformed', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['block-real'], unitIds: ['unit-real'] }], totalChapters: 1 }
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['material-malformed'], primaryMaterialId: 'material-malformed', materialNames: ['Ácidos fuertes'],
      selectedPages: {}, adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80, evalPreference: 'mix_everything', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, academicDomain: 'chemistry', blocks: [{ id: 'block-real' }], topics: [] },
      journey, currentSessionNumber: 2, currentStep: 0, completedSessionNumbers: [], status: 'in_progress', adaptiveState: 'studying',
      isProgramComplete: false, unresolvedMicroIds: [], sessionContent: { '2': learning }, recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId, learning })
}

test('classify con options=null (pregunta malformada restaurada) no crashea la pantalla de sesión', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', error => pageErrors.push(error))

  await installMalformedClassifySession(page)
  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Paso 1 de 1')).toBeVisible()
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()

  // La pantalla de pregunta debe seguir renderizada (botón de envío visible)
  // — antes del fix, currentQuestion.options.items.map(...) lanzaba dentro
  // del render y esto nunca se alcanzaba (pantalla en blanco / overlay de
  // error de Next.js, cero contenido de producto visible).
  await expect(page.getByRole('button', { name: 'Enviar respuesta' })).toBeVisible()

  expect(pageErrors, `no debe haber excepciones sin capturar en render (encontradas: ${pageErrors.map(e => e.message).join(' | ')})`).toHaveLength(0)
})
