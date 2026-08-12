import assert from 'node:assert/strict'
import { question, runReliabilityFixture } from './helpers/adaptiveSessionReliabilityFixture'

async function main(){
const store={value:null as any};const counters:Record<string,number>={}
const first=await runReliabilityFixture({key:'restore-chaos',store,counters})
const teachingCalls=counters.teaching;const blockCalls=counters.block
const restored=await runReliabilityFixture({key:'restore-chaos',store,counters})
assert.equal(first.preparationStatus,'ready');assert.equal(restored.preparationStatus,'ready');assert.equal(counters.teaching,teachingCalls);assert.equal(counters.block,blockCalls)
const repairStore={value:null as any};const repairCounters:Record<string,number>={}
const recoverable=await runReliabilityFixture({key:'restore-recoverable',store:repairStore,counters:repairCounters,generatedQuestions:[question('bad',{correctAnswer:'true'})],repairOutputs:[[],[question('fixed')]]})
assert.ok(['recoverable','ready'].includes(recoverable.preparationStatus));assert.ok(recoverable.teachingContent)
const resumed=await runReliabilityFixture({key:'restore-recoverable',store:repairStore,counters:repairCounters,generatedQuestions:[question('bad',{correctAnswer:'true'})],repairOutputs:[[question('fixed')]]})
assert.equal(resumed.preparationStatus,'ready');assert.equal(repairCounters.teaching,1,'restore no regenera teaching válido')
console.log('adaptive-session-restore-chaos-contracts: 6/6 PASS; pedagogical state loss=0; unnecessary valid regeneration=0')
}
void main()
