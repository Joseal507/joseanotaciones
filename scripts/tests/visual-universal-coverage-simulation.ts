import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { buildVisualCompositionPlan } from '../../lib/adaptive/visual/visualComposition'

const domains=['math','physics','chemistry','biology','medicine','history','law','programming','language','general']
const families=[
  'f(x) = 2x + 1. La gráfica tiene dominio -4 <= x <= 4.',
  'A=(0,0), B=(3,4), segmento AB.',
  'Reacción: H2 + I2 ⇌ 2HI. Concentraciones iniciales: [H2] = 1.00, [I2] = 1.00, [HI] = 0. Cambio: [H2] = -x, [I2] = -x, [HI] = +2x. En el equilibrio: [H2] = 1-x, [I2] = 1-x, [HI] = 2x.',
  'Fuerza peso = 20 N a 270°. Fuerza normal = 20 N a 90° sobre el bloque y eje vertical.',
  'La molécula tiene fórmula condensada CH3-CH2-CH3 y enlaces simples.',
  '```python\nx = 3\ny = x * 2\nprint(y)\n```\nTraza de ejecución: línea 1 x=3; línea 2 y=6; línea 3 salida=6.',
  'En 1848 ocurre A. En 1859 ocurre B. Secuencia cronológica.',
  'Proceso: entrada → análisis → resultado.',
  'Nodo A conecta con Nodo B; Nodo B depende de Nodo C.',
  'x + 3 = 7; x = 4',
]
let supported=0;let payload=0
const byDomain=new Map<string,number>();const started=performance.now()
for(let i=0;i<300;i++){
  const domain=domains[i%domains.length];const content=families[i%families.length]
  const plan=buildVisualCompositionPlan({microId:`m${i}`,title:'Caso',content,keyPoints:[],factKeys:[`f${i}`],cognitiveTarget:'application',sourceStepId:`s${i}`})
  if(plan){supported++;byDomain.set(domain,(byDomain.get(domain)||0)+1);payload+=JSON.stringify(plan).length}
}
const elapsed=performance.now()-started;const percentage=supported/300*100
assert.ok(percentage>=95,`coverage ${percentage}%`)
assert.equal(byDomain.size,10)
assert.ok(payload>0)
console.log(JSON.stringify({suite:'visual-universal-coverage',totalCases:300,usefulVisualCases:300,supported,unsupported:300-supported,percentage,byDomain:Object.fromEntries(byDomain),planningMs:Number(elapsed.toFixed(2)),averagePayloadBytes:Math.round(payload/supported)}))
