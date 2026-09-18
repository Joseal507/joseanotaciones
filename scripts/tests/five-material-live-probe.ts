/** Explicit, opt-in live probe: 5 small synthetic materials, one bounded pass. No product persistence. */
import assert from 'node:assert/strict'
import { alaiJson } from '../../lib/alai'
import { detectMaterialLanguage } from '../../lib/materialLanguage'
import { buildPayload, KEYS, MATERIALS } from './five-material-fixture'
import { generateEnjoyerFlashcardDeck } from '../../lib/materialBrain/flashcards/enjoyerGenerator'
import { buildEnjoyerAssessmentUniverse, defaultEnjoyerQuizProvider } from '../../lib/materialBrain/quiz/enjoyer'
import { buildChatEnjoyerContext, retrieveForChat, renderChatEnjoyerContext } from '../../lib/materialBrain/chatEnjoyerContext'
import { buildTeachingOnlyPrompt } from '../../app/api/adaptive/session-teach/route'

const keyword: Record<string, RegExp> = { 'mat-A': /photosynth|chlorophyll|light/i, 'mat-B': /hybridi|sp3|orbital|tetrahedral/i, 'mat-C': /industrial|steam|coal|factor/i, 'mat-D': /quadratic|parabola|vertex/i, 'mat-E': /newton|force|acceleration|mass|F ?= ?ma/i }
const spanishLeak = /Respuesta correcta|Explicación|¿Cuál de|Selecciona|Verdadero|Falso/i

async function main() {
  const { payload, selection, blocks } = buildPayload(KEYS)
  const deck = await generateEnjoyerFlashcardDeck(payload, selection)
  const mats = new Set(deck.cards.map(c => (c.provenance[0] as any).materialId))
  assert.equal(mats.size, 5, `flashcards cover all five materials, got ${[...mats]}`)
  for (const card of deck.cards) {
    const text = `${card.question} ${card.answer}`
    assert.doesNotMatch(text, spanishLeak)
    assert.match(text, keyword[(card.provenance[0] as any).materialId], `card provenance matches its content: ${text.slice(0, 80)}`)
  }
  const universe = buildEnjoyerAssessmentUniverse(payload, selection)
  const perMaterial = KEYS.map(k => universe.targets.find(t => t.materialId === MATERIALS[k].id)!)
  const quiz = await defaultEnjoyerQuizProvider({ mode: 'generate', universe, requestedCount: 5,
    config: { questionCount: 5, difficulty: 'mixed', questionTypes: ['multiple_choice'] },
    requiredSlots: perMaterial.map((t, slot) => ({ slot, slotId: `slot-${slot}`, type: 'multiple_choice', primaryTargetId: t.id })),
  }) as { questions: { question: string; explanation: string; options: string[] }[] }
  assert.equal(quiz.questions.length, 5)
  quiz.questions.forEach((q, i) => {
    const text = [q.question, q.explanation, ...q.options].join(' ')
    assert.doesNotMatch(text, spanishLeak); assert.equal(detectMaterialLanguage(text), 'en')
    assert.match(text, keyword[perMaterial[i].materialId], `quiz slot ${i} grounded on ${perMaterial[i].materialId}`)
  })
  const chat = buildChatEnjoyerContext(payload, selection)
  const retrieval = retrieveForChat({ query: 'Compare the role of energy in photosynthesis and Newton second law.', context: chat })
  const answer = await alaiJson({ messages: [{ role: 'system', content: renderChatEnjoyerContext(retrieval) },
    { role: 'user', content: 'Compare the role of energy in photosynthesis and Newton second law. Return JSON {"answer":string}, 3 sentences, using only the provided sources.' }], json: true, maxTokens: 600, taskType: 'summary' })
  assert.match(answer.answer, keyword['mat-A']); assert.match(answer.answer, keyword['mat-E'])
  assert.doesNotMatch(answer.answer, /steam|industrial|quadratic|Zorblax/i, 'no unrelated selected material leaks into the comparison')
  const input = { session: { kind: 'learning', blockIds: ['E-p2'], title: 'Physics' }, blueprint: { ...payload.blueprint, blocks: blocks.map(b => ({ ...b, name: b.label })), topics: (payload.blueprint as any).topicsIndex }, setup: {}, userProfile: {}, materialTitle: 'Physics' } as unknown as Parameters<typeof buildTeachingOnlyPrompt>[0]
  const teaching = await alaiJson({ messages: [{ role: 'user', content: buildTeachingOnlyPrompt(input) }], json: true, maxTokens: 2200, taskType: 'session_content' })
  const teachText = JSON.stringify(teaching)
  assert.match(teachText, keyword['mat-E']); assert.doesNotMatch(teachText, spanishLeak)
  assert.doesNotMatch(teachText, /photosynth|chlorophyll|steam power|quadratic/i, 'Adaptive interaction stays on Material E')
  console.log(`LIVE PASS five-material: ${deck.cards.length} flashcards over 5 materials, 5 quiz questions (1/material), cross-material chat, Adaptive interaction on Material E`)
}
main().catch(e => { console.error(e); process.exit(1) })
