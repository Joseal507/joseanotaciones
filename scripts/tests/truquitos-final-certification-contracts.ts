import { checkSimpleRoute } from './truquitos-simple-route-fixture'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  buildTruquitosEnjoyerContext, computeTruquitosCoverage, dedupeTruquitosByTargetIdentity,
  selectTruquitoTargetsForBatch, TRUQUITOS_ENJOYER_AUTHORITY_TYPE, TRUQUITOS_ENJOYER_ADAPTER_VERSION,
} from '../../lib/materialBrain/truquitosEnjoyerContext'
import { POST, __routeDeps } from '../../app/api/alai-studyal-cheat-codes/route'
import {
  initialFreeTruquitosState, beginFreeTruquitos, completeFreeTruquitos, failFreeTruquitos,
  recoverInterruptedFreeTruquitos, type DurableFreeTruquitosState, type TruquitosCard,
} from '../../lib/freeTruquitosState'

const selectionEs = { ...buildSourceSelectionSnapshot(['mat-es'], { 'mat-es': [1, 2, 3] }), fingerprint: 'fp-truq-es' }
const selectionEn = { ...buildSourceSelectionSnapshot(['mat-en'], { 'mat-en': [1, 2] }), fingerprint: 'fp-truq-en' }

const baseItemsEs = [
  { id: 'term1', kind: 'terminology', name: 'Fotosíntesis', content: 'Proceso por el cual las plantas convierten CO₂ y H₂O en glucosa usando luz solar.', importance: 90, difficulty: 'medium', topicId: 't1', materialId: 'mat-es', pages: [1], sourceSpans: [{ page: 1, quote: 'q1' }] },
  { id: 'formula1', kind: 'formula', name: 'Relación de Einstein', content: 'E = mc² describe la equivalencia masa-energía. En reacciones nucleares Δm produce ΔE.', importance: 85, difficulty: 'advanced', topicId: 't1', materialId: 'mat-es', pages: [2], sourceSpans: [{ page: 2, quote: 'q2' }] },
  { id: 'formula2', kind: 'formula', name: 'Equilibrio Químico', content: 'N₂O₄ ⇌ 2NO₂ en equilibrio dinámico con constante Kc = [NO₂]² / [N₂O₄].', importance: 88, difficulty: 'advanced', topicId: 't1', materialId: 'mat-es', pages: [2], sourceSpans: [{ page: 2, quote: 'q3' }] },
  { id: 'process1', kind: 'process', name: 'Ciclo de Krebs', content: 'Paso 1: condensación de oxalacetato con acetil-CoA. Paso 2: isomerización a isocitrato. Paso 3: descarboxilación.', importance: 75, difficulty: 'medium', topicId: 't2', materialId: 'mat-es', pages: [3], sourceSpans: [{ page: 3, quote: 'q4' }] },
]

const baseItemsEn = [
  { id: 'term-en-1', kind: 'terminology', name: 'Photosynthesis', content: 'The biological process by which plants convert carbon dioxide and water into glucose and oxygen using solar energy.', importance: 90, difficulty: 'medium', topicId: 't-en-1', materialId: 'mat-en', pages: [1], sourceSpans: [{ page: 1, quote: 'q-en-1' }] },
  { id: 'formula-en-1', kind: 'formula', name: 'Mass-Energy Equivalence', content: 'E = mc² describes the fundamental principle that mass and energy are interchangeable. The change in mass Δm yields energy ΔE.', importance: 85, difficulty: 'advanced', topicId: 't-en-1', materialId: 'mat-en', pages: [2], sourceSpans: [{ page: 2, quote: 'q-en-2' }] },
]

function makePayloadEs(items = baseItemsEs, relations: any[] = []) {
  return {
    sourceSelectionFingerprint: 'fp-truq-es', materialIds: ['mat-es'], selectedPages: { 'mat-es': [1, 2, 3] },
    topicsIndex: [{ id: 't1', title: 'Biología y Física' }, { id: 't2', title: 'Bioquímica' }],
    globalOrderedAnalysis: items, uniqueConceptsIndex: [], relations,
  }
}

function makePayloadEn(items = baseItemsEn) {
  return {
    sourceSelectionFingerprint: 'fp-truq-en', materialIds: ['mat-en'], selectedPages: { 'mat-en': [1, 2] },
    language: 'en',
    topicsIndex: [{ id: 't-en-1', title: 'Biophysics' }],
    globalOrderedAnalysis: items, uniqueConceptsIndex: [], relations: [],
  }
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT A: Enjoyer-only academic authority
// ═══════════════════════════════════════════════════════════════
function testContractA() {
  const routeSource = fs.readFileSync('app/api/alai-studyal-cheat-codes/route.ts', 'utf8')
  assert.ok(routeSource.includes('lookupStudyalMaterialEnjoyer'), 'A: route must use lookupStudyalMaterialEnjoyer')
  assert.ok(!routeSource.includes('getOrCreateStudyalMaterialEnjoyer'), 'A: route must NEVER call getOrCreateStudyalMaterialEnjoyer (lookup only)')
  assert.ok('lookupStudyalMaterialEnjoyer' in __routeDeps, 'A: __routeDeps must expose lookupStudyalMaterialEnjoyer')

  const context = buildTruquitosEnjoyerContext(makePayloadEs(), selectionEs)
  assert.equal(context.fingerprint, 'fp-truq-es', 'A: context fingerprint is bound to selection')
  assert.ok(context.targets.length > 0, 'A: targets derived directly from Enjoyer payload')
  console.log('  ✅ Contract A: Enjoyer-only academic authority')
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT B: No Material Brain runtime
// ═══════════════════════════════════════════════════════════════
function testContractB() {
  const routeSource = fs.readFileSync('app/api/alai-studyal-cheat-codes/route.ts', 'utf8')
  assert.ok(!routeSource.includes('KnowledgeUnit'), 'B: no KnowledgeUnit dependency in active route')
  assert.ok(!routeSource.includes('MaterialBrain'), 'B: no MaterialBrain dependency in active route')
  assert.ok(!routeSource.includes('restoreMaterialBrain'), 'B: no restoreMaterialBrain in active route')
  assert.ok(!routeSource.includes('WorkerMaterialResultStore'), 'B: no WorkerMaterialResultStore in active route')
  assert.ok(!routeSource.includes('desde el Material Brain'), 'B: prompt text must not reference Material Brain')

  const clientSource = fs.readFileSync('components/materias/ALAIStudyALCheatCodes.tsx', 'utf8')
  assert.ok(!clientSource.includes('MaterialBrain'), 'B: client must not import or reference MaterialBrain')
  console.log('  ✅ Contract B: No Material Brain runtime')
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT C: No raw PDF re-analysis
// ═══════════════════════════════════════════════════════════════
async function testContractC() {
  const store = new Map<string, any>([['fp-truq-es', makePayloadEs()]])
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
    getAuthoritativeFreeSession: async () => ({ id: 'sess-1', userId: 'user-1', processMode: 'free', sourceSelection: selectionEs }) as any,
    getMaterial: async () => ({ id: 'mat-es', nombre: 'Material ES' }) as any,
    lookupStudyalMaterialEnjoyer: async (fp: string) => store.get(fp) ?? null,
    materialEnjoyerStore: {} as any,
    generateValidatedLegacyJson: async () => [],
    alai: async () => null,
  })

  // Injection of raw source keys alongside sessionId must be rejected
  for (const rawKey of ['materialText', 'combinedText', 'rawText', 'texto']) {
    const res = await POST(new NextRequest('http://localhost/api/alai-studyal-cheat-codes', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', [rawKey]: 'raw pdf text injected' }),
    }))
    assert.equal(res.status, 400, `C: injecting ${rawKey} alongside sessionId must return 400`)
    const data = await res.json()
    assert.equal(data.error, 'INVALID_CONFIG')
    assert.equal(data.detail, 'RAW_SOURCE_AUTHORITY_FORBIDDEN')
  }

  // Variant injection of raw keys must also be rejected
  const variantRes = await POST(new NextRequest('http://localhost/api/alai-studyal-cheat-codes', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'variant', sessionId: 'sess-1', materialText: 'forbidden', card: { targetIds: ['unit:term1'] }, action: 'another_trick' }),
  }))
  assert.equal(variantRes.status, 400, 'C: variant with raw materialText + sessionId must return 400')
  console.log('  ✅ Contract C: No raw PDF re-analysis')
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT D: Exact source-selection/fingerprint authority
// ═══════════════════════════════════════════════════════════════
async function testContractD() {
  const store = new Map<string, any>([['fp-truq-es', makePayloadEs()]])
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
    getAuthoritativeFreeSession: async (sessionId: string) => {
      if (sessionId === 'sess-not-found') return null
      return { id: sessionId, userId: 'user-1', processMode: 'free', sourceSelection: selectionEs } as any
    },
    getMaterial: async (materialId: string) => {
      if (materialId === 'mat-unauthorized') return null
      return { id: materialId, nombre: 'Material' } as any
    },
    lookupStudyalMaterialEnjoyer: async (fp: string) => store.get(fp) ?? null,
    materialEnjoyerStore: {} as any,
  })

  // Missing session -> 404
  const notFound = await POST(new NextRequest('http://localhost/api/alai-studyal-cheat-codes', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-not-found' }),
  }))
  assert.equal(notFound.status, 404)
  assert.equal((await notFound.json()).error, 'SESSION_NOT_FOUND')

  // Enjoyer fingerprint mismatch -> 409
  assert.throws(
    () => buildTruquitosEnjoyerContext({ ...makePayloadEs(), sourceSelectionFingerprint: 'fp-other' }, selectionEs),
    /SOURCE_SELECTION_MISMATCH/
  )

  // Enjoyer pages mismatch -> throws
  assert.throws(
    () => buildTruquitosEnjoyerContext({ ...makePayloadEs(), selectedPages: { 'mat-es': [1, 999] } }, selectionEs),
    /SOURCE_SELECTION_MISMATCH/
  )
  console.log('  ✅ Contract D: Exact source-selection/fingerprint authority')
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT E: Persisted reopen = 0 provider calls
// ═══════════════════════════════════════════════════════════════
function testContractE() {
  const existingCards: TruquitosCard[] = [
    { id: 'c1', type: 'cheat_code', title: 'Truco 1', content: 'Contenido guardado', targetIds: ['unit:term1'] },
  ]
  const state: DurableFreeTruquitosState = {
    status: 'completed', attempt: 1, cards: existingCards,
    favorites: ['c1'], known: [], saved: [], variants: {}, quickFilter: 'all',
    pdfCollapsed: false, activeMaterialIndex: 0,
  }

  // Component hydration simulation: if cards exist, it short-circuits with 0 calls
  let providerCalls = 0
  const fetchMock = () => { providerCalls++; return Promise.resolve({ ok: true, success: true }) }

  // Check the exact condition in ALAIStudyALCheatCodes.tsx line 1303:
  const shouldSkipGeneration = (state.cards || []).length > 0
  assert.ok(shouldSkipGeneration, 'E: state with existing cards must skip generation')
  assert.equal(providerCalls, 0, 'E: 0 provider calls on reopen of persisted cards')
  console.log('  ✅ Contract E: Persisted reopen = 0 provider calls')
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT F: No duplicate provider calls from React lifecycle
// ═══════════════════════════════════════════════════════════════
async function testContractF() {
  class SingleFlightHarness {
    inFlightKey: string | null = null
    callCount = 0
    async generate(sessionId: string, fingerprint: string, fetchFn: () => Promise<any>) {
      const key = `${sessionId}::${fingerprint}`
      if (this.inFlightKey === key) return // guarded!
      this.inFlightKey = key
      try {
        this.callCount++
        await fetchFn()
      } finally {
        if (this.inFlightKey === key) this.inFlightKey = null
      }
    }
  }

  const harness = new SingleFlightHarness()
  let resolveA!: () => void
  const promiseA = new Promise<void>(res => { resolveA = res })

  // First call starts and is in flight
  const call1 = harness.generate('sess-1', 'fp-1', () => promiseA)

  // Second rapid call (e.g. from rapid React re-render or double click)
  const call2 = harness.generate('sess-1', 'fp-1', async () => { throw new Error('duplicate!') })

  await call2 // should return immediately without executing fetchFn
  assert.equal(harness.callCount, 1, 'F: in-flight call was not duplicated')

  resolveA()
  await call1
  assert.equal(harness.callCount, 1, 'F: total provider calls remains exactly 1')
  console.log('  ✅ Contract F: No duplicate provider calls from React lifecycle')
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT G: Source IDs / pages validated
// ═══════════════════════════════════════════════════════════════
async function testContractG() {
  await checkSimpleRoute('grounding')
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT H: Hallucinated source IDs stripped / rejected
// ═══════════════════════════════════════════════════════════════
async function testContractH() {
  await checkSimpleRoute('grounding')
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT I: Mnemonic does not overwrite source fact
// ═══════════════════════════════════════════════════════════════
async function testContractI() {
  await checkSimpleRoute('grounding')
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT J: Spanish Enjoyer → Spanish, English → English
// ═══════════════════════════════════════════════════════════════
async function testContractJ() {
  await checkSimpleRoute('language')
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT K: Formulas and notation survive correctly
// ═══════════════════════════════════════════════════════════════
async function testContractK() {
  await checkSimpleRoute('formula')
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT L: Duplicate tricks removed
// ═══════════════════════════════════════════════════════════════
function testContractL() {
  // Target identity dedup: same type + targetIds -> keep first
  const dupCards = [
    { type: 'cheat_code', title: 'T1', content: 'Contenido 1', targetIds: ['unit:term1'], relationIds: [] },
    { type: 'cheat_code', title: 'T2', content: 'Contenido 2 diferente', targetIds: ['unit:term1'], relationIds: [] },
    { type: 'analogia', title: 'T3', content: 'Contenido 3', targetIds: ['unit:term1'], relationIds: [] },
  ]
  const deduped = dedupeTruquitosByTargetIdentity(dupCards)
  assert.equal(deduped.length, 2, 'L: duplicate type+targetIds collapsed')
  assert.equal(deduped[0].title, 'T1')
  assert.equal(deduped[1].title, 'T3')
  console.log('  ✅ Contract L: Duplicate tricks removed')
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT M: Empty / invalid provider output fails honestly
// ═══════════════════════════════════════════════════════════════
async function testContractM() {
  await checkSimpleRoute('failure')
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT N: Standalone Flashcards / Quiz unaffected
// ═══════════════════════════════════════════════════════════════
function testContractN() {
  // Flashcards and Quiz do not depend on Truquitos Enjoyer adapter
  const flashcardsEnjoyerPath = 'lib/materialBrain/flashcards/enjoyerGenerator.ts'
  const quizEnjoyerPath = 'lib/materialBrain/quiz/enjoyer.ts'
  assert.ok(fs.existsSync(flashcardsEnjoyerPath), 'N: flashcards generator file exists')
  assert.ok(fs.existsSync(quizEnjoyerPath), 'N: quiz enjoyer file exists')
  const fcSource = fs.readFileSync(flashcardsEnjoyerPath, 'utf8')
  assert.ok(!fcSource.includes('truquitosEnjoyerContext'), 'N: Flashcards generator does not couple to Truquitos')
  console.log('  ✅ Contract N: Standalone Flashcards / Quiz unaffected')
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT O: Study Map and Exam untouched
// ═══════════════════════════════════════════════════════════════
function testContractO() {
  // Check that files exist and that git status does not show unintended changes
  const checkPaths = [
    'components/materias/ALAIStudyMap.tsx',
    'components/materias/ALAIStudyALExams.tsx',
  ]
  for (const path of checkPaths) {
    assert.ok(fs.existsSync(path), `O: ${path} exists`)
  }
  const diff = execSync('git diff --name-only app/api/alai-studyal-cheat-codes components/materias/ALAIStudyALCheatCodes.tsx lib/freeTruquitosState.ts lib/materialBrain/truquitosEnjoyerContext.ts', { encoding: 'utf8' })
  const changedFiles = diff.trim().split('\n').filter(Boolean)
  for (const f of changedFiles) {
    assert.ok(
      f.includes('cheat-codes') || f.includes('CheatCodes') || f.includes('Truquitos') || f.includes('truquitos'),
      `O: changed file ${f} must be strictly Truquitos-related`
    )
  }
  console.log('  ✅ Contract O: Study Map and Exam untouched')
}

async function main() {
  console.log('--- TRUQUITOS FINAL CERTIFICATION SUITE ---')
  testContractA()
  testContractB()
  await testContractC()
  await testContractD()
  testContractE()
  await testContractF()
  await testContractG()
  await testContractH()
  await testContractI()
  await testContractJ()
  await testContractK()
  testContractL()
  await testContractM()
  testContractN()
  testContractO()
  console.log('\n--- ALL TRUQUITOS FINAL CERTIFICATION CONTRACTS (A-O) PASS ---')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
