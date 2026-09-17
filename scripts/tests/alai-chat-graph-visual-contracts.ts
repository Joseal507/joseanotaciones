import assert from 'node:assert/strict'
import fs from 'node:fs'
import { extractGraphSpec } from '../../lib/adaptive/visual/engines/graphEngine'
import { detectChatIntent } from '../../lib/alai-chat/intent'
import { evaluateExpression } from '../../lib/adaptive/visual/engines/shared'

const intent = detectChatIntent('Grafícame y = x^2 - 4*x + 3')
assert.equal(intent.shape, 'graph')
const graph = extractGraphSpec('Grafícame y = x^2 - 4*x + 3', [], 'alai:test')
assert.ok(graph, 'explicit safe function must produce graph data')
assert.equal(graph!.data.expression.replace(/\s/g, ''), 'x^2-4*x+3')
assert.ok(graph!.data.points.length >= 5)
assert.ok(graph!.data.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))
const unicode = extractGraphSpec('Grafícame y = x² - 4x + 3.', [], 'alai:unicode')
assert.equal(unicode?.data.expression.replace(/\s/g, ''), 'x^2-4x+3')
assert.ok(unicode?.data.points.some(p => p.x === 2 && p.y === -1))
assert.equal(evaluateExpression('x(x+1)', 2), 6)
for (const expression of ['sin(x)', 'x;alert(1)', 'x + process.exit()', '(x+1', 'x..2', 'x)']) {
  assert.equal(evaluateExpression(expression, 2), null, expression)
  assert.equal(extractGraphSpec(`y=${expression}`, [], 'alai:invalid'), null, expression)
}
assert.equal(extractGraphSpec('y=x^2 con 10 <= x <= -10', [], 'alai:domain'), null)

const route = fs.readFileSync('app/api/alai-studyal-chat/route.ts', 'utf8')
const client = fs.readFileSync('components/materias/ALAIStudyALChat.tsx', 'utf8')
assert.doesNotMatch(route, /Las gráficas NO están disponibles|No puedo mostrar la gráfica/)
assert.match(route, /extractGraphSpec/)
assert.match(route, /visualSpec/)
assert.match(client, /VisualRenderer/)
assert.match(client, /msg\.visualSpec/)
assert.doesNotMatch(client, /sourceSelectionFingerprint\s*:/)
console.log('alai-chat-graph-visual-contracts: ALL PASS')
