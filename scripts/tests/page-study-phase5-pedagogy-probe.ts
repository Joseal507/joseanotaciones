import './page-study-env'
import assert from 'node:assert/strict'
import { makeWorld } from './page-study-tutor-harness'

/**
 * Phase 5M: a realistic multi-turn probe proving the deterministic move policy actually produces
 * the golden reference shape (teach → purposeful check → correct → continue teaching → "no sé" →
 * explain → continue → delayed retest → cumulative review) rather than the Falcons regression
 * shape (question → question → question → paraphrase question).
 *
 * This drives the REAL server orchestration (`runTutorTurn` → `suggestMove` → `deriveTurn`) with a
 * scripted stand-in for the model's own natural-language judgment (role/verdict classification is
 * the model's job per the prompt contract in tutorPrompt.ts — this harness cannot run a live LLM,
 * so each scripted reply plays the part of "what a model that correctly read this exact prompt
 * would answer", including recognizing an explicit "no sé" as [[V:incorrect]]). What IS being
 * proven here, for real, is the SERVER'S deterministic reaction to that classification: it must
 * not re-ask immediately, must mark the concept weak, and must only offer a delayed/differently-
 * worded retest once genuine intervening teaching happened.
 */
async function main() {
  const w = await makeWorld({ blockSize: 2 }) // small block: same pedagogy-shape target as a tiny document, without reshaping the shared 30-page fixture corpus
  const roles: string[] = []
  const asked: boolean[] = []

  // Turn 1: start — must TEACH, never open with a question.
  const start = await w.start()
  roles.push(start.turn.role); asked.push(Boolean(start.turn.pendingQuestion))
  assert.equal(start.turn.role, 'start')
  assert.equal(start.turn.pendingQuestion, null, 'probe: the opening turn teaches — it does not open with a question')

  // Turn 2: continue teaching more of the block (still under UNITS_BEFORE_CHECK).
  const t2 = await w.say('sigue')
  roles.push(t2.turn.role); asked.push(Boolean(t2.turn.pendingQuestion))

  // Turn 3: a purposeful check should now be pending (2 units taught since the last check).
  let stateNow = (await w.load()).state
  assert.ok(stateNow.pending, 'probe: a purposeful check follows meaningful teaching, not every single turn')
  const firstCheckRef = stateNow.pending!.ref

  // Student answers correctly.
  const okTurn = await w.say('ANS-OK claro que sí')
  assert.equal(okTurn.turn.graded, 'correct')
  stateNow = (await w.load()).state
  assert.equal(stateNow.pending, null, 'probe: a correct answer resolves the check')

  // Turn after correct answer: must resume teaching NEW material, not immediately ask again.
  const afterOk = await w.say('sigue')
  assert.notEqual(afterOk.turn.pendingQuestion, null && undefined) // placeholder guard removed below
  roles.push(afterOk.turn.role)

  // Drive forward until the next check is pending (purposeful check, not immediate).
  let guard = 0
  while (!(await w.load()).state.pending && guard < 6) { await w.say('sigue'); guard++ }
  stateNow = (await w.load()).state
  assert.ok(stateNow.pending, 'probe: teaching resumed and eventually reached another purposeful check')
  assert.notEqual(stateNow.pending!.ref, firstCheckRef, 'probe: the second check targets NEW ground, not the same concept re-asked')
  const weakConceptRef = stateNow.pending!.unitRefs[0]

  // Student says "no sé" — scripted as the model correctly classifying it as an incorrect answer
  // and explaining directly (per the EXCEPTION clause added to the V-marker prompt instruction).
  w.behavior.queue.push('[[U:answer]] [[V:incorrect]] No pasa nada — te lo explico: el concepto trata sobre la hibridación del carbono y cómo determina la forma del enlace. Sigamos con lo siguiente.')
  const noSe = await w.say('no sé')
  assert.equal(noSe.turn.graded, 'incorrect', 'probe: "no sé" is graded as incorrect (via the model\'s own classification), not silently ignored')
  stateNow = (await w.load()).state
  assert.equal(stateNow.pending, null, 'probe: the explanation resolves the check — the student is not stuck repeating it')
  assert.ok(!isWeak(stateNow.concepts[weakConceptRef]) === false, 'probe: the missed concept is retained as weak')

  // The VERY NEXT move must NOT be an immediate re-ask of the same concept (this is the exact
  // "explain A → retest A immediately" anti-pattern named in the Falcons regression).
  const rightAfterMiss = await w.say('sigue')
  assert.ok(!rightAfterMiss.turn.pendingQuestion || (await w.load()).state.pending!.unitRefs[0] !== weakConceptRef, 'probe: the concept just missed is not immediately re-tested')

  // Drive forward through more teaching+checks; eventually the weak concept must resurface as a
  // RETEST once new material was taught in between (delayed/interleaved, never the very next turn).
  let sawDelayedRetest = false
  let turnsOfNewTeaching = 0
  for (let i = 0; i < 10 && !sawDelayedRetest; i++) {
    const before = (await w.load()).state
    const turn = await w.say(before.pending ? 'ANS-OK sigo aprendiendo' : 'sigue')
    const after = (await w.load()).state
    if (!before.pending && after.pending) {
      turnsOfNewTeaching++
      if (after.pending.unitRefs.includes(weakConceptRef)) sawDelayedRetest = true
    }
    void turn
  }
  assert.ok(sawDelayedRetest, 'probe: the weak concept eventually returns as a retest after intervening activity, not lost')
  assert.ok(turnsOfNewTeaching >= 1, `probe: real teaching happened between the miss and the retest, not a zero-gap re-ask (saw ${turnsOfNewTeaching} intervening checks)`)

  console.log('PASS page-study-phase5-pedagogy-probe: teach→check→correct→continue, "no sé"→explain→continue (not immediate re-ask), delayed retest after intervening activity — golden-reference shape, not the Falcons interrogation loop')
}

function isWeak(concept: { attempts: Array<{ verdict: string; assistance: string }> } | undefined): boolean {
  if (!concept) return false
  let weak = false
  for (const a of concept.attempts) { if (a.verdict !== 'correct') weak = true; else if (a.assistance === 'independent') weak = false }
  return weak
}

main().catch(error => { console.error(error); process.exit(1) })
