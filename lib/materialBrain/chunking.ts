import type { PageChunk, ResolvedSourceMaterial } from './types'

// ============================================================
// Chunking page-aware, multi-material.
//
// Reglas obligatorias (encargo):
//  - nunca corta una página a la mitad
//  - nunca mezcla texto de dos materiales en el mismo chunk
//  - cada chunk conoce exactamente qué material y qué páginas cubre
//  - procesamiento incremental para materiales grandes (chunks
//    acotados en tamaño, nunca "todo el documento en cada llamada")
//
// B. Chunking más conservador (misión real-material):
//
//    El chunk size se redujo de 6000 → 3500 chars para reducir el
//    tamaño esperado de cada extracción y disminuir truncaciones.
//
//    El objetivo es dividir mejor el trabajo, no estudiar menos:
//    - el contenido total sigue procesándose completo
//    - páginas densas producen más chunks (más llamadas LLM)
//    - provenance materialId+page se preserva en cada chunk
//    - NO hay cap global de KnowledgeUnits
//
//    MAX_PAGE_CHARS_BEFORE_SPLIT: páginas muy densas (>3500 chars)
//    se dividen en sub-chunks preservando el número de página.
//    Cada sub-chunk lleva el mismo page number porque proviene de
//    la misma página — la cobertura se mide por (materialId, page),
//    no por sub-chunk.
// ============================================================

const PAGE_MARKER = /\[(?:P[aá]gina|Pagina|Page)\s+(\d+)\]/gi

export interface PageSegment {
  page: number
  text: string
}

/** Divide un texto ya autorizado en páginas, usando los mismos marcadores que ya produce filterTextToSelectedPages/[Pagina N]. */
export function splitIntoPages(text: string, fallbackPage?: number): PageSegment[] {
  const source = String(text || '')
  if (!source.trim()) return []

  const formFeedPages = source.split('\f')
  if (formFeedPages.length > 1) {
    return formFeedPages
      .map((pageText, index) => ({ page: index + 1, text: pageText.trim() }))
      .filter(segment => segment.text.length > 0)
  }

  const matches = [...source.matchAll(PAGE_MARKER)]
  if (matches.length > 0) {
    const segments: PageSegment[] = []
    for (let index = 0; index < matches.length; index++) {
      const page = Number(matches[index][1])
      const start = matches[index].index!
      const end = index + 1 < matches.length ? matches[index + 1].index! : source.length
      const segmentText = source.slice(start, end).trim()
      if (segmentText) segments.push({ page, text: segmentText })
    }
    return segments
  }

  return [{ page: fallbackPage ?? 1, text: source.trim() }]
}

/**
 * Divide el texto de una página densa en sub-segmentos de hasta
 * `maxChars` caracteres, cortando únicamente en límites de párrafo
 * (líneas vacías). Si no hay párrafos, corta en el límite de chars.
 *
 * Preserva el page number original — cada sub-segmento pertenece
 * a la misma página fuente.
 *
 * NO pierde contenido: la concatenación de los textos de todos los
 * sub-segmentos es idéntica al texto original (modulo whitespace de
 * unión).
 */
function splitDensePage(segment: PageSegment, maxChars: number): PageSegment[] {
  const text = segment.text
  if (text.length <= maxChars) return [segment]

  const paragraphs = text.split(/\n{2,}/)
  const subSegments: PageSegment[] = []
  let current = ''

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (candidate.length > maxChars && current.length > 0) {
      subSegments.push({ page: segment.page, text: current.trim() })
      current = paragraph
    } else {
      current = candidate
    }
  }
  if (current.trim()) {
    subSegments.push({ page: segment.page, text: current.trim() })
  }

  // Si la página no tenía párrafos y es mayor que maxChars,
  // cortar por longitud en el límite de palabra más cercano
  if (subSegments.length === 0) {
    let pos = 0
    while (pos < text.length) {
      let end = Math.min(pos + maxChars, text.length)
      if (end < text.length) {
        // Retroceder al último espacio para no cortar palabras
        const lastSpace = text.lastIndexOf(' ', end)
        if (lastSpace > pos) end = lastSpace
      }
      subSegments.push({ page: segment.page, text: text.slice(pos, end).trim() })
      pos = end
    }
  }

  return subSegments.filter(s => s.text.length > 0)
}

/**
 * Provider-facing extraction segments. The outer cN chunk remains the durable
 * coverage unit; these deterministic children bound each JSON response.
 * Page boundaries are preferred, followed by paragraph/line/sentence boundaries.
 */
export const DEFAULT_EXTRACTION_SUBCHUNK_CHARS = 1200

function splitAcademicSegment(segment: PageSegment, maxChars: number): PageSegment[] {
  if (segment.text.length <= maxChars) return [segment]
  const boundaries = segment.text
    .split(/(?:\n{2,}|(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡]))/)
    .map(text => text.trim())
    .filter(Boolean)
  if (boundaries.length <= 1) return splitDensePage(segment, maxChars)
  const result: PageSegment[] = []
  let current = ''
  for (const boundary of boundaries) {
    if (boundary.length > maxChars) {
      if (current) result.push({ page: segment.page, text: current })
      result.push(...splitDensePage({ page: segment.page, text: boundary }, maxChars))
      current = ''
      continue
    }
    const candidate = current ? `${current}\n\n${boundary}` : boundary
    if (current && candidate.length > maxChars) {
      result.push({ page: segment.page, text: current })
      current = boundary
    } else current = candidate
  }
  if (current) result.push({ page: segment.page, text: current })
  return result
}

export function splitExtractionSubchunks(
  chunk: PageChunk,
  maxChars = DEFAULT_EXTRACTION_SUBCHUNK_CHARS,
): PageChunk[] {
  if (chunk.sourceKind === 'vision' || chunk.text.length <= maxChars) return [chunk]
  const pageSegments = splitIntoPages(chunk.text)
    .flatMap(segment => splitAcademicSegment(segment, maxChars))
  const groups: PageSegment[][] = []
  let current: PageSegment[] = []
  let currentChars = 0
  const flush = () => {
    if (current.length) groups.push(current)
    current = []; currentChars = 0
  }
  for (const segment of pageSegments) {
    if (current.length && currentChars + segment.text.length > maxChars) flush()
    current.push(segment); currentChars += segment.text.length
  }
  flush()
  return groups.map((segments, index) => ({
    id: `${chunk.id}:s${index}`,
    materialId: chunk.materialId,
    pages: [...new Set(segments.map(segment => segment.page))],
    order: chunk.order,
    text: segments.map(segment => {
      const withoutMarker = segment.text.replace(/^\[(?:P[aá]gina|Pagina|Page)\s+\d+\]\s*/i, '')
      return `[Pagina ${segment.page}]\n${withoutMarker}`
    }).join('\n\n'),
    sourceKind: 'text',
  }))
}

export interface ChunkingOptions {
  chunkSizeChars?: number
}

/**
 * Tamaño de chunk reducido de 6000 → 3500 chars.
 *
 * Razón: materiales/PDFs reales con contenido denso producían outputs
 * LLM demasiado grandes con el chunk de 6000, causando truncaciones
 * frecuentes. Con 3500 chars el output esperado por chunk es más
 * manejable para los modelos usados.
 *
 * El contenido total sigue procesándose completo — páginas densas
 * generan más chunks, no menos cobertura.
 */
export const DEFAULT_CHUNK_SIZE_CHARS = 3500

/**
 * Umbral a partir del cual una página individual se divide en
 * sub-chunks antes de agrupar con otras páginas.
 * Mismo valor que DEFAULT_CHUNK_SIZE_CHARS para consistencia.
 */
const MAX_PAGE_CHARS_BEFORE_SPLIT = DEFAULT_CHUNK_SIZE_CHARS

/**
 * Agrupa páginas consecutivas de UN material en chunks de hasta
 * `chunkSizeChars`, sin partir ninguna página (a menos que sea
 * densa — ver splitDensePage). Una página más grande que el tamaño
 * objetivo se divide en sub-chunks que preservan el page number.
 */
export function chunkMaterial(
  material: ResolvedSourceMaterial,
  options: ChunkingOptions = {},
): PageChunk[] {
  const chunkSizeChars = options.chunkSizeChars ?? DEFAULT_CHUNK_SIZE_CHARS
  const fallbackPage = material.knownPages?.length === 1 ? material.knownPages[0] : undefined
  const rawPages = splitIntoPages(material.text, fallbackPage)

  // B. Dividir páginas densas en sub-segmentos antes de agrupar
  const pages: PageSegment[] = rawPages.flatMap(segment =>
    splitDensePage(segment, MAX_PAGE_CHARS_BEFORE_SPLIT),
  )

  const chunks: PageChunk[] = []
  let current: PageSegment[] = []
  let currentChars = 0
  let chunkIndex = 0

  const flush = () => {
    if (!current.length) return
    // Páginas únicas en el chunk (puede haber sub-segmentos de la misma página)
    const uniquePages = [...new Set(current.map(s => s.page))]
    chunks.push({
      id: `${material.materialId}_c${chunkIndex}`,
      materialId: material.materialId,
      pages: uniquePages,
      order: chunkIndex,
      text: current.map(segment => `[Pagina ${segment.page}]\n${segment.text}`).join('\n\n'),
      sourceKind: 'text',
    })
    chunkIndex++
    current = []
    currentChars = 0
  }

  for (const segment of pages) {
    const segmentSize = segment.text.length
    if (current.length > 0 && currentChars + segmentSize > chunkSizeChars) {
      flush()
    }
    current.push(segment)
    currentChars += segmentSize
  }
  flush()

  return chunks
}

/**
 * Construye los chunks de TODOS los materiales del scope, en orden
 * determinístico (orden de materialIds), asignando un `order` global
 * — pero cada chunk sigue perteneciendo a un solo material.
 */
export function chunkMaterials(
  materials: ResolvedSourceMaterial[],
  options: ChunkingOptions = { chunkSizeChars: DEFAULT_CHUNK_SIZE_CHARS },
): PageChunk[] {
  const all: PageChunk[] = []
  let globalOrder = 0
  for (const material of materials) {
    const materialChunks = chunkMaterial(material, options)
    for (const chunk of materialChunks) {
      all.push({ ...chunk, order: globalOrder })
      globalOrder++
    }
  }
  return all
}
