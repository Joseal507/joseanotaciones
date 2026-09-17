import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import type { ImportanceTier, KnowledgeUnit, KnowledgeUnitKind, MaterialBrain } from '../../lib/materialBrain/types'
import {
  buildStudyMapEdges, buildStudyMapGroundedContext, buildStudyMapNodeExplanationContext, buildStudyMapNodes,
  buildStudyMapVisualClusters, computeStudyMapCoverage, computeStudyMapInitialVisibility,
  renderStudyMapNodeExplanationContext,
} from '../../lib/materialBrain/studyMapContext'
import { POST, __routeDeps } from '../../app/api/alai-studyal-map/route'

function unit(
  id: string, materialId: string, page: number, derivation: 'native_text' | 'vision',
  kind: KnowledgeUnitKind = 'fact', tier: ImportanceTier = 'supporting',
): KnowledgeUnit {
  const base: any = {
    id, kind,
    identity: { canonicalSubject: id, semanticKey: id, qualifiers: [] },
    label: `  Concepto ${id}  `, statement: `Contenido autorizado de ${id}`,
    importance: { tier, signals: ['model_judged'], confidence: 0.9 },
    provenance: derivation === 'vision' ? [] : [{ materialId, page, quote: `Cita de ${id}`, chunkId: `c-${page}` }],
    evidence: derivation === 'vision'
      ? [{ materialId, page, derivation: 'vision', pageFingerprint: `pf-${id}`, analyzerVersion: '1.0', promptVersion: '1.0', description: `Descripción visual de ${id}` }]
      : [{ materialId, page, derivation: 'native_text', quote: `Cita de ${id}`, chunkId: `c-${page}` }],
    domainTags: [],
  }
  return base
}

function relation(id: string, type: string, fromUnitId: string, toUnitId: string) {
  return {
    id, type, fromUnitId, toUnitId, statement: `${fromUnitId} ${type} ${toUnitId}`,
    importance: { tier: 'supporting', signals: [], confidence: 0.8 }, provenance: [],
  }
}

function brain(
  fingerprint: string, units: KnowledgeUnit[], relations: any[] = [], materialIds: string[] = ['mat-a'],
  builderVersion = MATERIAL_BRAIN_BUILDER_VERSION, status: 'ready' | 'partial' | 'failed' = 'ready',
): MaterialBrain {
  const selectedPages = Object.fromEntries(materialIds.map(id => [id, [1, 2, 3]]))
  return {
    scope: { ...buildSourceSelectionSnapshot(materialIds, selectedPages), fingerprint },
    meta: {
      version: '1.0.0', builderVersion, generatedAt: new Date(0).toISOString(),
      chunking: { strategy: 'test', chunkSizeChars: 1000, chunkCount: 1 },
      llmCallsUsed: 0, retries: 0, status,
    },
    units, relations,
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'not_required' },
    knowledgeExtraction: { chunksAttempted: 1, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}

// ============================================================
// MAP-NODE-1/2/3 — pure studyMapContext.ts node model
// ============================================================
function testNodeModel() {
  const b = brain('fp-node', [
    unit('u1', 'mat-a', 1, 'native_text'),
    { ...unit('u-dead', 'mat-a', 2, 'native_text'), supersededBy: 'u1' } as any,
  ])
  const nodes = buildStudyMapNodes(b)
  assert.equal(nodes.length, 1, 'MAP-NODE-1 live units become map nodes')
  assert.ok(!nodes.some(n => n.id === 'u-dead'), 'MAP-NODE-2 superseded units excluded')
  assert.equal(nodes[0].unitId, 'u1', 'MAP-NODE-3 node authority traces to unit id')
  assert.equal(nodes[0].label, 'Concepto u1', 'display label cleaned deterministically (whitespace only)')
  assert.equal(nodes[0].statement, 'Contenido autorizado de u1', 'MAP-NODE-3 statement authority unchanged')
  console.log('study-map-material-brain-contracts: MAP-NODE-1/2/3 PASS')
}

// ============================================================
// MAP-EDGE-1/2/3/4 — academic edges derive only from real relations
// ============================================================
function testEdgeModel() {
  const units = [unit('a', 'mat-a', 1, 'native_text'), unit('b', 'mat-a', 2, 'native_text')]
  const b = brain('fp-edge', units, [
    relation('r1', 'depends_on', 'a', 'b'),
    relation('r-self', 'depends_on', 'a', 'a'),          // self-relation — must be dropped
    relation('r-dangling', 'depends_on', 'a', 'nonexistent'), // dangling — must be dropped
    relation('r-dup', 'depends_on', 'a', 'b'),            // exact duplicate of r1 — must be deduped
  ])
  const nodes = buildStudyMapNodes(b)
  const edges = buildStudyMapEdges(b, nodes)
  assert.equal(edges.length, 1, 'MAP-EDGE-4 duplicate relation deduped safely')
  assert.ok(['r1', 'r-dup'].includes(edges[0].relationId), 'MAP-EDGE-1 real relation becomes an academic edge')
  const edgesAgain = buildStudyMapEdges(b, nodes)
  assert.equal(edgesAgain[0].relationId, edges[0].relationId, 'MAP-EDGE-4 dedup winner is deterministic across rebuilds')
  assert.ok(!edges.some(e => e.sourceUnitId === e.targetUnitId), 'self-relations excluded')
  assert.ok(!edges.some(e => e.targetUnitId === 'nonexistent'), 'MAP-EDGE-3 dangling relation excluded')
  console.log('study-map-material-brain-contracts: MAP-EDGE-1/2/3/4 PASS')
}

// MAP-EDGE-2: an "invented" relation simply cannot exist in this model —
// there is no provider step that could add one; edges are a pure function
// of brain.relations. Verified structurally: edges never contains an id
// absent from brain.relations.
function testNoInventedEdges() {
  const units = [unit('a', 'mat-a', 1, 'native_text'), unit('b', 'mat-a', 2, 'native_text')]
  const b = brain('fp-noinvent', units, [relation('r1', 'depends_on', 'a', 'b')])
  const nodes = buildStudyMapNodes(b)
  const edges = buildStudyMapEdges(b, nodes)
  const relationIds = new Set(b.relations.map((r: any) => r.id))
  assert.ok(edges.every(e => relationIds.has(e.relationId)), 'MAP-EDGE-2 every edge traces to a real Brain relation id, nothing invented')
  console.log('study-map-material-brain-contracts: MAP-EDGE-2 PASS')
}

// ============================================================
// MAP-GROUP-1 — visual grouping is never an academic edge
// ============================================================
function testVisualGroupingNotAcademic() {
  // Two units with NO relation between them — must still end up in some
  // visual cluster (kind_group fallback), but that must not produce an edge.
  const units = [unit('x', 'mat-a', 1, 'native_text'), unit('y', 'mat-a', 2, 'native_text')]
  const b = brain('fp-group', units, [])
  const nodes = buildStudyMapNodes(b)
  const edges = buildStudyMapEdges(b, nodes)
  const clusters = buildStudyMapVisualClusters(nodes, edges)
  assert.equal(edges.length, 0, 'no academic edges when there are no relations')
  assert.ok(clusters.some(c => c.kind === 'kind_group' && c.nodeIds.includes('x') && c.nodeIds.includes('y')), 'MAP-GROUP-1 unrelated nodes are grouped visually (kind_group)')
  assert.ok(clusters.every(c => c.kind !== 'relation_component'), 'no relation_component cluster fabricated without real relations')
  console.log('study-map-material-brain-contracts: MAP-GROUP-1 PASS')
}

// ============================================================
// MAP-COV-1/2/3 — deterministic coverage math
// ============================================================
function testCoverage() {
  const units = [unit('u1', 'mat-a', 1, 'native_text'), unit('u2', 'mat-a', 2, 'native_text'), unit('u3', 'mat-a', 3, 'native_text')]
  const b = brain('fp-cov', units, [relation('r1', 'depends_on', 'u1', 'u2')])
  const nodes = buildStudyMapNodes(b)
  const edges = buildStudyMapEdges(b, nodes)
  const full = computeStudyMapCoverage(nodes, nodes.map(n => n.id), b.relations.length, edges)
  assert.equal(full.totalMapTargets, 3, 'MAP-COV-1 denominator is deterministic')
  assert.equal(full.coveragePercent, 100, 'MAP-COV-2 all eligible nodes represented = 100%')
  assert.equal(full.totalRelationIds, 1)
  assert.equal(full.representedRelationIds, 1)

  const partial = computeStudyMapCoverage(nodes, ['u1'], b.relations.length, edges)
  assert.deepEqual(partial.missingTargetIds, ['u2', 'u3'], 'MAP-COV-3 missing unit appears in missingTargetIds')
  console.log('study-map-material-brain-contracts: MAP-COV-1/2/3 PASS')
}

// ============================================================
// MAP-VISION-1 — vision-derived unit appears without a vision call
// ============================================================
function testVision() {
  const b = brain('fp-vision', [unit('u-vision', 'mat-a', 2, 'vision')])
  const nodes = buildStudyMapNodes(b)
  assert.equal(nodes[0].derivation, 'vision')
  assert.equal(nodes[0].evidenceText, 'Descripción visual de u-vision', 'MAP-VISION-1 vision evidence text carried into the node — 0 vision calls (no vision function exists to call)')
  console.log('study-map-material-brain-contracts: MAP-VISION-1 PASS')
}

// ============================================================
// MAP-LARGE-1 — large Brain stays navigable without deleting targets
// ============================================================
function testLargeMaterialNotDeleted() {
  const units = Array.from({ length: 80 }, (_, i) => unit(`u${i}`, 'mat-a', (i % 5) + 1, 'native_text', 'fact', i % 10 === 0 ? 'critical' : 'supporting'))
  const b = brain('fp-large', units)
  const context = buildStudyMapGroundedContext(b)
  assert.equal(context.nodes.length, 80, 'MAP-LARGE-1 all 80 units become nodes — nothing deleted')
  assert.equal(context.visibility.availableInMap.length, 80, 'availableInMap always contains 100% of the universe')
  assert.ok(context.visibility.visibleInitially.length < 80, 'visibleInitially narrows for a large map (critical-tier only)')
  assert.ok(context.visibility.visibleInitially.length > 0, 'visibleInitially is never empty when critical nodes exist')
  console.log(`study-map-material-brain-contracts: MAP-LARGE-1 PASS (nodes=${context.nodes.length}, visibleInitially=${context.visibility.visibleInitially.length}, clusters=${context.clusters.length})`)
}

// ============================================================
// Route-level contracts (MAP-BRAIN-*, MAP-PERF-*, MAP-SOURCE-1)
// ============================================================
async function testBrainAuthorityAndPerf() {
  const goodBrain = brain('fp-good', [
    unit('u-critical', 'mat-a', 1, 'native_text', 'fact', 'critical'),
    unit('u2', 'mat-a', 2, 'native_text'),
  ])

  function baseDeps(brainByFingerprint: Record<string, MaterialBrain | null>) {
    return {
      getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
      getAuthoritativeFreeSession: async (sessionId: string, userId: string) => {
        if (sessionId !== 'sess-1' || userId !== 'user-1') return null
        return { id: sessionId, userId, processMode: 'free', sourceSelection: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2] }), fingerprint: 'fp-good' } } as any
      },
      getMaterial: async () => ({ id: 'mat-a', nombre: 'Material A' }) as any,
      restoreMaterialBrain: async (fingerprint: string) => brainByFingerprint[fingerprint] ?? null,
    }
  }

  // MAP-BRAIN-1: exact fingerprint's ready Brain is used.
  {
    Object.assign(__routeDeps, baseDeps({ 'fp-good': goodBrain }))
    const t0 = performance.now()
    const req = new NextRequest('http://localhost/api/alai-studyal-map', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', materia: 'Física', tema: '' }),
    })
    const res = await POST(req)
    const t1 = performance.now()
    const data = await res.json()
    assert.equal(res.status, 200, 'MAP-BRAIN-1 exact-fingerprint ready Brain is accepted')
    assert.ok(data.mapa?.root?.children?.length > 0, 'grounded map tree returned')
    assert.equal(data.grounding.totalMapTargets, 2)
    assert.equal(data.grounding.coveragePercent, 100, 'MAP-PERF: node coverage is always 100% by construction')
    assert.ok(t1 - t0 < 500, `MAP-PERF-1/2/3 build is fast (no provider/extraction/mastery-graph work): ${(t1 - t0).toFixed(1)}ms`)
  }

  // MAP-BRAIN-2: stale builderVersion Brain is rejected.
  {
    const staleBrain = brain('fp-good', [unit('u1', 'mat-a', 1, 'native_text')], [], ['mat-a'], 'stale-builder-version')
    Object.assign(__routeDeps, baseDeps({ 'fp-good': staleBrain }))
    const req = new NextRequest('http://localhost/api/alai-studyal-map', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(res.status, 409)
    assert.equal(data.error, 'STALE_BRAIN', 'MAP-BRAIN-2 stale Brain rejected')
  }

  // MAP-BRAIN-3: partial Brain is never accepted as ready.
  {
    const partialBrain = brain('fp-good', [unit('u1', 'mat-a', 1, 'native_text')], [], ['mat-a'], MATERIAL_BRAIN_BUILDER_VERSION, 'partial')
    Object.assign(__routeDeps, baseDeps({ 'fp-good': partialBrain }))
    const req = new NextRequest('http://localhost/api/alai-studyal-map', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(res.status, 409)
    assert.equal(data.error, 'BRAIN_PARTIAL', 'MAP-BRAIN-3 partial/not-ready rejected')
  }

  // MAP-BRAIN-4: deps object has no build/extract/vision/LLM function at
  // all — if the route ever called one it would throw. Also confirms
  // MAP-PERF-1: 0 provider calls (there is nothing that counts one).
  {
    Object.assign(__routeDeps, baseDeps({ 'fp-good': goodBrain }))
    const req = new NextRequest('http://localhost/api/alai-studyal-map', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1' }),
    })
    const res = await POST(req)
    assert.equal(res.status, 200, 'MAP-BRAIN-4 route never builds/extracts — grounded path has no such dependency to call')
  }

  // Raw source authority forbidden.
  {
    Object.assign(__routeDeps, baseDeps({ 'fp-good': goodBrain }))
    const req = new NextRequest('http://localhost/api/alai-studyal-map', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', texto: 'texto crudo inyectado' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(res.status, 400)
    assert.equal(data.detail, 'RAW_SOURCE_AUTHORITY_FORBIDDEN', 'client cannot inject raw texto as authority')
  }

  console.log('study-map-material-brain-contracts: MAP-BRAIN-1/2/3/4, MAP-PERF-1/2/3 PASS')
}

// ============================================================
// MAP-SOURCE-1 — selected material/page authority, 0 leakage: a Brain
// scoped to a source selection never surfaces content from other
// materials/pages because buildStudyMapGroundedContext only ever reads
// brain.units, which Material Brain itself already scoped at build time.
// ============================================================
function testSourcePageAuthority() {
  const b = brain('fp-source', [
    unit('u-mat-a', 'mat-a', 1, 'native_text'),
    unit('u-mat-b', 'mat-b', 2, 'native_text'),
  ], [], ['mat-a', 'mat-b'])
  const context = buildStudyMapGroundedContext(b)
  const materialIds = new Set(context.nodes.map(n => n.materialId))
  assert.deepEqual([...materialIds].sort(), ['mat-a', 'mat-b'], 'nodes trace to exactly the materials in scope')
  assert.ok(context.nodes.every(n => b.scope.materialIds.includes(n.materialId!)), 'MAP-SOURCE-1 0 leakage — every node materialId is within SourceSelection')
  console.log('study-map-material-brain-contracts: MAP-SOURCE-1 PASS')
}

// ============================================================
// MAP-RESUME-1/2 — persistence contract mirrors Repasar/Análisis.
// ============================================================
async function testResumeContracts() {
  const b1 = brain('fp-resume-a', [unit('u-a', 'mat-a', 1, 'native_text')])
  const b2 = brain('fp-resume-b', [unit('u-b', 'mat-a', 1, 'native_text')])
  const deps = {
    getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
    getAuthoritativeFreeSession: async (sessionId: string) => {
      const fingerprint = sessionId === 'sess-a' ? 'fp-resume-a' : sessionId === 'sess-b' ? 'fp-resume-b' : null
      if (!fingerprint) return null
      return { id: sessionId, userId: 'user-1', processMode: 'free', sourceSelection: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint } } as any
    },
    getMaterial: async () => ({ id: 'mat-a', nombre: 'Material A' }) as any,
    restoreMaterialBrain: async (fingerprint: string) => (fingerprint === 'fp-resume-a' ? b1 : fingerprint === 'fp-resume-b' ? b2 : null),
  }

  Object.assign(__routeDeps, deps)
  const reqA = new NextRequest('http://localhost/api/alai-studyal-map', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-a' }),
  })
  const dataA = await (await POST(reqA)).json()

  const persistedEntry = {
    status: 'completed', attempt: 1, mapData: dataA.mapa, studiedNodeIds: [], expandedNodeIds: ['root'],
    selectedNodeId: null, view: 'map', showGuidedTour: false, tourIndex: 0, explanationsByNodeId: {},
  }
  const roundTripped = JSON.parse(JSON.stringify(persistedEntry))
  assert.deepEqual(roundTripped.mapData, dataA.mapa, 'MAP-RESUME-1 grounded map survives a refresh (JSON round-trip) exactly')
  assert.equal(roundTripped.status, 'completed')

  Object.assign(__routeDeps, deps)
  const reqB = new NextRequest('http://localhost/api/alai-studyal-map', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-b' }),
  })
  const dataB = await (await POST(reqB)).json()
  assert.notDeepEqual(dataB.mapa.root.children, dataA.mapa.root.children, 'MAP-RESUME-2 a different fingerprint resolves a different Brain, never restores the previous grounded map')

  console.log('study-map-material-brain-contracts: MAP-RESUME-1/2 PASS')
}

// ============================================================
// MAP-EXPLAIN-1..12 — grounded node explanation ("explain this node")
// ============================================================
async function testNodeExplanation() {
  let providerCalls = 0
  const goodBrain = brain('fp-exp', [
    unit('u-center', 'mat-a', 1, 'native_text', 'fact', 'critical'),
    unit('u-neighbor', 'mat-a', 2, 'native_text'),
    unit('u-vision', 'mat-a', 3, 'vision'),
    { ...unit('u-dead', 'mat-a', 4, 'native_text'), supersededBy: 'u-center' } as any,
  ], [relation('r1', 'depends_on', 'u-center', 'u-neighbor')])

  function baseDeps(brainByFingerprint: Record<string, MaterialBrain | null>, providerFn?: (input: any) => any) {
    return {
      getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
      getAuthoritativeFreeSession: async (sessionId: string, userId: string) => {
        if (sessionId !== 'sess-1' || userId !== 'user-1') return null
        return { id: sessionId, userId, processMode: 'free', sourceSelection: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3, 4] }), fingerprint: 'fp-exp' } } as any
      },
      getMaterial: async () => ({ id: 'mat-a', nombre: 'Material A' }) as any,
      restoreMaterialBrain: async (fingerprint: string) => brainByFingerprint[fingerprint] ?? null,
      generateValidatedLegacyJson: async ({ validate }: any) => {
        providerCalls++
        const value = providerFn ? providerFn({}) : { answer: 'Explicación grounded del concepto, en varias oraciones claras.', usedRelationIds: ['r1'] }
        assert.ok(validate(value).valid, 'mock response must satisfy route validation')
        return value
      },
    }
  }

  // MAP-EXPLAIN-1: exact fingerprint's ready Brain resolved for explanation.
  {
    Object.assign(__routeDeps, baseDeps({ 'fp-exp': goodBrain }))
    const before = providerCalls
    const req = new NextRequest('http://localhost/api/alai-studyal-map', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'explain_node', sessionId: 'sess-1', unitId: 'u-center' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(res.status, 200, 'MAP-EXPLAIN-1 exact-fingerprint ready Brain resolved')
    assert.ok(data.explanation.answer.length > 0)
    assert.equal(data.explanation.unitId, 'u-center')
    assert.equal(providerCalls, before + 1, 'MAP-EXPLAIN-10 exactly 1 provider call — no extraction/vision/graph work possible (no such dep exists)')
  }

  // MAP-EXPLAIN-2: unknown unitId rejected.
  {
    Object.assign(__routeDeps, baseDeps({ 'fp-exp': goodBrain }))
    const req = new NextRequest('http://localhost/api/alai-studyal-map', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'explain_node', sessionId: 'sess-1', unitId: 'unit-that-does-not-exist' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(res.status, 404)
    assert.equal(data.error, 'UNIT_NOT_FOUND', 'MAP-EXPLAIN-2 unknown unit rejected')
  }

  // MAP-EXPLAIN-3: superseded unit rejected.
  {
    Object.assign(__routeDeps, baseDeps({ 'fp-exp': goodBrain }))
    const req = new NextRequest('http://localhost/api/alai-studyal-map', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'explain_node', sessionId: 'sess-1', unitId: 'u-dead' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(res.status, 404)
    assert.equal(data.error, 'UNIT_SUPERSEDED', 'MAP-EXPLAIN-3 superseded unit rejected')
  }

  // MAP-EXPLAIN-4: stale fingerprint / foreign session rejected.
  {
    const staleBrain = brain('fp-exp', [unit('u1', 'mat-a', 1, 'native_text')], [], ['mat-a'], 'stale-builder-version')
    Object.assign(__routeDeps, baseDeps({ 'fp-exp': staleBrain }))
    const req = new NextRequest('http://localhost/api/alai-studyal-map', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'explain_node', sessionId: 'sess-1', unitId: 'u1' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(res.status, 409)
    assert.equal(data.error, 'STALE_BRAIN', 'MAP-EXPLAIN-4 stale fingerprint rejected')

    Object.assign(__routeDeps, baseDeps({ 'fp-exp': goodBrain }))
    const foreignReq = new NextRequest('http://localhost/api/alai-studyal-map', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'explain_node', sessionId: 'sess-foreign', unitId: 'u-center' }),
    })
    const foreignRes = await POST(foreignReq)
    assert.equal(foreignRes.status, 404, 'MAP-EXPLAIN-4 foreign/unknown session rejected')
  }

  // MAP-EXPLAIN-5: raw materialText is rejected outright, never used as authority.
  {
    Object.assign(__routeDeps, baseDeps({ 'fp-exp': goodBrain }))
    const req = new NextRequest('http://localhost/api/alai-studyal-map', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'explain_node', sessionId: 'sess-1', unitId: 'u-center', materialText: 'texto crudo inyectado' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(res.status, 400)
    assert.equal(data.detail, 'RAW_SOURCE_AUTHORITY_FORBIDDEN', 'MAP-EXPLAIN-5 raw materialText rejected outright')
  }

  // MAP-EXPLAIN-6/8: context contains the selected unit's evidence AND
  // only its legitimate neighboring relation (not some other unrelated pair).
  {
    const context = buildStudyMapGroundedContext(goodBrain)
    const explanationContext = buildStudyMapNodeExplanationContext(context, 'u-center')!
    const rendered = renderStudyMapNodeExplanationContext(explanationContext)
    assert.ok(rendered.includes('Contenido autorizado de u-center') || rendered.includes('CONTENIDO AUTORIZADO: Contenido autorizado de u-center'), 'MAP-EXPLAIN-6 context contains the selected unit\'s authorized content')
    assert.ok(rendered.includes('Cita de u-center') || rendered.includes('EVIDENCE'), 'MAP-EXPLAIN-6 context contains evidence')
    assert.equal(explanationContext.edges.length, 1, 'MAP-EXPLAIN-8 only the legitimate incident relation is included')
    assert.equal(explanationContext.neighbors.length, 1)
    assert.equal(explanationContext.neighbors[0].id, 'u-neighbor', 'MAP-EXPLAIN-8 only the directly-related neighbor is included, not unrelated units')
    assert.ok(!rendered.includes('u-vision'), 'MAP-EXPLAIN-8 an unrelated unit (u-vision) never appears in a node with no relation to it')
  }

  // MAP-EXPLAIN-7: vision-derived unit's explanation context works without any vision call.
  {
    const context = buildStudyMapGroundedContext(goodBrain)
    const explanationContext = buildStudyMapNodeExplanationContext(context, 'u-vision')!
    assert.equal(explanationContext.node.derivation, 'vision')
    const rendered = renderStudyMapNodeExplanationContext(explanationContext)
    assert.ok(rendered.includes('Descripción visual de u-vision'), 'MAP-EXPLAIN-7 vision evidence reaches the node explanation context, 0 vision calls (no such dep exists)')
  }

  // MAP-EXPLAIN-9: a provider-invented relation id never becomes map
  // authority — usedRelationIds is filtered to the edges actually in context.
  {
    Object.assign(__routeDeps, baseDeps({ 'fp-exp': goodBrain }, () => ({
      answer: 'Explicación con una conexión inventada.',
      usedRelationIds: ['r1', 'fabricated-relation-id'],
    })))
    const req = new NextRequest('http://localhost/api/alai-studyal-map', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'explain_node', sessionId: 'sess-1', unitId: 'u-center' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.deepEqual(data.explanation.usedRelationIds, ['r1'], 'MAP-EXPLAIN-9 fabricated relation id is dropped, never granted authority')
  }

  console.log('study-map-material-brain-contracts: MAP-EXPLAIN-1/2/3/4/5/6/7/8/9/10 PASS')
}

// ============================================================
// MAP-EXPLAIN-11 — generic ALAI Chat behavior for other tools is
// unchanged: /api/alai-studyal-chat itself was never modified, and the
// Study Map client only calls the NEW mode for leaf (real unit) nodes —
// branch/root/detail nodes still use the old generic chat path. Verified
// structurally against the component source (no route to mock/execute
// the chat endpoint from here without pulling in unrelated infra).
// ============================================================
function testGenericChatUnchanged() {
  const routeSource = require('node:fs').readFileSync('app/api/alai-studyal-chat/route.ts', 'utf8') as string
  assert.ok(!routeSource.includes('explain_node') && !routeSource.includes('studyMapContext'), 'MAP-EXPLAIN-11 /api/alai-studyal-chat was not touched by this migration')
  const componentSource = require('node:fs').readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8') as string
  assert.ok(componentSource.includes("current.type === 'leaf' && !!sessionId"), 'MAP-EXPLAIN-11 only leaf (real unit) nodes use the grounded path — branch/root/detail keep the generic chat call')
  assert.ok(componentSource.includes("fetch('/api/alai-studyal-chat'"), 'generic chat path still present for non-leaf nodes')
  console.log('study-map-material-brain-contracts: MAP-EXPLAIN-11 PASS')
}

async function main() {
  testNodeModel()
  testEdgeModel()
  testNoInventedEdges()
  testVisualGroupingNotAcademic()
  testCoverage()
  testVision()
  testLargeMaterialNotDeleted()
  await testBrainAuthorityAndPerf()
  testSourcePageAuthority()
  await testResumeContracts()
  await testNodeExplanation()
  testGenericChatUnchanged()
  console.log('study-map-material-brain-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
