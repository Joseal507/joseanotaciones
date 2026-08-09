/**
 * questionGenerator.ts
 *
 * Genera preguntas individuales usando el contrato canónico completo.
 * Usa pedagogicalFormatSelector para elegir el formato correcto
 * en lugar de hardcodear mcq_best_answer.
 */

import type { EvaluableObjective, CoverageMap } from './coverageExtractor'
import type { EvaluationMode, PlannedQuestionSpec } from './assessmentPlanner'
import type { CanonicalQuestion, GenerationContext } from './questionContract'
import { normalizeGeneratedQuestion } from './questionContract'
import { validateQuestionTypeForMode } from './evaluationModeContract'
import {
  detectContentSignal,
  selectPedagogicalFormat,
  type FormatSelectionInput,
} from './pedagogicalFormatSelector'
import { alaiJson } from '../../alai'

export interface QuestionGenerationContext {
  sessionTitle: string
  steps: Array<{
    id: string
    type: string
    title: string
    content: string
    keyPoint: string | null
  }>
  mode: EvaluationMode
  materialTitle: string
  recentFormats?: string[]
  questionIndex?: number
  totalQuestionsInBlock?: number
  consecutiveFailures?: number
  academicDomain?: string
}

const FORMAT_PROMPT_TEMPLATES: Record<string, string> = {
  multiple_choice: `{
  "variant": "VARIANT",
  "conceptLabel": "idea específica evaluada",
  "questionText": "pregunta clara que requiere comprensión real",
  "options": [{"id":"a","text":"..."},{"id":"b","text":"..."},{"id":"c","text":"..."},{"id":"d","text":"..."}],
  "correctAnswer": "a",
  "explanation": "por qué es correcta, referenciando el contenido enseñado",
  "hint": "pista útil sin dar la respuesta",
  "difficulty": "DIFFICULTY",
  "targetDimension": "DIMENSION",
  "estimatedSeconds": 35,
  "evidencesNeeded": 1
}`,
  true_false: `{
  "variant": "VARIANT",
  "conceptLabel": "...",
  "questionText": "afirmación precisa e inequívoca",
  "options": null,
  "correctAnswer": true,
  "explanation": "por qué es verdadera/falsa según el contenido",
  "hint": "...",
  "difficulty": "easy",
  "targetDimension": "recognition",
  "estimatedSeconds": 15,
  "evidencesNeeded": 1
}`,
  multi_select: `{
  "variant": "mcq_all_that_apply",
  "conceptLabel": "...",
  "questionText": "¿Cuáles de las siguientes afirmaciones son correctas? (selecciona todas las que apliquen)",
  "options": [{"id":"a","text":"..."},{"id":"b","text":"..."},{"id":"c","text":"..."},{"id":"d","text":"..."}],
  "correctAnswer": ["a","c"],
  "explanation": "...",
  "hint": "...",
  "difficulty": "DIFFICULTY",
  "targetDimension": "DIMENSION",
  "estimatedSeconds": 40,
  "evidencesNeeded": 1
}`,
  word_bank: `{
  "variant": "VARIANT",
  "conceptLabel": "...",
  "questionText": "Completa: ___ es la propiedad que ___ cuando ___",
  "options": [{"id":"w1","text":"término1"},{"id":"w2","text":"término2"},{"id":"w3","text":"distractor1"},{"id":"w4","text":"distractor2"}],
  "correctAnswer": ["w1","w2"],
  "explanation": "...",
  "hint": "...",
  "difficulty": "DIFFICULTY",
  "targetDimension": "recognition",
  "estimatedSeconds": 30,
  "evidencesNeeded": 1
}`,
  ordering: `{
  "variant": "VARIANT",
  "conceptLabel": "...",
  "questionText": "Ordena correctamente los siguientes elementos:",
  "options": [{"id":"s1","text":"elemento 1"},{"id":"s2","text":"elemento 2"},{"id":"s3","text":"elemento 3"}],
  "correctAnswer": ["s2","s1","s3"],
  "explanation": "...",
  "hint": "...",
  "difficulty": "DIFFICULTY",
  "targetDimension": "comprehension",
  "estimatedSeconds": 40,
  "evidencesNeeded": 1
}`,
  matching: `{
  "variant": "VARIANT",
  "matchingSemantics": "bijective",
  "conceptLabel": "...",
  "questionText": "Empareja cada elemento con su correspondiente:",
  "options": [
    {"id":"p1","left":"concepto1","rightId":"r1","right":"definición1"},
    {"id":"p2","left":"concepto2","rightId":"r2","right":"definición2"},
    {"id":"p3","left":"concepto3","rightId":"r3","right":"definición3"}
  ],
  "correctAnswer": {"p1":"r1","p2":"r2","p3":"r3"},
  "explanation": "...",
  "hint": "...",
  "difficulty": "DIFFICULTY",
  "targetDimension": "recognition",
  "estimatedSeconds": 45,
  "evidencesNeeded": 1
}`,
  classify: `{
  "variant": "VARIANT",
  "conceptLabel": "...",
  "questionText": "Clasifica cada elemento en la categoría correcta:",
  "options": {
    "categories": ["Categoría A","Categoría B"],
    "items": [
      {"id":"i1","text":"elemento 1","category":"Categoría A"},
      {"id":"i2","text":"elemento 2","category":"Categoría B"},
      {"id":"i3","text":"elemento 3","category":"Categoría A"}
    ]
  },
  "correctAnswer": {"i1":"Categoría A","i2":"Categoría B","i3":"Categoría A"},
  "explanation": "...",
  "hint": "...",
  "difficulty": "DIFFICULTY",
  "targetDimension": "comprehension",
  "estimatedSeconds": 40,
  "evidencesNeeded": 1
}`,
  scenario: `{
  "variant": "VARIANT",
  "conceptLabel": "...",
  "questionText": "Situación: [caso concreto]. ¿Qué ocurriría/elegiría?",
  "options": [{"id":"a","text":"..."},{"id":"b","text":"..."},{"id":"c","text":"..."},{"id":"d","text":"..."}],
  "correctAnswer": "a",
  "explanation": "...",
  "hint": "...",
  "difficulty": "DIFFICULTY",
  "targetDimension": "application",
  "estimatedSeconds": 55,
  "evidencesNeeded": 1
}`,
  find_the_error: `{
  "variant": "VARIANT",
  "conceptLabel": "...",
  "questionText": "El siguiente razonamiento contiene un error. ¿Cuál es?",
  "options": [{"id":"a","text":"El error es..."},{"id":"b","text":"El error es..."},{"id":"c","text":"No hay error"},{"id":"d","text":"El error es..."}],
  "correctAnswer": "a",
  "explanation": "El error está en... porque según el material...",
  "hint": "...",
  "difficulty": "DIFFICULTY",
  "targetDimension": "comprehension",
  "estimatedSeconds": 50,
  "evidencesNeeded": 1
}`,
  short_response: `{
  "variant": "VARIANT",
  "conceptLabel": "...",
  "questionText": "pregunta abierta específica",
  "options": null,
  "correctAnswer": "respuesta esperada en 1-2 frases",
  "explanation": "...",
  "hint": "...",
  "difficulty": "DIFFICULTY",
  "targetDimension": "DIMENSION",
  "estimatedSeconds": 75,
  "evidencesNeeded": 1
}`,
  numeric_problem: `{
  "variant": "problem_solve",
  "conceptLabel": "...",
  "questionText": "Calcula [problema con valores numéricos concretos]",
  "options": null,
  "correctAnswer": {"value": 42, "tolerance": 0.5, "unit": "unidad"},
  "explanation": "...",
  "hint": "...",
  "difficulty": "DIFFICULTY",
  "targetDimension": "application",
  "estimatedSeconds": 90,
  "evidencesNeeded": 1
}`,
}

function getFormatTemplate(format: string, variant: string, difficulty: string, dimension: string): string {
  const base = FORMAT_PROMPT_TEMPLATES[format] || FORMAT_PROMPT_TEMPLATES['multiple_choice']
  return base
    .replace(/VARIANT/g, variant)
    .replace(/DIFFICULTY/g, difficulty)
    .replace(/DIMENSION/g, dimension)
}

function buildFormatSpecificInstructions(format: string, variant: string): string {
  switch (format) {
    case 'multiple_choice':
      if (variant.includes('cause') || variant.includes('consequence'))
        return 'INSTRUCCIÓN: Presenta una situación y pregunta por la causa O consecuencia. Los distractores deben ser causas/consecuencias plausibles pero incorrectas.'
      if (variant.includes('analogy'))
        return 'INSTRUCCIÓN: Construye una analogía "A es a B como C es a D" usando el concepto del material.'
      if (variant.includes('except') || variant.includes('least'))
        return 'INSTRUCCIÓN: Pregunta cuál opción NO aplica. Las otras tres deben ser ejemplos correctos del material.'
      return 'INSTRUCCIÓN: 4 opciones. Una correcta, tres distractores que representen errores conceptuales reales, no absurdos.'
    case 'true_false':
      return 'INSTRUCCIÓN: Afirmación INEQUÍVOCAMENTE verdadera o falsa. Si es falsa, la explicación debe decir qué sería correcto.'
    case 'ordering':
      return 'INSTRUCCIÓN: Mínimo 3 elementos, máximo 5. Un solo orden correcto. Los IDs en correctAnswer deben ser exactamente los IDs de las opciones.'
    case 'matching':
      return 'INSTRUCCIÓN: Mínimo 3 pares, máximo 5. rightId únicos por columna derecha. correctAnswer mapea id de left (p1,p2...) con rightId (r1,r2...).'
    case 'word_bank':
      return 'INSTRUCCIÓN: Exactamente tantos ___ como palabras en correctAnswer. Los IDs en correctAnswer son los IDs de las opciones, no el texto.'
    case 'classify':
      return 'INSTRUCCIÓN: Mínimo 2 categorías, mínimo 2 items por categoría. correctAnswer mapea id de cada item con el nombre de su categoría.'
    case 'scenario':
      return 'INSTRUCCIÓN: El escenario debe ser concreto. El estudiante solo puede responder correctamente si entendió el concepto.'
    case 'find_the_error':
      return 'INSTRUCCIÓN: Presenta un razonamiento con UN error específico derivado de una misconception común.'
    case 'short_response':
      return 'INSTRUCCIÓN: Pregunta abierta pero específica. correctAnswer es una respuesta de referencia de 1-2 frases.'
    case 'numeric_problem':
      return 'INSTRUCCIÓN: Usa valores DIFERENTES al material original. Incluye value, tolerance y unit en correctAnswer. Verifica el resultado matemáticamente.'
    default:
      return ''
  }
}

function buildQuestionPrompt(
  objective: EvaluableObjective,
  spec: PlannedQuestionSpec,
  context: QuestionGenerationContext,
  format: string,
  variant: string,
  difficulty: string,
  cognitiveObjective: string,
  reasoning: string,
): string {
  const modeName = {
    quick_test: 'RÁPIDAS (sin escritura)',
    write_explain: 'ESCRIBIR (respuestas abiertas)',
    mix_everything: 'MIXTO',
    read_only: 'LECTURA',
  }[context.mode] || 'MIXTO'

  const dimension = objective.cognitiveLevel
  const template = getFormatTemplate(format, variant, difficulty, dimension)
  const formatInstructions = buildFormatSpecificInstructions(format, variant)

  return `Eres un experto en evaluación pedagógica.

MATERIAL: "${context.materialTitle}"
SESIÓN: "${context.sessionTitle}"
MODO: ${modeName}

PASO EVALUADO:
Título: ${objective.stepTitle}
Tipo: ${objective.stepType}
Contenido:
${objective.teachingContent}
${objective.keyPoint ? `IDEA CLAVE: ${objective.keyPoint}` : ''}

OBJETIVO:
- Concepto: ${objective.conceptLabel}
- Nivel cognitivo: ${dimension}
- Objetivo cognitivo: ${cognitiveObjective}

FORMATO SELECCIONADO: ${format}
VARIANTE: ${variant}
RAZÓN PEDAGÓGICA: ${reasoning}

${formatInstructions}

REGLAS:
1. Evalúa SOLO lo enseñado. No inventes.
2. La pregunta debe requerir comprensión real, no memorización literal.
3. El feedback debe usar el contenido real del material.
4. NO menciones números de pasos.
5. LaTeX correcto si hay fórmulas: $...$ inline, $$...$$ display.

Devuelve SOLO JSON válido:
${template}`
}

export async function generateQuestionsFromClass(
  coverageMap: CoverageMap,
  plan: { questions: PlannedQuestionSpec[] },
  context: QuestionGenerationContext,
): Promise<CanonicalQuestion[]> {
  const questions: CanonicalQuestion[] = []
  const usedFormats: string[] = context.recentFormats ? [...context.recentFormats] : []

  for (let i = 0; i < plan.questions.length; i++) {
    const spec = plan.questions[i]
    const objective = coverageMap.objectives.find(o => o.id === spec.objectiveId)
    if (!objective) continue

    const question = await generateSingleQuestion(
      objective, spec, context, usedFormats, i, plan.questions.length,
    )
    if (question) {
      questions.push(question)
      usedFormats.push(question.format)
    }
  }

  return questions
}

async function generateSingleQuestion(
  objective: EvaluableObjective,
  spec: PlannedQuestionSpec,
  context: QuestionGenerationContext,
  recentFormats: string[],
  questionIndex: number,
  totalQuestionsInBlock: number,
): Promise<CanonicalQuestion | null> {
  const contentText = `${objective.stepTitle} ${objective.teachingContent} ${objective.keyPoint || ''}`
  const contentSignal = detectContentSignal(contentText)

  const formatInput: FormatSelectionInput = {
    cognitiveLevel: objective.cognitiveLevel as any,
    contentSignal,
    academicDomain: ((context as any).academicDomain || 'general_conceptual') as any,
    evaluationMode: context.mode,
    recentFormats: recentFormats.slice(-4),
    consecutiveFailures: context.consecutiveFailures || 0,
    isRecovery: false,
    questionIndex,
    totalQuestionsInBlock,
  }

  const formatSelection = selectPedagogicalFormat(formatInput)

  // Respetar formatHint del spec si es válido y no es MCQ genérico
  const specFormat = spec.formatHint
  if (specFormat && specFormat !== 'multiple_choice' && specFormat !== 'mcq_best_answer') {
    const modeCheck = validateQuestionTypeForMode(context.mode, specFormat)
    if (modeCheck.valid) {
      formatSelection.format = specFormat
    }
  }

  const prompt = buildQuestionPrompt(
    objective, spec, context,
    formatSelection.format,
    formatSelection.variant,
    formatSelection.difficulty,
    formatSelection.cognitiveObjective,
    formatSelection.reasoning,
  )

  try {
    const result = await alaiJson({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.35,
      maxTokens: 1400,
      json: true,
    })

    if (!result || typeof result !== 'object') return null

    const genContext: GenerationContext = {
      activeConceptId: objective.conceptLabel,
      activeConceptLabel: objective.conceptLabel,
      teachingBlockId: objective.stepId,
      targetDimension: objective.cognitiveLevel as any,
      questionFamily: formatSelection.variant,
      allowedConceptIds: [objective.conceptLabel],
      forbiddenConceptIds: [],
      evaluationMode: context.mode,
      targetStepIds: [objective.stepId],
      targetKeyPointIds: [],
      factKeys: [objective.id],
      targetObjectiveIds: [objective.id],
    }

    const question = normalizeGeneratedQuestion(result, genContext)
    if (!question) return null

    const modeValidation = validateQuestionTypeForMode(context.mode, question.format)
    return modeValidation.valid ? question : null

  } catch (err) {
    console.error('[questionGenerator] Error:', err)
    return null
  }
}
