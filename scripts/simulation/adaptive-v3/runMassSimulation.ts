#!/usr/bin/env tsx
// Simulación masiva: 1000+ seeds
import { createRandom } from './seededRandom'
import { runSimulation } from './simulationRunner'
import { aggregateResults, printReport, saveReports } from './report'
import { DEFAULT_CONFIG } from './types'
import type { SimulationConfig, StudentProfileId } from './types'
import { ALL_PROFILE_IDS } from './studentProfiles'
import { ALL_PROGRAM_IDS } from './programFixtures'

async function main() {
  const TARGET_RUNS = parseInt(process.argv[2] || '1000')
  console.log(`\n🏭 MASS SIMULATION — ${TARGET_RUNS} runs\n`)

  const rngMaster = createRandom(42)
  const results = []
  const startTime = Date.now()

  for (let i = 0; i < TARGET_RUNS; i++) {
    const seed = 10000 + i
    const profileId = ALL_PROFILE_IDS[i % ALL_PROFILE_IDS.length] as StudentProfileId
    const programId = ALL_PROGRAM_IDS[
      Math.floor(i / ALL_PROFILE_IDS.length) % ALL_PROGRAM_IDS.length
    ]

    // Variar config: sesiones cortas, medias y largas
    const targetMinutes = [12, 22, 35][i % 3]

    const cfg: SimulationConfig = {
      seed,
      profileId,
      programId,
      ...DEFAULT_CONFIG,
      targetMinutes,
    }

    const rng = createRandom(seed)
    const result = await runSimulation(cfg, rng)
    results.push(result)

    // Progreso cada 100 runs
    if ((i + 1) % 100 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      const failures = results.filter(r => r.invariantFailures.length > 0).length
      console.log(`  Progress: ${i + 1}/${TARGET_RUNS} | ${elapsed}s | failures: ${failures}`)
    }
  }

  console.log(`\nCompleted ${results.length} runs in ${((Date.now() - startTime) / 1000).toFixed(1)}s`)

  const report = aggregateResults(results)
  report.stochasticRuns = results.length
  const failures = results.filter(r => r.invariantFailures.length > 0 || r.outcome.startsWith('invalid'))
  printReport(report, failures)
  saveReports(report, failures)

  const pedagogicalGateFailed =
    report.segments.capable.avgTurnsPerMicro > 12 ||
    (report.segments.recoverable.repairSuccessRate ?? 0) < 0.60 ||
    Object.values(report.segments).some(segment => segment.strategyChangeRate !== null && segment.strategyChangeRate < 0.80) ||
    report.segments.adversarial.falseMasteryCases > 0
  const exitCode = report.invariantFailures > 0 || report.loopFailures > 0 || report.restoreDivergences > 0 || report.falseMasteryCases > 0 || pedagogicalGateFailed ? 1 : 0
  process.exit(exitCode)
}

main().catch(e => { console.error(e); process.exit(1) })
