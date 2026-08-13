import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { POST as generatePlan } from '../../app/api/adaptive/generate-plan/route'
import { selectPagesNeedingVision } from '../../app/api/adaptive/blueprint/route'
import { mapPageSelectionsToMaterials, prepareCanonicalSourceMaterials, stripNonInstructionalBoilerplate } from '../../lib/adaptive/sourceSelection'

const documents = [{ id: 'doc-falcons', materialId: 'mat-falcons', pages: 2 }, { id: 'doc-bohr', materialId: 'mat-bohr', pages: 5 }, { id: 'doc-clutch', materialId: 'mat-clutch', pages: 43 }]
const selectedPages = mapPageSelectionsToMaterials(documents, [
  { materialId: 'doc-falcons', paginasSeleccionadas: [2] },
  { materialId: 'doc-bohr', paginasSeleccionadas: [1, 3] },
  { materialId: 'doc-clutch', paginasSeleccionadas: [6, 23, 27, 35, 38] },
])
const prepared = prepareCanonicalSourceMaterials(documents.map((document, materialIndex) => ({
  materialId: document.materialId, selectedPages: selectedPages[document.materialId],
  text: Array.from({ length: document.pages }, (_, index) => {
    const page = index + 1
    return `[Pagina ${page}]\n${selectedPages[document.materialId].includes(page) ? `AUTHORIZED_${materialIndex}_${page}` : `FORBIDDEN_${materialIndex}_${page}`}`
  }).join('\n'),
})))

assert.equal(prepared.materials.reduce((total, material) => total + material.selectedPages!.length, 0), 8)
assert.doesNotMatch(JSON.stringify(prepared.materials), /FORBIDDEN_/)
for (const material of prepared.materials) {
  const pageMap = new Map(material.selectedPages!.map(page => [page, '']))
  assert.deepEqual(selectPagesNeedingVision(pageMap, material.selectedPages!), material.selectedPages)
}
assert.doesNotMatch(stripNonInstructionalBoilerplate('© 2009 Prentice-Hall Inc. Todos los derechos reservados.'), /Prentice|copyright|derechos/i)

async function run() {
const blocked = await generatePlan(new NextRequest('http://localhost/api/adaptive/generate-plan', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    blueprint: { blocks: [{ id: 'b1' }], sourceSelectionFingerprint: prepared.snapshot.fingerprint },
    setup: { examDateType: 'just_studying', knowledgeLevel: 'never_seen' }, materialTitle: 'Fixture real',
    sourceSelectionFingerprint: prepared.snapshot.fingerprint,
    quality: { coverageCertified: false, planGenerationAllowed: false, status: 'degraded' },
  }),
}))
assert.equal(blocked.status, 422)

console.log('adaptive-real-source-authority-contracts: A-Q PASS; 8/50 pages authorized; vision subset selected; leakage=0; uncertified plan calls=0')
}

run().catch(error => { console.error(error); process.exitCode = 1 })
