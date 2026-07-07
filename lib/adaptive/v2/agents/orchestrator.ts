// ═══════════════════════════════════════════════════════════════
// ORCHESTRATOR — Coordina los 3 agentes de Fase A
// 
// Chunker → Analyzer (paralelo) → Consolidator
// Devuelve MaterialIntelligence completo.
// ═══════════════════════════════════════════════════════════════

import { chunkMaterial, debugChunks, type ChunkingResult } from './chunker'
import { analyzeChunksInParallel, type ChunkAnalysis } from './analyzer'
import { consolidateAnalyses, type ConsolidationResult } from './consolidator'
import type { MaterialIntelligence } from '../types'

export interface OrchestrationOptions {
  materialId: string
  materialTitle: string
  materialText: string
  totalPages?: number
  maxParallel?: number              // Cuántos chunks analizar en paralelo (default 5)
  onProgress?: (stage: string, current: number, total: number) => void
}

export interface OrchestrationResult {
  success: boolean
  intelligence?: MaterialIntelligence
  stats: {
    chunkingMs: number
    analysisMs: number
    consolidationMs: number
    totalMs: number
    totalChunks: number
    materialSize: string
    totalTopics: number
    duplicatesRemoved: number
    errors: string[]
  }
  chunkingResult?: ChunkingResult
  chunkAnalyses?: ChunkAnalysis[]
  consolidationResult?: ConsolidationResult
  error?: string
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export async function orchestrateAnalysis(
  options: OrchestrationOptions,
): Promise<OrchestrationResult> {
  const startTotal = Date.now()
  const errors: string[] = []
  const { materialId, materialTitle, materialText, totalPages, maxParallel = 5, onProgress } = options

  console.log(`\n🎬 [Orchestrator] Iniciando análisis de "${materialTitle}"`)
  console.log(`   Material size: ${materialText.length} chars`)

  // ═══════════════════════════════════════════════════════════
  // ETAPA 1: CHUNKING
  // ═══════════════════════════════════════════════════════════
  const chunkStart = Date.now()
  if (onProgress) onProgress('chunking', 0, 1)

  let chunkingResult: ChunkingResult
  try {
    chunkingResult = chunkMaterial(materialText, materialTitle)
    if (process.env.NODE_ENV === 'development') {
      debugChunks(chunkingResult)
    }
  } catch (err: any) {
    return {
      success: false,
      error: `Chunking failed: ${err.message}`,
      stats: buildEmptyStats(errors),
    }
  }

  const chunkingMs = Date.now() - chunkStart
  if (onProgress) onProgress('chunking', 1, 1)

  console.log(`✓ Chunking: ${chunkingResult.totalChunks} chunks en ${chunkingMs}ms`)

  // ═══════════════════════════════════════════════════════════
  // ETAPA 2: ANÁLISIS PARALELO
  // ═══════════════════════════════════════════════════════════
  const analysisStart = Date.now()
  const actualParallelism = Math.min(maxParallel, chunkingResult.recommendedParallelism)

  console.log(`⚙️  Analizando ${chunkingResult.totalChunks} chunks (paralelismo: ${actualParallelism})...`)

  let chunkAnalyses: ChunkAnalysis[] = []
  try {
    chunkAnalyses = await analyzeChunksInParallel(
      chunkingResult.chunks,
      actualParallelism,
      (done, total) => {
        if (onProgress) onProgress('analyzing', done, total)
        console.log(`   Progreso: ${done}/${total} chunks analizados`)
      },
    )

    // Recoger errores individuales
    chunkAnalyses.forEach(a => {
      if (a.errors.length > 0) {
        errors.push(...a.errors.map(e => `Chunk ${a.chunkOrder}: ${e}`))
      }
    })
  } catch (err: any) {
    return {
      success: false,
      error: `Analysis failed: ${err.message}`,
      chunkingResult,
      stats: buildEmptyStats(errors),
    }
  }

  const analysisMs = Date.now() - analysisStart
  const totalTopicsRaw = chunkAnalyses.reduce((sum, a) => sum + a.topics.length, 0)
  console.log(`✓ Análisis: ${totalTopicsRaw} topics crudos en ${analysisMs}ms (avg ${Math.round(analysisMs / chunkAnalyses.length)}ms/chunk)`)

  // ═══════════════════════════════════════════════════════════
  // ETAPA 3: CONSOLIDACIÓN
  // ═══════════════════════════════════════════════════════════
  const consolStart = Date.now()
  if (onProgress) onProgress('consolidating', 0, 1)

  let consolidationResult: ConsolidationResult
  try {
    consolidationResult = await consolidateAnalyses(
      materialId,
      materialTitle,
      chunkAnalyses,
      totalPages,
    )
  } catch (err: any) {
    return {
      success: false,
      error: `Consolidation failed: ${err.message}`,
      chunkingResult,
      chunkAnalyses,
      stats: buildEmptyStats(errors),
    }
  }

  const consolidationMs = Date.now() - consolStart
  if (onProgress) onProgress('consolidating', 1, 1)

  console.log(`✓ Consolidación: ${consolidationResult.stats.totalTopicsAfterDedupe} topics finales (${consolidationResult.stats.duplicatesRemoved} duplicados) en ${consolidationMs}ms`)

  // ═══════════════════════════════════════════════════════════
  // RESULTADO FINAL
  // ═══════════════════════════════════════════════════════════
  const totalMs = Date.now() - startTotal

  console.log(`\n🎉 [Orchestrator] COMPLETO en ${totalMs}ms
   ─ Área detectada: ${consolidationResult.intelligence.subjectArea}
   ─ Nivel: ${consolidationResult.intelligence.difficultyLevel}
   ─ Topics: ${consolidationResult.intelligence.topics.length}
   ─ Fórmulas: ${consolidationResult.intelligence.formulas.length}
   ─ Procedimientos: ${consolidationResult.intelligence.procedures.length}
   ─ Ejemplos: ${consolidationResult.intelligence.keyExamples.length}
   ─ Errores comunes: ${consolidationResult.intelligence.commonMistakes.length}
`)

  return {
    success: true,
    intelligence: consolidationResult.intelligence,
    stats: {
      chunkingMs,
      analysisMs,
      consolidationMs,
      totalMs,
      totalChunks: chunkingResult.totalChunks,
      materialSize: chunkingResult.materialSize,
      totalTopics: consolidationResult.intelligence.topics.length,
      duplicatesRemoved: consolidationResult.stats.duplicatesRemoved,
      errors,
    },
    chunkingResult,
    chunkAnalyses,
    consolidationResult,
  }
}

function buildEmptyStats(errors: string[]) {
  return {
    chunkingMs: 0,
    analysisMs: 0,
    consolidationMs: 0,
    totalMs: 0,
    totalChunks: 0,
    materialSize: 'unknown',
    totalTopics: 0,
    duplicatesRemoved: 0,
    errors,
  }
}
