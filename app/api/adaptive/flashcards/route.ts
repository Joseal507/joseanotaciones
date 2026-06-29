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
    const difficulty: number = ctx.difficulty ?? body.difficulty ?? 50
    const count: number = Math.min(Number(body.count) || 5, 10)
    const weakConcepts: string[] = ctx.weakConcepts || body.weakConcepts || []

    if (!materialSlice.trim() && targetConcepts.length === 0) {
      return NextResponse.json({ success: false, error: 'Sin contexto' }, { status: 400 })
    }

    const cFocus = targetConcepts.length > 0
      ? `Conceptos OBLIGATORIOS: ${targetConcepts.slice(0, 6).join(', ')}.`
      : ''
    const wFocus = weakConcepts.length > 0
      ? `Prioriza débiles: ${weakConcepts.slice(0, 3).join(', ')}.`
      : ''

    const prompt = `Eres un generador de flashcards para el tema "${topicTitle}".
REGLAS: Genera EXACTAMENTE ${count} flashcards TODAS sobre "${topicTitle}".
${cFocus} ${wFocus}
Frente (front): pregunta o concepto corto.
Reverso (back): respuesta clara y completa.
Dificultad: ${difficulty}/100. Basa todo en el material.

MATERIAL:
${materialSlice.slice(0, 4000)}

Devuelve SOLO JSON:
{"cards":[{"front":"¿Qué es...?","back":"Es...","concept":"nombre concepto"}]}`

    const rawText = await alaiRequest(async (client: any, model: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: model(),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.35,
        max_tokens: 1200,
      })
      return res.choices?.[0]?.message?.content || ''
    })

    let parsed: any = null
    try { parsed = JSON.parse((rawText as string).trim()) } catch {}
    if (!parsed) {
      const m = (rawText as string).match(/\{[\s\S]*\}/)
      if (m) try { parsed = JSON.parse(m[0]) } catch {}
    }

    const cards = (parsed?.cards || [])
      .filter((c: any) => c.front && c.back)
      .slice(0, count)
      .map((c: any, i: number) => ({
        id: `ac_${i}_${Date.now()}`,
        front: c.front,
        back: c.back,
        concept: c.concept || targetConcepts[0] || topicTitle,
      }))

    console.log(`[Adaptive Cards] "${topicTitle}" → ${cards.length}/${count} cards`)
    return NextResponse.json({ success: true, cards, flashcards: cards, topicTitle, count: cards.length })

  } catch (err: any) {
    console.error('[Adaptive Cards]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
