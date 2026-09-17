import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { buildStudyMapEnjoyerContext } from '../../lib/materialBrain/studyMapEnjoyerContext'
import { POST, __routeDeps } from '../../app/api/alai-studyal-map/route'

const selection = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3] }), fingerprint: 'fp-sm' }

const baseItems = [
  { id: 'n1', kind: 'concept', name: 'Nodo 1', content: 'Contenido autorizado del nodo 1', importance: 90, difficulty: 'medium', topicId: 't1', materialId: 'mat-a', pages: [1], sourceSpans: [{ page: 1, quote: 'q1' }] },
  { id: 'n2', kind: 'fact', name: 'Nodo 2', content: 'Contenido autorizado del nodo 2', importance: 60, difficulty: 'medium', topicId: 't1', materialId: 'mat-a', pages: [1], sourceSpans: [{ page: 1, quote: 'q2' }] },
  { id: 'n3', kind: 'example', name: 'Nodo 3', content: 'Contenido autorizado del nodo 3', importance: 20, difficulty: 'basic', topicId: 't2', materialId: 'mat-a', pages: [2], sourceSpans: [{ page: 2, quote: 'q3' }] },
]

function payload(items = baseItems, relations: any[] = []) {
  return {
    sourceSelectionFingerprint: 'fp-sm', materialIds: ['mat-a'], selectedPages: { 'mat-a': [1, 2, 3] },
    topicsIndex: [{ id: 't1', title: 'Tema uno' }, { id: 't2', title: 'Tema dos' }],
    globalOrderedAnalysis: items, uniqueConceptsIndex: [], relations,
  }
}

// ============================================================
// A/G/H/I/J — pure adapter contracts (no route/HTTP involved)
// ============================================================
function testAdapterContracts() {
  const context = buildStudyMapEnjoyerContext(payload(), selection)

  // A: exact Enjoyer is the academic authority.
  assert.equal(context.fingerprint, 'fp-sm')
  assert.equal(context.nodes.length, 3)
  assert.throws(() => buildStudyMapEnjoyerContext({ ...payload(), sourceSelectionFingerprint: 'wrong' }, selection), /SOURCE_SELECTION_MISMATCH/)

  // G: stable canonical node IDs, deterministic across rebuilds from the same payload.
  const rebuilt = buildStudyMapEnjoyerContext(payload(), selection)
  assert.deepEqual(context.nodes.map(n => n.id), rebuilt.nodes.map(n => n.id))
  assert.equal(context.nodes[0].id, 'map_node:n1')

  // H: topic grouping is the fallback when no relations exist.
  assert.equal(context.edges.length, 0)
  const n1 = context.nodes.find(n => n.sourceItemId === 'n1')!
  const n2 = context.nodes.find(n => n.sourceItemId === 'n2')!
  const n3 = context.nodes.find(n => n.sourceItemId === 'n3')!
  const clusterOfN1 = context.clusters.find(c => c.nodeIds.includes(n1.id))!
  assert.ok(clusterOfN1.nodeIds.includes(n2.id), 'H: same-topic nodes group together with no relations present')
  const clusterOfN3 = context.clusters.find(c => c.nodeIds.includes(n3.id))!
  assert.notEqual(clusterOfN1.id, clusterOfN3.id, 'H: a different topic is a different cluster')

  // I/J: no fabricated relation edges — dangling/self relations are dropped;
  // an explicit relation with known endpoints IS preserved and used.
  const withDangling = buildStudyMapEnjoyerContext(payload(baseItems, [
    { id: 'rX', type: 'related', fromSourceItemId: 'n1', toSourceItemId: 'does-not-exist' },
    { id: 'rY', type: 'related', fromSourceItemId: 'n1', toSourceItemId: 'n1' },
  ]), selection)
  assert.equal(withDangling.edges.length, 0, 'I: dangling and self relations never become fabricated edges')

  const withReal = buildStudyMapEnjoyerContext(payload(baseItems, [
    { id: 'rZ', type: 'some_label', fromSourceItemId: 'n1', toSourceItemId: 'n3' },
  ]), selection)
  assert.equal(withReal.edges.length, 1, 'J: an explicit relation with known endpoints is preserved as a real edge')
  const edge = withReal.edges[0]
  assert.equal(edge.sourceNodeId, n1.id)
  assert.equal(edge.targetNodeId, n3.id)
  const mergedCluster = withReal.clusters.find(c => c.kind === 'relation_component' && c.nodeIds.includes(n1.id) && c.nodeIds.includes(n3.id))
  assert.ok(mergedCluster, 'J: the real relation merges its endpoints into one relation_component cluster, crossing topics honestly')

  console.log('studymap-enjoyer-migration-contracts: A/G/H/I/J (adapter) PASS')
}

// ============================================================
// B/C/D/E/F/K/L/N/O — route-level contracts
// ============================================================
async function testRouteContracts() {
  const store = new Map<string, any>()
  let explainCalls = 0
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
    getAuthoritativeFreeSession: async () => ({ id: 'sess-1', userId: 'user-1', processMode: 'free', sourceSelection: selection }) as any,
    getMaterial: async () => ({ id: 'mat-a', nombre: 'Material A' }) as any,
    lookupStudyalMaterialEnjoyer: async (fingerprint: string) => store.get(fingerprint) ?? null,
    materialEnjoyerStore: {} as any,
    generateValidatedLegacyJson: async ({ validate }: any) => {
      explainCalls++
      const value = { answer: 'Explicación pedagógica breve del nodo.', usedRelationIds: [] }
      const v = validate(value)
      if (!v.valid) throw new Error('sim invalid: ' + v.errors.join(','))
      return value
    },
  })

  async function post(body: unknown) {
    const response = await POST(new NextRequest('http://localhost/api/alai-studyal-map', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
    return { response, data: await response.json() }
  }

  // B: missing Enjoyer returns a retryable readiness failure.
  const missing = await post({ sessionId: 'sess-1', materia: 'X', tema: 'Y' })
  assert.equal(missing.response.status, 409)
  assert.equal(missing.data.error, 'ENJOYER_NOT_READY')
  assert.equal(explainCalls, 0)

  // C: __routeDeps never exposes restoreMaterialBrain.
  assert.ok(!('restoreMaterialBrain' in __routeDeps), 'C: zero restoreMaterialBrain in the active route deps')

  // D: zero KnowledgeUnit / Material Brain dependency in the active route.
  const routeSource = fs.readFileSync('app/api/alai-studyal-map/route.ts', 'utf8')
  assert.ok(!routeSource.includes('KnowledgeUnit'), 'D: no KnowledgeUnit dependency in the active route')
  assert.ok(!routeSource.includes('restoreMaterialBrain') && !routeSource.includes('WorkerMaterialResultStore'),
    'D: no Brain restore path in the active route')
  assert.ok(routeSource.includes('lookupStudyalMaterialEnjoyer'), 'active route uses the Enjoyer lookup')
  // F: route never builds/regenerates the Enjoyer, lookup-only.
  assert.ok(!routeSource.includes('getOrCreateStudyalMaterialEnjoyer'), 'F: route never builds/regenerates the Enjoyer')

  // E: raw source authority keys are explicitly forbidden alongside sessionId (both modes).
  const rawBypass = await post({ sessionId: 'sess-1', texto: 'forbidden raw text' })
  assert.equal(rawBypass.response.status, 400)
  assert.equal(rawBypass.data.error, 'INVALID_CONFIG')
  const rawBypassExplain = await post({ mode: 'explain_node', sessionId: 'sess-1', unitId: 'map_node:n1', materialText: 'forbidden' })
  assert.equal(rawBypassExplain.response.status, 400)
  assert.equal(rawBypassExplain.data.error, 'INVALID_CONFIG')

  store.set('fp-sm', payload())

  // F/O: first map build — 0 provider calls (fully deterministic).
  const started = await post({ sessionId: 'sess-1', materia: 'X', tema: 'Y' })
  assert.equal(started.response.status, 200)
  assert.equal(explainCalls, 0, 'O: map construction itself is 0 provider calls')
  assert.equal(started.data.grounding.authorityType, 'studyal_material_enjoyer')
  assert.equal(started.data.grounding.fingerprint, 'fp-sm')
  assert.equal(started.data.mapa.totalConcepts, 3, 'G: canonical node count preserved end to end')

  // K: exact selection/fingerprint isolation — a different fingerprint
  // with nothing persisted is still ENJOYER_NOT_READY.
  const otherSelection = { ...buildSourceSelectionSnapshot(['mat-b'], { 'mat-b': [1] }), fingerprint: 'fp-other' }
  Object.assign(__routeDeps, { getAuthoritativeFreeSession: async () => ({ id: 'sess-2', userId: 'user-1', processMode: 'free', sourceSelection: otherSelection }) as any })
  const otherMissing = await post({ sessionId: 'sess-2' })
  assert.equal(otherMissing.response.status, 409)
  assert.equal(otherMissing.data.error, 'ENJOYER_NOT_READY', 'K: a different fingerprint never reuses another selection\'s persisted result')
  Object.assign(__routeDeps, { getAuthoritativeFreeSession: async () => ({ id: 'sess-1', userId: 'user-1', processMode: 'free', sourceSelection: selection }) as any })

  // O: explain_node — exactly one bounded provider call, scoped to a real node.
  const explain = await post({ mode: 'explain_node', sessionId: 'sess-1', unitId: 'map_node:n1', materia: 'X', tema: 'Y' })
  assert.equal(explain.response.status, 200)
  assert.equal(explainCalls, 1, 'O: explain_node makes exactly one bounded provider call')
  assert.equal(explain.data.explanation.unitId, 'map_node:n1')

  const explainUnknown = await post({ mode: 'explain_node', sessionId: 'sess-1', unitId: 'map_node:does-not-exist' })
  assert.equal(explainUnknown.response.status, 404)
  assert.equal(explainCalls, 1, 'a nonexistent node never reaches the provider')

  // N: legacy/Adaptive isolation — the `texto`-based legacy pipeline is a
  // structurally distinct branch, only reachable without sessionId.
  const postSource = routeSource.slice(routeSource.indexOf('export async function POST'))
  const sessionBranchIdx = postSource.indexOf('handleGroundedStudyMapRequest')
  const legacyIdx = postSource.indexOf("body.texto || body.content")
  assert.ok(sessionBranchIdx > -1 && legacyIdx > -1 && sessionBranchIdx < legacyIdx,
    'N: the Free sessionId/Enjoyer branch is checked before the legacy texto pipeline, both remain distinct')

  console.log('studymap-enjoyer-migration-contracts: B/C/D/E/F/K/N/O (route) PASS')
}

async function main() {
  testAdapterContracts()
  await testRouteContracts()
  console.log('studymap-enjoyer-migration-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
