#!/usr/bin/env tsx
import {
  normalizeEvalPreference,
  normalizeInteractionForPreference,
  prepareInteractionForDelivery,
  resolveMicroNames,
  SUPPORTED_INTERACTION_FORMATS,
  validateInteractionContract,
  validateNoAnswerLeak,
} from '../../lib/adaptive/v3/engine/interactionContract'
import { buildDistinctRepairContent, isNearDuplicateContent } from '../../lib/adaptive/v3/engine/contentDiversity'
import { evaluateAnswer, evaluateNumericShort } from '../../lib/adaptive/v3/engine/answerEvaluator'
import { repairStrategyForFailure } from '../../lib/adaptive/v3/engine/objectiveSelector'
import { pickNextQuestion, type QuestionBank } from '../../lib/adaptive/v3/graph/questionBank'
import { shouldGenerateInitialQuestionBank } from '../../lib/adaptive/v3/graph/orchestrator'
import { autoMath } from '../../lib/adaptive/v3/ui/autoMath'
import { canRenderSessionComplete, canonicalSessionDestination, shouldRenderActiveContent } from '../../lib/adaptive/v3/ui/interactionMachine'
import type { MicroConcept } from '../../lib/adaptive/v3/types'
import { resolveCanonicalMaterialIdentity, validateAdaptiveProgramIdentity } from '../../lib/adaptive/materialIdentity'

let passed = 0
let failed = 0
const assert = (label: string, condition: boolean) => {
  if (condition) { passed++; console.log(`  ✓ ${label}`) } else { failed++; console.error(`  ✗ ${label}`) }
}

async function main() {

const rapid = normalizeEvalPreference('rapid')
for (const denied of ['step_by_step_solver', 'open_response']) {
  assert(`rapid nunca entrega ${denied}`, validateInteractionContract({ interactionType: denied, prompt: 'Responde', data: {} }, rapid).some(e => e.includes('denied')))
}
const banked = normalizeInteractionForPreference({ id: 'rapid-bank', questionId: 'rapid-bank', factKey: 'rapid-bank-fact', interactionType: 'fill_blank', prompt: 'Completa ___', data: { bank: ['rápido', 'lento', 'uniforme'], correctAnswers: ['rápido'] } }, rapid)!
assert('rapid fill_blank se convierte a fill_blank_bank', banked.interactionType === 'fill_blank_bank')
assert('rapid fill_blank siempre tiene word bank válido', validateInteractionContract(banked, rapid).length === 0)
const incompleteRapidBlank = normalizeInteractionForPreference({ interactionType: 'fill_blank', prompt: 'Completa ___', data: { correctAnswers: ['x'] } }, rapid)!
assert('rapid convierte fill_blank incompleto y lo deja para reparación contractual', incompleteRapidBlank.interactionType === 'fill_blank_bank' && validateInteractionContract(incompleteRapidBlank, rapid).includes('FILL_BLANK_BANK_WORD_BANK_MIN_3'))
const incompleteBankErrors = validateInteractionContract({ interactionType: 'fill_blank_bank', prompt: 'Completa ___', data: { template: 'Bohr propuso ___', correctAnswers: ['órbitas'] } }, rapid)
assert('fill_blank_bank incompleto identifica wordBank ausente con reason code preciso', incompleteBankErrors.includes('FILL_BLANK_BANK_WORD_BANK_MIN_3'))

assert('answer leakage se detecta en prompt', validateNoAnswerLeak({ interactionType: 'numeric_short', prompt: 'La respuesta es -3.4 eV', data: { correctAnswer: '-3.4 eV' } }).length === 1)

const numeric = evaluateNumericShort({ data: { correctAnswer: '-3.4 eV', tolerance: 0.001, answerField: 'energía' } }, '-3.4')
assert('-3.4 equivale mayormente a -3.4 eV', numeric.semanticOutcome === 'mostly_correct' && numeric.score >= 80)
const invalidN = evaluateNumericShort({ data: { correctAnswer: '2', answerField: 'n' } }, '2.5')
assert('n de Bohr exige entero positivo', invalidN.outcome === 'incorrect')

const micro: MicroConcept = {
  id: 'micro_bohr', name: 'Rapidez electrónica', shortDescription: '', fullDefinition: '', cognitiveType: 'definitional', difficulty: 30, estimatedMinutes: 2,
  sourceQuotes: [], sourceChunkIds: [], sourcePages: [], examples: [], formulas: [], procedures: [], commonErrors: [], prerequisites: [], enables: [], related: [], importance: 'medium', topicGroup: 'Bohr', extractedAt: 0,
}
const equivalent = await evaluateAnswer({ interaction: { interactionType: 'fill_blank_bank', data: { correctAnswers: ['rápido'], bank: ['rápido', 'lento'] } }, studentAnswer: 'veloz', micro })
assert('rápido/veloz son equivalentes', equivalent.outcome === 'correct')

const strategies = [1, 2, 3].map(repairStrategyForFailure)
assert('tres fallos producen tres estrategias distintas', new Set(strategies).size === 3)

const bank: QuestionBank = {
  microId: 'micro_bohr', microName: 'Bohr', cognitiveType: 'conceptual', totalQuestions: 2, requiredEvidences: 1,
  questionsByFormat: { multiple_choice: [
    { id: 'q_old', microId: 'micro_bohr', format: 'multiple_choice', cognitiveAngle: 'recall', factKey: 'same_fact', prompt: 'Vieja', data: {}, sourceQuote: 'hecho', difficulty: 'easy' },
    { id: 'q_new_id_same_fact', microId: 'micro_bohr', format: 'multiple_choice', cognitiveAngle: 'apply', factKey: 'same_fact', prompt: 'Repetida', data: {}, sourceQuote: 'hecho', difficulty: 'medium' },
  ] },
}
assert('final review no reutiliza questionId ni factKey', pickNextQuestion(bank, ['q_old'], undefined, undefined, ['same_fact']) === null)

assert('session_complete exige persistencia confirmada', !canRenderSessionComplete(true, false) && canRenderSessionComplete(true, true))
assert('Ver mi programa vuelve al libro canónico', canonicalSessionDestination() === 'book')
assert('ningún microId aparece en nombres renderizados', resolveMicroNames(['micro_bohr', 'micro_missing'], [micro]).every(name => !name.includes('micro_')))
assert('loading no conserva controles activos', !shouldRenderActiveContent('evaluating') && !shouldRenderActiveContent('loading'))

const math = autoMath('E_n = -13.6/n^2 eV')
assert('math procesa fracción, exponente y unidad sin duplicar fórmula', math.includes('\\frac') && math.includes('\\text{eV}') && math.indexOf('\\frac') === math.lastIndexOf('\\frac'))
assert('math preserva blanks para interacción', autoMath('Completa ___ y x^2').includes('___'))
assert('generación inicial no construye todos los bancos', shouldGenerateInitialQuestionBank() === false)

const currentMaterial = { materialId: 'mat_bohr_new', id: 'legacy_new' }
const oldMastery = { materialId: 'mat_bohr_old', adaptiveProgram: { materialId: 'mat_bohr_old' }, sessionId: 'old_session' }
const sameMastery = { materialId: 'mat_bohr_new', masteryScore: 42, sessionId: 'valid_session' }
const canonical = resolveCanonicalMaterialIdentity([currentMaterial], oldMastery)
assert('material nuevo + baseMastery viejo usa material nuevo', canonical.currentMaterialId === 'mat_bohr_new')
assert('baseMastery de otro material no se reutiliza', canonical.compatibleMastery === null)
assert('mismo material sí restaura mastery y sesión válidos', resolveCanonicalMaterialIdentity([currentMaterial], sameMastery).compatibleMastery === sameMastery)

const currentGraphIds = ['new_m1', 'new_m2']
const validProgram = { materialId: 'mat_bohr_new', graphMicroIds: currentGraphIds, sessions: [{ id: 'new_session', assignedMicroIds: currentGraphIds }] }
const oldProgram = { materialId: 'mat_bohr_old', graphMicroIds: ['old_m1'], sessions: [{ id: 'old_session', assignedMicroIds: ['old_m1'] }] }
const contaminatedProgram = { materialId: 'mat_bohr_new', graphMicroIds: currentGraphIds, sessions: [{ id: 'bad_session', assignedMicroIds: ['old_m1'] }] }
assert('programa persistido con materialId distinto se invalida', !validateAdaptiveProgramIdentity(oldProgram, 'mat_bohr_new', currentGraphIds))
assert('assignedMicroIds de otro material no se restauran', !validateAdaptiveProgramIdentity(contaminatedProgram, 'mat_bohr_new', currentGraphIds))
assert('programa con microIds ausentes en grafo actual se invalida', !validateAdaptiveProgramIdentity(contaminatedProgram, 'mat_bohr_new', currentGraphIds))
assert('programa del mismo material y grafo sí es válido', validateAdaptiveProgramIdentity(validProgram, 'mat_bohr_new', currentGraphIds))
assert('re-upload del mismo PDF con nuevo materialId invalida programa anterior', !validateAdaptiveProgramIdentity(validProgram, 'mat_bohr_reupload', currentGraphIds))
assert('tutor no recibe microIds viejos desde un programa rechazado', !validateAdaptiveProgramIdentity(oldProgram, 'mat_bohr_new', currentGraphIds))

const validByFormat: Record<string, { prompt: string; data: Record<string, unknown> }> = {
  multiple_choice: { prompt: 'Selecciona la opción válida', data: { options: ['A', 'B'], correctIndex: 0 } },
  multi_select: { prompt: 'Selecciona todas', data: { options: ['A', 'B'], correctIndices: [0] } },
  true_false: { prompt: 'Evalúa', data: { statement: 'La afirmación se apoya en el material', correctAnswer: true, explanation: 'Así lo indica el texto.' } },
  fill_blank: { prompt: 'Completa ___', data: { template: 'El modelo usa ___.', correctAnswers: ['niveles'] } },
  fill_blank_bank: { prompt: 'Completa ___', data: { template: 'El modelo usa ___.', correctAnswers: ['niveles'], bank: ['niveles', 'órbitas', 'estados'] } },
  matching: { prompt: 'Relaciona', data: { pairs: [{ left: 'A', right: '1' }, { left: 'B', right: '2' }] } },
  ordering: { prompt: 'Ordena', data: { items: ['A', 'B'], correctOrder: [0, 1] } },
  open_response: { prompt: 'Explica', data: { criteria: ['idea central'] } },
  explain_why: { prompt: 'Explica por qué', data: { expectedFactors: ['causa'] } },
  teach_back: { prompt: 'Enséñalo', data: { rubric: ['definición'] } },
  practical_case: { prompt: 'Analiza', data: { scenario: 'Caso', question: '¿Qué ocurre?', expectedElements: ['aplicación'] } },
  prediction: { prompt: 'Predice', data: { setup: 'Situación', question: '¿Qué pasará?', expectedAnswer: 'Resultado' } },
  step_by_step_solver: { prompt: 'Resuelve', data: { problem: 'Problema', expectedSteps: ['Paso 1', 'Paso 2'] } },
  numeric_short: { prompt: 'Calcula', data: { correctAnswer: 2, tolerance: 0, answerField: 'n' } },
  classify_groups: { prompt: 'Clasifica', data: { items: ['A', 'B'], groups: ['G1', 'G2'], correctAssignments: { A: 'G1', B: 'G2' } } },
  find_the_error: { prompt: 'Encuentra el error', data: { workedSolution: ['bien', 'mal'], errorStepIndex: 1, explanation: 'El segundo paso falla.' } },
  complete_procedure: { prompt: 'Ordena el procedimiento', data: { steps: ['A', 'B'], correctOrder: [0, 1] } },
  complete_reaction_or_formula: { prompt: 'Completa ___', data: { template: 'E = ___', correctAnswers: ['hν'] } },
  calculator_check: { prompt: 'Comprueba', data: { correctAnswer: 2, tolerance: 0 } },
  choose_best_procedure: { prompt: 'Elige', data: { options: ['A', 'B'], correctIndex: 0 } },
  quick_check: { prompt: 'Responde', data: { acceptedAnswers: ['nivel'] } },
  formula_builder: { prompt: 'Completa ___', data: { equation: 'E = ___', correctAnswer: 'hν' } },
  concept_map: { prompt: 'Conecta', data: { nodes: ['A', 'B'], connections: [{ from: 'A', to: 'B' }] } },
  compare_contrast: { prompt: 'Compara', data: { itemA: 'A', itemB: 'B', expectedDifferences: ['diferencia'] } },
}
for (const format of SUPPORTED_INTERACTION_FORMATS) {
  const fixture = validByFormat[format]
  assert(`${format} válido satisface su contrato`, !!fixture && validateInteractionContract({ id: `id-${format}`, questionId: `id-${format}`, factKey: `fact-${format}`, interactionType: format, ...fixture }, 'mix_everything').length === 0)
}

const repairedBank = prepareInteractionForDelivery(
  { interactionType: 'fill_blank_bank', prompt: 'Completa ___', data: { template: 'Bohr propuso ___.', correctAnswers: ['niveles'] } },
  rapid,
  { microId: 'bohr-levels', microName: 'niveles cuantizados', objective: 'verify_understanding' },
)
assert('fill_blank_bank sin banco fiable cambia a formato seguro', repairedBank.status === 'safe_fallback' && repairedBank.interaction.interactionType === 'true_false' && validateInteractionContract(repairedBank.interaction, rapid).length === 0)
assert('fill_blank_bank sin blank falla con reason code preciso', validateInteractionContract({ interactionType: 'fill_blank_bank', prompt: 'Completa', data: { template: 'Bohr propuso niveles', correctAnswers: ['niveles'], bank: ['niveles', 'órbitas'] } }, rapid).includes('FILL_BLANK_EXPLICIT_BLANK_REQUIRED'))
const repairedMissingAnswer = prepareInteractionForDelivery(
  { interactionType: 'fill_blank_bank', prompt: 'Completa ___', data: { template: 'Bohr propuso ___.', correctAnswers: ['niveles'], bank: ['órbitas', 'átomos'] } },
  rapid,
  { microId: 'bohr-levels', microName: 'niveles cuantizados', objective: 'verify_understanding' },
)
assert('respuesta correcta ausente del banco se incorpora exactamente una vez', validateInteractionContract(repairedMissingAnswer.interaction, rapid).length === 0)
const duplicateOptions = prepareInteractionForDelivery(
  { interactionType: 'fill_blank_bank', prompt: 'Completa ___', data: { template: 'Bohr propuso ___.', correctAnswers: ['niveles'], bank: ['niveles', 'niveles', 'órbitas'] } },
  rapid,
  { microId: 'bohr-levels', microName: 'niveles cuantizados', objective: 'verify_understanding' },
)
assert('opciones duplicadas se normalizan', validateInteractionContract(duplicateOptions.interaction, rapid).length === 0)
const fallback = prepareInteractionForDelivery(
  { interactionType: 'fill_blank_bank', prompt: '', data: {} },
  rapid,
  { microId: 'bohr-levels', microName: 'niveles cuantizados', objective: 'verify_understanding', usedQuestionIds: ['q_old'] },
)
assert('interacción irreparable usa fallback local válido', fallback.status === 'safe_fallback' && validateInteractionContract(fallback.interaction, rapid).length === 0)
assert('fallback conserva micro y objetivo en factKey', fallback.interaction.factKey?.includes('bohr-levels:verify_understanding') === true)
assert('fallback genera questionId nuevo', fallback.interaction.questionId !== 'q_old')

const repeatedTeaching = 'La estructura atómica describe cómo se organiza el átomo con electrones alrededor del núcleo.'
assert('teaching casi igual se detecta por fingerprint', isNearDuplicateContent('La estructura del átomo organiza electrones alrededor de su núcleo.', [repeatedTeaching], 0.5))
const distinctRepair = buildDistinctRepairContent(micro, 'reconstruct_from_error', 1)
assert('repair cambia representación a estrategia estructurada', distinctRepair.strategy === 'structured_steps' && !isNearDuplicateContent(distinctRepair.tutorMessage, [repeatedTeaching]))

console.log(`Bohr product contracts: PASS ${passed} / FAIL ${failed}`)
process.exit(failed === 0 ? 0 : 1)
}

main().catch(error => { console.error(error); process.exit(1) })
