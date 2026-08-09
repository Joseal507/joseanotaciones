export type TeachingStepType='intro'|'concept'|'example'|'connection'|'formula'|'recap'|'closing'
export interface TeachingKeyPoint { id:string; text:string }
export interface TeachingContentStep { id:string;type:TeachingStepType;title:string;content:unknown;keyPoints:TeachingKeyPoint[];microId:string;importance:'supporting'|'important'|'critical';cognitiveTarget:'recognition'|'comprehension'|'application'|'analysis';relatedBlockIds:string[];factKeys:string[];sourceReferences:unknown[] }
export interface TeachingContent { sessionIntro:string;steps:TeachingContentStep[];closing:string }
export type TeachingParseResult={success:true;value:TeachingContent}|{success:false;errorCode:'TEACHING_SCHEMA_INVALID'|'TEACHING_CONTRACT_EXTRA_FIELDS';validationErrors:string[];extraFields:string[]}

const object=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null
const strings=(value:unknown):string[]=>Array.isArray(value)?value.map(String).map(item=>item.trim()).filter(Boolean):[]
const allowedRoot=new Set(['sessionIntro','steps','closing'])
const allowedStep=new Set(['id','type','title','content','keyPoints','microId','importance','cognitiveTarget','relatedBlockIds','factKeys','sourceReferences'])
const stepTypes=new Set(['intro','concept','example','connection','formula','recap','closing'])
const importances=new Set(['supporting','important','critical'])
const targets=new Set(['recognition','comprehension','application','analysis'])

export function parseTeachingContent(value:unknown):TeachingParseResult{
  const source=object(value);if(!source)return{success:false,errorCode:'TEACHING_SCHEMA_INVALID',validationErrors:['root_object_required'],extraFields:[]}
  const extraFields=Object.keys(source).filter(key=>!allowedRoot.has(key));const errors:string[]=[]
  if(typeof source.sessionIntro!=='string')errors.push('sessionIntro_required')
  if(typeof source.closing!=='string')errors.push('closing_required')
  const rawSteps=Array.isArray(source.steps)?source.steps:[];if(!rawSteps.length)errors.push('steps_required')
  const steps:TeachingContentStep[]=[]
  rawSteps.forEach((raw,index)=>{const step=object(raw);if(!step){errors.push(`step_${index+1}_object_required`);return}const stepExtra=Object.keys(step).filter(key=>!allowedStep.has(key));extraFields.push(...stepExtra.map(key=>`steps.${index}.${key}`));const id=String(step.id||'').trim();const type=String(step.type||'');const title=String(step.title||'').trim();const microId=String(step.microId||'').trim();const importance=String(step.importance||'');const cognitiveTarget=String(step.cognitiveTarget||'');const keyPoints=Array.isArray(step.keyPoints)?step.keyPoints.map((rawPoint,pointIndex)=>{const point=object(rawPoint);return{id:String(point?.id||'').trim(),text:String(point?.text||'').trim(),pointIndex}}):[];if(!id)errors.push(`step_${index+1}_id_required`);if(!stepTypes.has(type))errors.push(`step_${index+1}_type_invalid`);if(!title)errors.push(`step_${index+1}_title_required`);if(typeof step.content!=='string'&&!object(step.content))errors.push(`step_${index+1}_content_invalid`);if(!keyPoints.length||keyPoints.some(point=>!point.id||!point.text))errors.push(`step_${index+1}_keyPoints_invalid`);if(keyPoints.some(point=>point.id!==`${id}:kp:${point.pointIndex+1}`))errors.push(`step_${index+1}_keyPoint_id_invalid`);if(!microId)errors.push(`step_${index+1}_microId_required`);if(!importances.has(importance))errors.push(`step_${index+1}_importance_invalid`);if(!targets.has(cognitiveTarget))errors.push(`step_${index+1}_cognitiveTarget_invalid`);const factKeys=strings(step.factKeys);if(!factKeys.length)errors.push(`step_${index+1}_factKeys_required`);steps.push({id,type:type as TeachingStepType,title,content:step.content,keyPoints:keyPoints.map(({id:pointId,text})=>({id:pointId,text})),microId,importance:importance as TeachingContentStep['importance'],cognitiveTarget:cognitiveTarget as TeachingContentStep['cognitiveTarget'],relatedBlockIds:strings(step.relatedBlockIds),factKeys,sourceReferences:Array.isArray(step.sourceReferences)?step.sourceReferences:[]})})
  if(extraFields.length)return{success:false,errorCode:'TEACHING_CONTRACT_EXTRA_FIELDS',validationErrors:['extra_fields_forbidden'],extraFields:[...new Set(extraFields)]}
  if(errors.length)return{success:false,errorCode:'TEACHING_SCHEMA_INVALID',validationErrors:[...new Set(errors)],extraFields:[]}
  return{success:true,value:{sessionIntro:source.sessionIntro as string,steps,closing:source.closing as string}}
}

export function teachingResponseDiagnostics(raw:string){const trimmed=raw.trim();const detectedFence=/^```(?:json)?/i.test(trimmed);const unfenced=trimmed.replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim();let parsed:unknown=null;try{parsed=JSON.parse(unfenced)}catch{}const source=object(parsed);const extraFields=source?Object.keys(source).filter(key=>!allowedRoot.has(key)):[];const opens=(unfenced.match(/[\[{]/g)||[]).length;const closes=(unfenced.match(/[\]}]/g)||[]).length;const appearsTruncated=!parsed&&(opens>closes||/[:,\[{]\s*$/.test(unfenced)||detectedFence&&!/```\s*$/.test(trimmed));return{length:raw.length,first500:raw.slice(0,500),last500:raw.slice(-500),detectedFence,appearsTruncated,lastValidToken:(unfenced.match(/[^\s]/g)||[]).at(-1)||'',extraFields,parsed}}
