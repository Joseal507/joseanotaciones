import assert from 'node:assert/strict'
import {
  buildSourceSelectionSnapshot,
  filterTextToSelectedPages,
  prepareCanonicalSourceMaterials,
  validateSourceSelectionInput,
} from '../../lib/adaptive/sourceSelection'

// ═══════════════════════════════════════════════════════════════════
// Contamination fixture mandated by "MISIÓN PARALELA — SOURCE SELECTION
// AUTHORITY (FREE + ADAPTIVE)": prove the canonical filter never leaks
// unselected pages, correctly treats [] as "whole document" (never
// "0 páginas" / SOURCE_SELECTION_INVALID), and keeps each material's
// selection independent in a multi-document mixed scenario.
// ═══════════════════════════════════════════════════════════════════

// ── FASE 3: single 4-page document, select [2, 4] ──
const doc4 = [1, 2, 3, 4]
  .map(page => `[Pagina ${page}]\nTOKEN_PAGE_${page}_ONLY`)
  .join('\n')

const partial = filterTextToSelectedPages(doc4, [2, 4])
assert.match(partial, /TOKEN_PAGE_2_ONLY/)
assert.match(partial, /TOKEN_PAGE_4_ONLY/)
assert.doesNotMatch(partial, /TOKEN_PAGE_1_ONLY/)
assert.doesNotMatch(partial, /TOKEN_PAGE_3_ONLY/)

// ── FASE 6: selectedPages=[] means whole document, not "0 páginas" ──
const whole = filterTextToSelectedPages(doc4, [])
for (const page of [1, 2, 3, 4]) assert.match(whole, new RegExp(`TOKEN_PAGE_${page}_ONLY`))
assert.doesNotMatch(whole, /SOURCE_SELECTION_INVALID/)

const wholeSnapshot = buildSourceSelectionSnapshot(['doc-whole'], { 'doc-whole': [] })
assert.deepEqual(wholeSnapshot.selectedPages['doc-whole'], [])
assert.equal(wholeSnapshot.materialIds.length, 1)
assert.ok(validateSourceSelectionInput({ materials: wholeSnapshot.materials, fingerprint: wholeSnapshot.fingerprint }))

// ── FASE 7: multi-document mixed — DOC A partial [2], DOC B whole ([]) ──
const docA = [1, 2, 3].map(page => `[Pagina ${page}]\nA_PAGE_${page}`).join('\n')
const docB = [1, 2, 3].map(page => `[Pagina ${page}]\nB_PAGE_${page}`).join('\n')

const mixed = prepareCanonicalSourceMaterials([
  { materialId: 'doc-a', text: docA, selectedPages: [2] },
  { materialId: 'doc-b', text: docB, selectedPages: [] },
])

const materialA = mixed.materials.find(m => m.materialId === 'doc-a')!
const materialB = mixed.materials.find(m => m.materialId === 'doc-b')!

assert.match(materialA.text, /A_PAGE_2/)
assert.doesNotMatch(materialA.text, /A_PAGE_1\b/)
assert.doesNotMatch(materialA.text, /A_PAGE_3\b/)

for (const page of [1, 2, 3]) assert.match(materialB.text, new RegExp(`B_PAGE_${page}\\b`))

assert.deepEqual(mixed.snapshot.selectedPages['doc-a'], [2])
assert.deepEqual(mixed.snapshot.selectedPages['doc-b'], [])

// ── Restore: rebuilding the snapshot from persisted selectedPages must
// reproduce the identical fingerprint and filtered corpus (no drift). ──
const restoredSnapshot = buildSourceSelectionSnapshot(
  mixed.snapshot.materialIds,
  mixed.snapshot.selectedPages,
)
assert.equal(restoredSnapshot.fingerprint, mixed.snapshot.fingerprint)
const restored = prepareCanonicalSourceMaterials([
  { materialId: 'doc-a', text: docA, selectedPages: restoredSnapshot.selectedPages['doc-a'] },
  { materialId: 'doc-b', text: docB, selectedPages: restoredSnapshot.selectedPages['doc-b'] },
])
assert.equal(restored.snapshot.fingerprint, mixed.snapshot.fingerprint)
assert.equal(restored.materials.find(m => m.materialId === 'doc-a')!.text, materialA.text)
assert.equal(restored.materials.find(m => m.materialId === 'doc-b')!.text, materialB.text)

// ── Wrong fingerprint must be rejected, never silently accepted ──
assert.equal(
  validateSourceSelectionInput({ materials: mixed.snapshot.materials, fingerprint: 'tampered-fingerprint' }),
  null,
)

console.log('free-adaptive-source-selection-contamination-contracts: FASE 3/6/7/restore PASS; leakage=0')
