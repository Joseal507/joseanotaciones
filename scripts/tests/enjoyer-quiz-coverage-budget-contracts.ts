import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  buildEnjoyerAssessmentUniverse,
  enjoyerQuizCoverageRegime,
  generateEnjoyerQuizArtifact,
  validateAssessmentDesign,
  type EnjoyerQuizProvider,
} from '../../lib/materialBrain/quiz/enjoyer'

const selection = buildSourceSelectionSnapshot(['material-a'], { 'material-a': [1, 2, 3] })
const topics = [1, 2, 3].map(index => ({ id: `topic-${index}`, title: `Topic ${index}`, order: index }))
const items = Array.from({ length: 12 }, (_, index) => {
  const topic = index % 3 + 1
  return { id: `source-${index}`, kind: 'concept', label: `Target ${index}`,
    summary: `Supported answer ${index}`, importance: index % 4 ? 80 : 20, difficulty: 'intermediate',
    materialId: 'material-a', pages: [topic], topicId: `topic-${topic}`, globalOrder: index,
    sourceSpans: [{ page: topic, quote: `Supported answer ${index}` }] }
})
const payload = { blueprint: { sourceSelectionFingerprint: selection.fingerprint,
  topicsIndex: topics, globalOrderedAnalysis: items, uniqueConceptsIndex: [] } }
const universe = buildEnjoyerAssessmentUniverse(payload, selection)
const rawDesign = { fingerprint: selection.fingerprint,
  idealQuestionCountForFullCoverage: 3, rationale: 'over-compressed fixture',
  targetGroups: universe.targets.map((target, index) => ({ id: `group-${index}`,
    targetIds: [target.id], rationale: 'one coherent assessment unit' })) }
const design = validateAssessmentDesign(rawDesign, universe)

function question(serial: number, targetIndex: number) {
  const target = universe.targets[targetIndex]
  return { type: 'multiple_choice', question: `Question ${serial}?`, explanation: `Explanation ${serial}`,
    assessmentTargetIds: [target.id], options: [target.content, `Distractor ${serial}`], correctAnswer: 0 }
}

async function main() {
  // The provider's raw ideal cannot undercut its own complete group set.
  assert.equal(design.idealQuestionCountForFullCoverage, 12)
  assert.equal(enjoyerQuizCoverageRegime(3, design.idealQuestionCountForFullCoverage), 'compressed')
  assert.equal(enjoyerQuizCoverageRegime(12, design.idealQuestionCountForFullCoverage), 'full')
  assert.equal(enjoyerQuizCoverageRegime(13, design.idealQuestionCountForFullCoverage), 'full')

  // Three balanced questions over a large universe remain honest and do not repair solely for uncovered IDs.
  let compressedCalls = 0
  const compressed = await generateEnjoyerQuizArtifact({ payload, selection, sessionId: 'compressed',
    config: { questionCount: 3, difficulty: 'medium', questionTypes: ['multiple_choice'] },
    design: rawDesign, generationId: 'compressed', provider: async request => {
      compressedCalls++
      assert.equal(request.mode, 'generate')
      return { questions: [question(1, 0), question(2, 1), question(3, 2)] }
    } })
  assert.equal(compressed.questions.length, 3)
  assert.equal(compressed.coverage.coverageStatus, 'partial')
  assert.equal(compressed.coverage.coveragePercent, 25)
  assert.equal(compressed.meta.coverageRepairAttempts, 0)
  assert.equal(compressedCalls, 1)

  async function assertFullRepair(requested: number) {
    let serial = 0; let replacementCalls = 0
    const provider: EnjoyerQuizProvider = async request => {
      if (request.mode === 'repair') {
        replacementCalls++
        const missing = universe.targets.findIndex(target => target.id === request.focusTargetIds?.[0])
        return { questions: [question(1000 + replacementCalls, missing)] }
      }
      return { questions: Array.from({ length: request.missingSlots || 0 }, () => {
        const current = serial++
        return question(100 + current, current % 11)
      }) }
    }
    const artifact = await generateEnjoyerQuizArtifact({ payload, selection, sessionId: `full-${requested}`,
      config: { questionCount: requested, difficulty: 'medium', questionTypes: ['multiple_choice'] },
      design, generationId: `full-${requested}`, provider })
    assert.equal(artifact.questions.length, requested)
    assert.ok(replacementCalls > 0)
    assert.equal(artifact.coverage.coverageStatus, 'complete')
  }

  await assertFullRepair(12)
  await assertFullRepair(13)
  console.log('enjoyer-quiz-coverage-budget-contracts: PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
