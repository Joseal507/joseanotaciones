// Minimal reconstruction (post-incident) — dev-only, fail-open trace file
// persistence. Never throws; never affects deck generation. See
// pipelineTrace.ts for the counters this persists.

import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { PipelineTraceCounts, PendingTargetRecord, TargetDetailedTrace, NotationDiagnostic, FinalCoverageRecord } from './pipelineTrace'
import type { RepairDedupDiagnostics } from './pedagogicalDedup'
import type { PlannedCardMergeDiagnostic, MetadataEligibilityDiagnostic } from './types'

const TRACE_DIR = path.join(process.cwd(), '.flashcards-traces')

export interface FlashcardsTracePayload {
  runId: string
  fingerprint: string
  createdAt: string
  status: 'ok' | 'failed'
  errorStage?: string
  errorMessage?: string
  pipelineTrace?: PipelineTraceCounts
  pendingTargets?: PendingTargetRecord[]
  targetTraces?: TargetDetailedTrace[]
  notationDiagnostics?: NotationDiagnostic[]
  finalCoverage?: FinalCoverageRecord
  dedupDiagnostics?: Record<string, unknown> & { fullDeckDedupRuns?: number; repairDedupRounds?: (RepairDedupDiagnostics & { round: number })[] }
  repairAttemptDiagnostics?: unknown[]
  unresolvedGenerationFailures?: unknown[]
  mergeDiagnostics?: PlannedCardMergeDiagnostic[]
  metadataDiagnostics?: MetadataEligibilityDiagnostic[]
}

export async function persistFlashcardsTrace(payload: FlashcardsTracePayload): Promise<void> {
  if (process.env.NODE_ENV === 'production') return
  try {
    if (!existsSync(TRACE_DIR)) await mkdir(TRACE_DIR, { recursive: true })
    const filePath = path.join(TRACE_DIR, `${payload.fingerprint.replace(/[^a-zA-Z0-9_-]/g, '_')}-${payload.runId}.json`)
    await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
    console.log('[Flashcards] FLASHCARDS_TRACE_SAVED', JSON.stringify({ path: filePath }))
  } catch { /* fail-open — trace persistence must never affect deck generation */ }
}
