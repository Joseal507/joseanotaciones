import assert from 'node:assert/strict'
import { measureStrategyChangesAfterRepeatedFailure } from '../simulation/adaptive-v3/simulationRunner'
import type { SimulationTurn } from '../simulation/adaptive-v3/types'

const turn = (index: number, outcome: 'correct' | 'incorrect', objective: string, format = 'multiple_choice'): SimulationTurn => ({
  turnIndex: index,
  sessionIndex: 1,
  microId: 'micro',
  format,
  objective,
  response: { outcome, score: outcome === 'correct' ? 100 : 0, responseTimeMs: 1, assistanceLevel: 'independent', selfReportedConfidence: 50, interactionContext: 'immediate_practice', attemptNumber: index, wasRetry: index > 1, elapsedSinceLastExposureMs: 1, _latentKnowledgeAtTime: .2, _wasGuess: false },
  engineDecision: { objective, reason: 'test', strategyId: objective },
  evidenceProfileAfter: { masteryScore: 0, independentSuccesses: 0, hasTransfer: false, hasDelayedRecall: false },
  virtualTimeMs: index,
})

const changedAfterLongStreak = measureStrategyChangesAfterRepeatedFailure([
  turn(1, 'incorrect', 'retrieve'),
  turn(2, 'incorrect', 'retrieve'),
  turn(3, 'incorrect', 'repair', 'true_false'),
  turn(4, 'correct', 'repair', 'true_false'),
])
assert.deepEqual(changedAfterLongStreak, { opportunities: 1, changes: 1 }, 'una racha larga es una oportunidad, no oportunidades superpuestas')

const terminalStreak = measureStrategyChangesAfterRepeatedFailure([
  turn(1, 'incorrect', 'retrieve'),
  turn(2, 'incorrect', 'retrieve'),
])
assert.deepEqual(terminalStreak, { opportunities: 0, changes: 0 }, 'sin actividad posterior no existe oportunidad observable')

const unchanged = measureStrategyChangesAfterRepeatedFailure([
  turn(1, 'incorrect', 'retrieve'),
  turn(2, 'incorrect', 'retrieve'),
  turn(3, 'correct', 'retrieve'),
])
assert.deepEqual(unchanged, { opportunities: 1, changes: 0 }, 'una estrategia realmente repetida sigue contando como fallo')

console.log('Simulation strategy metrics: PASS')
