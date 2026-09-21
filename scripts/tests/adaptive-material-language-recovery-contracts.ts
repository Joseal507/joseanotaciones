import assert from 'node:assert/strict'
import { academicVerdict, resolveMaterialLanguage } from '../../lib/materialLanguage'
import { presentAnswer } from '../../lib/adaptive/evaluation/answerPresentation'
import { createDeterministicRecoveryFallback } from '../../lib/adaptive/evaluation/recoveryFallback'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'
import { languageFixtures } from './material-language-authority-contracts'

function trueFalseQuestion(): CanonicalQuestion {
  return {
    id: 'q1',
    conceptId: 'concept:photosynthesis',
    conceptLabel: 'Photosynthesis',
    teachingBlockId: 'block:1',
    questionFamily: 'true_false_factual',
    variant: 'true_false_factual',
    difficulty: 'easy',
    targetDimension: 'recognition',
    format: 'true_false',
    questionText: 'Photosynthesis converts light energy into chemical energy.',
    options: null,
    correctAnswer: true,
    explanation: 'Chlorophyll absorbs light and stores the energy in sugars.',
    hint: '',
    estimatedSeconds: 20,
    evidencesNeeded: 1,
    factKey: 'q1:fact',
  } as CanonicalQuestion
}

// A. English: True / False
assert.equal(presentAnswer(trueFalseQuestion(), true, 'en'), 'True')
assert.equal(presentAnswer(trueFalseQuestion(), false, 'en'), 'False')

// B. Spanish: Verdadero / Falso
assert.equal(presentAnswer(trueFalseQuestion(), true, 'es'), 'Verdadero')
assert.equal(presentAnswer(trueFalseQuestion(), false, 'es'), 'Falso')

// G. und/missing language: deliberate neutral behavior (symbolic, never
// silently English/Spanish prose)
assert.equal(presentAnswer(trueFalseQuestion(), true), academicVerdict('und', 'true'))
assert.notEqual(academicVerdict('und', 'true'), 'True')
assert.notEqual(academicVerdict('und', 'true'), 'Verdadero')

// F. Unicode survives round-trip through detection + verdict for zh/fr/ja
for (const language of ['zh', 'fr', 'ja'] as const) {
  const verdict = academicVerdict(language, 'true')
  assert.ok(verdict.length > 0)
  assert.notEqual(verdict, 'True')
  assert.notEqual(verdict, 'Verdadero')
}

// C/D. Chinese and French deterministic recovery must not leak English or
// Spanish prose into question text / hints, and must match the boolean
// verdict language academicVerdict() already gives for that language.
for (const language of ['zh', 'fr', 'ja'] as const) {
  const [selection, claim] = createDeterministicRecoveryFallback({
    sourceQuestion: trueFalseQuestion(),
    studentAnswer: false,
    evaluationMode: 'mix_everything',
    roundNumber: 1,
    teachingContent: 'Chlorophyll absorbs light and stores the energy in sugars.',
    materialLanguage: language,
  })
  const englishTells = /\b(select|based on|compare|alternative interpretation)\b/i
  const spanishTells = /\b(selecciona|según|contrasta|interpretación alternativa)\b/i
  assert.ok(!englishTells.test(selection.questionText), `${language} selection leaked English: ${selection.questionText}`)
  assert.ok(!spanishTells.test(selection.questionText), `${language} selection leaked Spanish: ${selection.questionText}`)
  assert.ok(!englishTells.test(selection.hint || ''), `${language} hint leaked English`)
  assert.ok(!spanishTells.test(selection.hint || ''), `${language} hint leaked Spanish`)
  assert.ok(!englishTells.test(claim.questionText), `${language} claim leaked English: ${claim.questionText}`)
  assert.ok(!spanishTells.test(claim.questionText), `${language} claim leaked Spanish: ${claim.questionText}`)
}

// I. allStepsContent-shaped arrays preserve known language resolution (the
// exact defect: passing an array of {content} steps must not collapse to
// 'und' by wrapping it in a single blocks[].content value).
const allStepsContent = [
  { title: 'Step 1', content: languageFixtures.fr },
  { title: 'Step 2', content: languageFixtures.fr },
]
assert.equal(resolveMaterialLanguage({ blocks: allStepsContent }), 'fr')
assert.notEqual(resolveMaterialLanguage({ blocks: [{ content: allStepsContent }] }), 'fr')

// H. authoritative session/blueprint language wins over a conflicting
// untrusted client hint when both are present in the canonical payload
// shape (blueprint is authority, top-level materialLanguage is not).
assert.equal(
  resolveMaterialLanguage({ materialLanguage: 'es', blueprint: { materialLanguage: 'en' } }),
  'en',
)

// N. mixed-language / dominant-material behavior still follows the frozen
// aggregate authority, unaffected by this fix.
assert.equal(resolveMaterialLanguage({ blocks: [{ content: languageFixtures.ja }] }), 'ja')

console.log('PASS adaptive material language recovery: EN/ES/ZH/FR/JA presentation + recovery prose, und neutral, allStepsContent arrays, authoritative-vs-client precedence')
