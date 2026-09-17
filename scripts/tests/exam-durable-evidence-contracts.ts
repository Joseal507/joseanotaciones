import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { advanceExamGrading, MemoryExamGradingStore, gradingIdentity, reconcileExamJudgments, examGradingTokens, type ExamGradingJob, type GradingWork } from '../../lib/materialBrain/examGrading'
import { buildExamEnjoyerUniverse, composeEnjoyerExamBlueprint } from '../../lib/materialBrain/examEnjoyerContext'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { authorSlotQuestion } from '../../app/api/alai-studyal-exam/route'
const selection = buildSourceSelectionSnapshot(['m'], { m: [1] })
const items = Array.from({length:51}, (_,i)=>({ id:`t${i}`,name:`Concept ${i}`,content:`Canonical complete statement ${i}.`,kind:'concept',importance:90,examTypes:['short_answer'],bloomLevel:'understand',topicId:'topic',materialId:'m',pages:[1],sourceSpans:[{page:1,quote:`Canonical complete statement ${i}.`}],dependsOn:i%2 ? [`t${i-1}`] : [] }))
const payload = {sourceSelectionFingerprint:selection.fingerprint,materialIds:['m'],selectedPages:selection.selectedPages,globalOrderedAnalysis:items,uniqueConceptsIndex:[],topicsIndex:[{id:'topic',title:'Topic'}],materialLanguage:'en'}
const universe=buildExamEnjoyerUniverse(payload,selection)
const blue=composeEnjoyerExamBlueprint(universe,90,'exam','seed')
const work:GradingWork[]=Array.from({length:29},(_,i)=>({criterion:{criterionId:`c${i}`,targetIds:[`t${i}`],operation:'interpret',canonicalCriterion:`Canonical ${i}`,gradingMode:'semantic',points:1,skill:'comprehension',label:`Target ${i}`,sourceItemId:`t${i}`,pages:[1],materialId:'m'},questionId:`q${i}`,prompt:`Explain ${i}`,answer:`Student answer ${i}`}))
const initial=():ExamGradingJob=>({version:1,identity:gradingIdentity('user','exam'),userId:'user',examId:'exam',answersHash:'answers',results:{},work,attempts:{},callsUsed:0,callBudget:58,status:'pending',claim:null,diagnostics:[]})
const verdict=(id:string)=>({criterionId:id,scorePercent:100,status:'correct',feedback:'Evidence accepted'})
let count=0
async function test(name:string,fn:()=>unknown|Promise<unknown>){await fn();console.log(`PASS ${++count}: ${name}`)}
async function main(){
await test('authorized dependsOn survives; aliases resolve and unauthorized endpoints are excluded',()=>{
 assert.equal(universe.relations.length,25)
 const aliased=buildExamEnjoyerUniverse({...payload,globalOrderedAnalysis:[items[0],{...items[0],id:'alias'},{...items[1],dependsOn:['alias','outside']}]},selection)
 assert.equal(aliased.relations.length,1);assert.equal(aliased.relations[0].toSourceItemId,'t0')
})
await test('all durations scope honestly, preserve relationships and account for every target',()=>{
 for(const duration of [15,30,45,60,90]){
  const b=composeEnjoyerExamBlueprint(universe,duration,'exam','seed')
  assert.ok(b.slots.length);assert.ok(b.expectedCompletionSeconds<=duration*60*.85)
  assert.equal(b.coverage.consideredTargetIds?.length,51)
  assert.equal(new Set([...b.coverage.assessedTargetIds,...b.coverage.contextOnlyTargetIds,...b.coverage.notAssessedDueToScopeTargetIds]).size,51)
  assert.deepEqual(b.coverage.sufficientEvidenceTargetIds,[])
  for(const slot of b.slots.filter(s=>s.assessedTargetIds.length>1)){
   assert.equal(slot.assessmentCriteria?.length,slot.assessedTargetIds.length)
   assert.ok(universe.relations.some(r=>slot.sourceItemIds.includes(r.fromSourceItemId)&&slot.sourceItemIds.includes(r.toSourceItemId)))
  }
 }
 assert.ok(composeEnjoyerExamBlueprint(universe,15,'e','s').coverage.assessedTargetIds.length<51)
 assert.ok(blue.slots.some(slot=>slot.assessmentCriteria!.length>1))
 const ids=blue.slots.flatMap(slot=>slot.assessmentCriteria!.flatMap(c=>c.targetIds))
 assert.ok(ids.length>new Set(ids).size,'long duration adds independent evidence')
})
await test('generic missing-case application cannot become ready',()=>{
 const slot={...blue.slots[0],cognitiveOperation:'use' as const,skill:'application' as const}
 assert.equal(authorSlotQuestion('exam',blue,slot,{type:slot.type,prompt:'Aplica los principios del tema para determinar el resultado y muestra el procedimiento.'}),null)
 assert.equal(authorSlotQuestion('exam',blue,slot,{type:slot.type,prompt:''}),null)
})
await test('29 open criteria grade in five bounded batches, reserving before calls',async()=>{
 const store=new MemoryExamGradingStore();let calls=0
 const job=await advanceExamGrading(store,initial(),async(batch,reserve)=>{
  assert.ok(batch.length<=6);assert.ok(examGradingTokens(batch.length)>=batch.length*300)
  await reserve();calls++;assert.equal((await store.read(initial().identity))!.job.callsUsed,calls)
  return {judgments:batch.map(w=>verdict(w.criterion.criterionId))}
 })
 assert.equal(calls,5);assert.equal(job.status,'completed');assert.equal(Object.keys(job.results).length,29)
 await advanceExamGrading(store,initial(),async()=>{throw Error('completed must not call')})
})
await test('HTTP policy commits one batch and resumes 29 criteria across five requests',async()=>{
 const store=new MemoryExamGradingStore();let calls=0;let job:ExamGradingJob
 for(let request=0;request<5;request++){
  const before=calls
  job=await advanceExamGrading(store,initial(),async(batch,reserve)=>{await reserve();calls++;return {judgments:batch.map(w=>verdict(w.criterion.criterionId))}},{maxBatches:1})
  assert.equal(calls-before,1)
  assert.equal(Object.keys(job.results).length,Math.min((request+1)*6,29))
 }
 assert.equal(job!.status,'completed')
})
await test('duplicate, unknown, malformed and missing siblings preserve valid judgments',()=>{
 const result=reconcileExamJudgments(work.slice(0,6),{judgments:[verdict('c0'),verdict('c1'),verdict('c1'),verdict('unknown'),{...verdict('c2'),scorePercent:'100'},verdict('c3')]})
 assert.deepEqual(result.accepted.map(r=>r.criterionId),['c0','c3'])
 for(const code of ['duplicate_ids','unknown_ids','malformed_judgment','missing_expected_ids'])assert.ok(result.diagnostics.includes(code))
})
await test('partial work survives request failure and a new worker resumes missing only',async()=>{
 const store=new MemoryExamGradingStore();let calls=0
 const first=await advanceExamGrading(store,initial(),async(batch,reserve)=>{await reserve();calls++;if(calls===2)throw Error('network');return {judgments:batch.map(w=>verdict(w.criterion.criterionId))}})
 assert.equal(Object.keys(first.results).length,6);assert.equal(first.status,'grading_incomplete')
 const resumed=await advanceExamGrading({read:id=>store.read(id),cas:(id,rev,job)=>store.cas(id,rev,job)},initial(),async(batch,reserve)=>{
  assert.ok(batch.every(w=>!first.results[w.criterion.criterionId]));await reserve();return {judgments:batch.map(w=>verdict(w.criterion.criterionId))}
 })
 assert.equal(resumed.status,'completed')
 await assert.rejects(advanceExamGrading(store,{...initial(),answersHash:'changed'},async()=>({})),/IMMUTABLE/)
})
await test('two worker instances cannot claim the same batch',async()=>{
 const store=new MemoryExamGradingStore();let calls=0;let release!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve})
 const first=advanceExamGrading(store,{...initial(),work:work.slice(0,1)},async(batch,reserve)=>{await reserve();calls++;await gate;return {judgments:batch.map(w=>verdict(w.criterion.criterionId))}})
 while(!calls)await new Promise(resolve=>setTimeout(resolve,1))
 await advanceExamGrading({read:id=>store.read(id),cas:(id,rev,job)=>store.cas(id,rev,job)},{...initial(),work:work.slice(0,1)},async()=>{calls++;return {}})
 assert.equal(calls,1);release();assert.equal((await first).status,'completed')
})
await test('exhaustion is incomplete with no fabricated zero judgments',async()=>{
 const store=new MemoryExamGradingStore();let calls=0
 const init={...initial(),work:work.slice(0,2),callBudget:2}
 const job=await advanceExamGrading(store,init,async(_,reserve)=>{await reserve();calls++;return {judgments:[]}})
 assert.equal(calls,2);assert.equal(job.status,'grading_incomplete');assert.deepEqual(job.results,{})
 const again=await advanceExamGrading(store,init,async()=>{throw Error('exhausted must not call')})
 assert.ok(again.diagnostics.includes('budget_exhausted'))
})
await test('Exam math uses the existing renderer and incomplete results do not become scores',()=>{
 const ui=readFileSync('components/materias/ALAIStudyALExams.tsx','utf8')
 for(const expr of ['q.prompt','opt','pq?.modelAnswer || formatCorrectAnswer(q)','step.detail'])assert.ok(ui.includes(`content={${expr}}`))
 const route=readFileSync('app/api/alai-studyal-exam/route.ts','utf8')
 assert.ok(route.includes("gradingStatus: 'grading_incomplete', score: null"))
 assert.ok(route.includes('rubricHints, assessmentCriteria, pairs, matchingCorrectMap, ...pub'))
 assert.ok(!route.includes("throw new Error('DURATION_INSUFFICIENT')"))
})
console.log(`exam-durable-evidence: ${count} passed`)
}
main().catch(error=>{console.error(error);process.exitCode=1})
