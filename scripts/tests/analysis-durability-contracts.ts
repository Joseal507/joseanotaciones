import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { classifyJsonParseFailure } from '../../lib/alai'
import { analysisArtifactIdentity, ANALYSIS_ARTIFACT_SCHEMA_VERSION } from '../../lib/materialBrain/analysisArtifactStore'
import { POST, __routeDeps } from '../../app/api/analizar-teorico/route'

// ============================================================
// ANALISIS_DURABILITY: server-side persistence for the generated
// Análisis artifact (see lib/materialBrain/analysisArtifactStore.ts).
// Identity = sha256(userId + sourceSelectionFingerprint + nivel), all
// three server-resolved (session, authoritative Enjoyer fingerprint,
// validated nivel enum) — never client-supplied. Reuses the exact
// getMaterialResult/saveMaterialResult primitives every other artifact
// store in this codebase already uses (repasoArtifactStore.ts,
// examGenerationStore.ts, materialEnjoyer.ts itself).
// ============================================================

const selectionA = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1] }), fingerprint: 'fp-durable-a' }
const selectionB = { ...buildSourceSelectionSnapshot(['mat-b'], { 'mat-b': [1] }), fingerprint: 'fp-durable-b' }

function enjoyerPayload(materialId: string, fingerprint: string, pages: number[] = [1]) {
  return {
    sourceSelectionFingerprint: fingerprint, materialIds: [materialId], selectedPages: { [materialId]: pages },
    topicsIndex: [{ id: 't1', title: 'Tema uno' }],
    globalOrderedAnalysis: [
      { id: 'crit1', kind: 'concept', name: 'Concepto crítico', content: 'Definición autorizada', importance: 90, difficulty: 'medium', topicId: 't1', materialId, pages: [1], sourceSpans: [{ page: 1, quote: 'q1' }] },
    ],
    uniqueConceptsIndex: [], relations: [],
  }
}

function validAlaiPayload(tag = 'v1') {
  return {
    objetivos: [`Entender el concepto crítico (${tag})`],
    si_no_sabes_nada: 'Explicación inicial.',
    mapa_inicial: 'Mapa inicial.',
    clase_narrativa: [{ titulo: `Clase ${tag}`, explicacion: 'Explicación pedagógica suficientemente larga.', ejemplo: '', checkpoint: '¿Por qué importa?', targetIds: ['analysis_target:crit1'] }],
    panorama_completo: 'Panorama.',
    conexiones_clave: [], errores_comunes: [], preguntas_profesor: [],
    resumen_final: 'Resumen.', preguntas_sugeridas: [],
  }
}

function emptySchemaInvalidPayload() {
  return {
    objetivos: [], si_no_sabes_nada: '', mapa_inicial: '',
    clase_narrativa: [], // O: no narrated clusters -> schema-invalid, must not persist
    panorama_completo: '', conexiones_clave: [], errores_comunes: [], preguntas_profesor: [],
    resumen_final: '', preguntas_sugeridas: [],
  }
}

interface Harness {
  enjoyers: Map<string, any>
  artifacts: Map<string, any>
  sessions: Map<string, { id: string; userId: string; processMode: 'free'; sourceSelection: any }>
  alaiJsonCalls: number
  alaiJsonImpl: () => Promise<any>
}

function newHarness(): Harness {
  const h: Harness = {
    enjoyers: new Map(),
    artifacts: new Map(),
    sessions: new Map(),
    alaiJsonCalls: 0,
    alaiJsonImpl: async () => validAlaiPayload(),
  }
  return h
}

function wire(h: Harness) {
  Object.assign(__routeDeps, {
    getServerSession: async () => ({ user: { id: 'user-1' } }) as any,
    getAuthoritativeFreeSession: async (sessionId: string) => h.sessions.get(sessionId) ?? null,
    getMaterial: async () => ({ id: 'mat-a', nombre: 'Material A' }) as any,
    lookupStudyalMaterialEnjoyer: async (fingerprint: string) => h.enjoyers.get(fingerprint) ?? null,
    materialEnjoyerStore: {} as any,
    analysisArtifactStore: {
      get: async (identity: string) => h.artifacts.get(identity) ?? null,
      set: async (identity: string, artifact: any) => { h.artifacts.set(identity, artifact) },
    } as any,
    alaiJson: async () => { h.alaiJsonCalls++; return h.alaiJsonImpl() },
  })
}

async function post(body: unknown, userId = 'user-1') {
  Object.assign(__routeDeps, { getServerSession: async () => ({ user: { id: userId } }) as any })
  const response = await POST(new NextRequest('http://localhost/api/analizar-teorico', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  return { response, data: await response.json() }
}

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => { await fn(); console.log(`  ✅ ${name}`) })()
}

async function main() {
  // ── A/B/C/D/E/F: MISS -> generate -> persist -> HIT (0 provider calls),
  // localStorage-independent, survives a simulated "reopen" (a fresh
  // request object hitting the same server-side store).
  {
    const h = newHarness()
    h.enjoyers.set('fp-durable-a', enjoyerPayload('mat-a', 'fp-durable-a'))
    h.sessions.set('sess-a', { id: 'sess-a', userId: 'user-1', processMode: 'free', sourceSelection: selectionA })
    wire(h)

    await test('A. first exact artifact MISS generates exactly once', async () => {
      const { response } = await post({ sessionId: 'sess-a', nivel: 'universidad' })
      assert.equal(response.status, 200)
      assert.equal(h.alaiJsonCalls, 1)
    })

    await test('B. successful result persists a durable artifact', () => {
      assert.equal(h.artifacts.size, 1)
    })

    let firstAnalisis: any
    await test('C/D. second exact request restores the persisted artifact with 0 new provider calls', async () => {
      const before = h.alaiJsonCalls
      const { response, data } = await post({ sessionId: 'sess-a', nivel: 'universidad' })
      assert.equal(response.status, 200)
      assert.equal(h.alaiJsonCalls, before, 'D: exactly 0 new provider calls on a persisted HIT')
      firstAnalisis = data.analisis
    })

    await test('E. localStorage absence never forces regeneration — the server request carries no cache/local-content field at all', async () => {
      const before = h.alaiJsonCalls
      // The request body below is the SAME minimal shape a fresh browser
      // with empty localStorage would send — no cached analysis, no
      // client-side result of any kind is read by the server route.
      const { response } = await post({ sessionId: 'sess-a', nivel: 'universidad' })
      assert.equal(response.status, 200)
      assert.equal(h.alaiJsonCalls, before)
    })

    await test('F. exact artifact survives a simulated reopen (independent request object, same server store)', async () => {
      const before = h.alaiJsonCalls
      const { data } = await post({ sessionId: 'sess-a', nivel: 'universidad' })
      assert.equal(h.alaiJsonCalls, before)
      assert.deepEqual(data.analisis, firstAnalisis, 'P: restored payload is byte-identical to the originally generated one')
    })
  }

  // ── G/H: per-nivel isolation, and returning to a prior nivel restores it.
  {
    const h = newHarness()
    h.enjoyers.set('fp-durable-a', enjoyerPayload('mat-a', 'fp-durable-a'))
    h.sessions.set('sess-a', { id: 'sess-a', userId: 'user-1', processMode: 'free', sourceSelection: selectionA })
    wire(h)

    const uni = await post({ sessionId: 'sess-a', nivel: 'universidad' })
    assert.equal(h.alaiJsonCalls, 1)

    await test('G. a never-generated nivel is its own MISS -> exactly one new generation', async () => {
      const { response } = await post({ sessionId: 'sess-a', nivel: 'secundaria' })
      assert.equal(response.status, 200)
      assert.equal(h.alaiJsonCalls, 2)
    })

    await test('H. switching back to the prior nivel restores its exact artifact with 0 new provider calls', async () => {
      const before = h.alaiJsonCalls
      const { data } = await post({ sessionId: 'sess-a', nivel: 'universidad' })
      assert.equal(h.alaiJsonCalls, before)
      assert.deepEqual(data.analisis, uni.data.analisis)
    })
  }

  // ── I: different fingerprint cannot reuse another selection's artifact.
  {
    const h = newHarness()
    h.enjoyers.set('fp-durable-a', enjoyerPayload('mat-a', 'fp-durable-a'))
    h.enjoyers.set('fp-durable-b', enjoyerPayload('mat-b', 'fp-durable-b'))
    h.sessions.set('sess-a', { id: 'sess-a', userId: 'user-1', processMode: 'free', sourceSelection: selectionA })
    h.sessions.set('sess-b', { id: 'sess-b', userId: 'user-1', processMode: 'free', sourceSelection: selectionB })
    wire(h)

    await post({ sessionId: 'sess-a', nivel: 'universidad' })
    await test('I. a different fingerprint (selection B) generates its OWN artifact, never selection A\'s', async () => {
      const before = h.alaiJsonCalls
      const { response, data } = await post({ sessionId: 'sess-b', nivel: 'universidad' })
      assert.equal(response.status, 200)
      assert.equal(h.alaiJsonCalls, before + 1, 'a different fingerprint is always a MISS against A\'s artifact')
      assert.notEqual(data.analisis.grounding.fingerprint, 'fp-durable-a')
      assert.equal(data.analisis.grounding.fingerprint, 'fp-durable-b')
    })
  }

  // ── J: different authenticated user cannot read another user's artifact.
  {
    const h = newHarness()
    h.enjoyers.set('fp-durable-a', enjoyerPayload('mat-a', 'fp-durable-a'))
    h.sessions.set('sess-a', { id: 'sess-a', userId: 'user-1', processMode: 'free', sourceSelection: selectionA })
    wire(h)
    // getAuthoritativeFreeSession in this mock ignores the userId argument
    // (as the real one validates it internally) — the durability
    // boundary under test here is purely the artifact identity, which is
    // computed from the AUTHENTICATED session's userId (passed to POST's
    // `post()` helper), never from anything the client can forge in the body.
    await post({ sessionId: 'sess-a', nivel: 'universidad' }, 'user-1')
    await test('J. a different authenticated user id can never restore user-1\'s persisted artifact', async () => {
      const before = h.alaiJsonCalls
      const { response, data } = await post({ sessionId: 'sess-a', nivel: 'universidad' }, 'user-2')
      assert.equal(response.status, 200)
      assert.equal(h.alaiJsonCalls, before + 1, 'user-2 must MISS and generate its own artifact — never inherit user-1\'s')
      // Direct identity-level proof, independent of the mock's session shape:
      const idUser1 = analysisArtifactIdentity('user-1', 'fp-durable-a', 'universidad')
      const idUser2 = analysisArtifactIdentity('user-2', 'fp-durable-a', 'universidad')
      assert.notEqual(idUser1, idUser2)
    })
  }

  // ── K/L: forged client authority cannot select or force generation.
  {
    const h = newHarness()
    h.enjoyers.set('fp-durable-a', enjoyerPayload('mat-a', 'fp-durable-a'))
    h.sessions.set('sess-a', { id: 'sess-a', userId: 'user-1', processMode: 'free', sourceSelection: selectionA })
    wire(h)
    await post({ sessionId: 'sess-a', nivel: 'universidad' })

    await test('K. a forged client-supplied fingerprint/materialIds field in the body cannot redirect artifact identity', async () => {
      const before = h.alaiJsonCalls
      const { response, data } = await post({
        sessionId: 'sess-a', nivel: 'universidad',
        // Forged authority claims — the route must never read these for
        // identity/content; only the server-resolved session/Enjoyer count.
        sourceSelectionFingerprint: 'evil-fingerprint', materialIds: ['evil-material'], fingerprint: 'evil-fingerprint',
      })
      assert.equal(response.status, 200)
      assert.equal(h.alaiJsonCalls, before, 'forged fields must not cause a spurious MISS/regeneration')
      assert.equal(data.analisis.grounding.fingerprint, 'fp-durable-a', 'the real server-resolved fingerprint always wins')
    })

    await test('L. missing Enjoyer never generates from arbitrary client content, regardless of nivel/session shape', async () => {
      const before = h.alaiJsonCalls
      h.sessions.set('sess-no-enjoyer', { id: 'sess-no-enjoyer', userId: 'user-1', processMode: 'free', sourceSelection: { ...buildSourceSelectionSnapshot(['mat-z'], { 'mat-z': [1] }), fingerprint: 'fp-no-enjoyer' } })
      const { response, data } = await post({ sessionId: 'sess-no-enjoyer', nivel: 'universidad' })
      assert.equal(response.status, 409)
      assert.equal(data.error, 'ENJOYER_NOT_READY')
      assert.equal(h.alaiJsonCalls, before, '0 provider calls when the Enjoyer authority itself is missing')
    })
  }

  // ── M/N/O: failure semantics — nothing is ever persisted on failure.
  {
    const h = newHarness()
    h.enjoyers.set('fp-durable-a', enjoyerPayload('mat-a', 'fp-durable-a'))
    h.sessions.set('sess-a', { id: 'sess-a', userId: 'user-1', processMode: 'free', sourceSelection: selectionA })

    await test('M. a provider failure (both attempts throw) writes no artifact', async () => {
      h.alaiJsonImpl = async () => { throw new Error('ALAI: todos los proveedores fallaron') }
      wire(h)
      const { response } = await post({ sessionId: 'sess-a', nivel: 'universidad' })
      assert.equal(response.status, 502)
      assert.equal(h.artifacts.size, 0)
    })

    await test('N. invalid JSON (unparseable both attempts) writes no artifact', async () => {
      h.alaiJsonImpl = async () => { const e: any = new Error('ALAI: INVALID_JSON'); e.code = 'INVALID_JSON'; e.jsonFailureClass = 'TRUNCATED'; throw e }
      wire(h)
      const { response, data } = await post({ sessionId: 'sess-a', nivel: 'universidad' })
      assert.equal(response.status, 502)
      assert.equal(data.error, 'PROVIDER_GENERATION_FAILED')
      assert.equal(h.artifacts.size, 0)
    })

    await test('O. a schema-invalid generation (valid JSON, zero narrated clusters) writes no artifact', async () => {
      h.alaiJsonImpl = async () => emptySchemaInvalidPayload()
      wire(h)
      const { response, data } = await post({ sessionId: 'sess-a', nivel: 'universidad' })
      assert.equal(response.status, 502)
      assert.equal(data.error, 'PROVIDER_GENERATION_FAILED')
      assert.equal(h.artifacts.size, 0)
    })

    await test('a subsequent legitimate retry after a write-nothing failure can still succeed and persist', async () => {
      h.alaiJsonImpl = async () => validAlaiPayload()
      wire(h)
      const { response } = await post({ sessionId: 'sess-a', nivel: 'universidad' })
      assert.equal(response.status, 200)
      assert.equal(h.artifacts.size, 1, 'the cache was never poisoned by the earlier failures')
    })
  }

  // ── Q: concurrency — two simultaneous requests for the identical
  // identity must not each trigger their own expensive generation.
  {
    const h = newHarness()
    h.enjoyers.set('fp-durable-a', enjoyerPayload('mat-a', 'fp-durable-a'))
    h.sessions.set('sess-a', { id: 'sess-a', userId: 'user-1', processMode: 'free', sourceSelection: selectionA })
    let releaseGeneration!: () => void
    const gate = new Promise<void>(resolve => { releaseGeneration = resolve })
    h.alaiJsonImpl = async () => { await gate; return validAlaiPayload('race') }
    wire(h)

    await test('Q. two concurrent requests for the same identity single-flight into exactly one provider call', async () => {
      const p1 = post({ sessionId: 'sess-a', nivel: 'universidad' })
      const p2 = post({ sessionId: 'sess-a', nivel: 'universidad' })
      // Let both requests reach the single-flight map before releasing
      // the mocked provider call.
      await new Promise(resolve => setTimeout(resolve, 10))
      releaseGeneration()
      const [r1, r2] = await Promise.all([p1, p2])
      assert.equal(r1.response.status, 200)
      assert.equal(r2.response.status, 200)
      assert.equal(h.alaiJsonCalls, 1, 'exactly one provider call for two concurrent identical requests')
      assert.deepEqual(r1.data.analisis, r2.data.analisis)
      assert.equal(h.artifacts.size, 1)
    })
  }

  // ── R: Material Brain remains 0 runtime dependency for Análisis.
  await test('R. Material Brain remains 0 runtime dependency for the durable Análisis path', () => {
    const routeSource = fs.readFileSync('app/api/analizar-teorico/route.ts', 'utf8')
    assert.ok(!routeSource.includes('restoreMaterialBrain') && !routeSource.includes('WorkerMaterialResultStore'),
      'no Material Brain runtime path in the durability-augmented route')
    const storeSource = fs.readFileSync('lib/materialBrain/analysisArtifactStore.ts', 'utf8')
    assert.ok(!storeSource.includes("result_type: 'material_brain'") && !storeSource.includes("RESULT_TYPE = 'material_brain'"),
      'the new artifact store never writes under the Material Brain result_type')
    assert.ok(!('restoreMaterialBrain' in __routeDeps))
  })

  // ── S: current JSON parser contracts remain green (surface-level check
  // here; the dedicated file is re-run in full during certification).
  await test('S. the JSON parser diagnostic surface used by this durability work is unchanged/exported', () => {
    assert.equal(typeof classifyJsonParseFailure, 'function')
  })

  // ── Artifact identity/schema sanity.
  await test('artifact identity is a stable deterministic hash of (userId, fingerprint, nivel)', () => {
    const a = analysisArtifactIdentity('u1', 'fp1', 'universidad')
    const b = analysisArtifactIdentity('u1', 'fp1', 'universidad')
    const c = analysisArtifactIdentity('u1', 'fp1', 'secundaria')
    assert.equal(a, b)
    assert.notEqual(a, c)
    assert.equal(typeof ANALYSIS_ARTIFACT_SCHEMA_VERSION, 'number')
  })

  console.log('analysis-durability-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
