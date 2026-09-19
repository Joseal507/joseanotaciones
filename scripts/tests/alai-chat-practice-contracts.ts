import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildChatEnjoyerContext } from '../../lib/materialBrain/chatEnjoyerContext'
import {
  splitPracticeVerdictTag, PRACTICE_START_SLOT, appendAsked, buildPracticeDirective, extractAskedQuestion, nextPracticeState, normalizePracticeNotation, pickPracticeCandidates,
  practiceTurnKey, readInteractionMode, readPracticeSlot, readPracticeVerdict,
} from '../../lib/alai-chat/practice'
import { chatTurnIdentity } from '../../lib/alai-chat/turnStore'
import { buildPayload, KEYS } from './five-material-fixture'

// ── mode / slot / verdict parsing ────────────────────────────────────────
assert.equal(readInteractionMode(undefined), 'ask', 'default = Preguntar')
assert.equal(readInteractionMode('answer'), 'answer'); assert.equal(readInteractionMode('quiz'), null, 'unknown mode is invalid, never silently downgraded')
assert.equal(readPracticeSlot(' abc '), 'abc'); assert.equal(readPracticeSlot(''), null); assert.equal(readPracticeSlot('x'.repeat(161)), null)
assert.equal(readPracticeVerdict('correct'), 'correct'); assert.equal(readPracticeVerdict('mastered'), null); assert.equal(readPracticeVerdict(undefined), null)

// ── notation is normalized, never solved ─────────────────────────────────
for (const variant of ['sp³', 'sp 3', 'SP3', 'sp^3']) assert.match(normalizePracticeNotation(`hibridación ${variant}`).toLowerCase(), /sp3\b/, `chemistry notation ${variant}`)
assert.equal(normalizePracticeNotation('x² − 4 = (x−2)(x+2)'), 'x2 - 4 = (x-2)(x+2)')
assert.equal(extractAskedQuestion('Correcto. Ahora dime: ¿cuál es el ángulo tetraédrico?'), '¿cuál es el ángulo tetraédrico?')
assert.deepEqual(appendAsked(['¿a?'], '¿a?'), ['¿a?'])

assert.deepEqual(splitPracticeVerdictTag('[[V:Correct]]  ¡Bien! ¿Siguiente?'), { verdict: 'correct', answer: '¡Bien! ¿Siguiente?' })
assert.deepEqual(splitPracticeVerdictTag('sin marcador'), { verdict: null, answer: 'sin marcador' }); assert.equal(splitPracticeVerdictTag('[[V:mastered]] x').verdict, null, 'unknown verdicts are not recognized')

// ── durable identity: Preguntar and Responder can never collide ──────────
assert.notEqual(chatTurnIdentity('u', 's', 'fp', 'abc'), chatTurnIdentity('u', 's', 'fp', practiceTurnKey('abc')), 'a practice slot never equals a Preguntar client turn id')
assert.equal(chatTurnIdentity('u', 's', 'fp', practiceTurnKey('q1')), chatTurnIdentity('u', 's', 'fp', practiceTurnKey('q1')), 'the same question slot is one durable record')
assert.notEqual(chatTurnIdentity('u', 's', 'fp1', practiceTurnKey(PRACTICE_START_SLOT)), chatTurnIdentity('u', 's', 'fp2', practiceTurnKey(PRACTICE_START_SLOT)), 'a different source selection has a different first question')

// ── the progression state machine ────────────────────────────────────────
const base = { start: false, answer: 'Siguiente: ¿pregunta nueva?', usedTargetIds: ['chat_target:n'], candidateIds: ['chat_target:n', 'chat_target:m'], questionRef: 'ref2' }
const pending = { version: 1 as const, subject: 's', operation: 'prose' as const, sourcePolicy: 'MIXED' as const, usedTargetIds: [], usedRelationIds: [], practiceCurrentTargetIds: ['chat_target:cur'], practiceAttempts: 1, practiceTargetIds: ['chat_target:done'], practiceQuestionRef: 'ref1' }
const started = nextPracticeState({ ...base, previous: null, start: true, verdict: 'start', usedTargetIds: [] })
assert.deepEqual(started.practiceCurrentTargetIds, ['chat_target:n'], 'start picks the first candidate when none was reported'); assert.equal(started.practiceLastVerdict, 'start'); assert.equal(started.practiceAttempts, 0)
const correct = nextPracticeState({ ...base, previous: pending, verdict: 'correct' })
assert.deepEqual(correct.practiceTargetIds, ['chat_target:done', 'chat_target:cur'], 'correct: the concept becomes mastered'); assert.deepEqual(correct.practiceCurrentTargetIds, ['chat_target:n']); assert.equal(correct.practiceAttempts, 0)
for (const verdict of ['partial', 'incorrect'] as const) {
  const stay = nextPracticeState({ ...base, previous: pending, verdict })
  assert.deepEqual(stay.practiceCurrentTargetIds, ['chat_target:cur'], `${verdict}: same concept`); assert.deepEqual(stay.practiceTargetIds, ['chat_target:done'], `${verdict}: not mastered`); assert.equal(stay.practiceAttempts, 2)
}
const question = nextPracticeState({ ...base, previous: pending, verdict: 'question' })
assert.deepEqual(question.practiceCurrentTargetIds, ['chat_target:cur']); assert.equal(question.practiceAttempts, 1, 'a question is not a failed attempt')
for (const junk of [undefined, null, 'mastered', 42, '']) {
  const safe = nextPracticeState({ ...base, previous: pending, verdict: junk })
  assert.deepEqual(safe.practiceCurrentTargetIds, ['chat_target:cur'], `unreadable verdict ${String(junk)} never advances`); assert.deepEqual(safe.practiceTargetIds, ['chat_target:done'])
}
assert.equal(correct.practiceQuestionRef, 'ref2', 'every generated question becomes the new pending slot')

// ── remediation is bounded, not an infinite loop ─────────────────────────
const directive = (attempts: number) => buildPracticeDirective({ start: false, lastQuestion: '¿q?', answer: 'x', asked: ['¿q?'], candidateIds: ['chat_target:n'], currentIds: ['chat_target:cur'], attempts })
assert.doesNotMatch(directive(1), /INTENTO 3\+ FALLIDO → explica/); assert.match(directive(3), /SÍ enseña: escribe la explicación clara/)
assert.match(directive(0), /practiceVerdict/); assert.match(directive(0), /SOLO avanza cuando demuestra comprensión/)
assert.match(directive(0), /EL MISMO CONCEPTO ACTUAL/); assert.match(directive(0), /NO determinan el idioma de salida/)
assert.match(buildPracticeDirective({ start: true, lastQuestion: '', answer: '', asked: [] }), /usa solo el tema\/materia indicados/, 'a material session is never turned into unrestricted trivia')

// ── candidate rotation: unpracticed only, material-interleaved, lead rotates ─
const five = buildPayload(KEYS)
const context = buildChatEnjoyerContext(five.payload, five.selection)
const mats = (rotation: number) => pickPracticeCandidates(context, [], 4, rotation).map(t => t.materialId)
assert.equal(new Set(mats(0)).size, 4, 'candidates span four materials'); assert.notEqual(mats(0)[0], mats(1)[0], 'the lead material rotates')
assert.ok(!pickPracticeCandidates(context, [context.targets[0].id], 4).some(t => t.id === context.targets[0].id), 'practiced targets are not offered again')

// ── static: no new pipeline, no new language authority, ask/answer stay orthogonal to sourcePolicy ─
const practiceSource = readFileSync('lib/alai-chat/practice.ts', 'utf8')
assert.doesNotMatch(practiceSource, /detectLanguage|detectMaterialLanguage|from '..\/alai'|generateValidatedLegacyJson|fetch\(/)
const routeSource = readFileSync('app/api/alai-studyal-chat/route.ts', 'utf8')
assert.equal((routeSource.match(/generateValidatedLegacyJson\(\{/g) || []).length, 1, 'still one grounded generation path')
assert.doesNotMatch(readFileSync('lib/alai-chat/contracts.ts', 'utf8'), /interactionMode/)
const ui = readFileSync('components/materias/ALAIStudyALChat.tsx', 'utf8')
assert.match(ui, /\[\['ask', 'Preguntar'\], \['answer', 'Responder'\]\]/); assert.match(ui, /role="radiogroup"/); assert.match(ui, /aria-checked=\{interactionMode === value\}/)
assert.match(ui, /Pregúntale a ALAI/); assert.match(ui, /ALAI te pregunta a ti/)
assert.doesNotMatch(ui, /useEffect\(\(\) => \{\s*if \(interactionMode === 'answer'\)/, 'no raw "mode === answer → generate" effect')
assert.match(ui, /if \(activeThread === 'answer' && practiceNeedsStart\) startPractice\(\)/, 'generation is gated by the durable-thread check')
assert.match(ui, /if \(!needsPracticeStart\(rootRef\.current\)\) return;/)
console.log('PASS alai-chat-practice: parsing, notation, durable identity namespacing, verdict state machine, bounded remediation, candidate rotation, no new pipeline')
