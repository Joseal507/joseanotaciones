import type { MicroConcept, TeachingObjective } from '../types'

const normalize = (value: unknown) => String(value || '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim()

export function contentFingerprint(value: unknown): string {
  return normalize(value).split(' ').filter(word => word.length > 2).join(' ')
}

export function contentSimilarity(left: unknown, right: unknown): number {
  const a = new Set(contentFingerprint(left).split(' ').filter(Boolean))
  const b = new Set(contentFingerprint(right).split(' ').filter(Boolean))
  if (a.size === 0 || b.size === 0) return 0
  const overlap = [...a].filter(word => b.has(word)).length
  return overlap / new Set([...a, ...b]).size
}

export function isNearDuplicateContent(candidate: unknown, previous: unknown[], threshold = 0.72): boolean {
  return previous.some(value => contentSimilarity(candidate, value) >= threshold)
}

export function buildDistinctRepairContent(
  micro: MicroConcept,
  objective: TeachingObjective,
  repairIndex: number,
): { tutorMessage: string; blocks: unknown[]; strategy: string } {
  const quote = micro.sourceQuotes[repairIndex % Math.max(1, micro.sourceQuotes.length)] || micro.shortDescription || micro.fullDefinition
  const strategies = ['contrast', 'structured_steps', 'source_evidence'] as const
  const strategy = strategies[repairIndex % strategies.length]
  if (strategy === 'contrast') {
    return {
      strategy,
      tutorMessage: `Cambiemos de representación: delimita qué es y qué no es ${micro.name}.`,
      blocks: [{ type: 'comparison', items: [
        { label: 'Sí pertenece al concepto', description: quote },
        { label: 'No basta para definirlo', description: 'Una asociación externa o una conclusión no respaldada por el material.' },
      ] }],
    }
  }
  if (strategy === 'structured_steps') {
    const parts = String(micro.fullDefinition || quote).split(/[.;]/).map(value => value.trim()).filter(Boolean).slice(0, 3)
    return {
      strategy,
      tutorMessage: `Ahora reconstruyamos ${micro.name} como una secuencia verificable.`,
      blocks: [{ type: 'steps', steps: (parts.length > 0 ? parts : [quote]).map((part, index) => ({ label: String(index + 1), content: part })) }],
    }
  }
  return {
    strategy,
    tutorMessage: `Probemos otro ángulo: parte de la evidencia textual y extrae la conclusión sobre ${micro.name}.`,
    blocks: [{ type: 'quote', text: quote, source: 'Material del estudiante' }, { type: 'callout', variant: 'insight', text: `La conclusión debe justificarse únicamente con esta evidencia; objetivo: ${objective}.` }],
  }
}
