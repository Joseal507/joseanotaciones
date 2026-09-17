import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import RepasarGapGroupSummary from '../../components/materias/RepasarGapGroupSummary'

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&middot;/g, '·').replace(/&#x27;/g, "'")
}

function assertSeparated(label: string, count: number) {
  const html = renderToStaticMarkup(<RepasarGapGroupSummary label={label} count={count} />)
  const text = visibleText(html)
  assert.ok(text.includes(label))
  assert.ok(text.includes(String(count)))
  assert.ok(!text.includes(`${label}${count}`), `label and count must not concatenate: ${text}`)
  assert.ok(text.includes(`${label} · ${count}`), `count must have a visible structural separator: ${text}`)
}

assertSeparated('Expresión de la constante de equilibrio Kc', 1)
assertSeparated('Otros conceptos', 40)
console.log('repasar-gap-count-render-contracts: PASS')
