import type { VisualEngine, VisualInteractionVerb, VisualRequiredness, VisualRequirement } from './visualContract'

export interface ClassifiableStep {
  microId: string
  title: string
  content: string
  keyPoints: string[]
  factKeys: string[]
  cognitiveTarget: string
  sourceStepId: string
}

interface EngineInteractionSet {
  teach: VisualInteractionVerb[]
  practice: VisualInteractionVerb[]
  assess: VisualInteractionVerb[]
}

const INTERACTIONS: Record<VisualEngine, EngineInteractionSet> = {
  graph_2d: { teach: ['reveal_progressive', 'highlight'], practice: ['select_region'], assess: ['select_region'] },
  structured_grid: { teach: ['reveal_progressive', 'highlight'], practice: ['fill_cell'], assess: ['fill_cell'] },
  spatial_vector: { teach: ['reveal_progressive', 'highlight'], practice: ['place_vector'], assess: ['place_vector'] },
  chemistry_2d: { teach: ['reveal_progressive', 'highlight'], practice: ['label_structure'], assess: ['label_structure'] },
  code_execution: { teach: ['step_through', 'highlight'], practice: ['predict_output'], assess: ['predict_output'] },
  timeline: { teach: ['reveal_progressive'], practice: ['order_sequence'], assess: ['order_sequence'] },
  geometry_canvas:{teach:['reveal_progressive','highlight'],practice:['select_point'],assess:['select_point']},
  structure_graph:{teach:['reveal_progressive','highlight'],practice:['select_node'],assess:['select_node']},
  flow_state:{teach:['reveal_progressive','highlight'],practice:['select_stage'],assess:['select_stage']},
  equation_expression:{teach:['reveal_progressive','highlight'],practice:['transform_expression'],assess:['transform_expression']},
  source_image:{teach:['highlight'],practice:['select_hotspot'],assess:['select_hotspot']},
}

const REPRESENTATION: Record<VisualEngine, string> = {
  graph_2d: 'coordinate_function',
  structured_grid: 'chemical_equilibrium_ice',
  spatial_vector: 'free_body_diagram',
  chemistry_2d: 'skeletal_structure',
  code_execution: 'execution_trace',
  timeline: 'chronological_sequence',
  geometry_canvas:'geometric_construction',structure_graph:'relational_structure',flow_state:'process_or_state',equation_expression:'symbolic_transformation',source_image:'grounded_source_figure',
}

// Señales puramente estructurales/cognitivas del texto — NUNCA el nombre de la
// asignatura. Cada detector busca la propiedad cognitiva real (relación espacial,
// tabla cuantitativa de cambio, notación funcional, traza de ejecución, topología de
// enlaces, secuencia temporal), no una palabra clave de materia.
function detectEngine(text: string): { engine: VisualEngine; signals: string[] } | null {
  const lower = text.toLowerCase()
  const signals: string[] = []

  // Bloque de código: señal muy específica, se resuelve antes que cualquier otra
  // (una asignación "y = ..." DENTRO de un bloque de código no es notación de
  // función matemática — es una línea de programa).
  const hasCodeBlock = /```/.test(text)
  const hasExecutionWords = /\btraza\b|\bejecuci[oó]n\b|\bpaso a paso\b|\bsalida\b|\bstack\b|\bpila\b/.test(lower)
  if (hasCodeBlock && hasExecutionWords) {
    signals.push('code_block', 'execution_trace_vocabulary')
    return { engine: 'code_execution', signals }
  }
  const textOutsideCode = text.replace(/```[\s\S]*?```/g, ' ')
  const lowerOutsideCode = textOutsideCode.toLowerCase()

  const hasReactionArrow = /[⇌↔]|<=>|<->/.test(textOutsideCode)
  const hasChangeTableWords = /\binicial(es)?\b/.test(lowerOutsideCode) && /\bcambio\b/.test(lowerOutsideCode) && /\bequilibrio\b/.test(lowerOutsideCode)
  if (hasReactionArrow && hasChangeTableWords) {
    signals.push('reaction_arrow', 'initial_change_equilibrium_table')
    return { engine: 'structured_grid', signals }
  }

  const hasForceWords = /\bfuerza(s)?\b|\bvector(es)?\b|\btensi[oó]n\b|\bnormal\b|\bfricci[oó]n\b|\bpeso\b/.test(lowerOutsideCode)
  const hasAngleOrAxis = /°|\bgrados?\b|\beje\s*[xy]\b|\bhorizontal\b|\bvertical\b|\bángulo\b|\bangulo\b/.test(lowerOutsideCode)
  if (hasForceWords && hasAngleOrAxis) {
    signals.push('force_vocabulary', 'angle_or_axis_reference')
    return { engine: 'spatial_vector', signals }
  }

  const coordinatePoints=(textOutsideCode.match(/[A-Z]\s*=\s*\(\s*-?\d+(?:[.,]\d+)?\s*,\s*-?\d+(?:[.,]\d+)?\s*\)/g)||[]).length
  if(coordinatePoints>=2){signals.push('explicit_coordinate_points','geometric_relation');return{engine:'geometry_canvas',signals}}

  // "f(x) =" es un marcador muy distintivo (rara vez aparece por coincidencia en
  // prosa) — se acepta solo con esa forma. La forma desnuda "y = ..." SÍ puede
  // colisionar con prosa ("llegó a las 8 y = 5 minutos después...") — para esa forma
  // exigimos que el lado derecho dependa realmente de x (si no, "y = <número>" suelto
  // es casi siempre una coincidencia de puntuación/hora, no notación funcional).
  const hasExplicitFOfX = /\bf\s*\(\s*x\s*\)\s*=/.test(textOutsideCode)
  const bareYMatch = textOutsideCode.match(/\by\s*=\s*([^\n,.;]{0,40})/)
  // 'x' como variable — acepta "3x" (coeficiente pegado, notación algebraica normal)
  // pero rechaza 'x' dentro de otra palabra ("extra", "excelente").
  const standaloneXPattern = /(?<![a-záéíóúñ])x(?![a-záéíóúñ])/i
  const hasBareYDependingOnX = Boolean(bareYMatch && standaloneXPattern.test(bareYMatch[1]))
  const hasFunctionNotation = hasExplicitFOfX || hasBareYDependingOnX
  const hasGraphWords = /\bgr[aá]fica\b|\bdominio\b|\brango\b|\bpendiente\b|\bintersecci[oó]n\b|\basíntota\b|\basintota\b/.test(lowerOutsideCode)
  if (hasFunctionNotation && hasGraphWords) {
    signals.push('function_notation', 'graph_interpretation_vocabulary')
    return { engine: 'graph_2d', signals }
  }
  if (hasFunctionNotation) {
    signals.push('function_notation')
    return { engine: 'graph_2d', signals }
  }

  const hasBondWords = /\benlace(s)?\b|\bátomo(s)?\b|\batomo(s)?\b|\bestructura esquel[eé]tica\b|\bf[oó]rmula estructural\b|\bf[oó]rmula condensada\b|\bmol[eé]cula\b/.test(lower)
  // Dos formas de notación: "C1-C2" (id+índice, formato explícito previo) o
  // fórmula condensada estándar "CH3-CH2-CH3" (grupos C/CH/CH2/CH3 con
  // ramificaciones opcionales) — ver chemistry2DEngine.ts para el parser real.
  const hasElementPattern = /\b[A-Z][a-z]?\d*(-[A-Z][a-z]?\d*){1,}\b/.test(text)
    || /C(?:H\d?)?(?:\([^()]*\))?(?:\s*[-=#]\s*C(?:H\d?)?(?:\([^()]*\))?)+/.test(text)
  if (hasBondWords && hasElementPattern) {
    signals.push('bond_vocabulary', 'element_bond_pattern')
    return { engine: 'chemistry_2d', signals }
  }

  const relationCount = (textOutsideCode.match(/(?:->|→|depende de|conecta con|contiene|se divide en|forma parte de)/gi) || []).length
  const processLanguage = /\bproceso\b|\betapa\b|\bflujo\b|\btransici[oó]n\b|\bciclo\b|\bprimero\b|\bdespu[eé]s\b/.test(lowerOutsideCode)
  if (relationCount >= 1 && processLanguage) {
    signals.push('ordered_stages', 'process_relation')
    return { engine: 'flow_state', signals }
  }
  if (relationCount >= 2) {
    signals.push('explicit_node_relations', 'connectivity')
    return { engine: 'structure_graph', signals }
  }

  const yearMatches = text.match(/\b(1[0-9]{3}|20[0-9]{2})\b/g) || []
  const hasSequenceWords = /\bcronolog[ií]a\b|\bl[ií]nea de tiempo\b|\bsecuencia\b|\borden cronol[oó]gico\b/.test(lower)
  if (yearMatches.length >= 2 || (yearMatches.length >= 1 && hasSequenceWords)) {
    signals.push('multiple_temporal_markers')
    return { engine: 'timeline', signals }
  }

  const equationLines=textOutsideCode.split(/\n|;/).filter(line=>line.includes('=')&&/[+\-*/^]/.test(line)).length
  if(equationLines>=1){signals.push('explicit_equation','symbolic_structure');return{engine:'equation_expression',signals}}

  return null
}

function determineRequiredness(engine: VisualEngine, cognitiveTarget: string): VisualRequiredness {
  if (engine === 'timeline'||engine==='source_image') return 'supportive'
  if (cognitiveTarget === 'application' || cognitiveTarget === 'analysis' || cognitiveTarget === 'transfer') {
    return 'required_for_mastery'
  }
  if (cognitiveTarget === 'comprehension') return 'required_for_understanding'
  return 'supportive'
}

// Clasificador puro y determinista: mismo input -> mismo output siempre. No llama a
// ningún proveedor de IA, no conoce la asignatura del material.
export function classifyVisualNeed(step: ClassifiableStep): VisualRequirement | null {
  const text = `${step.title}\n${step.content}\n${step.keyPoints.join('\n')}`
  const detected = detectEngine(text)
  if (!detected) return null
  const { engine, signals } = detected
  const requiredness = determineRequiredness(engine, step.cognitiveTarget)
  const interactions = INTERACTIONS[engine]
  const evidenceRequirements = requiredness === 'required_for_mastery'
    ? engine === 'graph_2d' || engine === 'code_execution'
      ? { interpret: true }
      : { construct: true }
    : requiredness === 'required_for_understanding'
      ? { interpret: true }
      : undefined

  return {
    id: `visualreq:${step.microId}`,
    microId: step.microId,
    requiredness,
    representation: REPRESENTATION[engine],
    engine,
    interactions,
    sourceGrounding: {
      sourceSpans: step.factKeys.map(factKey => ({ stepId: step.sourceStepId, factKey })),
      factKeys: [...step.factKeys],
    },
    evidenceRequirements,
    cognitiveSignals: signals,
    need: engine==='graph_2d'?'coordinate_graph':engine==='structured_grid'?'structured_grid':engine==='spatial_vector'?'vector_spatial':engine==='chemistry_2d'?'molecular_structure':engine==='code_execution'?'code_execution':engine==='timeline'?'timeline':engine==='geometry_canvas'?'geometry':engine==='structure_graph'?'network_connectivity':engine==='flow_state'?'process_flow':engine==='equation_expression'?'equation_structure':'source_figure',
    visualBenefit: requiredness==='required_for_mastery'?4:requiredness==='required_for_understanding'?3:2,
  }
}

export function visualNeedCandidates(step:ClassifiableStep):VisualRequirement[]{
  const primary=classifyVisualNeed(step)
  if(!primary)return[]
  const candidates=[primary]
  const source=`${step.title}\n${step.content}\n${step.keyPoints.join('\n')}`
  if(primary.engine==='graph_2d'&&source.includes('=')){const secondary={...primary,id:`${primary.id}:equation`,engine:'equation_expression' as const,representation:REPRESENTATION.equation_expression,need:'equation_structure' as const,interactions:INTERACTIONS.equation_expression,cognitiveSignals:[...primary.cognitiveSignals,'supporting_symbolic_structure']};candidates.push(secondary)}
  if(primary.engine==='structured_grid'&&/[⇌↔]|<=>|<->/.test(source)){const secondary={...primary,id:`${primary.id}:equation`,engine:'equation_expression' as const,representation:REPRESENTATION.equation_expression,need:'equation_structure' as const,interactions:INTERACTIONS.equation_expression,cognitiveSignals:[...primary.cognitiveSignals,'supporting_equation']};candidates.push(secondary)}
  return candidates.slice(0,3)
}
