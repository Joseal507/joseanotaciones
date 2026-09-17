import assert from 'node:assert/strict'
import { normalizeChatCandidate, validateChatCandidate } from '../../lib/alai-chat/validation'
import { detectChatIntent } from '../../lib/alai-chat/intent'
import { parseChatContent, normalizeChatText } from '../../lib/alai-chat/content'
const valid = (query: string, answer: string) => validateChatCandidate(normalizeChatCandidate({ answer, externalKnowledgeUsed: true }), { intent: detectChatIntent(query), sourcePolicy: 'MIXED' }).valid
const table = '| A | B |\n|---|---|\n| uno | dos |'
assert.ok(valid('ponlo en tabla', table))
assert.ok(!valid('tabla', '| A | B |\n|---|---|'))
assert.ok(!valid('tabla', table + '\n| solo |'))
assert.ok(!valid('dame cinco ejemplos', '1. Uno\n2. Dos\n3. Tres\n4. Cuatro'))
assert.ok(!valid('grafica y=x^2', 'Aquí está la gráfica.'))
assert.ok(valid('grafica y=x^2', 'No puedo mostrar la gráfica. Puedo explicar sus puntos.'))
assert.ok(!valid('paso a paso', 'La respuesta es 4.'))
assert.ok(valid('paso a paso', '1. Sustituye.\n  x = 2\n\n2. Comprueba.\n  2 + 2 = 4'))
assert.equal(parseChatContent('2. Segundo').nodes[0].kind, 'ol')
assert.ok(valid('explica', 'La respuesta es breve y suficiente.'))
assert.ok(!valid('timeline', 'Aquí está la timeline.'))
assert.ok(valid('timeline', '1. 1810: Primer evento.'))
const mixed = parseChatContent('1. Uno 2. Dos\n\n' + table + '\n\nFinal')
assert.deepEqual(mixed.nodes.map(n => n.kind), ['ol', 'table', 'p'])
assert.deepEqual(parseChatContent('Inicio\n\n' + table + '\n\nFinal').nodes.map(n => n.kind), ['p', 'table', 'p'])
assert.equal(normalizeChatText(String.raw`\nabla + \nu + \n`), String.raw`\nabla + \nu + \n`)
assert.ok(!valid('explica', 'Según tu PDF, página 99: falsa atribución.'))
console.log('alai-chat-phase-b-structure: PASS')
