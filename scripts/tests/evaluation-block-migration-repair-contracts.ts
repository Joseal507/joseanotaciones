import assert from 'node:assert/strict'
import { diagnoseEvaluationBlock, buildDeterministicEvaluationPlan, runSessionPreparationFactory, type PreparedEvaluationQuestion, type PreparedTeachingContent } from '../../lib/ai/sessionPreparationFactory'
import { canonicalizeGeneratedSession } from '../../lib/adaptive/evaluation/sessionEvaluation'

const teaching:PreparedTeachingContent={sessionId:'chapter_2',title:'Falcons',introduction:'',closing:'',steps:[{stepId:'step_1',id:'step_1',microId:'f1',title:'Identidad',type:'concept',content:'Pasión y resiliencia',keyPoints:['Pasión','Resiliencia'],keyPointIds:['step_1:kp:1','step_1:kp:2'],factKeys:['f1:fact:1'],importance:'important',cognitiveTarget:'comprehension',sourceReferences:[]}]}
const block=buildDeterministicEvaluationPlan(teaching,{evalPreference:'quick_test'}).blocks[0]
const question=(id:string,keyPointId:string):PreparedEvaluationQuestion=>({questionId:id,blockId:block.blockId,targetStepIds:['step_1'],targetKeyPointIds:[keyPointId],targetFactKeys:['f1:fact:1'],targetObjectiveIds:block.targetObjectiveIds,cognitiveTarget:'comprehension',format:'multiple_choice',prompt:`Pregunta ${id}`,options:['a','b'],correctAnswer:'a',feedback:'Feedback',difficulty:'medium'})
const valid=question('valid_q','step_1:kp:1')
const invalid={...question('chapter_2:evaluation:1_q1','step_1:kp:2'),targetFactKeys:['legacy:fact']}
const diagnostic=diagnoseEvaluationBlock(block,[valid,invalid],teaching,'quick_test')
assert.deepEqual(diagnostic.invalidQuestionIds,['chapter_2:evaluation:1_q1'])
assert.deepEqual(diagnostic.missingImportantKeyPointIds,['step_1:kp:2'])
assert.deepEqual(diagnostic.acceptedQuestionIds,['valid_q'])
assert.equal(diagnostic.requiredReplacementCount,1)
assert.equal(diagnostic.blockId,'chapter_2:evaluation:1')

const repaired=diagnoseEvaluationBlock(block,[valid,question('replacement','step_1:kp:2')],teaching,'quick_test')
assert.equal(repaired.code,'EVALUATION_COMPLETE')
assert.equal(repaired.requiredReplacementCount,0)

const events:string[]=[]
async function main(){
  const emptyRepair=await runSessionPreparationFactory({sessionKind:'learning',generationKey:'empty-repair-contract',evalPreference:'quick_test',load:async()=>null,persist:async()=>{},generateTeaching:async()=>teaching,planEvaluations:async()=>({blocks:[block]}),generateEvaluationBlock:async()=>({...block,questions:[valid,invalid]}),repairEvaluationBlock:async()=>[],telemetry:event=>events.push(event)})
  assert.equal(emptyRepair.preparationStatus,'technical_retry_required')
  assert.ok(events.includes('incremental_evaluation_repair_empty'))
  assert.ok(events.includes('incremental_evaluation_repair_failed'))
  assert.ok(!events.includes('incremental_evaluation_repair_succeeded'))
  const partialEvents:string[]=[]
  const repairedState=await runSessionPreparationFactory({sessionKind:'learning',generationKey:'partial-block-contract',evalPreference:'quick_test',load:async()=>null,persist:async()=>{},generateTeaching:async()=>teaching,planEvaluations:async()=>({blocks:[block]}),generateEvaluationBlock:async()=>({...block,questions:[valid]}),repairEvaluationBlock:async()=>[question('replacement','step_1:kp:2')],telemetry:event=>partialEvents.push(event)})
  assert.equal(repairedState.preparationStatus,'ready')
  assert.ok(partialEvents.includes('evaluation_block_generation_partial'))
  assert.ok(!partialEvents.includes('evaluation_block_generation_succeeded'))
  assert.ok(!partialEvents.includes('session_preparation_ready'),'ready belongs after route canonicalization')
  const raw={steps:teaching.steps.map(step=>({...step,id:step.stepId})),evaluationBlocks:[{id:block.blockId,...block,coveredKeyPoints:teaching.steps[0].keyPoints,questions:[{...valid,id:valid.questionId,type:valid.format,coveredStepIds:valid.targetStepIds,coveredKeyPoints:['Pasión'],targetKeyPointIds:['step_1:kp:1'],questionText:valid.prompt,explanation:valid.feedback,targetDimension:valid.cognitiveTarget}]}]}
  const canonical=canonicalizeGeneratedSession(raw,{sessionId:'chapter_2',kind:'learning',evaluationMode:'quick_test'})
  assert.equal(canonical.session,null)
  assert.ok(canonical.errors.some(error=>error.includes('step_1:kp:2')))
  assert.ok(!canonical.errors.some(error=>error.includes('missing=Resiliencia')))
  console.log('evaluation-block-migration-repair-contracts: PASS')
}
main().catch(error=>{console.error(error);process.exitCode=1})
