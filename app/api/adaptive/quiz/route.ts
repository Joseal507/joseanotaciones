import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest } from '../../../../lib/alai'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const ctx = body.adaptiveContext || body
    const topicTitle: string = ctx.topicTitle || body.topicTitle || 'el tema'
    const targetConcepts: string[] = ctx.targetConcepts || body.targetConcepts || []
    const materialSlice: string = ctx.materialSlice || body.contenido || body.content || ''
    const overallMastery: number = ctx.overallMastery ?? 0
    const count: number = Math.min(Number(body.count) || 2, 5)
    const focusConcept: string = body.focusConcept || body.focus || body.concept || targetConcepts[0] || ''
    const lastExplanation: string = body.lastExplanation || ''
    const sessionNumber: number = body.sessionNumber || ctx.sessionNumber || 1
    const previousTypes: string[] = body.previousTypes || []
    const actType: string = body.actType || 'micro_quiz'
    const knowledgeType: string = body.knowledgeType || 'conceptual'
    const learningGoal: string = body.learningGoal || 'explain_concept'

    // Nivel del estudiante
    const isLevelZero = overallMastery < 15 || sessionNumber === 1

    // Tipos de pregunta según knowledgeType — declarado ANTES de usarse
    const knowledgeQuizTypes: Record<string, string> = {
      mathematical: 'multiple_choice',
      narrative: overallMastery >= 40 ? 'true_false' : 'multiple_choice',
      memoristic: 'multiple_choice',
      causal: overallMastery >= 30 ? 'multi_select' : 'multiple_choice',
      argumentative: overallMastery >= 40 ? 'true_false' : 'multiple_choice',
      procedural: overallMastery >= 40 ? 'matching' : 'multiple_choice',
      visual: 'multiple_choice',
      conceptual: overallMastery >= 50 ? 'multi_select' : 'multiple_choice',
    }

    // Elegir tipo de pregunta según knowledgeType, actType y nivel
    let questionType = 'multiple_choice'
    if (!isLevelZero) {
      const suggestedByKnowledge = knowledgeQuizTypes[knowledgeType]
      const avoidType = previousTypes[previousTypes.length - 1]

      if (actType === 'comparison' && avoidType !== 'true_false') questionType = 'true_false'
      else if (actType === 'cause_effect' && overallMastery >= 30 && avoidType !== 'multi_select') questionType = 'multi_select'
      else if (actType === 'actors' && avoidType !== 'matching' && overallMastery >= 40) questionType = 'matching'
      else if (suggestedByKnowledge && suggestedByKnowledge !== avoidType) questionType = suggestedByKnowledge
      else questionType = 'multiple_choice'
    }

    // El contexto de evaluación es SIEMPRE lo que acaba de leer
    const evaluationContext = lastExplanation.length > 100
      ? `LO QUE EL ESTUDIANTE ACABA DE LEER (evalúa ESTO):
${lastExplanation.slice(0, 3000)}

MATERIAL ADICIONAL DE REFERENCIA:
${materialSlice.slice(0, 2000)}`
      : `MATERIAL:
${materialSlice.slice(0, 5000)}`

    const levelNote = isLevelZero
      ? 'NIVEL CERO: El estudiante acaba de leer esto por primera vez. Las preguntas deben verificar comprensión básica, no conocimiento previo.'
      : overallMastery < 40
      ? 'NIVEL BÁSICO: Preguntas de comprensión directa.'
      : 'NIVEL INTERMEDIO/AVANZADO: Preguntas de aplicación y análisis.'

    // Instrucción adicional según actType
    const actTypeQuizNote: Record<string, string> = {
      comparison: `La pregunta debe comparar "${focusConcept}" con otro concepto del material. ¿Cuál es la diferencia clave?`,
      cause_effect: `La pregunta debe evaluar si entiende la cadena causa-efecto de "${focusConcept}".`,
      position_a: `La pregunta debe evaluar si entiende el primer argumento/posición sobre "${focusConcept}".`,
      position_b: `La pregunta debe evaluar si puede comparar o refutar la posición sobre "${focusConcept}".`,
      identify: `La pregunta debe pedir identificar o reconocer "${focusConcept}" en un contexto.`,
      case_study: `La pregunta debe presentar un caso concreto y pedir aplicar "${focusConcept}".`,
      actors: `La pregunta debe evaluar quiénes son los actores clave y qué rol tienen en "${focusConcept}".`,
      harder_problem: `La pregunta debe ser más difícil que las anteriores. Requiere aplicación, no solo memoria.`,
      micro_quiz: `La pregunta debe verificar comprensión directa de lo que acaba de leer sobre "${focusConcept}".`,
    }
    const actTypeNote = actTypeQuizNote[actType] || actTypeQuizNote.micro_quiz



    const typeInstructions: Record<string, string> = {
      multiple_choice: `Genera ${count} pregunta(s) de OPCIÓN MÚLTIPLE sobre "${focusConcept}".
REGLAS:
- La pregunta verifica que entendió lo que acaba de leer
- 4 opciones, 1 correcta
- Las incorrectas son errores conceptuales reales (no absurdos)
- correctAnswer = ÍNDICE numérico (0, 1, 2 o 3)
- En nivel cero: la respuesta correcta está EXPLÍCITA en el texto que leyó
JSON por pregunta: { "type": "multiple_choice", "question": "...", "options": ["A","B","C","D"], "correctAnswer": 2, "explanation": "Según el texto: [cita o paráfrasis del material]..." }`,

      multi_select: `Genera ${count} pregunta(s) de SELECCIÓN MÚLTIPLE (varias respuestas correctas).
- 4-5 opciones, 2-3 correctas
- correctAnswers = ARRAY de índices [0, 2]
JSON: { "type": "multi_select", "question": "¿Cuáles de las siguientes...?", "options": [...], "correctAnswers": [0,2], "explanation": "..." }`,

      true_false: `Genera ${count} afirmación(es) de VERDADERO/FALSO sobre "${focusConcept}".
- Afirmaciones verificables en el material
- correctAnswer = true o false (boolean)
JSON: { "type": "true_false", "question": "Afirmación concreta...", "correctAnswer": true, "explanation": "El texto dice: [cita]..." }`,

      matching: `Genera 1 pregunta de RELACIONAR COLUMNAS sobre "${focusConcept}".
- 3-4 pares máximo
- Los pares deben estar en el material leído
- pairs = array de {left, right}
JSON: { "type": "matching", "question": "Relaciona:", "pairs": [{"left":"A","right":"def A"},{"left":"B","right":"def B"},{"left":"C","right":"def C"}], "explanation": "..." }`,
    }

    const prompt = `Eres un tutor generando preguntas pedagógicas para verificar comprensión real.

${levelNote}
CONCEPTO EVALUADO: "${focusConcept}"
TEMA: "${topicTitle}"
TIPO DE ACTIVIDAD: ${actType} — ${actTypeNote}
TIPO DE CONOCIMIENTO: ${knowledgeType}
OBJETIVO DE APRENDIZAJE: ${learningGoal}

${evaluationContext}

${typeInstructions[questionType] || typeInstructions.multiple_choice}

REGLAS CRÍTICAS:
1. Las preguntas evalúan LO QUE ACABA DE LEER — no conocimiento previo
2. La explanation cita o parafrasea el material: "Según el texto..."
3. NUNCA preguntar definiciones directas como "¿Qué es X?" — eso es trivia
4. SIEMPRE preguntar COMPRENSIÓN: "¿Por qué...?", "¿Qué pasaría si...?", "¿Cuál es la diferencia entre...?"
5. Las opciones incorrectas deben ser CREÍBLES — errores conceptuales reales, no absurdos
6. La respuesta correcta NO debe ser la más larga ni la más obvia
7. Todas las opciones deben tener longitud similar

TIPOS DE PREGUNTA BUENOS:
- "¿Por qué X es importante según el material?" (causalidad)
- "¿Qué diferencia hay entre X e Y?" (comparación)
- "Si cambiara X, ¿qué pasaría con Y?" (predicción)
- "¿Cuál de estos NO es un ejemplo de X?" (discriminación)
- "¿Qué tienen en común X e Y según el texto?" (síntesis)

TIPOS DE PREGUNTA PROHIBIDOS:
- "¿Qué es X?" (definición directa)
- "¿Quién creó X?" (trivia factual pura)
- "¿En qué año...?" (memoria pura — excepto si es esencial)

Devuelve SOLO JSON:
{
  "questions": [ <pregunta según el tipo> ],
  "questionType": "${questionType}"
}`

    const rawText = await alaiRequest(async (client: any, model: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 2000,
      })
      return res.choices?.[0]?.message?.content || ''
    })

    let parsed: any = null
    try { parsed = JSON.parse(String(rawText).trim()) } catch {}
    if (!parsed) {
      const m = String(rawText).match(/\{[\s\S]*\}/)
      if (m) try { parsed = JSON.parse(m[0]) } catch {}
    }

    const rawQuestions = parsed?.questions || (parsed && !parsed.questions ? [parsed] : [])

    const questions = rawQuestions.map((q: any, i: number) => {
      if (!q?.question) return null
      const base = {
        id: `q_${i}_${Date.now()}`,
        type: q.type || questionType,
        question: String(q.question).replace(/\*\*/g, '').replace(/\*/g, ''),
        explanation: String(q.explanation || '').replace(/\*\*/g, '').replace(/\*/g, ''),
        concept: focusConcept,
      }

      if (base.type === 'multiple_choice') {
        const options = Array.isArray(q.options) ? q.options.map((o: any) => String(o).replace(/\*\*/g, '')) : []
        if (options.length < 2) return null
        let correctIdx = typeof q.correctAnswer === 'number' ? q.correctAnswer : 0
        if (correctIdx < 0 || correctIdx >= options.length) correctIdx = 0
        return { ...base, options, correctAnswer: correctIdx }
      }
      if (base.type === 'multi_select') {
        const options = Array.isArray(q.options) ? q.options.map((o: any) => String(o).replace(/\*\*/g, '')) : []
        if (options.length < 2) return null
        const correctAnswers = Array.isArray(q.correctAnswers) ? q.correctAnswers.map(Number) : [0]
        return { ...base, options, correctAnswers }
      }
      if (base.type === 'true_false') {
        const correctAnswer = typeof q.correctAnswer === 'boolean' ? q.correctAnswer
          : ['true','verdadero','sí','yes'].includes(String(q.correctAnswer).toLowerCase())
        return { ...base, correctAnswer }
      }
      if (base.type === 'matching') {
        const pairs = Array.isArray(q.pairs) ? q.pairs : []
        if (pairs.length < 2) return null
        return { ...base, pairs }
      }
      return null
    }).filter(Boolean).slice(0, count)

    // Fallback: si no hay preguntas válidas, devolver error claro
    if (questions.length === 0) {
      return NextResponse.json({ success: false, error: 'No se pudieron generar preguntas' }, { status: 500 })
    }

    console.log(`[Quiz] "${focusConcept}" | tipo: ${questionType} | ${questions.length} preguntas | nivel: ${isLevelZero ? 'CERO' : overallMastery}`)
    return NextResponse.json({ success: true, questions, topicTitle, questionType, count: questions.length })

  } catch (err: any) {
    console.error('[Adaptive Quiz]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
