// ═══════════════════════════════════════════════════════════════
// ANSWER EVALUATOR
// 
// Evalúa respuestas del estudiante.
// - Para tipos objetivos (multiple_choice, true_false, ordering, etc): CÓDIGO PURO
// - Para tipos abiertos (open_response, practical_case, step_by_step): LLM
// ═══════════════════════════════════════════════════════════════

import { alaiRequest, safeParseJson } from '../../../alai'
import type { MicroConcept } from '../types'

// ═══════════════════════════════════════════════════════════════
// DIAGNÓSTICO DE ERROR — Por qué falló, no solo que falló
// ═══════════════════════════════════════════════════════════════
export type ErrorType =
  | 'confused_similar_concept'    // confunde con un concepto parecido
  | 'inverted_relationship'       // invirtió causa-efecto, mayor-menor, verdadero-falso
  | 'incomplete_understanding'    // sabe algo pero le falta una parte clave
  | 'random_guess'                // respuesta sin lógica (ej: índice inválido o sin relación)
  | 'calculation_error'           // entendió pero erró el cálculo o la operación
  | 'misread_question'            // respondió algo correcto pero a una pregunta diferente
  | 'knowledge_gap'               // simplemente no lo sabe todavía
  | 'misconception'               // creencia incorrecta persistente y específica

export interface ErrorDiagnosis {
  errorType: ErrorType
  hypothesis: string              // hipótesis sobre por qué falló
  distractorChosen?: string       // qué eligió exactamente
  isLikelyMisconception: boolean  // si parece una creencia errónea persistente
  suggestedIntervention: string   // qué estrategia usar ahora
}

export interface EvaluationResult {
  outcome: 'correct' | 'partial' | 'incorrect'
  semanticOutcome?: 'correct' | 'mostly_correct' | 'partial' | 'incorrect'
  score: number                       // 0-100
  whatWasCorrect: string
  whatWasMissing: string
  correctAnswer: string
  errorDetected?: string
  // Diagnóstico pedagógico del error (solo cuando outcome !== 'correct')
  errorDiagnosis?: ErrorDiagnosis
}

export interface EvaluationInput {
  interaction: any                    // La interacción original
  studentAnswer: any                  // Lo que respondió
  micro: MicroConcept                 // Para contexto
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export async function evaluateAnswer(input: EvaluationInput): Promise<EvaluationResult> {
  const { interaction, studentAnswer, micro } = input
  const type = interaction.interactionType || interaction.type

  // Formatos con evaluación determinista (código puro)
  switch (type) {
    case 'multiple_choice':
    case 'choose_best_procedure':
      return evaluateMultipleChoice(interaction, studentAnswer)
    case 'multi_select':
      return evaluateMultiSelect(interaction, studentAnswer)
    case 'true_false':
      return evaluateTrueFalse(interaction, studentAnswer)
    case 'fill_blank':
    case 'fill_blank_bank':
      return evaluateFillBlank(interaction, studentAnswer)
    case 'matching':
      return evaluateMatching(interaction, studentAnswer)
    case 'ordering':
    case 'complete_procedure':
      return evaluateOrdering(interaction, studentAnswer)
    case 'classify_groups':
      return evaluateClassifyGroups(interaction, studentAnswer)
    case 'find_the_error':
      return evaluateFindTheError(interaction, studentAnswer)
    case 'complete_reaction_or_formula':
    case 'formula_builder':
      return evaluateFillBlank(interaction, studentAnswer)
    case 'numeric_short':
    case 'calculator_check':
      return evaluateNumericShort(interaction, studentAnswer)

    // Formatos con evaluación semántica (LLM)
    case 'open_response':
    case 'practical_case':
    case 'step_by_step_solver':
    case 'quick_check':
    case 'explain_why':
    case 'teach_back':
    case 'prediction':
    case 'compare_contrast':
    case 'concept_map':
      return await evaluateWithLLM(input)

    default:
      return {
        outcome: 'partial',
        score: 60,
        whatWasCorrect: 'Respuesta recibida',
        whatWasMissing: '',
        correctAnswer: '',
      }
  }
}

function evaluateMultiSelect(interaction: any, answer: any): EvaluationResult {
  const expectedValues: string[] = (interaction.data?.correctIndices || interaction.data?.correctOptionIds || []).map(String)
  const receivedValues: string[] = (Array.isArray(answer) ? answer : []).map(String)
  const expected = new Set<string>(expectedValues)
  const received = new Set<string>(receivedValues)
  const isCorrect = expected.size > 0 && expected.size === received.size && [...expected].every(value => received.has(value))
  return {
    outcome: isCorrect ? 'correct' : 'incorrect',
    score: isCorrect ? 100 : 0,
    whatWasCorrect: isCorrect ? 'Seleccionaste exactamente todas las opciones correctas.' : '',
    whatWasMissing: isCorrect ? '' : 'Revisa qué opciones están respaldadas por el material.',
    correctAnswer: [...expected].join(', '),
  }
}

// ═══════════════════════════════════════════════════════════════
// MULTIPLE CHOICE (código puro)
// ═══════════════════════════════════════════════════════════════
function evaluateMultipleChoice(interaction: any, answer: any): EvaluationResult {
  const data = interaction.data
  const options = data.options || []

  // Compatibilidad:
  // 1) Legacy: correctIndex + answer numérico
  // 2) Nuevo: correctOptionIds / correctOptionId + options con { id, text }
  const correctOptionIds: string[] = Array.isArray(data.correctOptionIds)
    ? data.correctOptionIds
    : data.correctOptionId ? [String(data.correctOptionId)] : []

  const normalizeOptionId = (v: any) => String(v ?? '').trim()

  let isCorrect = false
  let chosenText = String(answer)

  if (correctOptionIds.length > 0) {
    const answerId = typeof answer === 'object' && answer !== null
      ? normalizeOptionId(answer.id)
      : normalizeOptionId(answer)

    isCorrect = correctOptionIds.includes(answerId)

    const chosenOption = Array.isArray(options)
      ? options.find((o: any) => normalizeOptionId(o?.id) === answerId)
      : null
    chosenText = chosenOption?.text || chosenOption?.label || String(answerId)
  } else {
    const correctIndex = data.correctIndex
    isCorrect = answer === correctIndex
    chosenText = typeof answer === 'number'
      ? (options[answer]?.text || options[answer]?.label || options[answer] || String(answer))
      : String(answer)
  }

  const explanation = data.explanation || data.reason || ''

  let whatWasCorrect = ''
  let whatWasMissing = ''

  const correctDisplay = correctOptionIds.length > 0
    ? (() => {
        const firstId = correctOptionIds[0] || ''
        const correctOption = Array.isArray(options)
          ? options.find((o: any) => normalizeOptionId(o?.id) === firstId)
          : null
        return correctOption?.text || correctOption?.label || String(firstId)
      })()
    : (() => {
        const correctIndex = data.correctIndex
        return options[correctIndex]?.text || options[correctIndex]?.label || options[correctIndex] || ''
      })()

  if (isCorrect) {
    whatWasCorrect = `Elegiste "${correctDisplay}"`
    if (explanation) whatWasCorrect += `. ${explanation}`
    else whatWasCorrect += '. Esa es la respuesta correcta.'
  } else {
    if (chosenText && chosenText !== correctDisplay) {
      whatWasMissing = `Elegiste "${chosenText}", pero la respuesta correcta es "${correctDisplay}".`
    } else {
      whatWasMissing = `La respuesta correcta era "${correctDisplay}".`
    }
    if (explanation) whatWasMissing += ` ${explanation}`
  }

  let errorDiagnosis: ErrorDiagnosis | undefined = undefined

  if (!isCorrect) {
    // Inferir tipo de error desde el distractor elegido vs la respuesta correcta
    const chosenLower = (chosenText || '').toLowerCase()
    const correctLower = correctDisplay.toLowerCase()

    let errorType: ErrorType = 'knowledge_gap'
    let hypothesis = `Eligió "${chosenText}" en vez de "${correctDisplay}".`
    let suggestedIntervention = 'Revelar la respuesta correcta y reexplicar el concepto.'
    let isLikelyMisconception = false

    if (!chosenText || chosenText === 'undefined' || chosenText === String(answer)) {
      // No eligió una opción real o eligió algo sin sentido
      errorType = 'random_guess'
      hypothesis = 'La respuesta no sigue ningún patrón lógico visible.'
      suggestedIntervention = 'Introducir el concepto desde cero con una analogía.'
    } else {
      // Analizar relación semántica entre lo elegido y lo correcto
      const chosenWords = new Set(chosenLower.split(/\s+/).filter((w: string) => w.length > 3))
      const correctWords = new Set(correctLower.split(/\s+/).filter((w: string) => w.length > 3))
      const overlap = [...chosenWords].filter((w: string) => correctWords.has(w)).length
      const totalUnique = new Set([...chosenWords, ...correctWords]).size

      if (overlap > 0 && totalUnique > 0 && overlap / totalUnique > 0.4) {
        // Alta superposición de palabras → confusión entre conceptos similares
        errorType = 'confused_similar_concept'
        hypothesis = `Confunde "${chosenText}" con "${correctDisplay}". Son conceptos similares pero distintos.`
        suggestedIntervention = 'Comparar explícitamente los dos conceptos usando una tabla o contraste directo.'
        isLikelyMisconception = true
      } else if (
        (chosenLower.includes('no') && !correctLower.includes('no')) ||
        (!chosenLower.includes('no') && correctLower.includes('no')) ||
        (chosenLower.includes('mayor') && correctLower.includes('menor')) ||
        (chosenLower.includes('menor') && correctLower.includes('mayor')) ||
        (chosenLower.includes('aumenta') && correctLower.includes('disminuye')) ||
        (chosenLower.includes('disminuye') && correctLower.includes('aumenta'))
      ) {
        errorType = 'inverted_relationship'
        hypothesis = `Invirtió la relación: eligió "${chosenText}" pero la relación correcta es la opuesta.`
        suggestedIntervention = 'Usar un ejemplo concreto que muestre la dirección correcta de la relación.'
        isLikelyMisconception = true
      } else {
        errorType = 'knowledge_gap'
        hypothesis = `No conoce o no recuerda "${correctDisplay}". Eligió "${chosenText}" sin relación clara.`
        suggestedIntervention = 'Reexplicar el concepto con un ejemplo directo del material.'
      }
    }

    errorDiagnosis = {
      errorType,
      hypothesis,
      distractorChosen: chosenText,
      isLikelyMisconception,
      suggestedIntervention,
    }
  }

  return {
    outcome: isCorrect ? 'correct' : 'incorrect',
    score: isCorrect ? 100 : 0,
    whatWasCorrect,
    whatWasMissing,
    correctAnswer: correctDisplay,
    errorDetected: !isCorrect ? data.explanation : undefined,
    errorDiagnosis,
  }
}

// ═══════════════════════════════════════════════════════════════
// TRUE / FALSE (código puro)
// ═══════════════════════════════════════════════════════════════
function evaluateTrueFalse(interaction: any, answer: any): EvaluationResult {
  const data = interaction.data
  // Normalizar: acepta true/false Y 0/1 Y "true"/"false"
  const normalize = (v: any): boolean => {
    if (typeof v === 'boolean') return v
    if (v === 0 || v === 'false') return false
    if (v === 1 || v === 'true') return true
    return Boolean(v)
  }
  const normalizedAnswer = normalize(answer)
  const normalizedCorrect = normalize(data.correctAnswer)
  const isCorrect = normalizedAnswer === normalizedCorrect

  const tfDiagnosis: ErrorDiagnosis | undefined = !isCorrect ? {
    errorType: 'inverted_relationship',
    hypothesis: `Marcó ${normalizedAnswer ? 'Verdadero' : 'Falso'} pero era ${normalizedCorrect ? 'Verdadero' : 'Falso'}. Posible inversión de la afirmación.`,
    distractorChosen: normalizedAnswer ? 'Verdadero' : 'Falso',
    isLikelyMisconception: true,
    suggestedIntervention: 'Mostrar la afirmación correcta con una cita exacta del material.',
  } : undefined

  return {
    outcome: isCorrect ? 'correct' : 'incorrect',
    score: isCorrect ? 100 : 0,
    whatWasCorrect: isCorrect
      ? `${normalizedCorrect ? 'Verdadero' : 'Falso'} es correcto${data.explanation ? '. ' + data.explanation : ''}`
      : '',
    whatWasMissing: isCorrect
      ? ''
      : `La respuesta correcta era ${normalizedCorrect ? 'Verdadero' : 'Falso'}${data.explanation ? '. ' + data.explanation : ''}`,
    correctAnswer: normalizedCorrect ? 'Verdadero' : 'Falso',
    errorDiagnosis: tfDiagnosis,
  }
}

// ═══════════════════════════════════════════════════════════════
// FILL BLANK (código puro con tolerancia)
// ═══════════════════════════════════════════════════════════════
function evaluateFillBlank(interaction: any, answer: any): EvaluationResult {
  const data = interaction.data
  
  // Si no hay correctAnswers explícito, intentar inferirlo
  let rawCorrectAnswers = data.correctAnswers || []
  
  // REGLA ESTRICTA: correctAnswers SOLO viene de campos explícitos de respuesta correcta.
  // NUNCA inferir del bank completo (bank puede tener opciones incorrectas como distractores).
  // Si hay bank de 1 sola opción → es la correcta (no hay distractores posibles).
  // Si hay bank de múltiples opciones → NO asumir cuál es la correcta sin correctAnswers explícito.
  if (rawCorrectAnswers.length === 0 && data.bank && data.bank.length === 1) {
    rawCorrectAnswers = data.bank
  }
  // Si bank tiene múltiples opciones y no hay correctAnswers → marcar como no evaluable
  if (rawCorrectAnswers.length === 0 && data.bank && data.bank.length > 1) {
    return {
      outcome: 'partial',
      score: 50,
      whatWasCorrect: 'Respuesta recibida',
      whatWasMissing: 'No se pudo verificar — datos de pregunta incompletos',
      correctAnswer: '',
    }
  }
  
  // Si correctAnswer (singular) existe, usarlo
  if (rawCorrectAnswers.length === 0 && data.correctAnswer) {
    rawCorrectAnswers = [data.correctAnswer]
  }
  
  // Si answer (singular) existe, usarlo
  if (rawCorrectAnswers.length === 0 && data.answer) {
    rawCorrectAnswers = [data.answer]
  }
  
  const correctAnswers = rawCorrectAnswers.map((a: string) => normalize(String(a)))
  const studentAnswer = normalize(String(answer || ''))

  if (!studentAnswer) {
    return {
      outcome: 'incorrect', score: 0,
      whatWasCorrect: '', whatWasMissing: 'No se recibió respuesta',
      correctAnswer: (data.correctAnswers || [''])[0] || '',
    }
  }

  // Comparación tolerante:
  // 1. Match exacto normalizado
  // 2. Respuesta contiene la correcta o viceversa
  // 3. Palabras clave presentes (para respuestas con múltiples palabras)
  // Detectar si la respuesta contiene símbolos técnicos donde un carácter cambia todo
  const hasSymbols = (s: string) => /[+\-*/=\[\]()<>^%°±≤≥]/.test(s)
  const anyHasSymbols = correctAnswers.some((c: string) => hasSymbols(c)) || hasSymbols(studentAnswer)

  const synonymGroups = [new Set(['rapido', 'veloz', 'agil']), new Set(['rapida', 'veloz', 'agil'])]
  const areEquivalentWords = (a: string, b: string) => synonymGroups.some(group => group.has(a) && group.has(b))
  let isCorrect = correctAnswers.some((c: string) => {
    // Match exacto siempre válido
    if (c === studentAnswer) return true
    if (areEquivalentWords(c, studentAnswer)) return true
    // Si hay símbolos técnicos, exigir match exacto (un +/- cambia el significado)
    if (anyHasSymbols) return false
    // Para respuestas cortas de texto plano, exigir exacto
    if (c.length <= 20 || studentAnswer.length <= 20) return false
    // Solo para respuestas largas de texto plano, permitir contención
    return c.includes(studentAnswer) || studentAnswer.includes(c)
  })

  // Si no matcheó exacto, intentar por palabras clave
  // SKIP si hay símbolos técnicos (un +/- cambia todo el significado)
  if (!isCorrect && studentAnswer.length > 3 && !anyHasSymbols) {
    const studentWords = studentAnswer.split(/[,\s]+/).filter(Boolean)
    isCorrect = correctAnswers.some((c: string) => {
      const correctWords = c.split(/[,\s]+/).filter(Boolean)
      // Si el estudiante mencionó al menos 60% de las palabras correctas
      const matchCount = correctWords.filter(cw =>
        studentWords.some(sw => sw.includes(cw) || cw.includes(sw))
      ).length
      return matchCount >= Math.ceil(correctWords.length * 0.6)
    })
  }

  // Score parcial si mencionó algunas palabras correctas
  let score = 0
  let outcome: 'correct' | 'partial' | 'incorrect' = 'incorrect'

  if (isCorrect) {
    score = 100
    outcome = 'correct'
  } else if (!anyHasSymbols) {
    // Score parcial SOLO para texto plano (no fórmulas/símbolos)
    const studentWords = studentAnswer.split(/[,\s]+/).filter(Boolean)
    const bestMatch = correctAnswers.reduce((best, c) => {
      const correctWords = c.split(/[,\s]+/).filter(Boolean)
      const matchCount = correctWords.filter(cw =>
        studentWords.some(sw => sw.includes(cw) || cw.includes(sw))
      ).length
      const ratio = correctWords.length > 0 ? matchCount / correctWords.length : 0
      return Math.max(best, ratio)
    }, 0)

    if (bestMatch >= 0.5) {
      score = Math.round(bestMatch * 100)
      outcome = 'partial'
    }
  }

  // Si el LLM olvidó correctAnswers pero hay bank con 1 sola opción, esa es la correcta
  let correctAns = (data.correctAnswers || [''])[0] || ''
  if (!correctAns && data.bank && Array.isArray(data.bank)) {
    // Si solo hay 1 opción en el bank, esa es la respuesta
    if (data.bank.length === 1) correctAns = data.bank[0]
    // Si hay múltiples y el estudiante eligió una del bank, aceptar la primera como referencia
    else correctAns = data.bank[0] || ''
  }
  return {
    outcome,
    score,
    whatWasCorrect: outcome !== 'incorrect'
      ? '"' + answer + '" es ' + (outcome === 'correct' ? 'correcto' : 'parcialmente correcto') + (data.explanation ? '. ' + data.explanation : '. Bien recordado.')
      : '',
    whatWasMissing: outcome === 'correct'
      ? ''
      : 'Respondiste "' + answer + '" pero la respuesta correcta era "' + correctAns + '".' + (data.explanation ? ' ' + data.explanation : ' Recuerda esta diferencia para el examen.'),
    correctAnswer: correctAns,
  }
}

// ═══════════════════════════════════════════════════════════════
// MATCHING (código puro)
// ═══════════════════════════════════════════════════════════════
function evaluateMatching(interaction: any, answer: any): EvaluationResult {
  const pairs = interaction.data?.pairs || []
  if (typeof answer !== 'object' || !answer) {
    return {
      outcome: 'incorrect',
      score: 0,
      whatWasCorrect: '',
      whatWasMissing: 'No se recibió respuesta',
      correctAnswer: pairs.map((p: any) => `${p.left} → ${p.right}`).join(', '),
    }
  }

  let correct = 0
  const total = pairs.length

  for (const [leftIdx, rightIdx] of Object.entries(answer)) {
    if (Number(leftIdx) === Number(rightIdx)) correct++
  }

  const score = Math.round((correct / total) * 100)
  const outcome: EvaluationResult['outcome'] =
    score >= 90 ? 'correct' :
    score >= 50 ? 'partial' :
    'incorrect'

  return {
    outcome,
    score,
    whatWasCorrect: correct === total
      ? `¡Perfecto! Acertaste las ${total} conexiones${interaction.data?.explanation ? '. ' + interaction.data.explanation : ''}`
      : `Acertaste ${correct} de ${total} conexiones`,
    whatWasMissing: correct === total
      ? ''
      : `Faltaron ${total - correct} conexiones correctas. Revisa las relaciones entre los conceptos.`,
    correctAnswer: pairs.map((p: any) => `"${p.left}" → "${p.right}"`).join(', '),
  }
}

// ═══════════════════════════════════════════════════════════════
// ORDERING (código puro)
// ═══════════════════════════════════════════════════════════════
function evaluateOrdering(interaction: any, answer: any): EvaluationResult {
  const data = interaction.data
  const items = data.items || []
  const correctOrder = data.correctOrder || items.map((_: any, i: number) => i)

  if (!Array.isArray(answer)) {
    return {
      outcome: 'incorrect',
      score: 0,
      whatWasCorrect: '',
      whatWasMissing: 'No se recibió orden',
      correctAnswer: correctOrder.map((i: number) => items[i]).join(' → '),
    }
  }

  const isCorrect = answer.length === correctOrder.length &&
                    answer.every((v, i) => v === correctOrder[i])

  // Score parcial: qué tan cerca del orden correcto
  let correctPositions = 0
  for (let i = 0; i < Math.min(answer.length, correctOrder.length); i++) {
    if (answer[i] === correctOrder[i]) correctPositions++
  }
  const score = Math.round((correctPositions / correctOrder.length) * 100)

  return {
    outcome: isCorrect ? 'correct' : score >= 50 ? 'partial' : 'incorrect',
    score,
    whatWasCorrect: isCorrect
      ? `¡Perfecto! Ordenaste correctamente las ${correctOrder.length} posiciones${interaction.data?.explanation ? '. ' + interaction.data.explanation : ''}`
      : `Acertaste ${correctPositions} de ${correctOrder.length} posiciones`,
    whatWasMissing: isCorrect
      ? ''
      : 'El orden no es completamente correcto. Revisa la secuencia lógica de los pasos.',
    correctAnswer: correctOrder.map((i: number) => items[i]).join(' → '),
  }
}

// ═══════════════════════════════════════════════════════════════
// CLASSIFY GROUPS (código puro)
// ═══════════════════════════════════════════════════════════════
function evaluateClassifyGroups(interaction: any, answer: any): EvaluationResult {
  const data = interaction.data
  const correctAssignments = data.correctAssignments || {}
  const items = Object.keys(correctAssignments)

  if (typeof answer !== 'object' || !answer) {
    return {
      outcome: 'incorrect',
      score: 0,
      whatWasCorrect: '',
      whatWasMissing: 'No se recibió clasificación',
      correctAnswer: Object.entries(correctAssignments).map(([i, g]) => `${i}: ${g}`).join(', '),
    }
  }

  let correct = 0
  for (const item of items) {
    if (answer[item] === correctAssignments[item]) correct++
  }

  const score = Math.round((correct / items.length) * 100)
  const outcome: EvaluationResult['outcome'] =
    score >= 90 ? 'correct' :
    score >= 50 ? 'partial' :
    'incorrect'

  return {
    outcome,
    score,
    whatWasCorrect: `Clasificaste ${correct} de ${items.length} correctamente`,
    whatWasMissing: correct === items.length ? '' : `${items.length - correct} clasificaciones incorrectas`,
    correctAnswer: Object.entries(correctAssignments).map(([i, g]) => `${i}: ${g}`).join(', '),
  }
}

// ═══════════════════════════════════════════════════════════════
// EVALUACIÓN CON LLM (para respuestas abiertas)
// ═══════════════════════════════════════════════════════════════
async function evaluateWithLLM(input: EvaluationInput): Promise<EvaluationResult> {
  const { interaction, studentAnswer, micro } = input

  const prompt = `Evalúa esta respuesta como tutor humano. Sé JUSTO y PEDAGÓGICO.

MICROCONCEPTO: ${micro.name}
DEFINICIÓN COMPLETA: ${micro.fullDefinition}

PREGUNTA: ${interaction.prompt}
RESPUESTA DEL ESTUDIANTE: ${typeof studentAnswer === 'string' ? studentAnswer : JSON.stringify(studentAnswer)}

CITAS EXACTAS DEL MATERIAL:
${micro.sourceQuotes.map(q => '"' + q + '"').join('\n')}

${micro.commonErrors.length > 0 ? 'ERRORES COMUNES DE ESTE CONCEPTO:\n' + micro.commonErrors.map(e => '- ' + e.description + ' → ' + e.correction).join('\n') : ''}

REGLAS DE EVALUACIÓN:
- Si respondió los conceptos correctos aunque parcial → outcome: "partial", score 60-80
- Si menciona la idea central correctamente → outcome: "correct", score 80-100
- Solo "incorrect" si score < 50

REGLAS DE FEEDBACK PEDAGÓGICO:
- whatWasCorrect: explica concretamente QUÉ dijo bien y POR QUÉ es correcto
- whatWasMissing: explica exactamente QUÉ faltó o qué estuvo mal y POR QUÉ
- correctAnswer: da la respuesta correcta COMPLETA con explicación pedagógica
  * SIEMPRE incluye una cita EXACTA del material entre comillas simples
  * Formato ideal: 'La respuesta es X. El material dice: [cita exacta del texto]'
  * Menciona el concepto clave que el estudiante debe recordar
  * Si hay un error común detectado, señálalo explícitamente
  * Máximo 3 oraciones — claro, directo, pedagógico

Devuelve SOLO JSON:
{
  "outcome": "correct|mostly_correct|partial|incorrect",
  "score": 0-100,
  "whatWasCorrect": "qué estuvo bien y por qué (1-2 oraciones)",
  "whatWasMissing": "qué faltó o qué estuvo mal y por qué (1-2 oraciones, vacío si perfecto)",
  "correctAnswer": "respuesta correcta completa con explicación pedagógica usando el material (2-3 oraciones)",
  "errorDiagnosis": {
    "errorType": "confused_similar_concept|inverted_relationship|incomplete_understanding|random_guess|calculation_error|misread_question|knowledge_gap|misconception",
    "hypothesis": "hipótesis específica sobre por qué el estudiante dio esa respuesta incorrecta",
    "isLikelyMisconception": true|false,
    "suggestedIntervention": "qué estrategia usar con este estudiante ahora mismo"
  }
}`

  try {
    const result = await alaiRequest(async (client: any, modelFn: any) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [
          { role: 'system', content: 'Evaluador pedagógico. Solo JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 500,
      })
      const raw = res?.choices?.[0]?.message?.content || ''
      if (!raw.trim()) throw new Error('Empty')
      return { text: raw, provider: 'unknown', model: 'unknown' }
    })

    const parsed = safeParseJson(result.text) || {}
    const llmDiagnosis: ErrorDiagnosis | undefined =
      parsed.errorDiagnosis && parsed.outcome !== 'correct'
        ? {
            errorType: parsed.errorDiagnosis.errorType || 'knowledge_gap',
            hypothesis: parsed.errorDiagnosis.hypothesis || '',
            isLikelyMisconception: !!parsed.errorDiagnosis.isLikelyMisconception,
            suggestedIntervention: parsed.errorDiagnosis.suggestedIntervention || '',
          }
        : undefined

    const semanticOutcome = ['correct', 'mostly_correct', 'partial', 'incorrect'].includes(parsed.outcome)
      ? parsed.outcome : 'partial'
    return {
      outcome: semanticOutcome === 'mostly_correct' ? 'partial' : semanticOutcome,
      semanticOutcome,
      score: Math.min(100, Math.max(0, Number(parsed.score) || 60)),
      whatWasCorrect: parsed.whatWasCorrect || '',
      whatWasMissing: parsed.whatWasMissing || '',
      correctAnswer: parsed.correctAnswer || '',
      errorDiagnosis: llmDiagnosis,
    }
  } catch {
    return {
      outcome: 'partial',
      score: 60,
      whatWasCorrect: 'Respuesta recibida',
      whatWasMissing: '',
      correctAnswer: '',
    }
  }
}

export function evaluateNumericShort(interaction: any, answer: any): EvaluationResult {
  const data = interaction.data || {}
  const parse = (value: unknown) => {
    const match = String(value ?? '').trim().replace(',', '.').match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([^\d\s].*)?$/i)
    return match ? { value: Number(match[1]), unit: String(match[2] || '').trim().toLowerCase() } : null
  }
  const expected = parse(data.correctAnswer)
  const received = parse(answer)
  const correctDisplay = String(data.correctAnswer ?? '')
  if (!expected || !received || !Number.isFinite(expected.value) || !Number.isFinite(received.value)) {
    return { outcome: 'incorrect', semanticOutcome: 'incorrect', score: 0, whatWasCorrect: '', whatWasMissing: 'Se esperaba un valor numérico.', correctAnswer: correctDisplay }
  }
  if (String(data.answerField || '').trim().toLowerCase() === 'n' && (!Number.isInteger(received.value) || received.value <= 0)) {
    return { outcome: 'incorrect', semanticOutcome: 'incorrect', score: 0, whatWasCorrect: '', whatWasMissing: 'La variable n debe ser un entero positivo según el contrato de esta pregunta.', correctAnswer: correctDisplay }
  }
  const tolerance = Math.max(0, Number(data.tolerance ?? 1e-6))
  const equivalentValue = Math.abs(received.value - expected.value) <= tolerance * Math.max(1, Math.abs(expected.value))
  const compatibleUnit = !received.unit || !expected.unit || received.unit === expected.unit
  if (!equivalentValue || !compatibleUnit) {
    return { outcome: 'incorrect', semanticOutcome: 'incorrect', score: 0, whatWasCorrect: '', whatWasMissing: `El valor o la unidad no equivale a ${correctDisplay}.`, correctAnswer: correctDisplay }
  }
  const omittedUnit = !!expected.unit && !received.unit
  return {
    outcome: omittedUnit ? 'partial' : 'correct',
    semanticOutcome: omittedUnit ? 'mostly_correct' : 'correct',
    score: omittedUnit ? 85 : 100,
    whatWasCorrect: `El valor ${received.value} es correcto.`,
    whatWasMissing: omittedUnit ? `Faltó indicar la unidad ${expected.unit}.` : '',
    correctAnswer: correctDisplay,
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function normalize(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s+\-*/=\[\]()<>^%°±≤≥]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ═══════════════════════════════════════════════════════════════
// FIND THE ERROR (código puro)
// ═══════════════════════════════════════════════════════════════
function evaluateFindTheError(interaction: any, answer: any): EvaluationResult {
  const data = interaction.data || {}
  const steps: string[] = data.workedSolution || data.steps || []
  const errorIndex: number = typeof data.errorStepIndex === 'number' ? data.errorStepIndex : -1
  const explanation: string = data.explanation || ''

  if (typeof answer !== 'number' || errorIndex < 0) {
    return {
      outcome: 'incorrect', score: 0,
      whatWasCorrect: '',
      whatWasMissing: 'No se recibió una selección válida',
      correctAnswer: errorIndex >= 0 ? `Paso ${errorIndex + 1}: ${steps[errorIndex] || ''}` : '',
    }
  }

  const isCorrect = answer === errorIndex
  return {
    outcome: isCorrect ? 'correct' : 'incorrect',
    score: isCorrect ? 100 : 0,
    whatWasCorrect: isCorrect
      ? `¡Correcto! Identificaste el error en el paso ${errorIndex + 1}${explanation ? '. ' + explanation : ''}`
      : '',
    whatWasMissing: isCorrect
      ? ''
      : `El error estaba en el paso ${errorIndex + 1}: "${steps[errorIndex] || ''}"${explanation ? '. ' + explanation : ''}. Elegiste el paso ${answer + 1}, que era correcto.`,
    correctAnswer: `Paso ${errorIndex + 1}: ${steps[errorIndex] || ''}`,
  }
}
