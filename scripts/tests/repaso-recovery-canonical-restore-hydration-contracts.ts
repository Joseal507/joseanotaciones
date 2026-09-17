import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/* ------------------------------------------------------------------ */
/* REPASO_CLIENT_RESTORE_BYPASSES_SERVER_REPAIR                         */
/*                                                                      */
/* Root cause: ALAIStudyALRepasar's mount effect called                 */
/* `setView(saved.view || null); setPhase(saved.phase || 'read')`       */
/* UNCONDITIONALLY whenever a persisted local snapshot existed — before  */
/* (and even independently of whether) the canonical `repaso-restore`   */
/* request ever fired. Since the canonical fetch itself was additionally */
/* gated on `sessionId` being resolved yet, a race where `sessionId` was */
/* still empty at mount meant NO request to /api/alai-studyal-repasar    */
/* happened at all, while the stale cached academic question/pages       */
/* still rendered as the final hydrated state — exactly the live report. */
/*                                                                      */
/* Fix: the local cache's `view`/`phase` (academic content: question,   */
/* pagesToReview, groupId, feedback) are hydrated ONLY when there is NO  */
/* persisted artifactId at all (nothing canonical to defer to). Whenever */
/* an artifactId exists, `view`/`phase` stay at their safe defaults      */
/* until the canonical repaso-restore response arrives — the request     */
/* fires as soon as `sessionId` is available (the effect re-runs on      */
/* that dependency), never leaving a stale question as the final state.  */
/* ------------------------------------------------------------------ */

const ui = readFileSync('components/materias/ALAIStudyALRepasar.tsx', 'utf8')

function mountEffectSource(): string {
  const start = ui.indexOf('useEffect(() => {\n    const saved = readFreeToolState')
  assert.ok(start >= 0, 'the mount-restore effect must exist')
  const end = ui.indexOf('}, [sessionId, selection.fingerprint, request, persist])')
  assert.ok(end > start, 'the mount-restore effect must end with its expected dependency array')
  return ui.slice(start, end)
}

function artifactIdBranchBounds(section: string): { ifBranch: string; elseBranch: string } {
  const ifStart = section.indexOf('if (saved.artifactId) {')
  assert.ok(ifStart >= 0, 'the effect must branch explicitly on whether a persisted artifactId exists')
  const elseMarker = '\n      } else {\n        setView(saved.view || null)'
  const elseStart = section.indexOf(elseMarker, ifStart)
  assert.ok(elseStart > ifStart, 'the artifactId branch must have a matching else for the no-artifactId case')
  const elseEnd = section.indexOf('\n    }', elseStart + elseMarker.length)
  return {
    ifBranch: section.slice(ifStart, elseStart),
    elseBranch: section.slice(elseStart, elseEnd),
  }
}

function testStaleViewNeverHydratedSynchronouslyWhenArtifactIdExists() {
  const section = mountEffectSource()
  const { ifBranch } = artifactIdBranchBounds(section)
  assert.match(ifBranch, /if \(sessionId\)/, 'the canonical restore call must be gated on sessionId being resolved')
  assert.match(ifBranch, /void request\(`restore:\$\{saved\.artifactId\}`, \{ kind: 'repaso-restore', artifactId: saved\.artifactId \}\)/)
  // Covering BOTH the sessionId-ready and not-yet-ready cases, there must
  // be no `setView(saved.view` / `setPhase(saved.phase` call — the stale
  // academic snapshot must never be applied while an artifactId exists.
  assert.doesNotMatch(ifBranch, /setView\(saved\.view/, 'view must never be hydrated from stale cache while a canonical artifactId is pending restore')
  assert.doesNotMatch(ifBranch, /setPhase\(saved\.phase/, 'phase must never be hydrated from stale cache while a canonical artifactId is pending restore')
}

function testNoArtifactIdStillHydratesImmediately() {
  // With no persisted artifactId there is no canonical Recovery state to
  // defer to — hydrating the (non-academic, harmless) cached view/phase
  // immediately in that case is fine and must remain unchanged.
  const section = mountEffectSource()
  const { elseBranch } = artifactIdBranchBounds(section)
  assert.match(elseBranch, /setView\(saved\.view \|\| null\)/)
  assert.match(elseBranch, /setPhase\(saved\.phase \|\| 'read'\)/)
}

function testCanonicalRestoreResponseStillAppliesAtomically() {
  const section = mountEffectSource()
  assert.match(section, /setView\(restoredView\); setPhase\(nextPhase\)/, 'the canonical restore response must still atomically replace view+phase once it arrives')
  assert.match(section, /persist\(\{ artifactId: restored\.artifactId,/, 'the canonical response must be the one persisted back to the local cache, not the stale one')
}

/* ------------------------------------------------------------------ */
/* Behavioral re-implementation of the mount-hydration DECISION logic,  */
/* exercised directly — mirrors the pattern already used for            */
/* applyRecoveryGroupSnapshot in repaso-recovery-client-snapshot-        */
/* contracts.ts for this same file.                                     */
/* ------------------------------------------------------------------ */

interface SavedState {
  artifactId: string | null
  phase: string
  view: { question?: string; pagesToReview?: number[]; groupId?: string } | null
}

interface HydrationDecision {
  hydrateFromCache: boolean
  requestsCanonicalRestore: boolean
}

function decideMountHydration(saved: SavedState | null, sessionId: string | null): HydrationDecision {
  if (!saved) return { hydrateFromCache: false, requestsCanonicalRestore: false }
  if (!saved.artifactId) return { hydrateFromCache: true, requestsCanonicalRestore: false }
  return { hydrateFromCache: false, requestsCanonicalRestore: Boolean(sessionId) }
}

function testDecision_ArtifactIdAndSessionReady_NoCacheHydrationRequestsRestore() {
  const saved: SavedState = { artifactId: 'art-1', phase: 'recovery', view: { question: 'stale?', pagesToReview: [1], groupId: 'g1' } }
  const decision = decideMountHydration(saved, 'sess-1')
  assert.equal(decision.hydrateFromCache, false, 'the stale cached question/pages must never be hydrated as current')
  assert.equal(decision.requestsCanonicalRestore, true, 'the canonical repaso-restore request must fire')
}

function testDecision_ArtifactIdButSessionNotReady_NoCacheHydrationNoRequestYet() {
  // The EXACT live race: sessionId not yet resolved. The old code still
  // hydrated the stale view/phase here even though no request fired.
  const saved: SavedState = { artifactId: 'art-1', phase: 'recovery', view: { question: 'stale?', pagesToReview: [1], groupId: 'g1' } }
  const decision = decideMountHydration(saved, null)
  assert.equal(decision.hydrateFromCache, false, 'the stale cached question/pages must never be hydrated, even when the canonical request cannot fire yet')
  assert.equal(decision.requestsCanonicalRestore, false)
}

function testDecision_NoArtifactId_SafeToHydrateFromCache() {
  const saved: SavedState = { artifactId: null, phase: 'read', view: null }
  const decision = decideMountHydration(saved, 'sess-1')
  assert.equal(decision.hydrateFromCache, true, 'with nothing canonical to defer to, the harmless local cache may hydrate immediately')
  assert.equal(decision.requestsCanonicalRestore, false)
}

function main() {
  testStaleViewNeverHydratedSynchronouslyWhenArtifactIdExists()
  testNoArtifactIdStillHydratesImmediately()
  testCanonicalRestoreResponseStillAppliesAtomically()
  testDecision_ArtifactIdAndSessionReady_NoCacheHydrationRequestsRestore()
  testDecision_ArtifactIdButSessionNotReady_NoCacheHydrationNoRequestYet()
  testDecision_NoArtifactId_SafeToHydrateFromCache()
  console.log('repaso-recovery-canonical-restore-hydration-contracts: ALL PASS')
}

main()
