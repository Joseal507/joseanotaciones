/**
 * pedagogicalFormatSelector.ts
 *
 * Selector determinístico de formatos de pregunta.
 * NO genera preguntas. Decide QUÉ formato usar y POR QUÉ.
 *
 * Reglas:
 * - Sin hardcode de temas específicos
 * - Generalizable a cualquier dominio
 * - Determinístico: misma entrada → mismo formato
 * - Respeta contratos de modo (quick_test, write_explain, etc.)
 * - Maximiza variabilidad sin romper coherencia pedagógica
 */

import type { AcademicDomain } from '../academicDomain'
import type { CanonicalEvaluationMode } from './evaluationModeContract'
import { validateQuestionTypeForMode } from './evaluationModeContract'
import { QUESTION_FORMAT_CAPABILITIES, QUESTION_VARIANT_FORMAT } from './questionFormatRegistry'
import type { QuestionVariant } from '../v3/engine/masteryContract'

// ─── Tipos públicos ───────────────────────────────────────────

export type CognitiveLevel =
  | 'recognition'
  | 'comprehension'
  | 'application'
  | 'transfer'

export type ContentSignal =
  | 'definition'        // "X es Y"
  | 'enumeration'       // lista de elementos
  | 'procedure'         // pasos ordenados
  | 'formula'           // expresión matemática
  | 'causal'            // causa → efecto
  | 'comparison'        // A vs B
  | 'classification'    // categorías
  | 'narrative'         // historia / cronología
  | 'argumentation'     // tesis + evidencia
  | 'case'              // situación concreta
  | 'exception'         // caso especial / advertencia
  | 'relation'          // conexión entre conceptos

export type ErrorType =
  | 'vocabulary'        // no conoce el término
  | 'relation'          // no conecta ideas
  | 'application'       // sabe teoría pero no aplica
  | 'procedure'         // no sigue pasos correctos
  | 'causal'            // confunde causa y efecto
  | 'classification'    // no discrimina categorías
  | 'memory'            // olvidó el contenido
  | 'false_confidence'  // creyó saber pero estaba mal

export interface FormatSelectionInput {
  cognitiveLevel: CognitiveLevel
  contentSignal: ContentSignal
  academicDomain: AcademicDomain
  evaluationMode: CanonicalEvaluationMode
  recentFormats: string[]           // últimos 3-5 formatos usados
  consecutiveFailures: number       // fallos consecutivos del estudiante
  isRecovery: boolean               // es re-evaluación post-reteach
  questionIndex: number             // posición en la secuencia (0, 1, 2...)
  totalQuestionsInBlock: number     // total de preguntas en este bloque
  targetStepIds?: string[]
  targetKeyPointIds?: string[]
  targetFactKeys?: string[]
  targetObjectiveIds?: string[]
  recentVariants?: string[]
  previousEvidence?: Array<{ cognitiveDimension: CognitiveLevel; correct: boolean; factKeys?: string[] }>
  assessmentPurpose?: 'normal' | 'verification' | 'recovery'
}

export interface FormatSelectionResult {
  format: string
  variant: string
  reasoning: string
  cognitiveObjective: string
  estimatedSeconds: number
  difficulty: 'easy' | 'medium' | 'hard'
}

export interface RecoveryFormatInput {
  errorType: ErrorType
  previousFormat: string
  cognitiveLevel: CognitiveLevel
  contentSignal: ContentSignal
  evaluationMode: CanonicalEvaluationMode
  consecutiveFailures: number
}

// ─── Biblioteca de formatos canónicos ────────────────────────
//
// Cada formato tiene:
//   - formats: lista de formatos canónicos que lo implementan
//   - variants: variantes específicas del contrato
//   - cognitiveMatch: niveles que este formato evalúa bien
//   - contentMatch: señales de contenido que favorecen este formato
//   - domainMatch: dominios donde este formato es más efectivo
//   - estimatedSeconds: tiempo estimado de interacción

interface FormatEntry {
  format: string
  variants: string[]
  cognitiveMatch: CognitiveLevel[]
  contentMatch: ContentSignal[]
  domainMatch: AcademicDomain[]
  estimatedSeconds: number
  writingRequired: boolean
}

const FORMAT_LIBRARY: FormatEntry[] = [
  // ── Selección simple ─────────────────────────────────────
  {
    format: 'multiple_choice',
    variants: ['mcq_best_answer', 'mcq_most_likely', 'mcq_cause', 'mcq_consequence', 'mcq_best_explanation', 'mcq_except', 'mcq_analogy', 'mcq_application', 'mcq_compare', 'mcq_rule_example', 'mcq_example_rule'],
    cognitiveMatch: ['recognition', 'comprehension', 'application'],
    contentMatch: ['definition', 'causal', 'comparison', 'formula', 'argumentation'],
    domainMatch: ['general_conceptual', 'medicine', 'law', 'history', 'biology', 'mixed', 'mathematics', 'physics_quantitative', 'chemistry_quantitative', 'chemistry_conceptual', 'language'],
    estimatedSeconds: 35,
    writingRequired: false,
  },
  {
    format: 'multiple_choice',
    variants: ['mcq_next_step', 'mcq_least_likely'],
    cognitiveMatch: ['application', 'transfer'],
    contentMatch: ['procedure', 'case', 'causal'],
    domainMatch: ['medicine', 'law', 'general_conceptual', 'biology', 'mixed'],
    estimatedSeconds: 45,
    writingRequired: false,
  },
  // ── Verdadero / Falso ────────────────────────────────────
  {
    format: 'true_false',
    variants: ['true_false_factual', 'true_false_negation'],
    cognitiveMatch: ['recognition', 'comprehension'],
    contentMatch: ['definition', 'exception', 'comparison', 'enumeration'],
    domainMatch: ['general_conceptual', 'history', 'law', 'medicine', 'biology', 'language', 'mixed', 'chemistry_conceptual', 'mathematics', 'physics_quantitative', 'chemistry_quantitative'],
    estimatedSeconds: 15,
    writingRequired: false,
  },
  // ── Selección múltiple ───────────────────────────────────
  {
    format: 'multi_select',
    variants: ['multi_select_correct', 'multi_select_incorrect', 'multi_select_causes', 'multi_select_consequences', 'multi_select_features', 'multi_select_required_steps', 'multi_select_valid_statements'],
    cognitiveMatch: ['comprehension', 'application'],
    contentMatch: ['enumeration', 'classification', 'comparison', 'causal'],
    domainMatch: ['medicine', 'law', 'biology', 'general_conceptual', 'mixed', 'history', 'chemistry_conceptual'],
    estimatedSeconds: 40,
    writingRequired: false,
  },
  // ── Word bank / Completar ────────────────────────────────
  {
    format: 'word_bank',
    variants: ['word_bank_fill', 'word_bank_definition', 'word_bank_formula', 'word_bank_equation', 'word_bank_process'],
    cognitiveMatch: ['recognition', 'comprehension'],
    contentMatch: ['definition', 'formula', 'enumeration', 'procedure'],
    domainMatch: ['language', 'mathematics', 'physics_quantitative', 'chemistry_quantitative', 'chemistry_conceptual', 'biology', 'medicine', 'general_conceptual', 'mixed'],
    estimatedSeconds: 30,
    writingRequired: false,
  },
  // ── Ordenamiento ─────────────────────────────────────────
  {
    format: 'ordering',
    variants: ['ordering_steps', 'ordering_events', 'ordering_process', 'ordering_magnitude', 'ordering_priority', 'ordering_chronology'],
    cognitiveMatch: ['comprehension', 'application'],
    contentMatch: ['procedure', 'narrative', 'causal', 'enumeration'],
    domainMatch: ['history', 'medicine', 'biology', 'general_conceptual', 'law', 'mixed', 'chemistry_conceptual', 'mathematics', 'physics_quantitative'],
    estimatedSeconds: 40,
    writingRequired: false,
  },
  // ── Matching ─────────────────────────────────────────────
  {
    format: 'matching',
    variants: ['matching_concept_def', 'matching_cause_effect', 'matching_formula_name', 'matching_example_rule', 'matching_term_function', 'matching_structure_function', 'matching_problem_method', 'matching_error_correction'],
    cognitiveMatch: ['recognition', 'comprehension'],
    contentMatch: ['definition', 'comparison', 'relation', 'causal', 'classification'],
    domainMatch: ['general_conceptual', 'medicine', 'law', 'history', 'biology', 'language', 'mathematics', 'chemistry_conceptual', 'mixed'],
    estimatedSeconds: 45,
    writingRequired: false,
  },
  // ── Clasificación ─────────────────────────────────────────
  {
    format: 'classify',
    variants: ['classify_category', 'classify_valid_invalid', 'classify_affected_not', 'classify_examples', 'classify_causes', 'classify_structures', 'classify_processes'],
    cognitiveMatch: ['comprehension', 'application'],
    contentMatch: ['classification', 'comparison', 'enumeration', 'exception'],
    domainMatch: ['biology', 'medicine', 'law', 'chemistry_conceptual', 'general_conceptual', 'history', 'mixed'],
    estimatedSeconds: 40,
    writingRequired: false,
  },
  // ── Escenario / Caso ─────────────────────────────────────
  {
    format: 'scenario',
    variants: ['scenario_predict', 'scenario_diagnose', 'scenario_choose_action', 'scenario_compare', 'scenario_apply_rule', 'scenario_transfer', 'scenario_what_if', 'scenario_clinical', 'scenario_experimental'],
    cognitiveMatch: ['application', 'transfer'],
    contentMatch: ['case', 'causal', 'procedure', 'argumentation'],
    domainMatch: ['medicine', 'law', 'biology', 'general_conceptual', 'mixed', 'history'],
    estimatedSeconds: 55,
    writingRequired: false,
  },
  // ── Detección de error ───────────────────────────────────
  {
    format: 'find_the_error',
    variants: ['find_error_calculation', 'find_error_reasoning', 'find_error_definition', 'find_error_procedure', 'find_error_formula', 'find_error_interpretation'],
    cognitiveMatch: ['comprehension', 'application', 'transfer'],
    contentMatch: ['procedure', 'formula', 'causal', 'definition', 'argumentation'],
    domainMatch: ['mathematics', 'physics_quantitative', 'chemistry_quantitative', 'medicine', 'law', 'general_conceptual', 'mixed'],
    estimatedSeconds: 50,
    writingRequired: false,
  },
  // ── Respuesta corta ───────────────────────────────────────
  {
    format: 'short_response',
    variants: ['short_answer_define', 'short_answer_compare', 'short_answer_summarize', 'explain_why_cause', 'explain_why_consequence', 'justify_answer', 'teach_back', 'problem_setup'],
    cognitiveMatch: ['comprehension', 'application', 'transfer'],
    contentMatch: ['definition', 'causal', 'comparison', 'argumentation', 'relation'],
    domainMatch: ['general_conceptual', 'history', 'law', 'language', 'medicine', 'biology', 'mixed'],
    estimatedSeconds: 75,
    writingRequired: true,
  },
  // ── Problema numérico ─────────────────────────────────────
  {
    format: 'numeric_problem',
    variants: ['problem_solve', 'numeric_missing_value', 'numeric_compare', 'numeric_estimate', 'numeric_intermediate_step'],
    cognitiveMatch: ['application', 'transfer'],
    contentMatch: ['formula', 'procedure', 'causal'],
    domainMatch: ['mathematics', 'physics_quantitative', 'chemistry_quantitative'],
    estimatedSeconds: 90,
    writingRequired: true,
  },
]

// Tabla derivada de FORMAT_LIBRARY (única fuente de verdad, no duplicada): qué
// niveles cognitivos evalúa razonablemente cada variant concreta. Un variant que
// aparece en más de un FormatEntry (p.ej. mcq_best_answer) toma la UNIÓN de los
// niveles de todas las entradas que lo listan.
const VARIANT_COGNITIVE_MATCH: Record<string, Set<CognitiveLevel>> = (() => {
  const table: Record<string, Set<CognitiveLevel>> = {}
  for (const entry of FORMAT_LIBRARY) {
    for (const variant of entry.variants) {
      const set = table[variant] || (table[variant] = new Set())
      for (const level of entry.cognitiveMatch) set.add(level)
    }
  }
  return table
})()

/**
 * Niveles cognitivos que un variant concreto puede evaluar razonablemente,
 * según FORMAT_LIBRARY. Devuelve null si el variant no está catalogado (no se
 * puede afirmar nada — el caller no debe rechazar por falta de dato).
 */
export function cognitiveLevelsForVariant(variant: string): CognitiveLevel[] | null {
  const set = VARIANT_COGNITIVE_MATCH[variant]
  return set ? [...set] : null
}

// ─── Variantes de recuperación por tipo de error ─────────────
//
// Cuando el estudiante falla, la recuperación usa una estrategia
// diferente según el tipo de error detectado.

const RECOVERY_STRATEGY: Record<ErrorType, {
  preferredFormats: string[]
  variants: string[]
  pedagogicalApproach: string
}> = {
  vocabulary: {
    preferredFormats: ['matching', 'word_bank', 'multiple_choice'],
    variants: ['matching_concept_def', 'word_bank_definition', 'mcq_best_answer'],
    pedagogicalApproach: 'Refuerza el término con su definición desde múltiples ángulos',
  },
  relation: {
    preferredFormats: ['matching', 'ordering', 'multiple_choice'],
    variants: ['matching_cause_effect', 'matching_example_rule', 'mcq_consequence'],
    pedagogicalApproach: 'Mapea explícitamente las conexiones entre conceptos',
  },
  application: {
    preferredFormats: ['scenario', 'find_the_error', 'multiple_choice'],
    variants: ['scenario_choose_action', 'find_error_reasoning', 'mcq_next_step'],
    pedagogicalApproach: 'Aplica el concepto a un caso concreto diferente al original',
  },
  procedure: {
    preferredFormats: ['ordering', 'find_the_error', 'word_bank'],
    variants: ['ordering_steps', 'find_error_calculation', 'word_bank_formula'],
    pedagogicalApproach: 'Recorre el procedimiento paso a paso con nuevos valores',
  },
  causal: {
    preferredFormats: ['multiple_choice', 'ordering', 'scenario'],
    variants: ['mcq_cause', 'mcq_consequence', 'ordering_events', 'scenario_predict'],
    pedagogicalApproach: 'Refuerza la cadena causa→efecto con ejemplos alternativos',
  },
  classification: {
    preferredFormats: ['classify', 'matching', 'multi_select'],
    variants: ['classify_valid_invalid', 'classify_category', 'matching_example_rule'],
    pedagogicalApproach: 'Discrimina categorías con casos límite y contraejemplos',
  },
  memory: {
    preferredFormats: ['word_bank', 'matching', 'multiple_choice'],
    variants: ['word_bank_fill', 'matching_concept_def', 'mcq_best_answer'],
    pedagogicalApproach: 'Recupera el contenido con señales de contexto progresivas',
  },
  false_confidence: {
    preferredFormats: ['find_the_error', 'true_false', 'multiple_choice'],
    variants: ['find_error_reasoning', 'true_false_negation', 'mcq_except'],
    pedagogicalApproach: 'Expone la misconception directamente con un contraejemplo',
  },
}

// ─── Funciones internas ───────────────────────────────────────

function scoreEntry(
  entry: FormatEntry,
  input: FormatSelectionInput,
): number {
  let score = 0

  // Coincidencia cognitiva (peso alto)
  if (entry.cognitiveMatch.includes(input.cognitiveLevel)) score += 30

  // Coincidencia de contenido (peso alto)
  if (entry.contentMatch.includes(input.contentSignal)) score += 25

  // Coincidencia de dominio (peso medio)
  if (entry.domainMatch.includes(input.academicDomain)) score += 15

  // Penalizar formatos repetidos recientemente
  const recentPenalty = input.recentFormats.lastIndexOf(entry.format)
  if (recentPenalty !== -1) {
    // Mayor penalización para el más reciente
    score -= (input.recentFormats.length - recentPenalty) * 8
  }

  // Penalizar escritura en recovery con muchos fallos
  if (input.isRecovery && input.consecutiveFailures >= 2 && entry.writingRequired) {
    score -= 20
  }

  // Bonus por diversidad posicional
  // Primera pregunta del bloque: favorecer formatos directos
  if (input.questionIndex === 0 && ['multiple_choice', 'true_false', 'matching'].includes(entry.format)) {
    score += 5
  }

  // Última pregunta del bloque: favorecer formatos integradores
  if (
    input.questionIndex === input.totalQuestionsInBlock - 1 &&
    ['scenario', 'find_the_error', 'multi_select', 'short_response'].includes(entry.format)
  ) {
    score += 8
  }

  // Penalizar formatos de escritura en modo quick_test
  if (input.evaluationMode === 'quick_test' && entry.writingRequired) {
    score -= 100 // bloqueante
  }

  // Favorecer escritura en write_explain
  if (input.evaluationMode === 'write_explain' && entry.writingRequired) {
    score += 15
  }

  return score
}

function selectVariant(
  entry: FormatEntry,
  input: FormatSelectionInput,
): string {
  const preferredByContent: Partial<Record<ContentSignal, string[]>> = {
    definition: ['mcq_best_explanation', 'matching_concept_def', 'word_bank_definition', 'multi_select_features', 'find_error_definition'],
    formula: ['word_bank_formula', 'word_bank_equation', 'find_error_formula', 'problem_solve', 'numeric_intermediate_step'],
    procedure: ['ordering_steps', 'ordering_process', 'mcq_next_step', 'find_error_procedure', 'multi_select_required_steps', 'scenario_choose_action'],
    causal: ['mcq_cause', 'mcq_consequence', 'matching_cause_effect', 'scenario_predict', 'multi_select_causes', 'multi_select_consequences'],
    comparison: ['mcq_compare', 'scenario_compare', 'short_answer_compare', 'classify_category'],
    classification: ['classify_category', 'classify_examples', 'multi_select_features'],
    exception: ['find_error_reasoning', 'mcq_except', 'true_false_negation', 'scenario_diagnose'],
    relation: ['matching_cause_effect', 'matching_example_rule', 'mcq_best_explanation'],
    narrative: ['ordering_chronology', 'ordering_events', 'scenario_what_if'],
  }
  const preferredByCognition: Record<CognitiveLevel, string[]> = {
    recognition: ['true_false_factual', 'mcq_best_answer', 'matching_concept_def', 'word_bank_definition'],
    comprehension: ['mcq_best_explanation', 'mcq_cause', 'mcq_consequence', 'matching_cause_effect', 'find_error_definition', 'explain_why_cause'],
    application: ['scenario_apply_rule', 'scenario_predict', 'scenario_choose_action', 'problem_solve', 'problem_setup', 'mcq_next_step', 'find_error_calculation', 'ordering_steps'],
    transfer: ['scenario_transfer', 'scenario_compare', 'mcq_analogy', 'teach_back', 'justify_answer'],
  }
  const recent = new Set(input.recentVariants || [])
  const ranked = [...(preferredByContent[input.contentSignal] || []), ...preferredByCognition[input.cognitiveLevel]]
  const exact = ranked.find(variant => entry.variants.includes(variant) && !recent.has(variant))
    || ranked.find(variant => entry.variants.includes(variant))
  if (exact) return exact
  if (entry.variants.length === 1) return entry.variants[0]

  // Selección determinística por hash del contexto
  const seed = `${input.cognitiveLevel}:${input.contentSignal}:${input.academicDomain}:${input.questionIndex}`
  let hash = 0
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) & 0xffffffff
  }
  const index = Math.abs(hash) % entry.variants.length
  return entry.variants[index]
}

function buildCognitiveObjective(
  format: string,
  cognitiveLevel: CognitiveLevel,
  contentSignal: ContentSignal,
): string {
  const objectiveMap: Record<CognitiveLevel, Record<ContentSignal, string>> = {
    recognition: {
      definition: 'Identificar la definición correcta del concepto',
      enumeration: 'Reconocer los elementos de la lista',
      procedure: 'Identificar los pasos del procedimiento',
      formula: 'Reconocer la fórmula y sus componentes',
      causal: 'Identificar la causa o el efecto correcto',
      comparison: 'Reconocer las diferencias entre conceptos',
      classification: 'Identificar a qué categoría pertenece',
      narrative: 'Reconocer eventos o personajes clave',
      argumentation: 'Identificar la tesis del argumento',
      case: 'Reconocer los elementos del caso',
      exception: 'Identificar el caso especial',
      relation: 'Reconocer la relación entre conceptos',
    },
    comprehension: {
      definition: 'Explicar con sus propias palabras qué significa el concepto',
      enumeration: 'Entender por qué cada elemento pertenece al conjunto',
      procedure: 'Comprender el propósito de cada paso',
      formula: 'Entender qué representa cada variable',
      causal: 'Explicar por qué ocurre la causa o consecuencia',
      comparison: 'Distinguir las similitudes y diferencias clave',
      classification: 'Comprender los criterios de clasificación',
      narrative: 'Entender el orden y la lógica de los eventos',
      argumentation: 'Comprender la estructura del argumento y su evidencia',
      case: 'Entender las implicaciones del caso',
      exception: 'Comprender por qué existe la excepción',
      relation: 'Explicar cómo y por qué se relacionan los conceptos',
    },
    application: {
      definition: 'Aplicar el concepto a una situación nueva',
      enumeration: 'Usar los elementos para resolver un problema',
      procedure: 'Ejecutar el procedimiento con nuevos datos',
      formula: 'Calcular usando la fórmula con valores distintos',
      causal: 'Predecir qué ocurrirá dado un cambio en la causa',
      comparison: 'Aplicar la distinción para tomar una decisión',
      classification: 'Clasificar nuevos casos según los criterios aprendidos',
      narrative: 'Aplicar el patrón histórico a un contexto nuevo',
      argumentation: 'Usar el argumento para evaluar una afirmación',
      case: 'Resolver un caso similar con distinto contexto',
      exception: 'Identificar cuándo aplica la excepción en casos nuevos',
      relation: 'Usar la relación para resolver una situación',
    },
    transfer: {
      definition: 'Usar el concepto para explicar fenómenos en un dominio diferente',
      enumeration: 'Transferir la lógica del conjunto a un contexto distinto',
      procedure: 'Adaptar el procedimiento a restricciones nuevas',
      formula: 'Derivar o adaptar la fórmula para un problema complejo',
      causal: 'Trazar cadenas causales en contextos complejos',
      comparison: 'Generar nuevas comparaciones por analogía',
      classification: 'Crear nuevos criterios de clasificación basados en los aprendidos',
      narrative: 'Extraer principios generales del patrón histórico',
      argumentation: 'Construir o refutar un argumento basado en los principios',
      case: 'Resolver un caso con múltiples variables no vistas antes',
      exception: 'Predecir excepciones en contextos no estudiados',
      relation: 'Descubrir nuevas relaciones análogas a las estudiadas',
    },
  }

  const objective = objectiveMap[cognitiveLevel]?.[contentSignal]
  if (objective) return objective

  // Fallback genérico
  const genericMap: Record<CognitiveLevel, string> = {
    recognition: 'Reconocer el concepto correctamente',
    comprehension: 'Demostrar comprensión real del concepto',
    application: 'Aplicar el concepto en un contexto concreto',
    transfer: 'Transferir el aprendizaje a un contexto nuevo',
  }
  return genericMap[cognitiveLevel]
}

function buildReasoning(
  entry: FormatEntry,
  input: FormatSelectionInput,
  score: number,
): string {
  const parts: string[] = []

  parts.push(`Formato "${entry.format}" seleccionado para nivel ${input.cognitiveLevel}`)

  if (entry.cognitiveMatch.includes(input.cognitiveLevel)) {
    parts.push(`alineado cognitivamente`)
  }
  if (entry.contentMatch.includes(input.contentSignal)) {
    parts.push(`óptimo para contenido tipo "${input.contentSignal}"`)
  }
  if (input.recentFormats.includes(entry.format)) {
    parts.push(`(forzado por falta de alternativas sin repetición)`)
  }
  if (input.isRecovery) {
    parts.push(`en contexto de recuperación`)
  }

  return parts.join(', ') + '.'
}

function estimateDifficulty(
  cognitiveLevel: CognitiveLevel,
  consecutiveFailures: number,
  isRecovery: boolean,
): 'easy' | 'medium' | 'hard' {
  if (isRecovery && consecutiveFailures >= 2) return 'easy'
  if (cognitiveLevel === 'transfer') return 'hard'
  if (cognitiveLevel === 'application') return 'medium'
  if (cognitiveLevel === 'comprehension') return 'medium'
  return 'easy'
}

// ─── API pública ──────────────────────────────────────────────

/**
 * Selecciona el formato pedagógicamente óptimo para una pregunta.
 *
 * Determinístico: misma entrada → mismo resultado.
 * Sin side effects. Sin llamadas externas.
 */
export function selectPedagogicalFormat(
  input: FormatSelectionInput,
): FormatSelectionResult {
  // Filtrar entradas válidas para el modo de evaluación
  const candidates = FORMAT_LIBRARY.filter(entry => {
    const validation = validateQuestionTypeForMode(input.evaluationMode, entry.format)
    if (!validation.valid) return false
    if (!QUESTION_FORMAT_CAPABILITIES[entry.format as keyof typeof QUESTION_FORMAT_CAPABILITIES]?.automaticSelectionEnabled) return false
    if (input.cognitiveLevel === 'transfer' && ['true_false', 'word_bank'].includes(entry.format)) return false
    if (input.cognitiveLevel === 'recognition' && entry.format === 'scenario') return false
    return true
  })

  if (candidates.length === 0) {
    // Fallback absoluto
    return {
      format: 'multiple_choice',
      variant: 'mcq_best_answer',
      reasoning: 'Fallback: ningún formato disponible para el modo de evaluación',
      cognitiveObjective: 'Reconocer la respuesta correcta',
      estimatedSeconds: 35,
      difficulty: 'easy',
    }
  }

  // Puntuar todos los candidatos
  const scored = candidates.map(entry => ({
    entry,
    score: scoreEntry(entry, input),
  })).sort((a, b) => b.score - a.score)

  const best = scored[0].entry
  const variant = selectVariant(best, input)

  if (QUESTION_VARIANT_FORMAT[variant as QuestionVariant] !== best.format) {
    throw new Error(`SELECTOR_VARIANT_FORMAT_MISMATCH:${variant}:${best.format}`)
  }

  return {
    format: best.format,
    variant,
    reasoning: buildReasoning(best, input, scored[0].score),
    cognitiveObjective: buildCognitiveObjective(best.format, input.cognitiveLevel, input.contentSignal),
    estimatedSeconds: best.estimatedSeconds,
    difficulty: estimateDifficulty(input.cognitiveLevel, input.consecutiveFailures, input.isRecovery),
  }
}

/**
 * Selecciona el formato óptimo para una re-evaluación post-reteach.
 *
 * Garantiza que el formato es diferente al que falló originalmente.
 * Selección basada en el tipo de error detectado.
 */
export function selectRecoveryFormat(
  input: RecoveryFormatInput,
): FormatSelectionResult {
  const strategy = RECOVERY_STRATEGY[input.errorType] || RECOVERY_STRATEGY.memory

  // Filtrar por modo de evaluación
  const validFormats = strategy.preferredFormats.filter(format => {
    const validation = validateQuestionTypeForMode(input.evaluationMode, format)
    return validation.valid && format !== input.previousFormat
  })

  // Si no hay formatos válidos distintos al anterior, permitir el mismo formato
  const targetFormats = validFormats.length > 0
    ? validFormats
    : strategy.preferredFormats.filter(format => {
        const validation = validateQuestionTypeForMode(input.evaluationMode, format)
        return validation.valid
      })

  const format = targetFormats[0] || 'multiple_choice'

  // Encontrar variante correspondiente
  const variantIndex = strategy.preferredFormats.indexOf(format)
  const variant = strategy.variants[variantIndex] || strategy.variants[0] || 'mcq_best_answer'

  return {
    format,
    variant,
    reasoning: `Recovery para error tipo "${input.errorType}": ${strategy.pedagogicalApproach}`,
    cognitiveObjective: buildCognitiveObjective(format, input.cognitiveLevel, 'definition'),
    estimatedSeconds: 40,
    difficulty: input.consecutiveFailures >= 2 ? 'easy' : 'medium',
  }
}

/**
 * Detecta la señal de contenido predominante en un texto.
 *
 * Heurística determinística sin IA. Para alimentar selectPedagogicalFormat.
 */
export function detectContentSignal(text: string): ContentSignal {
  const normalized = text.toLowerCase()

  // Señales de procedimiento (tienen prioridad alta)
  if (/\b(paso\s*\d|step\s*\d|primero|segundo|tercero|luego|después|finalmente|procedimiento|proceso|algoritmo|pasos para)\b/.test(normalized)) {
    return 'procedure'
  }

  // Fórmulas matemáticas
  if (/(\$[^$]+\$|\\frac|\\sqrt|=\s*[-\d]|\b(calcular?|cálculo|fórmula|ecuación|constante|variable)\b)/.test(normalized)) {
    return 'formula'
  }

  // Causalidad
  if (/\b(causa|produce|genera|provoca|resulta en|lleva a|por lo tanto|debido a|consecuencia|efecto de)\b/.test(normalized)) {
    return 'causal'
  }

  // Comparación
  if (/\b(diferencia|similar|contrario|opuesto|mientras que|en cambio|a diferencia|comparado|versus|vs\.?|tanto.*como)\b/.test(normalized)) {
    return 'comparison'
  }

  // Clasificación
  if (/\b(tipo|clase|categoría|grupo|se clasifica|se divide|tipos de|clases de|pertenece a)\b/.test(normalized)) {
    return 'classification'
  }

  // Narración / cronología
  if (/\b(en \d{4}|durante|siglo|época|período|historia|históricamente|aconteci|evento|fue cuando)\b/.test(normalized)) {
    return 'narrative'
  }

  // Enumeración
  if (/\b(entre ellos|incluye|son:|comprende|consta de|está compuesto por|los siguientes)\b/.test(normalized)) {
    return 'enumeration'
  }

  // Relación entre conceptos
  if (/\b(relaciona|conecta|depende de|asociado con|vinculado|corresponde|implica)\b/.test(normalized)) {
    return 'relation'
  }

  // Excepción / advertencia
  if (/\b(excepción|advertencia|cuidado|error común|sin embargo|pero|aunque|a menos que)\b/.test(normalized)) {
    return 'exception'
  }

  // Argumentación
  if (/\b(argumento|sostiene|afirma|propone|evidencia|demuestra|según el autor|tesis)\b/.test(normalized)) {
    return 'argumentation'
  }

  // Definición (fallback más común)
  if (/\b(es|se define|significa|consiste en|se entiende como|concepto de)\b/.test(normalized)) {
    return 'definition'
  }

  return 'definition'
}

/**
 * Detecta el tipo de error más probable dado el contexto de la falla.
 *
 * Sin IA. Para alimentar selectRecoveryFormat.
 */
export function detectErrorType(params: {
  questionFormat: string
  contentSignal: ContentSignal
  cognitiveLevel: CognitiveLevel
  consecutiveFailures: number
}): ErrorType {
  const { questionFormat, contentSignal, cognitiveLevel, consecutiveFailures } = params

  // Un segundo fallo consecutivo (misma ronda de recovery repetida) ya debe
  // cambiar de estrategia — no solo el tercero. Con el umbral anterior (>=2),
  // rounds 1 y 2 de reteach (consecutiveFailures 0 y 1) producían el MISMO
  // errorType y por tanto la MISMA instrucción de estrategia pedagógica
  // (STRATEGY_MATRIX), arriesgando "misma explicación → paráfrasis → paráfrasis"
  // ya desde la segunda reexplicación (hallazgo P3, reproducido leyendo
  // buildReteachStrategyInstructions: consecutiveFailures no alteraba el
  // errorType hasta el tercer fallo).
  if (consecutiveFailures >= 1) {
    return cognitiveLevel === 'recognition' ? 'memory' : 'false_confidence'
  }

  // Por señal de contenido
  if (contentSignal === 'procedure') return 'procedure'
  if (contentSignal === 'formula') return 'procedure'
  if (contentSignal === 'causal') return 'causal'
  if (contentSignal === 'classification') return 'classification'
  if (contentSignal === 'relation') return 'relation'
  if (contentSignal === 'definition') return 'vocabulary'

  // Por nivel cognitivo fallado
  if (cognitiveLevel === 'application' || cognitiveLevel === 'transfer') return 'application'
  if (cognitiveLevel === 'comprehension') return 'relation'

  return 'memory'
}
