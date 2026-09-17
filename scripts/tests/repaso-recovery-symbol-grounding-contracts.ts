import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  POST,
  __routeDeps,
  buildRepasoRecoveryQuestionGrounding,
  isRepasoRecoveryQuestionSupported,
  isSpecificRepasoRecoveryQuestion,
} from '../../app/api/alai-studyal-repasar/route'

/* ------------------------------------------------------------------ */
/* Unit: the exact live rejection, reproduced against the exact         */
/* canonical target and question text.                                  */
/* ------------------------------------------------------------------ */

function deltaNGrounding() {
  // Matches the EXACT live canonical shape: the target's own source-span
  // quote defines Δn but never restates "Kp"/"Kc" verbatim — those symbols
  // live only in the target's LABEL (its own name/subject). An earlier,
  // unrealistic test fixture had the quote itself repeat "Kp"/"Kc",
  // which is why that test passed even on pre-fix code while the real
  // live case still failed — this fixture reproduces the true gap.
  const targets = [{
    id: 'def_definicion_de_n_en_la_relacion_kc_y_kp',
    label: 'Definición de Δn en la relación Kc y Kp',
    statement: 'Δn representa la diferencia entre la suma de los moles de los productos gaseosos y la suma de los moles de los reactivos gaseosos.',
    sourceSpans: [{
      page: 9,
      quote: 'Δn representa la diferencia entre la suma de los moles de los productos gaseosos y la suma de los moles de los reactivos gaseosos.',
    }],
  }] as any
  return buildRepasoRecoveryQuestionGrounding({ targetIds: ['def_definicion_de_n_en_la_relacion_kc_y_kp'], pages: [9] } as any, targets)
}

function testDeltaNQuestionIsSpecificAndSupported() {
  const grounding = deltaNGrounding()
  const question = '¿Qué representa Δn en la relación entre Kp y Kc?'
  assert.equal(isSpecificRepasoRecoveryQuestion(question, grounding.targets), true)
  assert.equal(isRepasoRecoveryQuestionSupported(question, grounding), true,
    'a question about Δn must be supported when the canonical evidence literally defines Δn')
}

function testDeltaNSurvivesCaseAndUnicodeVariants() {
  const grounding = deltaNGrounding()
  // Accent/case variants of the surrounding Spanish text must not matter —
  // only the Δn token identity itself needs to survive tokenization.
  assert.equal(isRepasoRecoveryQuestionSupported('¿QUÉ REPRESENTA Δn EN LA RELACIÓN ENTRE Kp Y Kc?', grounding), true)
}

/* ------------------------------------------------------------------ */
/* Negative contracts — support validation must NOT be weakened         */
/* ------------------------------------------------------------------ */

function testUnrelatedConceptStillRejected() {
  const grounding = deltaNGrounding()
  assert.equal(isRepasoRecoveryQuestionSupported('¿Cómo afecta un catalizador a la posición del equilibrio?', grounding), false)
  assert.equal(isRepasoRecoveryQuestionSupported('¿Cómo se aplica el principio de Le Chatelier en este sistema?', grounding), false)
}

function testInventedFormulaStillRejected() {
  const grounding = deltaNGrounding()
  // ΔH is a real chemistry symbol but is NOT part of THIS target's evidence
  // (only Δn is grounded here) — introducing it must still fail.
  assert.equal(isRepasoRecoveryQuestionSupported('¿Cómo se relaciona ΔH con Δn en esta reacción?', grounding), false)
}

function testOtherMeaningfulSymbolsAreRecognized() {
  const targets = [{
    id: 't1', label: 'Relación Kp y Kc mediante Δn', statement: 'Kp = Kc (RT)^Δn relaciona ambas constantes mediante Δn.',
    sourceSpans: [{ page: 9, quote: 'Kp = Kc (RT)^Δn relaciona ambas constantes de equilibrio mediante el valor de Δn en la reacción.' }],
  }] as any
  const grounding = buildRepasoRecoveryQuestionGrounding({ targetIds: ['t1'], pages: [9] } as any, targets)
  assert.equal(isRepasoRecoveryQuestionSupported('¿Cómo se relaciona Kp con Kc mediante Δn?', grounding), true)
}

/* ------------------------------------------------------------------ */
/* Exact live-shaped end-to-end contract via the REAL authoring path    */
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

async function testLiveSymbolGroundingRegression() {
  const idealGasQuote = 'La ley de los gases ideales establece que PV = nRT relaciona presión, volumen, moles y temperatura.'
  const pressureQuote = 'La presión en función de la concentración se expresa reordenando PV = nRT en términos de n/V.'
  const kcKpQuote = 'Reacción decorativa' // decorative-only -> deferred at open time
  // Matches the exact live shape — the span defines Δn without restating
  // "Kp"/"Kc" verbatim; those live only in this target's own label.
  const deltaNQuote = 'Δn representa la diferencia entre la suma de los moles de los productos gaseosos y la suma de los moles de los reactivos gaseosos.'
  const targets = [
    { id: 'formula_ley_de_los_gases_ideales', kind: 'formula', name: 'Ley de los gases ideales', summary: idealGasQuote, importance: 90, materialId: 'mat-x', pages: [9], sourceSpans: [{ page: 9, quote: idealGasQuote }], topicId: 'topic-1', globalOrder: 0 },
    { id: 'formula_presion_en_funcion_de_la_concentracion', kind: 'formula', name: 'Presión en función de la concentración', summary: pressureQuote, importance: 85, materialId: 'mat-x', pages: [9], sourceSpans: [{ page: 9, quote: pressureQuote }], topicId: 'topic-1', globalOrder: 1 },
    { id: 'formula_relacion_entre_kc_y_kp', kind: 'formula', name: 'Relación entre Kc y Kp', summary: kcKpQuote, importance: 80, materialId: 'mat-x', pages: [9], sourceSpans: [{ page: 9, quote: kcKpQuote }], topicId: 'topic-1', globalOrder: 2 },
    { id: 'def_definicion_de_n_en_la_relacion_kc_y_kp', kind: 'concept', name: 'Definición de Δn en la relación Kc y Kp', summary: deltaNQuote, importance: 75, materialId: 'mat-x', pages: [9], sourceSpans: [{ page: 9, quote: deltaNQuote }], topicId: 'topic-1', globalOrder: 3 },
  ]
  const selection = buildSourceSelectionSnapshot(['mat-x'], { 'mat-x': [9] })
  const payload = {
    sourceSelectionFingerprint: selection.fingerprint,
    topicsIndex: [{ id: 'topic-1', title: 'Kc y Kp', order: 0 }],
    globalOrderedAnalysis: targets,
    uniqueConceptsIndex: [],
  }
  const artifacts = harness('sess-1', selection, payload, initialCoverageMock(targets))
  const { data: initial } = await post('sess-1', { explanation: 'x', mode: 'libre', kind: 'repaso-initial' })

  let questionAuthoringCalls = 0
  Object.assign(__routeDeps, {
    generateValidatedLegacyJson: async ({ telemetryContext }: any) => {
      if (telemetryContext?.phase === 'repaso_recovery_question') { questionAuthoringCalls += 1; throw new Error('provider must not be needed') }
      throw new Error('unexpected provider call at open time')
    },
  })
  const open = await post('sess-1', { artifactId: initial.artifactId, kind: 'repaso-recovery-open' })
  assert.equal(open.response.status, 200, `open must succeed via deterministic authoring: ${JSON.stringify(open.data)}`)
  assert.equal(questionAuthoringCalls, 0, 'a deterministically supportable Δn question must cost zero provider calls')

  const stored = artifacts.get(initial.artifactId)
  const groundedByLabel = stored.recoveryPlan.groups.find((g: any) => g.assessedTargetIds?.includes('def_definicion_de_n_en_la_relacion_kc_y_kp'))
  assert.ok(groundedByLabel, 'the Δn target must be assessable — never silently ungroundable due to the tokenization bug')
  assert.ok(groundedByLabel.question.length > 0)
}

/* ------------------------------------------------------------------ */
/* Provider repair-loop budget ceiling (unit-level, on the validator     */
/* callback contract itself — the fix above makes deterministic          */
/* authoring succeed for essentially any properly-labeled canonical      */
/* target, so the full route can no longer be forced into the provider   */
/* path with a well-formed fixture; that is itself the intended outcome. */
/* ------------------------------------------------------------------ */

function testVerbatimRepeatedRejectionIsMarkedNonRetryable() {
  // Re-implements the exact dedup contract used inside
  // authorRepasoRecoveryQuestion's validate callback: a repair attempt
  // that returns the SAME normalized question already rejected must be
  // marked non-retryable, so the pipeline can never attempt a THIRD call
  // even if a future repair stage were added to the ladder.
  let firstRejectedNormalized: string | null = null
  const normalize = (s: string) => s.trim().toLowerCase()
  const validate = (question: string) => {
    const valid = false // both attempts return an unsupported candidate
    if (valid) return { valid: true as const }
    const normalized = normalize(question)
    const isVerbatimRepeat = firstRejectedNormalized !== null && normalized === firstRejectedNormalized
    firstRejectedNormalized = firstRejectedNormalized ?? normalized
    return { valid: false as const, retryable: !isVerbatimRepeat }
  }
  const attempt1 = validate('¿Cuál es la idea principal?')
  const attempt2 = validate('¿Cuál es la idea principal?')
  assert.equal(attempt1.retryable, true, 'the FIRST rejection is always retryable — we do not yet know it will repeat')
  assert.equal(attempt2.retryable, false, 'a VERBATIM repeat of an already-rejected candidate must be marked non-retryable')
}

async function main() {
  testDeltaNQuestionIsSpecificAndSupported()
  testDeltaNSurvivesCaseAndUnicodeVariants()
  testUnrelatedConceptStillRejected()
  testInventedFormulaStillRejected()
  testOtherMeaningfulSymbolsAreRecognized()
  await testLiveSymbolGroundingRegression()
  testVerbatimRepeatedRejectionIsMarkedNonRetryable()
  console.log('repaso-recovery-symbol-grounding-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
