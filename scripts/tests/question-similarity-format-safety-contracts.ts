import assert from 'node:assert/strict'
import { questionSimilarity, validateQuestion, type CanonicalQuestion, type GenerationContext } from '../../lib/adaptive/evaluation/questionContract'
import { presentAnswer } from '../../lib/adaptive/evaluation/answerPresentation'
import {
  diagnoseEvaluationBlock,
  acceptedQuestionsAcrossBlocks,
  runSessionPreparationFactory,
  type PreparedTeachingContent,
  type EvaluationPlan,
  type PreparedEvaluationQuestion,
  type PreparedEvaluationBlock,
  type SessionPreparationState,
} from '../../lib/ai/sessionPreparationFactory'

// BUG REAL (tercera prueba manual de producto) — chapter_6, bloque
// evaluation:4: 503 con "SESSION_PREPARATION_STAGE_FAILED — Cannot read
// properties of null (reading 'categories')". Stack real: choiceText
// (questionContract.ts) -> questionSimilarity -> isSemanticDuplicate
// (sessionPreparationFactory.ts) -> Array.some.
//
// CAUSA RAÍZ (reproducida exactamente antes del fix — no committeada):
// state.acceptedQuestions en sessionPreparationFactory.ts::execute() se
// acumulaba desde la lista CRUDA de preguntas generadas por bloque
// (versioned.questions), NO desde el subconjunto que diagnoseEvaluationBlock
// realmente marcó como acceptedQuestionIds. Esto ocurría en 4 puntos
// distintos del mismo archivo (restore-compat, loop principal, siblingAccepted
// de repair, y el rebuild post-repair) — y también dentro de
// diagnoseEvaluationCoverage (blocks.slice(0,index).flatMap(other=>other.
// questions)). Una pregunta classify_category estructuralmente inválida
// (options=null, cuando normalizeClassifyOptionsForFamily la rechaza) de un
// bloque anterior sobrevivía como "aceptada" y llegaba SIN VALIDAR a
// isSemanticDuplicate cuando un bloque posterior generaba una pregunta
// classify_category genuinamente válida — choiceText() intentaba leer
// null.categories (classify es el ÚNICO formato cuya forma válida NO es un
// array, así que es el único que hace question.options.categories sin pasar
// primero por el guard Array.isArray).
//
// FIX (2 capas, ninguna arregla solo classify_category):
// 1) RAÍZ: acceptedQuestionsAcrossBlocks(), única fuente de verdad para "qué
//    preguntas de una lista de bloques están realmente aceptadas" —
//    reemplaza las 5 acumulaciones crudas. Nunca más una pregunta
//    estructuralmente inválida cuenta como "aceptada".
// 2) DEFENSA EN PROFUNDIDAD (contrato explícito, genérico, para CUALQUIER
//    formato presente o futuro): choiceText() ya no accede
//    question.options.categories/.items sin comprobar que options es un
//    record y que categories/items son arrays; isSemanticDuplicate() nunca
//    propaga una excepción (try/catch -> false).

function baseQuestion(id: string, targetDimension: CanonicalQuestion['targetDimension'] = 'comprehension') {
  return {
    id, conceptId: 'c1', conceptLabel: 'Concepto', teachingBlockId: 'step_1',
    questionFamily: `family-${id}`, variant: 'mcq_best_answer', difficulty: 'medium' as const,
    targetDimension, questionText: `Texto de la pregunta ${id}, con suficiente longitud real.`,
    explanation: 'Explicación.', hint: 'Pista.', estimatedSeconds: 30, evidencesNeeded: 1, factKey: `fact-${id}`,
  }
}

// ═══ Fixtures válidas — una por cada uno de los 11 formatos canónicos ═══
function validMultipleChoice(id: string): CanonicalQuestion {
  return { ...baseQuestion(id), format: 'multiple_choice', options: [{ id: 'a', text: 'Opción A' }, { id: 'b', text: 'Opción B' }], correctAnswer: 'a' } as CanonicalQuestion
}
function validMultiSelect(id: string): CanonicalQuestion {
  return { ...baseQuestion(id), format: 'multi_select', options: [{ id: 'a', text: 'Opción A' }, { id: 'b', text: 'Opción B' }], correctAnswer: ['a', 'b'] } as CanonicalQuestion
}
function validTrueFalse(id: string): CanonicalQuestion {
  return { ...baseQuestion(id), format: 'true_false', options: null, correctAnswer: true } as CanonicalQuestion
}
function validWordBank(id: string): CanonicalQuestion {
  return { ...baseQuestion(id), format: 'word_bank', options: [{ id: 'w1', text: 'palabra' }], correctAnswer: ['w1'] } as CanonicalQuestion
}
function validOrdering(id: string): CanonicalQuestion {
  return { ...baseQuestion(id), format: 'ordering', options: [{ id: 'a', text: 'Paso 1' }, { id: 'b', text: 'Paso 2' }], correctAnswer: ['a', 'b'] } as CanonicalQuestion
}
function validMatching(id: string): CanonicalQuestion {
  return {
    ...baseQuestion(id), format: 'matching',
    options: [{ id: 'p1', left: 'Izq', right: 'Der', rightId: 'm1' }],
    correctAnswer: { p1: 'm1' }, matchingSemantics: 'bijective', matchingOptionOrder: ['m1'],
  } as CanonicalQuestion
}
function validClassify(id: string): CanonicalQuestion {
  return {
    ...baseQuestion(id), format: 'classify',
    options: { categories: ['Base Fuerte', 'No Base Fuerte'], items: [{ id: 'i1', text: 'NaOH', category: 'Base Fuerte' }, { id: 'i2', text: 'NH3', category: 'No Base Fuerte' }] },
    correctAnswer: { i1: 'Base Fuerte', i2: 'No Base Fuerte' },
  } as CanonicalQuestion
}
function validScenario(id: string): CanonicalQuestion {
  return { ...baseQuestion(id), format: 'scenario', options: [{ id: 'a', text: 'Acción A' }, { id: 'b', text: 'Acción B' }], correctAnswer: 'a' } as CanonicalQuestion
}
function validFindTheError(id: string): CanonicalQuestion {
  return { ...baseQuestion(id), format: 'find_the_error', options: [{ id: 'a', text: 'Error A' }, { id: 'b', text: 'Error B' }], correctAnswer: 'a' } as CanonicalQuestion
}
function validNumericProblem(id: string): CanonicalQuestion {
  return { ...baseQuestion(id), format: 'numeric_problem', options: null, correctAnswer: { value: 5, tolerance: 0.1, unit: 'mol/L' } } as CanonicalQuestion
}
function validShortResponse(id: string): CanonicalQuestion {
  return { ...baseQuestion(id), format: 'short_response', options: null, correctAnswer: 'Respuesta abierta.' } as CanonicalQuestion
}

const VALID_BUILDERS: Record<string, (id: string) => CanonicalQuestion> = {
  multiple_choice: validMultipleChoice, multi_select: validMultiSelect, true_false: validTrueFalse,
  word_bank: validWordBank, ordering: validOrdering, matching: validMatching, classify: validClassify,
  scenario: validScenario, find_the_error: validFindTheError, numeric_problem: validNumericProblem,
  short_response: validShortResponse,
}

// ═══ 4 — Matriz: los 11 formatos canónicos x forma real de options x
// choiceText/questionSimilarity soportan sin excepción ═══
function testFormatMatrix() {
  const formats = Object.keys(VALID_BUILDERS)
  assert.equal(formats.length, 11, 'deben auditarse los 11 formatos canónicos de CANONICAL_QUESTION_FORMATS')
  const rows: string[] = []
  for (const format of formats) {
    const question = VALID_BUILDERS[format](`${format}-1`)
    const optionsShape = Array.isArray(question.options)
      ? 'array'
      : question.options === null
        ? 'null'
        : typeof question.options === 'object'
          ? 'object {categories,items}'
          : typeof question.options
    let threw = false
    try { questionSimilarity(question, question) } catch { threw = true }
    assert.equal(threw, false, `matriz: ${format} (options=${optionsShape}) NO debe lanzar excepción en questionSimilarity`)
    rows.push(`${format.padEnd(16)} | options=${optionsShape.padEnd(24)} | choiceText soporta=sí | questionSimilarity soporta=sí | excepción=no`)
  }
  console.log('\n=== MATRIZ DE FORMATOS (choiceText / questionSimilarity) ===')
  for (const row of rows) console.log(row)
  console.log('classify es el ÚNICO formato cuya forma válida NO es un array — por eso es el único que necesitaba el guard adicional en choiceText.\n')
}

// ═══ Requisito mínimo explícito: classify_category válido vs MCQ ═══
function testClassifyVsMcq() {
  assert.doesNotThrow(() => questionSimilarity(validClassify('c1'), validMultipleChoice('m1')), 'classify válido vs MCQ no debe lanzar')
}

// ═══ classify_category válido vs classify_category ═══
function testClassifyVsClassify() {
  assert.doesNotThrow(() => questionSimilarity(validClassify('c1'), validClassify('c2')), 'classify válido vs classify válido no debe lanzar')
}

// ═══ options=null para CADA formato (no solo classify) ═══
function testOptionsNullForEveryFormat() {
  for (const format of Object.keys(VALID_BUILDERS)) {
    const broken = { ...VALID_BUILDERS[format](`${format}-null`), options: null } as CanonicalQuestion
    assert.doesNotThrow(() => questionSimilarity(broken, VALID_BUILDERS[format](`${format}-ref`)), `options=null (${format}) no debe lanzar`)
    assert.doesNotThrow(() => questionSimilarity(VALID_BUILDERS[format](`${format}-ref2`), broken), `options=null (${format}) como segundo argumento no debe lanzar`)
  }
}

// ═══ options={} (objeto vacío, no null — clave para classify: categories/
// items serían undefined, spread de undefined también lanzaría sin el fix) ═══
function testOptionsEmptyObjectForEveryFormat() {
  for (const format of Object.keys(VALID_BUILDERS)) {
    const broken = { ...VALID_BUILDERS[format](`${format}-empty`), options: {} } as unknown as CanonicalQuestion
    assert.doesNotThrow(() => questionSimilarity(broken, VALID_BUILDERS[format](`${format}-ref`)), `options={} (${format}) no debe lanzar`)
  }
}

// ═══ matching / word_bank / true_false sin options — explícitamente pedidos ═══
function testSpecificFormatsExplicit() {
  assert.doesNotThrow(() => questionSimilarity(validMatching('mt1'), validMatching('mt2')))
  assert.doesNotThrow(() => questionSimilarity({ ...validMatching('mt3'), options: null } as unknown as CanonicalQuestion, validMatching('mt4')))
  assert.doesNotThrow(() => questionSimilarity(validWordBank('wb1'), validWordBank('wb2')))
  assert.doesNotThrow(() => questionSimilarity({ ...validWordBank('wb3'), options: null } as unknown as CanonicalQuestion, validWordBank('wb4')))
  assert.doesNotThrow(() => questionSimilarity(validTrueFalse('tf1'), validTrueFalse('tf2')), 'true_false sin options (null por diseño) no debe lanzar')
}

// ═══ numeric_problem / short_response (open response) ═══
function testNumericAndOpenResponse() {
  assert.doesNotThrow(() => questionSimilarity(validNumericProblem('n1'), validNumericProblem('n2')))
  assert.doesNotThrow(() => questionSimilarity(validShortResponse('s1'), validShortResponse('s2')))
  assert.doesNotThrow(() => questionSimilarity(validNumericProblem('n3'), validShortResponse('s3')))
}

// ═══ Comparación entre TODOS los pares de formatos heterogéneos (11×11) ═══
function testAllHeterogeneousPairs() {
  const formats = Object.keys(VALID_BUILDERS)
  let comparisons = 0
  for (const left of formats) {
    for (const right of formats) {
      const a = VALID_BUILDERS[left](`${left}-x`)
      const b = VALID_BUILDERS[right](`${right}-y`)
      assert.doesNotThrow(() => questionSimilarity(a, b), `${left} vs ${right} no debe lanzar`)
      comparisons++
    }
  }
  assert.equal(comparisons, 121, 'deben cubrirse las 11x11=121 combinaciones de formatos')
}

// ═══ Pregunta malformada (classify options=null, el bug real) debe ser
// rechazada por diagnoseEvaluationBlock (structurallyValid=false), NO
// explotar — y NUNCA contar como "aceptada" para bloques posteriores ═══
function testMalformedQuestionRejectedNotCrashed() {
  const teaching: PreparedTeachingContent = {
    sessionId: 'sess-fmt', title: 'T', introduction: 'i', closing: 'c',
    steps: [{ stepId: 'step_1', id: 'step_1', microId: 'm1', title: 'T1', type: 'concept', content: 'c1', keyPoints: ['KP1'], keyPointIds: ['step_1:kp:1'], factKeys: ['fact:1'], importance: 'critical', cognitiveTarget: 'comprehension', sourceReferences: [] }],
  }
  const blockId = 'sess-fmt:evaluation:1'
  const block: EvaluationPlan['blocks'][number] = { blockId, afterStepId: 'step_1', coveredStepIds: ['step_1'], coveredKeyPointIds: ['step_1:kp:1'], coveredFactKeys: ['fact:1'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTargets: ['comprehension'], recommendedQuestionCount: 1, recommendedFormats: ['classify'], difficulty: 'medium' }
  const malformed: PreparedEvaluationQuestion = {
    questionId: 'q-malformed', blockId, targetStepIds: ['step_1'], targetKeyPointIds: ['step_1:kp:1'],
    targetFactKeys: ['fact:1'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTarget: 'comprehension',
    format: 'classify_category', prompt: 'Pregunta classify malformada, options null.', options: null, correctAnswer: null,
    feedback: 'x', difficulty: 'medium',
  }
  let diagnosis: ReturnType<typeof diagnoseEvaluationBlock> | undefined
  assert.doesNotThrow(() => { diagnosis = diagnoseEvaluationBlock(block, [malformed], teaching, 'mix_everything') }, 'diagnoseEvaluationBlock nunca debe lanzar, ni con una pregunta malformada')
  assert.deepEqual(diagnosis!.invalidQuestionIds, ['q-malformed'], 'el validator debe rechazar la pregunta malformada — options=null hace correctAnswer=null -> answerOk=false')
  assert.equal(diagnosis!.acceptedQuestionIds.includes('q-malformed'), false)

  // Y aunque quedara "aceptada" en la lista CRUDA de un bloque (simulando el
  // estado exacto que producía el crash antes del fix), la función que
  // deriva accepted real nunca la incluye.
  const blockWithRawMalformed: PreparedEvaluationBlock = { ...block, questions: [malformed] }
  const accepted = acceptedQuestionsAcrossBlocks(teaching, [blockWithRawMalformed], 'mix_everything')
  assert.deepEqual(accepted, [], 'acceptedQuestionsAcrossBlocks nunca debe incluir una pregunta estructuralmente inválida')
}

// ═══ Generación de un bloque completo con classify_category debe continuar
// (reproduce el fixture real end-to-end: bloque previo con classify inválido
// + bloque posterior con classify_category real y válido) ═══
async function testFullBlockGenerationWithClassifyCategory() {
  const teaching: PreparedTeachingContent = {
    sessionId: 'sess-classify-e2e', title: 'Ácidos y bases', introduction: 'i', closing: 'c',
    steps: [
      { stepId: 'step_1', id: 'step_1', microId: 'm1', title: 'T1', type: 'concept', content: 'c1', keyPoints: ['KP1'], keyPointIds: ['step_1:kp:1'], factKeys: ['fact:1'], importance: 'critical', cognitiveTarget: 'comprehension', sourceReferences: [] },
      { stepId: 'step_2', id: 'step_2', microId: 'm2', title: 'T2', type: 'concept', content: 'c2', keyPoints: ['KP2'], keyPointIds: ['step_2:kp:1'], factKeys: ['fact:2'], importance: 'critical', cognitiveTarget: 'comprehension', sourceReferences: [] },
    ],
  }
  const block1Id = 'sess-classify-e2e:evaluation:1'
  const block2Id = 'sess-classify-e2e:evaluation:2'
  const plan: EvaluationPlan = {
    blocks: [
      { blockId: block1Id, afterStepId: 'step_1', coveredStepIds: ['step_1'], coveredKeyPointIds: ['step_1:kp:1'], coveredFactKeys: ['fact:1'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTargets: ['comprehension'], recommendedQuestionCount: 1, recommendedFormats: ['classify'], difficulty: 'medium' },
      { blockId: block2Id, afterStepId: 'step_2', coveredStepIds: ['step_2'], coveredKeyPointIds: ['step_2:kp:1'], coveredFactKeys: ['fact:2'], targetObjectiveIds: ['step_2:objective:comprehension'], cognitiveTargets: ['comprehension'], recommendedQuestionCount: 1, recommendedFormats: ['classify'], difficulty: 'medium' },
    ],
  }
  // Bloque 1: EXACTAMENTE el fixture real reportado — options=null porque la
  // normalización de classify_category falló para esa respuesta del modelo.
  const block1Invalid: PreparedEvaluationQuestion = {
    questionId: 'q-real-invalid', blockId: block1Id, targetStepIds: ['step_1'], targetKeyPointIds: ['step_1:kp:1'],
    targetFactKeys: ['fact:1'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTarget: 'comprehension',
    format: 'classify_category', prompt: 'Clasifica cada elemento según su categoría.', options: null, correctAnswer: null,
    feedback: 'x', difficulty: 'medium',
  }
  const block1Repair: PreparedEvaluationQuestion = {
    questionId: 'q-real-repair', blockId: block1Id, targetStepIds: ['step_1'], targetKeyPointIds: ['step_1:kp:1'],
    targetFactKeys: ['fact:1'], targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTarget: 'comprehension',
    format: 'true_false', prompt: 'Reparación del bloque 1.', correctAnswer: true, feedback: 'x', difficulty: 'easy',
  }
  // Bloque 2: EXACTAMENTE la forma real descrita en el bug — options con
  // categories/items reales y válidos.
  const block2Valid: PreparedEvaluationQuestion = {
    questionId: 'q-real-valid', blockId: block2Id, targetStepIds: ['step_2'], targetKeyPointIds: ['step_2:kp:1'],
    targetFactKeys: ['fact:2'], targetObjectiveIds: ['step_2:objective:comprehension'], cognitiveTarget: 'comprehension',
    format: 'classify_category', prompt: 'Clasifica cada sustancia como Base Fuerte o No Base Fuerte.',
    options: { categories: ['Base Fuerte', 'No Base Fuerte'], items: [{ id: 'i1', text: 'NaOH', category: 'Base Fuerte' }, { id: 'i2', text: 'NH3', category: 'No Base Fuerte' }] },
    correctAnswer: { i1: 'Base Fuerte', i2: 'No Base Fuerte' }, feedback: 'x', difficulty: 'medium',
  }

  let persisted: SessionPreparationState | null = null
  const state = await runSessionPreparationFactory({
    sessionKind: 'learning', generationKey: 'test:classify-full-block', evalPreference: 'mix_everything',
    load: async () => persisted,
    persist: async s => { persisted = s },
    generateTeaching: async () => teaching,
    planEvaluations: async () => plan,
    generateEvaluationBlock: async (block): Promise<PreparedEvaluationBlock> =>
      block.blockId === block1Id ? { ...block, questions: [block1Invalid] } : { ...block, questions: [block2Valid] },
    repairEvaluationBlock: async (): Promise<PreparedEvaluationQuestion[]> => [block1Repair],
  })

  assert.equal(state.preparationStatus, 'ready', 'la preparación con un classify_category real (previa inválida + posterior válida) debe completarse sin crash')
  const block2Final = state.generatedEvaluationBlocks.find(b => b.blockId === block2Id)
  assert.ok(block2Final?.questions.some(q => q.questionId === 'q-real-valid'), 'la pregunta classify_category genuinamente válida debe sobrevivir intacta')
  assert.equal(state.acceptedQuestions.some(q => q.questionId === 'q-real-invalid'), false, 'la pregunta inválida nunca debe contar como aceptada')
}

// ═══ Auditoría adicional (item 8): otras rutas con el MISMO supuesto
// inseguro encontradas al buscar todos los callers de .options.categories/
// .options.items — validateQuestion (llamada con el payload CRUDO del
// cliente en session-check/route.ts, sin pasar por normalizeGeneratedQuestion
// primero) y presentAnswer (usada también fuera del pipeline validado, p.ej.
// recoveryFallback.ts). Ambas corregidas con el mismo guard defensivo. ═══
function testValidateQuestionNeverThrowsOnMalformedClassify() {
  const context: GenerationContext = {
    activeConceptId: 'c1', activeConceptLabel: 'L', teachingBlockId: 'step_1',
    targetDimension: 'comprehension', questionFamily: 'classify', allowedConceptIds: ['c1'],
    forbiddenConceptIds: [],
  }
  const malformedNull = { ...validClassify('vq-null'), options: null } as unknown as CanonicalQuestion
  const malformedEmpty = { ...validClassify('vq-empty'), options: {} } as unknown as CanonicalQuestion
  let resultNull: ReturnType<typeof validateQuestion> | undefined
  let resultEmpty: ReturnType<typeof validateQuestion> | undefined
  assert.doesNotThrow(() => { resultNull = validateQuestion(malformedNull, context) }, 'validateQuestion nunca debe lanzar con classify options=null (payload directo del cliente, session-check/route.ts)')
  assert.doesNotThrow(() => { resultEmpty = validateQuestion(malformedEmpty, context) }, 'validateQuestion nunca debe lanzar con classify options={}')
  assert.equal(resultNull!.valid, false, 'debe marcarse inválida (invalid_classification), no aceptarse silenciosamente')
  assert.ok(resultNull!.errors.includes('invalid_classification'))
  assert.equal(resultEmpty!.valid, false)
  assert.ok(resultEmpty!.errors.includes('invalid_classification'))
  // Control: classify genuinamente válido nunca dispara invalid_classification
  // (el resto de errors depende de checks no relacionados con este guard —
  // concept/dimension/etc — fuera del alcance de este test).
  assert.doesNotThrow(() => {
    const r = validateQuestion(validClassify('vq-ok'), context)
    assert.ok(!r.errors.includes('invalid_classification'), `classify válido no debe disparar invalid_classification (errors: ${r.errors.join(',')})`)
  })
}

function testPresentAnswerNeverThrowsOnMalformedOptions() {
  const malformedClassify = { ...validClassify('pa-classify'), options: null } as unknown as CanonicalQuestion
  const malformedMatching = { ...validMatching('pa-matching'), options: null } as unknown as CanonicalQuestion
  assert.doesNotThrow(() => presentAnswer(malformedClassify, { i1: 'Base Fuerte' }), 'presentAnswer nunca debe lanzar con classify options=null')
  assert.doesNotThrow(() => presentAnswer(malformedMatching, { p1: 'm1' }), 'presentAnswer nunca debe lanzar con matching options=null')
  // Control: formas válidas siguen produciendo texto real, no se vacía por el guard.
  assert.ok(presentAnswer(validClassify('pa-classify-ok'), { i1: 'Base Fuerte' }).length > 0)
  assert.ok(presentAnswer(validMatching('pa-matching-ok'), { p1: 'm1' }).length > 0)
}

async function main() {
  testFormatMatrix()
  testClassifyVsMcq()
  testClassifyVsClassify()
  testOptionsNullForEveryFormat()
  testOptionsEmptyObjectForEveryFormat()
  testSpecificFormatsExplicit()
  testNumericAndOpenResponse()
  testAllHeterogeneousPairs()
  testMalformedQuestionRejectedNotCrashed()
  testValidateQuestionNeverThrowsOnMalformedClassify()
  testPresentAnswerNeverThrowsOnMalformedOptions()
  await testFullBlockGenerationWithClassifyCategory()
  console.log('question-similarity-format-safety-contracts: PASS (11 formatos, 121 pares heterogéneos, null/empty options, fixture real end-to-end, validateQuestion + presentAnswer)')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
