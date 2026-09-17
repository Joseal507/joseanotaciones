import { MemoryTruquitosStore, validProse } from './truquitos-simple-architecture-contracts'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  buildTruquitosEnjoyerContext, computeTruquitosCoverage, dedupeTruquitosByTargetIdentity,
} from '../../lib/materialBrain/truquitosEnjoyerContext'
import { POST, __routeDeps } from '../../app/api/alai-studyal-cheat-codes/route'

const selection = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3] }), fingerprint: 'fp-truq' }

const baseItems = [
  { id: 'term1', kind: 'terminology', name: 'Término 1', content: 'Definición autorizada del término 1', importance: 90, difficulty: 'medium', topicId: 't1', materialId: 'mat-a', pages: [1], sourceSpans: [{ page: 1, quote: 'q1' }] },
  { id: 'formula1', kind: 'formula', name: 'Fórmula 1', content: 'E = mc²', importance: 85, difficulty: 'advanced', topicId: 't1', materialId: 'mat-a', pages: [2], sourceSpans: [{ page: 2, quote: 'q2' }] },
  { id: 'process1', kind: 'process', name: 'Proceso 1', content: 'Paso 1, paso 2, paso 3 del proceso', importance: 60, difficulty: 'medium', topicId: 't2', materialId: 'mat-a', pages: [3], sourceSpans: [{ page: 3, quote: 'q3' }] },
  { id: 'fact1', kind: 'fact', name: 'Dato 1', content: 'Un dato aislado sin estrategia propia', importance: 30, difficulty: 'basic', topicId: 't2', materialId: 'mat-a', pages: [3], sourceSpans: [{ page: 3, quote: 'q4' }] },
]

function payload(items = baseItems, relations: any[] = []) {
  return {
    sourceSelectionFingerprint: 'fp-truq', materialIds: ['mat-a'], selectedPages: { 'mat-a': [1, 2, 3] },
    topicsIndex: [{ id: 't1', title: 'Tema uno' }, { id: 't2', title: 'Tema dos' }],
    globalOrderedAnalysis: items, uniqueConceptsIndex: [], relations,
  }
}

// ============================================================
// A/G/H/I — pure adapter contracts (no route/HTTP involved)
// ============================================================
function testAdapterContracts() {
  const context = buildTruquitosEnjoyerContext(payload(), selection)
  // A: exact Enjoyer is the academic authority — targets are derived
  // directly from the persisted payload, fingerprint matches exactly.
  assert.equal(context.fingerprint, 'fp-truq')
  const unitTargetIds = context.targets.filter(t => t.id.startsWith('unit:')).map(t => t.id)
  assert.deepEqual(unitTargetIds.sort(), ['unit:term1', 'unit:formula1', 'unit:process1', 'unit:fact1'].sort(),
    'A: academic facts remain eligible independently of importance')
  assert.throws(() => buildTruquitosEnjoyerContext({ ...payload(), sourceSelectionFingerprint: 'wrong' }, selection), /SOURCE_SELECTION_MISMATCH/)

  // H: an unsupported/unknown relation type must NOT create a
  // relation-based target and must NOT throw — safe fallback to
  // unit-level strategies only.
  const unknownRelation = [{ id: 'r1', type: 'somehow_related', fromSourceItemId: 'term1', toSourceItemId: 'formula1' }]
  const withUnknownRelation = buildTruquitosEnjoyerContext(payload(baseItems, unknownRelation), selection)
  assert.equal(withUnknownRelation.relations.length, 0, 'H: unknown relation type is dropped, not stored as a usable relation')
  assert.ok(!withUnknownRelation.targets.some(t => t.id.startsWith('relation:')), 'H: no relation-based target fabricated from an unknown type')

  // I: an EXPLICIT, exactly-matching known relation type IS used.
  const knownRelation = [{ id: 'r2', type: 'contrasts_with', fromSourceItemId: 'term1', toSourceItemId: 'formula1' }]
  const withKnownRelation = buildTruquitosEnjoyerContext(payload(baseItems, knownRelation), selection)
  assert.equal(withKnownRelation.relations.length, 1, 'I: an exactly-matching known relation type is retained')
  const relationTarget = withKnownRelation.targets.find(t => t.id === 'relation:r2')
  assert.ok(relationTarget, 'I: a relation-based target is created only for a known, explicit relation type')
  assert.deepEqual(relationTarget!.strategyOpportunities.sort(), ['contrast', 'error_warning'].sort())

  // G: dedupe by target identity collapses cards covering the exact
  // same target set regardless of wording.
  const dup = dedupeTruquitosByTargetIdentity([
    { type: 'cheat_code', title: 'A', content: 'uno', targetIds: ['unit:term1'], relationIds: [] },
    { type: 'cheat_code', title: 'B', content: 'dos', targetIds: ['unit:term1'], relationIds: [] },
    { type: 'analogia', title: 'C', content: 'tres', targetIds: ['unit:term1'], relationIds: [] },
  ])
  assert.equal(dup.length, 2, 'G: same type+targetIds collapses; different type for the same target survives')

  const coverage = computeTruquitosCoverage(context.targets, [context.targets[0].id])
  assert.equal(coverage.totalEligibleTargets, context.targets.length)
  assert.equal(coverage.representedEligibleTargets, 1)

  console.log('truquitos-enjoyer-migration-contracts: A/G/H/I (adapter) PASS')
}

// ============================================================
// B/C/D/E/F/J/K/M — route-level contracts
// ============================================================
async function testRouteContracts() {
  const store = new Map<string, any>()
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
    getAuthoritativeFreeSession: async () => ({ id: 'sess-1', userId: 'user-1', processMode: 'free', sourceSelection: selection }) as any,
    getMaterial: async () => ({ id: 'mat-a', nombre: 'Material A' }) as any,
    lookupStudyalMaterialEnjoyer: async (fingerprint: string) => store.get(fingerprint) ?? null,
    materialEnjoyerStore: {} as any,
    truquitosStore: new MemoryTruquitosStore(),
    alai: validProse,
  })

  async function post(body: unknown) {
    const response = await POST(new NextRequest('http://localhost/api/alai-studyal-cheat-codes', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
    return { response, data: await response.json() }
  }

  // B: missing Enjoyer returns a retryable readiness failure, never a build/generate attempt.
  const missing = await post({ mode: 'generate', sessionId: 'sess-1', materia: 'X', tema: 'Y' })
  assert.equal(missing.response.status, 409)
  assert.equal(missing.data.error, 'ENJOYER_NOT_READY')

  // C: __routeDeps never exposes restoreMaterialBrain at all.
  assert.ok(!('restoreMaterialBrain' in __routeDeps), 'C: zero restoreMaterialBrain in the active route deps')

  // D: zero KnowledgeUnit / Material Brain references in the active route source.
  const routeSource = fs.readFileSync('app/api/alai-studyal-cheat-codes/route.ts', 'utf8')
  assert.ok(!routeSource.includes('KnowledgeUnit'), 'D: no KnowledgeUnit dependency in the active route')
  assert.ok(!routeSource.includes('MaterialBrain'), 'D: no MaterialBrain dependency in the active route')
  assert.ok(!routeSource.includes('restoreMaterialBrain') && !routeSource.includes('WorkerMaterialResultStore'),
    'D: no Brain restore path in the active route')
  assert.ok(routeSource.includes('lookupStudyalMaterialEnjoyer'), 'active route uses the Enjoyer lookup')
  // M: no path to Enjoyer generation/regeneration exists in this route.
  assert.ok(!routeSource.includes('getOrCreateStudyalMaterialEnjoyer'), 'M: route never builds/regenerates the Enjoyer, lookup-only')

  // E: raw source authority keys are explicitly forbidden alongside sessionId (generate).
  const rawBypass = await post({ mode: 'generate', sessionId: 'sess-1', materialText: 'forbidden raw text' })
  assert.equal(rawBypass.response.status, 400)
  assert.equal(rawBypass.data.error, 'INVALID_CONFIG')

  store.set('fp-truq', payload())

  // F: first generation preserves canonical target IDs and provenance —
  // sourceMaterial/sourcePages come from the Enjoyer target, not the provider.
  const started = await post({ mode: 'generate', sessionId: 'sess-1', materia: 'X', tema: 'Y' })
  assert.equal(started.response.status, 200)
  assert.ok(Array.isArray(started.data.cards) && started.data.cards.length > 0, 'F: cards generated')
  const knownIds = new Set(['unit:term1', 'unit:formula1', 'unit:process1', 'unit:fact1'])
  for (const card of started.data.cards) {
    assert.ok(Array.isArray(card.targetIds) && card.targetIds.length > 0 && card.targetIds.every((id: string) => knownIds.has(id)),
      'F: every card carries only real, known target ids')
    assert.ok(card.sourceMaterial === 'mat-a', 'F: provenance is server-decided from the Enjoyer target')
  }
  assert.equal(started.data.grounding.authorityType, 'studyal_material_enjoyer')
  assert.equal(started.data.grounding.fingerprint, 'fp-truq')

  const firstCard = started.data.cards[0]

  // K: variant path rejects raw materialText alongside sessionId — never accepted as authority.
  const variantRawBypass = await post({ mode: 'variant', sessionId: 'sess-1', materialText: 'forbidden', card: firstCard, action: 'another_trick' })
  assert.equal(variantRawBypass.response.status, 400)
  assert.equal(variantRawBypass.data.error, 'INVALID_CONFIG')

  // J: variant uses the SAME Enjoyer authority/target identity as the original card.
  const variant = await post({ mode: 'variant', sessionId: 'sess-1', cardId: firstCard.id, action: 'another_trick' })
  assert.equal(variant.response.status, 200)
  assert.deepEqual(variant.data.card.targetIds, firstCard.targetIds, 'J: variant preserves the exact same grounded target ids')
  assert.equal(variant.data.card.sourceMaterial, firstCard.sourceMaterial)

  // J/B: a variant referencing an unknown/stale target id is an honest failure.
  const staleVariant = await post({ mode: 'variant', sessionId: 'sess-1', card: { ...firstCard, targetIds: ['unit:does-not-exist'] }, action: 'another_trick' })
  assert.equal(staleVariant.response.status, 400)
  assert.equal(staleVariant.data.error, 'PERSISTED_CARD_REQUIRED')

  console.log('truquitos-enjoyer-migration-contracts: B/C/D/E/F/J/K/M (route) PASS')
}

async function main() {
  testAdapterContracts()
  await testRouteContracts()
  console.log('truquitos-enjoyer-migration-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
