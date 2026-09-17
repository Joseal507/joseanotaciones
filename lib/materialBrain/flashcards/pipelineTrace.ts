// Minimal reconstruction (post-incident) — pure, side-effect-free counters
// and a dev console summary line. Deliberately much smaller than the
// original: only the fields deckStore.ts actually reads/persists and the
// surviving tests actually assert on. Never used by any correctness
// decision — deck generation must behave identically whether this module
// exists or not.

import type { MaterialBrain } from '../types'
import type { FlashcardPlan, GeneratedFlashcard, FlashcardDeckCoverage } from './types'

export interface StageSnapshot {
  round: number
  stage: 'generated' | 'validated' | 'dedup'
  cardsById: Map<string, { validated: boolean; validationErrors: string[]; sourceUnitIds: string[] }>
}

export interface NotationDiagnostic {
  boundary: 'raw_candidate' | 'source_brain' | 'validated_repaired' | 'final_persisted'
  round: number
  plannedCardId: string
  snippets: string[]
}

export interface PendingTargetRecord {
  targetId: string
}

export interface TargetDetailedTrace {
  targetId: string
  covered: boolean
}

export interface FinalCoverageRecord {
  coveredTargets: number
  pendingTargets: number
  totalTargets: number
}

export interface RepairAttemptDiagnostic {
  plannedCardId: string
  round: number
}

export interface PipelineTraceCounts {
  runId: string
  fingerprint: string
  retrievalTargets: number
  coveredTargets: number
  pendingTargets: number
  coverageInvariantPassed: boolean
  providerCalls: { generation: number; repair: number; dedupJudge: number; planDedup: number }
  timingsMs: Record<string, number>
  repairAttempts: number
  repairGeneratedCandidates: number
  dedupMergedCount: number
}

export function newTraceRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function buildPipelineTraceCounts(args: {
  brain: MaterialBrain
  plan: FlashcardPlan
  generatedAfterRepairLoop: GeneratedFlashcard[]
  validatedBeforeDedup: GeneratedFlashcard[]
  dedupedCards: GeneratedFlashcard[]
  finalCards: GeneratedFlashcard[]
  coverageBeforeDedup: FlashcardDeckCoverage
  coverageFinal: FlashcardDeckCoverage
  repairTargetsInitial: number
  repairAttempts: number
  repairGeneratedCandidates: number
  repairAttemptedPlannedCardIds: Set<string>
  dedupMergedCount: number
  providerCalls: { generation: number; repair: number; dedupJudge: number; planDedup: number }
  timingsMs: Record<string, number>
  repairRounds?: unknown[]
  stageSnapshots?: StageSnapshot[]
}): {
  counts: PipelineTraceCounts
  pendingTargets: PendingTargetRecord[]
  finalCoverage: FinalCoverageRecord
  detailedTargetTraces: TargetDetailedTrace[]
} {
  const totalTargets = args.coverageFinal.targetedConceptClusterIds.length
  const coveredTargetIds = new Set(args.coverageFinal.coveredConceptClusterIds)
  const covered = coveredTargetIds.size
  const pendingIds = args.coverageFinal.targetedConceptClusterIds.filter(id => !coveredTargetIds.has(id))

  const counts: PipelineTraceCounts = {
    runId: newTraceRunId(),
    fingerprint: args.brain.scope.fingerprint,
    retrievalTargets: totalTargets,
    coveredTargets: covered,
    pendingTargets: pendingIds.length,
    coverageInvariantPassed: covered + pendingIds.length === totalTargets,
    providerCalls: args.providerCalls,
    timingsMs: args.timingsMs,
    repairAttempts: args.repairAttempts,
    repairGeneratedCandidates: args.repairGeneratedCandidates,
    dedupMergedCount: args.dedupMergedCount,
  }

  const pendingTargets: PendingTargetRecord[] = pendingIds.map(targetId => ({ targetId }))
  const detailedTargetTraces: TargetDetailedTrace[] = args.coverageFinal.targetedConceptClusterIds.map(targetId => ({
    targetId,
    covered: coveredTargetIds.has(targetId),
  }))
  const finalCoverage: FinalCoverageRecord = { coveredTargets: covered, pendingTargets: pendingIds.length, totalTargets }

  return { counts, pendingTargets, finalCoverage, detailedTargetTraces }
}

export function logPipelineTrace(
  fingerprint: string,
  counts: PipelineTraceCounts,
  pendingTargets: PendingTargetRecord[],
  finalCoverage: FinalCoverageRecord,
  devVerbose: boolean,
  traceRunId: string,
  detailedTargetTraces?: TargetDetailedTrace[],
  notationDiagnostics?: NotationDiagnostic[],
): void {
  try {
    const summary = {
      fingerprint, runId: traceRunId,
      coveredTargets: counts.coveredTargets, pendingTargets: counts.pendingTargets, retrievalTargets: counts.retrievalTargets,
      providerCalls: counts.providerCalls,
    }
    console.log('[Flashcards] FLASHCARDS_PIPELINE_TRACE', JSON.stringify(summary))
    if (devVerbose) {
      void detailedTargetTraces
      void notationDiagnostics
      void finalCoverage
      void pendingTargets
    }
  } catch { /* observability must never fail the build */ }
}
