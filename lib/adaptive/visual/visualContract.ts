// Contrato canónico de visuales — general, no ad-hoc (no needsGraph/isChemistry/showICE).
// VisualRequirement = por qué/si hace falta un visual para un microconcepto (derivado de
// señales cognitivas del contenido, nunca del nombre de la asignatura).
// VisualSpec = qué renderizar en concreto, con datos extraídos DEL MATERIAL real (nunca
// inventados) y grounding trazable a sourceSpans/factKeys.

export type VisualEngine =
  | 'graph_2d'
  | 'structured_grid'
  | 'spatial_vector'
  | 'chemistry_2d'
  | 'code_execution'
  | 'timeline'
  | 'geometry_canvas'
  | 'structure_graph'
  | 'flow_state'
  | 'equation_expression'
  | 'source_image'

export type UniversalVisualNeed =
  | 'quantitative_relation' | 'coordinate_graph' | 'geometry' | 'vector_spatial'
  | 'structured_grid' | 'hierarchy' | 'network_connectivity' | 'process_flow'
  | 'state_transition' | 'timeline' | 'comparison' | 'sequence' | 'anatomy_spatial'
  | 'molecular_structure' | 'code_execution' | 'equation_structure' | 'image_annotation'
  | 'source_figure' | 'map_spatial' | 'symbolic_manipulation'

export type VisualBenefit = 0 | 1 | 2 | 3 | 4
export type VisualProvenanceKind = 'SOURCE' | 'STRUCTURED' | 'DERIVED'

export type VisualRequiredness =
  | 'optional'
  | 'supportive'
  | 'required_for_understanding'
  | 'required_for_mastery'

export type VisualInteractionMode = 'teach' | 'practice' | 'assess'

// Vocabulario de interacción con clasificación de determinismo de grading:
// D = totalmente determinista, C = determinista-constreñido (comparación estructurada
// contra tolerancia/orden), L = requiere juicio (no usado por los engines de esta slice —
// documentado para futuras extensiones, ninguna interacción D/C actual delega en LLM).
export type VisualInteractionVerb =
  | 'reveal_progressive'   // D — teach: revelar elementos en orden
  | 'highlight'            // D — teach: resaltar elemento(s)
  | 'fill_cell'            // D — practice/assess: completar celda de grid estructurado
  | 'place_vector'         // C — practice/assess: ubicar/ajustar vector (ángulo+magnitud con tolerancia)
  | 'select_region'        // D — practice/assess: seleccionar región/punto en gráfica
  | 'predict_output'       // D — practice/assess: predecir salida de ejecución
  | 'step_through'         // D — teach/practice: avanzar paso a paso una traza
  | 'label_structure'      // D — practice/assess: etiquetar átomo/enlace/elemento
  | 'order_sequence'       // D — practice/assess: ordenar eventos (timeline)
  | 'select_point'
  | 'select_node'
  | 'select_edge'
  | 'select_stage'
  | 'select_hotspot'
  | 'transform_expression'

export interface VisualSourceSpan {
  stepId: string
  factKey: string
  blockId?: string
  quote?: string
}

export interface VisualSourceGrounding {
  sourceSpans: VisualSourceSpan[]
  factKeys: string[]
}

export interface VisualEvidenceRequirements {
  interpret?: boolean
  construct?: boolean
  manipulate?: boolean
  transfer?: boolean
}

export interface VisualRequirement {
  id: string
  microId: string
  requiredness: VisualRequiredness
  representation: string
  engine: VisualEngine
  interactions: {
    teach: VisualInteractionVerb[]
    practice: VisualInteractionVerb[]
    assess: VisualInteractionVerb[]
  }
  sourceGrounding: VisualSourceGrounding
  evidenceRequirements?: VisualEvidenceRequirements
  // Señales cognitivas que dispararon esta clasificación — auditable, nunca el nombre
  // de la asignatura (ver visualNeedClassifier.ts).
  cognitiveSignals: string[]
  need?: UniversalVisualNeed
  visualBenefit?: VisualBenefit
}

// evidenceKind: usado por assessmentBlueprint.ts para exigir que un objective con
// requiredEvidenceKind !== undefined SOLO pueda demostrarse con evidencia del mismo
// tipo (una MCQ textual correcta no basta si el objective exige visual_construction).
export type VisualEvidenceKind =
  | 'textual'
  | 'visual_interpretation'
  | 'visual_construction'
  | 'visual_manipulation'

export interface GraphDataSpec {
  expression: string
  domain: [number, number]
  points: Array<{ x: number; y: number; label?: string }>
  annotations?: string[]
}

export interface StructuredGridDataSpec {
  reaction: string
  title?:string
  stageLabels?:{initial:string;change:string;equilibrium:string}
  species: string[]
  initial: Record<string, number | string>
  change: Record<string, string>
  equilibrium: Record<string, number | string | null>
}

export interface SpatialVectorDataSpec {
  body: string
  forces: Array<{ id: string; label: string; magnitude: number | null; angleDeg: number; unit?: string }>
  axes: { x: string; y: string }
  decomposition?: { forceId: string; xMagnitude: number; yMagnitude: number; unit?: string; angleDeg: number }
}

export interface Chemistry2DDataSpec {
  atoms: Array<{ id: string; element: string; x: number; y: number }>
  bonds: Array<{ from: string; to: string; order: 1 | 2 | 3 }>
  charges?: Array<{ atomId: string; charge: number }>
  stereochemistry?: string
}

export interface CodeExecutionDataSpec {
  language: string
  code: string
  steps: Array<{ line: number; variables: Record<string, string | number | boolean>; stack?: string[]; output?: string }>
}

export interface TimelineDataSpec {
  events: Array<{ id: string; label: string; date?: string; endDate?:string; detail?:string; order: number }>
  relations?:Array<{from:string;to:string;label?:string}>
}

export interface GeometryCanvasDataSpec {
  points: Array<{ id:string; x:number; y:number; label?:string }>
  segments: Array<{ id:string; from:string; to:string; label?:string; kind?:'segment'|'ray'|'line'|'vector'|'component'|'projection'; measurement?:number; unit?:string }>
  circles?: Array<{ id:string; center:string; radius:number; label?:string }>
  angles?: Array<{ id:string; vertex:string; from:string; to:string; degrees?:number; label?:string }>
  polygons?: Array<{ id:string; points:string[]; label?:string; kind?:'polygon'|'triangle'|'rectangle'; fill?:string }>
  paths?: Array<{ id:string; points:Array<{x:number;y:number}>; label?:string; kind?:'trajectory'|'arc' }>
  regions?: Array<{ id:string; points:string[]; label:string }>
  axes?: boolean
  assessment?: { verb:'select_point'|'select_edge'|'select_region'; targetId:string }
}

export interface StructureGraphDataSpec {
  nodes: Array<{ id:string; label:string; kind?:string }>
  edges: Array<{ id:string; from:string; to:string; label?:string; directed?:boolean }>
  layout: 'linear'|'tree'|'layered'|'radial'|'hierarchy'|'network'|'anatomy'|'molecular'
  assessment?: { verb:'select_node'|'select_edge'; targetId:string }
}

export interface FlowStateDataSpec {
  stages: Array<{ id:string; label:string; detail?:string }>
  transitions: Array<{ from:string; to:string; label?:string }>
  cyclic?: boolean
  assessment?: { verb:'select_stage'|'order_sequence'; targetId?:string; order?:string[] }
}

export interface EquationExpressionDataSpec {
  original:string
  steps:Array<{ id:string; expression:string; operation?:string }>
}

export interface SourceImageDataSpec {
  src:string
  alt:string
  page?:number
  bounds?:{ x:number; y:number; width:number; height:number }
  hotspots:Array<{ id:string; label:string; x:number; y:number; radius?:number }>
  assessment?: { verb:'select_hotspot'; targetId:string }
}

export interface VisualDerivation {
  kind:VisualProvenanceKind
  operation?:string
  inputs?:string[]
  reproducible:boolean
}

interface VisualSpecBase {
  id: string
  requirementId: string
  microId: string
  representation: string
  sourceGrounding: VisualSourceGrounding
  // conceptual=true: no hay suficientes datos exactos en el material para una
  // representación literal — se marca explícitamente en vez de inventar valores
  // (FASE 6). Un spec conceptual nunca puede satisfacer required_for_mastery.
  conceptual: boolean
  // Firma HMAC server-authoritative (mismo patrón que CanonicalQuestion.integrity,
  // ver questionIntegrity.ts) — el cliente transporta el spec sin poder recalcularla.
  // visual-check la verifica ANTES de confiar en `data` para el grading.
  integrity?: string
  provenance?: VisualDerivation
}

export type VisualSpec =
  | (VisualSpecBase & { engine: 'graph_2d'; data: GraphDataSpec })
  | (VisualSpecBase & { engine: 'structured_grid'; data: StructuredGridDataSpec })
  | (VisualSpecBase & { engine: 'spatial_vector'; data: SpatialVectorDataSpec })
  | (VisualSpecBase & { engine: 'chemistry_2d'; data: Chemistry2DDataSpec })
  | (VisualSpecBase & { engine: 'code_execution'; data: CodeExecutionDataSpec })
  | (VisualSpecBase & { engine: 'timeline'; data: TimelineDataSpec })
  | (VisualSpecBase & { engine: 'geometry_canvas'; data: GeometryCanvasDataSpec })
  | (VisualSpecBase & { engine: 'structure_graph'; data: StructureGraphDataSpec })
  | (VisualSpecBase & { engine: 'flow_state'; data: FlowStateDataSpec })
  | (VisualSpecBase & { engine: 'equation_expression'; data: EquationExpressionDataSpec })
  | (VisualSpecBase & { engine: 'source_image'; data: SourceImageDataSpec })

export interface VisualCompositionPlan {
  primary: VisualSpec
  supporting: VisualSpec[]
  purpose: string
  complexity: number
}

export interface VisualInteractionSubmission {
  visualSpecId: string
  verb: VisualInteractionVerb
  response: unknown
}

export interface VisualGradingResult {
  correct: boolean
  score: number
  evidenceKind: VisualEvidenceKind
  feedback: string
  errorType: string | null
}
