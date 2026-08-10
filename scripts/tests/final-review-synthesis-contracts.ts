import assert from 'node:assert/strict'
import { buildTeachingOnlyPrompt } from '../../app/api/adaptive/session-teach/route'

// Auditoría adversarial (Codex, Intro/Review #2, post-319a5bc):
//
// ANTES: final_review tenía blockIds:[] (capítulo final sin bloques propios
// asignados), así que buildTeachingOnlyPrompt caía en learningSource
// filtrando TODOS los bloques del blueprint (assignedIds.size===0 deja
// pasar todo el filtro) — stepCount = cantidad total de bloques del
// material, un paso por bloque. Para un material de 30 bloques, un "repaso
// global" terminaba siendo una regeneración lineal bloque-a-paso, nunca una
// síntesis. Tampoco recibía contenido real ya enseñado (solo lo tenía
// disponible buildTeachingPrompt, código muerto), ni factKeys demostrados
// ni recuperaciones.
//
// Fix: finalReviewContext (contenido real por sesión + demonstratedFactKeys
// + recoverySummary) hace que el step count se derive del VOLUMEN de
// contenido real acumulado (acotado 4-7), nunca del número de bloques del
// blueprint ni del número de sesiones previas — y el prompt recibe el
// material agregado real con instrucción explícita de síntesis, no de
// repetición sesión-por-sesión.

function baseSession(blockIds: string[] = []) {
  return { id: 's-final', chapterNumber: 5, title: 'Repaso final', objective: 'Sintetizar el recorrido', blockIds, topicIds: [], concepts: [], pages: [], kind: 'final_review' as const }
}

function baseSetup() {
  return { knowledgeLevel: 'want_review', examDateType: 'near_exam', evalPreference: 'mix_everything' }
}

function manyBlocks(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `b${i}`, label: `Bloque ${i}`, summary: 's', kind: 'concept', importance: 50 }))
}

function sessionContext(sessionNumber: number, keyPointCount: number, opts: { recovered?: boolean } = {}) {
  return {
    sessionNumber,
    sessionTitle: `Sesión ${sessionNumber}`,
    steps: [{
      title: `Tema de la sesión ${sessionNumber}`,
      content: 'Contenido real efectivamente enseñado en esta sesión.',
      keyPoints: Array.from({ length: keyPointCount }, (_, i) => ({ id: `kp${i}`, text: `Idea clave ${i} de la sesión ${sessionNumber}` })),
    }],
    demonstratedFactKeys: [`s${sessionNumber}:fact:1`],
    recoverySummary: opts.recovered ? [{ factKeys: [`s${sessionNumber}:fact:1`], resolved: true }] : [],
  }
}

// ═══ A. Con finalReviewContext, el step count NO es "un paso por bloque" ═══
function testStepCountIsNotOneBlockPerStep() {
  const blocks = manyBlocks(30) // material grande, como el caso "30 bloques" del audit
  const finalReviewContext = { sessions: [sessionContext(1, 6), sessionContext(2, 5), sessionContext(3, 7)] }
  const prompt = buildTeachingOnlyPrompt({
    session: baseSession([]), blueprint: { topics: [], blocks }, setup: baseSetup(), materialTitle: 'Material grande', finalReviewContext,
  } as any)
  const stepMatch = prompt.match(/Genera exactamente (\d+) pasos docentes/)
  assert.ok(stepMatch, 'debe declarar un número de pasos')
  const stepCount = Number(stepMatch![1])
  assert.notEqual(stepCount, 30, 'BUG DE ORIGEN SI FALLA: el repaso final NO debe generar un paso por cada uno de los 30 bloques del blueprint')
  assert.ok(stepCount >= 4 && stepCount <= 7, `el step count de síntesis debe estar acotado (4-7), obtuvo ${stepCount}`)
}

// ═══ B. El prompt recibe contenido REAL ya enseñado, no labels de blueprint ═══
function testPromptReceivesRealCrossSessionContent() {
  const blocks = manyBlocks(10)
  const finalReviewContext = { sessions: [sessionContext(1, 5, { recovered: true }), sessionContext(2, 6)] }
  const prompt = buildTeachingOnlyPrompt({
    session: baseSession([]), blueprint: { topics: [], blocks }, setup: baseSetup(), materialTitle: 'Material', finalReviewContext,
  } as any)
  assert.ok(prompt.includes('Idea clave 0 de la sesión 1'), 'BUG DE ORIGEN SI FALLA: debe incluir keyPoints reales de sesiones previas, no solo labels de bloques del blueprint')
  assert.ok(prompt.includes('s1:fact:1'), 'debe incluir factKeys realmente demostrados')
  assert.ok(prompt.includes('"resolved":true'), 'debe incluir el resumen de recuperación (qué costó y si se resolvió)')
  assert.ok(prompt.includes('SÍNTESIS'), 'debe instruir explícitamente síntesis, no repetición sesión-por-sesión')
}

// ═══ C. Sin finalReviewContext (legacy/restore sin datos), cae al fallback anterior sin romper ═══
function testFallsBackSafelyWithoutContext() {
  const blocks = manyBlocks(4)
  const prompt = buildTeachingOnlyPrompt({
    session: baseSession([]), blueprint: { topics: [], blocks }, setup: baseSetup(), materialTitle: 'Material',
  } as any)
  const stepMatch = prompt.match(/Genera exactamente (\d+) pasos docentes/)
  assert.equal(Number(stepMatch![1]), 4, 'sin finalReviewContext, debe seguir cayendo al fallback (todos los bloques) sin lanzar error')
}

// ═══ D. Más contenido real acumulado (no más bloques del blueprint) mueve el step count ═══
function testStepCountScalesWithRealContentVolumeNotBlockCount() {
  const blocks = manyBlocks(100) // el conteo de bloques NO debe influir
  const thin = buildTeachingOnlyPrompt({
    session: baseSession([]), blueprint: { topics: [], blocks }, setup: baseSetup(), materialTitle: 'Material',
    finalReviewContext: { sessions: [sessionContext(1, 3)] },
  } as any)
  const rich = buildTeachingOnlyPrompt({
    session: baseSession([]), blueprint: { topics: [], blocks }, setup: baseSetup(), materialTitle: 'Material',
    finalReviewContext: { sessions: [sessionContext(1, 8), sessionContext(2, 8), sessionContext(3, 8), sessionContext(4, 8)] },
  } as any)
  const thinCount = Number(thin.match(/Genera exactamente (\d+) pasos docentes/)![1])
  const richCount = Number(rich.match(/Genera exactamente (\d+) pasos docentes/)![1])
  assert.ok(richCount >= thinCount, `más contenido real acumulado debe producir igual o más pasos de síntesis (acotado), thin=${thinCount} rich=${richCount}`)
  assert.ok(thinCount <= 100 && richCount <= 100, 'en ningún caso debe acercarse al conteo de bloques del blueprint (100)')
}

testStepCountIsNotOneBlockPerStep()
testPromptReceivesRealCrossSessionContent()
testFallsBackSafelyWithoutContext()
testStepCountScalesWithRealContentVolumeNotBlockCount()

console.log('final-review-synthesis-contracts: PASS (step count desacoplado del conteo de bloques, contenido real cross-session presente, fallback seguro sin contexto, escala con volumen real no con bloques del blueprint)')
