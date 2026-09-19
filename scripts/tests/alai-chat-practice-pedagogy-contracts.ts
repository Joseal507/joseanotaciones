import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildChatEnjoyerContext } from '../../lib/materialBrain/chatEnjoyerContext'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { withMaterialLanguage } from '../../lib/materialLanguage'
import { hasSubstantialExplanation, questionLeaksAnswer, buildPracticeDirective, findPracticeStyleIssues, isEchoQuestion, nextPracticeState, pickPracticeCandidates, suggestPracticeOperation } from '../../lib/alai-chat/practice'
import { Client, chemistry, install, state } from './alai-practice-harness'
import { __routeDeps } from '../../app/api/alai-studyal-chat/route'
import { buildPayload, KEYS } from './five-material-fixture'

const directive = (attempts: number, extra: Record<string, unknown> = {}) => buildPracticeDirective({ start: false, lastQuestion: '¿q?', answer: 'x', asked: ['¿q?'], candidateIds: ['chat_target:n'], currentIds: ['chat_target:c'], attempts, ...extra })
const start = buildPracticeDirective({ start: true, lastQuestion: '', answer: '', asked: [] })

async function main() {
  // ── A/B/C/D/E: attempt-aware scaffolding, hint budget ──────────────────────
  const t1 = directive(0), t2 = directive(1), t3 = directive(2)
  assert.match(t1, /INTENTO 1 FALLIDO/); assert.match(t1, /UNA pista pequeña/); assert.match(t1, /SIN revelar la respuesta esperada/, 'A/B. first miss: small hint, expected answer not exposed')
  assert.match(t2, /INTENTO 2 FALLIDO/); assert.match(t2, /pista más fuerte/); assert.doesNotMatch(t2, /SÍ enseña: escribe la explicación clara/, 'C. second miss scaffolds harder but still does not lecture')
  assert.match(t3, /INTENTO 3\+ FALLIDO/); assert.match(t3, /SÍ enseña: escribe la explicación clara/); assert.match(t3, /NO pidas repetir ni enumerar/); assert.match(t3, /TRANSFERENCIA/, 'D/E. third miss teaches, then checks transfer')
  const revealed = directive(3, { revealed: true })
  assert.match(revealed, /YA EXPLICASTE/); assert.match(revealed, /PROHIBIDO pedir repetirla, enumerarla/); assert.doesNotMatch(directive(0), /YA EXPLICASTE/)

  // ── E: deterministic echo detector (hint-budget invariant) ────────────────
  const echo = 'Los factores son el legado, la influencia de los jugadores y la conexión con la afición. ¿Podrías mencionar los factores que definen la grandeza de un equipo: legado, influencia y afición?'
  const transfer = 'Los factores son el legado, la influencia de los jugadores y la conexión con la afición. Si un equipo casi no ganó títulos pero cambió a una ciudad entera, ¿podría considerarse grande? ¿Por qué?'
  assert.equal(isEchoQuestion(echo), true, 'asking the student to list what was just disclosed is an echo')
  assert.equal(isEchoQuestion(transfer), false, 'a transfer/application question is not an echo')
  assert.equal(isEchoQuestion('Casi. Piensa en lo que deja un equipo aunque no gane. ¿Qué otro aspecto influye?'), false)

  // ── J/K: no boilerplate, no over-praise, concise start ────────────────────
  for (const bad of ['Según el material que hemos revisado, ¿qué factores?', 'Basándote en el material, ¿qué es X?', '¡Hola! Es un placer comenzar esta práctica contigo.', '¡Excelente! Has captado perfectamente la idea.', '¡Exacto! Has captado la idea central.', 'According to the material, what is X?', '¡Fantástico! ¿Y ahora?', 'El material nos menciona que la grandeza no depende solo de títulos. ¿Qué crees?', 'Ahora, ¿podrías explicar por qué es importante conocer el ángulo?'])
    assert.ok(findPracticeStyleIssues(bad).length > 0, `flagged: ${bad}`)
  for (const good of ['Correcto. ¿Qué pasa si cambia la temperatura?', 'Casi. Falta una parte: ¿qué otro factor influye?', 'Empecemos con una sencilla: ¿qué son los Atlanta Falcons y cuándo se fundaron?', 'Exacto. Ahora, ¿cómo se relaciona con el ángulo?'])
    assert.deepEqual(findPracticeStyleIssues(good), [], `natural: ${good}`)
  assert.match(start, /como máximo una frase corta de arranque/); assert.match(start, /Sin saludo largo, sin "hola, es un placer"/, 'K. the first question is direct')
  assert.ok(start.length < 6500)
  assert.match(start, /jamás le recuerdes al estudiante que existe un material/); assert.match(start, /Prohibido usar fórmulas como "según el material"/, 'J.')
  assert.match(start, /La pregunta NO debe contener ni insinuar la respuesta/, 'questions do not hand over the key idea')
  assert.match(start, /No abras con elogios exagerados/); assert.doesNotMatch(start, /Vamos a practicar|Hola, /, 'no hard-coded Spanish greeting for the model to copy')

  // ── question leak + real explanation backstops ─────────────────────────────
  assert.equal(questionLeaksAnswer('Correcto. Ahora, ¿qué otros aspectos, además de los campeonatos, definen la grandeza?'), true, 'the reported Q2 leaked the key twist')
  assert.equal(questionLeaksAnswer('Correcto. Ahora, ¿qué hace grande a un equipo?'), false); assert.equal(questionLeaksAnswer('What besides trophies makes a team great?'), true)
  assert.equal(hasSubstantialExplanation('Sí, la grandeza suele medirse por más que los títulos. Por ejemplo, ¿crees que inspirar a los seguidores podría ser parte?'), false, 'a leading question is not an explanation')
  assert.equal(hasSubstantialExplanation('La grandeza de un equipo no depende solo de los campeonatos: también cuenta el legado que deja en su ciudad, la influencia de sus jugadores, la conexión con la afición y su capacidad de inspirar a otros. Por eso un equipo con pocos títulos puede ser grande. Entonces, si un equipo casi no ganó pero cambió a una ciudad, ¿podría considerarse grande? ¿Por qué?'), true)
  assert.match(t3, /una pista o una pregunta guiada NO cuenta como explicación/); assert.match(t3, /PROHIBIDO preguntar por la importancia o utilidad de saberlo/, 'transfer questions test the concept, not its importance')
  assert.ok(findPracticeStyleIssues('¡Exacto! Has descrito muy bien a los Atlanta Falcons.').length > 0)

  // ── F/G: semantic acceptance and natural handling of nonsense ─────────────
  assert.match(t1, /Si la respuesta demuestra la idea central con sus propias palabras, es correcta aunque no repita la redacción/, 'F. semantic understanding counts')
  assert.match(t1, /aunque no .*enumere cada frase canónica/)
  assert.match(t1, /no moralices ni regañes/); assert.match(t1, /Si la respuesta es un disparate, una broma/); assert.match(t1, /devuélvelo al concepto/, 'G. nonsense is redirected without moralizing')
  assert.doesNotMatch(t1, /sé más acad[eé]mico|debes responder con seriedad/i)
  // ── N: no external facts ──────────────────────────────────────────────────
  assert.match(t1, /No agregues hechos externos ni contenido fuera del temario/)

  // ── L: sequencing follows the material's own teaching order ───────────────
  const rows: Array<[string, number, number, string]> = [['carbon', 0, 90, 'concept'], ['hybrid', 1, 88, 'concept'], ['sp3', 2, 87, 'concept'], ['sp2', 3, 86, 'concept'], ['sp', 4, 85, 'concept'], ['geometry', 5, 84, 'concept'], ['sigma', 6, 83, 'concept'], ['trivia', 7, 10, 'concept']]
  const sel = buildSourceSelectionSnapshot(['m'], { m: [1] })
  const shuffled = [...rows].reverse() // storage order must not matter
  const ctx = buildChatEnjoyerContext(withMaterialLanguage({ blueprint: { sourceSelectionFingerprint: sel.fingerprint, materialIds: ['m'], selectedPages: sel.selectedPages, topicsIndex: [{ id: 't', title: 'Química', order: 0 }],
    globalOrderedAnalysis: shuffled.map(([id, order, importance, kind]) => ({ id, kind, label: id, name: id, summary: `contenido de ${id} suficientemente largo`, content: `contenido de ${id} suficientemente largo`, importance, materialId: 'm', pages: [1], topicId: 't', globalOrder: order, sourceSpans: [{ page: 1, quote: `contenido de ${id} suficientemente largo` }] })), uniqueConceptsIndex: [] } }), sel)
  const order: string[] = []; const covered: string[] = []
  for (let i = 0; i < 5; i++) { const next = pickPracticeCandidates(ctx, covered, 4, 0)[0]; order.push(next.sourceItemId); covered.push(next.id) }
  assert.deepEqual(order, ['carbon', 'hybrid', 'sp3', 'sp2', 'sp'], 'L. foundations first, then dependent ideas, in the material\'s order (not by raw importance)')
  assert.ok(!pickPracticeCandidates(ctx, [], 4).some(t => t.sourceItemId === 'trivia'), 'trivial items are skipped while important ones remain')
  const five = buildChatEnjoyerContext(buildPayload(KEYS).payload, buildPayload(KEYS).selection)
  assert.equal(new Set([0, 1, 2, 3, 4].map(r => pickPracticeCandidates(five, [], 4, r)[0].materialId)).size, 5, 'the lead material still rotates across five materials')

  // ── M: question variety follows the target kind, then a ladder ────────────
  const t = (kind: string, content = 'x', difficulty = 'basic') => ({ kind, content, difficulty })
  assert.equal(suggestPracticeOperation(t('formula', 'F = m a 2'), 0), 'calculate'); assert.equal(suggestPracticeOperation(t('process'), 0), 'order'); assert.equal(suggestPracticeOperation(t('cause'), 0), 'reason')
  const ladder = [0, 1, 2, 3, 4].map(n => suggestPracticeOperation(t('concept'), n)); assert.equal(new Set(ladder).size, 5, 'M. a plain concept run does not stay "what is X?"'); assert.equal(ladder[0], 'recall')
  assert.notEqual(suggestPracticeOperation(t('concept', 'x', 'advanced'), 0), 'recall')
  assert.match(directive(0, { operation: 'apply' }), /OPERACIÓN SUGERIDA PARA LA PRÓXIMA PREGUNTA: apply/); assert.match(start, /Alterna la demanda cognitiva/)

  // ── H/I + revealed flag: the state machine end to end through the real route ─
  const chem = chemistry(); install(chem.payload, chem.selection); state.prompts.length = 0
  const c = new Client(); await c.switchTo('answer')
  const ctxOf = () => c.lastAssistant('answer')!.conversationContext!
  assert.equal(ctxOf().practiceRevealed, undefined)
  await c.send('120 grados'); assert.match(state.prompts.at(-1)!, /Intentos no correctos en este concepto: 0/); assert.match(state.prompts.at(-1)!, /INTENTO 1 FALLIDO/); assert.equal(ctxOf().practiceRevealed, undefined, 'A/B. no reveal after the first miss')
  await c.send('parcial: forma orbitales'); assert.match(state.prompts.at(-1)!, /Intentos no correctos en este concepto: 1/); assert.match(state.prompts.at(-1)!, /INTENTO 2 FALLIDO/); assert.equal(ctxOf().practiceRevealed, undefined, 'I. partial stays on the concept, still nothing revealed')
  await c.send('otra respuesta mala'); assert.match(state.prompts.at(-1)!, /INTENTO 3\+ FALLIDO/); assert.equal(ctxOf().practiceRevealed, true, 'D. the third miss explains and marks the concept as revealed')
  await c.send('otra vez mal'); assert.match(state.prompts.at(-1)!, /YA EXPLICASTE/, 'E. once revealed, the next prompt forbids repetition checks'); assert.equal(ctxOf().practiceRevealed, true)
  const before = ctxOf().practiceCurrentTargetIds
  await c.send('sp3'); assert.equal(ctxOf().practiceLastVerdict, 'correct'); assert.equal(ctxOf().practiceRevealed, undefined, 'H. understanding clears the flag and advances')
  assert.notDeepEqual(ctxOf().practiceCurrentTargetIds, before); assert.deepEqual(ctxOf().practiceTargetIds, before)
  assert.equal(nextPracticeState({ previous: null, start: false, verdict: 'incorrect', answer: '¿q?', usedTargetIds: [], candidateIds: [], questionRef: 'r' }).practiceRevealed, undefined)

  // ── J/E in the real pipeline: one repair, never a hard failure ─────────────
  const { store } = install(chem.payload, chem.selection); void store
  const deps = __routeDeps as any; const realFake = deps.generateValidatedLegacyJson
  const seen: Array<{ style: boolean; echo: boolean }> = []
  deps.generateValidatedLegacyJson = async (params: any) => {
    const good = await realFake(params)
    const preachy = { ...good, answer: good.answer.replace(/^(\[\[V:\w+\]\]) /, '$1 ¡Excelente! Según el material que hemos revisado, ') }
    const first = params.validate(preachy), second = params.validate(preachy) // a stubborn model: same text again after the repair round
    seen.push({ style: first.errors.some((e: string) => e.startsWith('practice_boilerplate') || e.startsWith('practice_over_praise')), echo: false })
    assert.equal(second.valid, true, 'a stubborn style miss is accepted after one repair round: never a hard failure')
    return preachy
  }
  const stubborn = new Client(); await stubborn.switchTo('answer')
  assert.equal(seen[0]?.style, true, 'J. boilerplate/over-praise is flagged once to trigger the repair'); assert.equal(stubborn.view('answer').currentTurn?.status, 'completed')
  install(chem.payload, chem.selection)
  const echoClient = new Client(); await echoClient.switchTo('answer'); await echoClient.send('x1'); await echoClient.send('x2'); state.prompts.length = 0
  const orig = (__routeDeps as any).generateValidatedLegacyJson; let flagged = false
  ;(__routeDeps as any).generateValidatedLegacyJson = async (params: any) => {
    const good = await orig(params)
    const echoed = { ...good, answer: good.answer.replace(/Ahora dime:.*$/s, 'Los factores son el legado, la influencia y la afición. ¿Podrías mencionar los factores: legado, influencia y afición?') }
    flagged = params.validate(echoed).errors.some((e: string) => e.startsWith('practice_echo_question'))
    return good
  }
  await echoClient.send('x3'); assert.equal(flagged, true, 'E. an echo question right after the explanation is rejected once and repaired')
  ;(__routeDeps as any).generateValidatedLegacyJson = orig

  // ── P/O: the two-thread + provenance contracts are untouched ──────────────
  const source = readFileSync('scripts/tests/alai-chat-two-thread-contracts.ts', 'utf8')
  assert.match(source, /Acceptance scenario/); assert.match(readFileSync('lib/freeAlaiState.ts', 'utf8'), /alaiPendingQuestionRef/)
  console.log('PASS alai-chat-practice-pedagogy: scaffolding tiers, hint budget/echo guard, natural tone, semantic acceptance, nonsense handling, teaching-order sequencing, question variety, bounded style repair')
}
main().catch(error => { console.error(error); process.exit(1) })
