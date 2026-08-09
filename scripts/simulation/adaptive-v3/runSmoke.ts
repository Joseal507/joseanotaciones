#!/usr/bin/env tsx
// Smoke test rápido: 20 runs
import { createRandom } from './seededRandom'
import { runSimulation } from './simulationRunner'
import { aggregateResults, printReport, saveReports } from './report'
import { DEFAULT_CONFIG } from './types'
import type { SimulationConfig } from './types'

async function main() {
  console.log('\n🚀 SMOKE SIMULATION — 20 runs\n')
  const results = []
  const configs: SimulationConfig[] = [
    { seed: 1001, profileId: 'expert', programId: 'small_mixed', ...DEFAULT_CONFIG },
    { seed: 1002, profileId: 'honest_beginner', programId: 'small_mixed', ...DEFAULT_CONFIG },
    { seed: 1003, profileId: 'high_confidence_misconception', programId: 'single_definitional', ...DEFAULT_CONFIG },
    { seed: 1004, profileId: 'assistance_dependent', programId: 'small_mixed', ...DEFAULT_CONFIG },
    { seed: 1005, profileId: 'slow_but_correct', programId: 'small_mixed', ...DEFAULT_CONFIG },
    { seed: 1006, profileId: 'guesser', programId: 'definitional_only', ...DEFAULT_CONFIG },
    { seed: 1007, profileId: 'memorizer_no_transfer', programId: 'transfer_required', ...DEFAULT_CONFIG },
    { seed: 1008, profileId: 'deep_understanding', programId: 'chained', ...DEFAULT_CONFIG },
    { seed: 1009, profileId: 'forgetful', programId: 'small_mixed', ...DEFAULT_CONFIG },
    { seed: 1010, profileId: 'resistant', programId: 'small_mixed', ...DEFAULT_CONFIG },
    { seed: 1011, profileId: 'inconsistent', programId: 'definitional_only', ...DEFAULT_CONFIG },
    { seed: 1012, profileId: 'dropout_returning', programId: 'small_mixed', ...DEFAULT_CONFIG },
    { seed: 1013, profileId: 'low_confidence_expert', programId: 'mathematical', ...DEFAULT_CONFIG },
    { seed: 1014, profileId: 'hint_user', programId: 'small_mixed', ...DEFAULT_CONFIG },
    { seed: 1015, profileId: 'reveal_then_recover', programId: 'single_definitional', ...DEFAULT_CONFIG },
    { seed: 1016, profileId: 'legacy_student', programId: 'small_mixed', ...DEFAULT_CONFIG },
    { seed: 1017, profileId: 'expert', programId: 'large', ...DEFAULT_CONFIG },
    { seed: 1018, profileId: 'honest_beginner', programId: 'chained', ...DEFAULT_CONFIG },
    { seed: 1019, profileId: 'guesser', programId: 'mathematical', ...DEFAULT_CONFIG },
    { seed: 1020, profileId: 'deep_understanding', programId: 'procedural', ...DEFAULT_CONFIG },
  ]

  for (const cfg of configs) {
    process.stdout.write(`  seed=${cfg.seed} profile=${cfg.profileId} program=${cfg.programId}... `)
    const rng = createRandom(cfg.seed)
    const result = await runSimulation(cfg, rng)
    results.push(result)
    const icon = result.invariantFailures.length === 0 && result.outcome !== 'invalid_loop' ? '✓' : '✗'
    console.log(`${icon} ${result.outcome} (${result.totalTurns} turns, ${result.masteryPercent}% mastery)`)
  }

  const report = aggregateResults(results)
  const failures = results.filter(r => r.invariantFailures.length > 0 || r.outcome.startsWith('invalid'))
  printReport(report, failures)
  saveReports(report, failures)

  const exitCode = report.invariantFailures > 0 || report.loopFailures > 0 || report.falseMasteryCases > 0 ? 1 : 0
  process.exit(exitCode)
}

main().catch(e => { console.error(e); process.exit(1) })
