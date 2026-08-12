import {
  runSessionPreparationFactory,
  type EvaluationPlan,
  type EvaluationPlanBlock,
  type PreparedEvaluationQuestion,
  type PreparedTeachingContent,
  type SessionPreparationState,
} from '../../../lib/ai/sessionPreparationFactory'

export const teaching: PreparedTeachingContent = {
  sessionId: 'reliability-session', title: 'Reliability', introduction: 'Introducción válida', closing: 'Cierre válido',
  steps: [{ stepId:'step_1', id:'step_1', microId:'micro_1', title:'Principio', type:'concept', content:'El principio A es verdadero.', keyPoints:['El principio A es verdadero.'], keyPointIds:['step_1:kp:1'], factKeys:['fact_1'], importance:'critical', cognitiveTarget:'comprehension', sourceReferences:[] }],
}
export const block: EvaluationPlanBlock = {
  blockId:'reliability-session:evaluation:1', afterStepId:'step_1', coveredStepIds:['step_1'], coveredKeyPointIds:['step_1:kp:1'], coveredFactKeys:['fact_1'], targetObjectiveIds:['step_1:objective:comprehension'], cognitiveTargets:['comprehension'], recommendedQuestionCount:1, recommendedFormats:['true_false'], difficulty:'medium',
}
export const plan: EvaluationPlan = { blocks:[block] }

export function question(id='q_valid', overrides:Partial<PreparedEvaluationQuestion>={}):PreparedEvaluationQuestion {
  return { questionId:id, blockId:block.blockId, targetStepIds:['step_1'], targetKeyPointIds:['step_1:kp:1'], targetFactKeys:['fact_1'], targetObjectiveIds:['step_1:objective:comprehension'], cognitiveTarget:'comprehension', format:'true_false', variant:'true_false_factual', prompt:'El principio A es verdadero.', correctAnswer:true, feedback:'Correcto según el contenido.', difficulty:'medium', ...overrides }
}

export interface ReliabilityRunOptions {
  key:string
  teachingFailures?:number
  blockFailures?:number
  repairOutputs?:PreparedEvaluationQuestion[][]
  generatedQuestions?:PreparedEvaluationQuestion[]
  persistFailures?:number
  store?:{ value:SessionPreparationState|null }
  counters?:Record<string,number>
}

export async function runReliabilityFixture(options:ReliabilityRunOptions):Promise<SessionPreparationState> {
  const counters=options.counters || {}
  const store=options.store || {value:null}
  let teachingFailures=options.teachingFailures || 0
  let blockFailures=options.blockFailures || 0
  let persistFailures=options.persistFailures || 0
  const repairOutputs=[...(options.repairOutputs || [[question('q_repair')]])]
  return runSessionPreparationFactory({
    sessionKind:'learning', generationKey:options.key, evalPreference:'quick_test', origin:store.value?'restore':'cold',
    load:async()=>store.value,
    persist:async state=>{counters.persist=(counters.persist||0)+1;if(persistFailures-->0)throw new Error('PERSIST_TRANSIENT');store.value=structuredClone(state)},
    generateTeaching:async()=>{counters.teaching=(counters.teaching||0)+1;if(teachingFailures-->0)throw new Error('PROVIDER_TIMEOUT');return teaching},
    planEvaluations:async()=>{counters.plan=(counters.plan||0)+1;return plan},
    generateEvaluationBlock:async()=>{counters.block=(counters.block||0)+1;if(blockFailures-->0)throw new Error('EMPTY_OR_TIMEOUT');return{...block,questions:options.generatedQuestions || [question()]}},
    repairEvaluationBlock:async()=>{counters.repair=(counters.repair||0)+1;return repairOutputs.shift() || []},
  })
}
