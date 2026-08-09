import assert from 'node:assert/strict'
import {
  CANONICAL_QUESTION_FORMATS,
  QUESTION_FORMAT_CAPABILITIES,
  QUESTION_VARIANT_FORMAT,
  canonicalQuestionFormat,
} from '../../lib/adaptive/evaluation/questionFormatRegistry'
import { selectPedagogicalFormat, type CognitiveLevel, type ContentSignal } from '../../lib/adaptive/evaluation/pedagogicalFormatSelector'
import { normalizeGeneratedQuestion, type CanonicalQuestion, type GenerationContext } from '../../lib/adaptive/evaluation/questionContract'
import { scoreQuestion } from '../../lib/adaptive/evaluation/scoring'
import { presentAnswer } from '../../lib/adaptive/evaluation/answerPresentation'

assert.equal(CANONICAL_QUESTION_FORMATS.length, 11)
for (const [variant, format] of Object.entries(QUESTION_VARIANT_FORMAT)) {
  assert.equal(canonicalQuestionFormat(variant), format)
  assert.ok(CANONICAL_QUESTION_FORMATS.includes(format))
  assert.equal(QUESTION_FORMAT_CAPABILITIES[format].renderer, format)
}
assert.equal(canonicalQuestionFormat('mcq'), 'multiple_choice')
assert.equal(canonicalQuestionFormat('fill_in_the_blank'), 'word_bank')
assert.equal(canonicalQuestionFormat('unknown_renderer'), null)

const domains = ['general_conceptual', 'chemistry_conceptual', 'chemistry_quantitative', 'physics_quantitative', 'mathematics', 'medicine', 'law', 'history', 'biology', 'mixed'] as const
const levels: CognitiveLevel[] = ['recognition', 'comprehension', 'application', 'transfer']
const signals: ContentSignal[] = ['definition', 'enumeration', 'procedure', 'formula', 'causal', 'comparison', 'classification', 'narrative', 'argumentation', 'case', 'exception', 'relation']
let generated = 0
const selectedFormats = new Set<string>()
for (const academicDomain of domains) for (const cognitiveLevel of levels) for (const contentSignal of signals) {
  for (const evaluationMode of ['quick_test', 'mix_everything', 'write_explain'] as const) {
    const selected = selectPedagogicalFormat({ cognitiveLevel, contentSignal, academicDomain, evaluationMode, recentFormats: [], recentVariants: [], consecutiveFailures: 0, isRecovery: false, questionIndex: 0, totalQuestionsInBlock: 3, targetStepIds: ['s1'], targetKeyPointIds: ['kp1'], targetFactKeys: ['f1'], targetObjectiveIds: ['o1'] })
    generated++
    selectedFormats.add(selected.format)
    assert.equal(QUESTION_VARIANT_FORMAT[selected.variant as keyof typeof QUESTION_VARIANT_FORMAT], selected.format)
    assert.ok(CANONICAL_QUESTION_FORMATS.includes(selected.format as typeof CANONICAL_QUESTION_FORMATS[number]))
    assert.notEqual(selected.format, 'short_response', 'short response permanece fuera de selección automática hasta tener scorer semántico robusto')
    if (cognitiveLevel === 'transfer') assert.ok(!['true_false', 'word_bank'].includes(selected.format))
    if (cognitiveLevel === 'recognition') assert.notEqual(selected.format, 'scenario')
  }
}
assert.equal(generated, 1440)
assert.ok(selectedFormats.size >= 7, `selector colapsado: ${[...selectedFormats].join(',')}`)

const matrix = [
  ['definition', 'recognition', ['multiple_choice', 'matching', 'true_false', 'word_bank']],
  ['definition', 'application', ['scenario', 'multiple_choice', 'find_the_error']],
  ['formula', 'application', ['numeric_problem', 'find_the_error', 'scenario', 'multiple_choice']],
  ['procedure', 'application', ['ordering', 'multiple_choice', 'find_the_error', 'scenario']],
  ['exception', 'comprehension', ['find_the_error', 'multiple_choice', 'true_false']],
  ['relation', 'comprehension', ['matching', 'multiple_choice']],
] as const
for (const [contentSignal, cognitiveLevel, allowed] of matrix) {
  const selected = selectPedagogicalFormat({ contentSignal, cognitiveLevel, academicDomain: 'general_conceptual', evaluationMode: 'quick_test', recentFormats: [], consecutiveFailures: 0, isRecovery: false, questionIndex: 1, totalQuestionsInBlock: 3 })
  assert.ok((allowed as readonly string[]).includes(selected.format), `${contentSignal}+${cognitiveLevel} produjo ${selected.format}`)
}

const context = (variant: string, dimension: CognitiveLevel = 'comprehension'): GenerationContext => ({ activeConceptId: 'c1', activeConceptLabel: 'Concepto', teachingBlockId: 's1', targetDimension: dimension, questionFamily: variant, allowedConceptIds: ['c1'], forbiddenConceptIds: [], factKeys: ['f1'], targetObjectiveIds: ['o1'] })
const base = { conceptId: 'c1', conceptLabel: 'Concepto', difficulty: 'medium', targetDimension: 'comprehension', questionText: 'Pregunta suficientemente clara', explanation: 'Explicación', hint: 'Pista' }
const make = (raw: Record<string, unknown>): CanonicalQuestion => {
  const question = normalizeGeneratedQuestion({ ...base, ...raw }, context(String(raw.variant), (raw.targetDimension || 'comprehension') as CognitiveLevel), String(raw.id || raw.variant))
  assert.ok(question)
  return question
}

const multi = make({ variant: 'multi_select_correct', options: [{id:'a',text:'A'},{id:'b',text:'B'},{id:'c',text:'C'}], correctAnswer:['a','b'] })
assert.equal(scoreQuestion(multi, ['b','a']).correct, true)
assert.equal(scoreQuestion(multi, ['a']).correct, false)
assert.equal(scoreQuestion(multi, ['a','b','c']).correct, false)
assert.equal(scoreQuestion(multi, []).correct, false)

const ordering = make({ variant:'ordering_steps', options:[{id:'s1',text:'1'},{id:'s2',text:'2'},{id:'s3',text:'3'}], correctAnswer:['s1','s2','s3'] })
assert.equal(scoreQuestion(ordering, ['s3','s2','s1']).score, 33)
assert.equal(scoreQuestion(ordering, ['s1','s3','s2']).score, 33)
assert.equal(scoreQuestion(ordering, ['s3','s2','s1']).correct, false)

const wordBank = make({ variant:'word_bank_process', questionText:'___ luego ___ y finalmente ___', options:[{id:'w1',text:'A'},{id:'w2',text:'B'},{id:'w3',text:'C'},{id:'d',text:'X'}], correctAnswer:['w1','w2','w3'] })
assert.equal(scoreQuestion(wordBank, ['w1','w2','w3']).correct, true)
assert.equal(scoreQuestion(wordBank, ['w1','d','w3']).correct, false)
assert.equal(presentAnswer(wordBank, wordBank.correctAnswer), 'A, B, C')

const matching = make({ variant:'matching_term_function', options:[{id:'l1',left:'L1',rightId:'r1',right:'R1'},{id:'l2',left:'L2',rightId:'r2',right:'R2'},{id:'l3',left:'L3',rightId:'r3',right:'R3'}], correctAnswer:{l1:'r1',l2:'r2',l3:'r3'} })
assert.equal(matching.format, 'matching')
for (const visualOrder of [['r1','r2','r3'], ['r3','r1','r2'], ['r2','r3','r1']]) {
  const visuallyShuffled = { ...matching, matchingOptionOrder: visualOrder } as typeof matching
  assert.equal(scoreQuestion(visuallyShuffled, {l1:'r1',l2:'r2',l3:'r3'}).score, 100)
}

const classify = make({ variant:'classify_examples', options:{categories:['A','B','C'],items:[{id:'i1',text:'I1',category:'A'},{id:'i2',text:'I2',category:'B'},{id:'i3',text:'I3',category:'C'}]}, correctAnswer:{i1:'A',i2:'B',i3:'C'} })
assert.equal(scoreQuestion(classify, {i1:'A',i2:'B',i3:'A'}).score, 67)
assert.equal(scoreQuestion(classify, {i1:'A',i2:'B',i3:'A'}).correct, false)

const numeric = make({ variant:'problem_solve', targetDimension:'application', questionText:'Con 5 unidades y una regla enseñada, calcula el valor.', options:null, correctAnswer:{value:-0.0051,tolerance:0.00001,unit:'mol'} })
for (const answer of ['-0.0051 mol', '-5.1e-3 mol', '-0,0051 mol']) assert.equal(scoreQuestion(numeric, answer).correct, true)
assert.equal(scoreQuestion(numeric, '0.51 mol').correct, false)
assert.equal(scoreQuestion(numeric, '-0.0051 M').correct, false)

const boolFalse = make({ variant:'true_false_relationship', targetDimension:'recognition', options:null, correctAnswer:false })
assert.equal(scoreQuestion(boolFalse, false).correct, true)
assert.equal(scoreQuestion(boolFalse, true).correct, false)

console.log(`question-type-layer-contracts: PASS (${generated} combinaciones; ${Object.keys(QUESTION_VARIANT_FORMAT).length} variants; ${selectedFormats.size} formatos seleccionados)`)
