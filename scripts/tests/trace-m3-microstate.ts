import { createRandom } from '../simulation/adaptive-v3/seededRandom'
import { DEFAULT_CONFIG } from '../simulation/adaptive-v3/types'
import { isMicroMastered, emptyEvidenceProfile } from '../../lib/adaptive/v3/engine/evidenceEngine'
import { checkMasteryContract } from '../../lib/adaptive/v3/engine/masteryContracts'
import { PROGRAM_SMALL_MIXED } from '../simulation/adaptive-v3/programFixtures'
import {
  initSessionState, recordEvent, recordTurn, selectNextMicro,
  advanceMicro, evaluateSessionCompletion, MAX_INTERACTIONS_PER_MICRO
} from '../../lib/adaptive/v3/engine/stateMachine'
import { recordEvidence, isReadyToAdvanceEvidence } from '../../lib/adaptive/v3/engine/evidenceEngine'
import { selectObjective } from '../../lib/adaptive/v3/engine/objectiveSelector'
import { selectFormat } from '../../lib/adaptive/v3/engine/formatSelector'
import type { MicroEventType, Turn } from '../../lib/adaptive/v3/types'
import type { EvidenceProfile } from '../../lib/adaptive/v3/engine/evidenceEngine'

async function main() {
  const graph = PROGRAM_SMALL_MIXED
  const micro3 = graph.microConcepts.find(m => m.id === 'm3')!

  let session = initSessionState({
    sessionId: 's1', userId: 'u1', materialId: graph.materialId,
    graph, targetMinutes: 20,
  })
  session.requiredMicroIds = graph.microConcepts.map(m => m.id)

  const FORMATS_PRODUCING_EVIDENCE: Record<string, string[]> = {
    multiple_choice: ['recognized'], true_false: ['recognized'],
    fill_blank: ['recalled'], fill_blank_bank: ['recalled'],
    ordering: ['recalled', 'applied'], step_by_step_solver: ['applied'],
    practical_case: ['applied', 'transferred'], prediction: ['applied', 'transferred'],
    explain_why: ['explained'], teach_back: ['explained'], open_response: ['explained'],
    matching: ['recognized', 'connected'],
  }

  // Simular 30 turnos directamente en m3 con formatos que producen applied/recalled/transferred
  session.queue.activeMicroId = 'm3'
  session.queue.pendingMicroIds = []
  session.queue.completedMicroIds = ['m1', 'm2']

  const recordEventOnMicro = (event: MicroEventType, format: string, outcome: 'correct' | 'partial' | 'incorrect', score: number) => {
    const st = recordEvent(
      session.microStates['m3'], event, session.currentTurn,
      { outcome, studentResponse: `sim_${outcome}` }
    )
    if (st.timeline.length > 0) {
      const last = st.timeline[st.timeline.length - 1]
      if (last?.metadata) last.metadata.formatUsed = format
    }
    session.microStates['m3'] = st

    const currentProfile: EvidenceProfile =
      session.microStates['m3'].evidenceProfile || emptyEvidenceProfile('m3')

    const updatedProfile = recordEvidence(currentProfile, {
      formatUsed: format, outcome, score, turnNumber: session.currentTurn,
      assistanceLevel: 'independent', interactionContext: 'immediate_practice',
    })
    session.microStates['m3'].evidenceProfile = updatedProfile

    session.microStates['m3'].isReady =
      isReadyToAdvanceEvidence(updatedProfile, micro3) ||
      isMicroMastered(updatedProfile, micro3)
  }

  // Secuencia realista para applicative:
  // introduce → example → recall → apply → apply → transfer
  recordEvent(session.microStates['m3'], 'introduced', 0, { contentShown: 'intro' })
  recordEventOnMicro('answered_correctly', 'fill_blank', 'correct', 90)     // recalled
  recordEventOnMicro('answered_correctly', 'fill_blank', 'correct', 85)     // recalled ×2
  recordEventOnMicro('answered_correctly', 'practical_case', 'correct', 88) // applied + transferred
  recordEventOnMicro('answered_correctly', 'practical_case', 'correct', 90) // applied ×2 + transferred ×2
  recordEventOnMicro('answered_correctly', 'fill_blank', 'correct', 82)     // recalled ×3

  const profile = session.microStates['m3'].evidenceProfile || emptyEvidenceProfile('m3')

  console.log('=== PROFILE m3 DESPUÉS DE SECUENCIA ÓPTIMA ===')
  console.log(JSON.stringify({
    masteryScore: profile.masteryScore,
    independentSuccesses: profile.independentSuccesses,
    totalEvidences: profile.totalEvidences,
    hasTransfer: profile.hasTransfer,
    strongCount: profile.strongCount,
    mediumCount: profile.mediumCount,
    maxAssistanceLevelUsed: profile.maxAssistanceLevelUsed,
    isMicroMastered: isMicroMastered(profile, micro3 as any),
  }, null, 2))

  const contract = checkMasteryContract(
    'applicative',
    { strongCount: profile.strongCount, mediumCount: profile.mediumCount, masteryScore: profile.masteryScore, totalEvidences: profile.totalEvidences },
    { independentSuccesses: profile.independentSuccesses, hasDelayedRecall: profile.hasDelayedRecall, hasTransfer: profile.hasTransfer, hasIntegration: profile.hasIntegration, maxAssistanceLevelUsed: profile.maxAssistanceLevelUsed }
  )
  console.log('\n=== CONTRATO m3 DESPUÉS ===')
  console.log(JSON.stringify(contract, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })
