import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describeVisualSpec } from '../../components/visual/VisualRenderer'
import type { VisualSpec } from '../../lib/adaptive/visual/visualContract'

const engines=['source_image','geometry_canvas','graph_2d','structure_graph','flow_state','timeline'] as const
for(const engine of engines){const malformed={id:`bad:${engine}`,requirementId:'r',microId:'m',engine,representation:'bad',conceptual:false,sourceGrounding:{sourceSpans:[],factKeys:[]},data:null} as unknown as VisualSpec;assert.doesNotThrow(()=>describeVisualSpec(malformed));assert.match(describeVisualSpec(malformed),/no disponible/)}
const renderer=fs.readFileSync('components/visual/VisualRenderer.tsx','utf8');const sourceView=fs.readFileSync('components/visual/UniversalVisualViews.tsx','utf8')
assert.match(renderer,/VisualErrorBoundary/);assert.match(sourceView,/onError=\{\(\)=>setFailed\(true\)\}/);assert.match(sourceView,/La figura no está disponible/)
console.log('visual-product-failure-isolation-contracts: PASS (bad asset/geometry/graph/node-edge/flow/timeline -> local fallback)')
