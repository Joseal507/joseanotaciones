import assert from 'node:assert/strict'
import { generateValidQuestion } from '../../lib/adaptive/evaluation/generationPipeline'
import { normalizeGeneratedQuestion, validateQuestion, type GenerationContext } from '../../lib/adaptive/evaluation/questionContract'
import { scoreQuestion } from '../../lib/adaptive/evaluation/scoring'
import { buildMasteryContract, isMastered, recordEvidence } from '../../lib/adaptive/v3/engine/masteryContract'

async function main() {
  const context: GenerationContext = {
    activeConceptId: 'procedure', activeConceptLabel: 'Procedimiento',
    teachingBlockId: 'block-procedure', targetDimension: 'application',
    questionFamily: 'ordering_steps', allowedConceptIds: ['procedure'], forbiddenConceptIds: [],
  }
  const fixture = {
    conceptId: 'procedure', conceptLabel: 'Procedimiento', variant: 'ordering_steps',
    difficulty: 'medium', targetDimension: 'application',
    questionText: 'Ordena los pasos para aplicar el procedimiento al caso nuevo.',
    options: [{ id: 'observe', text: 'Observar' }, { id: 'apply', text: 'Aplicar' }],
    correctAnswer: ['observe', 'apply'], explanation: 'Primero se observa y después se aplica.',
    hint: 'Empieza por reunir la información.',
  }
  const question = normalizeGeneratedQuestion(fixture, context)
  assert(question)

  assert.equal(scoreQuestion(question, ['observe', 'apply']).outcome, 'correct')
  assert.equal(scoreQuestion(question, ['apply', 'observe']).outcome, 'incorrect')
  assert.equal(scoreQuestion(question, ['observe', 'apply']).outcome, 'correct')

  const mcq = normalizeGeneratedQuestion({
    ...fixture, variant: 'scenario_choose_action',
    options: [{ id: 'diagnostic', text: 'Diagnosticar' }, { id: 'guess', text: 'Adivinar' }],
    correctAnswer: 'diagnostic',
  }, { ...context, questionFamily: 'scenario_choose_action' })
  assert(mcq)
  assert.equal(scoreQuestion(mcq, 'guess').errorType, 'selection')

  const contract = buildMasteryContract({ id: 'procedure', label: 'Procedimiento', kind: 'concept', bloomLevel: 'apply' })
  const before = JSON.stringify(contract)
  const broken = normalizeGeneratedQuestion({ ...fixture, questionText: 'rac' }, context)
  assert(broken && !validateQuestion(broken, context).valid)
  assert.equal(JSON.stringify(contract), before)

  let attempt = 0
  const retry = await generateValidQuestion(async () => {
    attempt++
    return attempt === 1 ? fixture : {
      ...fixture,
      questionText: 'Un compañero aplicó la regla sin revisar el caso. Ordena las acciones para diagnosticar y corregir su error.',
      options: [{ id: 'diagnose', text: 'Diagnosticar el error' }, { id: 'correct', text: 'Corregir la aplicación' }],
      correctAnswer: ['diagnose', 'correct'],
    }
  }, context, [question])
  assert(retry.success && retry.attempts === 2)

  const recognitionOnly = recordEvidence(contract, 'comprehension', 'ordering_steps', 100, true)
  assert.equal(isMastered(recognitionOnly), false)

  assert.equal(question.format, 'ordering')
  assert.equal(scoreQuestion(question, ['observe', 'apply']).score, 100)

  console.log('adaptive-evaluation-simulations: 7 perfiles PASS; false mastery = 0')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
