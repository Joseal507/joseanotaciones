import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps } from '../../app/api/alai-studyal-repasar/route'

/* ------------------------------------------------------------------ */
/* FINAL REPASO AUTHORING FIX — semantic chunking, not grading patches   */
/*                                                                      */
/* Root cause: a CONNECTED question silently mixed conceptual targets   */
/* with "Ejemplo de..." targets into one wording ("Explica cómo se      */
/* conectan: A, B, ejemplo C, ejemplo D") — pedagogically ambiguous even */
/* though technically explicit by label. The fix is authoring-time      */
/* semantic homogeneity (selectRepasoSemanticChunkPool), not another     */
/* grading exemption.                                                    */
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

function initialCoverageMock(targets: any[]) {
  return async ({ telemetryContext }: any) => {
    if (telemetryContext?.phase === 'analysis_batch') {
      return { targetCoverage: targets.map(t => ({ targetId: t.id, status: 'missing', evidence: '', demonstrated: '', missingDetail: '' })) }
    }
    throw new Error('unexpected provider call during initial diagnosis')
  }
}

function refuseQuestionAuthoringProvider() {
  return async ({ telemetryContext }: any) => {
    if (telemetryContext?.phase === 'repaso_recovery_question') throw new Error('question-authoring provider must not be called')
    throw new Error('unexpected provider call at open time')
  }
}

async function openSession(materialId: string, targets: any[]) {
  const pages = Array.from(new Set(targets.flatMap(t => t.pages || [])))
  const selection = buildSourceSelectionSnapshot([materialId], { [materialId]: pages })
  const payload = {
    sourceSelectionFingerprint: selection.fingerprint,
    topicsIndex: [{ id: 'topic-1', title: 'Topic', order: 0 }],
    globalOrderedAnalysis: targets,
    uniqueConceptsIndex: [],
  }
  const artifacts = harness('sess-1', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-1', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const open = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200, `open must succeed deterministically: ${JSON.stringify(open.data)}`)
  return { artifacts, initial, stored: artifacts.get(initial.artifactId) }
}

/* ------------------------------------------------------------------ */
/* 1-3. Exact solids/liquids live shape: first chunk is conceptual-only, */
/* examples remain unresolved, Continue later opens the example chunk.  */
/* ------------------------------------------------------------------ */

function solidsLiquidsTargets() {
  const constancyQuote = 'Las concentraciones de sólidos y líquidos puros permanecen constantes porque su densidad y masa molar no cambian.'
  const exclusionQuote = 'Como las concentraciones de sólidos y líquidos puros son constantes, se excluyen de las expresiones de equilibrio.'
  const exampleExpressionQuote = 'Ejemplo: para CaCO3(s) ⇌ CaO(s) + CO2(g), la expresión de equilibrio es Kc = [CO2], porque los sólidos se omiten.'
  const exampleHeteroQuote = 'Ejemplo de reacción heterogénea: la descomposición de CaCO3(s) en CaO(s) y CO2(g) solo incluye el gas CO2 en la expresión de Kc.'
  return [
    { id: 'constancy', kind: 'concept', name: 'Constancia de las concentraciones de sólidos y líquidos', summary: constancyQuote, importance: 90, materialId: 'mat-sc', pages: [15], sourceSpans: [{ page: 15, quote: constancyQuote }], topicId: 'topic-1', sourceOrder: 0 },
    { id: 'exclusion', kind: 'concept', name: 'Exclusión de sólidos y líquidos de las expresiones de equilibrio', summary: exclusionQuote, importance: 88, materialId: 'mat-sc', pages: [15], sourceSpans: [{ page: 15, quote: exclusionQuote }], topicId: 'topic-1', sourceOrder: 1 },
    { id: 'exampleExpression', kind: 'concept', name: 'Ejemplo de expresión de equilibrio con sólidos', summary: exampleExpressionQuote, importance: 82, materialId: 'mat-sc', pages: [15], sourceSpans: [{ page: 15, quote: exampleExpressionQuote }], topicId: 'topic-1', sourceOrder: 2 },
    { id: 'exampleHetero', kind: 'concept', name: 'Ejemplo de reacción heterogénea con sólidos y gases', summary: exampleHeteroQuote, importance: 80, materialId: 'mat-sc', pages: [15], sourceSpans: [{ page: 15, quote: exampleHeteroQuote }], topicId: 'topic-1', sourceOrder: 3 },
  ]
}

async function testExactLiveShape_FirstChunkIsConceptualOnly() {
  const targets = solidsLiquidsTargets()
  const { stored } = await openSession('mat-sc', targets)
  const group = stored.recoveryPlan.groups.find((g: any) => g.question)
  assert.deepEqual(group.assessedTargetIds, ['constancy', 'exclusion'], 'the first authored question must scope the two conceptual targets only')
  assert.ok(!/ejemplo/i.test(group.question), `the conceptual chunk must not reference the example targets: ${group.question}`)

  // 2. The example targets must remain genuinely unresolved (never
  // silently marked covered ahead of time), and never disappear from the
  // plan.
  const allInPlan = new Set(stored.recoveryPlan.groups.flatMap((g: any) => g.targetIds))
  for (const id of ['exampleExpression', 'exampleHetero']) {
    assert.ok(allInPlan.has(id), `${id} must not disappear from the plan`)
    assert.notEqual(stored.currentTargetStates[id].status, 'covered', `${id} was never assessed and must not appear covered`)
  }
}

async function testContinuation_ExampleChunkOpensAfterConceptualResolves() {
  const targets = solidsLiquidsTargets()
  const { artifacts, initial, stored } = await openSession('mat-sc', targets)
  const conceptGroup = stored.recoveryPlan.groups.find((g: any) => g.question)

  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call')
      return {
        targetCoverage: [
          { targetId: 'constancy', status: 'covered', evidence: 'se consideran constantes', demonstrated: 'Concentraciones constantes.', missingDetail: '' },
          { targetId: 'exclusion', status: 'covered', evidence: 'no se incluyen en las expresiones de equilibrio', demonstrated: 'Se excluyen por ser constantes.', missingDetail: '' },
        ],
      }
    },
  })
  const answer = await post('sess-1', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: conceptGroup.groupId,
    attemptClientId: 'a1', answer: 'Las concentraciones de sólidos y líquidos puros son constantes, por eso se excluyen de las expresiones de equilibrio.',
  })
  assert.equal(answer.response.status, 200, JSON.stringify(answer.data))
  assert.equal(answer.data.feedback.groupResolved, true)
  assert.ok(answer.data.nextGroupId, 'Continue must have a next group to open')

  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const opened = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(opened.response.status, 200, JSON.stringify(opened.data))
  const afterOpen = artifacts.get(initial.artifactId)
  const exampleGroup = afterOpen.recoveryPlan.groups.find((g: any) => g.groupId === answer.data.nextGroupId)
  assert.deepEqual(new Set(exampleGroup.assessedTargetIds), new Set(['exampleExpression', 'exampleHetero']))
  assert.equal(exampleGroup.questionFamily, 'application', `a homogeneous example chunk must be authored as the application family: ${JSON.stringify(exampleGroup)}`)

  // 4. A generic conceptual answer must not cover the missing example.
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call')
      return {
        targetCoverage: [
          { targetId: 'exampleExpression', status: 'partial', evidence: 'los sólidos se omiten de la expresión', demonstrated: 'Explicó que los sólidos se omiten en general.', missingDetail: 'No reprodujo el ejemplo específico de CaCO3(s) ⇌ CaO(s) + CO2(g).' },
          { targetId: 'exampleHetero', status: 'partial', evidence: 'la expresión de K solo incluye gases', demonstrated: 'Explicó qué especies se incluyen en general.', missingDetail: 'No reprodujo el ejemplo específico de la descomposición de CaCO3.' },
        ],
      }
    },
  })
  const genericAnswer = await post('sess-1', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: exampleGroup.groupId,
    attemptClientId: 'a2', answer: 'En una reacción heterogénea, los sólidos se omiten de la expresión de equilibrio en general.',
  })
  assert.equal(genericAnswer.response.status, 200, JSON.stringify(genericAnswer.data))
  assert.equal(genericAnswer.data.feedback.groupResolved, false, 'a generic answer must not cover the missing worked example')
  assert.equal(artifacts.get(initial.artifactId).currentTargetStates.exampleExpression.status, 'partial', 'the missing example must stay genuinely unresolved, never falsely promoted')

  // 5. An explicit, example-covering answer DOES resolve it.
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call')
      return {
        targetCoverage: [
          { targetId: 'exampleExpression', status: 'covered', evidence: 'para CaCO3(s) ⇌ CaO(s) + CO2(g), Kc = [CO2]', demonstrated: 'Reprodujo el ejemplo CaCO3 -> CaO + CO2 con Kc = [CO2].', missingDetail: '' },
          { targetId: 'exampleHetero', status: 'covered', evidence: 'la descomposición de CaCO3 en CaO y CO2 solo incluye CO2 en Kc', demonstrated: 'Reprodujo el ejemplo de descomposición de CaCO3.', missingDetail: '' },
        ],
      }
    },
  })
  const explicitAnswer = await post('sess-1', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: exampleGroup.groupId,
    attemptClientId: 'a3', answer: 'Para CaCO3(s) ⇌ CaO(s) + CO2(g), la expresión de equilibrio es Kc = [CO2], porque los sólidos se omiten; lo mismo ocurre en la descomposición de CaCO3.',
  })
  assert.equal(explicitAnswer.response.status, 200, JSON.stringify(explicitAnswer.data))
  assert.equal(explicitAnswer.data.feedback.groupResolved, true, 'an explicit example-covering answer must resolve the application question')
  assert.equal(explicitAnswer.data.feedback.status, 'correct')
}

/* ------------------------------------------------------------------ */
/* 6-7. Kp/Kc 4-target true derivation and direct-reaction+rate-law     */
/* single-target case must remain unaffected (no "Ejemplo de" labels).  */
/* ------------------------------------------------------------------ */

async function testKpKcDerivationRemainsOneChunk() {
  const gasQuote = 'La ley de los gases ideales establece que PV = nRT relaciona presión, volumen, moles y temperatura.'
  const pressureQuote = 'La presión en función de la concentración se expresa reordenando PV = nRT en términos de n/V.'
  const kpKcQuote = 'La relación Kp = Kc (RT)^Δn conecta ambas constantes de equilibrio.'
  const deltaNQuote = 'Δn representa la diferencia entre la suma de los moles de los productos gaseosos y la suma de los moles de los reactivos gaseosos.'
  const targets = [
    { id: 'gas', kind: 'formula', name: 'Ley de los gases ideales', summary: gasQuote, importance: 90, materialId: 'mat-chain', pages: [9], sourceSpans: [{ page: 9, quote: gasQuote }], topicId: 'topic-1', sourceOrder: 0 },
    { id: 'pressure', kind: 'formula', name: 'Presión en función de la concentración', summary: pressureQuote, importance: 85, materialId: 'mat-chain', pages: [9], sourceSpans: [{ page: 9, quote: pressureQuote }], topicId: 'topic-1', sourceOrder: 1 },
    { id: 'kpkc', kind: 'formula', name: 'Relación entre Kc y Kp', summary: kpKcQuote, importance: 80, materialId: 'mat-chain', pages: [9], sourceSpans: [{ page: 9, quote: kpKcQuote }], topicId: 'topic-1', sourceOrder: 2 },
    { id: 'deltaN', kind: 'concept', name: 'Definición de Δn en la relación Kc y Kp', summary: deltaNQuote, importance: 75, materialId: 'mat-chain', pages: [9], sourceSpans: [{ page: 9, quote: deltaNQuote }], topicId: 'topic-1', sourceOrder: 3 },
  ]
  const { stored } = await openSession('mat-chain', targets)
  const group = stored.recoveryPlan.groups[0]
  assert.deepEqual(new Set(group.assessedTargetIds), new Set(['gas', 'pressure', 'kpkc', 'deltaN']),
    'a genuine 4-target derivation chain (no "Ejemplo de" targets involved) must still be allowed as one chunk')
}

async function testDirectReactionRateLawRemainsCoherent() {
  const quote = 'La reacción directa transforma N2O4 en NO2 según la ley de velocidad v = kf[N2O4].'
  const targets = [{
    id: 'directReactionAndRate', kind: 'process', name: 'Reacción directa y su ley de velocidad', summary: quote,
    importance: 90, materialId: 'mat-direct', pages: [7], sourceSpans: [{ page: 7, quote }], topicId: 'topic-1', sourceOrder: 0,
  }]
  const { stored } = await openSession('mat-direct', targets)
  const group = stored.recoveryPlan.groups[0]
  assert.deepEqual(group.assessedTargetIds, ['directReactionAndRate'])
}

/* ------------------------------------------------------------------ */
/* 10. No repeated solved chunk / infinite loop.                        */
/* ------------------------------------------------------------------ */

async function testNoInfiniteLoopAcrossChunks() {
  const targets = solidsLiquidsTargets()
  const { artifacts, initial, stored } = await openSession('mat-sc', targets)
  const conceptGroup = stored.recoveryPlan.groups.find((g: any) => g.question)
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call')
      return {
        targetCoverage: [
          { targetId: 'constancy', status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' },
          { targetId: 'exclusion', status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' },
        ],
      }
    },
  })
  const answer = await post('sess-1', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: conceptGroup.groupId,
    attemptClientId: 'a1', answer: 'Respuesta completa sobre constancia y exclusión.',
  })
  assert.equal(answer.response.status, 200)
  const seenGroupIds = new Set<string>()
  let currentId = answer.data.nextGroupId
  let iterations = 0
  while (currentId && iterations < 10) {
    assert.ok(!seenGroupIds.has(currentId), `group ${currentId} must not be revisited as current — infinite loop detected`)
    seenGroupIds.add(currentId)
    Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
    const opened = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
    assert.equal(opened.response.status, 200)
    const afterOpen = artifacts.get(initial.artifactId)
    const nextGroup = afterOpen.recoveryPlan.groups.find((g: any) => g.groupId === currentId)
    if (!nextGroup || nextGroup.status === 'resolved') break
    Object.assign(__routeDeps, {
      generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
        if (telemetryContext?.phase !== 'analysis_batch') throw new Error('unexpected provider call')
        return { targetCoverage: nextGroup.assessedTargetIds.map((id: string) => ({ targetId: id, status: 'covered', evidence: 'e', demonstrated: 'd', missingDetail: '' })) }
      },
    })
    const nextAnswer = await post('sess-1', {
      artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: currentId,
      attemptClientId: `loop-${iterations}`, answer: 'Respuesta completa incluyendo los ejemplos del material.',
    })
    assert.equal(nextAnswer.response.status, 200, JSON.stringify(nextAnswer.data))
    currentId = nextAnswer.data.nextGroupId
    iterations += 1
  }
  assert.ok(iterations < 10, 'recovery must terminate, not loop indefinitely')
}

async function main() {
  await testExactLiveShape_FirstChunkIsConceptualOnly()
  await testContinuation_ExampleChunkOpensAfterConceptualResolves()
  await testKpKcDerivationRemainsOneChunk()
  await testDirectReactionRateLawRemainsCoherent()
  await testNoInfiniteLoopAcrossChunks()
  console.log('repaso-recovery-semantic-chunking-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
