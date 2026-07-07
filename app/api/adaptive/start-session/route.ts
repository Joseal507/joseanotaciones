import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest, safeParseJson } from '../../../../lib/alai'

export const maxDuration = 45

// ── Arranca la sesión y genera el primer microconcepto ────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      session,
      materialText,
      materialTitle,
      subjectArea = 'general',
      coverageUnits = [],
      studentLevel = 'some',
      sessionLength = 'medium',
    } = body

    // Ordenar unidades por importancia, pero respetar sessionNumber para variar
    const sessionNum = session?.sessionNumber || 1
    const orderedUnits = [...coverageUnits].sort((a: any, b: any) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 }
      return (order[a.importance as keyof typeof order] || 2) -
             (order[b.importance as keyof typeof order] || 2)
    })

    // Cada sesión empieza en un punto diferente del material
    // Sesión 1: empieza en unidad 0
    // Sesión 2: empieza en unidad 1 o 2
    // Sesión 3+: rotación
    const startOffset = Math.min(sessionNum - 1, Math.floor(orderedUnits.length / 2))
    const firstUnit = orderedUnits[startOffset] || orderedUnits[0]
    if (!firstUnit) {
      return NextResponse.json({ success: false, error: 'Sin unidades de cobertura' }, { status: 400 })
    }

    // Generar objetivos de sesión
    const allObjectives = orderedUnits
      .flatMap((u: any) => u.learningObjectives || [`Aprender sobre ${u.title}`])
      .slice(0, 6)

    // Generar primera interacción — siempre explicación del primer microconcepto
    const unitText = firstUnit.rawTextReference || materialText?.slice(0, 2000) || ''
    const keyFacts = (firstUnit.keyFacts || []).join(', ')

    const prompt = `Eres un tutor. Genera la PRIMERA explicación de esta sesión de estudio.

PRIMER CONCEPTO: "${firstUnit.title}"
ÁREA: ${subjectArea}
NIVEL DEL ESTUDIANTE: ${studentLevel}

TEXTO DEL MATERIAL (cita información real de aquí):
"${unitText}"

HECHOS CLAVE A MENCIONAR: ${keyFacts}

REGLAS:
- Máximo 4 oraciones — microconcepto, no un ensayo
- Usa términos del material con definición cuando sean técnicos
- Cita hechos específicos del texto (nombres, fechas, eventos)
- Termina con "Para recordar: [frase ancla de máximo 8 palabras]"
- Si el nivel es "zero" o "some": empezar desde cero, sin asumir conocimiento previo

Devuelve SOLO este JSON:
{
  "type": "explain",
  "content": "explicación de máximo 4 oraciones usando el material real",
  "keyIdea": "frase ancla de máximo 8 palabras",
  "recallPrompt": "pregunta corta de verificación"
}`

    const res = await alaiRequest(async (client: any, modelFn: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [
        { role: 'system', content: 'Generas explicaciones pedagógicas cortas basadas en el material real. Solo JSON.' },
        { role: 'user', content: prompt },
      ],
        temperature: 0.3,
        max_tokens: 600,
      })
      const rawText = res?.choices?.[0]?.message?.content || ''
      if (!rawText.trim()) throw new Error('ALAI_EMPTY_RESPONSE')
      return { text: rawText, provider: 'unknown', model: 'unknown' }
    })

    let firstInteraction = safeParseJson(res.text)
    if (!firstInteraction?.content) {
      firstInteraction = {
        type: 'explain',
        content: `Vamos a aprender sobre "${firstUnit.title}". ${unitText.slice(0, 200)}`,
        keyIdea: firstUnit.title,
        recallPrompt: `¿Qué es "${firstUnit.title}"?`,
      }
    }

    // Enriquecer
    firstInteraction = {
      ...firstInteraction,
      id: `int_start_${Date.now()}`,
      format: 'explain',
      objective: 'recognition',
      concept: firstUnit.title,
      knowledgeType: firstUnit.knowledgeType || 'conceptual',
      unit: firstUnit,
      isTeaching: true,
      isFinalRecall: false,
    }

    // Estado inicial de la sesión
    const sessionState = {
      sessionId: session?.id || `sess_${Date.now()}`,
      startedAt: Date.now(),
      coveredUnits: [],
      remainingUnits: orderedUnits,
      evidenceHistory: [],
      recentFormats: ['explain'],
      consecutiveFailures: 0,
      totalInteractions: 0,
      scores: [],
      conceptsImproved: [],
    }

    return NextResponse.json({
      success: true,
      firstInteraction,
      sessionState,
      sessionObjectives: allObjectives,
      totalUnits: orderedUnits.length,
    })

  } catch (err: any) {
    console.error('[start-session]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
