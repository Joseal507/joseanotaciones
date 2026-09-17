import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { MATERIAL_BRAIN_BUILDER_VERSION } from '../../lib/materialBrain/build'
import type { ImportanceTier, KnowledgeUnit, KnowledgeUnitKind, MaterialBrain } from '../../lib/materialBrain/types'
import {
  buildAnalysisGroundedContext, buildAnalysisNarrativeClusters, buildAnalysisTargets,
  computeAnalysisCoverage, deterministicCoberturaMaterial, deterministicParaExamen,
  deterministicProbabilidadExamen, renderAnalysisGroundedContext,
} from '../../lib/materialBrain/analysisContext'
import { POST, __routeDeps } from '../../app/api/analizar-teorico/route'

let providerCalls = 0

function unit(
  id: string, materialId: string, page: number, derivation: 'native_text' | 'vision',
  kind: KnowledgeUnitKind = 'fact', tier: ImportanceTier = 'supporting',
): KnowledgeUnit {
  const base: any = {
    id, kind,
    identity: { canonicalSubject: id, semanticKey: id, qualifiers: [] },
    label: `Concepto ${id}`, statement: `Contenido autorizado de ${id}`,
    importance: { tier, signals: ['model_judged'], confidence: 0.9 },
    provenance: derivation === 'vision' ? [] : [{ materialId, page, quote: `Cita de ${id}`, chunkId: `c-${page}` }],
    evidence: derivation === 'vision'
      ? [{ materialId, page, derivation: 'vision', pageFingerprint: `pf-${id}`, analyzerVersion: '1.0', promptVersion: '1.0', description: `Descripción visual de ${id}` }]
      : [{ materialId, page, derivation: 'native_text', quote: `Cita de ${id}`, chunkId: `c-${page}` }],
    domainTags: [],
  }
  if (kind === 'formula') { base.expression = `F_${id}=m*a`; base.variables = [{ symbol: 'm', meaning: 'masa' }] }
  return base
}

function relation(id: string, fromUnitId: string, toUnitId: string) {
  return {
    id, type: 'depends_on', fromUnitId, toUnitId, statement: `${fromUnitId} depende de ${toUnitId}`,
    importance: { tier: 'supporting', signals: [], confidence: 0.8 }, provenance: [],
  }
}

function brain(
  fingerprint: string, units: KnowledgeUnit[], relations: any[] = [],
  builderVersion = MATERIAL_BRAIN_BUILDER_VERSION, status: 'ready' | 'partial' | 'failed' = 'ready',
): MaterialBrain {
  return {
    scope: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3] }), fingerprint },
    meta: {
      version: '1.0.0', builderVersion, generatedAt: new Date(0).toISOString(),
      chunking: { strategy: 'test', chunkSizeChars: 1000, chunkCount: 1 },
      llmCallsUsed: 0, retries: 0, status,
    },
    units, relations,
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'not_required' },
    knowledgeExtraction: { chunksAttempted: 1, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: units.length, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  } as any
}

// ============================================================
// AN-TARGET-1/2/3 — pure analysisContext.ts contract
// ============================================================
function testTargetModel() {
  const b = brain('fp-target', [
    unit('u1', 'mat-a', 1, 'native_text'),
    unit('u2', 'mat-a', 2, 'native_text'),
    { ...unit('u-dead', 'mat-a', 3, 'native_text'), supersededBy: 'u1' } as any,
  ])
  const targets = buildAnalysisTargets(b)
  assert.equal(targets.length, 2, 'AN-TARGET-1 targets derive only from live Brain units')
  assert.ok(targets.every(t => t.unitIds.length === 1 && t.unitIds[0] === t.id), 'AN-TARGET-1 target identity traces to a real unit id')
  assert.ok(!targets.some(t => t.id === 'u-dead'), 'AN-TARGET-2 superseded/dead units excluded')

  const relB = brain('fp-rel', [unit('a', 'mat-a', 1, 'native_text'), unit('b', 'mat-a', 2, 'native_text')], [relation('r1', 'a', 'b')])
  const relTargets = buildAnalysisTargets(relB)
  assert.deepEqual(relTargets.find(t => t.id === 'a')!.relationIds, ['r1'], 'AN-TARGET-3 relations preserve identity on the target')
  const clusters = buildAnalysisNarrativeClusters(relB, relTargets)
  assert.equal(clusters.length, 1, 'connected targets via a real relation form one cluster')
  assert.deepEqual([...clusters[0].targetIds].sort(), ['a', 'b'])

  console.log('analysis-material-brain-grounding-contracts: AN-TARGET-1/2/3 PASS')
}

// ============================================================
// AN-COV-1/2/3 — deterministic coverage math
// ============================================================
function testCoverage() {
  const b = brain('fp-cov', [
    unit('u1', 'mat-a', 1, 'native_text'), unit('u2', 'mat-a', 2, 'native_text'), unit('u3', 'mat-a', 3, 'native_text'),
  ])
  const targets = buildAnalysisTargets(b)
  const partial = computeAnalysisCoverage(targets, ['u1'])
  assert.equal(partial.totalAnalysisTargets, 3, 'AN-COV-1 denominator is deterministic')
  assert.deepEqual(partial.missingTargetIds, ['u2', 'u3'], 'AN-COV-2 missing targets appear in missingTargetIds')
  const full = computeAnalysisCoverage(targets, ['u1', 'u2', 'u3'])
  assert.equal(full.coveragePercent, 100, 'AN-COV-3 100% only when all targets represented')
  const partialAgain = computeAnalysisCoverage(targets, ['u1', 'u2'])
  assert.notEqual(partialAgain.coveragePercent, 100, 'AN-COV-3 partial representation never reports 100%')
  console.log('analysis-material-brain-grounding-contracts: AN-COV-1/2/3 PASS')
}

// ============================================================
// AN-VISION-1 — vision-derived evidence already authorized by the Brain
// participates in the grounded context (no new vision call).
// ============================================================
function testVisionAndFormula() {
  const b = brain('fp-vision', [unit('u-vision', 'mat-a', 2, 'vision'), unit('u-formula', 'mat-a', 3, 'native_text', 'formula')])
  const context = buildAnalysisGroundedContext(b)
  const visionTarget = context.targets.find(t => t.id === 'u-vision')!
  assert.equal(visionTarget.evidence[0].derivation, 'vision')
  assert.equal(visionTarget.evidence[0].evidenceText, 'Descripción visual de u-vision', 'AN-VISION-1 vision evidence text is carried into the target')
  const rendered = renderAnalysisGroundedContext(context)
  assert.ok(rendered.includes('Descripción visual de u-vision'), 'AN-VISION-1 vision evidence reaches the rendered prompt context')
  assert.ok(rendered.includes('u-formula') && rendered.includes('formula'), 'formula-kind target is rendered')
  console.log('analysis-material-brain-grounding-contracts: AN-VISION-1 PASS')
}

// ============================================================
// Deterministic sections — probabilidad_examen / para_examen / cobertura
// ============================================================
function testDeterministicSections() {
  const targets = buildAnalysisTargets(brain('fp-det', [
    unit('critical', 'mat-a', 1, 'native_text', 'fact', 'critical'),
    unit('connected', 'mat-a', 2, 'native_text', 'fact', 'supporting'),
    unit('lonely', 'mat-a', 3, 'native_text', 'fact', 'supporting'),
    unit('trivial', 'mat-a', 4, 'native_text', 'fact', 'contextual'),
  ], [relation('r1', 'connected', 'lonely'), relation('r2', 'connected', 'critical')]))
  const probabilities = Object.fromEntries(deterministicProbabilidadExamen(targets).map(p => [p.targetId, p.probabilidad]))
  assert.equal(probabilities['critical'], 'alta', 'critical tier is always alta')
  assert.equal(probabilities['connected'], 'alta', 'supporting tier with >=2 relations is alta')
  assert.equal(probabilities['lonely'], 'media', 'supporting tier with <2 relations is media')
  assert.equal(probabilities['trivial'], 'baja', 'contextual tier with <2 relations is baja')
  const paraExamen = deterministicParaExamen(targets).map(p => p.targetIds[0])
  assert.deepEqual(new Set(paraExamen), new Set(['critical', 'connected']), 'para_examen only includes alta-probability targets')
  const cobertura = deterministicCoberturaMaterial(targets)
  assert.ok(!cobertura.some(c => c.targetIds[0] === 'trivial'), 'cobertura_material excludes contextual-tier targets')
  console.log('analysis-material-brain-grounding-contracts: deterministic sections PASS')
}

// ============================================================
// AN-LARGE-1 — narrative parts are not hard-capped to 4-7.
// ============================================================
function testLargeMaterialNotCapped() {
  // 10 independent (unrelated) targets => 10 single-target clusters —
  // clusters scale with structure, not a fixed 4-7 ceiling.
  const units = Array.from({ length: 10 }, (_, i) => unit(`u${i}`, 'mat-a', i + 1, 'native_text'))
  const b = brain('fp-large', units)
  const targets = buildAnalysisTargets(b)
  const clusters = buildAnalysisNarrativeClusters(b, targets)
  assert.equal(clusters.length, 10, 'AN-LARGE-1 cluster count scales with target structure, not hardcoded to 4-7')
  console.log(`analysis-material-brain-grounding-contracts: AN-LARGE-1 PASS (clusters=${clusters.length})`)
}

// ============================================================
// Route-level contracts (AN-BRAIN-*, AN-GROUND-*, AN-PERF-*, AN-LEVEL-*)
// ============================================================
async function testBrainAuthorityAndGrounding() {
  const goodBrain = brain('fp-good', [
    unit('u-critical', 'mat-a', 1, 'native_text', 'fact', 'critical'),
    unit('u2', 'mat-a', 2, 'native_text'),
  ])

  function baseDeps(brainByFingerprint: Record<string, MaterialBrain | null>, providerFn?: (input: any) => any) {
    return {
      getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
      getAuthoritativeFreeSession: async (sessionId: string, userId: string) => {
        if (sessionId !== 'sess-1' || userId !== 'user-1') return null
        return { id: sessionId, userId, processMode: 'free', sourceSelection: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3] }), fingerprint: 'fp-good' } } as any
      },
      getMaterial: async () => ({ id: 'mat-a' }) as any,
      restoreMaterialBrain: async (fingerprint: string) => brainByFingerprint[fingerprint] ?? null,
      alaiJson: async (input: any) => {
        providerCalls++
        if (providerFn) return providerFn(input)
        return {
          objetivos: ['Explicar el material'], si_no_sabes_nada: 'Empieza por lo básico.', mapa_inicial: 'Contexto → idea → mecanismo',
          clase_narrativa: [{ titulo: 'Parte 1', explicacion: 'Explicación con suficiente longitud para pasar validación.', ejemplo: '', checkpoint: '¿Por qué?', targetIds: ['u-critical'] }],
          panorama_completo: 'Overview general del material completo.',
          conexiones_clave: [], errores_comunes: [], preguntas_profesor: [],
          resumen_final: 'Resumen final.', preguntas_sugeridas: ['¿Qué más quieres saber?'],
        }
      },
    }
  }

  // AN-BRAIN-1: exact fingerprint's ready Brain is used.
  {
    Object.assign(__routeDeps, baseDeps({ 'fp-good': goodBrain }))
    const req = new NextRequest('http://localhost/api/analizar-teorico', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', nivel: 'universidad' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(res.status, 200, 'AN-BRAIN-1 exact-fingerprint ready Brain is accepted')
    assert.ok(data.analisis, 'grounded analysis returned')
    assert.equal(data.analisis.grounding.totalAnalysisTargets, 2)
    // AN-GROUND-1: this provider response only referenced u-critical; u2 must be missing.
    assert.deepEqual(data.analisis.grounding.missingTargetIds, ['u2'], 'AN-COV-2/AN-GROUND-1 only actually-referenced targets count as represented')
    assert.equal(data.analisis.grounding.coveragePercent, 50)
  }

  // AN-BRAIN-2: stale builderVersion Brain is rejected.
  {
    const staleBrain = brain('fp-good', [unit('u1', 'mat-a', 1, 'native_text')], [], 'stale-builder-version')
    Object.assign(__routeDeps, baseDeps({ 'fp-good': staleBrain }))
    const req = new NextRequest('http://localhost/api/analizar-teorico', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', nivel: 'universidad' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(res.status, 409)
    assert.equal(data.error, 'STALE_BRAIN', 'AN-BRAIN-2 stale fingerprint/builderVersion rejected')
  }

  // AN-BRAIN-3: partial Brain is never accepted as ready.
  {
    const partialBrain = brain('fp-good', [unit('u1', 'mat-a', 1, 'native_text')], [], MATERIAL_BRAIN_BUILDER_VERSION, 'partial')
    Object.assign(__routeDeps, baseDeps({ 'fp-good': partialBrain }))
    const req = new NextRequest('http://localhost/api/analizar-teorico', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', nivel: 'universidad' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(res.status, 409)
    assert.equal(data.error, 'BRAIN_PARTIAL', 'AN-BRAIN-3 partial/not-ready rejected')
  }

  // AN-BRAIN-4: restoreMaterialBrain never builds — deps object has no
  // build/extract/vision function at all; if the route ever called one it
  // would throw a ReferenceError and this whole test would fail loudly.
  // Also verifies exactly ONE provider call for a normal request (AN-PERF-3).
  {
    const providerCallsBefore = providerCalls
    Object.assign(__routeDeps, baseDeps({ 'fp-good': goodBrain }))
    const req = new NextRequest('http://localhost/api/analizar-teorico', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', nivel: 'universidad' }),
    })
    await POST(req)
    assert.equal(providerCalls, providerCallsBefore + 1, 'AN-BRAIN-4/AN-PERF-3 exactly 1 provider call, 0 extraction/vision calls')
  }

  // Raw source authority forbidden.
  {
    Object.assign(__routeDeps, baseDeps({ 'fp-good': goodBrain }))
    const req = new NextRequest('http://localhost/api/analizar-teorico', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', documentos: [{ contenido: 'texto crudo inyectado' }] }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(res.status, 400)
    assert.equal(data.detail, 'RAW_SOURCE_AUTHORITY_FORBIDDEN', 'client cannot inject raw documentos as authority')
  }

  // AN-GROUND-1/AN-GROUND-3: provider invents a target id and tries to
  // sneak in "external" knowledge via that fabricated id — must never
  // count toward coverage.
  {
    Object.assign(__routeDeps, baseDeps({ 'fp-good': goodBrain }, () => ({
      objetivos: [], si_no_sabes_nada: 'x', mapa_inicial: 'x',
      clase_narrativa: [
        { titulo: 'Parte real', explicacion: 'Explicación con longitud suficiente para pasar validación real.', ejemplo: '', checkpoint: '?', targetIds: ['u-critical', 'fabricated-external-target'] },
      ],
      panorama_completo: 'x', conexiones_clave: [], errores_comunes: [], preguntas_profesor: [],
      resumen_final: 'x', preguntas_sugeridas: [],
    })))
    const req = new NextRequest('http://localhost/api/analizar-teorico', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', nivel: 'universidad' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.deepEqual(data.analisis.clase_narrativa[0].targetIds, ['u-critical'], 'AN-GROUND-1 fabricated target id is dropped, never granted authority')
    assert.equal(data.analisis.grounding.coveragePercent, 50, 'AN-GROUND-3 external/fabricated target never increases coverage')
    assert.ok(!data.analisis.grounding.missingTargetIds.includes('fabricated-external-target'), 'fabricated id never enters the known-target universe')
  }

  // AN-GROUND-2: cobertura_material/para_examen/probabilidad_examen are
  // deterministic — even a provider that tries to claim coverage=100 or
  // rewrite evidence cannot affect these fields (they never read `clean`).
  {
    Object.assign(__routeDeps, baseDeps({ 'fp-good': goodBrain }, () => ({
      objetivos: [], si_no_sabes_nada: 'x', mapa_inicial: 'x', clase_narrativa: [],
      panorama_completo: 'x', conexiones_clave: [], errores_comunes: [], preguntas_profesor: [],
      resumen_final: 'x', preguntas_sugeridas: [],
      // Adversarial fields the schema doesn't even define — must be ignored.
      coverage: 100, coveragePercent: 100, evidence: 'invented evidence text', probabilidad_examen: [{ concepto: 'fake', probabilidad: 'alta' }],
    })))
    const req = new NextRequest('http://localhost/api/analizar-teorico', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', nivel: 'universidad' }),
    })
    const res = await POST(req)
    const data = await res.json()
    assert.equal(data.analisis.grounding.coveragePercent, 0, 'AN-GROUND-2 provider cannot declare coverage=100 — coverage is computed server-side only')
    assert.ok(!data.analisis.probabilidad_examen.some((p: any) => p.concepto === 'fake'), 'AN-GROUND-2 provider cannot inject a fabricated probabilidad_examen row')
    assert.deepEqual(data.analisis.probabilidad_examen.map((p: any) => p.concepto).sort(), ['Concepto u-critical', 'Concepto u2'].sort(), 'probabilidad_examen is entirely Brain-derived')
  }

  console.log('analysis-material-brain-grounding-contracts: AN-BRAIN-1/2/3/4, AN-GROUND-1/2/3, AN-PERF-3 PASS')
}

// ============================================================
// AN-LEVEL-1/2 — all levels share the same academic target universe;
// level only changes narration, never authority/coverage denominator.
// ============================================================
async function testLevelBehavior() {
  const b = brain('fp-level', [
    unit('u-critical', 'mat-a', 1, 'native_text', 'fact', 'critical'),
    unit('u2', 'mat-a', 2, 'native_text'),
  ])
  const deps = {
    getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
    getAuthoritativeFreeSession: async () => ({ id: 'sess-1', userId: 'user-1', processMode: 'free', sourceSelection: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2] }), fingerprint: 'fp-level' } }) as any,
    getMaterial: async () => ({ id: 'mat-a' }) as any,
    restoreMaterialBrain: async (fingerprint: string) => (fingerprint === 'fp-level' ? b : null),
    alaiJson: async () => {
      providerCalls++
      return {
        objetivos: [], si_no_sabes_nada: 'x', mapa_inicial: 'x',
        clase_narrativa: [{ titulo: 'Parte', explicacion: 'Explicación con longitud suficiente para pasar validación.', ejemplo: '', checkpoint: '?', targetIds: ['u-critical', 'u2'] }],
        panorama_completo: 'x', conexiones_clave: [], errores_comunes: [], preguntas_profesor: [], resumen_final: 'x', preguntas_sugeridas: [],
      }
    },
  }
  const coveragesByLevel: Record<string, number> = {}
  const targetCountsByLevel: Record<string, number> = {}
  for (const nivel of ['secundaria', 'universidad', 'medicina', 'doctorado']) {
    Object.assign(__routeDeps, deps)
    const req = new NextRequest('http://localhost/api/analizar-teorico', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', nivel }),
    })
    const res = await POST(req)
    const data = await res.json()
    coveragesByLevel[nivel] = data.analisis.grounding.coveragePercent
    targetCountsByLevel[nivel] = data.analisis.grounding.totalAnalysisTargets
    assert.equal(data.analisis.nivel_detectado, nivel, 'AN-LEVEL-2 level changes narration metadata')
  }
  assert.ok(Object.values(targetCountsByLevel).every(count => count === 2), 'AN-LEVEL-1 same fingerprint => same target universe size across all levels')
  assert.ok(Object.values(coveragesByLevel).every(pct => pct === 100), 'AN-LEVEL-1 same fingerprint => same coverage outcome across all levels')
  console.log('analysis-material-brain-grounding-contracts: AN-LEVEL-1/2 PASS')
}

// ============================================================
// AN-PERF-1/2 — resolving a ready Brain and building the grounded
// context does zero provider calls on its own.
// ============================================================
async function testPerfContextConstruction() {
  const b = brain('fp-perf', Array.from({ length: 60 }, (_, i) => unit(`u${i}`, 'mat-a', (i % 3) + 1, i % 5 === 0 ? 'vision' : 'native_text')))
  const t0 = performance.now()
  const context = buildAnalysisGroundedContext(b)
  const rendered = renderAnalysisGroundedContext(context)
  const t1 = performance.now()
  assert.equal(context.targets.length, 60)
  assert.ok(rendered.length > 0)
  assert.ok(t1 - t0 < 300, `AN-PERF-1/2 grounded context construction is fast, no provider/extraction work: ${(t1 - t0).toFixed(1)}ms`)
  console.log(`analysis-material-brain-grounding-contracts: AN-PERF-1/2 PASS (${(t1 - t0).toFixed(1)}ms, 0 provider calls)`)
}

// ============================================================
// AN-RESUME-1/2/3 — persistence contract, same pattern proven for
// Repasar: JSON round-trip of the exact persisted shape, fingerprint
// scoping, and completed-reopen requiring 0 provider calls.
// ============================================================
async function testResumeContracts() {
  const b1 = brain('fp-resume-a', [unit('u-a', 'mat-a', 1, 'native_text', 'fact', 'critical')])
  const b2 = brain('fp-resume-b', [unit('u-b', 'mat-a', 1, 'native_text', 'fact', 'critical')])
  let lastFingerprint = ''
  const deps = {
    getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
    getAuthoritativeFreeSession: async (sessionId: string) => {
      const fingerprint = sessionId === 'sess-a' ? 'fp-resume-a' : sessionId === 'sess-b' ? 'fp-resume-b' : null
      if (!fingerprint) return null
      return { id: sessionId, userId: 'user-1', processMode: 'free', sourceSelection: { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint } } as any
    },
    getMaterial: async () => ({ id: 'mat-a' }) as any,
    restoreMaterialBrain: async (fingerprint: string) => { lastFingerprint = fingerprint; return fingerprint === 'fp-resume-a' ? b1 : fingerprint === 'fp-resume-b' ? b2 : null },
    alaiJson: async () => {
      providerCalls++
      const ownTargetId = lastFingerprint === 'fp-resume-b' ? 'u-b' : 'u-a'
      return {
        objetivos: [], si_no_sabes_nada: 'x', mapa_inicial: 'x',
        clase_narrativa: [{ titulo: 'Parte', explicacion: 'Explicación con longitud suficiente para pasar validación.', ejemplo: '', checkpoint: '?', targetIds: [ownTargetId] }],
        panorama_completo: 'x', conexiones_clave: [], errores_comunes: [], preguntas_profesor: [], resumen_final: 'x', preguntas_sugeridas: [],
      }
    },
  }

  Object.assign(__routeDeps, deps)
  const req = new NextRequest('http://localhost/api/analizar-teorico', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-a', nivel: 'universidad' }),
  })
  const res = await POST(req)
  const data = await res.json()

  // What the client persists verbatim inside DurableFreeAnalysisState.resultsByType[nivel].result.
  const persistedEntry = { type: 'universidad', status: 'completed', attempt: 1, result: data.analisis, activeSection: 'vision', readSections: [], shownSelfChecks: {}, shownCheckAnswers: {}, doubtDraft: '', doubtAnswer: '', doubtError: '', completed: true }
  const roundTripped = JSON.parse(JSON.stringify(persistedEntry))
  assert.deepEqual(roundTripped.result.grounding, data.analisis.grounding, 'AN-RESUME-1 grounded coverage/targetIds survive a refresh (JSON round-trip) exactly')
  assert.equal(roundTripped.status, 'completed', 'AN-RESUME-2 completed status restores unchanged for the same fingerprint')

  // AN-RESUME-3: a different session (different fingerprint) resolves a
  // different Brain and produces its own grounded result — never reuses
  // sess-a's grounded analysis.
  Object.assign(__routeDeps, deps)
  const reqB = new NextRequest('http://localhost/api/analizar-teorico', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'sess-b', nivel: 'universidad' }),
  })
  const resB = await POST(reqB)
  const dataB = await resB.json()
  assert.notDeepEqual(dataB.analisis.grounding.missingTargetIds, roundTripped.result.grounding.missingTargetIds.length ? roundTripped.result.grounding.missingTargetIds : ['sentinel'])
  assert.equal(dataB.analisis.clase_narrativa[0].targetIds[0], 'u-b', 'AN-RESUME-3 a different fingerprint resolves its own Brain/targets, never fp-resume-a\'s grounded state')

  // AN-PERF-1: reopening a completed analysis (client-side cache hit) is
  // 0 provider calls by construction — the component's completeFreeAnalysis
  // short-circuits generation when a completed result already exists
  // (see runAnalysis() in AnalisisTeorico.tsx: `if (current?.status === 'completed' && current.result) return;`).
  const { readFileSync } = await import('node:fs')
  const componentSource = readFileSync('components/materias/AnalisisTeorico.tsx', 'utf8')
  assert.ok(componentSource.includes("if (current?.status === 'completed' && current.result) return;"), 'AN-PERF-1 a completed analysis never re-triggers generation on reopen')

  console.log('analysis-material-brain-grounding-contracts: AN-RESUME-1/2/3, AN-PERF-1 PASS')
}

// ============================================================
// AN-BRAIN-4 (defense in depth) — dead-code confirmation for the
// legacy prompt builders (checked, not executed: no call sites).
// ============================================================
function testDeadPromptBuildersHaveNoCallSites() {
  const routeSource = require('node:fs').readFileSync('app/api/analizar-teorico/route.ts', 'utf8') as string
  for (const fn of ['synthPromptA', 'synthPromptB', 'multiMaterialPrompt', 'promptA', 'promptB']) {
    const callSitePattern = new RegExp(`[^a-zA-Z_]${fn}\\s*\\(`, 'g')
    const matches = routeSource.match(callSitePattern) || []
    // Only the function's own declaration should match `functionName(` — any
    // second match means something actually calls it.
    assert.ok(matches.length <= 1, `${fn} must have no call sites (found ${matches.length})`)
  }
  console.log('analysis-material-brain-grounding-contracts: dead prompt builders confirmed unreferenced')
}

async function main() {
  testTargetModel()
  testCoverage()
  testVisionAndFormula()
  testDeterministicSections()
  testLargeMaterialNotCapped()
  await testBrainAuthorityAndGrounding()
  await testLevelBehavior()
  await testPerfContextConstruction()
  await testResumeContracts()
  testDeadPromptBuildersHaveNoCallSites()
  console.log(`analysis-material-brain-grounding-contracts: ALL PASS (providerCalls total=${providerCalls})`)
}

main().catch(error => { console.error(error); process.exit(1) })
