import type {
  RepasarCoverageStatus,
  RepasarReviewTarget,
  RepasarRelationContext,
} from './reviewContext'

export type { RepasarCoverageStatus }

export const REPASO_ARTIFACT_SCHEMA_VERSION = '1.0.0' as const

/* ------------------------------------------------------------------ */
/*  CANONICAL ADJUDICATION                                            */
/* ------------------------------------------------------------------ */

export interface RepasoTargetAdjudication {
  targetId: string
  status: RepasarCoverageStatus
  evidence: string
  demonstrated: string
  missingDetail: string
}

/* ------------------------------------------------------------------ */
/*  TARGET STATE                                                      */
/* ------------------------------------------------------------------ */

export interface RepasoTargetState {
  targetId: string
  status: RepasarCoverageStatus
  evidence: string
  demonstrated: string
  missingDetail: string
  lastUpdatedBy:
    | { kind: 'initial' }
    | { kind: 'recovery'; attemptId: string }
    | { kind: 'final_verification'; attemptId: string }
  recoveryAttemptCount: number
}

/* ------------------------------------------------------------------ */
/*  INITIAL ATTEMPT                                                   */
/* ------------------------------------------------------------------ */

export interface RepasoInitialAttempt {
  snapshotId: string
  fingerprint: string
  explanation: string
  createdAt: string
  initialTargetStates: Record<string, RepasoTargetState>
  initialScore: number
  initialLetterGrade: string
}

/* ------------------------------------------------------------------ */
/*  RECOVERY PLAN                                                     */
/* ------------------------------------------------------------------ */

export interface RepasoRecoveryGroup {
  groupId: string
  targetIds: string[]
  groupingRationale:
    | { kind: 'topic'; topicId: string }
    | { kind: 'relation'; relationIds: string[] }
    | { kind: 'singleton' }
  pages: number[]
  materialId: string
  question: string
  questionProvenance: 'template' | 'provider'
  status: 'pending' | 'resolved' | 'exhausted'
  /**
   * The exact canonical target(s) THIS frozen question asks the student to
   * demonstrate — set once, atomically with `question`, at authoring time.
   * A group may organize several targets for planning purposes, but only
   * `assessedTargetIds` gates retry/resolution/feedback for the frozen
   * question; siblings in `targetIds` outside this set are never a hidden
   * requirement. Optional for backward compatibility with groups persisted
   * before this field existed — callers must go through
   * `resolveRepasoAssessedTargetIds` rather than reading this directly.
   */
  assessedTargetIds?: string[]
  /**
   * The deterministic natural-question family used to author `question`
   * ('definition' | 'formula' | 'mechanism' | 'relation' | 'connected' |
   * 'explanation_fallback'), or undefined for provider-authored/legacy
   * questions. DEV observability only — never a client-facing academic
   * authority signal.
   */
  questionFamily?: string
}

export interface RepasoRecoveryPlan {
  planId: string
  createdAt: string
  groups: RepasoRecoveryGroup[]
}

/* ------------------------------------------------------------------ */
/*  RECOVERY ATTEMPT                                                  */
/* ------------------------------------------------------------------ */

export interface RepasoRecoveryAttempt {
  attemptId: string
  groupId: string
  createdAt: string
  answer: string
  requestedTargetIds: string[]
  adjudicatedTargetIds: string[]
  adjudications: RepasoTargetAdjudication[]
  transitions: {
    targetId: string
    before: RepasarCoverageStatus
    after: RepasarCoverageStatus
  }[]
  scoreBefore: number
  scoreAfter: number
  letterBefore: string
  letterAfter: string
}

/* ------------------------------------------------------------------ */
/*  FINAL VERIFICATION                                                */
/* ------------------------------------------------------------------ */

export interface RepasoFinalVerificationCheck {
  checkId: string
  targetIds: string[]
  question: string
  questionProvenance: 'template' | 'provider'
  studentAnswer: string | null
  adjudicatedTargetIds: string[]
  adjudications: RepasoTargetAdjudication[]
  transitions: {
    targetId: string
    before: RepasarCoverageStatus
    after: RepasarCoverageStatus
  }[]
  status: 'pending' | 'passed' | 'failed'
  attemptId?: string | null
}

export interface RepasoFinalVerification {
  verificationId: string
  createdAt: string
  checks: RepasoFinalVerificationCheck[]
  passed: boolean
}

/* ------------------------------------------------------------------ */
/*  MASTERY (derived, never persisted)                                */
/* ------------------------------------------------------------------ */

export type RepasoMasteryStatus =
  | 'not_ready'
  | 'verification_ready'
  | 'verifying'
  | 'mastered'

/* ------------------------------------------------------------------ */
/*  SCORE HISTORY (append-only audit)                                 */
/* ------------------------------------------------------------------ */

export interface RepasoScoreHistoryEntry {
  eventId: string
  cause: 'initial' | 'recovery' | 'final_verification'
  sourceId: string | null
  scoreBefore: number
  scoreAfter: number
  letterBefore: string
  letterAfter: string
  createdAt: string
}

/* ------------------------------------------------------------------ */
/*  ARTIFACT                                                          */
/* ------------------------------------------------------------------ */

export interface RepasoArtifact {
  schemaVersion: typeof REPASO_ARTIFACT_SCHEMA_VERSION
  artifactId: string
  sessionId: string
  initial: RepasoInitialAttempt
  currentTargetStates: Record<string, RepasoTargetState>
  recoveryPlan: RepasoRecoveryPlan | null
  recoveryAttempts: RepasoRecoveryAttempt[]
  scoreHistory: RepasoScoreHistoryEntry[]
  finalVerification: RepasoFinalVerification | null
  /**
   * Target ids Repaso has PROVEN (via `buildRepasoRecoveryQuestionGrounding`
   * finding zero qualifying candidates for a target's own unopened,
   * unanswered group) have NO valid canonical recovery/assessment path —
   * a system coverage failure, never a student mastery failure. These
   * targets stay in `currentTargetStates` exactly as Enjoyer produced them
   * (never deleted, never marked 'covered', still genuinely 'missing' — no
   * fabricated evidence or mastery), so provenance/history is preserved.
   * They are excluded ONLY from: (a) the "every target resolved" mastery
   * gate (`allTargetsResolved`/`computeRepasoMasteryStatus`), and (b) the
   * Score v2 denominator (`repasoScore`) — both of which must represent
   * only targets StudyAL can actually validate. Append-only; a target
   * never leaves this set once proven non-assessable (that proof is a
   * static fact about the canonical material, not a transient state).
   */
  nonAssessableTargetIds?: string[]
  /**
   * A SERVER-OWNED, deterministic snapshot of the ownership/source-
   * selection identity that was ALREADY live-validated (via the
   * authoritative session lookup + per-material ownership check) at the
   * moment this artifact was legitimately created. Frozen once, never
   * mutated afterward (re-deriving it live on every subsequent request
   * is exactly the runtime single point of failure this field removes).
   *
   * `materialIds`/`selectedPages` deterministically reproduce the EXACT
   * same `SourceSelectionSnapshot.fingerprint` via
   * `buildSourceSelectionSnapshot` (a pure hash of these two fields) —
   * so an artifact-bound continuation (`repaso-restore`,
   * `repaso-recovery-open/answer`, `repaso-final-open/answer`) can
   * rebuild the canonical Enjoyer lookup key WITHOUT any live call to the
   * external session-authority or materials-ownership dependencies,
   * while still requiring the request's authenticated `userId` to match
   * `frozenAuthority.userId` exactly (fail-closed on any mismatch — this
   * is not a weaker check than the live one, it is the SAME ownership
   * fact, captured once instead of re-fetched every time).
   *
   * Optional only for backward compatibility with artifacts persisted
   * before this field existed; such an artifact falls back to the live
   * authority path (unchanged behavior) and is opportunistically
   * backfilled the next time that live path succeeds.
   */
  frozenAuthority?: {
    userId: string
    materialIds: string[]
    selectedPages: Record<string, number[]>
  }
}

/* ================================================================== */
/*  INTERNAL HELPERS                                                  */
/* ================================================================== */

function stableHash(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) & 0xffffffff
  }
  return (h >>> 0).toString(36)
}

function cloneTargetState(s: RepasoTargetState): RepasoTargetState {
  return {
    targetId: s.targetId,
    status: s.status,
    evidence: s.evidence,
    demonstrated: s.demonstrated,
    missingDetail: s.missingDetail,
    lastUpdatedBy: { ...s.lastUpdatedBy } as RepasoTargetState['lastUpdatedBy'],
    recoveryAttemptCount: s.recoveryAttemptCount,
  }
}

function cloneArtifact(a: RepasoArtifact): RepasoArtifact {
  return {
    schemaVersion: a.schemaVersion,
    artifactId: a.artifactId,
    sessionId: a.sessionId,
    initial: a.initial,
    currentTargetStates: Object.fromEntries(
      Object.entries(a.currentTargetStates).map(([k, v]) => [k, cloneTargetState(v)]),
    ),
    recoveryPlan: a.recoveryPlan
      ? {
          planId: a.recoveryPlan.planId,
          createdAt: a.recoveryPlan.createdAt,
          groups: a.recoveryPlan.groups.map(g => ({
            ...g,
            targetIds: [...g.targetIds],
            pages: [...g.pages],
            groupingRationale:
              g.groupingRationale.kind === 'relation'
                ? { kind: 'relation' as const, relationIds: [...g.groupingRationale.relationIds] }
                : { ...g.groupingRationale },
          })),
        }
      : null,
    recoveryAttempts: [...a.recoveryAttempts],
    scoreHistory: [...a.scoreHistory],
    finalVerification: a.finalVerification
      ? {
          verificationId: a.finalVerification.verificationId,
          createdAt: a.finalVerification.createdAt,
          passed: a.finalVerification.passed,
          checks: a.finalVerification.checks.map(c => ({
            ...c,
            targetIds: [...c.targetIds],
            adjudicatedTargetIds: [...c.adjudicatedTargetIds],
            adjudications: c.adjudications.map(j => ({ ...j })),
            transitions: c.transitions.map(t => ({ ...t })),
          })),
        }
      : null,
    nonAssessableTargetIds: a.nonAssessableTargetIds ? [...a.nonAssessableTargetIds] : undefined,
    frozenAuthority: a.frozenAuthority
      ? { userId: a.frozenAuthority.userId, materialIds: [...a.frozenAuthority.materialIds], selectedPages: { ...a.frozenAuthority.selectedPages } }
      : undefined,
  }
}

export interface RepasoTransitionPreview {
  nextTargetStates: Record<string, RepasoTargetState>
  transitions: {
    targetId: string
    before: RepasarCoverageStatus
    after: RepasarCoverageStatus
  }[]
}

const REPASO_STATUS_RANK: Record<RepasarCoverageStatus, number> = {
  missing: 0, incorrect: 0, partial: 1, covered: 2,
}

function isBlankRepasoEvidence(adjudication: RepasoTargetAdjudication): boolean {
  return !adjudication.evidence.trim() && !adjudication.demonstrated.trim()
}

/**
 * Recovery must ACCUMULATE demonstrated mastery, never erase it. A later
 * attempt can only raise a target's canonical state when it demonstrates
 * MORE knowledge, or lower it to 'incorrect' when the student gave genuine,
 * non-blank evidence that an evaluator explicitly flagged as contradictory
 * (real evidence + a real missingDetail/gap, not merely a blank/uncertain
 * answer). Absence of new evidence — "no sé", blank answers, admissions of
 * uncertainty, or an answer with no academic proposition — is NEVER treated
 * as contradictory evidence and must never lower Score v2. This is exactly
 * the "materialized mastery" layer: the raw adjudication is still recorded
 * verbatim in the attempt's own history (RepasoRecoveryAttempt.adjudications)
 * for audit — only THIS derived value feeds currentTargetStates/Score v2.
 */
function mergeRepasoRecoveryAdjudication(
  previous: RepasoTargetState,
  adjudication: RepasoTargetAdjudication,
): RepasoTargetAdjudication {
  const previousRecord: RepasoTargetAdjudication = {
    targetId: previous.targetId, status: previous.status,
    evidence: previous.evidence, demonstrated: previous.demonstrated, missingDetail: previous.missingDetail,
  }
  if (isBlankRepasoEvidence(adjudication)) return previousRecord

  const previousRank = REPASO_STATUS_RANK[previous.status]
  const nextRank = REPASO_STATUS_RANK[adjudication.status]
  if (nextRank > previousRank) return adjudication
  if (adjudication.status === 'incorrect' && adjudication.evidence.trim() && adjudication.missingDetail.trim()) {
    return adjudication
  }
  if (nextRank < previousRank) return previousRecord
  return adjudication
}

/**
 * Pure canonical transition derivation shared by score preview and mutation.
 * Recovery cannot touch covered knowledge; final verification may downgrade
 * only the targets explicitly frozen into the check. Recovery additionally
 * runs every adjudication through mergeRepasoRecoveryAdjudication so a weak
 * later attempt never destroys stronger previously demonstrated evidence —
 * final verification always applies the fresh adjudication directly (a
 * deliberate closed-book re-check, not an accumulating merge).
 */
export function previewRepasoTransitions(args: {
  currentTargetStates: Readonly<Record<string, RepasoTargetState>>
  adjudications: readonly RepasoTargetAdjudication[]
  allowedTargetIds: ReadonlySet<string>
  kind: 'recovery' | 'final_verification'
  attemptId: string
}): RepasoTransitionPreview {
  const nextTargetStates = Object.fromEntries(
    Object.entries(args.currentTargetStates).map(([id, state]) => [id, cloneTargetState(state)]),
  )
  const seen = new Set<string>()
  const transitions: RepasoTransitionPreview['transitions'] = []

  for (const adjudication of args.adjudications) {
    const id = adjudication.targetId
    if (seen.has(id)) throw new Error('REPASO_DUPLICATE_ADJUDICATED_ID')
    seen.add(id)
    if (!args.allowedTargetIds.has(id)) throw new Error('REPASO_TARGET_OUTSIDE_SCOPE')
    const current = nextTargetStates[id]
    if (!current) throw new Error('REPASO_UNKNOWN_TARGET')
    if (args.kind === 'recovery' && current.status === 'covered') {
      throw new Error('REPASO_ALREADY_COVERED_TARGET')
    }

    const materialized = args.kind === 'recovery'
      ? mergeRepasoRecoveryAdjudication(current, adjudication)
      : adjudication

    transitions.push({ targetId: id, before: current.status, after: materialized.status })
    nextTargetStates[id] = {
      targetId: id,
      status: materialized.status,
      evidence: materialized.evidence,
      demonstrated: materialized.demonstrated,
      missingDetail: materialized.missingDetail,
      lastUpdatedBy: args.kind === 'recovery'
        ? { kind: 'recovery', attemptId: args.attemptId }
        : { kind: 'final_verification', attemptId: args.attemptId },
      recoveryAttemptCount:
        current.recoveryAttemptCount + (args.kind === 'recovery' ? 1 : 0),
    }
  }

  return { nextTargetStates, transitions }
}

export function currentRepasoRecoveryGroup(
  artifact: Pick<RepasoArtifact, 'recoveryPlan' | 'currentTargetStates'>,
): RepasoRecoveryGroup | null {
  if (!artifact.recoveryPlan) return null
  return artifact.recoveryPlan.groups.find(group =>
    group.status !== 'exhausted' &&
    group.targetIds.some(id => artifact.currentTargetStates[id]?.status !== 'covered'),
  ) || null
}

const TIER_ORDER: Record<string, number> = {
  critical: 0,
  supporting: 1,
  contextual: 2,
}

function sortTargetsDeterministically(
  targets: readonly RepasarReviewTarget[],
): RepasarReviewTarget[] {
  return [...targets].sort((a, b) => {
    const tierDiff =
      (TIER_ORDER[a.importanceTier] ?? 9) - (TIER_ORDER[b.importanceTier] ?? 9)
    if (tierDiff !== 0) return tierDiff

    const aOrd = a.sourceOrder ?? Infinity
    const bOrd = b.sourceOrder ?? Infinity
    if (aOrd !== bOrd) return aOrd - bOrd

    const aPage = a.page ?? Infinity
    const bPage = b.page ?? Infinity
    if (aPage !== bPage) return aPage - bPage

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

function computeGroupPages(targets: readonly RepasarReviewTarget[]): number[] {
  const pages = new Set<number>()
  for (const t of targets) {
    if (t.pages && t.pages.length > 0) {
      for (const p of t.pages) pages.add(p)
    } else if (t.page != null) {
      pages.add(t.page)
    }
  }
  return [...pages].sort((a, b) => a - b)
}

function makeGroupId(materialId: string, sortedIds: readonly string[]): string {
  const raw = `grp:${materialId}:${sortedIds.join('|')}`
  if (raw.length <= 80) return raw
  return `grp:${materialId}:${stableHash(raw)}`
}

/* ================================================================== */
/*  EXISTING INVARIANT HELPERS (preserved)                            */
/* ================================================================== */

export function targetUniverseIsStable(
  artifact: Pick<RepasoArtifact, 'initial' | 'currentTargetStates'>,
): boolean {
  const initialIds = Object.keys(artifact.initial.initialTargetStates).sort()
  const currentIds = Object.keys(artifact.currentTargetStates).sort()
  return (
    initialIds.length === currentIds.length &&
    initialIds.every((id, i) => id === currentIds[i])
  )
}

export function rejectForgedTargetIds(
  knownTargetIds: ReadonlySet<string>,
  proposedIds: readonly string[],
): { accepted: string[]; rejected: string[] } {
  const accepted: string[] = []
  const rejected: string[] = []
  for (const id of proposedIds) {
    ;(knownTargetIds.has(id) ? accepted : rejected).push(id)
  }
  return { accepted, rejected }
}

export function partitionRecoveryResponse(
  requestedTargetIds: readonly string[],
  adjudicatedTargetIds: readonly string[],
): { adjudicated: string[]; stillUnadjudicated: string[] } {
  const adjudicatedSet = new Set(adjudicatedTargetIds)
  return {
    adjudicated: requestedTargetIds.filter(id => adjudicatedSet.has(id)),
    stillUnadjudicated: requestedTargetIds.filter(id => !adjudicatedSet.has(id)),
  }
}

const RESOLVED_STATUSES = new Set<RepasarCoverageStatus>(['covered'])

/**
 * `nonAssessableTargetIds` (system coverage failures — see
 * `RepasoArtifact.nonAssessableTargetIds`) are excluded from this gate:
 * they can never become 'covered' (no fabricated mastery), so counting
 * them here would make "every target resolved" permanently unreachable
 * for a reason the student has no possible action to repair.
 */
export function allTargetsResolved(
  currentTargetStates: Record<string, RepasoTargetState>,
  nonAssessableTargetIds?: ReadonlySet<string>,
): boolean {
  return Object.values(currentTargetStates).every(t =>
    RESOLVED_STATUSES.has(t.status) || Boolean(nonAssessableTargetIds?.has(t.targetId)),
  )
}

/**
 * FINAL PRODUCT FLOW: Recovery already requires the student to actively
 * demonstrate every unresolved assessable target — a second closed-book
 * Final Verification stage is no longer part of the active product path.
 * Once every ASSESSABLE target (excluding `nonAssessableTargetIds`, a
 * system coverage fact, never a student mastery fact) is resolved, Repaso
 * is complete: 'mastered' directly, with no 'verification_ready'/
 * 'verifying' gate in between. `finalVerification` is intentionally
 * IGNORED here — a legacy artifact that already has one keeps that data
 * fully readable (see `buildRepasoStudentEvidencePaper` / the artifact's
 * own persisted `finalVerification` field), it just never blocks or
 * changes the completion verdict anymore. This self-heals any existing
 * artifact whose assessable universe is already resolved directly to
 * 'mastered' on its very next read — no migration, no re-adjudication.
 */
export function computeRepasoMasteryStatus(
  currentTargetStates: Record<string, RepasoTargetState>,
  finalVerification: RepasoFinalVerification | null,
  nonAssessableTargetIds?: ReadonlySet<string>,
): RepasoMasteryStatus {
  void finalVerification
  return allTargetsResolved(currentTargetStates, nonAssessableTargetIds) ? 'mastered' : 'not_ready'
}

export function scoreCanReach100(
  currentTargetStates: Record<string, RepasoTargetState>,
  nonAssessableTargetIds?: ReadonlySet<string>,
): boolean {
  return allTargetsResolved(currentTargetStates, nonAssessableTargetIds)
}

export interface RepasoStudentEvidenceSection {
  provenance: string
  text: string
  groupId: string | null
  targetIds: string[]
}

/** Paper 2 is assembled exclusively from verbatim persisted student text. */
export function buildRepasoStudentEvidencePaper(
  artifact: RepasoArtifact,
): RepasoStudentEvidenceSection[] {
  const sections: RepasoStudentEvidenceSection[] = []
  const initiallyCovered = Object.values(artifact.initial.initialTargetStates)
    .filter(state => state.status === 'covered')
    .map(state => state.targetId)
  if (initiallyCovered.length > 0 && artifact.initial.explanation) {
    sections.push({
      provenance: 'Explicación inicial',
      text: artifact.initial.explanation,
      groupId: null,
      targetIds: initiallyCovered,
    })
  }
  artifact.recoveryAttempts.forEach((attempt, index) => {
    if (attempt.transitions.some(t => t.after === 'covered') && attempt.answer) {
      sections.push({
        provenance: `Recuperado en pregunta ${index + 1}`,
        text: attempt.answer,
        groupId: attempt.groupId,
        targetIds: attempt.transitions.filter(t => t.after === 'covered').map(t => t.targetId),
      })
    }
  })
  artifact.finalVerification?.checks.forEach((check, index) => {
    if (check.status === 'passed' && check.studentAnswer) {
      sections.push({
        provenance: `Confirmado en verificación final ${index + 1}`,
        text: check.studentAnswer,
        groupId: null,
        targetIds: [...check.targetIds],
      })
    }
  })
  return sections
}

/* ================================================================== */
/*  STRENGTHENED PARSER                                               */
/* ================================================================== */

export function isRepasoArtifact(value: unknown): value is RepasoArtifact {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>

  if (v.schemaVersion !== REPASO_ARTIFACT_SCHEMA_VERSION) return false
  if (typeof v.artifactId !== 'string') return false
  if (typeof v.sessionId !== 'string') return false

  const init = v.initial as Record<string, unknown> | undefined
  if (!init || typeof init !== 'object') return false
  if (typeof init.snapshotId !== 'string') return false
  if (typeof init.fingerprint !== 'string') return false
  if (typeof init.explanation !== 'string') return false
  if (!init.initialTargetStates || typeof init.initialTargetStates !== 'object') return false

  if (!v.currentTargetStates || typeof v.currentTargetStates !== 'object') return false
  if (!Array.isArray(v.recoveryAttempts)) return false
  if (!Array.isArray(v.scoreHistory)) return false
  if (v.finalVerification !== null && typeof v.finalVerification !== 'object') return false

  const initIds = Object.keys(init.initialTargetStates as Record<string, unknown>).sort()
  const curIds = Object.keys(v.currentTargetStates as Record<string, unknown>).sort()
  if (initIds.length !== curIds.length) return false
  if (!initIds.every((id, i) => id === curIds[i])) return false

  return true
}

/* ================================================================== */
/*  createRepasoArtifact                                              */
/* ================================================================== */

export function createRepasoArtifact(args: {
  artifactId: string
  sessionId: string
  snapshotId: string
  fingerprint: string
  explanation: string
  createdAt: string
  adjudications: readonly RepasoTargetAdjudication[]
  initialScore: number
  initialLetterGrade: string
}): RepasoArtifact {
  const seen = new Set<string>()
  for (const adj of args.adjudications) {
    if (seen.has(adj.targetId)) {
      throw new Error(`REPASO_DUPLICATE_TARGET_ID:${adj.targetId}`)
    }
    seen.add(adj.targetId)
  }

  const initialTargetStates: Record<string, RepasoTargetState> = {}
  const currentTargetStates: Record<string, RepasoTargetState> = {}

  for (const adj of args.adjudications) {
    const state: RepasoTargetState = {
      targetId: adj.targetId,
      status: adj.status,
      evidence: adj.evidence,
      demonstrated: adj.demonstrated,
      missingDetail: adj.missingDetail,
      lastUpdatedBy: { kind: 'initial' },
      recoveryAttemptCount: 0,
    }
    initialTargetStates[adj.targetId] = cloneTargetState(state)
    currentTargetStates[adj.targetId] = cloneTargetState(state)
  }

  return {
    schemaVersion: REPASO_ARTIFACT_SCHEMA_VERSION,
    artifactId: args.artifactId,
    sessionId: args.sessionId,
    initial: {
      snapshotId: args.snapshotId,
      fingerprint: args.fingerprint,
      explanation: args.explanation,
      createdAt: args.createdAt,
      initialTargetStates,
      initialScore: args.initialScore,
      initialLetterGrade: args.initialLetterGrade,
    },
    currentTargetStates,
    recoveryPlan: null,
    recoveryAttempts: [],
    scoreHistory: [
      {
        eventId: `initial:${args.artifactId}`,
        cause: 'initial',
        sourceId: null,
        scoreBefore: args.initialScore,
        scoreAfter: args.initialScore,
        letterBefore: args.initialLetterGrade,
        letterAfter: args.initialLetterGrade,
        createdAt: args.createdAt,
      },
    ],
    finalVerification: null,
  }
}

/* ================================================================== */
/*  buildRepasoRecoveryPlan  (deterministic, no provider)             */
/* ================================================================== */

export function buildRepasoRecoveryPlan(args: {
  planId: string
  createdAt: string
  targets: readonly RepasarReviewTarget[]
  relations: readonly RepasarRelationContext[]
  currentTargetStates: Readonly<Record<string, RepasoTargetState>>
  maxGroupSize?: number
}): RepasoRecoveryPlan {
  const maxGroupSize = args.maxGroupSize ?? 4

  const eligible = args.targets.filter(t => {
    const s = args.currentTargetStates[t.id]
    return s && s.status !== 'covered'
  })

  const byMaterial = new Map<string, RepasarReviewTarget[]>()
  for (const t of eligible) {
    const list = byMaterial.get(t.materialId) ?? []
    list.push(t)
    byMaterial.set(t.materialId, list)
  }

  const allGroups: RepasoRecoveryGroup[] = []

  for (const [materialId, matTargets] of byMaterial) {
    const byTopic = new Map<string, RepasarReviewTarget[]>()
    const noTopic: RepasarReviewTarget[] = []

    for (const t of matTargets) {
      if (t.topicId) {
        const list = byTopic.get(t.topicId) ?? []
        list.push(t)
        byTopic.set(t.topicId, list)
      } else {
        noTopic.push(t)
      }
    }

    for (const [topicId, topicTargets] of byTopic) {
      const sorted = sortTargetsDeterministically(topicTargets)
      const chunks = chunkArray(sorted, maxGroupSize)
      for (const chunk of chunks) {
        allGroups.push(
          buildGroupFromChunk(chunk, materialId, { kind: 'topic', topicId }),
        )
      }
    }

    if (noTopic.length > 0) {
      const noTopicIds = new Set(noTopic.map(t => t.id))
      const adj = new Map<string, Set<string>>()
      for (const t of noTopic) adj.set(t.id, new Set())

      for (const rel of args.relations) {
        if (noTopicIds.has(rel.fromTargetId) && noTopicIds.has(rel.toTargetId)) {
          adj.get(rel.fromTargetId)!.add(rel.toTargetId)
          adj.get(rel.toTargetId)!.add(rel.fromTargetId)
        }
      }

      const visited = new Set<string>()
      const components: RepasarReviewTarget[][] = []

      for (const t of sortTargetsDeterministically(noTopic)) {
        if (visited.has(t.id)) continue
        const comp: RepasarReviewTarget[] = []
        const queue = [t.id]
        visited.add(t.id)
        while (queue.length > 0) {
          const curr = queue.shift()!
          comp.push(noTopic.find(x => x.id === curr)!)
          for (const nb of adj.get(curr)!) {
            if (!visited.has(nb)) {
              visited.add(nb)
              queue.push(nb)
            }
          }
        }
        components.push(comp)
      }

      for (const comp of components) {
        const sorted = sortTargetsDeterministically(comp)
        const chunks = chunkArray(sorted, maxGroupSize)
        for (const chunk of chunks) {
          const relIds = args.relations
            .filter(
              r =>
                chunk.some(t => t.id === r.fromTargetId) &&
                chunk.some(t => t.id === r.toTargetId),
            )
            .map(r => r.id)

          const rationale: RepasoRecoveryGroup['groupingRationale'] =
            chunk.length === 1
              ? { kind: 'singleton' }
              : relIds.length > 0
                ? { kind: 'relation', relationIds: relIds }
                : { kind: 'singleton' }

          allGroups.push(buildGroupFromChunk(chunk, materialId, rationale))
        }
      }
    }
  }

  const targetMap = new Map(args.targets.map(t => [t.id, t]))

  allGroups.sort((a, b) => {
    const aTier = Math.min(
      ...a.targetIds.map(id => TIER_ORDER[targetMap.get(id)?.importanceTier ?? 'contextual'] ?? 9),
    )
    const bTier = Math.min(
      ...b.targetIds.map(id => TIER_ORDER[targetMap.get(id)?.importanceTier ?? 'contextual'] ?? 9),
    )
    if (aTier !== bTier) return aTier - bTier

    const aOrd = Math.min(...a.targetIds.map(id => targetMap.get(id)?.sourceOrder ?? Infinity))
    const bOrd = Math.min(...b.targetIds.map(id => targetMap.get(id)?.sourceOrder ?? Infinity))
    if (aOrd !== bOrd) return aOrd - bOrd

    const aPg = a.pages.length > 0 ? Math.min(...a.pages) : Infinity
    const bPg = b.pages.length > 0 ? Math.min(...b.pages) : Infinity
    if (aPg !== bPg) return aPg - bPg

    return a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0
  })

  return { planId: args.planId, createdAt: args.createdAt, groups: allGroups }
}

function chunkArray<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size) as T[])
  }
  return out
}

function buildGroupFromChunk(
  chunk: readonly RepasarReviewTarget[],
  materialId: string,
  rationale: RepasoRecoveryGroup['groupingRationale'],
): RepasoRecoveryGroup {
  const sortedIds = [...chunk].map(t => t.id).sort()
  return {
    groupId: makeGroupId(materialId, sortedIds),
    targetIds: sortedIds,
    groupingRationale: rationale,
    pages: computeGroupPages(chunk),
    materialId,
    question: '',
    questionProvenance: 'template',
    status: 'pending',
  }
}

/* ================================================================== */
/*  applyRecoveryAttempt                                              */
/* ================================================================== */

export function applyRecoveryAttempt(
  artifact: RepasoArtifact,
  attempt: RepasoRecoveryAttempt,
): RepasoArtifact {
  if (!artifact.recoveryPlan) {
    throw new Error('REPASO_NO_RECOVERY_PLAN')
  }

  const group = artifact.recoveryPlan.groups.find(g => g.groupId === attempt.groupId)
  if (!group) throw new Error('REPASO_UNKNOWN_GROUP')

  const groupSet = new Set(group.targetIds)
  for (const id of attempt.requestedTargetIds) {
    if (!groupSet.has(id)) throw new Error('REPASO_TARGET_OUTSIDE_GROUP')
  }

  if (new Set(attempt.requestedTargetIds).size !== attempt.requestedTargetIds.length) {
    throw new Error('REPASO_DUPLICATE_REQUESTED_ID')
  }
  if (new Set(attempt.adjudicatedTargetIds).size !== attempt.adjudicatedTargetIds.length) {
    throw new Error('REPASO_DUPLICATE_ADJUDICATED_ID')
  }

  const reqSet = new Set(attempt.requestedTargetIds)
  for (const id of attempt.adjudicatedTargetIds) {
    if (!reqSet.has(id)) throw new Error('REPASO_ADJUDICATION_ID_MISMATCH')
  }

  const adjMap = new Map(attempt.adjudications.map(a => [a.targetId, a]))
  if (adjMap.size !== attempt.adjudicatedTargetIds.length) {
    throw new Error('REPASO_ADJUDICATION_ID_MISMATCH')
  }
  for (const id of attempt.adjudicatedTargetIds) {
    if (!adjMap.has(id)) throw new Error('REPASO_ADJUDICATION_ID_MISMATCH')
  }

  const transMap = new Map(attempt.transitions.map(t => [t.targetId, t]))
  if (transMap.size !== attempt.adjudicatedTargetIds.length) {
    throw new Error('REPASO_TRANSITION_ID_MISMATCH')
  }
  for (const id of attempt.adjudicatedTargetIds) {
    if (!transMap.has(id)) throw new Error('REPASO_TRANSITION_ID_MISMATCH')
  }

  for (const id of attempt.requestedTargetIds) {
    const cur = artifact.currentTargetStates[id]
    if (!cur) throw new Error('REPASO_UNKNOWN_TARGET')
    if (cur.status === 'covered') throw new Error('REPASO_ALREADY_COVERED_TARGET')
  }

  const preview = previewRepasoTransitions({
    currentTargetStates: artifact.currentTargetStates,
    adjudications: attempt.adjudications,
    allowedTargetIds: new Set(attempt.requestedTargetIds),
    kind: 'recovery',
    attemptId: attempt.attemptId,
  })
  for (const transition of attempt.transitions) {
    const derived = preview.transitions.find(t => t.targetId === transition.targetId)
    if (!derived || derived.before !== transition.before || derived.after !== transition.after) {
      throw new Error('REPASO_TRANSITION_STATUS_MISMATCH')
    }
  }

  const next = cloneArtifact(artifact)
  next.currentTargetStates = preview.nextTargetStates

  const nextGroup = next.recoveryPlan!.groups.find(g => g.groupId === attempt.groupId)!
  if (nextGroup.targetIds.every(tid => next.currentTargetStates[tid]?.status === 'covered')) {
    nextGroup.status = 'resolved'
  }

  next.recoveryAttempts.push(attempt)

  next.scoreHistory.push({
    eventId: `recovery:${attempt.attemptId}`,
    cause: 'recovery',
    sourceId: attempt.attemptId,
    scoreBefore: attempt.scoreBefore,
    scoreAfter: attempt.scoreAfter,
    letterBefore: attempt.letterBefore,
    letterAfter: attempt.letterAfter,
    createdAt: attempt.createdAt,
  })

  return next
}

/* ================================================================== */
/*  applyFinalVerificationResult                                      */
/* ================================================================== */

export function applyFinalVerificationResult(
  artifact: RepasoArtifact,
  args: {
    verificationId: string
    checkId: string
    studentAnswer: string
    adjudicatedTargetIds: string[]
    adjudications: RepasoTargetAdjudication[]
    transitions: {
      targetId: string
      before: RepasarCoverageStatus
      after: RepasarCoverageStatus
    }[]
    status: 'passed' | 'failed'
    scoreBefore: number
    scoreAfter: number
    letterBefore: string
    letterAfter: string
    createdAt: string
    attemptId: string
  },
): RepasoArtifact {
  if (!artifact.finalVerification) throw new Error('REPASO_UNKNOWN_VERIFICATION')
  if (artifact.finalVerification.verificationId !== args.verificationId) {
    throw new Error('REPASO_UNKNOWN_VERIFICATION')
  }

  const checkIdx = artifact.finalVerification.checks.findIndex(
    c => c.checkId === args.checkId,
  )
  if (checkIdx === -1) throw new Error('REPASO_UNKNOWN_CHECK')

  const frozenCheck = artifact.finalVerification.checks[checkIdx]
  const frozenTargetSet = new Set(frozenCheck.targetIds)

  for (const id of args.adjudicatedTargetIds) {
    if (!frozenTargetSet.has(id)) throw new Error('REPASO_CHECK_TARGET_MISMATCH')
  }

  const adjMap = new Map(args.adjudications.map(a => [a.targetId, a]))
  if (adjMap.size !== args.adjudicatedTargetIds.length) {
    throw new Error('REPASO_ADJUDICATION_ID_MISMATCH')
  }
  for (const id of args.adjudicatedTargetIds) {
    if (!adjMap.has(id)) throw new Error('REPASO_ADJUDICATION_ID_MISMATCH')
  }

  const transMap = new Map(args.transitions.map(t => [t.targetId, t]))
  if (transMap.size !== args.adjudicatedTargetIds.length) {
    throw new Error('REPASO_TRANSITION_ID_MISMATCH')
  }
  for (const id of args.adjudicatedTargetIds) {
    if (!transMap.has(id)) throw new Error('REPASO_TRANSITION_ID_MISMATCH')
  }

  const next = cloneArtifact(artifact)

  for (const id of args.adjudicatedTargetIds) {
    const adj = adjMap.get(id)!
    const trans = transMap.get(id)!
    const cur = next.currentTargetStates[id]
    if (!cur) throw new Error('REPASO_UNKNOWN_TARGET')
    if (trans.before !== cur.status) throw new Error('REPASO_TRANSITION_STATUS_MISMATCH')
    if (trans.after !== adj.status) throw new Error('REPASO_TRANSITION_STATUS_MISMATCH')

    next.currentTargetStates[id] = {
      targetId: id,
      status: adj.status,
      evidence: adj.evidence,
      demonstrated: adj.demonstrated,
      missingDetail: adj.missingDetail,
      lastUpdatedBy: { kind: 'final_verification', attemptId: args.attemptId },
      recoveryAttemptCount: cur.recoveryAttemptCount,
    }
  }

  const nextCheck = next.finalVerification!.checks[checkIdx]
  nextCheck.studentAnswer = args.studentAnswer
  nextCheck.adjudicatedTargetIds = [...args.adjudicatedTargetIds]
  nextCheck.adjudications = args.adjudications.map(a => ({ ...a }))
  nextCheck.transitions = args.transitions.map(t => ({ ...t }))
  nextCheck.status = args.status
  nextCheck.attemptId = args.attemptId

  // A failed check reopens only frozen recovery groups containing targets
  // that the check actually downgraded. Plan order and questions stay frozen.
  if (args.status === 'failed' && next.recoveryPlan) {
    const failedIds = new Set(
      args.transitions.filter(t => t.after !== 'covered').map(t => t.targetId),
    )
    for (const group of next.recoveryPlan.groups) {
      if (group.targetIds.some(id => failedIds.has(id))) group.status = 'pending'
    }
  }

  next.finalVerification!.passed =
    next.finalVerification!.checks.length > 0 &&
    next.finalVerification!.checks.every(c => c.status === 'passed')

  next.scoreHistory.push({
    eventId: `final_verification:${args.attemptId}`,
    cause: 'final_verification',
    sourceId: args.attemptId,
    scoreBefore: args.scoreBefore,
    scoreAfter: args.scoreAfter,
    letterBefore: args.letterBefore,
    letterAfter: args.letterAfter,
    createdAt: args.createdAt,
  })

  return next
}
