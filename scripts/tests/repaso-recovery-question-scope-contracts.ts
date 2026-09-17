import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  POST,
  __routeDeps,
  deriveAssessedTargetIds,
  resolveRepasoAssessedTargetIds,
  projectRepasoRecoveryFeedback,
} from '../../app/api/alai-studyal-repasar/route'

/* ------------------------------------------------------------------ */
/* Unit: deriveAssessedTargetIds — distinctive-term text matching       */
/* ------------------------------------------------------------------ */

const target = (id: string, label: string, statement = label) => ({ id, label, statement } as any)

function testSingleTargetAlwaysAssessed() {
  const t = target('direct', 'Reacción directa y su ley de velocidad')
  const assessed = deriveAssessedTargetIds('Explica, según el material: Reacción directa y su ley de velocidad.', [t])
  assert.deepEqual(assessed, ['direct'])
}

function testNarrowQuestionAssessesOnlyMatchingTarget() {
  // Reproduces the EXACT live shape: a question phrased only about the
  // direct reaction must not silently assess its near-duplicate-labeled
  // siblings just because they share generic words like "reacción"/"velocidad".
  const targets = [
    target('direct', 'Reacción directa y su ley de velocidad', 'La reacción directa transforma N2O4 en NO2.'),
    target('inverse', 'Reacción inversa y su ley de velocidad', 'La reacción inversa regenera N2O4.'),
    target('relation', 'Expresión de la relación de constantes de velocidad', 'kf/kr = [NO2]^2/[N2O4].'),
    target('keq', 'Definición de la constante de equilibrio (Keq)', 'Keq = kf/kr.'),
  ]
  const assessed = deriveAssessedTargetIds('Explica, según el material: Reacción directa y su ley de velocidad.', targets)
  assert.deepEqual(assessed, ['direct'], 'only the target whose DISTINCTIVE terms appear in the question text is assessed')
}

function testMultiTargetQuestionAssessesBothWhenWordingExposesThem() {
  const targets = [
    target('direct', 'Reacción directa y su ley de velocidad', 'La reacción directa transforma N2O4 en NO2.'),
    target('inverse', 'Reacción inversa y su ley de velocidad', 'La reacción inversa regenera N2O4.'),
  ]
  const assessed = deriveAssessedTargetIds(
    'Explica, según el material: Reacción directa y su ley de velocidad y Reacción inversa y su ley de velocidad.',
    targets,
  )
  assert.deepEqual(assessed.sort(), ['direct', 'inverse'].sort(), 'a question that names both targets by their distinctive terms assesses both')
}

function testFallbackNeverEmpty() {
  const t = target('x', 'Algo', 'Algo')
  const assessed = deriveAssessedTargetIds('¿Qué aprendiste?', [t])
  assert.deepEqual(assessed, ['x'], 'a fully generic question with a single candidate target still falls back to that target rather than an empty scope')
}

/* ------------------------------------------------------------------ */
/* Unit: resolveRepasoAssessedTargetIds — backward compatibility        */
/* ------------------------------------------------------------------ */

function testResolvePrefersPersistedField() {
  const group = { targetIds: ['a', 'b'], question: 'Explica A y B.', assessedTargetIds: ['a'] } as any
  const resolved = resolveRepasoAssessedTargetIds(group, [target('a', 'A'), target('b', 'B')])
  assert.deepEqual([...resolved], ['a'], 'a persisted assessedTargetIds field is trusted directly, never re-derived')
}

function testResolveDerivesFromQuestionWhenFieldMissing() {
  // Simulates an OLD persisted group from before this field existed.
  const group = { targetIds: ['direct', 'inverse'], question: 'Explica, según el material: Reacción directa y su ley de velocidad.' } as any
  const targets = [
    target('direct', 'Reacción directa y su ley de velocidad', 'La reacción directa transforma N2O4 en NO2.'),
    target('inverse', 'Reacción inversa y su ley de velocidad', 'La reacción inversa regenera N2O4.'),
  ]
  const resolved = resolveRepasoAssessedTargetIds(group, targets)
  assert.deepEqual([...resolved], ['direct'], 'legacy groups derive scope deterministically from the already-frozen question — no provider call, no migration write')
}

function testResolveUnopenedGroupHasNoScope() {
  const group = { targetIds: ['a'], question: '' } as any
  const resolved = resolveRepasoAssessedTargetIds(group, [target('a', 'A')])
  assert.equal(resolved.size, 0)
}

/* ------------------------------------------------------------------ */
/* Unit: feedback scoping via assessedTargetIds                        */
/* ------------------------------------------------------------------ */

const baseAttempt = {
  attemptId: 'a1', groupId: 'g1', createdAt: 'now', answer: 'x',
  requestedTargetIds: [], adjudicatedTargetIds: [], transitions: [],
  scoreBefore: 8, scoreAfter: 9, letterBefore: 'F', letterAfter: 'F',
} as any

function testHiddenSiblingCannotBlockFeedback() {
  const targets = [
    target('direct', 'Reacción directa y su ley de velocidad'),
    target('inverse', 'Reacción inversa y su ley de velocidad'),
    target('relation', 'Expresión de la relación de constantes de velocidad'),
    target('keq', 'Definición de la constante de equilibrio (Keq)'),
  ]
  const adjudications = [
    { targetId: 'direct', status: 'covered', evidence: 'e', demonstrated: 'Explicó correctamente N2O4 -> 2NO2 y v = kf[N2O4].', missingDetail: '' },
    { targetId: 'inverse', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
    { targetId: 'relation', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
    { targetId: 'keq', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
  ]
  const assessed = new Set(['direct'])
  const feedback = projectRepasoRecoveryFeedback({ ...baseAttempt, adjudications }, targets, [7], assessed)
  assert.equal(feedback.status, 'correct', 'the answered question resolves independently of unassessed siblings')
  assert.equal(feedback.title, 'Excelente')
  assert.equal(feedback.groupResolved, true)
  assert.equal(feedback.needsWork.length, 0, 'hidden siblings must never appear as blocking gaps')
  assert.ok(!feedback.needsWork.some(item => item.includes('constantes') || item.includes('Keq')))
}

function testHiddenSiblingCannotBeFalselyCovered() {
  // Verified at the route/artifact level below (testLiveQuestionScopeRegression);
  // this unit test only checks the feedback layer never CLAIMS a sibling as
  // "didWell" when it wasn't part of the assessed scope.
  const targets = [target('direct', 'Reacción directa'), target('keq', 'Keq')]
  const adjudications = [
    { targetId: 'direct', status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' },
    { targetId: 'keq', status: 'covered', evidence: 'e', demonstrated: 'algo sobre Keq', missingDetail: '' },
  ]
  const assessed = new Set(['direct'])
  const feedback = projectRepasoRecoveryFeedback({ ...baseAttempt, adjudications }, targets, [7], assessed)
  assert.ok(!feedback.didWell.some(item => item.toLowerCase().includes('keq')), 'a target outside assessed scope is never presented as part of what THIS question resolved')
}

/* ------------------------------------------------------------------ */
/* Live-shaped end-to-end regression                                  */
/* ------------------------------------------------------------------ */

function liveFixture() {
  const directQuote = 'La reacción directa transforma N2O4 en NO2 según la ley de velocidad v = kf[N2O4].'
  const inverseQuote = 'La reacción inversa regenera N2O4 a partir de NO2 según la ley de velocidad del sistema.'
  const relationQuote = 'La expresión de la relación de constantes de velocidad conecta kf y kr con Keq mediante kf/kr = [NO2]^2/[N2O4].'
  const keqQuote = 'La definición de la constante de equilibrio Keq caracteriza la composición del sistema en equilibrio.'
  const targets = [
    { id: 'concept_reaccion_directa_y_su_ley_de_velocidad', kind: 'concept', name: 'Reacción directa y su ley de velocidad', summary: directQuote, importance: 90, materialId: 'mat-x', pages: [7], sourceSpans: [{ page: 7, quote: directQuote }], topicId: 'topic-1', globalOrder: 0 },
    { id: 'concept_reaccion_inversa_y_su_ley_de_velocidad', kind: 'concept', name: 'Reacción inversa y su ley de velocidad', summary: inverseQuote, importance: 85, materialId: 'mat-x', pages: [7], sourceSpans: [{ page: 7, quote: inverseQuote }], topicId: 'topic-1', globalOrder: 1 },
    { id: 'formula_expresion_de_la_relacion_de_constantes_d', kind: 'formula', name: 'Expresión de la relación de constantes de velocidad', summary: relationQuote, importance: 80, materialId: 'mat-x', pages: [7], sourceSpans: [{ page: 7, quote: relationQuote }], topicId: 'topic-1', globalOrder: 2 },
    { id: 'def_definicion_de_la_constante_de_equilibrio', kind: 'concept', name: 'Definición de la constante de equilibrio (Keq)', summary: keqQuote, importance: 75, materialId: 'mat-x', pages: [7], sourceSpans: [{ page: 7, quote: keqQuote }], topicId: 'topic-1', globalOrder: 3 },
  ]
  const selection = buildSourceSelectionSnapshot(['mat-x'], { 'mat-x': [7] })
  return {
    selection, targets,
    payload: {
      sourceSelectionFingerprint: selection.fingerprint,
      topicsIndex: [{ id: 'topic-1', title: 'Equilibrio', order: 0 }],
      globalOrderedAnalysis: targets,
      uniqueConceptsIndex: [],
    },
  }
}

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

function initialCoverageMock(targets: any[]) {
  return async ({ telemetryContext }: any) => {
    if (telemetryContext?.phase === 'analysis_batch') {
      return { targetCoverage: targets.map(t => ({ targetId: t.id, status: 'missing', evidence: '', demonstrated: '', missingDetail: '' })) }
    }
    throw new Error('unexpected provider call during initial diagnosis')
  }
}

async function testLiveQuestionScopeRegression() {
  const { selection, payload, targets } = liveFixture()
  const artifacts = harness('sess-1', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-1', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })

  // All 4 targets share one topic/material, so buildRepasoRecoveryPlan puts
  // them in ONE group. In production a PROVIDER-authored question can
  // legitimately phrase itself around only ONE of several grounded targets
  // even when the grounding unit spans more — the live-reported bug. Seed
  // the group with exactly that shape: a frozen, narrow question whose
  // assessedTargetIds (derived deterministically from the question text,
  // exactly as repaso-recovery-open would) name only the direct reaction.
  const groupId = (initial.recoveryPlan.groups[0] as any).groupId
  const narrowQuestion = 'Explica, según el material: Reacción directa y su ley de velocidad.'
  const assessedTargetIds = deriveAssessedTargetIds(narrowQuestion, targets.map(t => ({
    id: t.id, label: t.name, statement: t.summary,
  })) as any)
  assert.deepEqual(assessedTargetIds, ['concept_reaccion_directa_y_su_ley_de_velocidad'])
  const seeded = artifacts.get(initial.artifactId)
  seeded.recoveryPlan.groups = seeded.recoveryPlan.groups.map((g: any) => g.groupId === groupId
    ? { ...g, question: narrowQuestion, questionProvenance: 'provider', assessedTargetIds }
    : g)
  artifacts.set(initial.artifactId, seeded)

  const openReplay = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(openReplay.response.status, 200)
  assert.equal(openReplay.data.groupId, groupId)
  assert.equal(openReplay.data.question, narrowQuestion, 'a group with an already-frozen question is never re-authored')
  const stored = artifacts.get(initial.artifactId)
  const group = stored.recoveryPlan.groups.find((g: any) => g.groupId === groupId)
  assert.deepEqual(group.assessedTargetIds, ['concept_reaccion_directa_y_su_ley_de_velocidad'],
    'the frozen question only names the direct-reaction target — assessed scope must match exactly, not the whole 4-target group')

  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'analysis_batch') {
        return {
          targetCoverage: [
            { targetId: 'concept_reaccion_directa_y_su_ley_de_velocidad', status: 'covered', evidence: 'N2O4 -> 2NO2, v = kf[N2O4]', demonstrated: 'Explicó correctamente la reacción directa y su ley de velocidad.', missingDetail: '' },
            { targetId: 'concept_reaccion_inversa_y_su_ley_de_velocidad', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
            { targetId: 'formula_expresion_de_la_relacion_de_constantes_d', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
            { targetId: 'def_definicion_de_la_constante_de_equilibrio', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
          ],
        }
      }
      throw new Error('unexpected provider call')
    },
  })
  const answer = await post('sess-1', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId,
    attemptClientId: 'a1', answer: 'La reacción directa es N2O4 -> 2NO2 y su velocidad se expresa como v = kf[N2O4].',
  })
  assert.equal(answer.response.status, 200)

  // 1-2: current question resolves, feedback positive
  assert.equal(answer.data.feedback.status, 'correct')
  assert.equal(answer.data.feedback.title, 'Excelente')
  assert.notEqual(answer.data.feedback.title, 'Vamos a reforzarlo')

  // 3: feedback does not list relation/Keq as blocking gaps
  assert.equal(answer.data.feedback.needsWork.length, 0)
  const feedbackText = JSON.stringify(answer.data.feedback)
  assert.ok(!feedbackText.includes('Repasa'), 'a resolved question must not surface a missing-target hint for a hidden sibling')

  // 4-7: genuine per-target states
  const storedAfter = artifacts.get(initial.artifactId)
  assert.equal(storedAfter.currentTargetStates.concept_reaccion_directa_y_su_ley_de_velocidad.status, 'covered')
  assert.equal(storedAfter.currentTargetStates.concept_reaccion_inversa_y_su_ley_de_velocidad.status, 'missing')
  assert.equal(storedAfter.currentTargetStates.formula_expresion_de_la_relacion_de_constantes_d.status, 'missing')
  assert.equal(storedAfter.currentTargetStates.def_definicion_de_la_constante_de_equilibrio.status, 'missing')

  // 8: Score v2 deterministic — unaffected formula/domainMap, reflects genuine states
  assert.equal(typeof answer.data.attempt.scoreAfter, 'number')
  assert.ok(answer.data.attempt.scoreAfter >= answer.data.attempt.scoreBefore)

  // 9: unresolved siblings scheduled for later Recovery
  const deferred = storedAfter.recoveryPlan.groups.find((g: any) => g.groupId !== groupId)
  assert.ok(deferred, 'unresolved siblings must be preserved in a new group')
  assert.deepEqual(deferred.targetIds.sort(), [
    'concept_reaccion_inversa_y_su_ley_de_velocidad', 'formula_expresion_de_la_relacion_de_constantes_d', 'def_definicion_de_la_constante_de_equilibrio',
  ].sort())
  assert.equal(deferred.question, '')

  // 10-11: Continue opens a DIFFERENT question; retry does not reopen the resolved one
  const nextOpen = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(nextOpen.response.status, 200)
  assert.equal(nextOpen.data.groupId, deferred.groupId)
  assert.notEqual(nextOpen.data.question, group.question)
}

async function testZeroQuestionAuthoringCallsOnDeterministicPath() {
  const { selection, payload, targets } = liveFixture()
  harness('sess-2', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-2', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  let recoveryQuestionCalls = 0
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'analysis_batch') {
        return { targetCoverage: targets.map(t => ({ targetId: t.id, status: 'missing', evidence: '', demonstrated: '', missingDetail: '' })) }
      }
      if (telemetryContext?.phase === 'repaso_recovery_question') { recoveryQuestionCalls += 1; return { question: 'x' } }
      throw new Error('unexpected provider call')
    },
  })
  const open = await post('sess-2', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200)
  assert.equal(recoveryQuestionCalls, 0)
}

/* ------------------------------------------------------------------ */
/* Other required regressions                                          */
/* ------------------------------------------------------------------ */

const NARROW_QUESTION = 'Explica, según el material: Reacción directa y su ley de velocidad.'

/**
 * The 4 live-fixture targets are all substantively groundable together, so
 * the deterministic composer's own default behavior joins every label into
 * one broad question — a legitimate, self-consistent outcome (composer text
 * transparently lists every included target). To isolate and test the
 * NARROW-question scenario (a provider phrasing around only one grounded
 * target — the actual live-reported bug) these regressions seed that exact
 * already-frozen shape directly, matching testLiveQuestionScopeRegression.
 */
function seedNarrowDirectQuestion(artifacts: Map<string, any>, artifactId: string, groupId: string) {
  const stored = artifacts.get(artifactId)
  stored.recoveryPlan.groups = stored.recoveryPlan.groups.map((g: any) => g.groupId === groupId
    ? { ...g, question: NARROW_QUESTION, questionProvenance: 'provider', assessedTargetIds: ['concept_reaccion_directa_y_su_ley_de_velocidad'] }
    : g)
  artifacts.set(artifactId, stored)
}

async function testConciseAndParaphraseAnswersPass() {
  const { selection, payload, targets } = liveFixture()
  const artifacts = harness('sess-3', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-3', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  const groupId = initial.recoveryPlan.groups[0].groupId
  seedNarrowDirectQuestion(artifacts, initial.artifactId, groupId)
  const open = await post('sess-3', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'analysis_batch') {
        return {
          targetCoverage: [
            { targetId: 'concept_reaccion_directa_y_su_ley_de_velocidad', status: 'covered', evidence: 'e', demonstrated: 'Igualó las velocidades y derivó correctamente la expresión.', missingDetail: '' },
            { targetId: 'concept_reaccion_inversa_y_su_ley_de_velocidad', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
            { targetId: 'formula_expresion_de_la_relacion_de_constantes_d', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
            { targetId: 'def_definicion_de_la_constante_de_equilibrio', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
          ],
        }
      }
      throw new Error('unexpected provider call')
    },
  })
  const answer = await post('sess-3', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: open.data.groupId,
    attemptClientId: 'a1', answer: 'La reacción va de N2O4 a 2NO2 y su velocidad depende de [N2O4].',
  })
  assert.equal(answer.data.feedback.status, 'correct', 'a concise paraphrased answer must resolve the assessed target')
}

async function testEssentialOmissionRemainsPartial() {
  const { selection, payload, targets } = liveFixture()
  harness('sess-4', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-4', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  const open = await post('sess-4', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'analysis_batch') {
        return {
          targetCoverage: [
            { targetId: 'concept_reaccion_directa_y_su_ley_de_velocidad', status: 'partial', evidence: 'e', demonstrated: 'Mencionó que la reacción ocurre.', missingDetail: 'No expresó la ley de velocidad v = kf[N2O4].' },
            { targetId: 'concept_reaccion_inversa_y_su_ley_de_velocidad', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
            { targetId: 'formula_expresion_de_la_relacion_de_constantes_d', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
            { targetId: 'def_definicion_de_la_constante_de_equilibrio', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
          ],
        }
      }
      throw new Error('unexpected provider call')
    },
  })
  const answer = await post('sess-4', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: open.data.groupId, attemptClientId: 'a1', answer: 'La reacción directa ocurre.' })
  assert.equal(answer.data.feedback.status, 'partial')
  assert.equal(answer.data.feedback.groupResolved, false)
}

async function testNoSeRemainsMissing() {
  const { selection, payload, targets } = liveFixture()
  harness('sess-5', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-5', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  const open = await post('sess-5', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'analysis_batch') {
        return { targetCoverage: targets.map(t => ({ targetId: t.id, status: 'missing', evidence: '', demonstrated: '', missingDetail: '' })) }
      }
      throw new Error('unexpected provider call')
    },
  })
  const answer = await post('sess-5', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: open.data.groupId, attemptClientId: 'a1', answer: 'no sé' })
  assert.equal(answer.data.feedback.status, 'missing')
  assert.equal(answer.data.attempt.scoreBefore, answer.data.attempt.scoreAfter)
}

async function testMisconceptionRemainsIncorrect() {
  const { selection, payload, targets } = liveFixture()
  harness('sess-6', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-6', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  const open = await post('sess-6', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'analysis_batch') {
        return {
          targetCoverage: [
            { targetId: 'concept_reaccion_directa_y_su_ley_de_velocidad', status: 'incorrect', evidence: 'la reacción directa no depende de N2O4', demonstrated: '', missingDetail: 'la ley de velocidad sí depende de [N2O4]: v = kf[N2O4].' },
            { targetId: 'concept_reaccion_inversa_y_su_ley_de_velocidad', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
            { targetId: 'formula_expresion_de_la_relacion_de_constantes_d', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
            { targetId: 'def_definicion_de_la_constante_de_equilibrio', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
          ],
        }
      }
      throw new Error('unexpected provider call')
    },
  })
  const answer = await post('sess-6', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: open.data.groupId, attemptClientId: 'a1', answer: 'la reacción directa no depende de N2O4' })
  assert.equal(answer.data.feedback.status, 'incorrect')
}

async function testRestoreAndRefreshPreserveAssessedScope() {
  const { selection, payload, targets } = liveFixture()
  const artifacts = harness('sess-7', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-7', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  const groupId = initial.recoveryPlan.groups[0].groupId
  seedNarrowDirectQuestion(artifacts, initial.artifactId, groupId)
  const open = await post('sess-7', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  const restore = await post('sess-7', { artifactId: initial.artifactId, kind: 'repaso-restore' })
  assert.equal(restore.data.groupId, open.data.groupId)
  assert.equal(restore.data.question, open.data.question)
  const stored = artifacts.get(initial.artifactId)
  const group = stored.recoveryPlan.groups.find((g: any) => g.groupId === open.data.groupId)
  assert.deepEqual(group.assessedTargetIds, ['concept_reaccion_directa_y_su_ley_de_velocidad'], 'restore must not regenerate or widen the frozen assessed scope')
}

async function testIdempotentReplayPreservesScope() {
  const { selection, payload, targets } = liveFixture()
  harness('sess-8', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-8', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  const open = await post('sess-8', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'analysis_batch') {
        return {
          targetCoverage: [
            { targetId: 'concept_reaccion_directa_y_su_ley_de_velocidad', status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' },
            { targetId: 'concept_reaccion_inversa_y_su_ley_de_velocidad', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
            { targetId: 'formula_expresion_de_la_relacion_de_constantes_d', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
            { targetId: 'def_definicion_de_la_constante_de_equilibrio', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
          ],
        }
      }
      throw new Error('unexpected provider call')
    },
  })
  const first = await post('sess-8', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: open.data.groupId, attemptClientId: 'same-id', answer: 'respuesta' })
  const replay = await post('sess-8', { artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: open.data.groupId, attemptClientId: 'same-id', answer: 'respuesta' })
  assert.equal(replay.data.idempotentReplay, true)
  assert.equal(replay.data.feedback.status, first.data.feedback.status, 'idempotent replay must reproduce the SAME question-scoped feedback')
  assert.equal(replay.data.feedback.needsWork.length, 0)
}

async function main() {
  testSingleTargetAlwaysAssessed()
  testNarrowQuestionAssessesOnlyMatchingTarget()
  testMultiTargetQuestionAssessesBothWhenWordingExposesThem()
  testFallbackNeverEmpty()
  testResolvePrefersPersistedField()
  testResolveDerivesFromQuestionWhenFieldMissing()
  testResolveUnopenedGroupHasNoScope()
  testHiddenSiblingCannotBlockFeedback()
  testHiddenSiblingCannotBeFalselyCovered()
  await testLiveQuestionScopeRegression()
  await testZeroQuestionAuthoringCallsOnDeterministicPath()
  await testConciseAndParaphraseAnswersPass()
  await testEssentialOmissionRemainsPartial()
  await testNoSeRemainsMissing()
  await testMisconceptionRemainsIncorrect()
  await testRestoreAndRefreshPreserveAssessedScope()
  await testIdempotentReplayPreservesScope()
  console.log('repaso-recovery-question-scope-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
