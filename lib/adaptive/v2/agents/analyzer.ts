// ═══════════════════════════════════════════════════════════════
// AGENTE 2 — ANALYZER
// 
// Analiza UN chunk y extrae topics, hechos, ejemplos.
// Se ejecuta en paralelo (uno por chunk).
// Cada llamada es rápida porque el chunk es pequeño.
// ═══════════════════════════════════════════════════════════════

import { alaiRequest, safeParseJson } from '../../../alai'
import type { Chunk } from './chunker'

export interface ChunkAnalysis {
  chunkId: string
  chunkOrder: number
  topics: RawTopic[]
  formulas: RawFormula[]
  procedures: RawProcedure[]
  examples: RawExample[]
  commonMistakes: RawMistake[]
  keyFacts: string[]
  subjectHints: string[]        // Pistas de qué materia es
  contextSummary: string        // Resumen ultra breve para el consolidator
  processingTimeMs: number
  errors: string[]
}

export interface RawTopic {
  title: string
  rawText: string               // Texto exacto del chunk relacionado
  keyFacts: string[]
  topicType: string             // conceptual, procedural, mathematical, etc
  importance: 'low' | 'medium' | 'high' | 'critical'
  learningObjectives: string[]
  prerequisitesHint: string[]   // Nombres de topics que parecen prerequisitos
  approximatePage?: number
}

export interface RawFormula {
  name: string
  formula: string
  variables: Array<{ symbol: string; meaning: string; unit?: string }>
  context: string               // Cuando aparece en el material
}

export interface RawProcedure {
  name: string
  steps: string[]
  context: string
}

export interface RawExample {
  description: string
  solution?: string
  relatedTopicNames: string[]
}

export interface RawMistake {
  description: string
  correction: string
  relatedTopicName: string
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: analizar UN chunk
// ═══════════════════════════════════════════════════════════════
export async function analyzeChunk(chunk: Chunk): Promise<ChunkAnalysis> {
  const startTime = Date.now()
  const errors: string[] = []

  const prompt = buildAnalyzerPrompt(chunk)

  try {
    const result = await alaiRequest(async (client: any, modelFn: any) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [
          {
            role: 'system',
            content: 'Eres un analizador experto de material educativo. Extraes topics, fórmulas, procedimientos y ejemplos de forma estructurada. Solo respondes JSON válido siguiendo el schema exacto. No inventas información fuera del chunk.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 6000,
      })
      const raw = res?.choices?.[0]?.message?.content || ''
      if (!raw.trim()) throw new Error('Empty analyzer response')
      return { text: raw, provider: 'unknown', model: 'unknown' }
    })

    const parsed = safeParseJson(result.text)
    if (!parsed) {
      errors.push('No se pudo parsear JSON del analyzer')
      return buildEmptyAnalysis(chunk, Date.now() - startTime, errors)
    }

    // Enriquecer los topics con el approximatePage del chunk
    // Filtrar títulos basura (fragmentos de oración, metadata, etc.)
    const topics: RawTopic[] = (parsed.topics || []).map((t: any) => ({
      title: String(t.title || '').trim(),
      rawText: String(t.rawText || t.rawTextReference || '').slice(0, 2000),
      keyFacts: Array.isArray(t.keyFacts) ? t.keyFacts.slice(0, 8) : [],
      topicType: t.topicType || 'conceptual',
      importance: t.importance || 'medium',
      learningObjectives: Array.isArray(t.learningObjectives) ? t.learningObjectives.slice(0, 4) : [],
      prerequisitesHint: Array.isArray(t.prerequisitesHint) ? t.prerequisitesHint : [],
      approximatePage: chunk.metadata.startPage,
    })).filter((t: RawTopic) => {
      // 1. Título mínimo no vacío
      if (t.title.length === 0) return false
      // 2. Título debe ser válido (no fragmento, no metadata)
      if (!isValidLLMTitle(t.title)) {
        console.log(`[analyzer] ⚠ Título rechazado: "${t.title}"`)
        return false
      }
      return true
    })

    return {
      chunkId: chunk.id,
      chunkOrder: chunk.order,
      topics,
      formulas: (parsed.formulas || []).slice(0, 10),
      procedures: (parsed.procedures || []).slice(0, 8),
      examples: (parsed.examples || []).slice(0, 8),
      commonMistakes: (parsed.commonMistakes || []).slice(0, 6),
      keyFacts: (parsed.keyFacts || []).slice(0, 15),
      subjectHints: parsed.subjectHints || [],
      contextSummary: String(parsed.contextSummary || '').slice(0, 300),
      processingTimeMs: Date.now() - startTime,
      errors,
    }

  } catch (err: any) {
    errors.push(err.message || 'Analyzer error')
    console.error(`[analyzer] Chunk ${chunk.order}:`, err.message)
    return buildEmptyAnalysis(chunk, Date.now() - startTime, errors)
  }
}

// ═══════════════════════════════════════════════════════════════
// PROMPT DEL ANALYZER
// ═══════════════════════════════════════════════════════════════
function buildAnalyzerPrompt(chunk: Chunk): string {
  return `Analiza este fragmento de material educativo y extrae su estructura pedagógica.

═══════════════════════════════════════════════════════════════
FRAGMENTO (chunk ${chunk.order + 1}, ~${chunk.charCount} caracteres)
═══════════════════════════════════════════════════════════════
${chunk.text}
═══════════════════════════════════════════════════════════════

TU TAREA:
Identifica y extrae TODO lo importante que aparece en este fragmento. Sé específico y usa la información REAL del texto, no inventes.

Devuelve SOLO este JSON:

{
  "topics": [
    {
      "title": "Nombre específico del tema/persona/evento/concepto (ej: 'Michael Vick', 'Fórmula del pH', 'Batalla de Waterloo')",
      "rawText": "Cita textual EXACTA del fragmento que trata este topic (max 500 chars)",
      "keyFacts": ["Hecho concreto 1 del fragmento", "Hecho 2", "Hecho 3"],
      "topicType": "conceptual | procedural | mathematical | causal | chronological | comparative | classificatory | narrative | clinical_case | legal_case | analytical | memorization | definition",
      "importance": "critical | high | medium | low",
      "learningObjectives": ["El estudiante podrá explicar/calcular/comparar/identificar..."],
      "prerequisitesHint": ["Nombre de topic que parece necesitar antes"]
    }
  ],
  "formulas": [
    {
      "name": "Nombre de la fórmula",
      "formula": "Expresión matemática exacta (ej: pH = -log[H+])",
      "variables": [
        { "symbol": "pH", "meaning": "acidez", "unit": "" },
        { "symbol": "[H+]", "meaning": "concentración de iones", "unit": "M" }
      ],
      "context": "Cuando se usa según el material"
    }
  ],
  "procedures": [
    {
      "name": "Nombre del procedimiento (ej: 'Tabla ICE')",
      "steps": ["Paso 1", "Paso 2", "Paso 3"],
      "context": "Cuando se aplica"
    }
  ],
  "examples": [
    {
      "description": "El caso o ejemplo tal como aparece en el material",
      "solution": "La solución si el material la incluye",
      "relatedTopicNames": ["Nombre del topic relacionado"]
    }
  ],
  "commonMistakes": [
    {
      "description": "Error común mencionado en el material",
      "correction": "Cómo se corrige según el material",
      "relatedTopicName": "Topic donde ocurre"
    }
  ],
  "keyFacts": [
    "Los hechos más importantes de TODO el fragmento (fechas, nombres, números, definiciones exactas)"
  ],
  "subjectHints": [
    "Palabras clave que indican qué materia es (ej: 'Ka', 'pH', 'quarterback', 'articulo constitucional')"
  ],
  "contextSummary": "En 1-2 oraciones: de qué trata este fragmento en general"
}

REGLAS CRÍTICAS PARA TÍTULOS (aplicar SIEMPRE):

El "title" es lo que verá el estudiante como nombre de la sesión. DEBE ser:
✅ Un tema pedagógico claro: "Definición de pH", "Fuerza de ácidos", "Ácidos de Lewis"
✅ Ni muy corto (min 2 palabras salvo acrónimos como "ADN", "ATP") ni muy largo (max 8 palabras)
✅ Con inicial mayúscula y sin dos puntos ni descripciones largas
✅ Como aparecería en el índice de un libro de texto

🚫 PROHIBIDO en títulos:
✗ Nombres de autores o profesores: "Dra. María Fernanda", "Facilitador: Samuel Ortega"
✗ Copyright, editoriales, años: "© 2009 Prentice-Hall", "2015 Pearson Inc"
✗ Fragmentos de oración: "En oxiácidos, en los", "Para el ácido fórmico"
✗ Metadata del PDF: "Universidad X", "Facultad de", "Módulo N"
✗ Fórmulas o ecuaciones como título: "[H3O+][OH-] = 10^-14"
✗ Números de página, títulos de slide, subtítulos verbales
✗ Instrucciones verbales: "Calcule K", "Resuelva", "Determine"
✗ Definiciones con formato "PALABRA: descripción larga y explicativa"

Ejemplos correctos vs incorrectos:
✅ "Constante de equilibrio Ka"   ✗ "Ka = 1.8×10⁻⁵"
✅ "Reacciones ácido-base"        ✗ "En este capítulo veremos"
✅ "Fuerza de ácidos"             ✗ "Fuerza de ácidos y bases: cómo se comparan"
✅ "Duplicación del ADN"          ✗ "DUPLICACION DEL ADN paso a paso"
✅ "Ácidos de Lewis"              ✗ "Ácido de Lewis"  (usa plural cuando aplique)

REGLAS CRÍTICAS GENERALES:
1. Los topics deben ser ESPECÍFICOS, no genéricos ("Michael Vick" no "Jugadores")
2. Cada topic debe tener rawText que sea CITA REAL del fragmento
3. Si el fragmento no tiene fórmulas/procedimientos/ejemplos, deja arrays vacíos
4. Los keyFacts son datos concretos: nombres, fechas, números, definiciones
5. NUNCA copies texto crudo como título — siempre reformula pedagógicamente
5. Si el fragmento es sobre UN solo tema grande, extrae subtopics (ej: si es sobre "Equilibrio químico" → topics: "Kc", "Kp", "Q", "Le Châtelier")
6. Mínimo 1 topic, máximo 8 topics por chunk
7. Importance:
   - critical: sin esto no entiende nada más
   - high: muy importante para el examen
   - medium: importante pero no crítico
   - low: información contextual`
}

// ═══════════════════════════════════════════════════════════════
// ANÁLISIS VACÍO (fallback)
// ═══════════════════════════════════════════════════════════════
function buildEmptyAnalysis(chunk: Chunk, timeMs: number, errors: string[]): ChunkAnalysis {
  // Generar un título mejor que "Fragmento N"
  const title = deriveTitleFromChunk(chunk)
  return {
    chunkId: chunk.id,
    chunkOrder: chunk.order,
    topics: [{
      title,
      rawText: chunk.text.slice(0, 500),
      keyFacts: [chunk.text.slice(0, 100)],
      topicType: 'conceptual',
      importance: 'medium',
      learningObjectives: [`Comprender: ${title}`],
      prerequisitesHint: [],
      approximatePage: chunk.metadata.startPage,
    }],
    formulas: [],
    procedures: [],
    examples: [],
    commonMistakes: [],
    keyFacts: [],
    subjectHints: [],
    contextSummary: chunk.text.slice(0, 200),
    processingTimeMs: timeMs,
    errors,
  }
}

// ═══════════════════════════════════════════════════════════════
// ANALIZAR MÚLTIPLES CHUNKS EN PARALELO
// ═══════════════════════════════════════════════════════════════
export async function analyzeChunksInParallel(
  chunks: Chunk[],
  maxParallel: number = 5,
  onProgress?: (done: number, total: number) => void,
): Promise<ChunkAnalysis[]> {
  const results: ChunkAnalysis[] = []
  const total = chunks.length
  let done = 0

  // Ejecutar en batches paralelos
  for (let i = 0; i < chunks.length; i += maxParallel) {
    const batch = chunks.slice(i, i + maxParallel)
    const batchResults = await Promise.all(
      batch.map(chunk => analyzeChunk(chunk))
    )
    results.push(...batchResults)
    done += batch.length
    if (onProgress) onProgress(done, total)
  }

  // Ordenar por chunkOrder por si acaso
  return results.sort((a, b) => a.chunkOrder - b.chunkOrder)
}

// ═══════════════════════════════════════════════════════════════
// DERIVAR TÍTULO PEDAGÓGICO DESDE UN CHUNK
// (Reemplaza el fallback "Fragmento N" con algo útil al usuario)
// ═══════════════════════════════════════════════════════════════
function deriveTitleFromChunk(chunk: Chunk): string {
  // Prioridad 1: primer heading detectado
  if (chunk.metadata.detectedSections && chunk.metadata.detectedSections.length > 0) {
    const first = chunk.metadata.detectedSections[0].trim()
    if (first.length > 3 && first.length < 80 && isReadableTitle(first)) {
      return capitalizeFirst(first)
    }
  }

  // Prioridad 2: buscar la primera oración LEGIBLE del texto
  const text = (chunk.text || '').trim()
  if (text.length > 0) {
    // Dividir en oraciones y buscar la primera que sea legible
    const sentences = text.split(/[.!?\n]/).map(s => s.trim()).filter(Boolean)
    for (const sentence of sentences.slice(0, 5)) {
      if (sentence.length < 15 || sentence.length > 120) continue
      if (!isReadableTitle(sentence)) continue
      // Recortar a máximo 8 palabras
      const words = sentence.split(/\s+/).filter(Boolean)
      if (words.length <= 8) {
        return capitalizeFirst(sentence)
      }
      return capitalizeFirst(words.slice(0, 8).join(' ')) + '...'
    }
  }

  // Fallback final: NO usar "Fragmento", usar algo más neutral
  return `Contenido (parte ${chunk.order + 1})`
}

/**
 * Un título es "legible" si NO parece basura técnica:
 * - No empieza con números/símbolos/fórmulas
 * - No es solo fórmulas químicas ([H3O+], H2O, etc.)
 * - Tiene al menos 2 palabras alfabéticas
 * - Menos del 40% de caracteres son símbolos/dígitos
 */
/**
 * Filtro MÍNIMO — solo rechaza basura obvia que el LLM no debería haber devuelto.
 * La calidad pedagógica del título es responsabilidad del prompt del LLM.
 */
function isValidLLMTitle(s: string): boolean {
  if (!s) return false
  const t = s.trim()
  if (t.length < 2 || t.length > 80) return false

  // Rechazar metadata obvia
  if (/©|®|™/.test(t)) return false
  if (/\b(copyright|reserved|derechos\s+reservados)\b/i.test(t)) return false
  if (/^(dra?\.|msc\.|phd\.|prof\.|facilitador|profesor|profesora|licenciad[oa]|catedr[áa]tic[oa])\b/i.test(t)) return false

  // Rechazar patrón "PALABRA: descripción larga" (LLM copiando sections del chunker)
  // Ej: "GEN: Unidad funcional y estructural...", "Taller: Conceptos básico..."
  // Permitir si es corto (max 4 palabras después de :) y no un fragmento
  const colonMatch = t.match(/^([^:]{1,30}):\s+(.+)$/)
  if (colonMatch) {
    const afterColon = colonMatch[2].trim()
    const wordsAfter = afterColon.split(/\s+/).filter(w => w.length > 0)
    if (wordsAfter.length > 4) return false
  }

  // Rechazar si empieza con conjunciones/preposiciones (fragmentos)
  if (/^(en|a|al|de|del|los|las|un|una|el|la|para|con|por|es|que|como|si|cuando|donde|así|aunque|mientras)\s+[a-záéíóú]/i.test(t)) return false

  // Rechazar si termina con preposición (fragmento cortado)
  if (/\s(a|de|del|el|la|en|con|para|por|y|o|es|un|una|esta|este|más|menos|entre|los|las)\.?$/i.test(t)) return false

  // Rechazar si es solo símbolos/números (sin al menos 2 letras)
  const letters = (t.match(/[A-Za-zÁÉÍÓÚÑñáéíóúñ]/g) || []).length
  if (letters < 2) return false

  return true
}

// Acrónimos científicos comunes que SIEMPRE son topics válidos aunque sean cortos
const KNOWN_ACRONYMS = new Set([
  'adn','arn','atp','adp','amp','gtp','dna','rna','pcr','crispr','ph','poh',
  'kw','ka','kb','kc','kp','ge','tp','hcl','naoh','hno3','h2o','co2','o2','n2',
  'nadh','fadh','nadph','ldl','hdl','vldl','crp','tnf','il','mhc','tcr','bcr',
])

function isReadableTitle(s: string): boolean {
  if (!s) return false
  const trimmed = s.trim()

  // Acrónimos científicos conocidos siempre válidos
  if (KNOWN_ACRONYMS.has(trimmed.toLowerCase())) return true

  // Rechazar símbolos de metadata (©, ®, ™) al inicio
  if (/^[©®™§¶†‡]/.test(trimmed)) return false

  // Rechazar nombres académicos / metadata de autor
  if (/^(dr\.?|dra\.?|msc\.?|phd\.?|prof\.?|facilitador|profesor|profesora|autor|autora|catedr[áa]tico)\b/i.test(trimmed)) return false
  if (/\b(facilitador|professor|catedrático|instructor|licenciado|licenciada)\s*:/i.test(trimmed)) return false

  // Rechazar si empieza con número, símbolo, corchete, ecuación
  if (/^[\d\[\(=+\-*/•·°]/.test(trimmed)) return false

  // Rechazar si empieza con "0X •" (bullets numerados basura)
  if (/^[0-9]+\s*[•·]/.test(trimmed)) return false

  // Rechazar si CONTIENE año de copyright (ej: "© 2009", "2015 Pearson")
  if (/\b(19|20)\d{2}\b/.test(trimmed) && /(inc|hall|prentice|pearson|copyright|reserved|derechos)/i.test(trimmed)) return false

  // Contar palabras alfabéticas (min 2 letras cada una)
  const alphaWords = trimmed.match(/[A-Za-zÁÉÍÓÚáéíóúÑñ]{2,}/g) || []

  // Aceptar 1 palabra SOLO si es larga (≥6 letras: "Oxiácidos", "Fotosíntesis", etc.)
  if (alphaWords.length === 0) return false
  if (alphaWords.length === 1 && alphaWords[0].length < 6) return false

  // Contar proporción de símbolos/dígitos vs letras
  const letters = (trimmed.match(/[A-Za-zÁÉÍÓÚáéíóúÑñ]/g) || []).length
  const nonSpace = trimmed.replace(/\s+/g, '').length
  if (nonSpace === 0) return false
  const letterRatio = letters / nonSpace
  if (letterRatio < 0.6) return false

  return true
}

function capitalizeFirst(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}
