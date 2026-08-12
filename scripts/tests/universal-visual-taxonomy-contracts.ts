import assert from 'node:assert/strict'
import { classifyVisualNeed } from '../../lib/adaptive/visual/visualNeedClassifier'
import type { UniversalVisualNeed } from '../../lib/adaptive/visual/visualContract'

const taxonomy: UniversalVisualNeed[] = ['quantitative_relation','coordinate_graph','geometry','vector_spatial','structured_grid','hierarchy','network_connectivity','process_flow','state_transition','timeline','comparison','sequence','anatomy_spatial','molecular_structure','code_execution','equation_structure','image_annotation','source_figure','map_spatial','symbolic_manipulation']
assert.equal(new Set(taxonomy).size, 20)
const input = (content: string) => ({ microId:'m', title:'', content, keyPoints:[], factKeys:['f'], cognitiveTarget:'comprehension', sourceStepId:'s' })
assert.equal(classifyVisualNeed(input('A=(0,0), B=(2,3), segmento AB.'))?.engine, 'geometry_canvas')
assert.equal(classifyVisualNeed(input('Proceso: entrada → validación → salida.'))?.engine, 'flow_state')
assert.equal(classifyVisualNeed(input('Raíz contiene Rama; Rama contiene Hoja.'))?.engine, 'structure_graph')
assert.equal(classifyVisualNeed(input('x + 3 = 7; x = 4'))?.engine, 'equation_expression')
console.log(`Universal visual taxonomy contracts: PASS (${taxonomy.length}/20 needs declared)`)
