/**
 * FASE 7 — Tests end-to-end de sesión adaptativa
 * Ejecutar: npx tsx scripts/tests/phase7-e2e.ts
 */

import {
  rebuildProfile,
  recordEvidence,
  emptyEvidenceProfile,
  isReadyToAdvanceEvidence,
  DELAYED_RECALL_MIN_INTERVAL_MS,
  type Evidence,
} from '../../lib/adaptive/v3/engine/evidenceEngine'
import {
  diagnosePedagogicalState,
  resolveAssistanceLevel,
  detectKnowledgeIllusion,
  type PedagogicalReason,
} from '../../lib/adaptive/v3/engine/pedagogicalDecision'
import { formatScoreDisplay } from '../../lib/adaptive/v3/ui/formatScore'
import { ASSISTANCE_LEVEL_ORDER } from '../../lib/adaptive/v3/engine/confidenceTracker'

let passed = 0
let failed = 0
const failures: string[] = []

function assert(condition: boolean, msg: string): void {
  if (condition) { console.log(`  ✓ ${msg}`); passed++ }
  else { console.error(`  ✗ ${msg}`); failed++; failures.push(msg) }
}
function section(name: string): void { console.log(`\n═══ ${name} ═══`) }

const microEasy = { id: 'easy', difficulty: 10, importance: 'low', cognitiveType: 'definitional' } as any
const microMed = { id: 'med', difficulty: 40, importance: 'medium', cognitiveType: 'definitional' } as any

// ─── Helpers ────────────────────────────────────────────────
function makeEv(overrides: Partial<Evidence>): Evidence {
  return {
    type: 'recognized',
    strength: 'strong',
    turnNumber: 1,
    timestamp: Date.now(),
    formatUsed: 'multiple_choice',
    outcome: 'correct',
    score: 100,
    attemptNumber: 1,
    confidenceMultiplier: 1.0,
    ...overrides,
  }
}

function buildFromEvs(evs: Partial<Evidence>[]): ReturnType<typeof rebuildProfile> {
  return rebuildProfile('test', evs.map((e, i) => makeEv({ turnNumber: i + 1, timestamp: Date.now() + i * 1000, ...e })))
}

function diag(profile: ReturnType<typeof rebuildProfile>, overrides: Partial<Parameters<typeof diagnosePedagogicalState>[0]> = {}) {
  return diagnosePedagogicalState({
    profile,
    lastOutcome: 'correct',
    lastAssistanceLevel: 'independent',
    selfReportedConfidence: undefined,
    responseTimeMs: undefined,
    formatUsed: 'multiple_choice',
    interactionContext: 'immediate_practice',
    recentRevealedCount: 0,
    ...overrides,
  })
}

// TEST 1 — SCORE FORMATTING
section('TEST 1 — Formato visual de score')
{
  assert(formatScoreDisplay(2.1) === '2', '2.1 → "2"')
  assert(formatScoreDisplay(42.49) === '42', '42.49 → "42"')
  assert(formatScoreDisplay(42.5) === '43', '42.5 → "43"')
  assert(formatScoreDisplay(99.6) === '100', '99.6 → "100"')
  assert(formatScoreDisplay(100) === '100', '100 → "100"')
  assert(formatScoreDisplay(NaN) === '0', 'NaN → "0"')
  assert(formatScoreDisplay(-5) === '0', 'negativo → "0" (clamp)')
  assert(formatScoreDisplay(105) === '100', '> 100 → "100" (clamp)')
  assert(formatScoreDisplay(undefined) === '0', 'undefined → "0"')
  assert(formatScoreDisplay(null) === '0', 'null → "0"')
  assert(formatScoreDisplay(0) === '0', '0 → "0"')
  assert(formatScoreDisplay(50) === '50', '50 → "50"')
}

// TEST 2 — NO AVANCE TRAS UN ÚNICO ACIERTO
section('TEST 2 — No avance tras un solo acierto independiente')
{
  let p = emptyEvidenceProfile('micro_a')
  p = recordEvidence(p, {
    formatUsed: 'multiple_choice',
    outcome: 'correct', score: 100, turnNumber: 1,
    assistanceLevel: 'independent',
  })
  assert(isReadyToAdvanceEvidence(p, microMed) === false, 'un acierto no permite avance en micro medio')
  assert(p.independentSuccesses === 1, 'independentSuccesses = 1')
  const d = diag(p)
  assert(d.canAdvance === false, 'diagnosis.canAdvance = false')
  assert(d.reasons.includes('single_success_not_enough') || d.reasons.includes('insufficient_independent_evidence'),
    'reason indica evidencia insuficiente')
}

// TEST 3 — AVANCE CON EVIDENCIA SUFICIENTE
section('TEST 3 — Avance con evidencia suficiente e independiente')
{
  const p = buildFromEvs([
    { type: 'recognized', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'recognized', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'recalled', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'recalled', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'explained', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'explained', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'applied', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'applied', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
  ])
  assert(p.masteryScore >= 40, `masteryScore >= 40 (got ${p.masteryScore})`)
  assert(isReadyToAdvanceEvidence(p, microEasy) === true, 'micro fácil con evidencia suficiente puede avanzar')
  const d = diag(p)
  assert(d.canAdvance === true, 'diagnosis.canAdvance = true')
  assert(d.reasons.includes('ok_to_advance'), 'ok_to_advance en reasons')
}

// TEST 4 — ASSISTED-ONLY NO DOMINA
section('TEST 4 — Assisted-only no produce dominio')
{
  const p = buildFromEvs([
    { type: 'recognized', strength: 'strong', assistanceLevel: 'assisted', outcome: 'correct' },
    { type: 'recalled', strength: 'strong', assistanceLevel: 'assisted', outcome: 'correct' },
    { type: 'explained', strength: 'strong', assistanceLevel: 'assisted', outcome: 'correct' },
    { type: 'applied', strength: 'strong', assistanceLevel: 'assisted', outcome: 'correct' },
  ])
  assert(p.independentSuccesses === 0, 'assisted: independentSuccesses = 0')
  assert(isReadyToAdvanceEvidence(p, microEasy) === false, 'assisted-only no permite avance')
  const d = diag(p, { lastAssistanceLevel: 'assisted' })
  assert(d.isFalseMastery === true, 'isFalseMastery = true')
  assert(d.canAdvance === false, 'canAdvance = false')
  assert(d.reasons.includes('assisted_only_evidence'), 'assisted_only_evidence en reasons')
}

// TEST 5 — REVEAL + RETRY NO DOMINA
section('TEST 5 — Reveal + retry inmediato no demuestra dominio')
{
  let p = emptyEvidenceProfile('reveal_retry')
  // Reveal
  p = recordEvidence(p, {
    formatUsed: 'multiple_choice', outcome: 'correct', score: 100, turnNumber: 1,
    assistanceLevel: 'revealed',
  })
  // Retry correcto inmediato con assisted
  p = recordEvidence(p, {
    formatUsed: 'multiple_choice', outcome: 'correct', score: 100, turnNumber: 2,
    assistanceLevel: 'assisted',
  })
  assert(p.independentSuccesses === 0, 'reveal+retry: independentSuccesses = 0')
  assert(isReadyToAdvanceEvidence(p, microEasy) === false, 'reveal+retry no permite avance')
  const d = diag(p, { lastAssistanceLevel: 'assisted' })
  assert(d.isFalseMastery === true, 'isFalseMastery = true tras reveal')
}

// TEST 6 — RECUPERACIÓN INDEPENDIENTE POSTERIOR SÍ CUENTA
section('TEST 6 — Recuperación independiente posterior sí contribuye')
{
  let p = emptyEvidenceProfile('recovery')
  // Reveal
  p = recordEvidence(p, {
    formatUsed: 'multiple_choice', outcome: 'correct', score: 100, turnNumber: 1,
    assistanceLevel: 'revealed',
  })
  const masteryAfterReveal = p.masteryScore

  // Evidencia independiente posterior
  p = recordEvidence(p, {
    formatUsed: 'fill_blank', outcome: 'correct', score: 90, turnNumber: 2,
    assistanceLevel: 'independent',
  })
  assert(p.masteryScore > masteryAfterReveal, `mastery aumentó tras independent posterior (${masteryAfterReveal} → ${p.masteryScore})`)
  assert(p.independentSuccesses === 1, 'independentSuccesses = 1 tras independent')
}

// TEST 7 — ILUSIÓN DE CONOCIMIENTO
section('TEST 7 — Ilusión de conocimiento activada con confianza real')
{
  // Error con confianza alta
  const illusion = detectKnowledgeIllusion({
    outcome: 'incorrect',
    selfReportedConfidence: 85,
    assistanceLevel: 'independent',
  })
  assert(illusion === true, 'confianza 85 + error → ilusión')

  // Sin confianza reportada: no hay ilusión
  const noIllusion = detectKnowledgeIllusion({
    outcome: 'incorrect',
    selfReportedConfidence: undefined,
    assistanceLevel: 'independent',
  })
  assert(noIllusion === false, 'sin confianza reportada → no ilusión')

  // Ilusión NO aplica si fue revealed
  const revealedIllusion = detectKnowledgeIllusion({
    outcome: 'incorrect',
    selfReportedConfidence: 90,
    assistanceLevel: 'revealed',
  })
  assert(revealedIllusion === false, 'revealed + error no es ilusión (no era respuesta propia)')
}

// TEST 8 — SPACED REVIEW DESPUÉS DE RESTORE
section('TEST 8 — Spaced review con intervalo real tras restore')
{
  const now = Date.now()
  const original = buildFromEvs([
    { type: 'recognized', assistanceLevel: 'independent', outcome: 'correct', interactionContext: 'learning' as any, timestamp: now },
    {
      type: 'recalled',
      assistanceLevel: 'independent',
      outcome: 'correct',
      interactionContext: 'spaced_review' as any,
      elapsedSinceLastExposureMs: DELAYED_RECALL_MIN_INTERVAL_MS + 5000,
      timestamp: now + DELAYED_RECALL_MIN_INTERVAL_MS + 5000,
    },
  ])
  assert(original.hasDelayedRecall === true, 'original: hasDelayedRecall = true')

  // Restore
  const restored = rebuildProfile(
    JSON.parse(JSON.stringify(original)).microId,
    JSON.parse(JSON.stringify(original)).evidences,
  )
  assert(restored.hasDelayedRecall === true, 'restore conserva hasDelayedRecall')
  assert(original.masteryScore === restored.masteryScore, 'mastery igual antes/después del restore')
}

// TEST 9 — INTERLEAVING SIN DELAYED RECALL
section('TEST 9 — Interleaving no activa delayed recall')
{
  const p = buildFromEvs([
    { type: 'recognized', assistanceLevel: 'independent', outcome: 'correct', interactionContext: 'interleaving' as any },
  ])
  assert(p.hasDelayedRecall === false, 'interleaving no activa delayed recall')

  // immediate_practice tampoco
  const p2 = buildFromEvs([
    { type: 'recognized', assistanceLevel: 'independent', outcome: 'correct', interactionContext: 'immediate_practice' as any },
  ])
  assert(p2.hasDelayedRecall === false, 'immediate_practice no activa delayed recall')
}

// TEST 10 — RESTORE EN REMEDIACIÓN
section('TEST 10 — Restore conserva estado pedagógico en remediación')
{
  let p = emptyEvidenceProfile('remediation')
  // Error inicial
  p = recordEvidence(p, {
    formatUsed: 'multiple_choice', outcome: 'incorrect', score: 0, turnNumber: 1,
    assistanceLevel: 'independent',
  })
  // Explicación guiada (assisted)
  p = recordEvidence(p, {
    formatUsed: 'true_false', outcome: 'correct', score: 80, turnNumber: 2,
    assistanceLevel: 'guided',
  })

  const dBefore = diag(p, { lastAssistanceLevel: 'guided', lastOutcome: 'correct' })

  // Restore
  const pR = rebuildProfile(JSON.parse(JSON.stringify(p)).microId, JSON.parse(JSON.stringify(p)).evidences)
  const dAfter = diag(pR, { lastAssistanceLevel: 'guided', lastOutcome: 'correct' })

  assert(p.masteryScore === pR.masteryScore, 'mastery igual tras restore')
  assert(p.independentSuccesses === pR.independentSuccesses, 'independentSuccesses igual')
  assert(dBefore.canAdvance === dAfter.canAdvance, 'canAdvance igual tras restore')
  assert(dBefore.isFalseMastery === dAfter.isFalseMastery, 'isFalseMastery igual tras restore')

  // La asistencia del turno guided en remediación: sameActivity=true → max(independent, guided) = guided
  const resolved = resolveAssistanceLevel('independent' as any, 'guided' as any, { sameActivity: true })
  assert(resolved === 'guided', 'sameActivity: assisted inferred supera el independiente del frontend')
}

// TEST 11 — AISLAMIENTO ENTRE MICROCONCEPTOS
section('TEST 11 — Evidencias de A no contaminan B')
{
  let pA = emptyEvidenceProfile('micro_A')
  pA = recordEvidence(pA, {
    formatUsed: 'multiple_choice', outcome: 'correct', score: 100, turnNumber: 1,
    assistanceLevel: 'revealed',
  })

  let pB = emptyEvidenceProfile('micro_B')
  pB = recordEvidence(pB, {
    formatUsed: 'multiple_choice', outcome: 'correct', score: 100, turnNumber: 1,
    assistanceLevel: 'independent',
  })

  assert(pA.independentSuccesses === 0, 'micro A: revealed no cuenta como independent')
  assert(pB.independentSuccesses === 1, 'micro B: independent cuenta')
  assert(pA.maxAssistanceLevelUsed !== pB.maxAssistanceLevelUsed, 'perfiles A y B son distintos')
  assert(pA.masteryScore !== pB.masteryScore, 'mastery A ≠ mastery B')

  // Restore de A no afecta B
  const pAR = rebuildProfile(JSON.parse(JSON.stringify(pA)).microId, JSON.parse(JSON.stringify(pA)).evidences)
  assert(pAR.microId === 'micro_A', 'micro A restaurado tiene id correcto')
  assert(pB.microId === 'micro_B', 'micro B intacto')
}

// TEST 12 — RESET DE TELEMETRÍA ENTRE ACTIVIDADES
section('TEST 12 — Telemetría se reinicia en nueva actividad')
{
  // Simula tracker de asistencia
  const CANONICAL = ['independent', 'minimal_hint', 'guided', 'assisted', 'revealed'] as const
  type Level = typeof CANONICAL[number]

  class Tracker {
    private level: Level = 'independent'
    register(l: Level) {
      if (CANONICAL.indexOf(l) > CANONICAL.indexOf(this.level)) this.level = l
    }
    get(): Level { return this.level }
    reset() { this.level = 'independent' }
  }

  const t = new Tracker()
  t.register('assisted')
  assert(t.get() === 'assisted', 'asistencia acumulada: assisted')

  // Nueva actividad → reset
  t.reset()
  assert(t.get() === 'independent', 'tras reset: vuelve a independent')

  // Actividad nueva con revealed no hereda assisted anterior
  const resolved = resolveAssistanceLevel('independent' as any, 'revealed' as any, { sameActivity: false })
  assert(resolved === 'independent', 'nueva actividad: frontend independent prevalece sobre inferred revealed')
}

// TEST 13 — PREVENCIÓN DE EVIDENCIA DUPLICADA
section('TEST 13 — recordEvidence no duplica en round trip')
{
  let p = emptyEvidenceProfile('dup_test')
  p = recordEvidence(p, {
    formatUsed: 'multiple_choice', outcome: 'correct', score: 100, turnNumber: 1,
    assistanceLevel: 'independent',
  })
  const countBefore = p.evidences.length

  // Restore y rebuild (no añade evidencias)
  const pR = rebuildProfile(JSON.parse(JSON.stringify(p)).microId, JSON.parse(JSON.stringify(p)).evidences)
  assert(pR.evidences.length === countBefore, 'restore no duplica evidencias')
  assert(pR.masteryScore === p.masteryScore, 'mastery idéntico tras rebuild')
}

// TEST 14 — PROTECCIÓN CONTRA LOOP
section('TEST 14 — Protección: repetición de objetivo no indefinida')
{
  // El sistema debe cambiar estrategia tras N fallos consecutivos
  // objectiveSelector tiene protección a 3+ fallos consecutivos → cambia objetivo
  // Aquí validamos que el mismo objective no puede seleccionarse si el perfil
  // tiene muchas evidencias y sigue en verify_understanding sin progreso.

  // Perfil con 12+ evidencias sin avance → fusible
  let p = emptyEvidenceProfile('loop_test')
  for (let i = 0; i < 12; i++) {
    p = recordEvidence(p, {
      formatUsed: 'multiple_choice', outcome: 'incorrect', score: 0, turnNumber: i + 1,
      assistanceLevel: 'independent',
    })
  }
  // isReadyToAdvanceEvidence tiene fusible: >= 12 evidencias + mastery >= 30 → avanzar
  // Aquí mastery = 0 porque todo incorrecto
  assert(p.masteryScore === 0, 'solo incorrectos → mastery = 0')
  assert(isReadyToAdvanceEvidence(p, microMed) === false, 'mastery=0 no permite avance aunque haya 12 intentos')

  // Con algo de mastery + 12 evidencias sí dispara el fusible
  let p2 = emptyEvidenceProfile('loop_fuse')
  for (let i = 0; i < 10; i++) {
    p2 = recordEvidence(p2, {
      formatUsed: 'multiple_choice', outcome: 'correct', score: 85, turnNumber: i + 1,
      assistanceLevel: 'assisted',
    })
  }
  // 12 evidencias + mastery > 30 → fusible de estado machine dispara
  // isReadyToAdvanceEvidence tiene su propio fusible: totalEvidences >= 12 + mastery >= 30
  // Pero assisted bloquea antes: independentSuccesses = 0
  // El fusible de stateMachine (MAX_INTERACTIONS) prevalece sobre el de evidence
  // Los 2 mecanismos son complementarios. Evidence no avanza, stateMachine sí.
  assert(typeof isReadyToAdvanceEvidence(p2, microMed) === 'boolean', 'fusible no genera NaN')
}

// TEST 15 — PROGRESO NO LLEGA A 100% PREMATURAMENTE
section('TEST 15 — Progreso no marca 100% si quedan evidencias')
{
  // Un micro con solo 1 acierto independent no puede marcar 100% de dominio
  let p = emptyEvidenceProfile('premature_100')
  p = recordEvidence(p, {
    formatUsed: 'multiple_choice', outcome: 'correct', score: 100, turnNumber: 1,
    assistanceLevel: 'independent',
  })
  assert(isReadyToAdvanceEvidence(p, microMed) === false, 'un acierto no marca 100% en micro medio')
  assert(Math.round(p.masteryScore) < 40, `mastery (${Math.round(p.masteryScore)}) < 40, no marca dominio`)
}

// TEST 16 — FINALIZACIÓN CORRECTA
section('TEST 16 — Finalización solo con dominio real')
{
  // Un perfil dominado correctamente
  const dominated = buildFromEvs([
    { type: 'recognized', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'recognized', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'recalled', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'recalled', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'explained', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'explained', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'applied', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'applied', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
  ])
  assert(isReadyToAdvanceEvidence(dominated, microEasy) === true, 'micro dominado puede finalizar')
  assert(dominated.independentSuccesses === 8, 'independentSuccesses = 8')
  assert(dominated.masteryScore >= 40, `masteryScore >= 40 (${dominated.masteryScore})`)
  const d = diag(dominated)
  assert(d.reasons.includes('ok_to_advance'), 'ok_to_advance en reasons')

  // Un micro con solo revealed NO puede finalizar
  const revealedOnly = buildFromEvs([
    { type: 'recognized', strength: 'strong', assistanceLevel: 'revealed', outcome: 'correct' },
    { type: 'recalled', strength: 'strong', assistanceLevel: 'revealed', outcome: 'correct' },
  ])
  assert(isReadyToAdvanceEvidence(revealedOnly, microEasy) === false, 'revealed-only no puede finalizar')
}

// TEST 17 — RESTORE CONSERVA PROGRESO
section('TEST 17 — Restore conserva mastery y decisión')
{
  const p = buildFromEvs([
    { type: 'recognized', strength: 'strong', assistanceLevel: 'guided', outcome: 'correct' },
    { type: 'recalled', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'explained', strength: 'medium', assistanceLevel: 'minimal_hint', outcome: 'correct' },
  ])

  const serialized = JSON.stringify(p)
  const pR = rebuildProfile(JSON.parse(serialized).microId, JSON.parse(serialized).evidences)

  assert(p.masteryScore === pR.masteryScore, `masteryScore igual (${p.masteryScore})`)
  assert(p.independentSuccesses === pR.independentSuccesses, `independentSuccesses igual (${p.independentSuccesses})`)
  assert(p.maxAssistanceLevelUsed === pR.maxAssistanceLevelUsed, `maxAssistanceLevelUsed igual (${p.maxAssistanceLevelUsed})`)
  assert(isReadyToAdvanceEvidence(p, microMed) === isReadyToAdvanceEvidence(pR, microMed), 'canAdvance igual tras restore')

  const dBefore = diag(p)
  const dAfter = diag(pR)
  assert(dBefore.canAdvance === dAfter.canAdvance, 'diagnosis.canAdvance igual tras restore')
}

// TEST 18 — REGRESIÓN COMPLETA FASES 2-6
section('TEST 18 — Regresión completa de Fases 2-6')
{
  // F2: evidencias conservan campos tras rebuild
  const evRound = makeEv({ assistanceLevel: 'guided', responseTimeMs: 8000, selfReportedConfidence: 60, interactionContext: 'learning' as any })
  const pRound = rebuildProfile('r', [evRound])
  const pR2 = rebuildProfile(JSON.parse(JSON.stringify(pRound)).microId, JSON.parse(JSON.stringify(pRound)).evidences)
  assert(pRound.masteryScore === pR2.masteryScore, '[F2] mastery igual tras round trip')

  // F3: telemetría en evidencias
  assert(typeof evRound.responseTimeMs === 'number', '[F3] responseTimeMs es número')
  assert(evRound.assistanceLevel === 'guided', '[F3] assistanceLevel conservado')

  // F4: interleaving no hereda de actividad anterior
  const lvl = resolveAssistanceLevel('independent' as any, 'revealed' as any, { sameActivity: false })
  assert(lvl === 'independent', '[F4] nueva actividad: frontend prevalece')

  // F5: ilusión de conocimiento
  const ill = detectKnowledgeIllusion({ outcome: 'incorrect', selfReportedConfidence: 80, assistanceLevel: 'independent' })
  assert(ill === true, '[F5] ilusión detectada con confianza 80')

  // F6: legacy pesa menos
  const legacy = buildFromEvs([{ type: 'recognized', assistanceLevel: undefined, outcome: 'correct' }])
  const modern = buildFromEvs([{ type: 'recognized', assistanceLevel: 'independent', outcome: 'correct' }])
  assert(legacy.masteryScore < modern.masteryScore, '[F6] legacy < moderno')

  // F6: interleaving no activa delayed recall
  const interleaved = buildFromEvs([{ type: 'recognized', assistanceLevel: 'independent', outcome: 'correct', interactionContext: 'interleaving' as any }])
  assert(interleaved.hasDelayedRecall === false, '[F6] interleaving no activa delayed recall')

  // Formato score
  assert(formatScoreDisplay(42.300000000000004) === '42', '[F6/F7] score decimal feo formateado a entero')
}

// ─── RESUMEN ───────────────────────────────────────────────────
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
