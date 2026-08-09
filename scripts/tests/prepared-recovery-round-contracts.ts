import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parsePreparedRecoveryRound } from '../../lib/adaptive/evaluation/preparedRecoveryRound'

const target = {
  sourceQuestionId: 'normal_q2',
  sourceStepIds: ['step_3'],
  sourceKeyPointIds: ['step_3:kp:1'],
  sourceFactKeys: ['falcons:identity'],
  microId: 'falcons_identity',
  cognitiveTarget: 'comprehension',
}
const question = (id: string) => ({
  id, conceptId:target.microId, conceptLabel:'Identidad de los Falcons', teachingBlockId:'step_3',
  questionFamily:`recovery_${id}`, variant:'mcq_best_answer', format:'multiple_choice', difficulty:'medium',
  targetDimension:'comprehension', questionText:`¿Qué demuestra la identidad de los Falcons? ${id}`,
  options:[{id:'a',text:'Pasión, resiliencia e impacto cultural'},{id:'b',text:'Solo campeonatos'}],
  correctAnswer:'a', explanation:'La identidad trasciende los títulos.', hint:'Piensa en la cultura.',
  estimatedSeconds:30, evidencesNeeded:1, factKey:'falcons:identity', factKeys:['falcons:identity'],
  coveredStepIds:['step_3'], coveredKeyPointIds:['step_3:kp:1'], coveredKeyPoints:['Identidad y cultura'],
})

const valid = parsePreparedRecoveryRound({
  success:true, recoveryId:'r1', recoveryTargetId:'rt1', roundId:'r1:round:1', roundNumber:1,
  explanation:'Confundiste campeonatos con identidad. La identidad también nace de pasión, resiliencia e impacto cultural.',
  questions:[question('v1'),question('v2')], target,
})
assert.equal(valid.success,true)
if(valid.success) assert.equal(valid.value.questions.length,2)

const partial = parsePreparedRecoveryRound({
  success:true, recoveryId:'r1', recoveryTargetId:'rt1', roundId:'r1:round:1', roundNumber:1,
  explanation:'Explicación válida y específica suficientemente extensa.', questions:[question('v1')], target,
})
assert.equal(partial.success,false)
if(!partial.success){assert.equal(partial.partial.explanationAccepted,true);assert.equal(partial.partial.questions.length,1);assert.match(partial.errorCode,/PARTIAL/)}

const page=readFileSync('app/materias/[temaId]/sesion/[sessionNumber]/page.tsx','utf8')
assert.doesNotMatch(page,/throw new Error\(["']RECOVERY_ROUND_GENERATION_FAILED["']\)/)
assert.match(page,/recovery_round_response_received/)
assert.match(page,/Reintentar explicación/)

console.log('prepared-recovery-round-contracts: PASS')
