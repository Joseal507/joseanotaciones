// ═══════════════════════════════════════════════════════════════
// MICRO EXTRACTOR
// 
// Rol: extraer microconceptos de un chunk de material.
// El LLM solo extrae información estructurada del texto.
// No decide pedagogía, no genera contenido nuevo.
// ═══════════════════════════════════════════════════════════════

import { alaiRequest, safeParseJson } from '../../../alai'
import type { MicroConcept, CognitiveType } from '../types'
import type { Chunk } from '../../v2/agents/chunker'

const genId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

export interface ExtractionResult {
  chunkId: string
  chunkOrder: number
  micros: MicroConcept[]
  processingTimeMs: number
  errors: string[]
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: EXTRAER MICROS DE UN CHUNK
// ═══════════════════════════════════════════════════════════════
export async function extractMicrosFromChunk(chunk: Chunk): Promise<ExtractionResult> {
  const startTime = Date.now()
  const errors: string[] = []

  const prompt = buildExtractionPrompt(chunk)

  try {
    const result = await alaiRequest(async (client: any, modelFn: any) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [
          {
            role: 'system',
            content: 'Eres un extractor de microconceptos pedagógicos. Extraes UNIDADES ATÓMICAS de conocimiento del material. Cada microconcepto debe poder enseñarse independientemente en 2-3 minutos. Solo respondes JSON válido.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 6000,
      })
      const raw = res?.choices?.[0]?.message?.content || ''
      if (!raw.trim()) throw new Error('Empty extractor response')
      return { text: raw, provider: 'unknown', model: 'unknown' }
    })

    let parsed = safeParseJson(result.text)

    // Si el JSON está truncado, intentar recuperar los micros completos
    if (!parsed?.micros || !Array.isArray(parsed.micros)) {
      parsed = tryRecoverTruncatedJson(result.text)
    }

    if (!parsed?.micros || !Array.isArray(parsed.micros) || parsed.micros.length === 0) {
      console.log(`🔴 [microExtractor] Parse failed even with recovery. Chunk ${chunk.order}`)
      errors.push('No se extrajeron micros del chunk')
      return { chunkId: chunk.id, chunkOrder: chunk.order, micros: [], processingTimeMs: Date.now() - startTime, errors }
    }
    console.log(`🟢 [microExtractor] ${parsed.micros.length} micros extraídos del chunk ${chunk.order}`)

    // Enriquecer con datos del chunk
    const micros: MicroConcept[] = parsed.micros.map((m: any, i: number) => ({
      id: genId('micro'),
      name: String(m.name || `Micro ${i + 1}`).trim(),
      shortDescription: String(m.shortDescription || '').trim(),
      fullDefinition: String(m.fullDefinition || '').trim(),
      cognitiveType: normalizeCognitiveType(m.cognitiveType),
      difficulty: Math.min(100, Math.max(0, Number(m.difficulty) || 50)),
      estimatedMinutes: Math.max(2, Math.min(15, Number(m.estimatedMinutes) || 5)),
      sourceQuotes: Array.isArray(m.sourceQuotes) ? m.sourceQuotes.slice(0, 5) : [],
      sourceChunkIds: [chunk.id],
      sourcePages: chunk.metadata.startPage ? [chunk.metadata.startPage] : [],
      examples: (m.examples || []).map((e: any) => ({
        id: genId('ex'),
        scenario: String(e.scenario || ''),
        solution: e.solution ? String(e.solution) : undefined,
        keyInsight: String(e.keyInsight || ''),
      })),
      formulas: (m.formulas || []).map((f: any) => ({
        id: genId('formula'),
        expression: String(f.expression || ''),
        latex: f.latex,
        variables: Array.isArray(f.variables) ? f.variables : [],
        whenToUse: String(f.whenToUse || ''),
      })),
      procedures: (m.procedures || []).map((p: any) => ({
        id: genId('proc'),
        name: String(p.name || ''),
        steps: (p.steps || []).map((s: any, idx: number) => ({
          order: idx + 1,
          description: String(s.description || s),
          reasoning: String(s.reasoning || ''),
        })),
        applicableWhen: String(p.applicableWhen || ''),
      })),
      commonErrors: (m.commonErrors || []).map((e: any) => ({
        id: genId('err'),
        description: String(e.description || ''),
        whyItHappens: String(e.whyItHappens || ''),
        correction: String(e.correction || ''),
      })),
      prerequisites: [],   // Se llenan en el Dependency Resolver
      enables: [],
      related: [],
      importance: m.importance || 'medium',
      topicGroup: String(m.topicGroup || 'general'),
      extractedAt: Date.now(),
    }))

    return {
      chunkId: chunk.id,
      chunkOrder: chunk.order,
      micros,
      processingTimeMs: Date.now() - startTime,
      errors,
    }

  } catch (err: any) {
    errors.push(err.message || 'Extractor error')
    console.error(`[microExtractor] Chunk ${chunk.order}:`, err.message)
    return { chunkId: chunk.id, chunkOrder: chunk.order, micros: [], processingTimeMs: Date.now() - startTime, errors }
  }
}

// ═══════════════════════════════════════════════════════════════
// EXTRAER MICROS EN PARALELO
// ═══════════════════════════════════════════════════════════════
export async function extractMicrosParallel(
  chunks: Chunk[],
  maxParallel: number = 4,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractionResult[]> {
  const results: ExtractionResult[] = []
  const total = chunks.length
  let done = 0

  for (let i = 0; i < chunks.length; i += maxParallel) {
    const batch = chunks.slice(i, i + maxParallel)
    const batchResults = await Promise.all(batch.map(chunk => extractMicrosFromChunk(chunk)))
    results.push(...batchResults)
    done += batch.length
    if (onProgress) onProgress(done, total)
  }

  return results.sort((a, b) => a.chunkOrder - b.chunkOrder)
}

// ═══════════════════════════════════════════════════════════════
// PROMPT DEL EXTRACTOR
// ═══════════════════════════════════════════════════════════════
function buildExtractionPrompt(chunk: Chunk): string {
  return `Extrae los MICROCONCEPTOS de este fragmento de material educativo.

═══════════════════════════════════════════════════════════════
FRAGMENTO (chunk ${chunk.order + 1}, ${chunk.charCount} chars)
═══════════════════════════════════════════════════════════════
${chunk.text}
═══════════════════════════════════════════════════════════════

QUÉ ES UN MICROCONCEPTO:
- Unidad atómica de aprendizaje enseñable en 2-3 minutos
- Un microconcepto NO es un topic grande. Es UNA sola idea.
- REGLA CRÍTICA: Si el material menciona una persona, un evento, una fórmula,
  un proceso, o una teoría, CADA UNO es un micro separado.

- Ejemplos BUENOS:
  ✓ "Persona mencionada" — quién era, vida, contexto (si el material lo menciona)
  ✓ "Modelo científico específico" — la teoría específica
  ✓ "Fórmula del modelo: y = f(x)" — expresión y variables
  ✓ "Interpretación teórica" — qué propone
  ✓ "Reconocimiento en una fecha" — hecho específico
  ✓ "Colaboración entre dos autores" — relación específica
  ✓ "Definición de pH"
  ✓ "Una persona en su rol específico"

- Ejemplos MALOS (muy grandes, no son micros):
  ✗ "Química de ácidos y bases" → demasiado grande
  ✗ "La vida y obra completa de una persona" → fusiona varios micros
  ✗ "Una organización completa" → es un topic, no un micro

TIPOS DE MICROCONCEPTOS QUE DEBES BUSCAR ACTIVAMENTE:
1. PERSONAS específicas mencionadas — nombre, rol, contexto, aporte
2. FECHAS y EVENTOS clave — qué pasó, cuándo, por qué importa
3. TEORÍAS y MODELOS — nombre, qué propone, evidencia
4. FÓRMULAS o ECUACIONES — expresión, variables, cuándo usar
5. PROCESOS y PASOS — secuencia, por qué ese orden
6. CONCEPTOS ABSTRACTOS — definición, características, diferencias
7. CAUSAS y EFECTOS — qué causó qué, por qué
8. COMPARACIONES — X vs Y, en qué se diferencian
9. INSTITUCIONES u ORGANIZACIONES mencionadas
10. LEGADOS o IMPACTOS — qué consecuencias tuvo

REGLAS DE EXTRACCIÓN:
1. Extrae entre 4 y 12 microconceptos de este fragmento
2. Si ves una persona importante → es un micro propio
3. Si ves una fórmula → es un micro propio
4. Si ves un proceso con pasos → es un micro propio
5. Usa citas EXACTAS del material en "sourceQuotes"
6. NO inventes información. Solo lo que está en el fragmento.
7. Los ejemplos, fórmulas, procedimientos y errores deben venir del texto

Devuelve SOLO este JSON:

{
  "micros": [
    {
      "name": "Nombre corto y específico (max 8 palabras)",
      "shortDescription": "Una oración explicando qué es",
      "fullDefinition": "Definición completa según el material (2-4 oraciones)",
      "cognitiveType": "definitional | conceptual | procedural | mathematical | causal | comparative | chronological | classificatory | narrative | analytical | applicative",
      "difficulty": 0-100,
      "estimatedMinutes": 2-15,
      "sourceQuotes": ["Cita EXACTA del fragmento", "Otra cita si aplica"],
      "importance": "critical | high | medium | low",
      "topicGroup": "Nombre del grupo temático al que pertenece",
      
      "examples": [
        {
          "scenario": "Descripción del caso o ejemplo",
          "solution": "Solución si aplica",
          "keyInsight": "Qué enseña este ejemplo"
        }
      ],
      
      "formulas": [
        {
          "expression": "pH = -log[H+]",
          "variables": [
            { "symbol": "pH", "meaning": "acidez", "unit": "" },
            { "symbol": "[H+]", "meaning": "concentración de H+", "unit": "M" }
          ],
          "whenToUse": "Cuando conoces [H+] y quieres calcular pH"
        }
      ],
      
      "procedures": [
        {
          "name": "Cálculo de pH desde [H+]",
          "steps": [
            { "description": "Identificar [H+]", "reasoning": "Es el input" },
            { "description": "Aplicar log negativo", "reasoning": "Por definición" }
          ],
          "applicableWhen": "Se te da concentración de H+"
        }
      ],
      
      "commonErrors": [
        {
          "description": "Confundir signo del logaritmo",
          "whyItHappens": "El log es negativo por convención",
          "correction": "Recordar que pH = -log[H+], NO log[H+]"
        }
      ]
    }
  ]
}

IMPORTANTE:
- Si un micro no tiene fórmula, deja formulas: []
- Si no hay procedimiento, procedures: []
- commonErrors: SIEMPRE incluye al menos 1 error común REAL que los estudiantes cometen con este concepto.
  * Si el texto menciona un error, úsalo textual.
  * Si NO lo menciona, INFIÉRELO desde tu conocimiento pedagógico:
    - definitional: confundir con concepto similar
    - conceptual: aplicar mal la regla
    - procedural: saltarse un paso o hacerlo en orden equivocado
    - mathematical: error de signo, unidades, magnitud
    - causal: invertir causa/efecto
    - comparative: no ver la diferencia clave
  * Ejemplo química: "confundir pH con [H+] directo", "olvidar el signo negativo del log", "usar pH cuando toca pOH"
  * Ejemplo historia: "confundir causas económicas con sociales", "invertir orden de eventos"
- Siempre debe tener al menos 1 sourceQuote
- topicGroup ayuda a agrupar micros relacionados (ej: "Fundación", "Jugadores", "Cálculos de pH")`
}

// ═══════════════════════════════════════════════════════════════
// NORMALIZAR TIPO COGNITIVO
// ═══════════════════════════════════════════════════════════════
function normalizeCognitiveType(t: any): CognitiveType {
  const valid: CognitiveType[] = [
    'definitional', 'conceptual', 'procedural', 'mathematical',
    'causal', 'comparative', 'chronological', 'classificatory',
    'narrative', 'analytical', 'applicative',
  ]
  const normalized = String(t || '').toLowerCase().trim() as CognitiveType
  return valid.includes(normalized) ? normalized : 'conceptual'
}

// ═══════════════════════════════════════════════════════════════
// RECUPERAR JSON TRUNCADO
// Si el LLM cortó su respuesta a mitad de un micro, intentamos
// extraer los micros que SÍ están completos.
// ═══════════════════════════════════════════════════════════════
function tryRecoverTruncatedJson(raw: string): { micros: any[] } | null {
  if (!raw) return null

  // Buscar el inicio del array de micros
  const arrayStart = raw.indexOf('"micros"')
  if (arrayStart < 0) return null

  const openBracket = raw.indexOf('[', arrayStart)
  if (openBracket < 0) return null

  // Escanear caracter a caracter, contando { } " para encontrar micros completos
  const micros: any[] = []
  let i = openBracket + 1
  let currentStart = -1
  let braceDepth = 0
  let inString = false
  let escapeNext = false

  while (i < raw.length) {
    const c = raw[i]

    if (escapeNext) { escapeNext = false; i++; continue }
    if (c === '\\' && inString) { escapeNext = true; i++; continue }
    if (c === '"') inString = !inString

    if (!inString) {
      if (c === '{') {
        if (braceDepth === 0) currentStart = i
        braceDepth++
      } else if (c === '}') {
        braceDepth--
        if (braceDepth === 0 && currentStart >= 0) {
          // Micro completo detectado
          const microJson = raw.slice(currentStart, i + 1)
          try {
            const parsed = JSON.parse(microJson)
            if (parsed && parsed.name) micros.push(parsed)
          } catch {
            // Micro corrupto, skip
          }
          currentStart = -1
        }
      } else if (c === ']' && braceDepth === 0) {
        // Fin del array
        break
      }
    }
    i++
  }

  if (micros.length === 0) return null
  return { micros }
}
