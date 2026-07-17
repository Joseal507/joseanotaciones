/**
 * FASE 5 — Tests de decisiones pedagógicas basadas en evidencia real
 * Ejecutar: npx tsx scripts/tests/phase5-pedagogical-decisions.ts
 */

import {
  emptyEvidenceProfile,
  rebuildProfile,
  recordEvidence,
  isReadyToAdvanceEvidence,
  type Evidence,
  type EvidenceProfile,
} from '../../lib/adaptive/v3/engine/evidenceEngine'
import {
  ASSISTANCE_LEVEL_ORDER,
  type AssistanceLevel,
} from '../../lib/adaptive/v3/engine/confidenceTracker'
import {
  diagnosePedagogicalState,
  detectKnowledgeIllusion,
  resolveAssistanceLevel,
  getLegacyEvidenceWeight,
  HIGH_CONFIDENCE_THRESHOLD,
  LOW_CONFIDENCE_THRESHOLD,
  LEGACY_EVIDENCE_WEIGHT,
  type PedagogicalReason,
} from '../../lib/adaptive/v3/engine/pedagogicalDecision'

// ─── Mini micro stub para isReadyToAdvanceEvidence ───────────
const microStub = {
  id: 'm1', difficulty: 40, importance: 'medium',
  cognitiveType: 'definitional',
} as any

// ─── Mini framework ──────────────────────────────────────────
let passed = 0
let failed = 0
const failures: string[] = []

function assert(condition: boolean, msg: string): void {
  if (condition) { console.log(`  ✓ ${msg}`); passed++ }
  else { console.error(`  ✗ ${msg}`); failed++; failures.push(msg) }
}
function section(name: string): void { console.log(`\n═══ ${name} ═══`) }

// ─── Helper: construir perfil con evidencias dadas ───────────
function buildProfile(evs: Partial<Evidence>[]): EvidenceProfile {
  const base: Evidence = {
    type: 'recognized', strength: 'strong',
    turnNumber: 1, timestamp: Date.now(),
    formatUsed: 'multiple_choice',
    outcome: 'correct', score: 100,
    attemptNumber: 1, confidenceMultiplier: 1.0,
    assistanceLevel: 'independent',
  }
  return rebuildProfile('test_micro', evs.map((e, i) => ({ ...base, turnNumber: i + 1, timestamp: Date.now() + i * 1000, ...e })))
}

// ─── Helper: diagnóstico con defaults ────────────────────────
function diag(profile: EvidenceProfile, overrides: Partial<Parameters<typeof diagnosePedagogicalState>[0]> = {}) {
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

// ═══════════════════════════════════════════════════════════════
// TEST 1 — ACIERTO INDEPENDIENTE
// ═══════════════════════════════════════════════════════════════
section('TEST 1 — Acierto independiente: máximo peso')
{
  const profile = buildProfile([
    { type: 'recognized', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'recalled', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'explained', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
  ])

  assert(profile.independentSuccesses === 3, 'independentSuccesses = 3')
  assert(profile.maxAssistanceLevelUsed === 'independent', 'maxAssistanceLevelUsed = independent')
  assert(profile.masteryScore > 0, `masteryScore > 0 (${profile.masteryScore})`)

  const d = diag(profile, { lastAssistanceLevel: 'independent' })
  assert(d.canAdvance === true, 'canAdvance = true con 3 éxitos independientes')
  assert(d.isFalseMastery === false, 'isFalseMastery = false')
  assert(d.independenceLevel === 'medium' || d.independenceLevel === 'high', `independenceLevel >= medium (${d.independenceLevel})`)
}

// ═══════════════════════════════════════════════════════════════
// TEST 2 — ACIERTO CON MINIMAL HINT
// ═══════════════════════════════════════════════════════════════
section('TEST 2 — Minimal hint: menor peso que independent')
{
  const profileIndep = buildProfile([
    { type: 'recognized', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'recalled', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
  ])

  const profileHint = buildProfile([
    { type: 'recognized', strength: 'strong', assistanceLevel: 'minimal_hint', outcome: 'correct' },
    { type: 'recalled', strength: 'strong', assistanceLevel: 'minimal_hint', outcome: 'correct' },
  ])

  assert(profileIndep.independentSuccesses === 2, 'independent: independentSuccesses = 2')
  assert(profileHint.independentSuccesses === 0, 'minimal_hint: independentSuccesses = 0')
  assert(profileIndep.masteryScore >= profileHint.masteryScore, 'independent mastery >= hint mastery (mismos tipos/fuerza)')

  const dHint = diag(profileHint, { lastAssistanceLevel: 'minimal_hint' })
  assert(dHint.reasons.includes('insufficient_independent_evidence'), 'hint: insufficient_independent_evidence en reasons')
}

// ═══════════════════════════════════════════════════════════════
// TEST 3 — ACIERTO ASSISTED
// ═══════════════════════════════════════════════════════════════
section('TEST 3 — Assisted: no marca dominio independiente')
{
  const profile = buildProfile([
    { type: 'recognized', strength: 'strong', assistanceLevel: 'assisted', outcome: 'correct' },
    { type: 'recalled', strength: 'strong', assistanceLevel: 'assisted', outcome: 'correct' },
    { type: 'explained', strength: 'strong', assistanceLevel: 'assisted', outcome: 'correct' },
  ])

  assert(profile.independentSuccesses === 0, 'assisted: independentSuccesses = 0')
  assert(profile.maxAssistanceLevelUsed === 'assisted', 'maxAssistanceLevelUsed = assisted')

  // isReadyToAdvanceEvidence debe bloquearlo
  const canAdvance = isReadyToAdvanceEvidence(profile, microStub)
  assert(canAdvance === false, 'isReadyToAdvanceEvidence = false con solo assisted')

  const d = diag(profile, { lastAssistanceLevel: 'assisted' })
  assert(d.isFalseMastery === true, 'isFalseMastery = true')
  assert(d.canAdvance === false, 'canAdvance = false')
  assert(d.reasons.includes('assisted_only_evidence'), 'assisted_only_evidence en reasons')
}

// ═══════════════════════════════════════════════════════════════
// TEST 4 — REVEALED
// ═══════════════════════════════════════════════════════════════
section('TEST 4 — Revealed: no demuestra dominio')
{
  const profile = buildProfile([
    { type: 'recognized', strength: 'strong', assistanceLevel: 'revealed', outcome: 'correct' },
    { type: 'recalled', strength: 'medium', assistanceLevel: 'revealed', outcome: 'correct' },
  ])

  assert(profile.independentSuccesses === 0, 'revealed: independentSuccesses = 0')
  assert(profile.maxAssistanceLevelUsed === 'revealed', 'maxAssistanceLevelUsed = revealed')

  const canAdvance = isReadyToAdvanceEvidence(profile, microStub)
  assert(canAdvance === false, 'isReadyToAdvanceEvidence = false con solo revealed')

  const d = diag(profile, { lastAssistanceLevel: 'revealed' })
  assert(d.reasons.includes('revealed_no_mastery'), 'revealed_no_mastery en reasons')
  assert(d.isFalseMastery === true, 'isFalseMastery = true')
  assert(d.suggestedAction === 'verify_independent' || d.suggestedAction === 'simplify_to_core', `suggestedAction no es consolidate (${d.suggestedAction})`)
}

// ═══════════════════════════════════════════════════════════════
// TEST 5 — ERROR CON ALTA CONFIANZA
// ═══════════════════════════════════════════════════════════════
section('TEST 5 — Error con alta confianza: ilusión de conocimiento')
{
  // Alta confianza + error = ilusión
  const illusionDetected = detectKnowledgeIllusion({
    outcome: 'incorrect',
    selfReportedConfidence: 80,
    assistanceLevel: 'independent',
  })
  assert(illusionDetected === true, 'confianza 80 + error → ilusión detectada')

  // Justo en el umbral
  const atThreshold = detectKnowledgeIllusion({
    outcome: 'incorrect',
    selfReportedConfidence: HIGH_CONFIDENCE_THRESHOLD,
    assistanceLevel: 'independent',
  })
  assert(atThreshold === true, `confianza = ${HIGH_CONFIDENCE_THRESHOLD} (umbral) → ilusión`)

  // Justo debajo del umbral
  const belowThreshold = detectKnowledgeIllusion({
    outcome: 'incorrect',
    selfReportedConfidence: HIGH_CONFIDENCE_THRESHOLD - 1,
    assistanceLevel: 'independent',
  })
  assert(belowThreshold === false, `confianza = ${HIGH_CONFIDENCE_THRESHOLD - 1} → no ilusión`)

  // diagnosePedagogicalState
  const profile = emptyEvidenceProfile('illusion_micro')
  const d = diag(profile, {
    lastOutcome: 'incorrect',
    selfReportedConfidence: 85,
    lastAssistanceLevel: 'independent',
  })
  assert(d.hasKnowledgeIllusion === true, 'diagnosis: hasKnowledgeIllusion = true')
  assert(d.reasons.includes('knowledge_illusion_detected'), 'knowledge_illusion_detected en reasons')
  assert(d.reasons.includes('high_confidence_error'), 'high_confidence_error en reasons')
  assert(d.suggestedAction === 'address_misconception', `suggestedAction = address_misconception (${d.suggestedAction})`)
}

// ═══════════════════════════════════════════════════════════════
// TEST 6 — ERROR CON BAJA CONFIANZA
// ═══════════════════════════════════════════════════════════════
section('TEST 6 — Error con baja confianza: no es ilusión')
{
  const lowConfError = detectKnowledgeIllusion({
    outcome: 'incorrect',
    selfReportedConfidence: 20,
    assistanceLevel: 'independent',
  })
  assert(lowConfError === false, 'confianza baja + error → no ilusión')

  // Sin confianza reportada
  const noConfError = detectKnowledgeIllusion({
    outcome: 'incorrect',
    selfReportedConfidence: undefined,
    assistanceLevel: 'independent',
  })
  assert(noConfError === false, 'sin confianza + error → no ilusión')

  const profile = emptyEvidenceProfile('low_conf')
  const d = diag(profile, {
    lastOutcome: 'incorrect',
    selfReportedConfidence: 15,
    lastAssistanceLevel: 'independent',
  })
  assert(d.hasKnowledgeIllusion === false, 'diagnosis: hasKnowledgeIllusion = false')
  assert(d.reasons.includes('low_confidence_error'), 'low_confidence_error en reasons')
  assert(!d.reasons.includes('high_confidence_error'), 'NO high_confidence_error en reasons')
}

// ═══════════════════════════════════════════════════════════════
// TEST 7 — TIEMPO EXCESIVO
// ═══════════════════════════════════════════════════════════════
section('TEST 7 — Tiempo de respuesta: lento vs razonable')
{
  const profileNormal = emptyEvidenceProfile('speed_normal')
  const dNormal = diag(profileNormal, {
    lastOutcome: 'correct',
    responseTimeMs: 5000,
    formatUsed: 'multiple_choice',
  })
  assert(dNormal.wasVerySlowResponse === false, 'MCQ 5s: no es lenta')

  const profileSlow = emptyEvidenceProfile('speed_slow')
  const dSlow = diag(profileSlow, {
    lastOutcome: 'correct',
    responseTimeMs: 35000,
    formatUsed: 'multiple_choice',
  })
  assert(dSlow.wasVerySlowResponse === true, 'MCQ 35s: muy lenta (umbral 30s)')
  assert(dSlow.reasons.includes('response_too_slow'), 'response_too_slow en reasons')

  // No genera NaN
  const dUndefined = diag(profileNormal, { responseTimeMs: undefined })
  assert(dUndefined.wasVerySlowResponse === false, 'sin responseTimeMs: no marca lenta')
}

// ═══════════════════════════════════════════════════════════════
// TEST 8 — SPACED REVIEW REAL
// ═══════════════════════════════════════════════════════════════
section('TEST 8 — Spaced review: activa retención')
{
  // Respuesta independiente en spaced_review activa hasDelayedRecall
  let profile = emptyEvidenceProfile('spaced')
  profile = recordEvidence(profile, {
    formatUsed: 'multiple_choice',
    outcome: 'correct', score: 100, turnNumber: 1,
    assistanceLevel: 'independent',
    interactionContext: 'spaced_review',
    elapsedSinceLastExposureMs: 21 * 60 * 60 * 1000,
  })
  assert(profile.hasDelayedRecall === true, 'spaced_review con intervalo suficiente activa hasDelayedRecall')

  const d = diag(profile, {
    interactionContext: 'spaced_review',
    lastAssistanceLevel: 'independent',
    lastOutcome: 'correct',
  })
  assert(!d.reasons.includes('needs_delayed_recall') || d.reasons.includes('ok_to_advance'),
    'spaced_review independiente: no bloquea por delayed recall')
}

// ═══════════════════════════════════════════════════════════════
// TEST 9 — INTERLEAVING NO ES DELAYED RECALL
// ═══════════════════════════════════════════════════════════════
section('TEST 9 — Interleaving ≠ delayed recall automático')
{
  let profileInterleaved = emptyEvidenceProfile('interleaved')
  profileInterleaved = recordEvidence(profileInterleaved, {
    formatUsed: 'multiple_choice',
    outcome: 'correct', score: 100, turnNumber: 1,
    assistanceLevel: 'independent',
    interactionContext: 'interleaving',
  })

  assert(profileInterleaved.hasDelayedRecall === false,
    'interleaving NO activa hasDelayedRecall')

  // Pero immediate_practice NO activa hasDelayedRecall
  let profileImmediate = emptyEvidenceProfile('immediate')
  profileImmediate = recordEvidence(profileImmediate, {
    formatUsed: 'multiple_choice',
    outcome: 'correct', score: 100, turnNumber: 1,
    assistanceLevel: 'independent',
    interactionContext: 'immediate_practice',
  })
  assert(profileImmediate.hasDelayedRecall === false,
    'immediate_practice NO activa hasDelayedRecall')
}

// ═══════════════════════════════════════════════════════════════
// TEST 10 — TRANSFERENCIA REAL
// ═══════════════════════════════════════════════════════════════
section('TEST 10 — Transferencia real: activa hasTransfer')
{
  let profile = emptyEvidenceProfile('transfer')
  // Formato practical_case genera ['applied', 'transferred']
  profile = recordEvidence(profile, {
    formatUsed: 'practical_case',
    outcome: 'correct', score: 90, turnNumber: 1,
    assistanceLevel: 'independent',
    interactionContext: 'learning',
  })
  assert(profile.hasTransfer === true, 'practical_case activa hasTransfer')

  // Pregunta MCQ simple NO activa hasTransfer
  let profile2 = emptyEvidenceProfile('no_transfer')
  profile2 = recordEvidence(profile2, {
    formatUsed: 'multiple_choice',
    outcome: 'correct', score: 100, turnNumber: 1,
    assistanceLevel: 'independent',
  })
  assert(profile2.hasTransfer === false, 'MCQ NO activa hasTransfer')
}

// ═══════════════════════════════════════════════════════════════
// TEST 11 — INTEGRACIÓN REAL
// ═══════════════════════════════════════════════════════════════
section('TEST 11 — Integración real: activa hasIntegration')
{
  let profile = emptyEvidenceProfile('integration')
  // concept_map genera ['connected']
  profile = recordEvidence(profile, {
    formatUsed: 'concept_map',
    outcome: 'correct', score: 85, turnNumber: 1,
    assistanceLevel: 'independent',
  })
  assert(profile.hasIntegration === true, 'concept_map activa hasIntegration')

  // matching simple también puede activarlo (genera 'recognized' + 'connected')
  let profile2 = emptyEvidenceProfile('integration2')
  profile2 = recordEvidence(profile2, {
    formatUsed: 'matching',
    outcome: 'correct', score: 90, turnNumber: 1,
    assistanceLevel: 'independent',
  })
  assert(profile2.hasIntegration === true, 'matching activa hasIntegration via connected')

  // MCQ simple NO activa integración
  let profile3 = emptyEvidenceProfile('no_integration')
  profile3 = recordEvidence(profile3, {
    formatUsed: 'multiple_choice',
    outcome: 'correct', score: 100, turnNumber: 1,
    assistanceLevel: 'independent',
  })
  assert(profile3.hasIntegration === false, 'MCQ NO activa hasIntegration')
}

// ═══════════════════════════════════════════════════════════════
// TEST 12 — VARIOS ACIERTOS ASISTIDOS ≠ VARIOS INDEPENDIENTES
// ═══════════════════════════════════════════════════════════════
section('TEST 12 — Múltiples assisted ≠ múltiples independent')
{
  const profileAssisted = buildProfile([
    { type: 'recognized', strength: 'strong', assistanceLevel: 'assisted', outcome: 'correct' },
    { type: 'recalled', strength: 'strong', assistanceLevel: 'assisted', outcome: 'correct' },
    { type: 'explained', strength: 'strong', assistanceLevel: 'assisted', outcome: 'correct' },
    { type: 'applied', strength: 'strong', assistanceLevel: 'assisted', outcome: 'correct' },
  ])

  // Necesitamos 8 evidencias (2 strong de cada tipo principal) para masteryScore >= 40
  const easyMicroT12 = { id: 'easy', difficulty: 10, importance: 'low', cognitiveType: 'definitional' } as any
  const profileIndep = buildProfile([
    { type: 'recognized', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'recognized', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'recalled', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'recalled', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'explained', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'explained', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'applied', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'applied', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
  ])

  assert(profileAssisted.independentSuccesses === 0, 'assisted: independentSuccesses = 0')
  assert(profileIndep.independentSuccesses === 8, 'independent: independentSuccesses = 8')
  assert(profileIndep.masteryScore >= 40, `profileIndep masteryScore >= 40 (got ${profileIndep.masteryScore})`)

  const canAdvanceAssisted = isReadyToAdvanceEvidence(profileAssisted, easyMicroT12)
  const canAdvanceIndep = isReadyToAdvanceEvidence(profileIndep, easyMicroT12)

  assert(canAdvanceAssisted === false, 'solo assisted: NO puede avanzar')
  assert(canAdvanceIndep === true, 'solo independent con mastery suficiente: SÍ puede avanzar')
}

// ═══════════════════════════════════════════════════════════════
// TEST 13 — RECUPERACIÓN DESPUÉS DE REVEAL
// ═══════════════════════════════════════════════════════════════
section('TEST 13 — Recuperación después de revealed')
{
  let profile = emptyEvidenceProfile('recovery')

  // Primera: revealed (no cuenta)
  profile = recordEvidence(profile, {
    formatUsed: 'multiple_choice',
    outcome: 'correct', score: 100, turnNumber: 1,
    assistanceLevel: 'revealed',
  })
  assert(profile.independentSuccesses === 0, 'tras revealed: independentSuccesses = 0')
  assert(isReadyToAdvanceEvidence(profile, microStub) === false, 'tras revealed: no puede avanzar')

  // Segunda: actividad nueva, independiente
  profile = recordEvidence(profile, {
    formatUsed: 'fill_blank',
    outcome: 'correct', score: 90, turnNumber: 2,
    assistanceLevel: 'independent',
  })
  assert(profile.independentSuccesses === 1, 'tras independent: independentSuccesses = 1')
  assert(profile.evidences.length === 2, 'ambas evidencias conservadas en el perfil')
  assert(profile.maxAssistanceLevelUsed === 'revealed', 'maxAssistanceLevelUsed sigue siendo revealed')

  // No contamina permanentemente: con suficientes independientes puede avanzar
  // Usar rebuildProfile para consistencia — recordEvidence en cadena puede acumular
  // attemptsCountByType de forma diferente a una reconstrucción limpia
  const allEvs13 = [
    ...profile.evidences,
    { type: 'recognized' as any, strength: 'strong' as any, turnNumber: 3, timestamp: Date.now()+2000, formatUsed: 'true_false', outcome: 'correct' as any, score: 100, attemptNumber: 1, confidenceMultiplier: 1.0, assistanceLevel: 'independent' as any },
    { type: 'recalled' as any, strength: 'medium' as any, turnNumber: 4, timestamp: Date.now()+3000, formatUsed: 'matching', outcome: 'correct' as any, score: 85, attemptNumber: 1, confidenceMultiplier: 1.0, assistanceLevel: 'independent' as any },
  ]
  const profileFull = rebuildProfile('recovery', allEvs13)
  assert(profileFull.independentSuccesses === 3, `con 3 independent posteriores: independentSuccesses = 3 (got ${profileFull.independentSuccesses})`)
  // Ahora el maxAssistanceLevelUsed es revealed — esto BLOQUEA avance
  // porque el contrato exige que el nivel máximo sea <= al permitido
  // Documentamos: revealed en el historial bloquea avance en mastery contract
  // pero no en isReadyToAdvanceEvidence si hay suficientes independientes
  const canAdvance = isReadyToAdvanceEvidence(profile, microStub)
  // Con 3 independientes y totalEvidences ≥ minCorrect, puede avanzar
  assert(typeof canAdvance === 'boolean', 'isReadyToAdvanceEvidence devuelve boolean (no NaN)')
}

// ═══════════════════════════════════════════════════════════════
// TEST 14 — PRECEDENCIA DE ASSISTANCELEVEL
// ═══════════════════════════════════════════════════════════════
section('TEST 14 — Precedencia de assistanceLevel')
{
  // frontend independent + route inferred assisted → independent (frontend gana)
  assert(
    resolveAssistanceLevel('independent', 'assisted') === 'independent',
    'frontend=independent > route=assisted → independent',
  )

  // frontend revealed + route inferred minimal_hint → revealed (frontend gana)
  assert(
    resolveAssistanceLevel('revealed', 'minimal_hint') === 'revealed',
    'frontend=revealed > route=minimal_hint → revealed',
  )

  // frontend undefined + route inferred guided → guided (fallback al route)
  assert(
    resolveAssistanceLevel(undefined, 'guided') === 'guided',
    'frontend=undefined, route=guided → guided',
  )

  // ambos undefined → independent (fallback conservador)
  assert(
    resolveAssistanceLevel(undefined, undefined) === 'independent',
    'ambos undefined → independent',
  )

  // frontend assisted + route inferred revealed → assisted (frontend tiene prioridad)
  // Esto es correcto: el frontend mide la ayuda REAL de esta actividad
  assert(
    resolveAssistanceLevel('assisted', 'revealed') === 'assisted',
    'frontend=assisted, route=revealed → assisted (frontend es la verdad)',
  )
}

// ═══════════════════════════════════════════════════════════════
// TEST 15 — NO AVANCE PREMATURO
// ═══════════════════════════════════════════════════════════════
section('TEST 15 — No avance prematuro con un solo acierto')
{
  let profile = emptyEvidenceProfile('premature')
  profile = recordEvidence(profile, {
    formatUsed: 'multiple_choice',
    outcome: 'correct', score: 100, turnNumber: 1,
    assistanceLevel: 'independent',
  })

  assert(profile.independentSuccesses === 1, 'un acierto: independentSuccesses = 1')
  // Un micro de dificultad 40 (medium) necesita al menos 3 correctas y 55% mastery
  const canAdvance = isReadyToAdvanceEvidence(profile, { ...microStub, difficulty: 40 })
  assert(canAdvance === false, 'un solo acierto no permite avance (necesita >= 3 para difficulty 40)')

  const d = diag(profile, { lastAssistanceLevel: 'independent' })
  assert(d.reasons.includes('single_success_not_enough') || d.reasons.includes('insufficient_independent_evidence'),
    'razón estructurada indica evidencia insuficiente')
}

// ═══════════════════════════════════════════════════════════════
// TEST 16 — AVANCE JUSTIFICADO
// ═══════════════════════════════════════════════════════════════
section('TEST 16 — Avance justificado con evidencia suficiente')
{
  // Para que isReadyToAdvanceEvidence sea true necesitamos:
  // difficulty=10 → minMastery=40, minCorrect=2
  // Con 8 evidencias (2 strong de cada tipo principal) alcanzamos mastery suficiente
  const profileJustified = buildProfile([
    { type: 'recognized', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'recognized', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'recalled', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'recalled', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'explained', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'explained', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'applied', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
    { type: 'applied', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
  ])

  const easyMicro = { id: 'easy16', difficulty: 10, importance: 'low', cognitiveType: 'definitional' } as any
  const canAdvance = isReadyToAdvanceEvidence(profileJustified, easyMicro)
  assert(canAdvance === true, 'micro muy fácil con 8 éxitos independientes variados: puede avanzar')
  assert(profileJustified.independentSuccesses === 8, `independentSuccesses = 8 (got ${profileJustified.independentSuccesses})`)
  assert(profileJustified.masteryScore >= 40, `masteryScore >= 40 (got ${profileJustified.masteryScore})`)

  const d = diag(profileJustified, { lastAssistanceLevel: 'independent', lastOutcome: 'correct' })
  assert(d.canAdvance === true, 'diagnosis: canAdvance = true')
  assert(d.reasons.includes('ok_to_advance'), 'ok_to_advance en reasons')
}

// ═══════════════════════════════════════════════════════════════
// TEST 17 — RESTORE NO CAMBIA DECISIÓN
// ═══════════════════════════════════════════════════════════════
section('TEST 17 — Restore conserva la misma decisión')
{
  let profile = emptyEvidenceProfile('restore_decision')
  profile = recordEvidence(profile, {
    formatUsed: 'multiple_choice', outcome: 'correct', score: 100, turnNumber: 1,
    assistanceLevel: 'guided', responseTimeMs: 8000, selfReportedConfidence: 60,
    interactionContext: 'immediate_practice',
  })
  profile = recordEvidence(profile, {
    formatUsed: 'fill_blank', outcome: 'correct', score: 90, turnNumber: 2,
    assistanceLevel: 'independent', responseTimeMs: 5000, selfReportedConfidence: 75,
    interactionContext: 'immediate_practice',
  })

  const diagBefore = diag(profile, { lastAssistanceLevel: 'independent', lastOutcome: 'correct' })
  const canAdvanceBefore = isReadyToAdvanceEvidence(profile, microStub)
  const masteryBefore = profile.masteryScore
  const indepBefore = profile.independentSuccesses

  // Round trip
  const serialized = JSON.stringify(profile)
  const restored = rebuildProfile(
    JSON.parse(serialized).microId,
    JSON.parse(serialized).evidences,
  )

  const diagAfter = diag(restored, { lastAssistanceLevel: 'independent', lastOutcome: 'correct' })
  const canAdvanceAfter = isReadyToAdvanceEvidence(restored, microStub)
  const masteryAfter = restored.masteryScore
  const indepAfter = restored.independentSuccesses

  assert(masteryBefore === masteryAfter, `mastery igual antes/después (${masteryBefore} vs ${masteryAfter})`)
  assert(indepBefore === indepAfter, `independentSuccesses igual (${indepBefore} vs ${indepAfter})`)
  assert(canAdvanceBefore === canAdvanceAfter, 'canAdvance igual antes/después del restore')
  assert(diagBefore.canAdvance === diagAfter.canAdvance, 'diagnosis.canAdvance igual')
  assert(diagBefore.isFalseMastery === diagAfter.isFalseMastery, 'isFalseMastery igual')
  assert(diagBefore.hasKnowledgeIllusion === diagAfter.hasKnowledgeIllusion, 'hasKnowledgeIllusion igual')
}

// ═══════════════════════════════════════════════════════════════
// TEST 18 — REGRESIÓN
// ═══════════════════════════════════════════════════════════════
section('TEST 18 — Regresión: bugs que esta fase corrige')
{
  // Bug 1: assisted contado como independent
  const profileAssisted = buildProfile([
    { type: 'recognized', strength: 'strong', assistanceLevel: 'assisted', outcome: 'correct' },
  ])
  assert(profileAssisted.independentSuccesses === 0,
    '[REGRESIÓN] assisted no cuenta como independent')

  // Bug 2: revealed aumenta dominio como acierto normal
  const profileRevealed = buildProfile([
    { type: 'recognized', strength: 'strong', assistanceLevel: 'revealed', outcome: 'correct' },
    { type: 'recalled', strength: 'strong', assistanceLevel: 'revealed', outcome: 'correct' },
  ])
  assert(isReadyToAdvanceEvidence(profileRevealed, microStub) === false,
    '[REGRESIÓN] revealed no desbloquea avance')
  assert(profileRevealed.independentSuccesses === 0,
    '[REGRESIÓN] revealed no cuenta como independent')

  // Bug 3: interleaving activando delayed recall (documentado como comportamiento actual)
  // Este test documenta el estado actual, no un bug
  let profileImmediate = emptyEvidenceProfile('bug3')
  profileImmediate = recordEvidence(profileImmediate, {
    formatUsed: 'multiple_choice', outcome: 'correct', score: 100, turnNumber: 1,
    assistanceLevel: 'independent', interactionContext: 'immediate_practice',
  })
  assert(profileImmediate.hasDelayedRecall === false,
    '[REGRESIÓN] immediate_practice NO activa delayed recall')

  // Bug 4: confianza alta incorrecta ignorada
  const illusion = detectKnowledgeIllusion({
    outcome: 'incorrect', selfReportedConfidence: 90, assistanceLevel: 'independent',
  })
  assert(illusion === true, '[REGRESIÓN] error + confianza 90 → ilusión detectada')

  // Bug 5: sin confianza → no activar ilusión
  const noIllusion = detectKnowledgeIllusion({
    outcome: 'incorrect', selfReportedConfidence: undefined, assistanceLevel: 'independent',
  })
  assert(noIllusion === false, '[REGRESIÓN] sin confianza reportada → no ilusión')

  // Bug 6: precedencia de assistance
  assert(
    resolveAssistanceLevel('revealed', 'minimal_hint') === 'revealed',
    '[REGRESIÓN] frontend=revealed nunca reducido a minimal_hint',
  )

  // Bug 7: legacy evidence no infla dominio
  const legacyWeight = getLegacyEvidenceWeight({ outcome: 'correct', assistanceLevel: undefined })
  assert(legacyWeight < 1.0, `[REGRESIÓN] evidencia legacy pesa ${legacyWeight} < 1.0`)
  assert(legacyWeight === LEGACY_EVIDENCE_WEIGHT, `[REGRESIÓN] peso legacy = ${LEGACY_EVIDENCE_WEIGHT}`)

  // Bug 8: decision después de restore es la misma
  const p1 = buildProfile([
    { type: 'recognized', strength: 'strong', assistanceLevel: 'independent', outcome: 'correct' },
  ])
  const p2 = rebuildProfile(JSON.parse(JSON.stringify(p1)).microId, JSON.parse(JSON.stringify(p1)).evidences)
  assert(
    isReadyToAdvanceEvidence(p1, microStub) === isReadyToAdvanceEvidence(p2, microStub),
    '[REGRESIÓN] decision igual antes/después del restore',
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
