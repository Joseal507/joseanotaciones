import assert from 'node:assert/strict'
import { buildTeachingLayout } from '../../lib/adaptive/teachingLayout'

const kind = (type: string, content: string, keyPoints: string[] = []) => buildTeachingLayout({ type, content, keyPoints })[0]?.kind

assert.equal(kind('concept', 'Definición: una función asigna una salida a cada entrada.'), 'definition')
assert.equal(kind('concept', '1. Identifica los datos.\n2. Sustituye los valores.\n3. Comprueba el resultado.'), 'numbered_steps')
assert.equal(kind('concept', '• propiedad uno\n• propiedad dos\n• propiedad tres'), 'bullets')
assert.equal(kind('concept', '| Modelo | Aporte |\n|---|---|\n| A | Uno |\n| B | Dos |'), 'table')
assert.equal(kind('example', 'Ejemplo resuelto: f(4)=2(4)+3=11'), 'worked_example')
assert.equal(kind('concept', 'Error común: confundir cobertura con dominio.'), 'common_error')
assert.equal(kind('warning', 'Advertencia: no concluyas sin evidencia.'), 'warning')
assert.equal(kind('concept', 'A vs B: tienen criterios diferentes.'), 'comparison')

const structured = buildTeachingLayout({
  type: 'concept',
  content: '1. Observa la fuente.\n2. Identifica la regla.\n3. Comprueba la conclusión.',
  keyPoints: ['La fuente manda.', 'La evidencia debe ser explícita.', 'La fuente manda.'],
})
assert.deepEqual(structured.map(block => block.kind), ['numbered_steps', 'key_takeaways'])
assert.equal((structured[1] as { text: string }).text, 'La fuente manda. · La evidencia debe ser explícita.')
assert.deepEqual(structuredClone(structured), structured, 'el layout persistido debe restaurarse exactamente')
assert.deepEqual(buildTeachingLayout({ type: 'concept', content: '1. Observa la fuente.\n2. Identifica la regla.\n3. Comprueba la conclusión.', keyPoints: ['La fuente manda.', 'La evidencia debe ser explícita.', 'La fuente manda.'] }), structured)

const serialized = JSON.stringify(structured)
for (const grounded of ['Observa la fuente.', 'Identifica la regla.', 'Comprueba la conclusión.', 'La fuente manda.', 'La evidencia debe ser explícita.']) assert.ok(serialized.includes(grounded))
assert.ok(!serialized.includes('<script'), 'el contrato no emite HTML libre')

console.log('structured-teaching-layout-contracts: 10/10 PASS')
