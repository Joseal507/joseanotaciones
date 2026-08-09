// ═══════════════════════════════════════════════════════════════
// COVERAGE TRACKER
//
// Trackea qué páginas / micros del material fueron:
// - enseñados
// - evaluados
// - dominados con evidencia real
//
// El programa NO puede cerrarse hasta que todo el material
// esté en cobertura completa según los umbrales definidos.
// ═══════════════════════════════════════════════════════════════

import type { KnowledgeGraph, MicroConcept } from '../types'

export interface MicroCoverage {
  microId: string
  microName: string
  sourcePages: number[]
  taught: boolean          // fue introducido al menos una vez
  evaluated: boolean       // tuvo al menos 1 pregunta
  correctAnswers: number
  totalAnswers: number
  requiredEvidences: number
  isStudied: boolean       // expuesto + enseñado + practicado (≥1 intento) — independiente del score
  isMastered: boolean      // llegó al umbral de evidencias (correctAnswers >= requiredEvidences)
  masteryPercent: number   // 0-100
}

export interface CoverageReport {
  totalMicros: number
  taughtMicros: number
  evaluatedMicros: number
  studiedMicros: number    // micros con taught + evaluated (independiente de mastery)
  masteredMicros: number
  materialCoveragePercent: number  // studiedMicros / totalMicros * 100 (COBERTURA REAL)
  overallCoverage: number  // 0-100 % basado en mastery (legacy — no eliminar)
  materialLearned: number  // 0-100 % ponderado por importancia
  isComplete: boolean      // programa listo para cerrarse (basado en studied, no mastered)
  weakMicros: MicroCoverage[]  // micros no dominados
  strongMicros: MicroCoverage[] // micros dominados
  uncoveredPages: number[]
  coveredPages: number[]
}

// ═══════════════════════════════════════════════════════════════
// Calcular cobertura de un micro basado en sus estadísticas
// ═══════════════════════════════════════════════════════════════
export function computeMicroCoverage(
  micro: MicroConcept,
  stats: {
    taught: boolean
    correctAnswers: number
    totalAnswers: number
    requiredEvidences: number
  },
): MicroCoverage {
  const isMastered = stats.correctAnswers >= stats.requiredEvidences
  const masteryPercent = stats.requiredEvidences > 0
    ? Math.min(100, Math.round((stats.correctAnswers / stats.requiredEvidences) * 100))
    : 0

  // isStudied: el micro fue enseñado Y el estudiante intentó al menos 1 respuesta
  // No requiere que la respuesta sea correcta — solo que hubo exposición + práctica
  const isStudied = stats.taught && stats.totalAnswers > 0

  return {
    microId: micro.id,
    microName: micro.name,
    sourcePages: micro.sourcePages || [],
    taught: stats.taught,
    evaluated: stats.totalAnswers > 0,
    correctAnswers: stats.correctAnswers,
    totalAnswers: stats.totalAnswers,
    requiredEvidences: stats.requiredEvidences,
    isStudied,
    isMastered,
    masteryPercent,
  }
}

// ═══════════════════════════════════════════════════════════════
// Calcular el reporte completo de cobertura del material
// ═══════════════════════════════════════════════════════════════
export function computeCoverageReport(
  graph: KnowledgeGraph,
  coverages: Record<string, MicroCoverage>,
): CoverageReport {
  const allMicros = graph.microConcepts
  const totalMicros = allMicros.length

  let taughtMicros = 0
  let evaluatedMicros = 0
  let studiedMicros = 0
  let masteredMicros = 0

  const weakMicros: MicroCoverage[] = []
  const strongMicros: MicroCoverage[] = []

  // Ponderación por importancia
  const importanceWeight = { critical: 3, high: 2, medium: 1, low: 0.5 }
  let totalWeight = 0
  let learnedWeight = 0

  for (const m of allMicros) {
    const cov = coverages[m.id] || {
      microId: m.id, microName: m.name,
      sourcePages: m.sourcePages || [],
      taught: false, evaluated: false,
      correctAnswers: 0, totalAnswers: 0,
      requiredEvidences: 3, isStudied: false, isMastered: false, masteryPercent: 0,
    }

    if (cov.taught) taughtMicros++
    if (cov.evaluated) evaluatedMicros++
    if (cov.isStudied) studiedMicros++
    if (cov.isMastered) {
      masteredMicros++
      strongMicros.push(cov)
    } else if (cov.taught) {
      weakMicros.push(cov)
    }

    const w = importanceWeight[m.importance] || 1
    totalWeight += w
    learnedWeight += w * (cov.masteryPercent / 100)
  }

  const overallCoverage = totalMicros > 0
    ? Math.round((masteredMicros / totalMicros) * 100)
    : 0

  // materialCoveragePercent: basado en studied (no mastered)
  // Un micro está "cubierto" cuando fue enseñado Y el estudiante practicó al menos 1 vez
  const materialCoveragePercent = totalMicros > 0
    ? Math.round((studiedMicros / totalMicros) * 100)
    : 0

  const materialLearned = totalWeight > 0
    ? Math.round((learnedWeight / totalWeight) * 100)
    : 0

  // Cobertura de páginas
  const allPages = new Set<number>()
  const coveredPagesSet = new Set<number>()
  for (const m of allMicros) {
    for (const p of (m.sourcePages || [])) {
      allPages.add(p)
      if (coverages[m.id]?.isMastered) coveredPagesSet.add(p)
    }
  }
  const uncoveredPages = [...allPages].filter(p => !coveredPagesSet.has(p)).sort((a, b) => a - b)
  const coveredPages = [...coveredPagesSet].sort((a, b) => a - b)

  // isComplete: basado en COBERTURA (studied), no en MASTERY
  // El programa está completo cuando TODOS los micros fueron enseñados y practicados al menos 1 vez
  // El mastery puede ser menor — eso se muestra honestamente al usuario
  const criticalMicros = allMicros.filter(m => m.importance === 'critical')
  const criticalStudied = criticalMicros.every(m => coverages[m.id]?.isStudied)
  const isComplete = studiedMicros === totalMicros && criticalStudied

  return {
    totalMicros,
    taughtMicros,
    evaluatedMicros,
    studiedMicros,
    masteredMicros,
    materialCoveragePercent,
    overallCoverage,
    materialLearned,
    isComplete,
    weakMicros,
    strongMicros,
    uncoveredPages,
    coveredPages,
  }
}

// ═══════════════════════════════════════════════════════════════
// Determinar qué micros priorizar en la siguiente sesión
// ═══════════════════════════════════════════════════════════════
export function getMicrosNeedingWork(
  graph: KnowledgeGraph,
  coverages: Record<string, MicroCoverage>,
): { untaught: string[]; underEvaluated: string[]; failing: string[] } {
  const untaught: string[] = []
  const underEvaluated: string[] = []
  const failing: string[] = []

  for (const m of graph.microConcepts) {
    const cov = coverages[m.id]
    if (!cov || !cov.taught) {
      untaught.push(m.id)
    } else if (cov.correctAnswers < cov.requiredEvidences && cov.masteryPercent < 100) {
      if (cov.totalAnswers >= 3 && cov.correctAnswers / cov.totalAnswers < 0.6) {
        failing.push(m.id)
      } else {
        underEvaluated.push(m.id)
      }
    }
  }

  return { untaught, underEvaluated, failing }
}
