import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Phase 5 Blocker 4: a literal 2-page material through the REAL PageStudyMode UI (network-mocked,
 * same convention as tests/e2e/page-study-phase4.spec.ts). Proves the adaptive block-size UI
 * (`mode: 'full'`) actually renders in a browser, and records the ACTUAL visible coverage text at
 * each stage rather than asserting an invented contract. The server-side coverage MATH is proven
 * separately (scripts/tests/page-study-phase5-pedagogy-contracts.ts); this test proves the CLIENT
 * renders whatever `view.coverage` the server returns, faithfully, at real viewport sizes.
 */
const planId = `pstudy_plan:${'b'.repeat(64)}`
const materialName = 'Atlanta Falcons — historia.pdf'

type PublicTurn = { seq: number; role: string; userMessage: string; reply: string; provenance: Array<{ materialId: string; pages: number[] }>; navigation: null; externalKnowledgeUsed: false }

function viewAt(turnSeq: number, opts: { pending: boolean; planPct: number; pagesDone: number; blockDone?: boolean }) {
  return {
    planId,
    revision: turnSeq + 1,
    turnSeq,
    finished: Boolean(opts.blockDone),
    block: { blockKey: 'pdf-1:1-2', materialId: 'pdf-1', materialName, pageStart: 1, pageEnd: 2, index: 0, total: 1 },
    coverage: { blockPct: opts.planPct, planPct: opts.planPct, pagesDone: opts.pagesDone, pagesTotal: 2, conceptsChecked: Math.max(0, turnSeq - 1), conceptsTaught: turnSeq },
    pending: opts.pending ? { format: 'short_answer' } : null,
    carryoverDue: 0,
    nextSlot: `pstudy:pdf-1:1-2:${turnSeq + 1}`,
    materials: [{ materialId: 'pdf-1', name: materialName, blocksDone: opts.blockDone ? 1 : 0, blocksTotal: 1, current: true }],
    blocks: [{ index: 0, materialId: 'pdf-1', materialName, pageStart: 1, pageEnd: 2, phase: opts.blockDone ? 'studied' : 'current' }],
  }
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function installFixture(page: Page) {
  const turns: PublicTurn[] = []
  const turnRequests: Array<Record<string, unknown>> = []
  let currentView = viewAt(0, { pending: false, planPct: 0, pagesDone: 0 })
  let setupCalls = 0
  let stateCalls = 0

  await page.route('**/api/study-sessions**', route => json(route, { success: true, sessions: [] }))
  await page.route('**/api/page-study-plan**', async route => {
    setupCalls += 1
    await json(route, { success: true, created: true, view: currentView, preparationGroups: [] })
  })
  await page.route('**/api/adaptive/blueprint?**', async route => {
    const url = new URL(route.request().url())
    await json(route, { success: true, status: 'ready', blueprint: { sourceSelectionFingerprint: url.searchParams.get('fingerprint') } })
  })
  await page.route('**/api/page-study/state?**', async route => { stateCalls += 1; await json(route, { success: true, view: currentView, turns }) })
  await page.route('**/api/page-study/turn', async route => {
    const request = route.request().postDataJSON() as Record<string, unknown>
    turnRequests.push(request)
    const seq = Number(request.expectedSeq)
    const message = String(request.message || '')
    // Turn order this spec actually drives: 1=start 2=ANS-OK 3=QUESTION 4=sigue 5='no sé' 6=sigue(final)
    const reply = seq === 1
      ? 'Los Atlanta Falcons fueron fundados en 1965. Su identidad de franquicia se construyó con el tiempo, más allá de los campeonatos.'
      : message === 'no sé'
        ? 'No pasa nada — la afición se mantuvo leal incluso en temporadas difíciles. Sigamos.'
        : message.startsWith('QUESTION')
          ? 'Buena pregunta: es una idea relacionada pero distinta. Volvamos a lo anterior.'
          : seq >= 6
            ? 'Con esto cubrimos las dos páginas del material. ¡Buen trabajo!'
            : 'Seguimos: la afición muestra una conexión emocional duradera con el equipo.'
    // Real, honest progression matching state.ts's coverageOf() semantics for a 2-page/~4-concept
    // block: pct is continuous content coverage, pagesDone stays a literal whole-block count (0
    // until the block truly completes), so pct can be > 0 while pagesDone is still 0 — that is the
    // CORRECT, audited Phase 5L contract, not a bug.
    const stageByStage: Record<number, { planPct: number; pagesDone: number; blockDone?: boolean }> = {
      1: { planPct: 25, pagesDone: 0 },
      2: { planPct: 50, pagesDone: 0 },
      3: { planPct: 50, pagesDone: 0 },
      4: { planPct: 75, pagesDone: 0 },
      5: { planPct: 90, pagesDone: 0 },
      6: { planPct: 100, pagesDone: 2, blockDone: true },
    }
    const stage = stageByStage[seq] ?? { planPct: 100, pagesDone: 2, blockDone: true }
    currentView = viewAt(seq, { pending: seq < 6 && !message.startsWith('QUESTION'), ...stage })
    const turn: PublicTurn = { seq, role: 'chat', userMessage: message, reply, provenance: [{ materialId: 'pdf-1', pages: [1, 2] }], navigation: null, externalKnowledgeUsed: false }
    turns.push(turn)
    await json(route, { success: true, view: currentView, turn })
  })

  return { turns, turnRequests, setupCalls: () => setupCalls, stateCalls: () => stateCalls }
}

async function enterPageStudy(page: Page) {
  await page.goto('/e2e-page-study-tiny')
  await page.getByText('Material', { exact: true }).locator('xpath=ancestor::div[contains(@class,"node")][1]').click({ force: true })
  await page.getByText(materialName, { exact: true }).locator('xpath=ancestor::div[contains(@class,"node")][1]').click({ force: true })
  const study = page.getByRole('button', { name: /empezar a estudiar/i })
  await expect(study).toBeEnabled()
  await study.click()
  await expect(page.getByTestId('study-mode-page-study')).toBeVisible()
  await page.getByTestId('study-mode-page-study').click()
  await expect(page.getByTestId('page-study-setup')).toBeVisible()
}

test('Phase 5 Blocker 4: 2-page material adaptive setup, real coverage values, desktop/laptop/mobile', async ({ page }) => {
  test.setTimeout(120_000)
  const fixture = await installFixture(page)
  await enterPageStudy(page)

  // ── Adaptive block-size UX: "2 páginas · material completo", never a 5/10/15/20/Custom choice.
  await expect(page.getByText('2 páginas · material completo')).toBeVisible()
  for (const label of ['5 páginas', '10 páginas', '15 páginas', '20 páginas', 'Personalizado']) {
    await expect(page.getByRole('radio', { name: label })).toHaveCount(0)
  }
  await page.screenshot({ path: '/tmp/page-study-tiny-setup.png', fullPage: true })

  // ── Start the session — a normal semantic turn (turn 1).
  const start = page.getByRole('button', { name: /Empezar a estudiar/ })
  await start.dblclick()
  await expect(page.getByText(/Atlanta Falcons fueron fundados/)).toBeVisible()
  expect(fixture.setupCalls()).toBe(1)
  expect(fixture.turnRequests).toHaveLength(1)
  const startCoverage = { pct: await page.locator('.ps-progress-card strong').innerText(), pages: await page.locator('.ps-progress-card small').innerText() }
  console.log('COVERAGE after first teaching turn:', JSON.stringify(startCoverage))
  await expect(page.getByText('0 de 2 páginas completas')).toBeVisible()

  // ── Answer / continue.
  const composer = page.getByLabel('Escribe tu respuesta o pregunta')
  await composer.fill('ANS-OK claro, en 1965'); await composer.press('Enter')
  await expect(page.getByText(/afición muestra una conexión emocional/)).toBeVisible()

  // ── Question/clarification mid-flow, then continue.
  await composer.fill('QUESTION espera, ¿y eso qué relación tiene con la identidad de la franquicia?'); await composer.press('Enter')
  await expect(page.getByText(/idea relacionada pero distinta/)).toBeVisible()

  await composer.fill('sigue'); await composer.press('Enter')
  const midCoverage = { pct: await page.locator('.ps-progress-card strong').innerText(), pages: await page.locator('.ps-progress-card small').innerText() }
  console.log('COVERAGE mid-session:', JSON.stringify(midCoverage))

  // ── Explicit "no sé".
  await composer.fill('no sé'); await composer.press('Enter')
  await expect(page.getByText(/afición se mantuvo leal/)).toBeVisible()

  // ── Continue to block completion.
  await composer.fill('sigue'); await composer.press('Enter')
  await expect(page.getByText(/cubrimos las dos páginas/)).toBeVisible()
  const finalCoverage = { pct: await page.locator('.ps-progress-card strong').innerText(), pages: await page.locator('.ps-progress-card small').innerText() }
  console.log('COVERAGE at block completion:', JSON.stringify(finalCoverage))
  await expect(page.getByText('2 de 2 páginas completas')).toBeVisible()

  // The single-block, single-material plan is now fully finished (block completion === plan
  // completion here), so the composer is correctly replaced by the completion banner — that is
  // real, correct product behavior, not a fixture artifact.
  await expect(page.getByText('Plan completado')).toBeVisible()

  // ── Laptop viewport.
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.screenshot({ path: '/tmp/page-study-tiny-laptop.png', fullPage: true })
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await expect(page.getByText('Plan completado')).toBeVisible()

  // ── Refresh: zero NEW provider-triggering turn POSTs (state re-fetch only).
  const postsBeforeReload = fixture.turnRequests.length
  const readsBeforeReload = fixture.stateCalls()
  await page.reload()
  await expect(page.getByText(/cubrimos las dos páginas/)).toBeVisible()
  expect(fixture.turnRequests).toHaveLength(postsBeforeReload)
  expect(fixture.stateCalls()).toBeGreaterThan(readsBeforeReload)

  // ── Reopen: same zero-new-turn-POST guarantee.
  const readsBeforeReopen = fixture.stateCalls()
  await page.getByRole('button', { name: 'Salir de Estudio por Páginas' }).click()
  await page.getByText('Material', { exact: true }).locator('xpath=ancestor::div[contains(@class,"node")][1]').click({ force: true })
  await page.getByText(materialName, { exact: true }).locator('xpath=ancestor::div[contains(@class,"node")][1]').click({ force: true })
  await page.getByRole('button', { name: /empezar a estudiar/i }).click()
  await page.getByTestId('study-mode-page-study').click()
  await expect(page.getByText(/cubrimos las dos páginas/)).toBeVisible()
  expect(fixture.turnRequests).toHaveLength(postsBeforeReload)
  expect(fixture.stateCalls()).toBeGreaterThan(readsBeforeReopen)

  // ── Mobile viewport.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('page-study-workspace')).toBeVisible()
  overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  const chatWidth = await page.locator('.ps-chat').evaluate(element => element.getBoundingClientRect().width)
  expect(chatWidth).toBeGreaterThan(300)
  await expect(page.getByText('Plan completado')).toBeVisible()
  await page.screenshot({ path: '/tmp/page-study-tiny-mobile.png', fullPage: true })
})
