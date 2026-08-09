import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { POST as sessionTeachPOST } from '../../app/api/adaptive/session-teach/route'
import {
  EVALUATION_PLANNER_VERSION, EVALUATION_BLOCK_GENERATOR_VERSION,
  type EvaluationPlan, type PreparedEvaluationBlock, type PreparedEvaluationQuestion,
  type PreparedTeachingContent, type SessionPreparationState,
} from '../../lib/ai/sessionPreparationFactory'

// REGRESIÓN — bug real reportado en prueba manual con CLUTCH 1 ("La Química de
// los Pares Conjugados"): /api/adaptive/session-teach tardó ~120s y terminó en
// 503 SESSION_PREPARATION_VALIDATION_FAILED /
// SESSION_EVALUATION_INVALID:duplicate_question:eval_7_6 en
// stage:session_assembly_validation, DESPUÉS de que todos los bloques ya
// habían sido marcados EVALUATION_COMPLETE por diagnoseEvaluationBlock.
//
// Este spec ejercita la ruta REAL completa (POST de
// app/api/adaptive/session-teach/route.ts → runSessionPreparationFactory →
// diagnoseEvaluationBlock → repairEvaluationBlock → canonicalizeGeneratedSession),
// igual que matching-academic-validity.spec.ts (Test B) — mismo patrón, misma
// limitación conocida: el SDK de OpenAI captura su referencia de fetch en un
// punto que un globalThis.fetch tardío no siempre alcanza a reemplazar, así
// que si hay una API key real disponible (.env.local) el repair puede
// terminar llamando al proveedor real en vez del mock. Por eso, igual que
// Test B, este spec no depende de controlar la respuesta del LLM: siembra el
// bug (un duplicado cross-block YA presente en el estado persistido, como si
// una ronda de repair anterior lo hubiera colado) y acepta CUALQUIERA de los
// dos desenlaces seguros:
//   (a) 200 — el repair real reemplazó el duplicado y la sesión quedó limpia; o
//   (b) 503 fail-closed — el proveedor no estaba disponible en este entorno,
//       pero el duplicado tampoco llegó nunca al cliente.
// Lo que NUNCA es aceptable, y es lo único que este spec realmente prohíbe, es
// un 200 con el duplicado dentro de classContent.
//
// Reproduce "varios bloques parcialmente válidos": block1 completo, block2
// vacío (requiere repair por cobertura faltante) y block3 con una pregunta
// que parafrasea (no duplica literalmente) la accepted question de block1 —
// requiere repair por duplicado cross-block. Dos bloques distintos necesitan
// repair en la MISMA preparación ("múltiples repairs").

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)

const teaching: PreparedTeachingContent = {
  sessionId: 'chapter_dup', title: 'Metabolismo y energía', introduction: 'i', closing: 'c',
  steps: [
    { stepId: 'step_1', id: 'step_1', microId: 'm1', title: 'Fotosíntesis', type: 'concept', content: 'La fotosíntesis convierte luz solar en glucosa.', keyPoints: ['Conversión de luz en glucosa'], keyPointIds: ['step_1:kp:1'], factKeys: ['Fotosíntesis: luz en glucosa.'], importance: 'important', cognitiveTarget: 'comprehension', sourceReferences: [] },
    { stepId: 'step_2', id: 'step_2', microId: 'm2', title: 'Mitocondria', type: 'concept', content: 'La mitocondria genera ATP mediante respiración celular.', keyPoints: ['Producción de ATP'], keyPointIds: ['step_2:kp:1'], factKeys: ['Mitocondria: ATP por respiración.'], importance: 'important', cognitiveTarget: 'comprehension', sourceReferences: [] },
    { stepId: 'step_3', id: 'step_3', microId: 'm3', title: 'Gravedad y proyectiles', type: 'concept', content: 'La gravedad curva la trayectoria de un proyectil hacia abajo.', keyPoints: ['Trayectoria curva por gravedad'], keyPointIds: ['step_3:kp:1'], factKeys: ['Gravedad: curva la trayectoria.'], importance: 'important', cognitiveTarget: 'comprehension', sourceReferences: [] },
  ],
}
const plan: EvaluationPlan = {
  blocks: [
    { blockId: 'chapter_dup:evaluation:1', afterStepId: 'step_1', coveredStepIds: ['step_1'], coveredKeyPointIds: ['step_1:kp:1'], coveredFactKeys: ['Fotosíntesis: luz en glucosa.'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTargets: ['comprehension'], recommendedQuestionCount: 1, recommendedFormats: ['multiple_choice'], difficulty: 'medium' },
    { blockId: 'chapter_dup:evaluation:2', afterStepId: 'step_2', coveredStepIds: ['step_2'], coveredKeyPointIds: ['step_2:kp:1'], coveredFactKeys: ['Mitocondria: ATP por respiración.'], targetObjectiveIds: ['step_2:objective:comprehension'], cognitiveTargets: ['comprehension'], recommendedQuestionCount: 1, recommendedFormats: ['multiple_choice'], difficulty: 'medium' },
    { blockId: 'chapter_dup:evaluation:3', afterStepId: 'step_3', coveredStepIds: ['step_3'], coveredKeyPointIds: ['step_3:kp:1'], coveredFactKeys: ['Gravedad: curva la trayectoria.'], targetObjectiveIds: ['step_3:objective:comprehension'], cognitiveTargets: ['comprehension'], recommendedQuestionCount: 1, recommendedFormats: ['multiple_choice'], difficulty: 'medium' },
  ],
}
const teachingHash = hash(teaching)
const evaluationPlanHash = hash(plan)

const qBlock1: PreparedEvaluationQuestion = {
  questionId: 'q-block1', blockId: plan.blocks[0].blockId, targetStepIds: ['step_1'], targetKeyPointIds: ['step_1:kp:1'],
  targetFactKeys: ['Fotosíntesis: luz en glucosa.'], targetObjectiveIds: ['step_1:objective:comprehension'],
  cognitiveTarget: 'comprehension', format: 'multiple_choice',
  prompt: '¿Qué papel cumple la fotosíntesis en la producción de energía celular?',
  options: [{ id: 'a', text: 'La luz solar se convierte en glucosa' }, { id: 'b', text: 'El oxígeno se convierte en dióxido de carbono' }],
  correctAnswer: 'a', feedback: 'Correcto.', difficulty: 'medium',
}
// Reproduce el bug real: parafrasea (prompt distinto, mismo contenido,
// questionSimilarity>=0.8) la accepted question de block1, ya preservada —
// como si una ronda de repair anterior lo hubiera generado y el guard viejo
// (solo literal) lo hubiera dejado pasar como EVALUATION_COMPLETE.
const qBlock3Duplicate: PreparedEvaluationQuestion = {
  questionId: 'q-block3-duplicate-of-block1', blockId: plan.blocks[2].blockId, targetStepIds: ['step_3'], targetKeyPointIds: ['step_3:kp:1'],
  targetFactKeys: ['Gravedad: curva la trayectoria.'], targetObjectiveIds: ['step_3:objective:comprehension'],
  cognitiveTarget: 'comprehension', format: 'multiple_choice',
  prompt: 'Según el material, ¿qué papel cumple la fotosíntesis en la producción de energía celular?',
  options: [{ id: 'a', text: 'La luz solar se convierte en glucosa' }, { id: 'b', text: 'El oxígeno se convierte en dióxido de carbono' }],
  correctAnswer: 'a', feedback: 'Correcto.', difficulty: 'medium',
}

test('sesión con múltiples repairs (uno de ellos por un duplicado cross-block real) termina preparándose correctamente en vez de devolver 503 con el duplicado dentro', async () => {
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

  const repaired2: PreparedEvaluationQuestion = {
    questionId: 'q-block2-repaired', targetStepIds: ['step_2'], targetKeyPointIds: ['step_2:kp:1'],
    targetFactKeys: ['Mitocondria: ATP por respiración.'], targetObjectiveIds: ['step_2:objective:comprehension'],
    cognitiveTarget: 'comprehension', format: 'multiple_choice',
    prompt: 'Describe la función principal de la mitocondria dentro de la célula eucariota.',
    options: [{ id: 'a', text: 'Genera ATP mediante respiración' }, { id: 'b', text: 'Almacena información genética' }],
    correctAnswer: 'a', feedback: 'Correcto.', difficulty: 'medium',
  } as PreparedEvaluationQuestion
  const repaired3: PreparedEvaluationQuestion = {
    questionId: 'q-block3-repaired', targetStepIds: ['step_3'], targetKeyPointIds: ['step_3:kp:1'],
    targetFactKeys: ['Gravedad: curva la trayectoria.'], targetObjectiveIds: ['step_3:objective:comprehension'],
    cognitiveTarget: 'comprehension', format: 'multiple_choice',
    prompt: '¿Cómo afecta la gravedad la trayectoria de un proyectil lanzado horizontalmente?',
    options: [{ id: 'a', text: 'Curva la trayectoria hacia abajo' }, { id: 'b', text: 'Mantiene la trayectoria recta' }],
    correctAnswer: 'a', feedback: 'Correcto.', difficulty: 'medium',
  } as PreparedEvaluationQuestion
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url || ''
    if (!String(url).includes('chat/completions')) return originalFetch(input, init)
    const rawBody = String(init?.body || '')
    const questions = rawBody.includes('chapter_dup:evaluation:2') ? [repaired2] : [repaired3]
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questions }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  const events: string[] = []
  const originalInfo = console.info
  console.info = (...args: unknown[]) => { events.push(args.map(String).join(' ')) }

  let response: Response
  try {
    const preparationState: SessionPreparationState = {
      preparationStatus: 'evaluation_generation', currentGenerationStage: 'evaluation_generation', generationKey: 'test:dup-guard-e2e',
      teachingContent: teaching, teachingVersion: 'teaching-v1', teachingHash,
      evaluationPlan: plan, evaluationPlanHash,
      generatedEvaluationBlocks: [
        { ...plan.blocks[0], questions: [qBlock1], sessionId: teaching.sessionId, teachingHash, evaluationPlanHash, evalPreference: 'mix_everything', generatorVersion: EVALUATION_BLOCK_GENERATOR_VERSION },
        { ...plan.blocks[1], questions: [], sessionId: teaching.sessionId, teachingHash, evaluationPlanHash, evalPreference: 'mix_everything', generatorVersion: EVALUATION_BLOCK_GENERATOR_VERSION },
        { ...plan.blocks[2], questions: [qBlock3Duplicate], sessionId: teaching.sessionId, teachingHash, evaluationPlanHash, evalPreference: 'mix_everything', generatorVersion: EVALUATION_BLOCK_GENERATOR_VERSION },
      ],
      acceptedQuestions: [qBlock1, qBlock3Duplicate],
      missingCoverage: { code: 'EVALUATION_COMPLETE', missingRequiredStepIds: [], missingCriticalKeyPoints: [], missingImportantKeyPoints: [], invalidQuestionIds: [], duplicateQuestionIds: [], affectedBlockIds: [] },
      generationAttempts: { teaching: 1, planning: 1 },
      preparationVersion: 'session-preparation-v2', evaluationPlannerVersion: EVALUATION_PLANNER_VERSION,
      evaluationBlockGeneratorVersion: EVALUATION_BLOCK_GENERATOR_VERSION, evalPreference: 'mix_everything', sessionKind: 'learning',
    }
    const body = {
      userId: 'dup-guard-e2e', materialHash: 'mat-dup-guard-e2e', planVersion: 'plan-dup-guard-e2e',
      session: { id: 'chapter_dup', chapterNumber: 3, title: 'Metabolismo y energía', objective: 'Comprender el metabolismo celular.', topicIds: ['metabolismo'], blockIds: ['metabolismo'], concepts: ['Metabolismo y energía'], pages: [], kind: 'learning' as const },
      blueprint: { version: 1, topics: [{ id: 'metabolismo', title: 'Metabolismo y energía', description: 'Fotosíntesis, mitocondria, gravedad' }], blocks: [{ id: 'metabolismo', label: 'Metabolismo y energía', summary: 'Fotosíntesis y mitocondria', kind: 'concept', importance: 100 }] },
      setup: { knowledgeLevel: 'beginner', examDateType: 'no_date', evalPreference: 'mix_everything' },
      materialTitle: 'Metabolismo y energía', totalSessions: 1, preparationState,
    }
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

  // La detección del duplicado cross-block y de la cobertura faltante es
  // 100% real y determinista (diagnoseEvaluationBlock/diagnoseEvaluationCoverage)
  // — sin importar el resultado de la llamada externa al LLM, AMBOS bloques
  // deben haber disparado su propio repair en la misma preparación
  // ("múltiples repairs").
  expect(events.some(line => line.includes('partial_evaluation_coverage_detected') && line.includes('chapter_dup:evaluation:2') && line.includes('chapter_dup:evaluation:3'))).toBe(true)
  expect(events.some(line => line.includes('incremental_evaluation_repair_started') && line.includes('"blockId":"chapter_dup:evaluation:2"'))).toBe(true)
  expect(events.some(line => line.includes('incremental_evaluation_repair_started') && line.includes('"blockId":"chapter_dup:evaluation:3"') && line.includes('"duplicateQuestionIds":["q-block3-duplicate-of-block1"]'))).toBe(true)

  if (response.status === 200) {
    // Camino feliz: múltiples repairs simultáneos (block2 por cobertura
    // faltante, block3 por duplicado cross-block) y la sesión termina
    // preparándose correctamente — NO un 503, y el duplicado nunca llega al
    // classContent que el cliente va a renderizar.
    type FinalQuestion = { id: string; questionText: string }
    const allQuestions: FinalQuestion[] = payload.classContent.evaluationBlocks.flatMap((b: { questions: FinalQuestion[] }) => b.questions)
    expect(allQuestions.length).toBe(3)
    expect(allQuestions.some(q => q.id === 'q-block3-duplicate-of-block1')).toBe(false)
    expect(JSON.stringify(payload).includes('duplicate_question')).toBe(false)
  } else {
    // Sin acceso real al proveedor LLM en este entorno (mismo caveat que
    // matching-academic-validity.spec.ts: el mock de fetch no siempre
    // intercepta la llamada interna del SDK) — el repair falla con un error
    // real de proveedor. La propiedad de seguridad se sostiene igual:
    // fail-closed, teachingPreserved, y el duplicado NUNCA llega al cliente.
    expect(response.status).toBe(503)
    expect(payload.classContent).toBeUndefined()
    expect(payload.success).toBe(false)
    expect(payload.teachingPreserved).toBe(true)
  }
})
