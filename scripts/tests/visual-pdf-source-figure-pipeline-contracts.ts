import assert from 'node:assert/strict'
import fs from 'node:fs'
import { extractPdf } from '../../lib/materials/extractors'
import { renderPdfPagePng } from '../../lib/materials/pdfPageAsset'
import { attachSourceFiguresToBlocks, buildPageSourceFigure } from '../../app/api/adaptive/blueprint/route'
import { extractGroundedVisualComposition } from '../../lib/adaptive/visual/groundedVisualSource'

async function main(){const started=performance.now();const buffer=fs.readFileSync('tests/fixtures/real-materials/TAREA QUIMICA CLUTCH.pdf')
const extracted=await extractPdf(buffer,{localOnly:true});assert.ok((extracted.pages||0)>=1);assert.ok(extracted.text.length>100)
const png=await renderPdfPagePng(buffer,1,1);assert.ok(png.length>1000);assert.equal(png.subarray(1,4).toString(),'PNG')
const figure=buildPageSourceFigure('fixture-material',1,'Figura 1. La salida aumenta con la entrada.');assert.ok(figure)
const [block]=attachSourceFiguresToBlocks([{id:'block',label:'Relación',summary:'Figura grounded del material.',materialId:'fixture-material',pages:[1],sourceSpans:[{page:1,quote:'Figura 1. La salida aumenta con la entrada.'}]}],[figure!])
const composition=extractGroundedVisualComposition(block);assert.equal(composition?.primary.engine,'source_image');assert.equal(composition?.primary.provenance?.kind,'SOURCE')
console.log(JSON.stringify({suite:'visual-pdf-source-figure-pipeline',status:'PASS',pdfBytes:buffer.length,pngBytes:png.length,overheadMs:Number((performance.now()-started).toFixed(2)),providerCalls:0}))
}
main().catch(error=>{console.error(error);process.exitCode=1})
