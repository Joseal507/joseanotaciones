import { createHash } from 'node:crypto'
import type { SessionKind } from '../adaptive/sessionKind'
import { CANONICAL_QUESTION_FORMATS, canonicalQuestionFormat } from '../adaptive/evaluation/questionFormatRegistry'
import { validateMatchingQuestion } from '../adaptive/evaluation/matchingValidator'
import { validateCognitiveFormatFit } from '../adaptive/evaluation/cognitiveFormatFitValidator'
import { questionSimilarity, type CanonicalQuestion } from '../adaptive/evaluation/questionContract'

export type SessionPreparationStatus = 'teaching_generation' | 'teaching_ready' | 'evaluation_planning' | 'evaluation_plan_ready' | 'evaluation_generation' | 'evaluation_repair' | 'ready' | 'technical_retry_required'
export type Importance = 'supporting' | 'important' | 'critical'

export interface PreparedTeachingStep {
  stepId: string; id: string; microId: string; title: string; type: string; content: unknown
  keyPoints: string[]; keyPointIds: string[]; factKeys: string[]; importance: Importance; cognitiveTarget: string
  sourceReferences: unknown[]; objectiveIds?: string[]; relatedBlockIds?: string[]
}
export interface PreparedTeachingContent { sessionId: string; title: string; introduction: string; closing: string; steps: PreparedTeachingStep[] }
export interface EvaluationPlanBlock {
  blockId: string; afterStepId: string; coveredStepIds: string[]; coveredKeyPointIds: string[]; coveredFactKeys: string[]
  targetObjectiveIds: string[]; cognitiveTargets: string[]; recommendedQuestionCount: number
  recommendedFormats: string[]; difficulty: string
}
export interface EvaluationPlan { blocks: EvaluationPlanBlock[] }
export interface PreparedEvaluationQuestion {
  questionId: string; id?: string; blockId: string; targetStepIds: string[]; coveredStepIds?: string[]
  targetKeyPointIds: string[]; targetKeyPoints?: string[]; coveredKeyPoints?: string[]; targetFactKeys: string[]; targetObjectiveIds: string[]
  cognitiveTarget: string; format: string; variant?: string; prompt: string; questionText?: string; options?: unknown
  correctAnswer: unknown; feedback: string; explanation?: string; difficulty: string
}
export interface PreparedEvaluationBlock extends EvaluationPlanBlock { questions: PreparedEvaluationQuestion[]; sessionId?:string; teachingHash?:string; evaluationPlanHash?:string; evalPreference?:string; generatorVersion?:string }
export interface EvaluationBlockDiagnosis { code:'EVALUATION_COMPLETE'|'PARTIAL_EVALUATION_COVERAGE';blockId:string;missingRequiredStepIds:string[];missingCriticalKeyPointIds:string[];missingImportantKeyPointIds:string[];invalidQuestionIds:string[];duplicateQuestionIds:string[];acceptedQuestionIds:string[];requiredReplacementCount:number }
export interface EvaluationCoverageDiagnosis {
  code: 'EVALUATION_COMPLETE' | 'PARTIAL_EVALUATION_COVERAGE'
  missingRequiredStepIds: string[]; missingCriticalKeyPoints: string[]; missingImportantKeyPoints: string[]
  invalidQuestionIds: string[]; duplicateQuestionIds: string[]; affectedBlockIds: string[]
}
export interface SessionPreparationState {
  preparationStatus: SessionPreparationStatus; currentGenerationStage: string; generationKey: string
  teachingContent?: PreparedTeachingContent; teachingVersion: string; teachingHash?: string
  evaluationPlan?: EvaluationPlan; generatedEvaluationBlocks: PreparedEvaluationBlock[]
  acceptedQuestions: PreparedEvaluationQuestion[]; missingCoverage: EvaluationCoverageDiagnosis
  generationAttempts: Record<string, number>; lastTechnicalError?: string
  preparationVersion?:string; evaluationPlannerVersion?:string; evaluationBlockGeneratorVersion?:string; evaluationPlanHash?:string; evalPreference?:string; sessionKind?:SessionKind
  lastDiagnostic?: { errorCode:string; validationErrors:string[]; unknownStepIds:string[]; unknownKeyPoints:string[]; missingStepIds:string[]; offendingBlock?: unknown; stack?: string }
}

export interface SessionPreparationFactoryInput {
  sessionKind: SessionKind; generationKey: string; evalPreference: string
  load: () => Promise<SessionPreparationState | null>; persist: (state: SessionPreparationState) => Promise<void>
  generateTeaching: (generationKey: string) => Promise<PreparedTeachingContent>
  planEvaluations: (teaching: PreparedTeachingContent, generationKey: string) => Promise<EvaluationPlan>
  generateEvaluationBlock: (block: EvaluationPlanBlock, teaching: PreparedTeachingContent, accepted: PreparedEvaluationQuestion[], generationKey: string) => Promise<PreparedEvaluationBlock>
  repairEvaluationBlock: (block: EvaluationPlanBlock, missing: EvaluationCoverageDiagnosis, accepted: PreparedEvaluationQuestion[], generationKey: string) => Promise<PreparedEvaluationQuestion[]>
  telemetry?: (event: string, payload: Record<string, unknown>) => void
}

const active = new Map<string, Promise<SessionPreparationState>>()
const emptyDiagnosis = (): EvaluationCoverageDiagnosis => ({ code:'EVALUATION_COMPLETE', missingRequiredStepIds:[], missingCriticalKeyPoints:[], missingImportantKeyPoints:[], invalidQuestionIds:[], duplicateQuestionIds:[], affectedBlockIds:[] })
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24)
const uniq = (values: string[]): string[] => [...new Set(values.filter(Boolean))]
export const EVALUATION_PLANNER_VERSION='deterministic-planner-v3'
export const EVALUATION_BLOCK_GENERATOR_VERSION='evaluation-block-v2'
const allowedEvaluationFormats=new Set<string>(CANONICAL_QUESTION_FORMATS)

export interface DeterministicEvaluationPlanOptions { maxStepsPerBlock?:number; minStepsPerBlock?:number; evalPreference:string }

function deterministicFormats(steps:PreparedTeachingStep[],preference:string):string[]{
  const targets=new Set(steps.map(step=>step.cognitiveTarget));
  const formats:string[]=[];
  if(targets.has('recognition'))formats.push('true_false','multiple_choice');
  if(targets.has('application'))formats.push('ordering','classify');
  if(targets.has('analysis'))formats.push('matching','multi_select');
  if(!formats.length)formats.push('multiple_choice','matching');
  return preference==='quick_test'?uniq(formats).filter(format=>allowedEvaluationFormats.has(format)):uniq(formats)
}

export function buildDeterministicEvaluationPlan(teaching:PreparedTeachingContent,options:DeterministicEvaluationPlanOptions):EvaluationPlan{
  const max=Math.max(2,Math.min(4,options.maxStepsPerBlock??3));
  const min=Math.max(1,Math.min(max,options.minStepsPerBlock??2));
  const groups:PreparedTeachingStep[][]=[];let current:PreparedTeachingStep[]=[];
  const flush=()=>{if(current.length){groups.push(current);current=[]}}
  for(const step of teaching.steps){
    if(step.type==='closing'&&step.importance==='supporting'){flush();continue}
    const previous=current.at(-1);const strongChange=Boolean(previous&&previous.microId!==step.microId&&previous.cognitiveTarget!==step.cognitiveTarget);
    if(current.length>=max||(current.length>=min&&strongChange))flush();
    current.push(step)
  }
  flush()
  return{blocks:groups.map((steps,index)=>{
    const coveredKeyPointIds=uniq(steps.flatMap(step=>step.keyPointIds));
    const objectiveCount=Math.max(1,coveredKeyPointIds.length);
    const recommendedQuestionCount=objectiveCount===1?2:objectiveCount<=3?Math.min(3,objectiveCount):Math.min(5,objectiveCount);
    return{blockId:`${teaching.sessionId}:evaluation:${index+1}`,afterStepId:steps.at(-1)!.stepId,coveredStepIds:steps.map(step=>step.stepId),coveredKeyPointIds,coveredFactKeys:uniq(steps.flatMap(step=>step.factKeys)),targetObjectiveIds:uniq(steps.map(step=>`${step.stepId}:objective:${step.cognitiveTarget}`)),cognitiveTargets:uniq(steps.map(step=>step.cognitiveTarget)),recommendedQuestionCount,recommendedFormats:deterministicFormats(steps,options.evalPreference),difficulty:steps.some(step=>step.importance==='critical')?'hard':'medium'}
  })}
}

export function mergeEvaluationPlanEnrichment(block:EvaluationPlanBlock,enrichment:Record<string,unknown>):EvaluationPlanBlock{
  const count=Number(enrichment.recommendedQuestionCount);const formats=Array.isArray(enrichment.recommendedFormats)?enrichment.recommendedFormats.map(String).filter(format=>allowedEvaluationFormats.has(format)):[];const difficulty=String(enrichment.difficulty||'');
  return{...block,recommendedQuestionCount:Number.isInteger(count)&&count>=1&&count<=5?Math.max(block.recommendedQuestionCount,count):block.recommendedQuestionCount,recommendedFormats:formats.length?formats:block.recommendedFormats,difficulty:['easy','medium','hard'].includes(difficulty)?difficulty:block.difficulty}
}

export function compactTeachingForEvaluation(teaching: PreparedTeachingContent) {
  return teaching.steps.map(({ stepId, microId, title, keyPoints, keyPointIds, factKeys, importance, cognitiveTarget }) => ({ stepId, microId, title, keyPoints:keyPoints.map((text,index)=>({keyPointId:keyPointIds[index],text})), factKeys, importance, cognitiveTarget }))
}

export function validateEvaluationPlan(teaching: PreparedTeachingContent, plan: EvaluationPlan): string[] {
  const errors: string[] = []; const index = new Map(teaching.steps.map((step,i)=>[step.stepId,i])); const assigned = new Set<string>();let previousAfter=-1
  const formats=allowedEvaluationFormats
  for (const block of plan.blocks) {
    const after = index.get(block.afterStepId); if (after === undefined) errors.push(`EVALUATION_PLAN_UNKNOWN_AFTER_STEP:${block.blockId}`);else{if(after<previousAfter)errors.push(`EVALUATION_PLAN_BLOCK_ORDER_INVALID:${block.blockId}`);previousAfter=after}
    if(block.coveredStepIds.at(-1)!==block.afterStepId)errors.push(`EVALUATION_PLAN_AFTER_STEP_NOT_LAST:${block.blockId}`)
    for (const id of block.coveredStepIds) { const position=index.get(id); if(position===undefined) errors.push(`EVALUATION_PLAN_UNKNOWN_STEP:${block.blockId}:${id}`); else if(after!==undefined&&position>after) errors.push(`EVALUATION_PLAN_FUTURE_STEP:${block.blockId}:${id}`); else{if(assigned.has(id))errors.push(`EVALUATION_PLAN_DUPLICATE_STEP:${block.blockId}:${id}`);assigned.add(id)} }
    const allowedPoints=new Set(teaching.steps.filter(s=>block.coveredStepIds.includes(s.stepId)).flatMap(s=>s.keyPointIds)); for(const keyPointId of block.coveredKeyPointIds)if(!allowedPoints.has(keyPointId))errors.push(`EVALUATION_PLAN_UNKNOWN_KEY_POINT:${block.blockId}:${keyPointId}`)
    const allowedFacts=new Set(teaching.steps.filter(s=>block.coveredStepIds.includes(s.stepId)).flatMap(s=>s.factKeys));for(const factKey of block.coveredFactKeys)if(!allowedFacts.has(factKey))errors.push(`EVALUATION_PLAN_UNKNOWN_FACT_KEY:${block.blockId}:${factKey}`)
    if(!block.blockId||!block.afterStepId||!block.coveredStepIds.length||!block.coveredKeyPointIds.length||!Number.isInteger(block.recommendedQuestionCount)||block.recommendedQuestionCount<1||!block.recommendedFormats.length)errors.push(`EVALUATION_PLAN_SCHEMA_INVALID:${block.blockId||'unknown'}`)
    if(block.recommendedFormats.some(format=>!formats.has(format)))errors.push(`EVALUATION_PLAN_SCHEMA_INVALID:${block.blockId}:recommendedFormats`)
  }
  for (const step of teaching.steps.filter(s=>s.importance==='important'||s.importance==='critical')) if(!assigned.has(step.stepId)) errors.push(`PARTIAL_EVALUATION_COVERAGE:${step.stepId}`)
  if(!plan.blocks.length)errors.push('EVALUATION_PLAN_SCHEMA_INVALID:blocks_required')
  const plannedPoints=new Set(plan.blocks.flatMap(block=>block.coveredKeyPointIds))
  for(const step of teaching.steps.filter(s=>s.importance==='critical'))for(const point of step.keyPointIds)if(!plannedPoints.has(point))errors.push(`PARTIAL_EVALUATION_COVERAGE:${step.stepId}:${point}`)
  for(const step of teaching.steps.filter(s=>s.importance==='important'))if(step.keyPointIds.length&&!step.keyPointIds.some(point=>plannedPoints.has(point)))errors.push(`PARTIAL_EVALUATION_COVERAGE:${step.stepId}:important_key_point`)
  return uniq(errors)
}

function signature(q: PreparedEvaluationQuestion): string { return `${q.format}|${q.targetFactKeys.slice().sort().join(',')}|${q.prompt.trim().toLowerCase()}` }
// Mismo umbral que el guard final de canonicalización (sessionEvaluation.ts:
// validateGeneratedSessionEvaluation). signature() solo detecta duplicados
// literales; una pregunta de repair puede parafrasear una accepted question
// (prompt distinto, mismo contenido) y aun así ser un duplicado real — eso
// solo lo detecta questionSimilarity. Si este umbral y el del guard final
// divergen, un duplicado puede sobrevivir aquí y solo ser detectado en el
// assembly final, después de que todos los provider calls ya se pagaron.
const DUPLICATE_SIMILARITY_THRESHOLD = 0.8
const similarityShim = (q: PreparedEvaluationQuestion): CanonicalQuestion =>
  ({ questionText: q.prompt, options: q.options, format: canonicalQuestionFormat(q.format) } as unknown as CanonicalQuestion)
const isSemanticDuplicate = (a: PreparedEvaluationQuestion, b: PreparedEvaluationQuestion): boolean =>
  questionSimilarity(similarityShim(a), similarityShim(b)) >= DUPLICATE_SIMILARITY_THRESHOLD
export function diagnoseEvaluationBlock(block:EvaluationPlanBlock,questions:PreparedEvaluationQuestion[],teaching:PreparedTeachingContent,evaluationPreference='mixed',externalAccepted:PreparedEvaluationQuestion[]=[]):EvaluationBlockDiagnosis{
  const validSteps=new Set(block.coveredStepIds);const validPoints=new Set(block.coveredKeyPointIds);const validFacts=new Set(block.coveredFactKeys);const quickFormats=allowedEvaluationFormats;const invalid:string[]=[];const duplicates:string[]=[];const accepted:string[]=[];const seen=new Set<string>();const acceptedQuestions:PreparedEvaluationQuestion[]=[];const externalSignatures=new Set(externalAccepted.map(signature));
  for(const q of questions){const id=q.questionId||q.id||'unknown';const canonicalFormat=canonicalQuestionFormat(q.format);const blockIdOk=q.blockId===block.blockId;const stepIdsOk=Boolean(q.targetStepIds?.length)&&q.targetStepIds.every(step=>validSteps.has(step));const keyPointIdsOk=Boolean(q.targetKeyPointIds?.length)&&q.targetKeyPointIds.every(point=>validPoints.has(point));const factKeysOk=Boolean(q.targetFactKeys?.length)&&q.targetFactKeys.every(fact=>validFacts.has(fact));const promptOk=Boolean(q.prompt);const feedbackOk=true;const answerOk=canonicalFormat==='true_false'?typeof q.correctAnswer==='boolean':q.correctAnswer!==undefined&&q.correctAnswer!==null;const formatOk=Boolean(canonicalFormat)&&(evaluationPreference!=='quick_test'||quickFormats.has(canonicalFormat!));
    // Matching exige además seguridad académica de contenido (P3): shape
    // válido no basta — un pair puede ser referencialmente consistente y aun
    // así describir la relación equivocada (ver matchingValidator.ts).
    const matchingOk=canonicalFormat!=='matching'||validateMatchingQuestion(q).valid;
    // Guard de compatibilidad cognitiva (P3.2): application/transfer no puede
    // evaluarse con un variant que solo mide recall literal (ver
    // cognitiveFormatFitValidator.ts — reusa FORMAT_LIBRARY, no duplica taxonomía).
    const cognitiveFormatFitOk=validateCognitiveFormatFit(q).valid;
    const structurallyValid=Boolean(id&&blockIdOk&&stepIdsOk&&keyPointIdsOk&&factKeysOk&&promptOk&&feedbackOk&&answerOk&&formatOk&&matchingOk&&cognitiveFormatFitOk);if(!structurallyValid){invalid.push(id);continue}
    const key=signature(q)
    // Duplicado literal (dentro del bloque o contra otro bloque ya aceptado) o
    // duplicado semántico (mismo contenido, prompt parafraseado) — ambos se
    // rechazan aquí, en el punto donde accepted+repaired se combinan, para que
    // nunca lleguen al assembly final.
    const literalDuplicate=seen.has(key)||externalSignatures.has(key)
    const semanticDuplicate=acceptedQuestions.some(prev=>isSemanticDuplicate(prev,q))||externalAccepted.some(prev=>isSemanticDuplicate(prev,q))
    if(literalDuplicate||semanticDuplicate){duplicates.push(id);continue}
    seen.add(key);accepted.push(id);acceptedQuestions.push(q)}
  const coveredSteps=new Set(acceptedQuestions.flatMap(q=>q.targetStepIds));const coveredPoints=new Set(acceptedQuestions.flatMap(q=>q.targetKeyPointIds));const scopedSteps=teaching.steps.filter(step=>block.coveredStepIds.includes(step.stepId));const missingRequiredStepIds=scopedSteps.filter(step=>(step.importance==='important'||step.importance==='critical')&&!coveredSteps.has(step.stepId)).map(step=>step.stepId);const missingCriticalKeyPointIds=scopedSteps.filter(step=>step.importance==='critical').flatMap(step=>step.keyPointIds).filter(point=>!coveredPoints.has(point));const missingImportantKeyPointIds=scopedSteps.filter(step=>step.importance==='important').flatMap(step=>step.keyPointIds).filter(point=>!coveredPoints.has(point));const requiredReplacementCount=Math.max(invalid.length+duplicates.length,missingRequiredStepIds.length,missingCriticalKeyPointIds.length,missingImportantKeyPointIds.length);return{code:requiredReplacementCount?'PARTIAL_EVALUATION_COVERAGE':'EVALUATION_COMPLETE',blockId:block.blockId,missingRequiredStepIds:uniq(missingRequiredStepIds),missingCriticalKeyPointIds:uniq(missingCriticalKeyPointIds),missingImportantKeyPointIds:uniq(missingImportantKeyPointIds),invalidQuestionIds:uniq(invalid),duplicateQuestionIds:uniq(duplicates),acceptedQuestionIds:accepted,requiredReplacementCount}
}
export function diagnoseEvaluationCoverage(teaching: PreparedTeachingContent, blocks: PreparedEvaluationBlock[], evaluationPreference='mixed'): EvaluationCoverageDiagnosis {
  // externalAccepted: las preguntas ya aceptadas en los bloques ANTERIORES (por
  // orden del plan) de la misma sesión — sin esto, diagnoseEvaluationBlock solo
  // ve duplicados dentro de su propio bloque y un duplicado cross-block (mismo
  // hecho evaluado dos veces en bloques distintos) nunca se detecta aquí.
  // Deliberadamente asimétrico ("primero gana", igual que el dedup literal
  // intra-bloque con `seen`): comparar contra TODOS los demás bloques marcaría
  // ambos lados de un par cross-block como duplicado y dispararía un repair
  // innecesario del bloque que en realidad es el original.
  const diagnoses=blocks.map((block,index)=>diagnoseEvaluationBlock(block,block.questions,teaching,evaluationPreference,blocks.slice(0,index).flatMap(other=>other.questions)));const missingRequiredStepIds=uniq(diagnoses.flatMap(item=>item.missingRequiredStepIds));const missingCriticalKeyPoints=uniq(diagnoses.flatMap(item=>item.missingCriticalKeyPointIds));const missingImportantKeyPoints=uniq(diagnoses.flatMap(item=>item.missingImportantKeyPointIds));const invalidQuestionIds=uniq(diagnoses.flatMap(item=>item.invalidQuestionIds));const duplicateQuestionIds=uniq(diagnoses.flatMap(item=>item.duplicateQuestionIds));const affectedBlockIds=diagnoses.filter(item=>item.code==='PARTIAL_EVALUATION_COVERAGE').map(item=>item.blockId);return{code:affectedBlockIds.length?'PARTIAL_EVALUATION_COVERAGE':'EVALUATION_COMPLETE',missingRequiredStepIds,missingCriticalKeyPoints,missingImportantKeyPoints,invalidQuestionIds,duplicateQuestionIds,affectedBlockIds}
}

async function execute(input: SessionPreparationFactoryInput): Promise<SessionPreparationState> {
  let state=await input.load() || { preparationStatus:'teaching_generation', currentGenerationStage:'teaching_generation', generationKey:input.generationKey, teachingVersion:'teaching-v1', preparationVersion:'session-preparation-v2',evaluationPlannerVersion:EVALUATION_PLANNER_VERSION,evaluationBlockGeneratorVersion:EVALUATION_BLOCK_GENERATOR_VERSION,evalPreference:input.evalPreference,sessionKind:input.sessionKind,generatedEvaluationBlocks:[], acceptedQuestions:[], missingCoverage:emptyDiagnosis(), generationAttempts:{} }
  const save=async(status:SessionPreparationStatus,stage=status)=>{state={...state,preparationStatus:status,currentGenerationStage:stage};await input.persist(state)}
  try {
    if(!state.teachingContent){await save('teaching_generation'); input.telemetry?.('teaching_generation_started',{generationKey:input.generationKey}); state.generationAttempts.teaching=(state.generationAttempts.teaching||0)+1; const content=await input.generateTeaching(`${input.generationKey}:teaching:${state.teachingVersion}`); state={...state,teachingContent:content,teachingHash:hash(content),generatedEvaluationBlocks:[],acceptedQuestions:[]}; input.telemetry?.('teaching_generation_succeeded',{generationKey:input.generationKey}); await save('teaching_ready'); input.telemetry?.('teaching_persisted',{generationKey:input.generationKey})} else input.telemetry?.('teaching_regeneration_prevented',{generationKey:input.generationKey})
    if(input.sessionKind!=='learning'){state={...state,evaluationPlan:{blocks:[]},generatedEvaluationBlocks:[],acceptedQuestions:[],missingCoverage:emptyDiagnosis()};await save('ready');return state}
    input.telemetry?.('evaluation_restore_state_audited',{preparationVersion:state.preparationVersion||'legacy',plannerVersion:state.evaluationPlannerVersion||'legacy',evaluationBlockVersion:state.evaluationBlockGeneratorVersion||'legacy',teachingHash:state.teachingHash||null,evaluationPlanHash:state.evaluationPlanHash||null,evalPreference:state.evalPreference||null,sessionKind:state.sessionKind||null,preparationStatus:state.preparationStatus,totalAcceptedQuestionCount:state.acceptedQuestions.length,questionsPerBlock:Object.fromEntries(state.generatedEvaluationBlocks.map(block=>[block.blockId,block.questions.length])),blocks:state.generatedEvaluationBlocks.map(block=>({blockId:block.blockId,questionIds:block.questions.map(question=>question.questionId),questions:block.questions.map(question=>({questionId:question.questionId,targetStepIds:question.targetStepIds,targetKeyPointIds:question.targetKeyPointIds,targetFactKeys:question.targetFactKeys})),teachingHash:block.teachingHash||null,evaluationPlanHash:block.evaluationPlanHash||null,generatorVersion:block.generatorVersion||'legacy'})),missingCoverage:state.missingCoverage})
    if(state.evaluationPlan&&validateEvaluationPlan(state.teachingContent!,state.evaluationPlan).length){input.telemetry?.('invalid_persisted_evaluation_plan_discarded',{generationKey:input.generationKey});state={...state,evaluationPlan:undefined,evaluationPlanHash:undefined,generatedEvaluationBlocks:[],acceptedQuestions:[],lastDiagnostic:undefined,lastTechnicalError:undefined};await input.persist(state)}
    if(!state.evaluationPlan){await save('evaluation_planning'); input.telemetry?.('evaluation_planning_started',{generationKey:input.generationKey}); state.generationAttempts.planning=(state.generationAttempts.planning||0)+1; const plan=await input.planEvaluations(state.teachingContent!,`${state.teachingHash}:${input.evalPreference}:planner-v3`); const errors=validateEvaluationPlan(state.teachingContent!,plan); if(errors.length){state={...state,lastDiagnostic:{errorCode:'DETERMINISTIC_EVALUATION_PLAN_INVALID',validationErrors:errors,unknownStepIds:[],unknownKeyPoints:[],missingStepIds:[]}};throw new Error('DETERMINISTIC_EVALUATION_PLAN_INVALID')} state={...state,evaluationPlan:plan,evaluationPlanHash:hash(plan),evaluationPlannerVersion:EVALUATION_PLANNER_VERSION,evaluationBlockGeneratorVersion:EVALUATION_BLOCK_GENERATOR_VERSION,evalPreference:input.evalPreference,sessionKind:input.sessionKind,lastDiagnostic:undefined,lastTechnicalError:undefined};await save('evaluation_plan_ready');input.telemetry?.('evaluation_plan_validated',{generationKey:input.generationKey,blockCount:plan.blocks.length})}
    const currentPlanHash=hash(state.evaluationPlan);const previousPlanHash=state.evaluationPlanHash;const compatibleBlocks:PreparedEvaluationBlock[]=[];for(const block of state.generatedEvaluationBlocks){const planBlock=state.evaluationPlan.blocks.find(item=>item.blockId===block.blockId);const compatible=Boolean(planBlock&&block.sessionId===state.teachingContent!.sessionId&&block.teachingHash===state.teachingHash&&block.evaluationPlanHash===currentPlanHash&&block.evalPreference===input.evalPreference&&block.generatorVersion===EVALUATION_BLOCK_GENERATOR_VERSION&&JSON.stringify(block.coveredStepIds)===JSON.stringify(planBlock.coveredStepIds)&&JSON.stringify(block.coveredKeyPointIds)===JSON.stringify(planBlock.coveredKeyPointIds));if(compatible)compatibleBlocks.push(block);else input.telemetry?.('stale_evaluation_block_discarded',{blockId:block.blockId,previousPlanHash:block.evaluationPlanHash||previousPlanHash||null,currentPlanHash,previousVersion:block.generatorVersion||state.evaluationBlockGeneratorVersion||'legacy',currentVersion:EVALUATION_BLOCK_GENERATOR_VERSION,discardedQuestionIds:block.questions.map(question=>question.questionId)})}state={...state,preparationVersion:'session-preparation-v2',evaluationPlannerVersion:EVALUATION_PLANNER_VERSION,evaluationBlockGeneratorVersion:EVALUATION_BLOCK_GENERATOR_VERSION,evaluationPlanHash:currentPlanHash,evalPreference:input.evalPreference,sessionKind:input.sessionKind,...(compatibleBlocks.length!==state.generatedEvaluationBlocks.length?{generatedEvaluationBlocks:compatibleBlocks,acceptedQuestions:compatibleBlocks.flatMap(block=>block.questions)}:{})};await input.persist(state)
    await save('evaluation_generation');
    for(const block of state.evaluationPlan.blocks){if(state.generatedEvaluationBlocks.some(b=>b.blockId===block.blockId))continue; state.generationAttempts[`block:${block.blockId}`]=(state.generationAttempts[`block:${block.blockId}`]||0)+1; input.telemetry?.('evaluation_block_generation_started',{blockId:block.blockId}); const generated=await input.generateEvaluationBlock(block,state.teachingContent!,state.acceptedQuestions,`${state.teachingHash}:${block.blockId}:${input.evalPreference}:block-v2`);const versioned={...generated,sessionId:state.teachingContent!.sessionId,teachingHash:state.teachingHash,evaluationPlanHash:state.evaluationPlanHash,evalPreference:input.evalPreference,generatorVersion:EVALUATION_BLOCK_GENERATOR_VERSION};const blockDiagnosis=diagnoseEvaluationBlock(block,versioned.questions,state.teachingContent!,input.evalPreference,state.acceptedQuestions);state={...state,generatedEvaluationBlocks:[...state.generatedEvaluationBlocks,versioned],acceptedQuestions:[...state.acceptedQuestions,...versioned.questions]};await input.persist(state);if(blockDiagnosis.code==='EVALUATION_COMPLETE')input.telemetry?.('evaluation_block_generation_succeeded',{blockId:block.blockId,generatedQuestionCount:versioned.questions.length});else input.telemetry?.('evaluation_block_generation_partial',{blockId:block.blockId,diagnosis:blockDiagnosis,missingImportantKeyPointIds:blockDiagnosis.missingImportantKeyPointIds,acceptedQuestionIds:blockDiagnosis.acceptedQuestionIds,requiredReplacementCount:blockDiagnosis.requiredReplacementCount})}
    let diagnosis=diagnoseEvaluationCoverage(state.teachingContent!,state.generatedEvaluationBlocks,input.evalPreference); state={...state,missingCoverage:diagnosis}
    if(diagnosis.code==='PARTIAL_EVALUATION_COVERAGE'){await save('evaluation_repair');input.telemetry?.('partial_evaluation_coverage_detected',{diagnosis,missingStepIds:diagnosis.missingRequiredStepIds,missingKeyPoints:[...diagnosis.missingCriticalKeyPoints,...diagnosis.missingImportantKeyPoints]});for(const blockId of diagnosis.affectedBlockIds){const block=state.evaluationPlan.blocks.find(item=>item.blockId===blockId);const existing=state.generatedEvaluationBlocks.find(item=>item.blockId===blockId);if(!block||!existing)continue;const priorBlockIds=new Set(state.evaluationPlan.blocks.slice(0,state.evaluationPlan.blocks.findIndex(item=>item.blockId===blockId)).map(item=>item.blockId));const siblingAccepted=state.generatedEvaluationBlocks.filter(item=>priorBlockIds.has(item.blockId)).flatMap(item=>item.questions);const blockDiagnosis=diagnoseEvaluationBlock(block,existing.questions,state.teachingContent!,input.evalPreference,siblingAccepted);const accepted=existing.questions.filter(question=>blockDiagnosis.acceptedQuestionIds.includes(question.questionId));const globalAcceptedQuestionCount=state.acceptedQuestions.length;input.telemetry?.('incremental_evaluation_repair_started',{blockId,diagnosis:blockDiagnosis,requiredReplacementCount:blockDiagnosis.requiredReplacementCount,globalAcceptedQuestionCount,scopedAcceptedQuestionCount:existing.questions.length,compatibleAcceptedQuestionCount:accepted.length,discardedQuestionCount:existing.questions.length-accepted.length});state.generationAttempts[`repair:${blockId}`]=(state.generationAttempts[`repair:${blockId}`]||0)+1;const scopedDiagnosis:EvaluationCoverageDiagnosis={code:blockDiagnosis.code,missingRequiredStepIds:blockDiagnosis.missingRequiredStepIds,missingCriticalKeyPoints:blockDiagnosis.missingCriticalKeyPointIds,missingImportantKeyPoints:blockDiagnosis.missingImportantKeyPointIds,invalidQuestionIds:blockDiagnosis.invalidQuestionIds,duplicateQuestionIds:blockDiagnosis.duplicateQuestionIds,affectedBlockIds:[blockId]};const additions=await input.repairEvaluationBlock(block,scopedDiagnosis,accepted,`${blockId}:${hash(blockDiagnosis)}:repair-v2`);if(additions.length!==blockDiagnosis.requiredReplacementCount){input.telemetry?.(additions.length===0?'incremental_evaluation_repair_empty':'incremental_evaluation_repair_count_invalid',{blockId,requiredReplacementCount:blockDiagnosis.requiredReplacementCount,generatedQuestionCount:additions.length});input.telemetry?.('incremental_evaluation_repair_failed',{blockId,diagnosis:blockDiagnosis,requiredReplacementCount:blockDiagnosis.requiredReplacementCount,generatedQuestionCount:additions.length});throw new Error(`INCREMENTAL_EVALUATION_REPAIR_COUNT_INVALID:${blockId}`)}const candidate=[...accepted,...additions];const postDiagnosis=diagnoseEvaluationBlock(block,candidate,state.teachingContent!,input.evalPreference,siblingAccepted);if(postDiagnosis.code!=='EVALUATION_COMPLETE'){input.telemetry?.('incremental_evaluation_repair_failed',{blockId,diagnosis:postDiagnosis,requiredReplacementCount:blockDiagnosis.requiredReplacementCount,generatedQuestionCount:additions.length});throw new Error(`INCREMENTAL_EVALUATION_REPAIR_VALIDATION_FAILED:${blockId}`)}const replacement={...existing,questions:candidate};state={...state,generatedEvaluationBlocks:state.generatedEvaluationBlocks.map(item=>item.blockId===blockId?replacement:item),acceptedQuestions:state.generatedEvaluationBlocks.flatMap(item=>item.blockId===blockId?candidate:item.questions)};await input.persist(state);input.telemetry?.('accepted_questions_preserved',{blockId,acceptedQuestionCount:accepted.length});input.telemetry?.('incremental_evaluation_repair_validated',{blockId,diagnosis:postDiagnosis});input.telemetry?.('incremental_evaluation_repair_succeeded',{blockId,requiredReplacementCount:blockDiagnosis.requiredReplacementCount,generatedQuestionCount:additions.length})}diagnosis=diagnoseEvaluationCoverage(state.teachingContent!,state.generatedEvaluationBlocks,input.evalPreference);state={...state,missingCoverage:diagnosis};if(diagnosis.code!=='EVALUATION_COMPLETE')throw new Error(`PARTIAL_EVALUATION_COVERAGE:${JSON.stringify(diagnosis)}`)}
    await save('ready');return state
  }catch(error){const message=error instanceof Error?error.message:String(error);state={...state,lastTechnicalError:message,lastDiagnostic:state.lastDiagnostic||{errorCode:'SESSION_PREPARATION_STAGE_FAILED',validationErrors:[message],unknownStepIds:[],unknownKeyPoints:[],missingStepIds:[],stack:error instanceof Error?error.stack?.split('\n').slice(0,6).join('\n'):undefined}};input.telemetry?.('session_preparation_stage_failed',{errorCode:state.lastDiagnostic.errorCode,message,validationErrors:state.lastDiagnostic.validationErrors,unknownStepIds:state.lastDiagnostic.unknownStepIds,unknownKeyPoints:state.lastDiagnostic.unknownKeyPoints,missingStepIds:state.lastDiagnostic.missingStepIds,offendingBlock:state.lastDiagnostic.offendingBlock,stack:state.lastDiagnostic.stack});await save('technical_retry_required');return state}
}

export function runSessionPreparationFactory(input: SessionPreparationFactoryInput): Promise<SessionPreparationState> {
  const existing=active.get(input.generationKey);if(existing){input.telemetry?.('duplicate_generation_suppressed',{generationKey:input.generationKey});return existing}
  const operation=execute(input).finally(()=>active.delete(input.generationKey));active.set(input.generationKey,operation);return operation
}
