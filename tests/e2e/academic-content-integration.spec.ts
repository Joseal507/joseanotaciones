import { expect, test, type Page } from '@playwright/test'

const falconsSessionId = 'e2e-falcons-inline-recovery'
const falconsTemaId = 'e2e-falcons'

async function installFalconsInlineRecoveryFixture(
  page: Page,
  options: { initialActiveStudyMs?: number; normalQuestionCount?: number; realReteach?: boolean } = {},
) {
  let recoveryGeneration = 0
  await page.route('**/api/study-sessions**', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: [] }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
  })
  if (!options.realReteach) await page.route('**/api/adaptive/session-reteach', async route => {
    const body = route.request().postDataJSON()
    recoveryGeneration += 1
    const round = recoveryGeneration
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        recoveryId: body.recoveryId,
        recoveryTargetId: body.recoveryTargetId,
        roundId: body.roundId,
        roundNumber: body.recoveryRound,
        // Auditoría adversarial (Codex, Reteach #3.1): `body.reteachAttempt`
        // nunca lo envía el cliente real (envía `recoveryRound`, no
        // `reteachAttempt`) — la condición anterior siempre evaluaba
        // undefined > 1 === false, así que el mock devolvía SIEMPRE el mismo
        // texto sin importar la ronda. recordRecoveryReteachContent ahora
        // rechaza correctamente contenido duplicado entre rondas, exponiendo
        // este mismatch preexistente del fixture. `round` (contador real de
        // llamadas a este mock) sí distingue cada ronda genuinamente.
        explanation: round > 1
          ? '**Segundo enfoque sobre liderazgo.** Contrasta una actuación aislada con una trayectoria que mantiene dirección y rendimiento a lo largo del tiempo.'
          : '**Reexplicación sobre liderazgo.** La estabilidad, el liderazgo y la consistencia describen aportes diferentes y complementarios.',
        questions: body.includeVerificationQuestions ? [1, 2].map(number => ({
          id: `falcons-recovery-${round}-${number}`,
          conceptId: 'falcons-step-4',
          conceptLabel: 'Características de liderazgo de Matt Ryan',
          teachingBlockId: 'falcons-step-4',
          questionFamily: number === 1 ? 'leadership_discrimination' : 'leadership_application',
          variant: 'mcq_best_answer',
          difficulty: 'medium',
          targetDimension: 'recognition',
          format: 'multiple_choice',
          questionText: number === 1
            ? round === 1
              ? 'Ronda 1: ¿qué combinación describe mejor el aporte sostenido de Matt Ryan?'
              : 'Ronda 2: selecciona el contraste correcto entre liderazgo sostenido y un logro aislado.'
            : round === 1
              ? 'Ronda 1: ¿qué observación evidencia mejor liderazgo y consistencia durante una etapa prolongada?'
              : 'Ronda 2: aplica la idea de estabilidad a una nueva situación de equipo.',
          options: [
            { id: 'a', text: number === 1
              ? 'Estabilidad, liderazgo y consistencia.'
              : 'Mantener dirección y rendimiento estable durante más de una década.' },
            { id: 'b', text: 'Un resultado aislado sin continuidad ni liderazgo.' },
          ],
          correctAnswer: 'a',
          explanation: 'La respuesta integra la evidencia enseñada.',
          hint: 'Busca continuidad y liderazgo.',
          estimatedSeconds: 30,
          evidencesNeeded: 1,
          factKey: 'Características de liderazgo de Matt Ryan',
          factKeys: ['Características de liderazgo de Matt Ryan'],
          coveredKeyPoints: ['Características de liderazgo de Matt Ryan'],
          coveredKeyPointIds: body.target.sourceKeyPointIds,
          coveredStepIds: ['falcons-step-4'],
        })) : undefined,
        target: body.target,
        provider: 'openrouter',
        model: 'google/gemini-2.5-flash',
        generationKey: body.generationKey,
        preparedAt: Date.now(),
      }),
    })
  })
  await page.route('**/api/adaptive/session-check', async route => {
    const body = route.request().postDataJSON()
    const correct = options.realReteach && body.question.id !== 'falcons-inline-original' ? true : body.question.format === 'true_false'
      ? body.answer === true
      : body.answer === body.question.correctAnswer
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        result: {
          outcome: correct ? 'correct' : 'incorrect',
          correct,
          score: correct ? 100 : 0,
          feedback: correct ? 'Respuesta correcta.' : 'La respuesta no identifica la evidencia de liderazgo.',
          errorType: correct ? null : 'conceptual',
        },
      }),
    })
  })
  await page.route('**/api/adaptive/session-eval', async route => {
    const body = route.request().postDataJSON()
    if (!body.isReevaluation) {
      await route.fulfill({ status: 500, body: 'NORMAL_EVALUATION_MUST_NOT_CALL_SESSION_EVAL' })
      return
    }
    recoveryGeneration += 1
    const round = recoveryGeneration
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        questions: [1, 2].map(number => ({
          id: `falcons-recovery-${round}-${number}`,
          conceptId: 'falcons-leadership',
          conceptLabel: 'Características de liderazgo de Matt Ryan',
          teachingBlockId: 'falcons-step-4',
          questionFamily: number === 1 ? 'leadership_discrimination' : 'leadership_application',
          variant: 'mcq_best_answer',
          difficulty: 'medium',
          targetDimension: 'comprehension',
          format: 'multiple_choice',
          questionText: round === 1
            ? number === 1
              ? 'Ronda 1: ¿qué combinación describe mejor el aporte sostenido de Matt Ryan?'
              : 'Ronda 1: ¿qué observación evidencia mejor liderazgo y consistencia durante una etapa prolongada?'
            : number === 1
              ? 'Ronda 2: selecciona el contraste correcto entre liderazgo sostenido y un logro aislado.'
              : 'Ronda 2: aplica la idea de estabilidad a una nueva situación de equipo.',
          options: [
            { id: 'a', text: round === 1
              ? number === 1 ? 'Estabilidad, liderazgo y consistencia.' : 'Mantener dirección y rendimiento estable durante más de una década.'
              : number === 1 ? 'Una trayectoria continua orientando al equipo.' : 'Sostener decisiones y desempeño coherentes en el nuevo escenario.' },
            { id: 'b', text: round === 1 ? 'Un resultado aislado sin continuidad ni liderazgo.' : 'Una aparición puntual sin influencia continuada.' },
            { id: 'c', text: round === 1 ? 'Una característica no respaldada por el material.' : 'Una conclusión ajena a la evidencia presentada.' },
          ],
          correctAnswer: 'a',
          explanation: 'La respuesta integra la evidencia enseñada.',
          hint: 'Busca continuidad y liderazgo.',
          estimatedSeconds: 30,
          evidencesNeeded: 1,
          factKey: `falcons:leadership:round-${round}:check-${number}`,
        })),
      }),
    })
  })
  await page.addInitScript(({ sessionId, temaId, options }) => {
    if (localStorage.getItem('studyal_sessions_v4')?.includes(sessionId)) return
    const steps = Array.from({ length: 8 }, (_, index) => ({
      id: `falcons-step-${index + 1}`,
      type: 'concept',
      title: index === 3
        ? 'La era de Matt Ryan: Liderazgo y el Super Bowl LI'
        : index === 4
          ? 'La dupla imparable: Matt Ryan y Julio Jones'
          : `Paso Falcons ${index + 1}`,
      content: index === 3
        ? 'Matt Ryan aportó estabilidad, liderazgo y consistencia a los Atlanta Falcons durante más de una década.'
        : `Contenido académico del paso ${index + 1}.`,
      keyPoint: index === 3 ? 'Características de liderazgo de Matt Ryan' : `Idea ${index + 1}`,
      keyPoints: [index === 3 ? 'Características de liderazgo de Matt Ryan' : `Idea ${index + 1}`],
      importance: index === 3 ? 'critical' : 'supporting',
      relatedBlockIds: [`block-${index + 1}`],
    }))
    const classContent = {
      sessionId,
      sessionTitle: 'Falcons — Sesión 2',
      sessionNumber: 2,
      materialType: 'pdf',
      sessionIntro: 'Introducción Falcons.',
      steps,
      sessionClosing: 'Cierre Falcons.',
      totalSteps: 8,
      evaluationBlocks: [{
        id: 'falcons-evaluation-block',
        afterStepId: 'falcons-step-4',
        coveredStepIds: ['falcons-step-4'],
        coveredKeyPoints: ['Características de liderazgo de Matt Ryan'],
        questions: [{
          id: 'falcons-inline-original',
          conceptId: 'falcons-step-4',
          conceptLabel: 'Características de liderazgo de Matt Ryan',
          teachingBlockId: 'falcons-step-4',
          questionFamily: 'inline_true_false',
          variant: 'true_false_factual',
          difficulty: 'easy',
          targetDimension: 'recognition',
          format: 'true_false',
          questionText: 'Según el material, Matt Ryan aportó estabilidad, liderazgo y consistencia a los Atlanta Falcons durante más de una década.',
          options: null,
          correctAnswer: true,
          explanation: 'El material atribuye esas características a Matt Ryan.',
          hint: 'Recuerda la duración y el tipo de aporte.',
          estimatedSeconds: 15,
          evidencesNeeded: 1,
          factKey: 'Características de liderazgo de Matt Ryan',
          factKeys: ['Características de liderazgo de Matt Ryan'],
          coveredKeyPoints: ['Características de liderazgo de Matt Ryan'],
          coveredStepIds: ['falcons-step-4'],
        }, ...(options.normalQuestionCount === 3 ? [2, 3].map(number => ({
          id: `falcons-normal-${number}`,
          conceptId: 'falcons-step-4',
          conceptLabel: 'Características de liderazgo de Matt Ryan',
          teachingBlockId: 'falcons-step-4',
          questionFamily: `normal_${number}`,
          variant: 'true_false_factual',
          difficulty: 'easy',
          targetDimension: 'recognition',
          format: 'true_false',
          questionText: number === 2
            ? 'La consistencia de una trayectoria prolongada es distinta de un logro aislado.'
            : 'El liderazgo sostenido puede aportar dirección estable al equipo.',
          options: null,
          correctAnswer: true,
          explanation: 'La afirmación corresponde al punto enseñado.',
          hint: 'Distingue continuidad de un hecho aislado.',
          estimatedSeconds: 15,
          evidencesNeeded: 1,
          factKey: 'Características de liderazgo de Matt Ryan',
          factKeys: ['Características de liderazgo de Matt Ryan'],
          coveredKeyPoints: ['Características de liderazgo de Matt Ryan'],
          coveredStepIds: ['falcons-step-4'],
        })) : [])],
      }],
      evaluationProgress: {},
      recoveryQueue: [],
    }
    const session = {
      id: sessionId,
      temaId,
      enfoque: 'teorico',
      processMode: 'adaptive',
      studyMode: 'adaptive',
      materialIds: ['falcons-material'],
      materialNames: ['Falcons'],
      selectedPages: {},
      adaptiveSetup: {
        knowledgeLevel: 'never_seen',
        examDateType: 'tomorrow',
        targetScore: 100,
        mainConcern: '',
        professorExamStyle: [],
        evalPreference: 'quick_test',
        planView: 'book',
        completedAt: Date.now(),
      },
      blueprint: { version: 'e2e', topics: [], blocks: [] },
      journey: { chapters: [{ chapterNumber: 2, type: 'learning', title: 'Falcons — Sesión 2' }] },
      currentSessionNumber: 2,
      currentStep: 3,
      completedSessionNumbers: [],
      status: 'in_progress',
      adaptiveState: 'studying',
      sessionContent: { '2': classContent },
      recoveryQueues: { '2': [] },
      activeStudyMs: options.initialActiveStudyMs || 0,
      breakHoursAcknowledged: 0,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey: session.journey, sessionContent: session.sessionContent } }))
  }, { sessionId: falconsSessionId, temaId: falconsTemaId, options })
}

async function reachFalconsInlineReteach(page: Page) {
  await page.goto(`/materias/${falconsTemaId}/sesion/2?adaptiveSessionId=${falconsSessionId}`)
  await expect(page.getByText('Paso 4 de 8')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'La era de Matt Ryan: Liderazgo y el Super Bowl LI' })).toBeVisible()
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await expect(page.getByText('Según el material, Matt Ryan aportó estabilidad, liderazgo y consistencia')).toBeVisible()
  await page.getByRole('button', { name: 'Falso' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await expect(page.getByText('❌ Incorrecto')).toBeVisible()
  await page.getByRole('button', { name: 'Revisar conceptos →' }).click()
  await expect(page.getByText('📖 Reexplicación')).toBeVisible()
  await expect(page.getByText('Características de liderazgo de Matt Ryan')).toBeVisible()
}

test('matching académico usa listbox accesible y conserva IDs fuera de la presentación', async ({ page }) => {
  await page.goto('/e2e-adaptive')
  const listbox = page.getByRole('combobox', { name: 'Relacionar ecuación' })
  await listbox.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('listbox')).toBeVisible()
  const initialOrder = await page.getByRole('option').allTextContents()
  expect(initialOrder[0]).toContain('PV=nRT')
  await expect(page.getByRole('option').first().locator('.katex')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('selected-matching')).toHaveText('seleccionada')
  await expect(page.locator('body')).not.toContainText(/relation-pressure|ideal-gas|w1|w2|blank1/)
  await listbox.press('ArrowDown')
  await listbox.press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await listbox.press('ArrowDown')
  expect(await page.getByRole('option').allTextContents()).toEqual(initialOrder)
  await listbox.press('Escape')

  const second = page.getByRole('combobox', { name: 'Relacionar segunda fila' })
  await second.press('ArrowDown')
  await expect(page.getByRole('option').filter({ hasText: initialOrder[0] })).toHaveAttribute('aria-disabled', 'true')
  await second.press('Escape')
  await page.reload()
  await page.getByRole('combobox', { name: 'Relacionar ecuación' }).press('ArrowDown')
  expect(await page.getByRole('option').allTextContents()).toEqual(initialOrder)
})

test('química, blanks y transición a repaso tienen render único y fallback seguro', async ({ page }) => {
  await page.goto('/e2e-adaptive')
  const preview = page.getByTestId('word-bank-preview')
  await expect(preview.locator('.katex-html')).toHaveCount(1)
  await expect(preview).toContainText('La sustancia es')
  await expect(preview).not.toContainText(/INVALID_ACADEMIC_FRAGMENT|blank\d+|w\d+/)
  const quantities = page.getByTestId('quantity-preview')
  await expect(quantities).toContainText('de 193 pies, 1,069 pies y 6.022×10^23 mol⁻¹.')
  await expect(quantities).not.toContainText(/de193|1 ,069/)
  await expect(page.getByTestId('latex-unit-preview')).toContainText('12 h; 30 s; 193 m; 5 kg.')
  await expect(page.getByTestId('latex-unit-preview')).not.toContainText(/\b(?:exth|exts|extm|extkg|rmkg|mathrmm|textm)\b/i)
  await expect(page.getByTestId('math-unit-preview').locator('.katex')).toHaveCount(1)
  await page.getByRole('button', { name: 'Avanzar al repaso' }).click()
  await expect(page.getByTestId('review-safe-fallback')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('INVALID_ACADEMIC_FRAGMENT')
})

test('Markdown y matemáticas tienen un único propietario visual', async ({ page }) => {
  await page.goto('/e2e-adaptive')
  const preview = page.getByTestId('markdown-math-preview')
  await expect(preview.locator('strong')).toHaveCount(2)
  await expect(preview.locator('.katex')).toHaveCount(3)
  await expect(preview.locator('.katex-html')).toHaveCount(3)
  await expect(preview).toContainText('Cociente de reacción')
  await expect(preview).toContainText('Constante de equilibrio')
  await expect(preview).toContainText('Marcador incompleto procedente de extracción')
  await expect(preview.locator('code')).toHaveText('x ** 2')
  await expect(preview).not.toContainText(/\*\*Cociente|\*\*Constante|\*\*Marcador/)
  await expect(preview).not.toContainText(/INVALID_ACADEMIC_FRAGMENT|\[object Object\]|\\(?:text|mathrm|frac|ce)\b/)
  await expect(preview.locator('.katex-mathml')).toHaveCount(3)
  for (const mathml of await preview.locator('.katex-mathml').all()) {
    await expect(mathml).toHaveCSS('position', 'absolute')
  }
})

test('regresión visual académica estable en desktop y móvil', async ({ page }) => {
  await page.goto('/e2e-adaptive')
  const preview = page.getByTestId('markdown-math-preview')
  await expect(preview).toHaveScreenshot('academic-content-desktop.png', {
    animations: 'disabled',
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(preview).toHaveScreenshot('academic-content-mobile.png', {
    animations: 'disabled',
  })
})

test('recovery requiere dos verificaciones y conserva la deuda tras restore', async ({ page }) => {
  await page.goto('/e2e-adaptive')
  await page.evaluate(() => localStorage.removeItem('e2e-recovery-item'))
  await page.reload()
  await page.getByRole('button', { name: 'Simular fallo' }).click()
  await page.getByRole('button', { name: 'Registrar verificación correcta' }).click()
  await expect(page.getByTestId('recovery-status')).toHaveText('pending_verification:1/2')
  await page.reload()
  await expect(page.getByTestId('recovery-status')).toHaveText('pending_verification:1/2')
  await page.getByRole('button', { name: 'Registrar verificación correcta' }).click()
  await expect(page.getByTestId('recovery-status')).toHaveText('resolved:2/2')
})

test('CLUTCH 2 completa el bloque normal antes de recovery y reinicia crédito por ronda', async ({ page }) => {
  await page.goto('/e2e-adaptive')
  await page.evaluate(() => localStorage.removeItem('e2e-block-recovery'))
  await page.reload()
  const phase = page.getByTestId('block-phase')
  const nextStep = page.getByRole('button', { name: 'Avanzar al siguiente paso pedagógico' })

  await expect(phase).toHaveText('normal:1/4')
  await page.getByRole('button', { name: 'Responder normal incorrecta' }).click()
  await expect(phase).toHaveText('normal:2/4')
  await expect(page.getByTestId('block-recovery-count')).toHaveText('1')
  await expect(page.getByRole('button', { name: /Reenseñar/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'Responder normal incorrecta' }).click()
  await expect(phase).toHaveText('normal:3/4')
  await expect(page.getByTestId('block-recovery-count')).toHaveText('2')
  await expect(page.getByRole('button', { name: /Reenseñar/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Responder normal correcta' }).click()
  await expect(phase).toHaveText('normal:4/4')
  await page.getByRole('button', { name: 'Responder normal correcta' }).click()
  await expect(phase).toHaveText('reteach')
  await expect(page.getByTestId('block-recovery-position')).toHaveText('Ronda 1 · Error 1 de 2')
  await expect(page.getByRole('button', { name: 'Reenseñar Identificación de la reacción inversa' })).toBeVisible()
  await expect(nextStep).toBeDisabled()

  await page.getByRole('button', { name: 'Simular retry académico' }).click()
  await expect(page.getByTestId('academic-retry-count')).toHaveText('1')
  await expect(page.getByTestId('block-recovery-position')).toHaveText('Ronda 1 · Error 1 de 2')
  await page.getByRole('button', { name: 'Reenseñar Identificación de la reacción inversa' }).click()
  await expect(phase).toHaveText('verification:1:1/2')
  await expect(page.getByTestId('verification-presented')).toHaveText('presented')
  await expect(page.getByTestId('block-recovery-position')).toHaveText('Ronda 1 · Error 1 de 2')
  await page.getByRole('button', { name: 'Responder reevaluación correcta' }).click()
  await expect(phase).toHaveText('verification:1:2/2')
  await expect(page.getByTestId('verification-presented')).toHaveText('presented')
  await expect(page.getByTestId('block-round-credit')).toHaveText('1')
  await page.reload()
  await expect(phase).toHaveText('verification:1:2/2')
  await expect(page.getByTestId('block-recovery-position')).toHaveText('Ronda 1 · Error 1 de 2')
  await expect(page.getByTestId('verification-presented')).toHaveText('presented')
  await page.getByRole('button', { name: 'Responder reevaluación incorrecta' }).click()
  await expect(phase).toHaveText('reteach')
  await expect(page.getByTestId('block-recovery-position')).toHaveText('Ronda 1 · Error 1 de 2')
  await expect(nextStep).toBeDisabled()

  await page.getByRole('button', { name: 'Reenseñar Identificación de la reacción inversa' }).click()
  await expect(phase).toHaveText('verification:2:1/2')
  await expect(page.getByTestId('block-round-credit')).toHaveText('0')
  await page.getByRole('button', { name: 'Responder reevaluación correcta' }).click()
  await expect(phase).toHaveText('verification:2:2/2')
  await page.getByRole('button', { name: 'Responder reevaluación correcta' }).click()
  await expect(phase).toHaveText('reteach')
  await expect(page.getByTestId('block-recovery-position')).toHaveText('Ronda 1 · Error 2 de 2')
  await expect(page.getByRole('button', { name: 'Reenseñar Impacto de K en la dirección' })).toBeVisible()
  await expect(nextStep).toBeDisabled()

  await page.getByRole('button', { name: 'Reenseñar Impacto de K en la dirección' }).click()
  await expect(phase).toHaveText('verification:1:1/2')
  await expect(page.getByTestId('block-recovery-position')).toHaveText('Ronda 1 · Error 2 de 2')
  await page.getByRole('button', { name: 'Responder reevaluación correcta' }).click()
  await expect(phase).toHaveText('verification:1:2/2')
  await page.getByRole('button', { name: 'Responder reevaluación correcta' }).click()
  await expect(phase).toHaveText('next_step')
  await expect(nextStep).toBeEnabled()
  await expect(page.getByTestId('verification-lifecycle')).toHaveText('6:6:6:0')
  await expect(page.getByTestId('skipped-recovery-count')).toHaveText('0')
})

test('plan completado restaura el mismo journey sin requests de generación', async ({ page }) => {
  const generationRequests: string[] = []
  page.on('request', request => {
    if (/\/api\/(?:adaptive\/(?:blueprint|generate-plan)|enfoques\/teorico\/start)/.test(request.url())) {
      generationRequests.push(request.url())
    }
  })
  await page.goto('/e2e-adaptive')
  await page.evaluate(() => {
    const chapters = [1, 2, 3].map(chapterNumber => ({
      chapterNumber,
      sessionId: `chapter-${chapterNumber}`,
      title: `Sesión persistida ${chapterNumber}`,
      sessionTitle: `Sesión persistida ${chapterNumber}`,
      type: chapterNumber === 3 ? 'final_review' : 'learning',
      status: 'done',
      concepts: [],
      blockIds: [],
      topicIds: [],
      pages: [],
    }))
    localStorage.setItem('studyal_materias', JSON.stringify([{
      id: 'materia-e2e',
      nombre: 'Materia E2E',
      color: '#38bdf8',
      emoji: '📘',
      temas: [{
        id: 'tema-plan-e2e',
        nombre: 'Tema plan E2E',
        color: '#38bdf8',
        apuntes: [],
        documentos: [{
          id: 'doc-plan-e2e',
          materialId: 'mat-plan-e2e',
          nombre: 'Material persistido',
          contenido: 'Contenido académico suficiente.',
          tipo: 'pdf',
          fechaSubida: '2026-07-29',
        }],
      }],
    }]))
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({
      'journey-plan-e2e': {
        id: 'journey-plan-e2e',
        temaId: 'tema-plan-e2e',
        enfoque: 'teorico',
        processMode: 'adaptive',
        studyMode: 'adaptive',
        materialIds: ['mat-plan-e2e'],
        materialNames: ['Material persistido'],
        selectedPages: {},
        adaptiveSetup: {
          knowledgeLevel: 'never_seen',
          examDateType: 'just_studying',
          targetScore: 80,
          mainConcern: '',
          professorExamStyle: [],
          evalPreference: 'mixed',
          planView: 'book',
          completedAt: 100,
        },
        completedSessionNumbers: [1, 2, 3],
        currentSessionNumber: 3,
        currentStep: 0,
        status: 'completed',
        adaptiveState: 'completed',
        isProgramComplete: true,
        unresolvedMicroIds: [],
        createdAt: 100,
        updatedAt: 200,
        lastOpenedAt: 200,
      },
    }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({
      'journey-plan-e2e': {
        blueprint: { blocks: [{ id: 'block-1' }] },
        journey: {
          programGoal: 'Journey persistido E2E',
          programNarrative: 'El mismo plan completado.',
          totalChapters: 3,
          chapters,
        },
        sessionContent: {},
      },
    }))
  })

  const planUrl = '/e2e-adaptive?planRestore=1'
  await page.goto(planUrl)
  await expect(page).toHaveURL(new RegExp('planRestore=1'))
  await expect(page.getByText('Journey persistido E2E')).toBeVisible()
  await expect(page.getByText('3 sesiones')).toBeVisible()
  await expect(page.getByText('Sesión persistida 3')).toBeVisible()
  await expect(page.getByText(/Generando tu plan/)).toHaveCount(0)
  expect(generationRequests).toEqual([])

  await page.reload()
  await expect(page.getByText('Journey persistido E2E')).toBeVisible()
  await expect(page.getByText('3 sesiones')).toBeVisible()
  expect(generationRequests).toEqual([])
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('studyal_sessions_v4') || '{}'))
  expect(Object.keys(stored)).toEqual(['journey-plan-e2e'])
  expect(stored['journey-plan-e2e'].id).toBe('journey-plan-e2e')
})

test('quick_test recibe una pregunta compatible en una sola operación y conserva el modo', async ({ page }) => {
  const modes: string[] = []
  let calls = 0
  await page.route('**/api/adaptive/session-eval', async route => {
    calls += 1
    const body = route.request().postDataJSON()
    modes.push(body.mode)
    const question = { format: 'multiple_choice' }
    await route.fulfill({ json: { success: true, questions: [question] } })
  })
  await page.goto('/e2e-adaptive?evaluationMode=quick_test')
  await expect(page.getByTestId('active-evaluation-mode')).toHaveText('Evaluaciones rápidas sin escribir')
  await page.getByRole('button', { name: 'Generar evaluación' }).click()
  await expect(page.getByTestId('delivered-format')).toHaveText('multiple_choice')
  await expect(page.getByRole('button', { name: 'Respuesta cerrada' })).toBeVisible()
  await expect(page.locator('textarea')).toHaveCount(0)
  await expect(page.locator('input[type="text"]')).toHaveCount(0)
  expect(modes).toEqual(['quick_test'])
  await page.reload()
  await expect(page.getByTestId('active-evaluation-mode')).toHaveText('Evaluaciones rápidas sin escribir')
  await expect(page.locator('textarea')).toHaveCount(0)
})

test('write_explain conserva la capacidad de respuesta escrita', async ({ page }) => {
  await page.route('**/api/adaptive/session-eval', route => route.fulfill({
    json: { success: true, questions: [{ format: 'short_response' }] },
  }))
  await page.goto('/e2e-adaptive?evaluationMode=write_explain')
  await page.getByRole('button', { name: 'Generar evaluación' }).click()
  await expect(page.getByTestId('delivered-format')).toHaveText('short_response')
  await expect(page.getByRole('textbox', { name: 'Respuesta escrita' })).toBeVisible()
})

test('Falcons inline bloquea Paso 4 hasta responder dos reevaluaciones visibles', async ({ page }) => {
  const recoveryEvents: string[] = []
  page.on('console', message => {
    if (message.text().includes('[adaptive-recovery]')) recoveryEvents.push(message.text())
  })
  await installFalconsInlineRecoveryFixture(page)
  await reachFalconsInlineReteach(page)

  await page.getByRole('button', { name: 'Verificar comprensión →' }).click()
  await expect(page.getByText('Paso 4 de 8')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'La dupla imparable: Matt Ryan y Julio Jones' })).toHaveCount(0)
  await expect(page.getByText('Ronda 1: ¿qué combinación describe mejor')).toBeVisible()

  await page.getByRole('button', { name: 'Estabilidad, liderazgo y consistencia.' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.getByRole('button', { name: 'Continuar recuperación →' }).click()
  await expect(page.getByText('Paso 4 de 8')).toBeVisible()
  await expect(page.getByText('Ronda 1: ¿qué observación evidencia mejor')).toBeVisible()

  await page.getByRole('button', { name: 'Mantener dirección y rendimiento estable durante más de una década.' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.getByRole('button', { name: 'Continuar →' }).click()
  await expect(page.getByText('Paso 5 de 8')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'La dupla imparable: Matt Ryan y Julio Jones' })).toBeVisible()
  for (const event of [
    'inline_recovery_created',
    'reteach_verify_button_clicked',
    'verification_generation_started',
    'verification_question_presented',
    'verification_question_answered',
    'recovery_resolved',
  ]) {
    expect(recoveryEvents.some(entry => entry.includes(`"event":"${event}"`))).toBe(true)
  }
  expect(recoveryEvents.some(entry =>
    entry.includes('"event":"recovery_completion_audit"') &&
    entry.includes('"reteachWithoutTwoAnsweredVerifications":0'),
  )).toBe(true)
})

test('Falcons real recovery abre explicación y dos verificaciones tres veces', async ({ page }) => {
  test.setTimeout(300_000)
  await installFalconsInlineRecoveryFixture(page, { realReteach: true })
  const answer = async (question: any) => {
    if (question.format === 'true_false') {
      await page.getByRole('button', { name: question.correctAnswer ? 'Verdadero' : 'Falso' }).click()
      return
    }
    if (question.format === 'matching') {
      for (const pair of question.options) {
        const rightId = question.correctAnswer[pair.id]
        const right = question.options.find((candidate: any) => candidate.rightId === rightId)?.right
        expect(right).toBeTruthy()
        await page.getByRole('combobox', { name: `Relacionar ${pair.left}` }).click()
        await page.getByRole('option', { name: right, exact: true }).click()
      }
      return
    }
    const option = question.options.find((candidate: any) => candidate.id === question.correctAnswer)
    await page.getByRole('button', { name: option.text }).click()
  }
  for (let run = 1; run <= 3; run++) {
    if (run > 1) {
      await page.evaluate(() => localStorage.clear())
    }
    const responsePromise = page.waitForResponse(response =>
      response.url().includes('/api/adaptive/session-reteach') && response.request().method() === 'POST',
    )
    await reachFalconsInlineReteach(page)
    const response = await responsePromise
    expect(response.status()).toBe(200)
    const round = await response.json()
    expect(round.success).toBe(true)
    expect(round.questions).toHaveLength(2)
    expect(round.target.sourceStepIds).toEqual(['falcons-step-4'])
    await expect(page.getByText('📖 Reexplicación')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Verificar comprensión →' })).toBeVisible()
    await page.getByRole('button', { name: 'Verificar comprensión →' }).click()
    await answer(round.questions[0])
    await page.getByRole('button', { name: 'Enviar respuesta' }).click()
    await page.getByRole('button', { name: 'Continuar recuperación →' }).click()
    await answer(round.questions[1])
    await page.getByRole('button', { name: 'Enviar respuesta' }).click()
    await page.getByRole('button', { name: 'Continuar →' }).click()
    await expect(page.getByText('Paso 5 de 8')).toBeVisible()
  }
})

test('Falcons inline reinicia la ronda completa si falla la segunda reevaluación', async ({ page }) => {
  await installFalconsInlineRecoveryFixture(page)
  await reachFalconsInlineReteach(page)

  await page.getByRole('button', { name: 'Verificar comprensión →' }).click()
  await page.getByRole('button', { name: 'Estabilidad, liderazgo y consistencia.' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.getByRole('button', { name: 'Continuar recuperación →' }).click()
  await page.getByRole('button', { name: 'Un resultado aislado sin continuidad ni liderazgo.' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.getByRole('button', { name: 'Revisar de nuevo →' }).click()

  await expect(page.getByText('📖 Reexplicación')).toBeVisible()
  await expect(page.getByText('Paso 4 de 8')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'La dupla imparable: Matt Ryan y Julio Jones' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Verificar comprensión →' }).click()
  await expect(page.getByText('Ronda 2: selecciona el contraste correcto')).toBeVisible()
  await expect(page.getByText('Ronda 1: ¿qué combinación describe mejor')).toHaveCount(0)
})

test('Falcons inline restaura la primera reevaluación tras refresh sin avanzar', async ({ page }) => {
  await installFalconsInlineRecoveryFixture(page)
  await reachFalconsInlineReteach(page)

  await page.getByRole('button', { name: 'Verificar comprensión →' }).click()
  await expect(page.getByText('Ronda 1: ¿qué combinación describe mejor')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Paso 4 de 8')).toBeVisible()
  await expect(page.getByText('Ronda 1: ¿qué combinación describe mejor')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'La dupla imparable: Matt Ryan y Julio Jones' })).toHaveCount(0)
})

test('Falcons inline usa una sola operación lógica para preparar las dos verificaciones', async ({ page }) => {
  let recoveryRequests = 0
  page.on('request', request => {
    if (!request.url().includes('/api/adaptive/session-reteach') || request.method() !== 'POST') return
    try {
      if (request.postDataJSON().includeVerificationQuestions) recoveryRequests += 1
    } catch {
      // La aserción principal de UI sigue cubriendo una request sin cuerpo legible.
    }
  })
  await installFalconsInlineRecoveryFixture(page)
  await reachFalconsInlineReteach(page)

  await expect.poll(() => recoveryRequests).toBe(1)
  await page.getByRole('button', { name: 'Verificar comprensión →' }).click()
  await expect(page.getByText('Ronda 1: ¿qué combinación describe mejor')).toBeVisible()
  expect(recoveryRequests).toBe(1)
  await expect(page.getByText('Selecciona la respuesta respaldada por la explicación')).toHaveCount(0)
  await page.getByRole('button', { name: 'Estabilidad, liderazgo y consistencia.' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.getByRole('button', { name: 'Continuar recuperación →' }).click()
  await page.getByRole('button', { name: 'Mantener dirección y rendimiento estable durante más de una década.' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.getByRole('button', { name: 'Continuar →' }).click()
  await expect(page.getByText('Paso 5 de 8')).toBeVisible()
  await expect(page.getByText('No pudimos preparar las dos preguntas de recuperación')).toHaveCount(0)
})

test('Falcons usa preguntas normales persistidas sin llamar session-eval', async ({ page }) => {
  let normalRequests = 0
  page.on('request', request => {
    if (!request.url().includes('/api/adaptive/session-eval') || request.method() !== 'POST') return
    try {
      if (!request.postDataJSON().isReevaluation) normalRequests += 1
    } catch {}
  })
  await installFalconsInlineRecoveryFixture(page)
  await page.goto(`/materias/${falconsTemaId}/sesion/2?adaptiveSessionId=${falconsSessionId}`)
  await expect(page.getByText('Paso 4 de 8')).toBeVisible()
  expect(normalRequests).toBe(0)
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await expect(page.getByText('Según el material, Matt Ryan aportó estabilidad, liderazgo y consistencia')).toBeVisible()
  expect(normalRequests).toBe(0)
})

test('Falcons completa el bloque normal y prepara recovery en segundo plano desde el primer fallo', async ({ page }) => {
  let recoveryRequests = 0
  page.on('request', request => {
    if (request.url().includes('/api/adaptive/session-reteach') &&
        request.method() === 'POST' &&
        request.postDataJSON().includeVerificationQuestions) recoveryRequests += 1
  })
  await installFalconsInlineRecoveryFixture(page, { normalQuestionCount: 3 })
  await page.goto(`/materias/${falconsTemaId}/sesion/2?adaptiveSessionId=${falconsSessionId}`)
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await page.getByRole('button', { name: 'Falso' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await expect(page.getByText('Lo revisaremos al terminar este bloque de preguntas.')).toBeVisible()
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await expect(page.getByText('La consistencia de una trayectoria prolongada')).toBeVisible()
  await expect.poll(() => recoveryRequests).toBe(1)
  await page.getByRole('button', { name: 'Verdadero' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()
  await expect(page.getByText('El liderazgo sostenido puede aportar dirección estable')).toBeVisible()
  await page.getByRole('button', { name: 'Verdadero' }).click()
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()
  await page.getByRole('button', { name: 'Continuar →' }).click()
  await expect(page.getByText('📖 Reexplicación')).toBeVisible()
  expect(recoveryRequests).toBe(1)
})

test('aviso por una hora activa conserva la recuperación inline al continuar', async ({ page }) => {
  await installFalconsInlineRecoveryFixture(page, { initialActiveStudyMs: 3_590_000 })
  await reachFalconsInlineReteach(page)
  await expect(page.getByText('Llevas aproximadamente una hora estudiando')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Tomar un descanso' })).toBeVisible()
  await page.getByRole('button', { name: 'Continuar estudiando' }).click()
  await expect(page.getByText('📖 Reexplicación')).toBeVisible()
  await expect(page.getByText('Paso 4 de 8')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Verificar comprensión →' })).toBeVisible()
})
