import assert from 'node:assert/strict'
import {
  validateMatchingQuestion,
  validateMatchingStructure,
  validateMatchingGrounding,
  type MatchingOption,
} from '../../lib/adaptive/evaluation/matchingValidator'
import {
  diagnoseEvaluationBlock,
  runSessionPreparationFactory,
  type PreparedTeachingContent,
  type EvaluationPlan,
  type PreparedEvaluationQuestion,
  type PreparedEvaluationBlock,
  type SessionPreparationState,
} from '../../lib/ai/sessionPreparationFactory'
import { scoreQuestion } from '../../lib/adaptive/evaluation/scoring'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'

// P3.1 — MATCHING ACADÉMICAMENTE SEGURO
//
// Causa raíz real (2 de 2 preguntas matching observadas en generación real con
// OpenRouter, dominios "conceptual" y "medicine"): el modelo produce pares
// referencialmente consistentes (correctAnswer[pairId] === options[pairId].rightId)
// pero con el texto de `right` desplazado hacia un `left` distinto al que
// describe realmente — mientras `explanation` (de la misma pregunta) narra la
// relación correcta. Una validación de forma no detecta nada. matchingValidator.ts
// cruza el contenido de cada pair contra targetFactKeys/explanation (ya presentes
// en toda pregunta generada, sin nueva infraestructura) con una comparación
// RELATIVA ponderada por frecuencia inversa de palabra — no un umbral absoluto de
// "parece correcto", sino "¿encaja este right mejor en OTRO par que en el suyo?".

// ═══ 1. Matching correcto → válido ═══
const goodPairs: MatchingOption[] = [
  { id: 'p1', rightId: 'm1', left: 'Mitocondria', right: 'Produce energía celular mediante respiración' },
  { id: 'p2', rightId: 'm2', left: 'Núcleo', right: 'Contiene el material genético de la célula' },
  { id: 'p3', rightId: 'm3', left: 'Ribosoma', right: 'Sintetiza proteínas a partir de ARN mensajero' },
]
const goodFactKeys = [
  'Mitocondria: produce energía celular mediante respiración.',
  'Núcleo: contiene el material genético de la célula.',
  'Ribosoma: sintetiza proteínas a partir de ARN mensajero.',
]
const goodCorrectAnswer = { p1: 'm1', p2: 'm2', p3: 'm3' }
assert.deepEqual(
  validateMatchingQuestion({ options: goodPairs, correctAnswer: goodCorrectAnswer, targetFactKeys: goodFactKeys }),
  { valid: true },
  '1. matching correcto (grounding coherente con factKeys) debe ser válido',
)

// ═══ 2. Matching con right desplazados cíclicamente → inválido ═══
// Reproduce EXACTAMENTE el hallazgo real del dominio "conceptual" (Revolución Francesa).
const cyclicShift = {
  explanation: 'La crisis fiscal se debió a los gastos militares. Las ideas ilustradas promovieron la soberanía popular. La Toma de la Bastilla se convirtió en un símbolo del fin del absolutismo monárquico.',
  targetFactKeys: [
    'Crisis fiscal de la monarquía por gastos militares.',
    'Influencia de las ideas ilustradas sobre soberanía popular.',
    'Símbolo del fin del absolutismo.',
  ],
  options: [
    { id: 'pair_1', rightId: 'match_1', left: 'Crisis fiscal de la monarquía', right: 'Símbolo del fin del absolutismo' },
    { id: 'pair_2', rightId: 'match_2', left: 'Ideas ilustradas', right: 'Gastos militares excesivos' },
    { id: 'pair_3', rightId: 'match_3', left: 'Toma de la Bastilla', right: 'Influencia en la soberanía popular' },
  ] as MatchingOption[],
  correctAnswer: { pair_1: 'match_1', pair_2: 'match_2', pair_3: 'match_3' },
}
const cyclicResult = validateMatchingQuestion(cyclicShift)
assert.equal(cyclicResult.valid, false, '2. rotación cíclica de 3 pares (reproduce el bug real de "conceptual") debe ser inválida')
assert.ok(cyclicResult.reason?.startsWith('MATCHING_CONTENT_DRIFT'), '2. el motivo debe ser drift de contenido, no una falla estructural')

// Segundo caso real independiente (dominio "medicine", Diástole/Sístole invertidos).
const swappedPair = {
  explanation: 'Durante la diástole, las válvulas mitral y tricúspide se abren para permitir el llenado ventricular. Durante la sístole, las válvulas aórtica y pulmonar se abren para la expulsión de sangre.',
  targetFactKeys: [
    'Sístole: contracción ventricular, el corazón bombea sangre.',
    'Diástole: relajación ventricular, el corazón se llena de sangre.',
    'Diástole: apertura de válvulas mitral y tricúspide para llenado ventricular.',
    'Sístole: apertura de válvulas aórtica y pulmonar para expulsión de sangre.',
  ],
  options: [
    { id: 'pair_1', rightId: 'match_1', left: 'Diástole', right: 'Apertura de válvulas aórtica y pulmonar' },
    { id: 'pair_2', rightId: 'match_2', left: 'Sístole', right: 'Apertura de válvulas mitral y tricúspide' },
  ] as MatchingOption[],
  correctAnswer: { pair_1: 'match_1', pair_2: 'match_2' },
}
assert.equal(validateMatchingQuestion(swappedPair).valid, false, '2b. pares invertidos (reproduce el bug real de "medicine") debe ser inválido')
// La versión corregida del mismo contenido (mismo grounding, pares reales) debe pasar.
assert.equal(validateMatchingQuestion({
  ...swappedPair,
  options: [
    { id: 'pair_1', rightId: 'match_1', left: 'Diástole', right: 'Apertura de válvulas mitral y tricúspide' },
    { id: 'pair_2', rightId: 'match_2', left: 'Sístole', right: 'Apertura de válvulas aórtica y pulmonar' },
  ],
}).valid, true, '2c. control: mismo grounding con pares correctos debe validar — aísla que el rechazo viene del contenido, no del grounding')

// ═══ 3. Matching duplicado → inválido ═══
const duplicateRight: MatchingOption[] = [goodPairs[0], { ...goodPairs[1], right: goodPairs[0].right }]
assert.deepEqual(
  validateMatchingStructure(duplicateRight, { p1: 'm1', p2: 'm2' }),
  { valid: false, reason: 'MATCHING_DUPLICATE_RIGHT_DESCRIPTION' },
  '3. dos rights idénticos son ambiguos para el estudiante — inválido',
)

// ═══ 4. Matching non-bijective cuando exige bijective → inválido ═══
const nonBijective: MatchingOption[] = [goodPairs[0], { ...goodPairs[1], rightId: goodPairs[0].rightId }]
assert.deepEqual(
  validateMatchingStructure(nonBijective, { p1: 'm1', p2: 'm1' }),
  { valid: false, reason: 'MATCHING_NON_BIJECTIVE_RIGHT_IDS' },
  '4. dos pares no pueden compartir el mismo rightId cuando la semántica es bijective',
)

// ═══ 5. Matching correcto con matchingOptionOrder shuffle → sigue válido ═══
// El validador nunca lee matchingOptionOrder (es solo orden de RENDER) — shuffle
// no debe afectar la validación de contenido en absoluto.
const shuffledOrderQuestion = {
  options: goodPairs, correctAnswer: goodCorrectAnswer, targetFactKeys: goodFactKeys,
  matchingOptionOrder: ['m3', 'm1', 'm2'], // orden de display distinto al de options[]
}
assert.equal(validateMatchingQuestion(shuffledOrderQuestion).valid, true, '5. shuffle de matchingOptionOrder no debe invalidar un matching cuyo contenido es correcto')

// ═══ 6. Respuesta del alumno con parejas correctas tras shuffle → 100% ═══
// El scorer real (lib/adaptive/evaluation/scoring.ts) debe evaluar por pairId→rightId,
// nunca por posición visual — coincide con el diseño ya validado arriba.
const matchingQuestion: CanonicalQuestion = {
  id: 'q1', conceptId: 'c1', conceptLabel: 'Organelos', teachingBlockId: 'step_1',
  questionFamily: 'matching', variant: 'matching_concept_def', difficulty: 'medium',
  targetDimension: 'comprehension', questionText: 'Relaciona cada organelo con su función.',
  explanation: 'Ver factKeys.', hint: '', estimatedSeconds: 45, evidencesNeeded: 1, factKey: goodFactKeys[0],
  format: 'matching', options: goodPairs, correctAnswer: goodCorrectAnswer,
  matchingSemantics: 'bijective', matchingOptionOrder: ['m3', 'm1', 'm2'],
}
const studentAnswerAfterShuffle = { p1: 'm1', p2: 'm2', p3: 'm3' } // el alumno asoció todo correctamente
const scoreResult = scoreQuestion(matchingQuestion, studentAnswerAfterShuffle)
assert.equal(scoreResult.score, 100, '6. parejas correctas tras shuffle deben puntuar 100')
assert.equal(scoreResult.correct, true, '6. debe marcarse correct=true')

// ═══ 7 y 8. Matching inválido nunca llega a persistence/evidence, y el repair
// incremental reemplaza SOLO esa pregunta (no las demás ya aceptadas) ═══
// Usa el orquestador real runSessionPreparationFactory con I/O inyectado — la
// MISMA función que usa app/api/adaptive/session-teach/route.ts en producto vivo.
async function testRepairReplacesOnlyInvalidMatching() {
  const teaching: PreparedTeachingContent = {
    sessionId: 'sess-1', title: 'Organelos celulares', introduction: 'i', closing: 'c',
    steps: [{
      stepId: 'step_1', id: 'step_1', microId: 'm1', title: 'Organelos', type: 'concept',
      content: 'contenido', keyPoints: ['Concepto Alfa relacionado con Descripción Uno especial', 'Concepto Beta relacionado con Descripción Dos especial'],
      keyPointIds: ['step_1:kp:1', 'step_1:kp:2'],
      factKeys: ['Concepto Alfa relacionado con Descripción Uno especial.', 'Concepto Beta relacionado con Descripción Dos especial.'],
      importance: 'critical', cognitiveTarget: 'comprehension', sourceReferences: [],
    }],
  }
  const plan: EvaluationPlan = {
    blocks: [{
      blockId: 'sess-1:evaluation:1', afterStepId: 'step_1', coveredStepIds: ['step_1'],
      coveredKeyPointIds: ['step_1:kp:1', 'step_1:kp:2'],
      coveredFactKeys: ['Concepto Alfa relacionado con Descripción Uno especial.', 'Concepto Beta relacionado con Descripción Dos especial.'],
      targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTargets: ['comprehension'],
      recommendedQuestionCount: 2, recommendedFormats: ['matching', 'true_false'], difficulty: 'medium',
    }],
  }
  const validQuestion: PreparedEvaluationQuestion = {
    questionId: 'q-valid-tf', blockId: 'sess-1:evaluation:1', targetStepIds: ['step_1'],
    targetKeyPointIds: ['step_1:kp:1'], targetFactKeys: ['Concepto Alfa relacionado con Descripción Uno especial.'],
    targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTarget: 'comprehension',
    format: 'true_false', prompt: 'Concepto Alfa se relaciona con Descripción Uno.', correctAnswer: true,
    feedback: 'Correcto.', difficulty: 'medium',
  }
  const brokenMatching: PreparedEvaluationQuestion = {
    questionId: 'q-broken-matching', blockId: 'sess-1:evaluation:1', targetStepIds: ['step_1'],
    targetKeyPointIds: ['step_1:kp:2'], targetFactKeys: ['Concepto Alfa relacionado con Descripción Uno especial.', 'Concepto Beta relacionado con Descripción Dos especial.'],
    targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTarget: 'comprehension',
    format: 'matching', prompt: 'Relaciona Concepto Alfa y Concepto Beta con su descripción.',
    // Pares desplazados: Alfa debería ir con "Descripción Uno", Beta con "Descripción Dos".
    options: [
      { id: 'p1', rightId: 'm1', left: 'Concepto Alfa', right: 'Descripción Dos especial' },
      { id: 'p2', rightId: 'm2', left: 'Concepto Beta', right: 'Descripción Uno especial' },
    ],
    correctAnswer: { p1: 'm1', p2: 'm2' },
    explanation: 'Concepto Alfa relacionado con Descripción Uno especial. Concepto Beta relacionado con Descripción Dos especial.',
    feedback: 'Ver explicación.', difficulty: 'medium',
  }
  const repairQuestion: PreparedEvaluationQuestion = {
    questionId: 'q-repair-replacement', blockId: 'sess-1:evaluation:1', targetStepIds: ['step_1'],
    targetKeyPointIds: ['step_1:kp:2'], targetFactKeys: ['Concepto Beta relacionado con Descripción Dos especial.'],
    targetObjectiveIds: ['step_1:objective:comprehension'], cognitiveTarget: 'comprehension',
    // Prompt deliberadamente NO templado igual que validQuestion ("X se
    // relaciona con Y.") — con texto casi idéntico salvo por las entidades
    // nombradas, isSemanticDuplicate() (sessionPreparationFactory.ts) lo
    // marca correctamente como duplicado semántico (mismo detector que
    // protege producción de preguntas de repair parafraseadas contra una ya
    // aceptada). Ese es el comportamiento correcto del detector, no un bug —
    // el fixture debe usar contenido genuinamente distinto, como haría un
    // repair real.
    format: 'true_false', prompt: '¿Es correcta la asociación entre el segundo concepto clave y su descripción correspondiente?', correctAnswer: true,
    feedback: 'Correcto.', difficulty: 'medium',
  }

  let persisted: SessionPreparationState | null = null
  let repairCallCount = 0
  let repairInvalidIds: string[] = []
  const state = await runSessionPreparationFactory({
    sessionKind: 'learning', generationKey: 'test:matching-repair', evalPreference: 'mix_everything',
    load: async () => persisted,
    persist: async s => { persisted = s },
    generateTeaching: async () => teaching,
    planEvaluations: async () => plan,
    generateEvaluationBlock: async (block): Promise<PreparedEvaluationBlock> => ({
      ...block, questions: [validQuestion, brokenMatching],
    }),
    repairEvaluationBlock: async (_block, missing) => {
      repairCallCount += 1
      repairInvalidIds = missing.invalidQuestionIds
      return [repairQuestion]
    },
  })

  assert.equal(state.preparationStatus, 'ready', 'la preparación debe completarse tras el repair')
  assert.equal(repairCallCount, 1, '7/8. el repair debe invocarse exactamente una vez')
  assert.deepEqual(repairInvalidIds, ['q-broken-matching'], '8. el repair debe apuntar SOLO a la pregunta matching inválida, no a la pregunta válida ya aceptada')

  const finalQuestionIds = state.generatedEvaluationBlocks[0].questions.map(q => q.questionId).sort()
  assert.deepEqual(
    finalQuestionIds, ['q-repair-replacement', 'q-valid-tf'].sort(),
    '7. la pregunta matching inválida nunca debe llegar al estado final persistido — ni a evidencia ni a render',
  )
  assert.equal(
    state.acceptedQuestions.some(q => q.questionId === 'q-broken-matching'), false,
    '7. el matching inválido no debe aparecer en acceptedQuestions (fuente de evidencia)',
  )
  assert.equal(
    state.generatedEvaluationBlocks[0].questions.some(q => q.questionId === 'q-valid-tf'), true,
    '8. la pregunta válida original debe preservarse intacta — el repair no debe regenerar de más',
  )
}

async function main() {
  await testRepairReplacesOnlyInvalidMatching()

  // Confirma también a nivel de diagnoseEvaluationBlock (unidad más pequeña, sin
  // el orquestador completo) que un matching con drift entra a invalidQuestionIds
  // y jamás a acceptedQuestionIds.
  const diag = diagnoseEvaluationBlock(
    {
      blockId: 'b1', afterStepId: 's1', coveredStepIds: ['s1'], coveredKeyPointIds: ['s1:kp:1'],
      coveredFactKeys: cyclicShift.targetFactKeys, targetObjectiveIds: ['s1:objective:comprehension'],
      cognitiveTargets: ['comprehension'], recommendedQuestionCount: 1, recommendedFormats: ['matching'], difficulty: 'medium',
    },
    [{
      questionId: 'drifted', blockId: 'b1', targetStepIds: ['s1'], targetKeyPointIds: ['s1:kp:1'],
      targetFactKeys: cyclicShift.targetFactKeys, targetObjectiveIds: ['s1:objective:comprehension'], cognitiveTarget: 'comprehension',
      format: 'matching', prompt: 'x',
      options: cyclicShift.options, correctAnswer: cyclicShift.correctAnswer, explanation: cyclicShift.explanation,
      feedback: 'x', difficulty: 'medium',
    }],
    { sessionId: 's', title: 't', introduction: 'i', closing: 'c', steps: [] },
    'mix_everything',
  )
  assert.deepEqual(diag.invalidQuestionIds, ['drifted'], '7b. diagnoseEvaluationBlock debe marcar el matching con drift como inválido')
  assert.equal(diag.acceptedQuestionIds.includes('drifted'), false, '7b. y nunca incluirlo en acceptedQuestionIds')

  // ═══════════════════════════════════════════════════════════════════════
  // AUDITORÍA DE FALSOS POSITIVOS/NEGATIVOS (post-implementación)
  //
  // Dos bugs reales encontrados y corregidos al probar el validator contra
  // vocabulario técnico/corto (no solo prosa como en los hallazgos originales):
  //
  // FALSO POSITIVO (grave — rechazaba contenido correcto): la comprobación
  // estructural de "right/left duplicado" reutilizaba tokenize() (que
  // descarta palabras de 1-2 letras) para comparar literalmente — "Fase A" y
  // "Fase B" colapsaban ambos a "fase" y se marcaban como término duplicado.
  // Fix: normalizeLiteral() separado, sin descartar palabras cortas, solo
  // para detección de duplicados exactos.
  //
  // FALSO NEGATIVO (grave — no detectaba fórmulas con símbolos de una sola
  // letra, p.ej. v=d/t vs a=dv/dt): un right que tokeniza a CERO palabras (p.ej.
  // "v=d/t" → v,d,t son de 1 letra) no tiene nada que comparar — se
  // comparaba su score propio (0) contra el score de otro par sin relación,
  // generando un falso "drift". Fix: si left o right de un par no produce
  // ningún token, ese par se OMITE del chequeo de drift (no se afirma nada
  // sobre él) — conservador en la dirección correcta.
  //
  // TERCERA RONDA de auditoría — contra 108 preguntas REALES generadas con
  // OpenRouter (9 dominios, ver reporte P3.2) — encontró y corrigió dos bugs
  // más, ambos falsos positivos sobre matching CORRECTO real:
  //
  // 1) weight(word)=0 para palabras que no aparecen en NINGÚN grounding doc
  //    las hacía desaparecer del denominador en vez de penalizar — un right
  //    con mucho vocabulario propio (no grounded) podía marcar recall=1.0
  //    solo por las pocas palabras que sí coincidían por azar en algún doc.
  //    Fix: esas palabras pesan como las más específicas (1), no 0.
  // 2) La comparación PAR A PAR con margen aditivo (own+0.1) es inestable
  //    cuando ownScore es pequeño: una coincidencia léxica incidental de UN
  //    factKey ajeno bastaba para "ganarle" a un ownScore de 0.03. Fix
  //    estructural: en vez de comparar pares aislados, se resuelve como un
  //    problema de ASIGNACIÓN — se compara el total de la permutación
  //    declarada (identidad) contra la MEJOR permutación alternativa posible;
  //    solo se rechaza si una alternativa completa supera a la declarada por
  //    un margen real (0.3), no par por par. Esto es mucho más estable: una
  //    mención incidental en un solo factKey ajeno ya no puede superar a una
  //    asignación completa que sigue ganando en el resto de sus términos.
  //
  // GARANTÍA DOCUMENTADA (no re-derivable del código, dejar constancia aquí):
  // el validator SÍ detecta drift cuando el left/right de AMBOS lados de la
  // comparación tokeniza a 2+ palabras de contenido real (símbolos de 2+
  // letras como "Kc", "pH", "dv", "dt" cuentan). NO puede detectar (ni
  // rechaza) drift cuando el contenido depende de símbolos de una sola letra
  // (v, d, t, x, F...) — ahí no rechaza nada, ni bueno ni malo, por diseño
  // conservador. La decisión es sobre la ASIGNACIÓN COMPLETA, no par por par:
  // contenido parafraseado con bajo overlap directo entre left/right sigue
  // validando si, en conjunto, la asignación declarada sigue siendo la de
  // mayor puntuación total frente a cualquier alternativa.
  const singleLetterFormulaPairs: MatchingOption[] = [
    { id: 'p1', rightId: 'm1', left: 'Velocidad', right: 'v=d/t' },
    { id: 'p2', rightId: 'm2', left: 'Aceleración', right: 'a=dv/dt' },
  ]
  const formulaFactKeys = [
    'La velocidad es distancia sobre tiempo, v=d/t.',
    'La aceleración es cambio de velocidad sobre tiempo, a=dv/dt.',
  ]
  assert.equal(
    validateMatchingQuestion({ options: singleLetterFormulaPairs, correctAnswer: { p1: 'm1', p2: 'm2' }, targetFactKeys: formulaFactKeys }).valid,
    true,
    'FP regresión: fórmulas con símbolos de una sola letra (v, d, t) correctamente emparejadas no deben rechazarse',
  )
  const distinctShortLeftLabels: MatchingOption[] = [
    { id: 'p1', rightId: 'm1', left: 'Fase A', right: 'Apertura de válvula X para proceso inicial' },
    { id: 'p2', rightId: 'm2', left: 'Fase B', right: 'Apertura de válvula Y para proceso final' },
  ]
  assert.deepEqual(
    validateMatchingStructure(distinctShortLeftLabels, { p1: 'm1', p2: 'm2' }),
    { valid: true },
    'FP regresión: "Fase A" y "Fase B" son términos DISTINTOS, no deben colapsar a un duplicado por descartar el sufijo de una letra',
  )
  const shortSymbolPairs: MatchingOption[] = [
    { id: 'p1', rightId: 'm1', left: 'Kc', right: 'Relación de productos sobre reactivos en equilibrio' },
    { id: 'p2', rightId: 'm2', left: 'pH', right: 'Concentración de iones hidrógeno en una solución' },
  ]
  const shortSymbolFactKeys = [
    'Kc mide la relación de productos sobre reactivos en equilibrio.',
    'pH mide la concentración de iones hidrógeno en una solución.',
  ]
  assert.equal(
    validateMatchingQuestion({ options: shortSymbolPairs, correctAnswer: { p1: 'm1', p2: 'm2' }, targetFactKeys: shortSymbolFactKeys }).valid,
    true,
    'FN regresión: símbolos cortos de 2 letras (Kc, pH) correctamente emparejados deben validar',
  )
  const shortSymbolSwapped: MatchingOption[] = [
    { id: 'p1', rightId: 'm1', left: 'Kc', right: 'Concentración de iones hidrógeno en una solución' },
    { id: 'p2', rightId: 'm2', left: 'pH', right: 'Relación de productos sobre reactivos en equilibrio' },
  ]
  assert.equal(
    validateMatchingQuestion({ options: shortSymbolSwapped, correctAnswer: { p1: 'm1', p2: 'm2' }, targetFactKeys: shortSymbolFactKeys }).valid,
    false,
    'FN regresión: con símbolos de 2 letras SÍ debe detectar el swap (antes del fix de longitud>1 esto se perdía por completo)',
  )

  // FP regresión REAL #1 (physics_quantitative, generación real): weight(word)=0
  // para vocabulario ausente de todo doc dejaba que unas pocas palabras
  // coincidentes marcaran recall=1.0 — "Conservación de la Energía Mecánica"
  // parecía encajar mejor con el right de "Energía Cinética" que con el suyo.
  const energyPairs: MatchingOption[] = [
    { id: 'p1', rightId: 'm1', left: 'Energía Cinética', right: 'Energía asociada al movimiento de un objeto, dependiente de su masa y velocidad.' },
    { id: 'p2', rightId: 'm2', left: 'Conservación de la Energía Mecánica', right: 'Principio que establece que la suma de la energía cinética y potencial se mantiene constante en ausencia de fuerzas no conservativas.' },
  ]
  assert.equal(
    validateMatchingQuestion({
      options: energyPairs, correctAnswer: { p1: 'm1', p2: 'm2' },
      targetFactKeys: ['La energía cinética depende de la masa y la velocidad del objeto.', 'La energía mecánica total se conserva sin fricción.'],
    }).valid,
    true,
    'FP regresión real: right de un par que menciona de pasada vocabulario del otro par (aquí "energía cinética" dentro de la descripción de conservación) no debe bastar para rechazar un match correcto',
  )

  // FP regresión REAL #2 (law, generación real): comparación par-a-par con
  // margen aditivo era inestable cuando ownScore era pequeño — un factKey que
  // describe el OTRO par mencionaba de pasada el término de este par y con
  // margen pequeño eso bastaba para "ganarle" a un ownScore casi nulo. Fix:
  // comparación por asignación completa (permutación), no par aislado.
  const lawPairs: MatchingOption[] = [
    { id: 'p1', rightId: 'm1', left: 'Debido Proceso Legal', right: 'Garantía constitucional que protege los derechos individuales frente al Estado.' },
    { id: 'p2', rightId: 'm2', left: 'Medidas Cautelares', right: 'Excepciones al debido proceso, aplicables bajo estrictas condiciones.' },
  ]
  assert.equal(
    validateMatchingQuestion({
      options: lawPairs, correctAnswer: { p1: 'm1', p2: 'm2' },
      targetFactKeys: ['Garantía constitucional que protege los derechos individuales frente al Estado.', 'Las medidas cautelares son excepciones al debido proceso, aplicables bajo estrictas condiciones.'],
    }).valid,
    true,
    'FP regresión real: un factKey ajeno que menciona de pasada el término de otro par (aquí "debido proceso" dentro del factKey de medidas cautelares) no debe bastar para rechazar la asignación declarada, que en conjunto sigue siendo la mejor',
  )

  // FP regresión REAL #3 (physics_quantitative, generación real — segunda
  // reproducción del Bug 5, no cubierta hasta ahora por un test permanente):
  // aquí `explanation` es UNA sola oración-resumen que nombra los 3 conceptos
  // juntos ("la velocidad es X, la aceleración es Y, y en caída libre Z").
  // Con el algoritmo VIEJO (comparación par-a-par, weight=0 para vocabulario
  // ausente) esa oración por sí sola hacía que las 3 FILAS de la matriz
  // left×right fueran EXACTAMENTE IDÉNTICAS — evidencia real capturada en su
  // momento con MV_DEBUG:
  //   fila Velocidad:    [0.538, 1.000, 0.217]
  //   fila Aceleración:  [0.538, 1.000, 0.217]
  //   fila Caída Libre:  [0.538, 1.000, 0.217]
  // El algoritmo viejo comparaba ownScore=matrix[i][i] contra
  // matrix[i][j]>own+0.1: para pair_1 (Velocidad), own=matrix[0][0]=0.538 y
  // cross=matrix[0][1]=1.000 (el right de "Aceleración" dominaba toda columna
  // 1 por igual, sin importar la fila) → 1.000>0.538+0.1 → el par_1 se
  // marcaba como drift, un falso positivo (la pareja es correcta). El mismo
  // patrón afectaba a pair_3 (Caída Libre) por la misma columna dominante.
  // El algoritmo actual (asignación global: identidad vs mejor permutación
  // completa) ya no es susceptible a esto — una columna que domina fila por
  // fila no puede, por sí sola, formar una permutación alternativa BIJECTIVA
  // mejor que la identidad (cada right solo puede usarse una vez).
  const physicsKinematicsExplanation = 'La velocidad es el desplazamiento por unidad de tiempo, la aceleración es el cambio de velocidad por unidad de tiempo, y en caída libre, la aceleración es la gravedad.'
  const physicsKinematicsFactKeys = [
    'La velocidad es el desplazamiento por unidad de tiempo.',
    'La aceleración es el cambio de velocidad por unidad de tiempo.',
    'En caída libre, la aceleración es la gravedad ($g$).',
  ]
  const physicsKinematicsPairs: MatchingOption[] = [
    { id: 'p1', rightId: 'm1', left: 'Velocidad', right: 'Cambio de posición por unidad de tiempo' },
    { id: 'p2', rightId: 'm2', left: 'Aceleración', right: 'Cambio de velocidad por unidad de tiempo' },
    { id: 'p3', rightId: 'm3', left: 'Caída Libre', right: 'Movimiento donde la única aceleración es la gravedad' },
  ]
  assert.equal(
    validateMatchingQuestion({
      options: physicsKinematicsPairs, correctAnswer: { p1: 'm1', p2: 'm2', p3: 'm3' },
      targetFactKeys: physicsKinematicsFactKeys, explanation: physicsKinematicsExplanation,
    }).valid,
    true,
    'FP regresión real (Bug 5, reproducción B): una explanation-resumen que nombra los 3 conceptos juntos no debe degradar la comparación a "cualquier left encaja con cualquier right" — la asignación declarada (correcta) debe seguir ganando frente a cualquier alternativa',
  )

  console.log('matching-academic-validity-contracts: 8 contracts PASS + 7 audit regression contracts PASS')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
