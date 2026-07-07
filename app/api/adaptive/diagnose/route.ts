import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest, safeParseJson } from '../../../../lib/alai'
import type { DiagnosticResult, SubjectArea } from '../../../../lib/adaptive/types'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      materialText,
      materialTitle = 'el tema',
      coverageUnits = [],
      concepts = [],
      selfReportedLevel = 'some',
      subjectArea = 'general',
      targetGrade = '80',
    } = body

    if (!materialText || materialText.trim().length < 50) {
      return NextResponse.json({ success: false, error: 'Material insuficiente' }, { status: 400 })
    }

    // Si dice que no sabe nada, no hace falta diagnóstico — empezar desde cero
    if (selfReportedLevel === 'zero') {
      const result: DiagnosticResult = {
        questionsAsked: 0,
        conceptsEvaluated: [],
        layerResults: {
          recognition: { correct: 0, total: 0 },
          comprehension: { correct: 0, total: 0 },
          application: { correct: 0, total: 0 },
          transfer: { correct: 0, total: 0 },
        },
        falseConfidenceDetected: false,
        estimatedLevel: 'zero',
        conceptsKnown: [],
        conceptsUnknown: concepts.map((c: any) => c.name || c.id),
        conceptsPartial: [],
        recommendedStartingPoint: 'Empezar desde el principio absoluto',
      }
      return NextResponse.json({ success: true, result, skipDiagnosis: true })
    }

    // Construir preguntas de diagnóstico adaptadas al área y nivel reportado
    const subjectInstructions: Record<string, string> = {
      medical: 'Usa casos clínicos simples, síntomas, mecanismos. NO preguntes definiciones crudas.',
      math: 'Presenta un problema pequeño. Evalúa si puede resolverlo o reconocer el proceso.',
      legal: 'Presenta un supuesto simple. Evalúa si reconoce la norma aplicable.',
      history: 'Pregunta sobre causas, consecuencias o relaciones entre eventos. No fechas.',
      science: 'Pregunta sobre procesos, relaciones causa-efecto, aplicaciones.',
      general: 'Preguntas de comprensión directa sobre los conceptos del material.',
      language: 'Preguntas de identificación y aplicación de conceptos gramaticales o literarios.',
      mixed: 'Combina preguntas conceptuales y de aplicación.',
    }

    const conceptList = concepts.slice(0, 8).map((c: any) => c.name).join(', ')
    const unitList = coverageUnits.slice(0, 6).map((u: any) => u.title).join(', ')

    const prompt = `Eres un pedagogo creando un diagnóstico de conocimiento previo.

MATERIAL: "${materialTitle}"
ÁREA: ${subjectArea}
NIVEL REPORTADO: ${selfReportedLevel} (puede ser incorrecto — verifica)
OBJETIVO DEL ESTUDIANTE: ${targetGrade}

CONCEPTOS DEL MATERIAL: ${conceptList || unitList || 'los conceptos del material'}

INSTRUCCIONES ESPECÍFICAS PARA ESTA ÁREA:
${subjectInstructions[subjectArea] || subjectInstructions.general}

TEXTO DEL MATERIAL:
${materialText.slice(0, 5000)}

Genera 6-8 preguntas de diagnóstico adaptativo. Las preguntas deben:
1. Empezar con una pregunta de reconocimiento (fácil)
2. Subir gradualmente a comprensión
3. Incluir 1-2 de aplicación
4. Incluir 1 de transferencia (si el nivel reportado es alto)
5. Detectar falsa confianza: incluir 1 pregunta que parezca fácil pero requiera comprensión real

Para nivel "practice" o "review": empezar desde comprensión directamente.
Para nivel "some": mezclar reconocimiento y comprensión.

Devuelve SOLO este JSON:
{
  "questions": [
    {
      "id": "dq_1",
      "layer": "recognition|comprehension|application|transfer",
      "type": "multiple_choice|true_false|short_answer",
      "prompt": "pregunta clara",
      "options": ["A", "B", "C", "D"],
      "correctAnswer": 0,
      "explanation": "por qué esta es la respuesta",
      "difficulty": 30,
      "evidenceWeight": 0.4,
      "conceptNames": ["nombre del concepto evaluado"],
      "falseConfidenceTrap": false
    }
  ]
}`

    const result = await alaiRequest(async (client: any, modelFn: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 3000,
      })
      const rawText = res?.choices?.[0]?.message?.content || ''
      if (!rawText.trim()) throw new Error('ALAI_EMPTY_RESPONSE')
      return { text: rawText, provider: 'unknown', model: 'unknown' }
    })

    let parsed = safeParseJson(result.text)
    if (!parsed?.questions) {
      const match = result.text.match(/\{[\s\S]*\}/)
      if (match) parsed = safeParseJson(match[0])
    }

    if (!parsed?.questions || !Array.isArray(parsed.questions)) {
      return NextResponse.json({ success: false, error: 'No se pudo generar diagnóstico' }, { status: 500 })
    }

    const questions = parsed.questions.slice(0, 8).map((q: any, i: number) => ({
      id: q.id || `dq_${i + 1}`,
      layer: q.layer || 'recognition',
      type: q.type || 'multiple_choice',
      prompt: q.prompt || '',
      options: q.options || [],
      correctAnswer: q.correctAnswer ?? 0,
      explanation: q.explanation || '',
      difficulty: Number(q.difficulty) || 40,
      evidenceWeight: Number(q.evidenceWeight) || 0.5,
      conceptNames: q.conceptNames || [],
      falseConfidenceTrap: Boolean(q.falseConfidenceTrap),
    }))

    return NextResponse.json({ success: true, questions, skipDiagnosis: false })

  } catch (err: any) {
    console.error('[diagnose]', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
