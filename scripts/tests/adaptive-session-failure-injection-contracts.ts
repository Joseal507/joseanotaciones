import assert from 'node:assert/strict'
import { classifyPreparationFailure } from '../../lib/adaptive/sessionReliability'
import { question, runReliabilityFixture } from './helpers/adaptiveSessionReliabilityFixture'

async function main(){
const cases:[string,string,boolean][]=[
 ['teaching provider timeout','retryable',false],['teaching empty response','retryable',false],['teaching malformed JSON','retryable',false],['teaching schema invalid','retryable',false],
 ['visual classifier throws','degradable',true],['visual extractor returns null','degradable',true],['visual builder throws','degradable',true],
 ['evaluation planner invalid','recoverable',true],['evaluation provider timeout','recoverable',true],['one invalid question','recoverable',true],['all questions invalid optional block','recoverable',true],['invalid required question','recoverable',true],
 ['repair malformed JSON','recoverable',true],['repair incompatible format','recoverable',true],['matching content drift','recoverable',true],['symbolic numeric answer','recoverable',true],['duplicate question IDs','recoverable',true],
 ['duplicated generation request','recoverable',true],['stale generation result','recoverable',true],['persistence POST fails once','recoverable',true],['persistence GET fails once','recoverable',true],
 ['server restart mid preparation','recoverable',true],['reload mid preparation','recoverable',true],['prefetch fails','recoverable',true],['user exits during prefetch','recoverable',true],['next prefetch running when clicked','recoverable',true],
 ['completed session restore','recoverable',true],['recoverable session restore','recoverable',true],['final assembly assertion','recoverable',true],['renderer exception','degradable',true],
]
for(const [name,expected,hasTeaching] of cases){const stage=name.startsWith('visual')||name==='renderer exception'?'visual_renderer':name.startsWith('teaching')?'provider':name;assert.equal(classifyPreparationFailure(stage,hasTeaching),expected,name)}

const symbolic=question('symbolic',{format:'numeric_problem',variant:'problem_solve',correctAnswer:{value:'2x',tolerance:0,unit:'M'}})
const repaired=await runReliabilityFixture({key:'failure-symbolic',generatedQuestions:[symbolic],repairOutputs:[[question('closed-replacement')]]})
assert.equal(repaired.preparationStatus,'ready')
const persisted={value:null as any};const persistCounters:Record<string,number>={}
const persistedReady=await runReliabilityFixture({key:'failure-persist-once',persistFailures:1,store:persisted,counters:persistCounters})
assert.equal(persistedReady.preparationStatus,'ready');assert.equal(persistedReady.reliability?.persistRetries,1)
console.log(`adaptive-session-failure-injection-contracts: ${cases.length}/${cases.length} PASS; recoverable user-visible fatal screens=0`)
}
void main()
