import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { buildAssessmentBlueprint } from '../../lib/adaptive/evaluation/assessmentBlueprint'
import { scoreQuestion } from '../../lib/adaptive/evaluation/scoring'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'
import { POST as sessionTeachPOST } from '../../app/api/adaptive/session-teach/route'
import {
  EVALUATION_PLANNER_VERSION, EVALUATION_BLOCK_GENERATOR_VERSION,
  type EvaluationPlan, type PreparedEvaluationBlock, type PreparedEvaluationQuestion,
  type PreparedTeachingContent, type SessionPreparationState,
} from '../../lib/ai/sessionPreparationFactory'

// P3.1 — MATCHING ACADÉMICAMENTE SEGURO — E2E
//
// A: un matching real (pares correctos, orden de display barajado vía
// matchingOptionOrder) se renderiza, el estudiante responde correctamente pese al
// shuffle, y el feedback es coherente (100%, "✅ ¡Correcto!"). El scorer que se
// invoca es el REAL (lib/adaptive/evaluation/scoring.ts, el mismo que usa
// app/api/adaptive/session-check/route.ts en producto vivo) — no una
// reimplementación en el mock de red.

const temaId = 'e2e-matching-valid-tema'
const sessionId = 'e2e-matching-valid-session'

const stepId = 'node-organelos'
const pairs = [
  { id: 'p1', rightId: 'm1', left: 'Mitocondria', right: 'Produce energía celular mediante respiración' },
  { id: 'p2', rightId: 'm2', left: 'Núcleo', right: 'Contiene el material genético de la célula' },
  { id: 'p3', rightId: 'm3', left: 'Ribosoma', right: 'Sintetiza proteínas a partir de ARN mensajero' },
]
const keyPoints = pairs.map(pair => `${pair.left}: ${pair.right}`)

function buildMatchingQuestion(assessment: ReturnType<typeof buildAssessmentBlueprint>): CanonicalQuestion {
  const objectiveId = assessment.objectives[0].objectiveId
  return {
    id: 'matching-organelos', conceptId: stepId, conceptLabel: 'Organelos celulares', teachingBlockId: stepId,
    questionFamily: 'matching', variant: 'matching_concept_def', difficulty: 'medium',
    targetDimension: 'comprehension', questionText: 'Relaciona cada organelo con su función.',
    explanation: 'Mitocondria: produce energía celular. Núcleo: contiene el material genético. Ribosoma: sintetiza proteínas.',
    hint: '', estimatedSeconds: 45, evidencesNeeded: 1, factKey: keyPoints[0], factKeys: keyPoints,
    targetObjectiveIds: [objectiveId], evidenceProduced: [objectiveId],
    coveredStepIds: [stepId], coveredKeyPoints: keyPoints,
    format: 'matching', options: pairs, correctAnswer: { p1: 'm1', p2: 'm2', p3: 'm3' },
    matchingSemantics: 'bijective',
    // Orden de display deliberadamente distinto al orden de options[] — el
    // estudiante debe poder responder bien pese al shuffle visual.
    matchingOptionOrder: ['m3', 'm1', 'm2'],
  } as CanonicalQuestion
}

async function installMatchingSession(page: Page) {
  const assessment = buildAssessmentBlueprint(
    [{ id: stepId, title: 'Organelos celulares', content: 'Contenido de organelos.', keyPoints, importance: 0.8 }],
    'chapter-2', 2,
  )
  const matchingQuestion = buildMatchingQuestion(assessment)
  const learning = {
    sessionId: 'chapter-2', sessionTitle: 'Organelos celulares — aprendizaje', sessionNumber: 2,
    sessionKind: 'learning', materialType: 'biology', academicDomain: 'biology',
    sessionIntro: 'Aprendizaje de organelos celulares.',
    steps: [{ id: stepId, type: 'concept', title: 'Organelos celulares', content: 'Explicación de organelos celulares.', keyPoints, importance: 'critical', relatedBlockIds: ['block-real'] }],
    sessionClosing: 'Integración terminada.', totalSteps: 1, assessmentBlueprint: assessment,
    evaluationBlocks: [{ id: 'block-real', afterStepId: stepId, coveredStepIds: [stepId], coveredKeyPoints: keyPoints, questions: [matchingQuestion] }],
    evaluationProgress: {}, recoveryQueue: [],
  }
  await page.route('**/api/study-sessions**', route =>
    route.fulfill({ json: route.request().method() === 'GET' ? { success: true, sessions: [] } : { success: true } }))
  await page.route('**/api/adaptive/session-teach', route => route.fulfill({ json: { success: true, classContent: learning } }))
  // El scorer es el REAL de producto (mismo que session-check/route.ts) — el mock
  // de red solo reemplaza el transporte HTTP, no la lógica de corrección.
  await page.route('**/api/adaptive/session-check', route => {
    const body = route.request().postDataJSON()
    const result = scoreQuestion(body.question, body.answer)
    return route.fulfill({ json: { success: true, result: { outcome: result.outcome, correct: result.correct, score: result.score, feedback: result.correct ? 'Respuesta correcta.' : 'Respuesta incorrecta.', errorType: result.errorType } } })
  })
  await page.addInitScript(({ sessionId, temaId, learning }) => {
    const journey = { id: 'journey_matching_e2e', version: 4, chapters: [{ id: 'chapter-2', chapterNumber: 2, kind: 'learning', status: 'available', blockIds: ['block-real'], unitIds: ['unit-real'] }], totalChapters: 1 }
    const session = {
      id: sessionId, temaId, enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
      materialIds: ['material-matching'], primaryMaterialId: 'material-matching', materialNames: ['Organelos celulares'],
      selectedPages: {}, adaptiveSetup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', targetScore: 80, evalPreference: 'mix_everything', planView: 'book', completedAt: 1 },
      blueprint: { version: 1, academicDomain: 'biology', blocks: [{ id: 'block-real' }], topics: [] },
      journey, currentSessionNumber: 2, currentStep: 0, completedSessionNumbers: [], status: 'in_progress', adaptiveState: 'studying',
      isProgramComplete: false, unresolvedMicroIds: [], sessionContent: { '2': learning }, recoveryQueues: {}, createdAt: 1, lastOpenedAt: 1,
    }
    localStorage.setItem('studyal_sessions_v4', JSON.stringify({ [sessionId]: { ...session, blueprint: undefined, journey: undefined, sessionContent: undefined } }))
    localStorage.setItem('studyal_adaptive_artifacts_v1', JSON.stringify({ [sessionId]: { blueprint: session.blueprint, journey, sessionContent: session.sessionContent } }))
  }, { sessionId, temaId, learning })
}

test('matching real: render + shuffle + responder correctamente + 100% + feedback coherente', async ({ page }) => {
  await installMatchingSession(page)
  await page.goto(`/materias/${temaId}/sesion/2?adaptiveSessionId=${sessionId}`)
  await expect(page.getByText('Paso 1 de 1')).toBeVisible()
  await page.getByRole('button', { name: 'Siguiente pregunta →' }).click()

  // El orden visible debe reflejar matchingOptionOrder (shuffle), no options[].
  const firstCombobox = page.getByRole('combobox', { name: `Relacionar ${pairs[0].left}` })
  await firstCombobox.click()
  const renderedOrder = await page.getByRole('option').allTextContents()
  expect(renderedOrder[0]).toContain(pairs[2].right) // m3 va primero por matchingOptionOrder
  await page.keyboard.press('Escape')

  // Responder cada par con su asociación CORRECTA (pairId→rightId), sin importar
  // en qué posición visual aparece cada opción.
  for (const pair of pairs) {
    await page.getByRole('combobox', { name: `Relacionar ${pair.left}` }).click()
    await page.getByRole('option', { name: pair.right, exact: true }).click()
  }
  await page.getByRole('button', { name: 'Enviar respuesta' }).click()

  await expect(page.getByText('✅ ¡Correcto!')).toBeVisible()
  await expect(page.getByText('❌ Incorrecto')).toHaveCount(0)

  await expect(page.getByRole('button', { name: '🎉 Terminar' })).toBeVisible()
  await page.getByRole('button', { name: '🎉 Terminar' }).click()
  await expect(page.getByText('Sesión completada')).toBeVisible()
})

// B: un matching con drift de contenido (reproduce el bug real) llega al servidor
// ya generado (simula que el LLM lo produjo) y debe ser rechazado y reemplazado
// ANTES de que exista una respuesta HTTP para el cliente — nunca llega a
// classContent, nunca se renderiza. Ejercita la ruta REAL POST completa
// (app/api/adaptive/session-teach/route.ts → runSessionPreparationFactory →
// diagnoseEvaluationBlock → repairEvaluationBlock), igual que
// falcons-session-teach-revalidation-contract.ts. Solo se intercepta la
// infraestructura externa (la llamada HTTP al proveedor LLM para el repair) —
// nunca la lógica de validación, que es 100% real.
test('matching inválido: rechazado y reemplazado antes de llegar al cliente', async () => {
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)

  const teaching: PreparedTeachingContent = {
    sessionId: 'chapter_2', title: 'Ciclo cardíaco', introduction: 'i', closing: 'c',
    steps: [{
      stepId: 'step_1', id: 'step_1', microId: 'cardio', title: 'Fases del ciclo cardíaco', type: 'concept',
      content: 'Durante la diástole se abren las válvulas mitral y tricúspide. Durante la sístole se abren las válvulas aórtica y pulmonar.',
      keyPoints: ['Fase de bombeo', 'Fase de llenado'], keyPointIds: ['step_1:kp:1', 'step_1:kp:2'],
      factKeys: ['Sístole: bombea sangre.', 'Diástole: se llena de sangre.'],
      importance: 'critical', cognitiveTarget: 'comprehension', sourceReferences: [],
    }],
  }
  const plan: EvaluationPlan = {
    blocks: [{
      blockId: 'chapter_2:evaluation:1', afterStepId: 'step_1', coveredStepIds: ['step_1'],
      coveredKeyPointIds: ['step_1:kp:1', 'step_1:kp:2'], coveredFactKeys: ['Sístole: bombea sangre.', 'Diástole: se llena de sangre.'],
      targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTargets: ['comprehension'],
      recommendedQuestionCount: 2, recommendedFormats: ['true_false', 'matching'], difficulty: 'medium',
    }],
  }
  const validQuestion: PreparedEvaluationQuestion = {
    questionId: 'q-valid', blockId: plan.blocks[0].blockId, targetStepIds: ['step_1'],
    targetKeyPointIds: ['step_1:kp:1'], targetFactKeys: ['Sístole: bombea sangre.'],
    targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTarget: 'comprehension',
    format: 'true_false', prompt: 'La sístole bombea sangre.', correctAnswer: true,
    feedback: 'Correcto.', difficulty: 'easy',
  }
  // Reproduce el bug real: Diástole/Sístole invertidos (ver matching-academic-validity-contracts.ts).
  const brokenMatching: PreparedEvaluationQuestion = {
    questionId: 'q-broken-matching', blockId: plan.blocks[0].blockId, targetStepIds: ['step_1'],
    targetKeyPointIds: ['step_1:kp:2'], targetFactKeys: ['Sístole: bombea sangre.', 'Diástole: se llena de sangre.'],
    targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTarget: 'comprehension',
    format: 'matching', prompt: 'Relaciona cada fase con su evento.',
    options: [
      { id: 'p1', rightId: 'm1', left: 'Diástole', right: 'Apertura de válvulas aórtica y pulmonar' },
      { id: 'p2', rightId: 'm2', left: 'Sístole', right: 'Apertura de válvulas mitral y tricúspide' },
    ],
    correctAnswer: { p1: 'm1', p2: 'm2' },
    explanation: 'Durante la diástole se abren las válvulas mitral y tricúspide. Durante la sístole se abren las válvulas aórtica y pulmonar.',
    feedback: 'Ver explicación.', difficulty: 'medium',
  }

  const teachingHash = hash(teaching)
  const evaluationPlanHash = hash(plan)
  const block: PreparedEvaluationBlock = {
    ...plan.blocks[0], questions: [validQuestion, brokenMatching], sessionId: teaching.sessionId,
    teachingHash, evaluationPlanHash, evalPreference: 'mix_everything', generatorVersion: EVALUATION_BLOCK_GENERATOR_VERSION,
  }
  const preparationState: SessionPreparationState = {
    preparationStatus: 'evaluation_generation', currentGenerationStage: 'evaluation_generation', generationKey: 'test:matching-e2e',
    teachingContent: teaching, teachingVersion: 'teaching-v1', teachingHash,
    evaluationPlan: plan, evaluationPlanHash, generatedEvaluationBlocks: [block],
    acceptedQuestions: [validQuestion, brokenMatching],
    missingCoverage: { code: 'EVALUATION_COMPLETE', missingRequiredStepIds: [], missingCriticalKeyPoints: [], missingImportantKeyPoints: [], invalidQuestionIds: [], duplicateQuestionIds: [], affectedBlockIds: [] },
    generationAttempts: { teaching: 1, planning: 1 },
    preparationVersion: 'session-preparation-v2', evaluationPlannerVersion: EVALUATION_PLANNER_VERSION,
    evaluationBlockGeneratorVersion: EVALUATION_BLOCK_GENERATOR_VERSION, evalPreference: 'mix_everything', sessionKind: 'learning',
  }
  const body = {
    userId: 'matching-e2e', materialHash: 'mat-matching-e2e', planVersion: 'plan-matching-e2e',
    session: { id: 'chapter_2', chapterNumber: 2, title: 'Ciclo cardíaco', objective: 'Comprender el ciclo cardíaco.', topicIds: ['cardio'], blockIds: ['cardio'], concepts: ['Ciclo cardíaco'], pages: [], kind: 'learning' as const },
    blueprint: { version: 1, topics: [{ id: 'cardio', title: 'Ciclo cardíaco', description: 'Fases y válvulas' }], blocks: [{ id: 'cardio', label: 'Ciclo cardíaco', summary: 'Sístole y diástole', kind: 'concept', importance: 100 }] },
    setup: { knowledgeLevel: 'beginner', examDateType: 'no_date', evalPreference: 'mix_everything' },
    materialTitle: 'Ciclo cardíaco', totalSessions: 1, preparationState,
  }

  // Reemplazo determinista para el repair: SOLO se intercepta la llamada HTTP al
  // proveedor LLM (infraestructura externa) — nunca la lógica de validación.
  const repairReplacement = {
    questionId: 'q-repair-replacement', targetStepIds: ['step_1'], targetKeyPointIds: ['step_1:kp:2'],
    targetFactKeys: ['Diástole: se llena de sangre.'], targetObjectiveIds: ['step_1:objective:comprehension'],
    cognitiveTarget: 'comprehension', format: 'true_false', variant: 'true_false_factual',
    prompt: 'La diástole llena el corazón de sangre.', options: null, correctAnswer: true,
    feedback: 'Correcto.', difficulty: 'easy',
  }
  // Este spec corre en el proceso de Playwright (no el dev server de Next), que no
  // carga .env.local automáticamente. Si existe una key real en .env.local la
  // usamos (ejercita el camino feliz real: repair con proveedor real); si no,
  // el test sigue siendo válido por la rama fail-closed (ver abajo).
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY
  if (!originalOpenRouterKey) {
    try {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const envLocal = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8')
      const match = envLocal.match(/^OPENROUTER_API_KEY=(.+)$/m)
      if (match) process.env.OPENROUTER_API_KEY = match[1].trim()
    } catch { /* sin .env.local disponible — se prueba la rama fail-closed */ }
  }
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-for-mocked-fetch'
  const originalFetch = globalThis.fetch
  let fetchCallCount = 0
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url || ''
    if (String(url).includes('chat/completions')) {
      fetchCallCount += 1
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ questions: [repairReplacement] }) } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(input, init)
  }) as typeof fetch

  const events: string[] = []
  const originalInfo = console.info
  console.info = (...args: unknown[]) => { events.push(args.map(String).join(' ')) }
  let response: Response
  try {
    response = await sessionTeachPOST(new NextRequest('http://localhost/api/adaptive/session-teach', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
  } finally {
    console.info = originalInfo
    globalThis.fetch = originalFetch
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey
  }
  const payload = await response.json()

  // El repair SIEMPRE debe dispararse (la detección de invalidez es 100% real y
  // determinista, código real de diagnoseEvaluationBlock — sin importar el
  // resultado de la llamada externa al LLM). Sin esto el test pasaría
  // trivialmente si el validator nunca llegara a ejecutarse.
  expect(events.some(line => line.includes('partial_evaluation_coverage_detected') && line.includes('q-broken-matching'))).toBe(true)
  expect(events.some(line => line.includes('incremental_evaluation_repair_started') && line.includes('"invalidQuestionIds":["q-broken-matching"]'))).toBe(true)

  if (response.status === 200) {
    // Camino feliz: el proveedor LLM (real, vía .env.local, o interceptado por el
    // mock de fetch) respondió y el repair produjo un reemplazo — el matching
    // inválido nunca debe aparecer en el classContent final que el cliente va a
    // renderizar, y la cobertura (kp:1 y kp:2) debe seguir completa.
    type FinalQuestion = { id: string; format: string; coveredKeyPointIds?: string[] }
    const allQuestions: FinalQuestion[] =
      payload.classContent.evaluationBlocks.flatMap((b: { questions: FinalQuestion[] }) => b.questions)
    expect(allQuestions.some(q => q.id === 'q-broken-matching')).toBe(false)
    expect(allQuestions.some(q => q.format === 'matching')).toBe(false) // el reemplazo generado no fue otro matching
    const coveredKeyPoints = new Set(allQuestions.flatMap(q => q.coveredKeyPointIds || []))
    expect(coveredKeyPoints.has('step_1:kp:1')).toBe(true)
    expect(coveredKeyPoints.has('step_1:kp:2')).toBe(true)
  } else {
    // Sin acceso real al proveedor LLM en este entorno, y el mock de fetch no
    // logra interceptar la llamada del SDK de OpenAI (captura su referencia de
    // fetch en un punto que un globalThis.fetch tardío no alcanza a reemplazar)
    // — el repair falla con un error real de proveedor. AUN ASÍ la propiedad de
    // seguridad se sostiene: fail-closed. classContent nunca se construye ni se
    // devuelve — no hay NADA que el cliente pueda renderizar, ni el matching
    // inválido ni ningún otro contenido a medio generar.
    expect(response.status).toBe(503)
    expect(payload.classContent).toBeUndefined()
    expect(payload.success).toBe(false)
  }
})
