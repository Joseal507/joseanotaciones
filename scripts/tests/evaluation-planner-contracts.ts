import assert from 'node:assert/strict'
import { buildDeterministicEvaluationPlan, validateEvaluationPlan, mergeEvaluationPlanEnrichment, type PreparedTeachingContent } from '../../lib/ai/sessionPreparationFactory'

const teaching=(count:number):PreparedTeachingContent=>({sessionId:'chapter_2',title:'Falcons',introduction:'',closing:'',steps:Array.from({length:count},(_,index)=>{const n=index+1;return{stepId:`step_${n}`,id:`step_${n}`,microId:`micro_${Math.ceil(n/3)}`,title:`Paso ${n}`,type:'concept',content:'Contenido',keyPoints:[`Punto ${n}`],keyPointIds:[`step_${n}:kp:1`],factKeys:[`fact_${n}`],importance:n%4===0?'critical':'important',cognitiveTarget:n%3===0?'application':'comprehension',sourceReferences:[]}})})

const fourteen=teaching(14)
const plan=buildDeterministicEvaluationPlan(fourteen,{evalPreference:'quick_test',maxStepsPerBlock:4,minStepsPerBlock:2})
assert.deepEqual(validateEvaluationPlan(fourteen,plan),[])
assert.deepEqual([...new Set(plan.blocks.flatMap(block=>block.coveredStepIds))],fourteen.steps.map(step=>step.stepId))
for(const block of plan.blocks)assert.equal(block.afterStepId,block.coveredStepIds.at(-1))
assert.ok(plan.blocks.some(block=>block.coveredStepIds.includes('step_11')))
assert.equal(validateEvaluationPlan(teaching(11),{blocks:[{...buildDeterministicEvaluationPlan(teaching(11),{evalPreference:'quick_test'}).blocks[0],afterStepId:'step_3',coveredStepIds:['step_11']}]}).some(error=>error.includes('FUTURE_STEP')),true)
assert.ok(plan.blocks.some(block=>block.coveredStepIds.length>1),'related consecutive steps must be grouped')

const first=plan.blocks[0]
const merged=mergeEvaluationPlanEnrichment(first,{blockId:first.blockId,coveredStepIds:['invented'],afterStepId:'step_1',recommendedQuestionCount:4,recommendedFormats:['matching'],difficulty:'hard'})
assert.deepEqual(merged.coveredStepIds,first.coveredStepIds)
assert.equal(merged.afterStepId,first.afterStepId)
assert.equal(merged.recommendedQuestionCount,4)
assert.equal(merged.recommendedFormats[0],'matching')

console.log('evaluation-planner-contracts: PASS')
