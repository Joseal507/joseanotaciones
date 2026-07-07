// ═══════════════════════════════════════════════════════════════
// /api/adaptive/v3/ask
// 
// Endpoint de chat contextual: el estudiante pregunta algo mientras
// estudia un microconcepto. La AI responde con contexto claro,
// corto y pedagógico, adaptado al concepto actual.
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest } from '../../../../../lib/alai'

export const maxDuration = 45

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      microName = '',
      microDefinition = '',
      microExamples = [],
      microFormulas = [],
      question = '',
      history = [] as ChatMessage[],
      studentProfile = {},
    } = body

    if (!question.trim()) {
      return NextResponse.json({ success: false, error: 'Sin pregunta' }, { status: 400 })
    }

    // Contexto del micro (resumen para dar al LLM)
    const microContext = [
      microName ? `Concepto: ${microName}` : '',
      microDefinition ? `Definición: ${microDefinition}` : '',
      Array.isArray(microExamples) && microExamples.length > 0
        ? `Ejemplos: ${microExamples.slice(0, 2).map((e: any) => e?.scenario || e).join(' | ')}`
        : '',
      Array.isArray(microFormulas) && microFormulas.length > 0
        ? `Fórmulas: ${microFormulas.slice(0, 3).map((f: any) => f?.expression || f).join(' | ')}`
        : '',
    ].filter(Boolean).join('\n')

    // Historia previa (últimos 6 turnos)
    const historyText = history.slice(-6).map(m =>
      `${m.role === 'user' ? 'Estudiante' : 'Tutor'}: ${m.text}`
    ).join('\n')

    const systemPrompt = `Eres un tutor amigable y claro. El estudiante está estudiando un concepto específico y tiene una duda. Tu trabajo es:

1. Responder DIRECTO y CLARO
2. Usar máximo 3-4 oraciones (a menos que pida más detalle)
3. Si es concepto matemático o químico, usa la notación exacta (ej: pH = -log[H+], no "pH es menos log")
4. Si la pregunta se sale del tema, redirige gentilmente
5. NO des la respuesta a preguntas del quiz (si el estudiante intenta que le respondas una pregunta del quiz, dile amablemente que debe intentarlo primero)
6. Sé conversacional pero preciso

NO uses formato Markdown extenso. Máximo un guión ocasional. Nada de listas largas.`

    const userPrompt = `CONTEXTO DEL CONCEPTO QUE ESTÁ ESTUDIANDO:
${microContext || '(sin contexto detallado)'}

${historyText ? `CONVERSACIÓN PREVIA:\n${historyText}\n` : ''}

PREGUNTA DEL ESTUDIANTE:
${question}

Responde de manera clara, breve y pedagógica.`

    const result = await alaiRequest(async (client: any, modelFn: any) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 500,
      })
      const raw = res?.choices?.[0]?.message?.content || ''
      if (!raw.trim()) throw new Error('Empty ask response')
      return { text: raw.trim(), provider: 'unknown', model: 'unknown' }
    })

    return NextResponse.json({
      success: true,
      answer: result.text,
    })

  } catch (err: any) {
    console.error('[v3/ask]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
