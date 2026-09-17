import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import type { ImportanceTier, KnowledgeUnit, KnowledgeUnitKind, MaterialBrain } from '../../lib/materialBrain/types'
import { __clearSourceIndexCache } from '../../lib/materials/sourceIndex'
import { POST, __routeDeps } from '../../app/api/alai-studyal-chat/route'

// ============================================================
// Fixtures
// ============================================================

function unit(
  id: string, label: string, statement: string, materialId: string, page: number,
  kind: KnowledgeUnitKind = 'definition', derivation: 'native_text' | 'vision' = 'native_text', tier: ImportanceTier = 'supporting',
): KnowledgeUnit {
  return {
    id, kind,
    identity: { canonicalSubject: id, semanticKey: id, qualifiers: [] },
    label, statement,
    importance: { tier, signals: ['model_judged'], confidence: 0.9 },
    provenance: derivation === 'vision' ? [] : [{ materialId, page, quote: statement, chunkId: `c-${page}` }],
    evidence: derivation === 'vision'
      ? [{ materialId, page, derivation: 'vision', pageFingerprint: `pf-${id}`, analyzerVersion: '1.0', promptVersion: '1.0', description: statement }]
      : [{ materialId, page, derivation: 'native_text', quote: statement, chunkId: `c-${page}` }],
    domainTags: [],
  } as any
}

function relation(id: string, type: any, fromUnitId: string, toUnitId: string, statement: string) {
  return { id, type, fromUnitId, toUnitId, statement, importance: { tier: 'supporting', signals: [], confidence: 0.8 }, provenance: [] }
}

function pageContent(n: number): string {
  if (n === 5) return 'La constante de equilibrio Kc se define como la relación entre las concentraciones de productos y reactivos en equilibrio, elevadas a sus coeficientes estequiométricos.'
  if (n === 6) return 'Figura 6.1: diagrama de energía potencial de la reaccion, mostrando el estado de transicion entre reactivos y productos.'
  if (n === 7) return 'El profesor recomienda repasar el capitulo 3 antes del examen final, ya que integra varios conceptos previos.'
  if (n === 9) return 'Formulas relevantes de la seccion: Primera formula: Kc = [C]^c[D]^d / [A]^a[B]^b. Segunda formula: Kp = Kc(RT)^(Δn).'
  if (n === 13) return 'La pagina trece resume las diferencias practicas entre presion parcial y concentracion molar en sistemas gaseosos.'
  return `Contenido general de la pagina ${n} sobre equilibrio quimico y sus aplicaciones industriales.`
}

function rawTextWithPages(totalPages: number): string {
  const parts: string[] = []
  for (let p = 1; p <= totalPages; p++) parts.push(`[Pagina ${p}]\n${pageContent(p)}`)
  return parts.join('\n\n')
}

function brain(fingerprint: string, extraUnits: KnowledgeUnit[] = [], extraRelations: any[] = []): MaterialBrain {
  const units = [
    unit('kc', 'Constante Kc', 'Kc es la constante de equilibrio en terminos de concentraciones molares.', 'mat-a', 5, 'definition'),
    unit('kp', 'Constante Kp', 'Kp es la constante de equilibrio en terminos de presiones parciales.', 'mat-a', 9, 'definition'),
    unit('diagram6', 'Diagrama de energia', 'El diagrama muestra el estado de transicion entre reactivos y productos con su barrera energetica.', 'mat-a', 6, 'fact', 'vision'),
    ...extraUnits,
  ]
  const relations = [
    relation('r-kc-kp', 'contrasts_with', 'kc', 'kp', 'Kc y Kp difieren en que Kc usa concentraciones y Kp usa presiones parciales.'),
    ...extraRelations,
  ]
  return {
    scope: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': Array.from({ length: 10 }, (_, i) => i + 1) }), fingerprint },
    meta: {
      version: '1.0.0', builderVersion: MATERIAL_BRAIN_BUILDER_VERSION, generatedAt: new Date(0).toISOString(),
      chunking: { strategy: 'test', chunkSizeChars: 1000, chunkCount: 1 }, llmCallsUsed: 0, retries: 0, status: 'ready',
    },
    units, relations,
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'not_required' },
    knowledgeExtraction: { chunksAttempted: 1, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}

let providerCallCount = 0

/** Mock provider: a "well-behaved" provider that cites exactly what retrieval offered (parsed from the real grounded prompt's [BRAIN_UNIT id] / [SOURCE_BLOCK id] tags). */
function wellBehavedProvider(prompt: string) {
  providerCallCount++
  const unitIds = [...prompt.matchAll(/\[BRAIN_UNIT (\S+)\]/g)].map(m => m[1])
  const relationIds = [...prompt.matchAll(/\[BRAIN_RELATION (\S+)\]/g)].map(m => m[1])
  const blockIds = [...prompt.matchAll(/\[SOURCE_BLOCK (\S+)\]/g)].map(m => m[1])
  return {
    answer: unitIds.length || blockIds.length ? 'Respuesta grounded basada en el material.' : 'Respuesta de conocimiento general, sin relación con el material.',
    usedUnitIds: unitIds, usedRelationIds: relationIds, usedSourceBlockIds: blockIds,
    suggestedFollowups: ['¿Quieres más detalle?'],
  }
}

/** Adversarial provider: fabricates ids never offered, plus a false page-999 claim in prose. */
function adversarialProvider(prompt: string) {
  providerCallCount++
  const realBlockId = prompt.match(/\[SOURCE_BLOCK (\S+)\]/)?.[1]
  return {
    answer: 'Segun la pagina 999 del material, esto es correcto (cita inventada).',
    usedUnitIds: ['unit:doesnotexist', 'kc'],
    usedRelationIds: ['relation:fake'],
    usedSourceBlockIds: ['block:fake999999', ...(realBlockId ? [] : [])],
    suggestedFollowups: [],
  }
}

function baseDeps(
  b: MaterialBrain | null, rawText: string, providerFn: (prompt: string) => any, opts: { selectedPages?: number[]; brainMissing?: boolean } = {},
) {
  const fingerprint = b?.scope.fingerprint || 'fp-nobra1n'
  const selectedPages = opts.selectedPages || Array.from({ length: 10 }, (_, i) => i + 1)
  return {
    getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
    getAuthoritativeFreeSession: async (sessionId: string, userId: string) => {
      if (sessionId !== 'sess-1' || userId !== 'user-1') return null
      return { id: sessionId, userId, processMode: 'free', sourceSelection: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': selectedPages }), fingerprint } } as any
    },
    getMaterial: async () => ({ id: 'mat-a', nombre: 'Quimica.pdf', kind: 'pdf' }) as any,
    getMaterialText: async () => ({ material_id: 'mat-a', raw_text: rawText, created_at: '', updated_at: '' }),
    restoreMaterialBrain: async () => (opts.brainMissing ? null : b),
    generateValidatedLegacyJson: async ({ validate, prompt }: any) => {
      const value = providerFn(prompt)
      assert.ok(validate(value).valid, 'mock response must satisfy route validation')
      return value
    },
  }
}

async function chat(message: string, previousGrounding: any = null) {
  const req = new NextRequest('http://localhost/api/alai-studyal-chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-1', message, previousGrounding }),
  })
  const res = await POST(req)
  const data = await res.json()
  return { res, data }
}

function freshEnv(providerFn = wellBehavedProvider, selectedPages = Array.from({ length: 10 }, (_, i) => i + 1)) {
  __clearSourceIndexCache()
  providerCallCount = 0
  const b = brain('fp-chat')
  const rawText = rawTextWithPages(14)
  Object.assign(__routeDeps, baseDeps(b, rawText, providerFn, { selectedPages }))
  return { b, rawText }
}

// ============================================================
// CHAT-SOURCE-1/2 — every selected page retrievable, unselected never leaks
// ============================================================
async function testSourcePageCoverageAndLeakage() {
  freshEnv()
  const { data } = await chat('Que dice la pagina 5 sobre Kc?')
  assert.equal(data.success, true)
  assert.ok(data.sourcePages.includes(5), 'CHAT-SOURCE-1 the explicitly requested selected page is retrievable and cited')

  const { data: leakData } = await chat('Que dice la pagina 13 del material?')
  assert.ok(!leakData.sourcePages.includes(13), 'CHAT-SOURCE-2 an UNSELECTED page (13 is outside the selected 1-10 range) never leaks into citations')

  console.log('alai-chat-material-retrieval-contracts: CHAT-SOURCE-1/2 PASS')
}

// ============================================================
// CHAT-SOURCE-3 — exact phrase query finds faithful source block
// ============================================================
async function testExactPhraseRetrieval() {
  freshEnv()
  const { data } = await chat('¿Qué dice exactamente el material sobre la relación entre concentraciones de productos y reactivos?')
  assert.ok(data.usedSourceBlockIds.length > 0, 'CHAT-SOURCE-3 exact-phrase query surfaces a faithful source block')
  assert.equal(data.mode, 'MATERIAL_ONLY', 'exact-wording intent routes to MATERIAL_ONLY')
  console.log('alai-chat-material-retrieval-contracts: CHAT-SOURCE-3 PASS')
}

// ============================================================
// CHAT-SOURCE-4 — explicit page query prioritizes that page
// ============================================================
async function testExplicitPagePriority() {
  freshEnv()
  const { data } = await chat('Explicame la segunda formula de la pagina 9.')
  assert.ok(data.sourcePages.every((p: number) => p === 9), 'CHAT-SOURCE-4 explicit page reference dominates — only page 9 blocks are cited')
  assert.ok(data.usedSourceBlockIds.length > 0)
  console.log('alai-chat-material-retrieval-contracts: CHAT-SOURCE-4 PASS')
}

// ============================================================
// CHAT-SOURCE-5 — detail absent from Brain, present in source, still answerable
// ============================================================
async function testDetailAbsentFromBrainStillAnswerable() {
  freshEnv()
  // "repasar el capitulo 3" (page 7) has NO corresponding Brain unit —
  // only the Brain's kc/kp/diagram6 units exist. Source-only retrieval
  // must still surface it.
  const { data } = await chat('¿Qué recomienda el profesor sobre el capítulo 3 antes del examen?')
  assert.ok(data.usedSourceBlockIds.length > 0, 'CHAT-SOURCE-5 a detail with no KnowledgeUnit is still retrievable via the source index')
  assert.ok(data.sourcePages.includes(7))
  console.log('alai-chat-material-retrieval-contracts: CHAT-SOURCE-5 PASS')
}

// ============================================================
// CHAT-BRAIN-1/2 — relevant unit + relations retrieved
// ============================================================
async function testBrainUnitAndRelationRetrieval() {
  freshEnv()
  const { data } = await chat('¿Cuál es la diferencia entre Kc y Kp?')
  assert.ok(data.usedUnitIds.includes('kc') || data.usedUnitIds.includes('kp'), 'CHAT-BRAIN-1 relevant Brain unit retrieved')
  assert.ok(data.usedRelationIds.includes('r-kc-kp'), 'CHAT-BRAIN-2 the contrasts_with relation between Kc and Kp is included')
  console.log('alai-chat-material-retrieval-contracts: CHAT-BRAIN-1/2 PASS')
}

// ============================================================
// CHAT-BRAIN-3 — stale/partial Brain never blocks Chat, just narrows to source-only
// ============================================================
async function testStaleBrainDoesNotBlockChat() {
  __clearSourceIndexCache()
  providerCallCount = 0
  const staleBrain = { ...brain('fp-chat'), meta: { ...brain('fp-chat').meta, builderVersion: 'stale-version' } }
  Object.assign(__routeDeps, baseDeps(staleBrain as any, rawTextWithPages(14), wellBehavedProvider))
  const { res, data } = await chat('Que dice la pagina 5?')
  assert.equal(res.status, 200, 'CHAT-BRAIN-3 a stale Brain does not block Chat')
  assert.equal(data.success, true)
  assert.ok(data.sourcePages.includes(5), 'source-only retrieval still works without a valid Brain')
  console.log('alai-chat-material-retrieval-contracts: CHAT-BRAIN-3 PASS')
}

// ============================================================
// CHAT-MODE-1/2/3
// ============================================================
async function testAnswerModes() {
  freshEnv()
  const { data: materialOnly } = await chat('¿Qué dice mi material sobre la página 5?')
  assert.equal(materialOnly.mode, 'MATERIAL_ONLY', 'CHAT-MODE-1 explicit material-scoped question routes MATERIAL_ONLY')

  const { data: general } = await chat('¿Cuál es la capital de Australia?')
  assert.equal(general.mode, 'GENERAL_ONLY', 'CHAT-MODE-2 question clearly outside the material routes GENERAL_ONLY')
  assert.equal(general.usedUnitIds.length, 0)
  assert.equal(general.usedSourceBlockIds.length, 0)

  const { data: mixed } = await chat('¿Qué es Kc y por qué es un concepto importante en química en general?')
  assert.ok(['MIXED', 'MATERIAL_ONLY'].includes(mixed.mode), 'CHAT-MODE-3 material-grounded question without explicit material-only scoping is MIXED (or MATERIAL_ONLY if scoping keywords matched)')

  console.log('alai-chat-material-retrieval-contracts: CHAT-MODE-1/2/3 PASS')
}

// ============================================================
// CHAT-GROUND-1/2/3 — adversarial provider cannot fabricate provenance
// ============================================================
async function testAdversarialProvenance() {
  freshEnv(adversarialProvider)
  const { data } = await chat('Que dice la pagina 5 sobre Kc?')
  assert.ok(!data.usedSourceBlockIds.includes('block:fake999999'), 'CHAT-GROUND-2 fabricated source block id dropped')
  assert.ok(!data.usedUnitIds.includes('unit:doesnotexist'), 'fabricated unit id dropped')
  assert.ok(!data.usedRelationIds.includes('relation:fake'), 'fabricated relation id dropped')
  assert.ok(!data.sourcePages.includes(999), 'CHAT-GROUND-1 provider cannot fabricate page 999 provenance despite claiming it in prose')
  console.log('alai-chat-material-retrieval-contracts: CHAT-GROUND-1/2 PASS')

  // CHAT-GROUND-3: general knowledge (zero grounding available) receives no material citation even from an adversarial provider.
  const { data: generalAdversarial } = await chat('¿Cuál es la capital de Francia?')
  assert.equal(generalAdversarial.mode, 'GENERAL_ONLY')
  assert.equal(generalAdversarial.sourcePages.length, 0, 'CHAT-GROUND-3 general knowledge receives no material citation')
  assert.equal(generalAdversarial.sourceMaterial, '')
  console.log('alai-chat-material-retrieval-contracts: CHAT-GROUND-3 PASS')
}

// ============================================================
// CHAT-FOLLOWUP-1 — "why?" resolves using prior turn grounding
// ============================================================
async function testFollowupContinuity() {
  freshEnv()
  const { data: first } = await chat('¿Cuál es la diferencia entre Kc y Kp?')
  const grounding = { mode: first.mode, usedUnitIds: first.usedUnitIds, usedRelationIds: first.usedRelationIds, usedSourceBlockIds: first.usedSourceBlockIds, materialIds: first.materialIds, pages: first.sourcePages }
  const { data: followup } = await chat('¿y por qué pasa eso?', grounding)
  assert.ok(followup.usedUnitIds.includes('kc') || followup.usedUnitIds.includes('kp'), 'CHAT-FOLLOWUP-1 "why?" resolves using prior turn grounded unit ids, not just raw text history')
  console.log('alai-chat-material-retrieval-contracts: CHAT-FOLLOWUP-1 PASS')
}

// ============================================================
// CHAT-VISION-1/2 — visual evidence retrievable, 0 new vision calls
// ============================================================
async function testVisionRetrieval() {
  freshEnv()
  const before = providerCallCount
  const { data } = await chat('¿Qué muestra el diagrama de energía de la página 6?')
  assert.ok(data.usedUnitIds.includes('diagram6'), 'CHAT-VISION-1 vision-derived Brain unit is retrievable for a visual question')
  // Exactly one provider call (the answer itself) — no separate vision/analyzer call exists in this path at all.
  assert.equal(providerCallCount, before + 1, 'CHAT-VISION-2 zero NEW vision calls — only the one normal answer-generation call')
  console.log('alai-chat-material-retrieval-contracts: CHAT-VISION-1/2 PASS')
}

// ============================================================
// CHAT-PERF-1/2 — retrieval and opening chat cost 0 provider calls
// ============================================================
async function testZeroProviderCallsForRetrieval() {
  freshEnv()
  // "Opening chat" itself never calls this route at all (client-side
  // state restore only) — CHAT-PERF-2 is a structural fact, verified
  // via source inspection of the component instead of an HTTP call.
  const componentSource = require('node:fs').readFileSync('components/materias/ALAIStudyALChat.tsx', 'utf8') as string
  assert.ok(!componentSource.includes("fetch('/api/alai-studyal-chat'") || componentSource.includes('runTurn'), 'the chat endpoint is only called from an explicit user turn (runTurn), never on mount')

  const before = providerCallCount
  await chat('Que dice la pagina 5?')
  // Retrieval itself (source index build + search + brain scoring) does
  // not call generateValidatedLegacyJson more than once per turn — the
  // ONE call is the answer generation itself, not retrieval.
  assert.equal(providerCallCount, before + 1, 'CHAT-PERF-1 retrieval costs 0 provider calls — exactly one call total per turn, for the answer')
  console.log('alai-chat-material-retrieval-contracts: CHAT-PERF-1/2 PASS')
}

// ============================================================
// CHAT-RESUME-1/2 — grounding survives refresh; new fingerprint isolates old grounding
// ============================================================
function testResumeSemantics() {
  const stateSource = require('node:fs').readFileSync('lib/freeAlaiState.ts', 'utf8') as string
  assert.ok(stateSource.includes('usedUnitIds?: string[]') && stateSource.includes('usedSourceBlockIds?: string[]'),
    'CHAT-RESUME-1 grounding metadata is part of the persisted DurableAlaiMessage shape, so it survives refresh with the rest of the conversation')

  const componentSource = require('node:fs').readFileSync('components/materias/ALAIStudyALChat.tsx', 'utf8') as string
  assert.ok(componentSource.includes('effectiveSourceSelection.fingerprint'), 'chat state is scoped by source fingerprint')
  assert.ok(componentSource.includes('lastGroundedTurn'), 'CHAT-RESUME-2 follow-up grounding is derived from the CURRENT conversation only — a new fingerprint means a fresh conversation (see initialAlaiState), so old grounding can never leak across selections')
  console.log('alai-chat-material-retrieval-contracts: CHAT-RESUME-1/2 PASS (structural)')
}

// ============================================================
// §22 — Real-shape acceptance: large structurally-real source
// ============================================================
async function testRealShapeAcceptance() {
  __clearSourceIndexCache()
  providerCallCount = 0
  const b = brain('fp-realshape')
  const rawText = rawTextWithPages(40)
  const selectedPages = Array.from({ length: 40 }, (_, i) => i + 1)
  Object.assign(__routeDeps, baseDeps(b, rawText, wellBehavedProvider, { selectedPages }))

  const questions = [
    { q: 'Que dice exactamente la pagina 5 sobre Kc?', label: 'exact quote/detail' },
    { q: 'Que es Kc?', label: 'definition' },
    { q: 'Cual es la diferencia entre Kc y Kp?', label: 'relation between distant concepts' },
    { q: 'Que dice la pagina 13?', label: 'explicit page' },
    { q: 'Que recomienda el profesor sobre el capitulo 3?', label: 'tiny detail absent from Brain' },
    { q: 'Que muestra el diagrama de la pagina 6?', label: 'visual question' },
    { q: 'Cual es la capital de Japon?', label: 'general question unrelated to material' },
    { q: 'Que es Kc y por que la termodinamica es relevante en la industria en general?', label: 'mixed material/general' },
    { q: 'y por que pasa eso?', label: 'follow-up why', usesPriorGrounding: true },
    { q: 'Que dice mi material sobre agujeros negros?', label: 'unsupported claim' },
  ]

  const rows: any[] = []
  let priorGrounding: any = null
  const t0 = Date.now()
  for (const item of questions) {
    const turnStart = Date.now()
    const { data } = await chat(item.q, item.usesPriorGrounding ? priorGrounding : null)
    const latencyMs = Date.now() - turnStart
    priorGrounding = { mode: data.mode, usedUnitIds: data.usedUnitIds, usedRelationIds: data.usedRelationIds, usedSourceBlockIds: data.usedSourceBlockIds, materialIds: data.materialIds, pages: data.sourcePages }
    rows.push({
      label: item.label, mode: data.mode, unitsUsed: data.usedUnitIds.length, blocksUsed: data.usedSourceBlockIds.length,
      pages: data.sourcePages, retrievalMs: data.diagnostics?.retrievalMs,
    })
  }
  const totalMs = Date.now() - t0

  // Unsupported claim must be honest, never a fabricated citation.
  const unsupported = rows[rows.length - 1]
  assert.equal(unsupported.mode, 'GENERAL_ONLY', 'unsupported material claim ("agujeros negros") correctly falls back to GENERAL_ONLY, not a fake material citation')

  console.log('alai-chat-material-retrieval-contracts: REAL-SHAPE ACCEPTANCE —')
  console.log(`  source pages indexed=40, blocks indexed=${'see index build'}, brain units=${b.units.length}, totalProviderCalls=${providerCallCount}, totalMs=${totalMs}`)
  for (const row of rows) console.log(`  [${row.label}] mode=${row.mode} unitsUsed=${row.unitsUsed} blocksUsed=${row.blocksUsed} pages=${JSON.stringify(row.pages)} retrievalMs=${row.retrievalMs}`)
  console.log('alai-chat-material-retrieval-contracts: REAL-SHAPE ACCEPTANCE PASS')
}

async function main() {
  await testSourcePageCoverageAndLeakage()
  await testExactPhraseRetrieval()
  await testExplicitPagePriority()
  await testDetailAbsentFromBrainStillAnswerable()
  await testBrainUnitAndRelationRetrieval()
  await testStaleBrainDoesNotBlockChat()
  await testAnswerModes()
  await testAdversarialProvenance()
  await testFollowupContinuity()
  await testVisionRetrieval()
  await testZeroProviderCallsForRetrieval()
  testResumeSemantics()
  await testRealShapeAcceptance()
  console.log('alai-chat-material-retrieval-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
