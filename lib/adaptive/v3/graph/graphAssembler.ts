// ═══════════════════════════════════════════════════════════════
// GRAPH ASSEMBLER
// 
// Código puro — NO usa LLM.
// Toma los micros extraídos y los ensambla en un grafo:
// - Deduplica
// - Agrupa por topicGroup
// - Calcula métricas del grafo
// ═══════════════════════════════════════════════════════════════

import type {
  KnowledgeGraph,
  MicroConcept,
  TopicGroup,
  DependencyEdge,
} from '../types'
import type { ExtractionResult } from './microExtractor'

export interface AssemblyResult {
  micros: MicroConcept[]
  topicGroups: TopicGroup[]
  stats: {
    totalMicrosBeforeDedupe: number
    totalMicrosAfterDedupe: number
    duplicatesRemoved: number
    topicGroupsCount: number
    averageDifficulty: number
    totalEstimatedMinutes: number
  }
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export function assembleGraph(extractionResults: ExtractionResult[]): AssemblyResult {
  // 1. Recoger todos los micros
  const allMicros: MicroConcept[] = []
  for (const result of extractionResults) {
    allMicros.push(...result.micros)
  }

  const totalMicrosBeforeDedupe = allMicros.length

  // 2. Deduplicar por nombre similar
  const dedupedMicros = deduplicateMicros(allMicros)

  // 3. Agrupar por topicGroup
  const topicGroups = groupIntoTopics(dedupedMicros)

  // 4. Calcular métricas
  const averageDifficulty = dedupedMicros.length > 0
    ? Math.round(dedupedMicros.reduce((s, m) => s + m.difficulty, 0) / dedupedMicros.length)
    : 0
  const totalEstimatedMinutes = dedupedMicros.reduce((s, m) => s + m.estimatedMinutes, 0)

  return {
    micros: dedupedMicros,
    topicGroups,
    stats: {
      totalMicrosBeforeDedupe,
      totalMicrosAfterDedupe: dedupedMicros.length,
      duplicatesRemoved: totalMicrosBeforeDedupe - dedupedMicros.length,
      topicGroupsCount: topicGroups.length,
      averageDifficulty,
      totalEstimatedMinutes,
    },
  }
}

// ═══════════════════════════════════════════════════════════════
// DEDUPLICAR MICROS
// ═══════════════════════════════════════════════════════════════
function deduplicateMicros(micros: MicroConcept[]): MicroConcept[] {
  const seen: MicroConcept[] = []

  for (const micro of micros) {
    const norm = normalizeForCompare(micro.name)
    const duplicate = seen.find(s => {
      const sn = normalizeForCompare(s.name)
      // Nombres iguales o muy parecidos
      return sn === norm ||
             (sn.length > 5 && norm.length > 5 && (sn.includes(norm) || norm.includes(sn)))
    })

    if (duplicate) {
      // Mergear info del duplicado
      duplicate.sourceQuotes = mergeUnique([...duplicate.sourceQuotes, ...micro.sourceQuotes]).slice(0, 8)
      duplicate.sourceChunkIds = mergeUnique([...duplicate.sourceChunkIds, ...micro.sourceChunkIds])
      duplicate.sourcePages = mergeUnique([...duplicate.sourcePages, ...micro.sourcePages])
      duplicate.examples = mergeExamples([...duplicate.examples, ...micro.examples])
      duplicate.formulas = mergeFormulas([...duplicate.formulas, ...micro.formulas])
      duplicate.procedures = mergeProcedures([...duplicate.procedures, ...micro.procedures])
      duplicate.commonErrors = mergeErrors([...duplicate.commonErrors, ...micro.commonErrors])

      // Upgrade importancia si el duplicado tiene mayor
      const impOrder = { critical: 3, high: 2, medium: 1, low: 0 }
      if (impOrder[micro.importance] > impOrder[duplicate.importance]) {
        duplicate.importance = micro.importance
      }

      // Concatenar definición si es distinta
      if (!duplicate.fullDefinition.includes(micro.fullDefinition.slice(0, 50))) {
        duplicate.fullDefinition = (duplicate.fullDefinition + ' ' + micro.fullDefinition).slice(0, 800)
      }
    } else {
      seen.push({ ...micro })
    }
  }

  return seen
}

// ═══════════════════════════════════════════════════════════════
// AGRUPAR MICROS EN TOPIC GROUPS
// ═══════════════════════════════════════════════════════════════
function groupIntoTopics(micros: MicroConcept[]): TopicGroup[] {
  const groupsMap = new Map<string, MicroConcept[]>()

  for (const micro of micros) {
    const groupKey = normalizeForCompare(micro.topicGroup || 'general')
    if (!groupsMap.has(groupKey)) groupsMap.set(groupKey, [])
    groupsMap.get(groupKey)!.push(micro)
  }

  const groups: TopicGroup[] = []
  let order = 0
  for (const [groupKey, groupMicros] of groupsMap.entries()) {
    // Usar el nombre original del primer micro para el grupo
    const displayName = groupMicros[0].topicGroup || 'General'
    groups.push({
      id: `topic_${groupKey}_${Date.now()}`,
      name: displayName,
      description: `${groupMicros.length} microconceptos`,
      microIds: groupMicros.map(m => m.id),
      order: order++,
    })
  }

  // Ordenar grupos: primero los que tienen micros críticos
  groups.sort((a, b) => {
    const aCritical = countCriticalInGroup(a, micros)
    const bCritical = countCriticalInGroup(b, micros)
    return bCritical - aCritical
  })

  // Reasignar order tras sort
  groups.forEach((g, i) => { g.order = i })

  return groups
}

function countCriticalInGroup(group: TopicGroup, allMicros: MicroConcept[]): number {
  return group.microIds
    .map(id => allMicros.find(m => m.id === id))
    .filter(m => m?.importance === 'critical').length
}

// ═══════════════════════════════════════════════════════════════
// HELPERS DE DEDUPLICACIÓN
// ═══════════════════════════════════════════════════════════════
function normalizeForCompare(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function mergeUnique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

function mergeExamples(examples: any[]): any[] {
  const seen: any[] = []
  for (const ex of examples) {
    const norm = normalizeForCompare(ex.scenario.slice(0, 80))
    if (!seen.find(s => normalizeForCompare(s.scenario.slice(0, 80)) === norm)) {
      seen.push(ex)
    }
  }
  return seen.slice(0, 5)
}

function mergeFormulas(formulas: any[]): any[] {
  const seen: any[] = []
  for (const f of formulas) {
    const norm = normalizeForCompare(f.expression)
    if (!seen.find(s => normalizeForCompare(s.expression) === norm)) {
      seen.push(f)
    }
  }
  return seen
}

function mergeProcedures(procedures: any[]): any[] {
  const seen: any[] = []
  for (const p of procedures) {
    const norm = normalizeForCompare(p.name)
    if (!seen.find(s => normalizeForCompare(s.name) === norm)) {
      seen.push(p)
    }
  }
  return seen
}

function mergeErrors(errors: any[]): any[] {
  const seen: any[] = []
  for (const e of errors) {
    const norm = normalizeForCompare(e.description.slice(0, 80))
    if (!seen.find(s => normalizeForCompare(s.description.slice(0, 80)) === norm)) {
      seen.push(e)
    }
  }
  return seen
}
