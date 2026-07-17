/**
 * FASE 6 — Consistencia de scoring, contexto y asistencia
 * Ejecutar: npx tsx scripts/tests/phase6-consistency.ts
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
  getLegacyEvidenceWeight,
  resolveAssistanceLevel,
  diagnosePedagogicalState,
} from '../../lib/adaptive/v3/engine/pedagogicalDecision'
import { ASSISTANCE_LEVEL_ORDER } from '../../lib/adaptive/v3/engine/confidenceTracker'

let passed = 0
let failed = 0
const failures: string[] = []
function assert(condition: boolean, msg: string): void {
  if (condition) { console.log(`  ✓ ${msg}`); passed++ }
  else { console.error(`  ✗ ${msg}`); failed++; failures.push(msg) }
}
function section(name: string): void { console.log(`\n═══ ${name} ═══`) }

function buildProfile(evs: Partial<Evidence>[]) {
  const base: Evidence = {
    type: 'recognized',
    strength: 'strong',
    turnNumber: 1,
    timestamp: Date.now(),
    formatUsed: 'multiple_choice',
    outcome: 'correct',
    score: 100,
    attemptNumber: 1,
    confidenceMultiplier: 1.0,
  }
  return rebuildProfile('micro_f6', evs.map((e, i) => ({ ...base, turnNumber: i + 1, timestamp: Date.now() + i * 1000, ...e })))
}

const microEasy = { id: 'easy', difficulty: 10, importance: 'low', cognitiveType: 'definitional' } as any

// TEST 1 — LEGACY PESA MENOS
section('TEST 1 — Legacy pesa menos que independiente moderno')
{
  const modern = buildProfile([
    { type: 'recognized', assistanceLevel: 'independent', outcome: 'correct' },
  ])
  const legacy = buildProfile([
    { type: 'recognized', assistanceLevel: undefined, outcome: 'correct' },
  ])

  assert(modern.masteryScore > legacy.masteryScore, `moderno (${modern.masteryScore}) > legacy (${legacy.masteryScore})`)
  assert(legacy.masteryScore > 0, `legacy aporta algo (${legacy.masteryScore})`)
  assert(legacy.independentSuccesses === 0, 'legacy no incrementa independentSuccesses')
  assert(getLegacyEvidenceWeight({ outcome: 'correct', assistanceLevel: undefined }) < 1.0, 'legacy weight < 1.0')
}

// TEST 2 — LEGACY RESTORE
section('TEST 2 — Legacy restore conserva el mismo mastery')
{
  const legacy = buildProfile([
    { type: 'recognized', assistanceLevel: undefined, outcome: 'correct' },
    { type: 'recalled', assistanceLevel: undefined, outcome: 'correct' },
  ])
  const restored = rebuildProfile(
    JSON.parse(JSON.stringify(legacy)).microId,
    JSON.parse(JSON.stringify(legacy)).evidences,
  )
  assert(legacy.masteryScore === restored.masteryScore, `mastery igual (${legacy.masteryScore} vs ${restored.masteryScore})`)
  assert(restored.independentSuccesses === 0, 'restore legacy no se convierte en independent')
}

// TEST 3 — REVEALED NO INFLA SCORE
section('TEST 3 — Revealed aporta menos que independent')
{
  const indep = buildProfile([{ type: 'recognized', assistanceLevel: 'independent', outcome: 'correct' }])
  const rev = buildProfile([{ type: 'recognized', assistanceLevel: 'revealed', outcome: 'correct' }])
  assert(indep.masteryScore > rev.masteryScore, `independent (${indep.masteryScore}) > revealed (${rev.masteryScore})`)
  assert(isReadyToAdvanceEvidence(rev, microEasy) === false, 'revealed no desbloquea avance')
}

// TEST 4 — JERARQUÍA DE PESOS
section('TEST 4 — Jerarquía de pesos canónicos')
{
  const mk = (level: any) => buildProfile([{ type: 'recognized', assistanceLevel: level, outcome: 'correct' }]).masteryScore
  const indep = mk('independent')
  const hint = mk('minimal_hint')
  const guided = mk('guided')
  const assisted = mk('assisted')
  const revealed = mk('revealed')
  assert(indep > hint, `independent (${indep}) > hint (${hint})`)
  assert(hint > guided, `hint (${hint}) > guided (${guided})`)
  assert(guided > assisted, `guided (${guided}) > assisted (${assisted})`)
  assert(assisted >= revealed, `assisted (${assisted}) >= revealed (${revealed})`)
}

// TEST 5 — INTERLEAVING NO ES RETENCIÓN
section('TEST 5 — Interleaving no activa delayed recall')
{
  const p = buildProfile([
    { type: 'recognized', assistanceLevel: 'independent', outcome: 'correct', interactionContext: 'interleaving' as any },
  ])
  assert(p.hasDelayedRecall === false, 'interleaving no activa hasDelayedRecall')
}

// TEST 6 — SPACED REVIEW SIN ÉXITO
section('TEST 6 — Spaced review incorrecta no demuestra retención')
{
  let p = emptyEvidenceProfile('sr_bad')
  p = recordEvidence(p, {
    formatUsed: 'multiple_choice',
    outcome: 'incorrect',
    score: 0,
    turnNumber: 1,
    assistanceLevel: 'independent',
    interactionContext: 'spaced_review' as any,
    elapsedSinceLastExposureMs: DELAYED_RECALL_MIN_INTERVAL_MS + 1000,
  })
  assert(p.hasDelayedRecall === false, 'spaced_review incorrecta → hasDelayedRecall false')
}

// TEST 7 — SPACED REVIEW ASISTIDA
section('TEST 7 — Spaced review asistida no confirma delayed recall')
{
  const p = buildProfile([
    {
      type: 'recognized',
      assistanceLevel: 'assisted',
      outcome: 'correct',
      interactionContext: 'spaced_review' as any,
      elapsedSinceLastExposureMs: DELAYED_RECALL_MIN_INTERVAL_MS + 1000,
    },
  ])
  assert(p.hasDelayedRecall === false, 'spaced_review assisted no activa delayed recall')
}

// TEST 8 — DELAYED RECALL REAL
section('TEST 8 — Delayed recall real requiere tiempo suficiente')
{
  const p = buildProfile([
    { type: 'recognized', assistanceLevel: 'independent', outcome: 'correct', interactionContext: 'learning' as any, timestamp: Date.now() },
    {
      type: 'recalled',
      assistanceLevel: 'independent',
      outcome: 'correct',
      interactionContext: 'spaced_review' as any,
      elapsedSinceLastExposureMs: DELAYED_RECALL_MIN_INTERVAL_MS + 5000,
      timestamp: Date.now() + DELAYED_RECALL_MIN_INTERVAL_MS + 5000,
    },
  ])
  assert(p.hasDelayedRecall === true, 'spaced_review + intervalo real + independent = delayed recall')
}

// TEST 9 — INTERVALO INSUFICIENTE
section('TEST 9 — Intervalo insuficiente no activa delayed recall')
{
  const p = buildProfile([
    {
      type: 'recalled',
      assistanceLevel: 'independent',
      outcome: 'correct',
      interactionContext: 'spaced_review' as any,
      elapsedSinceLastExposureMs: DELAYED_RECALL_MIN_INTERVAL_MS - 1000,
    },
  ])
  assert(p.hasDelayedRecall === false, 'intervalo insuficiente → hasDelayedRecall false')
}

// TEST 10 — FRONTEND INDEPENDENT + INFERRED REVEALED MISMA ACTIVIDAD
section('TEST 10 — sameActivity conserva el máximo de ayuda')
{
  const level = resolveAssistanceLevel('independent' as any, 'revealed' as any, { sameActivity: true })
  assert(level === 'revealed', `sameActivity: independent + revealed → revealed (got ${level})`)
}

// TEST 11 — FRONTEND REVEALED + INFERRED MINIMAL HINT
section('TEST 11 — revealed siempre gana')
{
  const level = resolveAssistanceLevel('revealed' as any, 'minimal_hint' as any, { sameActivity: true })
  assert(level === 'revealed', `revealed + minimal_hint → revealed (got ${level})`)
}

// TEST 12 — AYUDA DE ACTIVIDAD ANTERIOR
section('TEST 12 — Actividad nueva no hereda ayuda anterior')
{
  const level = resolveAssistanceLevel('independent' as any, 'revealed' as any, { sameActivity: false })
  assert(level === 'independent', `nueva actividad: independent + old revealed → independent (got ${level})`)
}

// TEST 13 — RETRY MISMA ACTIVIDAD
section('TEST 13 — Retry misma actividad conserva ayuda previa')
{
  const level = resolveAssistanceLevel(undefined, 'guided' as any, { sameActivity: true })
  assert(level === 'guided', `retry sameActivity con guided inferred → guided (got ${level})`)
}

// TEST 14 — SCORE ÚNICO
section('TEST 14 — Registro incremental y rebuild dan mismo mastery')
{
  let p = emptyEvidenceProfile('score_unique')
  p = recordEvidence(p, {
    formatUsed: 'multiple_choice', outcome: 'correct', score: 100, turnNumber: 1,
    assistanceLevel: 'independent',
  })
  p = recordEvidence(p, {
    formatUsed: 'fill_blank', outcome: 'correct', score: 90, turnNumber: 2,
    assistanceLevel: 'minimal_hint',
  })

  const rebuilt = rebuildProfile(p.microId, JSON.parse(JSON.stringify(p.evidences)))
  assert(p.masteryScore === rebuilt.masteryScore, `masteryScore igual (${p.masteryScore} vs ${rebuilt.masteryScore})`)
  assert(p.independentSuccesses === rebuilt.independentSuccesses, 'independentSuccesses igual')
  const d1 = diagnosePedagogicalState({
    profile: p,
    lastOutcome: 'correct',
    lastAssistanceLevel: 'minimal_hint',
    selfReportedConfidence: undefined,
    responseTimeMs: undefined,
    formatUsed: 'multiple_choice',
    interactionContext: 'immediate_practice',
    recentRevealedCount: 0,
  })
  const d2 = diagnosePedagogicalState({
    profile: rebuilt,
    lastOutcome: 'correct',
    lastAssistanceLevel: 'minimal_hint',
    selfReportedConfidence: undefined,
    responseTimeMs: undefined,
    formatUsed: 'multiple_choice',
    interactionContext: 'immediate_practice',
    recentRevealedCount: 0,
  })
  assert(JSON.stringify(d1.reasons) === JSON.stringify(d2.reasons), 'reasons iguales después del rebuild')
}

// TEST 15 — CONTADORES NO FALSEAN SCORE
section('TEST 15 — Mismos contadores, distinta ayuda => mastery distinto')
{
  const modern = buildProfile([
    { type: 'recognized', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
  ])
  const assisted = buildProfile([
    { type: 'recognized', strength: 'strong', assistanceLevel: 'assisted', outcome: 'correct' },
  ])
  // Mismos strongCount (recognized=1), distinto assistanceLevel → mastery distinto
  assert(modern.strongCount.recognized === assisted.strongCount.recognized, 'mismos strongCount.recognized')
  assert(modern.masteryScore > assisted.masteryScore, `mismo count, moderno (${modern.masteryScore}) > assisted (${assisted.masteryScore})`)
}

// TEST 16 — REGRESIÓN
section('TEST 16 — Regresión')
{
  // legacy weight declarado pero no aplicado
  const legacy = buildProfile([{ type: 'recognized', assistanceLevel: undefined, outcome: 'correct' }])
  const modern = buildProfile([{ type: 'recognized', assistanceLevel: 'independent', outcome: 'correct' }])
  assert(legacy.masteryScore < modern.masteryScore, 'legacy realmente pesa menos')

  // interleaving no activa delayed recall
  const inter = buildProfile([{ type: 'recognized', assistanceLevel: 'independent', outcome: 'correct', interactionContext: 'interleaving' as any }])
  assert(inter.hasDelayedRecall === false, 'interleaving no activa delayed recall')

  // frontend independent no oculta inferred revealed sameActivity
  const lvl = resolveAssistanceLevel('independent' as any, 'revealed' as any, { sameActivity: true })
  assert(lvl === 'revealed', 'sameActivity independent + revealed => revealed')

  // restore no cambia score
  const restored = rebuildProfile(JSON.parse(JSON.stringify(modern)).microId, JSON.parse(JSON.stringify(modern)).evidences)
  assert(restored.masteryScore === modern.masteryScore, 'restore conserva masteryScore')

  // scoring único (no alternativo)
  let inc = emptyEvidenceProfile('inc')
  inc = recordEvidence(inc, { formatUsed: 'multiple_choice', outcome: 'correct', score: 100, turnNumber: 1, assistanceLevel: 'independent' })
  const reb = rebuildProfile(inc.microId, JSON.parse(JSON.stringify(inc.evidences)))
  assert(inc.masteryScore === reb.masteryScore, 'registro incremental = rebuild')
}

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
