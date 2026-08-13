import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildSourceSelectionSnapshot,
  filterTextToSelectedPages,
  prepareCanonicalSourceMaterials,
  mapPageSelectionsToMaterials,
  stripNonInstructionalBoilerplate,
  sourceSelectionFingerprint,
} from '../../lib/adaptive/sourceSelection'
import { persistableSnapshot } from '../../lib/studySessions'

const selectedPages: Record<string, number[]> = {
  mat_a: [5, 2, 2, 3],
  mat_b: [7, 3, 1, 3],
}
const snapshot = buildSourceSelectionSnapshot(['mat_b', 'mat_a', 'mat_b'], selectedPages)
assert.deepEqual(snapshot.materialIds, ['mat_b', 'mat_a'], 'materialIds usa dedupe estable')
assert.deepEqual(snapshot.selectedPages, { mat_a: [2, 3, 5], mat_b: [1, 3, 7] })
assert.equal(snapshot.fingerprint, sourceSelectionFingerprint(['mat_a', 'mat_b'], { mat_b: [3, 7, 1], mat_a: [3, 5, 2] }))
assert.notEqual(snapshot.fingerprint, sourceSelectionFingerprint(['mat_a', 'mat_b'], { mat_a: [2, 3, 5, 6], mat_b: [1, 3, 7] }))
const persisted = persistableSnapshot({
  id: 'source-restore', temaId: 'tema', enfoque: 'teorico', processMode: 'adaptive', studyMode: 'adaptive',
  materialIds: snapshot.materialIds, materialNames: ['B', 'A'], selectedPages: snapshot.selectedPages,
  sourceSelectionFingerprint: snapshot.fingerprint, createdAt: 1, lastOpenedAt: 1,
} as any)
assert.deepEqual(persisted.selectedPages, snapshot.selectedPages)
assert.equal(persisted.sourceSelectionFingerprint, snapshot.fingerprint)

const pagedText = '[Pagina 1]\nFORBIDDEN_ALPHA\n[Pagina 2]\nAUTHORIZED_ALPHA\n[Pagina 3]\nAUTHORIZED_ALPHA_3\n[Pagina 4]\nFORBIDDEN_ALPHA_4'
const filtered = filterTextToSelectedPages(pagedText, [3, 2, 2])
assert.match(filtered, /AUTHORIZED_ALPHA/)
assert.match(filtered, /AUTHORIZED_ALPHA_3/)
assert.doesNotMatch(filtered, /FORBIDDEN_ALPHA/)

const realMaterials = [
  { id: 'doc-a', materialId: 'remote-a' },
  { id: 'doc-b', materialId: 'remote-b' },
  { id: 'doc-c', materialId: 'remote-c' },
]
const realSelection = mapPageSelectionsToMaterials(realMaterials, [
  { materialId: 'doc-a', paginasSeleccionadas: [2] },
  { materialId: 'doc-b', paginasSeleccionadas: [1, 3] },
  { materialId: 'doc-c', paginasSeleccionadas: [6, 23, 27, 35, 38] },
])
assert.deepEqual(realSelection, { 'remote-a': [2], 'remote-b': [1, 3], 'remote-c': [6, 23, 27, 35, 38] })
const realFixture = prepareCanonicalSourceMaterials(realMaterials.map((material, index) => ({
  materialId: material.materialId,
  selectedPages: realSelection[material.materialId],
  text: Array.from({ length: [2, 5, 43][index] }, (_, page) =>
    `[Pagina ${page + 1}]\n${realSelection[material.materialId].includes(page + 1) ? `AUTHORIZED_${index}_${page + 1}` : `FORBIDDEN_${index}_${page + 1}`}`
  ).join('\n'),
})))
assert.equal(realFixture.materials.reduce((total, material) => total + material.selectedPages!.length, 0), 8)
assert.doesNotMatch(JSON.stringify(realFixture.materials), /FORBIDDEN_/)
assert.equal(stripNonInstructionalBoilerplate('© 2009 Prentice-Hall Inc. Todos los derechos reservados.'), '')

for (let count = 1; count <= 5; count++) {
  const ids = Array.from({ length: count }, (_, index) => `material_${index + 1}`)
  const pages = Object.fromEntries(ids.map((id, index) => [id, [index + 3, 1, index + 3]]))
  const value = buildSourceSelectionSnapshot(ids, pages)
  assert.equal(value.materialIds.length, count)
  assert.equal(new Set(value.materialIds).size, count)
  for (const id of ids) assert.deepEqual(value.selectedPages[id], [...new Set(pages[id])].sort((a, b) => a - b))
  const prepared = prepareCanonicalSourceMaterials(ids.map((id, index) => ({
    materialId: id,
    selectedPages: [index + 1],
    text: `[Pagina ${index + 1}]\nAUTHORIZED_${index + 1}\n[Pagina ${index + 11}]\nFORBIDDEN_${index + 1}`,
  })))
  assert.equal(prepared.materials.length, count)
  assert.doesNotMatch(JSON.stringify(prepared.materials), /FORBIDDEN_/)
  for (let index = 0; index < count; index++) assert.match(prepared.materials[index].text, new RegExp(`AUTHORIZED_${index + 1}`))
}

const blueprintRoute = readFileSync('app/api/adaptive/blueprint/route.ts', 'utf8')
const adaptive = readFileSync('components/materias/StudyALAdaptive.tsx', 'utf8')
const sessionPage = readFileSync('app/materias/[temaId]/sesion/[sessionNumber]/page.tsx', 'utf8')
const sessions = readFileSync('lib/studySessions.ts', 'utf8')
assert.match(blueprintRoute, /filterTextToSelectedPages/, 'blueprint debe filtrar antes de analizar')
assert.match(blueprintRoute, /sourceSelectionFingerprint/, 'blueprint debe certificar el snapshot')
assert.match(adaptive, /sourceSelectionFingerprint/, 'plan y prefetch inicial deben transportar la autoridad')
assert.match(sessionPage, /sourceSelectionFingerprint/, 'cold y prefetch N+1 deben usar el mismo snapshot')
assert.match(sessions, /sourceSelectionFingerprint/, 'restore debe persistir la autoridad')

console.log('adaptive-source-snapshot-contracts: A-O PASS; 1-5 materiales; source leakage=0')
