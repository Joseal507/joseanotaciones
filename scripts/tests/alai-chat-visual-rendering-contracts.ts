import assert from 'node:assert/strict'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// tsx/esbuild outside Next's build pipeline compiles JSX in classic mode
// (React.createElement) for standalone scripts — expose React globally
// only for this test process (see word-bank-render-contracts.ts for the
// same pattern; does not affect the real Next.js build).
;(globalThis as unknown as { React: typeof React }).React = React

import {
  formatCitationPages,
  parseContentNodes,
  renderMessageContent,
  sanitizeDisplayText,
} from '../../components/materias/ALAIStudyALChat'

// ============================================================
// ALAI Chat — visual presentation contracts.
//
// Scope: ONLY the Markdown renderer, citation formatting, and internal-
// disclosure sanitizer used by ALAIStudyALChat.tsx. Does not touch
// retrieval/grounding/source-authority — those are covered by
// alai-chat-material-retrieval-contracts.ts and free-alai-continuity-
// contracts.ts, both re-run unchanged and still passing.
// ============================================================

function html(node: React.ReactNode): string {
  return renderToStaticMarkup(React.createElement(React.Fragment, null, node))
}

function testNoLiteralNewlineEscape() {
  // A literal backslash-n (two characters) surviving JSON round-tripping
  // must never render as literal "\n" text — the P0 bug reported.
  const out = html(renderMessageContent('Primera línea.\\nSegunda línea.'))
  assert.ok(!out.includes('\\n'), `literal \\n leaked into markup: ${out}`)
  assert.ok(out.includes('Primera línea.') && out.includes('Segunda línea.'))
  console.log('VISUAL-1 PASS — literal \\n never renders as text')
}

function testRealNewlinesNeverLiteral() {
  const out = html(renderMessageContent('Uno\nDos\n\nTres'))
  assert.ok(!out.includes('\\n'))
  assert.ok(out.includes('Uno') && out.includes('Dos') && out.includes('Tres'))
  console.log('VISUAL-2 PASS — real newlines never render as literal text')
}

function testBulletListWithAsterisk() {
  const nodes = parseContentNodes('* Primer punto\n* Segundo punto\n* Tercer punto')
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].kind, 'ul')
  assert.deepEqual((nodes[0] as any).items, ['Primer punto', 'Segundo punto', 'Tercer punto'])
  const out = html(renderMessageContent('* Primer punto\n* Segundo punto\n* Tercer punto'))
  assert.ok(out.includes('<ul'), 'asterisk bullets must render as a real <ul>')
  assert.ok(!out.includes('* Primer punto'), 'the literal "* " marker must never survive into text')
  console.log('VISUAL-3 PASS — "*" bullet lines render as a real list, never literal "*"')
}

function testMixedParagraphAndList() {
  // The realistic shape: intro paragraph, then a list, then a closing
  // paragraph, all in ONE AI turn — the previous implementation only
  // recognized a list when EVERY line in the message matched.
  const text = 'Aquí tienes un resumen:\n\n- Punto uno\n- Punto dos\n- Punto tres\n\nEspero que ayude.'
  const nodes = parseContentNodes(text)
  assert.deepEqual(nodes.map(n => n.kind), ['p', 'ul', 'p'])
  const out = html(renderMessageContent(text))
  assert.ok(out.includes('<ul'))
  assert.ok(out.includes('Aquí tienes un resumen'))
  assert.ok(out.includes('Espero que ayude'))
  assert.ok(!out.includes('- Punto uno'), 'list dash marker must never leak as literal text')
  console.log('VISUAL-4 PASS — mixed paragraph + list renders both correctly, not swallowed as one block')
}

function testHeadingHierarchy() {
  const text = '# Título principal\n\nTexto normal.\n\n## Subtítulo\n\nMás texto.\n\n### Detalle'
  const nodes = parseContentNodes(text)
  assert.deepEqual(nodes.map(n => n.kind), ['h', 'p', 'h', 'p', 'h'])
  assert.equal((nodes[0] as any).level, 1)
  assert.equal((nodes[2] as any).level, 2)
  assert.equal((nodes[4] as any).level, 3)
  const out = html(renderMessageContent(text))
  assert.ok(out.includes('<h1') && out.includes('<h2') && out.includes('<h3'))
  assert.ok(!out.includes('# Título') && !out.includes('## Subtítulo'), 'heading markers must never leak as literal text')
  console.log('VISUAL-5 PASS — heading hierarchy (#, ##, ###) renders with correct levels, never literal "#"')
}

function testInlineCodeForFormulas() {
  const out = html(renderMessageContent('La fórmula es `pH = -log[H+]` y es fundamental.'))
  assert.ok(out.includes('aal-inline-code'), 'inline code/formula spans must render as legible monospace, not literal backticks')
  assert.ok(!out.includes('`pH'), 'backtick markers must never leak as literal text')
  console.log('VISUAL-6 PASS — inline code/formula spans render as legible monospace')
}

function testStrongNeverInheritsWhiteInLightCard() {
  const out = html(renderMessageContent('Esto es **muy importante** para el examen.'))
  assert.ok(out.includes('aal-strong'), 'bold text must use the theme-safe class')
  assert.ok(!out.includes('color:var(--text-primary)') && !out.includes('color: var(--text-primary)'),
    'bold text must never hardcode --text-primary, which can be near-white and unreadable on the light AI bubble card')
  console.log('VISUAL-7 PASS — strong/emphasis never hardcodes a var(--text-primary) color that could go white-on-light')
}

function testInternalDisclosureSanitized() {
  const dirty = 'No tengo acceso directo al contenido específico, pero puedo inferir basándome en tus conceptos débiles. La respuesta correcta es 42.'
  const clean = sanitizeDisplayText(dirty)
  assert.ok(!/no tengo acceso directo/i.test(clean), 'internal-disclosure phrase must be stripped')
  assert.ok(!/puedo inferir bas[aá]ndome en tus conceptos d[eé]biles/i.test(clean), 'internal-disclosure phrase must be stripped')
  assert.ok(clean.includes('La respuesta correcta es 42'), 'legitimate academic content must survive sanitization untouched')
  console.log('VISUAL-8 PASS — internal-disclosure phrasing is stripped from displayed text, real content untouched')
}

function testCitationChipAbbreviation() {
  assert.equal(formatCitationPages([22]), 'Página 22')
  assert.equal(formatCitationPages([14, 28]), 'Págs. 14, 28')
  assert.equal(formatCitationPages([1, 2, 3, 4, 5]), 'Págs. 1, 2, 3…')
  assert.equal(formatCitationPages([]), '')
  console.log('VISUAL-9 PASS — citation chip formatting matches "📄 Página N" / "📄 Págs. a, b, c…"')
}

function testNumberedListStillWorks() {
  const text = '1) Primero\n2) Segundo\n3) Tercero'
  const out = html(renderMessageContent(text))
  assert.ok(out.includes('<ol') || out.includes('aal-num-list'))
  assert.ok(!out.includes('1) Primero'), 'numbered marker must never leak as literal text')
  console.log('VISUAL-10 PASS — numbered lists (1), 2), ...) still render correctly after the rewrite')
}

function testModeChipsDoNotExposeInternalArchitecture() {
  // Structural check: the component source must never render the raw
  // mode enum values (MATERIAL_ONLY/GENERAL_ONLY/MIXED) or internal
  // retrieval terms as user-facing copy — only the discrete natural
  // labels the mission specifies.
  const source = require('node:fs').readFileSync('components/materias/ALAIStudyALChat.tsx', 'utf8') as string
  assert.ok(source.includes('Conocimiento general'), 'GENERAL_ONLY must show a discreet "Conocimiento general" indicator')
  assert.ok(source.includes('aal-mode-chip'), 'mode indicators must use the discrete chip styling, not an alarming error box')
  assert.ok(!source.includes('>MATERIAL_ONLY<') && !source.includes('>GENERAL_ONLY<') && !source.includes('>MIXED<'),
    'raw internal mode enum values must never be rendered as user-facing text')
  console.log('VISUAL-11 PASS — mode indicators are discrete, natural labels, never raw internal enum values')
}

async function main() {
  testNoLiteralNewlineEscape()
  testRealNewlinesNeverLiteral()
  testBulletListWithAsterisk()
  testMixedParagraphAndList()
  testHeadingHierarchy()
  testInlineCodeForFormulas()
  testStrongNeverInheritsWhiteInLightCard()
  testInternalDisclosureSanitized()
  testCitationChipAbbreviation()
  testNumberedListStillWorks()
  testModeChipsDoNotExposeInternalArchitecture()
  console.log('alai-chat-visual-rendering-contracts: ALL PASS')
}

main().catch(err => { console.error(err); process.exit(1) })
