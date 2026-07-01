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
    const difficulty: number = ctx.difficulty ?? body.difficulty ?? 65
    const count: number = Math.min(Number(body.count) || 6, 10)
    const weakConcepts: string[] = ctx.weakConcepts || body.weakConcepts || []
    const evidenceGoal: string = ctx.evidenceGoal || ''
    const userProfile = ctx.userProfile || body.userProfile || null
    const profileCtx = userProfile?.carrera
      ? `Carrera del estudiante: ${userProfile.carrera}. Nivel: ${userProfile.academicLevel || 'intermedio'}. `
      : ''

    const diffLabel = difficulty < 40 ? 'básicas' : difficulty < 70 ? 'intermedias' : 'difíciles y precisas'
    const cFocus = targetConcepts.length > 0
      ? `Conceptos obligatorios: ${targetConcepts.slice(0, 6).join(', ')}.`
      : ''
    const wFocus = weakConcepts.length > 0
      ? `Prioriza estos puntos débiles: ${weakConcepts.slice(0, 4).join(', ')}.`
      : ''

    const prompt = `Eres un generador de examen simulado para "${topicTitle}".

CONTEXTO: Este es un examen real de práctica. El estudiante debe demostrar dominio completo.
REGLAS:
- Genera EXACTAMENTE ${count} preguntas de opción múltiple
- TODAS sobre "${topicTitle}" exclusivamente
- Dificultad: preguntas ${diffLabel} (${difficulty}/100)
- ${cFocus}
- ${wFocus}
- ${evidenceGoal ? `Objetivo: ${evidenceGoal}` : ''}
- 4 opciones, 1 correcta, opciones plausibles (no obvias)
- Mezcla preguntas de: definición, aplicación, análisis, comparación

MATERIAL:
${materialSlice.slice(0, 5500)}

Devuelve SOLO JSON:
{"questions":[{"question":"pregunta","options":["A","B","C","D"],"correctAnswer":"A","concept":"concepto evaluado","type":"application"}]}`

    const rawText = await alaiRequest(async (client: any, model: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.45,
        max_tokens: 2000,
      })
      return res.choices?.[0]?.message?.content || ''
    })

    let parsed: any = null
    try { parsed = JSON.parse((rawText as string).trim()) } catch {}
    if (!parsed) {
      const m = (rawText as string).match(/\{[\s\S]*\}/)
      if (m) try { parsed = JSON.parse(m[0]) } catch {}
    }

    const questions = (parsed?.questions || [])
      .filter((q: any) => q.question && Array.isArray(q.options) && q.options.length >= 2 && q.correctAnswer)
      .slice(0, count)
      .map((q: any, i: number) => ({
        id: `ae_${i}_${Date.now()}`,
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        concept: q.concept || targetConcepts[0] || topicTitle,
        type: q.type || 'multiple_choice',
        difficulty,
      }))

    console.log(`[Adaptive Exam] "${topicTitle}" → ${questions.length}/${count} preguntas`)
    return NextResponse.json({ success: true, questions, topicTitle, count: questions.length })

  } catch (err: any) {
    console.error('[Adaptive Exam]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
