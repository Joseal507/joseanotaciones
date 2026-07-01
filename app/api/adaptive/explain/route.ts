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
    const overallMastery: number = ctx.overallMastery ?? 0
    const userProfile = ctx.userProfile || body.userProfile || null
    const focusConcept: string = body.focusConcept || targetConcepts[0] || topicTitle
    const mode: string = body.mode || 'explain'
    const actType: string = body.actType || mode
    const knowledgeType: string = body.knowledgeType || 'conceptual'
    const learningGoal: string = body.learningGoal || 'explain_concept'
    const sessionNumber: number = body.sessionNumber || ctx.sessionNumber || 1
    const lastExplanation: string = body.lastExplanation || ''
    const alreadyExplained: string[] = body.alreadyExplained || []
    const failureType: string = body.failureType || 'none'

    if (!materialSlice || materialSlice.trim().length < 50) {
      return NextResponse.json({ success: false, error: 'Material insuficiente' }, { status: 400 })
    }

    const levelNote = overallMastery < 15
      ? 'NIVEL CERO: El estudiante NO SABE NADA de este tema. Define CADA término técnico la primera vez que aparece. Nunca asumas conocimiento previo.'
      : overallMastery < 40
      ? 'NIVEL BÁSICO: Define los términos técnicos importantes.'
      : overallMastery < 70
      ? 'NIVEL INTERMEDIO: Conecta con conceptos conocidos.'
      : 'NIVEL AVANZADO: Profundiza y matiza.'

    const sessionNote = sessionNumber === 1
      ? 'Primera sesión: empieza desde cero absoluto. No asumas NADA.'
      : `Sesión ${sessionNumber}: conecta con lo que ya vio.`

    const failureNote = failureType && failureType !== 'none'
      ? `TIPO DE FALLO DETECTADO: ${failureType}\nEl estudiante falló porque: ${({
          vocabulary: 'no conoce los términos clave',
          relation: 'no conecta los conceptos entre sí',
          application: 'entiende la teoría pero no puede aplicarla',
          memory: 'olvidó lo que leyó',
          formula: 'no puede usar la fórmula o mecanismo',
          procedure: 'no sigue el procedimiento correctamente',
          argument: 'no puede argumentar o defender la posición',
        } as Record<string, string>)[failureType] || 'razón desconocida'}\nAdapta tu explicación específicamente para atacar este tipo de fallo.`
      : ''

    const alreadyExplainedNote = alreadyExplained.length > 0
      ? `🚫 YA EXPLICASTE ESTO ANTES — PROHIBIDO REPETIR:
Conceptos ya cubiertos: ${alreadyExplained.join(', ')}.
${alreadyExplained.includes(focusConcept)
  ? `"${focusConcept}" YA SE EXPLICÓ. Da un ángulo COMPLETAMENTE DIFERENTE:
  - Si antes explicaste qué es → ahora explica por qué importa o un caso concreto
  - Si antes usaste una analogía → ahora usa un ejemplo del material
  - Si antes explicaste el mecanismo → ahora explica las consecuencias
  NO repitas las mismas oraciones ni el mismo enfoque.`
  : `No repitas información de los conceptos ya explicados. Sé conciso sobre ellos.`}`
      : ''

    const carreraNote = userProfile?.carrera
      ? `El estudiante estudia ${userProfile.carrera}.`
      : ''

    // Instrucción según actType — cada tipo de actividad produce una experiencia distinta
    const actTypeInstructions: Record<string, string> = {
      explain: `Explica "${focusConcept}" usando SOLO la información del material.`,
      context: `Da el contexto necesario para entender "${focusConcept}". ¿De dónde viene? ¿Qué problema existía antes? ¿Por qué surgió?`,
      analogy: `Usa una analogía poderosa para explicar "${focusConcept}". La analogía debe venir del mundo cotidiano y hacer que el concepto sea obvio.`,
      worked_example: `Muestra un ejemplo resuelto paso a paso de "${focusConcept}". El estudiante debe ver el proceso completo, no solo la respuesta.`,
      step_by_step: `Explica "${focusConcept}" como una secuencia de pasos numerados. Cada paso debe ser claro y accionable.`,
      guided_practice: `Guía al estudiante a través de un ejercicio de "${focusConcept}". Explica el razonamiento en cada decisión.`,
      repair: (() => {
        const failureInstructions: Record<string, string> = {
          vocabulary: `El estudiante no conoce los términos de "${focusConcept}". Define cada término técnico de forma simple antes de continuar.`,
          relation: `El estudiante sabe los conceptos de "${focusConcept}" por separado pero no los conecta. Usa una analogía que muestre cómo se relacionan.`,
          application: `El estudiante entiende "${focusConcept}" en teoría pero no puede aplicarlo. Muestra un ejemplo resuelto paso a paso del material.`,
          memory: `El estudiante olvidó "${focusConcept}". Reexplícalo desde otro ángulo con una imagen mental diferente.`,
          formula: `El estudiante no puede usar la fórmula/mecanismo de "${focusConcept}". Muestra el proceso con números concretos del material.`,
          procedure: `El estudiante no sigue el proceso de "${focusConcept}" correctamente. Numera cada paso y explica por qué ese orden.`,
          argument: `El estudiante no puede argumentar sobre "${focusConcept}". Presenta la posición, luego el contraargumento, luego la síntesis.`,
        }
        return failureInstructions[failureType] || `El estudiante NO entendió "${focusConcept}". Reexplícalo desde OTRO ángulo completamente diferente. Más simple.`
      })(),
    }

    // Ajuste por knowledgeType — el tono cambia según el tipo de material
    const knowledgeTypeNotes: Record<string, string> = {
      mathematical: 'Usa números concretos, fórmulas del material, y muestra el proceso de resolución.',
      narrative: 'Usa el contexto histórico/narrativo del material. Menciona los actores reales y los eventos clave.',
      procedural: 'Enfócate en el proceso paso a paso. ¿Qué se hace primero? ¿Qué sigue? ¿Por qué ese orden?',
      memoristic: 'Usa asociaciones y patrones para hacer memorable el contenido. Agrupa elementos relacionados.',
      causal: 'Explica la cadena causa-efecto. ¿Qué causó qué? ¿Qué pasaría si cambiara algún factor?',
      argumentative: 'Presenta los argumentos con sus fundamentos. ¿Por qué se sostiene esa posición?',
      visual: 'Describe la estructura visualmente con palabras. ¿Cómo se ve? ¿Qué está conectado con qué?',
      conceptual: 'Construye la intuición primero, luego la definición formal.',
    }

    // Ajuste por learningGoal — qué debe lograr el estudiante
    const learningGoalNotes: Record<string, string> = {
      build_intuition: 'El objetivo es que el estudiante "sienta" el concepto, no que lo memorice.',
      explain_concept: 'El objetivo es que pueda explicarlo con sus propias palabras.',
      solve_problem: 'El objetivo es que pueda resolver problemas usando esto.',
      compare_models: 'El objetivo es que entienda las diferencias y cuándo usar cada uno.',
      memorize_terms: 'El objetivo es recordar términos y definiciones con precisión.',
      apply_to_case: 'El objetivo es aplicar esto a situaciones reales.',
      argue_position: 'El objetivo es poder defender o refutar la posición.',
      analyze_cause_effect: 'El objetivo es trazar la cadena de causas y efectos.',
      follow_procedure: 'El objetivo es ejecutar el procedimiento correctamente.',
      identify_structure: 'El objetivo es reconocer y nombrar los componentes.',
    }

    const modePrompt = actTypeInstructions[actType] || actTypeInstructions[mode] || actTypeInstructions.explain
    const knowledgeNote = knowledgeTypeNotes[knowledgeType] || ''
    const goalNote = learningGoalNotes[learningGoal] || ''

    const prompt = `Eres un tutor experto. Tu tarea: ${modePrompt}

${failureNote ? failureNote + '\n\n' : ''}${alreadyExplainedNote ? alreadyExplainedNote + '\n' : ''}${levelNote}
${sessionNote}
${carreraNote}
${knowledgeNote ? `TIPO DE MATERIAL: ${knowledgeNote}` : ''}
${goalNote ? `OBJETIVO DE APRENDIZAJE: ${goalNote}` : ''}

CONCEPTO A ENSEÑAR: "${focusConcept}"

ESTRUCTURA SEGÚN EL TIPO DE ACTIVIDAD (${actType}):
${actType === 'context' ? `
1. ¿Qué existía ANTES de "${focusConcept}"? ¿Qué problema había?
2. ¿Cómo surgió "${focusConcept}"? ¿Quién, cuándo, por qué?
3. ¿Qué cambió cuando apareció?
4. Para recordar: [frase ancla]` :
actType === 'analogy' ? `
1. La analogía: "${focusConcept}" es como [algo cotidiano] porque [razón]
2. Cómo funciona la analogía: [detalle]
3. Dónde la analogía tiene límites (para no confundir)
4. Para recordar: [frase ancla]` :
actType === 'worked_example' ? `
1. El problema/caso: [ejemplo concreto del material]
2. Paso 1: [primer paso con razonamiento]
3. Paso 2: [segundo paso]
4. Resultado y por qué importa
5. Para recordar: [frase ancla]` :
actType === 'step_by_step' ? `
1. Paso 1: [acción + por qué]
2. Paso 2: [acción + por qué]
3. Paso 3: [acción + por qué]
4. Error común que hay que evitar
5. Para recordar: [frase ancla]` :
`
1. Empieza con algo concreto del material (dato, hecho, persona, evento) — NO con definición
2. QUÉ ES "${focusConcept}" — definición directa en 1-2 oraciones
3. CÓMO FUNCIONA — mecanismo o lógica
4. POR QUÉ IMPORTA — consecuencia práctica
5. Para recordar: [frase ancla]`}

MATERIAL (usa SOLO esto, no inventes):
${materialSlice.slice(0, 6000)}

${lastExplanation ? `
EXPLICACIÓN ANTERIOR (NO REPETIR — da una perspectiva DIFERENTE):
${lastExplanation.slice(0, 500)}
` : ''}

REGLAS ABSOLUTAS:
- PROHIBIDO empezar con "Imagina", "Piensa en", "Supón", "Es importante", "En este tema"
- Máximo 200 palabras
- Sin asteriscos ni markdown — texto plano
- Usa datos reales del material: nombres, fechas, números, casos específicos
- Cada oración debe enseñar algo NUEVO — nunca repetir lo que ya se explicó
- Si ya se explicó este concepto antes, dar un ángulo diferente: otra analogía, otro ejemplo, otra consecuencia

Devuelve SOLO JSON:
{
  "content": "La explicación completa en texto plano sin markdown",
  "keyIdea": "La frase ancla (solo la frase, sin el prefijo Para recordar:)",
  "conceptCovered": "${focusConcept}",
  "recallPrompt": "Pregunta específica que verifique comprensión real — no trivia, sino entendimiento"
}`

    const rawText = await alaiRequest(async (client: any, model: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: model('llama-3.3-70b-versatile'),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 1200,
      })
      return res.choices?.[0]?.message?.content || ''
    })

    let parsed: any = null
    try { parsed = JSON.parse(String(rawText).trim()) } catch {}
    if (!parsed) {
      const match = String(rawText).match(/\{[\s\S]*\}/)
      if (match) try { parsed = JSON.parse(match[0]) } catch {}
    }

    let content = parsed?.content || String(rawText).trim()
    // Limpiar markdown residual
    content = content.replace(/\*\*/g, '').replace(/\*/g, '').replace(/#{1,6}\s/g, '')
    if (content.length > 0) content = content.charAt(0).toUpperCase() + content.slice(1)

    return NextResponse.json({
      success: true,
      content,
      keyIdea: (parsed?.keyIdea || '').replace(/\*\*/g, '').replace(/\*/g, ''),
      recallPrompt: parsed?.recallPrompt || '',
      conceptCovered: parsed?.conceptCovered || focusConcept,
    })

  } catch (err: any) {
    console.error('[Adaptive Explain]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
