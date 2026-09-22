import './page-study-env'
import assert from 'node:assert/strict'
import { buildFixtureCorpus, makeWorld, type FixtureMaterialSpec } from './page-study-tutor-harness'

/**
 * Phase 5 Blocker 3, Probe A: a LITERAL 2-page fixture with real authored content (not the
 * generic synthetic hybridization corpus), driven through the REAL Page Study orchestration.
 * Facts come only from this fixture — nothing here relies on the model's general knowledge.
 */
const FALCONS: FixtureMaterialSpec = {
  materialId: 'pdf-1', name: 'Atlanta Falcons — historia', lang: 'es', pageCount: 2,
  concepts: [
    { id: 'founded', page: 1, label: 'Fundación de los Falcons', quote: 'Los Atlanta Falcons fueron fundados en 1965 como equipo de expansión de la NFL.', summary: 'Los Falcons se fundaron en 1965.' },
    { id: 'identity', page: 1, label: 'Identidad de franquicia', quote: 'La identidad de la franquicia se construyó con el tiempo, no solo con campeonatos: la grandeza de un equipo no se define únicamente por los trofeos que gana.', summary: 'La grandeza no se define solo por campeonatos.' },
    { id: 'loyalty', page: 2, label: 'Lealtad de la afición', quote: 'La afición se mantuvo leal incluso en temporadas difíciles, mostrando una conexión emocional duradera con el equipo.', summary: 'La afición es leal incluso en temporadas difíciles.' },
    { id: 'resilience', page: 2, label: 'Resiliencia y comunidad', quote: 'Esa resiliencia frente a la adversidad, y el sentido de comunidad que genera, es parte central de lo que hace única a la franquicia.', summary: 'La resiliencia y el sentido de comunidad son centrales para la franquicia.' },
  ],
}

async function main() {
  const corpus = buildFixtureCorpus([FALCONS], 2) // blockSize=2 (pageCount): the whole 2-page material is one block, matching the real tiny-document product behavior
  const w = await makeWorld({ corpus })
  const actionTranscript: Array<{ turn: number; move: string; role: string; graded: string | null; asked: boolean }> = []
  let n = 0
  const record = (role: string, graded: string | null, asked: boolean) => actionTranscript.push({ turn: ++n, move: '', role, graded, asked })

  // Turn 1: start — must TEACH real Falcons content, never open with a question.
  const start = await w.start()
  record(start.turn.role, start.turn.graded, Boolean(start.turn.pendingQuestion))
  assert.equal(start.turn.pendingQuestion, null, 'A. opens by teaching, not by asking')
  const startPrompt = w.counters.prompts[0]
  assert.ok(startPrompt.includes('Fundación de los Falcons') || startPrompt.includes('Identidad de franquicia'), 'A. the teaching prompt is grounded in the LITERAL Falcons fixture text, not generic content')

  // Turn 2: continue — a purposeful check should become due (2 units taught).
  const t2 = await w.say('sigue')
  record(t2.turn.role, t2.turn.graded, Boolean(t2.turn.pendingQuestion))
  let state = (await w.load()).state
  assert.ok(state.pending, 'A. a purposeful check follows teaching, not every turn')
  const checkA = state.pending!.unitRefs[0]

  // Student answers correctly (target A) → feedback → continue teaching NEW material (page 2).
  const okA = await w.say('ANS-OK sí, se fundó en 1965')
  record(okA.turn.role, okA.turn.graded, Boolean(okA.turn.pendingQuestion))
  assert.equal(okA.turn.graded, 'correct')
  state = (await w.load()).state
  assert.equal(state.pending, null, 'A. correct answer resolves the check')

  const t4 = await w.say('sigue') // teaches page-2 concepts (loyalty, resilience)
  record(t4.turn.role, t4.turn.graded, Boolean(t4.turn.pendingQuestion))
  const t4Prompt = w.counters.prompts.at(-1)!
  assert.ok(t4Prompt.includes('Lealtad de la afición') || t4Prompt.includes('Resiliencia y comunidad'), 'A. teaching moved to NEW page-2 content, not repeating page 1')

  // A check on the new page-2 material becomes due — target B.
  state = (await w.load()).state
  let guard = 0
  while (!state.pending && guard < 4) { const t = await w.say('sigue'); record(t.turn.role, t.turn.graded, Boolean(t.turn.pendingQuestion)); state = (await w.load()).state; guard++ }
  assert.ok(state.pending, 'A. a second purposeful check is reached on the new material')
  const checkB = state.pending!.unitRefs[0]
  assert.notEqual(checkB, checkA, 'A. the second check targets a DIFFERENT concept than the first — no re-ask')

  // Student says "no sé" on target B → explained, weak-retained, NOT immediately re-asked.
  w.behavior.queue.push('[[U:answer]] [[V:incorrect]] No pasa nada, te lo explico: la afición se mantuvo leal incluso en temporadas difíciles. Sigamos.')
  const noSe = await w.say('no sé')
  record(noSe.turn.role, noSe.turn.graded, Boolean(noSe.turn.pendingQuestion))
  assert.equal(noSe.turn.graded, 'incorrect', 'A. "no sé" is classified as incorrect, not silently ignored')
  state = (await w.load()).state
  assert.equal(state.pending, null, 'A. the explanation resolves the check')

  const rightAfter = await w.say('sigue')
  record(rightAfter.turn.role, rightAfter.turn.graded, Boolean(rightAfter.turn.pendingQuestion))
  state = (await w.load()).state
  assert.ok(!state.pending || state.pending.unitRefs[0] !== checkB, 'A. target B is NOT immediately re-asked right after the miss')

  // Reject transcript shape: no 3 consecutive turns that are all a pending-question-producing action.
  let consecutiveAsks = 0; let maxConsecutiveAsks = 0
  for (const t of actionTranscript) { consecutiveAsks = t.asked ? consecutiveAsks + 1 : 0; maxConsecutiveAsks = Math.max(maxConsecutiveAsks, consecutiveAsks) }
  assert.ok(maxConsecutiveAsks < 3, `A. reject: 3+ consecutive question-producing turns would be the interrogation-loop shape (max seen: ${maxConsecutiveAsks})`)

  // Drive to block completion; expect BLOCK_REVIEW and eventual delayed retest of target B.
  let sawDelayedRetestOfB = false
  guard = 0
  while ((await w.load()).state.progress[Object.keys((await w.load()).state.progress)[0]]?.status !== 'done' && guard < 20) {
    guard++
    const before = (await w.load()).state
    const t = await w.say(before.pending ? 'ANS-OK entendido' : 'sigue')
    record(t.turn.role, t.turn.graded, Boolean(t.turn.pendingQuestion))
    const after = (await w.load()).state
    if (!before.pending && after.pending && after.pending.unitRefs.includes(checkB)) sawDelayedRetestOfB = true
  }
  assert.ok(sawDelayedRetestOfB, 'A. target B eventually returns as a retest (delayed), not lost')
  const finalState = (await w.load()).state
  assert.equal(Object.values(finalState.progress)[0]?.status, 'done', 'A. the block completes')

  console.log('Falcons action transcript (role/graded/asked):', actionTranscript.map(t => `${t.turn}:${t.role}${t.graded ? `(${t.graded})` : ''}${t.asked ? '?' : ''}`).join(' → '))
  console.log('PASS page-study-phase5-falcons-probe: literal 2-page fixture, teach→check→correct→continue, "no sé"→explain→continue, no 3-consecutive-question chain, delayed retest, block completion')
}

main().catch(error => { console.error(error); process.exit(1) })
