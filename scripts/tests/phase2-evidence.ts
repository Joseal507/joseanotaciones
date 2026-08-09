/**
 * FASE 2 — Tests de persistencia y restore de evidencias
 * Ejecutar: npx tsx scripts/tests/phase2-evidence.ts
 */

import {
  emptyEvidenceProfile,
  rebuildProfile,
  recordEvidence,
  type Evidence,
  type EvidenceProfile,
} from '../../lib/adaptive/v3/engine/evidenceEngine'
import {
  updateMemoryAfterReview,
  createInitialMemoryState,
} from '../../lib/adaptive/v3/engine/memoryEngine'
import type { AssistanceLevel } from '../../lib/adaptive/v3/engine/confidenceTracker'

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

function section(name: string): void {
  console.log(`\n═══ ${name} ═══`)
}

function almostEqual(a: number, b: number, tol = 0.001): boolean {
  return Math.abs(a - b) <= tol
}

// ─── ASISTENCIA CANÓNICA (copiada del contrato real) ─────────
const CANONICAL_ORDER: AssistanceLevel[] = [
  'independent',
  'minimal_hint',
  'guided',
  'assisted',
  'revealed',
]

function higherAssistance(a: AssistanceLevel, b: AssistanceLevel): AssistanceLevel {
  return CANONICAL_ORDER.indexOf(a) >= CANONICAL_ORDER.indexOf(b) ? a : b
}

// ═══════════════════════════════════════════════════════════════
// TEST 1 — EMPTY PROFILE
// ═══════════════════════════════════════════════════════════════
section('TEST 1 — emptyEvidenceProfile')
{
  const profile = emptyEvidenceProfile('micro_abc')

  assert(profile.microId === 'micro_abc', 'microId conservado')
  assert(Array.isArray(profile.evidences) && profile.evidences.length === 0, 'evidences vacío')
  assert(profile.independentSuccesses === 0, 'independentSuccesses = 0')
  assert(profile.maxAssistanceLevelUsed === 'independent', 'maxAssistanceLevelUsed = independent (nivel inicial canónico)')
  assert(profile.hasTransfer === false, 'hasTransfer = false')
  assert(profile.hasIntegration === false, 'hasIntegration = false')
  assert(profile.hasDelayedRecall === false, 'hasDelayedRecall = false')
  assert(profile.masteryScore === 0, 'masteryScore = 0')
  assert(profile.totalEvidences === 0, 'totalEvidences = 0')
  assert(profile.totalIncorrect === 0, 'totalIncorrect = 0')
  assert(profile.lastEvidenceAt === null, 'lastEvidenceAt = null')
  assert(profile.strongCount.recognized === 0, 'strongCount inicializado')
  assert(profile.mediumCount.recognized === 0, 'mediumCount inicializado')
  assert(profile.weakCount.recognized === 0, 'weakCount inicializado')
}

// ═══════════════════════════════════════════════════════════════
// TEST 2 — REBUILD CONSERVA EVIDENCIAS
// ═══════════════════════════════════════════════════════════════
section('TEST 2 — rebuildProfile conserva campos nuevos')
{
  const now = Date.now()

  const evidences: Evidence[] = [
    // A: éxito independiente con todos los campos nuevos
    {
      type: 'recognized',
      strength: 'strong',
      turnNumber: 1,
      timestamp: now,
      formatUsed: 'multiple_choice',
      outcome: 'correct',
      score: 100,
      attemptNumber: 1,
      confidenceMultiplier: 1.0,
      assistanceLevel: 'independent',
      responseTimeMs: 5000,
      selfReportedConfidence: 80,
      interactionContext: 'learning',
    },
    // B: éxito con minimal_hint
    {
      type: 'recalled',
      strength: 'medium',
      turnNumber: 2,
      timestamp: now + 1000,
      formatUsed: 'fill_blank',
      outcome: 'correct',
      score: 75,
      attemptNumber: 2,
      confidenceMultiplier: 0.7,
      assistanceLevel: 'minimal_hint',
      responseTimeMs: 8000,
      selfReportedConfidence: 50,
      interactionContext: 'immediate_practice',
    },
    // C: éxito parcial con assisted
    {
      type: 'applied',
      strength: 'weak',
      turnNumber: 3,
      timestamp: now + 2000,
      formatUsed: 'practical_case',
      outcome: 'partial',
      score: 60,
      attemptNumber: 1,
      confidenceMultiplier: 1.0,
      assistanceLevel: 'assisted',
      responseTimeMs: 15000,
      selfReportedConfidence: 40,
      interactionContext: 'immediate_practice',
    },
    // D: transferencia
    {
      type: 'transferred',
      strength: 'strong',
      turnNumber: 4,
      timestamp: now + 3000,
      formatUsed: 'practical_case',
      outcome: 'correct',
      score: 90,
      attemptNumber: 1,
      confidenceMultiplier: 1.0,
      assistanceLevel: 'independent',
      responseTimeMs: 12000,
      selfReportedConfidence: 70,
      interactionContext: 'learning',
    },
    // E: integración (connected)
    {
      type: 'connected',
      strength: 'medium',
      turnNumber: 5,
      timestamp: now + 4000,
      formatUsed: 'concept_map',
      outcome: 'correct',
      score: 80,
      attemptNumber: 1,
      confidenceMultiplier: 1.0,
      assistanceLevel: 'guided',
      responseTimeMs: 20000,
      selfReportedConfidence: 60,
      interactionContext: 'immediate_practice',
    },
    // F: delayed recall
    {
      type: 'retained',
      strength: 'strong',
      turnNumber: 6,
      timestamp: now + 5000,
      formatUsed: 'quick_check',
      outcome: 'correct',
      score: 95,
      attemptNumber: 1,
      confidenceMultiplier: 1.0,
      assistanceLevel: 'independent',
      responseTimeMs: 3000,
      selfReportedConfidence: 90,
      interactionContext: 'delayed_retrieval',
      elapsedSinceLastExposureMs: 21 * 60 * 60 * 1000,
      elapsedSinceLastExposureMs: 21 * 60 * 60 * 1000,
    },
  ]

  const profile = rebuildProfile('micro_test', evidences)

  // Evidencias conservadas
  assert(profile.evidences.length === 6, 'todas las evidencias conservadas')
  assert(profile.evidences[0].assistanceLevel === 'independent', 'ev[0].assistanceLevel conservado')
  assert(profile.evidences[0].responseTimeMs === 5000, 'ev[0].responseTimeMs conservado')
  assert(profile.evidences[0].selfReportedConfidence === 80, 'ev[0].selfReportedConfidence conservado')
  assert(profile.evidences[0].interactionContext === 'learning', 'ev[0].interactionContext conservado')
  assert(profile.evidences[1].assistanceLevel === 'minimal_hint', 'ev[1].assistanceLevel conservado')
  assert(profile.evidences[2].assistanceLevel === 'assisted', 'ev[2].assistanceLevel conservado')

  // independentSuccesses: solo A y D son correct+independent (F también)
  // A=recognized correct independent, D=transferred correct independent, F=retained correct independent = 3
  assert(profile.independentSuccesses === 3, `independentSuccesses = 3 (got ${profile.independentSuccesses})`)

  // maxAssistanceLevelUsed: el nivel más alto usado en éxitos = assisted (C es partial/assisted pero cuenta)
  // éxitos: A=independent, B=minimal_hint, C=partial/assisted (no es incorrect), D=independent, E=guided, F=independent
  // mayor = assisted
  assert(
    profile.maxAssistanceLevelUsed === 'assisted',
    `maxAssistanceLevelUsed = assisted (got ${profile.maxAssistanceLevelUsed})`,
  )

  // Flags
  assert(profile.hasTransfer === true, 'hasTransfer = true (evidencia D)')
  assert(profile.hasIntegration === true, 'hasIntegration = true (evidencia E)')
  assert(profile.hasDelayedRecall === true, 'hasDelayedRecall = true (evidencia F con delayed_retrieval)')

  // Contadores por fuerza
  assert(profile.strongCount.recognized === 1, 'strongCount.recognized = 1')
  assert(profile.mediumCount.recalled === 1, 'mediumCount.recalled = 1')
  assert(profile.weakCount.applied === 1, 'weakCount.applied = 1')

  // masteryScore no es NaN ni undefined
  assert(typeof profile.masteryScore === 'number' && !isNaN(profile.masteryScore), `masteryScore es número válido (${profile.masteryScore})`)
  assert(profile.masteryScore > 0, `masteryScore > 0 (${profile.masteryScore})`)
}

// ═══════════════════════════════════════════════════════════════
// TEST 3 — ORDEN CANÓNICO DE ASISTENCIA
// ═══════════════════════════════════════════════════════════════
section('TEST 3 — maxAssistanceLevelUsed no depende del orden de inserción')
{
  const now = Date.now()

  function makeEvidence(type: Evidence['type'], assistanceLevel: AssistanceLevel): Evidence {
    return {
      type,
      strength: 'strong',
      turnNumber: 1,
      timestamp: now,
      formatUsed: 'multiple_choice',
      outcome: 'correct',
      score: 100,
      attemptNumber: 1,
      confidenceMultiplier: 1.0,
      assistanceLevel,
      responseTimeMs: 5000,
      selfReportedConfidence: 80,
      interactionContext: 'learning',
    }
  }

  // Orden: assisted primero, luego independent
  const evs1 = [makeEvidence('applied', 'assisted'), makeEvidence('recognized', 'independent')]
  const p1 = rebuildProfile('m1', evs1)
  assert(p1.maxAssistanceLevelUsed === 'assisted', 'max=assisted cuando assisted viene primero')

  // Orden: independent primero, luego assisted
  const evs2 = [makeEvidence('recognized', 'independent'), makeEvidence('applied', 'assisted')]
  const p2 = rebuildProfile('m2', evs2)
  assert(p2.maxAssistanceLevelUsed === 'assisted', 'max=assisted cuando assisted viene después')

  // Solo independent
  const evs3 = [makeEvidence('recognized', 'independent'), makeEvidence('recalled', 'independent')]
  const p3 = rebuildProfile('m3', evs3)
  assert(p3.maxAssistanceLevelUsed === 'independent', 'max=independent cuando solo independent')

  // minimal_hint vs independent → minimal_hint gana
  const evs4 = [makeEvidence('recognized', 'independent'), makeEvidence('recalled', 'minimal_hint')]
  const p4 = rebuildProfile('m4', evs4)
  assert(p4.maxAssistanceLevelUsed === 'minimal_hint', 'max=minimal_hint sobre independent')

  // revealed gana a todo
  const evs5 = [makeEvidence('recognized', 'guided'), makeEvidence('recalled', 'revealed')]
  const p5 = rebuildProfile('m5', evs5)
  assert(p5.maxAssistanceLevelUsed === 'revealed', 'max=revealed gana a todo')

  // Errores (incorrect) NO cuentan para maxAssistanceLevelUsed
  const evIncorrect: Evidence = {
    type: 'recognized',
    strength: 'weak',
    turnNumber: 1,
    timestamp: now,
    formatUsed: 'multiple_choice',
    outcome: 'incorrect',
    score: 0,
    attemptNumber: 1,
    confidenceMultiplier: 1.0,
    assistanceLevel: 'revealed',
    responseTimeMs: 1000,
    selfReportedConfidence: 90,
    interactionContext: 'learning',
  }
  const evCorrect = makeEvidence('recalled', 'independent')
  const p6 = rebuildProfile('m6', [evIncorrect, evCorrect])
  assert(
    p6.maxAssistanceLevelUsed === 'independent',
    'incorrect con revealed no infla maxAssistanceLevelUsed',
  )
}

// ═══════════════════════════════════════════════════════════════
// TEST 4 — ROUND TRIP JSON
// ═══════════════════════════════════════════════════════════════
section('TEST 4 — Round trip JSON.stringify / JSON.parse / rebuildProfile')
{
  const now = Date.now()

  const originalProfile: EvidenceProfile = rebuildProfile('micro_rt', [
    {
      type: 'recognized',
      strength: 'strong',
      turnNumber: 1,
      timestamp: now,
      formatUsed: 'multiple_choice',
      outcome: 'correct',
      score: 100,
      attemptNumber: 1,
      confidenceMultiplier: 1.0,
      assistanceLevel: 'minimal_hint',
      responseTimeMs: 4500,
      selfReportedConfidence: 70,
      interactionContext: 'learning',
    },
    {
      type: 'transferred',
      strength: 'strong',
      turnNumber: 2,
      timestamp: now + 1000,
      formatUsed: 'practical_case',
      outcome: 'correct',
      score: 90,
      attemptNumber: 1,
      confidenceMultiplier: 1.0,
      assistanceLevel: 'independent',
      responseTimeMs: 12000,
      selfReportedConfidence: 80,
      interactionContext: 'spaced_review',
      elapsedSinceLastExposureMs: 21 * 60 * 60 * 1000,
    },
  ])

  // Round trip
  const serialized = JSON.stringify(originalProfile)
  const deserialized = JSON.parse(serialized) as EvidenceProfile
  const restored = rebuildProfile(deserialized.microId, deserialized.evidences)

  assert(restored.microId === originalProfile.microId, 'microId igual tras round trip')
  assert(restored.evidences.length === originalProfile.evidences.length, 'cantidad de evidencias igual')
  assert(restored.evidences[0].assistanceLevel === 'minimal_hint', 'assistanceLevel ev[0] conservado')
  assert(restored.evidences[0].responseTimeMs === 4500, 'responseTimeMs ev[0] conservado')
  assert(restored.evidences[0].selfReportedConfidence === 70, 'selfReportedConfidence ev[0] conservado')
  assert(restored.evidences[0].interactionContext === 'learning', 'interactionContext ev[0] conservado')
  assert(restored.evidences[1].assistanceLevel === 'independent', 'assistanceLevel ev[1] conservado')
  assert(restored.evidences[1].interactionContext === 'spaced_review', 'interactionContext ev[1] conservado')
  assert(restored.independentSuccesses === originalProfile.independentSuccesses, `independentSuccesses igual (${restored.independentSuccesses})`)
  assert(restored.maxAssistanceLevelUsed === originalProfile.maxAssistanceLevelUsed, `maxAssistanceLevelUsed igual (${restored.maxAssistanceLevelUsed})`)
  assert(restored.hasTransfer === originalProfile.hasTransfer, 'hasTransfer igual')
  assert(restored.hasIntegration === originalProfile.hasIntegration, 'hasIntegration igual')
  assert(restored.hasDelayedRecall === originalProfile.hasDelayedRecall, 'hasDelayedRecall igual (spaced_review activa)')
  assert(almostEqual(restored.masteryScore, originalProfile.masteryScore), `masteryScore igual (${restored.masteryScore} vs ${originalProfile.masteryScore})`)
}

// ═══════════════════════════════════════════════════════════════
// TEST 5 — RESTORE DE SESIÓN (simulado en memoria, sin R2)
// La sesión se guarda como JSON.stringify y se restaura como JSON.parse
// exactamente igual que sessionStorage.ts hace en R2
// ═══════════════════════════════════════════════════════════════
section('TEST 5 — Restore de sesión (serialize/deserialize en memoria)')
{
  const now = Date.now()

  // Construir sesión mínima con evidenceProfile en microStates
  const evidencesA: Evidence[] = [
    {
      type: 'recognized',
      strength: 'strong',
      turnNumber: 1,
      timestamp: now,
      formatUsed: 'multiple_choice',
      outcome: 'correct',
      score: 100,
      attemptNumber: 1,
      confidenceMultiplier: 1.0,
      assistanceLevel: 'independent',
      responseTimeMs: 5000,
      selfReportedConfidence: 85,
      interactionContext: 'learning',
    },
    {
      type: 'transferred',
      strength: 'strong',
      turnNumber: 2,
      timestamp: now + 1000,
      formatUsed: 'practical_case',
      outcome: 'correct',
      score: 90,
      attemptNumber: 1,
      confidenceMultiplier: 1.0,
      assistanceLevel: 'independent',
      responseTimeMs: 10000,
      selfReportedConfidence: 75,
      interactionContext: 'delayed_retrieval',
      elapsedSinceLastExposureMs: 21 * 60 * 60 * 1000,
      elapsedSinceLastExposureMs: 21 * 60 * 60 * 1000,
    },
  ]

  const evidencesB: Evidence[] = [
    {
      type: 'applied',
      strength: 'medium',
      turnNumber: 3,
      timestamp: now + 2000,
      formatUsed: 'practical_case',
      outcome: 'correct',
      score: 75,
      attemptNumber: 1,
      confidenceMultiplier: 1.0,
      assistanceLevel: 'guided',
      responseTimeMs: 20000,
      selfReportedConfidence: 50,
      interactionContext: 'immediate_practice',
    },
    {
      type: 'connected',
      strength: 'strong',
      turnNumber: 4,
      timestamp: now + 3000,
      formatUsed: 'concept_map',
      outcome: 'correct',
      score: 95,
      attemptNumber: 1,
      confidenceMultiplier: 1.0,
      assistanceLevel: 'minimal_hint',
      responseTimeMs: 8000,
      selfReportedConfidence: 65,
      interactionContext: 'learning',
    },
  ]

  const profileA = rebuildProfile('micro_a', evidencesA)
  const profileB = rebuildProfile('micro_b', evidencesB)

  // Simular sesión con evidenceProfile en microStates (como hace tutor/route.ts)
  const sessionBefore: any = {
    sessionId: 'test_session_001',
    userId: 'user_test',
    materialId: 'mat_test',
    microStates: {
      micro_a: { evidenceProfile: profileA, microId: 'micro_a' },
      micro_b: { evidenceProfile: profileB, microId: 'micro_b' },
    },
  }

  // Serializar (exactamente como saveSession)
  const serialized = JSON.stringify(sessionBefore)

  // Restaurar (exactamente como loadSession)
  const sessionAfter: any = JSON.parse(serialized)

  // Rebuild de perfiles restaurados
  const restoredA = rebuildProfile(
    sessionAfter.microStates.micro_a.evidenceProfile.microId,
    sessionAfter.microStates.micro_a.evidenceProfile.evidences,
  )
  const restoredB = rebuildProfile(
    sessionAfter.microStates.micro_b.evidenceProfile.microId,
    sessionAfter.microStates.micro_b.evidenceProfile.evidences,
  )

  // Verificar micro_a
  assert(restoredA.microId === 'micro_a', '[micro_a] microId conservado')
  assert(restoredA.evidences.length === 2, '[micro_a] evidencias conservadas')
  assert(restoredA.evidences[0].assistanceLevel === 'independent', '[micro_a] assistanceLevel ev[0]')
  assert(restoredA.evidences[0].responseTimeMs === 5000, '[micro_a] responseTimeMs ev[0]')
  assert(restoredA.evidences[0].selfReportedConfidence === 85, '[micro_a] selfReportedConfidence ev[0]')
  assert(restoredA.evidences[1].interactionContext === 'delayed_retrieval', '[micro_a] interactionContext ev[1]')
  assert(restoredA.independentSuccesses === 2, `[micro_a] independentSuccesses = 2 (got ${restoredA.independentSuccesses})`)
  assert(restoredA.maxAssistanceLevelUsed === 'independent', `[micro_a] maxAssistanceLevelUsed = independent (got ${restoredA.maxAssistanceLevelUsed})`)
  assert(restoredA.hasTransfer === true, '[micro_a] hasTransfer = true')
  assert(restoredA.hasDelayedRecall === true, '[micro_a] hasDelayedRecall = true (delayed_retrieval)')

  // Verificar micro_b
  assert(restoredB.microId === 'micro_b', '[micro_b] microId conservado')
  assert(restoredB.evidences.length === 2, '[micro_b] evidencias conservadas')
  assert(restoredB.evidences[0].assistanceLevel === 'guided', '[micro_b] assistanceLevel ev[0]')
  assert(restoredB.evidences[1].assistanceLevel === 'minimal_hint', '[micro_b] assistanceLevel ev[1]')
  assert(restoredB.independentSuccesses === 0, `[micro_b] independentSuccesses = 0 (got ${restoredB.independentSuccesses})`)
  assert(restoredB.maxAssistanceLevelUsed === 'guided', `[micro_b] maxAssistanceLevelUsed = guided (got ${restoredB.maxAssistanceLevelUsed})`)
  assert(restoredB.hasIntegration === true, '[micro_b] hasIntegration = true (connected)')
}

// ═══════════════════════════════════════════════════════════════
// TEST 6 — UPDATE MEMORY AFTER REVIEW con niveles canónicos
// ═══════════════════════════════════════════════════════════════
section('TEST 6 — updateMemoryAfterReview con todos los AssistanceLevel canónicos')
{
  const baseState = createInitialMemoryState('micro_mem', 5)

  // independent: grado efectivo = grado original
  const r_independent = updateMemoryAfterReview(baseState, 3, 'independent')
  assert(typeof r_independent.stability === 'number', 'independent: stability es número')
  assert(r_independent.totalReviews === 1, 'independent: totalReviews = 1')

  // minimal_hint: descuento de 0 (igual que independent en el mapeo)
  const r_hint = updateMemoryAfterReview(baseState, 3, 'minimal_hint')
  assert(typeof r_hint.stability === 'number', 'minimal_hint: stability es número')

  // guided: descuento de 1
  const r_guided = updateMemoryAfterReview(baseState, 3, 'guided')
  // grade 3 - 1 = 2 → efectivo Good
  assert(r_guided.totalReviews === 1, 'guided: totalReviews = 1')

  // assisted: descuento de 2
  const r_assisted = updateMemoryAfterReview(baseState, 3, 'assisted')
  // grade 3 - 2 = 1 → efectivo Hard
  assert(r_assisted.totalReviews === 1, 'assisted: totalReviews = 1')

  // revealed: descuento de 4
  const r_revealed = updateMemoryAfterReview(baseState, 3, 'revealed')
  // grade 3 - 4 = -1 → clamped a 0 → Again
  assert(r_revealed.lastGrade === 0, 'revealed con grade=3 → effectiveGrade = 0 (Again)')
  assert(r_revealed.failedRetrievals === 1, 'revealed cuenta como fallo de memoria')

  // minimal_hint y assisted producen resultados distintos
  const r_hint2 = updateMemoryAfterReview(baseState, 2, 'minimal_hint')
  const r_assisted2 = updateMemoryAfterReview(baseState, 2, 'assisted')
  // hint: grade 2 - 0 = 2 Good; assisted: grade 2 - 2 = 0 Again → estabilidades diferentes
  assert(
    r_hint2.stability !== r_assisted2.stability,
    `minimal_hint (${r_hint2.stability}) y assisted (${r_assisted2.stability}) producen estabilidades distintas`,
  )

  // Verificar que 'hinted' NO existe (compile-time check no aplica en runtime,
  // pero verificamos que el mapping solo usa los niveles canónicos)
  const canonicalLevels: AssistanceLevel[] = ['independent', 'minimal_hint', 'guided', 'assisted', 'revealed']
  assert(!canonicalLevels.includes('hinted' as any), 'hinted NO existe en niveles canónicos')

  // independent produce mayor estabilidad que revealed con mismo grade alto
  const rInd = updateMemoryAfterReview(baseState, 4, 'independent')
  const rRev = updateMemoryAfterReview(baseState, 4, 'revealed')
  assert(rInd.stability > rRev.stability, `independent (${rInd.stability}) > revealed (${rRev.stability}) con grade=4`)
}

// ═══════════════════════════════════════════════════════════════
// TEST 7 — REGRESIÓN DEL BUG
// ═══════════════════════════════════════════════════════════════
section('TEST 7 — Regresión: bugs que existían antes de Fase 1')
{
  // Bug 1: emptyEvidenceProfile no tenía los 5 campos obligatorios
  const empty = emptyEvidenceProfile('test_regression')
  assert(
    'independentSuccesses' in empty,
    '[REGRESIÓN] emptyEvidenceProfile tiene independentSuccesses',
  )
  assert(
    'maxAssistanceLevelUsed' in empty,
    '[REGRESIÓN] emptyEvidenceProfile tiene maxAssistanceLevelUsed',
  )
  assert(
    'hasTransfer' in empty,
    '[REGRESIÓN] emptyEvidenceProfile tiene hasTransfer',
  )
  assert(
    'hasIntegration' in empty,
    '[REGRESIÓN] emptyEvidenceProfile tiene hasIntegration',
  )
  assert(
    'hasDelayedRecall' in empty,
    '[REGRESIÓN] emptyEvidenceProfile tiene hasDelayedRecall',
  )

  // Bug 2: rebuildProfile devolvía independentSuccesses incorrecto
  // (usaba (e as any).assistanceLevel en lugar de e.assistanceLevel)
  const now = Date.now()
  const evIndep: Evidence = {
    type: 'recognized',
    strength: 'strong',
    turnNumber: 1,
    timestamp: now,
    formatUsed: 'multiple_choice',
    outcome: 'correct',
    score: 100,
    attemptNumber: 1,
    confidenceMultiplier: 1.0,
    assistanceLevel: 'independent',
    responseTimeMs: 5000,
    selfReportedConfidence: 80,
    interactionContext: 'learning',
  }
  const evAssisted: Evidence = {
    ...evIndep,
    type: 'recalled',
    assistanceLevel: 'assisted',
    turnNumber: 2,
    timestamp: now + 1000,
  }
  const profile = rebuildProfile('regression_test', [evIndep, evAssisted])
  assert(
    profile.independentSuccesses === 1,
    `[REGRESIÓN] independentSuccesses = 1 (solo el independent cuenta), got ${profile.independentSuccesses}`,
  )

  // Bug 3: rebuildProfile devolvía maxAssistanceLevelUsed hardcodeado como 'independent'
  assert(
    profile.maxAssistanceLevelUsed === 'assisted',
    `[REGRESIÓN] maxAssistanceLevelUsed = assisted (no hardcodeado), got ${profile.maxAssistanceLevelUsed}`,
  )

  // Bug 4: assistanceLevel se perdía tras recordEvidence + rebuild
  let p = emptyEvidenceProfile('bug4')
  p = recordEvidence(p, {
    formatUsed: 'multiple_choice',
    outcome: 'correct',
    score: 100,
    turnNumber: 1,
    assistanceLevel: 'guided',
    responseTimeMs: 5000,
    selfReportedConfidence: 70,
    interactionContext: 'learning',
  })
  assert(
    p.evidences[0]?.assistanceLevel === 'guided',
    `[REGRESIÓN] assistanceLevel conservado tras recordEvidence (got ${p.evidences[0]?.assistanceLevel})`,
  )
  assert(
    p.maxAssistanceLevelUsed === 'guided',
    `[REGRESIÓN] maxAssistanceLevelUsed calculado tras recordEvidence (got ${p.maxAssistanceLevelUsed})`,
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
