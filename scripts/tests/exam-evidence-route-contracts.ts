import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST, __routeDeps, authorSlotQuestion } from '../../app/api/alai-studyal-exam/route'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { buildExamEnjoyerUniverse, composeEnjoyerExamBlueprint } from '../../lib/materialBrain/examEnjoyerContext'
import { InMemoryExamGenerationStore, examGenerationIdentity } from '../../lib/materialBrain/examGenerationStore'
import { MemoryExamGradingStore } from '../../lib/materialBrain/examGrading'
const selection=buildSourceSelectionSnapshot(['source'],{source:[1]})
// Literal canonical notation: no external chemistry calculation or correction.
const truths=[String.raw`N₂O₄(g) ⇌ 2NO₂(g), Kc=0.212 a 100 °C; inversa Kc≈4.72; reacción duplicada Kc².`,String.raw`vf=kf[N₂O₄], vr=kr[NO₂]²; en equilibrio vf=vr.`,String.raw`Kp=Kc(RT)^Δn.`,String.raw`Q=K: equilibrio; Q>K: izquierda; Q<K: derecha.`,String.raw`El catalizador cambia la velocidad, no la composición de equilibrio.`,String.raw`Kc=[HI]^2/([H2][I2])≈50.5/51, con I₂(s), según este ejemplo canónico.`]
const payload={sourceSelectionFingerprint:selection.fingerprint,materialIds:['source'],selectedPages:selection.selectedPages,materialLanguage:'es',topicsIndex:[{id:'t',title:'Equilibrio'}],uniqueConceptsIndex:[],globalOrderedAnalysis:truths.map((content,i)=>({id:`t${i}`,name:`Concepto ${i}`,content,kind:'concept',importance:90,bloomLevel:'understand',examTypes:['short_answer'],topicId:'t',materialId:'source',pages:[1],sourceSpans:[{page:1,quote:content}],dependsOn:i===1?['t0']:[]}))}
async function main(){
 const universe=buildExamEnjoyerUniverse(payload,selection)
 const blueprint=composeEnjoyerExamBlueprint(universe,90,'route-evidence','route-evidence')
 const questions=blueprint.slots.map(slot=>authorSlotQuestion('route-evidence',blueprint,slot,{type:slot.type,prompt:`Describe ${slot.assessmentFocus}.`,parts:slot.assessmentCriteria?.map(c=>({criterionId:c.criterionId,prompt:`Explica el significado de ${c.label}.`}))})!)
 assert.ok(questions.every(Boolean))
 questions.forEach((q,index)=>{assert.deepEqual(q.assessmentCriteria,blueprint.slots[index].assessmentCriteria);assert.equal(q.points,q.assessmentCriteria!.reduce((sum,c)=>sum+c.points,0))})
 for(const text of truths)assert.ok(questions.some(q=>q.assessmentCriteria?.some(c=>c.canonicalCriterion===text)))
 const store=new InMemoryExamGenerationStore<typeof questions[number]>()
 const identity=examGenerationIdentity('session',selection.fingerprint,'route-evidence')
 await store.saveManifest(identity,{schemaVersion:2,identity,examId:'route-evidence',fingerprint:selection.fingerprint,sessionId:'session',blueprint,totalSlots:questions.length,status:'ready',slots:Object.fromEntries(questions.map(q=>[q.id,{status:'ready',attempts:1,questionId:q.id}])),providerAttemptsBudget:20,providerAttemptsUsed:2,createdAt:'',updatedAt:''})
 await store.saveArtifact(identity,{examId:'route-evidence',fingerprint:selection.fingerprint,meta:{status:'ready',generatedAt:''},questions})
 let calls=0
 Object.assign(__routeDeps,{examStore:store,gradingStore:new MemoryExamGradingStore(),getServerSession:async()=>({user:{id:'user'}}),getAuthoritativeFreeSession:async()=>({id:'session',userId:'user',sourceSelection:selection}),generateValidatedLegacyJson:async({prompt,beforeProviderAttempt}:{prompt:string;beforeProviderAttempt:()=>Promise<void>})=>{
  await beforeProviderAttempt();calls++
  const work=JSON.parse(prompt.slice(prompt.indexOf('\n')+1)) as Array<{criterion:{criterionId:string;targetIds:string[];canonicalCriterion:string}}>
  return {judgments:work.map(({criterion})=>({criterionId:criterion.criterionId,scorePercent:criterion.targetIds.includes('exam_target:t1')?0:100,status:criterion.targetIds.includes('exam_target:t1')?'incorrect':'correct',feedback:'Criterio evaluado.'}))}
 }})
 const post=async(body:object)=>{const response=await POST(new NextRequest('http://localhost/api/alai-studyal-exam',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:'session',examId:'route-evidence',...body})}));return {status:response.status,data:await response.json()}}
 const publicExam=(await post({mode:'advance'})).data.exam
 assert.equal(calls,0)
 for(const q of publicExam.questions)for(const key of ['assessmentCriteria','expectedAnswer','rubricHints','correctAnswer','pairs','matchingCorrectMap'])assert.ok(!(key in q))
 const answers=questions.map(q=>q.assessmentCriteria?.some(c=>c.targetIds.includes('exam_target:t5'))?'':'Respuesta del estudiante')
 let graded=await post({mode:'evaluate',answers})
 if(graded.status===409){assert.equal(graded.data.partialEvaluation.score,null);assert.equal(graded.data.partialEvaluation.canContinue,true);graded=await post({mode:'evaluate',answers})}
 assert.equal(graded.status,200,JSON.stringify(graded.data))
 const result=graded.data.evaluation
 assert.equal(result.targetEvidence.find((t:{targetId:string})=>t.targetId==='exam_target:t0').scorePercent,100)
 assert.equal(result.targetEvidence.find((t:{targetId:string})=>t.targetId==='exam_target:t1').scorePercent,0)
 assert.equal(result.targetEvidence.filter((t:{targetId:string})=>t.targetId==='exam_target:t0').length,1)
 const integrated=questions.find(q=>q.assessmentCriteria!.length===2)!
 const row=result.perQuestion[questions.indexOf(integrated)]
 assert.equal(row.partialScore,50,'integrated question independently awards its two criteria')
 assert.equal(result.skillScores.explanation,null)
 assert.ok(result.criterionResults.some((c:{status:string})=>c.status==='unanswered'))
 const before=calls
 assert.deepEqual((await post({mode:'evaluate',answers})).data.evaluation,result)
 assert.equal(calls,before)
 assert.equal((await post({mode:'evaluate',answers:questions.map(()=> 'changed')})).status,409)
 console.log('exam-evidence-route-contracts: route/criteria/canonical/privacy/reopen/frozen-points PASS; zero live calls')
}
main().catch(error=>{console.error(error);process.exitCode=1})
