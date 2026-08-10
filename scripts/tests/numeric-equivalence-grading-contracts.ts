import assert from 'node:assert/strict'
import { scoreQuestion } from '../../lib/adaptive/evaluation/scoring'
import { numericallyEquivalent, parseNumericExpression } from '../../lib/adaptive/evaluation/numericEquivalence'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'

// BUG 2 (prueba humana real): pregunta multiple_choice "Si pH = 2.38, ¿cuál
// es [H3O+]?" con opciones "4.2 × 10^-3 M" (marcada correcta) y "10^-2.38 M"
// (matemáticamente la MISMA cantidad, sin evaluar) — el sistema solo aceptó
// la primera representación -> false non-mastery -> recovery innecesario.
// scoreQuestion calificaba multiple_choice por igualdad estricta de id, sin
// evaluar nunca el contenido numérico de las opciones. La regresión
// obligatoria (10^-2.38 M ≈ 4.2×10^-3 M) se reproduce EXACTAMENTE tal como
// ocurrió, sin modificar la pregunta original para esconder el bug.
//
// Distinción exigida A-E:
//   A. igualdad literal        -> id match (comportamiento preexistente, intacto)
//   B. igualdad numérica       -> "4.2" vs "4,2" vs "4.20"
//   C. equivalencia matemática -> "10^-2.38" vs "4.2×10^-3" (potencia de 10)
//   D. tolerancia/redondeo     -> diferencias de redondeo entre representaciones exactas
//   E. unidades                -> "M" vs "kg" NUNCA deben graduarse equivalentes

function acidStrengthQuestion(): CanonicalQuestion {
  return {
    id: 'q-numeric-equivalence-1', conceptId: 'c-ph', conceptLabel: '[H3O+] a partir de pH', teachingBlockId: 'step_1',
    questionFamily: 'mcq_best_answer', variant: 'mcq_best_answer', difficulty: 'medium',
    targetDimension: 'application',
    questionText: 'Si pH = 2.38, ¿cuál es [H3O+]?',
    explanation: '[H3O+] = 10^(-pH).',
    hint: '', estimatedSeconds: 60, evidencesNeeded: 1, factKey: 'fact-ph-h3o',
    factKeys: ['fact-ph-h3o'], targetObjectiveIds: ['obj-ph'],
    format: 'multiple_choice',
    options: [
      { id: 'optA', text: '4.2 × 10^-3 M' },
      { id: 'optB', text: '10^-2.38 M' },
      { id: 'optC', text: '2.38 M' },
      { id: 'optD', text: '4.2 × 10^3 M' },
    ],
    correctAnswer: 'optA',
  } as CanonicalQuestion
}

// ═══ A. igualdad literal ═══
function testLiteralIdMatchStillWorks() {
  const question = acidStrengthQuestion()
  assert.equal(scoreQuestion(question, 'optA').correct, true, 'seleccionar el id correcto directamente debe seguir calificando correcto')
}

// ═══ REGRESIÓN OBLIGATORIA — reproducción exacta del caso real ═══
function testRealCaseExponentialFormEquivalentToDecimalForm() {
  const question = acidStrengthQuestion()
  const result = scoreQuestion(question, 'optB')
  assert.equal(result.correct, true, 'BUG DE ORIGEN SI FALLA: 10^-2.38 M debe calificarse correcto, es la misma cantidad que 4.2×10^-3 M (optA)')
}

function testUnevaluatedExpressionAcceptedWhenPromptDoesNotDemandEvaluation() {
  // El prompt real ("¿cuál es [H3O+]?") no exige explícitamente "valor
  // numérico aproximado" — una expresión sin evaluar (10^-2.38) debe
  // aceptarse como completa cuando esa exigencia no está en el prompt.
  const question = acidStrengthQuestion()
  assert.equal(scoreQuestion(question, 'optB').correct, true)
}

function testClearlyDifferentMagnitudeStillIncorrect() {
  const question = acidStrengthQuestion()
  assert.equal(scoreQuestion(question, 'optD').correct, false, '4.2 × 10^3 M es una magnitud completamente distinta, nunca debe colar por el fallback de equivalencia')
  assert.equal(scoreQuestion(question, 'optC').correct, false, '2.38 M (el pH crudo, no la concentración) tampoco debe colar')
}

// ═══ parseNumericExpression / numericallyEquivalent en aislamiento ═══

function testParsesPowerOfTenNotation() {
  const parsed = parseNumericExpression('10^-2.38')
  assert.ok(parsed, 'debe parsear notación de potencia de 10')
  assert.ok(Math.abs(parsed!.value - Math.pow(10, -2.38)) < 1e-9)
}

function testParsesMultiplicationSignVariants() {
  const viaTimes = parseNumericExpression('4.2 × 10^-3')
  const viaX = parseNumericExpression('4.2 x 10^-3')
  const viaDot = parseNumericExpression('4.2 · 10^-3')
  const viaAsterisk = parseNumericExpression('4.2 * 10^-3')
  for (const parsed of [viaTimes, viaX, viaDot, viaAsterisk]) {
    assert.ok(parsed, 'todas las variantes de signo de multiplicación deben parsear')
    assert.ok(Math.abs(parsed!.value - 4.2e-3) < 1e-9)
  }
}

function testParsesUnitSuffix() {
  const parsed = parseNumericExpression('4.2 × 10^-3 M')
  assert.ok(parsed)
  assert.equal(parsed!.unit, 'M')
  assert.ok(Math.abs(parsed!.value - 4.2e-3) < 1e-9)
}

// ═══ B. igualdad numérica (decimal/coma, redundancia de ceros) ═══
function testNumericEqualityVariants() {
  assert.equal(numericallyEquivalent('4.2', '4,2'), true, 'coma decimal debe tratarse igual que punto decimal')
  assert.equal(numericallyEquivalent('4.20', '4.2'), true, 'ceros redundantes no deben afectar la igualdad numérica')
}

// ═══ C. equivalencia matemática ═══
function testMathematicalEquivalence() {
  assert.equal(numericallyEquivalent('10^-2.38', '4.2e-3'), true)
  assert.equal(numericallyEquivalent('10^-2.38', '4.2 × 10^-3'), true)
}

// ═══ D. tolerancia/redondeo ═══
function testRoundingToleranceIsTight() {
  assert.equal(numericallyEquivalent('4.2e-3', '4.2001e-3'), true, 'diferencia de redondeo mínima debe pasar')
  assert.equal(numericallyEquivalent('4.2e-3', '5.0e-3'), false, 'una diferencia real (19%) NUNCA debe pasar por tolerancia')
}

// ═══ E. unidades ═══
function testUnitsMustMatchWhenBothDeclared() {
  assert.equal(numericallyEquivalent('4.2e-3 M', '4.2e-3 kg'), false, 'unidades declaradas y distintas nunca deben ser equivalentes')
  assert.equal(numericallyEquivalent('4.2e-3 M', '4.2e-3 M'), true, 'misma unidad, mismo valor -> equivalente')
  assert.equal(numericallyEquivalent('4.2e-3', '4.2e-3 M'), true, 'ausencia de unidad en un solo lado no debe forzar rechazo (E, diseño conservador)')
}

// ═══ No cualquier cosa "vagamente parecida" pasa ═══
function testNonNumericTextNeverFalselyEquivalent() {
  assert.equal(numericallyEquivalent('4.2 × 10^-3 M', 'una concentración baja'), false, 'prosa no numérica nunca debe colar, aunque hable del mismo concepto')
  assert.equal(numericallyEquivalent('H3PO4, HNO3, H2SO4, HCl', 'HCl, HBr, HI, HNO3'), false, 'texto no numérico de un distractor MCQ real nunca debe activar el fallback')
}

// ═══ numeric_problem reusa el mismo parser (soporta ahora "^") ═══
function testNumericProblemAcceptsPowerOfTenTypedAnswer() {
  const question = {
    id: 'q-numeric-problem-1', format: 'numeric_problem',
    correctAnswer: { value: 4.2e-3, tolerance: 0.05e-3, unit: 'M' },
  } as unknown as CanonicalQuestion
  const result = scoreQuestion(question, { value: '10^-2.38', unit: 'M' } as any)
  assert.equal(result.correct, true, 'un valor typed como "10^-2.38" ahora debe parsearse y calificarse correcto (antes: NaN, siempre incorrecto)')
}

function testNumericProblemStillRejectsUnitMismatch() {
  const question = {
    id: 'q-numeric-problem-2', format: 'numeric_problem',
    correctAnswer: { value: 4.2, tolerance: 0.1, unit: 'mol/L' },
  } as unknown as CanonicalQuestion
  assert.equal(scoreQuestion(question, { value: 4.2, unit: 'kg' } as any).correct, false, 'no debe regresionar el guard de unidades existente')
}

testLiteralIdMatchStillWorks()
testRealCaseExponentialFormEquivalentToDecimalForm()
testUnevaluatedExpressionAcceptedWhenPromptDoesNotDemandEvaluation()
testClearlyDifferentMagnitudeStillIncorrect()
testParsesPowerOfTenNotation()
testParsesMultiplicationSignVariants()
testParsesUnitSuffix()
testNumericEqualityVariants()
testMathematicalEquivalence()
testRoundingToleranceIsTight()
testUnitsMustMatchWhenBothDeclared()
testNonNumericTextNeverFalselyEquivalent()
testNumericProblemAcceptsPowerOfTenTypedAnswer()
testNumericProblemStillRejectsUnitMismatch()

console.log('numeric-equivalence-grading-contracts: PASS (A-E + regresión obligatoria 10^-2.38 M ≈ 4.2×10^-3 M + numeric_problem parser compartido)')
