// ═══════════════════════════════════════════════════════════════
// StudyAL — Blueprint Builder
// Llama al análisis de ALAI para extraer temas reales del material
// y construye el MaterialBlueprint completo.
//
// Este módulo es el único punto donde se hace la llamada de red.
// El resto del sistema trabaja con el blueprint resultante.
// ═══════════════════════════════════════════════════════════════

import {
  buildMaterialBlueprint,
  fallbackBlueprintFromText,
  validateMaterialBlueprint,
} from './blueprint'
import type { MaterialBlueprint, MaterialTopic, BlueprintBuildParams } from './blueprint'
import {
  splitIntoChunks,
  mergeTopicsFromChunks,
  validateMergedTopics,
} from './blueprintChunker'


// ── Tipos del grafo de conocimiento ─────────────────────────────
interface GraphRelation {
  from: string
  to: string
  type: string
  strength: number
}

interface GraphResult {
  relations: GraphRelation[]
  concepts: string[]
}

// ── Tipos internos ───────────────────────────────────────────────

interface RawExtractedTopic {
  title: string
  subtitle?: string
  description: string
  concepts: Array<{
    name: string
    definition: string
    importance?: 'critical' | 'major' | 'supporting'
    difficulty?: number
    sourcePages?: number[]
    prerequisites?: string[]
    commonConfusions?: string[]
    practiceType?: 'recall' | 'application' | 'explanation' | 'analysis'
  }>
  sourcePages?: number[]
  difficulty?: number
  importance?: number
  estimatedMinutes?: number
  practiceNeeds?: Array<'understand' | 'memorize' | 'apply' | 'simulate'>
  prerequisites?: string[]
  commonMistakes?: string[]
}

interface BlueprintAnalysisResult {
  topics: RawExtractedTopic[]
  centralQuestion: string
  learningPath: string[]
  keyInsight: string
  confidence: number
}

// ── Prompt para extraer blueprint del material ───────────────────

function buildBlueprintPrompt(
  materialContent: string,
  materialTitle: string,
  lang: 'es' | 'en',
): string {
  const contentSlice = materialContent // chunk ya viene con el tamaño correcto

  if (lang === 'es') {
    return `Eres ALAI BLUEPRINT ANALYZER. Tu trabajo es analizar el 100% de este material y extraer su estructura pedagógica real.

MISIÓN:
Identificar los TEMAS REALES del material — no secciones genéricas, no "introducción", no "resumen".
Cada tema debe ser un concepto, proceso, teoría o área de conocimiento específica del material.

REGLAS CRÍTICAS:
1. PROHIBIDO crear temas genéricos como "Introducción", "Resumen", "General", "Conceptos básicos".
2. Cada tema debe tener un título específico que diga EXACTAMENTE de qué trata: "Glucólisis y producción de ATP", "Modelo atómico de Bohr", "Ley de Ohm y circuitos eléctricos".
3. Mínimo 2 temas para cualquier material. Máximo 8 temas.
4. Cada tema debe tener entre 2 y 8 conceptos específicos.
5. PROHIBIDO inventar conceptos que no estén en el material.
6. Los conceptos deben ser términos, ideas o procesos que realmente aparecen en el texto.
7. La dificultad (0-100) debe reflejar qué tan difícil es el tema para un estudiante promedio.
8. La importancia (0-100) debe reflejar qué tan probable es que ese tema aparezca en un examen.

MATERIAL: ${materialTitle}
CONTENIDO:
${contentSlice}

Devuelve SOLO JSON válido con esta estructura exacta:
{
  "topics": [
    {
      "title": "Título específico del tema — NO genérico",
      "subtitle": "subtítulo opcional que añade contexto",
      "description": "qué cubre este tema en 1-2 oraciones",
      "concepts": [
        {
          "name": "nombre del concepto específico",
          "definition": "definición clara en 1 oración",
          "importance": "critical | major | supporting",
          "difficulty": 60,
          "practiceType": "recall | application | explanation | analysis",
          "commonConfusions": ["confusión frecuente con este concepto"]
        }
      ],
      "difficulty": 60,
      "importance": 80,
      "estimatedMinutes": 20,
      "practiceNeeds": ["understand", "memorize"],
      "commonMistakes": ["error frecuente que cometen los estudiantes"]
    }
  ],
  "centralQuestion": "El problema o pregunta central que resuelve este material",
  "learningPath": ["Primero aprender esto", "Luego esto", "Finalmente esto"],
  "keyInsight": "La idea más importante del material en 1 oración"
}`
  }

  return `You are ALAI BLUEPRINT ANALYZER. Your job is to analyze 100% of this material and extract its real pedagogical structure.

MISSION:
Identify the REAL TOPICS of the material — not generic sections, not "introduction", not "summary".
Each topic must be a specific concept, process, theory or knowledge area from the material.

CRITICAL RULES:
1. FORBIDDEN to create generic topics like "Introduction", "Summary", "General", "Basic concepts".
2. Each topic must have a specific title that says EXACTLY what it covers: "Glycolysis and ATP production", "Bohr atomic model", "Ohm's Law and electric circuits".
3. Minimum 2 topics for any material. Maximum 8 topics.
4. Each topic must have between 2 and 8 specific concepts.
5. FORBIDDEN to invent concepts not in the material.
6. Concepts must be terms, ideas or processes that actually appear in the text.
7. Difficulty (0-100) must reflect how hard the topic is for an average student.
8. Importance (0-100) must reflect how likely that topic is to appear in an exam.

MATERIAL: ${materialTitle}
CONTENT:
${contentSlice}

Return ONLY valid JSON with this exact structure:
{
  "topics": [
    {
      "title": "Specific topic title — NOT generic",
      "subtitle": "optional subtitle adding context",
      "description": "what this topic covers in 1-2 sentences",
      "concepts": [
        {
          "name": "specific concept name",
          "definition": "clear definition in 1 sentence",
          "importance": "critical | major | supporting",
          "difficulty": 60,
          "practiceType": "recall | application | explanation | analysis",
          "commonConfusions": ["frequent confusion about this concept"]
        }
      ],
      "difficulty": 60,
      "importance": 80,
      "estimatedMinutes": 20,
      "practiceNeeds": ["understand", "memorize"],
      "commonMistakes": ["frequent mistake students make"]
    }
  ],
  "centralQuestion": "The central problem or question this material solves",
  "learningPath": ["Learn this first", "Then this", "Finally this"],
  "keyInsight": "The most important idea of the material in 1 sentence"
}`
}

// ── Detectar idioma básico ───────────────────────────────────────

function detectLang(text: string): 'es' | 'en' {
  const spanishWords = [' el ', ' la ', ' los ', ' las ', ' de ', ' que ', ' en ', ' con ', ' por ']
  const count = spanishWords.filter(w => text.toLowerCase().includes(w)).length
  return count >= 4 ? 'es' : 'en'
}

// ── Parsear respuesta de ALAI ────────────────────────────────────

function parseAnalysisResponse(text: string): BlueprintAnalysisResult | null {
  // Intentar parse directo
  try {
    const parsed = JSON.parse(text.trim())
    if (parsed?.topics && Array.isArray(parsed.topics)) {
      return parsed as BlueprintAnalysisResult
    }
  } catch {}

  // Extraer JSON del texto
  const match = text.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0])
      if (parsed?.topics && Array.isArray(parsed.topics)) {
        return parsed as BlueprintAnalysisResult
      }
    } catch {}
  }

  return null
}

// ── Sanitizar topics extraídos ───────────────────────────────────

function sanitizeTopics(topics: any[]): RawExtractedTopic[] {
  if (!Array.isArray(topics)) return []

  return topics
    .filter(t => t && typeof t === 'object')
    .map(t => ({
      title: String(t.title || '').trim(),
      subtitle: t.subtitle ? String(t.subtitle).trim() : undefined,
      description: String(t.description || '').trim(),
      concepts: Array.isArray(t.concepts)
        ? t.concepts
            .filter((c: any) => c && typeof c === 'object' && c.name)
            .map((c: any) => ({
              name: String(c.name || '').trim(),
              definition: String(c.definition || c.definicion || '').trim(),
              importance: ['critical', 'major', 'supporting'].includes(c.importance)
                ? c.importance
                : 'major',
              difficulty: typeof c.difficulty === 'number'
                ? Math.min(100, Math.max(0, c.difficulty))
                : 50,
              practiceType: ['recall', 'application', 'explanation', 'analysis'].includes(c.practiceType)
                ? c.practiceType
                : 'recall',
              commonConfusions: Array.isArray(c.commonConfusions)
                ? c.commonConfusions.map((x: any) => String(x))
                : [],
              sourcePages: Array.isArray(c.sourcePages)
                ? c.sourcePages.map(Number).filter(Number.isFinite)
                : undefined,
            }))
        : [],
      difficulty: typeof t.difficulty === 'number'
        ? Math.min(100, Math.max(0, t.difficulty))
        : 50,
      importance: typeof t.importance === 'number'
        ? Math.min(100, Math.max(0, t.importance))
        : 70,
      estimatedMinutes: typeof t.estimatedMinutes === 'number'
        ? Math.min(60, Math.max(5, t.estimatedMinutes))
        : 15,
      practiceNeeds: Array.isArray(t.practiceNeeds)
        ? t.practiceNeeds.filter((n: string) =>
            ['understand', 'memorize', 'apply', 'simulate'].includes(n)
          )
        : ['understand', 'memorize'],
      commonMistakes: Array.isArray(t.commonMistakes)
        ? t.commonMistakes.map((x: any) => String(x))
        : [],
    }))
    .filter(t => t.title.length >= 3 && t.concepts.length > 0)
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// Analiza el material completo y construye el blueprint.
// Si la llamada falla, usa fallback automático.
// ═══════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════
// KNOWLEDGE GRAPH — extraer relaciones entre conceptos del material
// Llama a /api/mastery/extract-graph y guarda el resultado
// en el blueprint para que el generator pueda ordenar por prerequisitos.
// ═══════════════════════════════════════════════════════════════

async function fetchConceptGraph(
  materialContent: string,
  materialId: string,
  conceptNames: string[],
): Promise<GraphResult | null> {
  if (conceptNames.length < 2) return null

  try {
    const graphContext =
      conceptNames.join(', ') + '\n\n' + materialContent.slice(0, 8000);

    const res = await fetch('/api/mastery/extract-graph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        materialText: graphContext,
        concepts: conceptNames.slice(0, 40),
        materialId,
        tema: '',
        materia: '',
      }),
    })

    if (!res.ok) {
      console.warn('[Graph] extract-graph fallo (probable rate limit):', res.status);
      return null
    }

    const data = await res.json()
    if (!data.success || !Array.isArray(data.relations)) return null

    console.log(`[Blueprint] Grafo: ${data.relations.length} relaciones entre ${conceptNames.length} conceptos`)
    return { relations: data.relations, concepts: data.concepts || conceptNames }
  } catch (err) {
    console.warn('[Blueprint] fetchConceptGraph falló silenciosamente:', err)
    return null
  }
}

// Enriquecer los topics del blueprint con prerequisitos del grafo
function enrichTopicsWithGraph(
  topics: RawExtractedTopic[],
  graph: GraphResult,
): RawExtractedTopic[] {
  if (!graph.relations.length) return topics

  // Construir mapa: concepto → topic index
  const conceptToTopicIndex = new Map<string, number>()
  for (let i = 0; i < topics.length; i++) {
    for (const concept of topics[i].concepts || []) {
      conceptToTopicIndex.set(concept.name.toLowerCase(), i)
    }
  }

  // Para cada relación prerequisite/depends_on/requires,
  // agregar prerequisito al topic destino
  const topicPrereqs = new Map<number, Set<string>>() // topicIndex → Set<topicTitle>
  for (let i = 0; i < topics.length; i++) {
    topicPrereqs.set(i, new Set())
  }

  for (const rel of graph.relations) {
    const isPrereqRelation = [
      'prerequisite', 'depends_on', 'requires', 'prerequisite_of',
    ].includes(rel.type)

    if (!isPrereqRelation || rel.strength < 0.5) continue

    const fromTopicIdx = conceptToTopicIndex.get(rel.from.toLowerCase())
    const toTopicIdx = conceptToTopicIndex.get(rel.to.toLowerCase())

    if (fromTopicIdx === undefined || toTopicIdx === undefined) continue
    if (fromTopicIdx === toTopicIdx) continue

    // rel.from es prerequisito de rel.to
    // → el topic de rel.from debe ir antes que el topic de rel.to
    const toPrereqs = topicPrereqs.get(toTopicIdx)!
    toPrereqs.add(topics[fromTopicIdx].title)
  }

  // Aplicar prerequisitos a los topics
  return topics.map((topic, i) => {
    const prereqs = Array.from(topicPrereqs.get(i) || [])
    if (prereqs.length === 0) return topic
    return {
      ...topic,
      prerequisites: [
        ...new Set([...(topic.prerequisites || []), ...prereqs]),
      ],
    }
  })
}

// ═══════════════════════════════════════════════════════════════
// GRAPH DESDE BLUEPRINT — no necesita volver al texto
// Usa prerequisitos declarados en los topics para construir
// las relaciones del grafo directamente.
// ═══════════════════════════════════════════════════════════════

export interface BlueprintGraphRelation {
  from: string    // nombre del concepto origen
  to: string      // nombre del concepto destino
  type: 'prerequisite' | 'related' | 'part_of' | 'causes'
  strength: number  // 0-1
  topicFrom: string
  topicTo: string
}

export function buildGraphFromBlueprint(
  blueprint: MaterialBlueprint
): BlueprintGraphRelation[] {
  const relations: BlueprintGraphRelation[] = []
  const topicMap = new Map<string, MaterialTopic>()

  for (const t of blueprint.topics) {
    topicMap.set(t.id, t)
  }

  for (const topic of blueprint.topics) {
    // Prerequisitos declarados en el topic
    for (const prereqTitle of topic.prerequisites || []) {
      const prereqTopic = blueprint.topics.find(t =>
        t.title.toLowerCase().includes(prereqTitle.toLowerCase().slice(0, 10)) ||
        prereqTitle.toLowerCase().includes(t.title.toLowerCase().slice(0, 10))
      )
      if (!prereqTopic) continue

      // Crear relaciones entre todos los conceptos del prereq → todos del topic
      for (const fromConcept of prereqTopic.concepts || []) {
        for (const toConcept of (topic.concepts || []).slice(0, 2)) {
          relations.push({
            from: fromConcept.name,
            to: toConcept.name,
            type: 'prerequisite',
            strength: 0.8,
            topicFrom: prereqTopic.title,
            topicTo: topic.title,
          })
        }
      }
    }

    // Relaciones internas del topic: todos los conceptos son 'part_of'
    const concepts = topic.concepts || []
    for (let i = 0; i < concepts.length - 1; i++) {
      relations.push({
        from: concepts[i].name,
        to: concepts[i + 1].name,
        type: 'part_of',
        strength: 0.6,
        topicFrom: topic.title,
        topicTo: topic.title,
      })
    }

    // Relaciones entre topics adyacentes en el learningPath
    const pathIndex = (blueprint.learningPath || []).indexOf(topic.title)
    if (pathIndex > 0) {
      const prevTitle = blueprint.learningPath![pathIndex - 1]
      const prevTopic = blueprint.topics.find(t => t.title === prevTitle)
      if (prevTopic) {
        const prevConcepts = prevTopic.concepts || []
        const curConcepts = topic.concepts || []
        if (prevConcepts.length > 0 && curConcepts.length > 0) {
          relations.push({
            from: prevConcepts[prevConcepts.length - 1].name,
            to: curConcepts[0].name,
            type: 'related',
            strength: 0.5,
            topicFrom: prevTopic.title,
            topicTo: topic.title,
          })
        }
      }
    }
  }

  return relations
}

export interface BuildBlueprintOptions {
  materialId: string
  materialTitle: string
  materialContent: string
  selectedPages?: number[]
  // Si se pasa, evita llamar a la API y usa datos ya extraídos
  preExtractedTopics?: RawExtractedTopic[]
}

export async function fetchAndBuildBlueprint(
  options: BuildBlueprintOptions,
): Promise<MaterialBlueprint> {
  const {
    materialId,
    materialTitle,
    materialContent,
    selectedPages,
    preExtractedTopics,
  } = options

  // Si ya tenemos topics extraídos, construir directamente
  if (preExtractedTopics && preExtractedTopics.length > 0) {
    const params: BlueprintBuildParams = {
      materialId,
      materialTitle,
      materialContent,
      selectedPages,
      extractedTopics: preExtractedTopics,
    }
    return buildMaterialBlueprint(params)
  }

  // Sin contenido → fallback inmediato
  if (!materialContent || materialContent.trim().length < 50) {
    console.warn('[Blueprint] Material vacío — usando fallback')
    return fallbackBlueprintFromText(materialContent, materialId, materialTitle)
  }

  const lang = detectLang(materialContent)

  try {
    // ── Chunking para materiales largos ───────────────────────────
    const chunks = splitIntoChunks(materialContent)
    console.log(`[Blueprint] ${chunks.length} chunk(s) para analizar`)

    const chunkResults: Array<{ topics: RawExtractedTopic[]; chunkIndex: number }> = []
    let mergedCentralQuestion: string | undefined = undefined
    let mergedLearningPath: string[] | undefined = undefined
    let mergedKeyInsight: string | undefined = undefined

    // Procesar en lotes de 3 para no saturar
    for (let i = 0; i < chunks.length; i += 3) {
      const batch = chunks.slice(i, i + 3)

      const batchResults = await Promise.all(
        batch.map(async (chunk) => {
          const prompt = buildBlueprintPrompt(chunk.content, materialTitle, lang)

          try {
            const res = await fetch('/api/analizar-teorico', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contenido: chunk.content,
                mode: 'blueprint_analysis',
                blueprintPrompt: prompt,
                materialTitle,
                chunkIndex: chunk.index,
                chunkPages: chunk.estimatedPages,
                maxLength: 'medium',
              }),
            })

            if (!res.ok) {
              return { topics: [], chunkIndex: chunk.index }
            }

            const data = await res.json()

            const rawText =
              data.blueprint ||
              data.blueprintRaw ||
              data.analysis ||
              data.content ||
              ''

            const parsed = parseAnalysisResponse(rawText)
            if (!parsed?.topics || parsed.topics.length === 0) {
              return { topics: [], chunkIndex: chunk.index }
            }

            if (parsed.centralQuestion && !mergedCentralQuestion) {
              mergedCentralQuestion = parsed.centralQuestion
            }

            if (
              Array.isArray(parsed.learningPath) &&
              parsed.learningPath.length > 0 &&
              (!mergedLearningPath || parsed.learningPath.length > mergedLearningPath.length)
            ) {
              mergedLearningPath = parsed.learningPath.map(String)
            }

            if (parsed.keyInsight && !mergedKeyInsight) {
              mergedKeyInsight = parsed.keyInsight
            }

            const topics = sanitizeTopics(parsed.topics).map(t => ({
              ...t,
              sourcePages: t.sourcePages && t.sourcePages.length > 0
                ? t.sourcePages
                : chunk.estimatedPages,
              concepts: (t.concepts || []).map(c => ({
                ...c,
                sourcePages: c.sourcePages && c.sourcePages.length > 0
                  ? c.sourcePages
                  : chunk.estimatedPages,
              })),
            }))

            console.log(`[Blueprint] Chunk ${chunk.index}: ${topics.length} topics`)
            return { topics, chunkIndex: chunk.index }
          } catch {
            return { topics: [], chunkIndex: chunk.index }
          }
        })
      )

      chunkResults.push(...batchResults)
    }

    const mergedTopics = mergeTopicsFromChunks(chunkResults as any)
    const mergeValidation = validateMergedTopics(mergedTopics as any)

    console.log(
      `[Blueprint] Merge: ${mergeValidation.topicCount} topics, ${mergeValidation.conceptCount} conceptos`
    )

    if (mergeValidation.warnings.length > 0) {
      console.warn('[Blueprint] Warnings:', mergeValidation.warnings)
    }

    const sanitizedTopics = mergedTopics as RawExtractedTopic[]

    if (sanitizedTopics.length === 0) {
      console.warn('[Blueprint] Cero topics tras merge — usando fallback')
      return fallbackBlueprintFromText(materialContent, materialId, materialTitle)
    }
    // ── Enriquecer topics con relaciones del grafo de conocimiento ──
    // Extraer todos los conceptos de los topics para llamar a extract-graph
    const allConceptNames = sanitizedTopics
      .flatMap(t => t.concepts.map(c => c.name))
      .filter(n => n.length > 1)

    let enrichedTopics = sanitizedTopics

    if (allConceptNames.length >= 2) {
      const graph = await fetchConceptGraph(materialContent, materialId, allConceptNames)
      if (graph && graph.relations.length > 0) {
        enrichedTopics = enrichTopicsWithGraph(sanitizedTopics, graph)
        console.log('[Blueprint] Topics enriquecidos con grafo de conocimiento')
      }
    }

    const params: BlueprintBuildParams = {
      materialId,
      materialTitle,
      materialContent,
      selectedPages,
      extractedTopics: enrichedTopics,
      centralQuestion: mergedCentralQuestion,
      learningPath: mergedLearningPath,
      keyInsight: mergedKeyInsight,
    }

    const blueprint = buildMaterialBlueprint(params)

    // Validar resultado
    const validation = validateMaterialBlueprint(blueprint, materialContent.length)

    if (!validation.isValid) {
      console.warn('[Blueprint] Validación fallida:', validation.errors)
      // Si el score es muy bajo → fallback
      if (validation.score < 30) {
        return fallbackBlueprintFromText(materialContent, materialId, materialTitle)
      }
      // Si el score es medio → devolver igual pero marcar
      blueprint.validationPassed = false
      blueprint.confidence = Math.min(blueprint.confidence, 50)
    }

    console.log(
      `[Blueprint] ✅ ${blueprint.topics.length} temas | confidence: ${blueprint.confidence}% | fallback: ${blueprint.fallbackUsed}`
    )

    return blueprint

  } catch (err) {
    console.error('[Blueprint] Error en análisis:', err)
    return fallbackBlueprintFromText(materialContent, materialId, materialTitle)
  }
}

// ── Blueprint desde análisis existente ──────────────────────────
// Si ya se hizo un análisis previo (modo repasar/análisis),
// reutilizar esos datos para no llamar a la API de nuevo.

export function buildBlueprintFromExistingAnalysis(
  analysisData: {
    clase_narrativa?: Array<{ titulo: string; explicacion: string }>
    conceptos?: Array<{ nombre: string; definicion_clara: string; nivel?: string }>
    tema_principal?: string
    orden_para_ensenar?: string[]
  },
  materialId: string,
  materialTitle: string,
  materialContent: string,
): MaterialBlueprint {
  if (!analysisData || !analysisData.clase_narrativa?.length) {
    return fallbackBlueprintFromText(materialContent, materialId, materialTitle)
  }

  // Convertir clase_narrativa en topics
  const extractedTopics: RawExtractedTopic[] = analysisData.clase_narrativa
    .filter(part => part.titulo && part.explicacion)
    .map((part, i) => {
      // Extraer conceptos del texto de la parte
      const relatedConcepts = (analysisData.conceptos || [])
        .filter(c => {
          const partText = (part.titulo + ' ' + part.explicacion).toLowerCase()
          return partText.includes(c.nombre.toLowerCase().slice(0, 8))
        })
        .slice(0, 4)

      const concepts = relatedConcepts.length > 0
        ? relatedConcepts.map(c => ({
            name: c.nombre,
            definition: c.definicion_clara || '',
            importance: (i === 0 ? 'critical' : 'major') as 'critical' | 'major' | 'supporting',
            difficulty: c.nivel === 'avanzado' ? 75 : c.nivel === 'intermedio' ? 50 : 30,
            practiceType: 'recall' as const,
          }))
        : [{
            name: part.titulo.slice(0, 40),
            definition: part.explicacion.slice(0, 100),
            importance: 'major' as const,
            difficulty: 50,
            practiceType: 'recall' as const,
          }]

      return {
        title: part.titulo,
        description: part.explicacion.slice(0, 150),
        concepts,
        difficulty: 50,
        importance: Math.max(40, 90 - i * 10),
        estimatedMinutes: 15,
        practiceNeeds: ['understand', 'memorize'] as Array<'understand' | 'memorize' | 'apply' | 'simulate'>,
      }
    })

  const params: BlueprintBuildParams = {
    materialId,
    materialTitle,
    materialContent,
    extractedTopics,
    centralQuestion: analysisData.tema_principal,
    learningPath: analysisData.orden_para_ensenar,
  }

  return buildMaterialBlueprint(params)
}
