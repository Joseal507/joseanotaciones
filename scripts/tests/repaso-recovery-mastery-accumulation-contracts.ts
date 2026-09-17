import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps } from '../../app/api/alai-studyal-repasar/route'
import {
  previewRepasoTransitions,
  type RepasoTargetAdjudication,
  type RepasoTargetState,
} from '../../lib/materialBrain/repasoArtifact'

/* ------------------------------------------------------------------ */
/* Pure merge-matrix unit tests against previewRepasoTransitions      */
/* ------------------------------------------------------------------ */

function state(overrides: Partial<RepasoTargetState> = {}): RepasoTargetState {
  return {
    targetId: 't1', status: 'missing', evidence: '', demonstrated: '', missingDetail: '',
    lastUpdatedBy: { kind: 'initial' }, recoveryAttemptCount: 0,
    ...overrides,
  }
}

function adjudication(overrides: Partial<RepasoTargetAdjudication> = {}): RepasoTargetAdjudication {
  return { targetId: 't1', status: 'missing', evidence: '', demonstrated: '', missingDetail: '', ...overrides }
}

function merge(previous: RepasoTargetState, next: RepasoTargetAdjudication) {
  const preview = previewRepasoTransitions({
    currentTargetStates: { t1: previous },
    adjudications: [next],
    allowedTargetIds: new Set(['t1']),
    kind: 'recovery',
    attemptId: 'a1',
  })
  return preview.nextTargetStates.t1
}

function testMissingToMissing() {
  const previous = state({ status: 'missing' })
  const result = merge(previous, adjudication({ status: 'missing', evidence: '', demonstrated: '' }))
  assert.equal(result.status, 'missing')
}

function testPartialSurvivesNoSe() {
  const previous = state({ status: 'partial', evidence: 'evidencia previa real', demonstrated: 'demostro algo', missingDetail: 'le falta X' })
  const result = merge(previous, adjudication({ status: 'missing', evidence: '', demonstrated: '', missingDetail: '' }))
  assert.equal(result.status, 'partial', '"no sé" must not erase a previously demonstrated partial state')
  assert.equal(result.evidence, 'evidencia previa real')
  assert.equal(result.demonstrated, 'demostro algo')
  assert.equal(result.missingDetail, 'le falta X')
}

function testPartialSurvivesUncertaintyOnlyAnswer() {
  // The provider may legitimately return status="partial" again with blank
  // evidence fields for an uncertainty-only/irrelevant answer — blank
  // evidence is blank regardless of the label the provider put on it.
  const previous = state({ status: 'partial', evidence: 'evidencia previa', demonstrated: 'demo previa', missingDetail: 'falta previa' })
  const result = merge(previous, adjudication({ status: 'partial', evidence: '', demonstrated: '', missingDetail: '' }))
  assert.equal(result.status, 'partial')
  assert.equal(result.evidence, 'evidencia previa')
}

function testCoveredIsProtectedFromDowngrade() {
  // previewRepasoTransitions itself throws before merge is ever consulted —
  // covered targets can never even be submitted through Recovery.
  const previous = state({ status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' })
  assert.throws(() => merge(previous, adjudication({ status: 'missing' })), /REPASO_ALREADY_COVERED_TARGET/)
}

function testPartialToExplicitIncorrectDowngradeAllowed() {
  const previous = state({ status: 'partial', evidence: 'evidencia previa', demonstrated: 'demo previa', missingDetail: 'falta previa' })
  const result = merge(previous, adjudication({
    status: 'incorrect', evidence: 'el estudiante afirmo explicitamente que Q y K son lo mismo',
    demonstrated: '', missingDetail: 'Q y K son conceptos distintos; el estudiante los confundio',
  }))
  assert.equal(result.status, 'incorrect', 'a genuine, explicit contradiction (real evidence + real gap) may downgrade')
}

function testPartialToIncorrectWithoutGenuineEvidenceIsRejected() {
  // status says "incorrect" but the evaluator provided no real evidence/gap
  // text — this must never be trusted as a genuine contradiction.
  const previous = state({ status: 'partial', evidence: 'evidencia previa', demonstrated: 'demo previa', missingDetail: 'falta previa' })
  const result = merge(previous, adjudication({ status: 'incorrect', evidence: '', demonstrated: '', missingDetail: '' }))
  assert.equal(result.status, 'partial', 'a status label alone, without real evidence, must never downgrade')
}

function testPartialToCoveredUpgrade() {
  const previous = state({ status: 'partial', evidence: 'e', demonstrated: 'd', missingDetail: 'f' })
  const result = merge(previous, adjudication({ status: 'covered', evidence: 'evidencia completa nueva', demonstrated: 'demostro todo', missingDetail: '' }))
  assert.equal(result.status, 'covered')
  assert.equal(result.evidence, 'evidencia completa nueva')
}

function testIncorrectToCoveredUpgrade() {
  const previous = state({ status: 'incorrect', evidence: 'e', demonstrated: 'd', missingDetail: 'f' })
  const result = merge(previous, adjudication({ status: 'covered', evidence: 'correccion demostrada', demonstrated: 'ahora lo explica bien', missingDetail: '' }))
  assert.equal(result.status, 'covered', 'a corrected answer must be able to move incorrect -> covered')
}

function testMissingToPartialUpgrade() {
  const previous = state({ status: 'missing' })
  const result = merge(previous, adjudication({ status: 'partial', evidence: 'algo de evidencia', demonstrated: 'algo demostrado', missingDetail: 'aun falta detalle' }))
  assert.equal(result.status, 'partial')
}

/* ------------------------------------------------------------------ */
/* Live regression: 8/100 artifact, student answers "no sé"           */
/* ------------------------------------------------------------------ */

function fixture(materialId: string, targets: any[]) {
  const pages = [...new Set(targets.flatMap(t => t.pages))]
  const selection = buildSourceSelectionSnapshot([materialId], { [materialId]: pages })
  return {
    selection,
    payload: {
      sourceSelectionFingerprint: selection.fingerprint,
      topicsIndex: [{ id: 'topic-1', title: 'Tema', order: 0 }],
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

async function testLiveNoSeRegression() {
  const targets = [
    {
      id: 'covered1', kind: 'concept', name: 'Concepto cubierto',
      summary: 'Evidencia sustantiva ya cubierta previamente por el estudiante en su explicacion inicial.',
      importance: 90, materialId: 'mat-x', pages: [1],
      sourceSpans: [{ page: 1, quote: 'Evidencia sustantiva ya cubierta previamente por el estudiante en su explicacion inicial.' }],
      topicId: 'topic-1', globalOrder: 0,
    },
    {
      id: 'partial1', kind: 'concept', name: 'Concepto parcial',
      summary: 'Evidencia sustantiva parcialmente demostrada por el estudiante en su explicacion inicial.',
      importance: 80, materialId: 'mat-x', pages: [1],
      sourceSpans: [{ page: 1, quote: 'Evidencia sustantiva parcialmente demostrada por el estudiante en su explicacion inicial.' }],
      topicId: 'topic-1', globalOrder: 1,
    },
    {
      id: 'missing1', kind: 'concept', name: 'Concepto ausente',
      summary: 'Evidencia sustantiva que el estudiante nunca menciono en su explicacion inicial.',
      importance: 70, materialId: 'mat-x', pages: [1],
      sourceSpans: [{ page: 1, quote: 'Evidencia sustantiva que el estudiante nunca menciono en su explicacion inicial.' }],
      topicId: 'topic-1', globalOrder: 2,
    },
  ]
  const { selection, payload } = fixture('mat-x', targets)

  const artifacts = harness('sess-x', selection, payload, async ({ telemetryContext }: any) => {
    if (telemetryContext?.phase === 'analysis_batch') {
      return {
        targetCoverage: [
          { targetId: 'covered1', status: 'covered', evidence: 'evidencia inicial cubierta', demonstrated: 'demostro bien el concepto', missingDetail: '' },
          { targetId: 'partial1', status: 'partial', evidence: 'evidencia inicial parcial', demonstrated: 'demostro parte del concepto', missingDetail: 'le falta profundidad' },
          { targetId: 'missing1', status: 'missing', evidence: '', demonstrated: '', missingDetail: '' },
        ],
      }
    }
    throw new Error('unexpected provider call in initial phase')
  })

  const { response: initialResponse, data: initial } = await post('sess-x', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  assert.equal(initialResponse.status, 200)
  const scoreBefore = initial.initialScore

  const open = await post('sess-x', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200)
  const groupId = open.data.groupId
  const requestedIds = open.data.recoveryPlan?.groups?.find((g: any) => g.groupId === groupId)?.targetIds
    || initial.recoveryPlan.groups.find((g: any) => g.groupId === groupId).targetIds

  // Switch the mock to answer the Recovery "no sé" attempt: every requested
  // (unresolved) target comes back as a valid, blank-evidence 'missing'
  // adjudication — a legitimate "student demonstrated nothing new" verdict.
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'analysis_batch') {
        return { targetCoverage: requestedIds.map((id: string) => ({ targetId: id, status: 'missing', evidence: '', demonstrated: '', missingDetail: '' })) }
      }
      throw new Error('unexpected provider call in recovery-answer phase')
    },
  })

  const answered = await post('sess-x', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId,
    attemptClientId: 'attempt-no-se', answer: 'no sé',
  })
  assert.equal(answered.response.status, 200)
  assert.equal(answered.data.attempt.scoreBefore, scoreBefore)
  assert.equal(answered.data.attempt.scoreAfter, scoreBefore, '"no sé" must not change Score v2 at all')
  assert.equal(answered.data.feedback.status, 'missing')
  assert.equal(answered.data.feedback.scoreChanged, false)

  const stored = artifacts.get(initial.artifactId)
  assert.equal(stored.currentTargetStates.covered1.status, 'covered', 'previously covered target untouched')
  if (requestedIds.includes('partial1')) {
    assert.equal(stored.currentTargetStates.partial1.status, 'partial', 'previously demonstrated partial evidence must survive "no sé"')
    assert.equal(stored.currentTargetStates.partial1.evidence, 'evidencia inicial parcial')
  }
  assert.equal(stored.currentTargetStates.missing1.status, 'missing')
  // The raw "no sé" adjudication is still recorded verbatim in attempt history.
  assert.ok(stored.recoveryAttempts.some((a: any) => a.attemptId === 'attempt-no-se' && a.answer === 'no sé'))
  const rawAdjudication = stored.recoveryAttempts[0].adjudications.find((a: any) => a.targetId === requestedIds[0])
  assert.equal(rawAdjudication.status, 'missing', 'raw provider adjudication is preserved verbatim in attempt history, unmerged')
}

async function testImprovementAfterNoSeStillWorks() {
  const targets = [{
    id: 'partial1', kind: 'concept', name: 'Concepto parcial',
    summary: 'Evidencia sustantiva parcialmente demostrada por el estudiante en su explicacion inicial.',
    importance: 80, materialId: 'mat-y', pages: [1],
    sourceSpans: [{ page: 1, quote: 'Evidencia sustantiva parcialmente demostrada por el estudiante en su explicacion inicial.' }],
    topicId: 'topic-1', globalOrder: 0,
  }]
  const { selection, payload } = fixture('mat-y', targets)
  const artifacts = harness('sess-y', selection, payload, async ({ telemetryContext }: any) => {
    if (telemetryContext?.phase === 'analysis_batch') {
      return { targetCoverage: [{ targetId: 'partial1', status: 'partial', evidence: 'evidencia inicial parcial', demonstrated: 'demostro algo', missingDetail: 'le falta profundidad' }] }
    }
    throw new Error('unexpected provider call')
  })
  const { data: initial } = await post('sess-y', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  const open = await post('sess-y', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  const groupId = open.data.groupId

  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'analysis_batch') {
        return { targetCoverage: [{ targetId: 'partial1', status: 'covered', evidence: 'ahora explica todo correctamente', demonstrated: 'demostro el concepto completo', missingDetail: '' }] }
      }
      throw new Error('unexpected provider call')
    },
  })
  const answered = await post('sess-y', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId,
    attemptClientId: 'attempt-better', answer: 'Explicación completa y correcta del concepto.',
  })
  assert.equal(answered.response.status, 200)
  assert.ok(answered.data.attempt.scoreAfter > answered.data.attempt.scoreBefore, 'a genuinely better answer must raise the score')
  const stored = artifacts.get(initial.artifactId)
  assert.equal(stored.currentTargetStates.partial1.status, 'covered')
}

async function testDowngradeAfterNoSeStillWorksWhenExplicitlyContradictory() {
  const targets = [{
    id: 'partial1', kind: 'concept', name: 'Concepto parcial',
    summary: 'Evidencia sustantiva parcialmente demostrada por el estudiante en su explicacion inicial.',
    importance: 80, materialId: 'mat-z', pages: [1],
    sourceSpans: [{ page: 1, quote: 'Evidencia sustantiva parcialmente demostrada por el estudiante en su explicacion inicial.' }],
    topicId: 'topic-1', globalOrder: 0,
  }]
  const { selection, payload } = fixture('mat-z', targets)
  const artifacts = harness('sess-z', selection, payload, async ({ telemetryContext }: any) => {
    if (telemetryContext?.phase === 'analysis_batch') {
      return { targetCoverage: [{ targetId: 'partial1', status: 'partial', evidence: 'evidencia inicial parcial', demonstrated: 'demostro algo', missingDetail: 'le falta profundidad' }] }
    }
    throw new Error('unexpected provider call')
  })
  const { data: initial } = await post('sess-z', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  const open = await post('sess-z', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  const groupId = open.data.groupId

  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'analysis_batch') {
        return {
          targetCoverage: [{
            targetId: 'partial1', status: 'incorrect',
            evidence: 'el estudiante afirmo explicitamente una relacion falsa entre los conceptos',
            demonstrated: '',
            missingDetail: 'el estudiante confundio explicitamente dos conceptos distintos, contradiciendo el material canonico',
          }],
        }
      }
      throw new Error('unexpected provider call')
    },
  })
  const answered = await post('sess-z', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId,
    attemptClientId: 'attempt-wrong', answer: 'Afirmación explícitamente incorrecta y contradictoria.',
  })
  assert.equal(answered.response.status, 200)
  assert.ok(answered.data.attempt.scoreAfter < answered.data.attempt.scoreBefore, 'an explicit, evidenced contradiction may lower the score')
  const stored = artifacts.get(initial.artifactId)
  assert.equal(stored.currentTargetStates.partial1.status, 'incorrect')
}

async function main() {
  testMissingToMissing()
  testPartialSurvivesNoSe()
  testPartialSurvivesUncertaintyOnlyAnswer()
  testCoveredIsProtectedFromDowngrade()
  testPartialToExplicitIncorrectDowngradeAllowed()
  testPartialToIncorrectWithoutGenuineEvidenceIsRejected()
  testPartialToCoveredUpgrade()
  testIncorrectToCoveredUpgrade()
  testMissingToPartialUpgrade()
  await testLiveNoSeRegression()
  await testImprovementAfterNoSeStillWorks()
  await testDowngradeAfterNoSeStillWorksWhenExplicitlyContradictory()
  console.log('repaso-recovery-mastery-accumulation-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
