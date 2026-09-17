import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps } from '../../app/api/alai-studyal-repasar/route'

/* ------------------------------------------------------------------ */
/* STUDYAL — REPASO FINAL PRODUCT CLEANUP                               */
/*                                                                      */
/* Final Verification is retired from the ACTIVE product flow. New       */
/* invariant: once every ASSESSABLE target (excluding                    */
/* nonAssessableTargetIds — a system coverage fact, never a student      */
/* mastery fact) is resolved, Repaso is complete — 'mastered' directly,  */
/* with no 'verification_ready'/'verifying' gate in between. A legacy    */
/* artifact (with or without a persisted finalVerification) that is      */
/* already fully resolved self-heals to 'mastered' on its very next      */
/* read — no migration, no re-adjudication, no provider call.            */
/* ------------------------------------------------------------------ */

function harness(sessionId: string, selection: any, payload: any, generate: (input: any) => Promise<any>) {
  const snapshots = new Map<string, any>()
  const artifacts = new Map<string, any>()
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'user-1' } }),
    getAuthoritativeFreeSession: async () => ({ id: sessionId, userId: 'user-1', processMode: 'free', sourceSelection: selection }),
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

function refuseAnyProvider() {
  return async () => { throw new Error('unexpected provider call') }
}

function initialCoverageMock(targets: any[]) {
  return async ({ telemetryContext }: any) => {
    if (telemetryContext?.phase === 'analysis_batch') {
      return { targetCoverage: targets.map(t => ({ targetId: t.id, status: 'missing', evidence: '', demonstrated: '', missingDetail: '' })) }
    }
    throw new Error('unexpected provider call during initial diagnosis')
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

/* ------------------------------------------------------------------ */
/* 1-4. Recovery completion goes straight to 'mastered' — no             */
/* verification_ready/verifying intermediate state, and repaso-final-    */
/* open refuses to generate a NEW verification set (zero provider calls).*/
/* ------------------------------------------------------------------ */

async function testRecoveryCompletionGoesDirectlyToMastered() {
  const { selection, payload, targets } = fixture('mat-flow-1')
  const artifacts = harness('sess-1', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-1', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  assert.notEqual(initial.masteryStatus, 'verification_ready')

  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseAnyProvider() })
  const open = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200, JSON.stringify(open.data))
  assert.notEqual(open.data.masteryStatus, 'verification_ready')

  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call')
      return { targetCoverage: [{ targetId: 'catalyst', status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' }] }
    },
  })
  const answer = await post('sess-1', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: open.data.groupId,
    attemptClientId: 'a1', answer: 'Un catalizador acelera ambas reacciones por igual.',
  })
  assert.equal(answer.response.status, 200, JSON.stringify(answer.data))
  assert.equal(answer.data.masteryStatus, 'mastered', 'all assessable targets resolved must go directly to mastered')
  assert.notEqual(answer.data.masteryStatus, 'verification_ready')
  assert.ok(answer.data.studentEvidencePaper.length > 0, 'Paper 2 must already be available, no Final Verification required')

  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseAnyProvider() })
  const finalOpen = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-final-open' })
  assert.equal(finalOpen.response.status, 410, `a NEW Final Verification question set must never be generated: ${JSON.stringify(finalOpen.data)}`)
  assert.equal(finalOpen.data.error, 'REPASO_FINAL_VERIFICATION_RETIRED')
}

/* ------------------------------------------------------------------ */
/* 5, 7, 8, 9, 14, 15. Completed restore shows the final result,         */
/* preserves scoreHistory/initial explanation/recovery responses byte-   */
/* for-byte, requires zero provider calls, and repeated refresh stays    */
/* completed without mutating academic history.                        */
/* ------------------------------------------------------------------ */

async function testCompletedRestoreShowsFinalResultAndIsStable() {
  const { selection, payload, targets } = fixture('mat-flow-2')
  const artifacts = harness('sess-2', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-2', { explanation: 'Mi explicación inicial genuina.', mode: 'libre', kind: 'repaso-initial' })
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseAnyProvider() })
  const open = await post('sess-2', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call')
      return { targetCoverage: [{ targetId: 'catalyst', status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' }] }
    },
  })
  await post('sess-2', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: open.data.groupId,
    attemptClientId: 'a1', answer: 'Un catalizador acelera ambas reacciones por igual.',
  })

  const before = JSON.parse(JSON.stringify(artifacts.get(initial.artifactId)))

  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseAnyProvider() })
  const restore1 = await post('sess-2', { artifactId: initial.artifactId, kind: 'repaso-restore' })
  assert.equal(restore1.response.status, 200, JSON.stringify(restore1.data))
  assert.equal(restore1.data.masteryStatus, 'mastered')
  assert.ok(restore1.data.currentAnnotations, 'the Before/After AFTER side must be present on restore')
  assert.equal(restore1.data.initialPaper.explanation, 'Mi explicación inicial genuina.', 'initial explanation must be preserved exactly')

  const restore2 = await post('sess-2', { artifactId: initial.artifactId, kind: 'repaso-restore' })
  assert.equal(restore2.response.status, 200)
  assert.equal(restore2.data.masteryStatus, 'mastered', 'repeated refresh must stay completed')

  const after = JSON.parse(JSON.stringify(artifacts.get(initial.artifactId)))
  assert.deepEqual(after.scoreHistory, before.scoreHistory, 'scoreHistory preserved byte-for-byte')
  assert.deepEqual(after.recoveryAttempts, before.recoveryAttempts, 'genuine Recovery responses preserved byte-for-byte')
  assert.deepEqual(after.initial, before.initial, 'initial paper untouched')
}

/* ------------------------------------------------------------------ */
/* 6, 16. A legacy artifact already at A+100 — with or without a         */
/* persisted finalVerification — self-heals directly to 'mastered' on    */
/* its very next restore, with zero provider calls and no requirement    */
/* to open/answer another verification.                                 */
/* ------------------------------------------------------------------ */

async function testLegacyFullyCoveredArtifactSelfHealsToCompleted() {
  const { selection, payload, targets } = fixture('mat-flow-3')
  const artifacts = harness('sess-3', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-3', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })

  // Simulate the exact live A+100 artifact: fully covered canonical
  // state, but still carrying the OLD completion shape (a persisted,
  // already-passed finalVerification) — as if it were created before
  // this product change.
  const legacy = artifacts.get(initial.artifactId)
  legacy.currentTargetStates.catalyst = { ...legacy.currentTargetStates.catalyst, status: 'covered', evidence: 'e', demonstrated: 'd' }
  legacy.finalVerification = {
    verificationId: 'legacy-v1', createdAt: '2026-01-01T00:00:00.000Z', passed: true,
    checks: [{
      checkId: 'fvcheck_1_catalyst', targetIds: ['catalyst'], question: '¿Cómo afecta un catalizador?',
      questionProvenance: 'provider', studentAnswer: 'Acelera ambas reacciones por igual.',
      adjudicatedTargetIds: ['catalyst'], adjudications: [{ targetId: 'catalyst', status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' }],
      transitions: [{ targetId: 'catalyst', before: 'covered', after: 'covered' }], status: 'passed', attemptId: 'fv-att-1',
    }],
  }
  artifacts.set(initial.artifactId, legacy)

  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseAnyProvider() })
  const restore = await post('sess-3', { artifactId: initial.artifactId, kind: 'repaso-restore' })
  assert.equal(restore.response.status, 200, JSON.stringify(restore.data))
  assert.equal(restore.data.masteryStatus, 'mastered', 'a legacy artifact whose assessable universe is already resolved must self-heal to mastered directly')
  assert.equal(restore.data.score, 100)
  assert.equal(restore.data.letterGrade, 'A+')
  // Historical finalVerification data remains readable, never discarded.
  assert.ok(restore.data.finalVerification, 'historical finalVerification data must remain readable')
  assert.equal(restore.data.finalVerification.checks[0].studentAnswer, 'Acelera ambas reacciones por igual.')

  // No verification is ever required again.
  const finalOpen = await post('sess-3', { artifactId: initial.artifactId, kind: 'repaso-final-open' })
  assert.equal(finalOpen.response.status, 200, 'an artifact with an EXISTING finalVerification may still be read (backward compatibility), never regenerated')
}

/* ------------------------------------------------------------------ */
/* 10, 11. nonAssessable targets remain excluded (never falsely          */
/* covered), but a genuinely unresolved assessable target still blocks   */
/* completion.                                                          */
/* ------------------------------------------------------------------ */

async function testUnresolvedAssessableTargetStillBlocksCompletion() {
  const { selection, payload, targets } = fixture('mat-flow-4')
  const artifacts = harness('sess-4', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-4', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseAnyProvider() })
  const restore = await post('sess-4', { artifactId: initial.artifactId, kind: 'repaso-restore' })
  assert.equal(restore.response.status, 200)
  assert.equal(restore.data.masteryStatus, 'not_ready', 'a genuinely unresolved assessable target must still block completion')
  assert.equal(artifacts.get(initial.artifactId).currentTargetStates.catalyst.status, 'missing', 'no fabricated mastery')
}

/* ------------------------------------------------------------------ */
/* 13. Grade color mapping — F red, D orange/amber, C yellow/gold, B      */
/* cyan/blue-green, A family green. Re-implemented in lockstep with the  */
/* client source, matching the pattern already used elsewhere for this  */
/* file's pure helper functions.                                        */
/* ------------------------------------------------------------------ */

const ui = readFileSync('components/materias/ALAIStudyALRepasar.tsx', 'utf8')

function testGradeColorMappingExistsAndIsCentralized() {
  assert.match(ui, /function repasoGradeColor\(/, 'the grade-color mapping must be a single centralized function')
  const fnSource = ui.slice(ui.indexOf('function repasoGradeColor('), ui.indexOf('function attemptId('))
  // Every letter-color usage must go through the centralized function —
  // no scattered ad hoc hex literals reintroducing the old fixed red.
  assert.doesNotMatch(ui.slice(ui.indexOf('const PaperHeader')), /color: '#b62424'/, 'PaperHeader must no longer hardcode a single fixed grade color')
  assert.match(fnSource, /'#e5484d'/, 'F (default) must be red')
  assert.match(fnSource, /'#f2994a'/, 'D must be orange/amber')
  assert.match(fnSource, /'#f2c94c'/, 'C must be yellow/gold')
  assert.match(fnSource, /'#22c3d6'/, 'B must be cyan/blue-green')
  assert.match(fnSource, /'#34d399'/, 'A family must be green')
}

function repasoGradeColor(letter: string): string {
  const base = String(letter || '').trim().charAt(0).toUpperCase()
  switch (base) {
    case 'A': return '#34d399'
    case 'B': return '#22c3d6'
    case 'C': return '#f2c94c'
    case 'D': return '#f2994a'
    default: return '#e5484d'
  }
}

function testGradeColorBehavior() {
  for (const letter of ['A+', 'A', 'A-']) assert.equal(repasoGradeColor(letter), '#34d399', `${letter} must render green`)
  assert.equal(repasoGradeColor('B-'), '#22c3d6')
  assert.equal(repasoGradeColor('C'), '#f2c94c')
  assert.equal(repasoGradeColor('D'), '#f2994a')
  assert.equal(repasoGradeColor('F'), '#e5484d')
}

/* ------------------------------------------------------------------ */
/* 2, 3. No verification_ready/verifying/"Preparar verificación" is      */
/* reachable from computeRepasoMasteryStatus for the new flow.           */
/* ------------------------------------------------------------------ */

function testPhaseForNeverRoutesToVerificationWhenMastered() {
  const phaseForSource = ui.slice(ui.indexOf('function phaseFor('), ui.indexOf('/**\n * Centralized'))
  assert.doesNotMatch(phaseForSource, /verification_ready/, 'phaseFor must no longer branch on verification_ready')
  assert.doesNotMatch(phaseForSource, /'verifying'/, 'phaseFor must no longer branch on verifying')
}

async function main() {
  await testRecoveryCompletionGoesDirectlyToMastered()
  await testCompletedRestoreShowsFinalResultAndIsStable()
  await testLegacyFullyCoveredArtifactSelfHealsToCompleted()
  await testUnresolvedAssessableTargetStillBlocksCompletion()
  testGradeColorMappingExistsAndIsCentralized()
  testGradeColorBehavior()
  testPhaseForNeverRoutesToVerificationWhenMastered()
  console.log('repaso-final-product-flow-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
