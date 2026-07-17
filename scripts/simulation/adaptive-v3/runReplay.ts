#!/usr/bin/env tsx
// Replay exacto de un fallo por seed
import { createRandom } from './seededRandom'
import { runSimulation } from './simulationRunner'
import { DEFAULT_CONFIG } from './types'
import type { StudentProfileId } from './types'

async function main() {
  const args = process.argv.slice(2)
  const seedArg = args.find(a => a.startsWith('--seed='))?.split('=')[1]
  const profileArg = args.find(a => a.startsWith('--profile='))?.split('=')[1]
  const programArg = args.find(a => a.startsWith('--program='))?.split('=')[1]

  if (!seedArg || !profileArg || !programArg) {
    console.error('Uso: npm run simulate:v3:replay -- --seed=X --profile=Y --program=Z')
    process.exit(1)
  }

  const seed = parseInt(seedArg)
  const profileId = profileArg as StudentProfileId
  const programId = programArg

  console.log(`\n🔄 REPLAY seed=${seed} profile=${profileId} program=${programId}\n`)

  const rng = createRandom(seed)
  const result = await runSimulation({ seed, profileId, programId, ...DEFAULT_CONFIG }, rng)

  console.log(`Outcome: ${result.outcome}`)
  console.log(`Sessions: ${result.sessionCount}`)
  console.log(`Total turns: ${result.totalTurns}`)
  console.log(`Mastery: ${result.masteryPercent}%`)
  console.log(`False mastery: ${result.falseMasteryCount}`)
  console.log(`Restore divergences: ${result.restoreDivergences}`)

  if (result.invariantFailures.length > 0) {
    console.log(`\nINVARIANT FAILURES:`)
    for (const f of result.invariantFailures) {
      console.log(`  [${f.invariantId}] ${f.description}`)
      console.log(`  Snapshot: ${JSON.stringify(f.snapshot)}`)
    }
  }

  if (result.turns.length > 0) {
    console.log(`\nLast 10 turns:`)
    for (const t of result.turns.slice(-10)) {
      console.log(`  turn=${t.turnIndex} micro=${t.microId} obj=${t.objective} outcome=${t.response.outcome} mastery=${t.evidenceProfileAfter.masteryScore}%`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
