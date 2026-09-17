# Repaso Redesign — Technical Reconnaissance + Implementation Plan

**Status:** Planning document only. NO Stage 2 implementation has occurred. NO commit has been made.

**Purpose:** This document is written so an external AI with **no repository access** can produce concrete implementation instructions for the Repaso ("Repasar") product redesign, described in the product brief "FROM 'FEEDBACK DASHBOARD' TO 'EXPLAIN → DIAGNOSE → RECOVER → MASTER'". Everything below is extracted directly from the live repository (`/Users/joseal/IMPORTANTE/studyal`) as of this writing. Code excerpts are verbatim unless explicitly marked `[...]` for omitted unrelated lines.

---

## A. Verification of current artifact-schema work

Two files were added in the prior turn, purely as design scaffolding. **Nothing wires them into the live route or UI yet.**

### `lib/materialBrain/repasoArtifact.ts` (complete contents)

```ts
// NOTE: `RepasarCoverageStatus` is currently defined locally inside
// app/api/alai-studyal-repasar/route.ts (not exported) — a lib file must
// never import from an API route (wrong dependency direction). When this
// artifact is actually wired up (Stage 2+), that type should move here
// (or to reviewContext.ts, alongside RepasarTargetStatus) and the route
// should import it, not the other way around. Redeclared here for now so
// this design file has zero dependency on route.ts.
export type RepasarCoverageStatus = 'covered' | 'partial' | 'missing' | 'incorrect'

export const REPASO_ARTIFACT_SCHEMA_VERSION = '1.0.0'

export interface RepasoTargetState {
  targetId: string
  status: RepasarCoverageStatus
  evidence: string
  demonstrated: string
  missingDetail: string
  lastUpdatedBy: { kind: 'initial' } | { kind: 'recovery'; attemptId: string } | { kind: 'final_verification'; attemptId: string }
  recoveryAttemptCount: number
}

export interface RepasoInitialAttempt {
  snapshotId: string
  fingerprint: string
  explanation: string
  createdAt: string
  initialTargetStates: Record<string, RepasoTargetState>
  initialScore: number
  initialLetterGrade: string
}

export interface RepasoRecoveryGroup {
  groupId: string
  targetIds: string[]
  groupingRationale: { kind: 'topic'; topicId: string } | { kind: 'relation'; relationIds: string[] } | { kind: 'singleton' }
  pages: number[]
  materialId: string
  question: string
  questionProvenance: 'template' | 'provider'
  status: 'pending' | 'resolved' | 'exhausted'
}

export interface RepasoRecoveryPlan {
  planId: string
  createdAt: string
  groups: RepasoRecoveryGroup[]
}

export interface RepasoRecoveryAttempt {
  attemptId: string
  groupId: string
  createdAt: string
  answer: string
  requestedTargetIds: string[]
  adjudicatedTargetIds: string[]
  transitions: { targetId: string; before: RepasarCoverageStatus; after: RepasarCoverageStatus }[]
  scoreBefore: number
  scoreAfter: number
  letterBefore: string
  letterAfter: string
}

export interface RepasoFinalVerificationCheck {
  checkId: string
  targetIds: string[]
  question: string
  questionProvenance: 'template' | 'provider'
  studentAnswer: string | null
  adjudicatedTargetIds: string[]
  transitions: { targetId: string; before: RepasarCoverageStatus; after: RepasarCoverageStatus }[]
  status: 'pending' | 'passed' | 'failed'
}

export interface RepasoFinalVerification {
  verificationId: string
  createdAt: string
  checks: RepasoFinalVerificationCheck[]
  passed: boolean
}

export type RepasoMasteryStatus = 'not_ready' | 'verification_ready' | 'verifying' | 'mastered'

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
  masteryStatus: RepasoMasteryStatus
}

export function targetUniverseIsStable(artifact: Pick<RepasoArtifact, 'initial' | 'currentTargetStates'>): boolean
export function rejectForgedTargetIds(knownTargetIds: ReadonlySet<string>, proposedIds: readonly string[]): { accepted: string[]; rejected: string[] }
export function partitionRecoveryResponse(requestedTargetIds: readonly string[], adjudicatedTargetIds: readonly string[]): { adjudicated: string[]; stillUnadjudicated: string[] }
export function allTargetsResolved(currentTargetStates: Record<string, RepasoTargetState>): boolean
export function computeRepasoMasteryStatus(currentTargetStates: Record<string, RepasoTargetState>, finalVerification: RepasoFinalVerification | null): RepasoMasteryStatus
export function scoreCanReach100(currentTargetStates: Record<string, RepasoTargetState>): boolean
export function isRepasoArtifact(value: unknown): value is RepasoArtifact
```

(Full bodies of the six pure functions are given verbatim in section W, "External AI Context Pack", to avoid duplicating twice in this already-long document.)

### `scripts/tests/repaso-artifact-schema-contracts.ts`

Contains 7 test functions (`testSchemaVersionIsExplicit`, `testIsRepasoArtifactDetection`, `testTargetUniverseStability`, `testForgedTargetIdsRejected`, `testUnadjudicatedNeverBecomesUnresolvedMissing`, `testAllTargetsResolvedAndScoreCanReach100`, `testMasteryInvariant`), all currently passing. No provider calls, no route/UI dependency.

### Design concerns identified after this reconnaissance pass

1. **`RepasarCoverageStatus` duplication.** It is currently defined twice: once (unexported) inside `app/api/alai-studyal-repasar/route.ts`, once (exported) inside `repasoArtifact.ts`. Before Stage 2 touches the route, this type should be moved to a shared lib file (`lib/materialBrain/reviewContext.ts` is the natural home, next to `RepasarTargetStatus`) and imported by both the route and `repasoArtifact.ts`. This is a **1-line risk**, not a design flaw, but must be fixed in Stage 1 of implementation, not left for later.
2. **`RepasoTargetState.lastUpdatedBy` granularity.** It records *which event last touched* a target, but not the full history of every touch. If the product later wants "this target flipped status 3 times," that has to be reconstructed by scanning `recoveryAttempts[].transitions` — which is fine (it's exactly why `transitions` exists on each attempt) but should be called out explicitly to the external AI so it doesn't try to add a redundant per-target history array.
3. **`scoreHistory` is explicitly a cache, not a truth**, as documented in the file's own comments. The external AI must not treat `scoreHistory` as authoritative — any consumer must be able to tolerate it being empty/stale and rebuild from `recoveryAttempts` + `finalVerification` if ever needed. This should be turned into an explicit test (see section U/V) once Stage 2 writes to it.
4. **No `updatedAt`/`revision` field on the artifact itself.** `FreeToolStateEnvelope<T>` (section G) already provides `revision`/`updatedAt` at the storage-envelope level, so duplicating that inside `RepasoArtifact` would be a second source of truth for "is this stale" — deliberately left out, confirmed correct by inspecting `writeFreeToolState`.
5. **`RepasoRecoveryGroup.materialId` is singular**, but a recovery group's `targetIds` could theoretically span two materials in a multi-material Free session (up to 5 materials are supported — see `AGENTS.md`: "Support 1–5 selected materials"). This must be resolved in Stage 2 planning: either (a) forbid a recovery group from spanning materials (safer, simpler grouping rule), or (b) change `materialId: string` to `materialIds: string[]` and give `pages` a `{materialId, page}[]` shape instead of a flat `number[]`. **Recommendation: (a)** — never let a recovery group cross materials; simpler pedagogically too ("reread pages 7–10 of this document" is unambiguous). No code changed for this yet; flagging for the planner.

No other changes were made to fix a compile/test problem — `tsc --noEmit` and the test both already pass as shown in section AA (Certification).

---

## B. Complete Repaso file map

| Path | Role |
|---|---|
| `components/materias/ALAIStudyALRepasar.tsx` | CLIENT UI (entry component, ~2000 lines) |
| `components/materias/RepasarViewer.tsx` | PDF/SOURCE VIEWER |
| `components/materias/RepasarGapGroupSummary.tsx` | CLIENT UI (small presentational subcomponent) |
| `app/api/alai-studyal-repasar/route.ts` | SERVER ROUTE (single `POST` handler, ~1600 lines, dispatches by `body.kind`) |
| `lib/materialBrain/repasarSnapshot.ts` | SNAPSHOT (frozen academic universe + reader per attempt) |
| `lib/materialBrain/repasarEnjoyerContext.ts` | ACADEMIC AUTHORITY (Enjoyer → Repasar target adapter) |
| `lib/materialBrain/reviewContext.ts` | SCORING + EVALUATION (domain map, mastery, gap groups, score-support types) — shared with legacy Material-Brain-based Repasar path too |
| `lib/materialBrain/repasoArtifact.ts` | SHARED TYPE (new, unwired design-only schema) |
| `lib/freeToolState.ts` | PERSISTENCE (generic Free-tool envelope read/write, shared across all Free tools) |
| `lib/studySessions.ts` | PERSISTENCE (underlying `StudySession` document store — `getSessionById`/`updateSessionById`) |
| `lib/materials/repository.ts` | PERSISTENCE (generic `material_results` store — `getMaterialResult`/`saveMaterialResult`, used by `WorkerRepasarSnapshotStore`) |
| `lib/adaptive/sourceSelection.ts` | SHARED TYPE (`SourceSelectionSnapshot`, `buildSourceSelectionSnapshot`) |
| `lib/ai/legacyRouteGeneration.ts` | EVALUATION (generic bounded/validated LLM-JSON call wrapper — `generateValidatedLegacyJson`) |
| `lib/materialBrain/truncationRecovery.ts` | EVALUATION (partial-array salvage for truncated provider JSON — `recoverLLMResponse`) |
| `scripts/tests/repasar-*.ts` (15 files, listed in section U) | TEST |
| `scripts/tests/repaso-*.ts` (2 files) | TEST (new, unwired) |
| `lib/materialBrain/types.ts`, `lib/materialBrain/build.ts`, `lib/materialBrain/identity.ts` | LEGACY (Material Brain — the OLD academic authority; Repasar's `freezeRepasarSnapshot`/`buildRepasarGroundedContext` Brain-based path still exists for backward compatibility with pre-Enjoyer attempts, but is dead on the live Free-mode path) |

### Per-file detail

#### `components/materias/ALAIStudyALRepasar.tsx`
- **ROLE:** CLIENT UI — the entire Repasar screen: phase machine (`preview → lectura → explicar → analisis`), reader picker, explanation textarea, result rendering, teach-check loop, attempt history.
- **IMPORTANT EXPORTS:** `default function ALAIStudyALRepasar(props: Props)`.
- **IMPORTANT IMPORTS:** `buildSourceSelectionFromMaterials`, `useAuthorizedSource`, `sourceScopedKey` (from `lib/materials/authorizedSource`), `readFreeToolState`/`writeFreeToolState`, `RepasarGapGroupSummary`, `RepasarViewer` (dynamic import, `ssr: false`), `useMasteryReporter` (from `hooks/useMastery`).
- **WHO CALLS IT:** `app/materias/page.tsx` (renders it when `activeTool === 'repasar'`, per `VISTA_TOOL` mapping).
- **WHAT IT CALLS:** `fetch('/api/alai-studyal-repasar', ...)` for both evaluate and teach-check; `readFreeToolState`/`writeFreeToolState` for persistence; `onMasteryEvent` prop callback.
- **WHAT STATE IT OWNS:** everything in `PersistedRepasarState` plus ephemeral UI state (see section D).
- **WHAT MUST BE PRESERVED:** the phase machine's monotonic `furthestPhase` tracking (feeds Free-mode-wide progress %, see `lib/freeToolState.ts`'s `isToolEnvelopeMeaningfullyUsed`); the `sourceScopedKey`/`useAuthorizedSource` gating (never fetch/generate before source is authorized); the single-flight guards on `checkTeachMissing` (`checkingTeach`, `verificationAttemptRef`, `verificationControllerRef`).
- **WHAT NEW REPASO WILL CHANGE:** almost the entire render tree from `phase === 'analisis'` onward; the reader picker UI; the `Attempt`/`AnalysisResult` types feeding it (extended, not replaced, for backward compat).
- **WHAT MUST NOT BE TOUCHED:** the `phase === 'preview' | 'lectura'` reading UI and `RepasarViewer` integration (unrelated to this redesign, reused as-is for "releer material").

#### `app/api/alai-studyal-repasar/route.ts`
- **ROLE:** SERVER ROUTE — single `POST` exported function, `kind` field in body discriminates `'teach-check'` vs. default (evaluate).
- **IMPORTANT EXPORTS:** `POST`, `__routeDeps` (test-injectable dependency object), `REPASAR_TARGET_BATCH_SIZE`, `REPASAR_MAX_ADJUDICATION_ROUNDS`, `computeRepasoLetterGrade`, `REPASO_LETTER_GRADE_SCALE`.
- **IMPORTANT IMPORTS:** `buildRepasarGroundedContext`/`buildRepasarReviewTargets` (legacy Brain path), `buildRepasarEnjoyerGroundedContext` (live Enjoyer path), `computeRepasarDomainMap`/`computeRepasarMastery`/`computeRepasarCoverage`/`buildRepasarGapGroups`/`sortRepasarGapsByPriority`/`chunkRepasarTargets`/`renderRepasarGroundedContextForPrompt` (all from `reviewContext.ts`), `WorkerRepasarSnapshotStore`/`resolveRepasarEnjoyerSnapshot`/`freezeRepasarEnjoyerSnapshot`/`snapshotGroundedContext`/`resolveRepasarSnapshot` (from `repasarSnapshot.ts`), `generateValidatedLegacyJson` (from `lib/ai/legacyRouteGeneration.ts`), auth/session/material helpers.
- **WHO CALLS IT:** `ALAIStudyALRepasar.tsx`'s `evaluate()` and `checkTeachMissing()` functions via `fetch`.
- **WHAT IT CALLS:** `__routeDeps.lookupEnjoyer` (→ ultimately `lookupStudyalMaterialEnjoyer`), `__routeDeps.resolveRepasarSnapshot` (aliased to `resolveRepasarEnjoyerSnapshot`), `evaluateRepasarCoverageBatch` → `generateValidatedLegacyJson` → `alai()` (real provider call, mocked in tests via `__routeDeps.generateValidatedLegacyJson`).
- **WHAT STATE IT OWNS:** nothing persistent by itself for the "evaluate" response (the client persists it); the frozen snapshot IS persisted server-side via `__routeDeps.createRepasarSnapshotStore()`.
- **WHAT MUST BE PRESERVED:** the full-universe adjudication loop (`resolveRepasarCoverage`), the reader-freeze contract, the evidence/missingDetail canonical-source contract, the `SOURCE_SELECTION_MISMATCH`/`ENJOYER_NOT_READY` fail-closed error codes.
- **WHAT NEW REPASO WILL CHANGE:** needs a **new** `kind` branch (e.g. `'repaso-recovery-answer'`, `'repaso-final-verification'`) — additive, not a rewrite of the existing `'teach-check'`/default branches.
- **WHAT MUST NOT BE TOUCHED:** `resolveRepasarCoverage`, `reconcileCoverageEvidenceInvariant`, `evaluateRepasarCoverageBatch`'s prompt/schema, `computeRepasarDomainMap`/`computeRepasarMastery`/`calibrateRepasarScore` (per the task's explicit "DO NOT THROW AWAY THE SEMANTIC EVALUATION WORK" instruction).

#### `lib/materialBrain/repasarSnapshot.ts`
- **ROLE:** SNAPSHOT.
- **IMPORTANT EXPORTS:** `REPASAR_SNAPSHOT_SCHEMA_VERSION` (`'2.0.0'`), `RepasarReader` type, `RepasarFrozenSnapshot` interface, `RepasarSnapshotStore` interface, `WorkerRepasarSnapshotStore` class, `freezeRepasarSnapshot` (legacy Brain-based), `freezeRepasarEnjoyerSnapshot` (live), `snapshotGroundedContext`, `resolveRepasarEnjoyerSnapshot`, `resolveRepasarSnapshot` (legacy Brain-based).
- **IMPORTANT IMPORTS:** `randomUUID` (node:crypto), `getMaterialResult`/`saveMaterialResult` (`lib/materials/repository.ts`), `buildRepasarGroundedContext` and types from `reviewContext.ts`.
- **WHO CALLS IT:** `app/api/alai-studyal-repasar/route.ts` (via `__routeDeps.resolveRepasarSnapshot`/`__routeDeps.createRepasarSnapshotStore`), test files directly.
- **WHAT STATE IT OWNS:** the frozen target/relation/reader universe for one attempt, keyed by `snapshotId` in the generic material-results store.
- **WHAT MUST BE PRESERVED:** the "freeze once at new_attempt, restore-only at continue_attempt" contract; `reader` field semantics.
- **WHAT NEW REPASO WILL CHANGE:** nothing directly — `RepasoArtifact.initial.snapshotId` simply references this unchanged mechanism.

#### `lib/materialBrain/repasarEnjoyerContext.ts`
- **ROLE:** ACADEMIC AUTHORITY adapter.
- **IMPORTANT EXPORTS:** `REPASAR_ENJOYER_AUTHORITY` (`'studyal_material_enjoyer'`), `REPASAR_ENJOYER_ADAPTER_VERSION` (`'1.0.0'`), `buildRepasarEnjoyerGroundedContext(payload, selection): RepasarGroundedContext`.
- **WHAT MUST BE PRESERVED:** the exact-quote evidence-dedup merge logic (see section E excerpt); `SOURCE_SELECTION_MISMATCH` throw on fingerprint/page mismatch.
- **WHAT NEW REPASO WILL CHANGE:** nothing — this is purely upstream of everything Repaso-redesign touches.

#### `lib/materialBrain/reviewContext.ts`
- **ROLE:** SCORING + EVALUATION (shared types/functions for both legacy Brain-based and live Enjoyer-based Repasar).
- **IMPORTANT EXPORTS:** `RepasarReviewTarget`, `RepasarRelationContext`, `RepasarGroundedContext`, `RepasarTargetStatus`, `RepasarDomainMap`, `IMPORTANCE_WEIGHT`, `computeRepasarDomainMap`, `RepasarMastery`, `computeRepasarMastery`, `RepasarGapGroup`, `buildRepasarGapGroups`, `sortRepasarGapsByPriority`, `selectRepasarNextPriorityTargetId`, `chunkRepasarTargets`, `renderRepasarGroundedContextForPrompt`, `buildRepasarReviewTargets` (legacy Brain path), `buildRepasarGroundedContext` (legacy Brain path), `computeRepasarCoverage`.
- **WHAT MUST BE PRESERVED:** all of it, per explicit instruction — this is the "semantic evaluation work" that must not be thrown away.
- **WHAT NEW REPASO WILL CHANGE:** nothing in this file's logic; new code will call into it with **narrower** target subsets (recovery groups) instead of the full `reviewTargets` array.

#### `lib/freeToolState.ts`
- **ROLE:** PERSISTENCE (generic).
- **IMPORTANT EXPORTS:** `DurableFreeTool` type (includes `'repasar'`), `FREE_PROCESS_TOOL_CAPS`, `readFreeToolState<T>(sessionId, fingerprint, tool)`, `writeFreeToolState<T>(sessionId, fingerprint, tool, state)`, `computeFreeProcessProgress`.
- **WHAT MUST BE PRESERVED:** the `(sessionId, sourceSelectionFingerprint)` ownership scoping (`validOwner`); the `version: 1` envelope tag (a version bump here is a SEPARATE concern from `RepasoArtifact`'s own `schemaVersion`).
- **WHAT NEW REPASO WILL CHANGE:** nothing in this file — `RepasoArtifact` will be persisted through the *existing* `readFreeToolState`/`writeFreeToolState<PersistedRepasarState>` calls, just with a new field inside `PersistedRepasarState`.

---

## C. Current call graph (real names)

### 1. Initial Repaso generation/evaluation
```
ALAIStudyALRepasar (component)
  → evaluate()                                          [client handler, ~line 533 region]
  → fetch('/api/alai-studyal-repasar', { method: 'POST', body: { sessionId, materia, tema, mode, notes, explanation, previousWeakConcepts, sourceConceptMap, masteryContext } })
  → route.ts: POST(request)
      → getServerSession()
      → getAuthoritativeFreeSession(sessionId, userId)   [restores sourceSelection]
      → normalizeReader(body.mode)
      → resolveRepasarEnjoyerAuthority(sessionId, userId) → __routeDeps.lookupEnjoyer(fingerprint) → lookupStudyalMaterialEnjoyer(...)
      → buildRepasarEnjoyerGroundedContext(payload, selection)
      → __routeDeps.resolveRepasarSnapshot({ groundedContext, store, intent: 'new_attempt', requestedReader })
          → freezeRepasarEnjoyerSnapshot(groundedContext, { reader })
          → store.set(snapshot)   [WorkerRepasarSnapshotStore.set → saveMaterialResult]
      → resolveRepasarCoverage(reviewTargets, groundedContext, explanation)
          → chunkRepasarTargets(pending, REPASAR_TARGET_BATCH_SIZE)
          → evaluateRepasarCoverageBatch(batch, groundedContext, explanation)  [PARALLEL per batch]
              → generateValidatedLegacyJson({ taskType: 'summary', ... })  [REAL PROVIDER CALL]
          → reconcileCoverageEvidenceInvariant(entry)   [per returned verdict]
          → loop until pending.length === 0 or REPASAR_MAX_ADJUDICATION_ROUNDS exhausted
      → computeRepasarDomainMap(reviewTargets, validTargetCoverage)
      → generateValidatedLegacyJson({ taskType: 'summary', ... })  [REAL PROVIDER CALL — persona/feedback pass]
      → reconcileConceptStatus(parsed.conceptStatus, sourceConceptMap)
      → computeRepasarMastery(domainMap, qualityFrac)
      → calibrateRepasarScore({ explanation, mastery })
      → computeRepasoLetterGrade(score)
      → buildRepasarGapGroups / sortRepasarGapsByPriority / buildRepasarDisplayPriorities
      → NextResponse.json({ snapshotId, enrichmentRevision, review, analysis: {...} })
  → client: const data = await res.json()
  → setAnalysis(data.analysis); setAttempts(prev => [...prev, newAttempt])
  → writeFreeToolState<PersistedRepasarState>(sessionId, fingerprint, 'repasar', { phase, furthestPhase, notes, explanation, mode, analysis, attempts, followUpAnswer, teachCheck, activeRepasarColor })
```

### 2. Teach-check
```
ALAIStudyALRepasar
  → checkTeachMissing()
  → fetch('/api/alai-studyal-repasar', { method: 'POST', body: { kind: 'teach-check', sessionId, mode, snapshotId, repair, lesson, answer } })
  → route.ts: POST(request)
      → isTeachCheck = true
      → __routeDeps.resolveRepasarSnapshot({ intent: 'continue_attempt', requestedSnapshotId: body.snapshotId })
          → store.get(snapshotId)  [restore-only, no re-freeze]
      → verifiedTargetIds = body.repair.repairTargetIds.filter(id => knownTargetIds.has(id))   [server-side revalidation, never trusts client identity]
      → generateValidatedLegacyJson({ taskType: 'evaluation_question', ... })  [REAL PROVIDER CALL — fact-by-fact or free verdict]
      → NextResponse.json({ snapshotId, enrichmentRevision, check: { passed, message, understood, stillMissing, improvedAnswer, targetIds, confirmedTargetIds } })
  → client: setTeachCheck(data.check)
  → writeFreeToolState(...)  [persists attempt.teachCheck]
```

### 3. Reopen/restore
```
ALAIStudyALRepasar mount
  → useEffect([storageKey, sessionId, fingerprint])
      → readFreeToolState<PersistedRepasarState>(sessionId, fingerprint, 'repasar')
      → if found: setPhase/setFurthestPhase/setNotes/setExplanation/setMode/setAnalysis/setAttempts/setFollowUpAnswer/setTeachCheck/setActiveRepasarColor from saved.state
  → 0 provider calls (pure read)
```

### 4. Retry (teach-check retry)
```
ALAIStudyALRepasar
  → checkTeachMissing()  [guarded by `if (checkingTeach) return`]
  → verificationAttemptRef.current++ ; verificationControllerRef.current?.abort() ; new AbortController()
  → same fetch as (2), new AbortController.signal
  → on resolve: only applied if attempt identity still current (stale-response guard, same pattern as ALAI Chat)
```

### 5. Material/PDF reread action
```
ALAIStudyALRepasar
  → phase === 'lectura' branch renders <RepasarViewer materiales seleccion phase themeColor activeColor />
  → RepasarViewer owns its OWN internal currentPageIndex state (derived from the material's selectedPages, defaulting to the first page)
  → NO external prop currently exists to jump to an arbitrary page from outside the viewer.
```

---

## D. Client component decomposition (`ALAIStudyALRepasar.tsx`)

### 1. Important imports (verbatim, top of file)
```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { buildSourceSelectionFromMaterials, type SourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection';
import { useAuthorizedSource } from '../../lib/materials/useAuthorizedSource';
import { sourceScopedKey } from '../../lib/materials/authorizedSource';
import { readFreeToolState, writeFreeToolState } from '../../lib/freeToolState';
import RepasarGapGroupSummary from './RepasarGapGroupSummary';

const HAND = "var(--font-hand)";
const BODY = "var(--font-body)";

const RepasarViewer = dynamic(() => import('./RepasarViewer'), { ssr: false });
```
Additionally, near the bottom of the type/function region: `import { useMasteryReporter } from '../../hooks/useMastery';` (placed just before the default export, an established but unusual pattern in this file).

### 2. Local TypeScript types/interfaces
`Phase` (`'preview'|'lectura'|'explicar'|'analisis'`), `ExplainMode` (`'nino'|'universitario'|'profesor'|'libre'`), `Props`, `ReviewerResult`, `AnalysisResult` (full excerpt in section E), `Attempt`, `PersistedRepasarState`, plus module-level constant `PHASE_RANK`.

### 3. React state variables (from constructor region, `useState` calls)
`phase`, `furthestPhase`, `notes`, `explanation`, `mode` (`ExplainMode`, default `'nino'`), `loading`, `analysis` (`AnalysisResult | null`), `attempts` (`Attempt[]`), `followUpAnswer`, `checkingTeach`, plus several more further down not captured in this pass (e.g. `gapsExpanded` used by the "Para dominar el 100%" collapse toggle, `error`, `teachCheck`, `activeRepasarColor`) — all mirrored 1:1 in `PersistedRepasarState`.

### 4. Refs
`verificationAttemptRef` (number, monotonic attempt identity for teach-check), `verificationControllerRef` (`AbortController`, cancels in-flight teach-check on a new one).

### 5. Important useEffects
- Continuity-restore effect, dependency array `[storageKey, sessionId, effectiveSourceSelection.fingerprint]` — reads `readFreeToolState` and hydrates all state. **Known latent risk** (documented in an earlier session turn, never fixed): if this effect re-fires *after* the user has picked a fresh reader mode, it could `setMode(saved.mode)` and silently revert the user's selection. This concern becomes **moot once the reader picker is removed** (item K).

### 6. Persistence/hydration logic
The continuity-restore effect (5) is hydration; every state-setting handler (evaluate, checkTeachMissing, resetSession, pill clicks) is followed by a `writeFreeToolState<PersistedRepasarState>(sessionId, fingerprint, 'repasar', { ...all state fields... })` call (exact call sites not individually enumerated here — there are several, one per meaningful state-mutating action, all writing the *entire* `PersistedRepasarState` object each time since `writeFreeToolState` replaces the whole `state` value).

### 7. Generation handlers
`evaluate()` — async function, not memoized, closes over current `mode`/`explanation`/etc., builds the fetch body shown in section C.1, sets `loading`, calls `setAnalysis`/`setAttempts` on success.

### 8. Retry handlers
`retryCurrentTurn`-equivalent does not exist as a separate function for Repasar's *initial* evaluate call (the user can just click evaluate again — there is no single-flight guard on `evaluate()` itself, only on `checkTeachMissing()`). **This is worth flagging**: unlike ALAI Chat/Truquitos/Study Map (all audited and fixed for double-submit bugs earlier this session), `evaluate()` was never audited for a duplicate-generation guard. **Recommendation for Stage 2 planning**: add the same `inFlightGenerationKeyRef`-style guard when building the new initial-submit handler, since it is being rewritten anyway.

### 9. Teach-check handlers
`checkTeachMissing()` — full body given in section E.

### 10. PDF/material handlers
None directly in this file beyond passing props to `<RepasarViewer>` — see section J.

### 11. Rendering phases/branches
`phase === 'preview' || phase === 'lectura'` → two-column layout with `<RepasarViewer>` + right-rail content. `phase === 'explicar'` → explanation textarea + reader picker + submit. `phase === 'analisis'` → the entire result UI (reader banner, "Mapa de dominio", "Para dominar el 100%", "Ya entendiste"/"Corrige primero" two-column, teach-check section, history).

### 12. Reader-selection UI
Pill buttons, `[['nino','Niño'],['universitario','Universitario'],['profesor','Profesor'],['libre','Evaluador neutral']]`, each `onClick={() => setMode(id as ExplainMode)}` (~line 1124 region, inside the `explicar` phase).

### 13. Initial explanation UI
Textarea bound to `explanation` state, inside `phase === 'explicar'`, with the reader picker directly above it and a submit button calling `evaluate()`.

### 14. Feedback/result UI
The `phase === 'analisis'` block — reader banner (`Lector: {...}`), score/level, `studyBreakdown`, then the sectioned dashboard described in the product brief as "analytics dashboard vomit."

### 15. Domain-map UI
The "Mapa de dominio" IIFE block (~line 1368+ pre-redesign), building `groups` from `conceptStatus`, rendering per-item cards with `conceptBadge`.

### 16. Current "Corrige primero"
Conditional block gated by `currentHasUnresolvedConcept`, showing `analysis.domainMap.nextPriorityTarget.label` and `analysis.actions`.

### 17. Current teach-check input
`<div id="teach-check-section">` — textarea bound to `followUpAnswer`, Enter-to-submit and button-to-submit both guarded by `!checkingTeach` before calling `checkTeachMissing()`.

### 18. History UI
`attempts` array rendered as a list; clicking a past attempt calls `setMode(attempt.mode)` among other setters (this is the exact site referenced in section K as a reader-compat concern).

### 19. KEEP / CHANGE / REMOVE / REPLACE verdicts

| Item | Verdict | Why |
|---|---|---|
| `phase` state machine (`preview/lectura/explicar/analisis`) | **CHANGE** | Needs new phases for recovery/final-verification/mastery (see section L) — likely superset, not a full replacement. |
| `furthestPhase` monotonic tracking | **KEEP** | Feeds Free-mode-wide progress %; unrelated to redesign. |
| `notes` | **KEEP** | Unrelated free-text notes feature. |
| `explanation` | **KEEP (frozen after submit)** | Becomes `RepasoInitialAttempt.explanation` once submitted — must stop being mutable after that point. |
| `mode` / `ExplainMode` | **REMOVE (client-facing)**, **KEEP (server compat)** | Reader picker UI removed; server must still accept/normalize legacy values for old attempts. |
| `analysis` (`AnalysisResult`) | **REPLACE** | Superseded by rendering directly from `RepasoArtifact`, but the type itself should be kept for legacy-attempt read-only rendering. |
| `attempts: Attempt[]` | **REPLACE (new sessions)**, **KEEP (legacy read)** | New sessions get one `RepasoArtifact` instead of an array of independent full-re-explanation attempts. |
| `followUpAnswer` | **REPLACE** | Becomes the per-recovery-step answer input state, scoped to the active recovery group instead of a single global field. |
| `checkingTeach` / `verificationAttemptRef` / `verificationControllerRef` | **KEEP (pattern)**, **REPLACE (target)** | The exact single-flight/AbortController/stale-response-guard pattern must be reused for the new recovery-answer submit handler — do not re-invent it, copy it. |
| `RepasarViewer` integration | **KEEP**, **EXTEND** | Needs a new optional page-jump prop (see section J) — the component and its drawing/annotation features are untouched. |
| Reader picker UI | **REMOVE** | Per product brief item 1. |
| "Mapa de dominio" / "Para dominar el 100%" / "Ya entendiste" / "Corrige primero" / teach-check sections | **REPLACE** | Entire information architecture redesign per product brief items 3–7. |

---

## E. Critical code excerpts

### `RepasarFrozenSnapshot` (full interface, `lib/materialBrain/repasarSnapshot.ts`)
```ts
export type RepasarReader = 'nino' | 'universitario' | 'profesor' | 'libre'

export interface RepasarFrozenSnapshot {
  schemaVersion: string
  snapshotId: string
  fingerprint: string
  builderVersion: string
  authorityType?: 'studyal_material_enjoyer' | 'material_brain'
  enrichmentRevision: number | null
  createdAt: string
  targets: RepasarReviewTarget[]
  relations: RepasarRelationContext[]
  topics?: { id: string; title: string; order: number }[]
  reader?: RepasarReader
}
```

### `PersistedRepasarState` and `Attempt` (full, `ALAIStudyALRepasar.tsx`)
```tsx
interface Attempt {
  id: string;
  createdAt: number;
  mode: ExplainMode;
  explanation: string;
  analysis: AnalysisResult;
  teachCheck?: any | null;
}

interface PersistedRepasarState {
  phase: Phase;
  furthestPhase: Phase;
  notes: string;
  explanation: string;
  mode: ExplainMode;
  analysis: AnalysisResult | null;
  attempts: Attempt[];
  followUpAnswer: string;
  teachCheck: unknown | null;
  activeRepasarColor: string;
}
```

### `AnalysisResult` (full interface — this is the "current result response type")
```tsx
interface ReviewerResult {
  persona: string;
  rating: number;
  verdict: string;
  feedback: string;
  wouldUnderstand: boolean;
  missingForThem?: string[];
}

interface AnalysisResult {
  snapshotId?: string;
  score: number;
  level: string;
  metrics?: { coverage: number; clarity: number; depth: number; connections: number; };
  masteryStage?: string;
  summary?: string;
  mainIssue?: string;
  scoreReason?: string;
  estimatedNextScore?: number;
  studyBreakdown?: { remembered: number; explained: number; missing: number; };
  reviewer?: ReviewerResult | null;
  domainMap?: {
    totalAcademicTargets: number;
    demonstratedCorrect: number;
    demonstratedPartial: number;
    demonstratedIncorrect: number;
    omitted: number;
    coveragePercent: number;
    gaps: { id: string; label: string; importanceTier: string; status: string }[];
    strengths: { id: string; label: string; importanceTier: string }[];
    pendingAcademicTargets: number;
    gapGroups: {
      key: string; label: string; importanceTier: 'critical' | 'supporting' | 'contextual';
      targetIds: string[];
      items: { id: string; label: string; importanceTier: string; status: string; evidence?: string; missingDetail?: string }[];
    }[];
    gapRemainderCount: number;
    gapRemainder: { id: string; label: string; importanceTier: string; status: string; evidence?: string; missingDetail?: string }[];
    gapRemainderOverflow: number;
    nextPriorityTargetId: string | null;
    nextPriorityTarget: { id: string; label: string; importanceTier: string; status: string } | null;
  };
  conceptStatus?: {
    concept: string;
    status: 'mastered' | 'progress' | 'weak';
    importance?: 'critical' | 'supporting' | 'contextual';
    note?: string;
    said?: string;
    missing?: string;
  }[];
  strengths: string[];
  missingConcepts: string[];
  confusions: string[];
  weakConcepts?: string[];
  actions?: { title: string; detail?: string; }[];
  teachMissing?: { title: string; explanation: string; example?: string; analogy?: string; } | null;
  repair?: {
    question: string;
    topicLabel: string;
    targetConcepts: string[];
    requiredFacts: string[];
    optionalFacts: string[];
    repairTargetIds?: string[];
  } | null;
  feedback: string;
  nextStep: string;
}
```
**NOTE:** the live route also now returns `letterGrade: string` (added last turn, additive) — not yet reflected in this client-side type. Adding `letterGrade?: string;` to `AnalysisResult` is a Stage 2 task.

### Current Repaso fetch request (initial evaluate — reconstructed from route body reads)
```ts
{
  sessionId: string,
  materia?: string,
  tema?: string,
  mode: ExplainMode,          // will be removed from the CLIENT payload in the redesign; server keeps normalizeReader() for legacy safety
  notes?: string,
  explanation: string,
  previousWeakConcepts?: string[],
  sourceConceptMap?: unknown,
  masteryContext?: unknown,
}
```

### Current Repaso fetch request (teach-check)
```ts
{
  kind: 'teach-check',
  sessionId: string,
  mode: ExplainMode,
  snapshotId: string,
  repair: AnalysisResult['repair'],
  lesson: string,
  answer: string,
}
```

### Current hydration/reopen code (continuity-restore effect, paraphrased from confirmed grep hits — exact effect body not re-quoted here to avoid an unverified transcription, but the dependency array and setter list are confirmed real: `[storageKey, sessionId, effectiveSourceSelection.fingerprint]`, calling `setPhase/setFurthestPhase/setNotes/setExplanation/setMode/setAnalysis/setAttempts/setFollowUpAnswer/setTeachCheck/setActiveRepasarColor` from `readFreeToolState(...)`.)

### Current persistence call shape
```ts
writeFreeToolState<PersistedRepasarState>(sessionId, fingerprint, 'repasar', {
  phase, furthestPhase, notes, explanation, mode, analysis, attempts,
  followUpAnswer, teachCheck, activeRepasarColor,
});
```

### `checkTeachMissing()` (client handler, full body as read)
```tsx
const checkTeachMissing = async () => {
  if (!analysis?.repair?.question) {
    setError('No hay concepto para verificar.');
    return;
  }
  if (!followUpAnswer.trim()) {
    setError('Explícalo con tus palabras antes de verificar.');
    return;
  }
  if (!sessionId) {
    setError('No hay sesión activa para verificar.');
    return;
  }
  if (checkingTeach) return;
  const attempt = verificationAttemptRef.current + 1;
  verificationAttemptRef.current = attempt;
  verificationControllerRef.current?.abort();
  const controller = new AbortController();
  verificationControllerRef.current = controller;
  setCheckingTeach(true);
  setError('');

  try {
    const lesson = analysis.teachMissing ? [
      analysis.teachMissing.explanation,
      analysis.teachMissing.example ? `Ejemplo: ${analysis.teachMissing.example}` : '',
      analysis.teachMissing.analogy ? `Analogía: ${analysis.teachMissing.analogy}` : '',
    ].filter(Boolean).join('\n\n') : '';

    const res = await fetch('/api/alai-studyal-repasar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'teach-check',
        sessionId,
        mode,
        snapshotId: analysis.snapshotId,
        repair: analysis.repair,
        lesson,
        answer: followUpAnswer,
      }),
      signal: controller.signal,
    });

    const data = await res.json();
    if (!res.ok) {
      if (data?.error === 'LEGACY_SNAPSHOT_INCOMPATIBLE') {
        throw new Error('Este intento anterior puede consultarse, pero su verificación pertenece a una autoridad académica antigua. Inicia un nuevo intento para continuar.');
      }
      // [...error branches omitted...]
    }
    // [...success branch: setTeachCheck / persistence omitted, not re-read verbatim this pass...]
  } catch (err) {
    // [...]
  } finally {
    if (verificationAttemptRef.current === attempt) setCheckingTeach(false);
  }
};
```

### Route POST dispatcher shape (structure, not full body — ~1600 lines total)
```ts
export const __routeDeps = { getServerSession, getAuthoritativeFreeSession, getMaterial, lookupEnjoyer: lookupStudyalMaterialEnjoyer, createRepasarSnapshotStore: () => new WorkerRepasarSnapshotStore(), resolveRepasarSnapshot: resolveRepasarEnjoyerSnapshot, generateValidatedLegacyJson };

export async function POST(request: NextRequest) {
  const body = await request.json();
  // [RAW_SOURCE_AUTHORITY_KEYS rejection check]
  const sessionId = ...;
  const session = await __routeDeps.getAuthoritativeFreeSession(sessionId, userId);
  const enjoyerLookup = await resolveRepasarEnjoyerAuthority(sessionId, userId);   // 409 ENJOYER_NOT_READY / SOURCE_SELECTION_MISMATCH on failure
  const isTeachCheck = body?.kind === 'teach-check';
  const snapshotResolution = await __routeDeps.resolveRepasarSnapshot({ groundedContext, store, intent: isTeachCheck ? 'continue_attempt' : 'new_attempt', requestedSnapshotId: ..., requestedReader: ... });
  const frozenSnapshot = snapshotResolution.snapshot;
  const groundedContext = snapshotGroundedContext(frozenSnapshot);
  const frozenReader: RepasarReader = frozenSnapshot.reader || 'libre';

  if (isTeachCheck) {
    // [teach-check branch — see section F]
    return NextResponse.json({ snapshotId, enrichmentRevision, check: {...} });
  }

  // [default = evaluate branch — see section C.1]
  return NextResponse.json({ snapshotId, enrichmentRevision, review, analysis: {...} });
}
```

### `resolveRepasarCoverage` (full function, `route.ts`)
```ts
async function resolveRepasarCoverage(
  targets: readonly RepasarReviewTarget[],
  groundedContext: RepasarGroundedContext,
  explanation: string,
): Promise<RepasoCoverageResolution> {
  const orderedIds = targets.map(target => target.id);
  const knownTargetIds = new Set(orderedIds);
  const adjudicated = new Map<string, ReconciledRepasarCoverageEntry>();
  let pending: readonly RepasarReviewTarget[] = targets;

  for (let round = 0; round < REPASAR_MAX_ADJUDICATION_ROUNDS && pending.length > 0; round++) {
    const requestedThisRound = new Set(pending.map(target => target.id));
    const batches = chunkRepasarTargets(pending as RepasarReviewTarget[], REPASAR_TARGET_BATCH_SIZE);
    const results = await Promise.all(
      batches.map(batch => evaluateRepasarCoverageBatch(batch, groundedContext, explanation)),
    );
    for (const raw of results.flat()) {
      const targetId = String(raw?.targetId || '').trim();
      if (!knownTargetIds.has(targetId)) continue;
      if (!requestedThisRound.has(targetId)) continue;
      if (adjudicated.has(targetId)) continue;
      const status: RepasarCoverageStatus = VALID_COVERAGE_STATUSES.has(raw?.status) ? raw.status : 'missing';
      adjudicated.set(targetId, reconcileCoverageEvidenceInvariant({
        targetId, status, evidence: raw?.evidence, demonstrated: raw?.demonstrated, missingDetail: raw?.missingDetail,
      }));
    }
    pending = pending.filter(target => !adjudicated.has(target.id));
  }

  const verdicts = orderedIds.filter(id => adjudicated.has(id)).map(id => adjudicated.get(id)!);
  if (pending.length > 0) {
    return { ok: false, verdicts, unadjudicatedTargetIds: pending.map(target => target.id) };
  }
  return { ok: true, verdicts };
}
```
**This exact function is what a bounded recovery-answer adjudication call should reuse — call it with `targets = the recovery group's real RepasarReviewTarget objects` (looked up from the frozen snapshot by id) and `explanation = the recovery answer text`, not the full 51-target universe.**

### `reconcileCoverageEvidenceInvariant` (full function, `route.ts`)
```ts
const MIN_MEANINGFUL_EVIDENCE_CHARS = 6;
function reconcileCoverageEvidenceInvariant(entry: RawRepasarCoverageEntry): ReconciledRepasarCoverageEntry {
  const evidence = String(entry.evidence || '').trim();
  const demonstrated = String(entry.demonstrated || '').trim();
  const missingDetail = String(entry.missingDetail || '').trim();
  const hasRealEvidence = evidence.length >= MIN_MEANINGFUL_EVIDENCE_CHARS
    || demonstrated.length >= MIN_MEANINGFUL_EVIDENCE_CHARS;

  let status = entry.status;
  if (status === 'missing' && hasRealEvidence) {
    status = missingDetail ? 'partial' : 'covered';
  } else if (status === 'partial' && !hasRealEvidence) {
    status = 'missing';
  } else if (status === 'partial' && !missingDetail) {
    status = 'covered';
  }

  return {
    targetId: entry.targetId,
    status,
    evidence: status === 'missing' ? '' : evidence,
    demonstrated: status === 'missing' ? '' : demonstrated,
    missingDetail: (status === 'covered' || status === 'missing') ? '' : missingDetail,
  };
}
```

### `computeRepasoLetterGrade` (full, `route.ts`)
```ts
export const REPASO_LETTER_GRADE_SCALE: { min: number; letter: string }[] = [
  { min: 97, letter: 'A+' }, { min: 93, letter: 'A' }, { min: 90, letter: 'A-' },
  { min: 87, letter: 'B+' }, { min: 83, letter: 'B' }, { min: 80, letter: 'B-' },
  { min: 77, letter: 'C+' }, { min: 73, letter: 'C' }, { min: 70, letter: 'C-' },
  { min: 60, letter: 'D' }, { min: 0, letter: 'F' },
];

export function computeRepasoLetterGrade(score: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  return REPASO_LETTER_GRADE_SCALE.find(band => clamped >= band.min)?.letter || 'F';
}
```

### `renderRepasarGroundedContextForPrompt` (source/page extraction helper, `reviewContext.ts`)
```ts
export function renderRepasarGroundedContextForPrompt(context: RepasarGroundedContext, maxChars = 60000): string {
  const lines: string[] = []
  for (const target of context.targets) {
    lines.push(`[TARGET ${target.id}] kind=${target.kind} importance=${target.importanceTier}`)
    lines.push(`Etiqueta: ${target.label}`)
    lines.push(`Contenido autorizado: ${target.statement}`)
    if (target.evidenceText) lines.push(`Evidencia (${target.derivation || 'desconocida'}): "${target.evidenceText}"`)
    if (target.materialId) lines.push(`Fuente: material=${target.materialId}${target.page != null ? ` página=${target.page}` : ''}`)
    lines.push('')
  }
  if (context.relations.length) {
    lines.push('RELACIONES AUTORIZADAS:')
    for (const relation of context.relations) {
      lines.push(`- ${relation.fromTargetId} --${relation.type}--> ${relation.toTargetId}: ${relation.statement}`)
    }
  }
  const rendered = lines.join('\n')
  if (rendered.length <= maxChars) return rendered
  return rendered.slice(0, maxChars) + '\n\n[Contexto recortado para el análisis]'
}
```
**Note:** `target.page` is a *single* number (`itemPages[0]`), while `target.pages` (plural, on `RepasarReviewTarget`) is the full page array for that target. Page-range guidance ("páginas 7–10") must be computed as `Math.min(...allPagesAcrossGroupTargets)` to `Math.max(...)`, not read from a single field.

### `RepasarReviewTarget` interface (relevant fields, from `reviewContext.ts`)
```ts
interface RepasarReviewTarget {
  id: string
  unitId: string
  kind: string
  label: string
  statement: string
  importanceTier: 'critical' | 'supporting' | 'contextual'
  difficulty?: string | null
  topicId?: string | null
  topicTitle?: string | null
  sourceOrder?: number
  materialId: string
  page: number | null
  pages?: number[]
  sourceSpans?: { page: number; quote: string }[]
  derivation: string | null
  evidenceText: string
}
```

### `RepasarRelationContext` interface
```ts
interface RepasarRelationContext {
  id: string
  type: string
  statement: string
  fromTargetId: string
  toTargetId: string
}
```
**Important, established finding from earlier this session**: relation `type` strings are **free text, never validated against a semantic vocabulary**. The recovery planner (section M) must use relations only as graph adjacency (connectivity), never assume semantic meaning like `"causes"`/`"contrasts_with"`.

---

## F. Server route structural map

Functions, in file order (line numbers approximate, confirmed via earlier grep in this session; re-verify exact line numbers before editing, they shift as edits land):

1. `stripScoreMentions`, `cleanArray`, `cleanScore`, `cleanReviewer`, `cleanConceptStatus` — small sanitizers (~L60–140).
2. `reconcileConceptStatus(modelConceptStatus, lockedMap)` — canonical-status/evidence override for the top-12 `conceptStatus` projection (~L148–196).
3. `cleanRepair` (~L198+).
4. `REPASAR_TARGET_BATCH_SIZE = 15`, `REPASAR_MAX_ADJUDICATION_ROUNDS = 3` (exported constants, ~L23–41 after the batching redesign).
5. `RepasarCoverageStatus` type, `RawRepasarCoverageEntry` interface (~L340).
6. `evaluateRepasarCoverageBatch(batch, groundedContext, explanation)` — the canonical LLM coverage call (~L349–440s).
7. `reconcileCoverageEvidenceInvariant` (~L456–512, full body in section E).
8. `VALID_COVERAGE_STATUSES`, `RepasoCoverageResolution` interface (naming note: this pre-existing interface is called `RepasarCoverageResolution` in the live code, NOT `RepasoCoverageResolution` — **do not confuse with the new `RepasoArtifact` `Repaso`-prefixed types**; the coverage-loop's own interface predates the product-redesign naming and keeps the `Repasar` spelling).
9. `resolveRepasarCoverage` (full body in section E).
10. `buildRepasarDisplayPriorities`, `TIER_RANK` (~L494+).
11. `levelFromScore`, `masteryStage`, `REPASO_LETTER_GRADE_SCALE`, `computeRepasoLetterGrade` (~L630–655).
12. `calibrateRepasarScore` (~L291–322 in an earlier read; position may have shifted after edits — reconfirm before touching).
13. `POST(request: NextRequest)` — the single exported handler, containing both the `isTeachCheck` branch and the default evaluate branch inline (not split into separate functions).

### Where new v2 actions should hook in (minimal risk)

- Add a new `body.kind` value, e.g. `'repaso-recovery-answer'` and `'repaso-final-verification'`, checked with the **same pattern** as `const isTeachCheck = body?.kind === 'teach-check';` — i.e. `const isRecoveryAnswer = body?.kind === 'repaso-recovery-answer';` right next to it, BEFORE the existing `if (isTeachCheck) { ... }` block, so the existing evaluate/teach-check code paths are never touched, only guarded by an additional `if` that returns early.
- The recovery-answer branch should call `resolveRepasarCoverage` (unchanged) with a **filtered target array**: `groundedContext.targets.filter(t => recoveryGroup.targetIds.includes(t.id))`, and `explanation = body.answer`. This reuses 100% of the existing batching/retry/reconciliation logic with zero modification.
- The frozen-snapshot restoration (`resolveRepasarEnjoyerSnapshot` with `intent: 'continue_attempt'`) is already exactly what's needed to restore the target universe for a recovery step — reuse verbatim.

---

## G. Persistence — exact reality

### `readFreeToolState<T>` / `writeFreeToolState<T>` (full signatures, `lib/freeToolState.ts`)
```ts
export function readFreeToolState<T>(
  sessionId: string | null | undefined,
  fingerprint: string,
  tool: DurableFreeTool,
): FreeToolStateEnvelope<T> | null

export function writeFreeToolState<T>(
  sessionId: string | null | undefined,
  fingerprint: string,
  tool: DurableFreeTool,
  state: T,
): FreeToolStateEnvelope<T> | null
```
Internally: `readFreeToolState` calls `getSessionById(sessionId)`, validates ownership (`session.processMode === 'free' && session.sourceSelectionFingerprint === fingerprint`), and returns `session.notes.freeTools[tool]` if its envelope tag fields match. `writeFreeToolState` calls `updateSessionById(sessionId, session => { ...write session.notes.freeTools[tool]... })`, bumping `revision` and `updatedAt` each write, replacing the *entire* `state` value (not a partial merge).

`FreeToolStateEnvelope<T>` shape (inferred from the write function body):
```ts
interface FreeToolStateEnvelope<T> {
  version: 1;
  tool: DurableFreeTool;
  sessionId: string;
  sourceSelectionFingerprint: string;
  revision: number;
  updatedAt: number;
  state: T;
}
```

### `WorkerRepasarSnapshotStore` (generic material-results store, `repasarSnapshot.ts`)
```ts
class WorkerRepasarSnapshotStore implements RepasarSnapshotStore {
  async get(snapshotId: string): Promise<RepasarFrozenSnapshot | null> {
    const result = await this.getResult(`repasar_snapshot:${snapshotId}`, 'mixto', 'repasar_snapshot');
    // [validate payload shape, snapshotId match]
    return payload as RepasarFrozenSnapshot;
  }
  async set(snapshot: RepasarFrozenSnapshot): Promise<void> {
    await this.saveResult({
      material_id: `repasar_snapshot:${snapshot.snapshotId}`,
      enfoque: 'mixto',
      result_type: 'repasar_snapshot',
      payload: snapshot,
      content_hash: `${snapshot.fingerprint}::${snapshot.enrichmentRevision ?? 'legacy'}::${snapshot.snapshotId}`,
    });
  }
}
```
This uses `getMaterialResult`/`saveMaterialResult` from `lib/materials/repository.ts` — a **generic, opaque-payload, keyed-by-string-id document store**, not scoped to any one session. This is the SAME storage primitive already used for arbitrary large academic artifacts.

### Current Repaso save fields (recap from section E)
`explanation`, `analysis`, `attempts`, `teachCheck`, `sourceSelectionFingerprint` (implicit — it's the *key*, not a stored field, passed as the `fingerprint` argument to read/write), `phase`.

### Recommendation: where should `RepasoArtifact` live?

**Answer: (B) referenced by artifactId, stored via (C)-equivalent — i.e. through the SAME generic mechanism `WorkerRepasarSnapshotStore` already uses (`getMaterialResult`/`saveMaterialResult`), under its own `result_type` (e.g. `'repaso_artifact'`), keyed by `material_id: repaso_artifact:<artifactId>`.**

Reasoning, grounded in what actually exists:
- `PersistedRepasarState` (inside the Free-tool envelope) already exists for lightweight UI-session bookkeeping (`phase`, `notes`, pointers) — it should gain ONE new field, e.g. `repasoArtifactId: string | null`, mirroring exactly how `AnalysisResult.snapshotId` is a *pointer* into the separately-stored `RepasarFrozenSnapshot`, not the snapshot's content inlined.
- The full `RepasoArtifact` (initial adjudication of up to 150+ targets, plus growing recovery-attempt history) is too large and too write-frequent (append on every recovery answer) to keep re-writing the *entire* `PersistedRepasarState` envelope on every recovery step (`writeFreeToolState` replaces the whole `state` value, not a partial patch — appending one recovery attempt would mean re-serializing the full explanation + all prior attempts + everything else every time).
- `getMaterialResult`/`saveMaterialResult` is already the established pattern for exactly this shape of data (opaque, large, keyed by an opaque id, restored by lookup, never queried by content) — this is precisely how `RepasarFrozenSnapshot` itself is stored, so reusing it for `RepasoArtifact` is consistent with existing StudyAL infrastructure, not a new storage mechanism.

### Expected read/write flow (once implemented)
- **Initial submit:** create `RepasoArtifact` (new `artifactId`), `saveMaterialResult` it, then `writeFreeToolState` the *pointer* (`repasoArtifactId`) into `PersistedRepasarState`.
- **Every recovery/verification step:** `getMaterialResult('repaso_artifact:<id>', ...)` to restore, apply the validated transition, `saveMaterialResult` the updated artifact back under the same id (overwrite, not append-as-new-document — `material_results` is presumably keyed by `material_id` with implicit versioning/overwrite semantics, matching how snapshots are `store.set()`).
- **Reopen:** `readFreeToolState` → get `repasoArtifactId` → `getMaterialResult` → render. Zero provider calls, matching the existing snapshot-restore pattern.

---

## H. Current score formula — exact

### `calibrateRepasarScore` (as read this session, `route.ts`)
```ts
function calibrateRepasarScore({ explanation, mastery }: { explanation: string; mastery: RepasarMastery; }) {
  const words = wordCount(explanation);
  if (words < 4) return Math.min(mastery.masteryPercent, 15);
  return cleanScore(Math.round(mastery.masteryPercent));
}
```
The score IS `mastery.masteryPercent`, rounded, with a floor-clamp (max 15) only for a near-empty explanation (<4 words). **This is the entire "calibration" — there is no separate persona-driven multiplier anymore** (an older, removed anti-pattern per the file's own comments).

### `computeRepasarMastery` (interface + formula, `reviewContext.ts`)
```ts
export interface RepasarMastery {
  recallPercent: number;      // importance-weighted breadth of the academic universe successfully recalled — reader-invariant, depends only on domainMap.
  qualityPercent: number;     // 0-100, from the persona/feedback call's own score (0-1 fraction * 100).
  masteryPercent: number;     // composed of recallPercent and qualityPercent — never lets quality push mastery ABOVE recall, only down.
  reinforcementPercent: number; // proportional weighted share of real gaps (partial+incorrect+omitted).
}
export function computeRepasarMastery(domainMap: RepasarDomainMap, qualityFrac: number): RepasarMastery
```
(Exact arithmetic body not re-quoted verbatim here — confirmed present and tested via `repasar-score-semantics-contracts.ts`'s `REP-SCORE-A..E` cases; the important, verified *behavioral* contract is: recallPercent is importance-weighted breadth from `domainMap`, quality can only ever reduce mastery relative to recall, never inflate it above recall, and `reinforcementPercent` is `weighted(partial+incorrect+omitted)/totalWeight`, never `100 - masteryPercent`.)

### `computeRepasarDomainMap` (full formula, `reviewContext.ts`)
```ts
export const IMPORTANCE_WEIGHT: Record<RepasarReviewTarget['importanceTier'], number> = {
  critical: 3, supporting: 2, contextual: 1,
}

export function computeRepasarDomainMap(
  targets: readonly RepasarReviewTarget[],
  verdicts: readonly { targetId: string; status: 'covered' | 'partial' | 'missing' | 'incorrect' }[],
): RepasarDomainMap {
  const verdictById = new Map(verdicts.map(v => [v.targetId, v.status]))
  const statusByTargetId: Record<string, RepasarTargetStatus> = {}
  let correct = 0, partial = 0, incorrect = 0, omitted = 0, criticalGapCount = 0
  let totalWeight = 0, correctWeight = 0, partialWeight = 0, incorrectWeight = 0, omittedWeight = 0
  for (const target of targets) {
    const verdict = verdictById.get(target.id)
    const status: RepasarTargetStatus =
      verdict === 'covered' ? 'demonstrated_correct'
        : verdict === 'partial' ? 'demonstrated_partial'
          : verdict === 'incorrect' ? 'demonstrated_incorrect'
            : 'omitted'
    statusByTargetId[target.id] = status
    const weight = IMPORTANCE_WEIGHT[target.importanceTier] ?? IMPORTANCE_WEIGHT.supporting
    totalWeight += weight
    if (status === 'demonstrated_correct') { correct++; correctWeight += weight }
    else if (status === 'demonstrated_partial') { partial++; partialWeight += weight }
    else if (status === 'demonstrated_incorrect') { incorrect++; incorrectWeight += weight }
    else { omitted++; omittedWeight += weight }
    if (status !== 'demonstrated_correct' && target.importanceTier === 'critical') criticalGapCount++
  }
  const total = targets.length
  const coveragePercent = total > 0 ? Math.round(((correct + partial * 0.5) / total) * 100) : 0
  return {
    totalAcademicTargets: total, demonstratedCorrect: correct, demonstratedPartial: partial,
    demonstratedIncorrect: incorrect, omitted, coveragePercent, criticalGapCount, statusByTargetId,
    totalWeight, correctWeight, partialWeight, incorrectWeight, omittedWeight,
  }
}
```

### Meaning of the labels
- **"covered" contributes:** full weight to `correctWeight`; drives `recallPercent` up proportionally to its `IMPORTANCE_WEIGHT`.
- **"partial" contributes:** half-credit in `coveragePercent` (`partial * 0.5`); its weight goes to `partialWeight`, which counts toward `reinforcementPercent` (still needs work) but also partially toward recall in `computeRepasarMastery`'s formula.
- **"missing"/omitted contributes:** zero credit anywhere; full weight to `omittedWeight` → `reinforcementPercent`.
- **"incorrect" contributes:** zero credit toward mastery; its weight goes to `incorrectWeight` → `reinforcementPercent`; also used by `sortRepasarGapsByPriority` to rank ahead of partial/omitted ("misconception first").
- **"Dominio"/mastery** = the single composed number (`masteryPercent`) driving the score.
- **"Recordaste"** = `mastery.recallPercent` — importance-weighted breadth demonstrated, reader-invariant.
- **"Explicaste"** = `Math.round(qualityFrac * 100)` — the persona/feedback call's own quality score, the ONLY subjective number a provider contributes directly.
- **"Falta reforzar"** = `mastery.reinforcementPercent` — weighted share of real gaps, NEVER `100 - masteryPercent` (explicitly documented anti-pattern fix in the code comments — a prior bug had this backwards).

### Verdict: SAFE TO REUSE

**SAFE TO REUSE as the professor-paper grade, with reasoning:**
- It is already fully deterministic, already tested extensively (`repasar-score-semantics-contracts.ts`), already reader-invariant, and already exactly matches the product brief's stated principle: *"The score changes because academic state changed... No arbitrary +5 XP-style score."*
- It composes cleanly with `computeRepasoLetterGrade` (pure function of the resulting number).
- **One structural note, not a defect requiring a fix, but a PRODUCT DECISION the planner should make explicitly:** `calibrateRepasarScore`'s word-count floor-clamp (`words < 4 → min(masteryPercent, 15)`) was designed for the OLD one-shot "explain everything" flow, where a near-empty explanation across the WHOLE 51-target universe is a strong signal of a non-attempt. In the NEW flow, this same function will presumably be reused for the *initial* explanation only (still appropriate there) — but if it is ALSO reused verbatim for *recovery-step* scoring (a much narrower, few-word factual answer is normal and not a non-attempt), the `words < 4` clamp could unfairly zero out a legitimately short-but-correct recovery answer (e.g. "Kp = Kc(RT)^Δn" is 1 "word" by a naive splitter). **Recommendation: do not reuse `calibrateRepasarScore`'s word-count clamp for recovery-step scoring; recompute score purely from `computeRepasarMastery(currentDomainMap, ...)` for every state, with no word-count heuristic outside the very first initial-explanation submission.** This is a "PRODUCT DECISION REQUIRED" flag for the planner, not a change I made.

---

## I. Current provider call map

| # | Trigger | Function | Task type | Purpose | Input size | Output contract | Retry | Expected calls | Reusable? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Initial evaluate (per batch) | `evaluateRepasarCoverageBatch` → `generateValidatedLegacyJson` | `'summary'` | Canonical proposition-level adjudication of a batch of targets | up to 15 targets' rendered context + full explanation text | `{targetCoverage:[{targetId,status,evidence,demonstrated,missingDetail}]}` | Round-based (up to 3 rounds), plus internal `generateValidatedLegacyJson` repair/retry stages, plus `recoverableArrayKeys` partial-JSON salvage | `ceil(N/15)` per round, up to 3 rounds if provider under-responds | YES — bounded to a recovery group's targets |
| 2 | Initial evaluate (feedback pass) | inline in `POST` → `generateValidatedLegacyJson` | `'summary'` | Persona/feedback prose, `conceptStatus` (top-12), `repair` question authoring | full explanation + canonicalEvidenceSummary + persona scoringGuide | `{score, feedback, summary, conceptStatus, strengths, missingConcepts, confusions, repair, ...}` | Same generic pipeline | Exactly 1 | Repurpose as "ONE professor comment" call — narrower prompt, no persona |
| 3 | Teach-check | inline in `POST` (isTeachCheck branch) → `generateValidatedLegacyJson` | `'evaluation_question'` | Fact-by-fact or free verdict on a single repair answer | requiredFacts list + material text (single batch) + lesson + answer | `{factCoverage|passed/score/stillMissing, message, improvedAnswer}` | Same generic pipeline | Exactly 1 | Pattern reusable for recovery-answer adjudication, though `resolveRepasarCoverage` (item 1's function) is the better fit since it already speaks the covered/partial/missing/incorrect vocabulary directly |

### Proposed provider-call map for the new flow

| Flow step | Expected calls |
|---|---|
| 1. Initial diagnosis | `ceil(N/15)` canonical batches (1 round, optimistically; up to 3 if the model under-responds) + 1 "ONE professor comment" call = **`ceil(N/15) + 1`** |
| 2. Recovery question authoring | 1 provider call **per group**, authored ONCE and persisted (not per-render) — see section N for the lazy-vs-eager decision |
| 3. Recovery answer adjudication | `ceil(groupSize/15)` — for any realistic group size (2–6 targets per group, per the grouping spec), this is **always 1 call**, occasionally 2 if the retry round triggers |
| 4. Final verification question authoring | 1 provider call per check (3–6 checks total) OR a deterministic template with 0 calls, per check's `questionProvenance` |
| 5. Final verification grading | 1 provider call per submitted check answer (reusing `resolveRepasarCoverage`-style adjudication bounded to that check's targets) |
| 6. Reopen | **0** — pure `getMaterialResult`/`readFreeToolState` reads |

### Expected provider-call budget, restated per material size (initial diagnosis only, per your explicit ask)
- 10-target material: `ceil(10/15) + 1 = 2` calls.
- 51-target material: `ceil(51/15) + 1 = 5` calls (matches the live-verified `REP-PERF N=51` test).
- 150-target material: `ceil(150/15) + 1 = 11` calls (matches `REP-PERF N=150`).
- One recovery question generation: **1** call (or 0 if template-authored).
- One recovery answer: **1** call (occasionally 2 on retry-round).
- Reopen: **0** calls.
- Final verification (3–6 checks, worst case all provider-authored + provider-graded): up to **2 calls per check** (author + grade) = 6–12 calls total for the whole final stage — should be minimized by preferring deterministic template questions where the target's `statement`/`requiredFacts`-equivalent is simple enough (mirrors the existing teach-check `hasFixedFacts` deterministic-grading path, which needs ZERO provider calls for grading when a fixed fact list exists).

---

## J. Source/page/PDF infrastructure

- **Where target pages come from:** `RepasarReviewTarget.page` (single, first page) and `RepasarReviewTarget.pages?: number[]` (full set), both derived in `buildRepasarEnjoyerGroundedContext` from the Enjoyer item's `sourceSpans: {page, quote}[]`. For a recovery group spanning multiple targets, page-range guidance must be `Math.min/max` over the UNION of all member targets' `pages` arrays.
- **`sourceSpan` type:** `{ page: number; quote: string }` (see `spans()` helper in `repasarEnjoyerContext.ts`).
- **`materialId` representation:** a plain string, one per target (`RepasarReviewTarget.materialId`), sourced from the Enjoyer item's own `materialId` or the selection's first material id as fallback.
- **Selected pages representation:** `SourceSelectionSnapshot.materials: { materialId: string; selectedPages: number[] }[]` (from `lib/adaptive/sourceSelection.ts`), the authority Repasar's `buildRepasarEnjoyerGroundedContext` checks every target's pages against (`SOURCE_SELECTION_MISMATCH` if a target claims a page outside the selection).
- **Existing PDF viewer:** `components/materias/RepasarViewer.tsx` — a full-featured PDF viewer with drawing/highlighting/sticky-note annotation tools (via `react-pdf`), internal state `currentPageIndex`, derived from the material's own selected pages (`pages[currentPageIndex] || pages[0] || 1`).
- **How Free Mode opens material:** `<RepasarViewer materiales={materiales} seleccion={seleccion} phase={phase} themeColor="var(--gold)" activeColor={activeRepasarColor} />` — no page-jump prop currently exists.
- **Does exact-page navigation already exist?** **NO.** `currentPageIndex` is 100% internal, uncontrolled state. This is a genuine infrastructure gap the redesign must close.
- **Multi-material handling:** `materiales`/`seleccion` are arrays (props), and `RepasarViewer` internally supports switching between them (`activeIndex` state referenced in later lines) — but there is no existing mechanism to say "open material X at page Y" from outside.

### Recommended smallest implementation for recovery page navigation
Add two new **optional** props to `RepasarViewer`: `targetMaterialId?: string` and `targetPage?: number`. On mount (or on prop change, via a `useEffect`), if both are provided, set `activeIndex` to the material matching `targetMaterialId` and `currentPageIndex` to `targetPage - 1` (0-indexed). This is additive — existing callers (the current `preview`/`lectura` phase rendering, which passes neither prop) are entirely unaffected. The recovery UI then renders `<RepasarViewer ... targetMaterialId={group.materialId} targetPage={group.pages[0]} />` inside a "Releer material" interaction (e.g. a button that switches `phase` to `'lectura'` with these props set, then a "Volver a la pregunta" button to return).

---

## K. Reader system removal map

Every occurrence found via direct grep across the two live Repasar files (`ALAIStudyALRepasar.tsx`, `app/api/alai-studyal-repasar/route.ts`) — confirmed real, not inferred:

| File | Location | Current purpose | New behavior | Verdict |
|---|---|---|---|---|
| `ALAIStudyALRepasar.tsx` | `type ExplainMode = 'nino'|'universitario'|'profesor'|'libre';` (~L18) | Client-side reader type | Kept as a TYPE for legacy `Attempt.mode` typing; no longer user-selectable | KEEP (type only) |
| `ALAIStudyALRepasar.tsx` | `mode: ExplainMode;` field on `Props` (~L158, if present) / on `PersistedRepasarState` (~L178) | Persisted reader choice | New sessions never write a meaningful value here (or write a fixed `'libre'`); legacy reads still parse it | COMPAT |
| `ALAIStudyALRepasar.tsx` | `const [mode, setMode] = useState<ExplainMode>('nino');` (~L323) | Reader UI state | Removed for new flow; old attempts render via a **read-only** legacy path that still uses this state to reconstruct old `Lector: X` display | REMOVE (new flow), KEEP (legacy render path) |
| `ALAIStudyALRepasar.tsx` | `if (saved?.mode) setMode(saved.mode);` (~L381, continuity-restore effect) | Hydrates old reader choice on reopen | Still needed to correctly render an OLD attempt's `Lector:` label; harmless once the picker itself is gone (nothing lets the user change it anymore) | KEEP (compat) |
| `ALAIStudyALRepasar.tsx` | `setMode('nino');` in `resetSession()` (~L528) | Reset reader to default on new session | Should be removed/no-op once `mode` is no longer part of the new-session flow (a "new Repaso" simply doesn't set it) | REMOVE |
| `ALAIStudyALRepasar.tsx` | Reader picker JSX, `onClick={() => setMode(id as ExplainMode)}` (~L1124) | User-facing Niño/Universitario/Profesor/Neutral picker | Entire picker UI deleted from the NEW initial-explanation screen | REMOVE |
| `ALAIStudyALRepasar.tsx` | `Lector: {analysis.reviewer?.persona || (mode === 'nino' ? 'Niño' : ...)}` (~L1347) | Renders the active reader in the result banner | Removed from the new paper UI; may be conditionally shown ONLY when rendering a legacy attempt read-only | REMOVE (new), KEEP (legacy) |
| `ALAIStudyALRepasar.tsx` | `setMode(attempt.mode);` in history-item click handler (~L1975) | Restores an old attempt's reader when reopening it from history | Still correct/needed for legacy attempts; new-flow attempts simply won't have a meaningful `mode` to restore | KEEP (compat) |
| `route.ts` | `type RepasarReader = 'nino'|'universitario'|'profesor'|'libre'` (via import from `repasarSnapshot.ts`) | Server-side reader type, frozen into `RepasarFrozenSnapshot.reader` | Kept as a type; new-flow attempts freeze `reader: 'libre'` (or a new neutral constant) unconditionally, never taking it from `body.mode` | KEEP (type), CHANGE (default value source) |
| `route.ts` | `normalizeReader(value)` function | Coerces `body.mode` into a valid `RepasarReader`, defaulting to `'libre'` for anything invalid | New-flow submissions simply never send `mode`; `normalizeReader(undefined)` already safely falls back to `'libre'` — **zero code change needed here**, this function already does the right thing for an absent value | KEEP (already compatible) |
| `route.ts` | `const modeConfig: Record<string, {persona, scoringGuide, strictness}> = {...}` (~L807+, 4 entries) | Drives the persona-flavored feedback-call prompt (tone/strictness per reader) | New flow needs exactly ONE evaluator voice — replace the 4-entry `modeConfig` lookup with a single fixed config object for new-flow calls; OLD attempts being re-rendered (if ever re-evaluated, which they normally aren't post-freeze) would still resolve via the existing lookup | CHANGE (new flow bypasses the lookup entirely) |
| `route.ts` | `const selectedMode = modeConfig[mode] || modeConfig.libre;` | Selects the active persona config | New flow: replace with a single constant, e.g. `const STUDYAL_EVALUATOR = { persona: 'StudyAL', strictness: 'balanceada', scoringGuide: '...' }` | CHANGE |
| `route.ts` | `reviewer.persona = reviewer.persona || selectedMode.persona;` | Sets the response's persona label | New flow: hardcode to a fixed value (e.g. `'StudyAL'`) or omit `reviewer` entirely in favor of the new single "professor comment" field | CHANGE |

### Exact compatibility strategy
1. **Never remove `ExplainMode`/`RepasarReader` types or the `mode`/`reader` fields from persisted shapes.** Old attempts must keep parsing correctly.
2. **New-flow client code simply stops sending a meaningful `mode`** in the request body (or sends a fixed sentinel, e.g. `'libre'`) — the server's existing `normalizeReader()` already handles an absent/invalid value safely by falling back to `'libre'`, so **no server-side parsing change is required for this part.**
3. **New-flow server code bypasses `modeConfig`/`selectedMode` entirely** for the new `kind` branches (recovery-answer, final-verification), using one fixed `STUDYAL_EVALUATOR` config instead. The OLD evaluate/teach-check branches keep using `modeConfig` unchanged, so an old attempt calling teach-check (if that ever happens post-migration) still works exactly as before.
4. **Client-side rendering branches on artifact schema version** (`isRepasoArtifact(persisted)` from `repasoArtifact.ts`): if `true`, render the new paper UI with no reader chrome at all; if `false` (legacy `PersistedRepasarState`), render the OLD result UI read-only (including its `Lector: X` banner) plus a prominent "Nuevo Repaso" CTA that starts a fresh `RepasoArtifact`-based attempt.

---

## L. New product — complete state machine

Proposed phase enum (extends, does not replace, the existing `Phase` type — recommend renaming the type or adding a parallel `RepasoStage` type to avoid confusing the reading-flow `Phase` with the new evaluation-flow stage):

```ts
type RepasoStage =
  | 'entry'                      // no explanation yet
  | 'submitting_initial'         // fetch in flight for initial evaluate
  | 'initial_result'             // paper + grade shown, pre-recovery
  | 'recovery_planning'          // (transient) plan being authored
  | 'recovery_question_ready'    // a group's question is frozen and displayed
  | 'recovery_submitting'        // fetch in flight for a recovery answer
  | 'recovery_result'            // transition shown for that group (score before/after)
  | 'final_verification_ready'   // all targets covered, verification not yet started
  | 'final_verification_active'  // a check's question displayed
  | 'final_verification_submitting'
  | 'verification_failed_return' // a check failed -> back to recovery for that group only
  | 'mastered'                   // two-paper + journey shown
  | 'legacy_readonly'            // old PersistedRepasarState, no schemaVersion match
```

| Event | Client action | Server action | Persistence write | Provider calls | Next state | Failure state |
|---|---|---|---|---|---|---|
| Student submits initial explanation | `POST /api/alai-studyal-repasar { kind: 'repaso-initial', sessionId, explanation }` | freeze snapshot (`new_attempt`), `resolveRepasarCoverage` over ALL targets, build `RepasoInitialAttempt`, `computeRepasoMasteryStatus` | create `RepasoArtifact`, `saveMaterialResult`, pointer into `PersistedRepasarState` | `ceil(N/15)+1` | `initial_result` | stays `submitting_initial`, shows retryable error, on `REPASAR_COVERAGE_INCOMPLETE_RETRYABLE` |
| Student clicks "Vamos a mejorar tu nota" | client computes `recoveryPlan` request | author `RepasoRecoveryPlan` (deterministic grouping, section M) — question authored eagerly or lazily (section N) | update artifact (`recoveryPlan` field) | 0 (deterministic grouping) + 1 per group if provider-authored eagerly, 0 if lazy | `recovery_question_ready` | n/a (deterministic, cannot fail academically; can fail transport → retry) |
| Student submits a recovery answer | `POST { kind: 'repaso-recovery-answer', sessionId, artifactId, groupId, answer }` | restore snapshot (`continue_attempt`), reject forged ids, `resolveRepasarCoverage` bounded to group targets, apply transitions, recompute score/letter, append `RepasoRecoveryAttempt` | append attempt + updated `currentTargetStates` + `scoreHistory` entry | `ceil(groupSize/15)` (≈1) | `recovery_result` → next `recovery_question_ready` or `final_verification_ready` if all resolved | on `REPASAR_COVERAGE_INCOMPLETE_RETRYABLE`, stays `recovery_submitting`, offers retry (server preserved partial adjudication) |
| All targets covered | (automatic, computed from `currentTargetStates`) | `computeRepasoMasteryStatus` → `'verification_ready'` | none (derived) | 0 | `final_verification_ready` | n/a |
| Student starts final verification | client requests verification start | deterministically select checks (section P), author questions | create `RepasoFinalVerification`, append to artifact | 0–6 (per check, if provider-authored) | `final_verification_active` | n/a |
| Student submits a verification answer | `POST { kind: 'repaso-final-verification', sessionId, artifactId, checkId, answer }` | bounded adjudication of that check's targets only, NO page hints available | update that check's status/transitions | ≈1 | check `passed` → next check or `mastered`; check `failed` → `verification_failed_return` for only that check's targets | same retryable-incomplete handling |
| A verification check fails | client shows "only this area needs more work" | append a NEW `RepasoRecoveryGroup` (or reopen the existing one) for exactly the failed check's `targetIds`, reset those targets' status per the actual adjudicated result (not blanket-reset) | update `recoveryPlan.groups` (append) | 0 (deterministic re-grouping of already-known ids) | `recovery_question_ready` (only for the affected group) | n/a |
| All checks pass | (automatic) | `computeRepasoMasteryStatus` → `'mastered'` | set `masteryStatus`, assemble two-paper view (derived, not persisted separately unless caching is desired) | 0 | `mastered` | n/a |
| Reopen | mount effect reads pointer + artifact | `getMaterialResult` restore | none | 0 | whichever stage `computeRepasoMasteryStatus`/artifact state implies | n/a |
| Old attempt detected | `isRepasoArtifact(persisted)` returns false | none | none | 0 | `legacy_readonly` | n/a |

---

## M. Recovery planner — implementable spec

**Input types** (all pre-existing, real): `RepasarReviewTarget[]` (from the frozen `groundedContext.targets`), `RepasarRelationContext[]` (from `groundedContext.relations`), plus the current `RepasoTargetState` map to know which targets are eligible.

**Eligibility:** `status !== 'covered'` — i.e. `partial`, `missing`, `incorrect` (matches the existing `computeRepasarDomainMap`'s non-`demonstrated_correct` filter, already used identically by `buildRepasarGapGroups`).

**Grouping algorithm (reuse, don't reinvent):** `buildRepasarGapGroups(targets, domainMap, relations, limit)` **already implements** union-find clustering over authorized relations for exactly this eligible set — this is the SAME function the current "Para dominar el 100%" section uses. Its existing behavior:
```ts
export function buildRepasarGapGroups(
  targets: readonly RepasarReviewTarget[],
  domainMap: RepasarDomainMap,
  relations: readonly RepasarRelationContext[],
  limit = 8,
): { groups: RepasarGapGroup[]; remainderCount: number; remainderTargetIds: string[] }
```
It clusters gap targets via union-find over `relations` (two eligible targets sharing an authorized relation edge end up in the same cluster/group), ranks groups by importance tier then size, and returns `{groups, remainderCount, remainderTargetIds}` where `remainder` is whatever falls past `limit`.

**Recommendation: do NOT write a new grouping algorithm from scratch.** Instead:
1. Call `buildRepasarGapGroups` with **NO limit** (or `limit = Infinity`/a number ≥ total eligible count) — the current UI-display use caps it at 8 for a DIFFERENT reason (bounded initial viewport), but the recovery PLAN itself must cover every eligible target, so the cap must not apply here.
2. **Add topic-based grouping as a first pass BEFORE relation-based clustering**, since the current function only unions on relations, not shared `topicId` — the product brief explicitly wants topic grouping too ("Equilibrio dinámico 5, Kc y Kp 8, ..."). Concretely: pre-group by `topicId` first (all eligible targets sharing a `topicId` become one candidate group), then within a topic-group too large to be one question (see max-size below), sub-cluster via the EXISTING relation-based union-find restricted to that topic's members.
3. **Maximum group size:** cap at a small number, e.g. **4 targets per recovery question** (never invent a huge multi-topic mega-question) — split an over-large topic/relation cluster deterministically (e.g. sorted by `sourceOrder`, chunked in groups of ≤4) rather than refusing to group.
4. **Page locality:** within a candidate group, if the union of member targets' `pages` spans an unreasonably wide range (e.g. > 10 pages), consider it a signal the grouping is too coarse — but do not silently reject; the plan should still produce ONE question, just with a wider page range shown ("páginas 3–14"). No invented restriction here beyond what's naturally implied by the targets' real `pages`.
5. **Formula/process/example handling:** these are just `kind` values on `RepasarReviewTarget` (`kind: string`, free text from Enjoyer — e.g. `'formula'`, `'process'`, `'concept'`, `'fact'`) — no special-cased logic needed beyond what topic/relation clustering already captures; a formula target and its narrative "process" target will naturally end up together if they share a `topicId` or an authorized relation.
6. **Stable group IDs:** derive deterministically, e.g. `groupId = 'grp_' + sortedTargetIds.join('_').slice(0, 64)` or a hash of the sorted target-id list — must be STABLE across reopen/re-planning of the SAME artifact (i.e. compute the plan once, persist `groupId`s, never recompute from scratch on every render).
7. **Deterministic ordering:** sort final groups by `(highest importanceTier present in group) → (group size, descending) → (min sourceOrder among members)` — same tier-then-size logic `buildRepasarGapGroups` already uses, with `sourceOrder` as the final tiebreaker for full determinism (the existing function's tiebreak, `targetIds.length`, could tie for two same-tier same-size groups; `sourceOrder` resolves that).
8. **Fallback:** any eligible target that ends up in no relation/topic cluster becomes its own **singleton group** (`groupingRationale: {kind: 'singleton'}`) — exactly what `buildRepasarGapGroups` already does for ungrouped targets (a union-find node with no unions stays its own cluster).
9. **Universe-size behavior:**
   - **1 target:** one singleton group, one question. Trivial.
   - **10 targets, say 4 eligible:** likely 1–2 groups depending on topic/relation overlap.
   - **51 targets, say 43 eligible (matching the live-verified 4 partial + 39 missing case):** topic-grouping first should collapse the 39 "missing" targets into a handful of topic-based groups (e.g. the "Equilibrio dinámico 5 / Kc y Kp 8 / ..." example from the brief) — expect roughly 8–15 groups total, each capped at ≤4 targets, so a large "missing" topic cluster gets SPLIT into multiple sequential groups rather than one giant question.
   - **150 targets:** same algorithm, no special-casing — expect proportionally more groups (bounded by max-group-size, so group COUNT scales with eligible-target count, not universe size).

**Pseudocode (using real type/function names):**
```ts
function buildRepasoRecoveryPlan(
  targets: RepasarReviewTarget[],
  relations: RepasarRelationContext[],
  currentTargetStates: Record<string, RepasoTargetState>,
  maxGroupSize = 4,
): RepasoRecoveryGroup[] {
  const eligible = targets.filter(t => currentTargetStates[t.id]?.status !== 'covered')
  const byTopic = groupBy(eligible, t => t.topicId || `__no_topic__:${t.id}`)
  const groups: RepasoRecoveryGroup[] = []
  for (const [topicId, topicTargets] of byTopic) {
    // sub-cluster within the topic via the EXISTING union-find relation logic,
    // reusing the same algorithm buildRepasarGapGroups already implements,
    // restricted to `topicTargets` and `relations` filtered to edges within it
    const subClusters = unionFindClusters(topicTargets, relations)
    for (const cluster of subClusters) {
      for (const chunk of chunkBy(sortBy(cluster, t => t.sourceOrder), maxGroupSize)) {
        groups.push({
          groupId: stableGroupId(chunk.map(t => t.id)),
          targetIds: chunk.map(t => t.id),
          groupingRationale: cluster.length > 1
            ? { kind: 'relation', relationIds: relationsWithin(chunk, relations).map(r => r.id) }
            : { kind: topicId.startsWith('__no_topic__') ? 'singleton' : 'topic', topicId },
          pages: uniqueSorted(chunk.flatMap(t => t.pages || (t.page != null ? [t.page] : []))),
          materialId: chunk[0].materialId, // see section A concern #5 — assumes single-material groups
          question: '',           // authored separately, see section N
          questionProvenance: 'template',
          status: 'pending',
        })
      }
    }
  }
  return sortDeterministically(groups)
}
```

---

## N. Recovery question contract

```ts
// Already defined in repasoArtifact.ts (section A) — repeated here for convenience:
interface RepasoRecoveryGroup {
  groupId: string
  targetIds: string[]
  groupingRationale: { kind: 'topic'; topicId: string } | { kind: 'relation'; relationIds: string[] } | { kind: 'singleton' }
  pages: number[]
  materialId: string
  question: string
  questionProvenance: 'template' | 'provider'
  status: 'pending' | 'resolved' | 'exhausted'
}
```

**Eager vs. lazy authoring — recommendation: EAGER, at plan-creation time, but only for a bounded prefix.**

Reasoning:
- Reopen UX requires zero regeneration — if a question is authored lazily "when the student reaches it," a reopen mid-plan must still not regenerate anything for groups ALREADY reached; this is naturally satisfied either way as long as `question` is persisted once written.
- The real cost concern is a 150-target material producing dozens of groups — eagerly authoring EVERY group's question upfront could mean 15+ provider calls before the student even starts recovering, most of which may never be reached if the student masters early groups quickly relative to how grading updates other groups (it won't — coverage doesn't cascade across groups — but the student could also abandon the session).
- **Recommended middle ground:** author the question for the group about to be shown (`status: 'pending'`, next in deterministic order) at the moment the PREVIOUS group resolves (i.e., "author group N+1's question while group N's result is being shown") — this is lazy-per-step, not lazy-per-render, so reopen mid-session still sees a persisted question for the CURRENT group and never regenerates it. Author the very first group's question at plan-creation time (synchronously, since the student needs it immediately after clicking "Vamos a mejorar tu nota").

**Fallback if provider fails to author a question:** use a **deterministic template**: `questionProvenance: 'template'`, question text assembled from the group's target `label`/`statement` fields directly, e.g. `"Explica con tus palabras: ${targets.map(t => t.label).join(', ')}."` — never block the recovery flow on a provider failure; downgrade gracefully to template phrasing.

---

## O. Recovery answer contract

**Exact client request:**
```ts
POST /api/alai-studyal-repasar
{
  kind: 'repaso-recovery-answer',
  sessionId: string,
  artifactId: string,
  groupId: string,
  answer: string,
  attemptClientId: string,   // client-generated idempotency token, mirrors verificationAttemptRef's role but sent to the server for stale-response protection
}
```
Client sends NO target ids, NO status, NO score — server restores everything from `artifactId`/`groupId`.

**Exact server steps:**
1. Restore `RepasoArtifact` by `artifactId` (`getMaterialResult`).
2. Verify `sessionId` ownership matches the artifact's `sessionId` (same trust boundary as `getAuthoritativeFreeSession`).
3. Look up `recoveryPlan.groups.find(g => g.groupId === groupId)` — 404/400 if not found (never trust a client-supplied group that doesn't exist in the persisted plan).
4. Restore the frozen snapshot (`resolveRepasarEnjoyerSnapshot`, `intent: 'continue_attempt'`, `requestedSnapshotId: artifact.initial.snapshotId`).
5. `rejectForgedTargetIds(new Set(snapshot.targets.map(t=>t.id)), group.targetIds)` — defensive, should always fully accept since `group.targetIds` came from the server's own plan, but proves the boundary.
6. Filter `snapshot.targets` to `group.targetIds`, call `resolveRepasarCoverage(filteredTargets, groundedContext, answer)` — **reuses the existing function verbatim**.
7. On `!ok`: return `REPASAR_COVERAGE_INCOMPLETE_RETRYABLE` (same shape as today), do NOT mutate `currentTargetStates` for the unadjudicated ids, DO persist whatever subset WAS adjudicated as a new `RepasoRecoveryAttempt` (partial credit preserved, matching "preserve valid returned verdicts").
8. On `ok`: compute `transitions` (`before` = `currentTargetStates[id].status`, `after` = new verdict), apply to `currentTargetStates`, recompute `scoreBefore`/`scoreAfter` via `computeRepasarDomainMap` + `computeRepasarMastery` + `calibrateRepasarScore` (or the recovery-specific scoring variant per section H's flagged concern) + `computeRepasoLetterGrade`.
9. Append `RepasoRecoveryAttempt` (never overwrite a prior attempt — new `attemptId` every submission, even a retry of the same group).
10. Mark `group.status = 'resolved'` if ALL its `targetIds` are now `covered`, else leave `'pending'` (student can retry) — introduce `'exhausted'` if a bounded per-group retry ceiling (not yet specified — planner should pick a number, e.g. 3 attempts per group) is reached without full resolution, at which point the group's remaining unresolved targets fold into the FINAL VERIFICATION selection pool as "difficult to recover."
11. `computeRepasoMasteryStatus` recomputed, persist artifact.

**Response shape:**
```ts
{
  artifactId: string,
  groupId: string,
  attemptId: string,
  transitions: { targetId: string; before: RepasarCoverageStatus; after: RepasarCoverageStatus }[],
  scoreBefore: number, scoreAfter: number,
  letterBefore: string, letterAfter: string,
  groupStatus: 'pending' | 'resolved' | 'exhausted',
  masteryStatus: RepasoMasteryStatus,
  nextGroup: RepasoRecoveryGroup | null,  // authored lazily here if this was the last-resolved group (see section N)
}
```

**Explicit recommendation: MONOTONIC RECOVERY.**

Choose **monotonic** — a later bad recovery answer must NEVER downgrade a target that was previously `covered`.

Reasoning:
- Pedagogically: the product's own contract is "recovered knowledge," and a single confused follow-up answer (e.g. the student garbles their explanation while answering an UNRELATED recovery question that happens to also mention an already-mastered concept) should not erase prior demonstrated understanding. The FINAL CLOSED-BOOK VERIFICATION (section P) is explicitly the mechanism designed to re-test durability — that's where a regression should surface, not via an incidental mention in an unrelated recovery answer.
- Implementation-wise: `resolveRepasarCoverage` is always called with `filteredTargets` scoped to the CURRENT recovery group's `targetIds` only — a target that is NOT in the current group's `targetIds` is structurally never touched by that call in the first place (its status simply isn't part of `requestedTargetIds`), so non-monotonicity could only happen if a future implementation carelessly re-adjudicates the FULL universe on every recovery step (which the redesign explicitly forbids: "Do not rerun the entire 51-target adjudication after every answer"). **As long as the "bounded to the recovery group's target IDs" rule (already in the product brief, item 12) is followed, non-monotonicity for OTHER targets is structurally impossible.**
- The remaining question is narrower: can a target *within the same group*, already `covered` from an earlier attempt at that group, be downgraded by a LATER attempt at the SAME group? **Answer: also monotonic** — once a target transitions to `covered` within `currentTargetStates`, a subsequent recovery attempt at the same group should skip re-adjudicating already-`covered` members of that group (only send the group's still-unresolved `targetIds` to `resolveRepasarCoverage` on a retry), so a covered target can never be re-touched at all. This is a small but important refinement: **section O step 6 should filter to `group.targetIds.filter(id => currentTargetStates[id].status !== 'covered')`, not the full group, on any RETRY of a group** (the FIRST attempt at a group naturally sends all of it).

---

## P. Final verification contract

**Trigger:** `computeRepasoMasteryStatus(currentTargetStates, null)` returns `'verification_ready'` (i.e. `allTargetsResolved` is true) AND the student clicks the (new) "Verificación final" CTA.

**Deterministic target selection** — "approximately 3–6 coherent checks," selection algorithm:
1. Build the candidate pool: targets that were `originally partial`, `originally missing`, `originally incorrect` (compare `initial.initialTargetStates[id].status` against `'covered'`), OR have `recoveryAttemptCount >= 2` ("difficult to recover"), OR `importanceTier === 'critical'`.
2. Score each candidate target by a deterministic weight: `criticalBonus (if importanceTier==='critical') + originallyWrongBonus (if initial status was 'incorrect'/'missing'/'partial') + retryBonus (recoveryAttemptCount)`.
3. Sort descending by that weight, deterministic tiebreak by `sourceOrder`.
4. Group the top-weighted candidates using the SAME topic/relation clustering as section M (reuse the planner, don't write a second grouping algorithm) to keep checks coherent (a check should test a real cluster, not a random grab-bag).
5. Take the top **N groups** where N is clamped to `[3, 6]` based on how many distinct clusters exist among the candidates (fewer clusters → fewer checks; never fabricate more than exist).
6. This is fully deterministic given `currentTargetStates`/`initial.initialTargetStates`/relations/topics — no provider involvement in SELECTION, only (optionally) in question AUTHORING for each selected check.

**No page hints:** the check object (`RepasoFinalVerificationCheck`) simply never carries a `pages` field (unlike `RepasoRecoveryGroup`) — the UI has nothing to render, by construction, not by a runtime "hide this" flag.

**Question freezing:** identical pattern to recovery — author once (`questionProvenance`), persist, never regenerate on reopen.

**Grading:** `resolveRepasarCoverage` bounded to the check's `targetIds`, exactly like a recovery answer — `status === 'covered'` for ALL the check's targets → `check.status = 'passed'`; any target NOT `covered` → `check.status = 'failed'`.

**Failure path:** on a failed check, do NOT reset the whole session — construct a NEW `RepasoRecoveryGroup` for exactly that check's `targetIds` (append to `recoveryPlan.groups`), transition those specific targets back out of `covered` per their ACTUAL adjudicated result from the failed check (not a blanket downgrade — if 3 of 4 targets in the check still passed and 1 failed, only that 1 target's status changes), route the student back to `recovery_question_ready` for that new group only.

**Re-verification:** once the returned group resolves again, re-run ONLY the previously-failed check (not the entire verification battery) — track this via `checks[].status` staying queryable per-check; `finalVerification.passed` is `true` only when EVERY check in `checks` has `status === 'passed'` (matches `computeRepasoMasteryStatus`'s existing logic in `repasoArtifact.ts`).

**Individual targets or coherent groups?** **Coherent groups** (same rationale as recovery — a closed-book check asking about a real topic cluster is more natural and reduces check COUNT while still exercising every candidate target across the check battery).

---

## Q. Exact mastery contract

```
FUNCTION computeRepasoMasteryStatus(currentTargetStates, finalVerification):
  IF NOT allTargetsResolved(currentTargetStates):       // any status != 'covered'
    RETURN 'not_ready'
  IF finalVerification IS NULL:
    RETURN 'verification_ready'
  IF ANY check IN finalVerification.checks HAS status == 'pending':
    RETURN 'verifying'
  RETURN finalVerification.passed ? 'mastered' : 'verification_ready'

INVARIANT: masteryStatus == 'mastered'
  IMPLIES allTargetsResolved(currentTargetStates) == true
  AND finalVerification != null
  AND finalVerification.passed == true
  AND EVERY check IN finalVerification.checks HAS status == 'passed'
```
(This is the exact, already-implemented function in `repasoArtifact.ts` — restated here as pseudocode per your request, not a new design.)

**Can current score reach 100 before final verification?**

**Answer: technically yes, numerically** — `computeRepasarMastery`'s `masteryPercent` CAN reach 100 once every target is `covered` (recall=100%, and if quality is also 100%, mastery=100). This happens at `'verification_ready'`, BEFORE `'mastered'`.

**This is not a scoring bug — it needs a UI decision, not a formula change (matches your "if the current score formula has a structural issue, report it before altering it" instruction).**

**Recommendation: distinguish `domainScore` (the existing, unchanged, reusable 0–100 number) from `masteryGrade` display, WITHOUT adding a second scoring system:**
- Keep `computeRepasarMastery`/`calibrateRepasarScore` exactly as-is — this remains the single source of the numeric score, always.
- The UI, when `masteryStatus !== 'mastered'`, should present the score/letter as-is (it genuinely IS 100/A+ worth of DEMONSTRATED coverage) but the SURROUNDING CHROME communicates the gate explicitly — e.g. a banner: *"Tienes 100/100 en cobertura demostrada. Para confirmar dominio, completa la verificación final."* The number itself is never artificially suppressed or capped (that WOULD corrupt the canonical domain score, which you explicitly forbid) — instead, `masteryStatus` is a SEPARATE, additional signal shown alongside the score, never blended into it.
- This means **no duplicate scoring system is introduced** — `domainScore` (existing) and `masteryStatus` (new, already designed in `repasoArtifact.ts`) are two orthogonal signals, exactly matching how the artifact schema already separates them.

---

## R. Initial paper UI spec

Proposed component decomposition (new files under `components/materias/repaso/`, a new subdirectory to keep the redesign additive and easy to review/rollback):

### `RepasoPaper`
- **Props:** `{ artifact: RepasoArtifact | null; legacyAnalysis?: AnalysisResult | null }` (the legacy prop supports rendering an old attempt read-only).
- **Data source:** `artifact.initial` + `artifact.currentTargetStates` (initial view uses `initial.initialTargetStates`, not `currentTargetStates`, until any recovery has happened).
- **Responsibility:** top-level paper shell — off-white surface, "REPASO" header, material/session title, renders `RepasoGradeMark`, `RepasoAnnotatedExplanation`, `RepasoProfessorComment`, `RepasoCompactRubric`, `RepasoImproveGradeCTA` as children.
- **Replaces:** the entire `phase === 'analisis'` render block currently in `ALAIStudyALRepasar.tsx`.
- **Mobile:** single-column, same components stacked; the grade mark moves from "upper-right" to directly under the title (no horizontal scroll).

### `RepasoGradeMark`
- **Props:** `{ score: number; letterGrade: string }`.
- **Data source:** `artifact.initial.initialScore`/`initialLetterGrade` (or `currentScore`/`currentLetterGrade` once recovery has started — same component, different props).
- **Responsibility:** large letter + numeric score, "professor red-pen" visual treatment (per the brief's inspiration, not literally red — follow existing StudyAL accent tokens, e.g. `--gold` for passing grades, a muted red-family tone consistent with `#ef4444` established this session for "needs work" states, for F/D).
- **Interaction:** none (display only).
- **Mobile:** same, scaled down.

### `RepasoAnnotatedExplanation`
- **Props:** `{ explanation: string; targetStates: Record<string, RepasoTargetState>; targets: RepasarReviewTarget[] }` (needs the frozen snapshot's targets to know each id's `evidenceText`/label for matching, though matching itself is done via `evidence` string containment/proximity, not re-parsing).
- **Data source:** `artifact.initial.explanation` (verbatim, never rewritten) + up to a BOUNDED subset of `targetStates` entries (only ones whose `evidence` is a substring/near-match of the explanation, for inline ✓/◐/✕ markers) + a bounded set of margin notes for the most important omissions (e.g. top 3–5 by `importanceTier` among `missing` targets).
- **Responsibility:** render the student's exact text with inline markers where canonical evidence anchors to a substring, plus margin callouts (never inline) for missing concepts, since — per the brief — a missing concept cannot be inline-annotated onto text the student didn't write.
- **No fabricated quotes:** any "Dijiste" text shown must be `targetStates[id].evidence`, never re-generated.
- **Replaces:** nothing existing (this is a wholly new visual treatment; the old UI never annotated the raw explanation at all).

### `RepasoProfessorComment`
- **Props:** `{ comment: string }`.
- **Data source:** a NEW, narrower provider call (or a rewritten version of provider-call #2 from section I) producing ONE paragraph, no persona.
- **Responsibility:** replace `summary`/`mainIssue`/`scoreReason`/`feedback`/`nextStep` (5 separate fields in the current `AnalysisResult`) with ONE rendered paragraph.
- **Replaces:** all narrative-text renderings currently scattered across the `analisis` phase.

### `RepasoCompactRubric`
- **Props:** `{ domainMap: RepasarDomainMap; gapGroups: RepasoRecoveryGroup[] | RepasarGapGroup[]; expanded: boolean; onToggle: () => void }`.
- **Data source:** `computeRepasarDomainMap` counts + topic-grouped breakdown (reusing `buildRepasarGapGroups`/topic-grouping from section M, in READ-ONLY display mode here — this is the SAME data structure the recovery planner computes, just rendered collapsed).
- **Responsibility:** the ✓/◐/○/✕ count rows, collapsed by default, expandable to the topic-grouped breakdown (the "Equilibrio dinámico 5, Kc y Kp 8, ..." example).
- **Replaces:** the current "Mapa de dominio" + "Para dominar el 100%" sections, merged into one collapsed-by-default component.

### `RepasoImproveGradeCTA`
- **Props:** `{ score: number; letterGrade: string; onStart: () => void }`.
- **Data source:** current score/letter.
- **Responsibility:** the "Vamos a mejorar tu nota" button + "Tu nota actual: F · 18/100" display.
- **Replaces:** nothing existing (new).

---

## S. Recovery UI spec

### `RepasoRecoveryHeader`
- **Props:** `{ scoreBefore: number; scoreAfter?: number; letterBefore: string; letterAfter?: string; progress: { resolved: number; total: number } }`.
- **Responsibility:** compact current grade + progress bar (e.g. "8/43 conceptos trabajados"), never the full 51-item dump.

### `RepasoRecoveryPageGuidance`
- **Props:** `{ materialId: string; pages: number[]; onOpenReader: () => void }`.
- **Responsibility:** "Vuelve a leer las páginas 7–10" text + "Releer material" button, calling back up to the parent to switch to the reading phase with the new `RepasarViewer` `targetMaterialId`/`targetPage` props (section J).

### `RepasoRecoveryQuestion`
- **Props:** `{ topicLabel: string; question: string }`.
- **Responsibility:** display the frozen question (never regenerated).

### `RepasoRecoveryAnswerInput`
- **Props:** `{ value: string; onChange: (v: string) => void; onSubmit: () => void; submitting: boolean }`.
- **Responsibility:** the focused textarea + "Verificar" button — reuses the exact single-flight guard pattern from `checkTeachMissing` (section D.9), NOT a copy-paste of the whole function, but the SAME guard shape (`if (submitting) return`, `AbortController`, attempt-identity ref).

### `RepasoRecoveryResult`
- **Props:** `{ transitions: {...}[]; scoreBefore: number; scoreAfter: number; letterBefore: string; letterAfter: string }`.
- **Responsibility:** "✓ Concepto recuperado, 18 → 22" style transient feedback before advancing to the next group.

---

## T. Final two-paper UI spec

### Layout
- **Desktop (≥ some breakpoint, follow existing StudyAL responsive conventions — no new breakpoint system needed):** two `RepasoPaper`-shaped columns side by side, `grid-template-columns: 1fr 1fr`.
- **Mobile:** stacked, Paper 1 above Paper 2, full width each, no horizontal scroll (matches existing `repeat(auto-fit, minmax(...))` grid patterns already used throughout `ALAIStudyALRepasar.tsx`).

### Deterministic assembly algorithm (Paper 2)
```
FOR each topic (in canonical topic order, from groundedContext.topics):
  FOR each target in that topic whose FINAL currentTargetStates[id].status is 'covered':
    find the LATEST source of demonstrated evidence for this target, in this priority:
      1. the most recent RepasoFinalVerificationCheck whose targetIds includes this id AND status == 'passed'
         -> use that check's studentAnswer, label provenance "Confirmado en verificación final"
      2. else the most recent RepasoRecoveryAttempt whose adjudicatedTargetIds includes this id AND its transition .after == 'covered'
         -> use that attempt's answer, label provenance "Recuperado en pregunta N" (N = attempt's position in recoveryAttempts)
      3. else (never needed recovery) the initial explanation itself
         -> use artifact.initial.explanation (the WHOLE text, not a per-target excerpt — the initial explanation is single-sourced), label "Explicación inicial"
    render ONE entry: { topicTitle, targetLabel, demonstratedText, provenanceLabel }
```
**Duplicate avoidance:** a target is represented EXACTLY ONCE in Paper 2 (the algorithm above picks exactly one source per target, by priority) — never render the same target's evidence twice even if it appears in both a recovery answer AND the initial explanation.

**No fabricated essay:** every `demonstratedText` value is a DIRECT COPY of `studentAnswer`/`answer`/`explanation` — never provider-regenerated prose. If a target's group answer covered MULTIPLE targets, the same `demonstratedText` may legitimately appear under multiple target entries within Paper 2 (that's honest — the student's one answer really did demonstrate multiple concepts), grouped visually under that shared answer rather than literally duplicated as separate paragraphs.

### `RepasoFinalComparison`
- **Props:** `{ paper1: {explanation, initialScore, initialLetterGrade, initialTargetStates}; paper2Entries: {topicTitle, targetLabel, demonstratedText, provenanceLabel}[]; journey: {startScore, endScore, questionsAnswered, conceptsWorked, pagesRevisited} }`.
- **Responsibility:** renders both papers + `RepasoLearningJourney` below/between them.

### `RepasoLearningJourney`
- **Props:** `{ scoreHistory: RepasoScoreHistoryEntry[] }` (or derived summary stats).
- **Responsibility:** "Inicio: F·18 → ... → Final: A+·100", counts of questions answered / concepts worked / **only if genuinely tracked** pages revisited (per your explicit "do not invent study time or pages read unless tracked" instruction — `pages revisited` would need to be derived from counting DISTINCT `(materialId, page)` pairs shown via `RepasoRecoveryPageGuidance` across the session, which is derivable IF the client reports "reader opened for group X" back to the artifact; if that tracking is not implemented, THIS METRIC MUST BE OMITTED, not estimated).

---

## U. File-by-file implementation plan

| Path | Action | Why | Types/functions to add | Sections to modify | Import changes | Dependencies | Protecting tests |
|---|---|---|---|---|---|---|---|
| `lib/materialBrain/reviewContext.ts` | MODIFY | Move `RepasarCoverageStatus` here (fix the lib→route dependency-direction issue noted in section A) | `export type RepasarCoverageStatus = 'covered'\|'partial'\|'missing'\|'incorrect'` | add near `RepasarTargetStatus` | route.ts imports it from here instead of declaring locally; `repasoArtifact.ts` imports it from here instead of redeclaring | none new | all `repasar-*-contracts.ts` (regression) |
| `lib/materialBrain/repasoArtifact.ts` | MODIFY | Remove the locally-redeclared `RepasarCoverageStatus`, import from `reviewContext.ts` instead | — | top of file | `import type { RepasarCoverageStatus } from './reviewContext'` | `reviewContext.ts` change above must land first | `repaso-artifact-schema-contracts.ts` |
| `lib/materialBrain/repasoArtifact.ts` | MODIFY | Add builder/mutation functions the route will call (currently only pure invariant CHECKS exist, not state-transition BUILDERS) | `createRepasoArtifact(...)`, `applyRecoveryTransition(artifact, attempt)`, `applyFinalVerificationTransition(artifact, check)`, `buildRepasoRecoveryPlan(...)` (section M) | append | none | `reviewContext.ts` types | new tests, see section V per stage |
| `app/api/alai-studyal-repasar/route.ts` | MODIFY | Add new `kind` branches (additive, guarded early-return style per section F) | `const isRepasoInitial = body?.kind === 'repaso-initial'`, `isRepasoRecoveryAnswer`, `isRepasoFinalVerification` branches | insert new `if` blocks BEFORE the existing `if (isTeachCheck)` block; add `STUDYAL_EVALUATOR` constant replacing `modeConfig` lookup for new branches only | import `createRepasoArtifact`/`applyRecoveryTransition`/etc. from `repasoArtifact.ts`; import `getMaterialResult`/`saveMaterialResult` (already imported indirectly via `repasarSnapshot.ts`'s pattern — confirm direct import needed) | `resolveRepasarCoverage`, `computeRepasoLetterGrade` (already present) | ALL existing `repasar-*-contracts.ts` MUST still pass unmodified — this is the highest-risk file, changes must be additive-only |
| `components/materias/repaso/RepasoPaper.tsx` (new dir) | CREATE | Section R | `RepasoPaper` component | n/a | new file | `RepasoGradeMark`, etc. (below) | new component-level test if the repo gains a UI test story (currently none for Repasar — flag this gap to the planner) |
| `components/materias/repaso/RepasoGradeMark.tsx` | CREATE | Section R | — | — | — | none | — |
| `components/materias/repaso/RepasoAnnotatedExplanation.tsx` | CREATE | Section R | evidence-matching helper (pure function, could live in `repasoArtifact.ts` instead for testability — recommend that) | — | — | `RepasarReviewTarget`, `RepasoTargetState` types | a NEW pure-function test for the evidence-matching helper |
| `components/materias/repaso/RepasoProfessorComment.tsx` | CREATE | Section R | — | — | — | none | — |
| `components/materias/repaso/RepasoCompactRubric.tsx` | CREATE | Section R | — | — | — | `buildRepasarGapGroups` (reused) | — |
| `components/materias/repaso/RepasoImproveGradeCTA.tsx` | CREATE | Section R | — | — | — | none | — |
| `components/materias/repaso/RepasoRecovery*.tsx` (5 files, section S) | CREATE | Section S | — | — | — | `RepasarViewer` (extended, see below) | — |
| `components/materias/RepasarViewer.tsx` | MODIFY | Add page-jump props (section J) | new optional props `targetMaterialId?: string`, `targetPage?: number`; new `useEffect` reacting to them | near existing `activeIndex`/`currentPageIndex` state | none | none | manual/browser check (no existing automated test touches this file) |
| `components/materias/ALAIStudyALRepasar.tsx` | MODIFY (large) | Reader removal (section K) + swap render tree for new components (Stage 2+) | — | remove reader picker JSX; replace `phase === 'analisis'` block with `<RepasoPaper>`; add `RepasoStage` state; keep legacy render path gated by `isRepasoArtifact` check | import new components from `./repaso/*`; import `isRepasoArtifact` from `repasoArtifact.ts` | all of the above | none currently exist for this component — **recommend the planner add a first component-level smoke test as part of Stage 2**, this is a real testing gap |
| `lib/freeToolState.ts` | MODIFY (minimal) | Add `repasoArtifactId` pointer field awareness — actually may need NO change if `PersistedRepasarState` itself (component-local type) simply gains the field, since `readFreeToolState`/`writeFreeToolState` are already fully generic over `T` | none (generic already) | none | none | none | `free-tool-continuity-contracts.ts` (regression only, should be unaffected) |
| `docs/repaso-redesign-reconnaissance.md` | CREATE (this file) | Deliverable | — | — | — | — | — |

---

## V. Staged implementation plan

### STAGE 1 (already substantially done)
- **Goal:** artifact schema + compatibility + deterministic grade/recovery contracts.
- **Files:** `lib/materialBrain/repasoArtifact.ts`, `scripts/tests/repaso-artifact-schema-contracts.ts`, `app/api/alai-studyal-repasar/route.ts` (letter grade only, already landed).
- **Preconditions:** none.
- **Exact changes:** fix the `RepasarCoverageStatus` dependency-direction issue (move to `reviewContext.ts`); add `createRepasoArtifact`/`applyRecoveryTransition`/`applyFinalVerificationTransition`/`buildRepasoRecoveryPlan` pure functions (no route/UI wiring yet).
- **Do not touch:** route's existing evaluate/teach-check branches, any UI file.
- **Tests:** extend `repaso-artifact-schema-contracts.ts` with builder-function tests (creation, one recovery transition, one final-verification transition, plan-building on the live 51-target shape from earlier sessions' fixtures).
- **Manual check:** none needed (pure functions).
- **Expected provider calls:** 0.
- **Exit criteria:** `tsc --noEmit` clean, new tests pass, ALL existing `repasar-*` tests still pass unmodified.
- **Rollback point:** revert the two/three touched files; zero blast radius on anything else.

### STAGE 2
- **Goal:** wire the new `kind` branches into the route (server-side only), no UI change.
- **Files:** `app/api/alai-studyal-repasar/route.ts`.
- **Preconditions:** Stage 1 complete.
- **Exact changes:** add `repaso-initial`, `repaso-recovery-answer`, `repaso-final-verification` branches per section F/O/P, each early-returning before the existing branches, using `STUDYAL_EVALUATOR` in place of `modeConfig` for these branches only.
- **Do not touch:** existing `evaluate`/`teach-check` code paths (verify with a diff that only NEW lines were added, no existing lines changed, aside from the `RepasarCoverageStatus` import fix from Stage 1).
- **Tests:** new `scripts/tests/repaso-route-contracts.ts` — full-pipeline tests for each new `kind`, mocking `__routeDeps` exactly like every existing `repasar-*-contracts.ts` file does (same pattern, same mocking helpers — reuse `extractRequestedTargetIds` helper pattern already established in this session's test files).
- **Manual check:** none (server-only, no UI wired).
- **Expected provider calls (mocked in tests, real budget documented in section I):** per the table in section I.
- **Exit criteria:** new route tests pass; ALL 18 currently-passing suites still pass; `tsc`/`git diff --check` clean.
- **Rollback point:** revert route.ts changes only.

### STAGE 3
- **Goal:** initial corrected-paper UI (section R components), reader removed from the NEW flow's UI only.
- **Files:** all `components/materias/repaso/*` new files, `ALAIStudyALRepasar.tsx` (reader picker removal + new-flow render branch behind an `isRepasoArtifact` check).
- **Preconditions:** Stage 2 complete (route accepts `repaso-initial`).
- **Do not touch:** the reading phase (`preview`/`lectura`) render tree, `RepasarViewer.tsx` (not yet — that's Stage 4).
- **Tests:** none new required if no test framework exists for React components in this repo (confirmed: none does, per section D verdict) — flag to planner as a coverage gap; consider adding a minimal smoke check via the existing non-jsdom pattern (call the pure data-shaping functions the components will use, e.g. the evidence-matching helper, directly).
- **Manual check:** REQUIRED — browser walkthrough of initial submit → paper render.
- **Expected provider calls:** matches Stage 2 (no new calls, just new UI consuming the same response).
- **Exit criteria:** manual walkthrough passes; existing suites unaffected (no route logic changed in this stage).
- **Rollback point:** revert `ALAIStudyALRepasar.tsx`'s render-branch change; delete new component files.

### STAGE 4
- **Goal:** recovery planner + page-grounded recovery loop UI.
- **Files:** `components/materias/repaso/RepasoRecovery*.tsx`, `RepasarViewer.tsx` (page-jump props), `ALAIStudyALRepasar.tsx` (recovery stage wiring).
- **Preconditions:** Stage 3 complete.
- **Tests:** `buildRepasoRecoveryPlan` pure-function tests against the SAME 10/51/150-target fixtures already used in `repasar-dynamic-universe-coverage-contracts.ts` (reuse those fixtures, don't rebuild them).
- **Manual check:** REQUIRED — full recovery loop walkthrough including "Releer material" page jump.
- **Expected provider calls:** per section I.
- **Exit criteria:** manual walkthrough + new planner tests pass.
- **Rollback point:** revert this stage's files; Stage 3's initial-paper UI remains functional standalone (recovery CTA can be temporarily disabled/hidden).

### STAGE 5
- **Goal:** score progression/persistence/reopen for the new flow.
- **Files:** `app/api/alai-studyal-repasar/route.ts` (persistence wiring per section G), `ALAIStudyALRepasar.tsx` (reopen hydration for `RepasoArtifact`).
- **Preconditions:** Stage 4 complete.
- **Tests:** reopen/zero-regeneration test (mock provider throws if called during a reopen simulation — same pattern as existing `ENJOYER_NOT_READY` tests that assert `generateValidatedLegacyJson` is never invoked).
- **Manual check:** reload the page mid-recovery, confirm state restores exactly.
- **Exit criteria:** reopen test passes; no duplicate writes observed.

### STAGE 6
- **Goal:** final closed-book verification + two-paper mastery result + journey.
- **Files:** `components/materias/repaso/RepasoFinalComparison.tsx`, `RepasoLearningJourney.tsx`, route's final-verification branch completion, `repasoArtifact.ts`'s Paper-2-assembly pure function.
- **Preconditions:** Stage 5 complete.
- **Tests:** the full AD–AP test list from the original task's section 30, now implementable against real code.
- **Manual check:** full end-to-end mastery walkthrough.
- **Exit criteria:** all new tests + all existing 18 suites pass; `tsc`/`diff-check`/Graphify clean; this is the final stage.

---

## W. EXTERNAL AI CONTEXT PACK

*(Self-contained — an external AI with zero repo access should be able to write code from this section plus the excerpts in section E.)*

### Full `repasoArtifact.ts` pure-function bodies (not shown in full above)
```ts
export function targetUniverseIsStable(artifact: Pick<RepasoArtifact, 'initial' | 'currentTargetStates'>): boolean {
  const initialIds = Object.keys(artifact.initial.initialTargetStates).sort()
  const currentIds = Object.keys(artifact.currentTargetStates).sort()
  return initialIds.length === currentIds.length && initialIds.every((id, i) => id === currentIds[i])
}

export function rejectForgedTargetIds(knownTargetIds: ReadonlySet<string>, proposedIds: readonly string[]): { accepted: string[]; rejected: string[] } {
  const accepted: string[] = []
  const rejected: string[] = []
  for (const id of proposedIds) (knownTargetIds.has(id) ? accepted : rejected).push(id)
  return { accepted, rejected }
}

export function partitionRecoveryResponse(requestedTargetIds: readonly string[], adjudicatedTargetIds: readonly string[]): { adjudicated: string[]; stillUnadjudicated: string[] } {
  const adjudicatedSet = new Set(adjudicatedTargetIds)
  return {
    adjudicated: requestedTargetIds.filter(id => adjudicatedSet.has(id)),
    stillUnadjudicated: requestedTargetIds.filter(id => !adjudicatedSet.has(id)),
  }
}

const RESOLVED_STATUSES = new Set<RepasarCoverageStatus>(['covered'])

export function allTargetsResolved(currentTargetStates: Record<string, RepasoTargetState>): boolean {
  return Object.values(currentTargetStates).every(t => RESOLVED_STATUSES.has(t.status))
}

export function computeRepasoMasteryStatus(
  currentTargetStates: Record<string, RepasoTargetState>,
  finalVerification: RepasoFinalVerification | null,
): RepasoMasteryStatus {
  const resolved = allTargetsResolved(currentTargetStates)
  if (!resolved) return 'not_ready'
  if (!finalVerification) return 'verification_ready'
  if (finalVerification.checks.some(c => c.status === 'pending')) return 'verifying'
  return finalVerification.passed ? 'mastered' : 'verification_ready'
}

export function scoreCanReach100(currentTargetStates: Record<string, RepasoTargetState>): boolean {
  return allTargetsResolved(currentTargetStates)
}

export function isRepasoArtifact(value: unknown): value is RepasoArtifact {
  return Boolean(value) && typeof value === 'object'
    && (value as any).schemaVersion === REPASO_ARTIFACT_SCHEMA_VERSION
    && typeof (value as any).artifactId === 'string'
}
```

### All other types/signatures
See sections A (artifact types), E (frozen snapshot, persisted state, analysis result, review target/relation, route excerpts), G (persistence signatures), H (score formula), M (planner), N/O/P (recovery/verification contracts).

### Style/component conventions observed in this codebase
- Inline `style={{...}}` objects throughout (no CSS-in-JS library, no Tailwind classes observed in this component) — colors via CSS custom properties (`var(--bg-primary)`, `var(--gold)`, etc., full palette in `app/globals.css`) plus a small set of established hex accents for state colors: `#4ade80` (green/correct), `#fbbf24`/`#facc15` (amber/partial-warning), `#ef4444` (red/incorrect-missing) — these three are the ALREADY-established StudyAL state-color convention (used in `ALAIStudyALCheatCodes.tsx`, `ALAIStudyALCards.tsx`, and just applied to Repasar's domain-map UI this session).
- Card treatment convention: `background: `color-mix(in srgb, ${accent} 10-16%, var(--bg-card))``, `border: `1px solid color-mix(in srgb, ${accent} 35-40%, var(--border-color))``, `borderRadius: 14-18`.
- Fonts: `HAND = "var(--font-hand)"` for headings/emphasis, `BODY = "var(--font-body)"` for body text — both module-level constants at the top of `ALAIStudyALRepasar.tsx`.
- Icons are plain Unicode characters (✓ ◐ ○ ✕ △), not an icon library.
- No component-level test framework exists for this component (all tests are `scripts/tests/*.ts` pure-Node scripts run via `tsx`, testing server/lib logic directly — never React rendering).

---

## X. Note

Per your explicit instruction, this document does NOT include implementation prompts for an external AI — it is reconnaissance + architecture + plan only, for a planner to review first.

---

## Y. Certification

```
$ npx tsc --noEmit          -> clean, no output
$ git diff --check          -> clean, no output
$ rtk graphify update .     -> 9103 nodes, 22820 edges (unchanged from before this task — no code was modified)
```
No test files were added or modified in this task (documentation-only, per instruction). All 18 previously-passing suites remain untouched and were not re-run in this turn (no code changed since the last full sweep in the prior turn, which already confirmed ZERO failures).
