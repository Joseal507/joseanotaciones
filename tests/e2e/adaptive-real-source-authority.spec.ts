import { expect, test } from '@playwright/test'
import { sourceSelectionFingerprint } from '../../lib/adaptive/sourceSelection'

test('3 materiales / 8 páginas: blueprint certificado y programa durable antes de abrir sesión', async ({ page }) => {
  const selectedPages = { 'mat-a': [1, 2], 'mat-b': [2, 5], 'mat-c': [2, 5, 7, 43] }
  const fingerprint = sourceSelectionFingerprint(['mat-a', 'mat-b', 'mat-c'], selectedPages)
  const setup = {
    knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80,
    mainConcern: '', professorExamStyle: [], evalPreference: 'quick_test', planView: 'book', completedAt: 1,
  }
  const partialProgram = {
    id: 'program-source-authority', temaId: 'tema-source-authority', enfoque: 'teorico',
    processMode: 'adaptive', studyMode: 'adaptive', materialIds: ['mat-a', 'mat-b', 'mat-c'],
    materialNames: ['A.pdf', 'B.pdf', 'C.pdf'], selectedPages, adaptiveSetup: setup,
    currentSessionNumber: 1, currentStep: 0, completedSessionNumbers: [], status: 'active',
    adaptiveState: 'setup_complete', createdAt: 1, lastOpenedAt: 1,
  }
  const blueprint = {
    version: 3, sourceSelection: { materialIds: ['mat-a', 'mat-b', 'mat-c'], selectedPages, fingerprint },
    sourceSelectionFingerprint: fingerprint,
    topics: [{ id: 'topic-1', title: 'Contenido seleccionado', pages: [1, 2, 5, 7, 43] }],
    blocks: [{ id: 'block-1', topicId: 'topic-1', sourceSpans: [{ materialId: 'mat-a', page: 1 }] }],
  }
  const journey = {
    id: 'journey-source-authority', version: 3, programGoal: 'Programa de ocho páginas autorizadas',
    programNarrative: 'Solo usa el snapshot seleccionado.', totalChapters: 1,
    chapters: [{ id: 'chapter-1', sessionId: 'chapter-1', chapterNumber: 1, kind: 'introduction',
      title: 'Sesión autorizada 1', sessionTitle: 'Sesión autorizada 1', status: 'available',
      concepts: [], blockIds: ['block-1'], topicIds: ['topic-1'], pages: [1] }],
  }
  let blueprintCalls = 0
  let planCalls = 0
  let committedProgram: Record<string, any> | null = null

  await page.route('**/api/study-sessions**', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { success: true, sessions: [committedProgram || partialProgram] } })
      return
    }
    const body = route.request().postDataJSON()
    if (body?.id === partialProgram.id && body?.blueprint && body?.journey) committedProgram = body
    await route.fulfill({ json: { success: true, session: body } })
  })
  await page.route('**/api/adaptive/blueprint', async route => {
    blueprintCalls += 1
    const body = route.request().postDataJSON()
    expect(body.sourceSelection.fingerprint).toBe(fingerprint)
    expect(body.sourceSelection.materials).toEqual([
      { materialId: 'mat-a', selectedPages: [1, 2] },
      { materialId: 'mat-b', selectedPages: [2, 5] },
      { materialId: 'mat-c', selectedPages: [2, 5, 7, 43] },
    ])
    expect(body.sourceSelection.materials.flatMap((entry: any) => entry.selectedPages)).toHaveLength(8)
    await route.fulfill({ json: { success: true, blueprint, sourceSelection: blueprint.sourceSelection,
      sourceSelectionFingerprint: fingerprint,
      quality: { status: 'complete', coverageCertified: true, planGenerationAllowed: true, reasons: [] } } })
  })
  await page.route('**/api/adaptive/generate-plan', async route => {
    planCalls += 1
    const body = route.request().postDataJSON()
    expect(body.sourceSelectionFingerprint).toBe(fingerprint)
    expect(body.quality.planGenerationAllowed).toBe(true)
    expect(body.quality.coverageCertified).toBe(true)
    await route.fulfill({ json: { success: true, journey } })
  })
  await page.route('**/api/adaptive/session-teach', route => route.fulfill({ status: 202, json: { success: false, preparationStatus: 'recoverable' } }))

  await page.goto('/e2e-adaptive?sourceAuthority=1')
  await expect(page.getByText('Programa de ocho páginas autorizadas')).toBeVisible({ timeout: 15_000 })
  expect(blueprintCalls).toBe(1)
  expect(planCalls).toBe(1)
  expect(committedProgram).not.toBeNull()
  expect(committedProgram?.sourceSelectionFingerprint).toBe(fingerprint)
  expect(committedProgram?.selectedPages).toEqual(selectedPages)
  expect(committedProgram?.blueprint).toEqual(blueprint)
  expect(committedProgram?.journey.id).toBe(journey.id)
  expect(committedProgram?.journey.chapters).toEqual(journey.chapters)

  await page.getByText('Sesión autorizada 1').click()
  await expect(page).toHaveURL(/adaptiveSessionId=program-source-authority/)
  expect(planCalls).toBe(1)
})
