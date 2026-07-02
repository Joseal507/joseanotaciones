// ═══════════════════════════════════════════════════════════════
// StudyAL — Material Blueprint
// ALAI analiza el 100% del material ANTES de crear el programa.
// El blueprint es la inteligencia base del modo adaptativo.
// Sin blueprint sólido, no hay programa sólido.
// ═══════════════════════════════════════════════════════════════

// ── Tipos ────────────────────────────────────────────────────────

export interface TopicConcept {
  id: string
  name: string
  definition: string
  importance: 'critical' | 'major' | 'supporting'
  difficulty: number          // 0-100
  sourcePages?: number[]
  prerequisites?: string[]    // ids de otros conceptos
  commonConfusions?: string[]
  practiceType: 'recall' | 'application' | 'explanation' | 'analysis'
  knowledgeType?: 'conceptual' | 'narrative' | 'procedural' | 'memoristic' | 'mathematical' | 'argumentative' | 'causal' | 'visual'  // tipo específico de este concepto
  learningGoal?: string               // objetivo cognitivo de este concepto
}

export interface TopicEvidenceRequirement {
  minCorrectAnswers: number
  requiredEngines: string[]
  passingScore: number        // 0-100
  description: string
}

export interface MaterialTopic {
  id: string
  title: string
  subtitle?: string
  description: string
  order: number

  // Conceptos dentro de este tema
  concepts: TopicConcept[]

  // Páginas o secciones del material donde aparece
  sourcePages?: number[]

  // Metadata pedagógica
  difficulty: number            // 0-100 promedio del tema
  importance: number            // 0-100 qué tan importante es para el examen
  estimatedMinutes: number      // cuánto tarda en dominarse

  // Tipo de conocimiento — determina la estrategia pedagógica
  // Tipo de conocimiento — puede ser mixto
  primaryKnowledgeType: 'conceptual' | 'narrative' | 'procedural' | 'memoristic' | 'mathematical' | 'argumentative' | 'causal' | 'visual'
  knowledgeTypes: Array<'conceptual' | 'narrative' | 'procedural' | 'memoristic' | 'mathematical' | 'argumentative' | 'causal' | 'visual'>

  // Qué tipo de práctica necesita
  practiceNeeds: Array<'understand' | 'memorize' | 'apply' | 'simulate'>

  // Prerequisitos (ids de otros temas)
  prerequisites?: string[]

  // Posibles confusiones
  commonMistakes?: string[]

  // Evidencia necesaria para considerar el tema dominado
  evidenceRequirement: TopicEvidenceRequirement

  // Estado calculado (se llena después)
  masteryScore?: number         // 0-100
  isWeak?: boolean
  isCritical?: boolean
}

export interface MaterialBlueprint {
  id: string
  materialId: string
  createdAt: number
  version: number

  // Metadatos del material
  materialTitle: string
  totalPages: number
  language: 'es' | 'en' | 'unknown'

  // Estructura del material
  topics: MaterialTopic[]
  topicCount: number

  // Mapa de concepto → tema
  conceptToTopicMap: Record<string, string>  // conceptId → topicId

  // Calidad del blueprint
  confidence: number            // 0-100 qué tan bien ALAI entendió el material
  validationPassed: boolean
  coverageScore?: number          // 0-100: % del material cubierto
  fallbackUsed: boolean

  // Resumen pedagógico
  centralQuestion: string       // El problema central que resuelve el material
  learningPath: string[]        // Orden recomendado para aprender
  keyInsight: string            // La idea más importante del material
}

// ── Errores de validación ────────────────────────────────────────

export interface BlueprintValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
  score: number                 // 0-100 calidad del blueprint
}

// ═══════════════════════════════════════════════════════════════
// VALIDACIÓN
// ═══════════════════════════════════════════════════════════════

const GENERIC_TOPIC_TITLES = [
  'introducción', 'introduction', 'conclusión', 'conclusion',
  'resumen', 'summary', 'overview', 'general', 'misc',
  'otros', 'other', 'varios', 'various', 'tema', 'topic',
  'sección', 'section', 'parte', 'part', 'capítulo', 'chapter',
]

function isGenericTitle(title: string): boolean {
  const t = title.toLowerCase().trim()
  // Título exactamente igual a uno genérico
  if (GENERIC_TOPIC_TITLES.includes(t)) return true
  // Título muy corto sin contenido específico
  if (t.length < 4) return true
  // Título que es solo "Tema X" o "Sección X"
  if (/^(tema|sección|parte|capítulo|section|chapter|part)\s*\d*$/i.test(t)) return true
  return false
}

export function validateMaterialBlueprint(
  blueprint: MaterialBlueprint,
  materialContentLength: number,
): BlueprintValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  let score = 100

  // 1. Mínimo de temas según tamaño del material
  const minTopics = materialContentLength > 5000 ? 2 : 1
  if (blueprint.topics.length < minTopics) {
    errors.push(`Material de ${materialContentLength} chars necesita al menos ${minTopics} tema(s). Solo hay ${blueprint.topics.length}.`)
    score -= 40
  }

  // 2. No aceptar un solo tema para material largo
  if (materialContentLength > 8000 && blueprint.topics.length === 1) {
    errors.push('Material extenso no puede tener un solo tema. El análisis fue demasiado superficial.')
    score -= 30
  }

  // 3. Temas genéricos
  const genericTopics = blueprint.topics.filter(t => isGenericTitle(t.title))
  if (genericTopics.length > 0) {
    warnings.push(`${genericTopics.length} tema(s) con títulos genéricos: ${genericTopics.map(t => t.title).join(', ')}`)
    score -= genericTopics.length * 10
  }

  // 4. Temas vacíos (sin conceptos)
  const emptyTopics = blueprint.topics.filter(t => t.concepts.length === 0)
  if (emptyTopics.length > 0) {
    errors.push(`${emptyTopics.length} tema(s) sin conceptos: ${emptyTopics.map(t => t.title).join(', ')}`)
    score -= emptyTopics.length * 15
  }

  // 5. Conceptos duplicados entre temas
  const allConceptNames: string[] = []
  const duplicates: string[] = []
  for (const topic of blueprint.topics) {
    for (const concept of topic.concepts) {
      const key = concept.name.toLowerCase().trim()
      if (allConceptNames.includes(key)) {
        duplicates.push(concept.name)
      } else {
        allConceptNames.push(key)
      }
    }
  }
  if (duplicates.length > 0) {
    warnings.push(`${duplicates.length} concepto(s) duplicados: ${duplicates.slice(0, 3).join(', ')}`)
    score -= duplicates.length * 5
  }

  // 6. Conceptos sin topicId en el mapa
  const unmappedConcepts = allConceptNames.filter(
    name => !Object.keys(blueprint.conceptToTopicMap).some(
      k => k.toLowerCase() === name
    )
  )
  if (unmappedConcepts.length > 2) {
    warnings.push(`${unmappedConcepts.length} concepto(s) sin mapear a tema`)
    score -= 5
  }

  // 7. Blueprint sin pregunta central
  if (!blueprint.centralQuestion || blueprint.centralQuestion.length < 10) {
    warnings.push('Blueprint sin pregunta central definida')
    score -= 5
  }

  // 8. Blueprint sin learning path
  if (!blueprint.learningPath || blueprint.learningPath.length === 0) {
    warnings.push('Blueprint sin ruta de aprendizaje')
    score -= 5
  }

  score = Math.max(0, Math.min(100, score))

  return {
    isValid: errors.length === 0 && score >= 40,
    errors,
    warnings,
    score,
  }
}

// ═══════════════════════════════════════════════════════════════
// FALLBACK BLUEPRINT
// Cuando el análisis sale mal, este fallback garantiza que
// el sistema siga funcionando con datos básicos del material.
// ═══════════════════════════════════════════════════════════════

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

type BlueprintKnowledgeType =
  | 'conceptual'
  | 'narrative'
  | 'procedural'
  | 'memoristic'
  | 'mathematical'
  | 'argumentative'
  | 'causal'
  | 'visual'

function inferKnowledgeProfile(params: {
  title?: string
  description?: string
  concepts?: Array<{ name?: string; definition?: string }>
}): {
  primaryKnowledgeType: BlueprintKnowledgeType
  knowledgeTypes: BlueprintKnowledgeType[]
} {
  const text = [
    params.title || '',
    params.description || '',
    ...(params.concepts || []).flatMap(c => [c?.name || '', c?.definition || ''])
  ].join(' ').toLowerCase()

  const detected = new Set<BlueprintKnowledgeType>()
  const has = (arr: string[]) => arr.some(x => text.includes(x))

  if (has(['calcular', 'cálculo', 'formula', 'fórmula', 'ecuación', 'ka', 'kb', 'kw', 'ph', 'poh', 'ice', 'log', 'concentración'])) {
    detected.add('mathematical')
  }
  if (has(['paso', 'procedimiento', 'método', 'metodo', 'resolver', 'tabla ice', 'cómo', 'como'])) {
    detected.add('procedural')
  }
  if (has(['causa', 'efecto', 'porque', 'por qué', 'provoca', 'genera', 'desplaza', 'equilibrio'])) {
    detected.add('causal')
  }
  if (has(['historia', 'año', 'página', 'pagina', 'autor'])) {
    detected.add('narrative')
  }
  if (has(['clasifica', 'tipo', 'tipos', 'diferencia', 'categoría', 'categoria', 'definición', 'definicion'])) {
    detected.add('conceptual')
  }
  if (has(['recordar', 'memoria', 'memoriza'])) {
    detected.add('memoristic')
  }
  if (has(['diagrama', 'mapa', 'visual', 'esquema', 'gráfica', 'grafica'])) {
    detected.add('visual')
  }
  if (has(['argumenta', 'justifica', 'demuestra', 'defiende'])) {
    detected.add('argumentative')
  }

  if (detected.size === 0) detected.add('conceptual')

  const knowledgeTypes = Array.from(detected)
  const priority: BlueprintKnowledgeType[] = [
    'mathematical',
    'procedural',
    'causal',
    'argumentative',
    'conceptual',
    'memoristic',
    'narrative',
    'visual',
  ]
  const primaryKnowledgeType =
    priority.find(k => detected.has(k)) || 'conceptual'

  return { primaryKnowledgeType, knowledgeTypes }
}

export function fallbackBlueprintFromText(
  materialContent: string,
  materialId: string,
  materialTitle = 'Material',
): MaterialBlueprint {
  // Extraer palabras clave del material para crear temas básicos
  const words = materialContent
    .split(/\s+/)
    .map(w => w.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, '').trim())
    .filter(w => w.length > 5)

  // Frecuencia de palabras
  const freq: Record<string, number> = {}
  for (const w of words) {
    const key = w.toLowerCase()
    freq[key] = (freq[key] || 0) + 1
  }

  // Top palabras clave (excluir palabras comunes)
  const stopwords = new Set([
    'también', 'cuando', 'donde', 'porque', 'siendo', 'pueden', 'tienen',
    'mientras', 'través', 'manera', 'forma', 'parte', 'según', 'entre',
    'which', 'their', 'there', 'these', 'those', 'would', 'could', 'should',
    'about', 'after', 'before', 'other', 'every', 'first', 'second',
  ])

  const keywords = Object.entries(freq)
    .filter(([w]) => !stopwords.has(w))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([w]) => w)

  // Crear 2-3 temas básicos desde el contenido
  const chunkSize = Math.ceil(materialContent.length / 3)
  const chunks = [
    materialContent.slice(0, chunkSize),
    materialContent.slice(chunkSize, chunkSize * 2),
    materialContent.slice(chunkSize * 2),
  ].filter(c => c.trim().length > 100)

  const topics: MaterialTopic[] = chunks.map((chunk, i) => {
    // Extraer primera oración del chunk como título
    const firstSentence = chunk
      .trim()
      .split(/[.!?]/)[0]
      .trim()
      .slice(0, 60)

    const topicTitle = firstSentence.length > 10
      ? firstSentence
      : `Parte ${i + 1} del material`

    const topicId = uid()
    const kProfile = inferKnowledgeProfile({
      title: topicTitle,
      description: chunk.slice(0, 200),
    })

    // Conceptos básicos desde keywords del chunk
    const chunkWords = chunk.toLowerCase().split(/\s+/)
    const topicKeywords = keywords
      .filter(kw => chunkWords.filter(w => w.includes(kw)).length > 1)
      .slice(0, 4)

    const concepts: TopicConcept[] = topicKeywords.map(kw => {
      const conceptId = uid()
      return {
        id: conceptId,
        name: kw.charAt(0).toUpperCase() + kw.slice(1),
        definition: `Concepto clave del material: ${kw}`,
        importance: i === 0 ? 'major' as const : 'supporting' as const,
        difficulty: 50,
        practiceType: 'recall' as const,
      }
    })

    // Si no hay keywords, crear un concepto genérico seguro
    if (concepts.length === 0) {
      concepts.push({
        id: uid(),
        name: `Concepto ${i + 1}`,
        definition: 'Concepto del material',
        importance: 'supporting',
        difficulty: 50,
        practiceType: 'recall',
      })
    }

    return {
      id: topicId,
      title: topicTitle,
      description: `Sección ${i + 1} del material`,
      order: i + 1,
      concepts,
      difficulty: 50,
      importance: i === 0 ? 80 : 60,
      estimatedMinutes: 15,
      primaryKnowledgeType: kProfile.primaryKnowledgeType,
      knowledgeTypes: kProfile.knowledgeTypes,
      practiceNeeds: ['understand', 'memorize'],
      evidenceRequirement: {
        minCorrectAnswers: 3,
        requiredEngines: ['flashcards', 'quiz'],
        passingScore: 60,
        description: 'Completar flashcards y quiz con al menos 60% de aciertos',
      },
    }
  })

  // Construir mapa concepto → tema
  const conceptToTopicMap: Record<string, string> = {}
  for (const topic of topics) {
    for (const concept of topic.concepts) {
      conceptToTopicMap[concept.id] = topic.id
    }
  }

  return {
    id: uid(),
    materialId,
    createdAt: Date.now(),
    version: 1,
    materialTitle,
    totalPages: Math.max(1, Math.round(materialContent.length / 1600)),
    language: 'unknown',
    topics,
    topicCount: topics.length,
    conceptToTopicMap,
    confidence: 30,       // fallback tiene baja confianza
    validationPassed: false,
    fallbackUsed: true,
    centralQuestion: '¿Cuál es la idea principal de este material?',
    learningPath: topics.map(t => t.title),
    keyInsight: 'Revisa el material completo para identificar las ideas centrales.',
  }
}

// ═══════════════════════════════════════════════════════════════
// BUILD BLUEPRINT — Construir desde texto extraído
// Esta función no llama a ninguna API.
// Recibe el resultado de una extracción previa y lo estructura.
// ═══════════════════════════════════════════════════════════════

export interface BlueprintBuildParams {
  materialId: string
  materialTitle: string
  materialContent: string
  materiales?: any[]
  selectedPages?: number[]
  // Si viene de una extracción de análisis previo
  extractedTopics?: Array<{
    title: string
    subtitle?: string
    description: string
    concepts: Array<{
      name: string
      definition: string
      importance?: string
      difficulty?: number
      sourcePages?: number[]
      prerequisites?: string[]
      commonConfusions?: string[]
      practiceType?: string
    }>
    sourcePages?: number[]
    difficulty?: number
    importance?: number
    estimatedMinutes?: number
    practiceNeeds?: string[]
    prerequisites?: string[]
    commonMistakes?: string[]
  }>
  centralQuestion?: string
  learningPath?: string[]
  keyInsight?: string
}

export function buildMaterialBlueprint(params: BlueprintBuildParams): MaterialBlueprint {
  const {
    materialId,
    materialTitle,
    materialContent,
    selectedPages,
    extractedTopics,
    centralQuestion,
    learningPath,
    keyInsight,
  } = params

  // Sin topics extraídos → fallback
  if (!extractedTopics || extractedTopics.length === 0) {
    return fallbackBlueprintFromText(materialContent, materialId, materialTitle)
  }

  // Construir temas desde los extraídos
  const topics: MaterialTopic[] = []
  const conceptToTopicMap: Record<string, string> = {}

  for (let i = 0; i < extractedTopics.length; i++) {
    const raw = extractedTopics[i]
    const topicId = uid()

    // Validar título
    if (!raw.title || isGenericTitle(raw.title)) {
      // Intentar rescatar con el primer concepto
      const firstConceptName = raw.concepts?.[0]?.name
      if (!firstConceptName) continue  // saltar temas sin título ni conceptos
      raw.title = firstConceptName
    }

    // Construir conceptos
    const concepts: TopicConcept[] = []
    const seenConcepts = new Set<string>()

    for (const rawConcept of (raw.concepts || [])) {
      if (!rawConcept.name || rawConcept.name.length < 2) continue

      const conceptKey = rawConcept.name.toLowerCase().trim()
      if (seenConcepts.has(conceptKey)) continue
      seenConcepts.add(conceptKey)

      const conceptId = uid()

      const importance = (
        rawConcept.importance === 'critical' ? 'critical' :
        rawConcept.importance === 'major' ? 'major' :
        'supporting'
      ) as TopicConcept['importance']

      const practiceType = (
        rawConcept.practiceType === 'application' ? 'application' :
        rawConcept.practiceType === 'explanation' ? 'explanation' :
        rawConcept.practiceType === 'analysis' ? 'analysis' :
        'recall'
      ) as TopicConcept['practiceType']

      const concept: TopicConcept = {
        id: conceptId,
        name: rawConcept.name,
        definition: rawConcept.definition || `Concepto de ${raw.title}`,
        importance,
        difficulty: Math.min(100, Math.max(0, rawConcept.difficulty ?? 50)),
        sourcePages: rawConcept.sourcePages,
        prerequisites: rawConcept.prerequisites,
        commonConfusions: rawConcept.commonConfusions,
        practiceType,
      }

      concepts.push(concept)
      conceptToTopicMap[conceptId] = topicId
    }

    // No agregar temas sin conceptos
    if (concepts.length === 0) continue

    // Calcular dificultad promedio del tema
    const avgDifficulty = Math.round(
      concepts.reduce((s, c) => s + c.difficulty, 0) / concepts.length
    )

    // Determinar qué práctica necesita
    const practiceNeeds: MaterialTopic['practiceNeeds'] = ['understand']
    if (avgDifficulty > 30) practiceNeeds.push('memorize')
    if (avgDifficulty > 50) practiceNeeds.push('apply')
    if (raw.practiceNeeds) {
      for (const need of raw.practiceNeeds) {
        if (!practiceNeeds.includes(need as any)) {
          practiceNeeds.push(need as any)
        }
      }
    }

      const knowledgeProfile = inferKnowledgeProfile({
        title: raw.title?.trim(),
        description: raw.description || `Tema ${i + 1} del material`,
        concepts,
      })

      const topic: MaterialTopic = {
      id: topicId,
      title: raw.title.trim(),
      subtitle: raw.subtitle,
      description: raw.description || `Tema ${i + 1} del material`,
      order: i + 1,
      concepts,
      sourcePages: raw.sourcePages ?? selectedPages,
      difficulty: raw.difficulty ?? avgDifficulty,
      importance: raw.importance ?? (i === 0 ? 90 : Math.max(40, 80 - i * 10)),
      estimatedMinutes: raw.estimatedMinutes ?? Math.max(10, concepts.length * 4),
      primaryKnowledgeType: knowledgeProfile.primaryKnowledgeType,
      knowledgeTypes: knowledgeProfile.knowledgeTypes,
      practiceNeeds,
      prerequisites: raw.prerequisites,
      commonMistakes: raw.commonMistakes,
      evidenceRequirement: {
        minCorrectAnswers: Math.max(2, Math.ceil(concepts.length * 0.6)),
        requiredEngines: avgDifficulty > 60
          ? ['flashcards', 'quiz', 'alai']
          : ['flashcards', 'quiz'],
        passingScore: avgDifficulty > 70 ? 70 : 60,
        description: `Demostrar comprensión de ${concepts.length} concepto(s) con al menos ${avgDifficulty > 70 ? 70 : 60}% de aciertos`,
      },
    }

    topics.push(topic)
  }

  // Si después de procesar no hay temas válidos → fallback
  if (topics.length === 0) {
    return fallbackBlueprintFromText(materialContent, materialId, materialTitle)
  }

  // Detectar idioma básico
  const spanishWords = ['el', 'la', 'los', 'las', 'de', 'que', 'en', 'con', 'por']
  const contentLower = materialContent.toLowerCase()
  const spanishCount = spanishWords.filter(w => contentLower.includes(` ${w} `)).length
  const language: MaterialBlueprint['language'] = spanishCount > 4 ? 'es' : 'en'

  const blueprint: MaterialBlueprint = {
    id: uid(),
    materialId,
    createdAt: Date.now(),
    version: 1,
    materialTitle,
    totalPages: Math.max(1, Math.round(materialContent.length / 1600)),
    language,
    topics,
    topicCount: topics.length,
    conceptToTopicMap,
    confidence: 80,
    validationPassed: false,   // se llena después de validate
    fallbackUsed: false,
    centralQuestion: centralQuestion || `¿Qué es lo más importante de "${materialTitle}"?`,
    learningPath: learningPath || topics.map(t => t.title),
    keyInsight: keyInsight || topics[0]?.description || '',
  }

  // Validar y marcar resultado
  const validation = validateMaterialBlueprint(blueprint, materialContent.length)
  blueprint.validationPassed = validation.isValid
  blueprint.confidence = Math.round(
    (blueprint.confidence * 0.6) + (validation.score * 0.4)
  )

  // Si la validación falla con errores críticos → fallback
  if (!validation.isValid && validation.errors.length > 0) {
    const fb = fallbackBlueprintFromText(materialContent, materialId, materialTitle)
    return fb
  }


  // ── Coverage real por páginas y conceptos ────────────────────
  try {
    const allTopics = blueprint.topics
    const allConcepts = allTopics.flatMap(t => t.concepts || [])
    const allConceptNames = allConcepts.map(c => c.name.toLowerCase())

    // Páginas cubiertas por topics
    const coveredPageSet = new Set<number>()
    for (const t of allTopics) {
      for (const pg of t.sourcePages || []) coveredPageSet.add(pg)
      for (const concept of t.concepts || []) {
        for (const pg of concept.sourcePages || []) coveredPageSet.add(pg)
      }
    }

    const totalPages = blueprint.totalPages || 1
    const coveredPages = coveredPageSet.size
    const pageCoverage = Math.min(100, Math.round((coveredPages / totalPages) * 100))

    // Coverage de conceptos: cuántos tienen definición real
    const conceptsWithDefinition = allConcepts.filter(c =>
      c.definition && c.definition.length > 10
    ).length
    const conceptCoverage = allConcepts.length > 0
      ? Math.round((conceptsWithDefinition / allConcepts.length) * 100)
      : 0

    // Topic coverage: cuántos topics son reales (no genéricos)
    const realTopics = allTopics.filter(t =>
      !/^(introducción|resumen|general|básico|overview)/i.test(t.title)
    ).length
    const topicCoverage = allTopics.length > 0
      ? Math.round((realTopics / allTopics.length) * 100)
      : 0

    // Score final ponderado
    blueprint.coverageScore = Math.round(
      (pageCoverage * 0.4) +
      (conceptCoverage * 0.35) +
      (topicCoverage * 0.25)
    )

    // Metadata adicional para debug
    ;(blueprint as any).coverageDetail = {
      pageCoverage,
      conceptCoverage,
      topicCoverage,
      coveredPages,
      totalPages,
      realTopics,
      totalTopics: allTopics.length,
    }
  } catch {
    blueprint.coverageScore = 0
  }

  return blueprint
}

// ═══════════════════════════════════════════════════════════════
// FUNCIONES DE TOPIC — usadas por generator, replanner y mastery
// ═══════════════════════════════════════════════════════════════

// ── Obtener nombres de conceptos de un topic ─────────────────
export function getTopicConceptNames(topic: MaterialTopic): string[] {
  return (topic.concepts || []).map(c => c.name)
}

// ── Obtener todos los conceptos del blueprint ─────────────────
export function getAllConcepts(blueprint: MaterialBlueprint): TopicConcept[] {
  return blueprint.topics.flatMap(t => t.concepts || [])
}

// ── Ordenar topics por importancia descendente ────────────────
export function getTopicsByImportance(blueprint: MaterialBlueprint): MaterialTopic[] {
  return [...blueprint.topics].sort((a, b) => (b.importance ?? 50) - (a.importance ?? 50))
}

// ── Ordenar topics por dificultad ────────────────────────────
export function getTopicsByDifficulty(blueprint: MaterialBlueprint): MaterialTopic[] {
  return [...blueprint.topics].sort((a, b) => (b.difficulty ?? 50) - (a.difficulty ?? 50))
}

// ── Encontrar el topic al que pertenece un concepto ──────────
export function getTopicForConcept(
  blueprint: MaterialBlueprint,
  conceptName: string,
): MaterialTopic | null {
  const lower = conceptName.toLowerCase()
  return blueprint.topics.find(t =>
    (t.concepts || []).some(c => c.name.toLowerCase().includes(lower.slice(0, 8)) ||
      lower.includes(c.name.toLowerCase().slice(0, 8)))
  ) ?? null
}

// ── Verificar si un topic está dominado ──────────────────────
export function isTopicDominated(topic: MaterialTopic, scoreMap: Record<string, number>): boolean {
  const concepts = topic.concepts || []
  if (concepts.length === 0) return false
  const scores = concepts.map(c => scoreMap[c.name.toLowerCase()] ?? 0)
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  return avg >= 80
}

// ── Verificar si un topic está débil ────────────────────────
export function isTopicWeak(topic: MaterialTopic, scoreMap: Record<string, number>): boolean {
  const concepts = topic.concepts || []
  if (concepts.length === 0) return false
  const scores = concepts.map(c => scoreMap[c.name.toLowerCase()] ?? 0)
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  return avg < 40
}

// ── Título de sesión desde topic + propósito ─────────────────
export function buildSessionTitle(topic: MaterialTopic, purpose: string): string {
  const purposeLabels: Record<string, string> = {
    understand: 'Entender',
    organize:   'Organizar',
    memorize:   'Memorizar',
    apply:      'Practicar',
    simulate:   'Simular examen',
    repair:     'Reforzar',
  }
  const label = purposeLabels[purpose] || 'Estudiar'
  const shortTitle = topic.title.length > 35
    ? topic.title.slice(0, 33) + '…'
    : topic.title
  return `${label}: ${shortTitle}`
}

// ── Objetivo de sesión desde topic + propósito ───────────────
export function buildSessionObjective(topic: MaterialTopic, purpose: string): string {
  const concepts = (topic.concepts || []).slice(0, 3).map(c => c.name)
  const conceptStr = concepts.length > 0 ? ` (${concepts.join(', ')})` : ''

  const objectives: Record<string, string> = {
    understand: `Comprende las ideas principales de "${topic.title}"${conceptStr}.`,
    organize:   `Conecta y organiza los conceptos de "${topic.title}"${conceptStr}.`,
    memorize:   `Ancla en memoria los conceptos de "${topic.title}"${conceptStr}.`,
    apply:      `Aplica lo aprendido de "${topic.title}"${conceptStr}.`,
    simulate:   `Demuestra tu dominio de "${topic.title}" bajo condiciones de examen.`,
    repair:     `Trabaja específicamente lo que falla en "${topic.title}"${conceptStr}.`,
  }
  return objectives[purpose] || `Estudia "${topic.title}".`
}

// ── Objetivo de evidencia desde topic ────────────────────────
export function buildEvidenceGoal(topic: MaterialTopic): string {
  const concepts = (topic.concepts || []).slice(0, 3).map(c => c.name)
  if (concepts.length === 0) return `Demostrar comprensión de ${topic.title}`
  return `Explicar correctamente: ${concepts.join(', ')}`
}

// ═══════════════════════════════════════════════════════════════
// TOPIC MASTERY — calcular dominio por tema desde conceptos
// ═══════════════════════════════════════════════════════════════

export interface TopicMasteryScore {
  topicId: string
  topicTitle: string
  score: number
  conceptCount: number
  coveredCount: number
  dominated: boolean
  weak: boolean
  critical: boolean
  strongConcepts: string[]
  weakConcepts: string[]
}

// Construir mapa de nombre de concepto → score (0-100)
export function buildConceptScoreMap(
  concepts: Array<{ name: string; understanding?: number; memory?: number; application?: number; confidence?: number }>
): Record<string, number> {
  const map: Record<string, number> = {}
  for (const c of concepts) {
    const score = Math.round(
      ((c.understanding ?? 0) * 0.35) +
      ((c.memory ?? 0) * 0.25) +
      ((c.application ?? 0) * 0.25) +
      ((c.confidence ?? 0) * 0.15)
    )
    map[c.name.toLowerCase()] = score
  }
  return map
}

// Calcular dominio de cada topic del blueprint
export function calculateTopicMastery(
  blueprint: MaterialBlueprint,
  scoreMap: Record<string, number>,
): TopicMasteryScore[] {
  return blueprint.topics.map(topic => {
    const concepts = topic.concepts || []
    const scores = concepts.map(c => scoreMap[c.name.toLowerCase()] ?? 0)
    const coveredCount = scores.filter(s => s > 0).length
    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0

    const strongConcepts = concepts
      .filter((c, i) => (scores[i] ?? 0) >= 70)
      .map(c => c.name)
    const weakConcepts = concepts
      .filter((c, i) => (scores[i] ?? 0) < 40)
      .map(c => c.name)

    return {
      topicId: topic.id,
      topicTitle: topic.title,
      score: avgScore,
      conceptCount: concepts.length,
      coveredCount,
      dominated: avgScore >= 80,
      weak: avgScore < 40 && avgScore >= 20,
      critical: avgScore < 20,
      strongConcepts,
      weakConcepts,
    }
  })
}

// Filtrar topics débiles (20-40%)
export function getWeakTopics(topicMastery: TopicMasteryScore[]): TopicMasteryScore[] {
  return [...topicMastery].filter(t => t.weak).sort((a, b) => a.score - b.score)
}

// Filtrar topics críticos (< 20%)
export function getCriticalTopics(topicMastery: TopicMasteryScore[]): TopicMasteryScore[] {
  return [...topicMastery].filter(t => t.critical).sort((a, b) => a.score - b.score)
}

// Filtrar topics dominados (>= 80%)
export function getDominatedTopics(topicMastery: TopicMasteryScore[]): TopicMasteryScore[] {
  return [...topicMastery].filter(t => t.dominated)
}

// Calcular dominio global del blueprint
export function calculateBlueprintOverallMastery(
  topicMastery: TopicMasteryScore[],
): number {
  if (topicMastery.length === 0) return 0
  const weighted = topicMastery.reduce((sum, t) => sum + t.score, 0)
  return Math.round(weighted / topicMastery.length)
}
