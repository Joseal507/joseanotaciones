import assert from 'node:assert/strict'
import type {
  RepasarReviewTarget,
  RepasarRelationContext,
  RepasarCoverageStatus,
} from '../../lib/materialBrain/reviewContext'
import {
  REPASO_ARTIFACT_SCHEMA_VERSION,
  createRepasoArtifact,
  buildRepasoRecoveryPlan,
  applyRecoveryAttempt,
  applyFinalVerificationResult,
  targetUniverseIsStable,
  rejectForgedTargetIds,
  partitionRecoveryResponse,
  allTargetsResolved,
  computeRepasoMasteryStatus,
  scoreCanReach100,
  isRepasoArtifact,
} from '../../lib/materialBrain/repasoArtifact'
import type {
  RepasoArtifact,
  RepasoTargetAdjudication,
  RepasoTargetState,
  RepasoRecoveryAttempt,
  RepasoFinalVerification,
  RepasoFinalVerificationCheck,
} from '../../lib/materialBrain/repasoArtifact'

/* ------------------------------------------------------------------ */
/*  Tiny test runner                                                  */
/* ------------------------------------------------------------------ */

let passed = 0
let failed = 0
const failures: string[] = []

function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e: any) {
    failed++
    failures.push(name)
    console.error(`  ✗ ${name}`)
    console.error(`    ${e.stack || e.message}`)
  }
}

/* ------------------------------------------------------------------ */
/*  Fixture builders                                                  */
/* ------------------------------------------------------------------ */

function makeTarget(overrides: Partial<RepasarReviewTarget> = {}): RepasarReviewTarget {
  return {
    id: 't1',
    unitId: 'u1',
    kind: 'concept',
    label: 'Test',
    statement: 'stmt',
    importanceTier: 'critical',
    difficulty: null,
    topicId: null,
    topicTitle: null,
    sourceOrder: 1,
    materialId: 'm1',
    page: 1,
    pages: [1],
    sourceSpans: [],
    derivation: null,
    evidenceText: 'ev',
    ...overrides,
  }
}

function makeAdj(overrides: Partial<RepasoTargetAdjudication> = {}): RepasoTargetAdjudication {
  return {
    targetId: 't1',
    status: 'missing',
    evidence: 'ev',
    demonstrated: 'dem',
    missingDetail: 'miss',
    ...overrides,
  }
}

function makeRelation(
  overrides: Partial<RepasarRelationContext> = {},
): RepasarRelationContext {
  return {
    id: 'r1',
    type: 'related',
    statement: 'rel',
    fromTargetId: 't1',
    toTargetId: 't2',
    ...overrides,
  }
}

function makeBasicArtifact(
  adjudications?: RepasoTargetAdjudication[],
): RepasoArtifact {
  return createRepasoArtifact({
    artifactId: 'art1',
    sessionId: 'sess1',
    snapshotId: 'snap1',
    fingerprint: 'fp1',
    explanation: 'The student explanation',
    createdAt: '2024-01-01T00:00:00Z',
    adjudications: adjudications ?? [
      makeAdj({ targetId: 't1', status: 'missing' }),
      makeAdj({ targetId: 't2', status: 'partial' }),
    ],
    initialScore: 30,
    initialLetterGrade: 'F',
  })
}

function makeArtifactWithPlan(): {
  artifact: RepasoArtifact
  targets: RepasarReviewTarget[]
  relations: RepasarRelationContext[]
} {
  const targets = [
    makeTarget({ id: 't1', materialId: 'm1', topicId: 'top1', sourceOrder: 1, page: 5 }),
    makeTarget({ id: 't2', materialId: 'm1', topicId: 'top1', sourceOrder: 2, page: 6 }),
    makeTarget({ id: 't3', materialId: 'm1', topicId: null, sourceOrder: 3, page: 10 }),
  ]
  const relations = [makeRelation({ id: 'r1', fromTargetId: 't2', toTargetId: 't3' })]
  const artifact = makeBasicArtifact([
    makeAdj({ targetId: 't1', status: 'missing' }),
    makeAdj({ targetId: 't2', status: 'partial' }),
    makeAdj({ targetId: 't3', status: 'incorrect' }),
  ])
  const plan = buildRepasoRecoveryPlan({
    planId: 'plan1',
    createdAt: '2024-01-01T01:00:00Z',
    targets,
    relations,
    currentTargetStates: artifact.currentTargetStates,
  })
  return { artifact: { ...artifact, recoveryPlan: plan }, targets, relations }
}

function makeArtifactWithVerification(): RepasoArtifact {
  const art = createRepasoArtifact({
    artifactId: 'art-v',
    sessionId: 'sess-v',
    snapshotId: 'snap-v',
    fingerprint: 'fp-v',
    explanation: 'verification explanation',
    createdAt: '2024-01-01T00:00:00Z',
    adjudications: [
      makeAdj({ targetId: 't1', status: 'covered' }),
      makeAdj({ targetId: 't2', status: 'covered' }),
    ],
    initialScore: 90,
    initialLetterGrade: 'A-',
  })
  const fv: RepasoFinalVerification = {
    verificationId: 'v1',
    createdAt: '2024-01-02T00:00:00Z',
    checks: [
      {
        checkId: 'c1',
        targetIds: ['t1', 't2'],
        question: 'Explain t1 and t2 from memory',
        questionProvenance: 'template',
        studentAnswer: null,
        adjudicatedTargetIds: [],
        adjudications: [],
        transitions: [],
        status: 'pending',
      },
    ],
    passed: false,
  }
  return { ...art, finalVerification: fv }
}

/* ================================================================== */
/*  TESTS                                                             */
/* ================================================================== */

console.log('\nRepaso Artifact Schema Contracts\n')

/* A */ test('A — schemaVersion is exact', () => {
  assert.equal(REPASO_ARTIFACT_SCHEMA_VERSION, '1.0.0')
})

/* B */ test('B — old legacy state rejected', () => {
  const legacy = { snapshotId: 'old', targets: [], noSchemaVersion: true }
  assert.equal(isRepasoArtifact(legacy), false)
})

/* C */ test('C — malformed new artifact rejected', () => {
  const bad = {
    schemaVersion: '1.0.0',
    artifactId: 'x',
  }
  assert.equal(isRepasoArtifact(bad), false)
})

/* D */ test('D — createRepasoArtifact builds exact target universe', () => {
  const art = makeBasicArtifact()
  assert.deepEqual(Object.keys(art.currentTargetStates).sort(), ['t1', 't2'])
  assert.deepEqual(
    Object.keys(art.initial.initialTargetStates).sort(),
    ['t1', 't2'],
  )
})

/* E */ test('E — duplicate initial adjudication targetId throws', () => {
  assert.throws(
    () =>
      createRepasoArtifact({
        artifactId: 'a',
        sessionId: 's',
        snapshotId: 'sn',
        fingerprint: 'fp',
        explanation: 'e',
        createdAt: '2024-01-01',
        adjudications: [
          makeAdj({ targetId: 't1' }),
          makeAdj({ targetId: 't1' }),
        ],
        initialScore: 0,
        initialLetterGrade: 'F',
      }),
    /REPASO_DUPLICATE_TARGET_ID/,
  )
})

/* F */ test('F — initialTargetStates and currentTargetStates do not share mutable objects', () => {
  const art = makeBasicArtifact()
  art.currentTargetStates['t1'].status = 'covered'
  assert.equal(art.initial.initialTargetStates['t1'].status, 'missing')
})

/* G */ test('G — target universe stability true for valid artifact', () => {
  assert.equal(targetUniverseIsStable(makeBasicArtifact()), true)
})

/* H */ test('H — target universe stability false if current target disappears', () => {
  const art = makeBasicArtifact()
  delete art.currentTargetStates['t2']
  assert.equal(targetUniverseIsStable(art), false)
})

/* I */ test('I — target universe stability false if forged target added', () => {
  const art = makeBasicArtifact()
  art.currentTargetStates['t99'] = makeAdj({ targetId: 't99' }) as any
  assert.equal(targetUniverseIsStable(art), false)
})

/* J */ test('J — rejectForgedTargetIds correct', () => {
  const known = new Set(['t1', 't2'])
  const result = rejectForgedTargetIds(known, ['t1', 't99', 't2', 't88'])
  assert.deepEqual(result.accepted, ['t1', 't2'])
  assert.deepEqual(result.rejected, ['t99', 't88'])
})

/* K */ test('K — partitionRecoveryResponse keeps unadjudicated', () => {
  const r = partitionRecoveryResponse(['t1', 't2', 't3'], ['t1'])
  assert.deepEqual(r.adjudicated, ['t1'])
  assert.deepEqual(r.stillUnadjudicated, ['t2', 't3'])
})

/* L */ test('L — recovery plan excludes covered', () => {
  const targets = [
    makeTarget({ id: 't1' }),
    makeTarget({ id: 't2' }),
  ]
  const art = makeBasicArtifact([
    makeAdj({ targetId: 't1', status: 'covered' }),
    makeAdj({ targetId: 't2', status: 'missing' }),
  ])
  const plan = buildRepasoRecoveryPlan({
    planId: 'p',
    createdAt: '2024-01-01',
    targets,
    relations: [],
    currentTargetStates: art.currentTargetStates,
  })
  const allIds = plan.groups.flatMap(g => g.targetIds)
  assert.ok(!allIds.includes('t1'))
  assert.ok(allIds.includes('t2'))
})

/* M */ test('M — recovery plan assigns every unresolved target exactly once', () => {
  const { artifact } = makeArtifactWithPlan()
  const allIds = artifact.recoveryPlan!.groups.flatMap(g => g.targetIds).sort()
  assert.deepEqual(allIds, ['t1', 't2', 't3'])
})

/* N */ test('N — recovery plan never crosses material IDs', () => {
  const targets = [
    makeTarget({ id: 't1', materialId: 'm1' }),
    makeTarget({ id: 't2', materialId: 'm2' }),
  ]
  const art = makeBasicArtifact([
    makeAdj({ targetId: 't1', status: 'missing' }),
    makeAdj({ targetId: 't2', status: 'missing' }),
  ])
  const plan = buildRepasoRecoveryPlan({
    planId: 'p',
    createdAt: '2024-01-01',
    targets,
    relations: [],
    currentTargetStates: art.currentTargetStates,
  })
  for (const g of plan.groups) {
    const mats = new Set(targets.filter(t => g.targetIds.includes(t.id)).map(t => t.materialId))
    assert.equal(mats.size, 1, `Group ${g.groupId} crosses materials`)
  }
})

/* O */ test('O — same topic grouping works', () => {
  const { artifact } = makeArtifactWithPlan()
  const topicGroup = artifact.recoveryPlan!.groups.find(
    g => g.groupingRationale.kind === 'topic',
  )
  assert.ok(topicGroup, 'Expected a topic group')
  assert.ok(topicGroup!.targetIds.includes('t1'))
  assert.ok(topicGroup!.targetIds.includes('t2'))
})

/* P */ test('P — relation grouping only connects no-topic compatible targets', () => {
  const targets = [
    makeTarget({ id: 't1', materialId: 'm1', topicId: null }),
    makeTarget({ id: 't2', materialId: 'm1', topicId: null }),
  ]
  const relations = [makeRelation({ fromTargetId: 't1', toTargetId: 't2' })]
  const art = makeBasicArtifact([
    makeAdj({ targetId: 't1', status: 'missing' }),
    makeAdj({ targetId: 't2', status: 'missing' }),
  ])
  const plan = buildRepasoRecoveryPlan({
    planId: 'p',
    createdAt: '2024-01-01',
    targets,
    relations,
    currentTargetStates: art.currentTargetStates,
  })
  assert.equal(plan.groups.length, 1)
  assert.equal(plan.groups[0].groupingRationale.kind, 'relation')
})

/* Q */ test('Q — different explicit topicIds are not merged via relation', () => {
  const targets = [
    makeTarget({ id: 't1', materialId: 'm1', topicId: 'topA' }),
    makeTarget({ id: 't2', materialId: 'm1', topicId: 'topB' }),
  ]
  const relations = [makeRelation({ fromTargetId: 't1', toTargetId: 't2' })]
  const art = makeBasicArtifact([
    makeAdj({ targetId: 't1', status: 'missing' }),
    makeAdj({ targetId: 't2', status: 'missing' }),
  ])
  const plan = buildRepasoRecoveryPlan({
    planId: 'p',
    createdAt: '2024-01-01',
    targets,
    relations,
    currentTargetStates: art.currentTargetStates,
  })
  assert.equal(plan.groups.length, 2, 'Different topics must not merge')
})

/* R */ test('R — maxGroupSize respected', () => {
  const targets = Array.from({ length: 7 }, (_, i) =>
    makeTarget({ id: `t${i}`, materialId: 'm1', topicId: 'top1', sourceOrder: i }),
  )
  const adjs = targets.map(t => makeAdj({ targetId: t.id, status: 'missing' as const }))
  const art = createRepasoArtifact({
    artifactId: 'a', sessionId: 's', snapshotId: 'sn', fingerprint: 'fp',
    explanation: 'e', createdAt: '2024-01-01', adjudications: adjs,
    initialScore: 0, initialLetterGrade: 'F',
  })
  const plan = buildRepasoRecoveryPlan({
    planId: 'p', createdAt: '2024-01-01', targets, relations: [],
    currentTargetStates: art.currentTargetStates, maxGroupSize: 3,
  })
  for (const g of plan.groups) {
    assert.ok(g.targetIds.length <= 3, `Group ${g.groupId} has ${g.targetIds.length} targets`)
  }
  const allIds = plan.groups.flatMap(g => g.targetIds).sort()
  assert.deepEqual(allIds, targets.map(t => t.id).sort())
})

/* S */ test('S — recovery group pages are deduped and sorted', () => {
  const targets = [
    makeTarget({ id: 't1', materialId: 'm1', page: 10, pages: [10, 5] }),
    makeTarget({ id: 't2', materialId: 'm1', page: 5, pages: [5, 10, 3] }),
  ]
  const art = makeBasicArtifact([
    makeAdj({ targetId: 't1', status: 'missing' }),
    makeAdj({ targetId: 't2', status: 'missing' }),
  ])
  const plan = buildRepasoRecoveryPlan({
    planId: 'p', createdAt: '2024-01-01', targets, relations: [],
    currentTargetStates: art.currentTargetStates,
  })
  assert.deepEqual(plan.groups[0].pages, [3, 5, 10])
})

/* T */ test('T — recovery group IDs/order deterministic across repeated calls', () => {
  const targets = [
    makeTarget({ id: 't1', materialId: 'm1', sourceOrder: 2 }),
    makeTarget({ id: 't2', materialId: 'm1', sourceOrder: 1 }),
  ]
  const art = makeBasicArtifact([
    makeAdj({ targetId: 't1', status: 'missing' }),
    makeAdj({ targetId: 't2', status: 'missing' }),
  ])
  const args = {
    planId: 'p', createdAt: '2024-01-01', targets, relations: [] as RepasarRelationContext[],
    currentTargetStates: art.currentTargetStates,
  }
  const p1 = buildRepasoRecoveryPlan(args)
  const p2 = buildRepasoRecoveryPlan(args)
  assert.deepEqual(
    p1.groups.map(g => g.groupId),
    p2.groups.map(g => g.groupId),
  )
})

/* U */ test('U — applyRecoveryAttempt updates only adjudicated targets', () => {
  const { artifact } = makeArtifactWithPlan()
  const group = artifact.recoveryPlan!.groups.find(g => g.targetIds.includes('t1'))!
  const attempt: RepasoRecoveryAttempt = {
    attemptId: 'att1', groupId: group.groupId, createdAt: '2024-01-02',
    answer: 'my answer', requestedTargetIds: ['t1'], adjudicatedTargetIds: ['t1'],
    adjudications: [makeAdj({ targetId: 't1', status: 'partial', evidence: 'new-ev' })],
    transitions: [{ targetId: 't1', before: 'missing', after: 'partial' }],
    scoreBefore: 30, scoreAfter: 45, letterBefore: 'F', letterAfter: 'F',
  }
  const next = applyRecoveryAttempt(artifact, attempt)
  assert.equal(next.currentTargetStates['t1'].status, 'partial')
  assert.equal(next.currentTargetStates['t2'].status, 'partial')
})

/* V */ test('V — recovery attempt preserves exact answer', () => {
  const { artifact } = makeArtifactWithPlan()
  const group = artifact.recoveryPlan!.groups.find(g => g.targetIds.includes('t1'))!
  const attempt: RepasoRecoveryAttempt = {
    attemptId: 'att1', groupId: group.groupId, createdAt: '2024-01-02',
    answer: 'exact student text with ñ and ü',
    requestedTargetIds: ['t1'], adjudicatedTargetIds: ['t1'],
    adjudications: [makeAdj({ targetId: 't1', status: 'partial' })],
    transitions: [{ targetId: 't1', before: 'missing', after: 'partial' }],
    scoreBefore: 30, scoreAfter: 40, letterBefore: 'F', letterAfter: 'F',
  }
  const next = applyRecoveryAttempt(artifact, attempt)
  assert.equal(next.recoveryAttempts[0].answer, 'exact student text with ñ and ü')
})

/* W */ test('W — recovery attempt preserves exact canonical evidence/demonstrated/missingDetail', () => {
  const { artifact } = makeArtifactWithPlan()
  const group = artifact.recoveryPlan!.groups.find(g => g.targetIds.includes('t1'))!
  const adj = makeAdj({
    targetId: 't1', status: 'covered',
    evidence: 'ev-xyz', demonstrated: 'dem-xyz', missingDetail: '',
  })
  const attempt: RepasoRecoveryAttempt = {
    attemptId: 'att1', groupId: group.groupId, createdAt: '2024-01-02',
    answer: 'a', requestedTargetIds: ['t1'], adjudicatedTargetIds: ['t1'],
    adjudications: [adj],
    transitions: [{ targetId: 't1', before: 'missing', after: 'covered' }],
    scoreBefore: 30, scoreAfter: 60, letterBefore: 'F', letterAfter: 'D',
  }
  const next = applyRecoveryAttempt(artifact, attempt)
  assert.equal(next.currentTargetStates['t1'].evidence, 'ev-xyz')
  assert.equal(next.currentTargetStates['t1'].demonstrated, 'dem-xyz')
  assert.equal(next.currentTargetStates['t1'].missingDetail, '')
})

/* X */ test('X — recovery attempt increments recoveryAttemptCount only for adjudicated', () => {
  const { artifact } = makeArtifactWithPlan()
  const group = artifact.recoveryPlan!.groups.find(g => g.targetIds.includes('t1'))!
  const attempt: RepasoRecoveryAttempt = {
    attemptId: 'att1', groupId: group.groupId, createdAt: '2024-01-02',
    answer: 'a', requestedTargetIds: group.targetIds, adjudicatedTargetIds: ['t1'],
    adjudications: [makeAdj({ targetId: 't1', status: 'partial' })],
    transitions: [{ targetId: 't1', before: 'missing', after: 'partial' }],
    scoreBefore: 30, scoreAfter: 40, letterBefore: 'F', letterAfter: 'F',
  }
  const next = applyRecoveryAttempt(artifact, attempt)
  assert.equal(next.currentTargetStates['t1'].recoveryAttemptCount, 1)
  const other = group.targetIds.find(id => id !== 't1')
  if (other) {
    assert.equal(next.currentTargetStates[other].recoveryAttemptCount, 0)
  }
})

/* Y */ test('Y — unadjudicated requested target remains unchanged', () => {
  const { artifact } = makeArtifactWithPlan()
  const group = artifact.recoveryPlan!.groups.find(g => g.targetIds.includes('t1'))!
  const reqIds = group.targetIds
  const attempt: RepasoRecoveryAttempt = {
    attemptId: 'att1', groupId: group.groupId, createdAt: '2024-01-02',
    answer: 'a', requestedTargetIds: reqIds, adjudicatedTargetIds: ['t1'],
    adjudications: [makeAdj({ targetId: 't1', status: 'partial' })],
    transitions: [{ targetId: 't1', before: 'missing', after: 'partial' }],
    scoreBefore: 30, scoreAfter: 40, letterBefore: 'F', letterAfter: 'F',
  }
  const next = applyRecoveryAttempt(artifact, attempt)
  for (const id of reqIds) {
    if (id !== 't1') {
      assert.equal(
        next.currentTargetStates[id].status,
        artifact.currentTargetStates[id].status,
      )
    }
  }
})

/* Z */ test('Z — recovery attempt cannot touch target outside group', () => {
  const { artifact } = makeArtifactWithPlan()
  const group = artifact.recoveryPlan!.groups.find(g => g.targetIds.includes('t1'))!
  const outsideId = artifact.recoveryPlan!.groups
    .flatMap(g => g.targetIds)
    .find(id => !group.targetIds.includes(id))
  if (!outsideId) return
  assert.throws(
    () =>
      applyRecoveryAttempt(artifact, {
        attemptId: 'att1', groupId: group.groupId, createdAt: '2024-01-02',
        answer: 'a', requestedTargetIds: [outsideId], adjudicatedTargetIds: [outsideId],
        adjudications: [makeAdj({ targetId: outsideId, status: 'partial' })],
        transitions: [{ targetId: outsideId, before: 'missing', after: 'partial' }],
        scoreBefore: 30, scoreAfter: 40, letterBefore: 'F', letterAfter: 'F',
      }),
    /REPASO_TARGET_OUTSIDE_GROUP/,
  )
})

/* AA */ test('AA — recovery attempt cannot request already-covered target', () => {
  const art = createRepasoArtifact({
    artifactId: 'a', sessionId: 's', snapshotId: 'sn', fingerprint: 'fp',
    explanation: 'e', createdAt: '2024-01-01',
    adjudications: [
      makeAdj({ targetId: 't1', status: 'missing' }),
      makeAdj({ targetId: 't2', status: 'missing' }),
    ],
    initialScore: 0, initialLetterGrade: 'F',
  })
  const targets = [
    makeTarget({ id: 't1', materialId: 'm1', topicId: 'top1' }),
    makeTarget({ id: 't2', materialId: 'm1', topicId: 'top1' }),
  ]
  const plan = buildRepasoRecoveryPlan({
    planId: 'p', createdAt: '2024-01-01', targets, relations: [],
    currentTargetStates: art.currentTargetStates,
  })
  let artWithPlan = { ...art, recoveryPlan: plan }
  const group = plan.groups.find(g => g.targetIds.includes('t1'))!
  // First: cover t1 via recovery
  artWithPlan = applyRecoveryAttempt(artWithPlan, {
    attemptId: 'att1', groupId: group.groupId, createdAt: '2024-01-02',
    answer: 'a', requestedTargetIds: ['t1'], adjudicatedTargetIds: ['t1'],
    adjudications: [makeAdj({ targetId: 't1', status: 'covered' })],
    transitions: [{ targetId: 't1', before: 'missing', after: 'covered' }],
    scoreBefore: 0, scoreAfter: 50, letterBefore: 'F', letterAfter: 'F',
  })
  // Second: try to request t1 again (now covered) in same group
  assert.throws(
    () =>
      applyRecoveryAttempt(artWithPlan, {
        attemptId: 'att2', groupId: group.groupId, createdAt: '2024-01-03',
        answer: 'b', requestedTargetIds: ['t1'], adjudicatedTargetIds: ['t1'],
        adjudications: [makeAdj({ targetId: 't1', status: 'covered' })],
        transitions: [{ targetId: 't1', before: 'covered', after: 'covered' }],
        scoreBefore: 50, scoreAfter: 100, letterBefore: 'F', letterAfter: 'A+',
      }),
    /REPASO_ALREADY_COVERED_TARGET/,
  )
})

/* AB */ test('AB — recovery is monotonic: covered cannot downgrade', () => {
  const art = createRepasoArtifact({
    artifactId: 'a', sessionId: 's', snapshotId: 'sn', fingerprint: 'fp',
    explanation: 'e', createdAt: '2024-01-01',
    adjudications: [makeAdj({ targetId: 't1', status: 'covered' })],
    initialScore: 100, initialLetterGrade: 'A+',
  })
  const targets = [makeTarget({ id: 't1' })]
  const plan = buildRepasoRecoveryPlan({
    planId: 'p', createdAt: '2024-01-01', targets, relations: [],
    currentTargetStates: art.currentTargetStates,
  })
  assert.equal(plan.groups.length, 0)
})

/* AC */ test('AC — recovery attempt append-only: first attempt unchanged after second', () => {
  const { artifact } = makeArtifactWithPlan()
  const group = artifact.recoveryPlan!.groups.find(g => g.targetIds.includes('t1'))!
  const a1: RepasoRecoveryAttempt = {
    attemptId: 'att1', groupId: group.groupId, createdAt: '2024-01-02',
    answer: 'first', requestedTargetIds: ['t1'], adjudicatedTargetIds: ['t1'],
    adjudications: [makeAdj({ targetId: 't1', status: 'partial' })],
    transitions: [{ targetId: 't1', before: 'missing', after: 'partial' }],
    scoreBefore: 30, scoreAfter: 40, letterBefore: 'F', letterAfter: 'F',
  }
  const after1 = applyRecoveryAttempt(artifact, a1)
  const a2: RepasoRecoveryAttempt = {
    attemptId: 'att2', groupId: group.groupId, createdAt: '2024-01-03',
    answer: 'second', requestedTargetIds: ['t1'], adjudicatedTargetIds: ['t1'],
    adjudications: [makeAdj({ targetId: 't1', status: 'covered', evidence: 'new' })],
    transitions: [{ targetId: 't1', before: 'partial', after: 'covered' }],
    scoreBefore: 40, scoreAfter: 70, letterBefore: 'F', letterAfter: 'C-',
  }
  const after2 = applyRecoveryAttempt(after1, a2)
  assert.equal(after2.recoveryAttempts.length, 2)
  assert.equal(after2.recoveryAttempts[0].answer, 'first')
  assert.equal(after2.recoveryAttempts[0].attemptId, 'att1')
})

/* AD */ test('AD — scoreHistory appends without becoming target-state authority', () => {
  const art = makeBasicArtifact()
  assert.equal(art.scoreHistory.length, 1)
  assert.equal(art.scoreHistory[0].cause, 'initial')
  assert.equal(art.currentTargetStates['t1'].status, 'missing')
})

/* AE */ test('AE — initial snapshot remains unchanged after recovery', () => {
  const { artifact } = makeArtifactWithPlan()
  const group = artifact.recoveryPlan!.groups.find(g => g.targetIds.includes('t1'))!
  const attempt: RepasoRecoveryAttempt = {
    attemptId: 'att1', groupId: group.groupId, createdAt: '2024-01-02',
    answer: 'a', requestedTargetIds: ['t1'], adjudicatedTargetIds: ['t1'],
    adjudications: [makeAdj({ targetId: 't1', status: 'covered' })],
    transitions: [{ targetId: 't1', before: 'missing', after: 'covered' }],
    scoreBefore: 30, scoreAfter: 60, letterBefore: 'F', letterAfter: 'D',
  }
  const next = applyRecoveryAttempt(artifact, attempt)
  assert.equal(next.initial.initialTargetStates['t1'].status, 'missing')
  assert.equal(next.initial.explanation, 'The student explanation')
})

/* AF */ test('AF — final verification can downgrade covered target in frozen check', () => {
  const art = makeArtifactWithVerification()
  const result = applyFinalVerificationResult(art, {
    verificationId: 'v1', checkId: 'c1',
    studentAnswer: 'I forgot',
    adjudicatedTargetIds: ['t1'],
    adjudications: [makeAdj({ targetId: 't1', status: 'partial', evidence: 'weak' })],
    transitions: [{ targetId: 't1', before: 'covered', after: 'partial' }],
    status: 'failed',
    scoreBefore: 90, scoreAfter: 70, letterBefore: 'A-', letterAfter: 'C-',
    createdAt: '2024-01-03', attemptId: 'fv-att1',
  })
  assert.equal(result.currentTargetStates['t1'].status, 'partial')
})

/* AG */ test('AG — final verification stores exact studentAnswer', () => {
  const art = makeArtifactWithVerification()
  const result = applyFinalVerificationResult(art, {
    verificationId: 'v1', checkId: 'c1',
    studentAnswer: 'respuesta exacta del estudiante',
    adjudicatedTargetIds: ['t1', 't2'],
    adjudications: [
      makeAdj({ targetId: 't1', status: 'covered' }),
      makeAdj({ targetId: 't2', status: 'covered' }),
    ],
    transitions: [
      { targetId: 't1', before: 'covered', after: 'covered' },
      { targetId: 't2', before: 'covered', after: 'covered' },
    ],
    status: 'passed',
    scoreBefore: 90, scoreAfter: 95, letterBefore: 'A-', letterAfter: 'A',
    createdAt: '2024-01-03', attemptId: 'fv-att1',
  })
  assert.equal(
    result.finalVerification!.checks[0].studentAnswer,
    'respuesta exacta del estudiante',
  )
})

/* AH */ test('AH — final verification stores accepted adjudications', () => {
  const art = makeArtifactWithVerification()
  const result = applyFinalVerificationResult(art, {
    verificationId: 'v1', checkId: 'c1',
    studentAnswer: 'ok',
    adjudicatedTargetIds: ['t1'],
    adjudications: [makeAdj({ targetId: 't1', status: 'covered', evidence: 'ev-fv' })],
    transitions: [{ targetId: 't1', before: 'covered', after: 'covered' }],
    status: 'passed',
    scoreBefore: 90, scoreAfter: 90, letterBefore: 'A-', letterAfter: 'A-',
    createdAt: '2024-01-03', attemptId: 'fv-att1',
  })
  assert.equal(result.finalVerification!.checks[0].adjudications.length, 1)
  assert.equal(result.finalVerification!.checks[0].adjudications[0].evidence, 'ev-fv')
})

/* AI */ test('AI — final verification cannot replace frozen question', () => {
  const art = makeArtifactWithVerification()
  const result = applyFinalVerificationResult(art, {
    verificationId: 'v1', checkId: 'c1',
    studentAnswer: 'ok',
    adjudicatedTargetIds: ['t1'],
    adjudications: [makeAdj({ targetId: 't1', status: 'covered' })],
    transitions: [{ targetId: 't1', before: 'covered', after: 'covered' }],
    status: 'passed',
    scoreBefore: 90, scoreAfter: 90, letterBefore: 'A-', letterAfter: 'A-',
    createdAt: '2024-01-03', attemptId: 'fv-att1',
  })
  assert.equal(
    result.finalVerification!.checks[0].question,
    'Explain t1 and t2 from memory',
  )
})

/* AJ */ test('AJ — final verification cannot replace frozen targetIds', () => {
  const art = makeArtifactWithVerification()
  const result = applyFinalVerificationResult(art, {
    verificationId: 'v1', checkId: 'c1',
    studentAnswer: 'ok',
    adjudicatedTargetIds: ['t1'],
    adjudications: [makeAdj({ targetId: 't1', status: 'covered' })],
    transitions: [{ targetId: 't1', before: 'covered', after: 'covered' }],
    status: 'passed',
    scoreBefore: 90, scoreAfter: 90, letterBefore: 'A-', letterAfter: 'A-',
    createdAt: '2024-01-03', attemptId: 'fv-att1',
  })
  assert.deepEqual(result.finalVerification!.checks[0].targetIds, ['t1', 't2'])
})

/* AK */ test('AK — finalVerification.passed only true when all non-empty checks passed', () => {
  const art = makeArtifactWithVerification()
  const result = applyFinalVerificationResult(art, {
    verificationId: 'v1', checkId: 'c1',
    studentAnswer: 'ok',
    adjudicatedTargetIds: ['t1', 't2'],
    adjudications: [
      makeAdj({ targetId: 't1', status: 'covered' }),
      makeAdj({ targetId: 't2', status: 'covered' }),
    ],
    transitions: [
      { targetId: 't1', before: 'covered', after: 'covered' },
      { targetId: 't2', before: 'covered', after: 'covered' },
    ],
    status: 'passed',
    scoreBefore: 90, scoreAfter: 100, letterBefore: 'A-', letterAfter: 'A+',
    createdAt: '2024-01-03', attemptId: 'fv-att1',
  })
  assert.equal(result.finalVerification!.passed, true)
})

/* AL */ test('AL — allTargetsResolved false for partial, missing, incorrect', () => {
  const art1 = makeBasicArtifact([makeAdj({ targetId: 't1', status: 'partial' })])
  assert.equal(allTargetsResolved(art1.currentTargetStates), false)

  const art2 = makeBasicArtifact([makeAdj({ targetId: 't1', status: 'missing' })])
  assert.equal(allTargetsResolved(art2.currentTargetStates), false)

  const art3 = makeBasicArtifact([makeAdj({ targetId: 't1', status: 'incorrect' })])
  assert.equal(allTargetsResolved(art3.currentTargetStates), false)
})

/* AM */ test('AM — allTargetsResolved true only when all covered', () => {
  const art = makeBasicArtifact([
    makeAdj({ targetId: 't1', status: 'covered' }),
    makeAdj({ targetId: 't2', status: 'covered' }),
  ])
  assert.equal(allTargetsResolved(art.currentTargetStates), true)
  assert.equal(scoreCanReach100(art.currentTargetStates), true)
})

/* AN */ test('AN — computeRepasoMasteryStatus unresolved -> not_ready', () => {
  const art = makeBasicArtifact()
  const status = computeRepasoMasteryStatus(art.currentTargetStates, art.finalVerification)
  assert.equal(status, 'not_ready')
})

/* AO */ test('AO — FINAL PRODUCT FLOW: all covered + no verification -> mastered directly', () => {
  // Final Verification is retired from the active flow — Recovery
  // completion IS the final result now, with no intermediate gate.
  const art = makeBasicArtifact([
    makeAdj({ targetId: 't1', status: 'covered' }),
    makeAdj({ targetId: 't2', status: 'covered' }),
  ])
  const status = computeRepasoMasteryStatus(art.currentTargetStates, null)
  assert.equal(status, 'mastered')
})

/* AP */ test('AP — FINAL PRODUCT FLOW: all covered + a legacy pending check is ignored -> mastered', () => {
  // A legacy artifact's finalVerification data (even mid-verification)
  // no longer blocks or changes the completion verdict.
  const art = makeArtifactWithVerification()
  const status = computeRepasoMasteryStatus(art.currentTargetStates, art.finalVerification)
  assert.equal(status, 'mastered')
})

/* AQ */ test('AQ — all covered + passed non-empty verification -> mastered', () => {
  const art = makeArtifactWithVerification()
  const resolved = applyFinalVerificationResult(art, {
    verificationId: 'v1', checkId: 'c1',
    studentAnswer: 'ok',
    adjudicatedTargetIds: ['t1', 't2'],
    adjudications: [
      makeAdj({ targetId: 't1', status: 'covered' }),
      makeAdj({ targetId: 't2', status: 'covered' }),
    ],
    transitions: [
      { targetId: 't1', before: 'covered', after: 'covered' },
      { targetId: 't2', before: 'covered', after: 'covered' },
    ],
    status: 'passed',
    scoreBefore: 90, scoreAfter: 100, letterBefore: 'A-', letterAfter: 'A+',
    createdAt: '2024-01-03', attemptId: 'fv-att1',
  })
  const status = computeRepasoMasteryStatus(
    resolved.currentTargetStates,
    resolved.finalVerification,
  )
  assert.equal(status, 'mastered')
})

/* AR */ test('AR — failed verification -> verification_ready', () => {
  const art = makeArtifactWithVerification()
  const resolved = applyFinalVerificationResult(art, {
    verificationId: 'v1', checkId: 'c1',
    studentAnswer: 'I forgot',
    adjudicatedTargetIds: ['t1'],
    adjudications: [
      makeAdj({ targetId: 't1', status: 'incorrect' }),
    ],
    transitions: [
      { targetId: 't1', before: 'covered', after: 'incorrect' },
    ],
    status: 'failed',
    scoreBefore: 90, scoreAfter: 50, letterBefore: 'A-', letterAfter: 'F',
    createdAt: '2024-01-03', attemptId: 'fv-att1',
  })
  const status = computeRepasoMasteryStatus(
    resolved.currentTargetStates,
    resolved.finalVerification,
  )
  assert.equal(status, 'not_ready')
})

/* AS */ test('AS — FINAL PRODUCT FLOW: verification data of any shape never blocks mastered', () => {
  const art = makeBasicArtifact([
    makeAdj({ targetId: 't1', status: 'covered' }),
    makeAdj({ targetId: 't2', status: 'covered' }),
  ])
  const emptyFv: RepasoFinalVerification = {
    verificationId: 'v1',
    createdAt: '2024-01-02',
    checks: [],
    passed: true,
  }
  const status = computeRepasoMasteryStatus(art.currentTargetStates, emptyFv)
  assert.equal(status, 'mastered')
})

/* AT */ test('AT — initial Paper provenance remains exact student explanation', () => {
  const art = makeBasicArtifact()
  assert.equal(art.initial.explanation, 'The student explanation')
})

/* ------------------------------------------------------------------ */
/*  Summary                                                           */
/* ------------------------------------------------------------------ */

console.log(`\nTest results: ${passed} passed, ${failed} failed\n`)
if (failures.length > 0) {
  console.error('Failed tests:', failures)
  process.exit(1)
} else {
  console.log('All contracts and invariants verified successfully.')
  process.exit(0)
}
