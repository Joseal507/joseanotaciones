import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import {
  isCanonicalQuizWrittenAnswerCorrect,
  mapEnjoyerQuizResponseQuestions,
} from '../../lib/quiz/enjoyerProgressiveUi'
import {
  canonicalizeGeneratedFillBlankPrompt,
  canonicalizeLegacyFillBlankPrompt,
  canonicalizePersistedFillBlankQuestion,
} from '../../lib/quiz/fillBlankContract'
import {
  buildEnjoyerAssessmentUniverse,
  startEnjoyerQuizGeneration,
  type EnjoyerAssessmentDesign,
  type EnjoyerQuizArtifact,
  type EnjoyerQuizGenerationManifest,
  type EnjoyerQuizStore,
} from '../../lib/materialBrain/quiz/enjoyer'
import { responseForArtifact } from '../../app/api/alai-studyal-quizzes/route'

const selection = buildSourceSelectionSnapshot(['material-a'], { 'material-a': [1] })
const payload = { blueprint: { sourceSelectionFingerprint: selection.fingerprint,
  topicsIndex: [{ id: 'topic-1', title: 'Equilibrio', order: 1 }],
  globalOrderedAnalysis: [{ id: 'source-1', kind: 'concept', label: 'Equilibrio dinámico',
    summary: 'La reacción directa y la reacción inversa ocurren a la misma velocidad', importance: 90,
    difficulty: 'intermediate', materialId: 'material-a', pages: [1], topicId: 'topic-1', globalOrder: 0,
    sourceSpans: [{ page: 1, quote: 'La reacción directa y la reacción inversa ocurren a la misma velocidad' }] }],
  uniqueConceptsIndex: [] } }
const universe = buildEnjoyerAssessmentUniverse(payload, selection)
const design: EnjoyerAssessmentDesign = { fingerprint: selection.fingerprint,
  idealQuestionCountForFullCoverage: 1, rationale: 'fixture',
  targetGroups: [{ id: 'group-1', targetIds: [universe.targets[0].id], rationale: 'fixture' }] }

class MemoryStore implements EnjoyerQuizStore {
  private artifacts = new Map<string, EnjoyerQuizArtifact>()
  private manifests = new Map<string, EnjoyerQuizGenerationManifest>()
  async get(id: string) { return this.artifacts.get(id) || null }
  async save(id: string, artifact: EnjoyerQuizArtifact) { this.artifacts.set(id, structuredClone(artifact)) }
  async getManifest(id: string) { return this.manifests.get(id) || null }
  async saveManifest(id: string, manifest: EnjoyerQuizGenerationManifest) { this.manifests.set(id, structuredClone(manifest)) }
  artifact(id: string) { return this.artifacts.get(id) }
}

async function main() {
  // New questions are blanked by literal slicing of the separate canonical answer.
  assert.equal(canonicalizeGeneratedFillBlankPrompt(
    'La ley de velocidad es Velocidad = kf[N2O4].', '[N2O4]'),
  'La ley de velocidad es Velocidad = kf _____.')
  assert.equal(canonicalizeGeneratedFillBlankPrompt(
    'Se aplica a condiciones iniciales o [instantáneas].', 'instantáneas'),
  'Se aplica a condiciones iniciales o _____.')
  assert.equal(canonicalizeGeneratedFillBlankPrompt('Kc aparece al principio.', 'Kc'), '_____ aparece al principio.')
  assert.equal(canonicalizeGeneratedFillBlankPrompt('La relación usa Kp y Δn.', 'Kp'), 'La relación usa _____ y Δn.')
  assert.equal(canonicalizeGeneratedFillBlankPrompt('El símbolo final es Δn', 'Δn'), 'El símbolo final es _____')
  assert.equal(canonicalizeGeneratedFillBlankPrompt('La concentración es [NO2]².', '[NO2]²'), 'La concentración es _____.')

  // Compatibility is specific to historical fill-blank placeholder shapes.
  assert.equal(canonicalizeLegacyFillBlankPrompt('Ocurren a la misma$1 ___.'), 'Ocurren a la misma _____.')
  assert.equal(canonicalizeLegacyFillBlankPrompt('Completa [BLANK] ahora'), 'Completa _____ ahora')
  assert.equal(
    canonicalizeLegacyFillBlankPrompt('El ** _____ ** es un proceso bidireccional.'),
    'El _____ es un proceso bidireccional.',
  )
  assert.equal(
    canonicalizeLegacyFillBlankPrompt('Un maestro de **_____** antes de proceder.'),
    'Un maestro de _____ antes de proceder.',
  )
  assert.equal(canonicalizeLegacyFillBlankPrompt('Dos ___ espacios ___'), null)
  assert.deepEqual(canonicalizePersistedFillBlankQuestion({ type: 'fill_blank', prompt: 'Velocidad = kf$1 ____.' }),
    { type: 'fill_blank', prompt: 'Velocidad = kf _____.' })
  for (const type of ['multiple_choice', 'multi_select', 'true_false', 'matching', 'short_answer']) {
    const question = { type, question: 'Precio legítimo $1 ____.' }
    assert.equal(canonicalizePersistedFillBlankQuestion(question), question)
  }

  const store = new MemoryStore()
  let providerCalls = 0
  const generated = await startEnjoyerQuizGeneration({ payload, selection, sessionId: 'fill-session',
    config: { questionCount: 1, difficulty: 'medium', questionTypes: ['fill_blank'] }, design,
    generationId: 'fill-generation', store, provider: async request => {
      providerCalls++
      assert.deepEqual(request.requiredSlots, [{ slot: 1, type: 'fill_blank' }])
      return { questions: [{ type: 'fill_blank',
        question: 'La velocidad de formación de productos es igual a la velocidad de formación de$1 ___.',
        explanation: 'Ambas velocidades son iguales.', assessmentTargetIds: [universe.targets[0].id],
        answer: 'velocidad', wordBank: ['velocidad', 'presión', 'temperatura', 'masa'] }] }
    } })
  assert.equal(providerCalls, 1)
  assert.equal(generated.status, 'ready')
  const fill = generated.artifact.questions[0]
  assert.equal(fill.type, 'fill_blank')
  assert.equal(fill.question.includes('$1'), false)
  assert.equal((fill.question.match(/_____/g) || []).length, 1)
  assert.equal((fill as any).answer, 'velocidad')
  assert.equal((fill as any).wordBank.length, 4)
  assert.ok((fill as any).wordBank.includes('velocidad'))
  assert.equal(isCanonicalQuizWrittenAnswerCorrect([(fill as any).answer], 'velocidad'), true)
  assert.equal(isCanonicalQuizWrittenAnswerCorrect([(fill as any).answer], 'presión'), false)

  const restored = await startEnjoyerQuizGeneration({ payload, selection, sessionId: 'fill-session',
    config: generated.artifact.config, design, generationId: 'fill-generation', store,
    provider: async () => { throw new Error('restore must not call provider') } })
  assert.equal(restored.cacheStatus, 'hit')
  assert.deepEqual(restored.artifact.questions[0], fill)

  // Exercise the real route DTO and the exact mapper used before setQuestions/currentQuestion.
  const response = responseForArtifact(restored.artifact, 'hit', restored.manifest)
  const dto = await response.json()
  const uiQuestions = mapEnjoyerQuizResponseQuestions(dto.quiz)
  assert.equal(uiQuestions[0].question,
    'La velocidad de formación de productos es igual a la velocidad de formación de _____.')
  assert.equal(uiQuestions[0].question.includes('$1'), false)
  assert.equal((uiQuestions[0].question.match(/_____/g) || []).length, 1)
  assert.ok(Array.isArray(uiQuestions[0].wordBank) && uiQuestions[0].wordBank.length >= 4)
  assert.equal(store.artifact(restored.manifest.identity)?.questions[0].question.includes('$1'), false,
    'the persisted artifact must be canonical')

  // A complete 3/3 artifact with full target coverage has no terminal repair calls.
  let completeProviderCalls = 0
  const complete = await startEnjoyerQuizGeneration({ payload, selection, sessionId: 'fill-complete-session',
    config: { questionCount: 3, difficulty: 'medium', questionTypes: ['fill_blank'] }, design,
    generationId: 'fill-complete-generation', store: new MemoryStore(), provider: async request => {
      completeProviderCalls++
      assert.equal(request.mode, 'generate')
      return { questions: ['velocidad', 'reacción', 'inversa'].map((answer, index) => ({ type: 'fill_blank',
        question: `Recuerdo ${index + 1}: ${answer}.`, explanation: 'Contenido cubierto por la fuente.',
        assessmentTargetIds: [universe.targets[0].id], answer,
        wordBank: [answer, 'directa', 'productos', 'equilibrio'].filter((value, position, values) => values.indexOf(value) === position) })) }
    } })
  assert.equal(complete.artifact.questions.length, 3)
  assert.equal(completeProviderCalls, 1, 'full slots plus full coverage must not trigger terminal repair')

  const ui = readFileSync('components/materias/ALAIStudyALQuizzes.tsx', 'utf8')
  assert.ok(ui.includes('question.wordBank.map') && ui.includes('setUserAnswer(w)'),
    'the mature word-bank renderer selects its canonical string payload')
  assert.ok(ui.includes("question.type === 'fill_blank'") && ui.includes('scoreWrittenLocal'),
    'fill blank uses deterministic local written grading before remote evaluation')
  assert.ok(ui.includes('mapEnjoyerQuizResponseQuestions'),
    'all API/restore questions pass through the production UI mapper')

  console.log('enjoyer-quiz-fill-blank-contracts: PASS')
}

main().catch(error => { console.error(error); process.exit(1) })
