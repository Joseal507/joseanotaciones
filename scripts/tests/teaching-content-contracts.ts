import assert from 'node:assert/strict'
import { parseTeachingContent, teachingResponseDiagnostics } from '../../lib/ai/teachingContentContract'
import { readFileSync } from 'node:fs'

const valid={sessionIntro:'Inicio',steps:[{id:'step_1',type:'concept',title:'Identidad',content:'Contenido docente suficientemente concreto.',keyPoints:[{id:'step_1:kp:1',text:'Idea concreta'}],microId:'m1',importance:'critical',cognitiveTarget:'comprehension',relatedBlockIds:['b1'],factKeys:['f1'],sourceReferences:[]}],closing:'Cierre'}
assert.equal(parseTeachingContent(valid).success,true)
const extra=parseTeachingContent({...valid,evaluationBlocks:[{questions:[]}]})
assert.equal(extra.success,false)
if(!extra.success)assert.equal(extra.errorCode,'TEACHING_CONTRACT_EXTRA_FIELDS')
const truncated='```json\n{"sessionIntro":"Inicio","steps":'+JSON.stringify(valid.steps)+',"closing":"Cierre","evaluationBlocks":[{"questions":['
const diagnostic=teachingResponseDiagnostics(truncated)
assert.equal(diagnostic.appearsTruncated,true)
assert.equal(diagnostic.detectedFence,true)
const route=readFileSync('app/api/adaptive/session-teach/route.ts','utf8')
const prompt=route.slice(route.indexOf('function buildTeachingOnlyPrompt'),route.indexOf('function factoryTeaching'))
assert.match(prompt,/Genera únicamente la enseñanza de la sesión/)
assert.match(prompt,/La evaluación se planificará en una operación posterior/)
assert.match(prompt,/Tu respuesta debe terminar inmediatamente después del campo closing/)
assert.doesNotMatch(prompt,/coveredStepIds|coveredKeyPoints|correctAnswer|quick_test/)
assert.match(route,/prepareSessionByFactory\(body, teachingOnlyPrompt/)
console.log('teaching-content-contracts: PASS')
