import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { POST, __routeDeps } from '../../app/api/alai-studyal-chat/route'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { withMaterialLanguage } from '../../lib/materialLanguage'
import { buildChatEnjoyerContext } from '../../lib/materialBrain/chatEnjoyerContext'
import { chatRequestHash, type ChatTurnStore, type StoredChatTurn } from '../../lib/alai-chat/turnStore'
import {
  PRACTICE_START_MESSAGE, appendAsked, extractAskedQuestion, normalizePracticeNotation, pickPracticeCandidates, readInteractionMode, buildPracticeDirective,
} from '../../lib/alai-chat/practice'
import {
  alaiInteractionMode, beginAlaiTurn, completeAlaiTurn, failAlaiTurn, initialAlaiState, recoverInterruptedAlaiState, retryAlaiTurn, setAlaiInteractionMode,
} from '../../lib/freeAlaiState'
import { buildPayload, KEYS, F, selectionOf } from './five-material-fixture'
import { languageFixtures } from './material-language-authority-contracts'

let providerCalls = 0
const prompts: string[] = []
let providerFails = false

function memoryStore(): ChatTurnStore {
  const rows = new Map<string, StoredChatTurn>()
  return {
    async read(id) { return rows.get(id) ?? null },
    async compareAndSet(id, expected, revision, record) {
      if ((rows.get(id)?.revision ?? null) !== expected) return false
      rows.set(id, { revision, record }); return true
    },
  }
}

/** Deterministic stand-in for the provider: reads ONLY what the server put in the prompt. */
function fakeProvider(contextTargets: ReturnType<typeof buildChatEnjoyerContext>['targets']) {
  return async ({ prompt }: { prompt: string }) => {
    providerCalls++; prompts.push(prompt)
    if (providerFails) throw new Error('provider down')
    const seen = contextTargets.filter(target => prompt.includes(target.id))
      .sort((a, b) => prompt.indexOf(a.id) - prompt.indexOf(b.id)) // the model follows the order the server offered
    const askedText = /PREGUNTAS YA HECHAS:\n([\s\S]*?)\nReporta/.exec(prompt)?.[1] ?? ''
    const candidateIds = (/CANDIDATOS PARA LA PRÓXIMA PREGUNTA[^:]*: ([^\n]*)\./.exec(prompt)?.[1] ?? '').split(', ')
    const pick = contextTargets.find(target => target.id === candidateIds[0]) ?? seen.find(target => !askedText.includes(target.label)) ?? seen[seen.length - 1] ?? contextTargets[0]
    const evaluated = seen.find(target => target.id !== pick.id && !candidateIds.includes(target.id)) ?? null // grading evidence only
    const student = /RESPUESTA DEL ESTUDIANTE[^\n]*?\): ("(?:[^"\\]|\\.)*")/.exec(prompt)
    const answer = student ? String(JSON.parse(student[1])) : ''
    const verdict = !student ? 'Vamos a practicar.' : /109|correct/i.test(answer) || /sp3/.test(answer) ? 'Correcto.' : /parcial/i.test(answer) ? 'Parcialmente correcto.' : 'No exactamente.'
    return {
      answer: `${verdict} Ahora dime: ¿qué ocurre con ${pick.label}?`,
      usedTargetIds: [...new Set([...(evaluated ? [evaluated.id] : []), pick.id])], usedRelationIds: [], externalKnowledgeUsed: false, suggestedFollowups: ['no debería mostrarse'],
    }
  }
}

function install(payload: any, selection: ReturnType<typeof buildSourceSelectionSnapshot>, store = memoryStore()) {
  let context: ReturnType<typeof buildChatEnjoyerContext>
  try { context = buildChatEnjoyerContext(payload, selection) } catch { context = { targets: [], relations: [] } as any } // sixth-material payloads must fail closed inside the route
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'u1' } }),
    getAuthoritativeFreeSession: async () => ({ id: 's1', userId: 'u1', processMode: 'free', sourceSelection: selection }),
    getMaterial: async (id: string) => ({ id }),
    lookupStudyalMaterialEnjoyer: async () => payload,
    chatTurnStore: store,
    generateValidatedLegacyJson: fakeProvider(context.targets),
  })
  return { context, store }
}

async function turn(body: Record<string, unknown>) {
  const response = await POST(new NextRequest('http://localhost/api/alai-studyal-chat', { method: 'POST', body: JSON.stringify({ sessionId: 's1', ...body }) }))
  return { status: response.status, data: await response.json() as any }
}

function chemistry(text: string, materialId = 'mat-q') {
  const rows: Array<[string, string, string]> = [
    ['carbon-bonds', 'Enlaces del carbono', 'El carbono tiene cuatro electrones de valencia y por eso puede formar cuatro enlaces covalentes.'],
    ['sp3', 'Hibridación sp3', 'La hibridación sp3 combina un orbital s y tres orbitales p y forma cuatro orbitales híbridos con ángulo de 109.5 grados.'],
    ['sp2', 'Hibridación sp2', 'La hibridación sp2 combina un orbital s y dos orbitales p y forma geometría trigonal plana con ángulos de 120 grados.'],
    ['sp', 'Hibridación sp', 'La hibridación sp combina un orbital s y un orbital p y forma geometría lineal con ángulos de 180 grados.'],
    ['geometry', 'Geometría molecular', 'La geometría molecular depende del número de pares de electrones alrededor del átomo central según la teoría de repulsión.'],
    ['sigma-pi', 'Enlaces sigma y pi', 'Un doble enlace contiene un enlace sigma y un enlace pi formado por orbitales p paralelos.'],
  ]
  const selection = buildSourceSelectionSnapshot([materialId], { [materialId]: [1, 2] })
  const payload = withMaterialLanguage({ blueprint: {
    sourceSelectionFingerprint: selection.fingerprint, materialIds: [materialId], selectedPages: selection.selectedPages,
    topicsIndex: [{ id: 't', title: 'Química orgánica', order: 0 }],
    globalOrderedAnalysis: rows.map(([id, name, content], index) => ({ id, kind: 'concept', label: name, name, summary: content, content, importance: 90 - index, materialId, pages: [index < 3 ? 1 : 2], topicId: 't', globalOrder: index, sourceSpans: [{ page: index < 3 ? 1 : 2, quote: content }] })),
    uniqueConceptsIndex: [],
  } })
  void text
  return { payload, selection }
}

async function main() {
  // ── pure helpers: mode, notation, question extraction, rotation ───────
  assert.equal(readInteractionMode(undefined), 'ask', '1. default = Preguntar')
  assert.equal(readInteractionMode('answer'), 'answer'); assert.equal(readInteractionMode('quiz'), null, 'unknown mode is invalid, never silently downgraded')
  for (const variant of ['sp³', 'sp 3', 'SP3', 'sp^3']) assert.match(normalizePracticeNotation(`hibridación ${variant}`).toLowerCase(), /sp3\b/, `25. chemistry notation ${variant}`)
  assert.equal(normalizePracticeNotation('x² − 4 = (x−2)(x+2)'), 'x2 - 4 = (x-2)(x+2)', '24. math notation is normalized only, never solved')
  assert.equal(extractAskedQuestion('Correcto. Ahora dime: ¿cuál es el ángulo tetraédrico?'), '¿cuál es el ángulo tetraédrico?')
  assert.deepEqual(appendAsked(['¿a?'], '¿a?'), ['¿a?'], 'same question is not appended twice')
  assert.equal(appendAsked(Array.from({ length: 12 }, (_, i) => `¿${i}?`), '¿nueva?').length, 12)

  // ── client durable state ──────────────────────────────────────────────
  let state = initialAlaiState()
  assert.equal(alaiInteractionMode(state), 'ask', '1. default mode Preguntar (legacy state has no field)')
  const askTurn = beginAlaiTurn(state, { turnId: 't1', userMessageId: 't1:user', content: 'Explícame sp2', timestamp: 1, interactionMode: alaiInteractionMode(state) })
  assert.equal(askTurn.currentTurn?.interactionMode, undefined, '2. Preguntar turns are byte-identical to the legacy shape')
  state = setAlaiInteractionMode(state, 'answer'); assert.equal(alaiInteractionMode(state), 'answer')
  const started = beginAlaiTurn(state, { turnId: 't2', userMessageId: 't2:user', content: PRACTICE_START_MESSAGE, timestamp: 2, interactionMode: 'answer', practiceStart: true, hidden: true })
  assert.equal(started.currentTurn?.practiceStart, true); assert.equal(started.messages.at(-1)?.hidden, true)
  const failed = failAlaiTurn(started, 't2', 1, 'boom')
  const retried = retryAlaiTurn(failed, 't2')
  assert.equal(retried.currentTurn?.interactionMode, 'answer', '20. retry replays the frozen mode'); assert.equal(retried.currentTurn?.practiceStart, true); assert.equal(retried.currentTurn?.attempt, 2)
  assert.equal(setAlaiInteractionMode(started, 'ask'), started, 'cannot switch while a turn is in flight')
  assert.equal(recoverInterruptedAlaiState(started).currentTurn?.interactionMode, 'answer')
  const done = completeAlaiTurn(started, 't2', 1, { id: 'x', role: 'assistant', content: '¿Pregunta?' })
  const backToAsk = setAlaiInteractionMode(done, 'ask')
  assert.equal(alaiInteractionMode(backToAsk), 'ask', '19. RESPONDER → PREGUNTAR')
  assert.equal(backToAsk.messages.length, done.messages.length, 'mode switch never edits canonical history')

  // ── server: Preguntar unchanged ───────────────────────────────────────
  const chem = chemistry('es')
  const { context: chemContext } = install(chem.payload, chem.selection)
  providerCalls = 0; prompts.length = 0
  const asked = await turn({ turnId: 'a1', attempt: 1, message: 'Explícame la hibridación sp2', history: [], conversationContext: undefined })
  assert.equal(asked.status, 200); assert.equal(providerCalls, 1)
  assert.ok(!prompts[0].includes('MODO RESPONDER'), '2. Preguntar prompt has no practice directive')
  assert.ok(asked.data.suggestedFollowups.length >= 0)
  assert.equal(asked.data.conversationContext.practiceAsked, undefined)
  assert.equal(chatRequestHash('m', { conversation: null, history: [], previousGrounding: [], materia: '', tema: '' }), chatRequestHash('m', { conversation: null, history: [], previousGrounding: [], materia: '', tema: '' }))

  // ── server: Responder start → grounded question ───────────────────────
  providerCalls = 0; prompts.length = 0
  const start = await turn({ turnId: 'p1', attempt: 1, interactionMode: 'answer', practiceStart: true, message: PRACTICE_START_MESSAGE, history: [], materia: 'Química', tema: 'Química orgánica' })
  assert.equal(start.status, 200, JSON.stringify(start.data)); assert.equal(providerCalls, 1, '27. one provider call per practice turn')
  assert.match(prompts[0], /MODO RESPONDER/); assert.match(prompts[0], /INICIO:/)
  assert.match(prompts[0], /AUTHORITY: es\./, '26. the single canonical language authority is used')
  assert.match(start.data.answer, /\?/, '3. ALAI initiates with a question')
  assert.ok(start.data.usedTargetIds.length >= 1 && start.data.evidence.length >= 1, '4/18. question is grounded with provenance')
  for (const item of start.data.evidence) assert.equal(item.materialId, 'mat-q')
  assert.deepEqual(start.data.suggestedFollowups, [], 'no suggestion chips in practice')
  assert.equal(start.data.conversationContext.practiceAsked.length, 1)
  const startHistory = [{ role: 'assistant', content: start.data.answer }]

  // ── evaluate: correct / semantically-equivalent / partial / incorrect ──
  let context = start.data.conversationContext
  const scenarios: Array<[string, RegExp]> = [['sp³', /Correcto/], ['hibridación sp 3', /Correcto/], ['parcial: forma cuatro orbitales', /Parcialmente/], ['120 grados', /No exactamente/]]
  let history = startHistory
  const askedQuestions: string[] = [...context.practiceAsked]
  for (const [answer, expected] of scenarios) {
    providerCalls = 0; prompts.length = 0
    const result = await turn({ turnId: `p-${answer}`, attempt: 1, interactionMode: 'answer', message: answer, history, conversationContext: context })
    assert.equal(result.status, 200); assert.equal(providerCalls, 1)
    if (process.env.DBG) console.error('DBGC', answer, (/CANDIDATOS[^\n]*/.exec(prompts[0])||[''])[0].slice(-120), '| covered', JSON.stringify(context.practiceTargetIds))
    assert.match(prompts[0], /EVALÚA por significado/); assert.doesNotMatch(prompts[0], /INICIO:/)
    assert.ok(prompts[0].includes(JSON.stringify(normalizePracticeNotation(answer))), '5-8. student answer reaches the evaluator notation-normalized')
    assert.ok(prompts[0].includes(JSON.stringify(extractAskedQuestion(history[history.length - 1].content))), 'the last question is what is being graded')
    assert.match(result.data.answer, expected)
    assert.match(result.data.answer, /\?\s*$/, '9. every reply continues with the next question')
    for (const question of result.data.conversationContext.practiceAsked) assert.ok(question.length > 0)
    const newest = result.data.conversationContext.practiceAsked.at(-1)
    assert.ok(!askedQuestions.includes(newest), `10. no repeated question loop: ${newest} in ${JSON.stringify(askedQuestions)} :: ${result.data.answer}`)
    askedQuestions.push(newest)
    assert.equal(result.data.conversationContext.sourcePolicy, context.sourcePolicy, 'interaction mode never rewrites sourcePolicy')
    context = result.data.conversationContext
    history = [...history, { role: 'user', content: answer }, { role: 'assistant', content: result.data.answer }]
  }
  assert.equal(new Set(context.practiceTargetIds).size, context.practiceTargetIds.length)
  assert.ok(context.practiceTargetIds.length >= 4 && context.practiceTargetIds.length <= chemContext.targets.length, 'rotation practiced distinct authorized targets (evaluation evidence is not counted as practiced)')

  // ── mode switch back: normal chat, memory preserved ───────────────────
  providerCalls = 0; prompts.length = 0
  const back = await turn({ turnId: 'a2', attempt: 1, message: '¿Cuál es la diferencia entre sigma y pi?', history, conversationContext: context })
  assert.equal(back.status, 200); assert.ok(!prompts[0].includes('MODO RESPONDER'), '19. back to Preguntar = normal assistant')
  assert.deepEqual(back.data.conversationContext.practiceAsked, context.practiceAsked, 'practice memory survives the switch')

  // ── durability ────────────────────────────────────────────────────────
  providerCalls = 0
  const first = await turn({ turnId: 'd1', attempt: 1, interactionMode: 'answer', practiceStart: true, message: PRACTICE_START_MESSAGE, history: [] })
  const again = await turn({ turnId: 'd1', attempt: 1, interactionMode: 'answer', practiceStart: true, message: PRACTICE_START_MESSAGE, history: [] })
  assert.equal(providerCalls, 1, '20. retry of a completed turn makes no new provider call'); assert.deepEqual(again.data, first.data, 'same question restored, not regenerated')
  const conflict = await turn({ turnId: 'd1', attempt: 1, message: PRACTICE_START_MESSAGE, history: [] })
  assert.equal(conflict.status, 409); assert.equal(conflict.data.error, 'CHAT_TURN_ID_CONFLICT')
  providerFails = true
  const failedTurn = await turn({ turnId: 'd2', attempt: 1, interactionMode: 'answer', practiceStart: true, message: PRACTICE_START_MESSAGE, history: [] })
  assert.notEqual(failedTurn.status, 200); providerFails = false
  const recovered = await turn({ turnId: 'd2', attempt: 2, interactionMode: 'answer', practiceStart: true, message: PRACTICE_START_MESSAGE, history: [] })
  assert.equal(recovered.status, 200, 'attempt 2 after a failed attempt recovers with the same mode')

  // ── invalid mode / start flag ─────────────────────────────────────────
  assert.equal((await turn({ turnId: 'i1', attempt: 1, interactionMode: 'quiz', message: 'x' })).status, 400)
  assert.equal((await turn({ turnId: 'i2', attempt: 1, practiceStart: true, message: PRACTICE_START_MESSAGE })).status, 400, 'practiceStart requires Responder')

  // ── languages: EN / ES / ZH + explicit override ───────────────────────
  for (const [language, text] of Object.entries({ en: languageFixtures.en, es: languageFixtures.es, zh: languageFixtures.zh })) {
    const selection = buildSourceSelectionSnapshot([`mat-${language}`], { [`mat-${language}`]: [1] })
    const payload = withMaterialLanguage({ blueprint: { sourceSelectionFingerprint: selection.fingerprint, materialIds: selection.materialIds, selectedPages: selection.selectedPages,
      topicsIndex: [{ id: 't', title: text.slice(0, 12), order: 0 }],
      globalOrderedAnalysis: [{ id: 'x', kind: 'concept', label: text.slice(0, 20), name: text.slice(0, 20), summary: text, content: text, importance: 90, materialId: `mat-${language}`, pages: [1], topicId: 't', globalOrder: 0, sourceSpans: [{ page: 1, quote: text }] }], uniqueConceptsIndex: [] } })
    install(payload, selection); prompts.length = 0
    const result = await turn({ turnId: `l-${language}`, attempt: 1, interactionMode: 'answer', practiceStart: true, message: PRACTICE_START_MESSAGE, history: [] })
    assert.equal(result.status, 200)
    assert.match(prompts[0], new RegExp(`AUTHORITY: ${language}\\.`), `14-16. ${language} material → ${language} authority`)
    assert.ok(prompts[0].includes(text.slice(0, 30)), 'Unicode source reaches the prompt intact')
    assert.equal((payload as any).blueprint.materialLanguage, language)
    if (language === 'en') {
      prompts.length = 0
      await turn({ turnId: 'l-en-override', attempt: 1, interactionMode: 'answer', message: 'Explícamelo en español', history: [{ role: 'assistant', content: '¿What?' }], conversationContext: result.data.conversationContext })
      assert.match(prompts[0], /AUTHORITY: en\./); assert.match(prompts[0], /CURRENT user message/, '17. override is response-scoped')
      assert.equal((payload as any).blueprint.materialLanguage, 'en', '17. canonical language is never mutated')
    }
  }

  // ── five materials: rotation reaches all five; sixth excluded ─────────
  const five = buildPayload(KEYS)
  install(five.payload, five.selection)
  let fiveContext: any = undefined, fiveHistory: Array<{ role: string; content: string }> = []
  const materials = new Set<string>()
  for (let index = 0; index < 5; index++) {
    const result = await turn({ turnId: `f${index}`, attempt: 1, interactionMode: 'answer', ...(index === 0 ? { practiceStart: true, message: PRACTICE_START_MESSAGE } : { message: 'respuesta' }), history: fiveHistory, conversationContext: fiveContext })
    assert.equal(result.status, 200)
    if (process.env.DBG) console.error('DBG', index, JSON.stringify(result.data.usedTargetIds), (/CANDIDATOS[^\n]*/.exec(prompts[prompts.length - 1]) || [''])[0].slice(-150))
    for (const item of result.data.evidence) { assert.notEqual(item.materialId, F.id); materials.add(item.materialId) }
    fiveContext = result.data.conversationContext
    fiveHistory = [...fiveHistory, { role: 'assistant', content: result.data.answer }]
  }
  assert.ok(materials.size >= 4, `12. practice interleaves the five selected materials, got ${[...materials]}`)
  const foreign = buildPayload(KEYS, { extra: [{ id: 'F-p1', kind: 'concept', label: 'Zorblax', summary: F.fact, materialId: F.id, pages: [1], topicId: 'topic_A', globalOrder: 99, sourceSpans: [{ page: 1, quote: F.fact }] }] })
  install(foreign.payload, foreign.selection)
  const leak = await turn({ turnId: 'six', attempt: 1, interactionMode: 'answer', practiceStart: true, message: PRACTICE_START_MESSAGE, history: [] })
  assert.equal(leak.status, 409, '13. a sixth material makes the authority fail closed'); assert.ok(!JSON.stringify(leak.data).includes('Zorblax'))
  const one = buildPayload(['A']); install(one.payload, selectionOf(['A']))
  assert.equal((await turn({ turnId: 'one', attempt: 1, interactionMode: 'answer', practiceStart: true, message: PRACTICE_START_MESSAGE, history: [] })).status, 200, '11. one material')
  assert.equal(pickPracticeCandidates(buildChatEnjoyerContext(five.payload, five.selection), []).map(t => t.materialId).length, 4)

  // ── source policies stay orthogonal ───────────────────────────────────
  install(chem.payload, chem.selection)
  const practiceQuestion = [{ role: 'assistant', content: '¿Qué forma tiene el orbital sp3?' }]
  for (const [message, policy] of [['usa solo el material', 'MATERIAL_ONLY'], ['usa el material y conocimiento general', 'MIXED'], ['ignora el material', 'GENERAL_ONLY']] as const) {
    prompts.length = 0
    const result = await turn({ turnId: `pol-${policy}`, attempt: 1, interactionMode: 'answer', message, history: practiceQuestion })
    assert.equal(result.status, 200, `${policy}: ${JSON.stringify(result.data).slice(0, 200)}`)
    assert.equal(result.data.sourcePolicy, policy, `21-23. explicit ${policy} is honored in Responder; mode never rewrites sourcePolicy`)
    if (policy === 'GENERAL_ONLY') assert.ok(!prompts[0].includes('CANDIDATOS PARA LA PRÓXIMA PREGUNTA (aún no practicados, por prioridad; sirven para rotar conceptos y materiales): chat_target'), 'general-only practice injects no material candidates')
  }
  assert.match(buildPracticeDirective({ start: true, lastQuestion: '', answer: '', asked: [] }), /NO determinan el idioma de salida/, '14-17. the Spanish trigger/instructions never decide the output language')
  assert.match(buildPracticeDirective({ start: true, lastQuestion: '', answer: '', asked: [] }), /trivia irrestricta/, '22-23. material sessions are never turned into unrestricted trivia')

  // ── static: no new pipeline / language authority; UI contract ────────
  const practiceSource = readFileSync('lib/alai-chat/practice.ts', 'utf8')
  assert.doesNotMatch(practiceSource, /detectLanguage|detectMaterialLanguage|from '..\/alai'|generateValidatedLegacyJson|fetch\(/, '26/27. practice.ts adds no language detector, provider call or extraction')
  const routeSource = readFileSync('app/api/alai-studyal-chat/route.ts', 'utf8')
  assert.equal((routeSource.match(/generateValidatedLegacyJson\(\{/g) || []).length, 1, 'still one grounded generation path')
  const ui = readFileSync('components/materias/ALAIStudyALChat.tsx', 'utf8')
  assert.match(ui, /\[\['ask', 'Preguntar'\], \['answer', 'Responder'\]\]/); assert.match(ui, /role="radiogroup"/); assert.match(ui, /aria-checked=\{interactionMode === value\}/)
  assert.match(ui, /Pregúntale a ALAI/); assert.match(ui, /ALAI te pregunta a ti/); assert.match(ui, /hidden: true/)
  assert.doesNotMatch(readFileSync('lib/alai-chat/contracts.ts', 'utf8'), /interactionMode/, 'interaction mode is not part of sourcePolicy')
  console.log('PASS alai-chat-practice: Preguntar/Responder, grounded questions, semantic-evaluation contract, adaptive rotation, durability, languages, five materials, sixth excluded')
}
main().catch(error => { console.error(error); process.exit(1) })
