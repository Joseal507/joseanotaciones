import { expect, test } from '@playwright/test'

for (const outcome of ['ready', 'failed'] as const) {
  test(`Exam waits for the frozen artifact: ${outcome}`, async ({ page }) => {
    let generationCalls = 0
    let advanceCalls = 0
    let releaseAdvance: () => void = () => {}
    const advanceGate = new Promise<void>(resolve => { releaseAdvance = resolve })
    await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, sessions: [] }) }))
    const question = { id: 'frozen-1', slotId: 'frozen-1', section: 'Sección', type: 'true_false', prompt: 'La energía se conserva en un sistema aislado.', points: 10, skill: 'comprehension', difficulty: 'medium', ready: true }
    function response(status: 'generating' | 'ready') {
      return { success: true, status, readyCount: status === 'ready' ? 1 : 0, totalSlots: 1,
        blueprint: { authorityType: 'studyal_material_enjoyer', durationMinutes: 30 },
        exam: { id: 'frozen-exam', title: 'Examen', totalPoints: 10, estimatedDifficulty: 'medium', coverage: '1/1',
          sections: [{ id: 'Sección', title: 'Sección' }], questions: [{ ...question, ready: status === 'ready', prompt: status === 'ready' ? question.prompt : '' }] } }
    }
    await page.route('**/api/alai-studyal-exam', async route => {
      const body = route.request().postDataJSON()
      if (body.mode === 'recommend') return route.fulfill({ json: { success: true, idealDurationMinutes: 30 } })
      if (body.mode === 'generate') { generationCalls++; return route.fulfill({ json: response('generating') }) }
      if (body.mode === 'advance') {
        advanceCalls++
        await advanceGate
        return outcome === 'ready' ? route.fulfill({ json: response('ready') })
          : route.fulfill({ status: 500, json: { success: false, error: 'EXAM_GENERATION_FAILED' } })
      }
      return route.fulfill({ status: 400, json: { success: false } })
    })
    await page.goto('/e2e-free-continuity?tool=exam')
    await page.getByRole('button', { name: 'COMENZAR EXAMEN →', exact: true }).click()
    const start = page.getByRole('button', { name: 'Comenzar examen', exact: true })
    await expect(start).toBeDisabled()
    await expect.poll(() => advanceCalls).toBe(1)
    releaseAdvance()
    if (outcome === 'failed') {
      await expect(page.getByRole('alert').filter({ hasText: 'No se pudo completar' })).toBeVisible()
      await expect(start).toBeDisabled()
    } else {
      await expect(start).toBeEnabled()
      await start.click()
      await expect(page.getByText(question.prompt, { exact: true })).toBeVisible()
      await page.waitForTimeout(400)
      await page.reload()
      await expect(page.getByText(question.prompt, { exact: true })).toBeVisible()
    }
    await page.waitForTimeout(1700)
    expect(generationCalls).toBe(1)
    expect(advanceCalls).toBe(1)
  })
}
