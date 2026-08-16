import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSourceSelectionSnapshot, filterTextToSelectedPages, validateSourceSelectionInput } from '../../lib/adaptive/sourceSelection'

// ─── Wiring: MasteryCoach must route through the canonical sourceSelection,
// not a bare materialIds payload that bypasses page filtering. ───
const coach = readFileSync('components/materias/MasteryCoach.tsx', 'utf8')
assert.match(coach, /sourceSelection: SourceSelectionSnapshot \| null/, 'MasteryCoach debe recibir sourceSelection como prop')
assert.match(coach, /body: JSON\.stringify\(\{ sourceSelection \}\)/, 'extractConcepts debe enviar sourceSelection, no materialIds sueltos')
assert.doesNotMatch(coach, /body: JSON\.stringify\(\{ materialIds \}\)/, 'extractConcepts no debe volver a enviar solo materialIds')
assert.match(coach, /data\.sourceSelectionFingerprint !== sourceSelection\.fingerprint/, 'MasteryCoach debe rechazar respuestas con fingerprint distinto')
assert.match(coach, /if \(!sourceSelection \|\| sourceSelection\.materialIds\.length === 0\) return/, 'extractConcepts no debe correr sin sourceSelection')

const temaView = readFileSync('components/materias/TemaView.tsx', 'utf8')
assert.match(temaView, /<MasteryCoach[\s\S]{0,200}sourceSelection=\{freeSourceSelection\}/, 'TemaView debe pasar la sourceSelection canónica compartida al Coach')

// ─── Fixture: 4-page document, one unique token per page. ───
const FIXTURE = [1, 2, 3, 4]
  .map(page => `[Pagina ${page}]\nTOKEN_PAGE_${page}_ONLY`)
  .join('\n\n')

// [2,4] partial selection: MasteryCoach's payload is now built by the same
// buildSourceSelectionSnapshot/filterTextToSelectedPages pair the other 8
// Free tools use — prove it filters correctly for this shape too.
const partial = buildSourceSelectionSnapshot(['mat1'], { mat1: [2, 4] })
const partialText = filterTextToSelectedPages(FIXTURE, partial.selectedPages['mat1'])
assert.match(partialText, /TOKEN_PAGE_2_ONLY/)
assert.match(partialText, /TOKEN_PAGE_4_ONLY/)
assert.doesNotMatch(partialText, /TOKEN_PAGE_1_ONLY/)
assert.doesNotMatch(partialText, /TOKEN_PAGE_3_ONLY/)

// Whole document: selectedPages=[] must stay "documento completo", never
// SOURCE_SELECTION_INVALID and never an empty/"0 pages" result.
const whole = buildSourceSelectionSnapshot(['mat1'], { mat1: [] })
assert.deepEqual(whole.selectedPages['mat1'], [])
const wholeText = filterTextToSelectedPages(FIXTURE, whole.selectedPages['mat1'])
for (const page of [1, 2, 3, 4]) assert.match(wholeText, new RegExp(`TOKEN_PAGE_${page}_ONLY`))

// Wrong fingerprint / invalid selection must still be rejected by the same
// validator the /api/enfoques/teorico/start route uses.
assert.ok(validateSourceSelectionInput({ materials: partial.materials, fingerprint: partial.fingerprint }))
assert.equal(validateSourceSelectionInput({ materials: partial.materials, fingerprint: 'tampered-fingerprint' }), null)
assert.equal(validateSourceSelectionInput({ materials: partial.materials, fingerprint: whole.fingerprint }), null)

console.log('MasteryCoach source authority: 11/11 PASS')
console.log('partial [2,4]: PASS — whole-document: PASS — wrong fingerprint: rejected')
