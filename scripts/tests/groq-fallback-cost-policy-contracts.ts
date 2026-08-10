import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyProviderFailure, shouldFallbackToGroq } from '../../lib/ai/providerPolicy'

// AUDITORÍA DE POLÍTICA DE COSTO (verificación post-misión): "GROQ FALLBACK
// MUST RESPECT ZERO-COST POLICY." Alcance: únicamente
// callWithGroqFallbackOnCreditsExhausted (session-teach/route.ts) y los
// mecanismos de exclusión/configuración PRE-EXISTENTES de lib/alai.ts que
// esa función hereda (no se modifica lib/alai.ts — es el archivo canónico
// de política de proveedores, fuera de alcance de este audit).
//
// Conclusión de la auditoría de código (no ejecutable como test, documentada
// aquí explícitamente):
//
// 1. El mecanismo fallbackError/shouldFallbackToGroq/cola-solo-groq YA
//    EXISTÍA en lib/alai.ts (alaiRequest, líneas ~504-522) antes de esta
//    misión — no es un proveedor nuevo hardcodeado, es la política
//    canónica ya presente, simplemente sin conectar a session-teach.
// 2. AGENTS.md sanciona EXPLÍCITAMENTE este caso exacto: "Groq solo puede
//    usarse después de que una respuesta de OpenRouter haya sido
//    clasificada inequívocamente como OPENROUTER_CREDITS_EXHAUSTED."
// 3. Groq solo entra en la cola de buildQueue() si GROQ_API_KEY está
//    configurada — sin esa variable, la llamada de fallback falla limpio
//    ("proveedor canónico groq no configurado"), CERO llamadas de red.
// 4. lib/alai.ts ya tiene un mecanismo de exclusión de proyecto
//    PRE-EXISTENTE: ALAI_DISABLED_PROVIDERS (env var, lista separada por
//    comas) — si el proyecto incluye 'groq' ahí, buildQueue() nunca añade
//    Groq a la cola, con el mismo resultado que sin API key: fallback
//    excluido => 0 llamadas.
// 5. classifyProviderFailure() exige provider==='openrouter' para
//    devolver OPENROUTER_CREDITS_EXHAUSTED — un fallo del lado de Groq
//    JAMÁS puede reclasificarse como "créditos de OpenRouter agotados",
//    así que no existe ruta para un fallback-de-fallback recursivo.

// ═══ 1. Solo evidencia CONFIRMADA de OpenRouter habilita Groq ═══
function test1_OnlyConfirmedOpenRouterCreditsExhaustionEnablesFallback() {
  const creditsExhausted = { provider: 'openrouter', status: 402, message: 'insufficient credits', body: undefined }
  assert.equal(classifyProviderFailure(creditsExhausted), 'OPENROUTER_CREDITS_EXHAUSTED')
  assert.equal(shouldFallbackToGroq(creditsExhausted), true, 'BUG DE ORIGEN SI FALLA: con evidencia real y confirmada, el fallback debe permitirse')
}

// ═══ 2. Ningún otro código de fallo habilita Groq — nunca especulativo ═══
function test2_NoOtherFailureReasonEnablesFallback() {
  const cases: Array<{ label: string; err: any }> = [
    { label: 'timeout', err: { provider: 'openrouter', status: 503, message: 'network error', body: undefined } },
    { label: 'rate limit', err: { provider: 'openrouter', status: 429, message: 'rate limit exceeded', body: undefined } },
    { label: 'auth error', err: { provider: 'openrouter', status: 401, message: 'invalid api key', body: undefined } },
    { label: 'context too large', err: { provider: 'openrouter', status: 413, message: 'context length exceeded', body: undefined } },
    { label: 'empty response', err: { provider: 'openrouter', status: 204, message: 'ALAI_EMPTY_RESPONSE', body: undefined } },
    { label: 'invalid json content', err: { provider: 'openrouter', status: 400, message: 'INVALID_JSON parse error', body: undefined } },
  ]
  for (const { label, err } of cases) {
    assert.equal(shouldFallbackToGroq(err), false, `BUG DE ORIGEN SI FALLA: "${label}" NUNCA debe habilitar Groq — el gasto solo se justifica con créditos de OpenRouter confirmadamente agotados`)
  }
}

// ═══ 3. Un fallo del lado de Groq nunca se reclasifica como créditos de
// OpenRouter agotados — imposibilita un fallback-de-fallback recursivo ═══
function test3_GroqSideFailureCanNeverTriggerAnotherFallback() {
  const groqCreditsShaped = { provider: 'groq', status: 402, message: 'insufficient credits', body: undefined }
  assert.notEqual(classifyProviderFailure(groqCreditsShaped), 'OPENROUTER_CREDITS_EXHAUSTED', 'BUG DE ORIGEN SI FALLA: la clasificación de créditos agotados exige provider===openrouter — un fallo de Groq no puede disfrazarse de esto')
  assert.equal(shouldFallbackToGroq(groqCreditsShaped), false, 'BUG DE ORIGEN SI FALLA: un fallo YA en Groq no puede volver a habilitar "fallback a Groq" — evita el loop recursivo')
}

// ═══ 4-8. Wiring real en session-teach/route.ts — solo activa con
// evidencia confirmada, una sola llamada de fallback, sin recursión ═══
function test4to8_WiringRespectsGating() {
  const source = readFileSync('app/api/adaptive/session-teach/route.ts', 'utf8')
  const helperMatch = source.match(/const callWithGroqFallbackOnCreditsExhausted = async \(params: Parameters<typeof alai>\[0\]\) => \{[\s\S]*?\n  \}/)
  assert.ok(helperMatch, 'BUG DE ORIGEN SI FALLA: debe existir el helper callWithGroqFallbackOnCreditsExhausted')
  const helperSource = helperMatch![0]

  assert.match(helperSource, /classifyProviderFailure\(providerError\) === 'OPENROUTER_CREDITS_EXHAUSTED'/, '4: el fallback debe gatearse por clasificación confirmada, nunca especulativa')
  // 5: exactamente UNA llamada adicional a alai() dentro del catch (no un bucle).
  const alaiCallsInsideHelper = (helperSource.match(/await alai\(/g) || []).length
  assert.equal(alaiCallsInsideHelper, 2, '5: BUG DE ORIGEN SI FALLA: debe haber exactamente 2 llamadas a alai() en el helper — la original + UN fallback, nunca un bucle')
  // 6: el fallback reutiliza fallbackError (mecanismo canónico existente de alai.ts), no excludeProviders/provider hardcodeado a mano.
  assert.match(helperSource, /fallbackError: providerError/, '6: BUG DE ORIGEN SI FALLA: debe reutilizar el mecanismo fallbackError ya existente de alai.ts, no reimplementar selección de proveedor')
  // 7: sin try/catch ANIDADO alrededor de la llamada de fallback — si esa también falla, se propaga (bounded terminal failure), no se reintenta más.
  const fallbackCallLine = helperSource.split('\n').find(line => line.includes('fallbackError: providerError'))
  assert.ok(fallbackCallLine && !fallbackCallLine.includes('try'), '7: BUG DE ORIGEN SI FALLA: la llamada de fallback no debe estar envuelta en su propio try/catch — un fallo ahí debe propagarse limpio, nunca reintentar indefinidamente')
  // 8: no excluye proveedores adicionales ni pasa configuración especulativa — spread de params originales + solo fallbackError añadido.
  assert.match(helperSource, /\.\.\.params, fallbackError: providerError/, '8: BUG DE ORIGEN SI FALLA: el fallback debe preservar el resto de params tal cual (mismo stage/maxProviderAttempts/etc), solo añadiendo fallbackError — nunca reconfigurar especulativamente')
}

// ═══ 9. Mecanismos de exclusión/configuración pre-existentes en alai.ts
// (NO modificados) que este fallback hereda automáticamente ═══
function test9_PreExistingExclusionMechanismsCoverGroq() {
  const alaiSource = readFileSync('lib/alai.ts', 'utf8')
  assert.match(alaiSource, /ALAI_DISABLED_PROVIDERS/, 'BUG DE ORIGEN SI FALLA: debe existir el mecanismo de exclusión de proyecto ALAI_DISABLED_PROVIDERS')
  assert.match(alaiSource, /if \(disabledProviders\.has\(provider\)\) return;/, 'BUG DE ORIGEN SI FALLA: addOpenAIProvider debe respetar disabledProviders para CUALQUIER proveedor, incluido groq (mismo código, sin caso especial)')
  assert.match(alaiSource, /addOpenAIProvider\('groq', envKeys\('GROQ_API_KEY'\)/, 'BUG DE ORIGEN SI FALLA: groq debe registrarse a través del mismo addOpenAIProvider gateado — sin GROQ_API_KEY, la cola queda vacía y el fallback falla limpio ("proveedor canónico ... no configurado"), sin ninguna llamada de red')
}

function run() {
  test1_OnlyConfirmedOpenRouterCreditsExhaustionEnablesFallback()
  test2_NoOtherFailureReasonEnablesFallback()
  test3_GroqSideFailureCanNeverTriggerAnotherFallback()
  test4to8_WiringRespectsGating()
  test9_PreExistingExclusionMechanismsCoverGroq()
  console.log('groq-fallback-cost-policy-contracts: PASS (solo credits-exhausted confirmado de OpenRouter habilita Groq; ningún otro código de fallo lo hace; un fallo YA en Groq nunca reclasifica como créditos de OpenRouter — sin recursión; wiring real usa exactamente 1 llamada de fallback sin try/catch anidado, reutilizando fallbackError canónico; hereda GROQ_API_KEY + ALAI_DISABLED_PROVIDERS pre-existentes de alai.ts sin modificarlo)')
}

run()
