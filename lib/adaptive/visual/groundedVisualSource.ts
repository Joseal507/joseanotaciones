import { classifyVisualNeed, type ClassifiableStep } from './visualNeedClassifier'
import { buildVisualCompositionPlan } from './visualComposition'
import type { VisualCompositionPlan, VisualRequirement, VisualSpec } from './visualContract'
import { buildSourceImageSpec } from './engines/universalPrimitiveEngines'

// StudyAL_Visual_System_Stress_Test — cierre arquitectónico del Visual Pedagogy
// System (pedido explícito del usuario, "no quiero seguir parchando paráfrasis
// con regex indefinidamente").
//
// ANTES: SOURCE MATERIAL -> LLM reescribe teaching prose (una vez por CADA
// sesión preparada) -> classifyVisualNeed/buildVisualSpec sobre esa prosa ->
// VisualSpec. El visual dependía de cómo el LLM de enseñanza decidiera
// redactar esa vez — una paráfrasis distinta con los MISMOS datos podía hacer
// desaparecer el visual (extractor con regex rígida sobre texto libre).
//
// AHORA: SOURCE MATERIAL -> blueprint extrae block.sourceSpans[].quote (cita
// literal corta del documento, UNA sola vez, en blueprint/route.ts, prompt
// "exact short quote from the source text") -> este módulo clasifica/extrae
// el VisualSpec directamente desde esos datos grounded, ANTES de que exista
// ninguna prosa de enseñanza. factoryTeaching intenta este camino PRIMERO
// (ver session-teach/route.ts); solo si no hay bloque relacionado con datos
// grounded suficientes cae al camino anterior (prosa) como fallback seguro.
//
// Reutiliza el MISMO classifyVisualNeed/buildVisualSpec/engine que el camino
// basado en prosa — cero regex nuevas, cero motor paralelo. La única
// diferencia es QUÉ texto reciben: el bloque grounded en vez de la prosa
// regenerada. Esto hace el visual invariante a la redacción de la clase por
// construcción, no por tolerancia de regex.

export interface GroundedBlockLike {
  id: string
  label?: string
  summary?: string
  sourceSpans?: Array<{ quote?: string; page?: number; certainty?: string }>
  bloomLevel?: string
  sourceFigures?: Array<{ src?: string; alt?: string; page?: number; bounds?: { x:number; y:number; width:number; height:number }; hotspots?: Array<{ id:string; label:string; x:number; y:number; radius?:number }> }>
}

function bloomToCognitiveTarget(bloomLevel?: string): string {
  const level = (bloomLevel || '').toLowerCase()
  if (level === 'apply' || level === 'analyze' || level === 'evaluate' || level === 'create') return 'application'
  if (level === 'understand') return 'comprehension'
  return 'recognition'
}

// Devuelve null si el bloque no tiene sourceSpans/summary suficientes para
// clasificar o extraer — fail closed, nunca fabrica un visual desde un
// bloque vacío. `quote` en cada sourceSpan de la firma es literal del
// material (certainty puede ser 'inferred'/'uncertain' — ver blueprint
// route.ts — pero el TEXTO en sí nunca se inventa, viene de la extracción).
export function extractGroundedVisualSource(block: GroundedBlockLike): { requirement: VisualRequirement; spec: VisualSpec } | null {
  const composition = extractGroundedVisualComposition(block)
  if (!composition) return null
  const input = blockToClassifiableStep(block)
  const requirement = input ? classifyVisualNeed(input) || (composition.primary.engine === 'source_image' ? sourceImageRequirement(block.id) : null) : null
  return requirement ? { requirement, spec: composition.primary } : null
}

function blockToClassifiableStep(block: GroundedBlockLike): ClassifiableStep | null {
  const quotes = (block.sourceSpans || []).map(s => s.quote).filter((q): q is string => Boolean(q && q.trim()))
  const figureLabels = (block.sourceFigures || []).map(figure => figure.alt).filter(Boolean)
  const content = [block.summary, ...quotes, ...figureLabels].filter(Boolean).join('\n').trim()
  if (!content) return null
  return { microId: block.id, title: block.label || '', content, keyPoints: [], factKeys: [block.id], cognitiveTarget: bloomToCognitiveTarget(block.bloomLevel), sourceStepId: block.id }
}

function sourceImageRequirement(blockId: string): VisualRequirement {
  return { id:`visualreq:${blockId}:source`, microId:blockId, requiredness:'supportive', representation:'grounded_source_figure', engine:'source_image', interactions:{teach:['highlight'],practice:['select_hotspot'],assess:['select_hotspot']}, sourceGrounding:{factKeys:[blockId],sourceSpans:[{stepId:blockId,factKey:blockId}]}, cognitiveSignals:['existing_grounded_source_figure'], need:'source_figure', visualBenefit:2 }
}

export function extractGroundedVisualComposition(block: GroundedBlockLike): VisualCompositionPlan | null {
  const quotes = (block.sourceSpans || []).map(s => s.quote).filter((q): q is string => Boolean(q && q.trim()))
  const input = blockToClassifiableStep(block)
  if (!input) return null
  const content = input.content

  const primaryQuote = quotes[0]
  const composition = buildVisualCompositionPlan(input)
  const sourceData = (block.sourceFigures || []).map(buildSourceImageSpec).find(Boolean)
  const sourceSpec: VisualSpec | null = sourceData ? {
    id: `visualspec:${block.id}:source`, requirementId: `visualreq:${block.id}:source`, microId: block.id,
    representation: 'grounded_source_figure', conceptual: false, engine: 'source_image', data: sourceData,
    provenance: { kind:'SOURCE', reproducible:true, inputs:[sourceData.src] },
    sourceGrounding: { factKeys:[block.id], sourceSpans:[{stepId:block.id,factKey:block.id,blockId:block.id,quote:primaryQuote}] },
  } : null
  if (!composition && !sourceSpec) return null
  const ground = (spec: VisualSpec): VisualSpec => ({
      ...spec,
      sourceGrounding: {
        ...spec.sourceGrounding,
        sourceSpans: spec.sourceGrounding.sourceSpans.map(span => ({
        ...span,
        blockId: block.id,
        quote: span.quote || primaryQuote,
      })),
      },
  })
  if (!composition && sourceSpec) return { primary: sourceSpec, supporting: [], purpose:'Preserve and explore the grounded source figure', complexity:1 }
  const groundedComposition = composition!
  const structured = [ground(groundedComposition.primary), ...groundedComposition.supporting.map(ground)]
  if (sourceSpec) return { primary: sourceSpec, supporting: structured.slice(0,2), purpose:'Use the original figure before a structured reconstruction', complexity:Math.min(3,structured.length+1) }
  return { ...groundedComposition, primary: structured[0], supporting: structured.slice(1) }
}
