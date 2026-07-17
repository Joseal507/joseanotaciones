// ═══════════════════════════════════════════════════════════════
// Material Mastery Storage
// 
// Guarda y carga el mastery GLOBAL por material.
// Se acumula a lo largo de TODAS las sesiones del programa.
// Permite que la sesión 2 sepa lo que el estudiante aprendió en la 1.
// ═══════════════════════════════════════════════════════════════

import {
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { r2 } from '../../../materials/storage'
import type { MemoryState } from '../engine/memoryEngine'

const BUCKET = process.env.R2_BUCKET ?? 'studyal'

export interface EvidenceDimensions {
  recognized: number    // evidencias de reconocimiento (MCQ, true_false)
  recalled: number      // evidencias de recall (fill_blank)
  explained: number     // evidencias de explicación (open_response, teach_back)
  applied: number       // evidencias de aplicación (practical_case, step_by_step)
  connected: number     // evidencias de conexión (matching cross-micro)
  transferred: number   // evidencias de transferencia (contexto nuevo)
}

export interface MicroMasteryRecord {
  microId: string
  microName: string
  masteryLevel: string
  masteryScore: number          // 0-100 del evidence engine
  answeredCorrectly: number
  answeredIncorrectly: number
  introduced: boolean
  explainedByTutor: boolean
  applied: boolean
  isReady: boolean
  // Evidencia granular por dimensión
  evidenceDimensions: EvidenceDimensions
  // Páginas del material donde aparece este micro
  sourcePages: number[]
  // Snapshot del perfil de evidencia acumulado
  evidenceProfileSnapshot?: import('../engine/evidenceEngine').EvidenceProfile
  // Cuántas veces se trabajó este micro (across all sessions)
  totalSessions: number
  lastUpdatedAt: number
}

export interface CoveragePage {
  pageNumber: number
  covered: boolean       // fue enseñada al estudiante
  evaluated: boolean     // fue evaluada con preguntas
  microIds: string[]     // micros que cubren esta página
}

export interface MaterialMastery {
  userId: string
  materialId: string
  micros: Record<string, MicroMasteryRecord>
  // Lista canónica de TODOS los micros del grafo (fuente de verdad del denominador)
  allMicroIds: string[]
  // Coverage por páginas del PDF
  pagesCoverage: Record<number, CoveragePage>
  // Hipótesis activas sobre el estado cognitivo del estudiante
  hypotheses: import('../engine/hypothesisEngine').LearningHypothesis[]
  // Misconceptions persistentes del estudiante
  misconceptions: import('../engine/misconceptionTracker').Misconception[]
  // Estado de memoria por micro (modelo FSRS simplificado)
  memoryStates: Record<string, MemoryState>
  // Resumen de cobertura
  totalMicros: number
  masteredMicros: number
  coveragePercent: number   // % de micros cubiertos
  updatedAt: number
}

function buildKey(userId: string, materialId: string): string {
  return `mastery/${userId}/${materialId}/material_mastery.json`
}

export async function loadMaterialMastery(
  userId: string,
  materialId: string,
): Promise<MaterialMastery | null> {
  try {
    const response = await r2.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: buildKey(userId, materialId),
    }))
    if (!response.Body) return null
    const chunks: Uint8Array[] = []
    for await (const chunk of response.Body as any) chunks.push(chunk)
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'))
  } catch (err: any) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null
    console.error('[materialMasteryStorage] loadMaterialMastery error:', err.message)
    return null
  }
}

export async function saveMaterialMastery(mastery: MaterialMastery): Promise<void> {
  try {
    const buffer = Buffer.from(JSON.stringify(mastery), 'utf-8')
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: buildKey(mastery.userId, mastery.materialId),
      Body: buffer,
      ContentType: 'application/json',
    }))
  } catch (err: any) {
    console.error('[materialMasteryStorage] saveMaterialMastery error:', err.message)
  }
}

// ═══════════════════════════════════════════════════════════════
// RETENTION CHECK
// ═══════════════════════════════════════════════════════════════
export function getMicrosNeedingRetention(
  mastery: MaterialMastery,
  hoursThreshold: number = 24,
  maxCount: number = 3,
): string[] {
  // Si hay estados de memoria del Memory Engine, usarlos
  if (mastery.memoryStates && Object.keys(mastery.memoryStates).length > 0) {
    const { getMicrosNeedingReview } = require('../engine/memoryEngine')
    const needingReview = getMicrosNeedingReview(mastery.memoryStates, {
      urgencyThreshold: 0.9,
      maxCount,
      includeNotDue: false,
    })
    return needingReview.map((m: any) => m.microId)
  }

  // Fallback: sistema anterior basado en tiempo
  const now = Date.now()
  const thresholdMs = hoursThreshold * 60 * 60 * 1000
  return Object.values(mastery.micros)
    .filter(m => {
      if (!m.isReady || m.answeredCorrectly < 2) return false
      return (now - (m.lastUpdatedAt || 0)) >= thresholdMs
    })
    .sort((a, b) => (a.lastUpdatedAt || 0) - (b.lastUpdatedAt || 0))
    .map(m => m.microId)
    .slice(0, maxCount)
}

// ═══════════════════════════════════════════════════════════════
// COVERAGE REPORT — Resumen de cobertura del material
// ═══════════════════════════════════════════════════════════════
export function getCoverageReport(mastery: MaterialMastery): {
  totalMicros: number
  studiedMicros: number
  masteredMicros: number
  materialCoveragePercent: number
  overallCoverage: number
  coveragePercent: number
  uncoveredMicros: string[]
  uncoveredMicroIds: string[]
  weakMicros: Array<{ microId: string; microName: string }>
  strongMicros: Array<{ microId: string; microName: string }>
  pagesNotCovered: number[]
  isComplete: boolean
} {
  // Fuente de verdad: allMicroIds del grafo completo
  // Si no está inicializado, usar Object.keys(micros) como fallback
  const canonicalIds: string[] = mastery.allMicroIds?.length > 0
    ? mastery.allMicroIds
    : Object.keys(mastery.micros)

  const realTotalMicros = canonicalIds.length

  // Calcular sobre todos los IDs canónicos
  const studiedIds = canonicalIds.filter(id => {
    const m = mastery.micros[id]
    return m?.introduced && ((m.answeredCorrectly || 0) + (m.answeredIncorrectly || 0)) > 0
  })

  const masteredIds = canonicalIds.filter(id => {
    const m = mastery.micros[id]
    return m && (m.masteryScore >= 60 || m.isReady)
  })

  const weakIds = canonicalIds.filter(id => {
    const m = mastery.micros[id]
    return m?.introduced &&
      ((m.answeredCorrectly || 0) + (m.answeredIncorrectly || 0)) > 0 &&
      !(m.masteryScore >= 60 || m.isReady)
  })

  const uncoveredIds = canonicalIds.filter(id => {
    const m = mastery.micros[id]
    return !m?.introduced ||
      ((m?.answeredCorrectly || 0) + (m?.answeredIncorrectly || 0)) === 0
  })

  const strongIds = canonicalIds.filter(id => {
    const m = mastery.micros[id]
    return m?.masteryScore >= 80
  })

  const pagesNotCovered = Object.values(mastery.pagesCoverage || {})
    .filter(p => !p.covered)
    .map(p => p.pageNumber)

  // Cobertura real: micros estudiados / total canónico del grafo
  const materialCoveragePercent = realTotalMicros > 0
    ? Math.round((studiedIds.length / realTotalMicros) * 100)
    : 0

  // Dominio: micros dominados / total canónico
  const overallCoverage = realTotalMicros > 0
    ? Math.round((masteredIds.length / realTotalMicros) * 100)
    : 0

  return {
    totalMicros: realTotalMicros,
    studiedMicros: studiedIds.length,
    masteredMicros: masteredIds.length,
    materialCoveragePercent,
    overallCoverage,
    coveragePercent: overallCoverage,
    uncoveredMicros: uncoveredIds.map(id => mastery.micros[id]?.microName || id),
    uncoveredMicroIds: uncoveredIds,
    weakMicros: weakIds.map(id => ({ microId: id, microName: mastery.micros[id]?.microName || id })),
    strongMicros: strongIds.map(id => ({ microId: id, microName: mastery.micros[id]?.microName || id })),
    pagesNotCovered,
    isComplete: uncoveredIds.length === 0 && studiedIds.length === realTotalMicros,
  }
}

// Actualizar mastery global a partir del SessionState completado
export function extractMasteryFromSession(
  sessionState: any,
  existing: MaterialMastery | null,
  userId: string,
  materialId: string,
  graph?: { microConcepts: Array<{ id: string; name: string; sourcePages?: number[] }> } | null,
): MaterialMastery {
  const micros: Record<string, MicroMasteryRecord> = {
    ...(existing?.micros || {}),
  }

  // Lista canónica de todos los micros del grafo
  // Si el grafo está disponible, inicializar TODOS los micros (no solo los vistos)
  const allMicroIds: string[] = graph?.microConcepts?.map((m: any) => m.id) ||
    existing?.allMicroIds ||
    Object.keys(micros)

  // Inicializar micros del grafo que aún no existen en el mastery
  if (graph?.microConcepts) {
    for (const micro of graph.microConcepts) {
      if (!micros[micro.id]) {
        micros[micro.id] = {
          microId: micro.id,
          microName: micro.name,
          masteryLevel: 'unseen',
          masteryScore: 0,
          answeredCorrectly: 0,
          answeredIncorrectly: 0,
          introduced: false,
          explainedByTutor: false,
          applied: false,
          isReady: false,
          evidenceDimensions: { recognized: 0, recalled: 0, explained: 0, applied: 0, connected: 0, transferred: 0 },
          evidenceProfileSnapshot: undefined,
          sourcePages: micro.sourcePages || [],
          totalSessions: 0,
          lastUpdatedAt: 0,
        }
      }
    }
  }

  // Coverage por páginas
  const pagesCoverage: Record<number, CoveragePage> = {
    ...(existing?.pagesCoverage || {}),
  }

  for (const [microId, microState] of Object.entries(sessionState.microStates || {}) as any) {
    const prev = micros[microId]
    const evidenceProfile = (microState as any).evidenceProfile
    const ep = evidenceProfile || {}

    // Sumar evidencias por dimensión (tomar el mayor entre prev y actual)
    const prevDims = prev?.evidenceDimensions || { recognized: 0, recalled: 0, explained: 0, applied: 0, connected: 0, transferred: 0 }
    const newDims: EvidenceDimensions = {
      recognized: Math.max(prevDims.recognized, (ep.strongCount?.recognized || 0) + (ep.mediumCount?.recognized || 0)),
      recalled: Math.max(prevDims.recalled, (ep.strongCount?.recalled || 0) + (ep.mediumCount?.recalled || 0)),
      explained: Math.max(prevDims.explained, (ep.strongCount?.explained || 0) + (ep.mediumCount?.explained || 0)),
      applied: Math.max(prevDims.applied, (ep.strongCount?.applied || 0) + (ep.mediumCount?.applied || 0)),
      connected: Math.max(prevDims.connected, (ep.strongCount?.connected || 0) + (ep.mediumCount?.connected || 0)),
      transferred: Math.max(prevDims.transferred, (ep.strongCount?.transferred || 0) + (ep.mediumCount?.transferred || 0)),
    }

    // Páginas del micro (si están en el microState)
    const sourcePages: number[] = microState.sourcePages || prev?.sourcePages || []

    // Actualizar coverage por páginas
    for (const page of sourcePages) {
      if (!pagesCoverage[page]) {
        pagesCoverage[page] = { pageNumber: page, covered: false, evaluated: false, microIds: [] }
      }
      if (!pagesCoverage[page].microIds.includes(microId)) {
        pagesCoverage[page].microIds.push(microId)
      }
      if (microState.evidence?.introduced) pagesCoverage[page].covered = true
      if ((microState.evidence?.answeredCorrectly || 0) > 0) pagesCoverage[page].evaluated = true
    }

    micros[microId] = {
      microId,
      microName: microState.microName || prev?.microName || microId,
      masteryLevel: microState.masteryLevel || 'unseen',
      masteryScore: Math.max(evidenceProfile?.masteryScore ?? 0, prev?.masteryScore ?? 0),
      answeredCorrectly: Math.max(
        microState.evidence?.answeredCorrectly || 0,
        prev?.answeredCorrectly || 0,
      ),
      answeredIncorrectly: Math.max(
        microState.evidence?.answeredIncorrectly || 0,
        prev?.answeredIncorrectly || 0,
      ),
      introduced: microState.evidence?.introduced || prev?.introduced || false,
      explainedByTutor: microState.evidence?.explainedByTutor || prev?.explainedByTutor || false,
      applied: microState.evidence?.applied || prev?.applied || false,
      isReady: microState.isReady || prev?.isReady || false,
      evidenceDimensions: newDims,
      evidenceProfileSnapshot: evidenceProfile || prev?.evidenceProfileSnapshot,
      sourcePages,
      totalSessions: (prev?.totalSessions || 0) + 1,
      lastUpdatedAt: Date.now(),
    }
  }

  // Calcular resumen de cobertura usando el total real del grafo como denominador
  const totalMicros = allMicroIds.length > 0 ? allMicroIds.length : Object.keys(micros).length
  const masteredMicros = Object.values(micros).filter(
    m => m.masteryScore >= 60 || m.isReady
  ).length
  const coveragePercent = totalMicros > 0
    ? Math.round((masteredMicros / totalMicros) * 100)
    : 0

  return {
    userId,
    materialId,
    micros,
    allMicroIds,
    pagesCoverage,
    hypotheses: existing?.hypotheses || [],
    misconceptions: existing?.misconceptions || [],
    memoryStates: existing?.memoryStates || {},
    totalMicros,
    masteredMicros,
    coveragePercent,
    updatedAt: Date.now(),
  }
}
