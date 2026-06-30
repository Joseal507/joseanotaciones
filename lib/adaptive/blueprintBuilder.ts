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

// ── Chunking (mismo patrón que análisis) ─────────────────────
function splitIntoChunks(text: string, chunkSize = 4500): string[] {
  const chunks: string[] = []
  let remaining = text.trim()
  while (remaining.length > 0) {
    if (remaining.length <= chunkSize) {
      chunks.push(remaining)
      break
    }
    let cut = remaining.lastIndexOf('\n\n', chunkSize)
    if (cut < chunkSize * 0.5) cut = remaining.lastIndexOf('\n', chunkSize)
    if (cut < chunkSize * 0.5) cut = chunkSize
    chunks.push(remaining.slice(0, cut).trim())
    remaining = remaining.slice(cut).trim()
  }
  return chunks.filter(Boolean)
}

// ── Wrapper que llama a /api/analizar-teorico (funciona desde cliente) ──
async function safeAlaiJson(prompt: string, _maxTokens = 5000): Promise<any> {
  try {
    const res = await fetch('/api/analizar-teorico', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'blueprint_analysis',
        blueprintPrompt: prompt,
        materialTitle: 'blueprint',
        maxLength: 'medium',
        contenido: '',
      }),
    })

    if (!res.ok) {
      console.warn('⚠️ blueprint API falló:', res.status)
      return null
    }

    const data = await res.json()
    const rawText = data.blueprint || data.blueprintRaw || data.analysis || data.content || ''

    // Parsear JSON del texto
    let parsed = null
    try { parsed = JSON.parse(rawText.trim()) } catch {}
    if (!parsed) {
      const match = rawText.match(/\{[\s\S]*\}/)
      if (match) {
        try { parsed = JSON.parse(match[0]) } catch {}
      }
    }

    return parsed
  } catch (err: any) {
    console.warn('⚠️ blueprint safeAlaiJson falló:', err?.message)
    return null
  }
}


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
  chunk: string,
  materialTitle: string,
  lang: 'es' | 'en',
  chunkIndex: number = 0,
  totalChunks: number = 1,
): string {
  const isEs = lang === 'es'

  if (isEs) {
    return `Eres un extractor de TOPICS de aprendizaje. Tu trabajo: identificar los temas REALES y específicos de este fragmento del material.

MATERIAL: "${materialTitle}"
FRAGMENTO: ${chunkIndex + 1} de ${totalChunks}

CONTENIDO:
${chunk}

REGLAS CRÍTICAS:

1. NO crear topics genéricos como "Introducción", "Conceptos básicos", "Resumen", "General"
2. Cada topic debe ser una UNIDAD DE APRENDIZAJE específica del material
3. EXTRAE TODOS los topics que aparezcan en este fragmento:
   - Si hay 1 tema central, extrae 1 topic
   - Si hay 3 subtemas, extrae 3 topics
   - Si hay 5 procesos distintos, extrae 5 topics
4. Cada topic debe tener 2-6 conceptos CLAVE específicos
5. NO inventes — solo extrae lo que está en el material

EJEMPLOS BUENOS:
- "Estructura de los lípidos saturados" (específico)
- "Función de los fosfolípidos en la membrana" (concreto)
- "Clasificación de las grasas trans" (acotado)

EJEMPLOS MALOS:
- "Lípidos" (demasiado general)
- "Conceptos importantes" (genérico)
- "Lo que debes saber" (vacío)

Devuelve SOLO JSON válido:
{
  "topics": [
    {
      "title": "Título específico del topic",
      "description": "Descripción de 1-2 frases de qué cubre",
      "difficulty": 60,
      "importance": 80,
      "estimatedMinutes": 15,
      "concepts": [
        {
          "name": "Nombre del concepto",
          "definition": "Definición breve y clara",
          "importance": "critical" | "major" | "supporting",
          "difficulty": 50,
          "practiceType": "recall" | "application" | "analysis"
        }
      ]
    }
  ]
}`
  }

  return `You are a learning TOPIC extractor. Your job: identify the REAL specific topics in this material chunk.

MATERIAL: "${materialTitle}"
CHUNK: ${chunkIndex + 1} of ${totalChunks}

CONTENT:
${chunk}

CRITICAL RULES:

1. NO generic topics like "Introduction", "Basic concepts", "Summary", "General"
2. Each topic must be a SPECIFIC learning unit from the material
3. EXTRACT ALL topics that appear in this chunk:
   - If 1 central theme, extract 1 topic
   - If 3 subtopics, extract 3 topics
   - If 5 distinct processes, extract 5 topics
4. Each topic must have 2-6 KEY specific concepts
5. DON'T invent — only extract what's in the material

Return ONLY valid JSON:
{
  "topics": [
    {
      "title": "Specific topic title",
      "description": "1-2 sentence description",
      "difficulty": 60,
      "importance": 80,
      "estimatedMinutes": 15,
      "concepts": [
        {
          "name": "Concept name",
          "definition": "Brief clear definition",
          "importance": "critical" | "major" | "supporting",
          "difficulty": 50,
          "practiceType": "recall" | "application" | "analysis"
        }
      ]
    }
  ]
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

export async function fetchAndBuildBlueprint(params: BlueprintBuildParams): Promise<MaterialBlueprint> {
  const { materialContent, materialId, materialTitle } = params
  const lang = detectLang(materialContent)

  if (!materialContent || materialContent.length < 200) {
    console.warn('[Blueprint] Material muy corto, usando fallback')
    return fallbackBlueprintFromText(materialContent, materialId, materialTitle)
  }

  console.log(`📚 Blueprint analizando: "${materialTitle}" (${materialContent.length} chars)`)

  // ═══════════════════════════════════════════════════════════════
  // FASE 1: Análisis profundo por chunks
  // Extraer DATOS CRUDOS (ideas, hechos, procesos) de todo el PDF
  // ═══════════════════════════════════════════════════════════════
  const chunks = splitIntoChunks(materialContent, 4500)
  console.log(`📄 Fase 1: Analizando ${chunks.length} chunk(s) en paralelo`)

  const allRawData: ChunkAnalysis[] = []
  const PARALLEL = 2

  for (let start = 0; start < chunks.length; start += PARALLEL) {
    const batch = chunks.slice(start, start + PARALLEL)

    const results = await Promise.all(
      batch.map(async (chunk, idx) => {
        const chunkIndex = start + idx
        const prompt = buildChunkAnalysisPrompt(chunk, materialTitle, lang, chunkIndex, chunks.length)
        const raw = await safeAlaiJson(prompt, 3500)

        if (!raw) {
          console.warn(`⚠️ Chunk ${chunkIndex + 1} análisis falló`)
          return null
        }

        console.log(`✅ Chunk ${chunkIndex + 1}/${chunks.length}: ${(raw.ideas || []).length} ideas, ${(raw.conceptos || []).length} conceptos`)
        return raw as ChunkAnalysis
      })
    )

    allRawData.push(...results.filter((r): r is ChunkAnalysis => r !== null))
  }

  if (allRawData.length === 0) {
    console.warn('[Blueprint] Cero datos extraídos, fallback')
    return fallbackBlueprintFromText(materialContent, materialId, materialTitle)
  }

  // ═══════════════════════════════════════════════════════════════
  // FASE 2: Síntesis global
  // Con TODOS los datos, identificar los topics REALES del material
  // ═══════════════════════════════════════════════════════════════
  console.log(`🧠 Fase 2: Sintetizando topics desde ${allRawData.length} chunks analizados`)

  const allIdeas = allRawData.flatMap(d => d.ideas || [])
  const allConceptos = allRawData.flatMap(d => d.conceptos || [])
  const allProcesos = allRawData.flatMap(d => d.procesos || [])
  const allRelaciones = allRawData.flatMap(d => d.relaciones || [])

  const synthesisPrompt = buildSynthesisPrompt({
    materialTitle,
    lang,
    ideas: allIdeas,
    conceptos: allConceptos,
    procesos: allProcesos,
    relaciones: allRelaciones,
    totalChars: materialContent.length,
  })

  const synthesisResult = await safeAlaiJson(synthesisPrompt, 5500)

  if (!synthesisResult || !synthesisResult.topics || !Array.isArray(synthesisResult.topics)) {
    console.warn('[Blueprint] Síntesis falló, usando datos crudos')
    return fallbackFromRawData(allRawData, materialContent, materialId, materialTitle)
  }

  const extractedTopics = sanitizeTopics(synthesisResult.topics)
  console.log(`✅ Blueprint: ${extractedTopics.length} topics identificados`)

  // ═══════════════════════════════════════════════════════════════
  // FASE 3: Construir blueprint final
  // ═══════════════════════════════════════════════════════════════
  const blueprintParams: BlueprintBuildParams = {
    materialContent,
    materialId,
    materialTitle,
    extractedTopics,
  }

  const blueprint = buildMaterialBlueprint(blueprintParams)
  const validation = validateMaterialBlueprint(blueprint, materialContent.length)
  if (!validation.isValid) {
    console.warn('[Blueprint] Validación falló:', validation.errors || [])
  }

  return blueprint
}

// ═══════════════════════════════════════════════════════════════
// TIPOS Y HELPERS
// ═══════════════════════════════════════════════════════════════

interface ChunkAnalysis {
  ideas?: string[]
  conceptos?: Array<{ nombre: string; definicion: string }>
  procesos?: string[]
  relaciones?: string[]
}

function buildChunkAnalysisPrompt(
  chunk: string,
  materialTitle: string,
  lang: 'es' | 'en',
  chunkIndex: number,
  totalChunks: number,
): string {
  if (lang === 'es') {
    return `Analiza este fragmento del material "${materialTitle}" (chunk ${chunkIndex + 1}/${totalChunks}).

Tu trabajo: extraer TODO el conocimiento útil. No sintetices, no agrupes — EXTRAE.

CONTENIDO:
${chunk}

Devuelve SOLO JSON válido:
{
  "ideas": ["ideas centrales que aparecen", "puntos importantes", "hechos clave"],
  "conceptos": [
    {"nombre": "Nombre del concepto técnico", "definicion": "breve definición del material"}
  ],
  "procesos": ["procesos o mecanismos descritos", "secuencias", "ciclos"],
  "relaciones": ["X causa Y", "A se relaciona con B porque..."]
}

REGLAS:
- Extrae 5-15 ideas
- Extrae 3-10 conceptos con definición
- No inventes nada que no esté en el material
- Sé granular: prefiere muchos elementos específicos sobre pocos generales`
  }

  return `Analyze this chunk of "${materialTitle}" (${chunkIndex + 1}/${totalChunks}).

Extract ALL useful knowledge. Don't synthesize, don't group — EXTRACT.

CONTENT:
${chunk}

Return ONLY valid JSON:
{
  "ideas": ["central ideas", "key facts"],
  "conceptos": [{"nombre": "term", "definicion": "brief definition"}],
  "procesos": ["processes described"],
  "relaciones": ["X causes Y", "A relates to B because..."]
}`
}

function buildSynthesisPrompt(params: {
  materialTitle: string
  lang: 'es' | 'en'
  ideas: string[]
  conceptos: Array<{ nombre: string; definicion: string }>
  procesos: string[]
  relaciones: string[]
  totalChars: number
}): string {
  const { materialTitle, lang, ideas, conceptos, procesos, relaciones, totalChars } = params

  // Estimar cuántos topics esperados según tamaño del material
  // ~2000-3000 chars por topic, mínimo 3, máximo 12
  const expectedTopics = Math.max(3, Math.min(12, Math.round(totalChars / 2500)))

  const dataBlock = [
    'IDEAS EXTRAÍDAS:',
    ideas.slice(0, 60).map(i => '- ' + i).join('\n'),
    '',
    'CONCEPTOS EXTRAÍDOS:',
    conceptos.slice(0, 40).map(c => `- ${c.nombre}: ${c.definicion}`).join('\n'),
    '',
    'PROCESOS:',
    procesos.slice(0, 25).map(p => '- ' + p).join('\n'),
    '',
    'RELACIONES:',
    relaciones.slice(0, 25).map(r => '- ' + r).join('\n'),
  ].join('\n')

  if (lang === 'es') {
    return `Eres un diseñador de planes de estudio. Te doy todos los datos extraídos del material "${materialTitle}".

Tu trabajo: identificar los TOPICS reales que un estudiante necesita aprender para dominar este material.

DATOS DEL MATERIAL:
${dataBlock}

INSTRUCCIONES:

1. Identifica los ${expectedTopics} TOPICS principales del material (puede variar entre ${Math.max(2, expectedTopics - 2)} y ${expectedTopics + 2})
2. Cada topic debe ser una UNIDAD DE APRENDIZAJE específica
3. NO uses topics genéricos como "Introducción" o "Conceptos básicos"
4. Cada topic agrupa 3-7 conceptos relacionados
5. Los conceptos vienen de la lista de "Conceptos extraídos"

EJEMPLOS BUENOS de topics:
- "Estructura molecular de los lípidos saturados"
- "Función de fosfolípidos en la membrana celular"
- "Clasificación y propiedades de las grasas trans"
- "Vitaminas liposolubles y su absorción"

Devuelve SOLO JSON válido:
{
  "topics": [
    {
      "title": "Título específico (no genérico)",
      "description": "1-2 frases de qué cubre",
      "difficulty": 60,
      "importance": 80,
      "estimatedMinutes": 15,
      "concepts": [
        {
          "name": "Nombre del concepto",
          "definition": "Definición breve",
          "importance": "critical" | "major" | "supporting",
          "difficulty": 50,
          "practiceType": "recall" | "application" | "analysis"
        }
      ]
    }
  ]
}`
  }

  return `You are a study plan designer. Here are all data extracted from "${materialTitle}".

Your job: identify the REAL topics a student needs to learn to master this material.

DATA:
${dataBlock}

INSTRUCTIONS:

1. Identify the ${expectedTopics} main TOPICS (can vary ${Math.max(2, expectedTopics - 2)} to ${expectedTopics + 2})
2. Each topic = a SPECIFIC learning unit
3. NO generic topics like "Introduction"
4. Each topic groups 3-7 related concepts

Return ONLY valid JSON:
{
  "topics": [
    {
      "title": "Specific title",
      "description": "1-2 sentences",
      "difficulty": 60,
      "importance": 80,
      "estimatedMinutes": 15,
      "concepts": [
        {
          "name": "Concept name",
          "definition": "Brief definition",
          "importance": "critical" | "major" | "supporting",
          "difficulty": 50,
          "practiceType": "recall" | "application" | "analysis"
        }
      ]
    }
  ]
}`
}

function fallbackFromRawData(
  rawData: ChunkAnalysis[],
  materialContent: string,
  materialId: string,
  materialTitle: string,
): MaterialBlueprint {
  // Si la síntesis falló pero tenemos datos crudos, crear topics básicos por chunk
  const topics: RawExtractedTopic[] = []
  for (let i = 0; i < rawData.length; i++) {
    const d = rawData[i]
    const conceptos = (d.conceptos || []).slice(0, 5).map(c => ({
      name: c.nombre,
      definition: c.definicion,
      importance: 'major' as const,
      difficulty: 50,
      practiceType: 'recall' as const,
    }))

    if (conceptos.length === 0) continue

    topics.push({
      title: `Parte ${i + 1}`,
      description: (d.ideas || [])[0] || '',
      difficulty: 50,
      importance: 70,
      estimatedMinutes: 15,
      concepts: conceptos,
    })
  }

  if (topics.length === 0) {
    return fallbackBlueprintFromText(materialContent, materialId, materialTitle)
  }

  return buildMaterialBlueprint({
    materialContent,
    materialId,
    materialTitle,
    extractedTopics: topics,
  })
}



// ── Merge de topics duplicados ────────────────────────────
function mergeDuplicateTopics(topics: RawExtractedTopic[]): RawExtractedTopic[] {
  const groups: Map<string, RawExtractedTopic[]> = new Map()

  for (const topic of topics) {
    const key = topic.title.toLowerCase()
      .replace(/[^a-záéíóúñ\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join(' ')

    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(topic)
  }

  const merged: RawExtractedTopic[] = []
  for (const [key, group] of groups.entries()) {
    if (group.length === 1) {
      merged.push(group[0])
    } else {
      // Fusionar: combinar conceptos sin duplicar
      const allConcepts = group.flatMap(t => t.concepts || [])
      const uniqueConcepts = Array.from(
        new Map(allConcepts.map(c => [c.name.toLowerCase(), c])).values()
      )
      merged.push({
        ...group[0],
        concepts: uniqueConcepts,
      })
    }
  }

  return merged
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
