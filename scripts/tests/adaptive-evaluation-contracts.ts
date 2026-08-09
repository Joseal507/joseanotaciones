import assert from 'node:assert/strict'
import {
  hasBrokenLatex,
  normalizeOptionToString,
  normalizeGeneratedQuestion,
  questionSimilarity,
  restoreCanonicalQuestion,
  validateQuestion,
  type CanonicalQuestion,
  type GenerationContext,
} from '../../lib/adaptive/evaluation/questionContract'
import { generateValidQuestion } from '../../lib/adaptive/evaluation/generationPipeline'
import { invalidScoreResult, scoreQuestion } from '../../lib/adaptive/evaluation/scoring'
import { EVALUATION_GENERATION_ERROR, generationErrorMessage } from '../../lib/adaptive/evaluation/uiState'
import { presentAnswer } from '../../lib/adaptive/evaluation/answerPresentation'

async function main() {
const context: GenerationContext = {
  activeConceptId: 'kp',
  activeConceptLabel: 'Kp',
  teachingBlockId: 'block-kp',
  targetDimension: 'application',
  questionFamily: 'scenario_predict',
  allowedConceptIds: ['kp'],
  forbiddenConceptIds: ['kc'],
}

const base = {
  conceptId: 'kp', conceptLabel: 'Kp', variant: 'scenario_predict',
  difficulty: 'medium', targetDimension: 'application',
  questionText: 'A 300 K, con R = 0.082, ¿qué relación permite calcular Kp si Kc = 2?',
  options: [{ id: 'a', text: 'Kp = Kc(RT)^Δn' }, { id: 'b', text: 'Kp = Kc/RT' }],
  correctAnswer: { id: 'a', text: 'Kp = Kc(RT)^Δn' },
  explanation: 'Se usa la relación entre ambas constantes.', hint: 'Considera Δn.',
}

const q = normalizeGeneratedQuestion(base, context, 'q1')
assert(q)
assert.deepEqual(q.options[0], { id: 'a', text: 'Kp = Kc(RT)^Δn' })
assert.equal(q.correctAnswer, 'a')

const regressionOptions = [
  'a) La reacción directa se detiene por completo, mientras que la reacción inversa continúa hasta consumir todos los productos.',
  'b) Las reacciones continúan a velocidades iguales.',
]
assert.doesNotThrow(() => regressionOptions.map(normalizeOptionToString))
assert.deepEqual(regressionOptions.map(normalizeOptionToString), regressionOptions)
assert.equal(normalizeOptionToString('texto'), 'texto')
assert.equal(normalizeOptionToString({ text: 'texto' }), 'texto')
assert.equal(normalizeOptionToString({ id: 'a', text: 'texto' }), 'texto')
assert.equal(normalizeOptionToString(null), '')
assert.equal(normalizeOptionToString([]), '')
assert.equal(normalizeOptionToString({}), '')

const stringOptionQuestion = normalizeGeneratedQuestion({
  ...base,
  options: regressionOptions,
  correctAnswer: regressionOptions[1],
}, context)
assert(stringOptionQuestion)
assert.deepEqual(stringOptionQuestion.options.map(option => option.text), regressionOptions)
assert.equal(validateQuestion(stringOptionQuestion, context).valid, true)

const legacyRecent = { ...q, options: regressionOptions } as unknown as CanonicalQuestion
assert.doesNotThrow(() => validateQuestion(q, context, [legacyRecent]))

assert.equal(generationErrorMessage(false, { success: false }), EVALUATION_GENERATION_ERROR)
assert.equal(generationErrorMessage(true, { success: true }), null)

const byId = normalizeGeneratedQuestion({ ...base, correctAnswer: 'a' }, context)
assert(byId && byId.correctAnswer === 'a')
assert.equal(normalizeGeneratedQuestion({ ...base, correctAnswer: 'z' }, context), null)
assert.equal(normalizeGeneratedQuestion({ ...base, options: [{ nested: { bad: true } }, 'B'] }, context), null)

assert.equal(normalizeGeneratedQuestion({
  ...base, variant: 'matching_concept_def',
  options: [{ left: 'Kp' }], correctAnswer: {},
}, context), null)

const wb = normalizeGeneratedQuestion({
  ...base, variant: 'word_bank_formula', questionText: 'Kp = ___ ___',
  options: ['Kc', 'RT'], correctAnswer: ['Kc'],
}, context)
assert(wb)
assert(validateQuestion(wb, context).errors.includes('word_bank_slot_mismatch'))
assert.deepEqual(wb.correctAnswer, ['option_1'])

const ordering = normalizeGeneratedQuestion({
  ...base, variant: 'ordering_steps', options: ['Paso A', 'Paso A'],
  correctAnswer: ['Paso A', 'Paso A'],
}, context)
assert.equal(ordering, null)

assert.equal(normalizeGeneratedQuestion({
  ...base, variant: 'mcq_all_that_apply', correctAnswer: ['a', 'z'],
}, context), null)

const numericContext = { ...context, questionFamily: 'problem_solve' }
const numeric = normalizeGeneratedQuestion({
  ...base, variant: 'problem_solve',
  questionText: 'Con Kc = 2, R = 0.082 y T = 300 K, calcula Kp.',
  options: null, correctAnswer: { value: 4.2, tolerance: 0.05, unit: 'atm' },
}, numericContext)
assert(numeric && numeric.format === 'numeric_problem')
assert.equal(scoreQuestion(numeric, { value: 4.22, unit: 'atm' }).outcome, 'correct')
assert.equal(scoreQuestion(numeric, { value: 4.22, unit: 'M' }).outcome, 'incorrect')

for (const latex of [
  '$K_c$', '$K_p = K_c(RT)^{\\Delta n}$',
  '$N_2O_4(g) \\rightleftharpoons 2NO_2(g)$',
  '$$K_c = \\frac{[C]^c[D]^d}{[A]^a[B]^b}$$',
  '$1.87 \\times 10^{-3}\\,\\mathrm{M}$',
]) assert.equal(hasBrokenLatex(latex), false)
for (const broken of ['ightleftharpoons', 'rac', 'imes', '\\rac']) assert.equal(hasBrokenLatex(broken), true)

const wrongConcept = normalizeGeneratedQuestion({ ...base, conceptId: 'kc' }, context)
assert(wrongConcept)
assert(validateQuestion(wrongConcept, context).errors.includes('concept_mismatch'))

const missingData = normalizeGeneratedQuestion({
  ...base, questionText: 'Calcula Kp.', correctAnswer: 'a',
}, context)
assert(missingData)
assert.equal(missingData.requiresNumericData, false)
assert.ok(!validateQuestion(missingData, context).errors.includes('insufficient_numeric_data'))
const missingQuantitativeData = normalizeGeneratedQuestion({
  ...base, variant:'problem_solve', questionText:'Calcula Kp.',
  correctAnswer:{ value:4.2, tolerance:0.05 },
}, { ...context, questionFamily:'problem_solve', cognitiveTargetContract:'calculation' })
assert(missingQuantitativeData)
assert.equal(missingQuantitativeData.requiresNumericData, true)
assert(validateQuestion(missingQuantitativeData, { ...context, questionFamily:'problem_solve', cognitiveTargetContract:'calculation' }).errors.includes('insufficient_numeric_data'))

assert(q)
assert(validateQuestion(q, context, [q]).errors.includes('repeated_question'))
const paraphrase = normalizeGeneratedQuestion({
  ...base,
  questionText: 'A 300 K, si R = 0.082 y Kc = 2, selecciona la relación que calcula Kp.',
}, context)
assert(paraphrase)
assert(questionSimilarity(q, paraphrase) >= 0.58)

let calls = 0
const retried = await generateValidQuestion(async () => {
  calls++
  return calls === 1 ? { ...base, correctAnswer: 'missing' } : base
}, context, [])
assert(retried.success && retried.attempts === 2)

const exhausted = await generateValidQuestion(async () => ({ ...base, correctAnswer: 'missing' }), context, [], 3)
assert(!exhausted.success && exhausted.invalidQuestion && exhausted.attempts === 3)

assert.equal(invalidScoreResult().outcome, 'invalid')
assert.equal(invalidScoreResult().needsReteaching, false)
assert.equal(scoreQuestion(q, 'b').outcome, 'incorrect')
assert.equal(scoreQuestion(q, 'b').needsReteaching, true)
assert.equal(scoreQuestion(q, 'a').outcome, 'correct')

const formats: CanonicalQuestion[] = []
const fixtures = [
  base,
  { ...base, variant: 'mcq_all_that_apply', correctAnswer: ['a'] },
  { ...base, variant: 'true_false_factual', targetDimension: 'recognition', options: null, correctAnswer: true },
  { ...base, variant: 'word_bank_formula', questionText: 'Kp = ___', options: ['Kc', 'Kx'], correctAnswer: ['Kc'] },
  { ...base, variant: 'matching_formula_name', options: { Kp: 'presión', Kc: 'concentración' }, correctAnswer: { Kp: 'presión', Kc: 'concentración' } },
  { ...base, variant: 'ordering_steps', options: ['a', 'b'], correctAnswer: ['a', 'b'] },
  { ...base, variant: 'classify_category', options: { Kp: 'presión', Kc: 'concentración' }, correctAnswer: { Kp: 'presión', Kc: 'concentración' } },
  { ...base, variant: 'find_error_calculation' },
  { ...base, variant: 'short_answer_define', correctAnswer: 'Una constante basada en presiones.' },
]
for (const fixture of fixtures) {
  const fixtureContext = { ...context, targetDimension: (fixture.targetDimension || context.targetDimension) as GenerationContext['targetDimension'] }
  const normalized = normalizeGeneratedQuestion(fixture, fixtureContext)
  assert(normalized)
  formats.push(normalized)
}
assert.equal(new Set(formats.map(item => item.format)).size, 9)

const wordBank = formats.find(item => item.format === 'word_bank')
assert(wordBank && wordBank.format === 'word_bank')
assert.equal(scoreQuestion(wordBank, wordBank.correctAnswer).correct, true)
assert.equal(presentAnswer(wordBank, wordBank.correctAnswer), 'Kc')
assert.doesNotMatch(presentAnswer(wordBank, wordBank.correctAnswer), /\b(?:w\d+|blank\d+|option_\d+)\b/)

const matching = formats.find(item => item.format === 'matching')
assert(matching && matching.format === 'matching')
assert.equal(scoreQuestion(matching, matching.correctAnswer).correct, true)
assert.match(presentAnswer(matching, matching.correctAnswer), /Kp → presión/)
assert.doesNotMatch(presentAnswer(matching, matching.correctAnswer), /\b(?:pair_|match_)/)

const restored = restoreCanonicalQuestion(JSON.parse(JSON.stringify(q)), context)
assert.deepEqual(restored, q)

console.log('adaptive-evaluation-contracts: 25 escenarios deterministas PASS')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
