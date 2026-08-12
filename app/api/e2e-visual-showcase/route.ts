import { NextResponse } from 'next/server'
import { signVisualSpec } from '../../../lib/adaptive/visual/visualSpecIntegrity'
import type { VisualSpec } from '../../../lib/adaptive/visual/visualContract'

export function showcaseSpecs():VisualSpec[]{const base=(id:string)=>({id,requirementId:`r:${id}`,microId:`m:${id}`,representation:id,conceptual:false as const,sourceGrounding:{factKeys:[`f:${id}`],sourceSpans:[{stepId:`s:${id}`,factKey:`f:${id}`,quote:'Fixture grounded'}]}});return[
 {...base('graph'),engine:'graph_2d',data:{expression:'x^2 - 4',domain:[-3,3],points:[{x:-3,y:5},{x:-2,y:0,label:'raíz'},{x:0,y:-4,label:'vértice'},{x:2,y:0,label:'raíz'},{x:3,y:5}]}},
 {...base('geometry'),engine:'geometry_canvas',data:{axes:true,points:[{id:'A',x:0,y:0,label:'A'},{id:'B',x:4,y:0,label:'B'},{id:'C',x:2,y:3,label:'C'}],segments:[{id:'AB',from:'A',to:'B',measurement:4},{id:'BC',from:'B',to:'C'},{id:'CA',from:'C',to:'A'}],polygons:[{id:'triangle',points:['A','B','C'],kind:'triangle',label:'Triángulo ABC'}],assessment:{verb:'select_point',targetId:'A'}}},
 {...base('grid'),engine:'structured_grid',data:{reaction:'A ⇌ B',species:['A','B'],initial:{A:1,B:0},change:{A:'-x',B:'+x'},equilibrium:{A:'1-x',B:'x'}}},
 {...base('molecule'),engine:'chemistry_2d',data:{atoms:[{id:'C1',element:'C',x:0,y:45},{id:'C2',element:'C',x:64,y:45},{id:'C3',element:'C',x:128,y:45},{id:'C4',element:'C',x:192,y:45},{id:'C5',element:'C',x:64,y:0}],bonds:[{from:'C1',to:'C2',order:1},{from:'C2',to:'C3',order:1},{from:'C3',to:'C4',order:1},{from:'C2',to:'C5',order:1}]}},
 {...base('structure'),engine:'structure_graph',data:{layout:'tree',nodes:[{id:'root',label:'Sistema'},{id:'a',label:'Componente A'},{id:'b',label:'Componente B'}],edges:[{id:'ra',from:'root',to:'a',directed:true},{id:'rb',from:'root',to:'b',directed:true}],assessment:{verb:'select_node',targetId:'root'}}},
 {...base('flow'),engine:'flow_state',data:{stages:[{id:'one',label:'Entrada'},{id:'two',label:'Transformación'},{id:'three',label:'Resultado'}],transitions:[{from:'one',to:'two'},{from:'two',to:'three'}],assessment:{verb:'select_stage',targetId:'two'}}},
 {...base('timeline'),engine:'timeline',data:{events:[{id:'e1',label:'Primer evento',date:'1848',order:1},{id:'e2',label:'Segundo evento',date:'1859',order:2},{id:'e3',label:'Tercer evento',order:3}]}},
 {...base('source'),engine:'source_image',provenance:{kind:'SOURCE',reproducible:true,inputs:['fixture']},data:{src:'/fixtures/visual-source-page.svg',alt:'Figura original con entrada, flecha y resultado.',page:1,hotspots:[{id:'entry',label:'Entrada',x:.2,y:.47,radius:.05},{id:'result',label:'Resultado',x:.78,y:.47,radius:.05}],assessment:{verb:'select_hotspot',targetId:'entry'}}},
 {...base('code'),engine:'code_execution',data:{language:'javascript',code:'let x = 1;\nx = x + 1;',steps:[{line:1,variables:{x:1}},{line:2,variables:{x:2},output:'2'}]}},
 {...base('equation'),engine:'equation_expression',data:{original:'2x + 4 = 10',steps:[{id:'q1',expression:'2x + 4 = 10'},{id:'q2',expression:'2x = 6'},{id:'q3',expression:'x = 3'}]}},
] as VisualSpec[]}
export async function GET(){if(process.env.NODE_ENV==='production')return NextResponse.json({error:'Not found'},{status:404});return NextResponse.json({specs:showcaseSpecs().map(signVisualSpec)})}
