import assert from 'node:assert/strict'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import { generateEnjoyerQuizArtifact, type EnjoyerQuizProvider } from '../../lib/materialBrain/quiz/enjoyer'

const selection = buildSourceSelectionSnapshot(['material-a'], { 'material-a': [1, 2, 3] })
const topics = [0, 1, 2].map(index => ({ id: `topic-${index}`, title: `Topic ${index}`, order: index }))
const items = Array.from({ length: 51 }, (_, index) => ({
  id: `source-${index}`, kind: 'concept', label: `Target ${index}`, summary: `Supported answer ${index}`,
  importance: index % 5 ? 80 : 20, difficulty: 'intermediate', materialId: 'material-a',
  pages: [index % 3 + 1], topicId: `topic-${index % 3}`, globalOrder: index,
  sourceSpans: [{ page: index % 3 + 1, quote: `Supported answer ${index}` }],
}))
const payload = { blueprint: { sourceSelectionFingerprint: selection.fingerprint,
  topicsIndex: topics, globalOrderedAnalysis: items, uniqueConceptsIndex: [] } }

// Twenty-five coherent groups cover the full 51-target universe. This is the
// frozen budget contract used by terminal coverage semantics, not a page rule.
const design = {
  fingerprint: selection.fingerprint,
  idealQuestionCountForFullCoverage: 25,
  rationale: 'fixture full-coverage budget',
  targetGroups: Array.from({ length: 25 }, (_, index) => ({
    id: `group-${index}`,
    targetIds: [index, index + 25, ...(index === 0 ? [50] : [])].map(target => `assessment:source-${target}`),
    rationale: 'coherent grouped targets',
  })),
}

function question(serial: number, targetIndex: number, stem = `Question ${serial}?`) {
  return {
    type: 'multiple_choice', question: stem, explanation: `Explanation ${serial}`,
    assessmentTargetIds: [`assessment:source-${targetIndex}`],
    options: [`Supported answer ${targetIndex}`, `Distractor ${serial}`], correctAnswer: 0,
  }
}

async function main() {
  // Healthy compressed output: exact budget, all topics represented, honest
  // partial identity coverage, and no terminal replacement provider call.
  let healthyCalls = 0
  const healthy = await generateEnjoyerQuizArtifact({ payload, selection, sessionId: 'compressed-healthy',
    config: { questionCount: 3, difficulty: 'medium', questionTypes: ['multiple_choice'] }, design,
    generationId: 'compressed-healthy', provider: async request => {
      healthyCalls++
      assert.equal(request.mode, 'generate')
      return { questions: [question(1, 0), question(2, 1), question(3, 2)] }
    } })
  assert.equal(healthyCalls, 1)
  assert.equal(healthy.questions.length, 3)
  assert.equal(healthy.coverage.idealQuestionCountForFullCoverage, 25)
  assert.equal(healthy.coverage.coverageStatus, 'partial')
  assert.equal(healthy.coverage.coveragePercent, Math.round(3 / 51 * 10_000) / 100)
  assert.ok(healthy.coverage.topicCoverage.every(topic => topic.covered === 1))
  assert.equal(healthy.meta.coverageRepairAttempts, 0)
  assert.equal(healthy.meta.questionsReplacedForCoverage, 0)

  // A genuinely invalid compressed batch still repairs at the structural
  // missing-slot stage. Duplicate candidates cannot become playable merely
  // because terminal topic replacement is disabled for compressed quizzes.
  let structuralCalls = 0
  const structuralProvider: EnjoyerQuizProvider = async request => {
    structuralCalls++
    if (request.mode === 'generate') return { questions: [
      question(10, 0, 'Duplicate question?'),
      question(11, 1, 'Duplicate question?'),
      question(12, 2, 'Duplicate question?'),
    ] }
    assert.equal(request.mode, 'repair')
    assert.equal(request.missingSlots, 2)
    return { questions: [question(13, 1), question(14, 2)] }
  }
  const repaired = await generateEnjoyerQuizArtifact({ payload, selection, sessionId: 'compressed-structural',
    config: { questionCount: 3, difficulty: 'medium', questionTypes: ['multiple_choice'] }, design,
    generationId: 'compressed-structural', provider: structuralProvider })
  assert.equal(structuralCalls, 2, 'one generate plus one structural repair; no terminal replacement')
  assert.equal(repaired.questions.length, 3)
  assert.equal(repaired.meta.repairAttempts, 1)
  assert.equal(repaired.meta.coverageRepairAttempts, 0)
  assert.equal(repaired.meta.questionsReplacedForCoverage, 0)
  assert.equal(new Set(repaired.questions.map(value => value.question)).size, 3)

  console.log('enjoyer-quiz-compressed-terminal-repair-contracts: PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
