import assert from 'node:assert/strict'
import fs from 'node:fs'
import { NextRequest } from 'next/server'
import { POST, __routeDeps } from '../../app/api/alai-studyal-chat/route'

// ============================================================
// ANALISIS_CHAT_AUTH_HARDENING: the legacy materialText branch of
// /api/alai-studyal-chat (shared by Análisis's doubt chat and Study
// Map's legacy chat/explain path) previously invoked the real provider
// (alai()) for ANY request carrying materialText+message, with no
// authentication check at all — an unauthenticated cost-abuse surface
// (see the prior read-only audit, ANALISIS_CHAT_AUDIT_COMPLETE).
//
// Fix: a server session is now resolved via the SAME getServerSession
// primitive the sessionId/Enjoyer branch already used, BEFORE any
// materialText/message parsing or provider call. This file proves the
// invariant directly against the real POST() handler — no client
// changes were needed (both live callers already send
// credentials: 'same-origin').
// ============================================================

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => { await fn(); console.log(`  ✅ ${name}`) })()
}

async function post(body: unknown) {
  const response = await POST(new NextRequest('http://localhost/api/alai-studyal-chat', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  return { response, data: await response.json() }
}

function wireAuth(userId: string | null) {
  Object.assign(__routeDeps, {
    getServerSession: async () => (userId ? ({ user: { id: userId } } as any) : null),
  })
}

async function main() {
  // ── A/B: unauthenticated -> 401, 0 provider calls.
  {
    let providerCalls = 0
    wireAuth(null)
    Object.assign(__routeDeps, { alai: async () => { providerCalls++; return { text: '{}', provider: 'openrouter', model: 'x' } } })

    await test('A. unauthenticated legacy request returns 401 UNAUTHORIZED', async () => {
      const { response, data } = await post({ message: '¿Qué es Kc?', materialText: 'Kc es la constante de equilibrio.', history: [] })
      assert.equal(response.status, 401)
      assert.equal(data.error, 'UNAUTHORIZED')
    })

    await test('B. unauthenticated legacy request makes 0 provider calls', () => {
      assert.equal(providerCalls, 0)
    })

    await test('B2. unauthenticated request with no getServerSession session object at all (throws) also -> 401, 0 calls', async () => {
      Object.assign(__routeDeps, { getServerSession: async () => { throw new Error('no session cookie') } })
      const { response, data } = await post({ message: 'hola', materialText: 'texto', history: [] })
      assert.equal(response.status, 401)
      assert.equal(data.error, 'UNAUTHORIZED')
      assert.equal(providerCalls, 0)
    })
  }

  // ── C/D: authenticated + valid input -> succeeds, provider called exactly once.
  {
    let providerCalls = 0
    wireAuth('user-1')
    Object.assign(__routeDeps, {
      alai: async () => {
        providerCalls++
        return { text: JSON.stringify({ answer: 'Kc es la constante de equilibrio.', inMaterial: true, sourcePages: [1], confidence: 'alta', suggestedFollowups: [] }), provider: 'openrouter', model: 'google/gemini-2.5-flash' }
      },
    })

    await test('C. authenticated valid materialText request succeeds', async () => {
      const { response, data } = await post({ message: '¿Qué es Kc?', materialText: 'Kc es la constante de equilibrio en concentraciones.', history: [] })
      assert.equal(response.status, 200)
      assert.equal(data.success, true)
      assert.ok(data.answer.includes('Kc'))
    })

    await test('D. authenticated request invokes the provider exactly once', () => {
      assert.equal(providerCalls, 1)
    })
  }

  // ── E: empty/invalid required input still returns controlled failure,
  // unaffected by the new auth gate (auth passes, then existing
  // validation still runs exactly as before).
  {
    let providerCalls = 0
    wireAuth('user-1')
    Object.assign(__routeDeps, { alai: async () => { providerCalls++; return { text: '{}', provider: 'openrouter', model: 'x' } } })

    await test('E1. authenticated request with empty materialText -> controlled 400, 0 provider calls', async () => {
      const { response, data } = await post({ message: 'hola', materialText: '', history: [] })
      assert.equal(response.status, 400)
      assert.equal(data.success, false)
      assert.equal(providerCalls, 0)
    })

    await test('E2. authenticated request with empty message -> controlled 400, 0 provider calls', async () => {
      const { response, data } = await post({ message: '', materialText: 'algún texto', history: [] })
      assert.equal(response.status, 400)
      assert.equal(data.success, false)
      assert.equal(providerCalls, 0)
    })
  }

  // ── F/G: both live callers' exact request shapes remain compatible.
  {
    let providerCalls = 0
    wireAuth('user-1')
    Object.assign(__routeDeps, {
      alai: async () => { providerCalls++; return { text: JSON.stringify({ answer: 'Respuesta.', inMaterial: true, sourcePages: [], confidence: 'media', suggestedFollowups: [] }), provider: 'openrouter', model: 'x' } },
    })

    await test('F. Análisis caller contract (AnalisisTeorico.tsx preguntarDuda shape) remains compatible', async () => {
      // Exact body shape sent by components/materias/AnalisisTeorico.tsx's preguntarDuda().
      const { response, data } = await post({
        message: 'Responde como Profesor ALAI usando esta estructura clara: ... Duda del estudiante: ¿qué es Kc?',
        materialText: '[Material 1: Quimica.pdf | páginas 1, 2]\nKc es la constante de equilibrio.',
        history: [],
        materia: 'Química', tema: 'Equilibrio',
      })
      assert.equal(response.status, 200)
      assert.equal(data.success, true)
    })

    await test('G. Study Map legacy caller contract (ALAIStudyMap.tsx fallback shape) remains compatible', async () => {
      // Exact body shape sent by components/materias/ALAIStudyMap.tsx's legacy fallback branch.
      const { response, data } = await post({
        message: 'Explica este nodo del mapa',
        materialText: 'Texto del material seleccionado.',
        history: [],
        materia: 'Química', tema: 'Equilibrio',
      })
      assert.equal(response.status, 200)
      assert.equal(data.success, true)
    })

    await test('providerCalls sanity for F/G (2 authenticated calls, 2 provider calls, no extras)', () => {
      assert.equal(providerCalls, 2)
    })
  }

  // ── H: sessionId/Enjoyer branch remains structurally unchanged by this hardening.
  await test('H. the sessionId/Enjoyer branch is untouched — same auth call, same handler dispatch', () => {
    const routeSource = fs.readFileSync('app/api/alai-studyal-chat/route.ts', 'utf8')
    const sessionBranch = routeSource.slice(
      routeSource.indexOf("if (typeof body?.sessionId === 'string'"),
      routeSource.indexOf('return await handleGroundedChatTurn(body, userId);') + 60,
    )
    assert.match(sessionBranch, /getServerSession\(authOptions\)/)
    assert.match(sessionBranch, /return groundedErrorResponse\('UNAUTHORIZED', 401\)/)
    assert.match(sessionBranch, /return await handleGroundedChatTurn\(body, userId\);/)
  })

  // ── I: no Material Brain dependency introduced by this hardening.
  await test('I. no Material Brain runtime dependency introduced by the auth hardening', () => {
    const routeSource = fs.readFileSync('app/api/alai-studyal-chat/route.ts', 'utf8')
    assert.ok(!routeSource.includes('restoreMaterialBrain') && !routeSource.includes('WorkerMaterialResultStore') && !routeSource.includes('/api/material-brain'))
  })

  // ── J: provider budget for this legacy branch remains max 1 call —
  // structural proof there is no retry loop around __routeDeps.alai(
  // in the legacy branch (unlike Análisis's own safeGroundedAlaiJson,
  // which is a DIFFERENT route/file entirely).
  await test('J. the legacy branch has exactly one __routeDeps.alai( call site, no retry loop', () => {
    const routeSource = fs.readFileSync('app/api/alai-studyal-chat/route.ts', 'utf8')
    const legacyBranch = routeSource.slice(routeSource.indexOf('LEGACY materialText BRANCH'))
    const occurrences = (legacyBranch.match(/__routeDeps\.alai\(/g) || []).length
    assert.equal(occurrences, 1, 'exactly one provider call site in the legacy branch')
  })

  // ── Ordering proof: the auth gate appears in source BEFORE the
  // materialText/message extraction and BEFORE the provider call site.
  await test('auth gate is positioned before materialText parsing and before the provider call', () => {
    const routeSource = fs.readFileSync('app/api/alai-studyal-chat/route.ts', 'utf8')
    const authIdx = routeSource.indexOf("if (!legacyUserId) return groundedErrorResponse('UNAUTHORIZED', 401);")
    const materialTextIdx = routeSource.indexOf("const materialText = String(body.materialText || '').trim();")
    const providerIdx = routeSource.indexOf('const result = await __routeDeps.alai(')
    assert.ok(authIdx > -1 && materialTextIdx > -1 && providerIdx > -1)
    assert.ok(authIdx < materialTextIdx, 'auth check must precede materialText parsing')
    assert.ok(materialTextIdx < providerIdx, 'materialText parsing precedes the provider call, both after auth')
  })

  console.log('alai-chat-legacy-auth-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
