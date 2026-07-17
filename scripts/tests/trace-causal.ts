import { emptyEvidenceProfile, recordEvidence, isMicroMastered } from '../../lib/adaptive/v3/engine/evidenceEngine'
import { checkMasteryContract } from '../../lib/adaptive/v3/engine/masteryContracts'

let profile = emptyEvidenceProfile('m2')

// 1: MCQ recognized
profile = recordEvidence(profile, { formatUsed: 'multiple_choice', outcome: 'correct', score: 90, turnNumber: 1, assistanceLevel: 'independent', interactionContext: 'immediate_practice' })
// 2: explain_why explained
profile = recordEvidence(profile, { formatUsed: 'explain_why', outcome: 'correct', score: 85, turnNumber: 2, assistanceLevel: 'independent', interactionContext: 'immediate_practice' })
// 3: MCQ correct
profile = recordEvidence(profile, { formatUsed: 'multiple_choice', outcome: 'correct', score: 90, turnNumber: 3, assistanceLevel: 'independent', interactionContext: 'immediate_practice' })

const micro = { id: 'm2', cognitiveType: 'causal' as const, difficulty: 50, importance: 'medium' as const, related: ['m1'], formulas: [], procedures: [], examples: [], commonErrors: [], prerequisites: [], enables: [], name: 'Test Causal', shortDescription: '', fullDefinition: '', sourceQuotes: [], sourceChunkIds: [], sourcePages: [], topicGroup: '', extractedAt: Date.now(), estimatedMinutes: 5 }

const result = checkMasteryContract('causal', { strongCount: profile.strongCount, mediumCount: profile.mediumCount, masteryScore: profile.masteryScore, totalEvidences: profile.totalEvidences }, { independentSuccesses: profile.independentSuccesses, hasDelayedRecall: profile.hasDelayedRecall, hasTransfer: profile.hasTransfer, hasIntegration: profile.hasIntegration, maxAssistanceLevelUsed: profile.maxAssistanceLevelUsed })

console.log('fulfilled:', result.fulfilled)
console.log('provisionallyFulfilled:', result.provisionallyFulfilled)
console.log('retainedFulfilled:', result.retainedFulfilled)
console.log('blockingReason:', result.blockingReason)
console.log('missingRequired:', result.missingRequired)
console.log('isMicroMastered:', isMicroMastered(profile, micro as any))
