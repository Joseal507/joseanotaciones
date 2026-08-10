import { expect, test, type Page } from '@playwright/test'

// Misión: cerrar el gap "error/fallback" del reporte anterior con pruebas reales de
// navegador (no solo unit tests de las funciones de grading). Un VisualSpec
// malformado (`data` sin los campos que GraphView necesita) llega tal cual del mock
// de session-teach — igual que llegaría de cualquier fuente que produjera un spec
// roto en producción — y probamos que:
//   A) la sesión NUNCA crashea (el error boundary de VisualRenderer lo atrapa);
//   B) se muestra un fallback textual/accesible en su lugar;
//   C) si el step era required_for_mastery, el fallback NUNCA permite avanzar sin
//      evidencia real (no false-masters);
//   D) si el step era supportive, la sesión continúa con total normalidad.

function chapters() {
  return [
    { id: 'chapter-1', chapterNumber: 1, kind: 'introduction', status: 'available', blockIds: [], unitIds: [], arcRole: 'orientation' },
    { id: 'chapter-2', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['b1'], unitIds: ['u1'], arcRole: 'mechanism' },
  ]
}

const malformedVisualSpec = {
  id: 'visualspec:broken:1', requirementId: 'visualreq:broken', microId: 'micro:broken',
  engine: 'graph_2d', representation: 'coordinate_function',
  sourceGrounding: { sourceSpans: [], factKeys: ['f:broken'] },
  conceptual: false,
  // `data` deliberadamente sin domain/points — GraphView hace
  // `const [domainMin, domainMax] = data.domain` y lanza al desestructurar undefined.
  data: {},
}

async function installFixture(page: Page, sessionId: string, temaId: string, visualEvidenceKind: string | undefined) {
  await page.route('**/api/study-sessions**', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { success: true, sessions: [] } })
    : route.fulfill({ json: { success: true } }))
  await page.route('**/api/adaptive/session-teach', async route => {
    await route.fulfill({ json: {
      success: true,
      classContent: {
        sessionId: 'chapter-2', sessionTitle: 'Sesión con visual roto', sessionNumber: 2, sessionKind: 'learning',
        materialType: 'pdf', sessionIntro: 'Inicio', totalSteps: 1, evaluationProgress: {}, recoveryQueue: [],
        steps: [{
          id: 'step-broken', type: 'concept', title: 'Concepto con visual', content: 'Contenido del concepto con visual roto.',
          keyPoint: null, keyPoints: ['punto clave'], importance: 'important', relatedBlockIds: [], microId: 'micro:broken',
          factKeys: ['f:broken'], visualSpec: malformedVisualSpec, ...(visualEvidenceKind ? { visualEvidenceKind } : {}),
        }],
        sessionClosing: 'Cierre',
        evaluationBlocks: [{
          id: 'block-1', afterStepId: 'step-broken', coveredStepIds: ['step-broken'], coveredKeyPoints: ['punto clave'],
          questions: [{
            id: 'q1', conceptId: 'step-broken', conceptLabel: 'Concepto con visual', teachingBlockId: 'step-broken',
            questionFamily: 'fallback', variant: 'true_false_factual', difficulty: 'easy', targetDimension: 'recognition',
            format: 'true_false', questionText: 'El concepto es correcto.', options: null, correctAnswer: true,
            explanation: 'Coincide con el contenido.', hint: 'Pista.', estimatedSeconds: 15, evidencesNeeded: 1,
            factKey: 'f:broken', factKeys: ['f:broken'], coveredKeyPoints: ['punto clave'], coveredStepIds: ['step-broken'],
          }],
        }],
      },
    } })
  })
  await page.route('**/api/adaptive/session-check', async route => {
    const body = route.request().postDataJSON()
    const correct = body.answer === body.question.correctAnswer
    return route.fulfill({ json: { success: true, result: { outcome: correct ? 'correct' : 'incorrect', correct, score: correct ? 100 : 0, feedback: 'ok', errorType: null } } })
  })
  await page.addInitScript(({ sessionId, temaId, chapters }) => {
    if (localStorage.getItem('studyal_sessions_v4')?.includes(sessionId)) return
    const introContent = {
      sessionId: 'chapter-1', sessionTitle: 'Introducción', sessionNumber: 1, sessionKind: 'introduction', materialType: 'pdf',
      sessionIntro: 'Inicio', steps: [{ id: '1-a', type: 'intro', title: 'Bienvenida', content: 'Contenido de bienvenida.', keyPoint: null, keyPoints: [], importance: 'supporting', relatedBlockIds: [] }],
      sessionClosing: 'Cierre', totalSteps: 1, evaluationBlocks: [], evaluationProgress: {}, recoveryQueue: [],
    }
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['fallback-material'], primaryMaterialId: 'fallback-material', materialNames: ['Material Fallback'], selectedPages: {},
      adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80, mainConcern: '', professorExamStyle: [], evalPreference: 'quick_test', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, blocks: [{ id: 'b1' }], topics: [] },
      journey: { id: 'fallback-plan', version: 1, chapters, totalChapters: 2 },
      currentSessionNumber: 1, currentStep: 0, completedSessionNumbers: [], status: 'in_progress', adaptiveState: 'studying',
      isProgramComplete: false, unresolvedMicroIds: [],
      sessionContent: { '1': introContent },
      recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey: session.journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId, chapters: chapters() })
}

// ---------------------------------------------------------------------------
// A/C: visual REQUIRED_FOR_MASTERY roto — no crash, fallback accesible, y el
// fallback NUNCA permite avanzar (no false-masters) sin evidencia real.
// ---------------------------------------------------------------------------
test('visual renderer fallback: required_for_mastery roto no crashea y no permite avanzar sin evidencia', async ({ page }) => {
  const sessionId = 'e2e-fallback-required'
  const temaId = 'e2e-fallback-required-tema'
  await installFixture(page, sessionId, temaId, 'visual_construction')

  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)

  // A) La sesión NUNCA crashea — el título/contenido del step siguen visibles pese
  // al VisualSpec malformado, y NUNCA se muestra la pantalla de error de nivel de
  // página ("💥 Algo salió mal"). Nota: React en modo desarrollo re-emite el error ya
  // manejado por el boundary hacia window.onerror (para DevTools) aunque la UI se
  // haya recuperado correctamente — por eso no se afirma sobre pageerror aquí, solo
  // sobre lo que el usuario realmente ve.
  await expect(page.getByRole('heading', { name: 'Concepto con visual' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Algo salió mal')).toHaveCount(0)

  // B) Fallback textual/accesible visible en vez del render roto.
  await expect(page.getByText('No se pudo mostrar el visual — descripción del contenido:')).toBeVisible()

  // C) El botón "Continuar" permanece deshabilitado — el fallback nunca satisface
  // el checkpoint required_for_mastery (no false-master).
  const primaryButton = page.getByTestId('session-primary-action')
  await expect(primaryButton).toBeDisabled()
  await expect(page.getByText('Completa la interacción visual para continuar.')).toBeVisible()
  console.log('visual-renderer-fallback: required_for_mastery roto -> no crash, fallback accesible, Continuar sigue bloqueado PASS')
})

// ---------------------------------------------------------------------------
// D: visual SUPPORTIVE roto — la sesión continúa con total normalidad (nunca
// bloquea, ni siquiera cuando el render del visual falla).
// ---------------------------------------------------------------------------
test('visual renderer fallback: supportive roto nunca bloquea la sesión', async ({ page }) => {
  const sessionId = 'e2e-fallback-supportive'
  const temaId = 'e2e-fallback-supportive-tema'
  await installFixture(page, sessionId, temaId, undefined)

  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)

  await expect(page.getByRole('heading', { name: 'Concepto con visual' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Algo salió mal')).toHaveCount(0)
  await expect(page.getByText('No se pudo mostrar el visual — descripción del contenido:')).toBeVisible()

  // El botón "Continuar" NUNCA se deshabilita por un visual supportive, roto o no.
  const primaryButton = page.getByTestId('session-primary-action')
  await expect(primaryButton).toBeEnabled()
  await primaryButton.click()
  // Avanza normalmente a la evaluación del bloque (prueba que la sesión sigue
  // siendo 100% usable tras el fallo de render).
  await expect(page.getByText('El concepto es correcto.')).toBeVisible({ timeout: 10_000 })
  console.log('visual-renderer-fallback: supportive roto -> sesión sigue 100% usable, Continuar nunca bloqueado PASS')
})
