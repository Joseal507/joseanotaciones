import type { VisualRequirement, VisualSpec } from './visualContract'
import { extractGraphSpec } from './engines/graphEngine'
import { extractStructuredGridSpec } from './engines/structuredGridEngine'
import { extractSpatialVectorSpec } from './engines/spatialVectorEngine'
import { extractChemistry2DSpec } from './engines/chemistry2DEngine'
import { extractCodeExecutionSpec } from './engines/codeExecutionEngine'
import { extractTimelineSpec } from './engines/timelineEngine'

let specCounter = 0

// Único punto de construcción de VisualSpec: despacha por engine, y SOLO devuelve un
// spec cuando el extractor determinista del engine confirma datos reales en
// sourceText. Si la extracción falla (dato insuficiente), devuelve null — nunca se
// fabrica un VisualSpec "conceptual" con valores inventados en esta slice (FASE 6:
// preferimos omitir el visual antes que presentar un ejemplo inventado como si
// viniera del material).
export function buildVisualSpec(requirement: VisualRequirement, sourceText: string, sourceStepId: string): VisualSpec | null {
  const { factKeys } = requirement.sourceGrounding
  const id = `visualspec:${requirement.microId}:${++specCounter}`
  const base = { id, requirementId: requirement.id, microId: requirement.microId, representation: requirement.representation, conceptual: false as const }

  if (requirement.engine === 'graph_2d') {
    const extraction = extractGraphSpec(sourceText, factKeys, sourceStepId)
    if (!extraction) return null
    return { ...base, engine: 'graph_2d', data: extraction.data, sourceGrounding: { sourceSpans: extraction.sourceSpans, factKeys } }
  }
  if (requirement.engine === 'structured_grid') {
    const extraction = extractStructuredGridSpec(sourceText, factKeys, sourceStepId)
    if (!extraction) return null
    return { ...base, engine: 'structured_grid', data: extraction.data, sourceGrounding: { sourceSpans: extraction.sourceSpans, factKeys } }
  }
  if (requirement.engine === 'spatial_vector') {
    const extraction = extractSpatialVectorSpec(sourceText, factKeys, sourceStepId)
    if (!extraction) return null
    return { ...base, engine: 'spatial_vector', data: extraction.data, sourceGrounding: { sourceSpans: extraction.sourceSpans, factKeys } }
  }
  if (requirement.engine === 'chemistry_2d') {
    const extraction = extractChemistry2DSpec(sourceText, factKeys, sourceStepId)
    if (!extraction) return null
    return { ...base, engine: 'chemistry_2d', data: extraction.data, sourceGrounding: { sourceSpans: extraction.sourceSpans, factKeys } }
  }
  if (requirement.engine === 'code_execution') {
    const extraction = extractCodeExecutionSpec(sourceText, factKeys, sourceStepId)
    if (!extraction) return null
    return { ...base, engine: 'code_execution', data: extraction.data, sourceGrounding: { sourceSpans: extraction.sourceSpans, factKeys } }
  }
  const extraction = extractTimelineSpec(sourceText, factKeys, sourceStepId)
  if (!extraction) return null
  return { ...base, engine: 'timeline', data: extraction.data, sourceGrounding: { sourceSpans: extraction.sourceSpans, factKeys } }
}
