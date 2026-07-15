// ═══════════════════════════════════════════════════════════════
// FORMAT SELECTOR
// 
// Selecciona el formato de interacción más adecuado según:
// - Tipo cognitivo del micro
// - Recursos disponibles (formulas, procedures, errors)
// - Objetivo pedagógico actual
// - Historial reciente (evitar repetir)
// 
// No es variedad forzada. Es adecuación al contenido.
// ═══════════════════════════════════════════════════════════════

import type { MicroConcept, MicroState, TeachingObjective } from '../types'

export type InteractionFormat =
  | 'multiple_choice'
  | 'true_false'
  | 'fill_blank'
  | 'fill_blank_bank'
  | 'open_response'
  | 'matching'
  | 'ordering'
  | 'classify_groups'
  | 'step_by_step_solver'
  | 'find_the_error'
  | 'complete_procedure'
  | 'complete_reaction_or_formula'
  | 'calculator_check'
  | 'practical_case'
  | 'prediction'
  | 'choose_best_procedure'
  | 'teach_back'
  | 'quick_check'
  | 'explain_why'
  | 'formula_builder'
  | 'concept_map'
  | 'none'

export interface FormatDecision {
  format: InteractionFormat
  reason: string                      // Por qué se eligió (para debug)
  alternativeFormats: InteractionFormat[]  // Otros formatos válidos
  requiresSpecificData: boolean       // Si necesita datos específicos del micro
}

// ═══════════════════════════════════════════════════════════════
// FORMATOS ADECUADOS POR TIPO COGNITIVO
// (ordenados por preferencia — el primero es el mejor)
// ═══════════════════════════════════════════════════════════════
const FORMATS_BY_COGNITIVE_TYPE: Record<string, InteractionFormat[]> = {
  // Definiciones: reconocer o completar
  definitional: ['multiple_choice', 'fill_blank', 'true_false', 'matching'],

  // Memorización pura: recall directo
  memorization: ['fill_blank', 'multiple_choice', 'fill_blank_bank', 'matching'],

  // Conceptos abstractos: explicar o aplicar
  conceptual: ['multiple_choice', 'explain_why', 'open_response', 'true_false'],

  // Narrativas: identificar actores/eventos
  narrative: ['multiple_choice', 'true_false', 'matching', 'ordering'],

  // Causa-efecto: predecir o explicar
  causal: ['explain_why', 'prediction', 'multiple_choice', 'practical_case'],

  // Comparaciones: matching o clasificar
  comparative: ['matching', 'classify_groups', 'multiple_choice', 'true_false'],

  // Cronología: ordenar
  chronological: ['ordering', 'matching', 'multiple_choice', 'fill_blank'],

  // Clasificación: agrupar
  classificatory: ['classify_groups', 'matching', 'multiple_choice'],

  // Procedimientos: ordenar pasos o resolver
  procedural: ['ordering', 'complete_procedure', 'step_by_step_solver', 'find_the_error'],

  // Matemática: resolver o completar
  mathematical: ['step_by_step_solver', 'calculator_check', 'fill_blank', 'complete_reaction_or_formula', 'find_the_error'],

  // Análisis: casos o explicar
  analytical: ['practical_case', 'explain_why', 'open_response', 'multiple_choice'],

  // Aplicación: casos prácticos
  applicative: ['practical_case', 'step_by_step_solver', 'prediction', 'choose_best_procedure'],
}

// ═══════════════════════════════════════════════════════════════
// FORMATOS ADECUADOS POR OBJETIVO
// ═══════════════════════════════════════════════════════════════
const FORMATS_BY_OBJECTIVE: Partial<Record<TeachingObjective, InteractionFormat[]>> = {
  introduce: ['none'],                                          // Solo enseñar
  explain_deeper: ['none'],                                     // Solo enseñar más
  illustrate_with_example: ['none'],                            // Solo mostrar ejemplo

  verify_understanding: [                                        // Formatos de verificación (rápidos)
    'multiple_choice', 'true_false', 'fill_blank', 'matching',
    'ordering', 'classify_groups', 'quick_check',
  ],

  test_application: [                                            // Formatos de aplicación
    'practical_case', 'step_by_step_solver', 'explain_why',
    'prediction', 'choose_best_procedure',
  ],

  test_transfer: [                                               // Formatos de transferencia
    'practical_case', 'prediction', 'open_response', 'teach_back',
  ],

  consolidate: ['none'],                                         // Solo resumen

  reveal_answer: ['none'],                                       // Solo mostrar respuesta

  reconstruct_from_error: ['none'],                              // Solo reexplicar

  connect_to_previous: ['none', 'concept_map', 'matching'],      // Conexiones

  recall_check: ['quick_check', 'fill_blank', 'multiple_choice'], // Verificación rápida
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL — SELECCIONAR FORMATO
// ═══════════════════════════════════════════════════════════════
export function selectFormat(
  micro: MicroConcept,
  microState: MicroState,
  objective: TeachingObjective,
): FormatDecision {
  // ─── Paso 1: Si el objetivo NO requiere interacción, devolver 'none' ───
  const objectiveFormats = FORMATS_BY_OBJECTIVE[objective] || ['multiple_choice']
  if (objectiveFormats[0] === 'none' && objectiveFormats.length === 1) {
    return {
      format: 'none',
      reason: `Objetivo "${objective}" no requiere interacción`,
      alternativeFormats: [],
      requiresSpecificData: false,
    }
  }

  // ─── Paso 2: Formatos ideales por tipo cognitivo ───
  const cognitiveFormats = FORMATS_BY_COGNITIVE_TYPE[micro.cognitiveType] || ['multiple_choice']

  // ─── Paso 3: Intersección — formatos válidos para AMBOS ───
  const validFormats = cognitiveFormats.filter(f => objectiveFormats.includes(f))

  // Si no hay intersección, usar los del objetivo
  const candidateFormats = validFormats.length > 0 ? validFormats : objectiveFormats.filter(f => f !== 'none')

  // ─── Paso 4: Filtrar por recursos disponibles ───
  const filteredByResources = candidateFormats.filter(f => hasRequiredResources(f, micro))

  const finalCandidates = filteredByResources.length > 0 ? filteredByResources : candidateFormats

  // ─── Paso 5: Evitar repetir el último formato usado ───
  const recentFormats = extractRecentFormats(microState)
  const notRecentlyUsed = finalCandidates.filter(f => !recentFormats.includes(f))

  const bestCandidates = notRecentlyUsed.length > 0 ? notRecentlyUsed : finalCandidates

  // ─── Paso 6: Elegir el mejor (primero de la lista = mejor match) ───
  const selectedFormat = bestCandidates[0] || 'multiple_choice'

  return {
    format: selectedFormat,
    reason: buildReason(selectedFormat, micro, objective, recentFormats),
    alternativeFormats: bestCandidates.slice(1),
    requiresSpecificData: needsSpecificData(selectedFormat),
  }
}

// ═══════════════════════════════════════════════════════════════
// VERIFICAR SI EL MICRO TIENE LOS RECURSOS NECESARIOS
// ═══════════════════════════════════════════════════════════════
function hasRequiredResources(format: InteractionFormat, micro: MicroConcept): boolean {
  switch (format) {
    case 'step_by_step_solver':
    case 'complete_procedure':
      return micro.procedures.length > 0 || micro.formulas.length > 0

    case 'find_the_error':
      return micro.commonErrors.length > 0 || micro.procedures.length > 0

    case 'complete_reaction_or_formula':
    case 'calculator_check':
    case 'formula_builder':
      return micro.formulas.length > 0

    case 'practical_case':
      return micro.examples.length > 0 || micro.cognitiveType === 'applicative' || micro.cognitiveType === 'analytical'

    case 'matching':
    case 'classify_groups':
      // Requiere al menos 3 elementos para relacionar
      return micro.sourceQuotes && micro.sourceQuotes.length >= 3 ||
             micro.examples.length >= 2 ||
             micro.cognitiveType === 'comparative' ||
             micro.cognitiveType === 'classificatory'

    case 'ordering':
      return micro.procedures.length > 0 ||
             micro.cognitiveType === 'chronological' ||
             micro.cognitiveType === 'procedural'

    // Los demás formatos no requieren datos específicos
    default:
      return true
  }
}

// ═══════════════════════════════════════════════════════════════
// EXTRAER FORMATOS USADOS RECIENTEMENTE (para el mismo micro)
// ═══════════════════════════════════════════════════════════════
function extractRecentFormats(microState: MicroState): InteractionFormat[] {
  const recent: InteractionFormat[] = []

  // Buscar en los últimos 3 eventos del timeline
  const recentEvents = microState.timeline.slice(-3)
  for (const event of recentEvents) {
    const format = (event.metadata as any)?.formatUsed
    if (format) recent.push(format)
  }

  return recent
}

// ═══════════════════════════════════════════════════════════════
// SI EL FORMATO REQUIERE DATOS ESPECÍFICOS DEL MICRO
// ═══════════════════════════════════════════════════════════════
function needsSpecificData(format: InteractionFormat): boolean {
  const specific: InteractionFormat[] = [
    'step_by_step_solver',
    'complete_procedure',
    'find_the_error',
    'complete_reaction_or_formula',
    'calculator_check',
    'formula_builder',
    'practical_case',
    'matching',
    'classify_groups',
    'ordering',
  ]
  return specific.includes(format)
}

// ═══════════════════════════════════════════════════════════════
// GENERAR RAZÓN LEGIBLE
// ═══════════════════════════════════════════════════════════════
function buildReason(
  format: InteractionFormat,
  micro: MicroConcept,
  objective: TeachingObjective,
  recentFormats: InteractionFormat[],
): string {
  const reasons: string[] = []

  reasons.push(`Tipo cognitivo "${micro.cognitiveType}" prefiere ${format}`)

  if (recentFormats.length > 0) {
    const excluded = recentFormats.join(', ')
    reasons.push(`(evitando repetir: ${excluded})`)
  }

  return reasons.join(' ')
}

// ═══════════════════════════════════════════════════════════════
// HELPER: obtener instrucción de formato para el prompt del LLM
// ═══════════════════════════════════════════════════════════════
export function formatToInstruction(format: InteractionFormat, micro: MicroConcept): string {
  switch (format) {
    case 'multiple_choice':
      return `Genera UNA pregunta multiple_choice con 4 opciones. La correcta y 3 distractoras plausibles. Formato:
{
  "interactionType": "multiple_choice",
  "prompt": "pregunta clara",
  "data": {
    "type": "multiple_choice",
    "options": ["opción A", "opción B", "opción C", "opción D"],
    "correctIndex": 0,
    "explanation": "por qué es correcta"
  }
}`

    case 'true_false':
      return `Genera UNA afirmación verdadero/falso. Formato:
{
  "interactionType": "true_false",
  "prompt": "Evalúa si esto es verdadero o falso",
  "data": {
    "type": "true_false",
    "statement": "afirmación clara",
    "correctAnswer": true,
    "explanation": "por qué"
  }
}`

    case 'fill_blank':
      return `Genera una pregunta de completar espacio. Formato:
{
  "interactionType": "fill_blank",
  "prompt": "Completa la frase",
  "data": {
    "type": "fill_blank",
    "template": "Los Falcons fueron fundados en ___",
    "correctAnswers": ["1965"]
  }
}`

    case 'fill_blank_bank':
      return `Completar con banco de opciones. Formato:
{
  "interactionType": "fill_blank_bank",
  "prompt": "Completa la frase",
  "data": {
    "type": "fill_blank_bank",
    "template": "Los Falcons fueron fundados en ___",
    "bank": ["1965", "1970", "1980", "1990"],
    "correctAnswers": ["1965"]
  }
}`

    case 'matching':
      return `Genera un ejercicio de RELACIONAR pares. Necesitas 3-4 pares. Formato:
{
  "interactionType": "matching",
  "prompt": "Relaciona cada elemento con su descripción",
  "data": {
    "type": "matching",
    "pairs": [
      {"left": "Michael Vick", "right": "Revolucionó el quarterback"},
      {"left": "Matt Ryan", "right": "Llevó al equipo al Super Bowl LI"},
      {"left": "Julio Jones", "right": "Receptor dominante"}
    ]
  }
}`

    case 'ordering':
      return `Genera un ejercicio de ORDENAR. Los ítems se muestran desordenados y el estudiante los ordena. Necesitas 3-5 elementos. Formato:
{
  "interactionType": "ordering",
  "prompt": "Ordena estos eventos cronológicamente",
  "data": {
    "type": "ordering",
    "items": ["Michael Vick draft (2001)", "Fundación Falcons (1965)", "Matt Ryan Super Bowl LI (2017)"],
    "correctOrder": [1, 0, 2]
  }
}`

    case 'classify_groups':
      return `Ejercicio de clasificar items en grupos. Formato:
{
  "interactionType": "classify_groups",
  "prompt": "Clasifica cada elemento",
  "data": {
    "type": "classify_groups",
    "items": ["item1", "item2", "item3"],
    "groups": ["Grupo A", "Grupo B"],
    "correctAssignments": {"item1": "Grupo A", "item2": "Grupo B", "item3": "Grupo A"}
  }
}`

    case 'open_response':
    case 'explain_why':
      return `Pregunta abierta que requiere explicación. Formato:
{
  "interactionType": "${format}",
  "prompt": "Explica por qué...",
  "data": {
    "type": "${format}",
    "acceptedAnswers": ["palabra clave 1", "palabra clave 2"]
  }
}`

    case 'step_by_step_solver':
      const proc = micro.procedures[0]
      const procText = proc ? `\nUsa este procedimiento del material: ${proc.name} → ${proc.steps.map(s => s.description).join(' | ')}` : ''
      return `Problema paso a paso. El estudiante resuelve escribiendo cada paso.${procText}
Formato:
{
  "interactionType": "step_by_step_solver",
  "prompt": "Resuelve paso a paso",
  "data": {
    "type": "step_by_step_solver",
    "problem": "el problema completo",
    "expectedSteps": ["paso 1", "paso 2", "paso 3"],
    "finalAnswer": "respuesta final"
  }
}`

    case 'find_the_error':
      const err = micro.commonErrors[0]
      const errText = err ? `\nError común del material: ${err.description} → ${err.correction}` : ''
      return `Muestra una solución con un error. El estudiante debe encontrar dónde está el error.${errText}
Formato:
{
  "interactionType": "find_the_error",
  "prompt": "¿Dónde está el error en este razonamiento?",
  "data": {
    "type": "find_the_error",
    "workedSolution": ["paso 1 correcto", "paso 2 con error", "paso 3", "paso 4"],
    "errorStepIndex": 1,
    "explanation": "El error está en el paso 2 porque..."
  }
}`

    case 'practical_case':
      return `Caso práctico que requiere aplicar el conocimiento. Formato:
{
  "interactionType": "practical_case",
  "prompt": "Analiza este caso",
  "data": {
    "type": "practical_case",
    "scenario": "descripción del caso concreto",
    "question": "¿qué debería hacer/pasar/pensar?",
    "expectedElements": ["elemento clave 1", "elemento clave 2"]
  }
}`

    case 'prediction':
      return `Pregunta de predicción: ¿qué pasaría si...? Formato:
{
  "interactionType": "prediction",
  "prompt": "Predice el resultado",
  "data": {
    "type": "prediction",
    "setup": "situación inicial",
    "question": "¿qué pasaría si...?",
    "expectedAnswer": "resultado esperado"
  }
}`

    case 'choose_best_procedure':
      return `Elegir el mejor procedimiento entre varias opciones. Formato:
{
  "interactionType": "choose_best_procedure",
  "prompt": "¿Cuál es el mejor enfoque?",
  "data": {
    "type": "choose_best_procedure",
    "scenario": "descripción del problema",
    "options": ["enfoque 1", "enfoque 2", "enfoque 3"],
    "correctIndex": 0,
    "reasoning": "por qué es el mejor"
  }
}`

    case 'teach_back':
      return `Pedir al estudiante que enseñe el concepto con sus palabras. Formato:
{
  "interactionType": "teach_back",
  "prompt": "Explícame este concepto como si me lo enseñaras",
  "data": {
    "type": "teach_back",
    "concept": "${micro.name}",
    "rubric": ["debe mencionar X", "debe explicar Y"]
  }
}`

    case 'quick_check':
      return `Verificación rápida con respuesta corta. Formato:
{
  "interactionType": "quick_check",
  "prompt": "En una palabra o frase:",
  "data": {
    "type": "quick_check",
    "question": "pregunta rápida",
    "acceptedAnswers": ["respuesta1", "respuesta2"]
  }
}`

    default:
      return `Genera una pregunta multiple_choice con 4 opciones.`
  }
}
