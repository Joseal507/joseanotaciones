import path from 'node:path'
import { expect, test, type Page, type TestInfo } from '@playwright/test'

const fixture = (name: string) => path.resolve(process.cwd(), 'tests/fixtures/real-materials', name)
type Profile = 'capable' | 'misconception_prone' | 'assistance_dependent' | 'low_confidence' | 'random_guesser'

async function screenshot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true })
}

async function upload(page: Page, info: TestInfo, material: string, profile: Profile) {
  await page.goto('/e2e-real-sessions')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByTestId('student-profile').selectOption(profile)
  await page.getByTestId('real-session-upload').setInputFiles(fixture(material))
  await expect(page.getByTestId('intro-session')).toBeVisible()
  await screenshot(page, info, 'upload')
  await page.getByTestId('intro-next').click()
  await page.getByTestId('intro-next').click()
  await page.getByTestId('intro-enter-program').click()
  await expect(page.getByText('Libro canónico', { exact: false })).toBeVisible()
  await screenshot(page, info, 'libro-inicial')
  await page.getByTestId('start-session').click()
  await expect(page.getByTestId('adaptive-interaction')).toBeVisible()
  await screenshot(page, info, 'primera-pregunta')
}

async function answerTurn(page: Page, profile: Profile, turn: number) {
  if (profile === 'assistance_dependent') {
    await page.getByTestId('request-hint').click()
    await page.getByTestId('reveal-answer').click()
  }
  const interaction = page.getByTestId('adaptive-interaction')
  const format = await interaction.getAttribute('data-interaction-type')
  const buttons = interaction.locator('button')
  if (format === 'fill_blank_bank') {
    await buttons.first().click()
    await page.getByRole('button', { name: /Responder/ }).click()
  } else {
    await buttons.nth(profile === 'random_guesser' ? (turn % 2) + 1 : 0).click()
  }
  await expect(page.getByTestId('adaptive-feedback')).toBeVisible()
  await page.getByTestId('adaptive-continue').click()
  await expect(page.getByTestId('adaptive-confidence')).toBeVisible()
  const confidence = profile === 'low_confidence' ? 'No estaba seguro/a' : profile === 'misconception_prone' && turn === 0 ? 'Bastante seguro/a' : 'Más o menos'
  await page.getByRole('button', { name: confidence }).click()
  await page.getByTestId('confidence-continue').click()
}

async function finish(page: Page, profile: Profile) {
  const budgets = { sessions: 16, interactions: 80, repairs: 15 }
  const root = page.getByTestId('real-session-harness')
  let summaries = 0
  let repairs = 0
  let turns = 0
  let historyPreserved = true
  let evidencePreserved = true

  const readHistory = async () => JSON.parse((await root.getAttribute('data-history')) || '[]') as unknown[]
  const readEvidenceCounts = async () => {
    const diagnostics = JSON.parse((await root.getAttribute('data-evidence-diagnostics')) || '[]') as Array<{ microId: string; evidences: unknown[] }>
    return new Map(diagnostics.map(item => [item.microId, item.evidences.length]))
  }

  while (true) {
    const phase = await root.getAttribute('data-interaction-phase')
    if (phase === 'summary') {
      summaries++
      const sessions = Number(await root.getAttribute('data-session-count'))
      const result = { turns, summaries, repairs, sessions, finalPhase: 'summary' as const, historyPreserved, evidencePreserved }
      if (await root.getAttribute('data-is-program-complete') === 'true') return { ...result, outcome: 'program_complete' as const }

      const terminalReason = await root.getAttribute('data-fuse-reason')
      const repair = page.getByTestId('continue-repair')
      const canRepair = await repair.count() > 0
      const budgetExhausted = turns >= budgets.interactions || sessions >= budgets.sessions || repairs >= budgets.repairs
      if (!canRepair || terminalReason === 'global_budget_exhausted' || budgetExhausted) {
        return { ...result, outcome: 'valid_incomplete' as const }
      }

      const historyBefore = await readHistory()
      const evidenceBefore = await readEvidenceCounts()
      await repair.click()
      await expect(page.getByText('Libro canónico', { exact: false })).toBeVisible()
      const historyAfterRepair = await readHistory()
      const evidenceAfterRepair = await readEvidenceCounts()
      historyPreserved &&= historyBefore.every((item, index) => JSON.stringify(item) === JSON.stringify(historyAfterRepair[index]))
      evidencePreserved &&= [...evidenceBefore].every(([microId, count]) => (evidenceAfterRepair.get(microId) || 0) >= count)

      repairs++
      await page.getByTestId('start-session').click()
      await expect(page.getByTestId('adaptive-interaction')).toBeVisible()
      continue
    }

    expect(['answering', 'feedback', 'collecting_confidence']).toContain(phase)
    expect(turns).toBeLessThan(budgets.interactions)
    await answerTurn(page, profile, turns)
    turns++
  }
}

async function assertCanonicalFinal(page: Page, expectedComplete: boolean) {
  const root = page.getByTestId('real-session-harness')
  await expect(root).toHaveAttribute('data-is-program-complete', String(expectedComplete))
  const required = (await root.getAttribute('data-required-ids'))!.split(',').filter(Boolean)
  const studied = (await root.getAttribute('data-studied-ids'))!.split(',').filter(Boolean)
  const mastered = (await root.getAttribute('data-mastered-ids'))!.split(',').filter(Boolean)
  const unresolved = (await root.getAttribute('data-unresolved-ids'))!.split(',').filter(Boolean)
  const processed = (await root.getAttribute('data-processed-ids'))!.split(',').filter(Boolean)
  expect(new Set([...mastered, ...unresolved])).toEqual(new Set(required))
  expect(mastered.filter(id => unresolved.includes(id))).toEqual([])
  expect(required.every(id => studied.includes(id))).toBe(true)
  expect(processed.every(id => required.includes(id))).toBe(true)
  if (expectedComplete) {
    expect(required.every(id => processed.includes(id))).toBe(true)
    await expect(root).toHaveAttribute('data-coverage-percent', '100')
    await expect(root).toHaveAttribute('data-mastery-percent', '100')
    expect(unresolved).toEqual([])
  } else {
    expect(unresolved.length).toBeGreaterThan(0)
  }
  const history = JSON.parse((await root.getAttribute('data-history')) || '[]') as Array<{ questionId: string; factKey: string; prompt: string; repetitionIntent: boolean }>
  expect(new Set(history.map(h => h.questionId)).size).toBe(history.length)
  expect(new Set(history.map(h => h.prompt.toLowerCase().replace(/\W+/g, ' ').trim())).size).toBe(history.length)
  const facts = history.filter(h => !h.repetitionIntent).map(h => h.factKey)
  expect(new Set(facts).size).toBe(facts.length)
}

for (const entry of [
  ['niels bohr.pdf', 'capable', true],
  ['niels bohr.pdf', 'misconception_prone', true],
  ['Documento_Matematico_Calculo.docx', 'capable', true],
  ['Documento_Matematico_Calculo.docx', 'assistance_dependent', false],
  ['Documento_Medico_Cardiovascular.docx', 'capable', true],
  ['Documento_Medico_Cardiovascular.docx', 'low_confidence', true],
  ['Documento_Medico_Cardiovascular.docx', 'random_guesser', false],
] as const) {
  test(`${entry[0]} · ${entry[1]}`, async ({ page }, info) => {
    await upload(page, info, entry[0], entry[1])
    const first = page.getByTestId('real-session-harness')
    const initialStrategy = await first.getAttribute('data-strategy')
    const result = await finish(page, entry[1])
    expect(result.turns).toBeLessThanOrEqual(80)
    expect(result.outcome).toBe(entry[2] ? 'program_complete' : 'valid_incomplete')
    expect(result).toMatchObject({ finalPhase: 'summary', historyPreserved: true, evidencePreserved: true })
    if (!entry[2]) {
      expect(Reflect.get(result, 'repairs')).toBeGreaterThan(0)
      expect(Reflect.get(result, 'sessions')).toBeGreaterThan(1)
    }
    await assertCanonicalFinal(page, entry[2])
    if (entry[0] === 'niels bohr.pdf') await expect(first).toHaveAttribute('data-required-count', '9')
    if (entry[1] === 'misconception_prone') {
      const history = JSON.parse((await page.getByTestId('real-session-harness').getAttribute('data-history')) || '[]') as Array<{ outcome: string; strategy: string }>
      expect(history[0].outcome).toBe('incorrect')
      expect(history.some(item => item.strategy !== initialStrategy)).toBe(true)
    }
    if (entry[1] === 'low_confidence') {
      const history = JSON.parse((await page.getByTestId('real-session-harness').getAttribute('data-history')) || '[]') as Array<{ outcome: string; strategy: string }>
      expect(history.every(item => item.outcome === 'correct')).toBe(true)
      expect(history.some(item => item.strategy.startsWith('repair-'))).toBe(false)
    }
    await screenshot(page, info, entry[2] ? 'cierre-final' : 'valid-incomplete')
  })
}

test('Niels Bohr conserva answering, feedback, confianza y salir/volver', async ({ page }, info) => {
  await upload(page, info, 'niels bohr.pdf', 'capable')
  const identity = async () => ({ id: await page.getByTestId('real-session-harness').getAttribute('data-interaction-id'), q: await page.getByTestId('real-session-harness').getAttribute('data-question-id') })
  const answering = await identity(); await page.reload(); expect(await identity()).toEqual(answering)
  await page.getByTestId('adaptive-interaction').locator('button').first().click()
  await expect(page.getByTestId('adaptive-feedback')).toBeVisible()
  const feedback = await identity(); await page.reload(); expect(await identity()).toEqual(feedback); await expect(page.getByTestId('adaptive-feedback')).toBeVisible()
  await page.getByTestId('adaptive-continue').click(); await page.getByRole('button', { name: 'Más o menos' }).click()
  await page.reload(); await expect(page.getByTestId('real-session-harness')).toHaveAttribute('data-interaction-phase', 'collecting_confidence')
  await page.getByTestId('confidence-continue').click()
  const beforeExit = await identity(); await page.getByTestId('back-to-book').click(); await page.getByTestId('start-session').click(); expect(await identity()).toEqual(beforeExit)
})

test('re-upload del mismo PDF crea programa y grafo con identidad nueva', async ({ page }, info) => {
  await upload(page, info, 'niels bohr.pdf', 'capable')
  const first = page.getByTestId('real-session-harness')
  const firstMaterialId = await first.getAttribute('data-material-id')
  const firstAssigned = (await first.getAttribute('data-assigned-ids') || '').split(',').filter(Boolean)

  await page.getByTestId('back-to-book').click()
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await upload(page, info, 'niels bohr.pdf', 'capable')
  const second = page.getByTestId('real-session-harness')
  const secondMaterialId = await second.getAttribute('data-material-id')
  const secondGraph = (await second.getAttribute('data-graph-ids') || '').split(',').filter(Boolean)
  const secondAssigned = (await second.getAttribute('data-assigned-ids') || '').split(',').filter(Boolean)

  expect(secondMaterialId).not.toBe(firstMaterialId)
  expect(secondAssigned.length).toBeGreaterThan(0)
  expect(secondAssigned.every(id => secondGraph.includes(id))).toBe(true)
  expect(secondAssigned.some(id => firstAssigned.includes(id))).toBe(false)
  await expect(page.getByText('MATERIAL_GRAPH_MISMATCH', { exact: false })).toHaveCount(0)
})

test('Bohr repair transiciona true_false a fill_blank_bank válido sin error del tutor', async ({ page }, info) => {
  await upload(page, info, 'niels bohr.pdf', 'misconception_prone')
  await answerTurn(page, 'misconception_prone', 0)
  await expect(page.getByTestId('adaptive-interaction')).toHaveAttribute('data-interaction-type', 'true_false')
  await answerTurn(page, 'misconception_prone', 1)
  await expect(page.getByTestId('adaptive-interaction')).toHaveAttribute('data-interaction-type', 'fill_blank_bank')
  await expect(page.getByTestId('adaptive-word-bank')).toBeVisible()
  await expect(page.getByText(/Algo salió mal|Error del tutor|INVALID_INTERACTION/)).toHaveCount(0)
})
