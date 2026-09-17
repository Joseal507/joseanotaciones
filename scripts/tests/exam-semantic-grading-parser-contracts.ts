import assert from 'node:assert/strict'
import { safeParseJson } from '../../lib/alai'
import { runGenerationPipeline } from '../../lib/ai/generationPipeline'
import { reconcileExamJudgments, type GradingWork } from '../../lib/materialBrain/examGrading'
const work:GradingWork[]=[{questionId:'q1',prompt:'Explain',answer:'Answer',criterion:{criterionId:'c1',targetIds:['t1'],canonicalCriterion:'Canonical',gradingMode:'semantic',operation:'interpret',points:1,skill:'comprehension',label:'Concept',sourceItemId:'s1',pages:[1],materialId:'m'}}]
async function run(raw:string){
 let calls=0
 const result=await runGenerationPipeline<unknown>({taskType:'final_exam',failurePath:'single_repair',generate:async()=>{
  calls++;const value=safeParseJson(raw);if(value===null)throw Error('INVALID_JSON');return {value}
 },validate:()=>({valid:true,errors:[]})})
 return {result,calls}
}
async function main(){
 const valid={judgments:[{criterionId:'c1',scorePercent:80,status:'correct',feedback:'Evidence'}]}
 for(const text of [JSON.stringify(valid),'```json\n'+JSON.stringify(valid)+'\n```']){
  const {result,calls}=await run(text);assert.equal(calls,1);assert.equal(result.status,'validated')
  assert.equal(reconcileExamJudgments(work,result.content).accepted.length,1)
 }
 const malformed=await run('not JSON at all')
 assert.equal(malformed.result.status,'budget_exhausted');assert.equal(malformed.calls,2)
 const unknown=await run(JSON.stringify({judgments:[...valid.judgments,{criterionId:'unknown',scorePercent:80,status:'correct',feedback:'x'}]}))
 assert.equal(unknown.calls,1,'unknown siblings do not trigger full response repair')
 const reconciled=reconcileExamJudgments(work,unknown.result.content)
 assert.equal(reconciled.accepted.length,1);assert.ok(reconciled.diagnostics.includes('unknown_ids'))
 const truncated=await run('{"judgments":[{"criterionId":"c1","scorePercent":80,')
 assert.equal(reconcileExamJudgments(work,truncated.result.content).accepted.length,0,'repaired/truncated object cannot invent missing judgment fields')
 console.log('exam-semantic-grading-parser-contracts: 5 parser/reconciliation cases PASS')
}
main().catch(error=>{console.error(error);process.exitCode=1})
