import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { diagnoseEvaluationBlock, diagnoseEvaluationCoverage, runSessionPreparationFactory, type PreparedTeachingContent, type EvaluationPlan, type PreparedEvaluationBlock, type PreparedEvaluationQuestion } from '../../lib/ai/sessionPreparationFactory'
import { questionSimilarity, type CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'

const activeRoute = readFileSync('app/api/adaptive/session-teach/route.ts','utf8')
assert.ok(activeRoute.indexOf('return await prepareSessionByFactory') < activeRoute.indexOf('runSessionContentGenerationPipeline<Record'))
assert.match(activeRoute,/teaching_generation[^]*evaluation_planning[^]*evaluation_block_generation[^]*incremental_evaluation_repair/)
assert.doesNotMatch(activeRoute.slice(0,activeRoute.indexOf('return await prepareSessionByFactory')),/SESSION_CONTENT_SPLIT_INVALID/)

const teaching: PreparedTeachingContent = { sessionId: 's1', title: 'Clase', introduction: 'Inicio', closing: 'Cierre', steps: Array.from({ length: 6 }, (_, i) => ({ stepId: `step_${i+1}`, id: `step_${i+1}`, microId: `micro_${i+1}`, title: `Paso ${i+1}`, type: 'concept', content: `Contenido ${i+1}`, keyPoints: [`Punto ${i+1}`], keyPointIds:[`kp_${i+1}`], factKeys: [`fact_${i+1}`], importance: i === 5 ? 'critical' : 'important', cognitiveTarget: 'comprehension', sourceReferences: [] })) }
const plan: EvaluationPlan = { blocks: [
  { blockId:'b1', afterStepId:'step_3', coveredStepIds:['step_1','step_2','step_3'], coveredKeyPointIds:['kp_1','kp_2','kp_3'], coveredFactKeys:['fact_1','fact_2','fact_3'], targetObjectiveIds:['o1','o2','o3'], cognitiveTargets:['comprehension'], recommendedQuestionCount:2, recommendedFormats:['multiple_choice'], difficulty:'medium' },
  { blockId:'b2', afterStepId:'step_6', coveredStepIds:['step_4','step_5','step_6'], coveredKeyPointIds:['kp_4','kp_5','kp_6'], coveredFactKeys:['fact_4','fact_5','fact_6'], targetObjectiveIds:['o4','o5','o6'], cognitiveTargets:['comprehension'], recommendedQuestionCount:2, recommendedFormats:['multiple_choice'], difficulty:'medium' },
] }
// Prompts topicamente distintos (no una plantilla con una sola palabra
// variable) — con diagnoseEvaluationBlock/diagnoseEvaluationCoverage ahora
// deduplicando también por similitud semántica (questionSimilarity>=0.8, ver
// regresión más abajo), placeholders tipo "Comprueba step_N" resultan
// semánticamente indistinguibles entre sí (comparten todo el vocabulario
// significativo) y se marcarían como duplicados entre ellos. Cada entrada
// aquí cubre un tema real distinto para que este fixture siga probando
// cobertura de pasos, no duplicados.
const QUESTION_TOPICS = [
  { text: '¿Qué papel cumple la fotosíntesis en la producción de energía celular?', options: ['La luz solar se convierte en glucosa', 'El oxígeno se convierte en dióxido de carbono'] },
  { text: 'Describe la función principal de la mitocondria dentro de la célula eucariota.', options: ['Genera ATP mediante respiración', 'Almacena información genética'] },
  { text: '¿Cuáles fueron las causas económicas que detonaron la revolución de 1910?', options: ['Desigualdad en la tenencia de tierra', 'Crecimiento del comercio exterior'] },
  { text: 'Calcula el cambio de entropía en un proceso termodinámico irreversible.', options: ['La entropía del universo aumenta', 'La entropía del universo permanece constante'] },
  { text: '¿Cómo afecta la gravedad la trayectoria de un proyectil lanzado horizontalmente?', options: ['Curva la trayectoria hacia abajo', 'Mantiene la trayectoria recta'] },
  { text: 'Identifica el comportamiento de los electrones en un enlace covalente polar.', options: ['Se comparten de forma desigual', 'Se transfieren completamente'] },
]
const q = (n:number, blockId:string, stepId:string): any => { const topic=QUESTION_TOPICS[(n-1)%QUESTION_TOPICS.length]; return { questionId:`q${n}`, id:`q${n}`, blockId, targetStepIds:[stepId], coveredStepIds:[stepId], targetKeyPointIds:[`kp_${n}`], targetFactKeys:[`fact_${n}`], targetObjectiveIds:[`o${n}`], cognitiveTarget:'comprehension', format:'multiple_choice', prompt:topic.text, questionText:topic.text, options:topic.options.map((text,i)=>({id:i===0?'a':'b',text})), correctAnswer:'a', feedback:'Explicación', explanation:'Explicación', difficulty:'medium' } }
const partial: PreparedEvaluationBlock[] = [
  { ...plan.blocks[0], questions:[q(1,'b1','step_1'),q(2,'b1','step_2'),q(3,'b1','step_3')] },
  { ...plan.blocks[1], questions:[q(4,'b2','step_4'),q(5,'b2','step_5')] },
]
assert.deepEqual(diagnoseEvaluationCoverage(teaching, partial).missingRequiredStepIds, ['step_6'])
let teachingCalls=0, planningCalls=0, blockCalls=0, repairCalls=0
const run = () => runSessionPreparationFactory({ sessionKind:'learning', generationKey:'same', evalPreference:'quick_test', load:async()=>null, persist:async()=>{}, generateTeaching:async()=>{teachingCalls++;return teaching}, planEvaluations:async()=>{planningCalls++;return plan}, generateEvaluationBlock:async block=>{blockCalls++;return partial.find(x=>x.blockId===block.blockId)!}, repairEvaluationBlock:async(block,missing,accepted)=>{repairCalls++;assert.equal(block.blockId,'b2');assert.deepEqual(missing.missingRequiredStepIds,['step_6']);assert.equal(accepted.length,2);return [q(6,'b2','step_6')]} })
async function main() {
  const [result, joined] = await Promise.all([run(),run()])
  assert.equal(result.preparationStatus,'ready'); assert.equal(joined.preparationStatus,'ready')
  assert.equal(teachingCalls,1); assert.equal(planningCalls,1); assert.equal(blockCalls,2); assert.equal(repairCalls,1)
  assert.deepEqual(result.generatedEvaluationBlocks[1].questions.map(x=>x.questionId),['q4','q5','q6'])

  let introTeaching=0, introPlanning=0
  const intro = await runSessionPreparationFactory({ sessionKind:'introduction',generationKey:'intro',evalPreference:'quick_test',load:async()=>null,persist:async()=>{},generateTeaching:async()=>{introTeaching++;return teaching},planEvaluations:async()=>{introPlanning++;return plan},generateEvaluationBlock:async()=>{throw new Error('forbidden')},repairEvaluationBlock:async()=>{throw new Error('forbidden')} })
  assert.equal(intro.preparationStatus,'ready'); assert.equal(intro.generatedEvaluationBlocks.length,0); assert.equal(introTeaching,1); assert.equal(introPlanning,0)

  const finalReview = await runSessionPreparationFactory({ sessionKind:'final_review',generationKey:'final',evalPreference:'quick_test',load:async()=>null,persist:async()=>{},generateTeaching:async()=>teaching,planEvaluations:async()=>{throw new Error('forbidden')},generateEvaluationBlock:async()=>{throw new Error('forbidden')},repairEvaluationBlock:async()=>{throw new Error('forbidden')} })
  assert.equal(finalReview.preparationStatus,'ready'); assert.deepEqual(finalReview.evaluationPlan?.blocks,[])

  let durable: any = null, restoreTeachingCalls=0, failedOnce=false
  const restoreInput = () => ({ sessionKind:'learning' as const,generationKey:'restore',evalPreference:'quick_test',load:async()=>durable,persist:async(s:any)=>{durable=structuredClone(s)},generateTeaching:async()=>{restoreTeachingCalls++;return teaching},planEvaluations:async()=>plan,generateEvaluationBlock:async(block:any)=>{if(block.blockId==='b2'&&!failedOnce){failedOnce=true;throw new Error('temporary')}return partial.find(x=>x.blockId===block.blockId)!},repairEvaluationBlock:async(block:any)=>[q(6,block.blockId,'step_6')] })
  const interrupted=await runSessionPreparationFactory(restoreInput()); assert.equal(interrupted.preparationStatus,'technical_retry_required'); assert.ok(interrupted.teachingContent)
  const restored=await runSessionPreparationFactory(restoreInput()); assert.equal(restored.preparationStatus,'ready'); assert.equal(restoreTeachingCalls,1)

  const invalidPartial: PreparedEvaluationBlock[] = [{...partial[0],questions:[q(1,'b1','step_1'),q(2,'b1','step_2'),{...q(3,'b1','step_3'),targetStepIds:[]}]},partial[1]]
  const invalidDiagnosis=diagnoseEvaluationCoverage(teaching,invalidPartial); assert.deepEqual(invalidDiagnosis.invalidQuestionIds,['q3']); assert.ok(invalidDiagnosis.affectedBlockIds.includes('b1'))

  // ---------------------------------------------------------------------------
  // REGRESSION: bug real reportado en prueba manual con CLUTCH 1 ("La Química
  // de los Pares Conjugados"). /api/adaptive/session-teach tardó ~120s y
  // terminó en 503 SESSION_PREPARATION_VALIDATION_FAILED /
  // SESSION_EVALUATION_INVALID:duplicate_question:eval_7_6 en
  // stage:session_assembly_validation, con todos los bloques ya marcados
  // EVALUATION_COMPLETE por diagnoseEvaluationBlock.
  //
  // Causa raíz: diagnoseEvaluationBlock solo detectaba duplicados LITERALES
  // (signature() — mismo prompt exacto, normalizado). Una pregunta de repair
  // que parafrasea una accepted question ya preservada (prompt distinto,
  // mismo contenido, questionSimilarity>=0.8 — el mismo umbral que usa el
  // guard final en sessionEvaluation.ts) pasaba diagnoseEvaluationBlock como
  // EVALUATION_COMPLETE, tanto dentro del mismo bloque como entre bloques
  // distintos (no había ningún chequeo cross-block), y solo se detectaba en
  // la canonicalización final — después de pagar todos los provider calls.
  // ---------------------------------------------------------------------------
  const dupTeaching: PreparedTeachingContent = { sessionId:'s-dup', title:'Ácidos y bases', introduction:'Inicio', closing:'Cierre', steps:[
    { stepId:'d1', id:'d1', microId:'m1', title:'pH y equilibrio', type:'concept', content:'contenido d1', keyPoints:['Efecto del pH bajo'], keyPointIds:['dkp_1'], factKeys:['dfact_1'], importance:'important', cognitiveTarget:'comprehension', sourceReferences:[] },
    { stepId:'d2', id:'d2', microId:'m2', title:'Capacidad amortiguadora', type:'concept', content:'contenido d2', keyPoints:['Neutralización del buffer'], keyPointIds:['dkp_2'], factKeys:['dfact_2'], importance:'important', cognitiveTarget:'comprehension', sourceReferences:[] },
    { stepId:'d3', id:'d3', microId:'m3', title:'Selectividad iónica', type:'concept', content:'contenido d3', keyPoints:['Fuerza del par conjugado'], keyPointIds:['dkp_3'], factKeys:['dfact_3'], importance:'important', cognitiveTarget:'comprehension', sourceReferences:[] },
  ] }
  const dupPlan: EvaluationPlan = { blocks:[
    { blockId:'db1', afterStepId:'d1', coveredStepIds:['d1'], coveredKeyPointIds:['dkp_1'], coveredFactKeys:['dfact_1'], targetObjectiveIds:['do1'], cognitiveTargets:['comprehension'], recommendedQuestionCount:1, recommendedFormats:['multiple_choice'], difficulty:'medium' },
    { blockId:'db2', afterStepId:'d2', coveredStepIds:['d2'], coveredKeyPointIds:['dkp_2'], coveredFactKeys:['dfact_2'], targetObjectiveIds:['do2'], cognitiveTargets:['comprehension'], recommendedQuestionCount:1, recommendedFormats:['multiple_choice'], difficulty:'medium' },
    { blockId:'db3', afterStepId:'d3', coveredStepIds:['d3'], coveredKeyPointIds:['dkp_3'], coveredFactKeys:['dfact_3'], targetObjectiveIds:['do3'], cognitiveTargets:['comprehension'], recommendedQuestionCount:1, recommendedFormats:['multiple_choice'], difficulty:'medium' },
  ] }
  const dupOptions = [{id:'a',text:'Predomina la forma ácida del par conjugado'},{id:'b',text:'Predomina la forma básica del par conjugado'}]
  const qOriginal: PreparedEvaluationQuestion = { questionId:'qb1', id:'qb1', blockId:'db1', targetStepIds:['d1'], coveredStepIds:['d1'], targetKeyPointIds:['dkp_1'], targetFactKeys:['dfact_1'], targetObjectiveIds:['do1'], cognitiveTarget:'comprehension', format:'multiple_choice', prompt:'Según el material, ¿qué ocurre cuando el pH del sistema disminuye por debajo de siete?', questionText:'Según el material, ¿qué ocurre cuando el pH del sistema disminuye por debajo de siete?', options:dupOptions, correctAnswer:'a', feedback:'Explicación', explanation:'Explicación', difficulty:'medium' }
  const qParaphrase: PreparedEvaluationQuestion = { ...qOriginal, questionId:'qb2', id:'qb2', blockId:'db2', targetStepIds:['d2'], coveredStepIds:['d2'], targetKeyPointIds:['dkp_2'], targetFactKeys:['dfact_2'], targetObjectiveIds:['do2'], prompt:'De acuerdo con el material, ¿qué sucede cuando el pH del sistema disminuye por debajo de siete?', questionText:'De acuerdo con el material, ¿qué sucede cuando el pH del sistema disminuye por debajo de siete?' }
  const qDistinct: PreparedEvaluationQuestion = { ...qOriginal, questionId:'qb3', id:'qb3', blockId:'db3', targetStepIds:['d3'], coveredStepIds:['d3'], targetKeyPointIds:['dkp_3'], targetFactKeys:['dfact_3'], targetObjectiveIds:['do3'], prompt:'¿Qué papel cumple el componente básico del buffer al añadir una base fuerte?', questionText:'¿Qué papel cumple el componente básico del buffer al añadir una base fuerte?', options:[{id:'a',text:'Neutraliza el ácido añadido'},{id:'b',text:'Neutraliza la base añadida'}] }

  // El par realmente es un parafraseo semántico (no un falso positivo) y el
  // distinto realmente no lo es — si esto no fuera así, el resto del test no
  // probaría nada.
  assert.ok(questionSimilarity(qOriginal as unknown as CanonicalQuestion, qParaphrase as unknown as CanonicalQuestion) >= 0.8)
  assert.ok(questionSimilarity(qOriginal as unknown as CanonicalQuestion, qDistinct as unknown as CanonicalQuestion) < 0.8)

  // R1 — mismo punto donde execute() combina accepted+repaired DENTRO de un
  // bloque: el signature() literal no basta, la pregunta de repair parafrasea
  // una accepted question ya preservada del mismo bloque.
  const sameBlockDiagnosis = diagnoseEvaluationBlock(dupPlan.blocks[0], [qOriginal, { ...qParaphrase, blockId:'db1', targetStepIds:['d1'], targetKeyPointIds:['dkp_1'], targetFactKeys:['dfact_1'] }], dupTeaching, 'mixed')
  assert.equal(sameBlockDiagnosis.code, 'PARTIAL_EVALUATION_COVERAGE')
  assert.deepEqual(sameBlockDiagnosis.duplicateQuestionIds, ['qb2'])
  assert.deepEqual(sameBlockDiagnosis.acceptedQuestionIds, ['qb1'])

  // R2 — CROSS-BLOCK: db2 solo tiene la pregunta parafraseada de qb1 (que vive
  // en db1). Antes del fix, diagnoseEvaluationCoverage nunca comparaba entre
  // bloques, así que esto pasaba EVALUATION_COMPLETE en ambos bloques.
  const crossBlockBlocks: PreparedEvaluationBlock[] = [
    { ...dupPlan.blocks[0], questions:[qOriginal] },
    { ...dupPlan.blocks[1], questions:[qParaphrase] },
    { ...dupPlan.blocks[2], questions:[qDistinct] },
  ]
  const crossBlockDiagnosis = diagnoseEvaluationCoverage(dupTeaching, crossBlockBlocks)
  assert.equal(crossBlockDiagnosis.code, 'PARTIAL_EVALUATION_COVERAGE')
  assert.deepEqual(crossBlockDiagnosis.affectedBlockIds, ['db2'])
  assert.ok(crossBlockDiagnosis.duplicateQuestionIds.includes('qb2'))
  // Asimetría deliberada ("primero gana", igual que el dedup literal
  // intra-bloque): db1 llegó primero en el plan y NO debe marcarse afectado
  // solo porque un bloque posterior lo parafrasea — eso forzaría un repair
  // innecesario del bloque que en realidad es el original.
  assert.ok(!crossBlockDiagnosis.affectedBlockIds.includes('db1'))

  // R3 — reproducción end-to-end EXACTA del patrón reportado: varios bloques
  // parcialmente válidos → accepted questions preservadas → repairs
  // incrementales → cada bloque termina EVALUATION_COMPLETE → el assembly
  // global (generatedEvaluationBlocks completo, todas las preguntas) no debe
  // contener ningún par duplicado, ni siquiera cross-block. También verifica
  // que teachingPreserved:true permite reintentar sin regenerar innecesariamente
  // la enseñanza ni los bloques ya buenos — solo el bloque que de verdad falló
  // vuelve a llamar al provider.
  const qDupRepairAttempt: PreparedEvaluationQuestion = { ...qParaphrase, questionId:'qb2-attempt1-dup', id:'qb2-attempt1-dup' }
  const qCleanRepairAttempt: PreparedEvaluationQuestion = { ...qDistinct, questionId:'qb2-attempt2-ok', id:'qb2-attempt2-ok', blockId:'db2', targetStepIds:['d2'], targetKeyPointIds:['dkp_2'], targetFactKeys:['dfact_2'], targetObjectiveIds:['do2'], prompt:'¿Qué compuesto del buffer reacciona cuando se agrega un ácido fuerte al sistema?', questionText:'¿Qué compuesto del buffer reacciona cuando se agrega un ácido fuerte al sistema?' }
  assert.ok(questionSimilarity(qOriginal as unknown as CanonicalQuestion, qCleanRepairAttempt as unknown as CanonicalQuestion) < 0.8)

  let e2eTeachingCalls=0; const e2eBlockCalls: Record<string,number> = {}; let e2eRepairAttempts=0
  let e2eDurable: any = null
  const e2eInput = () => ({
    sessionKind:'learning' as const, generationKey:'dup-e2e', evalPreference:'mixed',
    load: async () => e2eDurable,
    persist: async (s: any) => { e2eDurable = structuredClone(s) },
    generateTeaching: async () => { e2eTeachingCalls++; return dupTeaching },
    planEvaluations: async () => dupPlan,
    generateEvaluationBlock: async (block: any) => {
      e2eBlockCalls[block.blockId] = (e2eBlockCalls[block.blockId] || 0) + 1
      if (block.blockId === 'db1') return { ...block, questions: [qOriginal] }
      if (block.blockId === 'db3') return { ...block, questions: [qDistinct] }
      return { ...block, questions: [] } // db2 arranca sin preguntas: fuerza repair
    },
    repairEvaluationBlock: async (block: any) => {
      e2eRepairAttempts++
      // Primer intento: reproduce el bug real — el repair genera una pregunta
      // que parafrasea (no duplica literalmente) una accepted question de
      // OTRO bloque ya preservado (db1). Segundo intento (tras retry): repair
      // "real" produce una pregunta genuinamente distinta.
      return [e2eRepairAttempts === 1 ? qDupRepairAttempt : qCleanRepairAttempt]
    },
  })

  const firstAttempt = await runSessionPreparationFactory(e2eInput())
  // El duplicado NUNCA debe llegar como sesión lista — debe fallar rápido y
  // preservar teaching + los bloques ya buenos para el retry, no descartar
  // silenciosamente el problema ni aceptar la sesión con el duplicado dentro.
  assert.equal(firstAttempt.preparationStatus, 'technical_retry_required')
  assert.ok(firstAttempt.teachingContent, 'teachingPreserved: la enseñanza debe sobrevivir al fallo de repair')
  assert.ok(!firstAttempt.generatedEvaluationBlocks.flatMap(b => b.questions).some(q => q.questionId === 'qb2-attempt1-dup'), 'el duplicado no debe quedar persistido como aceptado')

  const secondAttempt = await runSessionPreparationFactory(e2eInput())
  assert.equal(secondAttempt.preparationStatus, 'ready')
  assert.equal(e2eTeachingCalls, 1, 'retry no debe regenerar los pasos de enseñanza (teachingPreserved real, no solo declarado)')
  assert.deepEqual(e2eBlockCalls, { db1: 1, db2: 1, db3: 1 }, 'retry no debe re-generar bloques ya buenos — solo el repair del bloque afectado se reintenta')
  assert.equal(e2eRepairAttempts, 2)

  const allFinalQuestions = secondAttempt.generatedEvaluationBlocks.flatMap(b => b.questions)
  assert.equal(allFinalQuestions.length, 3)
  assert.ok(allFinalQuestions.some(q => q.questionId === 'qb2-attempt2-ok'), 'el bloque reparado debe quedar con la pregunta limpia, no la descartada')
  for (let i = 0; i < allFinalQuestions.length; i += 1) {
    for (let j = i + 1; j < allFinalQuestions.length; j += 1) {
      const similarity = questionSimilarity(allFinalQuestions[i] as unknown as CanonicalQuestion, allFinalQuestions[j] as unknown as CanonicalQuestion)
      assert.ok(similarity < 0.8, `assembly global no debe contener duplicados: ${allFinalQuestions[i].questionId} vs ${allFinalQuestions[j].questionId} = ${similarity}`)
    }
  }
  for (const block of secondAttempt.generatedEvaluationBlocks) {
    assert.equal(diagnoseEvaluationBlock(dupPlan.blocks.find(b => b.blockId === block.blockId)!, block.questions, dupTeaching, 'mixed').code, 'EVALUATION_COMPLETE')
  }

  console.log('session-preparation-factory-contracts: PASS')
}
void main()
