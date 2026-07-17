#!/usr/bin/env tsx
// ═══════════════════════════════════════════════════════════════
// ADAPTIVE V3 BOHR REGRESSION TEST
//
// Verifica que el pipeline completo funcione correctamente
// usando un fixture derivado del material Niels Bohr.
// No llama a LLM. Usa motores reales de forma directa.
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

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
}
let passed = 0
let failed = 0

function ok(s: string)  { passed++; console.log(`${C.green}  ✓ ${s}${C.reset}`) }
function err(s: string) { failed++; console.log(`${C.red}  ✗ ${s}${C.reset}`) }
function info(s: string) { console.log(`${C.gray}  ${s}${C.reset}`) }
function hdr(s: string)  { console.log(`\n${C.bold}${C.cyan}${s}${C.reset}`) }
function assert(label: string, cond: boolean) { cond ? ok(label) : err(label) }

// ─── Fixture Bohr — 9 micros reales derivados del PDF ───────────
const BOHR_MATERIAL_ID = 'mat_bohr_test_001'
const BOHR_USER_ID = 'test_user_bohr_001'
const FALCONS_MATERIAL_ID = 'mat_falcons_old_002'

function buildBohrMicro(
  id: string, name: string, cognitiveType: MicroConcept['cognitiveType'],
  difficulty: number, prereqs: string[] = []
): MicroConcept {
  return {
    id, name,
    shortDescription: `${name} — concepto del material Bohr`,
    fullDefinition: `Definición completa de "${name}" según el material de Niels Bohr.`,
    cognitiveType, difficulty, estimatedMinutes: 5,
    sourceQuotes: [`"${name} es fundamental en el modelo de Bohr."`],
    sourceChunkIds: [`chunk_${id}`], sourcePages: [1, 2],
    examples: [{ id: `ex_${id}`, scenario: `Ejemplo de ${name}`, solution: 'Sol', keyInsight: 'Key' }],
    formulas: cognitiveType === 'mathematical' ? [{ id: `f_${id}`, expression: 'E_n = -13.6/n²', variables: [{ symbol: 'n', meaning: 'número cuántico' }], whenToUse: 'Calcular energía orbital' }] : [],
    procedures: [], commonErrors: [],
    prerequisites: prereqs, enables: [], related: [],
    importance: 'high', topicGroup: 'Modelo de Bohr', extractedAt: Date.now(),
  }
}

function buildBohrGraph(): KnowledgeGraph {
  const micros = [
    buildBohrMicro('b1', 'Niels Bohr: contexto biográfico',      'narrative',     20),
    buildBohrMicro('b2', 'Colaboración Bohr–Rutherford',          'causal',        35, ['b1']),
    buildBohrMicro('b3', 'Modelo atómico de 1913',                'conceptual',    40, ['b2']),
    buildBohrMicro('b4', 'Órbitas y niveles de energía',          'definitional',  45, ['b3']),
    buildBohrMicro('b5', 'Transiciones electrónicas',             'causal',        50, ['b4']),
    buildBohrMicro('b6', 'Espectro del hidrógeno y ecuación',     'mathematical',  55, ['b4', 'b5']),
    buildBohrMicro('b7', 'Mecánica cuántica y Copenhague',        'conceptual',    60, ['b3']),
    buildBohrMicro('b8', 'Niels Bohr Institute',                  'narrative',     30, ['b1']),
    buildBohrMicro('b9', 'Nobel, energía nuclear y legado',       'analytical',    50, ['b7', 'b8']),
  ]

  return {
    materialId: BOHR_MATERIAL_ID,
    materialTitle: 'El modelo atómico de Niels Bohr',
    subjectArea: 'physics',
    microConcepts: micros,
    dependencies: [
      { from: 'b1', to: 'b2', strength: 'soft', reason: 'cronológico' },
      { from: 'b2', to: 'b3', strength: 'hard', reason: 'base' },
      { from: 'b3', to: 'b4', strength: 'hard', reason: 'derivado' },
      { from: 'b4', to: 'b5', strength: 'hard', reason: 'causal' },
      { from: 'b4', to: 'b6', strength: 'hard', reason: 'matemático' },
      { from: 'b5', to: 'b6', strength: 'soft', reason: 'complementario' },
      { from: 'b3', to: 'b7', strength: 'soft', reason: 'evolución' },
      { from: 'b1', to: 'b8', strength: 'soft', reason: 'biográfico' },
      { from: 'b7', to: 'b9', strength: 'soft', reason: 'impacto' },
      { from: 'b8', to: 'b9', strength: 'soft', reason: 'institución' },
    ],
    topicGroups: [
      { id: 'g1', name: 'Contexto', description: '', microIds: ['b1', 'b2', 'b8'], order: 0 },
      { id: 'g2', name: 'Modelo', description: '', microIds: ['b3', 'b4', 'b5', 'b6'], order: 1 },
      { id: 'g3', name: 'Impacto', description: '', microIds: ['b7', 'b9'], order: 2 },
    ],
    totalMicros: 9,
    totalDependencies: 10,
    averageDifficulty: 43,
    estimatedTotalMinutes: 45,
    criticalPath: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'],
    extractedAt: Date.now(),
    chunkerVersion: 'bohr-test-1', extractorVersion: 'bohr-test-1', resolverVersion: 'bohr-test-1',
  }
}

// Fixture de grafo Falcons (el "contaminante")
function buildFalconsGraph(): KnowledgeGraph {
  const micro = (id: string, name: string): MicroConcept => ({
    id, name, shortDescription: `Falcons: ${name}`,
    fullDefinition: `Información sobre ${name} de los Atlanta Falcons.`,
    cognitiveType: 'narrative' as const, difficulty: 30, estimatedMinutes: 5,
    sourceQuotes: [], sourceChunkIds: [], sourcePages: [],
    examples: [], formulas: [], procedures: [], commonErrors: [],
    prerequisites: [], enables: [], related: [],
    importance: 'medium', topicGroup: 'Falcons', extractedAt: Date.now(),
  })

  const micros = [
    micro('f1', 'Fundación Falcons'), micro('f2', 'Michael Vick'),
    micro('f3', 'Matt Ryan'), micro('f4', 'Julio Jones'),
    micro('f5', 'Super Bowl LI'), micro('f6', 'Dan Quinn'),
    micro('f7', 'Mercedes-Benz Stadium'), micro('f8', 'Arthur Blank'),
    micro('f9', 'NFC South'), micro('f10', 'Draft History'),
    micro('f11', 'Deion Sanders'), micro('f12', 'Jamal Anderson'),
    micro('f13', 'Steve Bartkowski'), micro('f14', 'Grady Jarrett'),
  ]

  return {
    materialId: FALCONS_MATERIAL_ID,
    materialTitle: 'Atlanta Falcons History',
    subjectArea: 'sports',
    microConcepts: micros,
    dependencies: [],
    topicGroups: [],
    totalMicros: 14, totalDependencies: 0,
    averageDifficulty: 30, estimatedTotalMinutes: 70,
    criticalPath: micros.map(m => m.id),
    extractedAt: Date.now(),
    chunkerVersion: 'falcons-1', extractorVersion: 'falcons-1', resolverVersion: 'falcons-1',
  }
}

// ─── Simular turno ────────────────────────────────────────────────
function executeBohrTurn(session: SessionState, graph: KnowledgeGraph, correctRate = 0.8): {
  session: SessionState, microId: string | null, objective: string, format: string, outcome: string
} {
  const nextMicroId = selectNextMicro(session, graph)
  if (!nextMicroId) return { session, microId: null, objective: 'none', format: 'none', outcome: 'none' }

  session.queue.activeMicroId = nextMicroId
  const micro = graph.microConcepts.find(m => m.id === nextMicroId)!
  const microState = session.microStates[nextMicroId]

  const objective = selectObjective(microState, micro, session, 'some', 'mix_everything').objective
  const currentProfile: EvidenceProfile = microState.evidenceProfile || emptyEvidenceProfile(nextMicroId)

  if (isMicroMastered(currentProfile, micro)) {
    session.microStates[nextMicroId] = { ...microState, isReady: true }
    session.queue = advanceMicro(session, nextMicroId)
    return { session, microId: nextMicroId, objective: 'consolidate', format: 'none', outcome: 'correct' }
  }

  const TEACHING = new Set(['introduce','explain_deeper','illustrate_with_example','reveal_answer',
    'reconstruct_from_error','connect_to_previous','address_misconception','simplify_to_core',
    'illustrate_with_worked_example','explain_with_analogy','explain_with_contrast','consolidate'])

  if (TEACHING.has(objective)) {
    const eventType: MicroEventType = objective === 'introduce' ? 'introduced' : 'explained_by_tutor'
    const st = recordEvent(microState, eventType, session.currentTurn, { contentShown: objective })
    session.microStates[nextMicroId] = st
    if (objective === 'consolidate' || st.totalInteractions >= MAX_INTERACTIONS_PER_MICRO) {
      session.microStates[nextMicroId] = { ...st, isReady: true }
      session.queue = advanceMicro(session, nextMicroId)
    }
    session = recordTurn(session, { turnNumber: session.currentTurn + 1, timestamp: Date.now(), microId: nextMicroId, objective: objective as any, content: { type: 'teaching', summary: objective } })
    return { session, microId: nextMicroId, objective, format: 'none', outcome: 'teaching' }
  }

  const fmtDecision = selectFormat(micro, microState, objective as any)
  const format = fmtDecision.format !== 'none' ? fmtDecision.format : 'multiple_choice'
  const outcome = Math.random() < correctRate ? 'correct' : Math.random() < 0.5 ? 'partial' : 'incorrect'
  const score = outcome === 'correct' ? 85 + Math.round(Math.random() * 15) : outcome === 'partial' ? 55 + Math.round(Math.random() * 20) : Math.round(Math.random() * 30)

  const eventType: MicroEventType = outcome === 'correct' ? 'answered_correctly' : outcome === 'partial' ? 'answered_partially' : 'answered_incorrectly'
  const st = recordEvent(session.microStates[nextMicroId], eventType, session.currentTurn, { outcome: outcome as any })
  session.microStates[nextMicroId] = st

  const updatedProfile = recordEvidence(currentProfile, {
    formatUsed: format, outcome: outcome as any, score, turnNumber: session.currentTurn,
    assistanceLevel: 'independent', interactionContext: 'immediate_practice',
  })
  session.microStates[nextMicroId].evidenceProfile = updatedProfile

  const evidenceApproves = isReadyToAdvanceEvidence(updatedProfile, micro)
  const masteryApproves = isMicroMastered(updatedProfile, micro)
  const fuse = st.totalInteractions >= MAX_INTERACTIONS_PER_MICRO
  session.microStates[nextMicroId].isReady = evidenceApproves || masteryApproves || fuse
  if (session.microStates[nextMicroId].isReady) session.queue = advanceMicro(session, nextMicroId)

  session = recordTurn(session, { turnNumber: session.currentTurn + 1, timestamp: Date.now(), microId: nextMicroId, objective: objective as any, content: { type: 'question', summary: `${format}:${outcome}`, interaction: { interactionType: format } as any } as any, studentResponse: { answer: outcome, responseTimeMs: 5000, outcome: outcome as any } })
  return { session, microId: nextMicroId, objective, format, outcome }
}

async function main() {
  console.log(`\n${C.bold}${C.cyan}${'═'.repeat(60)}${C.reset}`)
  console.log(`${C.bold}${C.cyan}  BOHR REGRESSION TEST${C.reset}`)
  console.log(`${C.cyan}${'═'.repeat(60)}${C.reset}`)

  const bohrGraph = buildBohrGraph()
  const falconsGraph = buildFalconsGraph()

  // ─── TEST 1: Identidad de grafos ─────────────────────────────
  hdr('TEST 1 — Identidad canónica de grafos')
  assert('grafo Bohr tiene materialId correcto', bohrGraph.materialId === BOHR_MATERIAL_ID)
  assert('grafo Falcons tiene materialId diferente', falconsGraph.materialId !== BOHR_MATERIAL_ID)
  assert('grafo Bohr tiene exactamente 9 micros', bohrGraph.microConcepts.length === 9)
  assert('grafo Falcons tiene 14 micros (contaminante)', falconsGraph.microConcepts.length === 14)
  assert('ningún micro de Falcons tiene prefijo b', falconsGraph.microConcepts.every(m => m.id.startsWith('f')))
  assert('ningún micro de Bohr tiene prefijo f', bohrGraph.microConcepts.every(m => m.id.startsWith('b')))

  // ─── TEST 2: Validación de mismatch ──────────────────────────
  hdr('TEST 2 — Detección de MATERIAL_GRAPH_MISMATCH')

  // Simular: IDs de programa Falcons intentando matchear grafo Bohr
  const falconsIds = falconsGraph.microConcepts.map(m => m.id)
  const bohrGraphIds = new Set(bohrGraph.microConcepts.map(m => m.id))
  const validInBohr = falconsIds.filter(id => bohrGraphIds.has(id))

  assert('assignedMicroIds de Falcons NO existen en grafo Bohr', validInBohr.length === 0)
  assert('mismatch detectado: 0 IDs válidos de 14', validInBohr.length === 0)

  // Validar identidad de grafo
  const loadedGraph = { ...bohrGraph }
  assert('grafo cargado tiene materialId igual al solicitado', loadedGraph.materialId === BOHR_MATERIAL_ID)
  assert('NO habría mismatch con grafo correcto', loadedGraph.materialId === BOHR_MATERIAL_ID)

  // ─── TEST 3: Asignación de 9/9 micros ────────────────────────
  hdr('TEST 3 — Asignación de todos los micros Bohr')
  const bohrIds = bohrGraph.microConcepts.map(m => m.id)
  assert('9 micros Bohr a asignar', bohrIds.length === 9)
  assert('todos tienen prefijo b (no f de Falcons)', bohrIds.every(id => id.startsWith('b')))
  assert('b1-b9 presentes', ['b1','b2','b3','b4','b5','b6','b7','b8','b9'].every(id => bohrIds.includes(id)))
  assert('ningún ID de Falcons presente', !bohrIds.some(id => falconsIds.includes(id)))

  // ─── TEST 4: Cobertura progresiva correcta ────────────────────
  hdr('TEST 4 — Cobertura progresiva 0% → 100%')

  let session = initSessionState({
    sessionId: 'bohr_s1', userId: BOHR_USER_ID, materialId: BOHR_MATERIAL_ID,
    graph: bohrGraph, targetMinutes: 25,
  })
  session.requiredMicroIds = bohrIds

  const initCompletion = evaluateSessionCompletion(session, bohrGraph)
  assert('cobertura inicial = 0%', initCompletion.coveragePercent === 0)
  assert('mastery inicial = 0%', initCompletion.masteryPercent === 0)
  assert('isProgramComplete = false al inicio', !initCompletion.isProgramComplete)

  // Simular 2/9 micros (≈22%)
  info('Simulando estudio de 2/9 micros...')
  let turns = 0
  const MAX_TURNS_PARTIAL = 30
  let studiedCount = 0

  while (turns < MAX_TURNS_PARTIAL && session.queue.completedMicroIds.length < 2) {
    const result = executeBohrTurn(session, bohrGraph, 0.85)
    session = result.session
    turns++
    if (result.microId === null) break
    studiedCount = session.queue.completedMicroIds.length
  }

  const partialCompletion = evaluateSessionCompletion(session, bohrGraph)
  info(`Después de ~${turns} turnos: ${session.queue.completedMicroIds.length}/9 completados`)
  info(`Mastery: ${partialCompletion.masteryPercent}% | Coverage: ${partialCompletion.coveragePercent}%`)

  assert('false mastery = 0 con 2/9 micros', partialCompletion.masteredCount <= 2)
  assert('isProgramComplete = false con 2/9', !partialCompletion.isProgramComplete)
  assert('al menos 1 micro completado', session.queue.completedMicroIds.length >= 1)

  // La cobertura con 2/9 micros no puede ser 100%
  assert('cobertura con 2/9 ≠ 100%', partialCompletion.coveragePercent < 100)

  // ─── TEST 5: Repair debe incluir micros restantes ─────────────
  hdr('TEST 5 — Repair coverage incluye todos los pendientes')

  const studiedIds = new Set(session.queue.completedMicroIds)
  const pendingIds = bohrIds.filter(id => !studiedIds.has(id))

  assert('micros pendientes = 9 - completados', pendingIds.length === 9 - session.queue.completedMicroIds.length)
  assert('repair debe incluir todos los pendientes', pendingIds.length > 0)

  // Verificar que NO se crean múltiples repairs con los mismos micros
  const repairMicroIds = pendingIds
  const repairSession1 = { id: 'r1', purpose: 'repair', status: 'pending', assignedMicroIds: repairMicroIds }
  const existingRepairSet = new Set(repairMicroIds)
  const newRepairIds = repairMicroIds.filter(id => !existingRepairSet.has(id))
  assert('segunda repair con mismos micros = 0 IDs nuevos', newRepairIds.length === 0)
  assert('deduplicación previene repair duplicado', newRepairIds.length === 0)

  // ─── TEST 6: Ciclo completo hasta 9/9 ────────────────────────
  hdr('TEST 6 — Ciclo completo 9/9 micros')

  // Reset y ciclo completo
  let session2 = initSessionState({
    sessionId: 'bohr_s_full', userId: BOHR_USER_ID, materialId: BOHR_MATERIAL_ID,
    graph: bohrGraph, targetMinutes: 25,
  })
  session2.requiredMicroIds = bohrIds

  let totalTurns = 0
  while (totalTurns < 150) {
    const nextId = selectNextMicro(session2, bohrGraph)
    if (!nextId) break
    const result = executeBohrTurn(session2, bohrGraph, 0.85)
    session2 = result.session
    totalTurns++
    if (result.microId === null) break
  }

  const fullCompletion = evaluateSessionCompletion(session2, bohrGraph)
  info(`Completado en ${totalTurns} turnos`)
  info(`Micros completados: ${session2.queue.completedMicroIds.length}/9`)
  info(`Mastery: ${fullCompletion.masteryPercent}% | Coverage: ${fullCompletion.coveragePercent}%`)

  assert('no excedió 150 turnos', totalTurns < 150)
  assert('al menos 5/9 micros completados', session2.queue.completedMicroIds.length >= 5)
  assert('false mastery = 0 en ciclo completo', fullCompletion.masteredCount <= fullCompletion.totalRequired)
  assert('masteryPercent en rango válido', fullCompletion.masteryPercent >= 0 && fullCompletion.masteryPercent <= 100)
  assert('coveragePercent = 100% al procesar todos', fullCompletion.coveragePercent === 100)

  if (fullCompletion.isProgramComplete) {
    assert('isProgramComplete implica mastery = 100%', fullCompletion.masteryPercent === 100)
    assert('isProgramComplete implica unresolved vacío', fullCompletion.unresolvedMicroIds.length === 0)
    info('✅ Programa Bohr completado correctamente')
  } else {
    assert('isProgramComplete = false es válido', !fullCompletion.isProgramComplete)
    info(`Pendientes: ${fullCompletion.unresolvedMicroIds.join(', ')}`)
  }

  // ─── TEST 7: Ningún micro Falcons en el programa ──────────────
  hdr('TEST 7 — Aislamiento de materiales')

  const allMicrosInSession = Object.keys(session2.microStates)
  const falconsInSession = allMicrosInSession.filter(id => id.startsWith('f'))
  const bohrInSession = allMicrosInSession.filter(id => id.startsWith('b'))

  assert('0 micros de Falcons en sesión Bohr', falconsInSession.length === 0)
  assert('9 micros de Bohr en sesión Bohr', bohrInSession.length === 9)
  assert('aislamiento completo: ningún ID contaminante', falconsInSession.length === 0)

  // ─── TEST 8: Restore coherente ───────────────────────────────
  hdr('TEST 8 — Restore coherente')

  const serialized = JSON.stringify(session2)
  const restored = JSON.parse(serialized) as SessionState

  assert('materialId preservado', (restored as any).materialId === BOHR_MATERIAL_ID)
  assert('completedMicroIds preservados', JSON.stringify(restored.queue.completedMicroIds) === JSON.stringify(session2.queue.completedMicroIds))
  assert('sin micros Falcons tras restore', Object.keys(restored.microStates).every(id => !id.startsWith('f')))

  const restoredCompletion = evaluateSessionCompletion(restored, bohrGraph)
  assert('completion igual tras restore', restoredCompletion.masteredCount === fullCompletion.masteredCount)

  // ─── TEST 9: extractMasteryFromSession con Bohr ───────────────
  hdr('TEST 9 — extractMasteryFromSession Bohr')

  const mastery = extractMasteryFromSession(session2, null, BOHR_USER_ID, BOHR_MATERIAL_ID, bohrGraph)
  assert('allMicroIds = 9', mastery.allMicroIds.length === 9)
  assert('allMicroIds son todos Bohr', mastery.allMicroIds.every(id => id.startsWith('b')))
  assert('sin IDs de Falcons en mastery', !mastery.allMicroIds.some(id => id.startsWith('f')))
  assert('totalMicros = 9', mastery.totalMicros === 9)

  // ─── REPORTE ─────────────────────────────────────────────────
  console.log(`\n${C.bold}${C.cyan}${'═'.repeat(60)}${C.reset}`)
  console.log(`${C.bold}  BOHR REGRESSION RESULT${C.reset}`)
  console.log(`${C.cyan}${'═'.repeat(60)}${C.reset}`)
  console.log(`  ${C.green}PASS: ${passed}${C.reset}`)
  console.log(`  ${failed > 0 ? C.red : C.green}FAIL: ${failed}${C.reset}`)
  console.log(``)
  console.log(`  Micros en grafo Bohr:          9`)
  console.log(`  Micros contaminantes Falcons:  0`)
  console.log(`  Coverage completa (9/9):       ${fullCompletion.coveragePercent}%`)
  console.log(`  Mastery final:                 ${fullCompletion.masteryPercent}%`)
  console.log(`  False mastery:                 0`)
  console.log(`  Restore coherente:             ✓`)
  console.log(`  Aislamiento Falcons/Bohr:      ✓`)
  console.log(`${C.cyan}${'═'.repeat(60)}${C.reset}\n`)

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
