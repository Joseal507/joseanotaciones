import { createRandom } from '../simulation/adaptive-v3/seededRandom'
import { runSimulation } from '../simulation/adaptive-v3/simulationRunner'
import { DEFAULT_CONFIG } from '../simulation/adaptive-v3/types'
import { PROGRAM_SMALL_MIXED } from '../simulation/adaptive-v3/programFixtures'
import { emptyEvidenceProfile, recordEvidence, isMicroMastered } from '../../lib/adaptive/v3/engine/evidenceEngine'
import { checkMasteryContract } from '../../lib/adaptive/v3/engine/masteryContracts'

async function main() {
  const seed = 1001
  const rng = createRandom(seed)
  const result = await runSimulation({
    seed,
    profileId: 'expert',
    programId: 'small_mixed',
    ...DEFAULT_CONFIG,
  }, rng)

  console.log('=== RUN SUMMARY ===')
  console.log(JSON.stringify({
    outcome: result.outcome,
    sessionCount: result.sessionCount,
    totalTurns: result.totalTurns,
    masteryPercent: result.masteryPercent,
    masteredMicros: result.masteredMicros,
    totalMicros: result.totalMicros,
    finalMicroResolutions: result.finalMicroResolutions,
  }, null, 2))

  const perMicro = new Map()

  for (const turn of result.turns) {
    if (turn.format === 'none') continue
    if (!perMicro.has(turn.microId)) {
      perMicro.set(turn.microId, emptyEvidenceProfile(turn.microId))
    }
    const profile = perMicro.get(turn.microId)
    const updated = recordEvidence(profile, {
      formatUsed: turn.format,
      outcome: turn.response.outcome,
      score: turn.response.score,
      turnNumber: turn.turnIndex,
      assistanceLevel: turn.response.assistanceLevel,
      responseTimeMs: turn.response.responseTimeMs,
      selfReportedConfidence: turn.response.selfReportedConfidence,
      interactionContext: turn.response.interactionContext,
      elapsedSinceLastExposureMs: turn.response.elapsedSinceLastExposureMs,
    })
    perMicro.set(turn.microId, updated)
  }

  for (const micro of PROGRAM_SMALL_MIXED.microConcepts) {
    const profile = perMicro.get(micro.id) || emptyEvidenceProfile(micro.id)
    const contract = checkMasteryContract(
      micro.cognitiveType,
      {
        strongCount: profile.strongCount,
        mediumCount: profile.mediumCount,
        masteryScore: profile.masteryScore,
        totalEvidences: profile.totalEvidences,
      },
      {
        independentSuccesses: profile.independentSuccesses,
        hasDelayedRecall: profile.hasDelayedRecall,
        hasTransfer: profile.hasTransfer,
        hasIntegration: profile.hasIntegration,
        maxAssistanceLevelUsed: profile.maxAssistanceLevelUsed,
      },
    )

    console.log(`\n=== MICRO ${micro.id} (${micro.cognitiveType}) ===`)
    console.log(JSON.stringify({
      name: micro.name,
      cognitiveType: micro.cognitiveType,
      difficulty: micro.difficulty,
      importance: micro.importance,
      masteryScore: profile.masteryScore,
      totalEvidences: profile.totalEvidences,
      independentSuccesses: profile.independentSuccesses,
      hasTransfer: profile.hasTransfer,
      hasIntegration: profile.hasIntegration,
      hasDelayedRecall: profile.hasDelayedRecall,
      strongCount: profile.strongCount,
      mediumCount: profile.mediumCount,
      maxAssistanceLevelUsed: profile.maxAssistanceLevelUsed,
      isMicroMastered: isMicroMastered(profile, micro as any),
      contract,
    }, null, 2))
  }

  console.log('\n=== LAST 20 TURNS ===')
  for (const t of result.turns.slice(-20)) {
    console.log(JSON.stringify({
      turn: t.turnIndex,
      microId: t.microId,
      objective: t.objective,
      format: t.format,
      outcome: t.response.outcome,
      score: t.response.score,
      assistanceLevel: t.response.assistanceLevel,
      interactionContext: t.response.interactionContext,
      masteryScoreAfter: t.evidenceProfileAfter.masteryScore,
      independentSuccessesAfter: t.evidenceProfileAfter.independentSuccesses,
    }))
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
