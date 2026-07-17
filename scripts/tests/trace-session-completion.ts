import { createRandom } from '../simulation/adaptive-v3/seededRandom'
import { runSimulation } from '../simulation/adaptive-v3/simulationRunner'
import { DEFAULT_CONFIG } from '../simulation/adaptive-v3/types'
import { evaluateSessionCompletion } from '../../lib/adaptive/v3/engine/stateMachine'
import { isMicroMastered, emptyEvidenceProfile } from '../../lib/adaptive/v3/engine/evidenceEngine'
import { PROGRAM_SINGLE_DEFINITIONAL } from '../simulation/adaptive-v3/programFixtures'

async function main() {
  const seed = 1001
  const rng = createRandom(seed)
  const config = {
    seed,
    profileId: 'expert' as const,
    programId: 'single_definitional',
    ...DEFAULT_CONFIG,
    maxSessionsPerProgram: 3,
    maxTurnsPerSession: 20,
  }

  const result = await runSimulation(config, rng)

  console.log('=== RESULTADO DEL RUN ===')
  console.log('outcome:', result.outcome)
  console.log('masteredMicros:', result.masteredMicros)
  console.log('totalMicros:', result.totalMicros)
  console.log('masteryPercent:', result.masteryPercent)
  console.log('finalMicroResolutions:', result.finalMicroResolutions)
  console.log('totalTurns:', result.totalTurns)
  console.log('sessionCount:', result.sessionCount)

  console.log('\n=== ÚLTIMOS 10 TURNOS ===')
  for (const t of result.turns.slice(-10)) {
    console.log(`turn=${t.turnIndex} micro=${t.microId} obj=${t.objective} format=${t.format} outcome=${t.response.outcome} assistanceLevel=${t.response.assistanceLevel} masteryScore=${t.evidenceProfileAfter.masteryScore}% indep=${t.evidenceProfileAfter.independentSuccesses}`)
  }

  console.log('\n=== PROFILE AFTER CADA TURNO (m1) ===')
  for (const t of result.turns.filter(t => t.microId === 'm1' && t.format !== 'none').slice(-5)) {
    console.log(`turn=${t.turnIndex} outcome=${t.response.outcome} assistanceLevel=${t.response.assistanceLevel} masteryScore=${t.evidenceProfileAfter.masteryScore}% indepSuccesses=${t.evidenceProfileAfter.independentSuccesses} hasDelayedRecall=${t.evidenceProfileAfter.hasDelayedRecall}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
