// ═══════════════════════════════════════════════════════════════
// QUESTION BANK — Pre-genera preguntas variadas por micro
//
// Se ejecuta UNA vez al construir el grafo.
// Para cada micro genera N preguntas basadas ESTRICTAMENTE en su
// texto exacto (sourceQuotes, examples, formulas, procedures).
//
// El tutor v3 durante las sesiones saca preguntas del banco,
// no las genera on-the-fly. Esto elimina la repetición y
// garantiza que las preguntas vengan del material real.
// ═══════════════════════════════════════════════════════════════

import { alaiRequest, safeParseJson } from '../../../alai'
import type { MicroConcept } from '../types'

const genId = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

export interface BankedQuestion {
  id: string
  microId: string
  format: 'multiple_choice' | 'true_false' | 'fill_blank' | 'fill_blank_bank' | 'matching' | 'ordering' |
          'open_response' | 'teach_back' | 'explain_why' | 'step_by_step_solver' |
          'practical_case' | 'find_the_error'
  cognitiveAngle: 'recall' | 'apply' | 'compare' | 'explain' | 'analyze'
  // Clave del hecho que evalúa — evitar preguntar el mismo hecho dos veces
  factKey: string
  prompt: string
  data: any
  sourceQuote: string  // texto EXACTO del material del que salió
  difficulty: 'easy' | 'medium' | 'hard'
  // Para true_false — indica si la afirmación es verdadera o falsa
  truthValue?: boolean
}

export interface QuestionBank {
  microId: string
  microName: string
  cognitiveType: string
  questionsByFormat: Record<string, BankedQuestion[]>
  totalQuestions: number
  requiredEvidences: number  // cuántas correctas necesita para dominar
}

// ═══════════════════════════════════════════════════════════════
// Calcular cuántas preguntas y de qué tipo necesita cada micro
// según su tipo cognitivo y dificultad
// ═══════════════════════════════════════════════════════════════
function planQuestionsForMicro(micro: MicroConcept): {
  formatCounts: Record<string, number>
  requiredEvidences: number
} {
  const type = micro.cognitiveType || 'conceptual'
  const difficulty = micro.difficulty || 50
  const importance = micro.importance || 'medium'

  // Base de evidencias necesarias por importancia y dificultad
  const baseEvidences =
    importance === 'critical' ? 5 :
    importance === 'high' ? 4 : 3
  const requiredEvidences = baseEvidences + (difficulty > 70 ? 2 : difficulty > 40 ? 1 : 0)

  // Distribución por tipo cognitivo
  // OPTIMIZADO: máximo 3 formatos por micro para velocidad
  // Genera ~9 preguntas por micro (~3 llamadas LLM en vez de ~8)
  // Cantidad ÓPTIMA de preguntas por formato según tipo cognitivo, importancia y dificultad.
  // La cantidad base varía por tipo: conceptos que requieren más práctica tienen más preguntas.
  // El multiplicador de importancia y dificultad se aplica al total resultante.

  // Factor base por tipo cognitivo: cuántas preguntas necesita para internalizarse
  const baseByType: Record<string, number> = {
    // Tipos que se aprenden con poco: 1 pregunta por formato basta
    narrative: 1,
    chronological: 1,
    classificatory: 1,
    // Tipos que necesitan práctica moderada: 2 preguntas por formato
    definitional: 2,
    conceptual: 2,
    comparative: 2,
    // Tipos que requieren práctica intensiva: 3 preguntas por formato
    mathematical: 3,
    procedural: 3,
    causal: 2,
    analytical: 2,
    applicative: 3,
  }

  const base = baseByType[type] || 2

  // Multiplicador por importancia del concepto
  const impMultiplier =
    importance === 'critical' ? 1.5 :
    importance === 'high' ? 1.2 :
    importance === 'low' ? 0.7 : 1.0

  // Multiplicador por dificultad (0-100)
  const diffMultiplier =
    difficulty >= 80 ? 1.4 :
    difficulty >= 60 ? 1.2 :
    difficulty <= 20 ? 0.7 : 1.0

  // Calcular cantidad final por formato (mínimo 1, máximo 2 para el banco inicial)
  // Preguntas adicionales se generan bajo demanda en reparación, repaso espaciado y examen
  const qPerFormat = Math.max(1, Math.min(2, Math.round(base * impMultiplier * diffMultiplier)))

  // Distribución por tipo cognitivo con la cantidad calculada
  const plans: Record<string, Record<string, number>> = {
    definitional: {
      multiple_choice: qPerFormat, true_false: qPerFormat, fill_blank: qPerFormat
    },
    conceptual: {
      multiple_choice: qPerFormat, fill_blank: qPerFormat, true_false: qPerFormat
    },
    mathematical: {
      fill_blank: qPerFormat, multiple_choice: qPerFormat, step_by_step_solver: qPerFormat
    },
    procedural: {
      ordering: qPerFormat, multiple_choice: qPerFormat, fill_blank: qPerFormat
    },
    causal: {
      multiple_choice: qPerFormat, true_false: qPerFormat, fill_blank: qPerFormat
    },
    comparative: {
      matching: qPerFormat, multiple_choice: qPerFormat, true_false: qPerFormat
    },
    chronological: {
      ordering: qPerFormat, multiple_choice: qPerFormat, fill_blank: qPerFormat
    },
    classificatory: {
      matching: qPerFormat, multiple_choice: qPerFormat, true_false: qPerFormat
    },
    narrative: {
      multiple_choice: qPerFormat, fill_blank: qPerFormat, true_false: qPerFormat
    },
    analytical: {
      multiple_choice: qPerFormat, fill_blank: qPerFormat, true_false: qPerFormat
    },
    applicative: {
      multiple_choice: qPerFormat, fill_blank: qPerFormat, step_by_step_solver: qPerFormat
    },
  }

  return {
    formatCounts: plans[type] || plans.conceptual,
    requiredEvidences,
  }
}

// ═══════════════════════════════════════════════════════════════
// Generar N preguntas de UN formato específico para UN micro
// ═══════════════════════════════════════════════════════════════
async function generateQuestionsForFormat(
  micro: MicroConcept,
  format: string,
  count: number,
): Promise<BankedQuestion[]> {
  if (count <= 0) return []

  const sourceText = [
    `NOMBRE: ${micro.name}`,
    `DEFINICIÓN: ${micro.fullDefinition}`,
    micro.sourceQuotes.length > 0 ? `CITAS EXACTAS DEL MATERIAL:\n${micro.sourceQuotes.map(q => `- "${q}"`).join('\n')}` : '',
    micro.examples.length > 0 ? `EJEMPLOS:\n${micro.examples.map(e => `- ${e.scenario}${e.solution ? ' → ' + e.solution : ''}`).join('\n')}` : '',
    micro.formulas.length > 0 ? `FÓRMULAS:\n${micro.formulas.map(f => `- ${f.expression}`).join('\n')}` : '',
    micro.procedures.length > 0 ? `PROCEDIMIENTOS:\n${micro.procedures.map(p => `- ${p.name}: ${p.steps.map(s => s.description).join(' → ')}`).join('\n')}` : '',
    micro.commonErrors.length > 0 ? `ERRORES COMUNES:\n${micro.commonErrors.map(e => `- ${e.description}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')

  const formatInstructions: Record<string, string> = {
    multiple_choice: `Genera ${count} preguntas de opción múltiple DIFERENTES entre sí, cada una desde un ángulo cognitivo distinto (recordar dato, aplicar, comparar, explicar).
Schema por pregunta: {"format":"multiple_choice","cognitiveAngle":"recall|apply|compare|explain","prompt":"...","data":{"options":["A","B","C","D"],"correctIndex":0,"explanation":"..."},"sourceQuote":"cita exacta usada","difficulty":"easy|medium|hard"}`,

    true_false: `Genera ${count} afirmaciones DIFERENTES sobre el concepto. Mezcla verdaderas y falsas. Cada una debe evaluar un aspecto distinto.
Schema: {"format":"true_false","cognitiveAngle":"recall|apply|explain","prompt":"Evalúa si esto es verdadero o falso","data":{"statement":"afirmación","correctAnswer":true,"explanation":"..."},"sourceQuote":"cita","difficulty":"..."}`,

    fill_blank: `Genera ${count} frases con espacio en blanco. Usar frases EXACTAS del material cuando sea posible. Cada frase debe evaluar UN dato específico distinto.
Schema: {"format":"fill_blank","cognitiveAngle":"recall","prompt":"Completa la frase","data":{"template":"El ___ es X","correctAnswers":["respuesta"],"bank":["opción1","opción2","opción3","respuesta"]},"sourceQuote":"...","difficulty":"..."}`,

    matching: `Genera ${count} preguntas de emparejamiento. Cada una con 4-5 pares distintos del material.
Schema: {"format":"matching","cognitiveAngle":"compare","prompt":"Relaciona","data":{"pairs":[{"left":"X","right":"Y"}]},"sourceQuote":"...","difficulty":"..."}`,

    ordering: `Genera ${count} preguntas de ordenar. Cada una con 4-6 pasos o eventos del material.
Schema: {"format":"ordering","cognitiveAngle":"apply","prompt":"Ordena","data":{"items":["a","b","c"],"correctOrder":[0,1,2]},"sourceQuote":"...","difficulty":"..."}`,

    open_response: `Genera ${count} preguntas abiertas. Cada una pide explicar/describir un aspecto DIFERENTE del concepto.
Schema: {"format":"open_response","cognitiveAngle":"explain","prompt":"...","data":{"expectedKeywords":["palabra1","palabra2"]},"sourceQuote":"...","difficulty":"..."}`,

    teach_back: `Genera ${count} instrucciones de "explica con tus palabras". Cada una enfoca un aspecto distinto.
Schema: {"format":"teach_back","cognitiveAngle":"explain","prompt":"Explica...","data":{"expectedKeywords":["..."]},"sourceQuote":"...","difficulty":"..."}`,

    explain_why: `Genera ${count} preguntas de "por qué" DIFERENTES sobre causas y consecuencias del concepto.
Schema: {"format":"explain_why","cognitiveAngle":"explain","prompt":"¿Por qué...?","data":{"expectedKeywords":["..."]},"sourceQuote":"...","difficulty":"..."}`,

    step_by_step_solver: `Genera ${count} problemas para resolver paso a paso usando las fórmulas/procedimientos del material.
Schema: {"format":"step_by_step_solver","cognitiveAngle":"apply","prompt":"Resuelve","data":{"problem":"...","expectedSteps":["paso1","paso2"],"finalAnswer":"..."},"sourceQuote":"...","difficulty":"..."}`,

    practical_case: `Genera ${count} casos prácticos donde el estudiante aplique el concepto a una situación nueva.
Schema: {"format":"practical_case","cognitiveAngle":"apply","prompt":"Caso:","data":{"scenario":"...","question":"¿qué harías?","expectedElements":["..."]},"sourceQuote":"...","difficulty":"..."}`,

    find_the_error: `Genera ${count} problemas resueltos CON un error para que el estudiante lo detecte.
Schema: {"format":"find_the_error","cognitiveAngle":"analyze","prompt":"Encuentra el error","data":{"workedSolution":["paso1","paso2 con error","paso3"],"errorStepIndex":1,"explanation":"..."},"sourceQuote":"...","difficulty":"..."}`,
  }

  const instruction = formatInstructions[format] || formatInstructions.multiple_choice

  const prompt = `Eres un generador de preguntas pedagógicas. Genera preguntas SOLO sobre el material dado, sin inventar datos.

MATERIAL:
${sourceText}

INSTRUCCIÓN:
${instruction}

REGLAS CRÍTICAS:
- Todas las preguntas deben ser sobre información REAL del material de arriba
- Cada pregunta debe ser DIFERENTE de las otras (distinto dato, distinto ángulo)
- Usar palabras del material cuando sea posible
- Los distractores deben ser plausibles pero claramente incorrectos según el material
- NO inventar datos que no estén en el material

Devuelve SOLO este JSON:
{
  "questions": [ /* array de ${count} preguntas siguiendo el schema */ ]
}`

  try {
    const result = await alaiRequest(async (client: any, modelFn: any) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [
          { role: 'system', content: 'Generas preguntas pedagógicas SOLO del material dado. Solo JSON válido.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5,
        max_tokens: 3500,
      })
      const raw = res?.choices?.[0]?.message?.content || ''
      if (!raw.trim()) throw new Error('Empty question bank response')
      return { text: raw, provider: 'unknown', model: 'unknown' }
    })

    const parsed = safeParseJson(result.text)
    const questions = Array.isArray(parsed?.questions) ? parsed.questions : []

    return questions.map((q: any, idx: number) => ({
      id: genId('q'),
      microId: micro.id,
      format: q.format || format,
      cognitiveAngle: q.cognitiveAngle || 'recall',
      // factKey: combinación de microId + cognitiveAngle + índice para anti-repetición
      factKey: `${micro.id}:${q.cognitiveAngle || 'recall'}:${idx}`,
      prompt: String(q.prompt || ''),
      data: q.data || {},
      sourceQuote: String(q.sourceQuote || ''),
      difficulty: q.difficulty || 'medium',
      // Para true_false: registrar si es verdadero o falso
      truthValue: q.format === 'true_false' || format === 'true_false'
        ? Boolean(q.data?.correctAnswer)
        : undefined,
    })).filter((q: BankedQuestion) => {
      if (!q.prompt || q.prompt.length < 5) return false
      // Validar que MCQ tiene correctIndex válido
      if (q.format === 'multiple_choice') {
        const opts = q.data?.options || []
        const idx = q.data?.correctIndex
        if (!opts.length || idx === undefined || idx < 0 || idx >= opts.length) return false
      }
      // Validar que fill_blank tiene respuesta
      if (q.format === 'fill_blank' || q.format === 'fill_blank_bank') {
        const ans = q.data?.correctAnswers || []
        if (!ans.length || !ans[0]) return false
      }
      // Validar que true_false tiene correctAnswer definido
      if (q.format === 'true_false') {
        if (q.data?.correctAnswer === undefined) return false
      }
      // Validar que ordering tiene items y correctOrder
      if (q.format === 'ordering') {
        if (!q.data?.items?.length || !q.data?.correctOrder?.length) return false
      }
      // Validar que matching tiene pairs
      if (q.format === 'matching') {
        if (!q.data?.pairs?.length || q.data.pairs.length < 2) return false
      }
      return true
    })

  } catch (err: any) {
    console.error(`[questionBank] Error generando ${format} para ${micro.name}:`, err.message)
    return []
  }
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: generar banco completo para un micro
// ═══════════════════════════════════════════════════════════════
export async function buildQuestionBankForMicro(micro: MicroConcept): Promise<QuestionBank> {
  const plan = planQuestionsForMicro(micro)
  const questionsByFormat: Record<string, BankedQuestion[]> = {}

  // Generar preguntas en paralelo para cada formato
  const entries = Object.entries(plan.formatCounts)
  const results = await Promise.all(
    entries.map(async ([format, count]) => {
      const qs = await generateQuestionsForFormat(micro, format, count)
      return [format, qs] as [string, BankedQuestion[]]
    })
  )

  for (const [format, qs] of results) {
    if (qs.length > 0) questionsByFormat[format] = qs
  }

  const totalQuestions = Object.values(questionsByFormat).reduce((s, arr) => s + arr.length, 0)

  console.log(`  📚 Banco: "${micro.name}" — ${totalQuestions} preguntas en ${Object.keys(questionsByFormat).length} formatos`)

  return {
    microId: micro.id,
    microName: micro.name,
    cognitiveType: micro.cognitiveType,
    questionsByFormat,
    totalQuestions,
    requiredEvidences: plan.requiredEvidences,
  }
}

// ═══════════════════════════════════════════════════════════════
// Generar banco para TODOS los micros del grafo
// ═══════════════════════════════════════════════════════════════
export async function buildQuestionBankForGraph(
  micros: MicroConcept[],
): Promise<Record<string, QuestionBank>> {
  console.log(`\n📚 [Question Bank] Generando preguntas para ${micros.length} micros`)
  const start = Date.now()

  const banks: Record<string, QuestionBank> = {}

  // Procesar en lotes de 3 para no saturar
  const batchSize = 3
  for (let i = 0; i < micros.length; i += batchSize) {
    const batch = micros.slice(i, i + batchSize)
    const results = await Promise.all(batch.map(m => buildQuestionBankForMicro(m)))
    for (const bank of results) {
      banks[bank.microId] = bank
    }
  }

  const totalQuestions = Object.values(banks).reduce((s, b) => s + b.totalQuestions, 0)
  const elapsed = Date.now() - start
  console.log(`✅ [Question Bank] ${totalQuestions} preguntas generadas en ${(elapsed/1000).toFixed(1)}s`)

  return banks
}

// ═══════════════════════════════════════════════════════════════
// SHUFFLE DETERMINISTA — distribuye opciones correctas entre A/B/C/D
// Usa el ID de la pregunta como semilla para que sea reproducible
// ═══════════════════════════════════════════════════════════════
function deterministicShuffle<T>(arr: T[], seed: string): T[] {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0
  }
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    hash = (hash * 1664525 + 1013904223) | 0
    const j = Math.abs(hash) % (i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function shuffleQuestionOptions(question: BankedQuestion): BankedQuestion {
  if (question.format !== 'multiple_choice') return question
  const options: string[] = question.data?.options || []
  const correctIndex: number = question.data?.correctIndex ?? 0
  if (options.length < 2) return question

  const correctText = options[correctIndex]
  const shuffled = deterministicShuffle(options, question.id)
  const newCorrectIndex = shuffled.indexOf(correctText)

  return {
    ...question,
    data: {
      ...question.data,
      options: shuffled,
      correctIndex: newCorrectIndex,
    },
  }
}

// ═══════════════════════════════════════════════════════════════
// Seleccionar siguiente pregunta del banco (sin repetición)
// ═══════════════════════════════════════════════════════════════
export function pickNextQuestion(
  bank: QuestionBank,
  usedQuestionIds: string[],
  preferredFormat?: string,
  preferredAngle?: string,
  recentFactKeys?: string[],
  preferredEvidenceType?: string,
): BankedQuestion | null {
  const allQuestions: BankedQuestion[] = Object.values(bank.questionsByFormat).flat()
  const available = allQuestions.filter(q => !usedQuestionIds.includes(q.id))

  if (available.length === 0) return null

  // Filtrar por factKey recientes para evitar repetir el mismo hecho con otro formato
  const recentKeys = new Set(recentFactKeys || [])
  const notRecentFact = available.filter(q => !recentKeys.has(q.factKey || ''))
  const pool = notRecentFact.length > 0 ? notRecentFact : available

  // Mapear tipo de evidencia faltante → ángulo cognitivo preferido
  const evidenceToAngle: Record<string, string[]> = {
    recognized: ['recall'],
    recalled: ['recall'],
    explained: ['explain'],
    applied: ['apply'],
    connected: ['compare', 'analyze'],
    transferred: ['apply', 'analyze'],
    retained: ['recall'],
  }

  // 0) Prioridad absoluta: evidencia faltante
  if (preferredEvidenceType && evidenceToAngle[preferredEvidenceType]) {
    const preferredAngles = evidenceToAngle[preferredEvidenceType]
    const byEvidence = pool.find(q => preferredAngles.includes(q.cognitiveAngle))
    if (byEvidence) return shuffleQuestionOptions(byEvidence)
  }

  // 1) Prioridad: mismo formato + mismo ángulo cognitivo
  if (preferredFormat && preferredAngle) {
    const match = pool.find(q => q.format === preferredFormat && q.cognitiveAngle === preferredAngle)
    if (match) return shuffleQuestionOptions(match)
  }

  // 2) Solo formato preferido
  if (preferredFormat) {
    const match = pool.find(q => q.format === preferredFormat)
    if (match) return shuffleQuestionOptions(match)
  }

  // 3) Solo ángulo preferido
  if (preferredAngle) {
    const match = pool.find(q => q.cognitiveAngle === preferredAngle)
    if (match) return shuffleQuestionOptions(match)
  }

  // 4) Cualquiera disponible, priorizando variedad de ángulos
  const usedAngles = new Set(
    allQuestions
      .filter(q => usedQuestionIds.includes(q.id))
      .map(q => q.cognitiveAngle)
  )
  const freshAngle = pool.find(q => !usedAngles.has(q.cognitiveAngle))
  if (freshAngle) return shuffleQuestionOptions(freshAngle)

  return shuffleQuestionOptions(pool[0])
}
