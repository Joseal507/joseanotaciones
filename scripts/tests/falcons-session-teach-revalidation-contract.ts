import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { POST } from '../../app/api/adaptive/session-teach/route'
import type { EvaluationPlan, PreparedEvaluationBlock, PreparedEvaluationQuestion, PreparedTeachingContent, SessionPreparationState } from '../../lib/ai/sessionPreparationFactory'

const hash = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24)
const teaching:PreparedTeachingContent={sessionId:'chapter_2',title:'Falcons',introduction:'Continúa con el contenido ya preparado.',closing:'Cierre.',steps:[{stepId:'step_1',id:'step_1',microId:'falcons_identity',title:'Identidad y grandeza',type:'concept',content:'Los jugadores icónicos y la conexión con la afición son criterios del argumento sobre la grandeza del equipo.',keyPoints:['Identidad de los Falcons','Jugadores y afición'],keyPointIds:['step_1:kp:1','step_1:kp:2'],factKeys:['falcons:identity','falcons:players_fans'],importance:'important',cognitiveTarget:'comprehension',sourceReferences:[]}]}
const plan:EvaluationPlan={blocks:[{blockId:'chapter_2:evaluation:1',afterStepId:'step_1',coveredStepIds:['step_1'],coveredKeyPointIds:['step_1:kp:1','step_1:kp:2'],coveredFactKeys:['falcons:identity','falcons:players_fans'],targetObjectiveIds:['step_1:objective:comprehension'],cognitiveTargets:['comprehension'],recommendedQuestionCount:2,recommendedFormats:['true_false'],difficulty:'medium'}]}
const question=(questionId:string,keyPointId:string,factKey:string,prompt:string):PreparedEvaluationQuestion=>({questionId,blockId:plan.blocks[0].blockId,targetStepIds:['step_1'],targetKeyPointIds:[keyPointId],targetFactKeys:[factKey],targetObjectiveIds:['step_1:objective:comprehension'],cognitiveTarget:'comprehension',format:'true_false',prompt,correctAnswer:true,feedback:'Correcto según el material.',difficulty:'medium'})
const questions=[
  question('source_q_1','step_1:kp:1','falcons:identity','La identidad de los Falcons forma parte del argumento central.'),
  question('source_q_2','step_1:kp:2','falcons:players_fans','Los jugadores icónicos y la conexión con la afición son criterios clave para determinar la grandeza de un equipo deportivo.'),
]
const teachingHash=hash(teaching);const evaluationPlanHash=hash(plan)
const block:PreparedEvaluationBlock={...plan.blocks[0],questions,sessionId:'chapter_2',teachingHash,evaluationPlanHash,evalPreference:'quick_test',generatorVersion:'evaluation-block-v2'}
const preparationState:SessionPreparationState={preparationStatus:'technical_retry_required',currentGenerationStage:'session_assembly_validation',generationKey:'persisted-falcons',teachingContent:teaching,teachingVersion:'teaching-v1',teachingHash,evaluationPlan:plan,evaluationPlanHash,generatedEvaluationBlocks:[block],acceptedQuestions:questions,missingCoverage:{code:'EVALUATION_COMPLETE',missingRequiredStepIds:[],missingCriticalKeyPoints:[],missingImportantKeyPoints:[],invalidQuestionIds:[],duplicateQuestionIds:[],affectedBlockIds:[]},generationAttempts:{teaching:1,planning:1,'block:chapter_2:evaluation:1':1},preparationVersion:'session-preparation-v2',evaluationPlannerVersion:'deterministic-planner-v3',evaluationBlockGeneratorVersion:'evaluation-block-v2',evalPreference:'quick_test',sessionKind:'learning',lastTechnicalError:'SESSION_PREPARATION_VALIDATION_FAILED'}

const body={userId:'falcons-real-run',materialHash:'mat_1786030926099qn7cx2',planVersion:'journey_mshoqk7j',session:{id:'chapter_2',chapterNumber:2,title:'Falcons',objective:'Comprender identidad, jugadores y afición.',topicIds:['falcons'],blockIds:['falcons_identity'],concepts:['Falcons'],pages:[],kind:'learning' as const},blueprint:{version:1,topics:[{id:'falcons',title:'Atlanta Falcons',description:'Historia, identidad cultural y argumentos deportivos'}],blocks:[{id:'falcons_identity',label:'Falcons - fundado en 1965 y Super Bowl LI',summary:'Jugadores icónicos, afición e identidad determinan la grandeza del equipo deportivo.',kind:'concept',importance:100}]},setup:{knowledgeLevel:'beginner',examDateType:'no_date',evalPreference:'quick_test'},materialTitle:'Atlanta Falcons',totalSessions:4,preparationState}
async function main(){
  const events:string[]=[];const originalInfo=console.info;const originalError=console.error
  console.info=(...args:unknown[])=>{events.push(args.map(String).join(' '))};console.error=(...args:unknown[])=>{events.push(args.map(String).join(' '))}
  let response:Response
  try { response=await POST(new NextRequest('http://localhost/api/adaptive/session-teach',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})) } finally { console.info=originalInfo;console.error=originalError }
  const payload=await response.json()
  assert.equal(response.status,200,JSON.stringify(payload))
  assert.equal(payload.classContent.academicDomain,'general_conceptual')
  const eval12=payload.classContent.evaluationBlocks.flatMap((item:{questions:unknown[]})=>item.questions).find((item:{id:string})=>item.id==='eval_1_2')
  assert(eval12);assert.equal(eval12.requiresNumericData,false);assert.ok(eval12.coveredKeyPointIds.includes('step_1:kp:2'))
  for(const expected of ['academic_domain_resolved','teaching_regeneration_prevented','plan_regeneration_prevented','evaluation_question_revalidated','evaluation_coverage_validated','session_assembly_validated','session_preparation_ready'])assert.ok(events.some(line=>line.includes(expected)),`missing event ${expected}`)
  assert.ok(events.some(line=>line.includes('evaluation_question_revalidated')&&line.includes('eval_1_2')&&line.includes('"requiresNumericData":false')&&line.includes('"valid":true')))
  assert.ok(events.some(line=>line.includes('session_preparation_ready')&&line.includes('"remoteCallNumber":0')))
  assert.ok(!events.some(line=>/insufficient_numeric_data|missing=step_1:kp:2|session_teach_503/.test(line)))
  console.log('falcons-session-teach-revalidation-contract: POST 200, eval_1_2 restored, remoteCalls=0 PASS')
}
main().catch(error=>{console.error(error);process.exitCode=1})
