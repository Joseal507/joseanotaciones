// ═══════════════════════════════════════════════════════════════
// ANSWER EVALUATOR
// 
// Evalúa respuestas del estudiante.
// - Para tipos objetivos (multiple_choice, true_false, ordering, etc): CÓDIGO PURO
// - Para tipos abiertos (open_response, practical_case, step_by_step): LLM
// ═══════════════════════════════════════════════════════════════

import { alaiRequest, safeParseJson } from '../../../alai'
import type { MicroConcept } from '../types'

export interface EvaluationResult {
  outcome: 'correct' | 'partial' | 'incorrect'
  score: number                       // 0-100
  whatWasCorrect: string
  whatWasMissing: string
  correctAnswer: string
  errorDetected?: string
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
      return evaluateMultipleChoice(interaction, studentAnswer)
    case 'true_false':
      return evaluateTrueFalse(interaction, studentAnswer)
    case 'fill_blank':
    case 'fill_blank_bank':
      return evaluateFillBlank(interaction, studentAnswer)
    case 'matching':
      return evaluateMatching(interaction, studentAnswer)
    case 'ordering':
      return evaluateOrdering(interaction, studentAnswer)
    case 'classify_groups':
      return evaluateClassifyGroups(interaction, studentAnswer)
    case 'find_the_error':
      return evaluateFindTheError(interaction, studentAnswer)
    case 'complete_reaction_or_formula':
      return evaluateFillBlank(interaction, studentAnswer)

    // Formatos con evaluación semántica (LLM)
    case 'open_response':
    case 'practical_case':
    case 'step_by_step_solver':
    case 'quick_check':
    case 'explain_why':
    case 'teach_back':
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

// ═══════════════════════════════════════════════════════════════
// MULTIPLE CHOICE (código puro)
// ═══════════════════════════════════════════════════════════════
function evaluateMultipleChoice(interaction: any, answer: any): EvaluationResult {
  const data = interaction.data
  const correctIndex = data.correctIndex
  const options = data.options || []
  const isCorrect = answer === correctIndex

  const explanation = data.explanation || data.reason || ''
  const chosenText = typeof answer === 'number' && options[answer] ? options[answer] : String(answer)

  let whatWasCorrect = ''
  let whatWasMissing = ''

  if (isCorrect) {
    whatWasCorrect = `Elegiste "${options[correctIndex]}"`
    if (explanation) whatWasCorrect += `. ${explanation}`
  } else {
    whatWasMissing = `La respuesta correcta era "${options[correctIndex]}"`
    if (explanation) whatWasMissing += `. ${explanation}`
    if (chosenText && chosenText !== options[correctIndex]) {
      whatWasMissing += ` Elegiste "${chosenText}", que no es correcto.`
    }
  }

  return {
    outcome: isCorrect ? 'correct' : 'incorrect',
    score: isCorrect ? 100 : 0,
    whatWasCorrect,
    whatWasMissing,
    correctAnswer: options[correctIndex] || '',
    errorDetected: !isCorrect ? data.explanation : undefined,
  }
}

// ═══════════════════════════════════════════════════════════════
// TRUE / FALSE (código puro)
// ═══════════════════════════════════════════════════════════════
function evaluateTrueFalse(interaction: any, answer: any): EvaluationResult {
  const data = interaction.data
  const isCorrect = answer === data.correctAnswer

  return {
    outcome: isCorrect ? 'correct' : 'incorrect',
    score: isCorrect ? 100 : 0,
    whatWasCorrect: isCorrect
      ? `${data.correctAnswer ? 'Verdadero' : 'Falso'} es correcto${data.explanation ? '. ' + data.explanation : ''}`
      : '',
    whatWasMissing: isCorrect
      ? ''
      : `La respuesta correcta era ${data.correctAnswer ? 'Verdadero' : 'Falso'}${data.explanation ? '. ' + data.explanation : ''}`,
    correctAnswer: data.correctAnswer ? 'Verdadero' : 'Falso',
  }
}

// ═══════════════════════════════════════════════════════════════
// FILL BLANK (código puro con tolerancia)
// ═══════════════════════════════════════════════════════════════
function evaluateFillBlank(interaction: any, answer: any): EvaluationResult {
  const data = interaction.data
  
  // Si no hay correctAnswers explícito, intentar inferirlo
  let rawCorrectAnswers = data.correctAnswers || []
  
  // FIX: Si correctAnswers está vacío pero hay bank, usar la primera opción del bank
  // (el LLM a veces no genera correctAnswers pero sí pone la correcta en el bank)
  if (rawCorrectAnswers.length === 0 && data.bank && data.bank.length > 0) {
    // Intentar encontrar la correcta comparando con el template
    // Si no podemos, aceptar la respuesta del estudiante si está en el bank
    rawCorrectAnswers = data.bank
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

  let isCorrect = correctAnswers.some((c: string) => {
    // Match exacto siempre válido
    if (c === studentAnswer) return true
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

  return {
    outcome,
    score,
    whatWasCorrect: outcome !== 'incorrect'
      ? '"' + answer + '" es ' + (outcome === 'correct' ? 'correcto' : 'parcialmente correcto') + (data.explanation ? '. ' + data.explanation : '')
      : '',
    whatWasMissing: outcome === 'correct'
      ? ''
      : 'La respuesta correcta era "' + (data.correctAnswers || [''])[0] + '"' + (data.explanation ? '. ' + data.explanation : ''),
    correctAnswer: (data.correctAnswers || [''])[0] || '',
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

  const prompt = `Evalúa esta respuesta como tutor humano. Sé JUSTO.

MICROCONCEPTO: ${micro.name}
DEFINICIÓN: ${micro.fullDefinition}

PREGUNTA: ${interaction.prompt}
RESPUESTA DEL ESTUDIANTE: ${typeof studentAnswer === 'string' ? studentAnswer : JSON.stringify(studentAnswer)}

CONTEXTO DEL MATERIAL:
${micro.sourceQuotes.map(q => '"' + q + '"').join('\n')}

REGLAS:
- Si respondió los conceptos correctos aunque parcial → outcome: "partial", score 60-80
- Si menciona la idea central correctamente → outcome: "correct", score 80-100
- Solo "incorrect" si score < 50

Devuelve SOLO JSON:
{
  "outcome": "correct|partial|incorrect",
  "score": 0-100,
  "whatWasCorrect": "qué estuvo bien",
  "whatWasMissing": "qué faltó (vacío si perfecto)",
  "correctAnswer": "la respuesta correcta según el material (1-2 oraciones)"
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
    return {
      outcome: parsed.outcome || 'partial',
      score: Math.min(100, Math.max(0, Number(parsed.score) || 60)),
      whatWasCorrect: parsed.whatWasCorrect || '',
      whatWasMissing: parsed.whatWasMissing || '',
      correctAnswer: parsed.correctAnswer || '',
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
