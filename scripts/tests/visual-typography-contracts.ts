import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

// ═══════════════════════════════════════════════════════════════════
// Guarda mínima para que no reaparezca la deuda tipográfica que hacía
// que StudyAL no se sintiera una sola app:
//   - fuentes cursivas (Caveat/Patrick Hand) en la UI,
//   - familias locales ('Inter', ...) compitiendo con la canónica,
//   - font-style: italic fuera del logo del Home.
// No es una mega-suite: son 6 asserts sobre el árbol real.
// ═══════════════════════════════════════════════════════════════════

// Excluidos a propósito:
//   *.backup.*  -> archivos muertos que nada importa
//   editor/     -> el usuario escribe contenido con formato propio
const EXCLUDE = /\.backup\.|components\/editor\//

function search(pattern: string): string[] {
  let out = ''
  try {
    out = execSync(
      `grep -rn --include='*.tsx' --include='*.ts' -- ${JSON.stringify(pattern)} app components`,
      { encoding: 'utf8' },
    )
  } catch {
    return [] // grep sale 1 cuando no hay coincidencias
  }
  return out.split('\n').filter(Boolean).filter(line => !EXCLUDE.test(line))
}

// A — Ninguna fuente cursiva declarada en componentes.
for (const needle of ['Caveat', 'Patrick Hand', 'Pacifico', 'Brush Script']) {
  assert.deepEqual(
    search(needle), [],
    `La fuente cursiva "${needle}" no puede volver a la UI (solo vive en .brand-study-home de globals.css)`,
  )
}

// B — Ninguna familia local compitiendo con la canónica.
assert.deepEqual(
  search("'Inter'"), [],
  "No declares 'Inter' localmente: la autoridad es var(--font-body)",
)

// C — Cero font-style italic inline en la UI.
assert.deepEqual(
  search("fontStyle: 'italic'"), [],
  'Sin cursiva inline en la UI de StudyAL',
)
assert.deepEqual(
  search('fontStyle: "italic"'), [],
  'Sin cursiva inline en la UI de StudyAL',
)

// D — globals.css: la única cursiva permitida es el logo del Home.
const css = readFileSync('app/globals.css', 'utf8')
const italicRules = css.split('\n').filter(l => /font-style:\s*italic/.test(l))
assert.equal(
  italicRules.length, 1,
  `globals.css debe declarar italic exactamente una vez (logo del Home); encontrado: ${italicRules.length}`,
)
assert.match(
  css, /\.brand-study-home\s*\{[^}]*font-style: italic/,
  'La única cursiva debe pertenecer a .brand-study-home',
)

// E — Esa clase se usa una sola vez, y en el Home.
const home = readFileSync('app/page.tsx', 'utf8')
assert.equal(
  (home.match(/brand-study-home/g) || []).length, 1,
  'brand-study-home debe aplicarse exactamente una vez, en el logo arriba-izquierda del Home',
)
assert.deepEqual(
  search('brand-study-home').filter(l => !l.startsWith('app/page.tsx')), [],
  'Ningún otro archivo puede usar la excepción de cursiva',
)

// F — El bootstrap anti-FOUC sigue siendo un script en <head>.
const layout = readFileSync('app/layout.tsx', 'utf8')
assert.match(layout, /THEME_BOOTSTRAP/, 'Debe existir el bootstrap de theme')
assert.ok(
  layout.indexOf('dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }}') <
    layout.indexOf('</head>'),
  'El bootstrap debe ejecutarse dentro de <head>, antes del primer paint',
)

console.log('visual-typography-contracts: A-F PASS')
console.log('cursivas en UI: 0 | familias locales: 0 | excepción: 1 (logo Home)')
