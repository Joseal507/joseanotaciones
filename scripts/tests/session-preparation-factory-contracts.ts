import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canonicalQuestionValidationForPreparation, diagnoseEvaluationBlock, diagnoseEvaluationCoverage, runSessionPreparationFactory, type PreparedTeachingContent, type EvaluationPlan, type PreparedEvaluationBlock, type PreparedEvaluationQuestion } from '../../lib/ai/sessionPreparationFactory'
import { normalizeGeneratedQuestion, questionSimilarity, validateQuestion, type CanonicalQuestion, type GenerationContext } from '../../lib/adaptive/evaluation/questionContract'
import { validateQuestionTypeForMode } from '../../lib/adaptive/evaluation/evaluationModeContract'

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
  const interrupted=await runSessionPreparationFactory(restoreInput()); assert.equal(interrupted.preparationStatus,'ready'); assert.ok(interrupted.teachingContent)
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
  assert.equal(sameBlockDiagnosis.code, 'EVALUATION_COMPLETE')
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
  assert.equal(firstAttempt.preparationStatus, 'ready', 'el segundo intento interno acotado debe reparar sin exponer un fallo al usuario')
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

  // ---------------------------------------------------------------------------
  // REGRESSION: bug real (StudyAL_Visual_System_Stress_Test, chapter_2,
  // evalPreference=quick_test). /api/adaptive/session-teach generó 12 bloques,
  // pagó ~18 remote calls (~128s) y terminó en 503
  // SESSION_PREPARATION_VALIDATION_FAILED / SESSION_EVALUATION_INVALID:eval_2_3:
  // EVALUATION_MODE_VIOLATION en session_assembly_validation — con TODOS los
  // bloques ya marcados EVALUATION_COMPLETE por diagnoseEvaluationBlock.
  //
  // Causa raíz: diagnoseEvaluationBlock (arriba, formatOk) usaba
  // `allowedEvaluationFormats` (= TODOS los formatos canónicos, sin distinción
  // de modo) en vez de la autoridad real de modo (validateQuestionTypeForMode,
  // la MISMA que usa questionContract.validateQuestion en la canonicalización
  // final). Para evaluationPreference==='quick_test' el chequeo era una
  // tautología (short_response SÍ está en `allowedEvaluationFormats`, así que
  // nunca se rechazaba); para CUALQUIER OTRO modo el chequeo de formato se
  // saltaba por completo (`evaluationPreference!=='quick_test'` cortocircuita a
  // true). Una pregunta de formato escrito sobrevivía accepted/incremental
  // repair y solo se rechazaba en la canonicalización final, después de pagar
  // TODOS los provider calls — nunca con un repair dirigido a tiempo.
  // ---------------------------------------------------------------------------
  const modeTeaching: PreparedTeachingContent = { sessionId:'s-mode', title:'Pruebas visuales', introduction:'Inicio', closing:'Cierre', steps:[
    { stepId:'m1', id:'m1', microId:'mm1', title:'Propósito de las pruebas visuales', type:'concept', content:'contenido m1', keyPoints:['Claridad y precisión de representaciones gráficas'], keyPointIds:['mkp_1'], factKeys:['mfact_1'], importance:'important', cognitiveTarget:'comprehension', sourceReferences:[] },
    { stepId:'m2', id:'m2', microId:'mm2', title:'Tipos de pruebas visuales', type:'concept', content:'contenido m2', keyPoints:['Tablas ICE, diagramas de cuerpo libre y estructuras moleculares'], keyPointIds:['mkp_2'], factKeys:['mfact_2'], importance:'important', cognitiveTarget:'comprehension', sourceReferences:[] },
  ] }
  const modeBlock: EvaluationPlan['blocks'][number] = { blockId:'mb1', afterStepId:'m2', coveredStepIds:['m1','m2'], coveredKeyPointIds:['mkp_1','mkp_2'], coveredFactKeys:['mfact_1','mfact_2'], targetObjectiveIds:['mo1','mo2'], cognitiveTargets:['comprehension'], recommendedQuestionCount:2, recommendedFormats:['multiple_choice'], difficulty:'medium' }
  const qClosed: PreparedEvaluationQuestion = { questionId:'eval_2_1', id:'eval_2_1', blockId:'mb1', targetStepIds:['m1'], coveredStepIds:['m1'], targetKeyPointIds:['mkp_1'], targetFactKeys:['mfact_1'], targetObjectiveIds:['mo1'], cognitiveTarget:'comprehension', format:'multiple_choice', variant:'mcq_best_answer', prompt:'¿Cuál es el propósito principal de las pruebas visuales en StudyAL?', questionText:'¿Cuál es el propósito principal de las pruebas visuales en StudyAL?', options:[{id:'a',text:'Validar claridad y precisión de representaciones gráficas'},{id:'b',text:'Medir la velocidad de carga de la página'}], correctAnswer:'a', feedback:'Explicación', explanation:'Explicación', difficulty:'medium' }
  const qWritten: PreparedEvaluationQuestion = { questionId:'eval_2_3', id:'eval_2_3', blockId:'mb1', targetStepIds:['m2'], coveredStepIds:['m2'], targetKeyPointIds:['mkp_2'], targetFactKeys:['mfact_2'], targetObjectiveIds:['mo2'], cognitiveTarget:'comprehension', format:'short_response', variant:'short_answer_define', prompt:'Explica con tus propias palabras qué tipos de pruebas visuales existen en StudyAL.', questionText:'Explica con tus propias palabras qué tipos de pruebas visuales existen en StudyAL.', options:null, correctAnswer:'Tablas ICE, diagramas de cuerpo libre y estructuras moleculares', feedback:'Explicación', explanation:'Explicación', difficulty:'medium' }

  // A — quick_test: la pregunta escrita (formato prohibido, WRITING_FORMATS)
  // debe caer en invalid, NUNCA en accepted — este es exactamente eval_2_3 del
  // bug real.
  const quickDiagnosis = diagnoseEvaluationBlock(modeBlock as any, [qClosed, qWritten], modeTeaching, 'quick_test')
  assert.deepEqual(quickDiagnosis.acceptedQuestionIds, ['eval_2_1'], 'A: quick_test debe aceptar solo la pregunta cerrada')
  assert.deepEqual(quickDiagnosis.invalidQuestionIds, ['eval_2_3'], 'A: quick_test debe invalidar la pregunta escrita — este es el bug real (eval_2_3)')
  assert.equal(quickDiagnosis.code, 'PARTIAL_EVALUATION_COVERAGE', 'A: una pregunta inválida debe disparar requiredReplacementCount, no EVALUATION_COMPLETE')

  // B — PATRÓN GENERAL (no solo quick_test): read_only prohíbe TODOS los
  // formatos (allowedQuestionTypes:[] en evaluationModeContract.ts). Antes del
  // fix, `evaluationPreference!=='quick_test'` cortocircuitaba a formatOk=true
  // para CUALQUIER modo que no fuera literalmente 'quick_test' — read_only
  // aceptaba TODO sin chequear nada. Esta es la prueba de que el fix es
  // general, no un parche específico para eval_2_3/quick_test.
  const readOnlyDiagnosis = diagnoseEvaluationBlock(modeBlock as any, [qClosed], modeTeaching, 'read_only')
  assert.deepEqual(readOnlyDiagnosis.invalidQuestionIds, ['eval_2_1'], 'B: read_only debe invalidar incluso una pregunta cerrada — antes del fix esto pasaba sin chequeo alguno')
  assert.deepEqual(readOnlyDiagnosis.acceptedQuestionIds, [], 'B: read_only no debe aceptar ninguna pregunta')

  // C — mix_everything acepta AMBOS formatos cuando pedagógicamente corresponde
  // (regresión contra sobre-restringir: el fix no debe volverse más estricto de
  // lo que el contrato real permite).
  const mixedDiagnosis = diagnoseEvaluationBlock(modeBlock as any, [qClosed, qWritten], modeTeaching, 'mix_everything')
  assert.deepEqual(mixedDiagnosis.acceptedQuestionIds.sort(), ['eval_2_1', 'eval_2_3'], 'C: mix_everything debe aceptar cerradas Y escritas')
  assert.deepEqual(mixedDiagnosis.invalidQuestionIds, [], 'C: mix_everything no debe invalidar nada por formato')

  // D — el validador final (questionContract.validateQuestion, el mismo que
  // dispara SESSION_EVALUATION_INVALID:*:EVALUATION_MODE_VIOLATION en
  // sessionEvaluation.ts/canonicalizeGeneratedSession) sigue siendo
  // AUTORITATIVO e intacto — el fix vive en diagnoseEvaluationBlock, nunca
  // desactiva ni reemplaza este guard final.
  const modeContext: GenerationContext = { activeConceptId:'m2', activeConceptLabel:'Tipos de pruebas visuales', teachingBlockId:'m2', targetDimension:'comprehension', questionFamily:'short_response', allowedConceptIds:['m2'], forbiddenConceptIds:[], evaluationMode:'quick_test', factKeys:['mfact_2'], targetObjectiveIds:['mo2'] }
  const canonicalWritten = normalizeGeneratedQuestion({ ...qWritten, conceptId:'m2', conceptLabel:'Tipos de pruebas visuales', questionText:qWritten.prompt }, modeContext, 'eval_2_3')
  assert.ok(canonicalWritten, 'D: fixture debe normalizar a un CanonicalQuestion válido')
  const finalValidation = validateQuestion(canonicalWritten!, modeContext, [])
  assert.ok(finalValidation.errors.includes('EVALUATION_MODE_VIOLATION'), 'D: el validador final debe seguir rechazando por modo, independientemente del fix en diagnoseEvaluationBlock')

  // E — end-to-end (runSessionPreparationFactory): reproduce el flujo real
  // completo. Primer intento de repair TAMBIÉN viola el modo (el replacement se
  // vuelve a validar, no se acepta ciegamente) → falla rápido, preserva
  // teaching y la pregunta válida. Segundo intento (retry) con un replacement
  // que sí cumple quick_test → sesión lista, SIN duplicados, SIN regenerar el
  // bloque completo (generateEvaluationBlock solo se llama una vez).
  const qWrittenReplacementStillInvalid: PreparedEvaluationQuestion = { ...qWritten, questionId:'eval_2_3_repair_attempt1', id:'eval_2_3_repair_attempt1', prompt:'Describe con tus propias palabras cómo se valida una tabla ICE en StudyAL.', questionText:'Describe con tus propias palabras cómo se valida una tabla ICE en StudyAL.' }
  const qClosedReplacementValid: PreparedEvaluationQuestion = { ...qClosed, questionId:'eval_2_3_repair_attempt2', id:'eval_2_3_repair_attempt2', targetStepIds:['m2'], coveredStepIds:['m2'], targetKeyPointIds:['mkp_2'], targetFactKeys:['mfact_2'], targetObjectiveIds:['mo2'], prompt:'¿Qué tipos de pruebas visuales se validan en StudyAL según el material?', questionText:'¿Qué tipos de pruebas visuales se validan en StudyAL según el material?', options:[{id:'a',text:'Tablas ICE, diagramas de cuerpo libre y estructuras moleculares'},{id:'b',text:'Solo capturas de pantalla'}] }

  let e2eModeBlockCalls = 0, e2eModeRepairAttempts = 0, e2eModeDurable: any = null
  const e2eModeInput = () => ({
    sessionKind:'learning' as const, generationKey:'mode-e2e', evalPreference:'quick_test',
    load: async () => e2eModeDurable,
    persist: async (s: any) => { e2eModeDurable = structuredClone(s) },
    generateTeaching: async () => modeTeaching,
    planEvaluations: async () => ({ blocks:[modeBlock] }) as EvaluationPlan,
    generateEvaluationBlock: async (block: any) => { e2eModeBlockCalls++; return { ...block, questions:[qClosed, qWritten] } },
    repairEvaluationBlock: async () => { e2eModeRepairAttempts++; return [e2eModeRepairAttempts === 1 ? qWrittenReplacementStillInvalid : qClosedReplacementValid] },
  })

  const modeFirstAttempt = await runSessionPreparationFactory(e2eModeInput())
  assert.equal(modeFirstAttempt.preparationStatus, 'ready', 'E: el replacement incompatible se rechaza y el retry interno cerrado completa la sesión')
  assert.ok(modeFirstAttempt.teachingContent, 'E: teaching debe preservarse para el retry')
  assert.ok(!modeFirstAttempt.generatedEvaluationBlocks.flatMap(b => b.questions).some(q => q.questionId === 'eval_2_3_repair_attempt1'), 'E: el replacement inválido no debe quedar persistido como aceptado')

  const modeSecondAttempt = await runSessionPreparationFactory(e2eModeInput())
  assert.equal(modeSecondAttempt.preparationStatus, 'ready', 'E: un replacement que sí cumple el modo debe dejar la sesión lista')
  assert.equal(e2eModeBlockCalls, 1, 'E: el retry no debe regenerar el bloque completo — generateEvaluationBlock solo se llama una vez')
  assert.equal(e2eModeRepairAttempts, 2, 'E: solo el repair se reintenta, no la generación completa')
  const modeFinalQuestions = modeSecondAttempt.generatedEvaluationBlocks.flatMap(b => b.questions)
  assert.deepEqual(modeFinalQuestions.map(q => q.questionId).sort(), ['eval_2_1', 'eval_2_3_repair_attempt2'], 'E: cobertura preservada — la pregunta cerrada original + el replacement válido, sin duplicados ni pérdida')
  assert.equal(new Set(modeFinalQuestions.map(q => q.questionId)).size, modeFinalQuestions.length, 'E: sin IDs duplicados')

  // ---------------------------------------------------------------------------
  // REGRESSION (bug real, prueba manual, StudyAL_Visual_System_Stress_Test):
  // chapter_2:evaluation:3 — Gemini generó 4 preguntas: 3 válidas
  // (eval3-q1-mcq-forces, eval3-q3-truefalse-2methylbutano,
  // eval3-q4-mcq-program-execution) y 1 inválida (eval3-q2-matching-
  // representations, un matching con pares desplazados — ver
  // matchingValidator.ts). Diagnóstico global ANTES del fallo:
  // globalAcceptedQuestionCount=25, compatibleAcceptedQuestionCount=3,
  // missingRequiredStepIds=[], missingCriticalKeyPointIds=[],
  // missingImportantKeyPointIds=[], missingFactKeys=[] — es decir, lo
  // pedagógicamente obligatorio YA estaba 100% cubierto por las 3 válidas.
  // Pese a eso, requiredReplacementCount forzaba repair (por la mera
  // existencia de la inválida), y cuando el replacement de Gemini TAMBIÉN
  // fue inválido, INCREMENTAL_EVALUATION_REPAIR_VALIDATION_FAILED tumbaba la
  // sesión entera a technical_retry_required -> 503, pese a que ningún
  // requisito pedagógico obligatorio dejó de estar cubierto.
  //
  // A-H no hardcodean matching ni ningún JSON específico (regla explícita:
  // "NO hagas un parche específico para este JSON ni para esta pregunta") —
  // usan el mismo mecanismo YA validado en este archivo para simular una
  // pregunta estructuralmente inválida (targetStepIds:[] / correctAnswer
  // ausente), agnóstico de formato. Fixture conceptual: bloque b1 (steps
  // 1-3), 3 preguntas válidas cubren 1 tema cada una; el "4to slot" es la
  // pregunta inválida que en el caso real era el matching desplazado.
  // ---------------------------------------------------------------------------
  const teaching3: PreparedTeachingContent = { ...teaching, steps: teaching.steps.slice(0, 3) }
  const planB1Only: EvaluationPlan = { blocks: [plan.blocks[0]] }
  const gapTeaching: PreparedTeachingContent = { ...teaching3, steps: teaching3.steps.map((step, i) => i === 2 ? { ...step, importance: 'critical' } : step) }

  // A — 4 preguntas para b1: 3 válidas cubren TODO lo obligatorio del bloque
  // (step_1/kp_1/fact_1, step_2/kp_2/fact_2, step_3/kp_3/fact_3) + 1 inválida
  // redundante (targetStepIds:[]). El bloque debe quedar EVALUATION_COMPLETE
  // de inmediato — una pregunta inválida NUNCA debe forzar repair si lo
  // obligatorio ya está cubierto por las aceptadas.
  const validTrio = [q(1, 'b1', 'step_1'), q(2, 'b1', 'step_2'), q(3, 'b1', 'step_3')]
  const redundantInvalid = { ...q(4, 'b1', 'step_1'), questionId: 'q4-redundant-invalid', id: 'q4-redundant-invalid', targetStepIds: [] }
  {
    const aDiagnosis = diagnoseEvaluationBlock(plan.blocks[0], [...validTrio, redundantInvalid], teaching3, 'quick_test')
    assert.equal(aDiagnosis.code, 'EVALUATION_COMPLETE', 'A: cobertura ya completa por las 3 válidas — la inválida redundante no debe forzar PARTIAL_EVALUATION_COVERAGE')
    assert.equal(aDiagnosis.requiredReplacementCount, 0, 'A: requiredReplacementCount no debe contar la mera existencia de una pregunta inválida')
    assert.deepEqual(aDiagnosis.acceptedQuestionIds.sort(), ['q1', 'q2', 'q3'])
    assert.deepEqual(aDiagnosis.invalidQuestionIds, ['q4-redundant-invalid'])

    const aSession = await runSessionPreparationFactory({
      sessionKind: 'learning', generationKey: 'bugreal-a', evalPreference: 'quick_test',
      load: async () => null, persist: async () => {},
      generateTeaching: async () => teaching3,
      planEvaluations: async () => planB1Only,
      generateEvaluationBlock: async block => ({ ...block, questions: [...validTrio, redundantInvalid] }),
      repairEvaluationBlock: async () => { throw new Error('A: repair NUNCA debe invocarse cuando la cobertura obligatoria ya está completa') },
    })
    assert.equal(aSession.preparationStatus, 'ready', 'A: sesión debe quedar READY sin pasar por repair')
    assert.deepEqual(aSession.generatedEvaluationBlocks[0].questions.map(x => x.questionId).sort(), ['q1', 'q2', 'q3'], 'A: la pregunta inválida nunca debe persistirse')
  }

  // B — 2 válidas + 1 inválida que deja un critical key point sin cubrir
  // (step_3/kp_3, marcado 'critical' en gapTeaching): a diferencia de A, aquí
  // SÍ falta cobertura real tras descartar la inválida -> debe disparar
  // incremental repair.
  const gapAcceptedPair = [q(1, 'b1', 'step_1'), q(2, 'b1', 'step_2')]
  const gapInvalid = { ...q(3, 'b1', 'step_3'), questionId: 'q3-invalid', id: 'q3-invalid', targetStepIds: [] }
  {
    const bDiagnosis = diagnoseEvaluationBlock(planB1Only.blocks[0], [...gapAcceptedPair, gapInvalid], gapTeaching, 'quick_test')
    assert.equal(bDiagnosis.code, 'PARTIAL_EVALUATION_COVERAGE', 'B: falta step_3/kp_3 (critical) tras descartar la inválida — debe disparar repair')
    assert.deepEqual(bDiagnosis.missingRequiredStepIds, ['step_3'])
    assert.deepEqual(bDiagnosis.missingCriticalKeyPointIds, ['kp_3'])
    assert.equal(bDiagnosis.requiredReplacementCount, 1)
  }

  // C — invariante central del fix: el repair devuelve una pregunta
  // inválida, pero las preguntas YA aceptadas (accepted) ya cubrían el 100%
  // de lo obligatorio. La re-diagnosis post-repair (misma función que usa
  // execute() como única autoridad, ver sessionPreparationFactory.ts) debe
  // dar EVALUATION_COMPLETE — nunca 503 — sin importar qué tan inválida sea
  // la addition descartada.
  {
    const cInvalidRepairReplacement = { ...q(4, 'b1', 'step_1'), questionId: 'q-repair-invalid-c', id: 'q-repair-invalid-c', targetStepIds: [] }
    const cPostDiagnosis = diagnoseEvaluationBlock(plan.blocks[0], [...validTrio, cInvalidRepairReplacement], teaching3, 'quick_test')
    assert.equal(cPostDiagnosis.code, 'EVALUATION_COMPLETE', 'C: accepted existentes ya cubrían todo -> READY, la addition inválida del repair es irrelevante')
    assert.deepEqual(cPostDiagnosis.acceptedQuestionIds.sort(), ['q1', 'q2', 'q3'])
    assert.ok(cPostDiagnosis.invalidQuestionIds.includes('q-repair-invalid-c'))
  }

  // D — repair devuelve pregunta inválida y SIGUE faltando cobertura
  // obligatoria (step_3/kp_3 crítico nunca se llenó) -> fail closed real:
  // technical_retry_required, teaching preservado, el replacement inválido
  // nunca se persiste como aceptado.
  {
    const dSession = await runSessionPreparationFactory({
      sessionKind: 'learning', generationKey: 'bugreal-d', evalPreference: 'quick_test',
      load: async () => null, persist: async () => {},
      generateTeaching: async () => gapTeaching,
      planEvaluations: async () => planB1Only,
      generateEvaluationBlock: async block => ({ ...block, questions: [...gapAcceptedPair, gapInvalid] }),
      repairEvaluationBlock: async () => [{ ...q(3, 'b1', 'step_3'), questionId: 'q3-repair-invalid-d', id: 'q3-repair-invalid-d', targetStepIds: [] }],
    })
    assert.equal(dSession.preparationStatus, 'recoverable', 'D: sigue faltando cobertura -> no false READY, teaching preservado y continuación desde checkpoint')
    assert.ok(dSession.teachingContent, 'D: teaching debe sobrevivir al fallo de evaluation')
    assert.ok(!dSession.generatedEvaluationBlocks.flatMap(b => b.questions).some(x => x.questionId === 'q3-repair-invalid-d'), 'D: el replacement inválido nunca debe persistirse como aceptado')
  }

  // E — repair válido completa la cobertura real faltante -> READY, en un
  // solo intento (a diferencia de la regresión "E" de modo más arriba, que
  // necesita 2 intentos porque el primer replacement también es inválido).
  {
    const eSession = await runSessionPreparationFactory({
      sessionKind: 'learning', generationKey: 'bugreal-e', evalPreference: 'quick_test',
      load: async () => null, persist: async () => {},
      generateTeaching: async () => gapTeaching,
      planEvaluations: async () => planB1Only,
      generateEvaluationBlock: async block => ({ ...block, questions: [...gapAcceptedPair, gapInvalid] }),
      repairEvaluationBlock: async (block, missing, accepted) => {
        assert.deepEqual(missing.missingRequiredStepIds, ['step_3'], 'E: el repair debe recibir exactamente el hueco real, no la cuenta de inválidas')
        assert.equal(accepted.length, 2, 'E: el repair debe recibir las 2 preguntas ya aceptadas')
        return [{ ...q(3, 'b1', 'step_3'), questionId: 'q3-repair-valid-e', id: 'q3-repair-valid-e' }]
      },
    })
    assert.equal(eSession.preparationStatus, 'ready', 'E: repair válido debe completar cobertura y dejar la sesión lista')
    assert.deepEqual(eSession.generatedEvaluationBlocks[0].questions.map(x => x.questionId).sort(), ['q1', 'q2', 'q3-repair-valid-e'])
  }

  // F — una pregunta inválida NUNCA cuenta como cobertura, ni siquiera
  // cuando "reclama" (targetStepIds/targetKeyPointIds/targetFactKeys)
  // cubrir exactamente lo obligatorio — solo answerOk falla aquí
  // (correctAnswer ausente), targetStepIds/targetKeyPointIds/targetFactKeys
  // siguen apuntando, correctamente, a step_3/kp_3/fact_3.
  {
    const fInvalidClaim: PreparedEvaluationQuestion = { ...q(3, 'b1', 'step_3'), questionId: 'f-invalid-claim', id: 'f-invalid-claim', correctAnswer: undefined }
    const fDiagnosis = diagnoseEvaluationBlock(planB1Only.blocks[0], [q(1, 'b1', 'step_1'), q(2, 'b1', 'step_2'), fInvalidClaim], gapTeaching, 'quick_test')
    assert.deepEqual(fDiagnosis.invalidQuestionIds, ['f-invalid-claim'])
    assert.deepEqual(fDiagnosis.missingRequiredStepIds, ['step_3'], 'F: una inválida que RECLAMA cubrir step_3 no debe contar como cobertura real')
    assert.deepEqual(fDiagnosis.missingCriticalKeyPointIds, ['kp_3'])
    assert.deepEqual(fDiagnosis.missingFactKeys, ['fact_3'])
  }

  // G — concurrencia: mismo generationKey, 2 requests simultáneas, mismo
  // escenario de A (cobertura completa, 1 inválida redundante). No debe
  // duplicar NINGUNA llamada remota (teaching/planning/block), y repair
  // jamás debe invocarse (mock lanza si se invoca).
  {
    let gTeachingCalls = 0, gPlanningCalls = 0, gBlockCalls = 0
    const gRun = () => runSessionPreparationFactory({
      sessionKind: 'learning', generationKey: 'bugreal-g', evalPreference: 'quick_test',
      load: async () => null, persist: async () => {},
      generateTeaching: async () => { gTeachingCalls++; return teaching3 },
      planEvaluations: async () => { gPlanningCalls++; return planB1Only },
      generateEvaluationBlock: async block => { gBlockCalls++; return { ...block, questions: [...validTrio, redundantInvalid] } },
      repairEvaluationBlock: async () => { throw new Error('G: repair no debe invocarse — cobertura ya completa') },
    })
    const [gFirst, gSecond] = await Promise.all([gRun(), gRun()])
    assert.equal(gFirst.preparationStatus, 'ready'); assert.equal(gSecond.preparationStatus, 'ready')
    assert.equal(gTeachingCalls, 1, 'G: concurrencia no debe duplicar generación de teaching')
    assert.equal(gPlanningCalls, 1, 'G: concurrencia no debe duplicar planning')
    assert.equal(gBlockCalls, 1, 'G: concurrencia no debe duplicar generación del bloque')
  }

  // H — teaching persistido nunca debe perderse por un fallo de evaluation
  // repair, bajo la NUEVA política (fail-closed real, no la vieja
  // sobre-restrictiva) — mismo escenario de D, verificando además que el
  // contenido de teaching sobrevive intacto, no solo "presente".
  {
    const hSession = await runSessionPreparationFactory({
      sessionKind: 'learning', generationKey: 'bugreal-h', evalPreference: 'quick_test',
      load: async () => null, persist: async () => {},
      generateTeaching: async () => gapTeaching,
      planEvaluations: async () => planB1Only,
      generateEvaluationBlock: async block => ({ ...block, questions: [...gapAcceptedPair, gapInvalid] }),
      repairEvaluationBlock: async () => [{ ...q(3, 'b1', 'step_3'), questionId: 'q3-repair-invalid-h', id: 'q3-repair-invalid-h', targetStepIds: [] }],
    })
    assert.equal(hSession.preparationStatus, 'recoverable')
    assert.ok(hSession.teachingContent, 'H: teaching debe sobrevivir al fallo de evaluation')
    assert.deepEqual(hSession.teachingContent, gapTeaching, 'H: el contenido de teaching debe ser exactamente el generado, sin pérdida ni mutación')
  }

  // Chapter 3 / question:0:2 — paridad canónica y contrato sin teclado.
  const numeric = { ...q(1,'b1','step_1'), questionId:'chapter_3:evaluation:1:q3', id:'chapter_3:evaluation:1:q3', format:'numeric_problem', variant:'problem_solve', prompt:'Con 2 M iniciales y un cambio de 1 M, calcula la concentración final.', questionText:'Con 2 M iniciales y un cambio de 1 M, calcula la concentración final.', options:null, correctAnswer:{value:1,tolerance:0,unit:'M'} }
  assert.equal(diagnoseEvaluationBlock(plan.blocks[0],[numeric],teaching3,'quick_test').acceptedQuestionIds.length,0,'1: quick_test + numeric_problem nunca entra a accepted')
  assert.equal(diagnoseEvaluationBlock(modeBlock as any,[qWritten],modeTeaching,'quick_test').acceptedQuestionIds.length,0,'2: quick_test + short_response nunca entra a accepted')
  for (const format of ['multiple_choice','multi_select','true_false','matching','ordering','classify','word_bank','scenario','find_the_error']) {
    const mode = validateQuestionTypeForMode('quick_test',format)
    assert.equal(mode.valid,true,`3: ${format} debe estar permitido en quick_test`)
    if(mode.valid)assert.equal(mode.capabilities.requiresKeyboardComposition,false,`3: ${format} no debe requerir teclado`)
  }
  assert.equal(canonicalQuestionValidationForPreparation(numeric as any,teaching3,'mix_everything').valid,true,'4: mixed conserva numeric_problem numérico de aplicación')
  const symbolic = { ...numeric, questionId:'chapter_3-symbolic-2x', id:'chapter_3-symbolic-2x', correctAnswer:{value:'2x',tolerance:0,unit:'M'} }
  const symbolicCanonical = canonicalQuestionValidationForPreparation(symbolic as any,teaching3,'mix_everything')
  assert.equal(symbolicCanonical.valid,false,'6: 2x nunca normaliza como respuesta numérica canónica')
  assert.ok(symbolicCanonical.errors.includes('canonical_normalization_failed'))
  const canonicalCandidates = [q(1,'b1','step_1'),numeric as any]
  for(const candidate of canonicalCandidates){
    const accepted=diagnoseEvaluationBlock(plan.blocks[0],[candidate],teaching3,'mix_everything').acceptedQuestionIds.includes(candidate.questionId)
    const canonical=canonicalQuestionValidationForPreparation(candidate,teaching3,'mix_everything')
    assert.ok(!accepted||canonical.valid,`5/10: accepted ${candidate.questionId} necesariamente pasa el contrato canónico final`)
  }

  console.log('session-preparation-factory-contracts: bug real chapter_2:evaluation:3 (A-H) PASS')
  console.log('session-preparation-factory-contracts: chapter_3 quick_test/canonical parity (1-10) PASS')
  console.log('session-preparation-factory-contracts: PASS')
}
void main()
