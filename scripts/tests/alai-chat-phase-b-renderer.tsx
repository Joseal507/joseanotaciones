import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderMessageContent } from '../../components/materias/ALAIStudyALChat'
import { chatProvenanceLabel } from '../../lib/alai-chat/contracts'
Object.assign(globalThis, { React })
const table = '| A | B |\n|---|---|\n| uno | dos |'
for (const source of ['Inicio\n\n' + table + '\n\nFinal', '1. Primero 2. Segundo\n\n' + table + '\n\nFinal']) {
  const html = renderToStaticMarkup(renderMessageContent(source))
  assert.ok(html.includes('<table'))
  assert.ok(html.includes('Final'))
  assert.ok(html.includes('uno') && html.includes('dos'))
}
const symbolic = String.raw`\nabla + \nu + \n + \frac{1}{2}`
assert.ok(renderToStaticMarkup(renderMessageContent(symbolic)).includes(symbolic))
const code = '```python\nif x < 2:\n  print(x)\n```\nFinal'
const html = renderToStaticMarkup(renderMessageContent(code))
assert.ok(html.includes('<pre') && html.includes('  print(x)') && html.includes('Final'))
assert.equal(chatProvenanceLabel({ sourceMode: 'MATERIAL_ONLY', materialRetrievalOutcome: 'no_relevant_target', externalKnowledgeUsed: false, materialEvidenceUsed: false }).startsWith('Material:'), true)
console.log('alai-chat-phase-b-renderer: PASS')
