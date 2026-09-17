import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { buildRepasarEnjoyerGroundedContext } from '../../lib/materialBrain/repasarEnjoyerContext'
import {
  freezeRepasarEnjoyerSnapshot,
  resolveRepasarEnjoyerSnapshot,
  snapshotGroundedContext,
} from '../../lib/materialBrain/repasarSnapshot'
import { POST, __routeDeps } from '../../app/api/alai-studyal-repasar/route'

const selection = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2] })
const payload = {
  sourceSelectionFingerprint: selection.fingerprint,
  topicsIndex: [{ id: 'topic-1', title: 'Equilibrio', order: 0 }],
  globalOrderedAnalysis: [
    {
      id: 'formula-1', kind: 'formula', name: 'Constante', summary: 'Kc relaciona concentraciones.',
      importance: 90, difficulty: 'advanced', materialId: 'mat-a', pages: [1],
      sourceSpans: [{ page: 1, quote: 'Kc relaciona concentraciones.' }], topicId: 'topic-1', globalOrder: 2,
    },
    {
      id: 'fact-low', kind: 'fact', name: 'Igualdad de velocidades en el equilibrio',
      summary: 'En equilibrio las velocidades son iguales y formalmente kf [N2O4] = kr [NO2]^2.',
      importance: 10, materialId: 'mat-a', pages: [2], sourceSpans: [{ page: 2, quote: 'kf [N2O4] = kr [NO2]^2.' }],
      topicId: 'topic-1', globalOrder: 1,
    },
  ],
  uniqueConceptsIndex: [
    {
      id: 'duplicate-other-id', kind: 'formula', name: 'Constante', summary: 'Kc relaciona concentraciones.',
      importance: 90, materialId: 'mat-a', pages: [1], sourceSpans: [{ page: 1, quote: 'Kc relaciona concentraciones.' }],
      topicId: 'topic-1', firstAppearanceOrder: 2,
    },
    {
      id: 'process-1', kind: 'process', name: 'Desplazamiento', summary: 'El sistema responde a una perturbación.',
      importance: 60, materialId: 'mat-a', pages: [2], sourceSpans: [{ page: 2, quote: 'El sistema responde a una perturbación.' }],
      topicId: 'topic-1', firstAppearanceOrder: 3,
    },
  ],
}

function testAdapter() {
  const context = buildRepasarEnjoyerGroundedContext(payload, selection)
  assert.equal(context.authorityType, 'studyal_material_enjoyer')
  assert.deepEqual(context.targets.map(target => target.id), ['fact-low', 'formula-1', 'process-1'])
  assert.equal(context.targets.length, 3, 'exact duplicate content must not double the denominator')
  assert.ok(context.targets.some(target => target.id === 'fact-low'), 'unique low-importance knowledge survives')
  assert.equal(context.targets.find(target => target.id === 'formula-1')?.kind, 'formula')
  assert.equal(context.targets.find(target => target.id === 'process-1')?.topicId, 'topic-1')
  assert.deepEqual(context.targets[0].sourceSpans, [{ page: 2, quote: 'kf [N2O4] = kr [NO2]^2.' }])

  assert.throws(
    () => buildRepasarEnjoyerGroundedContext({ ...payload, sourceSelectionFingerprint: 'wrong' }, selection),
    /SOURCE_SELECTION_MISMATCH/,
  )
  assert.throws(
    () => buildRepasarEnjoyerGroundedContext({
      ...payload,
      globalOrderedAnalysis: [{ ...payload.globalOrderedAnalysis[0], pages: [3] }],
    }, selection),
    /SOURCE_SELECTION_MISMATCH/,
  )
}

async function testSnapshot() {
  const context = buildRepasarEnjoyerGroundedContext(payload, selection)
  const frozen = freezeRepasarEnjoyerSnapshot(context, { snapshotId: 'snap-enjoyer', now: () => 0 })
  assert.equal(frozen.authorityType, 'studyal_material_enjoyer')
  assert.equal(snapshotGroundedContext(frozen).targets[0].id, 'fact-low')

  const snapshots = new Map<string, any>([[frozen.snapshotId, frozen]])
  const store = { async get(id: string) { return snapshots.get(id) || null }, async set(value: any) { snapshots.set(value.snapshotId, value) } }
  const restored = await resolveRepasarEnjoyerSnapshot({ groundedContext: context, store, intent: 'continue_attempt', requestedSnapshotId: frozen.snapshotId })
  assert.equal(restored.ok, true)

  const changed = { ...context, targets: context.targets.slice(0, 1) }
  assert.equal((await resolveRepasarEnjoyerSnapshot({ groundedContext: changed, store, intent: 'continue_attempt', requestedSnapshotId: frozen.snapshotId })).snapshot?.targets.length, 3,
    'background authority changes cannot mutate the frozen attempt')

  const other = { ...context, fingerprint: 'other-fingerprint' }
  assert.equal((await resolveRepasarEnjoyerSnapshot({ groundedContext: other, store, intent: 'continue_attempt', requestedSnapshotId: frozen.snapshotId })).code, 'SNAPSHOT_SCOPE_MISMATCH')
  snapshots.set('legacy', { ...frozen, snapshotId: 'legacy', schemaVersion: '1.0.0', authorityType: 'material_brain' })
  assert.equal((await resolveRepasarEnjoyerSnapshot({ groundedContext: context, store, intent: 'continue_attempt', requestedSnapshotId: 'legacy' })).code, 'LEGACY_SNAPSHOT_INCOMPATIBLE')
  assert.equal((await resolveRepasarEnjoyerSnapshot({ groundedContext: context, store, intent: 'continue_attempt', requestedSnapshotId: null })).code, 'LEGACY_SNAPSHOT_INCOMPATIBLE')
}

async function testRouteAuthority() {
  let providerCalls = 0
  let enjoyerLookups = 0
  const snapshots = new Map<string, any>()
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'user-1' } }),
    getAuthoritativeFreeSession: async () => ({ id: 'sess-1', userId: 'user-1', processMode: 'free', sourceSelection: selection }),
    getMaterial: async () => ({ id: 'mat-a' }),
    lookupEnjoyer: async (fingerprint: string) => { enjoyerLookups++; return fingerprint === selection.fingerprint ? payload : null },
    createRepasarSnapshotStore: () => ({
      async get(id: string) { return snapshots.get(id) || null },
      async set(snapshot: any) { snapshots.set(snapshot.snapshotId, snapshot) },
    }),
    generateValidatedLegacyJson: async ({ telemetryContext, validate }: any) => {
      providerCalls++
      const value = telemetryContext?.phase === 'analysis_batch'
        ? { targetCoverage: [
          { targetId: 'formula-1', status: 'covered', evidence: 'evidencia formula-1', demonstrated: 'evidencia formula-1' },
          { targetId: 'fact-low', status: 'partial', evidence: 'evidencia fact-low', demonstrated: 'evidencia fact-low', missingDetail: 'falta un detalle' },
          { targetId: 'process-1', status: 'incorrect', evidence: 'evidencia process-1 equivocada', demonstrated: 'evidencia process-1 equivocada' },
          { targetId: 'invented', status: 'covered', evidence: 'evidencia invented', demonstrated: 'evidencia invented' },
        ] }
        : {
          score: 80, feedback: 'Buen intento.', summary: 'Comprensión útil.', conceptStatus: [
            {
              concept: 'Igualdad de velocidades en el equilibrio', status: 'weak', importance: 'contextual',
              said: 'La reacción directa e inversa tienen la misma velocidad.',
              missing: 'No expresó la igualdad formal de las leyes de velocidad.',
            },
            { concept: 'Desplazamiento', status: 'mastered', importance: 'supporting' },
          ], strengths: [],
          missingConcepts: [], confusions: [], repair: { question: '', topicLabel: '', targetConcepts: [], requiredFacts: [], optionalFacts: [], targetIds: [] },
        }
      assert.equal(validate(value).valid, true)
      return value
    },
  })

  const response = await POST(new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-1', explanation: 'Explicación suficiente del contenido.', mode: 'libre' }),
  }))
  const data = await response.json()
  assert.equal(response.status, 200)
  assert.equal(enjoyerLookups, 1)
  assert.equal(providerCalls, 2, 'evaluate keeps canonical evaluation + feedback, without analysis/vision calls')
  assert.equal(data.analysis.domainMap.totalAcademicTargets, 3)
  assert.equal(data.analysis.domainMap.demonstratedCorrect, 1, 'unknown provider IDs cannot alter coverage')
  assert.equal(data.analysis.domainMap.demonstratedPartial, 1)
  assert.equal(data.analysis.domainMap.demonstratedIncorrect, 1, 'a genuinely wrong target remains incorrect')
  assert.equal(data.analysis.conceptStatus.find((item: any) => item.concept === 'Igualdad de velocidades en el equilibrio')?.status, 'progress',
    'reader wording cannot render a canonical partial target as red/weak')
  assert.equal(data.analysis.conceptStatus.find((item: any) => item.concept === 'Desplazamiento')?.status, 'weak',
    'reader wording cannot upgrade a canonical incorrect target')
  const stored = [...snapshots.values()][0]
  assert.equal(stored.authorityType, 'studyal_material_enjoyer')
  assert.deepEqual(stored.targets.find((target: any) => target.id === 'formula-1').sourceSpans, [{ page: 1, quote: 'Kc relaciona concentraciones.' }])

  Object.assign(__routeDeps, { lookupEnjoyer: async () => null, generateValidatedLegacyJson: async () => { throw new Error('provider must not run') } })
  const missing = await POST(new NextRequest('http://localhost/api/alai-studyal-repasar', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'sess-1', explanation: 'x' }),
  }))
  assert.equal(missing.status, 409)
  assert.equal((await missing.json()).error, 'ENJOYER_NOT_READY')
}

function testActivePathHasNoBrain() {
  const page = readFileSync('app/materias/page.tsx', 'utf8')
  const route = readFileSync('app/api/alai-studyal-repasar/route.ts', 'utf8')
  const component = readFileSync('components/materias/ALAIStudyALRepasar.tsx', 'utf8')
  const openRepasar = page.slice(page.indexOf('onOpenRepasar='), page.indexOf('onOpenAnalisis='))
  assert.doesNotMatch(openRepasar, /setBrainSourceSelection/)
  assert.doesNotMatch(page.match(/const VISTA_TOOL[\s\S]*?};/)?.[0] || '', /repasar/)
  assert.match(page, /if \(\['alai'\]\.includes\(freeTool\)\)/,
    'deep-link priming is restricted to the remaining legacy-priming tools (analisis and exam no longer need it after their own migrations)')
  assert.doesNotMatch(route, /restoreMaterialBrain|WorkerMaterialResultStore|resolveMaterialCapabilities|KnowledgeUnit/)
  assert.match(route, /lookupStudyalMaterialEnjoyer/)
  assert.doesNotMatch(route, /getOrCreateStudyalMaterialEnjoyer|download-url|\bcallVision\b|\bextractPdf\b/i)
  for (const phase of ['read', 'explain', 'diagnosis', 'recovery', 'verification', 'mastery']) assert.match(component, new RegExp(`'${phase}'`))
  assert.match(component, /readFreeToolState<PersistedState>/)
  assert.match(component, /writeFreeToolState/)
  assert.match(component, /onMasteryEvent\?\./)
}

async function main() {
  testAdapter()
  await testSnapshot()
  await testRouteAuthority()
  testActivePathHasNoBrain()
  console.log('repasar-enjoyer-migration-contracts: PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
