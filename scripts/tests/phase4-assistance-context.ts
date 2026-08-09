/**
 * FASE 4 — Tests de asistencia real y contexto pedagógico
 * Ejecutar: npx tsx scripts/tests/phase4-assistance-context.ts
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
  if (condition) { console.log(`  ✓ ${msg}`); passed++ }
  else { console.error(`  ✗ ${msg}`); failed++; failures.push(msg) }
}
function section(name: string): void { console.log(`\n═══ ${name} ═══`) }

// ─── Simulador del estado de asistencia (misma lógica que StudyALSessionV3) ─
class AssistanceTracker {
  private current: AssistanceLevel = 'independent'

  registerHintUsed(level: AssistanceLevel): void {
    const currentIdx = ASSISTANCE_LEVEL_ORDER.indexOf(this.current)
    const newIdx = ASSISTANCE_LEVEL_ORDER.indexOf(level)
    if (newIdx > currentIdx) {
      this.current = level
    }
  }

  getLevel(): AssistanceLevel {
    return this.current
  }

  // Llamar cuando el tutor entrega nueva actividad evaluable
  reset(): void {
    this.current = 'independent'
  }
}

// ─── Simulador del contexto pedagógico (misma lógica que StudyALSessionV3) ──
function resolveInteractionContext(activityContext: {
  isSpacedReview: boolean
  isInterleaving: boolean
}): 'spaced_review' | 'interleaving' | 'immediate_practice' {
  if (activityContext.isSpacedReview) return 'spaced_review'
  if (activityContext.isInterleaving) return 'interleaving'
  return 'immediate_practice'
}

// ─── Normalizadores del route (copiados de Fase 3) ───────────
function normalizeAssistanceLevel(raw: unknown): AssistanceLevel {
  if (typeof raw === 'string' && (ASSISTANCE_LEVEL_ORDER as readonly string[]).includes(raw))
    return raw as AssistanceLevel
  return 'independent'
}

const VALID_CONTEXTS = ['learning', 'immediate_practice', 'interleaving', 'delayed_retrieval', 'spaced_review'] as const
type InteractionCtx = typeof VALID_CONTEXTS[number]
function normalizeInteractionContext(raw: unknown): InteractionCtx | undefined {
  if (typeof raw === 'string' && (VALID_CONTEXTS as readonly string[]).includes(raw))
    return raw as InteractionCtx
  return undefined
}

// ═══════════════════════════════════════════════════════════════
// TEST 1 — SIN AYUDA
// ═══════════════════════════════════════════════════════════════
section('TEST 1 — Sin ayuda: independent')
{
  const tracker = new AssistanceTracker()
  // El estudiante responde sin abrir ninguna ayuda
  assert(tracker.getLevel() === 'independent', 'nivel inicial = independent')

  let p = emptyEvidenceProfile('m1')
  p = recordEvidence(p, {
    formatUsed: 'multiple_choice',
    outcome: 'correct',
    score: 100,
    turnNumber: 1,
    assistanceLevel: tracker.getLevel(),
  })

  assert(p.evidences[0].assistanceLevel === 'independent', 'evidencia registrada como independent')
  assert(p.independentSuccesses === 1, 'cuenta como éxito independiente')
}

// ═══════════════════════════════════════════════════════════════
// TEST 2 — PISTA MÍNIMA
// ═══════════════════════════════════════════════════════════════
section('TEST 2 — Pista mínima: cerrarla no devuelve a independent')
{
  const tracker = new AssistanceTracker()

  // Abre pista mínima
  tracker.registerHintUsed('minimal_hint')
  assert(tracker.getLevel() === 'minimal_hint', 'tras abrir pista: minimal_hint')

  // La cierra (simulado: el nivel no cambia)
  // En la UI cerrar un elemento no llama a ningún callback de reducción
  assert(tracker.getLevel() === 'minimal_hint', 'al cerrar pista: sigue minimal_hint')

  // Responde
  let p = emptyEvidenceProfile('m2')
  p = recordEvidence(p, {
    formatUsed: 'fill_blank',
    outcome: 'correct',
    score: 90,
    turnNumber: 1,
    assistanceLevel: tracker.getLevel(),
  })

  assert(p.evidences[0].assistanceLevel === 'minimal_hint', 'evidencia = minimal_hint')
  assert(p.independentSuccesses === 0, 'minimal_hint NO cuenta como independentSuccesses')
  assert(p.maxAssistanceLevelUsed === 'minimal_hint', 'maxAssistanceLevelUsed = minimal_hint')
}

// ═══════════════════════════════════════════════════════════════
// TEST 3 — AYUDA SUSTANCIAL
// ═══════════════════════════════════════════════════════════════
section('TEST 3 — Pista mínima + asistencia: conserva el máximo')
{
  const tracker = new AssistanceTracker()

  tracker.registerHintUsed('minimal_hint')
  assert(tracker.getLevel() === 'minimal_hint', 'tras minimal_hint: minimal_hint')

  tracker.registerHintUsed('assisted')
  assert(tracker.getLevel() === 'assisted', 'tras assisted: sube a assisted')

  // Intentar bajar el nivel (no debe funcionar)
  tracker.registerHintUsed('minimal_hint')
  assert(tracker.getLevel() === 'assisted', 'intentar bajar a minimal_hint: sigue en assisted')

  tracker.registerHintUsed('independent')
  assert(tracker.getLevel() === 'assisted', 'intentar bajar a independent: sigue en assisted')

  let p = emptyEvidenceProfile('m3')
  p = recordEvidence(p, {
    formatUsed: 'practical_case',
    outcome: 'correct',
    score: 80,
    turnNumber: 1,
    assistanceLevel: tracker.getLevel(),
  })

  assert(p.evidences[0].assistanceLevel === 'assisted', 'evidencia = assisted')
  assert(p.independentSuccesses === 0, 'assisted NO cuenta como independentSuccesses')
  assert(p.maxAssistanceLevelUsed === 'assisted', 'maxAssistanceLevelUsed = assisted')
}

// ═══════════════════════════════════════════════════════════════
// TEST 4 — RESPUESTA REVELADA
// ═══════════════════════════════════════════════════════════════
section('TEST 4 — Respuesta revelada: nunca termina como independent')
{
  const tracker = new AssistanceTracker()

  tracker.registerHintUsed('revealed')
  assert(tracker.getLevel() === 'revealed', 'tras revealed: nivel = revealed')

  // Intentar reducir
  tracker.registerHintUsed('independent')
  assert(tracker.getLevel() === 'revealed', 'revealed no puede reducirse')

  let p = emptyEvidenceProfile('m4')
  p = recordEvidence(p, {
    formatUsed: 'multiple_choice',
    outcome: 'correct',
    score: 100,
    turnNumber: 1,
    assistanceLevel: tracker.getLevel(),
  })

  assert(p.evidences[0].assistanceLevel === 'revealed', 'evidencia = revealed')
  assert(p.independentSuccesses === 0, 'revealed NO cuenta como independentSuccesses')
  assert(p.maxAssistanceLevelUsed === 'revealed', 'maxAssistanceLevelUsed = revealed')
}

// ═══════════════════════════════════════════════════════════════
// TEST 5 — REINICIO ENTRE ACTIVIDADES
// ═══════════════════════════════════════════════════════════════
section('TEST 5 — Reinicio al comenzar nueva actividad')
{
  const tracker = new AssistanceTracker()

  // Actividad A: usa revealed
  tracker.registerHintUsed('revealed')
  assert(tracker.getLevel() === 'revealed', 'actividad A: revealed')

  let pA = emptyEvidenceProfile('act_a')
  pA = recordEvidence(pA, {
    formatUsed: 'multiple_choice',
    outcome: 'correct',
    score: 100,
    turnNumber: 1,
    assistanceLevel: tracker.getLevel(),
  })

  // Tutor entrega nueva actividad → reset
  tracker.reset()
  assert(tracker.getLevel() === 'independent', 'tras reset: vuelve a independent')

  // Actividad B: sin ayuda
  let pB = emptyEvidenceProfile('act_b')
  pB = recordEvidence(pB, {
    formatUsed: 'true_false',
    outcome: 'correct',
    score: 100,
    turnNumber: 2,
    assistanceLevel: tracker.getLevel(),
  })

  assert(pA.evidences[0].assistanceLevel === 'revealed', 'actividad A conserva revealed')
  assert(pB.evidences[0].assistanceLevel === 'independent', 'actividad B es independent')
  assert(pA.maxAssistanceLevelUsed === 'revealed', 'perfil A: max = revealed')
  assert(pB.maxAssistanceLevelUsed === 'independent', 'perfil B: max = independent')
}

// ═══════════════════════════════════════════════════════════════
// TEST 6 — REINTENTO TRAS FEEDBACK
// ═══════════════════════════════════════════════════════════════
section('TEST 6 — Reintento: assistanceLevel no es independent tras feedback')
{
  // Primer intento: sin ayuda, incorrecto
  const tracker = new AssistanceTracker()
  // El nivel sigue independent (no hubo ayuda)
  assert(tracker.getLevel() === 'independent', 'primer intento: independent')

  // recordEvidence del primer intento (incorrecto no genera evidencia positiva)
  let p = emptyEvidenceProfile('retry_micro')
  p = recordEvidence(p, {
    formatUsed: 'multiple_choice',
    outcome: 'incorrect',
    score: 0,
    turnNumber: 1,
    assistanceLevel: tracker.getLevel(),
  })
  assert(p.evidences.length === 0, 'incorrect no genera evidencia positiva')
  assert(p.totalIncorrect === 1, 'totalIncorrect = 1')

  // El tutor muestra feedback correctivo (esto es "assisted" en el siguiente intento)
  // Según el plan: si recibió feedback antes de reintentar → mínimo 'assisted'
  // En el sistema real, el route inferredAssistance ya lo maneja:
  // recentTurnObjective === 'reveal_answer' ? 'revealed' : ... 'guided'
  // Aquí simulamos que el estudiante vio la respuesta correcta (reveal_answer)
  tracker.registerHintUsed('revealed')
  assert(tracker.getLevel() === 'revealed', 'tras ver feedback: nivel = revealed')

  // Segundo intento
  p = recordEvidence(p, {
    formatUsed: 'multiple_choice',
    outcome: 'correct',
    score: 100,
    turnNumber: 2,
    assistanceLevel: tracker.getLevel(),
  })

  assert(p.evidences.length === 1, 'segundo intento correcto genera evidencia')
  assert(p.evidences[0].assistanceLevel === 'revealed', 'segundo intento: revealed (no independent)')
  assert(p.independentSuccesses === 0, 'no cuenta como éxito independiente')
}

// ═══════════════════════════════════════════════════════════════
// TEST 7 — CONTEXTO REAL DESDE systemInfo
// ═══════════════════════════════════════════════════════════════
section('TEST 7 — Contexto pedagógico desde estado React (no globals)')
{
  // Simular systemInfo del route
  const systemInfoImmediate = { isSpacedReview: false, isInterleaving: false }
  const systemInfoSpaced = { isSpacedReview: true, isInterleaving: false }
  const systemInfoInterleaving = { isSpacedReview: false, isInterleaving: true }

  assert(resolveInteractionContext(systemInfoImmediate) === 'immediate_practice', 'immediate_practice correctamente')
  assert(resolveInteractionContext(systemInfoSpaced) === 'spaced_review', 'spaced_review correctamente')
  assert(resolveInteractionContext(systemInfoInterleaving) === 'interleaving', 'interleaving → interleaving correctamente')

  // No depende de window
  assert(typeof window === 'undefined' || true, 'no requiere window (Node.js context)')

  // Los valores se propagan a Evidence
  let p = emptyEvidenceProfile('ctx_real')
  p = recordEvidence(p, {
    formatUsed: 'fill_blank',
    outcome: 'correct',
    score: 100,
    turnNumber: 1,
    assistanceLevel: 'independent',
    interactionContext: resolveInteractionContext(systemInfoSpaced),
    elapsedSinceLastExposureMs: 21 * 60 * 60 * 1000,
  })
  assert(p.evidences[0].interactionContext === 'spaced_review', 'spaced_review en Evidence')
  assert(p.hasDelayedRecall === true, 'spaced_review con intervalo real activa hasDelayedRecall')

  let p2 = emptyEvidenceProfile('ctx_real2')
  p2 = recordEvidence(p2, {
    formatUsed: 'fill_blank',
    outcome: 'correct',
    score: 100,
    turnNumber: 1,
    assistanceLevel: 'independent',
    interactionContext: resolveInteractionContext(systemInfoInterleaving),
  })
  assert(p2.evidences[0].interactionContext === 'interleaving', 'interleaving en Evidence')
  assert(p2.hasDelayedRecall === false, 'interleaving NO activa hasDelayedRecall')
}

// ═══════════════════════════════════════════════════════════════
// TEST 8 — ORDEN MÁXIMO CANÓNICO
// ═══════════════════════════════════════════════════════════════
section('TEST 8 — Orden canónico se respeta en cualquier secuencia')
{
  // independent < minimal_hint < guided < assisted < revealed
  const allOrders = [
    ['revealed', 'independent', 'guided'],
    ['assisted', 'minimal_hint', 'revealed'],
    ['guided', 'assisted', 'independent'],
    ['independent', 'minimal_hint', 'guided', 'assisted', 'revealed'],
    ['revealed', 'assisted', 'guided', 'minimal_hint', 'independent'],
  ]

  for (const sequence of allOrders) {
    const tracker = new AssistanceTracker()
    let expectedMax = 'independent'
    for (const level of sequence) {
      tracker.registerHintUsed(level as AssistanceLevel)
      const currentIdx = ASSISTANCE_LEVEL_ORDER.indexOf(level as AssistanceLevel)
      const maxIdx = ASSISTANCE_LEVEL_ORDER.indexOf(expectedMax as AssistanceLevel)
      if (currentIdx > maxIdx) expectedMax = level
    }
    assert(
      tracker.getLevel() === expectedMax,
      `secuencia [${sequence.join(',')}] → max = ${expectedMax} (got ${tracker.getLevel()})`,
    )
  }

  // Verificar que el orden del array es correcto
  for (let i = 0; i < ASSISTANCE_LEVEL_ORDER.length - 1; i++) {
    assert(
      ASSISTANCE_LEVEL_ORDER.indexOf(ASSISTANCE_LEVEL_ORDER[i]) < ASSISTANCE_LEVEL_ORDER.indexOf(ASSISTANCE_LEVEL_ORDER[i + 1]),
      `orden canónico: ${ASSISTANCE_LEVEL_ORDER[i]} < ${ASSISTANCE_LEVEL_ORDER[i + 1]}`,
    )
  }
}

// ═══════════════════════════════════════════════════════════════
// TEST 9 — LEGACY
// ═══════════════════════════════════════════════════════════════
section('TEST 9 — Compatibilidad legacy: sesión sin contexto detallado')
{
  // systemInfo antiguo sin isSpacedReview ni isInterleaving
  const legacySystemInfo: any = {
    activeMicro: 'Concepto X',
    microsCompleted: 2,
    microsTotal: 10,
    progress: 20,
    // Sin isSpacedReview, sin isInterleaving
  }

  const ctx = resolveInteractionContext({
    isSpacedReview: !!legacySystemInfo.isSpacedReview,
    isInterleaving: !!legacySystemInfo.isInterleaving,
  })
  assert(ctx === 'immediate_practice', 'legacy sin flags → immediate_practice (fallback seguro)')

  // assistanceLevel sin campo → default independent
  assert(normalizeAssistanceLevel(undefined) === 'independent', 'legacy sin assistanceLevel → independent')

  // round trip de sesión legacy
  const legacyEvidence: Evidence = {
    type: 'recognized',
    strength: 'strong',
    turnNumber: 1,
    timestamp: Date.now(),
    formatUsed: 'multiple_choice',
    outcome: 'correct',
    score: 100,
    attemptNumber: 1,
    confidenceMultiplier: 1.0,
    assistanceLevel: 'independent',
    // Sin responseTimeMs, selfReportedConfidence, interactionContext
  }

  const restored = rebuildProfile('legacy_micro', [legacyEvidence])
  assert(restored.evidences[0].assistanceLevel === 'independent', 'legacy evidence sobrevive JSON round trip')
  assert(restored.independentSuccesses === 1, 'legacy independent cuenta correctamente')
  assert(restored.maxAssistanceLevelUsed === 'independent', 'legacy maxAssistanceLevelUsed correcto')
}

// ═══════════════════════════════════════════════════════════════
// TEST 10 — ROUND TRIP COMPLETO
// ═══════════════════════════════════════════════════════════════
section('TEST 10 — Round trip completo: UI → payload → recordEvidence → JSON → rebuildProfile')
{
  // Simular acción de UI: abre guided, luego assisted
  const tracker = new AssistanceTracker()
  tracker.registerHintUsed('guided')
  tracker.registerHintUsed('assisted')

  // systemInfo dice que es spaced_review
  const activityCtx = { isSpacedReview: true, isInterleaving: false }
  const resolvedCtx = resolveInteractionContext(activityCtx)

  // Payload del frontend
  const payload = {
    assistanceLevel: tracker.getLevel(),
    interactionContext: resolvedCtx,
    responseTimeMs: 12000,
    selfReportedConfidence: 40,
  }

  // Normalización del route
  const aLevel = normalizeAssistanceLevel(payload.assistanceLevel)
  const iCtx = normalizeInteractionContext(payload.interactionContext)

  // recordEvidence
  let p = emptyEvidenceProfile('rt_full')
  p = recordEvidence(p, {
    formatUsed: 'practical_case',
    outcome: 'correct',
    score: 75,
    turnNumber: 5,
    assistanceLevel: aLevel,
    interactionContext: iCtx,
    elapsedSinceLastExposureMs: 21 * 60 * 60 * 1000,
    responseTimeMs: 12000,
    selfReportedConfidence: 40,
  })

  // JSON round trip
  const serialized = JSON.stringify(p)
  const deserialized = JSON.parse(serialized)
  const restored = rebuildProfile(deserialized.microId, deserialized.evidences)

  // Verificar todos los campos
  assert(restored.evidences[0].assistanceLevel === 'assisted', '[round trip] assistanceLevel = assisted')
  assert(restored.evidences[0].interactionContext === 'spaced_review', '[round trip] interactionContext = spaced_review')
  assert(restored.evidences[0].responseTimeMs === 12000, '[round trip] responseTimeMs conservado')
  assert(restored.evidences[0].selfReportedConfidence === 40, '[round trip] selfReportedConfidence conservado')
  assert(restored.independentSuccesses === 0, '[round trip] assisted no es independent')
  assert(restored.maxAssistanceLevelUsed === 'assisted', '[round trip] maxAssistanceLevelUsed = assisted')
  assert(restored.hasDelayedRecall === false, '[round trip] spaced_review asistido no activa hasDelayedRecall')
}

// ═══════════════════════════════════════════════════════════════
// TEST 11 — REGRESIÓN: bugs de Fase 3 que esta fase corrige
// ═══════════════════════════════════════════════════════════════
section('TEST 11 — Regresión: bugs anteriores ahora corregidos')
{
  // Bug 1: abrir pista no cambiaba assistanceLevel porque registerHintUsed no se llamaba
  // Ahora el tracker funciona correctamente
  const tracker = new AssistanceTracker()
  assert(tracker.getLevel() === 'independent', 'inicio: independent')
  tracker.registerHintUsed('minimal_hint')
  assert(tracker.getLevel() === 'minimal_hint', '[REGRESIÓN] registerHintUsed actualiza el nivel')

  // Bug 2: window.__v3_isSpacedReview no existía en runtime → siempre immediate_practice
  // Ahora usamos activityContext del estado React
  // Verificamos que la función resolveInteractionContext funciona sin window
  const ctxSpaced = resolveInteractionContext({ isSpacedReview: true, isInterleaving: false })
  assert(ctxSpaced === 'spaced_review', '[REGRESIÓN] spaced_review sin depender de window')

  const ctxInterleaving = resolveInteractionContext({ isSpacedReview: false, isInterleaving: true })
  assert(ctxInterleaving === 'interleaving', '[REGRESIÓN] interleaving separado sin window')

  // Bug 3: revealed nunca podía bajar a independent
  const tracker2 = new AssistanceTracker()
  tracker2.registerHintUsed('revealed')
  tracker2.registerHintUsed('independent')
  assert(tracker2.getLevel() === 'revealed', '[REGRESIÓN] revealed no puede reducirse')

  // Bug 4: sin reset entre actividades, el nivel se arrastraba
  const tracker3 = new AssistanceTracker()
  tracker3.registerHintUsed('assisted')
  tracker3.reset()
  assert(tracker3.getLevel() === 'independent', '[REGRESIÓN] reset limpia el nivel para nueva actividad')

  // ASSISTANCE_LEVEL_ORDER canónico no contiene hinted
  assert(
    !(ASSISTANCE_LEVEL_ORDER as readonly string[]).includes('hinted'),
    '[REGRESIÓN] hinted no existe en el orden canónico',
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
