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

    // Procesar el material completo en chunks para no perder contenido
    const CHUNK_SIZE = 8000
    const OVERLAP = 500
    const fullText = materialText.trim()
    const detectedArea = subjectHint || detectSubjectArea(fullText.slice(0, 5000), materialTitle)

    const chunks: string[] = []
    let pos = 0
    while (pos < fullText.length) {
      const end = Math.min(pos + CHUNK_SIZE, fullText.length)
      chunks.push(fullText.slice(pos, end))
      if (end === fullText.length) break
      pos += CHUNK_SIZE - OVERLAP
    }

    console.log(`[analyze-material] ${fullText.length} chars → ${chunks.length} chunks`)

    const allUnitsRaw: any[] = []
    const allConceptsRaw: any[] = []

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunkText = chunks[ci]

      const prompt = `Analiza este fragmento (parte ${ci + 1} de ${chunks.length}) del documento y extrae su estructura de aprendizaje.

DOCUMENTO: "${materialTitle}"
AREA: ${detectedArea}
FRAGMENTO ${ci + 1}/${chunks.length}:
${chunkText}

INSTRUCCIONES:
1. Identifica CADA sección, tema, persona, evento o concepto importante de ESTE fragmento
2. Crea una coverageUnit por cada elemento relevante
3. Usa citas textuales del fragmento
4. Mínimo 2 unidades por fragmento, máximo 8 por fragmento
5. NO repitas temas que ya habrían aparecido en fragmentos anteriores

Responde con este JSON exacto:
{
  "coverageUnits": [
    {
      "id": "u_${ci}_1",
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
      "id": "c_${ci}_1",
      "name": "nombre",
      "explanation": "explicacion basada en el texto",
      "sourceUnitIds": ["u_${ci}_1"],
      "prerequisites": [],
      "relatedConcepts": [],
      "difficulty": 40,
      "anchorConcept": true,
      "knowledgeType": "conceptual"
    }
  ]
}`

      try {
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
            max_tokens: 4000,
          })
          const rawText = res?.choices?.[0]?.message?.content || ''
          if (!rawText.trim()) throw new Error('ALAI_EMPTY_RESPONSE')
          return { text: rawText, provider: 'unknown', model: 'unknown' }
        })

        let chunkParsed = safeParseJson(result.text)
        if (!chunkParsed) {
          const match = result.text.match(/\{[\s\S]*\}/)
          if (match) chunkParsed = safeParseJson(match[0])
        }

        if (chunkParsed?.coverageUnits?.length > 0) {
          allUnitsRaw.push(...chunkParsed.coverageUnits)
          allConceptsRaw.push(...(chunkParsed.concepts || []))
          console.log(`[analyze-material] Chunk ${ci + 1}/${chunks.length}: ${chunkParsed.coverageUnits.length} unidades`)
        } else {
          // Fallback por chunk: al menos 1 unidad del texto
          const fallbackChunk = buildBasicAnalysis(chunkText, materialTitle, detectedArea)
          allUnitsRaw.push(...fallbackChunk.coverageUnits)
          console.log(`[analyze-material] Chunk ${ci + 1}/${chunks.length}: fallback ${fallbackChunk.coverageUnits.length} unidades`)
        }
      } catch (chunkErr: any) {
        console.warn(`[analyze-material] Chunk ${ci + 1} falló: ${chunkErr.message}`)
        // En error de chunk, usar fallback básico para no perder contenido
        const fallbackChunk = buildBasicAnalysis(chunkText, materialTitle, detectedArea)
        allUnitsRaw.push(...fallbackChunk.coverageUnits)
      }
    }

    // Si no se extrajeron unidades de ningún chunk, usar fallback completo
    if (allUnitsRaw.length === 0) {
      const fallback = buildBasicAnalysis(fullText.slice(0, 8000), materialTitle, detectedArea)
      allUnitsRaw.push(...fallback.coverageUnits)
      allConceptsRaw.push(...fallback.concepts)
    }

    // Deduplicar unidades por título similar (evitar repetición entre chunks con overlap)
    const seenTitles = new Set<string>()
    const deduplicatedUnits = allUnitsRaw.filter((u: any) => {
      const normalizedTitle = String(u.title || '').toLowerCase().trim().slice(0, 40)
      if (seenTitles.has(normalizedTitle)) return false
      seenTitles.add(normalizedTitle)
      return true
    })

    // Enriquecer unidades con IDs únicos globales
    const coverageUnits: CoverageUnit[] = deduplicatedUnits.map((u: any, i: number) => ({
      id: `u${i + 1}`,
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

    // Deduplicar conceptos por nombre
    const seenConceptNames = new Set<string>()
    const deduplicatedConcepts = allConceptsRaw.filter((c: any) => {
      const normalizedName = String(c.name || '').toLowerCase().trim()
      if (!normalizedName || seenConceptNames.has(normalizedName)) return false
      seenConceptNames.add(normalizedName)
      return true
    })

    const concepts: ConceptNode[] = deduplicatedConcepts.map((c: any, i: number) => ({
      id: `c${i + 1}`,
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
      subjectArea: detectedArea,
      difficultyLevel: 'intermediate',
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
    } as any

    console.log(`[analyze-material] OK: ${coverageUnits.length} unidades (${chunks.length} chunks) | ${concepts.length} conceptos | ${analysis.subjectArea}`)
    console.log(`[analyze-material] Temas: ${coverageUnits.map((u: CoverageUnit) => u.title).join(' | ')}`)

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
