import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps } from '../../app/api/alai-studyal-repasar/route'

/* ------------------------------------------------------------------ */
/* REPASO — ELIMINATE SESSION_AUTHORITY AS A RUNTIME SINGLE POINT OF     */
/* FAILURE                                                              */
/*                                                                      */
/* Root cause: every artifact-bound continuation (repaso-restore,       */
/* repaso-recovery-open/answer, repaso-final-open/answer) re-derived    */
/* ownership + source-selection identity from a LIVE call to the        */
/* external /study-sessions dependency, on every single request — even  */
/* against an already-legitimately-created, long-lived artifact. A      */
/* transient upstream outage there (including a malformed/HTML 500       */
/* response) fully blocked academic continuity, no matter how healthy   */
/* and long-persisted the artifact itself was.                          */
/*                                                                      */
/* Fix: `RepasoArtifact.frozenAuthority` — a server-owned, deterministic */
/* snapshot of {userId, materialIds, selectedPages} captured ONCE, at    */
/* the exact moment a NEW artifact's ownership was live-validated.       */
/* `buildSourceSelectionSnapshot` is a pure hash of those two fields, so */
/* rebuilding the identical SourceSelectionSnapshot (same fingerprint)   */
/* from frozen data reproduces the exact canonical identity with zero    */
/* live calls. Ownership is still enforced every time — by comparing     */
/* the CURRENTLY authenticated userId (from the untouched, local         */
/* getServerSession) against the frozen snapshot, fail-closed on any     */
/* mismatch. A pre-migration artifact without the snapshot still uses    */
/* the legacy live path unchanged, and is opportunistically backfilled   */
/* the next time that live path succeeds.                               */
/* ------------------------------------------------------------------ */

function harness(userId: string, sessionId: string, selection: any, payload: any, generate: (input: any) => Promise<any>, authorityImpl: (sessionId: string, userId: string) => Promise<any>) {
  const snapshots = new Map<string, any>()
  const artifacts = new Map<string, any>()
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: userId } }),
    getAuthoritativeFreeSession: authorityImpl,
    getMaterial: async () => ({ id: selection.materialIds[0] }),
    lookupEnjoyer: async (fingerprint: string) => (fingerprint === selection.fingerprint ? payload : null),
    createRepasarSnapshotStore: () => ({
      async get(id: string) { return snapshots.get(id) || null },
      async set(snapshot: any) { snapshots.set(snapshot.snapshotId, snapshot) },
    }),
    createRepasoArtifactStore: () => ({
      async get(id: string) { return artifacts.get(id) || null },
      async set(artifact: any) { artifacts.set(artifact.artifactId, artifact) },
    }),
    generateValidatedLegacyJson: generate,
  })
  return artifacts
}

async function post(sessionId: string, body: Record<string, unknown>) {
  const response = await POST(new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, ...body }),
  }))
  return { response, data: await response.json() }
}

function initialCoverageMock(targets: any[]) {
  return async ({ telemetryContext }: any) => {
    if (telemetryContext?.phase === 'analysis_batch') {
      return { targetCoverage: targets.map(t => ({ targetId: t.id, status: 'missing', evidence: '', demonstrated: '', missingDetail: '' })) }
    }
    throw new Error('unexpected provider call during initial diagnosis')
  }
}

function refuseAnyProvider() {
  return async () => { throw new Error('unexpected provider call') }
}

function outageAuthority(): (sessionId: string, userId: string) => Promise<any> {
  return async () => {
    // Exactly the live incident: /study-sessions returned non-JSON HTML,
    // which the shared sessionAuthority dependency surfaces as a thrown
    // error carrying the transient 5xx shape.
    throw new Error('SESSION_AUTHORITY_FAILED:503')
  }
}

function fixture(materialId: string) {
  const quote = 'Efecto de los catalizadores en las velocidades de reacción: un catalizador acelera tanto la reacción directa como la inversa por igual.'
  const targets = [
    { id: 'catalyst', kind: 'concept', name: 'Efecto de los catalizadores en las velocidades de reacción', summary: quote, importance: 90, materialId, pages: [30], sourceSpans: [{ page: 30, quote }], topicId: 'topic-1', sourceOrder: 0 },
  ]
  const selection = buildSourceSelectionSnapshot([materialId], { [materialId]: [30] })
  return {
    selection, targets,
    payload: {
      sourceSelectionFingerprint: selection.fingerprint,
      topicsIndex: [{ id: 'topic-1', title: 'Catálisis', order: 0 }],
      globalOrderedAnalysis: targets,
      uniqueConceptsIndex: [],
    },
  }
}

/** Creates an artifact under valid live authority, then opens it once
 * (the point at which frozenAuthority gets set) — the long-lived,
 * already-established artifact every scenario below builds on. */
async function createLongLivedArtifact(userId: string, sessionId: string, materialId: string) {
  const { selection, payload, targets } = fixture(materialId)
  let authorityCalls = 0
  const authorityImpl = async (sid: string, uid: string) => {
    authorityCalls += 1
    return { id: sid, userId: uid, processMode: 'free', sourceSelection: selection }
  }
  const artifacts = harness(userId, sessionId, selection, payload, initialCoverageMock(targets), authorityImpl)
  const { data: initial } = await post(sessionId, { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseAnyProvider() })
  const open = await post(sessionId, { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200, JSON.stringify(open.data))
  const stored = artifacts.get(initial.artifactId)
  assert.ok(stored.frozenAuthority, 'the artifact must be frozen with an authority snapshot on its first continuation')
  assert.equal(stored.frozenAuthority.userId, userId)
  assert.deepEqual(stored.frozenAuthority.materialIds, selection.materialIds)
  return { artifacts, artifactId: initial.artifactId, group: open.data, targets, selection }
}

/* ------------------------------------------------------------------ */
/* 1-4. restore / recovery-open / recovery-answer / final-open+answer    */
/* all succeed from frozen authority while the live dependency is        */
/* completely down — long after creation.                                */
/* ------------------------------------------------------------------ */

async function testRestoreSucceedsDuringOutage() {
  const { artifacts, artifactId } = await createLongLivedArtifact('user-1', 'sess-1', 'mat-durable-1')
  Object.assign(__routeDeps, { getAuthoritativeFreeSession: outageAuthority(), generateValidatedLegacyJson: refuseAnyProvider() })
  const restore = await post('sess-1', { artifactId, kind: 'repaso-restore' })
  assert.equal(restore.response.status, 200, `restore must survive a live outage via frozen authority: ${JSON.stringify(restore.data)}`)
  assert.equal(restore.data.score, 0)
  void artifacts
}

async function testRecoveryOpenSucceedsDuringOutage() {
  const { artifactId } = await createLongLivedArtifact('user-1', 'sess-2', 'mat-durable-2')
  Object.assign(__routeDeps, { getAuthoritativeFreeSession: outageAuthority(), generateValidatedLegacyJson: refuseAnyProvider() })
  const open = await post('sess-2', { artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200, `recovery-open must survive a live outage via frozen authority: ${JSON.stringify(open.data)}`)
  assert.ok(open.data.question)
}

async function testRecoveryAnswerReachesGradingDuringOutage() {
  const { artifacts, artifactId, group } = await createLongLivedArtifact('user-1', 'sess-3', 'mat-durable-3')
  Object.assign(__routeDeps, {
    getAuthoritativeFreeSession: outageAuthority(),
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call')
      return { targetCoverage: [{ targetId: 'catalyst', status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' }] }
    },
  })
  const answer = await post('sess-3', {
    artifactId, kind: 'repaso-recovery-answer', groupId: group.groupId,
    attemptClientId: 'a1', answer: 'Un catalizador acelera ambas reacciones por igual.',
  })
  assert.equal(answer.response.status, 200, `grading must be reached despite a live outage: ${JSON.stringify(answer.data)}`)
  assert.equal(answer.data.feedback.groupResolved, true)
  assert.equal(artifacts.get(artifactId).recoveryAttempts.length, 1)
}

async function testCompletionAndRetiredFinalOpenSurviveOutage() {
  // FINAL PRODUCT FLOW: Final Verification is retired — completing
  // Recovery reaches 'mastered' directly, and repaso-final-open must
  // refuse to generate a NEW verification set (410), all while the live
  // session-authority dependency stays down.
  const { artifacts, artifactId, group } = await createLongLivedArtifact('user-1', 'sess-4', 'mat-durable-4')
  Object.assign(__routeDeps, {
    getAuthoritativeFreeSession: outageAuthority(),
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call')
      return { targetCoverage: [{ targetId: 'catalyst', status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' }] }
    },
  })
  const answer = await post('sess-4', {
    artifactId, kind: 'repaso-recovery-answer', groupId: group.groupId,
    attemptClientId: 'a1', answer: 'Un catalizador acelera ambas reacciones por igual.',
  })
  assert.equal(answer.response.status, 200, JSON.stringify(answer.data))
  assert.equal(answer.data.masteryStatus, 'mastered', 'mastered must be reachable directly during a live outage, with no Final Verification gate')

  Object.assign(__routeDeps, {
    getAuthoritativeFreeSession: outageAuthority(),
    generateValidatedLegacyJson: refuseAnyProvider(),
  })
  const finalOpen = await post('sess-4', { artifactId, kind: 'repaso-final-open' })
  assert.equal(finalOpen.response.status, 410, `a NEW Final Verification set must never be generated, even during a live outage: ${JSON.stringify(finalOpen.data)}`)
  assert.equal(finalOpen.data.error, 'REPASO_FINAL_VERIFICATION_RETIRED')

  const restore = await post('sess-4', { artifactId, kind: 'repaso-restore' })
  assert.equal(restore.response.status, 200, `restore of a mastered artifact must survive a live outage: ${JSON.stringify(restore.data)}`)
  assert.equal(restore.data.masteryStatus, 'mastered')
  void artifacts
}

/* ------------------------------------------------------------------ */
/* 5. Repeated upstream 5xx does not require retry storms — zero calls   */
/* to the live dependency at all once authority is frozen.               */
/* ------------------------------------------------------------------ */

async function testRepeatedOutageNeverCallsLiveAuthority() {
  const { artifactId } = await createLongLivedArtifact('user-1', 'sess-5', 'mat-durable-5')
  let liveCalls = 0
  Object.assign(__routeDeps, {
    getAuthoritativeFreeSession: async () => { liveCalls += 1; throw new Error('SESSION_AUTHORITY_FAILED:503') },
    generateValidatedLegacyJson: refuseAnyProvider(),
  })
  for (let i = 0; i < 5; i++) {
    const r = await post('sess-5', { artifactId, kind: 'repaso-restore' })
    assert.equal(r.response.status, 200)
  }
  assert.equal(liveCalls, 0, 'a frozen-authority artifact must never call the live dependency, no matter how many times it is (still) down')
}

/* ------------------------------------------------------------------ */
/* 6. Malformed HTML/non-JSON upstream response cannot corrupt the       */
/* artifact — it never even reaches the artifact once frozen.            */
/* ------------------------------------------------------------------ */

async function testMalformedUpstreamResponseCannotCorruptArtifact() {
  const { artifacts, artifactId } = await createLongLivedArtifact('user-1', 'sess-6', 'mat-durable-6')
  const before = JSON.parse(JSON.stringify(artifacts.get(artifactId)))
  Object.assign(__routeDeps, {
    getAuthoritativeFreeSession: async () => { throw new SyntaxError(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`) },
    generateValidatedLegacyJson: refuseAnyProvider(),
  })
  const restore = await post('sess-6', { artifactId, kind: 'repaso-restore' })
  assert.equal(restore.response.status, 200, 'a malformed upstream response must never even be reached for a frozen-authority artifact')
  const after = JSON.parse(JSON.stringify(artifacts.get(artifactId)))
  assert.deepEqual(after, before)
}

/* ------------------------------------------------------------------ */
/* 7-8. Forged/foreign ownership is rejected WITHOUT ever calling the    */
/* live dependency — the frozen snapshot is definitive proof, not a      */
/* weaker check.                                                        */
/* ------------------------------------------------------------------ */

async function testForeignUserIsRejectedWithoutLiveCall() {
  const { artifactId } = await createLongLivedArtifact('user-1', 'sess-7', 'mat-durable-7')
  let liveCalls = 0
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'attacker-user' } }),
    getAuthoritativeFreeSession: async () => { liveCalls += 1; return { id: 'sess-7', userId: 'attacker-user', processMode: 'free', sourceSelection: null } },
    generateValidatedLegacyJson: refuseAnyProvider(),
  })
  const restore = await post('sess-7', { artifactId, kind: 'repaso-restore' })
  assert.equal(restore.response.status, 404, `an artifact belonging to another user must be rejected: ${JSON.stringify(restore.data)}`)
  assert.equal(restore.data.error, 'SESSION_NOT_FOUND')
  assert.equal(liveCalls, 0, 'ownership is decided from the frozen snapshot alone — the live dependency must never even be consulted')
}

async function testForgedSessionIdRejected() {
  const { artifactId } = await createLongLivedArtifact('user-1', 'sess-8', 'mat-durable-8')
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseAnyProvider() })
  const restore = await post('sess-8-forged', { artifactId, kind: 'repaso-restore' })
  assert.equal(restore.response.status, 403)
  assert.equal(restore.data.error, 'REPASO_SESSION_MISMATCH')
}

/* ------------------------------------------------------------------ */
/* 9 & 11. Missing/corrupt frozen authority fails closed — and leaves    */
/* the artifact byte-identical — never falls back to client trust.       */
/* ------------------------------------------------------------------ */

async function testMissingFrozenAuthorityFailsClosedWhenLiveAlsoDown() {
  const { artifacts, artifactId } = await createLongLivedArtifact('user-1', 'sess-9', 'mat-durable-9')
  const stripped = { ...artifacts.get(artifactId), frozenAuthority: undefined }
  artifacts.set(artifactId, stripped)
  const before = JSON.parse(JSON.stringify(artifacts.get(artifactId)))

  Object.assign(__routeDeps, { getAuthoritativeFreeSession: outageAuthority(), generateValidatedLegacyJson: refuseAnyProvider() })
  const restore = await post('sess-9', { artifactId, kind: 'repaso-restore' })
  assert.equal(restore.response.status, 503, `an artifact with no frozen authority must fall back to the (currently down) live path and fail HONESTLY — never trust client-supplied state instead: ${JSON.stringify(restore.data)}`)

  const after = JSON.parse(JSON.stringify(artifacts.get(artifactId)))
  assert.deepEqual(after, before, 'a failed authority validation must leave the artifact byte-identical')
}

/* ------------------------------------------------------------------ */
/* 10. Old-artifact compatibility: no frozenAuthority yet, live path      */
/* still works unchanged, and backfills the snapshot for next time.      */
/* ------------------------------------------------------------------ */

async function testOldArtifactBackfillsOnNextSuccessfulLiveCall() {
  const { selection, payload, targets } = fixture('mat-durable-10')
  const authorityImpl = async (sid: string, uid: string) => ({ id: sid, userId: uid, processMode: 'free', sourceSelection: selection })
  const artifacts = harness('user-1', 'sess-10', selection, payload, initialCoverageMock(targets), authorityImpl)
  const { data: initial } = await post('sess-10', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })

  // Simulate a pre-migration artifact: strip the snapshot the initial
  // creation would normally set.
  const legacyArtifact = { ...artifacts.get(initial.artifactId), frozenAuthority: undefined }
  artifacts.set(initial.artifactId, legacyArtifact)

  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseAnyProvider() })
  const open = await post('sess-10', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200, `a legacy artifact must still work via the live path: ${JSON.stringify(open.data)}`)
  const backfilled = artifacts.get(initial.artifactId)
  assert.ok(backfilled.frozenAuthority, 'a successful legacy-path call must backfill the frozen authority snapshot')
  assert.equal(backfilled.frozenAuthority.userId, 'user-1')
}

/* ------------------------------------------------------------------ */
/* 12. Idempotent replay after a transient failure does not duplicate    */
/* attempts — the existing replay contract still holds under the         */
/* durable-authority path.                                               */
/* ------------------------------------------------------------------ */

async function testIdempotentReplayNeverDuplicatesAttempts() {
  const { artifacts, artifactId, group } = await createLongLivedArtifact('user-1', 'sess-12', 'mat-durable-12')
  Object.assign(__routeDeps, {
    getAuthoritativeFreeSession: outageAuthority(),
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call')
      return { targetCoverage: [{ targetId: 'catalyst', status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' }] }
    },
  })
  const first = await post('sess-12', {
    artifactId, kind: 'repaso-recovery-answer', groupId: group.groupId,
    attemptClientId: 'a1', answer: 'Un catalizador acelera ambas reacciones por igual.',
  })
  assert.equal(first.response.status, 200)

  Object.assign(__routeDeps, { getAuthoritativeFreeSession: outageAuthority(), generateValidatedLegacyJson: refuseAnyProvider() })
  const replay = await post('sess-12', {
    artifactId, kind: 'repaso-recovery-answer', groupId: group.groupId,
    attemptClientId: 'a1', answer: 'Un catalizador acelera ambas reacciones por igual.',
  })
  assert.equal(replay.response.status, 200)
  assert.equal(replay.data.idempotentReplay, true)
  assert.equal(artifacts.get(artifactId).recoveryAttempts.length, 1, 'a replayed attemptClientId must never create a duplicate attempt')
}

async function main() {
  await testRestoreSucceedsDuringOutage()
  await testRecoveryOpenSucceedsDuringOutage()
  await testRecoveryAnswerReachesGradingDuringOutage()
  await testCompletionAndRetiredFinalOpenSurviveOutage()
  await testRepeatedOutageNeverCallsLiveAuthority()
  await testMalformedUpstreamResponseCannotCorruptArtifact()
  await testForeignUserIsRejectedWithoutLiveCall()
  await testForgedSessionIdRejected()
  await testMissingFrozenAuthorityFailsClosedWhenLiveAlsoDown()
  await testOldArtifactBackfillsOnNextSuccessfulLiveCall()
  await testIdempotentReplayNeverDuplicatesAttempts()
  console.log('repaso-recovery-durable-authority-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
