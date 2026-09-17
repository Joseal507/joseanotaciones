import type { KnowledgeUnitKind, MaterialBrain, SourceRef } from './types'

export const MATERIAL_BRAIN_KIND_LABELS: Record<KnowledgeUnitKind, string> = {
  concept: 'Conceptos',
  definition: 'Definiciones',
  formula: 'Fórmulas',
  example: 'Ejemplos',
  fact: 'Datos',
  process: 'Procesos',
  event_or_data: 'Eventos / datos',
  terminology: 'Terminología',
}

function refKey(ref: SourceRef): string {
  return `${ref.materialId}:${ref.page}`
}

export interface MaterialBrainDebugSummary {
  units: number
  relations: number
  byKind: Partial<Record<KnowledgeUnitKind, number>>
  selectedPages: SourceRef[]
  coveredPages: SourceRef[]
  missingPages: SourceRef[]
  minimalPages: SourceRef[]
  visionPages: SourceRef[]
  coveragePercent: number
  groundedUnits: number
  ungroundedUnits: number
  warnings: string[]
}

export function deriveMaterialBrainDebugSummary(brain: MaterialBrain): MaterialBrainDebugSummary {
  const selectedPages = brain.scope.materials.flatMap(material =>
    material.selectedPages.map(page => ({ materialId: material.materialId, page })))
  const coveredPages = brain.sourceCoverage.processed
  const missingPages = brain.sourceCoverage.missing
  const minimalPages = brain.sourceCoverage.suspiciouslyEmpty
  const visionPages = brain.visualCoverage?.analyzed || []
  const represented = new Set(brain.units.flatMap(unit => [
    ...unit.provenance.map(item => refKey(item)),
    ...(unit.evidence || []).map(item => refKey(item)),
  ]))
  const selectedKeys = new Set(selectedPages.map(refKey))
  const representedSelected = [...selectedKeys].filter(key => represented.has(key)).length
  const groundedUnits = brain.units.filter(unit => unit.provenance.length > 0 || (unit.evidence?.length || 0) > 0).length
  const byKind = brain.units.reduce<Partial<Record<KnowledgeUnitKind, number>>>((counts, unit) => {
    counts[unit.kind] = (counts[unit.kind] || 0) + 1
    return counts
  }, {})
  const warnings: string[] = []
  const unrepresented = Math.max(0, selectedKeys.size - representedSelected)
  if (unrepresented) warnings.push(`${unrepresented} selected pages have no represented units`)
  if (groundedUnits < brain.units.length) warnings.push(`${brain.units.length - groundedUnits} units have no source provenance`)
  if (brain.meta.status !== 'ready') warnings.push(`Brain status = ${brain.meta.status}`)
  if (brain.sourceCoverage.status !== 'complete') warnings.push(`Source coverage = ${brain.sourceCoverage.status}`)
  if (brain.knowledgeExtraction.chunksFailed) warnings.push(`${brain.knowledgeExtraction.chunksFailed} extraction chunks failed`)
  warnings.push(...brain.knowledgeExtraction.warnings)
  return {
    units: brain.units.length,
    relations: brain.relations.length,
    byKind,
    selectedPages,
    coveredPages,
    missingPages,
    minimalPages,
    visionPages,
    coveragePercent: selectedKeys.size ? Math.round((representedSelected / selectedKeys.size) * 100) : 0,
    groundedUnits,
    ungroundedUnits: brain.units.length - groundedUnits,
    warnings: [...new Set(warnings)],
  }
}
