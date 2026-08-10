import assert from 'node:assert/strict'
import { validateQuestion, type CanonicalQuestion, type GenerationContext } from '../../lib/adaptive/evaluation/questionContract'
import { validateMatchingStructure, validateMatchingGrounding, type MatchingOption } from '../../lib/adaptive/evaluation/matchingValidator'

// AUDITORÍA FINAL (misión de cierre del modo Adaptativo) — sección 13
// (null/shape fuzzing) + sección 15 (matching). Dos bugs reales encontrados
// por auditoría en paralelo, ambos con el MISMO patrón que el crash de
// classify_category ya arreglado en el ciclo anterior (question-similarity-
// format-safety-contracts.ts): acceso sin guard a options/correctAnswer de
// una pregunta que puede llegar malformada.
//
// BUG 1 — validateQuestion() (questionContract.ts): la rama classify ya tenía
// guard defensivo, pero word_bank/ordering/multi_select/matching/
// numeric_problem NO — accedían directo a question.options.map(...) /
// question.correctAnswer.length / question.correctAnswer.value sin comprobar
// que options/correctAnswer fueran del shape esperado. Alcanzable en
// producción: session-check/route.ts llama validateQuestion con el payload
// CRUDO del cliente (question viene del POST, sin pasar por
// normalizeGeneratedQuestion). Un payload cliente corrupto/viejo con
// options=null para cualquiera de estos 5 formatos tumbaba la ruta de
// calificación con un TypeError sin control, en vez de devolver el
// {outcome:'invalid'} ya diseñado para este caso.
//
// BUG 2 — validateMatchingGrounding() (matchingValidator.ts): la capa 2
// (grounding de contenido) compara la asignación declarada contra TODAS las
// permutaciones de los pares "juzgables" — factorial en su número. Sin cota
// superior, un matching con ~10+ pares juzgables cuelga la petición (medido:
// n=10 ≈ 13s, crece factorial). Nada en el pipeline de generación acota el
// número de pares de un matching antes de llegar aquí.

function baseQuestion(id: string): Omit<CanonicalQuestion, 'format' | 'options' | 'correctAnswer'> & Record<string, unknown> {
  return {
    id, conceptId: 'c1', conceptLabel: 'Concepto', teachingBlockId: 'step_1',
    questionFamily: 'family', variant: 'v', difficulty: 'medium',
    targetDimension: 'comprehension', questionText: 'Texto de la pregunta con longitud suficiente ___.',
    explanation: 'Explicación.', hint: '', estimatedSeconds: 30, evidencesNeeded: 1, factKey: `fact-${id}`,
  } as unknown as Omit<CanonicalQuestion, 'format' | 'options' | 'correctAnswer'> & Record<string, unknown>
}

const context: GenerationContext = {
  activeConceptId: 'c1', activeConceptLabel: 'L', teachingBlockId: 'step_1',
  targetDimension: 'comprehension', questionFamily: 'family', allowedConceptIds: ['c1'],
  forbiddenConceptIds: [],
}

function validWordBank(): CanonicalQuestion {
  return { ...baseQuestion('wb'), format: 'word_bank', options: [{ id: 'w1', text: 'palabra' }], correctAnswer: ['w1'] } as CanonicalQuestion
}
function validOrdering(): CanonicalQuestion {
  return { ...baseQuestion('or'), format: 'ordering', options: [{ id: 'a', text: 'Paso 1' }, { id: 'b', text: 'Paso 2' }], correctAnswer: ['a', 'b'] } as CanonicalQuestion
}
function validMultiSelect(): CanonicalQuestion {
  return { ...baseQuestion('ms'), format: 'multi_select', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctAnswer: ['a', 'b'] } as CanonicalQuestion
}
function validMatching(): CanonicalQuestion {
  return {
    ...baseQuestion('mt'), format: 'matching',
    options: [{ id: 'p1', left: 'Izq1', right: 'Der1', rightId: 'm1' }, { id: 'p2', left: 'Izq2', right: 'Der2', rightId: 'm2' }],
    correctAnswer: { p1: 'm1', p2: 'm2' }, matchingSemantics: 'bijective', matchingOptionOrder: ['m1', 'm2'],
  } as CanonicalQuestion
}
function validNumericProblem(): CanonicalQuestion {
  return { ...baseQuestion('np'), format: 'numeric_problem', options: null, correctAnswer: { value: 5, tolerance: 0.1, unit: 'mol/L' } } as CanonicalQuestion
}

const MALFORMATIONS: Record<string, (q: CanonicalQuestion) => CanonicalQuestion> = {
  'options=null': q => ({ ...q, options: null }) as unknown as CanonicalQuestion,
  'options=undefined': q => ({ ...q, options: undefined }) as unknown as CanonicalQuestion,
  'correctAnswer=null': q => ({ ...q, correctAnswer: null }) as unknown as CanonicalQuestion,
  'correctAnswer=undefined': q => ({ ...q, correctAnswer: undefined }) as unknown as CanonicalQuestion,
}

// ═══ BUG 1 — reproducción exacta + verificación del fix, por formato ═══
function testValidateQuestionNeverThrowsAcrossFormats() {
  // numeric_problem tiene options=null POR DISEÑO (no es un formato de
  // opciones) — solo correctAnswer puede malformarse ahí; options=null/
  // undefined no es una malformación para este formato, es su forma válida.
  const cases: [string, () => CanonicalQuestion, string, string[]][] = [
    ['word_bank', validWordBank, 'word_bank_slot_mismatch', Object.keys(MALFORMATIONS)],
    ['ordering', validOrdering, 'ordering_answer_missing', Object.keys(MALFORMATIONS)],
    ['multi_select', validMultiSelect, 'invalid_multi_select_answer', Object.keys(MALFORMATIONS)],
    ['matching', validMatching, 'invalid_matching_pairs', Object.keys(MALFORMATIONS)],
    ['numeric_problem', validNumericProblem, 'invalid_numeric_answer', ['correctAnswer=null', 'correctAnswer=undefined']],
  ]
  for (const [format, builder, expectedError, applicableMalformations] of cases) {
    for (const [malformName, malform] of Object.entries(MALFORMATIONS).filter(([name]) => applicableMalformations.includes(name))) {
      const broken = malform(builder())
      let result: ReturnType<typeof validateQuestion> | undefined
      assert.doesNotThrow(
        () => { result = validateQuestion(broken, context) },
        `validateQuestion NUNCA debe lanzar: ${format} con ${malformName} (reproduce el crash real pre-fix)`,
      )
      assert.equal(result!.valid, false, `${format} con ${malformName} debe marcarse inválida, no aceptada silenciosamente`)
      assert.ok(result!.errors.includes(expectedError), `${format} con ${malformName} debe incluir '${expectedError}' (errors: ${result!.errors.join(',')})`)
    }
    // Control: la forma válida de este formato NUNCA dispara el error de shape.
    const ok = validateQuestion(builder(), context)
    assert.ok(!ok.errors.includes(expectedError), `${format} válido no debe disparar '${expectedError}' (errors: ${ok.errors.join(',')})`)
  }
}

// matching también puede llegar con matchingOptionOrder malformado específicamente
function testMatchingOptionOrderMalformed() {
  for (const malformed of [null, undefined, 'not-an-array', {}] as unknown[]) {
    const broken = { ...validMatching(), matchingOptionOrder: malformed } as unknown as CanonicalQuestion
    let result: ReturnType<typeof validateQuestion> | undefined
    assert.doesNotThrow(() => { result = validateQuestion(broken, context) }, `validateQuestion no debe lanzar con matchingOptionOrder=${JSON.stringify(malformed)}`)
    assert.equal(result!.valid, false)
    assert.ok(result!.errors.includes('invalid_matching_pairs'))
  }
}

// ═══ BUG 2 — matching grounding: cota superior al hang factorial ═══
function buildJudgeablePairs(n: number): MatchingOption[] {
  // n pares, cada uno con vocabulario propio distinto (left/right con al
  // menos una palabra específica de longitud>1) — todos "judgeable" en
  // validateMatchingGrounding, exactamente el peor caso de la búsqueda de
  // permutaciones.
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, rightId: `r${i}`,
    left: `Concepto${i} propiedad${i}`,
    right: `Descripcion${i} detalle${i}`,
  }))
}

function testMatchingGroundingBoundedTime() {
  const n = 12
  const options = buildJudgeablePairs(n)
  const correctAnswer = Object.fromEntries(options.map(o => [o.id, o.rightId]))
  const groundingTexts = options.map(o => `${o.left} se relaciona con ${o.right}`)

  // Layer 1 estructural sigue exigiéndose siempre, sin excepción, para
  // cualquier tamaño — el fix NO debe tocar esto.
  const structural = validateMatchingStructure(options, correctAnswer)
  assert.equal(structural.valid, true, 'matching bien formado de 12 pares debe pasar la capa estructural')

  const start = Date.now()
  const grounding = validateMatchingGrounding(options, groundingTexts)
  const elapsed = Date.now() - start
  assert.ok(elapsed < 2000, `validateMatchingGrounding con ${n} pares debe completar en <2000ms tras el fix (tomó ${elapsed}ms — antes del fix, n=10 tomaba ~13000ms y crece factorial)`)
  assert.equal(grounding.valid, true, 'por encima de la cota, la capa 2 no rechaza por permutación (igual que "sin señal suficiente")')

  // Layer 1 sigue rechazando un matching de 12 pares genuinamente inválido
  // (IDs duplicados) — la cota de la capa 2 no debilita la capa 1.
  const brokenOptions = [...options.slice(0, -1), { ...options[0], id: 'p0' }]
  const brokenStructural = validateMatchingStructure(brokenOptions, correctAnswer)
  assert.equal(brokenStructural.valid, false, 'IDs duplicados en un matching grande deben seguir siendo rechazados por la capa estructural')
}

// Control: por debajo de la cota, el comportamiento NO cambió — un matching
// pequeño con drift de contenido real sigue siendo detectado por la capa 2.
function testMatchingGroundingBelowCapUnaffected() {
  const options: MatchingOption[] = [
    { id: 'p1', rightId: 'm1', left: 'Mitocondria', right: 'Contiene el material genético de la célula' },
    { id: 'p2', rightId: 'm2', left: 'Núcleo', right: 'Produce energía celular mediante respiración' },
    { id: 'p3', rightId: 'm3', left: 'Ribosoma', right: 'Sintetiza proteínas a partir de ARN mensajero' },
  ]
  const groundingTexts = [
    'Mitocondria: produce energía celular mediante respiración.',
    'Núcleo: contiene el material genético de la célula.',
    'Ribosoma: sintetiza proteínas a partir de ARN mensajero.',
  ]
  const result = validateMatchingGrounding(options, groundingTexts)
  assert.equal(result.valid, false, 'drift de contenido real (Mitocondria<->Núcleo desplazados) debe seguir detectándose por debajo de la cota')
}

function main() {
  testValidateQuestionNeverThrowsAcrossFormats()
  testMatchingOptionOrderMalformed()
  testMatchingGroundingBoundedTime()
  testMatchingGroundingBelowCapUnaffected()
  console.log('question-validation-shape-fuzzing-contracts: PASS (5 formatos x 4 malformaciones en validateQuestion, matching grounding acotado sin regresión bajo la cota)')
}

main()
