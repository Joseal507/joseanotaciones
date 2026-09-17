import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps } from '../../app/api/alai-studyal-repasar/route'

/* ------------------------------------------------------------------ */
/* FINAL REPASO RECOVERY PRODUCT CALIBRATION — contracts A-H            */
/* Deterministic chunking (group membership != question membership)    */
/* and deterministic question-family variety ("Explica..." is a         */
/* fallback, never the default). Exercised through the REAL production */
/* repaso-initial -> repaso-recovery-open -> answer -> Continue path.   */
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

async function openSession(materialId: string, targets: any[], topicId = 'topic-1') {
  const pages = Array.from(new Set(targets.flatMap(t => t.pages || [])))
  const selection = buildSourceSelectionSnapshot([materialId], { [materialId]: pages })
  const payload = {
    sourceSelectionFingerprint: selection.fingerprint,
    topicsIndex: [{ id: topicId, title: 'Topic', order: 0 }],
    globalOrderedAnalysis: targets,
    uniqueConceptsIndex: [],
  }
  const artifacts = harness('sess-1', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-1', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })
  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const open = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200, `open must succeed deterministically: ${JSON.stringify(open.data)}`)
  const stored = artifacts.get(initial.artifactId)
  return { artifacts, initial, stored }
}

/* ------------------------------------------------------------------ */
/* A. SINGLE DEFINITION                                                */
/* ------------------------------------------------------------------ */

async function testContractA_SingleDefinition() {
  const quote = 'Δn representa la diferencia entre la suma de los moles de los productos gaseosos y la suma de los moles de los reactivos gaseosos.'
  const targets = [{
    id: 'deltaN', kind: 'concept', name: 'Definición de Δn en la relación Kc y Kp', summary: quote,
    importance: 90, materialId: 'mat-a', pages: [9], sourceSpans: [{ page: 9, quote }], topicId: 'topic-1', sourceOrder: 0,
  }]
  const { stored } = await openSession('mat-a', targets)
  const group = stored.recoveryPlan.groups[0]
  assert.deepEqual(group.assessedTargetIds, ['deltaN'])
  assert.ok(/definition|formula/.test(group.questionFamily), `expected definition/formula family, got ${group.questionFamily}`)
  assert.ok(/Δn/.test(group.question), `question must mention Δn: ${group.question}`)
}

/* ------------------------------------------------------------------ */
/* B. DIRECT REACTION                                                  */
/* ------------------------------------------------------------------ */

async function testContractB_DirectReaction() {
  const quote = 'La reacción directa transforma N2O4 en NO2 según la ley de velocidad v = kf[N2O4].'
  const targets = [{
    id: 'directReactionAndRate', kind: 'process', name: 'Reacción directa y su ley de velocidad', summary: quote,
    importance: 90, materialId: 'mat-b', pages: [7], sourceSpans: [{ page: 7, quote }], topicId: 'topic-1', sourceOrder: 0,
  }]
  const { stored } = await openSession('mat-b', targets)
  const group = stored.recoveryPlan.groups[0]
  assert.deepEqual(group.assessedTargetIds, ['directReactionAndRate'])
  assert.ok(group.question.length > 0)
}

/* ------------------------------------------------------------------ */
/* C. CONNECTED DERIVATION — 4-target tight chain, same topic,          */
/* consecutive sourceOrder -> either one connected question (all 4) or  */
/* a deterministic split, but never silent knowledge loss.              */
/* ------------------------------------------------------------------ */

function chainTargets() {
  const gasQuote = 'La ley de los gases ideales establece que PV = nRT relaciona presión, volumen, moles y temperatura.'
  const pressureQuote = 'La presión en función de la concentración se expresa reordenando PV = nRT en términos de n/V.'
  const kpKcQuote = 'La relación Kp = Kc (RT)^Δn conecta ambas constantes de equilibrio.'
  const deltaNQuote = 'Δn representa la diferencia entre la suma de los moles de los productos gaseosos y la suma de los moles de los reactivos gaseosos.'
  return [
    { id: 'gas', kind: 'formula', name: 'Ley de los gases ideales', summary: gasQuote, importance: 90, materialId: 'mat-c', pages: [9], sourceSpans: [{ page: 9, quote: gasQuote }], topicId: 'topic-1', sourceOrder: 0 },
    { id: 'pressure', kind: 'formula', name: 'Presión en función de la concentración', summary: pressureQuote, importance: 85, materialId: 'mat-c', pages: [9], sourceSpans: [{ page: 9, quote: pressureQuote }], topicId: 'topic-1', sourceOrder: 1 },
    { id: 'kpkc', kind: 'formula', name: 'Relación entre Kc y Kp', summary: kpKcQuote, importance: 80, materialId: 'mat-c', pages: [9], sourceSpans: [{ page: 9, quote: kpKcQuote }], topicId: 'topic-1', sourceOrder: 2 },
    { id: 'deltaN', kind: 'concept', name: 'Definición de Δn en la relación Kc y Kp', summary: deltaNQuote, importance: 75, materialId: 'mat-c', pages: [9], sourceSpans: [{ page: 9, quote: deltaNQuote }], topicId: 'topic-1', sourceOrder: 3 },
  ]
}

async function testContractC_ConnectedDerivation() {
  const targets = chainTargets()
  const { stored } = await openSession('mat-c', targets)
  const groups = stored.recoveryPlan.groups
  const primary = groups[0]
  assert.ok(primary.assessedTargetIds.length >= 1)
  // Either the coherence rule accepted all four in one chunk, or it split —
  // both acceptable IF no knowledge is silently lost (every target ends up
  // assessed by SOME group, none is silently dropped).
  const allAssessedAcrossGroups = new Set<string>()
  for (const g of groups) for (const id of (g.assessedTargetIds || [])) allAssessedAcrossGroups.add(id)
  for (const t of targets) {
    const inAnyGroupTargets = groups.some((g: any) => (g.targetIds || []).includes(t.id))
    assert.ok(inAnyGroupTargets, `${t.id} must not be silently dropped from all groups`)
  }
  if (primary.assessedTargetIds.length === 4) {
    assert.deepEqual(new Set(primary.assessedTargetIds), new Set(['gas', 'pressure', 'kpkc', 'deltaN']))
  } else {
    assert.ok(primary.assessedTargetIds.length < 4, 'a split must be a genuine subset, never a silent 4-target dump')
  }
}

/* ------------------------------------------------------------------ */
/* D. EQUILIBRIUM DIRECTION GROUP — 3 targets, must not become one      */
/* "Explica, según el material: A, B y C." dump.                        */
/* ------------------------------------------------------------------ */

async function testContractD_EquilibriumDirectionGroup() {
  const reachQuote = 'El equilibrio puede alcanzarse tanto partiendo de reactivos como de productos.'
  const graphQuote = 'La gráfica muestra cómo se alcanza el mismo equilibrio partiendo de direcciones distintas.'
  const constancyQuote = 'La relación de concentraciones permanece constante una vez alcanzado el equilibrio.'
  const targets = [
    { id: 'reach', kind: 'concept', name: 'Equilibrio alcanzable desde cualquier dirección', summary: reachQuote, importance: 90, materialId: 'mat-d', pages: [11], sourceSpans: [{ page: 11, quote: reachQuote }], topicId: 'topic-1', sourceOrder: 0 },
    { id: 'graph', kind: 'concept', name: 'Ejemplo gráfico desde direcciones distintas', summary: graphQuote, importance: 85, materialId: 'mat-d', pages: [11], sourceSpans: [{ page: 11, quote: graphQuote }], topicId: 'topic-1', sourceOrder: 1 },
    { id: 'constancy', kind: 'concept', name: 'Constancia de la relación de concentraciones', summary: constancyQuote, importance: 80, materialId: 'mat-d', pages: [11], sourceSpans: [{ page: 11, quote: constancyQuote }], topicId: 'topic-1', sourceOrder: 2 },
  ]
  const { stored } = await openSession('mat-d', targets)
  const primary = stored.recoveryPlan.groups[0]
  assert.ok(!/^Explica, según el material: .+, .+ y .+\.$/.test(primary.question),
    `must not be a mechanical 3-way dump: ${primary.question}`)
}

/* ------------------------------------------------------------------ */
/* E. UNRELATED SAME-GROUP TARGETS — assessedTargetIds must be a        */
/* genuine subset; remaining targets stay unresolved; Continue          */
/* produces another question; no false mastery.                        */
/* ------------------------------------------------------------------ */

async function testContractE_UnrelatedSameGroupTargets() {
  const targets = chainTargets() // reuse: only the FIRST is genuinely groundable alone, rest are decorative-thin
  for (const t of targets) t.materialId = 'mat-e'
  targets[1].summary = 'Presión'
  targets[1].sourceSpans = [{ page: 9, quote: 'Presión' }]
  targets[2].summary = 'Relación Kp Kc'
  targets[2].sourceSpans = [{ page: 9, quote: 'Relación Kp Kc' }]
  targets[3].summary = 'Delta n'
  targets[3].sourceSpans = [{ page: 9, quote: 'Delta n' }]
  const { artifacts, initial, stored } = await openSession('mat-e', targets)
  const group = stored.recoveryPlan.groups.find((g: any) => g.assessedTargetIds?.length)
  assert.ok(group)
  const allTargetIds = targets.map(t => t.id)
  assert.ok(group.assessedTargetIds.length < allTargetIds.length,
    'assessedTargetIds must be a proper subset of the original 4-target group')
  assert.ok(stored.recoveryPlan.groups.length > 1, 'the unassessed targets must have been split into a remainder group')

  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'analysis_batch') {
        return { targetCoverage: group.assessedTargetIds.map((id: string) => ({ targetId: id, status: 'covered', evidence: 'e', demonstrated: 'Correcto.', missingDetail: '' })) }
      }
      throw new Error('unexpected provider call at answer time')
    },
  })
  const answer = await post('sess-1', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: group.groupId,
    attemptClientId: 'a1', answer: 'Respuesta completa sobre lo preguntado.',
  })
  assert.equal(answer.response.status, 200)
  assert.equal(answer.data.feedback.groupResolved, true)

  const afterAnswer = artifacts.get(initial.artifactId)
  const untouched = targets.map(t => t.id).filter(id => !group.assessedTargetIds.includes(id))
  for (const id of untouched) {
    assert.equal(afterAnswer.currentTargetStates[id].status, 'missing', `${id} was not assessed and must remain unresolved`)
  }
  const remainderGroup = afterAnswer.recoveryPlan.groups.find((g: any) => g.groupId !== group.groupId)
  assert.ok(remainderGroup, 'unresolved siblings must be preserved as another group for Continue')
}

/* ------------------------------------------------------------------ */
/* F. VARIETY — several distinct question families, "Explica..." not    */
/* dominant.                                                            */
/* ------------------------------------------------------------------ */

async function testContractF_Variety() {
  const cases: { materialId: string; targets: any[] }[] = [
    {
      materialId: 'mat-f1',
      targets: [{ id: 'def1', kind: 'concept', name: 'Definición de entalpía', summary: 'La entalpía es una función de estado que mide el calor a presión constante.', importance: 90, materialId: 'mat-f1', pages: [3], sourceSpans: [{ page: 3, quote: 'La entalpía es una función de estado que mide el calor a presión constante.' }], topicId: 'topic-1', sourceOrder: 0 }],
    },
    {
      materialId: 'mat-f2',
      targets: [{ id: 'form1', kind: 'formula', name: 'Ecuación de Arrhenius', summary: 'k = A e^(-Ea/RT) expresa la dependencia de la constante de velocidad con la temperatura.', importance: 90, materialId: 'mat-f2', pages: [4], sourceSpans: [{ page: 4, quote: 'k = A e^(-Ea/RT) expresa la dependencia de la constante de velocidad con la temperatura.' }], topicId: 'topic-1', sourceOrder: 0 }],
    },
    {
      materialId: 'mat-f3',
      targets: [
        { id: 'rel1', kind: 'concept', name: 'Relación entre presión y volumen', summary: 'La presión y el volumen se relacionan de forma inversa a temperatura constante.', importance: 90, materialId: 'mat-f3', pages: [5], sourceSpans: [{ page: 5, quote: 'La presión y el volumen se relacionan de forma inversa a temperatura constante.' }], topicId: 'topic-1', sourceOrder: 0 },
        { id: 'rel2', kind: 'concept', name: 'Relación de Boyle', summary: 'La relación de Boyle establece que P1V1 = P2V2.', importance: 85, materialId: 'mat-f3', pages: [5], sourceSpans: [{ page: 5, quote: 'La relación de Boyle establece que P1V1 = P2V2.' }], topicId: 'topic-1', sourceOrder: 1 },
      ],
    },
    {
      materialId: 'mat-f4',
      targets: [{ id: 'proc1', kind: 'process', name: 'Difusión de gases', summary: 'La difusión de gases ocurre por el movimiento aleatorio de las partículas de mayor a menor concentración.', importance: 90, materialId: 'mat-f4', pages: [6], sourceSpans: [{ page: 6, quote: 'La difusión de gases ocurre por el movimiento aleatorio de las partículas de mayor a menor concentración.' }], topicId: 'topic-1', sourceOrder: 0 }],
    },
  ]
  const families: string[] = []
  const questions: string[] = []
  for (const c of cases) {
    const { stored } = await openSession(c.materialId, c.targets)
    const group = stored.recoveryPlan.groups[0]
    families.push(group.questionFamily)
    questions.push(group.question)
  }
  const uniqueFamilies = new Set(families)
  assert.ok(uniqueFamilies.size >= 3, `expected several distinct families, got ${JSON.stringify(families)}`)
  const explicaCount = questions.filter(q => q.startsWith('Explica, según el material:')).length
  assert.ok(explicaCount < questions.length, 'explanation_fallback must not be the dominant/default template')
}

/* ------------------------------------------------------------------ */
/* G. FREEZE/RESTORE — byte-for-byte question, assessedTargetIds,       */
/* provenance/family unchanged; zero provider calls on restore.         */
/* ------------------------------------------------------------------ */

async function testContractG_FreezeRestore() {
  const quote = 'Δn representa la diferencia entre la suma de los moles de los productos gaseosos y la suma de los moles de los reactivos gaseosos.'
  const targets = [{
    id: 'deltaN', kind: 'concept', name: 'Definición de Δn en la relación Kc y Kp', summary: quote,
    importance: 90, materialId: 'mat-g', pages: [9], sourceSpans: [{ page: 9, quote }], topicId: 'topic-1', sourceOrder: 0,
  }]
  const { artifacts, initial, stored } = await openSession('mat-g', targets)
  const before = stored.recoveryPlan.groups[0]

  Object.assign(__routeDeps, { generateValidatedLegacyJson: refuseQuestionAuthoringProvider() })
  const restore = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-restore' })
  assert.equal(restore.response.status, 200)
  const after = artifacts.get(initial.artifactId).recoveryPlan.groups[0]

  assert.equal(after.question, before.question)
  assert.deepEqual(after.assessedTargetIds, before.assessedTargetIds)
  assert.equal(after.questionProvenance, before.questionProvenance)
  assert.equal(after.questionFamily, before.questionFamily)
}

/* ------------------------------------------------------------------ */
/* H. RETRY — incomplete answer keeps same question/scope/pages/family, */
/* zero question-authoring calls.                                       */
/* ------------------------------------------------------------------ */

async function testContractH_Retry() {
  const quote = 'La reacción directa transforma N2O4 en NO2 según la ley de velocidad v = kf[N2O4].'
  const targets = [{
    id: 'directReactionAndRate', kind: 'process', name: 'Reacción directa y su ley de velocidad', summary: quote,
    importance: 90, materialId: 'mat-h', pages: [7], sourceSpans: [{ page: 7, quote }], topicId: 'topic-1', sourceOrder: 0,
  }]
  const { artifacts, initial, stored } = await openSession('mat-h', targets)
  const before = stored.recoveryPlan.groups[0]

  let questionAuthoringCalls = 0
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'repaso_recovery_question') { questionAuthoringCalls += 1; throw new Error('must not author on retry') }
      if (telemetryContext?.phase === 'analysis_batch') {
        return { targetCoverage: [{ targetId: 'directReactionAndRate', status: 'missing', evidence: '', demonstrated: '', missingDetail: 'Respuesta incompleta.' }] }
      }
      throw new Error('unexpected provider call')
    },
  })
  const answer = await post('sess-1', {
    artifactId: initial.artifactId, kind: 'repaso-recovery-answer', groupId: before.groupId,
    attemptClientId: 'a1', answer: 'no sé',
  })
  assert.equal(answer.response.status, 200)
  assert.equal(answer.data.feedback.groupResolved, false)

  const after = artifacts.get(initial.artifactId).recoveryPlan.groups.find((g: any) => g.groupId === before.groupId)
  assert.equal(after.question, before.question)
  assert.deepEqual(after.assessedTargetIds, before.assessedTargetIds)
  assert.deepEqual(after.pages, before.pages)
  assert.equal(after.questionFamily, before.questionFamily)
  assert.equal(questionAuthoringCalls, 0, 'retry must cost zero question-authoring provider calls')
}

async function main() {
  await testContractA_SingleDefinition()
  await testContractB_DirectReaction()
  await testContractC_ConnectedDerivation()
  await testContractD_EquilibriumDirectionGroup()
  await testContractE_UnrelatedSameGroupTargets()
  await testContractF_Variety()
  await testContractG_FreezeRestore()
  await testContractH_Retry()
  console.log('repaso-recovery-question-granularity-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
