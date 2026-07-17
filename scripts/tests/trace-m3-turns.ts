import { createRandom } from '../simulation/adaptive-v3/seededRandom'
import { runSimulation } from '../simulation/adaptive-v3/simulationRunner'
import { DEFAULT_CONFIG } from '../simulation/adaptive-v3/types'

async function main() {
  const rng = createRandom(1001)
  const result = await runSimulation({
    seed: 1001, profileId: 'expert', programId: 'small_mixed', ...DEFAULT_CONFIG,
  }, rng)

  const m3turns = result.turns.filter(t => t.microId === 'm3' && t.format !== 'none')

  console.log('=== m3: TODOS LOS TURNOS CON FORMATO ===')
  console.log('total:', m3turns.length)

  const byFormat: Record<string, {correct: number, partial: number, incorrect: number}> = {}
  for (const t of m3turns) {
    if (!byFormat[t.format]) byFormat[t.format] = {correct: 0, partial: 0, incorrect: 0}
    byFormat[t.format][t.response.outcome]++
  }
  console.log('\nDistribución por formato:')
  console.log(JSON.stringify(byFormat, null, 2))

  console.log('\nÚltimos 15 turnos de m3:')
  for (const t of m3turns.slice(-15)) {
    console.log(`turn=${t.turnIndex} obj=${t.objective} format=${t.format} outcome=${t.response.outcome} score=${t.response.score} indep=${t.evidenceProfileAfter.independentSuccesses} mastery=${t.evidenceProfileAfter.masteryScore}%`)
  }

  console.log('\n=== PROFILE FINAL m3 ===')
  const last = m3turns[m3turns.length - 1]
  if (last) {
    console.log(JSON.stringify(last.evidenceProfileAfter, null, 2))
  }

  // Ver si hay practical_case correctos
  const practicalCorrect = m3turns.filter(t => t.format === 'practical_case' && t.response.outcome === 'correct')
  console.log('\npractical_case correctos:', practicalCorrect.length)

  const predictCorrect = m3turns.filter(t => t.format === 'prediction' && t.response.outcome === 'correct')
  console.log('prediction correctos:', predictCorrect.length)
}

main().catch(e => { console.error(e); process.exit(1) })
