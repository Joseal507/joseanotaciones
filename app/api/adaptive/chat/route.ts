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
    const overallMastery: number = ctx.overallMastery ?? 0
    const weakConcepts: string[] = ctx.weakConcepts || body.weakConcepts || []
    const message: string = body.message || ''
    const context: string = body.context || ''
    const evaluateOnly: boolean = body.evaluateOnly === true

    if (!message.trim()) {
      return NextResponse.json({ success: false, error: 'Sin mensaje' }, { status: 400 })
    }

    // Modo evaluación: devolver solo score numérico
    if (evaluateOnly || context.includes('Responde SOLO con un número')) {
      const evalPrompt = `Evalúa si esta respuesta del estudiante demuestra comprensión de "${topicTitle}".
Conceptos evaluados: ${targetConcepts.slice(0, 4).join(', ') || topicTitle}.
Respuesta del estudiante: "${message}"
Material de referencia: ${materialSlice.slice(0, 2000)}
Responde SOLO con un número del 0 al 100. Sin texto adicional.`

      const score = await alaiRequest(async (client: any, model: (m?: string) => string) => {
        const res = await client.chat.completions.create({
          model: model(),
          messages: [{ role: 'user', content: evalPrompt }],
          temperature: 0.1,
          max_tokens: 10,
        })
        return res.choices?.[0]?.message?.content || '50'
      })

      const num = parseInt(String(score).match(/\d+/)?.[0] || '50')
      const finalScore = isNaN(num) ? 50 : Math.min(100, Math.max(0, num))
      return NextResponse.json({ success: true, message: String(finalScore), score: finalScore })
    }

    // Modo chat: respuesta pedagógica
    const systemPrompt = `Eres ALAI, tutor adaptativo de StudyAL.
Tema actual: "${topicTitle}".
Dominio del estudiante: ${overallMastery}%.
Conceptos objetivo: ${targetConcepts.slice(0, 5).join(', ') || 'los del tema'}.
${weakConcepts.length > 0 ? `Puntos débiles: ${weakConcepts.slice(0,3).join(', ')}.` : ''}
Responde siempre en el idioma del estudiante.
Sé conciso (máx 150 palabras), pedagógico y directo.
Basa tus respuestas en el material proporcionado.`

    const response = await alaiRequest(async (client: any, model: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: model(),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        temperature: 0.35,
        max_tokens: 400,
      })
      return res.choices?.[0]?.message?.content || ''
    })

    console.log(`[Adaptive Chat] "${topicTitle}" → ${(response as string).length} chars`)
    return NextResponse.json({ success: true, message: response, content: response })

  } catch (err: any) {
    console.error('[Adaptive Chat]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
