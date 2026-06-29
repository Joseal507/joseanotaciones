// ═══════════════════════════════════════════════════════════════
// StudyAL — Student Knowledge Graph
// Los conceptos no son independientes.
// Si falla ATP Synthase, probablemente también falla gradiente.
// Este grafo modela esas dependencias y las usa para predecir.
// ═══════════════════════════════════════════════════════════════

export type RelationType =
  | 'prerequisite'      // A es necesario para entender B
  | 'enables'           // Dominar A hace más fácil B
  | 'conflicts_with'    // A y B se confunden frecuentemente
  | 'part_of'           // A es parte de B
  | 'applies_to'        // A se aplica en el contexto de B
  | 'similar_to'        // A y B son similares (riesgo de confusión)

export interface ConceptNode {
  id: string
  name: string
  domain: number           // 0-100
  confidence: number       // 0-100 confianza del modelo
  evidenceCount: number    // cuántas veces fue evaluado
  lastUpdated: number
  tags: string[]           // categorías (ej: 'bioquímica', 'energía')
}

export interface ConceptEdge {
  from: string             // conceptId
  to: string               // conceptId
  relation: RelationType
  strength: number         // 0-1 qué tan fuerte es la relación
  empirical: boolean       // true si fue descubierta por el sistema, false si fue predefinida
  errorCorrelation: number // 0-1 qué tan seguido fallan juntos
}

export interface StudentKnowledgeGraph {
  materialId: string
  nodes: ConceptNode[]
  edges: ConceptEdge[]
  lastUpdated: number
  version: number
}

// ── Crear grafo vacío ─────────────────────────────────────────────
export function createEmptyGraph(materialId: string): StudentKnowledgeGraph {
  return {
    materialId,
    nodes: [],
    edges: [],
    lastUpdated: Date.now(),
    version: 1,
  }
}

// ── Agregar o actualizar nodo ─────────────────────────────────────
export function upsertNode(
  graph: StudentKnowledgeGraph,
  concept: Partial<ConceptNode> & { id: string; name: string },
): StudentKnowledgeGraph {
  const existing = graph.nodes.find(n => n.id === concept.id)

  if (existing) {
    return {
      ...graph,
      nodes: graph.nodes.map(n =>
        n.id === concept.id
          ? { ...n, ...concept, lastUpdated: Date.now() }
          : n
      ),
      lastUpdated: Date.now(),
    }
  }

  const newNode: ConceptNode = {
    id: concept.id,
    name: concept.name,
    domain: concept.domain ?? 0,
    confidence: concept.confidence ?? 0,
    evidenceCount: concept.evidenceCount ?? 0,
    lastUpdated: Date.now(),
    tags: concept.tags ?? [],
  }

  return {
    ...graph,
    nodes: [...graph.nodes, newNode],
    lastUpdated: Date.now(),
  }
}

// ── Agregar relación entre conceptos ─────────────────────────────
export function addEdge(
  graph: StudentKnowledgeGraph,
  edge: ConceptEdge,
): StudentKnowledgeGraph {
  const existing = graph.edges.find(
    e => e.from === edge.from && e.to === edge.to && e.relation === edge.relation
  )

  if (existing) {
    return {
      ...graph,
      edges: graph.edges.map(e =>
        e === existing
          ? { ...e, strength: Math.min(1, e.strength + 0.1), errorCorrelation: edge.errorCorrelation }
          : e
      ),
    }
  }

  return {
    ...graph,
    edges: [...graph.edges, edge],
    lastUpdated: Date.now(),
  }
}

// ── Inferir conceptos en riesgo por dependencias ──────────────────
// Si el concepto A falla, los conceptos que dependen de A también están en riesgo
export function inferAtRiskConcepts(
  graph: StudentKnowledgeGraph,
  failedConceptIds: string[],
  threshold: number = 0.5,
): Array<{ conceptId: string; conceptName: string; riskScore: number; reason: string }> {
  const atRisk: Map<string, { score: number; reasons: string[] }> = new Map()

  for (const failedId of failedConceptIds) {
    const failedNode = graph.nodes.find(n => n.id === failedId)
    if (!failedNode) continue

    // Buscar conceptos que dependen del fallado
    const dependentEdges = graph.edges.filter(
      e => (e.from === failedId || e.to === failedId) &&
           ['prerequisite', 'enables', 'part_of'].includes(e.relation)
    )

    for (const edge of dependentEdges) {
      const dependentId = edge.from === failedId ? edge.to : edge.from
      if (failedConceptIds.includes(dependentId)) continue

      const dependentNode = graph.nodes.find(n => n.id === dependentId)
      if (!dependentNode) continue

      const riskScore = edge.strength * (edge.relation === 'prerequisite' ? 1.5 : 1.0)

      if (riskScore >= threshold) {
        const existing = atRisk.get(dependentId) || { score: 0, reasons: [] }
        atRisk.set(dependentId, {
          score: Math.max(existing.score, riskScore),
          reasons: [
            ...existing.reasons,
            `Depende de "${failedNode.name}" (${edge.relation})`
          ],
        })
      }
    }

    // Conceptos que se confunden frecuentemente con el fallado
    const confusionEdges = graph.edges.filter(
      e => (e.from === failedId || e.to === failedId) &&
           ['conflicts_with', 'similar_to'].includes(e.relation) &&
           e.errorCorrelation >= 0.4
    )

    for (const edge of confusionEdges) {
      const relatedId = edge.from === failedId ? edge.to : edge.from
      const relatedNode = graph.nodes.find(n => n.id === relatedId)
      if (!relatedNode) continue

      const existing = atRisk.get(relatedId) || { score: 0, reasons: [] }
      atRisk.set(relatedId, {
        score: Math.max(existing.score, edge.errorCorrelation),
        reasons: [
          ...existing.reasons,
          `Se confunde frecuentemente con "${failedNode.name}"`
        ],
      })
    }
  }

  return Array.from(atRisk.entries())
    .map(([id, { score, reasons }]) => {
      const node = graph.nodes.find(n => n.id === id)
      return {
        conceptId: id,
        conceptName: node?.name || id,
        riskScore: Math.min(1, score),
        reason: reasons[0] || 'Relacionado con conceptos fallados',
      }
    })
    .sort((a, b) => b.riskScore - a.riskScore)
}

// ── Descubrir relaciones empíricas ───────────────────────────────
// Si dos conceptos fallan juntos frecuentemente → crear edge conflicts_with
export function discoverEmpiricalRelations(
  graph: StudentKnowledgeGraph,
  errorHistory: Array<{ conceptIds: string[]; timestamp: number }>,
): StudentKnowledgeGraph {
  if (errorHistory.length < 3) return graph

  let updatedGraph = { ...graph }

  // Contar co-ocurrencias de errores
  const coOccurrences: Map<string, number> = new Map()
  const totalOccurrences: Map<string, number> = new Map()

  for (const errorEvent of errorHistory) {
    for (const id of errorEvent.conceptIds) {
      totalOccurrences.set(id, (totalOccurrences.get(id) || 0) + 1)
    }

    // Pares que fallan juntos
    for (let i = 0; i < errorEvent.conceptIds.length; i++) {
      for (let j = i + 1; j < errorEvent.conceptIds.length; j++) {
        const pair = [errorEvent.conceptIds[i], errorEvent.conceptIds[j]].sort().join('::')
        coOccurrences.set(pair, (coOccurrences.get(pair) || 0) + 1)
      }
    }
  }

  // Crear edges para pares con alta co-ocurrencia
  for (const [pair, count] of coOccurrences.entries()) {
    const [idA, idB] = pair.split('::')
    const totalA = totalOccurrences.get(idA) || 1
    const totalB = totalOccurrences.get(idB) || 1
    const correlation = count / Math.min(totalA, totalB)

    if (correlation >= 0.5) {
      updatedGraph = addEdge(updatedGraph, {
        from: idA,
        to: idB,
        relation: 'conflicts_with',
        strength: Math.min(1, correlation),
        empirical: true,
        errorCorrelation: correlation,
      })
    }
  }

  return updatedGraph
}

// ── Propagación de dominio a través del grafo ─────────────────────
// Si dominas un prerequisito, los conceptos dependientes suben un poco
export function propagateDomainGains(
  graph: StudentKnowledgeGraph,
  updatedConceptId: string,
  newDomain: number,
): Array<{ conceptId: string; gain: number }> {
  const gains: Array<{ conceptId: string; gain: number }> = []

  const outEdges = graph.edges.filter(
    e => e.from === updatedConceptId &&
         ['enables', 'prerequisite'].includes(e.relation)
  )

  for (const edge of outEdges) {
    const targetNode = graph.nodes.find(n => n.id === edge.to)
    if (!targetNode) continue

    // Si el prerequisito sube, el dependiente gana un poco
    if (newDomain > 70) {
      const gain = Math.round(edge.strength * (newDomain - 70) * 0.1)
      if (gain > 0) {
        gains.push({ conceptId: edge.to, gain })
      }
    }
  }

  return gains
}
