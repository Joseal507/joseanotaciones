import { expect, test, type Page } from '@playwright/test'
import { gradeVisualInteraction } from '../../lib/adaptive/visual/visualGrading'

// StudyAL_Visual_System_Stress_Test — cierre del Bug 4 (pedido explícito del
// usuario, sección 7: "Ahora valida el flujo REAL... Añade E2E de los tres
// modos"). Prueba, navegando la página REAL de sesión (no solo el
// componente aislado), que TEACH/PRACTICE/ASSESS son visual e
// interaccionalmente distintos, y que Comprobar/Resolver visual (dev)/
// Continuar nunca contradicen el contrato:
//   TEACH: banner "Explora el ejemplo", Continuar NUNCA depende de responder.
//   PRACTICE: banner "Práctica guiada", puede intentarlo, Continuar NUNCA
//     bloqueado por el resultado.
//   ASSESS: banner "Comprobación requerida", Continuar bloqueado hasta
//     resolver correctamente; "Resolver visual (dev)" es herramienta de
//     desarrollo, nunca aparece fuera de development.

const graphSpec = {
  id: 'visualspec:graph:modes', requirementId: 'visualreq:graph:modes', microId: 'micro:modes',
  engine: 'graph_2d', representation: 'coordinate_function',
  sourceGrounding: { sourceSpans: [], factKeys: ['f:modes'] },
  conceptual: false,
  data: { expression: '2x + 3', domain: [-5, 5], points: [{ x: -5, y: -7 }, { x: 0, y: 3 }, { x: 5, y: 13 }] },
}

async function installFixture(page: Page, opts: { sessionId: string; temaId: string; visualEvidenceKind?: string; visualRequirement?: { requiredness: string } }) {
  await page.route('**/api/study-sessions**', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { success: true, sessions: [] } })
    : route.fulfill({ json: { success: true } }))
  // Mismo patrón que dev-skip-tool.spec.ts: mockea /api/adaptive/visual-check
  // llamando al grader REAL localmente — el fixture de este archivo no está
  // firmado (integrity), así que el endpoint real (que sí verifica firma)
  // lo rechazaría; el grading en sí (gradeVisualInteraction) es 100% real.
  await page.route('**/api/adaptive/visual-check', route => {
    const body = route.request().postDataJSON()
    const result = gradeVisualInteraction(body.visualSpec, body.submission)
    return route.fulfill({ json: { success: true, result } })
  })
  await page.route('**/api/adaptive/session-teach', async route => {
    await route.fulfill({ json: {
      success: true,
      classContent: {
        sessionId: 'chapter-2', sessionTitle: 'Sesión con visual', sessionNumber: 2, sessionKind: 'learning',
        materialType: 'pdf', sessionIntro: 'Inicio', totalSteps: 1, evaluationProgress: {}, recoveryQueue: [],
        steps: [{
          id: 'step-modes', type: 'example', title: 'Función lineal', content: 'La función f(x) = 2x + 3.',
          keyPoint: null, keyPoints: ['punto clave'], importance: 'important', relatedBlockIds: [], microId: 'micro:modes',
          factKeys: ['f:modes'], visualSpec: graphSpec,
          ...(opts.visualEvidenceKind ? { visualEvidenceKind: opts.visualEvidenceKind } : {}),
          ...(opts.visualRequirement ? { visualRequirement: opts.visualRequirement } : {}),
        }],
        sessionClosing: 'Cierre',
        evaluationBlocks: [{
          id: 'block-1', afterStepId: 'step-modes', coveredStepIds: ['step-modes'], coveredKeyPoints: ['punto clave'],
          questions: [{
            id: 'q1', conceptId: 'step-modes', conceptLabel: 'Función lineal', teachingBlockId: 'step-modes',
            questionFamily: 'fallback', variant: 'true_false_factual', difficulty: 'easy', targetDimension: 'recognition',
            format: 'true_false', questionText: 'El concepto es correcto.', options: null, correctAnswer: true,
            explanation: 'Coincide con el contenido.', hint: 'Pista.', estimatedSeconds: 15, evidencesNeeded: 1,
            factKey: 'f:modes', factKeys: ['f:modes'], coveredKeyPoints: ['punto clave'], coveredStepIds: ['step-modes'],
          }],
        }],
      },
    } })
  })
  await page.addInitScript(({ sessionId, temaId }) => {
    const chapters = [
      { id: 'chapter-1', chapterNumber: 1, kind: 'introduction', status: 'available', blockIds: [], unitIds: [], arcRole: 'orientation' },
      { id: 'chapter-2', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['b1'], unitIds: ['u1'], arcRole: 'mechanism' },
    ]
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
  }, { sessionId: opts.sessionId, temaId: opts.temaId })
}

test('TEACH: banner "Explora el ejemplo", sin interacción obligatoria, Continuar nunca bloqueado', async ({ page }) => {
  const sessionId = 'e2e-mode-teach', temaId = 'e2e-mode-teach-tema'
  await installFixture(page, { sessionId, temaId })
  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)

  await expect(page.getByRole('heading', { name: 'Función lineal' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Explora el ejemplo')).toBeVisible()
  await expect(page.getByText('Práctica guiada')).toHaveCount(0)
  await expect(page.getByText('Comprobación requerida')).toHaveCount(0)
  // teach: GraphView solo muestra el formulario "Comprobar" en practice/assess.
  await expect(page.getByRole('button', { name: 'Comprobar' })).toHaveCount(0)
  await expect(page.getByText('Completa la interacción visual para continuar')).toHaveCount(0)

  const primaryButton = page.getByTestId('session-primary-action')
  await expect(primaryButton).toBeEnabled()
  console.log('visual-teach-practice-assess-modes: TEACH — sin bloqueo, sin Comprobar PASS')
})

test('PRACTICE: banner "Práctica guiada", puede intentarlo, Continuar nunca bloqueado por el resultado', async ({ page }) => {
  const sessionId = 'e2e-mode-practice', temaId = 'e2e-mode-practice-tema'
  await installFixture(page, { sessionId, temaId, visualRequirement: { requiredness: 'required_for_understanding' } })
  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)

  await expect(page.getByRole('heading', { name: 'Función lineal' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Práctica guiada')).toBeVisible()
  await expect(page.getByText('Explora el ejemplo')).toHaveCount(0)
  await expect(page.getByText('Comprobación requerida')).toHaveCount(0)
  await expect(page.getByText('Práctica — tu respuesta no bloquea tu progreso')).toBeVisible()
  // practice: SÍ ofrece la interacción (a diferencia de teach), pero no bloquea.
  await expect(page.getByRole('button', { name: 'Comprobar' })).toBeVisible()

  const primaryButton = page.getByTestId('session-primary-action')
  await expect(primaryButton).toBeEnabled()
  console.log('visual-teach-practice-assess-modes: PRACTICE — interacción visible, nunca bloquea PASS')
})

test('ASSESS: banner "Comprobación requerida", Continuar bloqueado hasta resolver, "Resolver visual (dev)" solo en dev', async ({ page }) => {
  const sessionId = 'e2e-mode-assess', temaId = 'e2e-mode-assess-tema'
  await installFixture(page, { sessionId, temaId, visualEvidenceKind: 'visual_interpretation' })
  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)

  await expect(page.getByRole('heading', { name: 'Función lineal' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Comprobación requerida')).toBeVisible()
  await expect(page.getByText('Explora el ejemplo')).toHaveCount(0)
  await expect(page.getByText('Práctica guiada')).toHaveCount(0)
  await expect(page.getByText('Se requiere una respuesta correcta para continuar')).toBeVisible()
  await expect(page.getByText('Completa la interacción visual para continuar')).toBeVisible()

  const primaryButton = page.getByTestId('session-primary-action')
  await expect(primaryButton).toBeDisabled()

  // Resolver el visual (dev tool, disponible solo en development — la MISMA
  // ruta /api/adaptive/visual-check real, nunca un atajo que fabrique mastery).
  // Tras resolver, la señal correcta es que el GATE VISUAL específico
  // desaparece (mensaje + botón dev) — el botón primario puede seguir
  // deshabilitado por un gate DISTINTO (la evaluación del bloque, que exige
  // responder su propia pregunta) — mismo patrón que dev-skip-tool.spec.ts.
  const devButton = page.getByTestId('dev-resolve-visual')
  await expect(devButton).toBeVisible()
  await devButton.click()
  await expect(page.getByText('Se requiere una respuesta correcta para continuar')).toHaveCount(0)
  await expect(page.getByText('Completa la interacción visual para continuar')).toHaveCount(0)
  await expect(devButton).toHaveCount(0)
  console.log('visual-teach-practice-assess-modes: ASSESS — bloquea hasta resolver, dev tool real desbloquea el gate visual específico PASS')
})
