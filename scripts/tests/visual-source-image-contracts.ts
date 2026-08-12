import assert from 'node:assert/strict'
import { buildSourceImageSpec } from '../../lib/adaptive/visual/engines/universalPrimitiveEngines'
import { extractGroundedVisualComposition } from '../../lib/adaptive/visual/groundedVisualSource'

const source = buildSourceImageSpec({ src:'/fixtures/page-2.png', alt:'Figura 2 del material', page:2, bounds:{x:0.1,y:0.2,width:0.5,height:0.4}, hotspots:[{id:'h',label:'Región citada',x:0.4,y:0.6},{id:'bad',label:'Inventada',x:4,y:2}] })
assert.ok(source)
assert.equal(source.src, '/fixtures/page-2.png')
assert.equal(source.hotspots.length, 1)
assert.equal(buildSourceImageSpec({ src:'/x.png' }), null)
assert.equal(buildSourceImageSpec({ alt:'sin imagen' }), null)
const attached = extractGroundedVisualComposition({ id:'b', summary:'Figura preservada del documento.', sourceFigures:[{src:'/page.png',alt:'Esquema fuente de la página',page:3}] })
assert.equal(attached?.primary.engine, 'source_image')
assert.equal(attached?.primary.provenance?.kind, 'SOURCE')
console.log('Visual source-image contracts: PASS (source preserved; ungrounded omitted)')
