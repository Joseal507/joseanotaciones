import { expect, test, type Page, type Route } from '@playwright/test'

const planId = `pstudy_plan:${'a'.repeat(64)}`
const materialNames = Array.from({ length: 7 }, (_, index) => index === 0
  ? 'Química Orgánica — nomenclatura, reacciones y mecanismos.pdf'
  : `Material ${index + 1}.pdf`)

type PublicTurn = {
  seq: number
  role: string
  userMessage: string
  reply: string
  provenance: Array<{ materialId: string; pages: number[] }>
  navigation: null
  externalKnowledgeUsed: false
}

function viewAt(turnSeq: number, materialIndex = 0, pending = turnSeq >= 1 && turnSeq < 4) {
  const currentBlock = materialIndex * 2
  const pagesDone = materialIndex * 30 + (turnSeq ? 5 : 0)
  const pagesTotal = 210
  return {
    planId,
    revision: turnSeq + 1,
    turnSeq,
    finished: false,
    block: {
      blockKey: `pdf-${materialIndex + 1}:1-15`,
      materialId: `pdf-${materialIndex + 1}`,
      materialName: materialNames[materialIndex],
      pageStart: 1,
      pageEnd: 15,
      index: currentBlock,
      total: 14,
    },
    coverage: {
      blockPct: turnSeq ? 33 : 0,
      planPct: Math.round((pagesDone / pagesTotal) * 100),
      pagesDone,
      pagesTotal,
      conceptsChecked: Math.max(0, turnSeq - 1),
      conceptsTaught: turnSeq,
    },
    pending: pending ? { format: 'short_answer' } : null,
    carryoverDue: turnSeq >= 2 ? 1 : 0,
    nextSlot: `pstudy:pdf-${materialIndex + 1}:1-15:${turnSeq + 1}`,
    materials: materialNames.map((name, index) => ({
      materialId: `pdf-${index + 1}`,
      name,
      blocksDone: index < materialIndex ? 2 : 0,
      blocksTotal: 2,
      current: index === materialIndex,
    })),
    blocks: materialNames.flatMap((name, index) => [0, 1].map(part => ({
      index: index * 2 + part,
      materialId: `pdf-${index + 1}`,
      materialName: name,
      pageStart: part ? 16 : 1,
      pageEnd: part ? 30 : 15,
      phase: index * 2 + part < currentBlock ? 'studied' : index * 2 + part === currentBlock ? 'current' : 'upcoming',
    }))),
  }
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function installFixture(page: Page) {
  const turns: PublicTurn[] = []
  const turnRequests: Array<Record<string, unknown>> = []
  let currentView = viewAt(0)
  let setupCalls = 0
  let stateCalls = 0
  let blueprintCalls = 0
  let failedOnce = false

  await page.route('**/api/study-sessions**', route => json(route, { success: true, sessions: [] }))
  await page.route('**/api/page-study-plan**', async route => {
    setupCalls += 1
    const body = route.request().postDataJSON()
    const groups = [body.orderedMaterialIds.slice(0, 5), body.orderedMaterialIds.slice(5)].filter((ids: string[]) => ids.length).map((ids: string[], groupIndex: number) => ({
      sourceSelection: { materialIds: ids, selectedPages: Object.fromEntries(ids.map(id => [id, Array.from({ length: 30 }, (_, pageIndex) => pageIndex + 1)])), fingerprint: `fixture-${groupIndex}` },
      materials: ids.map(id => ({ materialId: id, materialName: materialNames[Number(id.split('-')[1]) - 1], selectedPages: Array.from({ length: 30 }, (_, pageIndex) => pageIndex + 1) })),
    }))
    await json(route, { success: true, created: true, view: currentView, preparationGroups: groups })
  })
  await page.route('**/api/adaptive/blueprint?**', async route => {
    blueprintCalls += 1
    const url = new URL(route.request().url())
    const fingerprint = url.searchParams.get('fingerprint')
    await json(route, { success: true, status: 'ready', blueprint: { sourceSelectionFingerprint: fingerprint } })
  })
  await page.route('**/api/page-study/state?**', async route => {
    stateCalls += 1
    await json(route, { success: true, view: currentView, turns })
  })
  await page.route('**/api/page-study/turn', async route => {
    const request = route.request().postDataJSON() as Record<string, unknown>
    turnRequests.push(request)
    if (request.message === 'provoca un fallo' && !failedOnce) {
      failedOnce = true
      await json(route, { success: false, recoverable: true, userMessage: 'No pude continuar este turno. Inténtalo de nuevo.' }, 503)
      return
    }
    await new Promise(resolve => setTimeout(resolve, 80))
    const seq = Number(request.expectedSeq)
    const message = String(request.message || '')
    const materialIndex = message === 'sigue' ? 5 : currentView.block.materialId === 'pdf-6' ? 5 : 0
    const reply = seq === 1
      ? '## Empecemos\n\nLa reacción $S_N2$ ocurre en una etapa.\n\n| Factor | Efecto |\n|---|---|\n| Estérico | Disminuye la velocidad |\n\nTambién: \\ce{CH3Br + OH- -> CH3OH + Br-} y 光合作用.'
      : message === 'respuesta incorrecta'
        ? 'Casi. Revisa el impedimento estérico y vuelve a razonarlo.'
        : message === 'no entendí'
          ? 'Claro: imagina que el nucleófilo necesita llegar por la cara posterior. La pregunta anterior sigue pendiente.'
          : message === 'sigue'
            ? 'Terminamos el material anterior. Seguimos con Material 6.pdf, páginas 1–15.'
            : 'Continuamos desde el mismo turno durable.'
    currentView = viewAt(seq, materialIndex, seq < 4)
    const turn: PublicTurn = {
      seq,
      role: 'chat',
      userMessage: message,
      reply,
      provenance: [{ materialId: `pdf-${materialIndex + 1}`, pages: [3, 4] }],
      navigation: null,
      externalKnowledgeUsed: false,
    }
    turns.push(turn)
    await json(route, { success: true, view: currentView, turn })
  })
  // Phase 6F: TemaView's resumable-session discovery hits GET /api/page-study-plan/resume, which
  // the broad '**/api/page-study-plan**' route above also matches — registered LAST so it wins
  // (Playwright resolves overlapping routes in reverse registration order) and answers read-only
  // (no session discovered in this fixture) instead of falling into the POST-only setup handler.
  await page.route('**/api/page-study-plan/resume**', route => json(route, { success: true, exists: false }))

  return {
    turns,
    turnRequests,
    setupCalls: () => setupCalls,
    stateCalls: () => stateCalls,
    blueprintCalls: () => blueprintCalls,
  }
}

async function enterPageStudy(page: Page) {
  await page.goto('/e2e-page-study')
  await page.getByText('Material', { exact: true }).locator('xpath=ancestor::div[contains(@class,"node")][1]').click({ force: true })
  await page.getByText(materialNames[0], { exact: true }).locator('xpath=ancestor::div[contains(@class,"node")][1]').click({ force: true })
  const study = page.getByRole('button', { name: /empezar a estudiar/i })
  await expect(study).toBeEnabled()
  await study.click()
  await expect(page.getByTestId('study-mode-page-study')).toBeVisible()
  await page.getByTestId('study-mode-page-study').click()
  await expect(page.getByTestId('page-study-setup')).toBeVisible()
}

test('Phase 4 real UI: setup, durable chat, retry, restore, transition and responsive layout', async ({ page }) => {
  test.setTimeout(120_000)
  const fixture = await installFixture(page)
  await enterPageStudy(page)
  await page.screenshot({ path: '/tmp/page-study-phase4-setup.png', fullPage: true })

  for (const name of materialNames.slice(1)) await page.getByRole('button', { name: new RegExp(`${name.replace('.', '\\.')}.*Añadir`) }).click()
  await expect(page.getByText('7 materiales · 15 páginas por bloque')).toBeVisible()

  // Phase 6J: Custom was removed — the bucketed choices for a 30-page material ([5,10,15,30])
  // always include the exact full-document size, so Custom had no remaining product value.
  await expect(page.getByRole('radio', { name: 'Personalizado' })).toHaveCount(0)
  await page.getByRole('radio', { name: '15 páginas' }).click()

  const start = page.getByRole('button', { name: /Empezar a estudiar/ })
  await start.dblclick()
  await expect(page.getByText('Empecemos')).toBeVisible()
  expect(fixture.setupCalls()).toBe(1)
  expect(fixture.turnRequests).toHaveLength(1)
  await expect(page.getByText('Fuente: Química Orgánica — nomenclatura, reacciones y mecanismos.pdf · págs. 3–4')).toBeVisible()
  await expect(page.getByText('estudiado', { exact: true }).first()).toBeVisible()
  await expect(page.locator('.ps-message-content table')).toBeVisible()
  expect(await page.locator('.ps-message-content [role="math"]').count()).toBeGreaterThanOrEqual(2)
  await page.screenshot({ path: '/tmp/page-study-phase4-desktop.png', fullPage: true })

  const composer = page.getByLabel('Escribe tu respuesta o pregunta')
  await composer.fill('respuesta incorrecta')
  await composer.press('Enter')
  await composer.press('Enter')
  await expect(page.getByText(/Casi\. Revisa/)).toBeVisible()
  expect(fixture.turnRequests).toHaveLength(2)

  await composer.fill('no entendí')
  await composer.press('Enter')
  await expect(page.getByText(/pregunta anterior sigue pendiente/)).toBeVisible()
  await expect(page.getByText('ALAI espera tu respuesta en la conversación.')).toBeVisible()

  await composer.fill('sigue')
  await composer.press('Enter')
  await expect(page.getByText('Material 6.pdf', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Fuente: Material 6.pdf · págs. 3–4')).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/batch|lote de autoridad/i)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.screenshot({ path: '/tmp/page-study-phase4-laptop.png', fullPage: true })

  await composer.fill('provoca un fallo')
  await composer.press('Enter')
  await expect(page.getByText('No pude continuar este turno. Inténtalo de nuevo.')).toBeVisible()
  const failedRequest = fixture.turnRequests.at(-1)
  await page.getByRole('button', { name: 'Reintentar' }).click()
  await expect(page.getByText('Continuamos desde el mismo turno durable.')).toBeVisible()
  expect(fixture.turnRequests.at(-1)).toEqual(failedRequest)

  const postsBeforeReload = fixture.turnRequests.length
  const readsBeforeReload = fixture.stateCalls()
  const blueprintsBeforeReload = fixture.blueprintCalls()
  await page.reload()
  await expect(page.getByText('Continuamos desde el mismo turno durable.')).toBeVisible()
  expect(fixture.turnRequests).toHaveLength(postsBeforeReload)
  expect(fixture.stateCalls()).toBeGreaterThan(readsBeforeReload)
  expect(fixture.blueprintCalls()).toBe(blueprintsBeforeReload)

  const readsBeforeReopen = fixture.stateCalls()
  await page.getByRole('button', { name: 'Salir de Estudio por Páginas' }).click()
  await page.getByText('Material', { exact: true }).locator('xpath=ancestor::div[contains(@class,"node")][1]').click({ force: true })
  await page.getByText(materialNames[0], { exact: true }).locator('xpath=ancestor::div[contains(@class,"node")][1]').click({ force: true })
  await page.getByRole('button', { name: /empezar a estudiar/i }).click()
  await page.getByTestId('study-mode-page-study').click()
  await expect(page.getByText('Continuamos desde el mismo turno durable.')).toBeVisible()
  expect(fixture.turnRequests).toHaveLength(postsBeforeReload)
  expect(fixture.stateCalls()).toBeGreaterThan(readsBeforeReopen)
  expect(fixture.blueprintCalls()).toBe(blueprintsBeforeReload)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('page-study-workspace')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  const chatWidth = await page.locator('.ps-chat').evaluate(element => element.getBoundingClientRect().width)
  expect(chatWidth).toBeGreaterThan(350)
  await page.screenshot({ path: '/tmp/page-study-phase4-mobile.png', fullPage: true })
})
