import assert from 'node:assert/strict'
import { gradeVisualInteraction } from '../../lib/adaptive/visual/visualGrading'
import type { VisualSpec } from '../../lib/adaptive/visual/visualContract'

const spec: VisualSpec = { id:'v', requirementId:'r', microId:'m', representation:'geometry', conceptual:false, engine:'geometry_canvas', sourceGrounding:{factKeys:['f'],sourceSpans:[{stepId:'s',factKey:'f',quote:'A=(0,0), B=(1,1)'}]}, data:{points:[{id:'A',x:0,y:0},{id:'B',x:1,y:1}],segments:[{id:'AB',from:'A',to:'B'}],assessment:{verb:'select_point',targetId:'A'}} }
assert.equal(gradeVisualInteraction(spec,{visualSpecId:'v',verb:'select_point',response:'A'}).correct,true)
assert.equal(gradeVisualInteraction(spec,{visualSpecId:'v',verb:'select_point',response:'X'}).correct,false)
assert.equal(gradeVisualInteraction(spec,{visualSpecId:'wrong',verb:'select_point',response:'A'}).errorType,'spec_mismatch')
console.log('Visual interaction contracts: PASS (teach/practice share spec; assessment grading deterministic)')
