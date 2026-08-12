import assert from 'node:assert/strict'
import { buildVisualCompositionPlan } from '../../lib/adaptive/visual/visualComposition'

const adversarial = ['there is a force','there is a parabola','compound has carbon','event happened before another','program loops','see image']
for (let i=0;i<20;i++) for (const content of adversarial) assert.equal(buildVisualCompositionPlan({microId:`m${i}`,title:'',content,keyPoints:[],factKeys:['f'],cognitiveTarget:'application',sourceStepId:'s'}),null,content)
console.log(`Visual adversarial grounding contracts: PASS (${adversarial.length*20}/120 fail closed; invented data 0)`)
