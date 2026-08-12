import assert from 'node:assert/strict'
import { buildTeachingLayout } from '../../lib/adaptive/visual/teachingLayout'

assert.equal(buildTeachingLayout({type:'concept',content:'1. Observa\n2. Compara\n3. Concluye'})[0]?.kind,'numbered_steps')
assert.equal(buildTeachingLayout({type:'formula',content:'F = ma'})[0]?.kind,'formula')
assert.equal(buildTeachingLayout({type:'concept',content:'Definición: una relación conecta elementos.'})[0]?.kind,'definition')
assert.ok(buildTeachingLayout({type:'concept',content:'<script>alert(1)</script>'}).every(block => !('html' in block)))
console.log('Visual teaching-layout contracts: PASS')
