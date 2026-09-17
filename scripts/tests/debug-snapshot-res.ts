import { resolveRepasarEnjoyerSnapshot } from '../../lib/materialBrain/repasarSnapshot'

const MOCK_TARGETS = [
  {
    id: 't1', unitId: 'u1', kind: 'concept', label: 'Concepto A',
    statement: 'stmt A', importanceTier: 'critical' as const,
    difficulty: null, topicId: 'top1', topicTitle: 'Topic 1',
    sourceOrder: 1, materialId: 'm1', page: 5, pages: [5],
    sourceSpans: [], derivation: null, evidenceText: 'ev A',
  }
]

const store = new Map()
const storeAdapter = {
  async get(id: string) { return store.get(id) || null },
  async set(s: any) { store.set(s.snapshotId, s) }
}

async function testSnap() {
  const groundedContext = {
    targets: MOCK_TARGETS,
    relations: [],
    materialText: 'text'
  }
  
  const res = await resolveRepasarEnjoyerSnapshot({
    groundedContext: groundedContext as any,
    store: storeAdapter as any,
    intent: 'new_attempt',
    requestedSnapshotId: null,
    requestedReader: 'libre',
  })
  
  console.log("resolveRepasarEnjoyerSnapshot result:", res)
}

testSnap()
