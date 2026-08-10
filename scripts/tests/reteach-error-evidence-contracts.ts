import assert from 'node:assert/strict'
import { normalizeLatestErrorType, buildPriorAttemptsSummary } from '../../app/api/adaptive/session-reteach/route'
import { estimatedExplanationLength } from '../../lib/adaptive/evaluation/recoveryStrategyEngine'

// Auditoría adversarial (Codex, Reteach #2.1, post-319a5bc): la rama viva de
// session-reteach/route.ts (includeVerificationQuestions===true, la ÚNICA
// que ejecutan las peticiones reales) recalculaba SIEMPRE un errorType
// heurístico desde formato+señal de contenido+número de ronda —
// ignorando latestErrorType (evidencia real de la respuesta del
// estudiante que disparó este recovery, ya presente en el request body).
// Dos estudiantes con distractores/confusiones distintas sobre la MISMA
// pregunta y ronda recibían idéntica estrategia de reenseñanza.
//
// Fix: normalizeLatestErrorType mapea el vocabulario de errorType de
// scoring.ts (session-check/route.ts: selection/false_confidence/procedure/
// recall/relation/calculation/explanation) al ErrorType de
// pedagogicalFormatSelector.ts SOLO cuando hay correspondencia semántica
// confiable — nunca inventa una causa de error para valores ambiguos
// (selection/explanation), que deben caer al heurístico existente en vez
// de una confusión conceptual específica no verificable.

function testConfidentMappingsPassThroughOrTranslate() {
  assert.equal(normalizeLatestErrorType('procedure'), 'procedure', 'procedure debe pasar directo')
  assert.equal(normalizeLatestErrorType('relation'), 'relation', 'relation debe pasar directo')
  assert.equal(normalizeLatestErrorType('false_confidence'), 'false_confidence', 'false_confidence debe pasar directo')
  assert.equal(normalizeLatestErrorType('recall'), 'memory', 'BUG DE ORIGEN SI FALLA: recall (vocabulario de scoring.ts) debe traducirse a memory (vocabulario de ErrorType)')
  assert.equal(normalizeLatestErrorType('calculation'), 'procedure', 'BUG DE ORIGEN SI FALLA: calculation debe traducirse a procedure')
}

function testAmbiguousValuesFallBackInsteadOfGuessing() {
  assert.equal(normalizeLatestErrorType('selection'), null, 'BUG DE ORIGEN SI FALLA: selection no tiene una causa de error específica inferible con confianza — no debe inventarse una')
  assert.equal(normalizeLatestErrorType('explanation'), null, 'BUG DE ORIGEN SI FALLA: explanation no tiene mapeo confiable — debe caer al heurístico, no adivinar')
  assert.equal(normalizeLatestErrorType('algo_desconocido'), null, 'un valor desconocido nunca debe forzarse a un ErrorType arbitrario')
  assert.equal(normalizeLatestErrorType(null), null, 'null debe devolver null')
  assert.equal(normalizeLatestErrorType(undefined), null, 'undefined debe devolver null')
  assert.equal(normalizeLatestErrorType(42), null, 'un valor no-string nunca debe pasar (fail-closed ante forma inesperada)')
}

function testAlreadyCanonicalValuesPassThrough() {
  for (const value of ['vocabulary', 'application', 'causal', 'classification', 'memory']) {
    assert.equal(normalizeLatestErrorType(value), value, `${value} ya es un ErrorType canónico y debe pasar sin cambios`)
  }
}

testConfidentMappingsPassThroughOrTranslate()
testAmbiguousValuesFallBackInsteadOfGuessing()
testAlreadyCanonicalValuesPassThrough()

// Auditoría adversarial (Codex, Reteach #1.1): antes solo se listaba el
// enunciado de intentos previos — sin la respuesta real, el prompt no podía
// distinguir "repitió el mismo distractor" de "cambió de confusión".

function testPriorAttemptsSummaryIncludesRealAnswersAndErrorTypes() {
  const summary = buildPriorAttemptsSummary(
    [
      { questionText: '¿Cuál es la fórmula?', studentAnswerDisplay: 'Opción B', correctAnswerDisplay: 'Opción A', errorType: 'procedure' },
      { questionText: '¿Cuál es la fórmula? (variante)', studentAnswerDisplay: 'Opción C', correctAnswerDisplay: 'Opción A', errorType: 'relation' },
    ],
    [],
  )
  assert.ok(summary.includes('Opción B') && summary.includes('procedure'), 'BUG DE ORIGEN SI FALLA: debe incluir la respuesta real y el errorType de la ronda 1')
  assert.ok(summary.includes('Opción C') && summary.includes('relation'), 'BUG DE ORIGEN SI FALLA: debe incluir la respuesta real y el errorType de la ronda 2, distinta de la ronda 1')
  assert.ok(summary.includes('Ronda 1') && summary.includes('Ronda 2'), 'debe distinguir explícitamente cada ronda')
}

function testFallsBackToQuestionTextOnlyWhenNoFailuresSummary() {
  const summary = buildPriorAttemptsSummary(undefined, [{ format: 'multiple_choice', questionText: 'Pregunta previa' }])
  assert.ok(summary.includes('Pregunta previa'), 'sin priorFailuresSummary debe caer al listado de solo-enunciado existente')
  assert.ok(!summary.includes('respondió'), 'el fallback de solo-enunciado no debe inventar una respuesta que no se envió')
}

function testEmptyHistoryReportedAsFirstRound() {
  assert.equal(buildPriorAttemptsSummary(undefined, []), 'Ninguna — esta es la primera ronda.')
  assert.equal(buildPriorAttemptsSummary([], []), 'Ninguna — esta es la primera ronda.')
}

testPriorAttemptsSummaryIncludesRealAnswersAndErrorTypes()
testFallsBackToQuestionTextOnlyWhenNoFailuresSummary()
testEmptyHistoryReportedAsFirstRound()

// Auditoría adversarial (Codex, Reteach #3.2): el contrato de salida vivo
// fijaba "máximo 3 oraciones" SIN IMPORTAR la estrategia decidida —
// contradiciendo estrategias 'detailed' (ejemplo resuelto, descomposición:
// "8-12 frases, no omitas ningún paso").
function testExplanationLengthVariesByStrategyNotHardcoded() {
  const lengths = new Set<string>()
  const errorTypes = ['vocabulary', 'relation', 'application', 'procedure', 'causal', 'classification', 'memory', 'false_confidence'] as const
  const contentSignals = ['definition', 'procedure', 'formula', 'causal', 'classification', 'relation'] as const
  for (const errorType of errorTypes) {
    for (const contentSignal of contentSignals) {
      lengths.add(estimatedExplanationLength(errorType, contentSignal))
    }
  }
  assert.ok(lengths.size > 1, 'BUG DE ORIGEN SI FALLA: la extensión objetivo debe variar según errorType/contentSignal, no ser un único valor fijo')
  const hasDetailed = [...lengths].some(l => l.includes('8-12'))
  assert.ok(hasDetailed, 'BUG DE ORIGEN SI FALLA: debe existir al menos una combinación que pida 8-12 oraciones (ejemplo resuelto/descomposición), no un tope fijo de 3')
}

testExplanationLengthVariesByStrategyNotHardcoded()

console.log('reteach-error-evidence-contracts: PASS (latestErrorType real se traduce con confianza o cae al heurístico sin inventar una confusión conceptual no verificable; historial de intentos previos incluye respuesta real + errorType por ronda; extensión objetivo varía por estrategia, no un tope fijo de 3 oraciones)')
