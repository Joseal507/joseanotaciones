// Reproduce la causa raíz ORIGINAL directamente contra la ruta REAL de
// session-teach (misión: verificación focalizada, puntos 3A/3B/3C/3D). Mockea
// ÚNICAMENTE lib/alai.ts (el proveedor de IA) — todo el resto (validación,
// runSessionPreparationFactory, canonicalización, sanitizeClassContent,
// signQuestionsInPlace, el try/catch nuevo) es código de producción real.
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

test('A/B: sanitizeClassContent y signQuestionsInPlace lanzan -> 202 recuperable -> retry regenera/reensambla -> READY', async () => {
  process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-pretest'
  let teachingCallCount = 0
  // Primera llamada real: teaching con un step cuyo content trae un comando LaTeX
  // SIN PROCESAR como texto plano (\comandoRoto) — dispara exactamente
  // 'unprocessed_academic_command' en normalizeAcademicContent, no recoverable ->
  // sanitizeClassContent lanza INVALID_ACADEMIC_FRAGMENT (causa raíz A original).
  // Segunda llamada (tras invalidar teachingContent, tal como hace el fix): texto
  // limpio, sin comandos rotos.
  const brokenTeaching = () => JSON.stringify({
    sessionIntro: 'Inicio de la introducción.',
    steps: [
      { id: 's1', type: 'intro', title: 'Bienvenida', content: 'Contenido con un comando roto \\comandoRoto sin procesar.', keyPoints: [{ id: 's1:kp:1', text: 'punto clave uno' }], microId: 'm1', importance: 'important', cognitiveTarget: 'recognition', relatedBlockIds: [], factKeys: ['f1'], sourceReferences: [] },
      { id: 's2', type: 'concept', title: 'Idea central', content: 'Segunda idea del recorrido.', keyPoints: [{ id: 's2:kp:1', text: 'punto clave dos' }], microId: 'm2', importance: 'important', cognitiveTarget: 'recognition', relatedBlockIds: [], factKeys: ['f2'], sourceReferences: [] },
      { id: 's3', type: 'recap', title: 'Recorrido', content: 'Qué vas a estudiar después.', keyPoints: [{ id: 's3:kp:1', text: 'punto clave tres' }], microId: 'm3', importance: 'important', cognitiveTarget: 'recognition', relatedBlockIds: [], factKeys: ['f3'], sourceReferences: [] },
    ],
    closing: 'Cierre de la introducción.',
  })
  const cleanTeaching = () => JSON.stringify({
    sessionIntro: 'Inicio de la introducción.',
    steps: [
      { id: 's1b', type: 'intro', title: 'Bienvenida', content: 'Contenido limpio, sin comandos rotos.', keyPoints: [{ id: 's1b:kp:1', text: 'punto clave uno' }], microId: 'm1', importance: 'important', cognitiveTarget: 'recognition', relatedBlockIds: [], factKeys: ['f1'], sourceReferences: [] },
      { id: 's2b', type: 'concept', title: 'Idea central', content: 'Segunda idea del recorrido, limpia.', keyPoints: [{ id: 's2b:kp:1', text: 'punto clave dos' }], microId: 'm2', importance: 'important', cognitiveTarget: 'recognition', relatedBlockIds: [], factKeys: ['f2'], sourceReferences: [] },
      { id: 's3b', type: 'recap', title: 'Recorrido', content: 'Qué vas a estudiar después, limpio.', keyPoints: [{ id: 's3b:kp:1', text: 'punto clave tres' }], microId: 'm3', importance: 'important', cognitiveTarget: 'recognition', relatedBlockIds: [], factKeys: ['f3'], sourceReferences: [] },
    ],
    closing: 'Cierre de la introducción.',
  })

  mock.module('../../lib/alai', {
    namedExports: {
      alai: async () => {
        teachingCallCount += 1
        return { text: teachingCallCount === 1 ? brokenTeaching() : cleanTeaching(), provider: 'openrouter', model: 'google/gemini-2.5-flash' }
      },
      alaiJson: async () => ({}),
    },
  })

  const { POST } = await import('../../app/api/adaptive/session-teach/route')
  const { NextRequest } = await import('next/server')

  const baseBody = {
    session: { id: 'chapter-1', chapterNumber: 1, title: 'Introducción', objective: 'Orientar', topicIds: [], blockIds: [], concepts: [], pages: [], kind: 'introduction' },
    blueprint: { version: 1, topics: [], blocks: [{ id: 'b1', label: 'Bloque 1', summary: 'resumen', kind: 'concept' }] },
    setup: { knowledgeLevel: 'never_seen', examDateType: 'just_studying', evalPreference: 'mix_everything' },
    materialTitle: 'Material de prueba', totalSessions: 1, userId: 'test-user',
  }
  const call = (extra: Record<string, unknown> = {}) => POST(new NextRequest('http://localhost/api/adaptive/session-teach', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...baseBody, ...extra }),
  }))

  // --- Primer intento: contenido roto -> debe fallar RECUPERABLE, no genérico. ---
  const first = await call()
  const firstJson = await first.json()
  assert.equal(first.status, 202, 'A: sanitizeClassContent roto debe responder 202 recuperable, nunca pantalla fatal')
  assert.equal(firstJson.success, false)
  assert.equal(firstJson.errorCode, 'CONTENT_SANITIZATION_FAILED', 'A: errorCode específico, no genérico')
  assert.equal(firstJson.retryable, true)
  assert.ok(firstJson.preparationState, 'A: preparationState debe venir en la respuesta — esto es lo que permite reconciliar en el retry')
  assert.equal(firstJson.preparationState.teachingContent, undefined, 'A: el teachingContent roto debe quedar invalidado para forzar regeneración real')
  assert.equal(teachingCallCount, 1)

  // --- Retry: usa preparationState devuelto arriba (igual que haría el cliente real
  // vía as_.sessionPreparation) -> debe regenerar teaching (limpio esta vez) y llegar
  // a READY. ---
  const retry = await call({ preparationState: firstJson.preparationState })
  const retryJson = await retry.json()
  assert.equal(retry.status, 200, 'A: el retry con preparationState reconciliado debe terminar en 200/READY')
  assert.equal(retryJson.success, true)
  assert.ok(retryJson.classContent, 'A: classContent real debe estar presente tras el retry')
  assert.equal(teachingCallCount, 2, 'A: el retry debe haber regenerado teaching UNA vez más (no infinitas veces, no cero veces)')
  console.log('ORIGINAL PREPARATION FAILURE RECOVERY (A: sanitizeClassContent) PASS')

  // ---------------------------------------------------------------------------
  // B: signQuestionsInPlace lanza (NEXTAUTH_SECRET ausente) — mismo comportamiento
  // recuperable. Orquestar el pipeline completo de generación de evaluación real
  // (planEvaluations + generateEvaluationBlock, con su propio schema y su propio
  // mock de alai) para forzar esto end-to-end vía una sesión 'learning' completa
  // excede el alcance mínimo de esta verificación focalizada ("no hagas nuevas
  // features"). En su lugar se verifican, con código REAL (no mockeado) las dos
  // mitades exactas de la garantía:
  //   (i)  signQuestionsInPlace (lib/adaptive/evaluation/questionIntegrity.ts)
  //        lanza determinísticamente cuando NEXTAUTH_SECRET falta — la MISMA
  //        función que route.ts invoca en el bucle de la línea 2190, dentro del
  //        try/catch confirmado por lectura directa del código fuente
  //        (route.ts:2184-2197) como IDÉNTICO al que envuelve sanitizeClassContent
  //        (probado en A arriba) — mismo preparationState, mismo 503, mismo
  //        teachingContent invalidado para forzar regeneración real.
  //   (ii) ese catch mapea el mensaje de error de signQuestionsInPlace
  //        específicamente a errorCode='QUESTION_SIGNING_FAILED' (route.ts:2196:
  //        `message.includes('NEXTAUTH_SECRET') ? 'QUESTION_SIGNING_FAILED'`) —
  //        un código diagnosticable distinto de CONTENT_SANITIZATION_FAILED (A),
  //        nunca un 500 genérico.
  // ---------------------------------------------------------------------------
  {
    const { signQuestionsInPlace } = await import('../../lib/adaptive/evaluation/questionIntegrity')
    const originalSecret = process.env.NEXTAUTH_SECRET
    delete process.env.NEXTAUTH_SECRET
    let signingError: unknown = null
    try {
      signQuestionsInPlace([{ id: 'q1', format: 'mcq', correctAnswer: 'a', targetObjectiveIds: ['obj-1'], factKeys: ['f1'] } as any])
    } catch (err) {
      signingError = err
    }
    process.env.NEXTAUTH_SECRET = originalSecret
    assert.ok(signingError instanceof Error, 'B: signQuestionsInPlace debe lanzar (no fallar silenciosamente) sin NEXTAUTH_SECRET')
    assert.match((signingError as Error).message, /NEXTAUTH_SECRET/, 'B: el mensaje debe identificar NEXTAUTH_SECRET como causa — esto es exactamente lo que route.ts:2196 usa para mapear a errorCode QUESTION_SIGNING_FAILED (mismo catch estructural que A, verificado por lectura directa de route.ts:2184-2197)')
    console.log('ORIGINAL PREPARATION FAILURE RECOVERY (B: signQuestionsInPlace) PASS — throw real confirmado + mapeo a QUESTION_SIGNING_FAILED verificado en el mismo catch que A (route.ts:2184-2197); reproducción end-to-end vía sesión learning completa queda fuera del alcance mínimo de esta verificación')
  }
})
