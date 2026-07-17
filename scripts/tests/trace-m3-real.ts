import { createRandom } from '../simulation/adaptive-v3/seededRandom'
import { runSimulation } from '../simulation/adaptive-v3/simulationRunner'
import { DEFAULT_CONFIG } from '../simulation/adaptive-v3/types'
import { isMicroMastered } from '../../lib/adaptive/v3/engine/evidenceEngine'
import { checkMasteryContract } from '../../lib/adaptive/v3/engine/masteryContracts'
import { PROGRAM_SMALL_MIXED } from '../simulation/adaptive-v3/programFixtures'

async function main() {
  const seed = 1001
  const rng = createRandom(seed)
  
  // Hook: interceptar el estado final de microStates
  const result = await runSimulation({
    seed, profileId: 'expert', programId: 'small_mixed', ...DEFAULT_CONFIG,
  }, rng)

  console.log('outcome:', result.outcome)
  console.log('masteryPercent:', result.masteryPercent)
  console.log('finalMicroResolutions:', JSON.stringify(result.finalMicroResolutions, null, 2))

  // Analizar los turnos de m3
  const m3turns = result.turns.filter(t => t.microId === 'm3')
  console.log('\n=== TODOS LOS TURNOS DE m3 ===')
  console.log('total turns m3:', m3turns.length)
  
  // Distribución de formatos
  const formatsM3: Record<string, number> = {}
  const outcomesM3: Record<string, number> = {}
  for (const t of m3turns) {
    if (t.format !== 'none') {
      formatsM3[t.format] = (formatsM3[t.format] || 0) + 1
      outcomesM3[t.response.outcome] = (outcomesM3[t.response.outcome] || 0) + 1
    }
  }
  console.log('formatos usados en m3:', JSON.stringify(formatsM3))
  console.log('outcomes en m3:', JSON.stringify(outcomesM3))

  // evidenceProfile acumulado turno a turno
  console.log('\n=== ÚLTIMO evidenceProfileAfter de m3 con formato real ===')
  const lastM3WithFormat = [...m3turns].reverse().find(t => t.format !== 'none')
  if (lastM3WithFormat) {
    console.log(JSON.stringify(lastM3WithFormat.evidenceProfileAfter, null, 2))
  }

  // Verificar m3 con el contrato real
  const micro3 = PROGRAM_SMALL_MIXED.microConcepts.find(m => m.id === 'm3')!
  const lastProfile = lastM3WithFormat?.evidenceProfileAfter
  if (lastProfile) {
    console.log('\n=== CONTRATO m3 con último evidenceProfileAfter ===')
    const contract = checkMasteryContract(
      'applicative',
      {
        strongCount: lastProfile as any,
        mediumCount: lastProfile as any,
        masteryScore: lastProfile.masteryScore,
        totalEvidences: 0,
      },
      {
        independentSuccesses: lastProfile.independentSuccesses,
        hasDelayedRecall: lastProfile.hasDelayedRecall,
        hasTransfer: lastProfile.hasTransfer,
      }
    )
    console.log(JSON.stringify(contract, null, 2))
  }

  // Primeros y últimos 10 turnos de m3
  console.log('\n=== PRIMEROS 10 TURNOS DE m3 ===')
  for (const t of m3turns.slice(0, 10)) {
    console.log(JSON.stringify({
      turn: t.turnIndex, objective: t.objective, format: t.format,
      outcome: t.response.outcome, score: t.response.score,
      assistanceLevel: t.response.assistanceLevel,
      masteryScoreAfter: t.evidenceProfileAfter.masteryScore,
      independentSuccessesAfter: t.evidenceProfileAfter.independentSuccesses,
    }))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
