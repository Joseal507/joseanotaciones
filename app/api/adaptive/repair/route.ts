import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest } from '../../../../lib/alai'

export const maxDuration = 45

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const ctx = body.adaptiveContext || body
    const topicTitle: string = ctx.topicTitle || body.topicTitle || 'el tema'
    const targetConcepts: string[] = ctx.targetConcepts || body.targetConcepts || []
    const materialSlice: string = ctx.materialSlice || body.contenido || body.content || ''
    const weakConcepts: string[] = ctx.weakConcepts || body.weakConcepts || targetConcepts
    const overallMastery: number = ctx.overallMastery ?? 0
    const previousMistakes: string[] = body.previousMistakes || []

    const focusConcepts = weakConcepts.length > 0 ? weakConcepts : targetConcepts

    const prompt = `Eres ALAI en modo de corrección dirigida para el tema "${topicTitle}".

El estudiante tiene dificultades específicas con: ${focusConcepts.slice(0, 4).join(', ')}.
${previousMistakes.length > 0 ? `Errores anteriores: ${previousMistakes.slice(0,3).join('; ')}.` : ''}
Dominio actual: ${overallMastery}%.

MATERIAL DE REFERENCIA:
${materialSlice.slice(0, 4000)}

Genera una explicación correctiva que:
1. Identifique por qué se comete el error frecuente
2. Explique el concepto correcto con un ejemplo concreto del material
3. Dé una regla o truco para recordarlo
4. Proponga una pregunta de verificación al final

Máximo 200 palabras. Sé directo y pedagógico.`

    const explanation = await alaiRequest(async (client: any, model: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 600,
      })
      return res.choices?.[0]?.message?.content || ''
    })

    console.log(`[Adaptive Repair] "${topicTitle}" → ${(explanation as string).length} chars`)
    return NextResponse.json({
      success: true,
      analysis: explanation,
      content: explanation,
      explanation,
      topicTitle,
      focusConcepts,
    })

  } catch (err: any) {
    console.error('[Adaptive Repair]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
