import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import katex from 'katex'

// Execute the actual private rendering functions, not a copied regex implementation.
const source = fs.readFileSync('components/materias/ALAIStudyALCheatCodes.tsx', 'utf8')
const ast = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && ['renderCanonicalNotation', 'renderCardContent'].includes(node.name.text))
assert.equal(functions.length, 2)
const compiled = ts.transpileModule(functions.map(fn => fn.getText(ast)).join('\n') + '\nexports.renderCardContent = renderCardContent;',
  { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText
const sandbox = { React, katex, exports: {} as { renderCardContent?: (card: unknown, color: string) => React.ReactNode } }
vm.runInNewContext(compiled, sandbox)
const formula = String.raw`$K_p = K_c(RT)^{\Delta n}; \frac{[NO_2]^2}{[N_2O_4]}$`
const card = { schemaVersion: 2, content: 'Recuerda las dos puertas del equilibrio.', canonicalSources: [{ sourceItemId: 'f', pages: [28], content: formula }] }
const html = renderToStaticMarkup(sandbox.exports.renderCardContent!(card, 'red'))
assert(html.includes('katex')); assert(html.includes('mfrac')); assert(html.includes('msupsub'))
assert(!html.includes('\u000c')); assert(!html.includes('*****'))
assert.equal(card.canonicalSources[0].content, formula, 'render never mutates canonical notation')
const invalid = { ...card, canonicalSources: [{ sourceItemId: 'f', pages: [28], content: String.raw`$\unknowncanonical{a}$` }] }
const invalidHtml = renderToStaticMarkup(sandbox.exports.renderCardContent!(invalid, 'red'))
assert(invalidHtml.includes(String.raw`\unknowncanonical{a}`), 'invalid canonical notation remains visible unchanged')
const text = { ...card, content: '<script>unsafe()</script>', canonicalSources: [] }
assert(!renderToStaticMarkup(sandbox.exports.renderCardContent!(text, 'red')).includes('<script>'))
assert.match(source, /useAuthorizedSource\(sessionId \? null : effectiveSourceSelection/)
assert.match(source, /cardId: card.id/)
assert.doesNotMatch(source, /setProfessorAdvice/)
console.log('Truquitos render contracts passed: real renderer, canonical fractions/subscripts/exponents, safe text, legacy isolation; 0 provider calls')
