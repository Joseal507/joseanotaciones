// ═══════════════════════════════════════════════════════════════
// DEPENDENCY RESOLVER
// 
// Detecta dependencias entre microconceptos.
// Usa LLM para analizar cuáles micros necesitan otros ANTES.
// Devuelve aristas del grafo (edges).
// ═══════════════════════════════════════════════════════════════

import { alaiRequest, safeParseJson } from '../../../alai'
import type { MicroConcept, DependencyEdge } from '../types'

export interface ResolutionResult {
  edges: DependencyEdge[]
  stats: {
    totalEdges: number
    hardDependencies: number
    softDependencies: number
    processingTimeMs: number
  }
  errors: string[]
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export async function resolveDependencies(
  micros: MicroConcept[],
): Promise<ResolutionResult> {
  const startTime = Date.now()
  const errors: string[] = []

  // Si hay pocos micros, procesarlos todos juntos
  // Si hay muchos, procesar por lotes
  const BATCH_SIZE = 15

  let allEdges: DependencyEdge[] = []

  if (micros.length <= BATCH_SIZE) {
    const edges = await detectDependenciesInBatch(micros)
    allEdges = edges
  } else {
    // Procesar por lotes solapados
    for (let i = 0; i < micros.length; i += BATCH_SIZE - 3) {
      const batch = micros.slice(i, i + BATCH_SIZE)
      try {
        const edges = await detectDependenciesInBatch(batch)
        allEdges.push(...edges)
      } catch (err: any) {
        errors.push(`Lote ${i}: ${err.message}`)
      }
    }
    // Deduplicar edges
    allEdges = deduplicateEdges(allEdges)
  }

  // Aplicar edges al grafo (mutar micros)
  applyEdgesToMicros(micros, allEdges)

  return {
    edges: allEdges,
    stats: {
      totalEdges: allEdges.length,
      hardDependencies: allEdges.filter(e => e.strength === 'hard').length,
      softDependencies: allEdges.filter(e => e.strength === 'soft').length,
      processingTimeMs: Date.now() - startTime,
    },
    errors,
  }
}

// ═══════════════════════════════════════════════════════════════
// DETECTAR DEPENDENCIAS EN UN LOTE
// ═══════════════════════════════════════════════════════════════
async function detectDependenciesInBatch(micros: MicroConcept[]): Promise<DependencyEdge[]> {
  if (micros.length < 2) return []

  const microsList = micros.map((m, i) => 
    `${i + 1}. ID: ${m.id} | ${m.name} — ${m.shortDescription}`
  ).join('\n')

  const prompt = `Analiza estos microconceptos y detecta cuáles necesitan otros ANTES para ser entendidos.

MICROCONCEPTOS:
${microsList}

Tu tarea: encontrar dependencias PEDAGÓGICAS reales.

Ejemplos de dependencias:
- "Calcular pH" DEPENDE de "Definición de pH" (hard)
- "Aplicar Ka" DEPENDE de "Equilibrio químico" (hard)
- "Fundación Falcons 1965" no depende de nada (0 dependencias)
- "Matt Ryan como quarterback" DEPENDE de "Qué es un quarterback" (soft)

Reglas:
- hard: DEBE entenderse antes, o el otro no tiene sentido
- soft: AYUDA entenderlo antes, pero no es obligatorio
- No forzar dependencias artificiales
- Un micro puede tener 0 dependencias
- No crees ciclos (A depende de B, B depende de A)

Devuelve SOLO este JSON:
{
  "dependencies": [
    {
      "fromId": "id_del_prerequisito",
      "toId": "id_del_que_depende",
      "strength": "hard" | "soft",
      "reason": "Por qué existe esta dependencia (breve)"
    }
  ]
}

Si no detectas dependencias claras, devuelve dependencies: []`

  try {
    const result = await alaiRequest(async (client: any, modelFn: any) => {
      const res = await client.chat.completions.create({
        model: modelFn(),
        messages: [
          {
            role: 'system',
            content: 'Eres un experto en diseño curricular. Detectas dependencias pedagógicas reales entre microconceptos. Solo JSON válido.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 4000,
      })
      const raw = res?.choices?.[0]?.message?.content || ''
      if (!raw.trim()) throw new Error('Empty response')
      return { text: raw, provider: 'unknown', model: 'unknown' }
    })

    const parsed = safeParseJson(result.text)
    if (!parsed?.dependencies || !Array.isArray(parsed.dependencies)) return []

    // Validar IDs
    const microIds = new Set(micros.map(m => m.id))
    const edges: DependencyEdge[] = []

    for (const dep of parsed.dependencies) {
      if (!microIds.has(dep.fromId) || !microIds.has(dep.toId)) continue
      if (dep.fromId === dep.toId) continue

      edges.push({
        from: dep.fromId,
        to: dep.toId,
        strength: dep.strength === 'hard' ? 'hard' : 'soft',
        reason: String(dep.reason || 'dependencia pedagógica'),
      })
    }

    return edges
  } catch (err: any) {
    console.error('[DependencyResolver]', err.message)
    return []
  }
}

// ═══════════════════════════════════════════════════════════════
// DEDUPLICAR EDGES
// ═══════════════════════════════════════════════════════════════
function deduplicateEdges(edges: DependencyEdge[]): DependencyEdge[] {
  const seen = new Map<string, DependencyEdge>()
  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, edge)
    } else {
      // Si aparece dos veces, upgrade a hard si aplica
      if (edge.strength === 'hard') existing.strength = 'hard'
    }
  }
  return Array.from(seen.values())
}

// ═══════════════════════════════════════════════════════════════
// APLICAR EDGES A LOS MICROS (mutación)
// ═══════════════════════════════════════════════════════════════
function applyEdgesToMicros(micros: MicroConcept[], edges: DependencyEdge[]): void {
  const microMap = new Map(micros.map(m => [m.id, m]))

  for (const edge of edges) {
    const fromMicro = microMap.get(edge.from)
    const toMicro = microMap.get(edge.to)
    if (!fromMicro || !toMicro) continue

    // toMicro tiene fromMicro como prerequisito
    if (!toMicro.prerequisites.includes(edge.from)) {
      toMicro.prerequisites.push(edge.from)
    }

    // fromMicro habilita a toMicro
    if (!fromMicro.enables.includes(edge.to)) {
      fromMicro.enables.push(edge.to)
    }
  }
}
