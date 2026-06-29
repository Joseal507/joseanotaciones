import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest } from '../../../../lib/alai'

export const maxDuration = 60

// ═══════════════════════════════════════════════════════════════
// Adaptive Quiz — usa misma lógica que /alai-studyal-quizzes
// correctAnswer = ÍNDICE (no texto)
// Cada pregunta tiene explanation completa
// ═══════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const ctx = body.adaptiveContext || body
    const topicTitle: string = ctx.topicTitle || body.topicTitle || 'el tema'
    const targetConcepts: string[] = ctx.targetConcepts || body.targetConcepts || []
    const materialSlice: string = ctx.materialSlice || body.contenido || body.content || ''
    const difficulty: number = ctx.difficulty ?? body.difficulty ?? 50
    const count: number = Math.min(Number(body.count) || 3, 6)
    const weakConcepts: string[] = ctx.weakConcepts || body.weakConcepts || []
    const questionTypes: string[] = body.questionTypes || ['multiple_choice']
    const focusConcept: string = body.focus || body.concept || targetConcepts[0] || ''

    if (!materialSlice.trim() && targetConcepts.length === 0) {
      return NextResponse.json({ success: false, error: 'Sin contexto' }, { status: 400 })
    }

    const diffLabel = difficulty < 40 ? 'fáciles' : difficulty < 70 ? 'intermedias' : 'difíciles'
    const focusInstruction = focusConcept
      ? `Las preguntas deben enfocarse específicamente en: "${focusConcept}"`
      : `Conceptos objetivo: ${targetConcepts.slice(0, 5).join(', ')}`

    const typeInstructions = questionTypes.map(t => {
      if (t === 'multiple_choice') return '- multiple_choice: 4 opciones, una correcta'
      if (t === 'true_false') return '- true_false: pregunta de verdadero/falso'
      if (t === 'apply_scenario') return '- apply_scenario: caso a resolver (multiple_choice con 4 opciones)'
      if (t === 'open_essay') return '- open_essay: pregunta abierta de desarrollo'
      if (t === 'explain_why') return '- explain_why: pregunta abierta de razonamiento'
      return '- multiple_choice: 4 opciones, una correcta'
    }).join('\n')

    const prompt = `Eres un generador de preguntas de quiz para el tema "${topicTitle}".

═══ CONTEXTO ═══
${focusInstruction}
Dificultad: ${diffLabel} (${difficulty}/100)
${weakConcepts.length > 0 ? `Conceptos débiles a reforzar: ${weakConcepts.slice(0, 3).join(', ')}` : ''}

═══ MATERIAL DE REFERENCIA ═══
${materialSlice.slice(0, 5000)}

═══ TIPOS DE PREGUNTA A USAR ═══
${typeInstructions}

═══ REGLAS CRÍTICAS ═══

1. Genera EXACTAMENTE ${count} preguntas
2. TODAS basadas en el material de referencia, no inventes
3. Las opciones incorrectas deben ser PLAUSIBLES (no absurdas)
4. CADA pregunta debe tener una "explanation" clara que explique:
   - Por qué la respuesta correcta es correcta
   - Por qué las otras opciones están mal (si aplica)
5. correctAnswer es un ÍNDICE numérico (0, 1, 2, 3) — NO texto
6. Para true_false: correctAnswer es boolean (true o false)

═══ FORMATO JSON ═══

Devuelve SOLO JSON válido:
{
  "questions": [
    {
      "type": "multiple_choice",
      "question": "¿Pregunta clara y específica?",
      "options": ["Opción A", "Opción B", "Opción C", "Opción D"],
      "correctAnswer": 2,
      "explanation": "La opción C es correcta porque [razón clara]. La opción A es incorrecta porque [error común]. Las opciones B y D son incorrectas porque [explicación].",
      "concept": "${focusConcept || targetConcepts[0] || topicTitle}"
    }
  ]
}

Para true_false:
{
  "type": "true_false",
  "question": "Afirmación clara",
  "correctAnswer": true,
  "explanation": "Es verdadero porque [razón]. Un error común es pensar [malentendido] pero en realidad [aclaración]."
}

Para open_essay o explain_why:
{
  "type": "open_essay",
  "question": "¿Pregunta abierta?",
  "expectedAnswer": "La idea central esperada (para evaluar respuesta del estudiante)",
  "explanation": "Una buena respuesta incluiría: [puntos clave]. Lo más importante es [concepto central]."
}`

    const rawText = await alaiRequest(async (client: any, model: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: model(),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
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

    // Validar y normalizar preguntas
    const questions = (parsed?.questions || [])
      .map((q: any, i: number) => {
        if (!q.question) return null

        // multiple_choice y apply_scenario
        if (q.type === 'multiple_choice' || q.type === 'apply_scenario' || !q.type) {
          const options = Array.isArray(q.options) ? q.options.map(String) : []
          if (options.length < 2) return null

          // correctAnswer puede venir como número o como texto (compatibilidad)
          let correctIdx = typeof q.correctAnswer === 'number'
            ? q.correctAnswer
            : options.findIndex((opt: string) => opt === String(q.correctAnswer).trim())

          if (correctIdx < 0 || correctIdx >= options.length) correctIdx = 0

          return {
            id: `q_${i}_${Date.now()}`,
            type: 'multiple_choice',
            question: String(q.question),
            options,
            correctAnswer: correctIdx,  // ← ÍNDICE numérico
            explanation: String(q.explanation || ''),
            concept: q.concept || focusConcept || targetConcepts[0] || topicTitle,
          }
        }

        // true_false
        if (q.type === 'true_false') {
          let correctVal: boolean = false
          if (typeof q.correctAnswer === 'boolean') correctVal = q.correctAnswer
          else {
            const v = String(q.correctAnswer).toLowerCase().trim()
            if (['true', '1', 'yes', 'si', 'verdadero', 'v'].includes(v)) correctVal = true
          }

          return {
            id: `q_${i}_${Date.now()}`,
            type: 'true_false',
            question: String(q.question),
            options: ['Verdadero', 'Falso'],
            correctAnswer: correctVal ? 0 : 1,  // Verdadero=0, Falso=1
            isBoolean: true,
            booleanAnswer: correctVal,
            explanation: String(q.explanation || ''),
            concept: q.concept || focusConcept || targetConcepts[0] || topicTitle,
          }
        }

        // open_essay o explain_why
        if (q.type === 'open_essay' || q.type === 'explain_why') {
          return {
            id: `q_${i}_${Date.now()}`,
            type: 'open_essay',
            question: String(q.question),
            expectedAnswer: String(q.expectedAnswer || q.expectedIdea || ''),
            explanation: String(q.explanation || ''),
            concept: q.concept || focusConcept || targetConcepts[0] || topicTitle,
          }
        }

        return null
      })
      .filter(Boolean)
      .slice(0, count)

    console.log(`[Adaptive Quiz] "${topicTitle}" → ${questions.length}/${count} preguntas válidas`)

    return NextResponse.json({
      success: true,
      questions,
      topicTitle,
      count: questions.length,
    })

  } catch (err: any) {
    console.error('[Adaptive Quiz]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
