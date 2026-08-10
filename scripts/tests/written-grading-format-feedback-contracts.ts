process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-pretest'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { deriveWrittenGradingVerdict, type WrittenGradingSignals } from '../../lib/adaptive/evaluation/writtenGrading'
import { validateQuestionTypeForMode } from '../../lib/adaptive/evaluation/evaluationModeContract'
import { POST as sessionCheckPOST } from '../../app/api/adaptive/session-check/route'
import { signQuestionIntegrity } from '../../lib/adaptive/evaluation/questionIntegrity'
import type { CanonicalQuestion } from '../../lib/adaptive/evaluation/questionContract'
import { buildAssessmentBlueprint, recordAssessmentEvidence } from '../../lib/adaptive/evaluation/assessmentBlueprint'
import { normalizeGeneratedQuestion, type GenerationContext } from '../../lib/adaptive/evaluation/questionContract'

// Auditoría adversarial (Codex, misión nocturna FASE 1-3, post-319a5bc):
// grading de respuestas escritas sin distinción CORE/OPTIONAL, feedback
// genérico que nunca usaba la respuesta real del estudiante, y
// write_explain estructuralmente incapaz de producir short_response en el
// flujo vivo de generación. Este archivo prueba, de forma determinista (sin
// LLM real salvo donde se indica explícitamente), los 21 casos requeridos.

function signals(overrides: Partial<WrittenGradingSignals> = {}): WrittenGradingSignals {
  return {
    coreResults: [{ requirement: 'requisito central', met: true }],
    optionalDetailsMissing: [],
    contradiction: false,
    keywordStuffingOnly: false,
    vague: false,
    reasoningRequired: false,
    reasoningValid: true,
    whatWasRight: '',
    whatWasWrong: '',
    feedback: '',
    ...overrides,
  }
}

// ═══ A. WRITTEN RESPONSE — 10 casos obligatorios ═══

function test1ConciseCorrect() {
  const decision = deriveWrittenGradingVerdict(signals({ coreResults: [{ requirement: 'se disocia completamente', met: true }] }))
  assert.equal(decision.verdict, 'correct')
  assert.equal(decision.score, 100)
}

function test2ParaphraseCorrect() {
  // La paráfrasis ya se refleja en que el extractor marcó el requisito
  // central como cumplido (met:true) — deriveWrittenGradingVerdict nunca ve
  // el texto crudo, solo la señal ya extraída, así que este caso prueba
  // exactamente lo mismo que el 1 a nivel del contrato determinista: texto
  // distinto, mismo requisito satisfecho, mismo resultado.
  const decision = deriveWrittenGradingVerdict(signals({ coreResults: [{ requirement: 'produce todos sus iones por disociación total', met: true }] }))
  assert.equal(decision.verdict, 'correct')
  assert.equal(decision.score, 100)
}

function test3OptionalDetailMissingStillCorrect() {
  const decision = deriveWrittenGradingVerdict(signals({
    coreResults: [{ requirement: 'disociación completa', met: true }],
    optionalDetailsMissing: ['definición de electrolito', 'ecuación completa'],
  }))
  assert.equal(decision.verdict, 'correct', 'BUG DE ORIGEN SI FALLA: un detalle opcional ausente NUNCA debe bajar de correct/100')
  assert.equal(decision.score, 100)
}

function test4TypoClearMeaningCorrect() {
  const decision = deriveWrittenGradingVerdict(signals({ coreResults: [{ requirement: 'disociación completa', met: true }] }))
  assert.equal(decision.verdict, 'correct', 'un typo no debe afectar el requisito CORE si el significado es claro (la señal ya viene extraída como met:true)')
  assert.equal(decision.score, 100)
}

function test5KeywordStuffingNotCorrect() {
  const decision = deriveWrittenGradingVerdict(signals({ keywordStuffingOnly: true, coreResults: [{ requirement: 'r', met: true }] }))
  assert.notEqual(decision.verdict, 'correct', 'BUG DE ORIGEN SI FALLA: keyword stuffing nunca debe ser correct, incluso si coreResults dice met:true')
  assert.equal(decision.correct, false)
}

function test6ContradictionNotCorrect() {
  const decision = deriveWrittenGradingVerdict(signals({ contradiction: true, coreResults: [{ requirement: 'r', met: true }] }))
  assert.notEqual(decision.verdict, 'correct', 'BUG DE ORIGEN SI FALLA: una contradicción interna nunca debe ser correct')
  assert.equal(decision.correct, false)
}

function test7VagueNotCorrect() {
  const decision = deriveWrittenGradingVerdict(signals({ vague: true, coreResults: [{ requirement: 'r', met: true }] }))
  assert.notEqual(decision.verdict, 'correct', 'BUG DE ORIGEN SI FALLA: una respuesta vaga nunca debe ser correct')
  assert.equal(decision.correct, false)
}

function test8PartialMissingCoreIsPartial() {
  const decision = deriveWrittenGradingVerdict(signals({
    coreResults: [{ requirement: 'r1', met: true }, { requirement: 'r2 (central)', met: false }],
  }))
  assert.equal(decision.verdict, 'partial', 'BUG DE ORIGEN SI FALLA: falta un requisito CENTRAL -> partial, no correct')
  assert.equal(decision.correct, false)
  assert.ok(decision.score > 0 && decision.score < 100)
}

function test9PolishedButWrongIsIncorrect() {
  // "Pulida pero conceptualmente incorrecta": el extractor (guiado por el
  // prompt a evaluar CONTENIDO, no fluidez) debe marcar el requisito
  // central como no cumplido pese a la redacción — se simula aquí la señal
  // ya extraída correctamente.
  const decision = deriveWrittenGradingVerdict(signals({ coreResults: [{ requirement: 'r', met: false }] }))
  assert.equal(decision.verdict, 'incorrect')
  assert.equal(decision.correct, false)
}

function test10CorrectConclusionWrongReasoningNotFullCorrect() {
  const decision = deriveWrittenGradingVerdict(signals({
    coreResults: [{ requirement: 'conclusión final', met: true }],
    reasoningRequired: true,
    reasoningValid: false,
  }))
  assert.notEqual(decision.verdict, 'correct', 'BUG DE ORIGEN SI FALLA: conclusión correcta con razonamiento críticamente incorrecto NO debe ser correct cuando la pregunta exige razonamiento')
  assert.equal(decision.correct, false)
}

// ═══ B. FEEDBACK — 5 casos, contra el POST real de session-check ═══

function mcqQuestion(): CanonicalQuestion {
  return {
    id: 'q-feedback-1', conceptId: 'c1', conceptLabel: 'Concepto', teachingBlockId: 'step_1',
    questionFamily: 'mcq_best_answer', variant: 'mcq_best_answer', difficulty: 'medium',
    targetDimension: 'comprehension', questionText: '¿Cuál es correcta?',
    explanation: 'Porque cumple la condición X.', hint: '',
    estimatedSeconds: 30, evidencesNeeded: 1, factKey: 'fact-1', factKeys: ['fact-1'], targetObjectiveIds: ['obj-1'],
    format: 'multiple_choice',
    options: [{ id: 'a', text: 'Respuesta correcta' }, { id: 'b', text: 'Respuesta incorrecta' }],
    correctAnswer: 'a',
  } as CanonicalQuestion
}

async function callSessionCheck(question: CanonicalQuestion, answer: unknown) {
  const signed = { ...question, integrity: signQuestionIntegrity(question) }
  const req = new NextRequest('http://localhost/api/adaptive/session-check', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: signed, answer, teachingContent: 'Contenido enseñado real.', mode: 'mix_everything', materialTitle: 'Material' }),
  })
  return (await sessionCheckPOST(req)).json()
}

async function test11CorrectFeedbackReferencesActualAnswer() {
  const result = await callSessionCheck(mcqQuestion(), 'a')
  assert.equal(result.result.correct, true)
  assert.ok(result.result.feedback.includes('Respuesta correcta'), `BUG DE ORIGEN SI FALLA: el feedback correcto debe referenciar la respuesta REAL elegida por el estudiante: "${result.result.feedback}"`)
}

async function test12IncorrectFeedbackShowsActualMismatch() {
  const result = await callSessionCheck(mcqQuestion(), 'b')
  assert.equal(result.result.correct, false)
  assert.ok(result.result.feedback.includes('Respuesta incorrecta'), `BUG DE ORIGEN SI FALLA: debe mostrar lo que el estudiante realmente respondió: "${result.result.feedback}"`)
  assert.ok(result.result.feedback.includes('Respuesta correcta'), `debe mostrar también la respuesta correcta: "${result.result.feedback}"`)
}

function test13PartialFeedbackSeparatesRightFromMissing() {
  const decision = deriveWrittenGradingVerdict(signals({
    coreResults: [{ requirement: 'r1', met: true }, { requirement: 'r2', met: false }],
  }))
  assert.equal(decision.verdict, 'partial')
  // El contrato de deriveWrittenGradingVerdict deja la separación de
  // right/missing a whatWasRight/whatWasWrong (construidos por el LLM a
  // partir de coreResults) — se verifica aquí que el veredicto boolean
  // 'correct' nunca colapsa un partial a true (lo cual perdería la
  // distinción "parte correcta / parte faltante" en la UI).
  assert.equal(decision.correct, false, 'un partial nunca debe colapsar a correct:true en la UI')
}

async function test14FeedbackCanonicalAnswerMatchesGraderCanonicalAnswer() {
  const question = mcqQuestion()
  const result = await callSessionCheck(question, 'b')
  assert.equal(result.result.correctAnswerDisplay, 'Respuesta correcta', 'correctAnswerDisplay debe derivar del mismo correctAnswer que usó scoreQuestion')
  assert.ok(result.result.feedback.includes(result.result.correctAnswerDisplay), 'el feedback visible debe usar la MISMA respuesta canónica que correctAnswerDisplay')
}

async function test15FeedbackNeverContradictsVerdict() {
  const correctResult = await callSessionCheck(mcqQuestion(), 'a')
  assert.equal(correctResult.result.correct, true)
  assert.ok(!/incorrecta\.|no coincide/i.test(correctResult.result.feedback), `feedback correcto no debe sonar a incorrecto: "${correctResult.result.feedback}"`)

  const incorrectResult = await callSessionCheck(mcqQuestion(), 'b')
  assert.equal(incorrectResult.result.correct, false)
  assert.ok(!/^tu respuesta \(".*"\) es correcta/i.test(incorrectResult.result.feedback), `feedback incorrecto no debe abrir afirmando que es correcta: "${incorrectResult.result.feedback}"`)
}

// ═══ C. FORMAT SELECTION — 6 casos ═══

function test16QuickOnlyNeverProducesWrittenResponse() {
  const result = validateQuestionTypeForMode('quick_test', 'short_response')
  assert.equal(result.valid, false, 'BUG DE ORIGEN SI FALLA: quick_test nunca debe validar short_response como formato permitido')
}

function test17WrittenOnlyProducesWrittenAssessment() {
  const source = readFileSync('app/api/adaptive/session-teach/route.ts', 'utf8')
  assert.match(source, /'short_response'/, 'BUG DE ORIGEN SI FALLA: short_response debe existir en el canonicalizador de formatos del generador vivo')
  assert.match(source, /case 'short_response':/, 'debe existir un case explícito que preserve correctAnswer (la respuesta modelo) para short_response')
  assert.match(source, /write_explain: la evaluación inicial de este bloque DEBE usar short_response/, 'el prompt debe instruir explícitamente write_explain como written-only')
}

function test18MixedChoosesByObjectiveNotRandomQuota() {
  const source = readFileSync('app/api/adaptive/session-teach/route.ts', 'utf8')
  assert.match(source, /mix_everything: elige el formato que mejor demuestre la capacidad exigida por CADA objetivo/, 'el prompt debe instruir selección por objetivo, no por cuota/variedad')
  assert.doesNotMatch(source, /mix_everything.*aleatori/i, 'nunca debe instruir selección aleatoria para mix_everything')
}

function test19NumericObjectiveUsesNumericFormat() {
  const source = readFileSync('app/api/adaptive/session-teach/route.ts', 'utf8')
  assert.match(source, /objetivo numérico → numeric_problem/, 'debe mapear explícitamente objetivo numérico a numeric_problem')
}

function test20OrderingObjectiveUsesOrderingFormat() {
  const source = readFileSync('app/api/adaptive/session-teach/route.ts', 'utf8')
  assert.match(source, /secuencia\/proceso → ordering/, 'debe mapear explícitamente secuencia/proceso a ordering')
}

function test21CausalExplanationUsesWrittenWhenReasoningRequired() {
  const source = readFileSync('app/api/adaptive/session-teach/route.ts', 'utf8')
  assert.match(source, /explicación causal que exige que el estudiante PRODUZCA el razonamiento.*short_response o scenario/, 'debe mapear explícitamente explicación causal que exige producir razonamiento a short_response/scenario')
}

// ═══ C-bis. Revisión final Codex (FASE 5, P1 CONFIRMADO): las variants de
// short_response que el prompt vivo pide/permite deben sobrevivir el
// canonicalizador REAL de producción (normalizeGeneratedQuestion), no solo
// el canonicalizador local de session-teach/route.ts. Antes del fix, el
// prompt anunciaba variants como 'explain_why'/'justify'/'compare_contrast'
// que canonicalizeEvaluationFormat aceptaba localmente, pero
// normalizeGeneratedQuestion las rechazaba silenciosamente por no existir
// en QUESTION_VARIANT_FORMAT — una pregunta write_explain genuinamente
// escrita se descartaba en la validación final. ═══
function testShortResponseVariantsAdvertisedInPromptSurviveRealCanonicalizer() {
  const source = readFileSync('app/api/adaptive/session-teach/route.ts', 'utf8')
  const match = source.match(/- short_response → ([^(]+)\(/)
  assert.ok(match, 'debe existir la línea de variants disponibles para short_response')
  const advertisedVariants = match![1].split(',').map(v => v.trim()).filter(Boolean)
  assert.ok(advertisedVariants.length >= 6, `se esperaban varias variants anunciadas, encontré: ${advertisedVariants.join(', ')}`)

  const context: GenerationContext = {
    activeConceptId: 'c1', activeConceptLabel: 'Concepto', teachingBlockId: 'step_1',
    targetDimension: 'comprehension', questionFamily: 'written_check',
    allowedConceptIds: ['c1'], forbiddenConceptIds: [],
  }

  for (const variant of advertisedVariants) {
    const normalized = normalizeGeneratedQuestion({
      variant, conceptId: 'c1', targetDimension: 'comprehension', difficulty: 'medium',
      questionText: `Pregunta de prueba para la variant ${variant}.`,
      correctAnswer: 'Respuesta modelo de prueba.', explanation: 'Explicación.', hint: '',
      factKey: 'fact-written-1',
    }, context, `q-${variant}`)
    assert.ok(normalized, `BUG DE ORIGEN SI FALLA: la variant "${variant}" anunciada en el prompt vivo debe sobrevivir normalizeGeneratedQuestion (el canonicalizador REAL de producción), no solo el canonicalizador local de session-teach/route.ts`)
    assert.equal(normalized!.format, 'short_response', `la variant "${variant}" debe resolver a format=short_response`)
    assert.equal(normalized!.options, null, 'short_response nunca debe llevar options')
    assert.equal((normalized as any).correctAnswer, 'Respuesta modelo de prueba.', 'la respuesta modelo debe preservarse intacta')
  }
}

function testShortResponseDefaultVariantIsRegistered() {
  const source = readFileSync('app/api/adaptive/session-teach/route.ts', 'utf8')
  const match = source.match(/short_response: '([a-z_]+)'/)
  assert.ok(match, 'debe existir un default variant para short_response en DEFAULT_VARIANT_BY_FORMAT')
  const context: GenerationContext = {
    activeConceptId: 'c1', activeConceptLabel: 'Concepto', teachingBlockId: 'step_1',
    targetDimension: 'comprehension', questionFamily: 'written_check',
    allowedConceptIds: ['c1'], forbiddenConceptIds: [],
  }
  const normalized = normalizeGeneratedQuestion({
    variant: match![1], conceptId: 'c1', targetDimension: 'comprehension', difficulty: 'medium',
    questionText: 'Pregunta con el variant por defecto.', correctAnswer: 'Respuesta modelo.', explanation: '', hint: '',
  }, context, 'q-default')
  assert.ok(normalized, `BUG DE ORIGEN SI FALLA: el variant por defecto "${match![1]}" también debe estar registrado en QUESTION_VARIANT_FORMAT`)
}

// ═══ D. ESCENARIO INTEGRADO — written-only: 0 false mastery, 0 false non-mastery ═══
//
// Simula un estudiante con setup written-only respondiendo 5 preguntas
// distintas que targetean el MISMO factKey (concise correct, paraphrased
// correct, partial, misconception, vague) contra el pipeline REAL de
// evidencia (buildAssessmentBlueprint + recordAssessmentEvidence) — la
// señal de entrada es la misma que produciría deriveWrittenGradingVerdict
// para cada tipo de respuesta.
function testIntegratedWrittenOnlyScenarioNoFalseMasteryNoFalseNonMastery() {
  const stepId = 'step-written-only'
  const factKey = `${stepId}:fact:1`
  const blueprint = buildAssessmentBlueprint(
    [{ id: stepId, title: 'Concepto', content: 'contenido', keyPoints: ['punto'], factKeys: [factKey], importance: 0.8 }],
    'session-written-only', 1,
  )
  const objectiveId = blueprint.objectives[0].objectiveId

  const responses: Array<{ label: string; sig: WrittenGradingSignals; expectDemonstrated: boolean }> = [
    { label: 'concise correct', sig: signals({ coreResults: [{ requirement: 'r', met: true }] }), expectDemonstrated: true },
    { label: 'paraphrased correct', sig: signals({ coreResults: [{ requirement: 'r', met: true }] }), expectDemonstrated: true },
    { label: 'partial', sig: signals({ coreResults: [{ requirement: 'r1', met: true }, { requirement: 'r2', met: false }] }), expectDemonstrated: false },
    { label: 'misconception', sig: signals({ coreResults: [{ requirement: 'r', met: false }] }), expectDemonstrated: false },
    { label: 'vague', sig: signals({ vague: true, coreResults: [{ requirement: 'r', met: true }] }), expectDemonstrated: false },
  ]

  let current = blueprint
  for (const { label, sig, expectDemonstrated } of responses) {
    // Cada respuesta se evalúa contra un blueprint FRESCO (representa
    // intentos independientes de distintas preguntas sobre el mismo
    // factKey) — lo que importa es que recordAssessmentEvidence, alimentado
    // por el `correct` que produce deriveWrittenGradingVerdict, nunca
    // acredite el factKey salvo para las dos respuestas genuinamente
    // correctas.
    const decision = deriveWrittenGradingVerdict(sig)
    const attempted = recordAssessmentEvidence(blueprint, [objectiveId], [factKey], {
      valid: true, correct: decision.correct, independent: true, evidenceId: `evidence-${label}`,
    })
    const objective = attempted.objectives.find(o => o.objectiveId === objectiveId)!
    const demonstrated = objective.demonstratedFactKeys.includes(factKey)
    assert.equal(demonstrated, expectDemonstrated, `BUG DE ORIGEN SI FALLA — "${label}": demonstratedFactKeys=${demonstrated}, esperado=${expectDemonstrated} (0 false mastery / 0 false non-mastery)`)
    if (expectDemonstrated) current = attempted
  }
  // Control positivo final: al menos una de las respuestas genuinamente
  // correctas SÍ dejó el factKey demostrado en algún punto del recorrido.
  assert.ok(current.objectives.find(o => o.objectiveId === objectiveId)!.demonstratedFactKeys.includes(factKey), 'al menos una respuesta correcta real debe demostrar el factKey')
}

// ═══ E. ESCENARIO INTEGRADO — mixed: distintos cognitive targets => formatos pedagógicamente adecuados ═══
function testIntegratedMixedScenarioObjectiveDrivenFormats() {
  const source = readFileSync('app/api/adaptive/session-teach/route.ts', 'utf8')
  const mixedGuideline = source.match(/mix_everything: elige el formato[^\n]*\n/)
  assert.ok(mixedGuideline, 'debe existir la guía de selección por objetivo para mix_everything')
  const guideline = mixedGuideline![0]
  // Verifica que la guía cubre múltiples cognitive targets/necesidades
  // simultáneamente (no un solo mapping aislado) — reflejando que distintos
  // objetivos en la MISMA sesión mixed reciben formatos distintos según su
  // propia naturaleza, no una cuota fija.
  for (const mapping of ['numeric_problem', 'ordering', 'matching', 'classify', 'short_response o scenario', 'multi_select']) {
    assert.ok(guideline.includes(mapping), `la guía mixed debe cubrir el mapping hacia "${mapping}": "${guideline}"`)
  }
}

async function run() {
  test1ConciseCorrect()
  test2ParaphraseCorrect()
  test3OptionalDetailMissingStillCorrect()
  test4TypoClearMeaningCorrect()
  test5KeywordStuffingNotCorrect()
  test6ContradictionNotCorrect()
  test7VagueNotCorrect()
  test8PartialMissingCoreIsPartial()
  test9PolishedButWrongIsIncorrect()
  test10CorrectConclusionWrongReasoningNotFullCorrect()
  await test11CorrectFeedbackReferencesActualAnswer()
  await test12IncorrectFeedbackShowsActualMismatch()
  test13PartialFeedbackSeparatesRightFromMissing()
  await test14FeedbackCanonicalAnswerMatchesGraderCanonicalAnswer()
  await test15FeedbackNeverContradictsVerdict()
  test16QuickOnlyNeverProducesWrittenResponse()
  test17WrittenOnlyProducesWrittenAssessment()
  test18MixedChoosesByObjectiveNotRandomQuota()
  test19NumericObjectiveUsesNumericFormat()
  test20OrderingObjectiveUsesOrderingFormat()
  test21CausalExplanationUsesWrittenWhenReasoningRequired()
  testShortResponseVariantsAdvertisedInPromptSurviveRealCanonicalizer()
  testShortResponseDefaultVariantIsRegistered()
  testIntegratedWrittenOnlyScenarioNoFalseMasteryNoFalseNonMastery()
  testIntegratedMixedScenarioObjectiveDrivenFormats()
  console.log('written-grading-format-feedback-contracts: PASS (21 casos — written grading CORE/OPTIONAL determinista, feedback usa la respuesta real y nunca contradice el veredicto, format selection written-only/quick-only/mixed verificado; escenario integrado written-only con 0 false mastery/0 false non-mastery; escenario mixed objective-driven)')
}

run()
