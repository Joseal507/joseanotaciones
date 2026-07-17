/**
 * FASE 8 — Tests de cierre de sesión vs finalización real del programa
 * Ejecutar: npx tsx scripts/tests/phase8-program-completion.ts
 */

import {
  initMicroState,
  MAX_INTERACTIONS_PER_MICRO,
  shouldCloseSession,
  evaluateSessionCompletion,
  type MicroResolutionStatus,
} from '../../lib/adaptive/v3/engine/stateMachine'
import {
  rebuildProfile,
  recordEvidence,
  emptyEvidenceProfile,
} from '../../lib/adaptive/v3/engine/evidenceEngine'
import type { SessionState } from '../../lib/adaptive/v3/types'

let passed = 0
let failed = 0
const failures: string[] = []

function assert(condition: boolean, msg: string): void {
  if (condition) { console.log(`  ✓ ${msg}`); passed++ }
  else { console.error(`  ✗ ${msg}`); failed++; failures.push(msg) }
}
function section(name: string): void { console.log(`\n═══ ${name} ═══`) }

// ─── Helpers ────────────────────────────────────────────────

function buildMinimalSession(params: {
  microIds: string[]
  completedMicroIds?: string[]
  activeMicroId?: string | null
  pendingMicroIds?: string[]
}): SessionState {
  const { microIds, completedMicroIds = [], activeMicroId = null, pendingMicroIds } = params
  const microStates: Record<string, any> = {}

  for (const id of microIds) {
    microStates[id] = {
      ...initMicroState(id),
      microId: id,
    }
  }

  const pending = pendingMicroIds ?? microIds.filter(id =>
    !completedMicroIds.includes(id) && id !== activeMicroId
  )

  const session: any = {
    sessionId: 'test_sess',
    userId: 'test_user',
    materialId: 'test_mat',
    startedAt: Date.now(),
    currentTurn: 1,
    totalTurnsCompleted: 1,
    elapsedSeconds: 60,
    targetMinutes: 20,
    microStates,
    queue: {
      sessionId: 'test_sess',
      pendingMicroIds: pending,
      activeMicroId,
      completedMicroIds,
      postponedMicroIds: [],
      totalPlanned: microIds.length,
      createdAt: Date.now(),
    },
    recentTurns: [],
    totalCorrect: 0,
    totalIncorrect: 0,
    totalPartial: 0,
    consecutiveCorrect: 0,
    consecutiveIncorrect: 0,
    studentState: { energy: 'engaged', pace: 'medium', confidence: 'medium' },
    requiredMicroIds: microIds,
  }
  return session as SessionState
}

function markMicroStudied(session: SessionState, microId: string): SessionState {
  const st = { ...(session.microStates[microId] as any) }
  st.evidence = {
    ...st.evidence,
    introduced: true,
    explainedByTutor: true,
    answeredCorrectly: 1,
    answeredIncorrectly: 0,
  }
  st.totalInteractions = 2
  return {
    ...session,
    microStates: { ...session.microStates, [microId]: st },
  }
}

function markMicroFused(session: SessionState, microId: string): SessionState {
  const st = { ...(session.microStates[microId] as any) }
  st.evidence = {
    ...st.evidence,
    introduced: true,
    explainedByTutor: true,
    answeredCorrectly: 1,
    answeredIncorrectly: 3,
  }
  st.totalInteractions = MAX_INTERACTIONS_PER_MICRO
  st.isReady = true // fusible: isReady por totalInteractions, no por evidencia
  st.masteryLevel = 'struggling'
  // No hay independentSuccesses reales en evidenceProfile
  st.evidenceProfile = emptyEvidenceProfile(microId)
  return {
    ...session,
    microStates: { ...session.microStates, [microId]: st },
  }
}

function markMicroDominated(session: SessionState, microId: string): SessionState {
  const st = { ...(session.microStates[microId] as any) }
  st.evidence = {
    ...st.evidence,
    introduced: true,
    explainedByTutor: true,
    answeredCorrectly: 8,
    answeredIncorrectly: 0,
  }
  st.totalInteractions = 4
  st.isReady = true
  st.masteryLevel = 'mastered'
  // Perfil canónico: cumple definitional con score suficiente + independencia suficiente
  let profile = emptyEvidenceProfile(microId)
  const plan = [
    'multiple_choice', 'multiple_choice',
    'fill_blank', 'fill_blank',
    'open_response', 'open_response',
    'step_by_step_solver', 'step_by_step_solver',
  ] as const
  for (let i = 0; i < plan.length; i++) {
    profile = recordEvidence(profile, {
      formatUsed: plan[i],
      outcome: 'correct', score: 90, turnNumber: i + 1,
      assistanceLevel: 'independent',
    })
  }
  st.evidenceProfile = profile
  return {
    ...session,
    microStates: { ...session.microStates, [microId]: st },
  }
}

// TEST 1 — FUSIBLE NO DOMINA
section('TEST 1 — Fusible no produce dominio')
{
  let session = buildMinimalSession({ microIds: ['A'] })
  session = markMicroFused(session, 'A')

  const result = evaluateSessionCompletion(session)

  assert(result.microResolutions['A']?.status === 'unresolved_struggling' ||
         result.microResolutions['A']?.status === 'unresolved_fused',
    'micro A: unresolved tras fusible')
  assert(result.isProgramComplete === false, 'programComplete = false con micro unresolved')
  assert(result.unresolvedMicroIds.includes('A'), 'A en unresolvedMicroIds')
  assert(result.masteredCount === 0, 'masteredCount = 0')
}

// TEST 2 — SESIÓN PUEDE CERRAR CON PENDIENTES
section('TEST 2 — Sesión cierra con micro B unresolved')
{
  let session = buildMinimalSession({
    microIds: ['A', 'B'],
    completedMicroIds: ['A'],
    activeMicroId: null,
    pendingMicroIds: [],
  })
  session = markMicroDominated(session, 'A')
  session = markMicroFused(session, 'B')

  const result = evaluateSessionCompletion(session)
  const sessionCloses = shouldCloseSession(session)

  assert(sessionCloses === true, 'shouldCloseSession = true (todos processed)')
  assert(result.isSessionComplete === true, 'isSessionComplete = true')
  assert(result.isProgramComplete === false, 'isProgramComplete = false (B unresolved)')
  assert(result.unresolvedMicroIds.includes('B'), 'B en unresolvedMicroIds')
  assert(result.masteredCount === 1, `masteredCount = 1 (got ${result.masteredCount})`)
  assert(result.closeReason === 'unresolved_micros_deferred', 'closeReason = unresolved_micros_deferred')
}

// TEST 3 — COBERTURA 100, DOMINIO MENOR
section('TEST 3 — Cobertura 100% no implica dominio 100%')
{
  let session = buildMinimalSession({
    microIds: ['A', 'B'],
    completedMicroIds: ['A'],
    activeMicroId: null,
    pendingMicroIds: [],
  })
  session = markMicroDominated(session, 'A')
  session = markMicroStudied(session, 'B') // estudiado pero no dominado

  const result = evaluateSessionCompletion(session)

  assert(result.coveragePercent === 100, `coveragePercent = 100 (got ${result.coveragePercent})`)
  assert(result.masteryPercent < 100, `masteryPercent < 100 (got ${result.masteryPercent})`)
  assert(result.isProgramComplete === false, 'programComplete = false con B no dominado')

  // Los dos conceptos NO deben confundirse
  assert(result.coveragePercent !== result.masteryPercent || result.coveragePercent === 100,
    'coverage y mastery son conceptos distintos')
}

// TEST 4 — MICRO UNRESOLVED SOBREVIVE AL RESTORE
section('TEST 4 — Micro unresolved persiste en restore')
{
  let session = buildMinimalSession({ microIds: ['A', 'B'] })
  session = markMicroDominated(session, 'A')
  session = markMicroFused(session, 'B')

  const result1 = evaluateSessionCompletion(session)

  // Simular restore via JSON (igual que R2)
  const restored = JSON.parse(JSON.stringify(session)) as SessionState

  const result2 = evaluateSessionCompletion(restored)

  assert(result1.isProgramComplete === result2.isProgramComplete, 'isProgramComplete igual tras restore')
  assert(result1.unresolvedMicroIds.length === result2.unresolvedMicroIds.length, 'unresolvedMicroIds igual tras restore')
  assert(result1.masteredCount === result2.masteredCount, 'masteredCount igual tras restore')
  assert(result1.coveragePercent === result2.coveragePercent, 'coveragePercent igual tras restore')
}

// TEST 5 — NO REPETIR ESTRATEGIA AGOTADA
section('TEST 5 — Micro fused tiene razón documentada')
{
  let session = buildMinimalSession({ microIds: ['A'] })
  session = markMicroFused(session, 'A')

  const result = evaluateSessionCompletion(session)
  const resolution = result.microResolutions['A']

  assert(resolution !== undefined, 'A tiene resolution')
  assert(resolution.reason.includes('max_interactions') || resolution.reason.includes('without_mastery'),
    `razón documenta el fusible: ${resolution.reason}`)
  assert(resolution.status !== 'mastered', 'status NO es mastered')
}

// TEST 6 — DOMINIO POSTERIOR DE MICRO PREVIAMENTE UNRESOLVED
section('TEST 6 — Dominio posterior cambia el estado del micro')
{
  let session = buildMinimalSession({ microIds: ['A'] })

  // Sesión 1: micro A fused
  session = markMicroFused(session, 'A')
  const result1 = evaluateSessionCompletion(session)
  assert(result1.isProgramComplete === false, 'sesión 1: programComplete = false')

  // Sesión 2 simulada: micro A dominado
  let session2 = buildMinimalSession({ microIds: ['A'], completedMicroIds: ['A'] })
  session2 = markMicroDominated(session2, 'A')
  const result2 = evaluateSessionCompletion(session2)

  assert(result2.isProgramComplete === true, 'sesión 2: programComplete = true tras dominar A')
  assert(result2.masteredCount === 1, 'masteredCount = 1')
  assert(result2.unresolvedMicroIds.length === 0, 'no hay unresolved')
}

// TEST 7 — FINALIZACIÓN REAL
section('TEST 7 — Programa completo solo con todos dominados')
{
  let session = buildMinimalSession({
    microIds: ['A', 'B', 'C'],
    completedMicroIds: ['A', 'B', 'C'],
    pendingMicroIds: [],
  })
  session = markMicroDominated(session, 'A')
  session = markMicroDominated(session, 'B')
  session = markMicroDominated(session, 'C')

  const result = evaluateSessionCompletion(session)

  assert(result.isProgramComplete === true, 'programComplete = true con todos dominados')
  assert(result.masteredCount === 3, 'masteredCount = 3')
  assert(result.unresolvedMicroIds.length === 0, 'no hay unresolved')
  assert(result.masteryPercent === 100, 'masteryPercent = 100')
  assert(result.coveragePercent === 100, 'coveragePercent = 100')
}

// TEST 8 — ASSISTED NO FINALIZA PROGRAMA
section('TEST 8 — Assisted-only no finaliza el programa')
{
  let session = buildMinimalSession({ microIds: ['A'], completedMicroIds: ['A'] })
  const st = { ...(session.microStates['A'] as any) }
  st.evidence = {
    ...st.evidence,
    introduced: true,
    explainedByTutor: true,
    answeredCorrectly: 4,
    answeredIncorrectly: 0,
  }
  st.totalInteractions = 4
  st.isReady = true // isReady por stateMachine (legacy)
  st.masteryLevel = 'understood'
  // Perfil con solo assisted — sin independentSuccesses
  let profile = emptyEvidenceProfile('A')
  for (let i = 0; i < 4; i++) {
    profile = recordEvidence(profile, {
      formatUsed: 'multiple_choice',
      outcome: 'correct', score: 90, turnNumber: i + 1,
      assistanceLevel: 'assisted',
    })
  }
  st.evidenceProfile = profile
  session = {
    ...session,
    microStates: { ...session.microStates, 'A': st },
  }

  const result = evaluateSessionCompletion(session)

  assert(profile.independentSuccesses === 0, 'assisted: independentSuccesses = 0')
  assert(result.isProgramComplete === false, 'assisted-only: programComplete = false')
  assert(result.masteredCount === 0, 'masteredCount = 0 con solo assisted')
}

// TEST 9 — REVEALED NO FINALIZA PROGRAMA
section('TEST 9 — Revealed-only no finaliza el programa')
{
  let session = buildMinimalSession({ microIds: ['A'], completedMicroIds: ['A'] })
  const st = { ...(session.microStates['A'] as any) }
  st.evidence = {
    ...st.evidence,
    introduced: true,
    explainedByTutor: true,
    answeredCorrectly: 2,
    answeredIncorrectly: 0,
  }
  st.totalInteractions = 2
  st.isReady = true
  st.masteryLevel = 'understood'
  let profile = emptyEvidenceProfile('A')
  for (let i = 0; i < 2; i++) {
    profile = recordEvidence(profile, {
      formatUsed: 'multiple_choice',
      outcome: 'correct', score: 100, turnNumber: i + 1,
      assistanceLevel: 'revealed',
    })
  }
  st.evidenceProfile = profile
  session = {
    ...session,
    microStates: { ...session.microStates, 'A': st },
  }

  const result = evaluateSessionCompletion(session)
  assert(result.isProgramComplete === false, 'revealed-only: programComplete = false')
  assert(result.masteredCount === 0, 'masteredCount = 0 con solo revealed')
}

// TEST 10 — VARIOS FUSIBLES
section('TEST 10 — Varios micros fused, solo uno dominado')
{
  let session = buildMinimalSession({
    microIds: ['A', 'B', 'C'],
    completedMicroIds: ['A', 'B', 'C'],
    pendingMicroIds: [],
  })
  session = markMicroFused(session, 'A')
  session = markMicroFused(session, 'B')
  session = markMicroDominated(session, 'C')

  const result = evaluateSessionCompletion(session)

  assert(result.masteredCount === 1, 'solo C dominado')
  assert(result.unresolvedMicroIds.length === 2, 'A y B unresolved')
  assert(result.isProgramComplete === false, 'programComplete = false')
  assert(result.masteryPercent < 100, `masteryPercent < 100 (got ${result.masteryPercent})`)
}

// TEST 11 — SESSION COMPLETE ≠ PROGRAM COMPLETE
section('TEST 11 — sessionComplete y programComplete son contratos distintos')
{
  let session = buildMinimalSession({
    microIds: ['A', 'B'],
    completedMicroIds: ['A'],
    activeMicroId: null,
    pendingMicroIds: [],
  })
  session = markMicroDominated(session, 'A')
  session = markMicroFused(session, 'B')

  const sessionCloses = shouldCloseSession(session)
  const result = evaluateSessionCompletion(session)

  // Pueden tener valores distintos
  assert(sessionCloses === true, 'sesión cierra')
  assert(result.isProgramComplete === false, 'programa NO completo')
  assert(result.isSessionComplete !== result.isProgramComplete, 'son contratos distintos')

  // No son alias
  assert(typeof result.isSessionComplete === 'boolean', 'isSessionComplete es boolean')
  assert(typeof result.isProgramComplete === 'boolean', 'isProgramComplete es boolean')
}

// TEST 12 — UI SEMÁNTICA: COVERAGE ≠ MASTERY
section('TEST 12 — Semántica: coverage 100 con mastery < 100')
{
  let session = buildMinimalSession({
    microIds: ['A', 'B'],
    completedMicroIds: ['A'],
    activeMicroId: null,
    pendingMicroIds: [],
  })
  session = markMicroDominated(session, 'A')
  session = markMicroStudied(session, 'B') // cubierto pero no dominado

  const result = evaluateSessionCompletion(session)

  assert(result.coveragePercent === 100, 'coverage = 100%')
  assert(result.masteryPercent < 100, 'mastery < 100%')
  assert(result.isProgramComplete === false, 'programa no completo')

  // Nunca mostrar "programa completo" si masteryPercent < 100
  const shouldShowComplete = result.isProgramComplete
  assert(shouldShowComplete === false, 'UI no debe mostrar programa completo')
}

// TEST 13 — RESTORE PROGRAMA COMPLETO
section('TEST 13 — Restore de programa completo mantiene el estado')
{
  let session = buildMinimalSession({
    microIds: ['A', 'B'],
    completedMicroIds: ['A', 'B'],
    pendingMicroIds: [],
  })
  session = markMicroDominated(session, 'A')
  session = markMicroDominated(session, 'B')

  const result1 = evaluateSessionCompletion(session)
  assert(result1.isProgramComplete === true, 'pre-restore: programComplete = true')

  const restored = JSON.parse(JSON.stringify(session)) as SessionState
  const result2 = evaluateSessionCompletion(restored)

  assert(result2.isProgramComplete === true, 'post-restore: programComplete sigue true')
  assert(result2.masteryPercent === result1.masteryPercent, 'masteryPercent igual tras restore')
}

// TEST 14 — MICRO EN PROGRESO NO BLOQUEA SI NO ES REQUIRED
section('TEST 14 — Micro no requerido no afecta programComplete')
{
  // Solo A es required
  let session = buildMinimalSession({
    microIds: ['A', 'B'],
    completedMicroIds: ['A'],
    pendingMicroIds: [],
  })
  ;(session as any).requiredMicroIds = ['A'] // solo A
  session = markMicroDominated(session, 'A')
  session = markMicroFused(session, 'B') // B fused pero no required

  const result = evaluateSessionCompletion(session)

  // Solo A es evaluado como required
  assert(result.totalRequired === 1, 'totalRequired = 1 (solo A)')
  assert(result.masteredCount === 1, 'masteredCount = 1')
  assert(result.isProgramComplete === true, 'programComplete = true (A dominado, B no required)')
}

// TEST 15 — SESSION ABIERTA NO REPORTA COMPLETE
section('TEST 15 — Sesión abierta no reporta cierre prematuro')
{
  let session = buildMinimalSession({
    microIds: ['A', 'B'],
    activeMicroId: 'A',
    pendingMicroIds: ['B'],
  })
  session = markMicroStudied(session, 'A') // A trabajado pero B pendiente

  const result = evaluateSessionCompletion(session)
  const sessionCloses = shouldCloseSession(session)

  // Con B pendiente sin procesar, no debe cerrar
  assert(sessionCloses === false, 'sesión abierta no cierra')
  assert(result.isSessionComplete === false, 'isSessionComplete = false')
  assert(result.isProgramComplete === false, 'isProgramComplete = false con B pendiente')
}

// TEST 16 — REGRESIÓN
section('TEST 16 — Regresión: bugs que esta fase protege')
{
  // Bug 1: MAX_INTERACTIONS cerrando programa sin dominio
  let s1 = buildMinimalSession({ microIds: ['A'], completedMicroIds: ['A'] })
  s1 = markMicroFused(s1, 'A')
  const r1 = evaluateSessionCompletion(s1)
  assert(r1.isProgramComplete === false, '[REGRESIÓN] fusible no produce programComplete')

  // Bug 2: coverage usada como mastery
  let s2 = buildMinimalSession({ microIds: ['A', 'B'], completedMicroIds: ['A', 'B'] })
  s2 = markMicroStudied(s2, 'A')
  s2 = markMicroStudied(s2, 'B')
  const r2 = evaluateSessionCompletion(s2)
  assert(r2.coveragePercent === 100 && r2.masteryPercent < 100,
    '[REGRESIÓN] coverage 100 ≠ mastery 100')
  assert(r2.isProgramComplete === false, '[REGRESIÓN] coverage 100 no = programComplete')

  // Bug 3: shouldCloseSession no = programComplete
  let s3 = buildMinimalSession({ microIds: ['A', 'B'], completedMicroIds: ['A', 'B'] })
  s3 = markMicroDominated(s3, 'A')
  s3 = markMicroFused(s3, 'B')
  const closes = shouldCloseSession(s3)
  const r3 = evaluateSessionCompletion(s3)
  assert(closes === true, '[REGRESIÓN] sesión sí cierra')
  assert(r3.isProgramComplete === false, '[REGRESIÓN] cierre ≠ programComplete')

  // Bug 4: restore convierte deferred en completed
  let s4 = buildMinimalSession({ microIds: ['A'] })
  s4 = markMicroFused(s4, 'A')
  const s4r = JSON.parse(JSON.stringify(s4)) as SessionState
  const r4 = evaluateSessionCompletion(s4r)
  assert(r4.isProgramComplete === false, '[REGRESIÓN] restore no convierte deferred en complete')
  assert(r4.unresolvedMicroIds.includes('A'), '[REGRESIÓN] deferred sobrevive al restore')

  // Bug 5: assisted no finaliza programa
  let s5 = buildMinimalSession({ microIds: ['A'], completedMicroIds: ['A'] })
  const stA = { ...(s5.microStates['A'] as any) }
  stA.isReady = true
  stA.totalInteractions = 4
  stA.evidence = { ...stA.evidence, introduced: true, explainedByTutor: true, answeredCorrectly: 4, answeredIncorrectly: 0 }
  let pA = emptyEvidenceProfile('A')
  for (let i = 0; i < 4; i++) {
    pA = recordEvidence(pA, { formatUsed: 'multiple_choice', outcome: 'correct', score: 90, turnNumber: i+1, assistanceLevel: 'assisted' })
  }
  stA.evidenceProfile = pA
  s5 = { ...s5, microStates: { ...s5.microStates, 'A': stA } }
  const r5 = evaluateSessionCompletion(s5)
  assert(r5.isProgramComplete === false, '[REGRESIÓN] assisted-only no finaliza programa')
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
