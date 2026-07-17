import {
  emptyEvidenceProfile,
  recordEvidence,
  getMissingEvidences,
  isMicroMastered,
} from '../../lib/adaptive/v3/engine/evidenceEngine'
import {
  checkMasteryContract,
  MASTERY_CONTRACTS,
} from '../../lib/adaptive/v3/engine/masteryContracts'

const micro = {
  id: 'm1',
  name: 'Test Micro',
  shortDescription: 'Micro de prueba',
  fullDefinition: 'Definición de prueba',
  cognitiveType: 'definitional',
  difficulty: 30,
  estimatedMinutes: 5,
  sourceQuotes: [],
  sourceChunkIds: [],
  sourcePages: [],
  examples: [],
  formulas: [],
  procedures: [],
  commonErrors: [],
  prerequisites: [],
  enables: [],
  related: [],
  importance: 'high',
  topicGroup: 'test',
  extractedAt: Date.now(),
} as const

console.log('=== CONTRATO definitional ===')
console.log(JSON.stringify(MASTERY_CONTRACTS.definitional, null, 2))

let profile = emptyEvidenceProfile('m1')

console.log('\n=== PERFIL INICIAL ===')
console.log(JSON.stringify({
  independentSuccesses: profile.independentSuccesses,
  masteryScore: profile.masteryScore,
  hasDelayedRecall: profile.hasDelayedRecall,
  maxAssistanceLevelUsed: profile.maxAssistanceLevelUsed,
  strongCount: profile.strongCount,
  mediumCount: profile.mediumCount,
}, null, 2))

console.log('\n=== EVIDENCIA 1: multiple_choice correct independent ===')
profile = recordEvidence(profile, {
  formatUsed: 'multiple_choice',
  outcome: 'correct',
  score: 90,
  turnNumber: 1,
  assistanceLevel: 'independent',
  interactionContext: 'immediate_practice',
})
console.log(JSON.stringify({
  independentSuccesses: profile.independentSuccesses,
  masteryScore: profile.masteryScore,
  hasDelayedRecall: profile.hasDelayedRecall,
  maxAssistanceLevelUsed: profile.maxAssistanceLevelUsed,
  strongCount: profile.strongCount,
  mediumCount: profile.mediumCount,
}, null, 2))

console.log('\n=== EVIDENCIA 2: fill_blank correct independent ===')
profile = recordEvidence(profile, {
  formatUsed: 'fill_blank',
  outcome: 'correct',
  score: 85,
  turnNumber: 2,
  assistanceLevel: 'independent',
  interactionContext: 'immediate_practice',
})
console.log(JSON.stringify({
  independentSuccesses: profile.independentSuccesses,
  masteryScore: profile.masteryScore,
  hasDelayedRecall: profile.hasDelayedRecall,
  hasTransfer: profile.hasTransfer,
  hasIntegration: profile.hasIntegration,
  maxAssistanceLevelUsed: profile.maxAssistanceLevelUsed,
  strongCount: profile.strongCount,
  mediumCount: profile.mediumCount,
  totalEvidences: profile.totalEvidences,
}, null, 2))

console.log('\n=== MISSING EVIDENCES ===')
console.log(getMissingEvidences(profile, micro as any))

console.log('\n=== CHECK MASTERY CONTRACT ===')
const result = checkMasteryContract(
  'definitional',
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
console.log(JSON.stringify(result, null, 2))

console.log('\n=== isMicroMastered ===')
console.log(isMicroMastered(profile, micro as any))
