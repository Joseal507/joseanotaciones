// ═══════════════════════════════════════════════════════════════
// StudyAL — Causal Strategy Engine
// Aprende qué secuencias de motores funcionan mejor
// para cada tipo de estudiante.
// No reglas. Patrones causales aprendidos del uso.
// ═══════════════════════════════════════════════════════════════

import type { StudentMemory, LearningPattern } from './studentMemory'

export interface SequenceOutcome {
  sequence: string[]         // ej: ['analisis', 'flashcards', 'quiz']
  pattern: LearningPattern
  avgDomainGain: number
  sampleSize: number
  confidence: number         // 0-100
  lastObserved: number
}

export interface CausalModel {
  userId: string
  sequenceOutcomes: SequenceOutcome[]
  bestSequenceByPattern: Partial<Record<LearningPattern, string[]>>
  totalObservations: number
  lastUpdated: number
}

// ── Crear modelo causal vacío ────────────────────────────────────
export function createEmptyCausalModel(userId: string): CausalModel {
  return {
    userId,
    sequenceOutcomes: [],
    bestSequenceByPattern: {},
    totalObservations: 0,
    lastUpdated: Date.now(),
  }
}

// ── Registrar resultado de una secuencia ─────────────────────────
export function recordSequenceOutcome(
  model: CausalModel,
  sequence: string[],
  pattern: LearningPattern,
  domainGain: number,
): CausalModel {
  const key = sequence.join('→')
  const existing = model.sequenceOutcomes.find(
    s => s.sequence.join('→') === key && s.pattern === pattern
  )

  let updatedOutcomes: SequenceOutcome[]

  if (existing) {
    const newAvg = Math.round(
      (existing.avgDomainGain * existing.sampleSize + domainGain) /
      (existing.sampleSize + 1)
    )
    const newSample = existing.sampleSize + 1
    const confidence = Math.min(100, newSample * 8)

    updatedOutcomes = model.sequenceOutcomes.map(s =>
      s === existing
        ? { ...s, avgDomainGain: newAvg, sampleSize: newSample, confidence, lastObserved: Date.now() }
        : s
    )
  } else {
    updatedOutcomes = [
      ...model.sequenceOutcomes.slice(-49),
      {
        sequence,
        pattern,
        avgDomainGain: domainGain,
        sampleSize: 1,
        confidence: 10,
        lastObserved: Date.now(),
      },
    ]
  }

  // Recalcular mejores secuencias por patrón
  const bestByPattern: Partial<Record<LearningPattern, string[]>> = {}
  const patterns: LearningPattern[] = [
    'practice_learner', 'memory_learner', 'deep_thinker',
    'exam_performer', 'fast_learner', 'steady_learner', 'anxiety_prone',
  ]

  for (const p of patterns) {
    const forPattern = updatedOutcomes
      .filter(s => s.pattern === p && s.confidence >= 30)
      .sort((a, b) => b.avgDomainGain - a.avgDomainGain)

    if (forPattern.length > 0) {
      bestByPattern[p] = forPattern[0].sequence
    }
  }

  return {
    ...model,
    sequenceOutcomes: updatedOutcomes,
    bestSequenceByPattern: bestByPattern,
    totalObservations: model.totalObservations + 1,
    lastUpdated: Date.now(),
  }
}

// ── Obtener mejor secuencia para el estudiante ───────────────────
export function getBestSequenceForStudent(
  model: CausalModel,
  pattern: LearningPattern,
  fallback: string[],
): { sequence: string[]; confidence: number; isLearned: boolean } {
  const learned = model.bestSequenceByPattern[pattern]
  if (learned) {
    const outcome = model.sequenceOutcomes.find(
      s => s.sequence.join('→') === learned.join('→') && s.pattern === pattern
    )
    return {
      sequence: learned,
      confidence: outcome?.confidence || 50,
      isLearned: true,
    }
  }

  // Buscar secuencias de patrones similares
  const similarPatterns: Partial<Record<LearningPattern, LearningPattern[]>> = {
    practice_learner: ['exam_performer'],
    memory_learner: ['steady_learner'],
    deep_thinker: ['steady_learner'],
    fast_learner: ['practice_learner'],
  }

  const similar = similarPatterns[pattern] || []
  for (const p of similar) {
    const seq = model.bestSequenceByPattern[p]
    if (seq) {
      return { sequence: seq, confidence: 35, isLearned: false }
    }
  }

  return { sequence: fallback, confidence: 20, isLearned: false }
}

// ── Secuencias predeterminadas por patrón (prior knowledge) ──────
export const DEFAULT_SEQUENCES: Partial<Record<LearningPattern, string[]>> = {
  practice_learner: ['quiz', 'alai', 'examen'],
  memory_learner: ['flashcards', 'truquitos', 'quiz'],
  deep_thinker: ['analisis', 'studymap', 'alai'],
  exam_performer: ['quiz', 'examen', 'alai'],
  anxiety_prone: ['analisis', 'flashcards', 'quiz', 'examen'],
  fast_learner: ['quiz', 'examen', 'alai'],
  steady_learner: ['analisis', 'flashcards', 'quiz'],
  visual_learner: ['studymap', 'analisis', 'quiz'],
  unknown: ['analisis', 'flashcards', 'quiz'],
}

// ── Evaluador de N programas posibles ────────────────────────────
export interface ProgramCandidate {
  sequence: string[]
  estimatedGain: number
  estimatedMinutes: number
  roi: number
  rationale: string
}

export function evaluateProgramCandidates(
  pattern: LearningPattern,
  model: CausalModel,
  availableMinutes: number,
  currentDomain: number,
  targetScore: number,
): ProgramCandidate[] {
  const gap = targetScore - currentDomain

  // Generar candidatos
  const candidates: ProgramCandidate[] = []

  const allEngines = ['analisis', 'flashcards', 'quiz', 'examen', 'alai', 'studymap', 'truquitos']
  const evidenceEngines = ['flashcards', 'quiz', 'examen', 'alai']
  const supportEngines = ['analisis', 'studymap', 'truquitos']

  // Candidato 1: Basado en el patrón del estudiante
  const bestSeq = getBestSequenceForStudent(model, pattern, DEFAULT_SEQUENCES[pattern] || evidenceEngines)
  const seqGain = Math.min(gap, bestSeq.confidence * 0.15 + 8)
  candidates.push({
    sequence: bestSeq.sequence,
    estimatedGain: Math.round(seqGain),
    estimatedMinutes: bestSeq.sequence.length * (availableMinutes / 3),
    roi: seqGain / Math.max(1, availableMinutes),
    rationale: bestSeq.isLearned
      ? `Esta secuencia funcionó mejor para tu perfil (${pattern}) en el pasado.`
      : `Secuencia optimizada para tu tipo de aprendizaje (${pattern}).`,
  })

  // Candidato 2: Máxima evidencia
  const evidenceSeq = evidenceEngines.slice(0, 3)
  const evidenceGain = currentDomain < 50 ? 6 : currentDomain < 75 ? 10 : 14
  candidates.push({
    sequence: evidenceSeq,
    estimatedGain: evidenceGain,
    estimatedMinutes: evidenceSeq.length * (availableMinutes / 3),
    roi: evidenceGain / Math.max(1, availableMinutes),
    rationale: 'Máxima recolección de evidencia. Ideal cuando ALAI necesita calibrar mejor tu nivel.',
  })

  // Candidato 3: Tiempo mínimo (para sesiones cortas)
  if (availableMinutes <= 20) {
    const shortSeq = [pattern === 'memory_learner' ? 'flashcards' : 'quiz']
    const shortGain = 5
    candidates.push({
      sequence: shortSeq,
      estimatedGain: shortGain,
      estimatedMinutes: availableMinutes,
      roi: shortGain / Math.max(1, availableMinutes),
      rationale: `Sesión corta optimizada (${availableMinutes} min). Un solo motor de alto impacto.`,
    })
  }

  // Candidato 4: Comprensión + práctica (balanceado)
  const balancedSeq = ['analisis', 'quiz', 'alai']
  const balancedGain = 9
  candidates.push({
    sequence: balancedSeq,
    estimatedGain: balancedGain,
    estimatedMinutes: balancedSeq.length * (availableMinutes / 3),
    roi: balancedGain / Math.max(1, availableMinutes),
    rationale: 'Secuencia balanceada: comprensión → práctica → verificación.',
  })

  // Ordenar por ROI
  return candidates.sort((a, b) => b.roi - a.roi)
}
