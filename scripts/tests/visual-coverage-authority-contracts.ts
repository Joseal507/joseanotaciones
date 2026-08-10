import assert from 'node:assert/strict'
import {
  certifyBlueprint,
  selectPagesNeedingVision,
  enrichPageWithVision,
  type BlueprintAuditReport,
} from '../../app/api/adaptive/blueprint/route'

// GARANTÍA 1, ronda de verificación de coverage authority: "REQUIRED VISUAL
// PAGE FAILED => THAT PAGE CANNOT BE CONSIDERED COVERED." Antes,
// certifyBlueprint no recibía NINGÚN dato sobre fallos de enriquecimiento
// visual — un console.warn era la única señal, y el blueprint podía
// certificarse "listo" con una página requerida nunca analizada. Ahora
// failedVisualPages es un 4º parámetro AUTORITATIVO de certifyBlueprint
// (la misma función real que usa la ruta viva) — no una reimplementación.

const passingQuality = { status: 'ok', reasons: [] }
const passingAudit: BlueprintAuditReport = { passed: true, issues: [], uncoveredFragments: [] }
const minimalBlueprint = { topics: [], blocks: [] }

// ═══ A. 13/13 success => ready ═══
function testA_AllSucceed_Ready() {
  const certification = certifyBlueprint(minimalBlueprint, passingQuality, passingAudit, [])
  assert.equal(certification.coverageCertified, true, 'A: BUG DE ORIGEN SI FALLA: sin páginas fallidas, la certificación no debe bloquearse por este motivo')
  assert.equal(certification.planGenerationAllowed, true)
  assert.equal(certification.certificationReasons.length, 0)
}

// ═══ B. 12/13 + one transient fail then success => ready ═══
// Un fallo TRANSITORIO que termina en éxito (tras retry) nunca llega a
// failedVisualPages — solo 'failed' (agotó todos los reintentos) cuenta.
// Se prueba end-to-end contra la función REAL enrichPageWithVision.
async function testB_TransientThenSuccess_NeverCountsAsFailed() {
  let calls = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    calls += 1
    if (calls === 1) return { ok: false, status: 503, text: async () => 'transient' } as any
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Contenido visual real recuperado tras el segundo intento, con más de cincuenta caracteres.' } }] }) } as any
  }) as any
  try {
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key'
    const outcome = await enrichPageWithVision(5, Buffer.from('pdf'), 'material.pdf', '')
    assert.equal(outcome.status, 'enriched', 'B: un fallo transitorio seguido de éxito debe terminar en "enriched", nunca en "failed"')
    // Simula lo que hace el caller real: solo 'failed' se empuja a failedVisualPages.
    const failedVisualPages: Array<{ material: string; page: number }> = []
    if ((outcome.status as string) === 'failed') failedVisualPages.push({ material: 'material.pdf', page: 5 })
    const certification = certifyBlueprint(minimalBlueprint, passingQuality, passingAudit, failedVisualPages)
    assert.equal(certification.coverageCertified, true, 'B: BUG DE ORIGEN SI FALLA: 12/13 + 1 transitorio-recuperado debe seguir siendo "ready" — el retry SÍ cubrió la página')
  } finally {
    globalThis.fetch = originalFetch
  }
}

// ═══ C. 12/13 + one persistent required failure => NOT ready ═══
function testC_OnePersistentFailure_BlocksCertification() {
  const failedVisualPages = [{ material: 'QUIMICA SEGUNDO SEMESTRE 1.pdf', page: 7 }]
  const certification = certifyBlueprint(minimalBlueprint, passingQuality, passingAudit, failedVisualPages)
  assert.equal(certification.coverageCertified, false, 'C: BUG DE ORIGEN SI FALLA: una sola página requerida persistentemente fallida debe bloquear coverageCertified, aunque calidad/auditoría estén perfectas')
  assert.equal(certification.planGenerationAllowed, false, 'C: BUG DE ORIGEN SI FALLA: planGenerationAllowed debe seguir a coverageCertified — no puede generarse un plan sobre cobertura incompleta')
  assert.ok(certification.certificationReasons.some(r => r.includes('VISUAL_ENRICHMENT_FAILED') && r.includes('p.7')), 'C: la razón de bloqueo debe ser específica y trazable a la página exacta')
}

// ═══ D. failure cannot disappear after merge ═══
// Aunque calidad y auditoría sean intachables (el caso más favorable
// posible para que el bug se cuele), failedVisualPages sigue bloqueando —
// no hay ninguna combinación de otras señales "buenas" que lo blanqueen.
function testD_FailureNeverDisappearsRegardlessOfOtherSignals() {
  const excellentQuality = { status: 'excellent', reasons: [] }
  const excellentAudit: BlueprintAuditReport = { passed: true, issues: [], uncoveredFragments: [] }
  const richBlueprint = { topics: [{ id: 't1', title: 'Topic', pages: [1, 2, 3] }], blocks: [{ topicId: 't1', sourceSpans: ['x'] }] }
  const failedVisualPages = [{ material: 'm.pdf', page: 7 }]
  const certification = certifyBlueprint(richBlueprint, excellentQuality, excellentAudit, failedVisualPages)
  assert.equal(certification.coverageCertified, false, 'D: BUG DE ORIGEN SI FALLA: ninguna señal estructural/de auditoría "buena" puede blanquear un fallo visual requerido registrado')
}

// ═══ E. retry cannot duplicate successful page extraction ═══
async function testE_RetrySuccessNeverDuplicatesContent() {
  let calls = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    calls += 1
    if (calls === 1) return { ok: false, status: 503, text: async () => 'transient' } as any
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'UNICO-CONTENIDO-VISUAL: descripción real de la página con más de cincuenta caracteres para superar el umbral.' } }] }) } as any
  }) as any
  try {
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key'
    const outcome = await enrichPageWithVision(6, Buffer.from('pdf'), 'material.pdf', '')
    const occurrences = outcome.text.split('UNICO-CONTENIDO-VISUAL').length - 1
    assert.equal(occurrences, 1, 'E: BUG DE ORIGEN SI FALLA: el retry no debe duplicar el contenido — debe aparecer exactamente una vez, no acumulado de ambos intentos')
  } finally {
    globalThis.fetch = originalFetch
  }
  // selectPagesNeedingVision no puede producir duplicados: escanea 1..totalPages
  // una sola vez por número de página — verificado estructuralmente.
  const fullPageMap = new Map<number, string>([[1, ''], [2, 'x'.repeat(200)]])
  const selected = selectPagesNeedingVision(fullPageMap, 2)
  assert.equal(new Set(selected).size, selected.length, 'E: selectPagesNeedingVision no debe producir páginas duplicadas')
}

// ═══ F. restored/cached enrichment — NO APLICA ═══
// blueprint/route.ts no tiene ningún mecanismo de caché/restore por página
// para resultados de visión (verificado: sin `cache`/`Cache` en el
// archivo) — cada POST reprocesa el material completo desde cero. No hay
// estado "restaurado" cuyo failed/success deba preservarse entre
// requests para este endpoint. Documentado explícitamente, no fabricado.
function testF_NoCachingMechanismExists_DocumentedNotApplicable() {
  console.log('  ℹ️  F: no aplica — blueprint/route.ts no cachea/restaura resultados de visión por página entre requests; cada POST reprocesa desde cero')
}

async function run() {
  testA_AllSucceed_Ready()
  await testB_TransientThenSuccess_NeverCountsAsFailed()
  testC_OnePersistentFailure_BlocksCertification()
  testD_FailureNeverDisappearsRegardlessOfOtherSignals()
  await testE_RetrySuccessNeverDuplicatesContent()
  testF_NoCachingMechanismExists_DocumentedNotApplicable()
  console.log('visual-coverage-authority-contracts: PASS (A: 13/13 ready; B: transitorio-recuperado sigue ready; C: 1 fallo persistente bloquea certificación; D: ninguna otra señal blanquea el fallo; E: retry no duplica contenido/páginas; F: sin mecanismo de caché, no aplica)')
}

run()
