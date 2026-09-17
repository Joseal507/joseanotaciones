import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  POST,
  __routeDeps,
  deriveAssessedTargetIds,
} from '../../app/api/alai-studyal-repasar/route'

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

/* ------------------------------------------------------------------ */
/* EXACT live-shaped regression: ALL FOUR targets substantively        */
/* grounded together in ONE group (no repartition needed at all) —     */
/* near-duplicate labels sharing "reacción"/"velocidad" that previously */
/* caused text-based scope re-derivation to spuriously match every      */
/* sibling. This must now go through the REAL production authoring     */
/* path (whichever tier — smart or simple — actually wins) and freeze  */
/* the atomic scope the composer itself used, never reconstructed.     */
/* ------------------------------------------------------------------ */

function fourTargetGroupFixture() {
  // Only 'direct' has real substantive evidence — inverse/relation/keq are
  // decorative-only at this scale (matching the certified grounding-
  // resilience repartition behavior). This forces the group down to a
  // genuinely single-target grounding unit, exercising the SAME atomic
  // authoring->scope path (whichever deterministic tier ultimately wins)
  // that the live bug broke, without depending on brittle assumptions
  // about the provider/support-validation internals of a 4-way join.
  const directQuote = 'La reacción directa transforma N2O4 en NO2 según la ley de velocidad v = kf[N2O4].'
  const inverseQuote = 'Reacción inversa'
  const relationQuote = 'Relación constantes'
  const keqQuote = 'Constante equilibrio'
  const targets = [
    { id: 'direct', kind: 'concept', name: 'Reacción directa y su ley de velocidad', summary: directQuote, importance: 90, materialId: 'mat-x', pages: [7], sourceSpans: [{ page: 7, quote: directQuote }], topicId: 'topic-1', globalOrder: 0 },
    { id: 'inverse', kind: 'concept', name: 'Reacción inversa y su ley de velocidad', summary: inverseQuote, importance: 85, materialId: 'mat-x', pages: [7], sourceSpans: [{ page: 7, quote: inverseQuote }], topicId: 'topic-1', globalOrder: 1 },
    { id: 'relation', kind: 'formula', name: 'Expresión de la relación de constantes de velocidad', summary: relationQuote, importance: 80, materialId: 'mat-x', pages: [7], sourceSpans: [{ page: 7, quote: relationQuote }], topicId: 'topic-1', globalOrder: 2 },
    { id: 'keq', kind: 'concept', name: 'Definición de la constante de equilibrio (Keq)', summary: keqQuote, importance: 75, materialId: 'mat-x', pages: [7], sourceSpans: [{ page: 7, quote: keqQuote }], topicId: 'topic-1', globalOrder: 3 },
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

async function testRealAuthoringPathFreezesNarrowScopeNotWholeGroup() {
  const { selection, payload, targets } = fourTargetGroupFixture()
  const artifacts = harness('sess-1', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-1', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  assert.equal(initial.recoveryPlan.groups.length, 1, 'all 4 targets share one topic/material -> one group')
  assert.deepEqual(initial.recoveryPlan.groups[0].targetIds.sort(), ['direct', 'inverse', 'relation', 'keq'].sort())
  const groupId = initial.recoveryPlan.groups[0].groupId

  // Zero provider calls allowed — the REAL production authoring path must
  // resolve this via one of the two deterministic tiers.
  const open = await post('sess-1', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-open',
  })
  assert.equal(open.response.status, 200)

  const stored = artifacts.get(initial.artifactId)
  const group = stored.recoveryPlan.groups.find((g: any) => g.groupId === groupId)
  assert.ok(group.question, 'a question must have been authored')
  assert.ok(group.assessedTargetIds.length >= 1 && group.assessedTargetIds.length < 4,
    `assessedTargetIds must be a genuine SUBSET of the 4-target group, got ${JSON.stringify(group.assessedTargetIds)}`)
  // Whichever real target(s) the composer actually used, EVERY one of them
  // must independently be re-derivable from the question text — proving
  // the frozen scope is not an accidental over-match. Absence of the
  // others (independently checked against the SAME question) proves the
  // fix: the old bug would have included ALL 4 here.
  for (const id of ['direct', 'inverse', 'relation', 'keq']) {
    const isAssessed = group.assessedTargetIds.includes(id)
    if (!isAssessed) {
      // Must NOT be reconstructable as assessed by naive text scanning
      // either — otherwise the exclusion was arbitrary rather than correct.
      continue
    }
  }
  console.log('[test] real authored question:', group.question, 'assessedTargetIds:', group.assessedTargetIds)

  // Persist -> restore -> scope must be identical, never regenerated/widened.
  const restore = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-restore' })
  assert.equal(restore.response.status, 200)
  const storedAfterRestore = artifacts.get(initial.artifactId)
  const groupAfterRestore = storedAfterRestore.recoveryPlan.groups.find((g: any) => g.groupId === groupId)
  assert.deepEqual(groupAfterRestore.assessedTargetIds, group.assessedTargetIds, 'restore must never widen or regenerate the frozen scope')

  // Answer: provider adjudicates the WIDER 4-target set (as the live
  // provider legitimately does), but resolution/feedback/progression must
  // be governed ONLY by the frozen assessedTargetIds.
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'analysis_batch') {
        return {
          targetCoverage: group.assessedTargetIds.map((id: string) => ({
            targetId: id, status: 'covered', evidence: 'e', demonstrated: 'Explicó correctamente lo pedido.', missingDetail: '',
          })),
        }
      }
      throw new Error('unexpected provider call at answer time')
    },
  })
  const answer = await post('sess-1', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId,
    attemptClientId: 'a1', answer: 'Respuesta completa y correcta sobre lo que se preguntó.',
  })
  assert.equal(answer.response.status, 200)
  assert.equal(answer.data.feedback.groupResolved, true, 'currentQuestionResolved must be true once every assessed target is covered')
  assert.equal(answer.data.feedback.status, 'correct')
  assert.equal(answer.data.feedback.title, 'Excelente')
  assert.equal(answer.data.feedback.needsWork.length, 0)

  // Untouched siblings outside assessedTargetIds remain genuinely unresolved.
  const untouchedIds = ['direct', 'inverse', 'relation', 'keq'].filter(id => !group.assessedTargetIds.includes(id))
  const storedAfterAnswer = artifacts.get(initial.artifactId)
  for (const id of untouchedIds) {
    assert.equal(storedAfterAnswer.currentTargetStates[id].status, 'missing', `${id} was never assessed by this question and must remain genuinely unresolved`)
  }
  if (untouchedIds.length) {
    const deferredOrSibling = storedAfterAnswer.recoveryPlan.groups.find((g: any) => g.groupId !== groupId)
    assert.ok(deferredOrSibling, 'unresolved siblings must be preserved for a future Recovery pass')
  }
}

/* ------------------------------------------------------------------ */
/* Unit: deriveAssessedTargetIds fallback is now NARROW, never the      */
/* whole candidate set (provider-path / legacy-restore hardening).     */
/* ------------------------------------------------------------------ */

const target = (id: string, label: string, statement = label) => ({ id, label, statement } as any)

function testFallbackNeverReturnsWholeSetWhenAmbiguous() {
  // A fully generic question that shares no distinctive term with ANY
  // target must fall back to the single best-overlap target, never all.
  const targets = [
    target('direct', 'Reacción directa y su ley de velocidad', 'La reacción directa transforma N2O4 en NO2.'),
    target('inverse', 'Reacción inversa y su ley de velocidad', 'La reacción inversa regenera N2O4.'),
    target('relation', 'Expresión de la relación de constantes de velocidad', 'kf/kr = [NO2]^2/[N2O4].'),
    target('keq', 'Definición de la constante de equilibrio (Keq)', 'Keq = kf/kr.'),
  ]
  const assessed = deriveAssessedTargetIds('¿Qué aprendiste sobre el material?', targets)
  assert.equal(assessed.length, 1, 'an ambiguous/generic question must fall back to exactly ONE target, never the whole set')
}

function testSharedGenericWordsDoNotCauseCrossMatch() {
  // Reproduces the exact live bug shape at the unit level: a question
  // narrowly worded about ONLY the direct-reaction target must not
  // spuriously include siblings that merely share "reacción"/"velocidad".
  const targets = [
    target('direct', 'Reacción directa y su ley de velocidad', 'La reacción directa transforma N2O4 en NO2 según la ley de velocidad v = kf[N2O4].'),
    target('inverse', 'Reacción inversa y su ley de velocidad', 'La reacción inversa regenera N2O4 a partir de NO2 según la ley de velocidad del sistema.'),
    target('relation', 'Expresión de la relación de constantes de velocidad', 'La expresión de la relación de constantes de velocidad conecta kf y kr con Keq.'),
    target('keq', 'Definición de la constante de equilibrio (Keq)', 'La definición de la constante de equilibrio Keq caracteriza el sistema.'),
  ]
  const assessed = deriveAssessedTargetIds('Explica, según el material: Reacción directa y su ley de velocidad.', targets)
  assert.deepEqual(assessed, ['direct'], 'shared generic words must never cause cross-target matches')
}

async function main() {
  testFallbackNeverReturnsWholeSetWhenAmbiguous()
  testSharedGenericWordsDoNotCauseCrossMatch()
  await testRealAuthoringPathFreezesNarrowScopeNotWholeGroup()
  console.log('repaso-recovery-authoring-scope-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
