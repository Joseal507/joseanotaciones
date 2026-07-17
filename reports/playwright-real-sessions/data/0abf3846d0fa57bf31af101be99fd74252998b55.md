# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: real-sessions.spec.ts >> niels bohr.pdf · capable
- Location: tests/e2e-real-sessions/real-sessions.spec.ts:140:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('intro-session')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByTestId('intro-session')

```

```yaml
- main:
  - heading "Recorrido visual con material real" [level=1]
  - text: Perfil
  - combobox "Perfil":
    - option "capable" [selected]
    - option "misconception_prone"
    - option "assistance_dependent"
    - option "low_confidence"
    - option "random_guesser"
  - button "Choose File"
  - paragraph: Extrayendo y construyendo el programa…
- alert
```

# Test source

```ts
  1   | import path from 'node:path'
  2   | import { expect, test, type Page, type TestInfo } from '@playwright/test'
  3   | 
  4   | const fixture = (name: string) => path.resolve(process.cwd(), 'tests/fixtures/real-materials', name)
  5   | type Profile = 'capable' | 'misconception_prone' | 'assistance_dependent' | 'low_confidence' | 'random_guesser'
  6   | 
  7   | async function screenshot(page: Page, info: TestInfo, name: string) {
  8   |   await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true })
  9   | }
  10  | 
  11  | async function upload(page: Page, info: TestInfo, material: string, profile: Profile) {
  12  |   await page.goto('/e2e-real-sessions')
  13  |   await page.evaluate(() => localStorage.clear())
  14  |   await page.reload()
  15  |   await page.getByTestId('student-profile').selectOption(profile)
  16  |   await page.getByTestId('real-session-upload').setInputFiles(fixture(material))
> 17  |   await expect(page.getByTestId('intro-session')).toBeVisible()
      |                                                   ^ Error: expect(locator).toBeVisible() failed
  18  |   await screenshot(page, info, 'upload')
  19  |   await page.getByTestId('intro-next').click()
  20  |   await page.getByTestId('intro-next').click()
  21  |   await page.getByTestId('intro-enter-program').click()
  22  |   await expect(page.getByText('Libro canónico', { exact: false })).toBeVisible()
  23  |   await screenshot(page, info, 'libro-inicial')
  24  |   await page.getByTestId('start-session').click()
  25  |   await expect(page.getByTestId('adaptive-interaction')).toBeVisible()
  26  |   await screenshot(page, info, 'primera-pregunta')
  27  | }
  28  | 
  29  | async function answerTurn(page: Page, profile: Profile, turn: number) {
  30  |   if (profile === 'assistance_dependent') {
  31  |     await page.getByTestId('request-hint').click()
  32  |     await page.getByTestId('reveal-answer').click()
  33  |   }
  34  |   const interaction = page.getByTestId('adaptive-interaction')
  35  |   const format = await interaction.getAttribute('data-interaction-type')
  36  |   const buttons = interaction.locator('button')
  37  |   if (format === 'fill_blank_bank') {
  38  |     await buttons.first().click()
  39  |     await page.getByRole('button', { name: /Responder/ }).click()
  40  |   } else {
  41  |     await buttons.nth(profile === 'random_guesser' ? (turn % 2) + 1 : 0).click()
  42  |   }
  43  |   await expect(page.getByTestId('adaptive-feedback')).toBeVisible()
  44  |   await page.getByTestId('adaptive-continue').click()
  45  |   await expect(page.getByTestId('adaptive-confidence')).toBeVisible()
  46  |   const confidence = profile === 'low_confidence' ? 'No estaba seguro/a' : profile === 'misconception_prone' && turn === 0 ? 'Bastante seguro/a' : 'Más o menos'
  47  |   await page.getByRole('button', { name: confidence }).click()
  48  |   await page.getByTestId('confidence-continue').click()
  49  | }
  50  | 
  51  | async function finish(page: Page, profile: Profile) {
  52  |   const budgets = { sessions: 16, interactions: 80, repairs: 15 }
  53  |   const root = page.getByTestId('real-session-harness')
  54  |   let summaries = 0
  55  |   let repairs = 0
  56  |   let turns = 0
  57  |   let historyPreserved = true
  58  |   let evidencePreserved = true
  59  | 
  60  |   const readHistory = async () => JSON.parse((await root.getAttribute('data-history')) || '[]') as unknown[]
  61  |   const readEvidenceCounts = async () => {
  62  |     const diagnostics = JSON.parse((await root.getAttribute('data-evidence-diagnostics')) || '[]') as Array<{ microId: string; evidences: unknown[] }>
  63  |     return new Map(diagnostics.map(item => [item.microId, item.evidences.length]))
  64  |   }
  65  | 
  66  |   while (true) {
  67  |     const phase = await root.getAttribute('data-interaction-phase')
  68  |     if (phase === 'summary') {
  69  |       summaries++
  70  |       const sessions = Number(await root.getAttribute('data-session-count'))
  71  |       const result = { turns, summaries, repairs, sessions, finalPhase: 'summary' as const, historyPreserved, evidencePreserved }
  72  |       if (await root.getAttribute('data-is-program-complete') === 'true') return { ...result, outcome: 'program_complete' as const }
  73  | 
  74  |       const terminalReason = await root.getAttribute('data-fuse-reason')
  75  |       const repair = page.getByTestId('continue-repair')
  76  |       const canRepair = await repair.count() > 0
  77  |       const budgetExhausted = turns >= budgets.interactions || sessions >= budgets.sessions || repairs >= budgets.repairs
  78  |       if (!canRepair || terminalReason === 'global_budget_exhausted' || budgetExhausted) {
  79  |         return { ...result, outcome: 'valid_incomplete' as const }
  80  |       }
  81  | 
  82  |       const historyBefore = await readHistory()
  83  |       const evidenceBefore = await readEvidenceCounts()
  84  |       await repair.click()
  85  |       await expect(page.getByText('Libro canónico', { exact: false })).toBeVisible()
  86  |       const historyAfterRepair = await readHistory()
  87  |       const evidenceAfterRepair = await readEvidenceCounts()
  88  |       historyPreserved &&= historyBefore.every((item, index) => JSON.stringify(item) === JSON.stringify(historyAfterRepair[index]))
  89  |       evidencePreserved &&= [...evidenceBefore].every(([microId, count]) => (evidenceAfterRepair.get(microId) || 0) >= count)
  90  | 
  91  |       repairs++
  92  |       await page.getByTestId('start-session').click()
  93  |       await expect(page.getByTestId('adaptive-interaction')).toBeVisible()
  94  |       continue
  95  |     }
  96  | 
  97  |     expect(['answering', 'feedback', 'collecting_confidence']).toContain(phase)
  98  |     expect(turns).toBeLessThan(budgets.interactions)
  99  |     await answerTurn(page, profile, turns)
  100 |     turns++
  101 |   }
  102 | }
  103 | 
  104 | async function assertCanonicalFinal(page: Page, expectedComplete: boolean) {
  105 |   const root = page.getByTestId('real-session-harness')
  106 |   await expect(root).toHaveAttribute('data-is-program-complete', String(expectedComplete))
  107 |   const required = (await root.getAttribute('data-required-ids'))!.split(',').filter(Boolean)
  108 |   const studied = (await root.getAttribute('data-studied-ids'))!.split(',').filter(Boolean)
  109 |   const mastered = (await root.getAttribute('data-mastered-ids'))!.split(',').filter(Boolean)
  110 |   const unresolved = (await root.getAttribute('data-unresolved-ids'))!.split(',').filter(Boolean)
  111 |   const processed = (await root.getAttribute('data-processed-ids'))!.split(',').filter(Boolean)
  112 |   expect(new Set([...mastered, ...unresolved])).toEqual(new Set(required))
  113 |   expect(mastered.filter(id => unresolved.includes(id))).toEqual([])
  114 |   expect(required.every(id => studied.includes(id))).toBe(true)
  115 |   expect(processed.every(id => required.includes(id))).toBe(true)
  116 |   if (expectedComplete) {
  117 |     expect(required.every(id => processed.includes(id))).toBe(true)
```