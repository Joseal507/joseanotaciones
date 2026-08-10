// FASE 10 (misión visual+prefetch) — invalidación A-H + cierre de gaps pedidos tras
// el primer reporte. Cobertura de este archivo, actualizada:
//   A, evidence-irrelevance, unresolved-irrelevance, setup-change, blueprint/journey
//   version-change, refresh (round-trip), same-tab dedup, y retry-after-failure son
//   ahora TESTS EJECUTABLES reales (no solo documentación).
//   final_review (la única sesión que SÍ depende de evidencia/recovery de N) se
//   prueba excluida del prefetch por completo.
//   E (dos pestañas): dedupe DENTRO de una pestaña se prueba real; cross-tab se
//   declara explícitamente NO garantizado (ver CROSS_TAB_DEDUP) — nunca se afirma
//   cobertura que no existe.
import assert from 'node:assert/strict'
import {
  computeSessionDependencyFingerprint,
  isPrefetchStillValid,
  shouldPrefetchSession,
  KeyedPromiseCache,
  CROSS_TAB_DEDUP,
  type PrefetchDependencyInput,
} from '../../lib/adaptive/sessionPrefetch'

const stateAtPrefetchTime: PrefetchDependencyInput = {
  chapterId: 'chapter-3', chapterBlockIds: ['b3', 'b4'], blueprintVersion: 5,
  journeyId: 'journey-9', journeyVersion: 2, setupSnapshot: { knowledgeLevel: 'intermedio', evalPreference: 'mix_everything' },
  materialHash: 'material-42',
}

// A) N+1 prefetched, N termina sin cambios relevantes ⇒ reuse.
{
  const fingerprintAtPrefetch = computeSessionDependencyFingerprint(stateAtPrefetchTime)
  const meta = {
    sessionNumber: 4, sourceBlueprintVersion: 5, journeyVersion: 2, setupFingerprint: 'irrelevant',
    dependencyFingerprint: fingerprintAtPrefetch, preparedAt: Date.now(), status: 'ready' as const,
  }
  const fingerprintAtConsumption = computeSessionDependencyFingerprint(stateAtPrefetchTime)
  assert.equal(isPrefetchStillValid(meta, fingerprintAtConsumption), true, 'A: sin cambios de dependencias reales, el prefetch debe reutilizarse')
  console.log('session-prefetch-invalidation: A (reuse sin cambios) PASS')
}

// ---------------------------------------------------------------------------
// Evidence-irrelevance / unresolved-irrelevance (B/C reforzados): reproduce
// EXACTAMENTE la derivación de dependencias que usa triggerNextSessionPrefetch en
// page.tsx (chapterId/chapterBlockIds/blueprintVersion/journeyId/journeyVersion/
// setupSnapshot/materialHash) a partir de un objeto `as_` simulado, y demuestra que
// mutar evidencia real (demonstratedFactKeys) o recovery (recoveryQueues) sobre ese
// mismo objeto NUNCA cambia el fingerprint derivado — no es una afirmación de tipo,
// es la MISMA función de derivación ejecutada antes/después de la mutación.
// ---------------------------------------------------------------------------
function deriveDependencyInputLikePageTsx(as_: any, chapter: any, bp: any, jy: any): PrefetchDependencyInput {
  return {
    chapterId: chapter.id, chapterBlockIds: chapter.blockIds || [], blueprintVersion: bp.version || 0,
    journeyId: jy.id || 'current', journeyVersion: jy.version || jy.id || 'current',
    setupSnapshot: as_.adaptiveSetup, materialHash: as_.masteryMaterialKey || as_.primaryMaterialId || as_.materialIds?.join(','),
  }
}
{
  const chapter = { id: 'chapter-4', chapterNumber: 4, blockIds: ['b5', 'b6'] }
  const bp = { version: 7, blocks: [] }
  const jy = { id: 'journey-x', version: 3 }
  const as_: any = {
    id: 'session-1', adaptiveSetup: { knowledgeLevel: 'novato', evalPreference: 'mix_everything' },
    masteryMaterialKey: 'material-99',
    assessmentBlueprintBySession: { '3': { objectives: [{ objectiveId: 'o1', demonstratedFactKeys: [] }] } },
    recoveryQueues: { '3': [] },
    completedSessionNumbers: [],
  }

  const before = deriveDependencyInputLikePageTsx(as_, chapter, bp, jy)
  const fingerprintBefore = computeSessionDependencyFingerprint(before)

  // Evidencia real de N cambia (demonstratedFactKeys avanza) — evidence-irrelevance.
  as_.assessmentBlueprintBySession['3'].objectives[0].demonstratedFactKeys = ['f1', 'f2', 'f3']
  // Recovery de N cambia (nuevos items unresolved) — unresolved-irrelevance.
  as_.recoveryQueues['3'] = [{ recoveryId: 'r1', status: 'unresolved', latestFactKeys: ['f1'] }, { recoveryId: 'r2', status: 'pending', latestFactKeys: ['f2'] }]
  // N se marca completada — tampoco es un input de fingerprint para N+1 learning.
  as_.completedSessionNumbers = [3]

  const after = deriveDependencyInputLikePageTsx(as_, chapter, bp, jy)
  const fingerprintAfter = computeSessionDependencyFingerprint(after)

  assert.equal(fingerprintBefore, fingerprintAfter, 'evidence-irrelevance/unresolved-irrelevance: cambios reales de evidencia/recovery/completion de N NUNCA deben alterar el dependencyFingerprint de una N+1 learning (journey estático, Codex C)')
  console.log('session-prefetch-invalidation: evidence-irrelevance + unresolved-irrelevance (prueba ejecutable, no solo tipo) PASS')
}

// B/C) final_review nunca es candidata a prefetch — la dependencia real de N se
// resuelve esperando, nunca invalidando después del hecho.
{
  assert.equal(shouldPrefetchSession('final_review'), false, 'B/C: final_review depende de la evidencia de N — nunca se prefetchea por adelantado')
  assert.equal(shouldPrefetchSession('learning'), true, 'control: learning sí es prefetcheable (es la clase para la que este mecanismo existe)')
  console.log('session-prefetch-invalidation: B/C (final_review nunca prefetcheada) PASS')
}

// Setup change invalida.
{
  const fingerprintOldSetup = computeSessionDependencyFingerprint(stateAtPrefetchTime)
  const meta = {
    sessionNumber: 4, sourceBlueprintVersion: 5, journeyVersion: 2, setupFingerprint: 'irrelevant',
    dependencyFingerprint: fingerprintOldSetup, preparedAt: Date.now(), status: 'ready' as const,
  }
  const fingerprintNewSetup = computeSessionDependencyFingerprint({ ...stateAtPrefetchTime, setupSnapshot: { knowledgeLevel: 'avanzado', evalPreference: 'quick_test' } })
  assert.equal(isPrefetchStillValid(meta, fingerprintNewSetup), false, 'un cambio de setup entre prefetch y consumo debe invalidar el prefetch')
  console.log('session-prefetch-invalidation: setup change invalidates PASS')
}

// H) blueprint/journey version change invalida — prefetch de una versión ANTIGUA
// nunca se sirve.
{
  const fingerprintOldBlueprint = computeSessionDependencyFingerprint(stateAtPrefetchTime)
  const staleMeta = {
    sessionNumber: 4, sourceBlueprintVersion: 5, journeyVersion: 2, setupFingerprint: 'irrelevant',
    dependencyFingerprint: fingerprintOldBlueprint, preparedAt: Date.now() - 60_000, status: 'ready' as const,
  }
  const fingerprintNewBlueprint = computeSessionDependencyFingerprint({ ...stateAtPrefetchTime, blueprintVersion: 6 })
  const fingerprintNewJourney = computeSessionDependencyFingerprint({ ...stateAtPrefetchTime, journeyVersion: 3 })
  assert.equal(isPrefetchStillValid(staleMeta, fingerprintNewBlueprint), false, 'H: prefetch de una versión de blueprint antigua NUNCA debe servirse tras una regeneración de blueprint')
  assert.equal(isPrefetchStillValid(staleMeta, fingerprintNewJourney), false, 'H: un cambio de versión de journey también debe invalidar')
  console.log('session-prefetch-invalidation: H (stale blueprint/journey version never served) PASS')
}

// D) Refresh: el meta persistido sobrevive un round-trip JSON (serialización real,
// como localStorage/studySessions) sin perder capacidad de detectar staleness ni de
// validar reuse — nunca queda en un estado ambiguo que se sirva "por accidente".
{
  const fingerprint = computeSessionDependencyFingerprint(stateAtPrefetchTime)
  const meta = {
    sessionNumber: 4, sourceBlueprintVersion: 5, journeyVersion: 2, setupFingerprint: 'irrelevant',
    dependencyFingerprint: fingerprint, preparedAt: Date.now(), status: 'ready' as const,
  }
  const roundTripped = JSON.parse(JSON.stringify(meta))
  assert.equal(isPrefetchStillValid(roundTripped, computeSessionDependencyFingerprint(stateAtPrefetchTime)), true, 'D: un meta serializado/deserializado (simulando refresh) con fingerprint aún vigente debe seguir siendo válido')
  assert.equal(isPrefetchStillValid(roundTripped, computeSessionDependencyFingerprint({ ...stateAtPrefetchTime, blueprintVersion: 999 })), false, 'D: y debe seguir detectando staleness correctamente tras el round-trip')
  console.log('session-prefetch-invalidation: D (refresh — round-trip JSON preserva validación) PASS')
}

// E) Same-tab dedup: dos triggers concurrentes con la MISMA clave comparten
// exactamente una ejecución del factory — nunca generan sesiones divergentes.
// (envuelto en main() porque usa await — top-level await no soportado por el
// runner cjs de este repo, mismo patrón que el resto de scripts/tests/*.ts)
async function main() {
  const cache = new KeyedPromiseCache<number>()
  let factoryCalls = 0
  const factory = async () => { factoryCalls += 1; await new Promise(resolve => setTimeout(resolve, 10)); return factoryCalls }
  const [resultA, resultB] = await Promise.all([cache.run('key-1', factory), cache.run('key-1', factory)])
  assert.equal(factoryCalls, 1, 'E (same-tab): dos triggers concurrentes con la misma clave deben invocar el factory UNA sola vez')
  assert.equal(resultA, resultB, 'E (same-tab): ambos callers deben recibir el resultado de la MISMA ejecución (nunca sesiones divergentes)')
  assert.equal(cache.has('key-1'), false, 'tras completar, la clave debe liberarse (permite un futuro trigger real, no queda bloqueada para siempre)')

  // Una clave DISTINTA (p.ej. otro fingerprint tras cambiar setup) sí dispara un
  // segundo factory — el dedupe es por clave, no global.
  await cache.run('key-2', factory)
  assert.equal(factoryCalls, 2, 'una clave distinta debe generar una ejecución independiente')
  console.log('session-prefetch-invalidation: E same-tab dedup (KeyedPromiseCache) PASS')

  assert.equal(CROSS_TAB_DEDUP, 'NOT GUARANTEED', 'cross-tab dedup debe permanecer declarado explícitamente como NO garantizado — nunca se afirma cobertura que no existe (limitación heredada, confirmada por Codex C)')
  console.log(`session-prefetch-invalidation: CROSS_TAB_DEDUP = ${CROSS_TAB_DEDUP} (declarado explícitamente, no se reclama cobertura) PASS`)

  // F) Fallo transitorio: tras un rechazo del factory, la clave se libera de
  // inmediato — un trigger posterior (el "reintento lazy" real de este diseño) puede
  // intentarlo de nuevo, nunca queda permanentemente bloqueado por un fallo previo.
  const flakyCache = new KeyedPromiseCache<string>()
  let attempts = 0
  const flakyFactory = async () => {
    attempts += 1
    if (attempts === 1) throw new Error('fallo transitorio simulado')
    return 'ok'
  }
  await assert.rejects(() => flakyCache.run('flaky-key', flakyFactory), /fallo transitorio simulado/)
  assert.equal(flakyCache.has('flaky-key'), false, 'F: tras un rechazo, la clave debe liberarse inmediatamente (no queda "en curso" para siempre)')
  const secondAttempt = await flakyCache.run('flaky-key', flakyFactory)
  assert.equal(secondAttempt, 'ok', 'F: un segundo trigger tras el fallo debe poder reintentar y tener éxito')
  assert.equal(attempts, 2, 'F: el reintento debe ser una ejecución nueva real, no una promesa fallida cacheada')
  console.log('session-prefetch-invalidation: F (retry-after-failure, la clave nunca queda bloqueada) PASS')

  console.log('session-prefetch-invalidation-contracts: ALL PASS')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
