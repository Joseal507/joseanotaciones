import type { Page, Route } from '@playwright/test'

export const theoryPage = (text = 'Los electrones ocupan niveles discretos.') => ({
  type: 'theory', title: 'Energía cuantizada', content: { blocks: [{ type: 'text', text }] },
})

export const questionPage = (id = 'q-energy', overrides: Record<string, unknown> = {}) => ({
  type: 'practice', title: 'Evidencia', content: { blocks: [] },
  interaction: { id, questionId: id, factKey: `${id}-fact`, interactionType: 'fill_blank', prompt: 'La energía indicada es ____ eV.', data: { template: 'E = ____ eV', bank: ['-3.4', '-13.6', '3.4'], correctAnswers: ['-3.4'] }, ...overrides },
})

export const common = {
  success: true,
  sessionId: 'e2e-session',
  systemInfo: { activeMicro: 'Energía cuantizada', microsCompleted: 0, microsTotal: 1, progress: 20 },
  coverageReport: {
    materialCoveragePercent: 50, studiedMicros: 1, totalMicros: 1,
    studiedMicroIds: ['micro_bohr_energy'], studiedMicroNames: ['Energía cuantizada'],
    provisionallyMasteredMicroIds: [], provisionallyMasteredMicroNames: [],
    reinforcementMicroIds: ['micro_bohr_energy'], reinforcementMicroNames: ['Energía cuantizada'],
  },
}

export async function mockAdaptive(page: Page, responses: Array<Record<string, unknown>>, options: { delayAt?: number; ask?: (question: string) => string } = {}) {
  let tutorCalls = 0
  const bodies: Array<Record<string, unknown>> = []
  await page.route('**/api/adaptive/v3/build-graph', route => route.fulfill({ json: { success: true, graph: { totalMicros: 1 }, stats: { bankMs: 0 } } }))
  await page.route('**/api/adaptive/v3/ask', async route => {
    const body = route.request().postDataJSON()
    await route.fulfill({ json: { success: true, answer: options.ask?.(body.question) || `Respuesta ${body.question}` } })
  })
  await page.route('**/api/adaptive/v3/tutor', async (route: Route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    bodies.push(body)
    const index = tutorCalls++
    if (options.delayAt === index) await new Promise(resolve => setTimeout(resolve, 350))
    const response = responses[Math.min(index, responses.length - 1)] || {}
    await route.fulfill({ json: { ...common, ...response, requestId: body.requestId } })
  })
  return { calls: () => tutorCalls, bodies }
}

export async function openQuestion(page: Page, id = 'q-energy') {
  const harness = await mockAdaptive(page, [{ page: theoryPage() }, { page: questionPage(id) }])
  await page.goto('/e2e-adaptive')
  await page.getByTestId('adaptive-continue').click()
  return harness
}

export function evaluation(id: string, outcome: 'correct' | 'partial' | 'incorrect' = 'correct') {
  return { interactionId: id, questionId: id, outcome, whatWasCorrect: 'La respuesta conserva el significado y la unidad.', whatWasMissing: 'Revisa la relación física.', correctAnswer: '-3.4 eV' }
}
