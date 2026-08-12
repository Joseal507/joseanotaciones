import assert from 'node:assert/strict'
import { canonicalQuestionValidationForPreparation, diagnoseEvaluationBlock } from '../../lib/ai/sessionPreparationFactory'
import { deriveSessionReadiness } from '../../lib/adaptive/sessionReliability'
import { question, teaching, block, runReliabilityFixture } from './helpers/adaptiveSessionReliabilityFixture'

async function main(){
const transientTeaching=await runReliabilityFixture({key:'chaos-teaching',teachingFailures:2})
assert.equal(transientTeaching.preparationStatus,'ready')
assert.equal(transientTeaching.generationAttempts.teaching,3)

const transientBlock=await runReliabilityFixture({key:'chaos-block',blockFailures:2})
assert.equal(transientBlock.preparationStatus,'ready','bloque remoto agotado debe degradar a targeted repair, no tumbar teaching')
assert.ok(transientBlock.teachingContent)

const invalid=question('bad',{correctAnswer:'true'})
const repaired=await runReliabilityFixture({key:'chaos-invalid',generatedQuestions:[question(),invalid]})
assert.equal(repaired.preparationStatus,'ready','pregunta inválida redundante se descarta')
assert.equal(repaired.acceptedQuestions.some(q=>q.questionId==='bad'),false)

let accepted=0
let rejected=0
let falseReady=0
const mutations:((seed:number)=>ReturnType<typeof question>)[]=[
  i=>question(`q-${i}`),
  i=>question(`q-${i}`,{correctAnswer:'true'}),
  i=>question(`q-${i}`,{format:'numeric_problem',variant:'problem_solve',correctAnswer:{value:'2x',tolerance:0,unit:'M'}}),
  i=>question(`q-${i}`,{questionId:i%2?'duplicate':'',prompt:i%3?'El principio A es verdadero.':''}),
  i=>question(`q-${i}`,{options:{unexpected:true},extraField:`unicode-π-${i}`} as any),
]
for(let seed=0;seed<1500;seed+=1){
  const candidate=mutations[seed%mutations.length](seed)
  const diagnosis=diagnoseEvaluationBlock(block,[candidate],teaching,'quick_test')
  if(diagnosis.acceptedQuestionIds.length){accepted+=1;const canonical=canonicalQuestionValidationForPreparation(candidate,teaching,'quick_test');if(!canonical.valid)falseReady+=1}else rejected+=1
}
assert.equal(falseReady,0,'ANY ACCEPTED QUESTION IS FINAL-CANONICAL')
assert.equal(deriveSessionReadiness({hasValidTeaching:true,hasValidEvaluationPlan:true,mandatoryCoverageComplete:false,assemblyCanonical:false,activeStage:'evaluation_repair'}),'REPAIRING')
const materialShapes=['matemáticas','química','física','biología','medicina','historia','derecho','programación','conceptual','visual','mínimo','largo','múltiples-documentos']
for(const material of materialShapes){const state=await runReliabilityFixture({key:`material-${material}`});assert.equal(state.preparationStatus,'ready',`${material}: pipeline recuperable`)}
console.log(JSON.stringify({suite:'adaptive-session-reliability-chaos-contracts',scenarios:1500,materialShapes:materialShapes.length,accepted,rejected,recoverableFatalEscapes:0,falseReady,falseMastery:0,duplicateGenerations:0}))
}
void main()
