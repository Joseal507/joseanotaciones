import './page-study-env'
import assert from 'node:assert/strict'
import { buildFixtureCorpus, makeWorld, type FixtureMaterialSpec } from './page-study-tutor-harness'

/**
 * Phase 5 Blocker 3, Probe C: a LITERAL quadratic-functions fixture, driven through the REAL
 * orchestration. Every fact the tutor can use is written into the fixture — no outside math
 * knowledge is authorized.
 */
const QUADRATICS: FixtureMaterialSpec = {
  materialId: 'pdf-1', name: 'Funciones cuadráticas', lang: 'es', pageCount: 2,
  concepts: [
    { id: 'form', page: 1, label: 'Forma general', quote: 'Una función cuadrática tiene la forma y = ax² + bx + c, donde a, b y c son constantes y a ≠ 0.', summary: 'Forma general: y = ax² + bx + c.' },
    { id: 'axis', page: 1, label: 'Eje de simetría', quote: 'El eje de simetría de la parábola se calcula con la fórmula x = -b / (2a).', summary: 'Eje de simetría: x = -b/(2a).' },
    { id: 'worked', page: 1, label: 'Ejemplo resuelto', quote: 'Ejemplo: para y = x² - 4x + 3, el eje de simetría es x = -(-4)/(2·1) = 2, y el vértice está en (2, -1).', summary: 'Ejemplo resuelto: eje de simetría x=2, vértice (2,-1) para y=x²-4x+3.' },
    { id: 'opening', page: 2, label: 'Dirección de apertura', quote: 'Si a es positivo la parábola abre hacia arriba; si a es negativo, abre hacia abajo.', summary: 'Signo de a determina si abre hacia arriba o hacia abajo.' },
    { id: 'roots', page: 2, label: 'Raíces / intersecciones con x', quote: 'Las raíces de la función son los valores de x donde y = 0, es decir, donde la parábola cruza el eje x.', summary: 'Raíces: valores de x donde y=0.' },
  ],
}

async function main() {
  const corpus = buildFixtureCorpus([QUADRATICS], 2)
  const w = await makeWorld({ corpus })
  const transcript: string[] = []

  // TEACH[quadratic form] — must explain the METHOD/concept, grounded in the fixture's own notation.
  const start = await w.start()
  transcript.push(`TEACH[${Object.keys((await w.load()).state.concepts).join(',')}]`)
  assert.equal(start.turn.pendingQuestion, null, 'opens by teaching, not asking')
  const startPrompt = w.counters.prompts[0]
  assert.ok(startPrompt.includes('y = ax² + bx + c') || startPrompt.includes('x = -b / (2a)'), 'the teaching prompt is grounded in the LITERAL quadratic-form/axis-of-symmetry notation from the fixture')

  // TEACH/CONTINUE[axis/vertex + worked example]
  let stateNow = (await w.load()).state
  if (stateNow.pending) { await w.say('ANS-OK claro'); }
  const t2 = await w.say('sigue')
  transcript.push('TEACH/CONTINUE[axis,worked-example]')
  const t2Prompt = w.counters.prompts.at(-1)!
  assert.ok(t2Prompt.includes('Ejemplo resuelto') || t2Prompt.includes('vértice'), 'a grounded worked example reaches the teaching prompt')
  void t2

  // CHECK[application] — student applies something, gets it WRONG.
  stateNow = (await w.load()).state
  let guard = 0
  while (!stateNow.pending && guard < 4) { await w.say('sigue'); stateNow = (await w.load()).state; guard++ }
  assert.ok(stateNow.pending, 'a purposeful check follows the worked example')
  const targetA = stateNow.pending!.unitRefs[0]
  transcript.push(`CHECK[${targetA}]`)

  w.behavior.queue.push('[[U:answer]] [[V:incorrect]] [[M:cree que el eje de simetría es x=-4::el eje de simetría es x=-b/(2a)]] No exactamente: recuerda que el eje de simetría se calcula con x = -b/(2a), no solo con -b. Repasemos la fórmula.')
  const wrong = await w.say('creo que x = -4')
  transcript.push('STUDENT[wrong]')
  assert.equal(wrong.turn.graded, 'incorrect')
  transcript.push('FEEDBACK/REMEDIATE[corrects the reasoning, not just "incorrecto"]')
  assert.ok(wrong.turn.reply.length > 20 && !/^incorrecto\.?$/i.test(wrong.turn.reply.trim()), 'the correction explains the REASONING (references the formula), not a bare "incorrect"')
  stateNow = (await w.load()).state
  assert.equal(stateNow.pending, null, 'the correction resolves the check')

  // NOT immediately re-asked on the same target.
  const rightAfter = await w.say('sigue')
  stateNow = (await w.load()).state
  assert.ok(!stateNow.pending || stateNow.pending.unitRefs[0] !== targetA, 'the same application target is NOT immediately re-asked')
  transcript.push('TEACH[new concept: opening direction / roots]')
  void rightAfter

  // RETEST[application-different] — delayed, after intervening teaching.
  let sawDelayedRetest = false
  guard = 0
  while (!sawDelayedRetest && guard < 12) {
    guard++
    const before = (await w.load()).state
    await w.say(before.pending ? 'ANS-OK ahora sí, x = -b/(2a)' : 'sigue')
    const after = (await w.load()).state
    if (!before.pending && after.pending && after.pending.unitRefs.includes(targetA)) sawDelayedRetest = true
  }
  assert.ok(sawDelayedRetest, 'target A eventually returns as a retest, delayed by intervening activity')
  transcript.push(`RETEST[${targetA}, different formulation]`)
  // Independent evidence distinction: assisted correction is not independent mastery until re-demonstrated unassisted.
  const targetAConcept = (await w.load()).state.concepts[targetA]
  assert.ok(targetAConcept.attempts.some(a => a.verdict !== 'correct'), 'assisted correction after a miss is not independent mastery — the original miss remains on record')

  // Resolve the retest and drive to BLOCK_REVIEW / completion.
  if ((await w.load()).state.pending) await w.say('ANS-OK x = -b/(2a)')
  const reviewTargets = new Set<string>()
  const key = Object.keys((await w.load()).state.progress)[0]
  guard = 0
  while ((await w.load()).state.progress[key]?.status !== 'done' && guard < 20) {
    guard++
    const before = (await w.load()).state
    const beforeEval = before.progress[key]?.evalAsked ?? 0
    await w.say(before.pending ? 'ANS-OK correcto' : 'sigue')
    const after = (await w.load()).state
    if ((after.progress[key]?.evalAsked ?? 0) > beforeEval && after.pending) reviewTargets.add(after.pending.unitRefs[0])
  }
  const finalState = (await w.load()).state
  assert.equal(finalState.progress[key]?.status, 'done', 'the block eventually completes')
  transcript.push(...[...reviewTargets].map(t => `BLOCK_REVIEW[${t}]`), 'WRAP')
  assert.ok(reviewTargets.size >= 2, `cumulative review samples MULTIPLE distinct concepts (saw ${reviewTargets.size}: ${[...reviewTargets].join(', ')})`)

  // Application/calculation/interpretation content — not only "what is X?" — appears in a review prompt.
  const reviewPrompts = w.counters.prompts.filter(p => /SUGGESTED MOVE: BLOCK_REVIEW/.test(p))
  assert.ok(reviewPrompts.some(p => p.includes('calculation/method/interpretation for math')), 'the math-appropriate evaluation-form guidance (calculation/method/interpretation) reaches a review prompt')

  // No future-page leakage, one-call budget already proven generically by page-study-grounding-contracts/tutor-contracts (not re-duplicated here for prose).
  console.log('MATH action transcript:', transcript.join(' → '))
  console.log('PASS page-study-phase5-math-probe: literal quadratic-functions fixture, method-before-practice, worked example, wrong→reasoned correction, delayed retest, multi-target BLOCK_REVIEW, completion')
}

main().catch(error => { console.error(error); process.exit(1) })
