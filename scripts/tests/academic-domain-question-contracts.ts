import assert from 'node:assert/strict'
import { resolveAcademicDomain, legacyMaterialType } from '../../lib/adaptive/academicDomain'
import { canonicalizeGeneratedSession } from '../../lib/adaptive/evaluation/sessionEvaluation'
import { normalizeGeneratedQuestion, validateQuestion, type GenerationContext } from '../../lib/adaptive/evaluation/questionContract'

const falcons = resolveAcademicDomain({
  materialTitle:'Falcons',
  blocks:[
    { kind:'fact', label:'Fundado en 1965', summary:'Historia, identidad cultural y conexión con la afición.' },
    { kind:'entity', label:'Super Bowl LI', summary:'Jugadores icónicos y argumentos deportivos.' },
    { kind:'concept', label:'Pasión-resiliencia', summary:'Criterios para determinar la grandeza de un equipo.' },
  ],
  topics:[{ title:'Atlanta Falcons', description:'Historia e identidad del equipo' }],
})
assert.equal(falcons.academicDomain, 'general_conceptual')
assert.equal(legacyMaterialType(falcons.academicDomain), 'general')
assert.equal(falcons.academicDomainVersion, 'academic-domain-v1')

const conceptualContext: GenerationContext = {
  activeConceptId:'step_1', activeConceptLabel:'Identidad', teachingBlockId:'step_1',
  targetDimension:'comprehension', cognitiveTargetContract:'comprehension',
  questionFamily:'true_false', allowedConceptIds:['step_1'], forbiddenConceptIds:[],
  factKeys:['step_1:kp:2'], targetObjectiveIds:['chapter_2:step_1:kp:2'], evaluationMode:'quick_test',
}
const falconsQuestion = normalizeGeneratedQuestion({
  conceptId:'step_1',
  variant:'true_false_factual', targetDimension:'comprehension', difficulty:'medium',
  questionText:'Los jugadores icónicos y la conexión con la afición son criterios clave para determinar la grandeza de un equipo deportivo.',
  correctAnswer:true, explanation:'El texto usa ambos criterios.', hint:'Revisa los criterios del argumento.',
}, conceptualContext, 'eval_1_2')
assert(falconsQuestion)
assert.equal(falconsQuestion.requiresNumericData, false)
assert.equal(validateQuestion(falconsQuestion, conceptualContext).valid, true)
assert.ok(!validateQuestion(falconsQuestion, conceptualContext).errors.includes('insufficient_numeric_data'))

const mathDefinition = normalizeGeneratedQuestion({
  conceptId:'step_1',
  variant:'true_false_factual', targetDimension:'comprehension', difficulty:'easy',
  questionText:'Una derivada representa una tasa de cambio.', correctAnswer:true,
  explanation:'Es una definición conceptual.', hint:'Piensa en la definición.', requiresNumericData:true,
}, conceptualContext, 'math_definition')
assert(mathDefinition)
assert.equal(mathDefinition.requiresNumericData, false)

const quantitativeContext = { ...conceptualContext, targetDimension:'application' as const, cognitiveTargetContract:'calculation', questionFamily:'problem_solve', evaluationMode:'mix_everything' }
const quantitative = normalizeGeneratedQuestion({
  conceptId:'step_1',
  variant:'problem_solve', targetDimension:'application', difficulty:'medium',
  questionText:'Con x = 2 y y = 3, calcula x + y.', correctAnswer:{ value:5, tolerance:0 },
  explanation:'Se suman ambos valores.', hint:'Suma los valores.',
}, quantitativeContext, 'real_calculation')
assert(quantitative)
assert.equal(quantitative.requiresNumericData, true)
assert.deepEqual(quantitative.numericEvidence?.values, ['2', '3'])
assert.equal(validateQuestion(quantitative, quantitativeContext).valid, true)

const rawSession = {
  sessionIntro:'Falcons', sessionClosing:'Continúa.',
  steps:[{ id:'step_1', type:'concept', title:'Identidad', content:'Los jugadores icónicos y la conexión con la afición sustentan el argumento.', keyPoints:['Criterios de grandeza','Jugadores y afición'], keyPointIds:['step_1:kp:1','step_1:kp:2'], importance:'important', relatedBlockIds:['falcons'], factKeys:['f1','f2'] }],
  evaluationBlocks:[{ id:'block_1', afterStepId:'step_1', coveredStepIds:['step_1'], coveredKeyPoints:['Criterios de grandeza','Jugadores y afición'], coveredKeyPointIds:['step_1:kp:1','step_1:kp:2'], questions:[
    // targetFactKeys es obligatorio en toda pregunta real generada por el
    // pipeline (contrato de salida exigido en session-teach/route.ts) — el
    // STRICT COVERAGE BLOCKER (sessionEvaluation.ts) exige que TODOS los
    // factKeys declarados por el step (f1, f2) queden cubiertos por
    // sourceFactKeys de preguntas aceptadas, o rechaza la sesión.
    { questionId:'eval_1_1', format:'true_false', coveredStepIds:['step_1'], targetKeyPointIds:['step_1:kp:1'], targetFactKeys:['f1'], coveredKeyPoints:['Criterios de grandeza'], cognitiveTarget:'comprehension', prompt:'La identidad del equipo forma parte del argumento central.', correctAnswer:true, feedback:'Correcto.' },
    { questionId:'eval_1_2', format:'true_false', coveredStepIds:['step_1'], targetKeyPointIds:['step_1:kp:2'], targetFactKeys:['f2'], coveredKeyPoints:['Jugadores y afición'], cognitiveTarget:'comprehension', prompt:'Los jugadores icónicos y la conexión con la afición son criterios clave para determinar la grandeza de un equipo deportivo.', correctAnswer:true, feedback:'Correcto.' },
  ] }],
}
const canonical = canonicalizeGeneratedSession(rawSession, { sessionId:'chapter_2', kind:'learning', evaluationMode:'quick_test' })
assert(canonical.session, canonical.errors.join('\n'))
const restored = canonical.session.evaluationBlocks[0].questions.find(question => question.id === 'eval_1_2')
assert(restored)
assert.equal(restored.requiresNumericData, false)
assert.ok(restored.coveredKeyPointIds?.includes('step_1:kp:2'))
assert.ok(!canonical.errors.some(error => error.includes('insufficient_numeric_data') || error.includes('missing=step_1:kp:2')))

const introduction = canonicalizeGeneratedSession({
  steps:Array.from({length:5},(_,index)=>({id:`step_${index+1}`,type:index===4?'recap':'intro',title:`Orientación ${index+1}`,content:'Mapa y vocabulario del recorrido sin desarrollar los microconceptos.',keyPoints:[`Orientación ${index+1}`],importance:'supporting',relatedBlockIds:[]})),
  evaluationBlocks:[],
}, { sessionId:'chapter_intro', kind:'introduction', evaluationMode:'quick_test' })
assert(introduction.session)
assert.equal(introduction.session.evaluationBlocks.length, 0)
assert.ok(introduction.session.steps.every(step => step.relatedBlockIds.length === 0))

console.log('academic-domain-question-contracts: Falcons domain, per-question numeric validation and introduction PASS')
