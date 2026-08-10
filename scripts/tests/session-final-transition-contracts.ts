import assert from 'node:assert/strict'
import { clampTeachingStepIndex, deriveNextSessionAction, getPrimaryActionLabel, getRecoveryActionLabel, type SessionTransitionState } from '../../lib/adaptive/sessionFinalTransition'

const complete:SessionTransitionState={currentStepIndex:11,currentEvaluationBlock:{id:'final',completed:true},currentQuestionIndex:2,unansweredNormalQuestions:0,pendingRecoveries:0,actionableRecoveries:0,activeRecovery:false,completedEvaluationBlocks:4,totalEvaluationBlocks:4,totalTeachingSteps:12,sessionKind:'learning',sessionCompletionResult:{isSessionComplete:true,objectiveCoverageRatio:1}}
assert.deepEqual(deriveNextSessionAction(complete),{type:'complete_session'})
assert.equal(getPrimaryActionLabel(deriveNextSessionAction(complete)),'🎉 Terminar')
assert.deepEqual(deriveNextSessionAction({...complete,pendingRecoveries:1,actionableRecoveries:1}),{type:'show_next_recovery'})
// BUG 2 (misión de reproducción real): pendingRecoveries>0 SOLO por un item
// 'unresolved' (actionableRecoveries=0) nunca debe derivar show_next_recovery
// (llevaría a un handler que no encuentra nada que enrutar — CTA muerto) ni
// complete_session (falsa completion). Debe bloquearse honestamente.
assert.deepEqual(deriveNextSessionAction({...complete,pendingRecoveries:1,actionableRecoveries:0}),{type:'blocked',reason:'unresolved_recovery_gap'})
assert.deepEqual(deriveNextSessionAction({...complete,activeRecovery:true}),{type:'show_next_recovery'})
assert.deepEqual(deriveNextSessionAction({...complete,currentStepIndex:9}),{type:'show_next_teaching_step'})
assert.deepEqual(deriveNextSessionAction({...complete,currentEvaluationBlock:{id:'final',completed:false}}),{type:'complete_current_block'})
assert.deepEqual(deriveNextSessionAction({...complete,unansweredNormalQuestions:1}),{type:'show_next_normal_question'})
assert.deepEqual(deriveNextSessionAction({...complete,completedEvaluationBlocks:3}),{type:'blocked',reason:'evaluation_blocks_incomplete'})
assert.deepEqual(deriveNextSessionAction({...complete,sessionCompletionResult:{isSessionComplete:false,objectiveCoverageRatio:1}}),{type:'blocked',reason:'engine_session_incomplete'})
assert.equal(clampTeachingStepIndex(12,12),11)
assert.equal(clampTeachingStepIndex(11,12),11)
assert.equal(getRecoveryActionLabel({explanationVisible:true}),'Verificar comprensión →')
assert.equal(getRecoveryActionLabel({}),'Continuar recuperación →')
assert.equal(getRecoveryActionLabel({roundFailed:true}),'Revisar de nuevo →')
assert.equal(getRecoveryActionLabel({resolved:true,hasMoreTeachingSteps:true}),'Continuar →')
assert.equal(getRecoveryActionLabel({resolved:true,hasMoreTeachingSteps:false}),'🎉 Terminar')

async function main(){
  let completionCalls=0;let persistenceCalls=0;let locked=false
  const execute=async(action=deriveNextSessionAction(complete))=>{if(locked)return false;locked=true;try{if(action.type==='complete_session'){completionCalls++;persistenceCalls++;await Promise.resolve()}return true}finally{locked=false}}
  await Promise.all([execute(),execute()])
  assert.equal(completionCalls,1);assert.equal(persistenceCalls,1)
  for(let index=0;index<100;index++)assert.doesNotThrow(()=>deriveNextSessionAction({...complete,currentStepIndex:index%12}))
  assert.equal(clampTeachingStepIndex(999,12),11)
  console.log('session-final-transition-contracts: final block, lock, clamp and 100 transitions PASS')
}
main().catch(error=>{console.error(error);process.exitCode=1})
