import assert from 'node:assert/strict'
import { buildVisualCompositionPlan } from '../../lib/adaptive/visual/visualComposition'

const plan = buildVisualCompositionPlan({ microId:'q', title:'Función', content:'f(x) = x^2 + 2. La gráfica tiene dominio -3 <= x <= 3.', keyPoints:[], factKeys:['f'], cognitiveTarget:'application', sourceStepId:'s' })
assert.ok(plan)
assert.equal(plan.primary.engine, 'graph_2d')
assert.equal(plan.supporting[0]?.engine, 'equation_expression')
assert.ok(plan.complexity <= 3)
assert.equal(buildVisualCompositionPlan({ microId:'n', title:'Idea', content:'Una idea requiere reflexión cuidadosa.', keyPoints:[], factKeys:['f'], cognitiveTarget:'comprehension', sourceStepId:'s' }), null)
console.log('Visual composition contracts: PASS')
