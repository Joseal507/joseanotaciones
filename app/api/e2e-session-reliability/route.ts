import { NextRequest, NextResponse } from 'next/server'
import { buildGroundedTeachingFallback } from '../adaptive/session-teach/route'

const active=new Map<string,Promise<any>>()
const logicalCalls=new Map<string,number>()
const completed=new Map<string,any>()

function assemble(body:any){
  const teaching=buildGroundedTeachingFallback(body)
  const last=teaching.steps.at(-1)!
  const question={id:`${body.session.id}:q1`,questionId:`${body.session.id}:q1`,conceptId:last.stepId,conceptLabel:last.title,teachingBlockId:last.stepId,questionFamily:'grounded-fallback',variant:'true_false_factual',difficulty:'easy',targetDimension:'recognition',format:'true_false',questionText:`Según el material, ${last.keyPoints[0]}`,options:null,correctAnswer:true,explanation:last.keyPoints[0],hint:'Revisa el contenido grounded.',estimatedSeconds:15,evidencesNeeded:1,factKey:last.factKeys[0],factKeys:last.factKeys,coveredKeyPoints:last.keyPoints,coveredStepIds:[last.stepId]}
  return {success:true,classContent:{sessionId:teaching.sessionId,sessionTitle:teaching.title,sessionNumber:body.session.chapterNumber,sessionKind:'learning',materialType:'pdf',sessionIntro:teaching.introduction,steps:teaching.steps.map(step=>({id:step.stepId,type:step.type,title:step.title,content:step.content,keyPoint:step.keyPoints[0],keyPoints:step.keyPoints,importance:step.importance,relatedBlockIds:step.relatedBlockIds,visualSpec:step.visualSpec,visualRequirement:step.visualRequirement})),sessionClosing:teaching.closing,totalSteps:teaching.steps.length,evaluationProgress:{},recoveryQueue:[],evaluationBlocks:[{id:`${body.session.id}:evaluation:1`,afterStepId:last.stepId,coveredStepIds:[last.stepId],coveredKeyPoints:last.keyPoints,questions:[question]}],preparationState:{preparationStatus:'ready',readiness:'READY',generationKey:body.generationKey||body.session.id}},_e2e:{providerAttempts:body.session.chapterNumber===3?2:1,logicalPreparationCalls:logicalCalls.get(body.generationKey||body.session.id)||1,usedGroundedFallback:body.session.chapterNumber===3}}
}

export async function POST(request:NextRequest){
  if(process.env.NODE_ENV==='production')return NextResponse.json({error:'Not found'},{status:404})
  const body=await request.json();const key=String(body.generationKey||`${body.userId||'anon'}::${body.session.id}::${body.materialHash||''}::${body.planVersion||''}`)
  const ready=completed.get(key);if(ready)return NextResponse.json(ready)
  const existing=active.get(key);if(existing)return NextResponse.json(await existing)
  logicalCalls.set(key,(logicalCalls.get(key)||0)+1)
  const operation=new Promise(resolve=>setTimeout(()=>{const result=assemble({...body,generationKey:key});completed.set(key,result);resolve(result)},700)).finally(()=>active.delete(key));active.set(key,operation)
  return NextResponse.json(await operation)
}

export async function GET(request:NextRequest){
  if(process.env.NODE_ENV==='production')return NextResponse.json({error:'Not found'},{status:404})
  const key=request.nextUrl.searchParams.get('key')||''
  return NextResponse.json({logicalPreparationCalls:logicalCalls.get(key)||0})
}
