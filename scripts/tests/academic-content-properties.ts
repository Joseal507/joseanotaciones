import assert from 'node:assert/strict'
import { academicDocumentText, parseAcademicContent } from '../../lib/academic-content/parser'
import { renderAcademicDocumentToHtml } from '../../lib/academic-content/render'
import { restoreAcademicDocument, serializeAcademicDocument } from '../../lib/academic-content/serialization'
import { containsUnprocessedAcademicCommand, normalizeAcademicContent, prepareAcademicContentForDelivery, validateAcademicDocument } from '../../lib/academic-content/validation'
import { normalizeOrRegenerateAcademicFragment } from '../../lib/academic-content/fragmentPipeline'
import { recoverAcademicFragment, type AcademicFragmentTelemetry } from '../../lib/academic-content/recovery'
import { semanticBlankSpacing } from '../../lib/academic-content/blankSpacing'
import { normalizeGeneratedQuestion, validateQuestion, type GenerationContext } from '../../lib/adaptive/evaluation/questionContract'
import { sanitizeLatex } from '../../lib/adaptive/sanitizeLatex'
import { safeParseJson } from '../../lib/alai'
import type { AcademicDocument, AcademicNode } from '../../lib/academic-content/types'

async function main() {
const childNodes = (node: AcademicNode): AcademicNode[] => {
  switch (node.type) {
    case 'paragraph':
    case 'strong':
    case 'emphasis':
    case 'strike':
    case 'heading':
    case 'link':
    case 'callout':
      return node.children
    case 'list':
      return node.items.flat()
    case 'table':
      return [...node.headers, ...node.rows.flat()]
    default:
      return []
  }
}
const findNodes = <T extends AcademicNode['type']>(
  document: AcademicDocument,
  type: T,
): Extract<AcademicNode, { type: T }>[] => {
  const found: Extract<AcademicNode, { type: T }>[] = []
  const visit = (node: AcademicNode) => {
    if (node.type === type) {
      found.push(node as Extract<AcademicNode, { type: T }>)
    }
    childNodes(node).forEach(visit)
  }
  document.nodes.forEach(visit)
  return found
}
const assertSingleQuantity = (
  document: AcademicDocument,
  value: string,
  unit: string,
  source: string,
) => {
  const quantities = findNodes(document, 'quantity')
  assert.equal(quantities.length, 1, source)
  assert.equal(quantities[0].value, value, source)
  assert.equal(quantities[0].unit, unit, source)
}
let seed = 0x5eed1234
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0x100000000
}
const pick = <T>(values: T[]): T => values[Math.floor(random() * values.length)]

const fragments = [
  'Texto con Unicode válido: α β γ ∀ ∃ → ⇌ µ Ω 你好 مرحبا',
  '$\\int_0^1 x^2\\,dx$', '$$\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}$$',
  '$\\lim_{x\\to 0}\\frac{\\sin x}{x}=1$', '$\\sum_{i=1}^{n} i$',
  '\\(\\vec{F}=m\\vec{a}\\)', '\\ce{2H2 + O2 -> 2H2O}',
  '<math><mrow><mi>x</mi><mo>=</mo><mn>2</mn></mrow></math>',
  '1.87 × 10^−3 mol/L', '`const value = items.map(x => x.id)`',
  '```python\nvalues = [1, 2, 3]\nprint(sum(values))\n```',
  'Completa ___ y después ___', '{{blank:concepto_principal}}',
  '- primer elemento\n- segundo elemento',
  '| Variable | Valor |\n| --- | --- |\n| x | $2^3$ |',
  '**Definición:** relación entre variables.',
  '12 \\text{h}', '30 \\text{s}', '193 \\text{m}', '5 \\mathrm{kg}',
  '9.81 \\mathrm{m/s^2}', '6.022 \\times 10^{23} \\mathrm{mol^{-1}}',
  'tab\treal', 'llaves {ordinarias} y texto extra',
]

const forbiddenVisible = /\{\{(?:blank|slot|answer|internal):|\[\[(?:blank|slot|answer):|blank_id|\[object Object\]/i
const partialLatexVisible = /\b(?:exth|exts|extm|extkg|extmol|rmkg|mathrmm|textm)\b/i

const fuzzRuns = 3_000
for (let run = 0; run < fuzzRuns; run++) {
  const content = Array.from({ length: 1 + Math.floor(random() * 8) }, () => pick(fragments)).join('\n\n')
  const normalized = normalizeAcademicContent(content)
  assert.equal(normalized.validation.valid, true, `${content}\n${JSON.stringify(normalized.validation.issues)}`)
  assert.equal(containsUnprocessedAcademicCommand(normalized.document), false)
  const serialized = serializeAcademicDocument(normalized.document)
  const restored = restoreAcademicDocument(serialized)
  assert(restored)
  assert.deepEqual(restored, normalized.document)
  const before = renderAcademicDocumentToHtml(normalized.document)
  const after = renderAcademicDocumentToHtml(restored)
  assert.equal(after, before)
  assert.equal(forbiddenVisible.test(before), false, before)
  assert.equal(partialLatexVisible.test(before), false, before)
}

const mixedClass = parseAcademicContent([
  'Biología: $P(A\\mid B)$ y concentración 5 mg/mL.',
  'Química: \\ce{CO2 + H2O <=> H2CO3}.',
  'Programación: `O(log n)` y lógica $\\forall x\\, P(x)$.',
  'Medicina: presión 120 mmHg; ingeniería: $\\vec{F}=m\\vec{a}$.',
].join('\n'))
assert.equal(validateAcademicDocument(mixedClass).valid, true, JSON.stringify(validateAcademicDocument(mixedClass).issues))
assert.match(renderAcademicDocumentToHtml(mixedClass), /katex/)

const structuralMarkdownCases = [
  ['**Cociente de reacción (Q)**', '<strong>Cociente de reacción (Q)</strong>'],
  ['__Constante de equilibrio__', '<strong>Constante de equilibrio</strong>'],
  ['*énfasis académico*', '<em>énfasis académico</em>'],
  ['~~hipótesis descartada~~', '<del>hipótesis descartada</del>'],
] as const
for (const [source, expectedHtml] of structuralMarkdownCases) {
  const document = parseAcademicContent(source)
  assert.equal(validateAcademicDocument(document).valid, true, source)
  const html = renderAcademicDocumentToHtml(document)
  assert.equal(html, `<p>${expectedHtml}</p>`, source)
  assert.equal(html.includes('**'), false, source)
}

for (const source of [
  '**Cociente de reacción ($Q$)**',
  '**Constante de equilibrio ($K_c$ y $K_p$)**',
]) {
  const document = parseAcademicContent(source)
  assert.equal(validateAcademicDocument(document).valid, true, source)
  const html = renderAcademicDocumentToHtml(document)
  assert.equal((html.match(/<strong>/g) || []).length, 1, source)
  assert.equal((html.match(/class="katex-html"/g) || []).length, source.includes('K_p') ? 2 : 1, source)
  assert.equal(html.includes('**'), false, source)
  const restored = restoreAcademicDocument(serializeAcademicDocument(document))
  assert(restored)
  assert.equal(renderAcademicDocumentToHtml(restored), html, source)
}

const unbalancedMarkdown = prepareAcademicContentForDelivery('**Constante de equilibrio')
assert.equal(unbalancedMarkdown.degraded, false)
assert.equal(academicDocumentText(unbalancedMarkdown.document), 'Constante de equilibrio')
assert.equal(renderAcademicDocumentToHtml(unbalancedMarkdown.document).includes('**'), false)
assert.match(renderAcademicDocumentToHtml(parseAcademicContent('`x ** 2`')), /<code>x \*\* 2<\/code>/)
assert.equal(academicDocumentText(parseAcademicContent('El símbolo * conserva su significado ordinario.')), 'El símbolo * conserva su significado ordinario.')

for (const invalid of ['$\\frac{a}{b$', '$\\unknowncommand{x}$', '{{internal:secret}}']) {
  const normalized = normalizeAcademicContent(invalid)
  assert.equal(normalized.requiresRegeneration, true)
  assert.match(renderAcademicDocumentToHtml(normalized.document), /data-academic-invalid/)
}

const context: GenerationContext = {
  activeConceptId: 'universal', activeConceptLabel: 'Universal',
  teachingBlockId: 'block', targetDimension: 'comprehension',
  questionFamily: 'mcq_best_answer', allowedConceptIds: ['universal'], forbiddenConceptIds: [],
}
const invalidQuestion = normalizeGeneratedQuestion({
  conceptId: 'universal', conceptLabel: 'Universal', variant: 'mcq_best_answer',
  targetDimension: 'comprehension', difficulty: 'medium',
  questionText: 'Interpreta $\\unknowncommand{x}$.',
  options: ['A', 'B'], correctAnswer: 'A', explanation: 'Explicación.', hint: 'Pista.',
}, context)
assert(invalidQuestion)
assert.equal(validateQuestion(invalidQuestion, context).valid, false)

assert.equal(academicDocumentText(parseAcademicContent('{{blank:id_privado}}')), '___')
const regenerated = await normalizeOrRegenerateAcademicFragment(
  '$\\unknowncommand{x}$',
  async () => '$x^2$',
)
assert.equal(regenerated.valid, true)
assert.equal(regenerated.attempts, 1)

const exhausted = await normalizeOrRegenerateAcademicFragment(
  '$\\unknowncommand{x}$',
  async fragment => fragment,
)
assert.equal(exhausted.valid, false)
assert.equal(exhausted.source, '')

assert.deepEqual(semanticBlankSpacing('de', 'cálculo', 'siguiente'), { before: ' ', after: ' ' })
assert.deepEqual(semanticBlankSpacing('la ', 'química', '.'), { before: '', after: '' })
assert.deepEqual(semanticBlankSpacing('α', 'β', ','), { before: ' ', after: '' })
assert.deepEqual(semanticBlankSpacing('你好', '世界', '。'), { before: '', after: '' })

const telemetry: AcademicFragmentTelemetry[] = []
let recoveryCalls = 0
const recoveredFragment = await recoverAcademicFragment(
  '$\\unknowncommand{x}$',
  {
    surface: 'teaching_step_content', sessionId: 'session-1', stepId: 'step-1',
    phase: 'final_review', nodePath: 'steps[0].content', nodeType: 'math',
    fallback: 'Contenido seguro.',
  },
  async () => {
    recoveryCalls++
    return recoveryCalls === 1 ? '$\\unknowncommand{x}$' : '$x$'
  },
  event => telemetry.push(event),
)
assert.equal(recoveredFragment.content, '$x$')
assert.equal(recoveredFragment.attempts, 2)
assert.equal(telemetry.length, 0)

const fallbackFragment = await recoverAcademicFragment(
  '{{internal:secret}}',
  {
    surface: 'teaching_step_content', sessionId: 'session-2', stepId: 'step-2',
    phase: 'final_review', nodePath: 'steps[1].content', nodeType: 'text',
    fallback: 'Contenido seguro.',
  },
  async fragment => fragment,
  event => telemetry.push(event),
)
assert.equal(fallbackFragment.content, 'Contenido seguro.')
assert.equal(fallbackFragment.attempts, 2)
assert.equal(telemetry.length, 1)
assert.deepEqual(
  Object.keys(telemetry[0]).sort(),
  ['surface', 'sessionId', 'stepId', 'phase', 'nodePath', 'nodeType', 'validationReason', 'repairAttempts'].sort(),
)

const singleFormula = renderAcademicDocumentToHtml(parseAcademicContent('$x^2$'))
assert.equal((singleFormula.match(/class="katex-html"/g) || []).length, 1)
assert.equal((singleFormula.match(/<math/g) || []).length, 1)

const quantityCases = [
  ['1,069 pies', '1,069\u00a0pies'],
  ['entender las medidas de193 pies es importante', 'entender las medidas de 193\u00a0pies es importante'],
  ['3.14 m.', '3.14\u00a0m.'],
  ['6.022×10^23 mol⁻¹,', '6.022×10^23\u00a0mol⁻¹,'],
  ['120/80 mmHg;', '120/80\u00a0mmHg;'],
  ['95 mg/dL.', '95\u00a0mg/dL.'],
] as const
for (const [source, expected] of quantityCases) {
  const parsed = parseAcademicContent(source)
  assert.equal(validateAcademicDocument(parsed).valid, true, source)
  assert.equal(academicDocumentText(parsed), expected, source)
  const restored = restoreAcademicDocument(serializeAcademicDocument(parsed))
  assert(restored)
  assert.equal(renderAcademicDocumentToHtml(restored), renderAcademicDocumentToHtml(parsed))
}
assert.equal(academicDocumentText(parseAcademicContent('La fórmula$x^2$describe el valor.')), 'La fórmula x^2 describe el valor.')

const latexUnitCases = [
  ['12 \\text{h}', '12', 'h'],
  ['30 \\text{s}', '30', 's'],
  ['193 \\text{m}', '193', 'm'],
  ['5 \\mathrm{kg}', '5', 'kg'],
  ['9.81 \\mathrm{m/s^2}', '9.81', 'm/s^2'],
  ['6.022 \\times 10^{23} \\mathrm{mol^{-1}}', '6.022 × 10^23', 'mol^-1'],
] as const
for (const [source, value, unit] of latexUnitCases) {
  const normalized = normalizeAcademicContent(source)
  assert.equal(normalized.validation.valid, true, source)
  assertSingleQuantity(normalized.document, value, unit, source)
  assert.equal(academicDocumentText(normalized.document), `${value}\u00a0${unit}`)
  assert.equal(partialLatexVisible.test(renderAcademicDocumentToHtml(normalized.document)), false)
  const serialized = serializeAcademicDocument(normalized.document)
  assert.match(serialized, /"type":"quantity"/)
  const restored = restoreAcademicDocument(serialized)
  assert(restored)
  assert.equal(renderAcademicDocumentToHtml(restored), renderAcademicDocumentToHtml(normalized.document))
}

const validMathWithUnit = normalizeAcademicContent('$v = 10\\,\\mathrm{m/s}$')
assert.equal(validMathWithUnit.validation.valid, true)
assert.equal(findNodes(validMathWithUnit.document, 'math').length, 1)
assert.match(renderAcademicDocumentToHtml(validMathWithUnit.document), /katex/)

const jsonEscapedUnit = JSON.parse(JSON.stringify({ content: '193 \\text{m}' })) as { content: string }
assert.equal(jsonEscapedUnit.content, '193 \\text{m}')
assertSingleQuantity(normalizeAcademicContent(jsonEscapedUnit.content).document, '193', 'm', jsonEscapedUnit.content)
const providerJsonUnit = safeParseJson('{"content":"12 \\text{h}"}') as { content: string }
assert.equal(providerJsonUnit.content, '12 \\text{h}')
assertSingleQuantity(normalizeAcademicContent(providerJsonUnit.content).document, '12', 'h', providerJsonUnit.content)

const lostTextSlash = normalizeAcademicContent('193 \text{m}')
assert.equal(lostTextSlash.validation.valid, true)
assertSingleQuantity(lostTextSlash.document, '193', 'm', '193 \\text{m} with a lost slash')
assert.equal(partialLatexVisible.test(renderAcademicDocumentToHtml(lostTextSlash.document)), false)
assert.equal(sanitizeLatex('193 \text{m}'), '193 m')
assert.equal(sanitizeLatex('5 \\mathrm{kg}'), '5 kg')

const realTab = normalizeAcademicContent('Pulsa\tTab para continuar.')
assert.equal(realTab.validation.valid, true)
assert.equal(academicDocumentText(realTab.document), 'Pulsa\tTab para continuar.')
assert.equal(normalizeAcademicContent('Un texto extra mantiene ext sin cambios.').validation.valid, true)
assert.equal(academicDocumentText(normalizeAcademicContent('Un texto extra mantiene ext sin cambios.').document), 'Un texto extra mantiene ext sin cambios.')

for (const damaged of ['exth', 'exts', 'extm', 'extkg', 'extmol', 'rmkg', 'mathrmm', 'textm']) {
  assert.equal(normalizeAcademicContent(damaged).validation.valid, false, damaged)
}
console.log(`academic-content-properties: ${fuzzRuns} fuzz runs + universal invariants PASS`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
