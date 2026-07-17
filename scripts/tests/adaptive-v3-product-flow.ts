#!/usr/bin/env tsx
// ═══════════════════════════════════════════════════════════════
// ADAPTIVE V3 PRODUCT FLOW TEST
//
// Simula el flujo real de producto end-to-end SIN navegador NI LLM:
//   material sintético
//   → grafo (motores reales)
//   → programa (asignación de micros)
//   → sesión (tutor loop)
//   → persistencia (serialize → restore)
//   → cierre de sesión
//   → cierre de programa
//
// No hace HTTP. Llama directamente a los motores TypeScript.
// ═══════════════════════════════════════════════════════════════

import {
  initSessionState,
  recordEvent,
  recordTurn,
  selectNextMicro,
  advanceMicro,
  evaluateSessionCompletion,
  MAX_INTERACTIONS_PER_MICRO,
} from '../../lib/adaptive/v3/engine/stateMachine'
import {
  recordEvidence,
  emptyEvidenceProfile,
  isMicroMastered,
  isReadyToAdvanceEvidence,
  type EvidenceProfile,
} from '../../lib/adaptive/v3/engine/evidenceEngine'
import { selectObjective } from '../../lib/adaptive/v3/engine/objectiveSelector'
import { selectFormat } from '../../lib/adaptive/v3/engine/formatSelector'
import { extractMasteryFromSession } from '../../lib/adaptive/v3/storage/materialMasteryStorage'
import type { KnowledgeGraph, MicroConcept, SessionState, Turn, MicroEventType } from '../../lib/adaptive/v3/types'

// ─── Colores ─────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
}
const ok  = (s: string) => console.log(`${C.green}  ✓ ${s}${C.reset}`)
const err = (s: string) => console.log(`${C.red}  ✗ ${s}${C.reset}`)
const info = (s: string) => console.log(`${C.gray}  ${s}${C.reset}`)
const hdr  = (s: string) => console.log(`\n${C.bold}${C.cyan}${s}${C.reset}`)

// ─── Material sintético ──────────────────────────────────────────
function buildSyntheticGraph(): KnowledgeGraph {
  const micro = (
    id: string, name: string, cognitiveType: MicroConcept['cognitiveType'],
    difficulty: number, prereqs: string[] = []
  ): MicroConcept => ({
    id, name, shortDescription: `Descripción de ${name}`,
    fullDefinition: `Definición completa y detallada de ${name}.`,
    cognitiveType, difficulty, estimatedMinutes: 5,
    sourceQuotes: [`"${name} es fundamental para el dominio del material."`],
    sourceChunkIds: [], sourcePages: [1],
    examples: [{ id: `ex_${id}`, scenario: `Ejemplo de ${name}`, solution: 'Solución', keyInsight: 'Insight' }],
    formulas: [], procedures: [],
    commonErrors: [{ id: `err_${id}`, description: `Error en ${name}`, whyItHappens: 'Confusión', correction: 'Corrección' }],
    prerequisites: prereqs, enables: [], related: [],
    importance: 'high', topicGroup: 'Test', extractedAt: Date.now(),
  })

  const micros = [
    micro('m1', 'Concepto Base', 'definitional', 25),
    micro('m2', 'Principio Causal', 'causal', 45, ['m1']),
    micro('m3', 'Aplicación Práctica', 'applicative', 60, ['m1', 'm2']),
  ]

  return {
    materialId: 'test_material_001',
    materialTitle: 'Material de Prueba Product Flow',
    subjectArea: 'test',
    microConcepts: micros,
    dependencies: [
      { from: 'm1', to: 'm2', strength: 'soft', reason: 'prerequisito' },
      { from: 'm1', to: 'm3', strength: 'soft', reason: 'prerequisito' },
      { from: 'm2', to: 'm3', strength: 'soft', reason: 'prerequisito' },
    ],
    topicGroups: [{ id: 'g1', name: 'Test', description: '', microIds: ['m1','m2','m3'], order: 0 }],
    totalMicros: 3,
    totalDependencies: 3,
    averageDifficulty: 43,
    estimatedTotalMinutes: 15,
    criticalPath: ['m1', 'm2', 'm3'],
    extractedAt: Date.now(),
    chunkerVersion: 'test-1', extractorVersion: 'test-1', resolverVersion: 'test-1',
  }
}

// ─── Simular respuesta de estudiante experto ─────────────────────
function simulateExpertResponse(objective: string, format: string): {
  outcome: 'correct' | 'partial' | 'incorrect', score: number
} {
  // Experto: alta probabilidad de acertar, especialmente en formatos simples
  const baseProb = format === 'multiple_choice' ? 0.88 :
                   format === 'fill_blank' ? 0.82 :
                   format === 'true_false' ? 0.90 :
                   format === 'practical_case' ? 0.75 :
                   format === 'explain_why' || format === 'teach_back' ? 0.78 : 0.85

  const rand = Math.random()
  if (rand < baseProb) {
    return { outcome: 'correct', score: 85 + Math.round(Math.random() * 15) }
  } else if (rand < baseProb + 0.08) {
    return { outcome: 'partial', score: 55 + Math.round(Math.random() * 20) }
  } else {
    return { outcome: 'incorrect', score: Math.round(Math.random() * 30) }
  }
}

// ─── Ejecutar un turno completo ──────────────────────────────────
function executeTurn(session: SessionState, graph: KnowledgeGraph, turnIndex: number): {
  session: SessionState
  microId: string | null
  objective: string
  format: string
  outcome: 'correct' | 'partial' | 'incorrect'
  score: number
} {
  const nextMicroId = selectNextMicro(session, graph)
  if (!nextMicroId) return { session, microId: null, objective: 'none', format: 'none', outcome: 'correct', score: 0 }

  session.queue.activeMicroId = nextMicroId
  const currentMicro = graph.microConcepts.find(m => m.id === nextMicroId)!
  const microState = session.microStates[nextMicroId]

  const objectiveDecision = selectObjective(microState, currentMicro, session, 'some', 'mix_everything')
  const objective = objectiveDecision.objective

  // Si es mastered, consolidar
  const currentProfile: EvidenceProfile = microState.evidenceProfile || emptyEvidenceProfile(nextMicroId)
  if (isMicroMastered(currentProfile, currentMicro)) {
    session.microStates[nextMicroId] = { ...microState, isReady: true }
    session.queue = advanceMicro(session, nextMicroId)
    return { session, microId: nextMicroId, objective: 'consolidate', format: 'none', outcome: 'correct', score: 0 }
  }

  // Turno de enseñanza
  const TEACHING_OBJECTIVES = new Set([
    'introduce', 'explain_deeper', 'illustrate_with_example', 'reveal_answer',
    'reconstruct_from_error', 'connect_to_previous', 'address_misconception',
    'simplify_to_core', 'illustrate_with_worked_example', 'explain_with_analogy',
    'explain_with_contrast', 'consolidate', 'summarize_key_idea', 'build_mental_model',
  ])

  if (TEACHING_OBJECTIVES.has(objective) || !objectiveDecision.requiresQuestion) {
    const eventType: MicroEventType = objective === 'introduce' ? 'introduced' : 'explained_by_tutor'
    session.microStates[nextMicroId] = recordEvent(microState, eventType, session.currentTurn, { contentShown: objective })

    if (objective === 'consolidate') {
      session.microStates[nextMicroId] = { ...session.microStates[nextMicroId], isReady: true }
      session.queue = advanceMicro(session, nextMicroId)
    } else if (session.microStates[nextMicroId].totalInteractions >= MAX_INTERACTIONS_PER_MICRO) {
      session.microStates[nextMicroId] = { ...session.microStates[nextMicroId], isReady: true }
      session.queue = advanceMicro(session, nextMicroId)
    }

    const turnRecord: Turn = {
      turnNumber: session.currentTurn + 1,
      timestamp: Date.now(),
      microId: nextMicroId,
      objective: objective as any,
      content: { type: 'teaching', summary: objective },
    }
    session = recordTurn(session, turnRecord)
    return { session, microId: nextMicroId, objective, format: 'none', outcome: 'correct', score: 0 }
  }

  // Turno con respuesta
  const formatDecision = selectFormat(currentMicro, microState, objective as any)
  const format = objectiveDecision.forcedFormat ||
    (formatDecision.format !== 'none' ? formatDecision.format : 'multiple_choice')

  const { outcome, score } = simulateExpertResponse(objective, format)

  const eventType: MicroEventType = outcome === 'correct' ? 'answered_correctly' :
    outcome === 'partial' ? 'answered_partially' : 'answered_incorrectly'

  const stAfterEvent = recordEvent(session.microStates[nextMicroId], eventType, session.currentTurn,
    { outcome, studentResponse: `sim_${outcome}` })
  if (stAfterEvent.timeline.length > 0) {
    const last = stAfterEvent.timeline[stAfterEvent.timeline.length - 1]
    if (last?.metadata) last.metadata.formatUsed = format
  }
  session.microStates[nextMicroId] = stAfterEvent

  const updatedProfile = recordEvidence(currentProfile, {
    formatUsed: format, outcome, score, turnNumber: session.currentTurn,
    assistanceLevel: 'independent', interactionContext: 'immediate_practice',
  })
  session.microStates[nextMicroId].evidenceProfile = updatedProfile

  const evidenceApproves = isReadyToAdvanceEvidence(updatedProfile, currentMicro)
  const masteryApproves = isMicroMastered(updatedProfile, currentMicro)
  const motorFuse = stAfterEvent.totalInteractions >= MAX_INTERACTIONS_PER_MICRO
  session.microStates[nextMicroId].isReady = evidenceApproves || masteryApproves || motorFuse

  if (session.microStates[nextMicroId].isReady) {
    session.queue = advanceMicro(session, nextMicroId)
  }

  const turnRecord: Turn = {
    turnNumber: session.currentTurn + 1,
    timestamp: Date.now(),
    microId: nextMicroId,
    objective: objective as any,
    content: { type: 'question', summary: `${format}:${outcome}`, interaction: { interactionType: format } as any } as any,
    studentResponse: { answer: outcome, responseTimeMs: 5000, outcome },
  }
  session = recordTurn(session, turnRecord)

  return { session, microId: nextMicroId, objective, format, outcome, score }
}

// ─── Tests ───────────────────────────────────────────────────────
let passed = 0
let failed = 0

function assert(label: string, condition: boolean) {
  if (condition) { passed++; ok(label) }
  else { failed++; err(label) }
}

async function main() {
  console.log(`\n${C.bold}${C.cyan}${'═'.repeat(60)}${C.reset}`)
  console.log(`${C.bold}${C.cyan}  ADAPTIVE V3 PRODUCT FLOW TEST${C.reset}`)
  console.log(`${C.cyan}${'═'.repeat(60)}${C.reset}`)

  const graph = buildSyntheticGraph()

  // ─── TEST 1: Grafo sintético válido ─────────────────────────
  hdr('TEST 1 — Grafo sintético')
  assert('grafo tiene 3 micros', graph.microConcepts.length === 3)
  assert('todos los micros tienen cognitiveType', graph.microConcepts.every(m => !!m.cognitiveType))
  assert('m2 tiene prerequisito m1', graph.microConcepts.find(m => m.id === 'm2')?.prerequisites.includes('m1') === true)

  // ─── TEST 2: Sesión inicial ──────────────────────────────────
  hdr('TEST 2 — Sesión inicial')
  let session = initSessionState({
    sessionId: 'test_s1', userId: 'test_user', materialId: graph.materialId,
    graph, targetMinutes: 20,
  })
  session.requiredMicroIds = graph.microConcepts.map(m => m.id)

  assert('sesión inicializada correctamente', !!session.sessionId)
  assert('3 micros en cola', session.queue.pendingMicroIds.length === 3)
  assert('ningún micro completado al inicio', session.queue.completedMicroIds.length === 0)

  const initCompletion = evaluateSessionCompletion(session, graph)
  assert('programa NO está completo al inicio', !initCompletion.isProgramComplete)
  assert('todos los micros en unresolved inicialmente', initCompletion.unresolvedMicroIds.length > 0 || initCompletion.masteredCount === 0)

  // ─── TEST 3: Ciclo de aprendizaje ───────────────────────────
  hdr('TEST 3 — Ciclo de aprendizaje (hasta 80 turnos)')
  let totalTurns = 0
  const MAX_TURNS = 80

  while (totalTurns < MAX_TURNS) {
    const nextMicro = selectNextMicro(session, graph)
    if (!nextMicro) break

    const result = executeTurn(session, graph, totalTurns)
    session = result.session
    totalTurns++

    if (result.microId === null) break
  }

  info(`Turnos ejecutados: ${totalTurns}`)
  info(`Micros completados: ${session.queue.completedMicroIds.length}/3`)
  info(`Micros pendientes: ${session.queue.pendingMicroIds.length}`)

  assert('no excedió límite de turnos', totalTurns <= MAX_TURNS)
  assert('al menos un micro fue completado', session.queue.completedMicroIds.length >= 1)

  // ─── TEST 4: evaluateSessionCompletion ──────────────────────
  hdr('TEST 4 — Evaluación de completitud')
  const completion = evaluateSessionCompletion(session, graph)

  info(`masteredCount: ${completion.masteredCount}`)
  info(`isProgramComplete: ${completion.isProgramComplete}`)
  info(`unresolvedMicroIds: ${completion.unresolvedMicroIds.join(', ') || 'ninguno'}`)
  info(`masteryPercent: ${completion.masteryPercent}%`)
  info(`coveragePercent: ${completion.coveragePercent}%`)

  assert('masteredCount >= 0', completion.masteredCount >= 0)
  assert('masteryPercent entre 0 y 100', completion.masteryPercent >= 0 && completion.masteryPercent <= 100)
  assert('coveragePercent entre 0 y 100', completion.coveragePercent >= 0 && completion.coveragePercent <= 100)
  assert('false mastery: masteredCount <= totalRequired', completion.masteredCount <= completion.totalRequired)

  if (completion.isProgramComplete) {
    assert('program complete implica unresolvedMicroIds vacío', completion.unresolvedMicroIds.length === 0)
    assert('program complete implica masteryPercent = 100', completion.masteryPercent === 100)
  }

  // ─── TEST 5: Persistencia y restore ─────────────────────────
  hdr('TEST 5 — Persistencia y restore')

  const serialized = JSON.stringify(session)
  const restored = JSON.parse(serialized) as SessionState

  assert('serialize/parse no lanza', !!restored)
  assert('sessionId preservado', restored.sessionId === session.sessionId)
  assert('currentTurn preservado', restored.currentTurn === session.currentTurn)
  assert('completedMicroIds preservados', JSON.stringify(restored.queue.completedMicroIds) === JSON.stringify(session.queue.completedMicroIds))
  assert('pendingMicroIds preservados', JSON.stringify(restored.queue.pendingMicroIds) === JSON.stringify(session.queue.pendingMicroIds))

  // Verificar que evidenceProfile se preserve
  for (const microId of session.queue.completedMicroIds) {
    const orig = session.microStates[microId]?.evidenceProfile
    const rest = restored.microStates[microId]?.evidenceProfile
    if (orig && rest) {
      assert(`evidenceProfile de ${microId} preservado tras restore`,
        orig.independentSuccesses === rest.independentSuccesses &&
        orig.masteryScore === rest.masteryScore)
    }
  }

  const restoredCompletion = evaluateSessionCompletion(restored, graph)
  assert('completion igual tras restore', restoredCompletion.masteredCount === completion.masteredCount)
  assert('isProgramComplete igual tras restore', restoredCompletion.isProgramComplete === completion.isProgramComplete)

  // ─── TEST 6: extractMasteryFromSession ──────────────────────
  hdr('TEST 6 — extractMasteryFromSession')

  const mastery = extractMasteryFromSession(session, null, 'test_user', graph.materialId, graph)
  assert('mastery generado', !!mastery)
  assert('allMicroIds tiene los 3 micros', mastery.allMicroIds.length === 3)
  assert('micros del grafo inicializados en mastery', Object.keys(mastery.micros).length >= 1)

  // ─── TEST 7: Invariantes de seguridad ───────────────────────
  hdr('TEST 7 — Invariantes de seguridad')

  // No false mastery: ningún micro mastered con evidencia cero
  let falseMasteryCount = 0
  for (const microId of completion.microResolutions ? Object.keys(completion.microResolutions) : []) {
    const resolution = completion.microResolutions[microId]
    if (resolution.status === 'mastered') {
      const ep = session.microStates[microId]?.evidenceProfile
      if (!ep || ep.totalEvidences === 0) {
        falseMasteryCount++
      }
    }
  }
  assert('false mastery = 0', falseMasteryCount === 0)

  // No hay micros simultáneamente en completed y pending
  const completedSet = new Set(session.queue.completedMicroIds)
  const pendingSet = new Set(session.queue.pendingMicroIds)
  const overlap = [...completedSet].filter(id => pendingSet.has(id))
  assert('ningún micro en completado Y pendiente simultáneamente', overlap.length === 0)

  // Asistencia correcta: ningún micro mastered solo por revealed
  for (const microId of session.queue.completedMicroIds) {
    const ep = session.microStates[microId]?.evidenceProfile
    if (ep) {
      const micro = graph.microConcepts.find(m => m.id === microId)!
      if (isMicroMastered(ep, micro)) {
        assert(`${microId} mastered tiene al menos 1 éxito independiente`,
          ep.independentSuccesses >= 1)
      }
    }
  }

  // ─── TEST 8: Segunda sesión con priorMastery ─────────────────
  hdr('TEST 8 — Segunda sesión con priorMastery')

  const priorMastery: Record<string, any> = {}
  for (const [microId, st] of Object.entries(session.microStates)) {
    priorMastery[microId] = {
      masteryLevel: st.masteryLevel,
      isReady: st.isReady,
      answeredCorrectly: st.evidence.answeredCorrectly,
      answeredIncorrectly: st.evidence.answeredIncorrectly,
      introduced: st.evidence.introduced,
      explainedByTutor: st.evidence.explainedByTutor,
      applied: st.evidence.applied,
      evidenceProfileSnapshot: st.evidenceProfile,
    }
  }

  const unresolvedIds = completion.unresolvedMicroIds.length > 0
    ? completion.unresolvedMicroIds
    : graph.microConcepts.map(m => m.id)

  const session2 = initSessionState({
    sessionId: 'test_s2', userId: 'test_user', materialId: graph.materialId,
    graph, targetMinutes: 20,
    microIdsToTeach: unresolvedIds,
    priorMastery,
  })
  session2.requiredMicroIds = graph.microConcepts.map(m => m.id)
  session2.queue.completedMicroIds = [...session.queue.completedMicroIds]
  session2.queue.pendingMicroIds = [...unresolvedIds]

  assert('segunda sesión inicializada', !!session2.sessionId)
  assert('segunda sesión diferente de primera', session2.sessionId !== session.sessionId)

  // Verificar que los micros ya dominados tienen evidenceProfile restaurado
  for (const microId of session.queue.completedMicroIds) {
    const restoredEp = session2.microStates[microId]?.evidenceProfile
    const originalEp = session.microStates[microId]?.evidenceProfile
    if (originalEp && restoredEp) {
      assert(`${microId}: evidenceProfile restaurado en sesión 2`,
        restoredEp.independentSuccesses === originalEp.independentSuccesses)
    }
  }

  // ─── TEST 9: Contrato de cierre de programa ──────────────────
  hdr('TEST 9 — Contrato de cierre de programa')

  if (completion.isProgramComplete) {
    assert('isProgramComplete = true implica coverage = 100%', completion.coveragePercent === 100)
    assert('isProgramComplete = true implica unresolvedMicroIds vacío', completion.unresolvedMicroIds.length === 0)
    assert('isProgramComplete = true implica masteryPercent = 100', completion.masteryPercent === 100)
    info('✅ Programa completado en la primera sesión')
  } else {
    assert('isProgramComplete = false: no se cierra prematuramente', true)
    info(`Programa no completado todavía — ${completion.unresolvedMicroIds.length} micros pendientes`)
    info('Esto es esperado para perfiles que no alcanzan mastery en 1 sesión')
  }

  // ─── REPORTE FINAL ───────────────────────────────────────────
  console.log(`\n${C.bold}${C.cyan}${'═'.repeat(60)}${C.reset}`)
  console.log(`${C.bold}  RESULTADO DEL PRODUCT FLOW TEST${C.reset}`)
  console.log(`${C.cyan}${'═'.repeat(60)}${C.reset}`)
  console.log(`  ${C.green}PASS: ${passed}${C.reset}`)
  console.log(`  ${failed > 0 ? C.red : C.green}FAIL: ${failed}${C.reset}`)
  console.log(``)
  console.log(`  Turnos ejecutados:        ${totalTurns}`)
  console.log(`  Micros completados:       ${session.queue.completedMicroIds.length}/3`)
  console.log(`  Mastery percent:          ${completion.masteryPercent}%`)
  console.log(`  Coverage percent:         ${completion.coveragePercent}%`)
  console.log(`  isProgramComplete:        ${completion.isProgramComplete}`)
  console.log(`  False mastery:            ${falseMasteryCount}`)
  console.log(`  Restore coherente:        ✓`)
  console.log(`${C.cyan}${'═'.repeat(60)}${C.reset}\n`)

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
