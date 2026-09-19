import assert from 'node:assert/strict'
import { ALAI_WELCOME_MESSAGE, alaiPracticePhase, alaiPendingQuestionRef } from '../../lib/freeAlaiState'
import { buildPayload, KEYS, F } from './five-material-fixture'
import { languageFixtures } from './material-language-authority-contracts'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { withMaterialLanguage } from '../../lib/materialLanguage'
import { Client, chemistry, install, rawTurn, state } from './alai-practice-harness'

const calls = () => state.providerCalls
async function main() {
  const chem = chemistry(); install(chem.payload, chem.selection)

  // ── Acceptance scenario, end to end through the real route + real reducers ──
  const c = new Client()
  assert.equal(c.thread, 'ask'); assert.equal(c.visible()[0].id, ALAI_WELCOME_MESSAGE.id)
  await c.send('¿Qué es la hibridación?'); const askBefore = c.visible('ask').map(m => m.content)
  assert.equal(askBefore.length, 3, 'welcome + question + answer')
  const beforeStart = calls()
  await c.switchTo('answer')
  assert.equal(calls(), beforeStart + 1, '3. first Responder question is generated once')
  const q1 = c.visible('answer'); assert.equal(q1.length, 1, 'Responder shows only the first practice question')
  assert.ok(q1[0].role === 'assistant' && /\?/.test(q1[0].content))
  assert.ok(!c.visible('answer').some(m => m.id === ALAI_WELCOME_MESSAGE.id || /Ya analicé tu material/.test(m.content)), '2. Preguntar welcome never appears in Responder')
  assert.equal(alaiPracticePhase(c.view('answer')), 'QUESTION_PENDING')
  const q1Ref = alaiPendingQuestionRef(c.view('answer')), q1Text = q1[0].content

  // switch away, chat normally, come back — repeatedly
  for (let round = 0; round < 3; round++) {
    const before = calls()
    await c.switchTo('ask')
    assert.equal(calls(), before, '4. leaving Responder generates nothing')
    if (round === 0) { await c.send('¿Cuál es la diferencia entre sigma y pi?'); assert.ok(calls() === before + 1, 'a normal Preguntar turn is one provider call') }
    const mid = calls()
    await c.switchTo('answer')
    assert.equal(calls(), mid, '6. returning to Responder causes ZERO provider calls')
    assert.deepEqual(c.visible('answer').map(m => m.content), [q1Text], '5/15. the exact same Q1 is shown, no duplicate greeting/question')
    assert.equal(alaiPendingQuestionRef(c.view('answer')), q1Ref)
  }
  assert.equal(c.visible('ask').filter(m => m.id === ALAI_WELCOME_MESSAGE.id).length, 1, '15. exactly one welcome, in Preguntar only')
  assert.equal(c.visible('ask').length, askBefore.length + 2, '13. Preguntar history only gained its own turn')

  // ── incorrect → remediate the SAME concept; still pending ─────────────
  const conceptOf = (client: Client) => client.lastAssistant('answer')!.conversationContext!.practiceCurrentTargetIds
  const concept1 = conceptOf(c)
  const wrong = await c.send('120 grados')
  assert.equal(wrong!.status, 200)
  const afterWrong = c.lastAssistant('answer')!.conversationContext!
  assert.deepEqual(afterWrong.practiceCurrentTargetIds, concept1, '10/11. incorrect answer stays on the SAME concept')
  assert.equal(afterWrong.practiceLastVerdict, 'incorrect'); assert.equal(afterWrong.practiceAttempts, 1)
  assert.deepEqual(afterWrong.practiceTargetIds, [], 'nothing is mastered by submitting something')
  assert.notEqual(afterWrong.practiceQuestionRef, q1Ref, 'a remediation question is a new pending question')
  // partial → same concept, attempts grows
  await c.send('parcial: forma orbitales')
  const afterPartial = c.lastAssistant('answer')!.conversationContext!
  assert.deepEqual(afterPartial.practiceCurrentTargetIds, concept1, '9. partial answer does NOT advance'); assert.equal(afterPartial.practiceAttempts, 2)
  assert.deepEqual(afterPartial.practiceTargetIds, [])
  // a question is not an answer
  await c.send('¿me ayudas?'); assert.deepEqual(c.lastAssistant('answer')!.conversationContext!.practiceCurrentTargetIds, concept1); assert.equal(c.lastAssistant('answer')!.conversationContext!.practiceAttempts, 2)
  // Preguntar untouched while practicing
  const askNow = c.visible('ask').map(m => m.content)
  // switching mid-remediation keeps the pending remediation question
  const pendingBeforeSwitch = c.visible('answer').at(-1)!.content
  await c.switchTo('ask'); await c.switchTo('answer')
  assert.equal(c.visible('answer').at(-1)!.content, pendingBeforeSwitch)

  // ── correct → advance to a NEW concept ───────────────────────────────
  const correct = await c.send('sp³')
  assert.equal(correct!.status, 200)
  const afterCorrect = c.lastAssistant('answer')!.conversationContext!
  assert.equal(afterCorrect.practiceLastVerdict, 'correct')
  assert.notDeepEqual(afterCorrect.practiceCurrentTargetIds, concept1, '8. only a correct answer advances to the next concept')
  assert.deepEqual(afterCorrect.practiceTargetIds, concept1, 'the mastered concept is recorded only now')
  assert.equal(afterCorrect.practiceAttempts, 0)
  const q2 = c.visible('answer').at(-1)!.content, q2Ref = alaiPendingQuestionRef(c.view('answer'))
  const beforeQ2Switch = calls()
  await c.switchTo('ask'); await c.switchTo('answer')
  assert.equal(calls(), beforeQ2Switch); assert.equal(c.visible('answer').at(-1)!.content, q2, 'Q2 stays pending exactly where the student left it')
  assert.deepEqual(c.visible('ask').map(m => m.content), askNow, '13. Preguntar history untouched by practice')

  // ── Preguntar turns never touch the Responder thread ─────────────────
  const answerSnapshot = JSON.stringify(c.view('answer'))
  await c.switchTo('ask'); await c.send('Explícame sp2')
  assert.equal(JSON.stringify(c.view('answer')), answerSnapshot, '14. Responder history untouched while asking normal questions')

  // ── remount / restore ────────────────────────────────────────────────
  await c.switchTo('answer')
  const remounted = Client.remount(c); const beforeRemount = calls()
  assert.equal(remounted.thread, 'answer'); await remounted.mount()
  assert.equal(calls(), beforeRemount, '7. restoring a session with a pending question causes no provider call')
  assert.equal(remounted.visible('answer').at(-1)!.content, q2); assert.equal(alaiPendingQuestionRef(remounted.view('answer')), q2Ref)
  await remounted.switchTo('ask'); await remounted.switchTo('answer'); assert.equal(calls(), beforeRemount)

  // ── duplicate / stale submissions ────────────────────────────────────
  install(chem.payload, chem.selection) // fresh durable store: an unrelated session
  const dupClient = new Client(); await dupClient.switchTo('answer')
  const slot = alaiPendingQuestionRef(dupClient.view('answer'))!, ctx = dupClient.lastAssistant('answer')!.conversationContext
  const body = { interactionMode: 'answer', practiceSlot: slot, message: 'sp3', history: [{ role: 'assistant', content: dupClient.visible('answer')[0].content }], conversationContext: ctx }
  const beforeDup = calls()
  const first = await rawTurn({ ...body, turnId: 'dup-a', attempt: 1 })
  const second = await rawTurn({ ...body, turnId: 'dup-b', attempt: 1 }) // double submit, different client turn id
  assert.equal(calls(), beforeDup + 1, '12. duplicate answer submission cannot generate a duplicate Q2')
  assert.deepEqual(second.data, first.data, 'the second submit restores the same Q2')
  const conflict = await rawTurn({ ...body, message: 'otra respuesta distinta sp3', turnId: 'dup-c', attempt: 1 })
  assert.equal(conflict.status, 409); assert.equal(conflict.data.error, 'CHAT_TURN_ID_CONFLICT', 'same question slot + different payload stays protected')
  const stale = await rawTurn({ ...body, practiceSlot: 'some-old-question', turnId: 'dup-d', attempt: 1 })
  assert.equal(stale.status, 409); assert.equal(stale.data.error, 'CHAT_PRACTICE_STALE_QUESTION'); assert.equal(calls(), beforeDup + 1)
  const startAgain = await rawTurn({ interactionMode: 'answer', practiceStart: true, practiceSlot: 'start', message: 'Iniciar práctica', history: [], conversationContext: ctx, turnId: 'dup-e', attempt: 1 })
  assert.equal(startAgain.status, 409, 'a non-empty Responder thread can never generate a second "first question"')

  // ── durable start: a lost client still gets the SAME Q1 back ─────────
  install(chem.payload, chem.selection)
  const lost = new Client(); await lost.switchTo('answer'); const firstQ = lost.visible('answer')[0].content
  const beforeLost = calls(); const reborn = new Client(); await reborn.switchTo('answer')
  assert.equal(calls(), beforeLost, '16. a brand-new client restores the durable first question with no provider call')
  assert.equal(reborn.visible('answer')[0].content, firstQ)
  // failed start → recoverable → retry replays the same request
  state.fail = true; const failing = chemistry(); install(failing.payload, failing.selection)
  const broken = new Client(); await broken.switchTo('answer')
  assert.equal(alaiPracticePhase(broken.view('answer')), 'RECOVERABLE'); assert.equal(await broken.send('hola'), null, 'no answers without a pending question')
  state.fail = false; const failedCalls = calls(); await broken.retry()
  assert.equal(alaiPracticePhase(broken.view('answer')), 'QUESTION_PENDING'); assert.equal(calls(), failedCalls + 1)
  await broken.switchTo('ask'); await broken.switchTo('answer'); assert.equal(calls(), failedCalls + 1)

  // ── the model cannot drift: a non-correct verdict must stay on the current concept (validated, then repaired) ──
  install(chem.payload, chem.selection)
  const driftClient = new Client(); await driftClient.switchTo('answer')
  const { __routeDeps: deps } = await import('../../app/api/alai-studyal-chat/route')
  const realFake = (deps as any).generateValidatedLegacyJson
  const verdicts: boolean[] = []
  ;(deps as any).generateValidatedLegacyJson = async (params: any) => {
    const good = await realFake(params)                       // what a compliant model returns
    const other = params.prompt.match(/CANDIDATOS[^:]*: (chat_target:[^,\n.]+)/)?.[1]
    const drifted = { ...good, usedTargetIds: [other] }       // a model that jumps to a new concept while grading "incorrect"
    verdicts.push(params.validate(drifted).valid, params.validate(good).valid)
    return good
  }
  await driftClient.send('120 grados')
  assert.deepEqual(verdicts, [false, true], 'concept drift on a non-correct verdict is rejected; the compliant answer is accepted')
  ;(deps as any).generateValidatedLegacyJson = realFake

  // ── the verdict marker is never shown; the JSON-field form is accepted as well ──
  assert.ok(![...c.visible('answer'), ...c.visible('ask')].some(m => /\[\[V:/.test(m.content)), 'the inline verdict marker never reaches the student: ' + JSON.stringify([...c.visible('answer'), ...c.visible('ask')].filter(m => /\[\[V:/.test(m.content)).map(m => [m.role, m.content.slice(0, 80)])))
  state.tagForm = false
  install(chem.payload, chem.selection); const fieldClient = new Client(); await fieldClient.switchTo('answer'); await fieldClient.send('120 grados')
  assert.equal(fieldClient.lastAssistant('answer')!.conversationContext!.practiceLastVerdict, 'incorrect'); state.tagForm = true

  // ── independent drafts ───────────────────────────────────────────────
  const drafts = new Client(); await drafts.switchTo('answer')
  drafts.root = { ...drafts.root, draft: 'borrador ask', practiceThread: { ...drafts.root.practiceThread!, draft: 'borrador answer' } }
  assert.equal(drafts.view('ask').draft, 'borrador ask'); assert.equal(drafts.view('answer').draft, 'borrador answer')

  // ── shared authority: languages, five materials, sixth excluded ──────
  for (const [language, text] of Object.entries({ en: languageFixtures.en, es: languageFixtures.es, zh: languageFixtures.zh })) {
    const selection = buildSourceSelectionSnapshot([`mat-${language}`], { [`mat-${language}`]: [1] })
    const payload = withMaterialLanguage({ blueprint: { sourceSelectionFingerprint: selection.fingerprint, materialIds: selection.materialIds, selectedPages: selection.selectedPages, topicsIndex: [{ id: 't', title: text.slice(0, 10), order: 0 }],
      globalOrderedAnalysis: [{ id: 'x', kind: 'concept', label: text.slice(0, 20), name: text.slice(0, 20), summary: text, content: text, importance: 90, materialId: `mat-${language}`, pages: [1], topicId: 't', globalOrder: 0, sourceSpans: [{ page: 1, quote: text }] }], uniqueConceptsIndex: [] } })
    install(payload, selection); state.prompts.length = 0
    const client = new Client(); await client.switchTo('answer')
    assert.match(state.prompts[0], new RegExp(`AUTHORITY: ${language}\\.`), `17. ${language} authority reaches the Responder thread`)
    assert.ok(state.prompts[0].includes(text.slice(0, 30)))
    await client.switchTo('ask'); await client.send('pregunta normal'); assert.match(state.prompts.at(-1)!, new RegExp(`AUTHORITY: ${language}\\.`), 'same authority in the Preguntar thread')
  }
  const five = buildPayload(KEYS); install(five.payload, five.selection)
  const fiveClient = new Client(); await fiveClient.switchTo('answer')
  const seen = new Set<string>()
  for (let i = 0; i < 5; i++) { for (const e of fiveClient.lastAssistant('answer')!.evidence ?? []) { assert.notEqual(e.materialId, F.id); seen.add(e.materialId) } await fiveClient.send('sp3') }
  assert.ok(seen.size >= 4, `18/19. correct answers advance across the five selected materials, saw ${[...seen]}`)
  for (const item of fiveClient.lastAssistant('answer')!.evidence ?? []) assert.ok(item.pages.length >= 1 && item.materialId, '19. provenance (materialId + pages) preserved')
  const foreign = buildPayload(KEYS, { extra: [{ id: 'F-p1', kind: 'concept', label: 'Zorblax', summary: F.fact, materialId: F.id, pages: [1], topicId: 'topic_A', globalOrder: 99, sourceSpans: [{ page: 1, quote: F.fact }] }] })
  install(foreign.payload, foreign.selection)
  const sixth = await rawTurn({ interactionMode: 'answer', practiceStart: true, practiceSlot: 'start', message: 'Iniciar práctica', turnId: 'six', attempt: 1, history: [] })
  assert.equal(sixth.status, 409, '20. a sixth material fails closed in the Responder thread'); assert.ok(!JSON.stringify(sixth.data).includes('Zorblax'))
  console.log('PASS alai-chat-two-thread: independent Preguntar/Responder threads, pending question survives switching/remount, verdict-driven progression, duplicate/stale protection, shared authorities')
}
main().catch(error => { console.error(error); process.exit(1) })
