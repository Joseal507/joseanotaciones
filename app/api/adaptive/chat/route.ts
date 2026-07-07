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
    const lastExplanation: string = body.lastExplanation || ''
    const chatHistory: Array<{role: string; text: string}> = body.chatHistory || []
    const knowledgeType: string = body.knowledgeType || 'conceptual'
    const learningGoal: string = body.learningGoal || 'explain_concept'
    const evaluateOnly: boolean = body.evaluateOnly === true
    const evaluateWithFeedback: boolean = body.evaluateWithFeedback === true

    if (!message.trim()) {
      return NextResponse.json({ success: false, error: 'Sin mensaje' }, { status: 400 })
    }

    // ─── FEEDBACK PEDAGÓGICO COMPLETO ────────────────────────
    if (evaluateWithFeedback) {
      const concept = body.concept || targetConcepts[0] || topicTitle
      const stepType = body.stepType || 'recall'
      // El recallPrompt viene del explain — pregunta exacta que se usó
      const recallPrompt = body.recallPrompt || ''

      // Pre-validar respuestas vacías o sin contenido
      const msgLower = message.toLowerCase().trim()
      const isEmptyResponse = msgLower.length < 10 ||
        ['no sé', 'no se', 'no sé nada', 'no se nada', 'nada', 'no sé esto', 'no entiendo'].some(p => msgLower === p || msgLower.startsWith(p))

      if (isEmptyResponse) {
        return NextResponse.json({
          success: true,
          score: Math.floor(Math.random() * 8) + 3, // 3-10
          failureType: 'memory',
          correctThings: 'No hay elementos correctos que destacar en esta respuesta.',
          wrongOrMissing: 'La respuesta no contiene información suficiente. Es necesario explicar al menos la idea central.',
          keyExplanation: '',
          answerToDubts: '',
          keyIdea: '',
          message: '',
        })
      }

      // Calibrar expectativas según nivel del estudiante
      const masteryLevel = overallMastery < 20 ? 'NIVEL CERO (primera vez viendo esto)' :
        overallMastery < 40 ? 'NIVEL BÁSICO (conocimiento inicial)' :
        overallMastery < 60 ? 'NIVEL INTERMEDIO (en desarrollo)' :
        overallMastery < 80 ? 'NIVEL AVANZADO (buen dominio)' : 'NIVEL EXPERTO'

      const feedbackPrompt = `Eres un profesor evaluando la respuesta de un estudiante. Sé generoso y honesto.

REGLAS DE EVALUACIÓN:
- Si la respuesta menciona los puntos clave aunque sea de forma simple → score 70-85
- Solo dar score < 50 si la respuesta está completamente equivocada o vacía
- Si mencionó los elementos principales pero le faltó detalle → score 60-75
- Si la respuesta es buena → score 75-90
- El score debe reflejar COMPRENSIÓN, no perfección de redacción

TEMA: "${topicTitle}"
CONCEPTO EVALUADO: "${concept}"
NIVEL DEL ESTUDIANTE: ${masteryLevel} (dominio actual: ${overallMastery}/100)
${recallPrompt ? `PREGUNTA QUE SE LE HIZO: "${recallPrompt}"` : ''}
TIPO DE ACTIVIDAD: ${stepType}

CALIBRACIÓN SEGÚN NIVEL:
- NIVEL CERO: si explica la idea central con sus palabras = mínimo 60 puntos. No exijas conexiones entre conceptos.
- NIVEL BÁSICO: si explica + da un ejemplo = mínimo 65 puntos.
- NIVEL INTERMEDIO: si conecta 2 ideas = mínimo 70 puntos.
- NIVEL AVANZADO/EXPERTO: exige conexiones, aplicaciones y matices.

MATERIAL DE REFERENCIA:
${materialSlice.slice(0, 4000)}

RESPUESTA DEL ESTUDIANTE:
"${message}"

EVALÚA con estos criterios:

PUNTAJE (0-100):
- 0-30: No captó la idea central
- 31-50: Captó algo pero con errores importantes  
- 51-70: Entiende la idea general pero le faltan detalles clave
- 71-85: Buena comprensión, faltan algunos matices
- 86-100: Domina el concepto completamente

TU RESPUESTA debe:
1. Citar literalmente lo que dijo bien (con sus propias palabras)
2. Señalar específicamente qué faltó o estuvo mal (no genérico)
3. Dar la explicación correcta completa (para que aprenda, no solo que sepa su score)
4. Si expresó dudas ("¿por qué...?", "no entiendo..."), RESPÓNDELAS
5. Terminar con una frase memorable para recordar

TONO: varía según la calidad. Sé honesto y directo.

DETECTA EL TIPO DE FALLO (crítico para adaptar la siguiente explicación):
- "vocabulary": no conoce los términos clave
- "relation": sabe los conceptos por separado pero no los conecta
- "application": entiende la teoría pero no sabe aplicarla
- "memory": olvidó información que leyó recientemente
- "formula": no sabe usar o interpretar la fórmula/mecanismo
- "procedure": no sigue el proceso en el orden correcto
- "argument": no puede defender o refutar la posición
- "none": no hay fallo — dominó el concepto

EVALÚA con estas 5 dimensiones y suma los puntos:

1. COBERTURA (0-30): ¿Mencionó las ideas principales del concepto?
   30=todo | 20=la mayoría | 10=algo | 0=nada relevante

2. PRECISIÓN (0-20): ¿Dijo algo incorrecto?
   20=sin errores | 10=error menor | 0=error grave

3. PROFUNDIDAD (0-20): ¿Conectó ideas o solo repitió?
   20=conectó y razonó más allá | 10=explicó con sus palabras | 0=copió frases

4. TRANSFERENCIA (0-15): ¿Usó sus propias palabras y ejemplos?
   15=totalmente propio | 8=mezcla | 0=copia directa

5. CLARIDAD (0-15): ¿Se entiende la respuesta?
   15=muy clara | 8=entendible | 0=confusa

SUMA LAS 5 = score real (0-100). NO uses siempre el mismo número.

Ejemplos reales:
- Respuesta mínima ("fue importante") → score ~15-20
- Respuesta que menciona 1-2 ideas clave sin conectar → score ~40-55
- Respuesta que explica el mecanismo con sus palabras → score ~65-75
- Respuesta que conecta ideas, menciona causa y consecuencia → score ~78-88
- Respuesta que explica, aplica y conecta con otros conceptos → score ~90-97

IMPORTANTE: 
- Si la respuesta menciona el problema que resuelve el concepto + el mecanismo + una consecuencia = mínimo 80 puntos.
- Si la respuesta usa sus propias palabras correctamente y cubre la idea central = mínimo 65 puntos.
- Si solo menciona la idea central sin explicar = máximo 45 puntos.
- "No sé nada" o respuesta vacía = máximo 10 puntos.
- NUNCA dar 0 si el estudiante escribió algo relevante aunque sea parcial.

TONO del feedback según score:
- 90+: empieza con "Exacto." o "Perfecto."
- 75-89: empieza con "Lo tienes." o "Muy bien."
- 55-74: empieza con "Casi." o "Bien encaminado."
- 35-54: empieza con "Parcial." o "Hay algo pero falta lo esencial."
- 0-34: empieza con "Todavía no." o "La idea central no apareció."

Devuelve SOLO JSON:
{
  "score": <número real 0-100 calculado sumando las 5 dimensiones>,
  "failureType": "vocabulary|relation|application|memory|formula|procedure|argument|none",
  "correctThings": "Citando sus palabras exactas: dijo '[frase literal del estudiante]', lo cual es correcto porque [razón específica del material]",
  "wrongOrMissing": "Lo que faltó: [concepto específico]. Lo correcto es [explicación directa]. Esto importa porque [razón]",
  "keyExplanation": "Explicación completa en 2-4 oraciones directas. Sin repetir lo que ya dijo bien.",
  "answerToDubts": "Si expresó una duda, respóndela directamente. Si no hay duda, string vacío.",
  "keyIdea": "Una sola frase memorable. Que pueda repetirla mañana sin mirar nada."
}`

      const rawText = await alaiRequest(async (client: any, model: (m?: string) => string) => {
        const res = await client.chat.completions.create({
          model: model('llama-3.3-70b-versatile'),
          messages: [{ role: 'user', content: feedbackPrompt }],
          temperature: 0.5,
          max_tokens: 1000,
        })
        return res.choices?.[0]?.message?.content || ''
      })

      let parsed: any = null
      try { parsed = JSON.parse(String(rawText).trim()) } catch {}
      if (!parsed) {
        const match = String(rawText).match(/\{[\s\S]*\}/)
        if (match) try { parsed = JSON.parse(match[0]) } catch {}
      }

      if (!parsed) {
        return NextResponse.json({
          success: true, score: 50, correctThings: '', wrongOrMissing: '',
          keyExplanation: String(rawText).slice(0, 500), answerToDubts: '', keyIdea: '',
        })
      }

      // Score real — nunca hardcodeado, siempre del JSON
      const rawScore = parsed.score
      const score = Math.min(100, Math.max(0, typeof rawScore === 'number' ? rawScore : Number(rawScore) || 50))
      const clean = (s: any) => String(s || '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/#{1,6}\s/g, '')
      const failureType = parsed.failureType || 'none'
      console.log(`[Chat Evaluator] score: ${score} | failure: ${failureType}`)
      return NextResponse.json({
        success: true,
        score,
        failureType,
        correctThings: clean(parsed.correctThings),
        wrongOrMissing: clean(parsed.wrongOrMissing),
        keyExplanation: clean(parsed.keyExplanation),
        answerToDubts: clean(parsed.answerToDubts),
        keyIdea: clean(parsed.keyIdea),
        message: clean(parsed.keyExplanation),
      })
    }

    // ─── SCORE NUMÉRICO (legacy) ──────────────────────────────
    if (evaluateOnly) {
      const evalPrompt = `Evalúa comprensión de "${topicTitle}". Conceptos: ${targetConcepts.slice(0,4).join(', ') || topicTitle}. Respuesta: "${message}". Material: ${materialSlice.slice(0,2000)}. Responde SOLO un número 0-100.`
      const score = await alaiRequest(async (client: any, model: (m?: string) => string) => {
        const res = await client.chat.completions.create({
          model: model('llama-3.3-70b-versatile'),
          messages: [{ role: 'user', content: evalPrompt }],
          temperature: 0.1, max_tokens: 10,
        })
        return res.choices?.[0]?.message?.content || '50'
      })
      const num = parseInt(String(score).match(/\d+/)?.[0] || '50')
      const finalScore = isNaN(num) ? 50 : Math.min(100, Math.max(0, num))
      return NextResponse.json({ success: true, message: String(finalScore), score: finalScore })
    }

    // ─── CHAT PEDAGÓGICO ──────────────────────────────────────
    const systemPrompt = [
      'Eres ALAI, tutor personal de StudyAL. Acabas de enseñar este tema.',
      '',
      'TEMA: "' + topicTitle + '"',
      'CONCEPTO: ' + (targetConcepts.slice(0,3).join(', ') || topicTitle),
      'DOMINIO DEL ESTUDIANTE: ' + overallMastery + '%',
      '',
      lastExplanation
        ? 'LO QUE ACABAS DE EXPLICAR (mantén coherencia con esto):\n' + lastExplanation.slice(0, 1200)
        : 'MATERIAL:\n' + materialSlice.slice(0, 1200),
      chatHistory.length > 0
        ? '\nCONVERSACIÓN PREVIA:\n' + chatHistory.map((m: any) =>
            (m.role === 'user' ? 'Estudiante: ' : 'ALAI: ') + m.text
          ).join('\n')
        : '',
      '',
      'REGLAS:',
      '- Mismo tono y vocabulario que usaste en la explicación anterior',
      '- Si pide más simple: usa analogía DIFERENTE a la que ya usaste',
      '- Si no entendió: cambia el ángulo, no repitas lo mismo',
      '- Máximo 120 palabras, texto plano, sin asteriscos',
      '- Responde en el idioma del estudiante',
    ].filter(Boolean).join('\n')

    const response = await alaiRequest(async (client: any, model: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
        temperature: 0.35, max_tokens: 400,
      })
      return res.choices?.[0]?.message?.content || ''
    })

    return NextResponse.json({ success: true, message: response, content: response })

  } catch (err: any) {
    console.error('[Adaptive Chat]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
