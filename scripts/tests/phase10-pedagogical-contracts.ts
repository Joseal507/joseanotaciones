#!/usr/bin/env tsx

import { emptyEvidenceProfile, recordEvidence, rebuildProfile, getMissingEvidences, isMicroMastered, type Evidence } from '../../lib/adaptive/v3/engine/evidenceEngine'
import { selectObjective } from '../../lib/adaptive/v3/engine/objectiveSelector'
import { initSessionState, recordEvent } from '../../lib/adaptive/v3/engine/stateMachine'
import { PROGRAM_SINGLE_DEFINITIONAL } from '../simulation/adaptive-v3/programFixtures'
import { aggregateResults } from '../simulation/adaptive-v3/report'
import type { SimulationRunResult } from '../simulation/adaptive-v3/types'
import { runSimulation } from '../simulation/adaptive-v3/simulationRunner'
import { createRandom } from '../simulation/adaptive-v3/seededRandom'
import { DEFAULT_CONFIG } from '../simulation/adaptive-v3/types'

let passed = 0
let failed = 0

function assert(label: string, condition: boolean): void {
  if (condition) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.error(`  ✗ ${label}`)
  }
}

function evidence(
  type: Evidence['type'],
  assistanceLevel: NonNullable<Evidence['assistanceLevel']>,
  turnNumber: number,
): Evidence {
  return {
    type,
    strength: 'strong',
    turnNumber,
    timestamp: turnNumber * 1_000,
    formatUsed: type === 'recalled' ? 'fill_blank' : 'teach_back',
    outcome: 'correct',
    score: 95,
    attemptNumber: 1,
    confidenceMultiplier: 1,
    assistanceLevel,
  }
}

console.log('\nPHASE 10 — PEDAGOGICAL CONTRACTS\n')

async function main(): Promise<void> {
{
  const graph = PROGRAM_SINGLE_DEFINITIONAL
  const micro = graph.microConcepts[0]
  const session = initSessionState({
    sessionId: 'teaching-cap', userId: 'test-user', materialId: graph.materialId,
    graph, targetMinutes: 20,
  })
  const state = recordEvent(session.microStates[micro.id], 'introduced', 1)
  session.microStates[micro.id] = state
  session.recentTurns = [
    { turnNumber: 1, timestamp: 1, microId: 'prior', objective: 'reconstruct_from_error', content: { type: 'teaching', summary: 'repair' } },
    { turnNumber: 2, timestamp: 2, microId: micro.id, objective: 'introduce', content: { type: 'teaching', summary: 'introduce' } },
  ]
  const decision = selectObjective(state, micro, session)
  assert(
    'dos enseñanzas consecutivas fuerzan práctica aunque pertenezcan a micros distintos',
    decision.requiresQuestion,
  )
}
{
  const graph = (await import('../simulation/adaptive-v3/programFixtures')).PROGRAM_MATHEMATICAL
  const micro = graph.microConcepts[0]
  const session = initSessionState({
    sessionId: 'no-heuristic-consolidation', userId: 'test-user',
    materialId: graph.materialId, graph, targetMinutes: 20,
  })
  let state = session.microStates[micro.id]
  state = recordEvent(state, 'introduced', 1)
  let profile = emptyEvidenceProfile(micro.id)
  for (let turn = 2; turn <= 4; turn++) {
    state = recordEvent(state, 'answered_correctly', turn, { outcome: 'correct', formatUsed: 'fill_blank' })
    profile = recordEvidence(profile, {
      formatUsed: 'fill_blank', outcome: 'correct', score: 95, turnNumber: turn,
      assistanceLevel: 'independent', activityAttemptNumber: 1,
    })
  }
  state.evidenceProfile = profile
  session.microStates[micro.id] = state
  const decision = selectObjective(state, micro, session)
  assert(
    'ninguna heurística consolida cuando el Mastery Contract aún exige aplicación',
    decision.objective !== 'consolidate',
  )
}
{
  let profile = emptyEvidenceProfile('new-activity-evidence')
  profile = recordEvidence(profile, {
    formatUsed: 'multiple_choice', outcome: 'incorrect', score: 10, turnNumber: 1,
    assistanceLevel: 'independent', activityAttemptNumber: 1,
  })
  profile = recordEvidence(profile, {
    formatUsed: 'multiple_choice', outcome: 'correct', score: 95, turnNumber: 2,
    assistanceLevel: 'independent', activityAttemptNumber: 1,
  })
  assert(
    'una actividad nueva correcta puede producir evidencia fuerte tras un fallo previo del mismo tipo',
    profile.strongCount.recognized === 1,
  )
}
{
  const run = await runSimulation({
    seed: 51_001,
    profileId: 'honest_beginner',
    programId: 'single_definitional',
    ...DEFAULT_CONFIG,
    maxSessionsPerProgram: 1,
  }, createRandom(51_001))
  const firstTeaching = run.turns.find(turn => turn.format === 'none')
  const firstPractice = run.turns.find(turn => turn.format !== 'none')
  assert(
    'la enseñanza modifica el estado latente antes de la práctica en perfiles recuperables',
    !!firstTeaching && !!firstPractice &&
      firstPractice.response._latentKnowledgeAtTime > firstTeaching.response._latentKnowledgeAtTime,
  )
}

{
  const graph = PROGRAM_SINGLE_DEFINITIONAL
  const micro = graph.microConcepts[0]
  const session = initSessionState({
    sessionId: 'repeated-failure',
    userId: 'test-user',
    materialId: graph.materialId,
    graph,
    targetMinutes: 20,
  })

  let state = session.microStates[micro.id]
  state = recordEvent(state, 'introduced', 1)
  state = recordEvent(state, 'answered_incorrectly', 2, { outcome: 'incorrect' })
  state = recordEvent(state, 'explained_by_tutor', 3, { contentShown: 'reveal_answer' })
  state = recordEvent(state, 'answered_incorrectly', 4, { outcome: 'incorrect' })
  session.microStates[micro.id] = state

  const decision = selectObjective(state, micro, session)
  assert(
    'dos fallos reales separados por feedback fuerzan una estrategia distinta de reveal_answer',
    decision.objective !== 'reveal_answer' && decision.alternativeStrategy === 'different_angle',
  )

  const afterRepair = recordEvent(state, 'explained_by_tutor', 5, {
    contentShown: decision.objective,
  })
  session.microStates[micro.id] = afterRepair
  const nextDecision = selectObjective(afterRepair, micro, session)
  assert(
    'una intervención tras el fallo conduce a práctica y no repite enseñanza equivalente',
    nextDecision.requiresQuestion && nextDecision.objective !== decision.objective,
  )
}

{
  const baseRun: SimulationRunResult & {
    repairAttempts: number
    repairResolutions: number
    strategyChangeOpportunities: number
    strategyChangesAfterRepeatedFailure: number
  } = {
    seed: 1,
    profileId: 'expert',
    programId: 'single_definitional',
    sessionCount: 2,
    totalTurns: 4,
    outcome: 'program_complete',
    masteredMicros: 1,
    totalMicros: 1,
    masteryPercent: 100,
    virtualDurationMs: 1,
    virtualDays: 0,
    invariantFailures: [],
    turns: [],
    finalMicroResolutions: { m1: 'mastered' },
    avgTrueKnowledgeAtEnd: 1,
    falseMasteryCount: 0,
    falseMissCount: 0,
    strategiesUsed: [],
    strategyChangedAfterFail: false,
    restorePointsChecked: 0,
    restoreDivergences: 0,
    repairAttempts: 0,
    repairResolutions: 0,
    strategyChangeOpportunities: 2,
    strategyChangesAfterRepeatedFailure: 2,
  }
  const report = aggregateResults([baseRun])
  assert(
    'repair success usa micros que entraron unresolved y no sessionCount como proxy',
    report.repairSuccessRate === 0,
  )
  assert(
    'strategy change usa oportunidades reales y no un boolean por run',
    report.strategyChangeRate === 1,
  )
}

{
  const graph = PROGRAM_SINGLE_DEFINITIONAL
  const microId = graph.microConcepts[0].id
  const repairedSession = initSessionState({
    sessionId: 'repair-budget',
    userId: 'test-user',
    materialId: graph.materialId,
    graph,
    targetMinutes: 20,
    priorMastery: {
      [microId]: {
        masteryLevel: 'struggling',
        isReady: true,
        answeredCorrectly: 1,
        answeredIncorrectly: 5,
        introduced: true,
        explainedByTutor: true,
      },
    },
  })
  assert(
    'una sesión de repair recibe un presupuesto nuevo de interacciones sin borrar evidencia histórica',
    repairedSession.microStates[microId].totalInteractions === 0 &&
      repairedSession.microStates[microId].evidence.answeredIncorrectly === 5,
  )
}

{
  const micro = PROGRAM_SINGLE_DEFINITIONAL.microConcepts[0]
  const profile = rebuildProfile(micro.id, [
    evidence('recognized', 'assisted', 1),
    evidence('recalled', 'assisted', 2),
    evidence('explained', 'independent', 3),
    evidence('explained', 'independent', 4),
  ])

  assert(
    'independencia en evidencia irrelevante no compensa ayuda excesiva en tipos requeridos',
    isMicroMastered(profile, micro) === false,
  )
  const missing = getMissingEvidences(profile, micro)
  assert(
    'evidencia requerida obtenida con ayuda excesiva permanece como objetivo de repair',
    missing.includes('recognized') && missing.includes('recalled'),
  )
}

{
  const conceptual = {
    ...PROGRAM_SINGLE_DEFINITIONAL.microConcepts[0],
    id: 'conceptual-strong-medium-floor',
    cognitiveType: 'conceptual' as const,
  }
  const profile = rebuildProfile(conceptual.id, [
    evidence('recognized', 'independent', 1),
    evidence('explained', 'independent', 2),
    evidence('connected', 'independent', 3),
  ])
  assert(
    'evidencia strong satisface un mínimo medium del mismo tipo sin debilitar el contrato',
    isMicroMastered(profile, conceptual),
  )
}

console.log(`\nResultado: ${passed} PASS, ${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
