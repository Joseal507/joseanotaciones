// ═══════════════════════════════════════════════════════════════
// ORCHESTRATOR — Fase 1
// 
// Coordina: Chunker → MicroExtractor → GraphAssembler → DependencyResolver
// Produce un KnowledgeGraph completo.
// ═══════════════════════════════════════════════════════════════

import { chunkMaterial } from '../../v2/agents/chunker'
import { extractMicrosParallel } from './microExtractor'
import { assembleGraph } from './graphAssembler'
import { resolveDependencies } from './dependencyResolver'
import { buildQuestionBankForGraph } from './questionBank'
import type { QuestionBank } from './questionBank'
import type { KnowledgeGraph, MicroConcept } from '../types'

export interface OrchestrationOptions {
  materialId: string
  materialTitle: string
  materialText: string
  subjectHint?: string
  onProgress?: (stage: string, current: number, total: number) => void
  generateQuestionBank?: boolean
}

export interface OrchestrationResult {
  success: boolean
  graph?: KnowledgeGraph
  questionBank?: Record<string, QuestionBank>
  stats: {
    chunkingMs: number
    extractionMs: number
    assemblyMs: number
    resolutionMs: number
    bankMs: number
    totalMs: number
    totalChunks: number
    totalMicrosExtracted: number
    totalMicrosFinal: number
    duplicatesRemoved: number
    totalDependencies: number
    hardDeps: number
    softDeps: number
    topicGroups: number
    errors: string[]
  }
  error?: string
}

export function shouldGenerateInitialQuestionBank(options: Pick<OrchestrationOptions, 'generateQuestionBank'> = {}): boolean {
  return options.generateQuestionBank === true
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export async function buildKnowledgeGraph(
  options: OrchestrationOptions,
): Promise<OrchestrationResult> {
  const startTotal = Date.now()
  const errors: string[] = []
  const { materialId, materialTitle, materialText, subjectHint, onProgress } = options
  const generateQuestionBank = shouldGenerateInitialQuestionBank(options)

  console.log(`\n🕸️  [Graph Builder] Iniciando construcción de grafo`)
  console.log(`   Material: "${materialTitle}" (${materialText.length} chars)`)

  // ═══════════════════════════════════════════════════════════
  // ETAPA 1: CHUNKING
  // ═══════════════════════════════════════════════════════════
  const chunkStart = Date.now()
  if (onProgress) onProgress('chunking', 0, 1)

  let chunkingResult
  try {
    chunkingResult = chunkMaterial(materialText, materialTitle)
  } catch (err: any) {
    return {
      success: false,
      error: `Chunking falló: ${err.message}`,
      stats: buildEmptyStats(errors),
    }
  }

  const chunkingMs = Date.now() - chunkStart
  if (onProgress) onProgress('chunking', 1, 1)
  console.log(`✓ Chunking: ${chunkingResult.totalChunks} chunks en ${chunkingMs}ms`)

  // ═══════════════════════════════════════════════════════════
  // ETAPA 2: EXTRACCIÓN DE MICROS (paralelo)
  // ═══════════════════════════════════════════════════════════
  const extractStart = Date.now()

  const extractionResults = await extractMicrosParallel(
    chunkingResult.chunks,
    5,
    (done, total) => {
      if (onProgress) onProgress('extracting', done, total)
      console.log(`   Extrayendo micros: ${done}/${total}`)
    },
  )

  extractionResults.forEach(r => {
    if (r.errors.length > 0) errors.push(...r.errors.map(e => `Chunk ${r.chunkOrder}: ${e}`))
  })

  const totalMicrosExtracted = extractionResults.reduce((s, r) => s + r.micros.length, 0)
  const extractionMs = Date.now() - extractStart
  console.log(`✓ Extracción: ${totalMicrosExtracted} micros crudos en ${extractionMs}ms`)

  // ═══════════════════════════════════════════════════════════
  // ETAPA 3: ENSAMBLAJE DEL GRAFO
  // ═══════════════════════════════════════════════════════════
  const assemblyStart = Date.now()
  const assemblyResult = assembleGraph(extractionResults)
  const assemblyMs = Date.now() - assemblyStart

  console.log(`✓ Ensamblaje: ${assemblyResult.stats.totalMicrosAfterDedupe} micros finales (${assemblyResult.stats.duplicatesRemoved} duplicados) en ${assemblyMs}ms`)

  // Validar que se extrajeron suficientes micros para el tamaño del material
  const expectedMinMicros = Math.max(3, Math.ceil(materialText.length / 1500))
  if (assemblyResult.micros.length < expectedMinMicros) {
    console.warn(`⚠ [Graph Builder] Solo ${assemblyResult.micros.length} micros para ${materialText.length} chars (esperado mínimo ${expectedMinMicros})`)
    errors.push(`Pocos micros extraídos: ${assemblyResult.micros.length}/${expectedMinMicros} esperados`)
  }
  console.log(`   Topic groups: ${assemblyResult.stats.topicGroupsCount}`)

  // ═══════════════════════════════════════════════════════════
  // ETAPA 4: RESOLUCIÓN DE DEPENDENCIAS
  // ═══════════════════════════════════════════════════════════
  const resolutionStart = Date.now()
  if (onProgress) onProgress('resolving_deps', 0, 1)

  const resolutionResult = await resolveDependencies(assemblyResult.micros)
  if (resolutionResult.errors.length > 0) errors.push(...resolutionResult.errors)

  const resolutionMs = Date.now() - resolutionStart
  if (onProgress) onProgress('resolving_deps', 1, 1)

  console.log(`✓ Dependencias: ${resolutionResult.stats.totalEdges} edges (${resolutionResult.stats.hardDependencies} hard, ${resolutionResult.stats.softDependencies} soft) en ${resolutionMs}ms`)

  // ═══════════════════════════════════════════════════════════
  // ETAPA 5: CONSTRUIR GRAFO FINAL
  // ═══════════════════════════════════════════════════════════
  const subjectArea = subjectHint || detectSubjectArea(assemblyResult.micros, materialTitle)
  const criticalPath = calculateCriticalPath(assemblyResult.micros, resolutionResult.edges)

  const graph: KnowledgeGraph = {
    materialId,
    materialTitle,
    subjectArea,
    microConcepts: assemblyResult.micros,
    dependencies: resolutionResult.edges,
    topicGroups: assemblyResult.topicGroups,
    totalMicros: assemblyResult.micros.length,
    totalDependencies: resolutionResult.edges.length,
    averageDifficulty: assemblyResult.stats.averageDifficulty,
    estimatedTotalMinutes: assemblyResult.stats.totalEstimatedMinutes,
    criticalPath,
    extractedAt: Date.now(),
    chunkerVersion: 'v2.chunker',
    extractorVersion: 'v3.microExtractor',
    resolverVersion: 'v3.dependencyResolver',
  }

  const totalMs = Date.now() - startTotal

  console.log(`\n🎉 [Graph Builder] COMPLETO en ${totalMs}ms`)
  console.log(`   ─ Área: ${subjectArea}`)
  console.log(`   ─ Micros: ${graph.totalMicros}`)
  console.log(`   ─ Dependencias: ${graph.totalDependencies}`)
  console.log(`   ─ Grupos: ${graph.topicGroups.length}`)
  console.log(`   ─ Camino crítico: ${criticalPath.length} micros`)
  console.log(`   ─ Tiempo total estimado: ${graph.estimatedTotalMinutes} min`)

  // ═══════════════════════════════════════════════════════════
  // ETAPA 5: GENERAR QUESTION BANK
  // ═══════════════════════════════════════════════════════════
  const bankStart = Date.now()
  if (onProgress) onProgress('building_bank', 0, 1)

  let questionBank: Record<string, QuestionBank> | undefined = undefined
  try {
    if (!generateQuestionBank) {
      console.log('✓ Question Bank: diferido; generación on-demand activada')
    } else {
    questionBank = await buildQuestionBankForGraph(graph.microConcepts)
    const totalQ = Object.values(questionBank).reduce((s, b) => s + b.totalQuestions, 0)
    console.log(`✓ Question Bank: ${totalQ} preguntas para ${Object.keys(questionBank).length} micros`)
    }
  } catch (err: any) {
    console.error('[Graph Builder] Question bank falló (no crítico):', err.message)
    errors.push('Question bank: ' + err.message)
  }

  const bankMs = Date.now() - bankStart
  if (onProgress) onProgress('building_bank', 1, 1)

  return {
    success: true,
    graph,
    questionBank,
    stats: {
      chunkingMs,
      extractionMs,
      assemblyMs,
      resolutionMs,
      bankMs,
      totalMs,
      totalChunks: chunkingResult.totalChunks,
      totalMicrosExtracted,
      totalMicrosFinal: graph.totalMicros,
      duplicatesRemoved: assemblyResult.stats.duplicatesRemoved,
      totalDependencies: graph.totalDependencies,
      hardDeps: resolutionResult.stats.hardDependencies,
      softDeps: resolutionResult.stats.softDependencies,
      topicGroups: graph.topicGroups.length,
      errors,
    },
  }
}

// ═══════════════════════════════════════════════════════════════
// DETECTAR ÁREA DEL MATERIAL
// ═══════════════════════════════════════════════════════════════
function detectSubjectArea(micros: MicroConcept[], title: string): string {
  const combined = (title + ' ' + micros.map(m => m.name + ' ' + m.shortDescription).join(' ')).toLowerCase()

  const patterns: Record<string, string[]> = {
    chemistry: ['ph', 'ácido', 'base', 'reacción', 'molécula', 'ion', 'equilibrio químico', 'ka', 'kb', 'kw'],
    medical: ['paciente', 'diagnos', 'síntoma', 'patolog', 'fisiolog', 'anatom', 'clínic', 'enferm'],
    math: ['ecuación', 'derivada', 'integral', 'función', 'álgebra', 'cálculo', 'teorema'],
    physics: ['newton', 'velocidad', 'aceleración', 'fuerza', 'energía', 'ondas'],
    biology: ['célula', 'adn', 'proteína', 'evolución', 'genética'],
    legal: ['artículo', 'ley', 'código', 'derecho', 'jurídic', 'norma'],
    history: ['guerra', 'revolución', 'siglo', 'imperio', 'coloni', 'independencia'],
    sports: ['equipo', 'jugador', 'liga', 'temporada', 'entrenador', 'campeonato'],
    general: [],
  }

  const scores: Record<string, number> = {}
  for (const [area, keywords] of Object.entries(patterns)) {
    // Word boundary matching: evitar que "revolución" matchee "evolución"
    scores[area] = keywords.filter(k => {
      // Escapar caracteres regex especiales
      const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // \\b es word boundary en unicode; usamos boundary manual para acentos
      const re = new RegExp('(^|[^a-záéíóúñü])' + escaped + '($|[^a-záéíóúñü])', 'gi')
      return re.test(combined)
    }).length
  }

  const sorted = Object.entries(scores).filter(([a]) => a !== 'general').sort((a, b) => b[1] - a[1])
  if (sorted[0][1] === 0) return 'general'
  return sorted[0][0]
}

// ═══════════════════════════════════════════════════════════════
// CALCULAR CAMINO CRÍTICO (topological sort de micros críticos)
// ═══════════════════════════════════════════════════════════════
function calculateCriticalPath(micros: MicroConcept[], edges: any[]): string[] {
  const criticalMicros = micros.filter(m => m.importance === 'critical' || m.importance === 'high')

  // Topological sort
  const sorted: string[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const microMap = new Map(criticalMicros.map(m => [m.id, m]))

  function visit(microId: string) {
    if (visited.has(microId) || visiting.has(microId)) return
    visiting.add(microId)
    const micro = microMap.get(microId)
    if (!micro) { visiting.delete(microId); return }

    for (const prereqId of micro.prerequisites) {
      if (microMap.has(prereqId)) visit(prereqId)
    }

    visiting.delete(microId)
    visited.add(microId)
    sorted.push(microId)
  }

  for (const micro of criticalMicros) visit(micro.id)
  return sorted
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function buildEmptyStats(errors: string[]) {
  return {
    chunkingMs: 0, extractionMs: 0, assemblyMs: 0, resolutionMs: 0, totalMs: 0,
    bankMs: 0, totalChunks: 0, totalMicrosExtracted: 0, totalMicrosFinal: 0,
    duplicatesRemoved: 0, totalDependencies: 0, hardDeps: 0, softDeps: 0,
    topicGroups: 0, errors,
  }
}
