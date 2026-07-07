// ═══════════════════════════════════════════════════════════════
// AGENTE 3 — CONSOLIDATOR
// 
// Junta los resultados de todos los analyzers.
// Detecta duplicados, ordena topics, infiere prerequisitos.
// Genera el MaterialIntelligence final.
// ═══════════════════════════════════════════════════════════════

import { alaiRequest, safeParseJson } from '../../../alai'
import type {
  MaterialIntelligence,
  TopicNode,
  FormulaItem,
  ProcedureItem,
  ExampleItem,
  CommonMistake,
  SubjectArea,
  TopicType,
} from '../types'
import type { ChunkAnalysis, RawTopic } from './analyzer'

export interface ConsolidationResult {
  intelligence: MaterialIntelligence
  stats: {
    totalTopicsBeforeDedupe: number
    totalTopicsAfterDedupe: number
    duplicatesRemoved: number
    prerequisitesInferred: number
    processingTimeMs: number
  }
  errors: string[]
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export async function consolidateAnalyses(
  materialId: string,
  materialTitle: string,
  chunkAnalyses: ChunkAnalysis[],
  totalPages: number = 0,
): Promise<ConsolidationResult> {
  const startTime = Date.now()
  const errors: string[] = []

  // Recoger todos los topics de todos los chunks
  const allRawTopics: Array<RawTopic & { chunkOrder: number }> = []
  chunkAnalyses.forEach(analysis => {
    analysis.topics.forEach(topic => {
      allRawTopics.push({ ...topic, chunkOrder: analysis.chunkOrder })
    })
  })

  const totalTopicsBeforeDedupe = allRawTopics.length

  // Detectar área del material desde subject hints
  const allHints = chunkAnalyses.flatMap(a => a.subjectHints)
  const subjectArea = detectSubjectArea(allHints, materialTitle, chunkAnalyses)

  // Deduplicar topics (por título similar)
  const dedupedTopics = dedupeTopics(allRawTopics)
  const duplicatesRemoved = totalTopicsBeforeDedupe - dedupedTopics.length

  // Convertir a TopicNode con IDs estables
  let topicNodes: TopicNode[] = dedupedTopics.map((raw, i) => ({
    id: `topic_${i + 1}_${Date.now()}`,
    title: raw.title,
    rawText: raw.rawText,
    keyFacts: raw.keyFacts,
    keyIdeas: [],
    topicType: normalizeTopicType(raw.topicType),
    cognitiveLoad: raw.importance === 'critical' ? 'heavy' : raw.importance === 'high' ? 'medium' : 'light',
    prerequisites: [],   // Se llenarán después
    relatedTopics: [],
    subtopics: [],
    formulaIds: [],
    procedureIds: [],
    exampleIds: [],
    mistakeIds: [],
    learningObjectives: raw.learningObjectives,
    importance: raw.importance,
    estimatedMinutes: raw.importance === 'critical' ? 12 : raw.importance === 'high' ? 8 : 5,
    sourcePage: raw.approximatePage,
  }))

  // Inferir prerequisitos entre topics
  const prerequisitesInferred = await inferPrerequisites(topicNodes, dedupedTopics)

  // Consolidar formulas, procedures, examples, mistakes
  const formulas: FormulaItem[] = deduplicateFormulas(chunkAnalyses)
  const procedures: ProcedureItem[] = deduplicateProcedures(chunkAnalyses)
  const keyExamples: ExampleItem[] = deduplicateExamples(chunkAnalyses, topicNodes)
  const commonMistakes: CommonMistake[] = deduplicateMistakes(chunkAnalyses, topicNodes)

  // Conectar topics con sus formulas/procedures/examples/mistakes
  linkResourcesToTopics(topicNodes, formulas, procedures, keyExamples, commonMistakes)

  // Determinar difficulty level general
  const difficultyLevel = detectDifficultyLevel(topicNodes, chunkAnalyses)

  const intelligence: MaterialIntelligence = {
    materialId,
    materialTitle,
    subjectArea,
    difficultyLevel,
    topics: topicNodes,
    formulas,
    procedures,
    keyExamples,
    commonMistakes,
    totalPages: totalPages || chunkAnalyses.length,
    analyzedAt: Date.now(),
  }

  return {
    intelligence,
    stats: {
      totalTopicsBeforeDedupe,
      totalTopicsAfterDedupe: topicNodes.length,
      duplicatesRemoved,
      prerequisitesInferred,
      processingTimeMs: Date.now() - startTime,
    },
    errors,
  }
}

// ═══════════════════════════════════════════════════════════════
// DEDUPLICAR TOPICS (por similitud de título)
// ═══════════════════════════════════════════════════════════════
function dedupeTopics(topics: Array<RawTopic & { chunkOrder: number }>): Array<RawTopic & { chunkOrder: number }> {
  const seen: Array<RawTopic & { chunkOrder: number }> = []

  for (const topic of topics) {
    const normalized = normalizeForCompare(topic.title)
    const duplicate = seen.find(s => {
      const sn = normalizeForCompare(s.title)
      return sn === normalized || 
             (sn.length > 4 && normalized.length > 4 && (sn.includes(normalized) || normalized.includes(sn)))
    })

    if (duplicate) {
      // Mergear información
      duplicate.keyFacts = [...new Set([...duplicate.keyFacts, ...topic.keyFacts])].slice(0, 10)
      duplicate.learningObjectives = [...new Set([...duplicate.learningObjectives, ...topic.learningObjectives])].slice(0, 5)
      duplicate.prerequisitesHint = [...new Set([...duplicate.prerequisitesHint, ...topic.prerequisitesHint])]
      
      // Concatenar rawText si son distintos
      if (!duplicate.rawText.includes(topic.rawText.slice(0, 100))) {
        duplicate.rawText = (duplicate.rawText + '\n\n' + topic.rawText).slice(0, 2500)
      }

      // Upgrade importance si el nuevo es mayor
      const importanceOrder = { low: 0, medium: 1, high: 2, critical: 3 }
      if (importanceOrder[topic.importance] > importanceOrder[duplicate.importance]) {
        duplicate.importance = topic.importance
      }
    } else {
      seen.push({ ...topic })
    }
  }

  return seen
}

function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ═══════════════════════════════════════════════════════════════
// INFERIR PREREQUISITOS ENTRE TOPICS
// ═══════════════════════════════════════════════════════════════
async function inferPrerequisites(
  nodes: TopicNode[],
  rawTopics: Array<RawTopic & { chunkOrder: number }>,
): Promise<number> {
  let count = 0

  nodes.forEach((node, i) => {
    const raw = rawTopics[i]
    if (!raw?.prerequisitesHint?.length) return

    // Buscar match de cada hint con títulos de otros topics
    raw.prerequisitesHint.forEach(hint => {
      const hintNorm = normalizeForCompare(hint)
      const matchingNode = nodes.find((n, j) => {
        if (i === j) return false
        const nNorm = normalizeForCompare(n.title)
        return nNorm === hintNorm || 
               (nNorm.length > 4 && hintNorm.length > 4 && 
                (nNorm.includes(hintNorm) || hintNorm.includes(nNorm)))
      })

      if (matchingNode && !node.prerequisites.includes(matchingNode.id)) {
        node.prerequisites.push(matchingNode.id)
        count++
      }
    })
  })

  return count
}

// ═══════════════════════════════════════════════════════════════
// DETECTAR ÁREA DEL MATERIAL
// ═══════════════════════════════════════════════════════════════
function detectSubjectArea(
  hints: string[],
  title: string,
  analyses: ChunkAnalysis[],
): SubjectArea {
  const combined = (hints.join(' ') + ' ' + title + ' ' + 
    analyses.map(a => a.contextSummary).join(' ')).toLowerCase()

  const patterns: Record<SubjectArea, string[]> = {
    medical: ['paciente', 'diagnos', 'síntoma', 'patolog', 'fisiolog', 'anatom', 'médic', 'clínic', 'enferm', 'tratamiento', 'farmac'],
    chemistry: ['ph', 'ka', 'kb', 'kw', 'ácido', 'base', 'reacción', 'molécula', 'ion', 'química', 'concentración'],
    physics: ['newton', 'velocidad', 'aceleración', 'fuerza', 'energía cinética', 'ondas', 'física'],
    biology: ['célula', 'adn', 'proteína', 'evolución', 'biología', 'genética', 'organismo'],
    math: ['ecuación', 'derivada', 'integral', 'función', 'álgebra', 'cálculo', 'teorema', 'matriz', 'límite'],
    legal: ['artículo', 'ley', 'código', 'derecho', 'jurídic', 'norma', 'contrato', 'tribunal'],
    history: ['guerra', 'revolución', 'siglo', 'imperio', 'coloni', 'independencia', 'historia'],
    literature: ['novela', 'poesía', 'narrador', 'autor', 'obra literaria'],
    engineering: ['circuito', 'ingeniería', 'diseño', 'estructura', 'material', 'algoritmo'],
    economics: ['mercado', 'oferta', 'demanda', 'economía', 'inflación', 'pib'],
    philosophy: ['ética', 'moral', 'ontología', 'epistemología', 'argumento filosófico'],
    language: ['gramática', 'sintaxis', 'morfología', 'lingüística'],
    general: [],
    mixed: [],
  }

  const scores: Record<string, number> = {}
  for (const [area, keywords] of Object.entries(patterns)) {
    scores[area] = keywords.filter(k => combined.includes(k)).length
  }

  const sorted = Object.entries(scores)
    .filter(([area]) => area !== 'general' && area !== 'mixed')
    .sort((a, b) => b[1] - a[1])

  if (sorted[0][1] === 0) return 'general'
  if (sorted.length > 1 && sorted[0][1] > 0 && sorted[1][1] > 0 && 
      Math.abs(sorted[0][1] - sorted[1][1]) < 2) return 'mixed'
  return sorted[0][0] as SubjectArea
}

// ═══════════════════════════════════════════════════════════════
// NORMALIZAR TOPIC TYPE
// ═══════════════════════════════════════════════════════════════
function normalizeTopicType(t: string): TopicType {
  const valid: TopicType[] = [
    'definition', 'conceptual', 'procedural', 'mathematical', 'causal',
    'chronological', 'comparative', 'classificatory', 'narrative',
    'clinical_case', 'legal_case', 'analytical', 'memorization',
  ]
  const normalized = t.toLowerCase().trim() as TopicType
  return valid.includes(normalized) ? normalized : 'conceptual'
}

// ═══════════════════════════════════════════════════════════════
// DEDUPLICAR FORMULAS
// ═══════════════════════════════════════════════════════════════
function deduplicateFormulas(analyses: ChunkAnalysis[]): FormulaItem[] {
  const all = analyses.flatMap(a => a.formulas)
  const seen: FormulaItem[] = []

  all.forEach((f, i) => {
    const fNorm = normalizeForCompare(f.formula)
    const nameNorm = normalizeForCompare(f.name)
    const dup = seen.find(s => 
      normalizeForCompare(s.formula) === fNorm || 
      normalizeForCompare(s.name) === nameNorm
    )
    if (!dup) {
      seen.push({
        id: `formula_${i + 1}_${Date.now()}`,
        name: f.name,
        formula: f.formula,
        variables: f.variables || [],
        whenToUse: f.context || '',
        commonErrors: [],
      })
    }
  })

  return seen
}

// ═══════════════════════════════════════════════════════════════
// DEDUPLICAR PROCEDURES
// ═══════════════════════════════════════════════════════════════
function deduplicateProcedures(analyses: ChunkAnalysis[]): ProcedureItem[] {
  const all = analyses.flatMap(a => a.procedures)
  const seen: ProcedureItem[] = []

  all.forEach((p, i) => {
    const dup = seen.find(s => normalizeForCompare(s.name) === normalizeForCompare(p.name))
    if (!dup) {
      seen.push({
        id: `proc_${i + 1}_${Date.now()}`,
        name: p.name,
        steps: p.steps || [],
        whenToUse: p.context || '',
        commonErrors: [],
      })
    }
  })

  return seen
}

// ═══════════════════════════════════════════════════════════════
// DEDUPLICAR EXAMPLES
// ═══════════════════════════════════════════════════════════════
function deduplicateExamples(analyses: ChunkAnalysis[], topics: TopicNode[]): ExampleItem[] {
  const all = analyses.flatMap(a => a.examples)
  const seen: ExampleItem[] = []

  all.forEach((e, i) => {
    const descNorm = normalizeForCompare(e.description.slice(0, 100))
    const dup = seen.find(s => normalizeForCompare(s.description.slice(0, 100)) === descNorm)
    if (!dup) {
      // Mapear relatedTopicNames a topicIds
      const relatedTopicIds = (e.relatedTopicNames || []).map(name => {
        const found = topics.find(t => normalizeForCompare(t.title) === normalizeForCompare(name))
        return found?.id
      }).filter(Boolean) as string[]

      seen.push({
        id: `example_${i + 1}_${Date.now()}`,
        description: e.description,
        solution: e.solution,
        relatedTopicIds,
      })
    }
  })

  return seen
}

// ═══════════════════════════════════════════════════════════════
// DEDUPLICAR MISTAKES
// ═══════════════════════════════════════════════════════════════
function deduplicateMistakes(analyses: ChunkAnalysis[], topics: TopicNode[]): CommonMistake[] {
  const all = analyses.flatMap(a => a.commonMistakes)
  const seen: CommonMistake[] = []

  all.forEach((m, i) => {
    const descNorm = normalizeForCompare(m.description.slice(0, 80))
    const dup = seen.find(s => normalizeForCompare(s.description.slice(0, 80)) === descNorm)
    if (!dup) {
      const relatedTopicIds = m.relatedTopicName
        ? [topics.find(t => normalizeForCompare(t.title) === normalizeForCompare(m.relatedTopicName))?.id].filter(Boolean) as string[]
        : []

      seen.push({
        id: `mistake_${i + 1}_${Date.now()}`,
        description: m.description,
        correction: m.correction,
        relatedTopicIds,
        errorType: 'concept_confusion',
      })
    }
  })

  return seen
}

// ═══════════════════════════════════════════════════════════════
// CONECTAR RECURSOS CON TOPICS
// ═══════════════════════════════════════════════════════════════
function linkResourcesToTopics(
  topics: TopicNode[],
  formulas: FormulaItem[],
  procedures: ProcedureItem[],
  examples: ExampleItem[],
  mistakes: CommonMistake[],
): void {
  topics.forEach(topic => {
    const topicNorm = normalizeForCompare(topic.title)

    // Formulas relacionadas por nombre o texto
    topic.formulaIds = formulas
      .filter(f => {
        const fNorm = normalizeForCompare(f.name + ' ' + (f.whenToUse || ''))
        return fNorm.includes(topicNorm) || topicNorm.includes(normalizeForCompare(f.name))
      })
      .map(f => f.id)

    // Procedures relacionadas
    topic.procedureIds = procedures
      .filter(p => {
        const pNorm = normalizeForCompare(p.name + ' ' + (p.whenToUse || ''))
        return pNorm.includes(topicNorm) || topicNorm.includes(normalizeForCompare(p.name))
      })
      .map(p => p.id)

    // Examples relacionadas
    topic.exampleIds = examples
      .filter(e => e.relatedTopicIds.includes(topic.id))
      .map(e => e.id)

    // Mistakes relacionadas
    topic.mistakeIds = mistakes
      .filter(m => m.relatedTopicIds.includes(topic.id))
      .map(m => m.id)
  })
}

// ═══════════════════════════════════════════════════════════════
// DETECTAR DIFFICULTY LEVEL
// ═══════════════════════════════════════════════════════════════
function detectDifficultyLevel(
  topics: TopicNode[],
  analyses: ChunkAnalysis[],
): 'basic' | 'intermediate' | 'advanced' {
  const criticalCount = topics.filter(t => t.importance === 'critical').length
  const mathCount = topics.filter(t => t.topicType === 'mathematical').length
  const totalFormulas = analyses.reduce((sum, a) => sum + a.formulas.length, 0)
  const totalProcedures = analyses.reduce((sum, a) => sum + a.procedures.length, 0)

  const complexity = criticalCount + mathCount * 2 + totalFormulas + totalProcedures * 2

  if (complexity > 15) return 'advanced'
  if (complexity > 6) return 'intermediate'
  return 'basic'
}
