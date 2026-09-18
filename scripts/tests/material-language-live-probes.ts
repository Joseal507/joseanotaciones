/** Explicit, opt-in provider probes. Synthetic materials only; no product persistence. */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { alaiJson } from '../../lib/alai'
import { academicLanguageInstruction, detectMaterialLanguage, withMaterialLanguage } from '../../lib/materialLanguage'
import { extractDocumentStructure, analyzeTopic } from '../../app/api/adaptive/blueprint/route'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { generateEnjoyerFlashcardDeck } from '../../lib/materialBrain/flashcards/enjoyerGenerator'
import { buildEnjoyerAssessmentUniverse, defaultEnjoyerQuizProvider } from '../../lib/materialBrain/quiz/enjoyer'
import { buildRepasarEnjoyerGroundedContext } from '../../lib/materialBrain/repasarEnjoyerContext'
import { renderRepasarGroundedContextForPrompt } from '../../lib/materialBrain/reviewContext'
import { buildTeachingOnlyPrompt } from '../../app/api/adaptive/session-teach/route'
import { buildChatEnjoyerContext, retrieveForChat, renderChatEnjoyerContext } from '../../lib/materialBrain/chatEnjoyerContext'

const samples = {
  en: 'Photosynthesis converts light energy into chemical energy. Chlorophyll absorbs light in the chloroplasts of plant cells. The light-dependent reactions use water and release oxygen. These reactions produce ATP and NADPH. The Calvin cycle uses ATP and NADPH to fix carbon dioxide into sugars. The sugars store chemical energy and support plant growth. Stomata are small pores that allow carbon dioxide to enter the leaf. Closing the stomata reduces water loss but also limits carbon dioxide uptake. Light intensity, carbon dioxide availability, and temperature can limit the rate of photosynthesis.',
  zh: '光合作用将光能转化为化学能。叶绿素在植物细胞的叶绿体中吸收光。光反应利用水并释放氧气，同时产生ATP和NADPH。卡尔文循环利用ATP和NADPH将二氧化碳固定为糖。糖储存化学能并支持植物生长。气孔是叶片表面的小孔，允许二氧化碳进入叶片。关闭气孔可以减少水分流失，但也限制二氧化碳的吸收。光照强度、二氧化碳浓度和温度都可能限制光合作用的速率。',
}
const evidence: Record<string, unknown> = {}
const leaks = /Respuesta correcta|Explicación|Tu respuesta|¿Cuál de|Selecciona|Verdadero|Falso|Concepto clave/i
function verify(text: string, language: string) {
  assert.doesNotMatch(text, leaks)
  if (language === 'zh') assert.match(text, /\p{Script=Han}/u)
  else assert.equal(detectMaterialLanguage(text), language)
}
async function main() {
  for (const [language, source] of Object.entries(samples)) {
    const topics = await extractDocumentStructure(new Map([[1, source]]), 'Synthetic source', language)
    assert.ok(topics.length)
    const blocks = await analyzeTopic(topics[0], source, topics, 'Synthetic source', 0, topics.length, language)
    assert.ok(blocks.length >= 1)
    verify(topics.map(topic => `${topic.title} ${topic.description}`).join(' '), language)
    verify(blocks.map(block => `${block.label} ${block.summary}`).join(' '), language)
    const scope = buildSourceSelectionSnapshot([`probe-${language}`], { [`probe-${language}`]: [1] })
    const payload = withMaterialLanguage({ blueprint: { materialLanguage: language,
      sourceSelectionFingerprint: scope.fingerprint, topicsIndex: topics,
      globalOrderedAnalysis: blocks.slice(0, 3).map((block, i) => ({ ...block, id: `source-${i}`, materialId: `probe-${language}`, pages: [1], sourceSpans: [{ page: 1, quote: source }] })),
    } })
    const deck = await generateEnjoyerFlashcardDeck(payload, scope)
    assert.ok(deck.cards.length >= (language === 'en' ? 3 : 1))
    verify(deck.cards.map(card => `${card.question} ${card.answer}`).join(' '), language)
    const universe = buildEnjoyerAssessmentUniverse(payload, scope)
    const quiz = await defaultEnjoyerQuizProvider({ mode: 'generate', universe, requestedCount: 3,
      config: { questionCount: 3, difficulty: 'mixed', questionTypes: ['multiple_choice'] },
      requiredSlots: [0, 1, 2].map(slot => ({ slot, slotId: `slot-${slot}`, type: 'multiple_choice', primaryTargetId: universe.targets[slot % universe.targets.length].id })),
    }) as { questions: { question: string; explanation: string; options: string[] }[] }
    assert.equal(quiz.questions.length, 3)
    verify(quiz.questions.map(q => [q.question, q.explanation, ...q.options].join(' ')).join(' '), language)
    const review = await alaiJson({ messages: [{ role: 'system', content: renderRepasarGroundedContextForPrompt(buildRepasarEnjoyerGroundedContext(payload, scope)) },
      { role: 'user', content: 'Return JSON {"explanation":string}: a short explanation of the main process.' }], json: true, maxTokens: 600, taskType: 'summary' })
    verify(review.explanation, language)
    const input = { session: { kind: 'learning', blockIds: ['source-0'], title: topics[0].title }, blueprint: { ...payload.blueprint,
      blocks: payload.blueprint.globalOrderedAnalysis, topics }, setup: {}, userProfile: {}, materialTitle: topics[0].title,
    } as unknown as Parameters<typeof buildTeachingOnlyPrompt>[0]
    const interaction = await alaiJson({ messages: [{ role: 'user', content: buildTeachingOnlyPrompt(input) }], json: true, maxTokens: 2200, taskType: 'session_content' })
    verify(JSON.stringify(interaction), language)
    let override: unknown
    if (language === 'en') {
      const chat = buildChatEnjoyerContext(payload, scope)
      const grounding = renderChatEnjoyerContext(retrieveForChat({ query: 'photosynthesis', context: chat }))
      override = await alaiJson({ messages: [{ role: 'system', content: `${academicLanguageInstruction(chat.materialLanguage, true)}\n${grounding}` },
        { role: 'user', content: 'Explícamelo en español. Return JSON {"answer":string}.' }], json: true, maxTokens: 700, taskType: 'summary' })
      assert.equal(detectMaterialLanguage(JSON.stringify(override)), 'es')
      assert.ok(!/solo puedo|no puedo|cannot|only (?:communicate|respond)/i.test(JSON.stringify(override)), 'explicit override must be fulfilled, not refused')
      assert.match(JSON.stringify(override), /fotos[ií]ntesis|luz|clorofila/i, 'override answer must actually explain the material')
      assert.equal(payload.blueprint.materialLanguage, 'en')
    }
    evidence[language] = { payload, cards: deck.cards, quiz, review, interaction, override }
    writeFileSync('/tmp/studyal-material-language-live.json', JSON.stringify(evidence, null, 2))
    console.log(`LIVE PASS ${language}: Enjoyer topics/blocks, ${deck.cards.length} flashcards, 3 Quiz questions, review, Adaptive interaction${override ? ', explicit Spanish chat override' : ''}`)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
