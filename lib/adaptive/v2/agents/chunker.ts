// ═══════════════════════════════════════════════════════════════
// AGENTE 1 — CHUNKER
// 
// Divide el material en chunks manejables.
// NO usa LLM. Es lógica JS pura.
// 
// Estrategia:
// 1. Detectar estructura natural (párrafos, títulos, secciones)
// 2. Chunks entre 2000-4000 caracteres
// 3. Overlap de ~200 chars entre chunks para no perder contexto
// 4. Nunca cortar a mitad de oración
// ═══════════════════════════════════════════════════════════════

export interface Chunk {
  id: string
  order: number
  text: string
  charCount: number
  wordCount: number
  estimatedTokens: number    // aprox 4 chars = 1 token
  metadata: {
    startPage?: number
    endPage?: number
    hasHeadings: boolean
    hasNumbers: boolean       // Detección temprana de material matemático
    hasFormulas: boolean
    detectedSections: string[]
  }
}

export interface ChunkingResult {
  chunks: Chunk[]
  totalChunks: number
  totalChars: number
  totalWords: number
  estimatedTotalTokens: number
  materialSize: 'tiny' | 'small' | 'medium' | 'large' | 'huge'
  recommendedParallelism: number
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════
const TARGET_CHUNK_SIZE = 3000       // Tamaño ideal en chars
const MAX_CHUNK_SIZE = 4500          // Máximo antes de forzar corte
const MIN_CHUNK_SIZE = 1500          // Mínimo (si es más pequeño, mergear)
const OVERLAP_SIZE = 200             // Overlap entre chunks consecutivos

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export function chunkMaterial(text: string, materialTitle?: string): ChunkingResult {
  const cleanText = normalizeText(text)
  const totalChars = cleanText.length

  // Material muy pequeño → 1 chunk único
  if (totalChars <= MAX_CHUNK_SIZE) {
    const chunk = buildChunk(cleanText, 0, 0)
    return {
      chunks: [chunk],
      totalChunks: 1,
      totalChars,
      totalWords: chunk.wordCount,
      estimatedTotalTokens: chunk.estimatedTokens,
      materialSize: getSizeCategory(totalChars),
      recommendedParallelism: 1,
    }
  }

  // Material grande → dividir por estructura natural
  const chunks = splitByStructure(cleanText)
  
  // Enriquecer con metadata
  const enrichedChunks = chunks.map((text, i) => buildChunk(text, i, findApproximatePage(text, cleanText)))

  const totalWords = enrichedChunks.reduce((sum, c) => sum + c.wordCount, 0)
  const estimatedTotalTokens = enrichedChunks.reduce((sum, c) => sum + c.estimatedTokens, 0)

  return {
    chunks: enrichedChunks,
    totalChunks: enrichedChunks.length,
    totalChars,
    totalWords,
    estimatedTotalTokens,
    materialSize: getSizeCategory(totalChars),
    recommendedParallelism: Math.min(enrichedChunks.length, 5),
  }
}

// ═══════════════════════════════════════════════════════════════
// LIMPIAR Y NORMALIZAR TEXTO
// ═══════════════════════════════════════════════════════════════
function normalizeText(text: string): string {
  let cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')                // Espacios múltiples → 1
    .replace(/ +\n/g, '\n')                 // Espacios antes de newline

  // ─── Eliminar headers/footers repetidos de PDFs ───
  // (copyright, títulos de página, etc. que aparecen en cada slide)
  cleaned = removeRepeatedLines(cleaned)

  // ─── Unir fragmentos rotos por OCR ───
  // Ej: "H\n2\nO" → "H2O", "10^-\n14" → "10^-14"
  cleaned = joinBrokenTokens(cleaned)

  // ─── Remover metadata académica (autores, instituciones, roles) ───
  cleaned = removeAuthorAndInstitutionLines(cleaned)

  cleaned = cleaned
    .replace(/\n{4,}/g, '\n\n\n')          // Max 3 saltos de línea
    .trim()

  return cleaned
}

/**
 * Elimina líneas que se repiten 3+ veces (típico de headers/footers de PDF).
 * Ej: "© 2009 Prentice-Hall Inc.  Todos los derechos reservados."
 * o títulos de sección repetidos en cada slide.
 */
function removeRepeatedLines(text: string): string {
  const lines = text.split('\n')
  const counts = new Map<string, number>()

  // Contar ocurrencias de cada línea (normalizada)
  for (const line of lines) {
    const key = line.trim().toLowerCase()
    if (key.length < 5 || key.length > 200) continue  // Ignorar muy cortas o muy largas
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  // Identificar líneas basura: aparecen 3+ veces
  const junk = new Set<string>()
  for (const [key, count] of counts) {
    if (count >= 3) junk.add(key)
  }

  if (junk.size === 0) return text

  // Filtrar líneas basura
  const filtered = lines.filter(line => {
    const key = line.trim().toLowerCase()
    return !junk.has(key)
  })

  return filtered.join('\n')
}

/**
 * Une tokens fragmentados por OCR de PDF.
 * Casos típicos:
 * - "H\n2\nO" → "H2O" (subíndices en línea aparte)
 * - "10^-\n14" → "10^-14" (exponentes rotos)
 * - "(l)\n+" → "(l)+" (signos separados)
 */
function joinBrokenTokens(text: string): string {
  let s = text

  // Letra sola o número solo en línea propia → pegarlo a la línea anterior
  // Ej: "H\n2\nO" → "H2O"
  // Aplicar varias veces para casos anidados
  for (let i = 0; i < 3; i++) {
    // Línea de 1-2 chars (dígito o símbolo) pegada a la anterior si termina en letra/número
    s = s.replace(/([A-Za-z0-9\]\)])\n(\d{1,2})\n/g, '$1$2\n')
    // Signo +/- en línea propia entre letras/números
    s = s.replace(/([A-Za-z0-9\]\)])\n([+\-])\n/g, '$1$2\n')
  }

  return s
}

/**
 * Remueve líneas típicas de metadata académica del PDF que no aportan al contenido:
 * - Nombres de autores/facilitadores/profesores
 * - Nombres de instituciones (Universidad X, Facultad Y)
 * - Roles con ":" (FACILITADOR: NOMBRE)
 * - Departamentos, cátedras, licenciaturas
 */
function removeAuthorAndInstitutionLines(text: string): string {
  const lines = text.split('\n')

  const isMetadataLine = (line: string): boolean => {
    const t = line.trim()
    if (t.length === 0 || t.length > 150) return false

    // Nombres con título académico: Dr, Dra, Msc, Prof, PhD, Lic
    if (/^(dra?\.?|msc\.?|phd\.?|prof\.?|lic\.?|licenciad[oa])\s+[A-ZÁÉÍÓÚÑ]/i.test(t)) return true

    // Roles con dos puntos: FACILITADOR: XX, PROFESOR: XX, AUTOR: XX
    if (/^(facilitador|profesor[a]?|autor[a]?|catedr[áa]tic[oa]|instructor[a]?|coordinador[a]?|expositor[a]?)\s*:/i.test(t)) return true

    // Instituciones educativas
    if (/^(universidad|facultad|escuela|instituto|colegio|licenciatura|departamento|c[áa]tedra)\s+(de\s+|del\s+|nacional|latina|autónoma|latinoamericana)/i.test(t)) return true

    // "Doctor Medicina y Cirugía" (títulos de carrera)
    if (/^(doctor|doctora|maestría|licenciatura|especialización)\s+(en\s+)?[A-ZÁÉÍÓÚ]/i.test(t)) return true

    // Números de módulo/capítulo sueltos
    if (/^(m[óo]dulo|cap[íi]tulo|unidad|tema|lecci[óo]n|slide|p[áa]gina)\s+\d+$/i.test(t)) return true

    return false
  }

  const filtered = lines.filter(line => !isMetadataLine(line))
  return filtered.join('\n')
}

// ═══════════════════════════════════════════════════════════════
// DIVIDIR POR ESTRUCTURA NATURAL
// ═══════════════════════════════════════════════════════════════
function splitByStructure(text: string): string[] {
  const chunks: string[] = []
  
  // Estrategia 1: dividir por títulos (líneas cortas que parecen encabezados)
  const sections = detectSections(text)
  
  if (sections.length > 1) {
    // Hay secciones detectadas → agrupar hasta llegar al tamaño objetivo
    let currentChunk = ''
    for (const section of sections) {
      const withOverlap = currentChunk 
        ? currentChunk + '\n\n' + section
        : section

      if (withOverlap.length > MAX_CHUNK_SIZE && currentChunk.length >= MIN_CHUNK_SIZE) {
        chunks.push(currentChunk)
        // Comenzar nuevo chunk con overlap
        const overlap = getOverlap(currentChunk)
        currentChunk = overlap + '\n\n' + section
      } else if (withOverlap.length > MAX_CHUNK_SIZE) {
        // Sección sola es demasiado grande → dividir por párrafos
        const subChunks = splitByParagraphs(withOverlap)
        chunks.push(...subChunks.slice(0, -1))
        currentChunk = subChunks[subChunks.length - 1] || ''
      } else {
        currentChunk = withOverlap
      }
    }
    if (currentChunk.length > 0) chunks.push(currentChunk)
  } else {
    // Sin secciones detectadas → dividir por párrafos
    return splitByParagraphs(text)
  }

  // Filtrar chunks vacíos o demasiado pequeños
  return chunks.filter(c => c.trim().length >= 100)
}

// ═══════════════════════════════════════════════════════════════
// DETECTAR SECCIONES (líneas que parecen títulos)
// ═══════════════════════════════════════════════════════════════
function detectSections(text: string): string[] {
  const lines = text.split('\n')
  const sections: string[] = []
  let currentSection = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const isHeading = looksLikeHeading(line, i > 0 ? lines[i - 1] : '', i < lines.length - 1 ? lines[i + 1] : '')

    if (isHeading && currentSection.trim().length >= MIN_CHUNK_SIZE / 3) {
      // Cerrar sección actual, empezar nueva
      sections.push(currentSection.trim())
      currentSection = line + '\n'
    } else {
      currentSection += line + '\n'
    }
  }

  if (currentSection.trim()) sections.push(currentSection.trim())
  return sections.length > 1 ? sections : [text]
}

// ═══════════════════════════════════════════════════════════════
// DETECTAR SI UNA LÍNEA PARECE UN TÍTULO
// ═══════════════════════════════════════════════════════════════
function looksLikeHeading(line: string, prevLine: string, nextLine: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length === 0) return false
  if (trimmed.length > 100) return false            // Muy larga → no es título
  if (trimmed.length < 3) return false              // Muy corta

  // Patrones típicos de títulos
  const patterns = [
    /^(chapter|capítulo|tema|sección|section|parte|part|unidad|unit)\s+\d+/i,
    /^\d+\.\d*\s+[A-ZÁÉÍÓÚ]/,                       // "1.2 Título"
    /^\d+\)\s+[A-ZÁÉÍÓÚ]/,                          // "1) Título"
    /^[IVX]+\.\s+/,                                  // Romanos "II. Título"
    /^[A-ZÁÉÍÓÚ][A-ZÁÉÍÓÚ\s]{3,}$/,                 // TODO EN MAYÚSCULAS
    /^#{1,6}\s/,                                     // Markdown headings
  ]

  if (patterns.some(p => p.test(trimmed))) return true

  // Heurística: línea corta rodeada de líneas vacías
  const isSurroundedByEmpty = prevLine.trim() === '' && nextLine.trim() === ''
  const isShortAndCapitalized = trimmed.length < 60 && /^[A-ZÁÉÍÓÚ]/.test(trimmed)
  const doesntEndWithPunct = !/[.!?]$/.test(trimmed)

  return isSurroundedByEmpty && isShortAndCapitalized && doesntEndWithPunct
}

// ═══════════════════════════════════════════════════════════════
// DIVIDIR POR PÁRRAFOS CUANDO NO HAY SECCIONES
// ═══════════════════════════════════════════════════════════════
function splitByParagraphs(text: string): string[] {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0)
  const chunks: string[] = []
  let currentChunk = ''

  for (const p of paragraphs) {
    const withNext = currentChunk ? currentChunk + '\n\n' + p : p

    if (withNext.length > MAX_CHUNK_SIZE && currentChunk.length >= MIN_CHUNK_SIZE) {
      chunks.push(currentChunk)
      const overlap = getOverlap(currentChunk)
      currentChunk = overlap + '\n\n' + p
    } else if (withNext.length > MAX_CHUNK_SIZE) {
      // Párrafo solo es demasiado grande → cortar por oraciones
      const subChunks = splitBySentences(withNext)
      chunks.push(...subChunks.slice(0, -1))
      currentChunk = subChunks[subChunks.length - 1] || ''
    } else {
      currentChunk = withNext
    }
  }

  if (currentChunk.length > 0) chunks.push(currentChunk)
  return chunks.filter(c => c.trim().length >= 100)
}

// ═══════════════════════════════════════════════════════════════
// DIVIDIR POR ORACIONES (último recurso)
// ═══════════════════════════════════════════════════════════════
function splitBySentences(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text]
  const chunks: string[] = []
  let currentChunk = ''

  for (const s of sentences) {
    if (currentChunk.length + s.length > MAX_CHUNK_SIZE && currentChunk.length >= MIN_CHUNK_SIZE) {
      chunks.push(currentChunk.trim())
      currentChunk = s.trim()
    } else {
      currentChunk += ' ' + s.trim()
    }
  }

  if (currentChunk.length > 0) chunks.push(currentChunk.trim())
  return chunks
}

// ═══════════════════════════════════════════════════════════════
// OVERLAP: últimas oraciones del chunk anterior
// ═══════════════════════════════════════════════════════════════
function getOverlap(text: string): string {
  const tail = text.slice(-OVERLAP_SIZE * 2)
  const sentences = tail.match(/[^.!?]+[.!?]+/g) || []
  const lastFew = sentences.slice(-2).join(' ').trim()
  return lastFew || tail.slice(-OVERLAP_SIZE).trim()
}

// ═══════════════════════════════════════════════════════════════
// CONSTRUIR OBJETO CHUNK CON METADATA
// ═══════════════════════════════════════════════════════════════
function buildChunk(text: string, order: number, approximatePage: number): Chunk {
  const charCount = text.length
  const wordCount = text.split(/\s+/).filter(Boolean).length
  const estimatedTokens = Math.ceil(charCount / 4)

  // Detectar características del contenido
  const hasNumbers = /\d/.test(text)
  const hasFormulas = /[=+\-*/^]|(\bpH\b)|(\d+\s*[×xX]\s*10)|(\b(mol|M|g|L|mL|kg|N|Pa|K)\b)/.test(text)
  const hasHeadings = /^[A-ZÁÉÍÓÚ][A-ZÁÉÍÓÚ\s]{3,}$/m.test(text) || /^#{1,6}\s/m.test(text)

  // Extraer posibles nombres de sección
  const lines = text.split('\n').slice(0, 5).map(l => l.trim()).filter(Boolean)
  const detectedSections = lines.filter(l => l.length < 80 && /^[A-ZÁÉÍÓÚ]/.test(l))

  return {
    id: `chunk_${Date.now()}_${order}`,
    order,
    text,
    charCount,
    wordCount,
    estimatedTokens,
    metadata: {
      startPage: approximatePage,
      endPage: approximatePage,
      hasHeadings,
      hasNumbers,
      hasFormulas,
      detectedSections: detectedSections.slice(0, 3),
    },
  }
}

// ═══════════════════════════════════════════════════════════════
// APROXIMAR PÁGINA (asumiendo ~2000 chars por página promedio)
// ═══════════════════════════════════════════════════════════════
function findApproximatePage(chunk: string, fullText: string): number {
  const idx = fullText.indexOf(chunk.slice(0, 100))
  if (idx < 0) return 0
  return Math.floor(idx / 2000) + 1
}

// ═══════════════════════════════════════════════════════════════
// CATEGORIZAR TAMAÑO DEL MATERIAL
// ═══════════════════════════════════════════════════════════════
function getSizeCategory(chars: number): ChunkingResult['materialSize'] {
  if (chars < 3000) return 'tiny'         // < ~1 página
  if (chars < 15000) return 'small'       // 1-5 páginas
  if (chars < 50000) return 'medium'      // 5-20 páginas
  if (chars < 150000) return 'large'      // 20-60 páginas
  return 'huge'                            // 60+ páginas
}

// ═══════════════════════════════════════════════════════════════
// HELPERS DE DEBUG
// ═══════════════════════════════════════════════════════════════
export function debugChunks(result: ChunkingResult): void {
  console.log(`
📚 CHUNKER RESULT
─────────────────────────────
Total chars: ${result.totalChars}
Total words: ${result.totalWords}
Estimated tokens: ${result.estimatedTotalTokens}
Material size: ${result.materialSize}
Chunks: ${result.totalChunks}
Recommended parallelism: ${result.recommendedParallelism}

CHUNKS:
${result.chunks.map(c => 
  `  #${c.order} — ${c.charCount} chars, ${c.wordCount} words, ~${c.estimatedTokens} tokens${
    c.metadata.detectedSections.length > 0 
      ? `\n     Sections: ${c.metadata.detectedSections.join(' | ')}`
      : ''
  }`
).join('\n')}
  `)
}
