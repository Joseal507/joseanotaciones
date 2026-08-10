import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  selectPagesNeedingVision,
  chunkIntoBatches,
  syncVisualEnrichmentToPageMap,
  enrichPageWithVision,
  VISION_BATCH_SIZE,
  VISION_MAX_CHARS,
} from '../../app/api/adaptive/blueprint/route'

// GARANTÍA 2 (verificación post-misión): "ninguna página que realmente
// necesite análisis visual puede descartarse por una cuota fija de
// páginas." Usa las funciones REALES extraídas y exportadas de
// blueprint/route.ts (selectPagesNeedingVision, chunkIntoBatches,
// syncVisualEnrichmentToPageMap, enrichPageWithVision) — nunca una
// reimplementación paralela de su lógica.

function buildFullPageMap(poorPageNumbers: Set<number>, totalPages: number): Map<number, string> {
  const map = new Map<number, string>()
  for (let p = 1; p <= totalPages; p++) {
    map.set(p, poorPageNumbers.has(p) ? '' : `Contenido de texto normal y suficiente para la página ${p}, con más de ochenta caracteres reales de material académico genuino.`)
  }
  return map
}

function assertAllProcessedNoneDropped(poorPageNumbers: number[], totalPages: number, label: string) {
  const fullPageMap = buildFullPageMap(new Set(poorPageNumbers), totalPages)
  const selected = selectPagesNeedingVision(fullPageMap, totalPages)
  assert.deepEqual(new Set(selected), new Set(poorPageNumbers), `${label}: BUG DE ORIGEN SI FALLA: selectPagesNeedingVision debe seleccionar EXACTAMENTE las páginas pobres, ni más ni menos`)
  const batches = chunkIntoBatches(selected, VISION_BATCH_SIZE)
  const flattened = batches.flat()
  assert.deepEqual(new Set(flattened), new Set(poorPageNumbers), `${label}: BUG DE ORIGEN SI FALLA: el batching no puede perder ni una sola candidata — processed required pages debe ser ${poorPageNumbers.length}, dropped debe ser 0`)
  assert.equal(flattened.length, poorPageNumbers.length, `${label}: ninguna página duplicada ni perdida en el aplanado de batches`)
  if (poorPageNumbers.length > 0) {
    assert.equal(batches.length, Math.ceil(poorPageNumbers.length / VISION_BATCH_SIZE), `${label}: número de batches debe derivarse del total de candidatas, no de un cap`)
  }
}

// ═══ 1-6. 0/2/4/5/13/21+ páginas visuales — todas procesadas, 0 dropped ═══
function testCounts() {
  assertAllProcessedNoneDropped([], 10, '0 páginas visuales')
  assertAllProcessedNoneDropped([3, 7], 10, '2 páginas visuales')
  assertAllProcessedNoneDropped([1, 4, 7, 10], 12, '4 páginas visuales')
  assertAllProcessedNoneDropped([2, 5, 8, 11, 14], 15, '5 páginas visuales')
  assertAllProcessedNoneDropped([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], 20, '13 páginas visuales — el caso real reportado (antes: 4 procesadas, 9 descartadas)')
  const many = Array.from({ length: 34 }, (_, i) => i * 2 + 1) // 34 páginas no consecutivas, disperso en 80
  assertAllProcessedNoneDropped(many, 80, '>20 páginas visuales (34, disperso en material de 80 páginas)')
}

// ═══ 7. páginas visuales no consecutivas ═══
function testNonConsecutive() {
  assertAllProcessedNoneDropped([2, 9, 23, 41], 50, 'páginas no consecutivas dispersas')
}

// ═══ 8. mezcla texto + diagramas: solo el detector decide, nunca "todas a
// visión ciegamente" ═══
function testMixedTextAndDiagramsOnlyFlagsWhatNeedsIt() {
  const fullPageMap = new Map<number, string>([
    [1, 'Texto normal extenso y perfectamente extraíble para la página uno, con contenido académico real y suficiente.'],
    [2, ''], // diagrama puro, sin texto
    [3, 'Otro texto normal extenso y suficiente para la página tres, también con contenido académico completo y real.'],
    [4, 'x'.repeat(30)], // casi vacía — bajo VISION_MAX_CHARS
    [5, 'Texto normal extenso y suficiente para la página cinco, con todo el contenido académico real necesario aquí.'],
  ])
  const selected = selectPagesNeedingVision(fullPageMap, 5)
  assert.deepEqual(new Set(selected), new Set([2, 4]), 'BUG DE ORIGEN SI FALLA: solo las páginas realmente pobres (2 y 4) deben marcarse — las páginas 1/3/5 con texto suficiente NUNCA deben enviarse a visión ciegamente')
}

// ═══ 9. sin cuota fija — verificación explícita de ausencia de cap ═══
function testNoFixedCapInSource() {
  const source = readFileSync('app/api/adaptive/blueprint/route.ts', 'utf8')
  assert.doesNotMatch(source, /const MAX_VISION_PAGES/, 'BUG DE ORIGEN SI FALLA: no debe existir ningún cap fijo de páginas visuales')
  assert.doesNotMatch(source, /poorPages\.slice\(0,\s*(MAX_VISION_PAGES|\d+)\)/, 'BUG DE ORIGEN SI FALLA: no debe existir ningún slice(0, N) que descarte candidatas por cuota')
  assert.match(source, /export function chunkIntoBatches/, 'debe existir batching real (control de concurrencia, no de cobertura)')
}

// ═══ 10. una página falla transitoriamente → retry ═══
async function testTransientFailureRetries() {
  let calls = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (..._args: any[]) => {
    calls += 1
    if (calls === 1) return { ok: false, status: 503, text: async () => 'transient' } as any
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Descripción visual real de la página, con más de cincuenta caracteres de contenido genuino.' } }] }) } as any
  }) as any
  try {
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-for-vision-retry'
    const result = await enrichPageWithVision(3, Buffer.from('fake-pdf'), 'material.pdf', '')
    assert.equal(calls, 2, 'BUG DE ORIGEN SI FALLA: un fallo HTTP transitorio debe reintentarse exactamente una vez más')
    assert.equal(result.status, 'enriched', 'BUG DE ORIGEN SI FALLA: tras el retry exitoso, el status debe ser "enriched", nunca "failed"')
    assert.ok(result.text.length > 50, 'BUG DE ORIGEN SI FALLA: el segundo intento exitoso debe devolver el contenido enriquecido — nunca perderlo tras un fallo transitorio')
  } finally {
    globalThis.fetch = originalFetch
  }
}

// ═══ 11. página persistentemente fallida: registrada explícitamente, nunca
// silenciosa; no bloquea el resto del pipeline (no lanza) ═══
async function testPersistentFailureExplicitlyLoggedNeverThrows() {
  let calls = 0
  const originalFetch = globalThis.fetch
  const originalWarn = console.warn
  const warnings: string[] = []
  console.warn = (...args: any[]) => { warnings.push(args.join(' ')) }
  globalThis.fetch = (async (..._args: any[]) => {
    calls += 1
    return { ok: false, status: 500, text: async () => 'persistent failure' } as any
  }) as any
  try {
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-for-vision-retry'
    const result = await enrichPageWithVision(9, Buffer.from('fake-pdf'), 'material.pdf', '')
    assert.equal(calls, 2, 'BUG DE ORIGEN SI FALLA: debe agotar exactamente 2 intentos antes de rendirse (bounded, no infinito)')
    assert.equal(result.status, 'failed', 'BUG DE ORIGEN SI FALLA: un fallo persistente debe reportarse como status="failed" — distinto de "no_content" (que es un resultado legítimo, no un hueco de cobertura)')
    assert.equal(result.text, '', 'un fallo persistente no debe lanzar — el pipeline debe poder continuar con las demás páginas')
    assert.ok(warnings.some(w => w.includes('agotó') && w.includes('9')), 'BUG DE ORIGEN SI FALLA: una página persistentemente fallida debe quedar EXPLÍCITAMENTE registrada (log estructurado), nunca desaparecer en silencio')
  } finally {
    globalThis.fetch = originalFetch
    console.warn = originalWarn
  }
}

// ═══ 12. contenido visual llega a pageMap (de donde lo consume
// extractDocumentStructure) — nunca se pierde entre extracción y topics ═══
function testVisualContentReachesPageMapForTopicExtraction() {
  const pageMap = new Map<number, string>([[1, 'texto original corto']])
  const fullPageMap = new Map<number, string>([
    [1, 'texto original corto\n\n[Visual content]\nDescripción enriquecida real de la página uno.'],
    [2, '[Visual content]\nPágina puramente visual — nunca estuvo en pageMap porque su texto extraído tenía ≤20 caracteres.'],
  ])
  syncVisualEnrichmentToPageMap(pageMap, fullPageMap)
  assert.equal(pageMap.get(1), fullPageMap.get(1), 'BUG DE ORIGEN SI FALLA: el contenido enriquecido de una página ya existente debe sincronizarse a pageMap')
  assert.equal(pageMap.get(2), fullPageMap.get(2), 'BUG DE ORIGEN SI FALLA: una página puramente visual (nunca en pageMap originalmente) debe aparecer en pageMap tras la sincronización, o extractDocumentStructure jamás la verá')
  assert.equal(pageMap.size, 2, 'pageMap debe ganar la nueva key de la página puramente visual')
}

function testVisionMaxCharsAndBatchSizeAreReasonable() {
  assert.ok(VISION_MAX_CHARS > 0 && VISION_MAX_CHARS < 500, 'VISION_MAX_CHARS debe ser un umbral de "casi vacía", no una cuota de cobertura')
  assert.ok(VISION_BATCH_SIZE >= 1 && VISION_BATCH_SIZE <= 10, 'VISION_BATCH_SIZE debe ser un tamaño de concurrencia razonable, nunca un total de páginas')
}

async function run() {
  testCounts()
  testNonConsecutive()
  testMixedTextAndDiagramsOnlyFlagsWhatNeedsIt()
  testNoFixedCapInSource()
  await testTransientFailureRetries()
  await testPersistentFailureExplicitlyLoggedNeverThrows()
  testVisualContentReachesPageMapForTopicExtraction()
  testVisionMaxCharsAndBatchSizeAreReasonable()
  console.log('visual-coverage-no-fixed-cap-contracts: PASS (0/2/4/5/13/34 páginas — todas procesadas, 0 dropped; no consecutivas; mezcla texto+diagramas solo marca lo necesario; sin cap fijo en fuente; retry ante fallo transitorio; fallo persistente acotado+registrado explícitamente+nunca lanza; contenido visual llega a pageMap para extractDocumentStructure)')
}

run()
