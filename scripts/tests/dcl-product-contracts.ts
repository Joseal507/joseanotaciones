import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { VisualRenderer } from '../../components/visual/VisualRenderer'
import { extractSpatialVectorSpec } from '../../lib/adaptive/visual/engines/spatialVectorEngine'

const extracted=extractSpatialVectorSpec(
  'Sobre el bloque actúan Peso 49 N hacia abajo, Normal 49 N hacia arriba, Fuerza aplicada 30 N a 30 grados, Fricción 8 N hacia la izquierda.',
  ['dcl:forces'], 'step_dcl',
)
assert.ok(extracted,'el sistema grounded de cuatro fuerzas debe extraerse')
assert.equal(extracted.data.forces.length,4,'las cuatro fuerzas deben coexistir en un único DCL')
assert.deepEqual(extracted.data.forces.map(force=>force.angleDeg),[270,90,30,180])
assert.deepEqual(extracted.data.forces.map(force=>force.label),['Peso','Normal','Fuerza aplicada','Fricción'])

const spec:any={id:'dcl',requirementId:'r',microId:'m',engine:'spatial_vector',representation:'free_body_diagram',conceptual:false,sourceGrounding:{sourceSpans:extracted.sourceSpans,factKeys:['dcl:forces']},data:extracted.data}
const teach=renderToStaticMarkup(React.createElement(VisualRenderer,{spec,mode:'teach'}))
for(const label of ['Peso','Normal','Fuerza aplicada','Fricción']) assert.match(teach,new RegExp(label))
assert.match(teach,/viewBox="0 0 520 360"/,'DCL debe usar SVG responsive con espacio de producto')

const assess=renderToStaticMarkup(React.createElement(VisualRenderer,{spec,mode:'assess'}))
assert.doesNotMatch(assess,/<input/,'assessment DCL quick/select no debe requerir teclado')
assert.match(assess,/30°/)
assert.match(assess,/49 N/)
console.log('dcl-product-contracts: PASS (4 fuerzas simultáneas, ángulos, labels semánticos, SVG responsive y assess sin teclado)')

const decomposed=extractSpatialVectorSpec('Sobre el bloque actúa una fuerza aplicada F = 30 N a 30°. Sus componentes grounded son Fx ≈ 25.98 N y Fy = 15 N.',['dcl:components'],'step_components')
assert.ok(decomposed?.data.decomposition)
assert.deepEqual(decomposed.data.decomposition,{forceId:'force_1',xMagnitude:25.98,yMagnitude:15,unit:'N',angleDeg:30})
const decompositionMarkup=renderToStaticMarkup(React.createElement(VisualRenderer,{spec:{...spec,id:'components',data:decomposed.data},mode:'teach'}))
assert.match(decompositionMarkup,/vector-decomposition/)
assert.match(decompositionMarkup,/Fx ≈ 25.98 N/)
assert.match(decompositionMarkup,/Fy = 15 N/)
