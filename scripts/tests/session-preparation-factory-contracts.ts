import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { diagnoseEvaluationCoverage, runSessionPreparationFactory, type PreparedTeachingContent, type EvaluationPlan, type PreparedEvaluationBlock } from '../../lib/ai/sessionPreparationFactory'

const activeRoute = readFileSync('app/api/adaptive/session-teach/route.ts','utf8')
assert.ok(activeRoute.indexOf('return await prepareSessionByFactory') < activeRoute.indexOf('runSessionContentGenerationPipeline<Record'))
assert.match(activeRoute,/teaching_generation[^]*evaluation_planning[^]*evaluation_block_generation[^]*incremental_evaluation_repair/)
assert.doesNotMatch(activeRoute.slice(0,activeRoute.indexOf('return await prepareSessionByFactory')),/SESSION_CONTENT_SPLIT_INVALID/)

const teaching: PreparedTeachingContent = { sessionId: 's1', title: 'Clase', introduction: 'Inicio', closing: 'Cierre', steps: Array.from({ length: 6 }, (_, i) => ({ stepId: `step_${i+1}`, id: `step_${i+1}`, microId: `micro_${i+1}`, title: `Paso ${i+1}`, type: 'concept', content: `Contenido ${i+1}`, keyPoints: [`Punto ${i+1}`], keyPointIds:[`kp_${i+1}`], factKeys: [`fact_${i+1}`], importance: i === 5 ? 'critical' : 'important', cognitiveTarget: 'comprehension', sourceReferences: [] })) }
const plan: EvaluationPlan = { blocks: [
  { blockId:'b1', afterStepId:'step_3', coveredStepIds:['step_1','step_2','step_3'], coveredKeyPointIds:['kp_1','kp_2','kp_3'], coveredFactKeys:['fact_1','fact_2','fact_3'], targetObjectiveIds:['o1','o2','o3'], cognitiveTargets:['comprehension'], recommendedQuestionCount:2, recommendedFormats:['multiple_choice'], difficulty:'medium' },
  { blockId:'b2', afterStepId:'step_6', coveredStepIds:['step_4','step_5','step_6'], coveredKeyPointIds:['kp_4','kp_5','kp_6'], coveredFactKeys:['fact_4','fact_5','fact_6'], targetObjectiveIds:['o4','o5','o6'], cognitiveTargets:['comprehension'], recommendedQuestionCount:2, recommendedFormats:['multiple_choice'], difficulty:'medium' },
] }
const q = (n:number, blockId:string, stepId:string): any => ({ questionId:`q${n}`, id:`q${n}`, blockId, targetStepIds:[stepId], coveredStepIds:[stepId], targetKeyPointIds:[`kp_${n}`], targetFactKeys:[`fact_${n}`], targetObjectiveIds:[`o${n}`], cognitiveTarget:'comprehension', format:'multiple_choice', prompt:`Comprueba ${stepId}`, questionText:`Comprueba ${stepId}`, options:[{id:'a',text:'A'},{id:'b',text:'B'}], correctAnswer:'a', feedback:'Explicación', explanation:'Explicación', difficulty:'medium' })
const partial: PreparedEvaluationBlock[] = [
  { ...plan.blocks[0], questions:[q(1,'b1','step_1'),q(2,'b1','step_2'),q(3,'b1','step_3')] },
  { ...plan.blocks[1], questions:[q(4,'b2','step_4'),q(5,'b2','step_5')] },
]
assert.deepEqual(diagnoseEvaluationCoverage(teaching, partial).missingRequiredStepIds, ['step_6'])
let teachingCalls=0, planningCalls=0, blockCalls=0, repairCalls=0
const run = () => runSessionPreparationFactory({ sessionKind:'learning', generationKey:'same', evalPreference:'quick_test', load:async()=>null, persist:async()=>{}, generateTeaching:async()=>{teachingCalls++;return teaching}, planEvaluations:async()=>{planningCalls++;return plan}, generateEvaluationBlock:async block=>{blockCalls++;return partial.find(x=>x.blockId===block.blockId)!}, repairEvaluationBlock:async(block,missing,accepted)=>{repairCalls++;assert.equal(block.blockId,'b2');assert.deepEqual(missing.missingRequiredStepIds,['step_6']);assert.equal(accepted.length,2);return [q(6,'b2','step_6')]} })
async function main() {
  const [result, joined] = await Promise.all([run(),run()])
  assert.equal(result.preparationStatus,'ready'); assert.equal(joined.preparationStatus,'ready')
  assert.equal(teachingCalls,1); assert.equal(planningCalls,1); assert.equal(blockCalls,2); assert.equal(repairCalls,1)
  assert.deepEqual(result.generatedEvaluationBlocks[1].questions.map(x=>x.questionId),['q4','q5','q6'])

  let introTeaching=0, introPlanning=0
  const intro = await runSessionPreparationFactory({ sessionKind:'introduction',generationKey:'intro',evalPreference:'quick_test',load:async()=>null,persist:async()=>{},generateTeaching:async()=>{introTeaching++;return teaching},planEvaluations:async()=>{introPlanning++;return plan},generateEvaluationBlock:async()=>{throw new Error('forbidden')},repairEvaluationBlock:async()=>{throw new Error('forbidden')} })
  assert.equal(intro.preparationStatus,'ready'); assert.equal(intro.generatedEvaluationBlocks.length,0); assert.equal(introTeaching,1); assert.equal(introPlanning,0)

  const finalReview = await runSessionPreparationFactory({ sessionKind:'final_review',generationKey:'final',evalPreference:'quick_test',load:async()=>null,persist:async()=>{},generateTeaching:async()=>teaching,planEvaluations:async()=>{throw new Error('forbidden')},generateEvaluationBlock:async()=>{throw new Error('forbidden')},repairEvaluationBlock:async()=>{throw new Error('forbidden')} })
  assert.equal(finalReview.preparationStatus,'ready'); assert.deepEqual(finalReview.evaluationPlan?.blocks,[])

  let durable: any = null, restoreTeachingCalls=0, failedOnce=false
  const restoreInput = () => ({ sessionKind:'learning' as const,generationKey:'restore',evalPreference:'quick_test',load:async()=>durable,persist:async(s:any)=>{durable=structuredClone(s)},generateTeaching:async()=>{restoreTeachingCalls++;return teaching},planEvaluations:async()=>plan,generateEvaluationBlock:async(block:any)=>{if(block.blockId==='b2'&&!failedOnce){failedOnce=true;throw new Error('temporary')}return partial.find(x=>x.blockId===block.blockId)!},repairEvaluationBlock:async(block:any)=>[q(6,block.blockId,'step_6')] })
  const interrupted=await runSessionPreparationFactory(restoreInput()); assert.equal(interrupted.preparationStatus,'technical_retry_required'); assert.ok(interrupted.teachingContent)
  const restored=await runSessionPreparationFactory(restoreInput()); assert.equal(restored.preparationStatus,'ready'); assert.equal(restoreTeachingCalls,1)

  const invalidPartial: PreparedEvaluationBlock[] = [{...partial[0],questions:[q(1,'b1','step_1'),q(2,'b1','step_2'),{...q(3,'b1','step_3'),targetStepIds:[]}]},partial[1]]
  const invalidDiagnosis=diagnoseEvaluationCoverage(teaching,invalidPartial); assert.deepEqual(invalidDiagnosis.invalidQuestionIds,['q3']); assert.ok(invalidDiagnosis.affectedBlockIds.includes('b1'))

  console.log('session-preparation-factory-contracts: PASS')
}
void main()
