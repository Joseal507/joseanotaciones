import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NextRequest } from 'next/server'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { POST, __routeDeps } from '../../app/api/alai-studyal-map/route'

// ============================================================
// STUDYMAP_LEGACY_AUTH_HARDENING: the legacy texto/content branch at the
// bottom of /api/alai-studyal-map/route.ts is unreachable from the
// current UI (ALAIStudyMap.tsx only ever sends sessionId or
// mode:'explain_node') but was directly reachable over raw HTTP with NO
// authentication at all — the same class of gap already closed for
// /api/alai-studyal-chat's legacy branch.
//
// Fix: a server session is now resolved via the SAME getServerSession
// primitive the sessionId/explain_node branches already use, BEFORE any
// texto parsing or provider call. The live sessionId/Enjoyer generation
// path and the explain_node path are untouched and re-verified here.
// ============================================================

const selection = { ...buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3] }), fingerprint: 'fp-sm-auth' }

const items = [
  { id: 'n1', kind: 'concept', name: 'Nodo 1', content: 'Contenido autorizado del nodo 1', importance: 90, difficulty: 'medium', topicId: 't1', materialId: 'mat-a', pages: [1], sourceSpans: [{ page: 1, quote: 'q1' }] },
]

function enjoyerPayload() {
  return {
    sourceSelectionFingerprint: 'fp-sm-auth', materialIds: ['mat-a'], selectedPages: { 'mat-a': [1, 2, 3] },
    topicsIndex: [{ id: 't1', title: 'Tema uno' }], globalOrderedAnalysis: items, uniqueConceptsIndex: [], relations: [],
  }
}

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => { await fn(); console.log(`  ✅ ${name}`) })()
}

async function post(body: unknown) {
  const response = await POST(new NextRequest('http://localhost/api/alai-studyal-map', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  return { response, data: await response.json() }
}

function baseDeps(userId: string | null, enjoyerStore = new Map<string, any>()) {
  return {
    getServerSession: async () => (userId ? ({ user: { id: userId } } as any) : null),
    getAuthoritativeFreeSession: async (sessionId: string) => (sessionId === 'sess-1' ? ({ id: 'sess-1', userId: 'user-1', processMode: 'free', sourceSelection: selection } as any) : null),
    getMaterial: async () => ({ id: 'mat-a', nombre: 'Material A' }) as any,
    lookupStudyalMaterialEnjoyer: async (fingerprint: string) => enjoyerStore.get(fingerprint) ?? null,
    materialEnjoyerStore: {} as any,
  }
}

async function main() {
  // ── A/B: unauthenticated legacy texto request -> 401, 0 provider calls.
  {
    let providerCalls = 0
    Object.assign(__routeDeps, baseDeps(null), {
      generateValidatedLegacyJson: async () => { providerCalls++; return { title: 'x', summary: 'x', categorias: [] } },
    })

    await test('A. unauthenticated legacy texto request returns 401 UNAUTHORIZED', async () => {
      const { response, data } = await post({ texto: 'Contenido crudo del material.', materia: 'X', tema: 'Y' })
      assert.equal(response.status, 401)
      assert.equal(data.error, 'UNAUTHORIZED')
    })

    await test('B. unauthenticated legacy texto request makes 0 provider calls', () => {
      assert.equal(providerCalls, 0)
    })

    await test('B2. unauthenticated request via `content` alias also -> 401, 0 calls', async () => {
      const { response, data } = await post({ content: 'Contenido crudo del material.' })
      assert.equal(response.status, 401)
      assert.equal(data.error, 'UNAUTHORIZED')
      assert.equal(providerCalls, 0)
    })

    await test('B3. a session lookup that throws also -> 401, 0 calls', async () => {
      Object.assign(__routeDeps, { getServerSession: async () => { throw new Error('no cookie') } })
      const { response, data } = await post({ texto: 'algo' })
      assert.equal(response.status, 401)
      assert.equal(data.error, 'UNAUTHORIZED')
      assert.equal(providerCalls, 0)
    })
  }

  // ── C/D/E: authenticated legacy request preserves existing behavior
  // and provider budget; auth happens before the provider call.
  {
    let providerCalls = 0
    Object.assign(__routeDeps, baseDeps('user-1'), {
      generateValidatedLegacyJson: async (params: any) => {
        providerCalls++
        // The legacy branch makes TWO distinct provider calls per request:
        // (1) schema/category proposal (object), (2) per-chunk concept
        // extraction (array) — distinguished here by expected shape only,
        // never by touching production code.
        if (providerCalls === 1) return { title: 'Título real', summary: 'Resumen.', categorias: [{ nombre: 'Categoría 1', descripcion: 'desc' }] }
        return [{ categoria: 'Categoría 1', concepto: 'Concepto X', explicacion: 'Explicación X del material.' }]
      },
    })

    await test('C. authenticated legacy texto request preserves existing behavior (succeeds, produces a mapa)', async () => {
      const { response, data } = await post({ texto: 'Contenido crudo suficientemente largo del material.', materia: 'X', tema: 'Y' })
      assert.equal(response.status, 200)
      assert.equal(data.success, true)
      assert.ok(data.mapa)
    })

    await test('D. authenticated legacy request preserves existing provider budget (schema call happened)', () => {
      assert.ok(providerCalls >= 1, 'the legacy schema-generation provider call still occurs once authenticated')
    })
  }

  await test('E. auth gate is positioned before texto parsing and before both legacy provider call sites', () => {
    const routeSource = fs.readFileSync('app/api/alai-studyal-map/route.ts', 'utf8')
    const authIdx = routeSource.indexOf("if (!legacyUserId) return groundedErrorResponse('UNAUTHORIZED', 401);")
    const textoIdx = routeSource.indexOf("const texto = String(body.texto || body.content || '').trim();")
    const firstProviderIdx = routeSource.indexOf('const schema: any = await __routeDeps.generateValidatedLegacyJson(')
    const secondProviderIdx = routeSource.indexOf('const conceptos = await __routeDeps.generateValidatedLegacyJson<any[]>(')
    assert.ok(authIdx > -1 && textoIdx > -1 && firstProviderIdx > -1 && secondProviderIdx > -1)
    assert.ok(authIdx < textoIdx, 'auth check must precede texto parsing')
    assert.ok(textoIdx < firstProviderIdx && textoIdx < secondProviderIdx, 'texto parsing precedes both legacy provider call sites, both after auth')
  })

  // ── F/G: live sessionId/Enjoyer map generation remains unchanged and 0 provider calls.
  {
    let providerCalls = 0
    const store = new Map<string, any>([['fp-sm-auth', enjoyerPayload()]])
    Object.assign(__routeDeps, baseDeps('user-1', store), {
      generateValidatedLegacyJson: async () => { providerCalls++; return {} },
    })

    await test('F. live sessionId/Enjoyer map generation remains unchanged (succeeds, Enjoyer-grounded)', async () => {
      const { response, data } = await post({ sessionId: 'sess-1', materia: 'X', tema: 'Y' })
      assert.equal(response.status, 200)
      assert.equal(data.success, true)
      assert.equal(data.grounding.fingerprint, 'fp-sm-auth')
      assert.equal(data.grounding.authorityType, 'studyal_material_enjoyer')
    })

    await test('G. live map generation remains 0 provider calls', () => {
      assert.equal(providerCalls, 0)
    })
  }

  // ── H/I/J: explain_node remains authenticated, bounded to 1 call, Enjoyer-grounded.
  {
    let providerCalls = 0
    const store = new Map<string, any>([['fp-sm-auth', enjoyerPayload()]])
    Object.assign(__routeDeps, baseDeps('user-1', store), {
      generateValidatedLegacyJson: async () => { providerCalls++; return { answer: 'Explicación grounded del nodo.', usedRelationIds: [] } },
    })

    await test('H. explain_node remains authenticated (missing session -> 401, 0 calls)', async () => {
      Object.assign(__routeDeps, { getServerSession: async () => null })
      const { response, data } = await post({ mode: 'explain_node', sessionId: 'sess-1', unitId: 'map_node:n1' })
      assert.equal(response.status, 401)
      assert.equal(data.error, 'UNAUTHORIZED')
      assert.equal(providerCalls, 0)
      Object.assign(__routeDeps, { getServerSession: async () => ({ user: { id: 'user-1' } } as any) })
    })

    await test('I. explain_node remains bounded to exactly 1 provider call when authenticated', async () => {
      const { response, data } = await post({ mode: 'explain_node', sessionId: 'sess-1', unitId: 'map_node:n1' })
      assert.equal(response.status, 200)
      assert.equal(data.success, true)
      assert.equal(providerCalls, 1)
    })

    await test('J. explain_node remains Enjoyer-grounded (resolves the real node, scopes relations to it)', async () => {
      const { data } = await post({ mode: 'explain_node', sessionId: 'sess-1', unitId: 'map_node:n1' })
      assert.equal(data.explanation.unitId, 'map_node:n1')
      assert.deepEqual(data.explanation.sourcePages, [1])
    })
  }

  // ── K: no Material Brain dependency introduced by this hardening.
  await test('K. no Material Brain runtime dependency introduced by the legacy auth hardening', () => {
    const routeSource = fs.readFileSync('app/api/alai-studyal-map/route.ts', 'utf8')
    assert.ok(!routeSource.includes('restoreMaterialBrain') && !routeSource.includes('WorkerMaterialResultStore') && !routeSource.includes('/api/material-brain'))
    assert.ok(!routeSource.includes('setBrainSourceSelection') && !routeSource.includes('useMaterialBrainLifecycle'))
  })

  // ── L: current client contract remains compatible — the live UI never
  // sends texto/content, so it is entirely unaffected by this hardening;
  // its two actual request shapes (sessionId-only, and mode:'explain_node')
  // are exactly what F/G/H/I/J exercise above.
  await test('L. current client contract remains compatible (no client changes required)', () => {
    const clientSource = fs.readFileSync('components/materias/ALAIStudyMap.tsx', 'utf8')
    assert.ok(!clientSource.includes("texto:") && !clientSource.match(/body:\s*JSON\.stringify\(\{[^}]*\bcontent:/),
      'the live client never sends texto/content to this route — unaffected by the legacy-branch auth gate')
  })

  console.log('studymap-legacy-auth-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
