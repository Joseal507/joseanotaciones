import { NextRequest, NextResponse } from 'next/server'
import { alaiRequest, safeParseJson } from '../../../../lib/alai'
import type {
  MaterialAnalysis,
  SubjectArea,
  CoverageUnit,
  ConceptNode,
} from '../../../../lib/adaptive/types'

export const maxDuration = 60

function detectSubjectArea(text: string, title: string): SubjectArea {
  const combined = (text + ' ' + title).toLowerCase()
  const patterns: Record<string, string[]> = {
    medical: ['diagnos', 'paciente', 'síntoma', 'patolog', 'fisiolog', 'anatom', 'médic', 'clínic', 'enferm', 'tratamiento', 'farmac', 'disease', 'patient', 'symptom'],
    math: ['ecuación', 'derivada', 'integral', 'función', 'álgebra', 'cálculo', 'theorem', 'equation', 'matrix', 'vector', 'límite', 'probabilidad'],
    legal: ['artículo', 'ley', 'código', 'derecho', 'jurídic', 'norma', 'constitución', 'contrato', 'tribunal', 'legal', 'statute', 'court'],
    history: ['guerra', 'revolución', 'siglo', 'imperio', 'coloni', 'independencia', 'historia', 'historical', 'century', 'war', 'revolution'],
    science: ['átomo', 'molécula', 'reacción', 'energía', 'física', 'química', 'biología', 'experiment', 'hypothesis', 'molecule', 'reaction', 'cell'],
    language: ['gramática', 'sintaxis', 'morfología', 'fonética', 'literatura', 'grammar', 'syntax', 'linguistics'],
  }
  const scores: Record<string, number> = {}
  for (const [area, keywords] of Object.entries(patterns)) {
    scores[area] = keywords.filter(k => combined.includes(k)).length
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
  if (sorted[0][1] === 0) return 'general'
  if (sorted.length > 1 && sorted[0][1] > 0 && sorted[1][1] > 0 && sorted[0][1] - sorted[1][1] < 3) return 'mixed'
  return sorted[0][0] as SubjectArea
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { materialText, materialTitle = 'Material', subjectHint, materialIds } = body

    if (!materialText || materialText.trim().length < 100) {
      return NextResponse.json({ success: false, error: 'Material insuficiente' }, { status: 400 })
    }

    const textSlice = materialText.slice(0, 10000)
    const detectedArea = subjectHint || detectSubjectArea(textSlice, materialTitle)

    // Prompt simplificado y más robusto para cualquier modelo
    const prompt = `Analiza este documento y extrae su estructura de aprendizaje completa.

DOCUMENTO: "${materialTitle}"
AREA: ${detectedArea}

TEXTO:
${textSlice}

INSTRUCCIONES:
1. Identifica CADA sección, tema, persona, evento o concepto importante
2. Crea una coverageUnit por cada elemento relevante
3. Usa citas textuales del documento
4. Mínimo 5 unidades, máximo 20

Responde con este JSON exacto:
{
  "subjectArea": "${detectedArea}",
  "difficultyLevel": "basic",
  "coverageUnits": [
    {
      "id": "u1",
      "title": "titulo del tema",
      "importance": "high",
      "knowledgeType": "conceptual",
      "rawTextReference": "cita textual del documento",
      "keyFacts": ["hecho 1 del documento", "hecho 2"],
      "learningObjectives": ["El estudiante podrá explicar..."]
    }
  ],
  "concepts": [
    {
      "id": "c1",
      "name": "nombre",
      "explanation": "explicacion basada en el texto",
      "sourceUnitIds": ["u1"],
      "prerequisites": [],
      "relatedConcepts": [],
      "difficulty": 40,
      "anchorConcept": true,
      "knowledgeType": "conceptual"
    }
  ]
}`

    const result = await alaiRequest(async (client: any, modelFn: (m?: string) => string) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [
        {
          role: 'system',
          content: 'Eres un analizador de documentos. Respondes SOLO con JSON valido. Sin texto extra.',
        },
        { role: 'user', content: prompt },
      ],
        temperature: 0.1,
        max_tokens: 6000,
      })
      const rawText = res?.choices?.[0]?.message?.content || ''
      if (!rawText.trim()) throw new Error('ALAI_EMPTY_RESPONSE')
      return { text: rawText, provider: 'unknown', model: 'unknown' }
    })

    // Intentar parsear de múltiples formas
    let parsed = safeParseJson(result.text)

    if (!parsed) {
      const match = result.text.match(/\{[\s\S]*\}/)
      if (match) parsed = safeParseJson(match[0])
    }

    if (!parsed) {
      // Intentar limpiar el texto y parsear
      const cleaned = result.text
        .replace(/^[^{]*/, '')  // quitar texto antes del primer {
        .replace(/[^}]*$/, '')  // quitar texto después del último }
        + '}'
      parsed = safeParseJson(cleaned)
    }

    if (!parsed || !Array.isArray(parsed.coverageUnits) || parsed.coverageUnits.length === 0) {
      console.error('[analyze-material] Parse failed. Raw text slice:', result.text.slice(0, 500))

      // Fallback: crear análisis básico desde el texto
      parsed = buildBasicAnalysis(textSlice, materialTitle, detectedArea)
    }

    // Enriquecer unidades
    const coverageUnits: CoverageUnit[] = (parsed.coverageUnits || []).map((u: any, i: number) => ({
      id: u.id || `u${i + 1}`,
      title: u.title || `Tema ${i + 1}`,
      sourceMaterialId: materialIds?.[0] || 'material_1',
      rawTextReference: u.rawTextReference || u.title || '',
      importance: u.importance || 'medium',
      knowledgeType: u.knowledgeType || 'conceptual',
      recommendedTeachingStrategies: [],
      recommendedAssessmentStrategies: [],
      keyFacts: u.keyFacts || [],
      learningObjectives: u.learningObjectives || [`Aprender sobre ${u.title}`],
    }))

    const concepts: ConceptNode[] = (parsed.concepts || []).map((c: any, i: number) => ({
      id: c.id || `c${i + 1}`,
      name: c.name || '',
      explanation: c.explanation || '',
      sourceUnitIds: c.sourceUnitIds || [coverageUnits[0]?.id].filter(Boolean),
      prerequisites: c.prerequisites || [],
      relatedConcepts: c.relatedConcepts || [],
      difficulty: Number(c.difficulty) || 50,
      anchorConcept: Boolean(c.anchorConcept),
      knowledgeType: c.knowledgeType || 'conceptual',
    }))

    const analysis: MaterialAnalysis = {
      materialTitle,
      subjectArea: parsed.subjectArea || detectedArea,
      difficultyLevel: parsed.difficultyLevel || 'intermediate',
      totalCoverageUnits: coverageUnits,
      concepts,
      dependencies: [],
      examplesFromMaterial: [],
      problemsFromMaterial: [],
      formulas: [],
      definitions: [],
      processes: [],
      commonMistakes: [],
      examRelevantItems: [],
      analyzedAt: Date.now(),
      documentStructure: parsed.documentStructure || null,
    } as any

    console.log(`[analyze-material] OK: ${coverageUnits.length} unidades | ${concepts.length} conceptos | ${analysis.subjectArea}`)
    console.log(`[analyze-material] Temas: ${coverageUnits.map(u => u.title).join(' | ')}`)

    return NextResponse.json({ success: true, analysis })

  } catch (err: any) {
    console.error('[analyze-material] Error:', err.message)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}

// Fallback: análisis básico cuando el modelo falla
function buildBasicAnalysis(text: string, title: string, area: string) {
  // Dividir el texto en párrafos y crear unidades básicas
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 50)
  const units = paragraphs.slice(0, 10).map((p, i) => {
    // Extraer primera oración como título
    const firstSentence = p.split(/[.!?]/)[0]?.trim() || `Sección ${i + 1}`
    const shortTitle = firstSentence.slice(0, 60) + (firstSentence.length > 60 ? '...' : '')
    return {
      id: `u${i + 1}`,
      title: shortTitle,
      importance: i < 2 ? 'critical' : i < 5 ? 'high' : 'medium',
      knowledgeType: 'conceptual',
      rawTextReference: p.slice(0, 300),
      keyFacts: [p.slice(0, 100)],
      learningObjectives: [`Comprender: ${shortTitle}`],
    }
  })

  if (units.length === 0) {
    units.push({
      id: 'u1',
      title: title,
      importance: 'critical',
      knowledgeType: 'conceptual',
      rawTextReference: text.slice(0, 500),
      keyFacts: [text.slice(0, 100)],
      learningObjectives: [`Aprender sobre ${title}`],
    })
  }

  return {
    subjectArea: area,
    difficultyLevel: 'intermediate',
    coverageUnits: units,
    concepts: units.slice(0, 5).map((u, i) => ({
      id: `c${i + 1}`,
      name: u.title,
      explanation: u.rawTextReference,
      sourceUnitIds: [u.id],
      prerequisites: [],
      relatedConcepts: [],
      difficulty: 50,
      anchorConcept: i === 0,
      knowledgeType: 'conceptual',
    })),
  }
}
