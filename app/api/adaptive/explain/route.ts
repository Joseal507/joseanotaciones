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
    const weakConcepts: string[] = ctx.weakConcepts || body.weakConcepts || []
    const overallMastery: number = ctx.overallMastery ?? 0
    const userProfile = ctx.userProfile || body.userProfile || null
    const mode: string = body.mode || 'explain'

    const carreraNote = userProfile?.carrera
      ? `\nEl estudiante estudia ${userProfile.carrera}. Conecta con su campo si aplica naturalmente.`
      : ''

    const conceptsList = targetConcepts.length > 0
      ? `Conceptos a cubrir: ${targetConcepts.join(', ')}.`
      : ''

    const weakNote = weakConcepts.length > 0
      ? `Conceptos débiles del estudiante: ${weakConcepts.join(', ')}. Explica estos con más cuidado.`
      : ''

    const masteryNote = overallMastery < 20
      ? 'El estudiante NO SABE NADA de este tema. Empieza desde cero absoluto. NO asumas conocimiento previo.'
      : overallMastery < 50
      ? 'El estudiante tiene conocimiento básico. Define términos cuando aparezcan.'
      : 'El estudiante tiene algo de base. Puedes profundizar.'

    const prompt = `Eres un profesor excelente. Tu trabajo: explicar "${topicTitle}" usando SOLO el material proporcionado.

${masteryNote}
${conceptsList}
${weakNote}
${carreraNote}

MATERIAL DE REFERENCIA:
${materialSlice.slice(0, 6000)}

REGLAS:
- Explica SOLO lo que está en el material. No inventes.
- Empieza con algo que despierte curiosidad, no con una definición.
- Define términos técnicos cuando aparezcan.
- Usa ejemplos concretos del material.
- Si el estudiante no sabe nada, NO uses "como probablemente recuerdas" ni "como ya sabes".
- Máximo 300 palabras. Calidad sobre cantidad.
- No uses markdown excesivo.

Devuelve SOLO JSON válido:
{
  "content": "La explicación completa, clara, conversacional y basada en el material",
  "keyIdea": "La idea más importante en 1 frase"
}`

    const rawText = await alaiRequest(async (client: any, model: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: model(),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 1500,
      })
      return res.choices?.[0]?.message?.content || ''
    })

    let parsed: any = null
    try { parsed = JSON.parse(String(rawText).trim()) } catch {}
    if (!parsed) {
      const match = String(rawText).match(/\{[\s\S]*\}/)
      if (match) try { parsed = JSON.parse(match[0]) } catch {}
    }

    const content = parsed?.content || String(rawText).trim()
    const keyIdea = parsed?.keyIdea || ''

    console.log(`[Adaptive Explain] "${topicTitle}" → ${content.length} chars`)

    return NextResponse.json({
      success: true,
      content,
      analysis: content,
      explanation: content,
      keyIdea,
      topicTitle,
    })

  } catch (err: any) {
    console.error('[Adaptive Explain]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
