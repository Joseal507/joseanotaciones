import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  buildAnalysisEnjoyerContext, computeAnalysisCoverage, deterministicCoberturaMaterial,
  deterministicParaExamen, deterministicProbabilidadExamen, deterministicYaPuedesExplicar,
} from '../../lib/materialBrain/analysisEnjoyerContext'
import { POST, __routeDeps } from '../../app/api/analizar-teorico/route'

const selection = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3] }), fingerprint: 'fp-an' }

const baseItems = [
  { id: 'crit1', kind: 'concept', name: 'Concepto crítico', content: 'Definición autorizada del concepto crítico', importance: 90, difficulty: 'medium', topicId: 't1', materialId: 'mat-a', pages: [1], sourceSpans: [{ page: 1, quote: 'q1' }] },
  { id: 'supp1', kind: 'fact', name: 'Dato de apoyo', content: 'Un dato de apoyo relacionado con el concepto crítico', importance: 60, difficulty: 'medium', topicId: 't1', materialId: 'mat-a', pages: [1], sourceSpans: [{ page: 1, quote: 'q2' }] },
  { id: 'ctx1', kind: 'example', name: 'Ejemplo contextual', content: 'Un ejemplo contextual aislado', importance: 20, difficulty: 'basic', topicId: 't2', materialId: 'mat-a', pages: [2], sourceSpans: [{ page: 2, quote: 'q3' }] },
]

function payload(items = baseItems, relations: any[] = []) {
  return {
    sourceSelectionFingerprint: 'fp-an', materialIds: ['mat-a'], selectedPages: { 'mat-a': [1, 2, 3] },
    topicsIndex: [{ id: 't1', title: 'Tema uno' }, { id: 't2', title: 'Tema dos' }],
    globalOrderedAnalysis: items, uniqueConceptsIndex: [], relations,
  }
}

// ============================================================
// A/G/H/I/J — pure adapter contracts (no route/HTTP involved)
// ============================================================
function testAdapterContracts() {
  const context = buildAnalysisEnjoyerContext(payload(), selection)

  // A: exact Enjoyer is the academic authority.
  assert.equal(context.fingerprint, 'fp-an')
  assert.equal(context.targets.length, 3, 'A: every surviving source item becomes a target — no strategy-eligibility filter (unlike Truquitos)')
  assert.throws(() => buildAnalysisEnjoyerContext({ ...payload(), sourceSelectionFingerprint: 'wrong' }, selection), /SOURCE_SELECTION_MISMATCH/)

  // G: canonical target IDs/provenance survive the adapter untouched.
  const crit = context.targets.find(t => t.sourceItemId === 'crit1')!
  assert.equal(crit.id, 'analysis_target:crit1')
  assert.equal(crit.materialId, 'mat-a')
  assert.deepEqual(crit.pages, [1])
  assert.equal(crit.importanceTier, 'critical')

  // H: absent relations → topic-based grouping is the honest fallback —
  // t1's two targets cluster together, t2's one target is its own cluster.
  assert.equal(context.relations.length, 0)
  const clusterForCrit = context.clusters.find(c => c.targetIds.includes(crit.id))!
  const supp = context.targets.find(t => t.sourceItemId === 'supp1')!
  assert.ok(clusterForCrit.targetIds.includes(supp.id), 'H: same-topic targets cluster together with no relations present')
  const ctxTarget = context.targets.find(t => t.sourceItemId === 'ctx1')!
  const clusterForCtx = context.clusters.find(c => c.targetIds.includes(ctxTarget.id))!
  assert.notEqual(clusterForCrit.id, clusterForCtx.id, 'H: a different topic is a different cluster — nothing fabricated across topics')

  // I: explicit relations, when genuinely present, are used for clustering
  // regardless of their `type` string — no taxonomy assumption.
  const withRelation = buildAnalysisEnjoyerContext(payload(baseItems, [
    { id: 'r1', type: 'some_unrecognized_label', fromSourceItemId: 'ctx1', toSourceItemId: 'crit1' },
  ]), selection)
  const mergedCluster = withRelation.clusters.find(c => c.targetIds.length === 3)
  assert.ok(mergedCluster, 'I: an explicit relation (any type string) merges targets across topics into one cluster')

  // J: deterministic derived fields remain deterministic and sensible
  // against Enjoyer importance/difficulty/kind fields.
  const cobertura = deterministicCoberturaMaterial(context.targets)
  assert.equal(cobertura.length, 2, 'J: contextual-tier target excluded from cobertura_material')
  const paraExamen = deterministicParaExamen(context.targets)
  assert.ok(paraExamen.some(item => item.punto === 'Concepto crítico'), 'J: critical target appears in para_examen')
  const probabilidad = deterministicProbabilidadExamen(context.targets)
  assert.equal(probabilidad.length, 3, 'J: one deterministic row per target')
  const yaPuedesExplicar = deterministicYaPuedesExplicar(context.targets)
  assert.ok(yaPuedesExplicar.includes('Concepto crítico'))

  const coverage = computeAnalysisCoverage(context.targets, [crit.id])
  assert.equal(coverage.totalAnalysisTargets, 3)
  assert.equal(coverage.representedAnalysisTargets, 1)

  console.log('analysis-enjoyer-migration-contracts: A/G/H/I/J (adapter) PASS')
}

// ============================================================
// B/C/D/E/F/K/L/M/N/O — route-level contracts
// ============================================================
async function testRouteContracts() {
  const store = new Map<string, any>()
  let alaiJsonCalls = 0
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
    getAuthoritativeFreeSession: async () => ({ id: 'sess-1', userId: 'user-1', processMode: 'free', sourceSelection: selection }) as any,
    getMaterial: async () => ({ id: 'mat-a', nombre: 'Material A' }) as any,
    lookupStudyalMaterialEnjoyer: async (fingerprint: string) => store.get(fingerprint) ?? null,
    materialEnjoyerStore: {} as any,
    analysisArtifactStore: {
      _map: new Map<string, any>(),
      async get(identity: string) { return this._map.get(identity) ?? null },
      async set(identity: string, artifact: any) { this._map.set(identity, artifact) },
    } as any,
    alaiJson: async () => {
      alaiJsonCalls++
      return {
        objetivos: ['Entender el concepto crítico'],
        si_no_sabes_nada: 'Explicación inicial.',
        mapa_inicial: 'Mapa inicial.',
        clase_narrativa: [{ titulo: 'Clase 1', explicacion: 'Explicación pedagógica suficientemente larga.', ejemplo: '', checkpoint: '¿Por qué importa?', targetIds: ['analysis_target:crit1', 'analysis_target:supp1'] }],
        panorama_completo: 'Panorama.',
        conexiones_clave: [], errores_comunes: [], preguntas_profesor: [],
        resumen_final: 'Resumen.', preguntas_sugeridas: [],
      } as any
    },
  })

  async function post(body: unknown) {
    const response = await POST(new NextRequest('http://localhost/api/analizar-teorico', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
    return { response, data: await response.json() }
  }

  // B: missing Enjoyer returns a retryable readiness failure.
  const missing = await post({ sessionId: 'sess-1', nivel: 'universidad' })
  assert.equal(missing.response.status, 409)
  assert.equal(missing.data.error, 'ENJOYER_NOT_READY')
  assert.equal(alaiJsonCalls, 0, 'F: no provider call attempted when Enjoyer is missing')

  // C: __routeDeps never exposes restoreMaterialBrain.
  assert.ok(!('restoreMaterialBrain' in __routeDeps), 'C: zero restoreMaterialBrain in the active route deps')

  // D/N: zero KnowledgeUnit / Material Brain / legacy-extraction entry from the Free branch.
  const routeSource = fs.readFileSync('app/api/analizar-teorico/route.ts', 'utf8')
  assert.ok(!routeSource.includes('KnowledgeUnit'), 'D: no KnowledgeUnit dependency in the active route')
  assert.ok(!routeSource.includes('restoreMaterialBrain') && !routeSource.includes('WorkerMaterialResultStore'),
    'D: no Brain restore path in the active route')
  assert.ok(routeSource.includes('lookupStudyalMaterialEnjoyer'), 'active route uses the Enjoyer lookup')
  assert.ok(!routeSource.includes('getOrCreateStudyalMaterialEnjoyer'), 'F: route never builds/regenerates the Enjoyer, lookup-only')
  // N: the Free sessionId branch is checked BEFORE the legacy documentos
  // pipeline and returns early — confirmed structurally by successfully
  // completing a full Free request below without ever touching `documentos`.

  // E: raw source authority keys are explicitly forbidden alongside sessionId.
  const rawBypass = await post({ sessionId: 'sess-1', documentos: ['forbidden'] });
  assert.equal(rawBypass.response.status, 400)
  assert.equal(rawBypass.data.error, 'INVALID_CONFIG')
  const rawBypass2 = await post({ sessionId: 'sess-1', materialText: 'forbidden raw text' })
  assert.equal(rawBypass2.response.status, 400)
  assert.equal(rawBypass2.data.error, 'INVALID_CONFIG')

  store.set('fp-an', payload())

  // K/F: first generation — exactly 1 bounded provider call, canonical
  // target ids preserved, deterministic fields present.
  const started = await post({ sessionId: 'sess-1', nivel: 'universidad', materia: 'X', tema: 'Y' })
  assert.equal(started.response.status, 200)
  assert.equal(alaiJsonCalls, 1, 'K: exactly one bounded provider call for first generation')
  const analisis = started.data.analisis
  assert.equal(analisis.grounding.authorityType, 'studyal_material_enjoyer')
  assert.equal(analisis.grounding.fingerprint, 'fp-an')
  assert.equal(analisis.clase_narrativa[0].targetIds.join(','), 'analysis_target:crit1,analysis_target:supp1')
  assert.ok(analisis.cobertura_material.length >= 1, 'J: deterministic cobertura_material present')
  assert.ok(Array.isArray(analisis.para_examen))
  assert.ok(Array.isArray(analisis.probabilidad_examen))
  assert.ok(Array.isArray(analisis.ya_puedes_explicar))

  // M: exact selection/fingerprint isolation — a different fingerprint
  // with no persisted Enjoyer is still ENJOYER_NOT_READY, never served
  // from another selection's cache.
  const otherSelection = { ...buildSourceSelectionSnapshot(['mat-b'], { 'mat-b': [1] }), fingerprint: 'fp-other' }
  Object.assign(__routeDeps, { getAuthoritativeFreeSession: async () => ({ id: 'sess-2', userId: 'user-1', processMode: 'free', sourceSelection: otherSelection }) as any })
  const otherMissing = await post({ sessionId: 'sess-2', nivel: 'universidad' })
  assert.equal(otherMissing.response.status, 409)
  assert.equal(otherMissing.data.error, 'ENJOYER_NOT_READY', 'M: a different fingerprint never reuses another selection\'s persisted result')

  // O: blueprint_analysis (Adaptive) path remains structurally untouched
  // by this migration — checked BEFORE the Free sessionId/Enjoyer branch
  // in POST(), and never calls __routeDeps.alaiJson (it uses the
  // separate, unmocked safeAlaiJson/`alai()` legacy path directly) — so
  // it is never exercised here (no real provider calls), only confirmed
  // structurally from source order.
  const postSource = routeSource.slice(routeSource.indexOf('export async function POST'))
  const blueprintIdx = postSource.indexOf("mode === 'blueprint_analysis'")
  const sessionIdx = postSource.indexOf('handleGroundedAnalysisRequest')
  assert.ok(blueprintIdx > -1 && sessionIdx > -1 && blueprintIdx < sessionIdx,
    'O: blueprint_analysis branch is checked before the Free Enjoyer branch inside POST(), both remain distinct code paths')
  // handleGroundedAnalysisRequest (the Free Enjoyer branch's handler)
  // calls safeGroundedAlaiJson, never the legacy safeAlaiJson used by
  // blueprint_analysis — confirmed directly at the call site.
  assert.ok(routeSource.includes('safeGroundedAlaiJson(\n    analysisUserPrompt'), 'O: Free branch uses the bounded safeGroundedAlaiJson, not the legacy pipeline')

  console.log('analysis-enjoyer-migration-contracts: B/C/D/E/F/K/M/N/O (route) PASS')
}

async function main() {
  testAdapterContracts()
  await testRouteContracts()
  console.log('analysis-enjoyer-migration-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
