import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Phase 6: real TemaView session-lifecycle scenarios — "Seguir estudiando" discovery/resume,
 * same-content-different-material isolation, and the exact block-size option sets for 20/50-page
 * materials — all through the REAL TemaView mode-selector flow (not just PageStudyMode in
 * isolation), network-mocked at the same convention as page-study-phase4.spec.ts /
 * page-study-tiny-material.spec.ts.
 */
const names = {
  'pdf-1': 'Atlanta Falcons — historia.pdf',
  'pdf-2': 'Atlanta Falcons — historia (copia).pdf',
  'pdf-3': 'Material 20 páginas.pdf',
  'pdf-4': 'Material 50 páginas.pdf',
} as const

function planIdFor(materialId: string) { return `pstudy_plan:${materialId.padEnd(64, '0')}` }

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function viewFor(materialId: string, turnSeq: number, pagesTotal: number) {
  return {
    planId: planIdFor(materialId),
    revision: turnSeq + 1,
    turnSeq,
    finished: false,
    block: { blockKey: `${materialId}:1-${pagesTotal}`, materialId, materialName: names[materialId as keyof typeof names], pageStart: 1, pageEnd: pagesTotal, index: 0, total: 1 },
    coverage: { blockPct: 25, planPct: 25, pagesDone: 0, pagesTotal, conceptsChecked: 0, conceptsTaught: turnSeq },
    pending: false ? { format: 'short_answer' } : null,
    carryoverDue: 0,
    nextSlot: `pstudy:${materialId}:1-${pagesTotal}:${turnSeq + 1}`,
    materials: [{ materialId, name: names[materialId as keyof typeof names], blocksDone: 0, blocksTotal: 1, current: true }],
    blocks: [{ index: 0, materialId, materialName: names[materialId as keyof typeof names], pageStart: 1, pageEnd: pagesTotal, phase: 'current' }],
  }
}

/** Sessions started so far, keyed by the exact sorted materialId set — mirrors the real
 * deterministic identity contract (planId = f(temaId, materialIds, selectedPages)) closely enough
 * for this network-mocked scenario: a session only exists once its POST has actually happened. */
async function installLifecycleFixture(page: Page) {
  const started = new Set<string>()
  const turnRequests: Array<Record<string, unknown>> = []
  // Real turns, tracked per material — a fresh session has NONE until its first real turn POST;
  // a resumed session replays exactly what was already recorded, never a synthetic "Retomamos" line.
  const turnsByMaterial = new Map<string, Array<Record<string, unknown>>>()
  const pagesTotalOf = (materialId: string) => (materialId === 'pdf-3' ? 20 : materialId === 'pdf-4' ? 50 : 2)

  await page.route('**/api/study-sessions**', route => json(route, { success: true, sessions: [] }))
  await page.route('**/api/adaptive/blueprint?**', async route => {
    const url = new URL(route.request().url())
    await json(route, { success: true, status: 'ready', blueprint: { sourceSelectionFingerprint: url.searchParams.get('fingerprint') } })
  })
  await page.route('**/api/page-study/state?**', async route => {
    const url = new URL(route.request().url())
    const planId = url.searchParams.get('planId') || ''
    const materialId = (Object.keys(names) as string[]).find(id => planIdFor(id) === planId) || 'pdf-1'
    const turns = turnsByMaterial.get(materialId) || []
    const seq = turns.length
    await json(route, { success: true, view: viewFor(materialId, seq, pagesTotalOf(materialId)), turns })
  })
  await page.route('**/api/page-study/turn', async route => {
    const request = route.request().postDataJSON() as Record<string, unknown>
    turnRequests.push(request)
    const slot = String(request.slot || '')
    const materialId = (Object.keys(names) as string[]).find(id => slot.includes(id)) || 'pdf-1'
    const seq = Number(request.expectedSeq)
    const turn = { seq, role: 'chat', userMessage: String(request.message || ''), reply: `Empezamos con ${names[materialId as keyof typeof names]}.`, provenance: [{ materialId, pages: [1] }], navigation: null, externalKnowledgeUsed: false }
    const list = turnsByMaterial.get(materialId) || []
    list.push(turn)
    turnsByMaterial.set(materialId, list)
    await json(route, { success: true, view: viewFor(materialId, seq, pagesTotalOf(materialId)), turn })
  })
  await page.route('**/api/page-study-plan**', async route => {
    const body = route.request().postDataJSON() as { orderedMaterialIds: string[] }
    const materialIds = [...body.orderedMaterialIds].sort()
    started.add(materialIds.join(','))
    const materialId = materialIds[0]
    await json(route, { success: true, created: true, view: viewFor(materialId, 0, pagesTotalOf(materialId)), preparationGroups: [] })
  })
  // Registered LAST (Playwright resolves overlapping routes in reverse registration order) so it
  // wins over the broad page-study-plan POST handler above for GET /resume requests.
  await page.route('**/api/page-study-plan/resume**', async route => {
    const url = new URL(route.request().url())
    const materialIds = (url.searchParams.get('materialIds') || '').split(',').filter(Boolean).sort()
    const key = materialIds.join(',')
    if (!materialIds.length || !started.has(key)) return json(route, { success: true, exists: false })
    const materialId = materialIds[0]
    await json(route, { success: true, exists: true, planId: planIdFor(materialId), finished: false, currentMaterialId: materialId, currentMaterialName: names[materialId as keyof typeof names], pageStart: 1, pageEnd: pagesTotalOf(materialId), coverage: viewFor(materialId, 1, pagesTotalOf(materialId)).coverage, updatedAt: Date.now() })
  })

  return { turnRequests, sessionsStarted: () => started.size }
}

async function selectMaterialAndOpenModeSelector(page: Page, materialId: keyof typeof names) {
  await page.getByText('Material', { exact: true }).locator('xpath=ancestor::div[contains(@class,"node")][1]').click({ force: true })
  await page.getByText(names[materialId], { exact: true }).locator('xpath=ancestor::div[contains(@class,"node")][1]').click({ force: true })
  const study = page.getByRole('button', { name: /empezar a estudiar/i })
  await expect(study).toBeEnabled()
  await study.click()
  await expect(page.getByTestId('study-mode-page-study')).toBeVisible()
}

test('Phase 6 Scenario 1+2: Seguir estudiando resume, and a different materialId never inherits it', async ({ page }) => {
  test.setTimeout(120_000)
  const fixture = await installLifecycleFixture(page)
  await page.goto('/e2e-page-study-tiny')

  // Fresh: no session yet for pdf-1 → normal entry.
  await selectMaterialAndOpenModeSelector(page, 'pdf-1')
  await expect(page.getByTestId('study-mode-page-study')).toHaveText(/Estudio por Páginas/)
  await page.getByTestId('study-mode-page-study').click()
  await expect(page.getByTestId('page-study-setup')).toBeVisible()
  await expect(page.getByText('2 páginas · material completo')).toBeVisible()

  const start = page.getByRole('button', { name: /Empezar a estudiar/ })
  await start.click()
  await expect(page.getByText(/Empezamos con Atlanta Falcons/)).toBeVisible()
  expect(fixture.sessionsStarted()).toBe(1)

  // Exit and return to the SAME material instance (pdf-1) — a fresh page load (closed tab,
  // came back later) resets the graph's zoom/pan state, matching a real return visit and avoiding
  // the canvas view's own unrelated flakiness after in-app "Salir" navigation.
  await page.goto('/e2e-page-study-tiny')
  await selectMaterialAndOpenModeSelector(page, 'pdf-1')
  await expect(page.getByTestId('study-mode-page-study')).toHaveText(/Seguir estudiando/)
  const postsBeforeResume = fixture.turnRequests.length
  await page.getByTestId('study-mode-page-study').click()
  await expect(page.getByText(/Empezamos con Atlanta Falcons/)).toBeVisible()
  expect(fixture.turnRequests).toHaveLength(postsBeforeResume) // zero NEW turn POSTs merely to resume

  // Scenario 2: pdf-2 is a DIFFERENT material instance with the same content/name pattern — it
  // must NOT show "Seguir estudiando" and must NOT inherit pdf-1's session.
  await page.goto('/e2e-page-study-tiny')
  await selectMaterialAndOpenModeSelector(page, 'pdf-2')
  await expect(page.getByTestId('study-mode-page-study')).toHaveText(/Estudio por Páginas/)
  await expect(page.getByTestId('study-mode-page-study')).not.toHaveText(/Seguir estudiando/)
})

test('Phase 6 Scenario 3: 20-page material offers exactly 5 / 10 / 20', async ({ page }) => {
  test.setTimeout(60_000)
  await installLifecycleFixture(page)
  await page.goto('/e2e-page-study-tiny')
  await selectMaterialAndOpenModeSelector(page, 'pdf-3')
  await page.getByTestId('study-mode-page-study').click()
  await expect(page.getByTestId('page-study-setup')).toBeVisible()
  await expect(page.getByRole('radio', { name: '5 páginas', exact: true })).toBeVisible()
  await expect(page.getByRole('radio', { name: '10 páginas', exact: true })).toBeVisible()
  await expect(page.getByRole('radio', { name: /20 páginas/ })).toBeVisible()
  for (const missing of ['15 páginas', 'Personalizado']) await expect(page.getByRole('radio', { name: missing, exact: true })).toHaveCount(0)
})

test('Phase 6 Scenario 4: 50-page material offers exactly 5 / 10 / 15 / 20 / 25 / 50', async ({ page }) => {
  test.setTimeout(60_000)
  await installLifecycleFixture(page)
  await page.goto('/e2e-page-study-tiny')
  await selectMaterialAndOpenModeSelector(page, 'pdf-4')
  await page.getByTestId('study-mode-page-study').click()
  await expect(page.getByTestId('page-study-setup')).toBeVisible()
  for (const size of ['5 páginas', '10 páginas', '15 páginas', '20 páginas', '25 páginas']) await expect(page.getByRole('radio', { name: size, exact: true })).toBeVisible()
  await expect(page.getByRole('radio', { name: /50 páginas/ })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Personalizado' })).toHaveCount(0)
})

test('Phase 6 Scenario 1: desktop and mobile layout for the resume flow', async ({ page }) => {
  test.setTimeout(90_000)
  await installLifecycleFixture(page)
  await page.goto('/e2e-page-study-tiny')
  await selectMaterialAndOpenModeSelector(page, 'pdf-1')
  await page.getByTestId('study-mode-page-study').click()
  await expect(page.getByText('2 páginas · material completo')).toBeVisible()
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByText('2 páginas · material completo')).toBeVisible()
  overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
