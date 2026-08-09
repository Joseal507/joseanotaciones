import type { PersistedAcademicContent } from '../../academic-content/serialization'
import type { CanonicalQuestion } from './questionContract'

export interface RecoveryRoundTarget {
  sourceQuestionId: string
  sourceStepIds: string[]
  sourceKeyPointIds: string[]
  sourceFactKeys: string[]
  microId: string
  cognitiveTarget: string
}

export type RecoveryQuestion = CanonicalQuestion & {
  coveredStepIds: string[]
  coveredKeyPointIds: string[]
  coveredKeyPoints?: string[]
}

export interface PreparedRecoveryRound {
  success: true
  recoveryId: string
  recoveryTargetId: string
  roundId: string
  roundNumber: number
  explanation: string | PersistedAcademicContent
  questions: [RecoveryQuestion, RecoveryQuestion]
  target: RecoveryRoundTarget
  provider?: string
  model?: string
  generationKey?: string
  preparedAt?: number
}

export type PreparedRecoveryRoundParseResult =
  | { success: true; value: PreparedRecoveryRound }
  | {
      success: false
      errorCode: 'RECOVERY_ROUND_SCHEMA_INVALID' | 'PARTIAL_RECOVERY_ROUND'
      validationErrors: string[]
      partial: { explanation?: PreparedRecoveryRound['explanation']; explanationAccepted: boolean; questions: RecoveryQuestion[] }
    }

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(String).filter(Boolean) : []

export function parsePreparedRecoveryRound(value: unknown): PreparedRecoveryRoundParseResult {
  const source=record(value); const errors:string[]=[]
  const target=record(source?.target)
  const explanation=source?.explanation
  const explanationAccepted=typeof explanation==='string'
    ? explanation.trim().length>=20
    : Boolean(record(explanation))
  if(source?.success!==true)errors.push('success_required')
  for(const field of ['recoveryId','recoveryTargetId','roundId'] as const)if(typeof source?.[field]!=='string'||!String(source[field]).trim())errors.push(`${field}_required`)
  if(!Number.isInteger(source?.roundNumber)||Number(source?.roundNumber)<1)errors.push('roundNumber_invalid')
  if(!explanationAccepted)errors.push('explanation_invalid')
  if(!target)errors.push('target_required')
  const canonicalTarget:RecoveryRoundTarget={sourceQuestionId:String(target?.sourceQuestionId||''),sourceStepIds:strings(target?.sourceStepIds),sourceKeyPointIds:strings(target?.sourceKeyPointIds),sourceFactKeys:strings(target?.sourceFactKeys),microId:String(target?.microId||''),cognitiveTarget:String(target?.cognitiveTarget||'')}
  if(!canonicalTarget.sourceQuestionId)errors.push('target.sourceQuestionId_required')
  if(!canonicalTarget.sourceStepIds.length)errors.push('target.sourceStepIds_required')
  if(!canonicalTarget.sourceKeyPointIds.length)errors.push('target.sourceKeyPointIds_required')
  if(!canonicalTarget.sourceFactKeys.length)errors.push('target.sourceFactKeys_required')
  if(!canonicalTarget.microId)errors.push('target.microId_required')
  if(!canonicalTarget.cognitiveTarget)errors.push('target.cognitiveTarget_required')
  const rawQuestions=Array.isArray(source?.questions)?source.questions:[]
  const questions=rawQuestions.filter((question):question is RecoveryQuestion=>Boolean(record(question)))
  if(rawQuestions.length!==2)errors.push(`questions_expected_2_received_${rawQuestions.length}`)
  questions.forEach((question,index)=>{
    const q=question as RecoveryQuestion
    if(!q.id||!q.questionText||!q.explanation||!q.format)errors.push(`question_${index+1}_shape_invalid`)
    if(strings(q.coveredStepIds).join('|')!==canonicalTarget.sourceStepIds.join('|'))errors.push(`question_${index+1}_step_drift`)
    if(strings(q.coveredKeyPointIds).join('|')!==canonicalTarget.sourceKeyPointIds.join('|'))errors.push(`question_${index+1}_key_point_drift`)
    if(strings(q.factKeys).join('|')!==canonicalTarget.sourceFactKeys.join('|'))errors.push(`question_${index+1}_fact_drift`)
    if(q.conceptId!==canonicalTarget.microId||q.targetDimension!==canonicalTarget.cognitiveTarget)errors.push(`question_${index+1}_target_drift`)
  })
  if(errors.length)return {success:false,errorCode:explanationAccepted&&questions.length===1?'PARTIAL_RECOVERY_ROUND':'RECOVERY_ROUND_SCHEMA_INVALID',validationErrors:[...new Set(errors)],partial:{explanation:explanationAccepted?explanation as PreparedRecoveryRound['explanation']:undefined,explanationAccepted,questions}}
  return {success:true,value:{success:true,recoveryId:String(source!.recoveryId),recoveryTargetId:String(source!.recoveryTargetId),roundId:String(source!.roundId),roundNumber:Number(source!.roundNumber),explanation:explanation as PreparedRecoveryRound['explanation'],questions:questions as [RecoveryQuestion,RecoveryQuestion],target:canonicalTarget,provider:typeof source!.provider==='string'?source!.provider:undefined,model:typeof source!.model==='string'?source!.model:undefined,generationKey:typeof source!.generationKey==='string'?source!.generationKey:undefined,preparedAt:typeof source!.preparedAt==='number'?source!.preparedAt:undefined}}
}
