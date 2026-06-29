// ═══════════════════════════════════════════════════════════════
// StudyAL — Blueprint Chunker
// Para materiales largos: divide → extrae por partes → merge.
// Garantiza que no se pierdan temas del final del documento.
// ═══════════════════════════════════════════════════════════════

export interface TextChunk {
  index: number
  content: string
  startChar: number
  endChar: number
  estimatedPages: number[]
}

// ── Configuración ────────────────────────────────────────────────
const CHUNK_SIZE = 14000      // chars por chunk (seguro para el LLM)
const CHUNK_OVERLAP = 1200    // overlap para no cortar ideas a la mitad
const CHARS_PER_PAGE = 1600   // estimado para calcular páginas

// ═══════════════════════════════════════════════════════════════
// SPLIT EN CHUNKS
// Intenta cortar en párrafos/secciones naturales.
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// DETECTOR DE PÁGINAS REALES
// Busca delimitadores: \f, [Pagina N], [Page N], --- página N ---
// Si los encuentra, los usa como cortes naturales.
// ═══════════════════════════════════════════════════════════════

export interface PageMap {
  pageNumber: number
  startChar: number
  endChar: number
}

export function detectRealPages(text: string): PageMap[] {
  const pages: PageMap[] = []

  // Patrones de inicio de página
  const patterns = [
    //g,                                    // form feed
    /[P[aá]gina?s*(d+)]/gi,              // [Pagina N] [Página N]
    /[Pages*(d+)]/gi,                     // [Page N]
    /---s*p[aá]gina?s*(d+)s*---/gi,      // --- página N ---
    /---s*pages*(d+)s*---/gi,            // --- page N ---
    /^#{1,3}s*d+.s/gm,                   // ## 1. Sección numerada
  ]

  const hits: Array<{ pos: number; page: number }> = []

  // Form feed — cada  es una nueva página
  let ffMatch
  const ffRegex = //g
  let ffPage = 1
  while ((ffMatch = ffRegex.exec(text)) !== null) {
    hits.push({ pos: ffMatch.index, page: ffPage++ })
  }

  // Patrones explícitos de número de página
  const namedPatterns = patterns.slice(1)
  for (const pattern of namedPatterns) {
    let m
    while ((m = pattern.exec(text)) !== null) {
      const pageNum = m[1] ? parseInt(m[1]) : hits.length + 1
      if (!isNaN(pageNum)) {
        hits.push({ pos: m.index, page: pageNum })
      }
    }
  }

  if (hits.length === 0) return [] // sin páginas reales detectadas

  // Ordenar por posición
  hits.sort((a, b) => a.pos - b.pos)

  // Deduplicar hits muy cercanos (< 100 chars)
  const deduped: typeof hits = [hits[0]]
  for (let i = 1; i < hits.length; i++) {
    if (hits[i].pos - deduped[deduped.length - 1].pos > 100) {
      deduped.push(hits[i])
    }
  }

  // Construir PageMap
  for (let i = 0; i < deduped.length; i++) {
    const start = deduped[i].pos
    const end = i + 1 < deduped.length ? deduped[i + 1].pos : text.length
    pages.push({
      pageNumber: deduped[i].page,
      startChar: start,
      endChar: end,
    })
  }

  return pages
}

// Extraer texto de páginas específicas usando el PageMap real
export function extractPageSlice(
  text: string,
  pageNumbers: number[],
  pageMap: PageMap[],
  maxChars = 6000,
): string {
  if (pageMap.length === 0 || pageNumbers.length === 0) return ''

  const prefix = text.slice(0, 600) // contexto inicial siempre
  const slices: string[] = []

  for (const pageNum of pageNumbers) {
    const page = pageMap.find(p => p.pageNumber === pageNum)
    if (!page) continue
    slices.push(text.slice(page.startChar, page.endChar))
  }

  if (slices.length === 0) return ''

  const combined = prefix + '\n\n' + slices.join('\n\n---\n\n')
  return combined.slice(0, maxChars)
}

export function splitIntoChunks(text: string): TextChunk[] {
  // Texto corto → un solo chunk
  if (text.length <= CHUNK_SIZE) {
    return [{
      index: 0,
      content: text,
      startChar: 0,
      endChar: text.length,
      estimatedPages: estimatePages(0, text.length),
    }]
  }

  // ── Intentar usar páginas reales primero ─────────────────────
  const realPages = detectRealPages(text)

  if (realPages.length >= 2) {
    console.log(`[Chunker] ${realPages.length} páginas reales detectadas`)
    return buildChunksFromPages(text, realPages)
  }

  // ── Fallback: corte por tamaño con puntos naturales ──────────
  const chunks: TextChunk[] = []
  let start = 0
  let chunkIndex = 0

  while (start < text.length) {
    const rawEnd = Math.min(start + CHUNK_SIZE, text.length)
    const end = findNaturalBreak(text, rawEnd, start + CHUNK_SIZE * 0.7)

    chunks.push({
      index: chunkIndex++,
      content: text.slice(start, end),
      startChar: start,
      endChar: end,
      estimatedPages: estimatePages(start, end),
    })

    start = Math.max(start + 1, end - CHUNK_OVERLAP)
    if (start >= text.length) break
  }

  return chunks
}

// Agrupar páginas reales en chunks del tamaño correcto
function buildChunksFromPages(text: string, pages: PageMap[]): TextChunk[] {
  const chunks: TextChunk[] = []
  let chunkIndex = 0
  let i = 0

  while (i < pages.length) {
    const startPage = pages[i]
    let endPage = pages[i]
    let chunkLen = 0

    // Agrupar páginas hasta llenar CHUNK_SIZE
    let j = i
    while (j < pages.length) {
      const pageLen = pages[j].endChar - pages[j].startChar
      if (chunkLen + pageLen > CHUNK_SIZE && j > i) break
      endPage = pages[j]
      chunkLen += pageLen
      j++
    }

    const startChar = startPage.startChar
    const endChar = Math.min(endPage.endChar, text.length)
    const pageNumbers = pages.slice(i, j).map(p => p.pageNumber)

    chunks.push({
      index: chunkIndex++,
      content: text.slice(startChar, endChar),
      startChar,
      endChar,
      estimatedPages: pageNumbers,
    })

    i = j
  }

  return chunks
}

// Buscar un punto de corte natural cerca del target
function findNaturalBreak(text: string, target: number, minCut: number): number {
  if (target >= text.length) return text.length

  // Buscar doble salto de línea hacia atrás desde target
  for (let i = target; i > minCut; i--) {
    if (text[i] === '\n' && text[i - 1] === '\n') return i
  }

  // Buscar salto de línea simple
  for (let i = target; i > minCut; i--) {
    if (text[i] === '\n') return i
  }

  // Buscar punto + espacio
  for (let i = target; i > minCut; i--) {
    if (text[i] === '.' && (text[i + 1] === ' ' || text[i + 1] === '\n')) return i + 1
  }

  return target
}

// Estimar qué páginas cubre este chunk
function estimatePages(startChar: number, endChar: number): number[] {
  const startPage = Math.floor(startChar / CHARS_PER_PAGE) + 1
  const endPage = Math.floor(endChar / CHARS_PER_PAGE) + 1
  const pages: number[] = []
  for (let p = startPage; p <= endPage; p++) pages.push(p)
  return pages
}

// ═══════════════════════════════════════════════════════════════
// MERGE DE TOPICS EXTRAÍDOS DE MÚLTIPLES CHUNKS
// Reglas:
//   1. Topics con título similar → fusionar (el que tiene más conceptos gana)
//   2. Conceptos duplicados → deduplicar por nombre normalizado
//   3. sourcePages → unir todos los rangos
//   4. difficulty/importance → promedio ponderado
// ═══════════════════════════════════════════════════════════════

export interface RawTopic {
  title: string
  subtitle?: string
  description: string
  difficulty: number
  importance: number
  estimatedMinutes: number
  practiceNeeds: string[]
  commonMistakes: string[]
  sourcePages?: number[]
  concepts: RawConcept[]
}

export interface RawConcept {
  name: string
  definition: string
  importance: 'critical' | 'major' | 'supporting'
  difficulty: number
  practiceType: string
  commonConfusions?: string[]
  sourcePages?: number[]
}

export function mergeTopicsFromChunks(
  chunkResults: Array<{ topics: RawTopic[]; chunkIndex: number }>,
): RawTopic[] {
  if (chunkResults.length === 0) return []
  if (chunkResults.length === 1) return chunkResults[0].topics

  // Aplanar todos los topics con su chunk origen
  const allTopics: Array<RawTopic & { chunkIndex: number }> = []
  for (const result of chunkResults) {
    for (const topic of result.topics) {
      allTopics.push({ ...topic, chunkIndex: result.chunkIndex })
    }
  }

  // Agrupar topics similares
  const groups: Array<Array<RawTopic & { chunkIndex: number }>> = []

  for (const topic of allTopics) {
    const existingGroup = groups.find(g =>
      isSimilarTopic(g[0].title, topic.title)
    )
    if (existingGroup) {
      existingGroup.push(topic)
    } else {
      groups.push([topic])
    }
  }

  // Merge de cada grupo
  return groups.map(group => mergeTopicGroup(group)).filter(t => t.concepts.length > 0)
}

// Comparar si dos títulos son del mismo tema
function isSimilarTopic(a: string, b: string): boolean {
  const normalize = (s: string) => s
    .toLowerCase()
    .replace(/[^a-záéíóúñ\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 3)

  const wordsA = normalize(a)
  const wordsB = normalize(b)

  if (wordsA.length === 0 || wordsB.length === 0) return false

  // Calcular overlap
  const shared = wordsA.filter(w => wordsB.includes(w))
  const overlapRatio = shared.length / Math.min(wordsA.length, wordsB.length)

  return overlapRatio >= 0.5
}

// Fusionar un grupo de topics similares en uno solo
function mergeTopicGroup(group: RawTopic[]): RawTopic {
  // El que tiene más conceptos es el "master"
  const master = [...group].sort((a, b) => b.concepts.length - a.concepts.length)[0]

  // Unir todos los conceptos y deduplicar
  const allConcepts: RawConcept[] = []
  for (const topic of group) {
    allConcepts.push(...topic.concepts)
  }
  const dedupedConcepts = deduplicateConcepts(allConcepts)

  // Unir sourcePages
  const allPages: number[] = []
  for (const topic of group) {
    if (topic.sourcePages) allPages.push(...topic.sourcePages)
  }
  const uniquePages = [...new Set(allPages)].sort((a, b) => a - b)

  // Promediar difficulty e importance
  const avgDifficulty = Math.round(
    group.reduce((sum, t) => sum + t.difficulty, 0) / group.length
  )
  const avgImportance = Math.round(
    group.reduce((sum, t) => sum + t.importance, 0) / group.length
  )
  const totalMinutes = Math.min(60,
    Math.round(group.reduce((sum, t) => sum + t.estimatedMinutes, 0) / group.length)
  )

  // Unir commonMistakes deduplicados
  const allMistakes = [...new Set(
    group.flatMap(t => t.commonMistakes || [])
  )].slice(0, 4)

  return {
    title: master.title,
    subtitle: master.subtitle,
    description: master.description,
    difficulty: avgDifficulty,
    importance: avgImportance,
    estimatedMinutes: totalMinutes,
    practiceNeeds: master.practiceNeeds,
    commonMistakes: allMistakes,
    sourcePages: uniquePages.length > 0 ? uniquePages : undefined,
    concepts: dedupedConcepts,
  }
}

// Deduplicar conceptos por nombre normalizado
function deduplicateConcepts(concepts: RawConcept[]): RawConcept[] {
  const seen = new Map<string, RawConcept>()

  for (const concept of concepts) {
    const key = normalizeName(concept.name)
    if (!seen.has(key)) {
      seen.set(key, concept)
    } else {
      // Si el nuevo tiene mejor definición (más larga), reemplazar
      const existing = seen.get(key)!
      if (concept.definition.length > existing.definition.length) {
        seen.set(key, {
          ...concept,
          sourcePages: mergePages(existing.sourcePages, concept.sourcePages),
        })
      }
    }
  }

  return Array.from(seen.values()).slice(0, 40) // máx 40 conceptos totales
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-záéíóúñ\s]/g, '').trim()
}

function mergePages(a?: number[], b?: number[]): number[] | undefined {
  if (!a && !b) return undefined
  return [...new Set([...(a || []), ...(b || [])])].sort((x, y) => x - y)
}

// ═══════════════════════════════════════════════════════════════
// VALIDAR QUE EL MERGE TIENE SENTIDO
// ═══════════════════════════════════════════════════════════════

export interface MergeValidation {
  isValid: boolean
  topicCount: number
  conceptCount: number
  warnings: string[]
}

export function validateMergedTopics(topics: RawTopic[]): MergeValidation {
  const warnings: string[] = []

  if (topics.length === 0) {
    return { isValid: false, topicCount: 0, conceptCount: 0, warnings: ['Sin topics'] }
  }

  const conceptCount = topics.reduce((sum, t) => sum + t.concepts.length, 0)

  if (topics.length > 10) {
    warnings.push(`Demasiados topics (${topics.length}) — considera reducir`)
  }

  if (conceptCount < 3) {
    warnings.push(`Muy pocos conceptos (${conceptCount})`)
  }

  const generic = topics.filter(t =>
    /^(introducción|resumen|conclusión|general|básicos?|overview)/i.test(t.title)
  )
  if (generic.length > 0) {
    warnings.push(`Topics genéricos detectados: ${generic.map(t => t.title).join(', ')}`)
  }

  return {
    isValid: topics.length >= 1 && conceptCount >= 2,
    topicCount: topics.length,
    conceptCount,
    warnings,
  }
}
