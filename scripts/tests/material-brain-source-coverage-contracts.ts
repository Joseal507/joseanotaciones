import assert from 'node:assert/strict'
import { computeSourceCoverage } from '../../lib/materialBrain/coverage'
import { sourceRefKey } from '../../lib/materialBrain/types'
import type { KnowledgeUnit, PageChunk } from '../../lib/materialBrain/types'

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`  ✅ ${name}`)
    passed++
  } catch (err: any) {
    console.log(`  ❌ ${name}`)
    console.log(`     ${err.message}`)
    failed++
  }
}

function chunk(id: string, materialId: string, pages: number[]): PageChunk {
  return {
    id,
    materialId,
    pages,
    order: 0,
    text: pages.map(page => `[Pagina ${page}]\ncontenido ${page}`).join('\n\n'),
  }
}

function fakeUnit(materialId: string, page: number, label: string): KnowledgeUnit {
  return {
    id: `u_${materialId}_${page}_${label}`,
    kind: 'fact',
    identity: {
      canonicalSubject: label,
      semanticKey: label.toLowerCase(),
      qualifiers: [],
    },
    label,
    statement: `statement ${label}`,
    importance: { tier: 'supporting', signals: ['model_judged'], confidence: 0.5 },
    provenance: [{ materialId, page, quote: `quote ${label}`, chunkId: `${materialId}_${page}` }],
    domainTags: [],
  }
}

console.log('\n── SOURCE COVERAGE SPLIT-PAGE CONTRACTS ──')

test('CASE 1 — página normal, un chunk exitoso -> processed + complete', () => {
  const allChunks = [chunk('A', 'mat1', [1])]
  const coverage = computeSourceCoverage(allChunks, new Set(), [])

  assert.equal(coverage.status, 'complete')
  assert.equal(coverage.processed.length, 1)
  assert.ok(coverage.processed.some(ref => sourceRefKey(ref) === sourceRefKey({ materialId: 'mat1', page: 1 })))
  assert.equal(coverage.missing.length, 0)
})

test('CASE 2 — página densa dividida, todos exitosos -> processed + complete', () => {
  const allChunks = [
    chunk('A', 'mat1', [1]),
    chunk('B', 'mat1', [1]),
    chunk('C', 'mat1', [1]),
  ]
  const coverage = computeSourceCoverage(allChunks, new Set(), [])

  assert.equal(coverage.status, 'complete')
  assert.equal(coverage.processed.length, 1)
  assert.ok(coverage.processed.some(ref => sourceRefKey(ref) === sourceRefKey({ materialId: 'mat1', page: 1 })))
  assert.equal(coverage.missing.length, 0)
})

test('CASE 3 — bug regression: success + FAILED + success -> página NO processed', () => {
  const allChunks = [
    chunk('A', 'mat1', [1]),
    chunk('B', 'mat1', [1]),
    chunk('C', 'mat1', [1]),
  ]
  const coverage = computeSourceCoverage(allChunks, new Set(['B']), [])

  assert.notEqual(coverage.status, 'complete')
  assert.equal(coverage.processed.length, 0, 'page 1 no puede considerarse processed con fallo parcial')
  assert.ok(coverage.missing.some(ref => sourceRefKey(ref) === sourceRefKey({ materialId: 'mat1', page: 1 })))
})

test('CASE 4 — multi-page: page2 parcial -> page1 y page3 processed, page2 missing', () => {
  const allChunks = [
    chunk('A', 'mat1', [1]),
    chunk('B', 'mat1', [2]),
    chunk('C', 'mat1', [2]),
    chunk('D', 'mat1', [3]),
  ]
  const coverage = computeSourceCoverage(allChunks, new Set(['C']), [])

  assert.equal(coverage.status, 'partial')
  assert.ok(coverage.processed.some(ref => sourceRefKey(ref) === sourceRefKey({ materialId: 'mat1', page: 1 })))
  assert.ok(!coverage.processed.some(ref => sourceRefKey(ref) === sourceRefKey({ materialId: 'mat1', page: 2 })))
  assert.ok(coverage.processed.some(ref => sourceRefKey(ref) === sourceRefKey({ materialId: 'mat1', page: 3 })))
  assert.ok(coverage.missing.some(ref => sourceRefKey(ref) === sourceRefKey({ materialId: 'mat1', page: 2 })))
})

test('CASE 5 — chunk compartido failed -> ninguna de sus páginas queda processed', () => {
  const allChunks = [
    chunk('shared', 'mat1', [1, 2]),
  ]
  const coverage = computeSourceCoverage(allChunks, new Set(['shared']), [])

  assert.equal(coverage.processed.length, 0)
  assert.ok(coverage.missing.some(ref => sourceRefKey(ref) === sourceRefKey({ materialId: 'mat1', page: 1 })))
  assert.ok(coverage.missing.some(ref => sourceRefKey(ref) === sourceRefKey({ materialId: 'mat1', page: 2 })))
})

test('CASE 6 — preservar conocimiento parcial: units sobreviven aunque coverage quede incomplete', () => {
  const allChunks = [
    chunk('A', 'mat1', [1]),
    chunk('B', 'mat1', [1]),
  ]
  const units: KnowledgeUnit[] = [fakeUnit('mat1', 1, 'Unidad válida del chunk A')]
  const coverage = computeSourceCoverage(allChunks, new Set(['B']), units)

  assert.equal(units.length, 1, 'las KnowledgeUnits válidas del chunk exitoso NO deben eliminarse')
  assert.equal(coverage.processed.length, 0, 'la página sigue incomplete por el chunk fallido')
  assert.ok(coverage.missing.some(ref => sourceRefKey(ref) === sourceRefKey({ materialId: 'mat1', page: 1 })))
})

console.log('\n' + '─'.repeat(60))
console.log(`Source coverage tests: ${passed + failed} total | ✅ ${passed} passed | ❌ ${failed} failed`)
if (failed > 0) {
  console.log('\n❌ Source coverage contracts fallaron.')
  process.exit(1)
} else {
  console.log('\n✅ Todos los source coverage contracts pasaron.')
}
