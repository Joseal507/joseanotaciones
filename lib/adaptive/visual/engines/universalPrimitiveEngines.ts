import type { EquationExpressionDataSpec, FlowStateDataSpec, GeometryCanvasDataSpec, SourceImageDataSpec, StructureGraphDataSpec, VisualGradingResult, VisualSourceSpan } from '../visualContract'

const spans=(factKeys:string[],stepId:string,quote:string):VisualSourceSpan[]=>factKeys.map(factKey=>({stepId,factKey,quote}))
const number=(value:string)=>Number(value.replace(',','.'))

export function extractGeometryCanvasSpec(text:string,factKeys:string[],stepId:string):{data:GeometryCanvasDataSpec;sourceSpans:VisualSourceSpan[]}|null{
  const explicit=[...text.matchAll(/([A-Z])\s*=\s*\(\s*(-?\d+(?:[.,]\d+)?)\s*,\s*(-?\d+(?:[.,]\d+)?)\s*\)/g)]
  if(explicit.length<2)return null
  const points=explicit.map(match=>({id:match[1],label:match[1],x:number(match[2]),y:number(match[3])}))
  const ids=new Set(points.map(point=>point.id));const segments=[...text.matchAll(/(?:segmento|lado|vector)\s+([A-Z])([A-Z])/gi)].filter(match=>ids.has(match[1])&&ids.has(match[2])).map((match,index)=>({id:`segment-${index}`,from:match[1],to:match[2],label:`${match[1]}${match[2]}`,kind:/vector/i.test(match[0])?'vector' as const:'segment' as const}))
  if(!segments.length)for(let i=1;i<points.length;i++)segments.push({id:`segment-${i}`,from:points[i-1].id,to:points[i].id,label:`${points[i-1].id}${points[i].id}`,kind:'segment'})
  return{data:{points,segments,axes:true},sourceSpans:spans(factKeys,stepId,explicit.map(match=>match[0]).join('; '))}
}

export function extractStructureGraphSpec(text:string,factKeys:string[],stepId:string):{data:StructureGraphDataSpec;sourceSpans:VisualSourceSpan[]}|null{
  const relations=[...text.matchAll(/\b([\p{L}\d_ -]{2,30})\s*(?:->|→|depende de|conecta con|contiene|se divide en|forma parte de)\s*([\p{L}\d_ -]{2,30})/giu)]
  if(!relations.length)return null
  const labels=[...new Set(relations.flatMap(match=>[match[1].trim(),match[2].trim()]))]
  if(labels.length<2||labels.length>20)return null
  const nodes=labels.map((label,index)=>({id:`node-${index}`,label}));const byLabel=new Map(nodes.map(node=>[node.label,node.id]))
  const edges=relations.map((match,index)=>({id:`edge-${index}`,from:byLabel.get(match[1].trim())!,to:byLabel.get(match[2].trim())!,directed:true}))
  const hierarchy=/contiene|se divide en|forma parte de/i.test(text)
  return{data:{nodes,edges,layout:hierarchy?'hierarchy':'network'},sourceSpans:spans(factKeys,stepId,relations.map(match=>match[0]).join('; '))}
}

export function extractFlowStateSpec(text:string,factKeys:string[],stepId:string):{data:FlowStateDataSpec;sourceSpans:VisualSourceSpan[]}|null{
  const arrowLine=text.split(/\n|\./).find(line=>(line.match(/(?:→|->)/g)||[]).length>=1)
  if(!arrowLine)return null
  const labels=arrowLine.split(/→|->/).map(value=>value.trim()).filter(value=>value.length>=2&&value.length<=80)
  if(labels.length<2||labels.length>12)return null
  const stages=labels.map((label,index)=>({id:`stage-${index}`,label}));const transitions=stages.slice(1).map((stage,index)=>({from:stages[index].id,to:stage.id}))
  return{data:{stages,transitions,cyclic:/ciclo|cycle/i.test(text)},sourceSpans:spans(factKeys,stepId,arrowLine.trim())}
}

export function extractEquationExpressionSpec(text:string,factKeys:string[],stepId:string):{data:EquationExpressionDataSpec;sourceSpans:VisualSourceSpan[]}|null{
  const chain=text.split(/\n|;/).map(line=>line.trim()).filter(line=>/^[\p{L}\d()[\]{}+\-*/^=.⇌↔<>\s]+$/u.test(line)&&(line.includes('=')||/[⇌↔]|<=>|<->/.test(line))&&line.length<140)
  if(!chain.length)return null
  const original=chain[0];const steps=chain.slice(0,8).map((expression,index)=>({id:`equation-${index}`,expression,operation:index?'transformación indicada en el material':'expresión fuente'}))
  return{data:{original,steps},sourceSpans:spans(factKeys,stepId,chain.join('; '))}
}

export function buildSourceImageSpec(figure:{src?:string;alt?:string;page?:number;bounds?:SourceImageDataSpec['bounds'];hotspots?:SourceImageDataSpec['hotspots']}):SourceImageDataSpec|null{
  if(!figure.src||!figure.alt?.trim())return null
  const hotspots=(figure.hotspots||[]).filter(item=>item.label&&Number.isFinite(item.x)&&Number.isFinite(item.y)&&item.x>=0&&item.x<=1&&item.y>=0&&item.y<=1)
  return{src:figure.src,alt:figure.alt,page:figure.page,bounds:figure.bounds,hotspots}
}

export function gradeUniversalPrimitive(data:GeometryCanvasDataSpec|StructureGraphDataSpec|FlowStateDataSpec|EquationExpressionDataSpec|SourceImageDataSpec,verb:string,response:unknown):VisualGradingResult{
  let correct=false
  const id=typeof response==='string'?response:typeof response==='object'&&response!==null&&'id'in response&&typeof response.id==='string'?response.id:''
  if('assessment'in data&&data.assessment){
    if(verb===data.assessment.verb&&'targetId'in data.assessment)correct=data.assessment.targetId===id
    if(verb==='order_sequence'&&'order'in data.assessment&&Array.isArray(response))correct=JSON.stringify(response)===JSON.stringify(data.assessment.order)
  }
  if(verb==='transform_expression'&&'steps'in data)correct=data.steps.some(step=>step.id===id||step.expression===id)
  const gradeable=('assessment'in data&&Boolean(data.assessment))||verb==='transform_expression'
  return{correct,score:correct?100:0,evidenceKind:'visual_interpretation',feedback:correct?'Selección correcta.':gradeable?'Revisa las relaciones mostradas.':'Esta representación no tiene un objetivo espacial grounded evaluable.',errorType:correct?null:gradeable?'visual_selection':'ungradeable'}
}
