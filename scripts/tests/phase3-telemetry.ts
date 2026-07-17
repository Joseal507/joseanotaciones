/**
 * FASE 3 — Tests de telemetría real conectada a Evidence
 * Ejecutar: npx tsx scripts/tests/phase3-telemetry.ts
 */

import {
  emptyEvidenceProfile,
  rebuildProfile,
  recordEvidence,
  type Evidence,
} from '../../lib/adaptive/v3/engine/evidenceEngine'
import {
  ASSISTANCE_LEVEL_ORDER,
  type AssistanceLevel,
} from '../../lib/adaptive/v3/engine/confidenceTracker'

// ─── Mini framework ──────────────────────────────────────────
let passed = 0
let failed = 0
const failures: string[] = []

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  ✓ ${msg}`)
    passed++
  } else {
    console.error(`  ✗ ${msg}`)
    failed++
    failures.push(msg)
  }
}
function section(name: string): void { console.log(`\n═══ ${name} ═══`) }

// ─── Helpers de telemetría (misma lógica que el route) ──────
const MAX_RESPONSE_TIME_MS = 10 * 60 * 1000

function normalizeResponseTimeMs(raw: unknown): number | undefined {
  if (typeof raw === 'number' && isFinite(raw) && raw >= 0)
    return Math.min(Math.round(raw), MAX_RESPONSE_TIME_MS)
  return undefined
}

function normalizeAssistanceLevel(raw: unknown): AssistanceLevel {
  if (typeof raw === 'string' && (ASSISTANCE_LEVEL_ORDER as readonly string[]).includes(raw))
    return raw as AssistanceLevel
  return 'independent'
}

function normalizeSelfReportedConfidence(raw: unknown): number | undefined {
  if (typeof raw === 'number' && isFinite(raw) && raw >= 0 && raw <= 100)
    return Math.round(raw)
  return undefined
}

const VALID_CONTEXTS = ['learning', 'immediate_practice', 'interleaving', 'delayed_retrieval', 'spaced_review'] as const
type InteractionCtx = typeof VALID_CONTEXTS[number]

function normalizeInteractionContext(raw: unknown): InteractionCtx | undefined {
  if (typeof raw === 'string' && (VALID_CONTEXTS as readonly string[]).includes(raw))
    return raw as InteractionCtx
  return undefined
}

// ═══════════════════════════════════════════════════════════════
// TEST 1 — VALIDACIÓN DEL BODY
// ═══════════════════════════════════════════════════════════════
section('TEST 1 — Validación y normalización del body')
{
  // Todos los campos válidos
  assert(normalizeResponseTimeMs(5000) === 5000, 'responseTimeMs válido: 5000')
  assert(normalizeResponseTimeMs(0) === 0, 'responseTimeMs = 0 es válido')
  assert(normalizeAssistanceLevel('guided') === 'guided', 'assistanceLevel válido: guided')
  assert(normalizeSelfReportedConfidence(80) === 80, 'selfReportedConfidence válido: 80')
  assert(normalizeInteractionContext('learning') === 'learning', 'interactionContext válido: learning')

  // Campos opcionales ausentes → defaults seguros
  assert(normalizeResponseTimeMs(undefined) === undefined, 'responseTimeMs ausente → undefined')
  assert(normalizeAssistanceLevel(undefined) === 'independent', 'assistanceLevel ausente → independent')
  assert(normalizeSelfReportedConfidence(undefined) === undefined, 'selfReportedConfidence ausente → undefined')
  assert(normalizeInteractionContext(undefined) === undefined, 'interactionContext ausente → undefined')

  // assistanceLevel inválido → independent (no aceptar silenciosamente)
  assert(normalizeAssistanceLevel('hinted') === 'independent', 'assistanceLevel inválido "hinted" → independent')
  assert(normalizeAssistanceLevel('INDEPENDENT') === 'independent', 'assistanceLevel case-sensitive → independent')
  assert(normalizeAssistanceLevel(42) === 'independent', 'assistanceLevel número → independent')
  assert(normalizeAssistanceLevel('revealed') === 'revealed', 'assistanceLevel "revealed" válido')

  // responseTimeMs negativo → undefined
  assert(normalizeResponseTimeMs(-100) === undefined, 'responseTimeMs negativo → undefined')
  assert(normalizeResponseTimeMs(NaN) === undefined, 'responseTimeMs NaN → undefined')
  assert(normalizeResponseTimeMs('5000') === undefined, 'responseTimeMs string → undefined')
  assert(normalizeResponseTimeMs(Infinity) === undefined, 'responseTimeMs Infinity → undefined')

  // Clamp máximo 10 min
  assert(normalizeResponseTimeMs(MAX_RESPONSE_TIME_MS + 1000) === MAX_RESPONSE_TIME_MS, 'responseTimeMs clamped a 10 min')
  assert(normalizeResponseTimeMs(MAX_RESPONSE_TIME_MS) === MAX_RESPONSE_TIME_MS, 'responseTimeMs exacto en límite OK')

  // selfReportedConfidence fuera de rango
  assert(normalizeSelfReportedConfidence(-1) === undefined, 'selfReportedConfidence -1 → undefined')
  assert(normalizeSelfReportedConfidence(101) === undefined, 'selfReportedConfidence 101 → undefined')
  assert(normalizeSelfReportedConfidence(0) === 0, 'selfReportedConfidence 0 válido')
  assert(normalizeSelfReportedConfidence(100) === 100, 'selfReportedConfidence 100 válido')
  assert(normalizeSelfReportedConfidence(80.7) === 81, 'selfReportedConfidence se redondea')

  // interactionContext inválido
  assert(normalizeInteractionContext('unknown_context') === undefined, 'interactionContext inválido → undefined')
  assert(normalizeInteractionContext(123) === undefined, 'interactionContext número → undefined')
  assert(normalizeInteractionContext('spaced_review') === 'spaced_review', 'spaced_review válido')
  assert(normalizeInteractionContext('delayed_retrieval') === 'delayed_retrieval', 'delayed_retrieval válido')
}

// ═══════════════════════════════════════════════════════════════
// TEST 2 — PROPAGACIÓN A recordEvidence
// ═══════════════════════════════════════════════════════════════
section('TEST 2 — Propagación real a recordEvidence')
{
  let profile = emptyEvidenceProfile('micro_prop')

  // Simular lo que hace el route tras normalizar
  const responseTimeMs = normalizeResponseTimeMs(7500)!
  const assistanceLevel = normalizeAssistanceLevel('minimal_hint')
  const selfReportedConfidence = normalizeSelfReportedConfidence(70)
  const interactionContext = normalizeInteractionContext('learning')

  profile = recordEvidence(profile, {
    formatUsed: 'multiple_choice',
    outcome: 'correct',
    score: 90,
    turnNumber: 1,
    assistanceLevel,
    responseTimeMs,
    selfReportedConfidence,
    interactionContext,
  })

  assert(profile.evidences.length === 1, 'se registró 1 evidencia')
  const ev = profile.evidences[0]
  assert(ev.assistanceLevel === 'minimal_hint', 'assistanceLevel propagado: minimal_hint')
  assert(ev.responseTimeMs === 7500, `responseTimeMs propagado: ${ev.responseTimeMs}`)
  assert(ev.selfReportedConfidence === 70, `selfReportedConfidence propagado: ${ev.selfReportedConfidence}`)
  assert(ev.interactionContext === 'learning', `interactionContext propagado: ${ev.interactionContext}`)

  // Verificar que independentSuccesses NO cuenta minimal_hint
  assert(profile.independentSuccesses === 0, 'minimal_hint no cuenta como independentSuccesses')
  assert(profile.maxAssistanceLevelUsed === 'minimal_hint', 'maxAssistanceLevelUsed = minimal_hint')
}

// ═══════════════════════════════════════════════════════════════
// TEST 3 — COMPATIBILIDAD LEGACY
// ═══════════════════════════════════════════════════════════════
section('TEST 3 — Compatibilidad con clientes legacy (sin los 4 campos)')
{
  // Body legacy: sin responseTimeMs, sin assistanceLevel, etc.
  const legacyBody = {
    userId: 'u1',
    materialId: 'm1',
    sessionId: 's1',
    studentAnswer: 'opcion_a',
    evalPreference: 'mix_everything',
    // SIN: responseTimeMs, assistanceLevel, selfReportedConfidence, interactionContext
  }

  const responseTimeMs = normalizeResponseTimeMs((legacyBody as any).responseTimeMs)
  const assistanceLevel = normalizeAssistanceLevel((legacyBody as any).assistanceLevel)
  const selfReportedConfidence = normalizeSelfReportedConfidence((legacyBody as any).selfReportedConfidence)
  const interactionContext = normalizeInteractionContext((legacyBody as any).interactionContext)

  assert(responseTimeMs === undefined, '[legacy] responseTimeMs = undefined')
  assert(assistanceLevel === 'independent', '[legacy] assistanceLevel = independent (default seguro)')
  assert(selfReportedConfidence === undefined, '[legacy] selfReportedConfidence = undefined')
  assert(interactionContext === undefined, '[legacy] interactionContext = undefined')

  // Registrar con defaults legacy — no debe romper
  let profile = emptyEvidenceProfile('micro_legacy')
  profile = recordEvidence(profile, {
    formatUsed: 'true_false',
    outcome: 'correct',
    score: 100,
    turnNumber: 1,
    assistanceLevel,
    responseTimeMs,
    selfReportedConfidence,
    interactionContext,
  })

  assert(profile.evidences.length === 1, '[legacy] evidencia registrada OK')
  assert(profile.evidences[0].assistanceLevel === 'independent', '[legacy] assistanceLevel = independent')
  assert(profile.evidences[0].responseTimeMs === undefined, '[legacy] responseTimeMs = undefined en Evidence')
  assert(profile.independentSuccesses === 1, '[legacy] independentSuccesses = 1 con default independent')
}

// ═══════════════════════════════════════════════════════════════
// TEST 4 — ASISTENCIA REAL
// ═══════════════════════════════════════════════════════════════
section('TEST 4 — Asistencia real por nivel')
{
  // Sin ayuda → independent
  assert(normalizeAssistanceLevel('independent') === 'independent', 'sin ayuda → independent')

  // Pista mínima → minimal_hint
  assert(normalizeAssistanceLevel('minimal_hint') === 'minimal_hint', 'pista mínima → minimal_hint')

  // Ayuda sustancial → assisted
  assert(normalizeAssistanceLevel('assisted') === 'assisted', 'ayuda sustancial → assisted')

  // Una demostración independiente posterior del MISMO tipo recupera ese tipo.
  // maxAssistanceLevelUsed es el máximo entre la mejor demostración de cada tipo,
  // no una penalización histórica permanente.
  let p = emptyEvidenceProfile('m_assist')
  p = recordEvidence(p, {
    formatUsed: 'multiple_choice',
    outcome: 'correct',
    score: 100,
    turnNumber: 1,
    assistanceLevel: 'assisted',
  })
  p = recordEvidence(p, {
    formatUsed: 'true_false',
    outcome: 'correct',
    score: 100,
    turnNumber: 2,
    assistanceLevel: 'independent',
  })
  assert(p.maxAssistanceLevelUsed === 'independent', 'mismo tipo recuperado: independent reemplaza assisted')
  assert(p.independentSuccesses === 1, 'solo 1 éxito independiente (la segunda)')

  // Si otro tipo de evidencia solo fue demostrado con ayuda, ese nivel sí persiste.
  p = recordEvidence(p, {
    formatUsed: 'fill_blank',
    outcome: 'correct',
    score: 100,
    turnNumber: 3,
    assistanceLevel: 'assisted',
  })
  assert(p.maxAssistanceLevelUsed === 'assisted', 'otro tipo aún asistido conserva el máximo del perfil')

  // Resetear en nueva actividad (simulado: perfil nuevo)
  let p2 = emptyEvidenceProfile('m_reset')
  p2 = recordEvidence(p2, {
    formatUsed: 'multiple_choice',
    outcome: 'correct',
    score: 100,
    turnNumber: 1,
    assistanceLevel: 'independent',
  })
  assert(p2.maxAssistanceLevelUsed === 'independent', 'nueva actividad empieza desde independent')
}

// ═══════════════════════════════════════════════════════════════
// TEST 5 — TIEMPO DE RESPUESTA
// ═══════════════════════════════════════════════════════════════
section('TEST 5 — Helper de tiempo de respuesta')
{
  // Diferencia correcta
  const start = 1000
  const end = 6500
  const diff = Math.round(end - start)
  assert(diff === 5500, 'diferencia correcta: 5500ms')

  // Nunca negativo
  assert(normalizeResponseTimeMs(-1) === undefined, 'negativo → undefined')
  assert(normalizeResponseTimeMs(0) === 0, '0 es válido')

  // Clamp máximo
  const overMax = MAX_RESPONSE_TIME_MS + 99999
  assert(normalizeResponseTimeMs(overMax) === MAX_RESPONSE_TIME_MS, 'clamp a 10 min')

  // Redondear a entero
  assert(normalizeResponseTimeMs(4500.7) === 4501, 'redondea a entero')
  assert(normalizeResponseTimeMs(4500.3) === 4500, 'redondea a entero (down)')

  // No numérico
  assert(normalizeResponseTimeMs('5000') === undefined, 'string → undefined')
  assert(normalizeResponseTimeMs(null) === undefined, 'null → undefined')
  assert(normalizeResponseTimeMs(undefined) === undefined, 'undefined → undefined')
}

// ═══════════════════════════════════════════════════════════════
// TEST 6 — CONTEXTO DE INTERACCIÓN
// ═══════════════════════════════════════════════════════════════
section('TEST 6 — Contexto de interacción')
{
  // Todos los contextos válidos
  for (const ctx of VALID_CONTEXTS) {
    assert(normalizeInteractionContext(ctx) === ctx, `contexto "${ctx}" válido`)
  }

  // Contextos inválidos
  assert(normalizeInteractionContext('exam') === undefined, '"exam" no es contexto válido')
  assert(normalizeInteractionContext('') === undefined, 'string vacío → undefined')
  assert(normalizeInteractionContext(null) === undefined, 'null → undefined')

  // Persistencia en Evidence
  let p = emptyEvidenceProfile('ctx_test')
  p = recordEvidence(p, {
    formatUsed: 'fill_blank',
    outcome: 'correct',
    score: 100,
    turnNumber: 1,
    assistanceLevel: 'independent',
    interactionContext: 'delayed_retrieval',
    elapsedSinceLastExposureMs: 21 * 60 * 60 * 1000,
  })
  assert(p.evidences[0].interactionContext === 'delayed_retrieval', 'interactionContext persiste en Evidence')
  assert(p.hasDelayedRecall === true, 'delayed_retrieval con intervalo suficiente activa hasDelayedRecall')

  // spaced_review también activa hasDelayedRecall
  let p2 = emptyEvidenceProfile('ctx_test2')
  p2 = recordEvidence(p2, {
    formatUsed: 'fill_blank',
    outcome: 'correct',
    score: 100,
    turnNumber: 1,
    assistanceLevel: 'independent',
    interactionContext: 'spaced_review',
    elapsedSinceLastExposureMs: 21 * 60 * 60 * 1000,
  })
  assert(p2.hasDelayedRecall === true, 'spaced_review con intervalo suficiente activa hasDelayedRecall')

  // La evidencia no arrastra interactionContext de actividad anterior
  let p3 = emptyEvidenceProfile('ctx_test3')
  p3 = recordEvidence(p3, {
    formatUsed: 'multiple_choice',
    outcome: 'correct',
    score: 100,
    turnNumber: 1,
    assistanceLevel: 'independent',
    interactionContext: 'learning',
  })
  p3 = recordEvidence(p3, {
    formatUsed: 'true_false',
    outcome: 'correct',
    score: 100,
    turnNumber: 2,
    assistanceLevel: 'independent',
    interactionContext: 'immediate_practice',  // diferente
  })
  assert(p3.evidences[0].interactionContext === 'learning', 'ev[0] mantiene su propio contexto')
  assert(p3.evidences[1].interactionContext === 'immediate_practice', 'ev[1] tiene su propio contexto')
}

// ═══════════════════════════════════════════════════════════════
// TEST 7 — ROUND TRIP COMPLETO
// ═══════════════════════════════════════════════════════════════
section('TEST 7 — Round trip: payload → recordEvidence → Evidence → JSON → rebuildProfile')
{
  // Payload del frontend (simulado)
  const frontendPayload = {
    studentAnswer: 'opcion_b',
    responseTimeMs: 8234,
    assistanceLevel: 'guided',
    selfReportedConfidence: 60,
    interactionContext: 'immediate_practice',
  }

  // Normalización (como hace el route)
  const rTime = normalizeResponseTimeMs(frontendPayload.responseTimeMs)!
  const aLevel = normalizeAssistanceLevel(frontendPayload.assistanceLevel)
  const sConf = normalizeSelfReportedConfidence(frontendPayload.selfReportedConfidence)
  const iCtx = normalizeInteractionContext(frontendPayload.interactionContext)

  // recordEvidence
  let profile = emptyEvidenceProfile('micro_rt_full')
  profile = recordEvidence(profile, {
    formatUsed: 'multiple_choice',
    outcome: 'correct',
    score: 85,
    turnNumber: 3,
    assistanceLevel: aLevel,
    responseTimeMs: rTime,
    selfReportedConfidence: sConf,
    interactionContext: iCtx,
  })

  // JSON round trip (como hace sessionStorage)
  const serialized = JSON.stringify({ microStates: { micro_rt_full: { evidenceProfile: profile } } })
  const deserialized = JSON.parse(serialized)
  const restoredRaw = deserialized.microStates.micro_rt_full.evidenceProfile
  const restored = rebuildProfile(restoredRaw.microId, restoredRaw.evidences)

  // Verificar que los 4 campos sobreviven intactos
  assert(restored.evidences[0].assistanceLevel === 'guided', '[round trip] assistanceLevel = guided')
  assert(restored.evidences[0].responseTimeMs === 8234, `[round trip] responseTimeMs = 8234 (got ${restored.evidences[0].responseTimeMs})`)
  assert(restored.evidences[0].selfReportedConfidence === 60, `[round trip] selfReportedConfidence = 60 (got ${restored.evidences[0].selfReportedConfidence})`)
  assert(restored.evidences[0].interactionContext === 'immediate_practice', '[round trip] interactionContext = immediate_practice')

  // Métricas derivadas correctas
  assert(restored.independentSuccesses === 0, '[round trip] guided no cuenta como independent')
  assert(restored.maxAssistanceLevelUsed === 'guided', `[round trip] maxAssistanceLevelUsed = guided (got ${restored.maxAssistanceLevelUsed})`)
  assert(typeof restored.masteryScore === 'number' && !isNaN(restored.masteryScore), '[round trip] masteryScore válido')
}

// ═══════════════════════════════════════════════════════════════
// TEST 8 — REGRESIÓN: route sin telemetría deja campos en default
// ═══════════════════════════════════════════════════════════════
section('TEST 8 — Regresión: sin telemetría los campos quedan en defaults seguros')
{
  // Comportamiento anterior (Fase 2): recordEvidence se llamaba sin los 4 campos
  // Esto debe seguir funcionando pero producir defaults canónicos

  let profileLegacy = emptyEvidenceProfile('micro_regression')
  profileLegacy = recordEvidence(profileLegacy, {
    formatUsed: 'multiple_choice',
    outcome: 'correct',
    score: 100,
    turnNumber: 1,
    // SIN assistanceLevel, responseTimeMs, selfReportedConfidence, interactionContext
  })

  assert(
    profileLegacy.evidences[0].assistanceLevel === 'independent',
    '[REGRESIÓN] sin assistanceLevel → default independent',
  )
  assert(
    profileLegacy.evidences[0].responseTimeMs === undefined,
    '[REGRESIÓN] sin responseTimeMs → undefined (no inventado)',
  )
  assert(
    profileLegacy.evidences[0].selfReportedConfidence === undefined,
    '[REGRESIÓN] sin selfReportedConfidence → undefined (no inventado)',
  )
  assert(
    profileLegacy.independentSuccesses === 1,
    '[REGRESIÓN] default independent cuenta como éxito independiente',
  )

  // Verificar que ASSISTANCE_LEVEL_ORDER es exportado y tiene todos los niveles
  assert(ASSISTANCE_LEVEL_ORDER.length === 5, 'ASSISTANCE_LEVEL_ORDER tiene 5 niveles')
  assert(ASSISTANCE_LEVEL_ORDER[0] === 'independent', 'primer nivel = independent')
  assert(ASSISTANCE_LEVEL_ORDER[4] === 'revealed', 'último nivel = revealed')
  assert(
    !(ASSISTANCE_LEVEL_ORDER as readonly string[]).includes('hinted'),
    '"hinted" NO existe en ASSISTANCE_LEVEL_ORDER',
  )
}

// ─── RESUMEN ────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50))
console.log(`RESULTADO: ${passed} passed, ${failed} failed`)
if (failures.length > 0) {
  console.log('\nFALLOS:')
  failures.forEach(f => console.log(`  ✗ ${f}`))
  process.exit(1)
} else {
  console.log('✓ Todos los tests pasaron')
  process.exit(0)
}
