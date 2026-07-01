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
    const count: number = Math.min(Number(body.count) || 5, 6)

    if (!materialSlice.trim() && targetConcepts.length === 0) {
      return NextResponse.json({ success: false, error: 'Sin contexto' }, { status: 400 })
    }

    const isLevelZero = overallMastery < 15

    const levelNote = isLevelZero
      ? `NIVEL CERO: El estudiante NO sabe nada. Las flashcards deben:
- Frente: pregunta MUY simple y directa ("¿Qué es X?", "¿Para qué sirve X?")
- Reverso: respuesta corta y clara (2-3 oraciones máximo). Sin tecnicismos sin definir.`
      : overallMastery < 50
      ? `NIVEL BÁSICO: Preguntas directas de comprensión. Respuestas claras con un ejemplo.`
      : `NIVEL INTERMEDIO: Preguntas de aplicación y conexión entre conceptos.`

    const conceptList = targetConcepts.slice(0, 6).join(', ')

    const prompt = `Eres un tutor creando flashcards de estudio sobre "${topicTitle}".

${levelNote}

CONCEPTOS A CUBRIR: ${conceptList || topicTitle}

MATERIAL (usa SOLO esto):
${materialSlice.slice(0, 5000)}

GENERA ${count} FLASHCARDS con estas reglas:

FRENTE (pregunta):
- Preguntas que obligan a CONECTAR ideas, no solo recordar definiciones
- PROHIBIDO: "¿Qué es X?" — eso es trivia
- Ejemplos BUENOS:
  "¿Por qué los Falcons siguen teniendo seguidores sin muchos títulos?"
  "¿Qué tienen en común Michael Vick y Matt Ryan según el material?"
  "Si desaparecieran todos los trofeos, ¿seguirían siendo grandes los Falcons? ¿Por qué?"
  "¿Cómo se relaciona el legado con la conexión emocional?"
- Cada pregunta debe requerir conectar al menos 2 ideas del material
- En nivel cero: la pregunta puede ser más guiada pero nunca pedir solo definición

REVERSO (respuesta):
- 2-4 oraciones que INTEGRAN ideas del material
- No solo "X es Y" sino "X importa porque Y, como se ve en Z del material"
- Sin markdown, sin asteriscos, texto plano
- Incluir un dato concreto del material (nombre, fecha, evento)

DISTRIBUCIÓN: 
- NO una flashcard por concepto aislado
- SÍ flashcards que conecten conceptos entre sí
- Mezclar: 2 flashcards de conexión + 2 de concepto individual + 2 de aplicación

Devuelve SOLO JSON:
{
  "cards": [
    {
      "front": "¿Pregunta simple y directa?",
      "back": "Respuesta clara en 2-3 oraciones. Sin tecnicismos sin explicar.",
      "concept": "nombre del concepto"
    }
  ]
}`

    const rawText = await alaiRequest(async (client: any, model: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1500,
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
        front: String(c.front).trim().replace(/\*\*/g, '').replace(/\*/g, ''),
        back: String(c.back).trim().replace(/\*\*/g, '').replace(/\*/g, ''),
        concept: c.concept || targetConcepts[0] || topicTitle,
      }))

    return NextResponse.json({ success: true, cards, flashcards: cards, topicTitle, count: cards.length })

  } catch (err: any) {
    console.error('[Adaptive Cards]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
