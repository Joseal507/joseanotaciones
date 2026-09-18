import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { withMaterialLanguage, academicLanguageInstruction } from '../../lib/materialLanguage'
import { languageFixtures } from './material-language-authority-contracts'
import { buildEnjoyerFlashcardPrompt, generateEnjoyerFlashcardDeck } from '../../lib/materialBrain/flashcards/enjoyerGenerator'
import { buildEnjoyerAssessmentUniverse, defaultEnjoyerQuizProvider } from '../../lib/materialBrain/quiz/enjoyer'
import { buildExamEnjoyerUniverse } from '../../lib/materialBrain/examEnjoyerContext'
import { buildGroundedExamPrompt, fallbackPromptForSlot } from '../../app/api/alai-studyal-exam/route'
import { buildRepasarEnjoyerGroundedContext } from '../../lib/materialBrain/repasarEnjoyerContext'
import { freezeRepasarEnjoyerSnapshot, snapshotGroundedContext } from '../../lib/materialBrain/repasarSnapshot'
import { renderRepasarGroundedContextForPrompt } from '../../lib/materialBrain/reviewContext'
import { buildAnalysisEnjoyerContext, renderAnalysisEnjoyerContext, deterministicProbabilidadExamen } from '../../lib/materialBrain/analysisEnjoyerContext'
import { buildChatEnjoyerContext, retrieveForChat, renderChatEnjoyerContext } from '../../lib/materialBrain/chatEnjoyerContext'
import { buildStudyMapEnjoyerContext, buildStudyMapNodeExplanationContext, renderStudyMapNodeExplanationContext } from '../../lib/materialBrain/studyMapEnjoyerContext'
import { buildTruquitosEnjoyerContext } from '../../lib/materialBrain/truquitosEnjoyerContext'
import { buildProsePrompt } from '../../lib/truquitos/artifact'
import { buildTeachingOnlyPrompt } from '../../app/api/adaptive/session-teach/route'
import { displayName as narrativeName } from '../../lib/adaptive/narrativeFormatter'
import { displayName as presentationName } from '../../lib/adaptive/presentationLayer'
import { generateValidatedLegacyJson } from '../../lib/ai/legacyRouteGeneration'

const scope = buildSourceSelectionSnapshot(['material'], { material: [1] })
const leakage = /Respuesta correcta|Explicación|Tu respuesta|¿Cuál de|Selecciona|Verdadero|Falso|Concepto clave/i
const checkPrompt = (prompt: string, language: string) => {
  assert.ok(prompt.includes(`AUTHORITY: ${language}.`), prompt.slice(0, 150))
  assert.ok(prompt.includes('repair and replacement must preserve'))
}
async function main() {
  for (const [language, content] of Object.entries(languageFixtures)) {
    const payload = withMaterialLanguage({ blueprint: {
      materialLanguage: language, sourceSelectionFingerprint: scope.fingerprint,
      materialIds: scope.materialIds, selectedPages: scope.selectedPages,
      topicsIndex: [{ id: 'topic', title: content, order: 0 }],
      globalOrderedAnalysis: [{ id: 'source', kind: 'concept', label: content, summary: content,
        importance: 95, materialId: 'material', pages: [1], topicId: 'topic', sourceSpans: [{ page: 1, quote: content }] }],
    } })
    let calls = 0
    const deck = await generateEnjoyerFlashcardDeck(payload, scope, { language: 'es', provider: async request => {
      checkPrompt(buildEnjoyerFlashcardPrompt(request), language)
      calls++
      if (calls === 1) return [] // Force the actual coverage-repair path.
      assert.equal(request.mode, 'repair')
      return [{ question: content, answer: content, sourceItemIds: ['source'], pages: [1], sourceSpans: [{ sourceItemId: 'source', page: 1, quote: content }] }]
    } })
    assert.equal(calls, 2)
    assert.equal(deck.cards[0].materialLanguage, language)
    assert.equal(deck.cards[0].answer, content)
    if (language === 'en') assert.doesNotMatch(JSON.stringify(deck.cards.map(c => [c.question, c.answer])), leakage)

    const universe = buildEnjoyerAssessmentUniverse(payload, scope)
    assert.equal(universe.materialLanguage, language)
    for (const mode of ['generate', 'repair'] as const) {
      await defaultEnjoyerQuizProvider({ mode, universe, config: { questionCount: 3, difficulty: 'mixed', questionTypes: ['multiple_choice'], language: 'es' }, requestedCount: 3 }, async params => {
        checkPrompt(params.messages.map(m => String(m.content)).join('\n'), language)
        return { text: '{"questions":[]}', provider: 'mock', model: 'deterministic' }
      })
    }
    const exam = buildExamEnjoyerUniverse(payload, scope)
    assert.equal(exam.materialLanguage, language)
    checkPrompt(buildGroundedExamPrompt([], exam.materialLanguage), language)
    // Force malformed JSON through the same format repair used by Exam.
    let repairs = 0
    await generateValidatedLegacyJson({ prompt: buildGroundedExamPrompt([], language), taskType: 'final_exam', failurePath: 'single_repair',
      provider: async params => {
        checkPrompt(params.messages.map(m => String(m.content)).join('\n'), language)
        return { text: ++repairs === 1 ? '{invalid' : '{"questions":[]}', provider: 'mock', model: 'deterministic' }
      }, normalize: raw => raw, validate: () => ({ valid: true, errors: [] }) })
    assert.equal(repairs, 2)

    const review = buildRepasarEnjoyerGroundedContext(payload, scope)
    const restored = snapshotGroundedContext(JSON.parse(JSON.stringify(freezeRepasarEnjoyerSnapshot(review))))
    assert.equal(restored.materialLanguage, language)
    checkPrompt(renderRepasarGroundedContextForPrompt(restored), language)
    assert.equal(restored.targets[0].sourceSpans[0].quote, content)
    const analysis = buildAnalysisEnjoyerContext(payload, scope)
    checkPrompt(renderAnalysisEnjoyerContext(analysis), language)
    assert.equal(deterministicProbabilidadExamen(analysis.targets)[0].razon, content)
    const chat = buildChatEnjoyerContext(payload, scope)
    const retrieved = retrieveForChat({ query: content, context: chat })
    checkPrompt(renderChatEnjoyerContext(retrieved), language)
    assert.ok(renderChatEnjoyerContext(retrieved).includes('CURRENT user message'))
    assert.equal(chat.materialLanguage, language)
    const map = buildStudyMapEnjoyerContext(payload, scope)
    const explanation = buildStudyMapNodeExplanationContext(map, [map.nodes[0].id])!
    checkPrompt(renderStudyMapNodeExplanationContext(explanation), language)
    assert.equal(map.nodes[0].label, content)
    const tricks = buildTruquitosEnjoyerContext(payload, scope)
    assert.equal(tricks.language, language)
    checkPrompt(buildProsePrompt([], tricks.language), language)
    const teachingInput = { session: { kind: 'learning', blockIds: ['source'] }, blueprint: {
      ...payload.blueprint, blocks: payload.blueprint.globalOrderedAnalysis, topics: payload.blueprint.topicsIndex,
    }, setup: {}, userProfile: {} } as unknown as Parameters<typeof buildTeachingOnlyPrompt>[0]
    checkPrompt(buildTeachingOnlyPrompt(teachingInput), language)
    assert.equal(narrativeName(content), content)
    assert.equal(presentationName(content), content)
    console.log(`PASS ${language}: 8 Free adapters + Adaptive teaching; persisted Unicode; Flashcard/Quiz/Exam repair prompts`)
  }
  assert.equal(narrativeName('Energy Level Equation'), 'Energy Level Equation')
  assert.equal(presentationName('Energy Level Equation'), 'Energy Level Equation')
  const chatSource = readFileSync('app/api/alai-studyal-chat/route.ts', 'utf8')
  assert.match(chatSource, /academicLanguageInstruction\(params.materialLanguage, true\)/)
  assert.match(chatSource, /materialLanguage: context.materialLanguage, message/)
  for (const route of ['session-teach', 'session-ask', 'session-chat', 'session-eval', 'session-reteach', 'session-check', 'session-copy']) {
    assert.ok(readFileSync(`app/api/adaptive/${route}/route.ts`, 'utf8').includes('academicLanguageInstruction'))
  }
  assert.ok(academicLanguageInstruction('en', true).includes('never mutated'))
  console.log('PASS shared authority, no normalization translation, response-scoped explicit chat override contract')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
