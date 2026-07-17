import { initSessionState, recordEvent, evaluateSessionCompletion } from '../../lib/adaptive/v3/engine/stateMachine'
import { emptyEvidenceProfile, recordEvidence, isMicroMastered } from '../../lib/adaptive/v3/engine/evidenceEngine'
import { PROGRAM_SINGLE_DEFINITIONAL } from '../simulation/adaptive-v3/programFixtures'

const graph = PROGRAM_SINGLE_DEFINITIONAL

function log(title: string, value: unknown) {
  console.log(`\n=== ${title} ===`)
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
}

async function main() {
  const session1 = initSessionState({
    sessionId: 's1',
    userId: 'u1',
    materialId: graph.materialId,
    graph,
    targetMinutes: 20,
    microIdsToTeach: ['m1'],
  })

  const micro = graph.microConcepts[0]
  const st0 = session1.microStates['m1']

  // Introducción + ejemplo
  let st = recordEvent(st0, 'introduced', 1, { contentShown: 'intro' })
  st = recordEvent(st, 'explained_by_tutor', 2, { contentShown: 'example' })

  let profile = emptyEvidenceProfile('m1')

  // Turno 3: MCQ correct independent
  st = recordEvent(st, 'answered_correctly', 3, { outcome: 'correct' })
  profile = recordEvidence(profile, {
    formatUsed: 'multiple_choice',
    outcome: 'correct',
    score: 90,
    turnNumber: 3,
    assistanceLevel: 'independent',
    interactionContext: 'immediate_practice',
  })

  // Turno 4: fill_blank partial independent
  st = recordEvent(st, 'answered_partially', 4, { outcome: 'partial' })
  profile = recordEvidence(profile, {
    formatUsed: 'fill_blank',
    outcome: 'partial',
    score: 65,
    turnNumber: 4,
    assistanceLevel: 'independent',
    interactionContext: 'immediate_practice',
  })

  // Turno 5: true_false correct independent
  st = recordEvent(st, 'answered_correctly', 5, { outcome: 'correct' })
  profile = recordEvidence(profile, {
    formatUsed: 'true_false',
    outcome: 'correct',
    score: 90,
    turnNumber: 5,
    assistanceLevel: 'independent',
    interactionContext: 'immediate_practice',
  })

  // Turno 6: MCQ correct independent
  st = recordEvent(st, 'answered_correctly', 6, { outcome: 'correct' })
  profile = recordEvidence(profile, {
    formatUsed: 'multiple_choice',
    outcome: 'correct',
    score: 90,
    turnNumber: 6,
    assistanceLevel: 'independent',
    interactionContext: 'immediate_practice',
  })

  // Turno 7: fill_blank correct independent
  st = recordEvent(st, 'answered_correctly', 7, { outcome: 'correct' })
  profile = recordEvidence(profile, {
    formatUsed: 'fill_blank',
    outcome: 'correct',
    score: 90,
    turnNumber: 7,
    assistanceLevel: 'independent',
    interactionContext: 'immediate_practice',
  })

  st.evidenceProfile = profile
  session1.microStates['m1'] = st
  session1.requiredMicroIds = ['m1']

  log('PROFILE AL FINAL DE SESSION 1', {
    masteryScore: profile.masteryScore,
    independentSuccesses: profile.independentSuccesses,
    hasDelayedRecall: profile.hasDelayedRecall,
    strongCount: profile.strongCount,
    totalEvidences: profile.totalEvidences,
    isMicroMastered: isMicroMastered(profile, micro as any),
  })

  const completion1 = evaluateSessionCompletion(session1, graph)
  log('COMPLETION SESSION 1', completion1)

  const priorMastery = {
    m1: {
      masteryLevel: st.masteryLevel,
      isReady: st.isReady,
      answeredCorrectly: st.evidence.answeredCorrectly,
      answeredIncorrectly: st.evidence.answeredIncorrectly,
      introduced: st.evidence.introduced,
      explainedByTutor: st.evidence.explainedByTutor,
      applied: st.evidence.applied,
      evidenceProfileSnapshot: st.evidenceProfile,
    },
  }

  log('PRIOR MASTERY SNAPSHOT', priorMastery)

  const session2 = initSessionState({
    sessionId: 's2',
    userId: 'u1',
    materialId: graph.materialId,
    graph,
    targetMinutes: 20,
    microIdsToTeach: ['m1'],
    priorMastery,
  })
  session2.requiredMicroIds = ['m1']

  const restored = session2.microStates['m1']
  log('RESTORED MICROSTATE SESSION 2', {
    masteryLevel: restored.masteryLevel,
    isReady: restored.isReady,
    totalInteractions: restored.totalInteractions,
    answeredCorrectly: restored.evidence.answeredCorrectly,
    answeredIncorrectly: restored.evidence.answeredIncorrectly,
    hasEvidenceProfile: !!restored.evidenceProfile,
    evidenceProfile: restored.evidenceProfile ? {
      masteryScore: restored.evidenceProfile.masteryScore,
      independentSuccesses: restored.evidenceProfile.independentSuccesses,
      hasDelayedRecall: restored.evidenceProfile.hasDelayedRecall,
      strongCount: restored.evidenceProfile.strongCount,
      totalEvidences: restored.evidenceProfile.totalEvidences,
      isMicroMastered: isMicroMastered(restored.evidenceProfile, micro as any),
    } : null,
  })

  const completion2 = evaluateSessionCompletion(session2, graph)
  log('COMPLETION SESSION 2', completion2)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
