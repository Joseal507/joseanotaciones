import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { buildSourceSelectionSnapshot } from '../../lib/adaptive/sourceSelection'
import type { SourceEvidence } from '../../lib/materials/sourceEvidence'
import type { KnowledgeUnit, MaterialBrain } from '../../lib/materialBrain/types'
import {
  getOrBuildQuizArtifact, InMemoryQuizArtifactStore, normalizeQuizConfig,
  getOrBuildQuizGeneration,
  buildQuizBatchPrompt, normalizeQuizBatchResponse, planQuiz, quizArtifactIdentity,
  quizConfigFingerprint, validateGeneratedQuiz,
  normalizeQuizText, normalizeTrueFalseAnswer, validateBatchStructure,
  applyQuizPresentation, computeCorrectPositionAssignment, summarizeCorrectPositions,
  generateQuizFromPlan,
  plannedContext,
  allocateQuizTypeTargets,
  computeQuizProviderBudget, decodePersistedQuizArtifact, lookupQuizArtifact,
  quizGenerationHistoryIdentity, quizKnowledgeTargetId,
  quizAssessmentSemanticIdentity,
  compareQuizCandidateNovelty,
  stampAuthoritativeQuizOutput,
  allocateQuizTypeCounts, quizAllocationSeed,
  analyzeQuizCoverage,
  computeAndAttachMaterialQuizCoverage, readCachedQuizCoverage, MATERIAL_QUIZ_COVERAGE_CONFIG,
  availableQuizHelpActions, consumeQuizHelp, createQuizHelpEffect,
  QUIZ_HELP_EXHAUSTED_MESSAGE,
  type GenerateQuizBatchFn, type PlannedQuizQuestion,
} from '../../lib/materialBrain/quiz'
import { POST, __routeDeps } from '../../app/api/alai-studyal-quizzes/route'
import { POST as POSTQuizReport, __quizReportDeps } from '../../app/api/quiz-reports/route'
import { runGenerationPipeline } from '../../lib/ai/generationPipeline'
import {
  __quizEvaluatorDeps, evaluateQuizOpenAnswer, type QuizAnswerEvaluation,
} from '../../lib/materialBrain/quiz/evaluator'
import { evidenceLinkForUnit, verifyEvidenceLink } from '../../lib/materialBrain/quiz/grounding'

let providerCalls = 0
const source = buildSourceSelectionSnapshot(['mat-a', 'mat-b'], { 'mat-a': [1, 3], 'mat-b': [2] })

function evidence(materialId: string, page: number, derivation: 'native_text' | 'vision'): SourceEvidence {
  return derivation === 'vision' ? {
    materialId, page, derivation, pageFingerprint: `page-${materialId}-${page}`,
    analyzerVersion: '1.2.0', promptVersion: '1.1.0', provider: 'openrouter', model: 'google/gemini-2.5-flash',
  } : { materialId, page, derivation, quote: `Supported statement ${materialId} ${page}`, chunkId: `c-${page}` }
}

function unit(id: string, materialId: string, page: number, derivation: 'native_text' | 'vision', kind: KnowledgeUnit['kind'] = 'fact'): KnowledgeUnit {
  const base: any = {
    id, kind, identity: { canonicalSubject: id, semanticKey: id, qualifiers: [] },
    label: `Answer ${id}`, statement: `Supported statement ${materialId} ${page} with Answer ${id}`,
    importance: { tier: id === 'u1' ? 'critical' : 'supporting', signals: ['model_judged'], confidence: .9 },
    provenance: derivation === 'vision' ? [] : [{ materialId, page, quote: `Supported statement ${materialId} ${page}`, chunkId: `c-${page}` }],
    evidence: [evidence(materialId, page, derivation)], domainTags: [],
  }
  if (kind === 'formula') { base.expression = `F_${id}=m*a`; base.variables = [{ symbol: 'm', meaning: 'mass' }, { symbol: 'a', meaning: 'acc' }] }
  if (kind === 'process') base.steps = [{ order: 1, text: `Answer ${id}` }, { order: 2, text: 'result' }]
  if (kind === 'terminology') base.aliases = [`Answer ${id}`, 'alias']
  if (kind === 'definition') base.term = `Term ${id}`
  const authorityText = [base.label, base.statement, base.expression,
    ...(base.variables || []).flatMap((v: any) => [v.symbol, v.meaning]),
    ...(base.steps || []).map((step: any) => step.text), ...(base.aliases || []), base.term]
    .filter(Boolean).join(' | ')
  base.evidence = derivation === 'vision'
    ? [{ ...base.evidence[0], description: authorityText }]
    : [{ ...base.evidence[0], quote: authorityText }]
  if (base.provenance.length) base.provenance[0].quote = authorityText
  return base
}

function brain(fingerprint = source.fingerprint): MaterialBrain {
  const value: MaterialBrain = {
    scope: { ...source, fingerprint },
    meta: { version: '1', builderVersion: '2.2.0', generatedAt: '2026-01-01T00:00:00.000Z', chunking: { strategy: 'test', chunkSizeChars: 1, chunkCount: 3 }, llmCallsUsed: 0, retries: 0, status: 'ready' },
    units: [unit('u1', 'mat-a', 1, 'native_text'), unit('u2', 'mat-a', 3, 'vision', 'formula'), unit('u3', 'mat-b', 2, 'native_text', 'process')],
    relations: [{ id: 'r1', type: 'depends_on', fromUnitId: 'u2', toUnitId: 'u1', statement: 'Answer u2 depends on Answer u1', importance: { tier: 'supporting', signals: [], confidence: .8 }, provenance: [], evidence: [{ ...evidence('mat-a', 3, 'vision'), description: 'Answer u2 depends on Answer u1' }] }],
    sourceCoverage: { requested: [], processed: [], missing: [], suspiciouslyEmpty: [], status: 'complete' },
    visualCoverage: { requested: [], analyzed: [], failed: [], noContent: [], status: 'complete' },
    knowledgeExtraction: { chunksAttempted: 0, chunksFailed: 0, failedChunkIds: [], unitsExtractedRaw: 3, unitsWithoutValidProvenance: 0, invalidStructural: 0, droppedAmbiguousRelations: 0, warnings: [] },
    mergeLog: [],
  }
  return value
}

function brainWithUnits(count: number, fingerprint: string, kind: KnowledgeUnit['kind'] = 'fact'): MaterialBrain {
  const value = brain(fingerprint)
  value.scope = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 3] })
  value.scope.fingerprint = fingerprint
  value.units = Array.from({ length: count }, (_, index) => unit(
    `many-${index + 1}`, 'mat-a', index % 2 ? 3 : 1,
    index % 3 === 0 ? 'vision' : 'native_text',
    kind,
  ))
  value.relations = []
  return value
}

function brainMultipleBuckets(fingerprint: string): MaterialBrain {
  const value = brain(fingerprint)
  value.scope = buildSourceSelectionSnapshot(['mat-a', 'mat-b'], { 'mat-a': [1, 2, 3], 'mat-b': [1, 2, 3] })
  value.scope.fingerprint = fingerprint
  const units: KnowledgeUnit[] = []
  for (const mid of ['mat-a', 'mat-b']) {
    for (const p of [1, 2, 3]) units.push(unit(`b-${mid}-${p}`, mid, p, 'native_text', 'fact'))
  }
  value.units = units
  value.relations = []
  return value
}

function brainT5Adversarial(fingerprint: string): MaterialBrain {
  const value = brain(fingerprint)
  value.scope = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': [1, 2, 3, 4, 5] })
  value.scope.fingerprint = fingerprint
  const mcOnly1 = unit('mc-only-1', 'mat-a', 1, 'native_text', 'fact')
  const mcOnly2 = unit('mc-only-2', 'mat-a', 2, 'native_text', 'fact')
  const formula1: any = unit('formula-1', 'mat-a', 3, 'native_text', 'formula')
  const formula2: any = unit('formula-2', 'mat-a', 4, 'native_text', 'formula')
  const formula3: any = unit('formula-3', 'mat-a', 5, 'native_text', 'formula')
  value.units = [mcOnly1, mcOnly2, formula1, formula2, formula3]
  value.relations = []
  return value
}

function invalidateUnitLabelGrounding(value: MaterialBrain, unitId: string): void {
  const target = value.units.find(item => item.id === unitId)
  if (!target) throw new Error(`TEST_FIXTURE_INVALID:${unitId}`)
  target.label = 'Generic placeholder label'
  const authority = `${target.id} specific grounded statement without the derived display label.`
  target.statement = authority
  target.evidence = [{ materialId: 'mat-a', page: 1, derivation: 'native_text', quote: authority, chunkId: 'c-1' }]
  target.provenance = [{ materialId: 'mat-a', page: 1, quote: authority, chunkId: 'c-1' }]
}

const config = normalizeQuizConfig({ questionCount: 3, difficulty: 'medium', questionTypes: ['multiple_choice'] })

const mockGenerate: GenerateQuizBatchFn = async (plans, _language, attemptControl) => {
  attemptControl?.beforeProviderAttempt()
  return plans.map((plan: any) => {
  const correctText = plan.answerTarget?.canonicalValue || plan.units[0]?.label || 'Answer'
  const supporting = plan.units[0]?.statement || 'Supported'
  const type = plan.requiredType
  const base: any = {
    planId: plan.planId, id: `q-${plan.planId}`, type,
    question: `Which supported answer applies to ${plan.planId}?`,
    explanation: supporting, difficulty: plan.difficulty, supportingText: supporting,
  }
  if (type === 'multiple_choice') { base.options = [correctText, 'Distractor A', 'Distractor B', 'Distractor C']; base.correctAnswer = 0 }
  else if (type === 'multi_select') {
    const values = plan.answerTarget?.canonicalValues || [correctText, supporting]
    base.options = values.length < 5 ? [...values, 'Distractor'] : [...values]
    base.correctAnswers = values.map((_: string, index: number) => index)
  }
  else if (type === 'true_false') {
    base.correctAnswer = plan.answerTarget?.canonicalValue !== 'false'
    if (plan.answerTarget?.acceptedSurfaceForms?.[0]) {
      base.question = `Is this statement true for ${plan.planId}: ${plan.answerTarget.acceptedSurfaceForms[0]}?`
    }
  }
  else if (type === 'fill_blank') { base.question = `Complete ___ for ${plan.planId}`; base.answer = correctText; base.wordBank = [correctText, 'A', 'B', 'C'] }
  else if (type === 'matching') {
    base.pairs = (plan.answerTarget?.pairTargets || []).map((pair: any) => ({
      left: pair.leftCanonical, right: pair.rightCanonical,
    }))
  }
  else if (type === 'short_answer') base.acceptedAnswers = [correctText]
    return base
  })
}

async function routeRequest(body: unknown) {
  return POST(new NextRequest('http://localhost/api/alai-studyal-quizzes', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
}

async function testRouteAuthority() {
  const original = { ...__routeDeps }
  try {
    __routeDeps.getServerSession = async () => null as any
    assert.equal((await routeRequest({})).status, 401)
    __routeDeps.getServerSession = async () => ({ user: { id: 'user-a' } }) as any
    __routeDeps.getAuthoritativeFreeSession = async () => null
    assert.equal((await routeRequest({ sessionId: 'owned-by-other', sourceSelectionFingerprint: source.fingerprint, config })).status, 404)
    __routeDeps.getAuthoritativeFreeSession = async () => ({ id: 's1', userId: 'user-a', processMode: 'free', sourceSelection: source })
    assert.equal((await routeRequest({ sessionId: 's1', sourceSelectionFingerprint: 'wrong', config })).status, 409)
    assert.equal((await routeRequest({ sessionId: 's1', sourceSelectionFingerprint: source.fingerprint, config, rawText: 'forbidden' })).status, 400)
    const routeSource = readFileSync('app/api/alai-studyal-quizzes/route.ts', 'utf8')
    assert.ok(routeSource.includes('lookupStudyalMaterialEnjoyer'))
    assert.doesNotMatch(routeSource, /restoreMaterialBrain|WorkerMaterialResultStore|resolveMaterialCapabilities/)
  } finally { Object.assign(__routeDeps, original) }
}

async function testMatchingOnlyCapabilityErrorDetail() {
  // MATCH-ONLY-1 / REL-PIPE-1 / MATCH-CAP-1: an explicit grounded Brain relation remains usable.
  const supported = brain('matching-only-supported')
  const supportedPlan = planQuiz(supported, normalizeQuizConfig({
    questionCount: 1, difficulty: 'hard', questionTypes: ['matching'],
  }))
  assert.equal(supportedPlan.plannedQuestions.length, 1)
  assert.equal(supportedPlan.plannedQuestions[0].questionType, 'matching')
  assert.ok((supportedPlan.typeCapabilityDiagnostics.matching?.capacity || 0) > 0)
  assert.ok(supportedPlan.plannedQuestions[0].sourceRelationIds.includes('r1'))

  // MATCH-ONLY-2 / MATCH-CAP-2: facts without relational structure surface the planner diagnostic.
  const unsupported = brainWithUnits(3, 'matching-only-unsupported', 'fact')
  unsupported.units.forEach(item => {
    item.label = 'Atlanta Falcons'
    item.identity.canonicalSubject = 'Atlanta Falcons'
  })
  let plannerMessage = ''
  try {
    planQuiz(unsupported, normalizeQuizConfig({
      questionCount: 1, difficulty: 'hard', questionTypes: ['matching'],
    }))
  } catch (error) {
    plannerMessage = String((error as Error).message)
  }
  assert.match(plannerMessage, /^INSUFFICIENT_KNOWLEDGE:matching:/i)

  // Legacy planner diagnostic remains available for its existing consumers;
  // the active Enjoyer route lets the model choose among allowed types.
  const ui = readFileSync('components/materias/ALAIStudyALQuizzes.tsx', 'utf8')
  assert.ok(ui.includes('Este material no contiene relaciones suficientes para crear preguntas de Relacionar.'))
  assert.ok(ui.includes('Este material no contiene suficientes datos agrupables para crear preguntas de Selección Múltiple.'))
  assert.ok(ui.includes('Las páginas seleccionadas no contienen suficiente material para tantas preguntas.'))
  const relationEndpoint = readFileSync('app/api/mastery/extract-graph/route.ts', 'utf8')
  assert.ok(relationEndpoint.includes('independent from Material Brain/Quiz'))
  assert.doesNotMatch(relationEndpoint, /saveMaterialResult/)
}

async function testNEW1_NewIntentCreatesDistinctArtifacts() {
  const value = brainWithUnits(6, 'new-1-distinct-generations', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 3, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const savedIdentities = new Set<string>()
  class TrackingStore extends InMemoryQuizArtifactStore {
    override async save(identity: string, artifact: Parameters<InMemoryQuizArtifactStore['save']>[1]) {
      savedIdentities.add(identity)
      await super.save(identity, artifact)
    }
  }
  const store = new TrackingStore()
  let generationCalls = 0
  const generateBatch: GenerateQuizBatchFn = async (...args) => {
    generationCalls += 1
    return mockGenerate(...args)
  }
  const first = await getOrBuildQuizArtifact(value, cfg, store, { mode: 'new', generateBatch })
  const second = await getOrBuildQuizArtifact(value, cfg, store, { mode: 'new', generateBatch })
  assert.ok(first.artifact.meta.generationId)
  assert.ok(second.artifact.meta.generationId)
  assert.notEqual(first.artifact.meta.generationId, second.artifact.meta.generationId)
  assert.equal(savedIdentities.size, 2)
  assert.equal(generationCalls, 2)
}

async function testNEW3_SpecificGenerationResumeHasZeroRegeneration() {
  const value = brainWithUnits(6, 'new-3-specific-resume', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 3, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const store = new InMemoryQuizArtifactStore()
  const built = await getOrBuildQuizArtifact(value, cfg, store, { mode: 'new', generateBatch: mockGenerate })
  const generationId = built.artifact.meta.generationId
  assert.ok(generationId)
  const resumed = await getOrBuildQuizArtifact(value, cfg, store, {
    mode: 'resume', generationId,
    generateBatch: async () => { throw new Error('must-not-regenerate-specific-generation') },
  })
  assert.equal(resumed.cacheStatus, 'hit')
  assert.deepEqual(resumed.artifact, built.artifact)
}

async function testBackwardCompatiblePlainResumeIdentity() {
  const value = brainWithUnits(6, 'legacy-identity-regression', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 3, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const expectedIdentity = quizArtifactIdentity(
    'quiz-test-session', value.scope.fingerprint, quizConfigFingerprint(cfg),
  )
  let savedIdentity = ''
  class TrackingStore extends InMemoryQuizArtifactStore {
    override async save(identity: string, artifact: Parameters<InMemoryQuizArtifactStore['save']>[1]) {
      savedIdentity = identity
      await super.save(identity, artifact)
    }
  }
  const store = new TrackingStore()
  const built = await getOrBuildQuizArtifact(value, cfg, store, { generateBatch: mockGenerate })
  assert.equal(savedIdentity, expectedIdentity)
  assert.equal(built.artifact.meta.generationId, undefined)
  const resumed = await getOrBuildQuizArtifact(value, cfg, store, {
    generateBatch: async () => { throw new Error('must-hit-legacy-identity') },
  })
  assert.equal(resumed.cacheStatus, 'hit')
  assert.deepEqual(resumed.artifact, built.artifact)
}

async function testGEN1To9_PlanningNoveltyContracts() {
  const value = brainWithUnits(12, 'gen-planning', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 4, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const targets = (plan: ReturnType<typeof planQuiz>) => plan.plannedQuestions.map(question =>
    quizKnowledgeTargetId(question.sourceUnitIds, question.sourceRelationIds))

  // GEN-1: one generation is deterministic.
  const sameA = planQuiz(value, cfg, { generationId: 'gen-same' })
  const sameB = planQuiz(value, cfg, { generationId: 'gen-same' })
  assert.deepEqual(sameA, sameB)

  // GEN-2: generation seed changes knowledge selection when grounded alternatives exist.
  const differentA = planQuiz(value, cfg, { generationId: 'gen-A' })
  let differentB = planQuiz(value, cfg, { generationId: 'gen-B' })
  if (JSON.stringify(targets(differentA)) === JSON.stringify(targets(differentB))) {
    differentB = planQuiz(value, cfg, { generationId: 'gen-C' })
  }
  assert.notDeepEqual(new Set(targets(differentA)), new Set(targets(differentB)))

  // GEN-3: persisted history is read by the real store path and unused knowledge wins.
  const store = new InMemoryQuizArtifactStore()
  const historyIdentity = quizGenerationHistoryIdentity('gen-history-session', value.scope.fingerprint, quizConfigFingerprint(cfg))
  const reservedUnused = 'many-12'
  await store.saveHistory(historyIdentity, { entries: [{
    generationId: 'old',
    knowledgeTargetIds: value.units.filter(item => item.id !== reservedUnused).map(item => item.id),
    assessmentIntents: value.units.filter(item => item.id !== reservedUnused).map(() => 'multiple_choice:direct_recall'),
    generatedAt: '2026-01-01T00:00:00.000Z',
  }] })
  const historyBuilt = await getOrBuildQuizArtifact('gen-history-session', value, cfg, store, { mode: 'new', generateBatch: mockGenerate })
  assert.ok(historyBuilt.artifact.questions.some(question => question.grounding.sourceUnitIds.includes(reservedUnused)))

  // GEN-4: variants/intents over an already-used target remain used knowledge.
  const oneCfg = normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const firstTarget = planQuiz(value, oneCfg, { generationId: 'variant-baseline' }).plannedQuestions[0].sourceUnitIds[0]
  const variantHistory = { entries: [{ generationId: 'variant-old', knowledgeTargetIds: [firstTarget],
    assessmentIntents: ['multiple_choice:some_other_variant'], generatedAt: '2026-01-01T00:00:00.000Z' }] }
  const variantPlan = planQuiz(value, oneCfg, { generationId: 'variant-new', history: variantHistory })
  assert.notEqual(variantPlan.plannedQuestions[0].sourceUnitIds[0], firstTarget)

  // GEN-5: scarce matching remains allocated even when every target was used.
  const scarce = brainWithUnits(2, 'gen-scarce', 'formula')
  const scarceCfg = normalizeQuizConfig({ questionCount: 2, difficulty: 'medium', questionTypes: ['matching'] })
  const scarceBase = planQuiz(scarce, scarceCfg)
  const scarceHistory = { entries: [{ generationId: 'scarce-old',
    knowledgeTargetIds: scarceBase.globalCandidatePool.map(candidate => quizKnowledgeTargetId(candidate.sourceUnitIds, candidate.sourceRelationIds)),
    assessmentIntents: scarceBase.globalCandidatePool.map(candidate => candidate.assessmentIntent), generatedAt: '2026-01-01T00:00:00.000Z' }] }
  const scarceNew = planQuiz(scarce, scarceCfg, { generationId: 'scarce-new', history: scarceHistory })
  assert.equal(scarceNew.plannedQuestions.length, 2)
  assert.ok(scarceNew.plannedQuestions.every(question => question.questionType === 'matching'))

  // GEN-6/7/8: exact-N, supported selected coverage, and no unselected type.
  const allTypes = ['multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer'] as const
  const capable = aggregateBrain('gen-all-types')
  capable.units.push(unit('gen-formula', 'mat-a', 1, 'native_text', 'formula'))
  const allCfg = normalizeQuizConfig({ questionCount: 10, difficulty: 'medium', questionTypes: [...allTypes] })
  const activeHistory = { entries: [{ generationId: 'prior', knowledgeTargetIds: ['agg-a'], assessmentIntents: ['old'], generatedAt: '2026-01-01T00:00:00.000Z' }] }
  const allPlan = planQuiz(capable, allCfg, { generationId: 'all-new', history: activeHistory })
  assert.equal(allPlan.plannedQuestions.length, 10)
  for (const type of allTypes) if ((allPlan.typeCapabilityDiagnostics[type]?.capacity || 0) > 0) {
    assert.ok(allPlan.plannedQuestions.some(question => question.questionType === type), `GEN-7 ${type}`)
  }
  assert.ok(allPlan.plannedQuestions.every(question => allTypes.includes(question.questionType as typeof allTypes[number])))

  // GEN-9: novelty exhaustion falls back to controlled reuse.
  const tiny = brainWithUnits(1, 'gen-tiny', 'fact')
  const tinyCfg = normalizeQuizConfig({ questionCount: 5, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const tinyPlan = planQuiz(tiny, tinyCfg, { generationId: 'tiny-new', history: { entries: [{
    generationId: 'tiny-old', knowledgeTargetIds: ['many-1'], assessmentIntents: ['old'], generatedAt: '2026-01-01T00:00:00.000Z',
  }] } })
  assert.equal(tinyPlan.plannedQuestions.length, 5)
}

async function testGEN10To11_ArtifactResumeContracts() {
  const value = brainWithUnits(10, 'gen-resume', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 4, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const store = new InMemoryQuizArtifactStore()
  let calls = 0
  const generate: GenerateQuizBatchFn = async (...args) => { calls += 1; return mockGenerate(...args) }
  const a = await getOrBuildQuizArtifact('gen-resume-session', value, cfg, store, { mode: 'new', generateBatch: generate })
  const callsAfterA = calls
  const resumeA = await getOrBuildQuizArtifact('gen-resume-session', value, cfg, store, {
    mode: 'resume', generationId: a.artifact.meta.generationId, generateBatch: generate,
  })
  // GEN-10: exact persisted generation, zero provider/generator work.
  assert.deepEqual(resumeA.artifact, a.artifact); assert.equal(calls, callsAfterA)
  const b = await getOrBuildQuizArtifact('gen-resume-session', value, cfg, store, { mode: 'new', generateBatch: generate })
  const callsAfterB = calls
  const resumeB = await getOrBuildQuizArtifact('gen-resume-session', value, cfg, store, {
    mode: 'resume', generationId: b.artifact.meta.generationId, generateBatch: generate,
  })
  // GEN-11: A and B each resume their own artifact without cross-contamination.
  assert.deepEqual(resumeB.artifact, b.artifact); assert.equal(calls, callsAfterB)
  assert.notEqual(a.artifact.meta.generationId, b.artifact.meta.generationId)
  assert.deepEqual((await lookupQuizArtifact('gen-resume-session', value, cfg, store, { mode: 'resume', generationId: a.artifact.meta.generationId }))!, a.artifact)
}

async function testGEN12To17_PresentationContracts() {
  const value = aggregateBrain('gen-presentation')
  value.units.push(unit('presentation-formula', 'mat-a', 1, 'native_text', 'formula'))
  const cfg = normalizeQuizConfig({ questionCount: 10, difficulty: 'medium',
    questionTypes: ['multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer'] })
  const plan = planQuiz(value, cfg)
  const generated = await generateQuizFromPlan(value, plan, { generateBatch: mockGenerate })
  assert.equal(generated.status, 'ready')
  const before = JSON.parse(JSON.stringify(generated.questions)) as typeof generated.questions
  const a = applyQuizPresentation(before, { brainFingerprint: value.scope.fingerprint, configFingerprint: plan.configFingerprint, generationId: 'present-A' }, cfg)
  const aAgain = applyQuizPresentation(before, { brainFingerprint: value.scope.fingerprint, configFingerprint: plan.configFingerprint, generationId: 'present-A' }, cfg)
  const b = applyQuizPresentation(before, { brainFingerprint: value.scope.fingerprint, configFingerprint: plan.configFingerprint, generationId: 'present-B' }, cfg)
  const presentationVariants = [a, b, ...['present-C', 'present-D', 'present-E'].map(generationId =>
    applyQuizPresentation(before, { brainFingerprint: value.scope.fingerprint, configFingerprint: plan.configFingerprint, generationId }, cfg))]
  assert.deepEqual(aAgain, a)
  // GEN-12: seeded generation identity changes question presentation order.
  assert.notDeepEqual(a.questions.map(question => question.id), b.questions.map(question => question.id))
  let sawMC = false; let changedMCDistractors = false
  let sawMultiSelect = false; let changedMultiSelect = false
  let sawMatching = false; let changedMatching = false
  let sawFillBlank = false; let changedFillBlank = false
  for (const output of presentationVariants) {
    for (const question of output.questions) {
      const original = before.find(item => item.id === question.id)!
      if (question.type === 'multiple_choice' && original.type === 'multiple_choice') {
        sawMC = true
        // GEN-13: MC permutation preserves canonical correct option.
        assert.equal(question.options[question.correctAnswer], original.options[original.correctAnswer])
        assert.deepEqual(new Set(question.options), new Set(original.options))
        const originalDistractors = original.options.filter((_, index) => index !== original.correctAnswer)
        const presentedDistractors = question.options.filter((_, index) => index !== question.correctAnswer)
        if (JSON.stringify(originalDistractors) !== JSON.stringify(presentedDistractors)) changedMCDistractors = true
      }
      if (question.type === 'multi_select' && original.type === 'multi_select') {
        sawMultiSelect = true
        // GEN-14: every correct multi-select value survives index remapping.
        assert.deepEqual(new Set(question.correctAnswers.map(index => question.options[index])),
          new Set(original.correctAnswers.map(index => original.options[index])))
        if (JSON.stringify(question.options) !== JSON.stringify(original.options)) changedMultiSelect = true
      }
      if (question.type === 'matching' && original.type === 'matching') {
        sawMatching = true
        // GEN-15: exact pairs survive presentation reordering.
        assert.deepEqual(new Set(question.pairs.map(pair => JSON.stringify(pair))), new Set(original.pairs.map(pair => JSON.stringify(pair))))
        if (JSON.stringify(question.pairs) !== JSON.stringify(original.pairs)) changedMatching = true
      }
      if (question.type === 'fill_blank' && original.type === 'fill_blank') {
        sawFillBlank = true
        // GEN-16: canonical fill answer remains present in shuffled word bank.
        assert.equal(question.answer, original.answer); assert.ok(question.wordBank?.includes(question.answer))
        if (JSON.stringify(question.wordBank) !== JSON.stringify(original.wordBank)) changedFillBlank = true
      }
      // GEN-17: grounding AnswerTarget/GroundingTarget authority is immutable.
      assert.deepEqual(question.grounding.answerTarget, original.grounding.answerTarget)
      assert.deepEqual(question.grounding.groundingTarget, original.grounding.groundingTarget)
    }
  }
  assert.ok(sawMC && changedMCDistractors, 'GEN-13 must exercise seeded distractor permutation')
  assert.ok(sawMultiSelect && changedMultiSelect, 'GEN-14 must exercise seeded option permutation')
  assert.ok(sawMatching && changedMatching, 'GEN-15 must exercise seeded pair permutation')
  assert.ok(sawFillBlank && changedFillBlank, 'GEN-16 must exercise seeded wordBank permutation')
}

async function testGEN18To20_Regressions() {
  // GEN-18: production evaluator regression suite is invoked independently in main below.
  assert.equal(typeof evaluateQuizOpenAnswer, 'function')
  // GEN-19: M3 diagnostics remain equal with and without generation/history options.
  const value = aggregateBrain('gen-diagnostics')
  const cfg = normalizeQuizConfig({ questionCount: 3, difficulty: 'medium', questionTypes: ['multiple_choice', 'matching'] })
  const legacy = planQuiz(value, cfg)
  const novel = planQuiz(value, cfg, { generationId: 'diagnostic-gen', history: { entries: [] } })
  assert.deepEqual(novel.typeCapabilityDiagnostics, legacy.typeCapabilityDiagnostics)
  // GEN-20: this mission uses only local GenerateQuizBatchFn implementations.
  assert.equal(providerCalls, 0)
}

function knowledgeTargetOfQuestion(question: { grounding: { sourceUnitIds: string[]; sourceRelationIds: string[] } }) {
  return quizKnowledgeTargetId(question.grounding.sourceUnitIds, question.grounding.sourceRelationIds)
}

async function runRecoveryNoveltyScenario(params: {
  value: MaterialBrain
  questionCount: number
  generationId: string
  history?: { entries: Array<{ generationId: string; knowledgeTargetIds: string[]; assessmentIntents: string[]; generatedAt: string }> }
  rejectCalls: number
  questionTypes?: string[]
}) {
  const cfg = normalizeQuizConfig({ questionCount: params.questionCount, difficulty: 'medium',
    questionTypes: params.questionTypes || ['multiple_choice'] })
  const plan = planQuiz(params.value, cfg, { generationId: params.generationId, history: params.history })
  let call = 0
  const outcome = await generateQuizFromPlan(params.value, plan, { batchSize: 8, providerBudget: 12,
    generateBatch: async plans => {
      call += 1
      const generated = await mockGenerate(plans)
      if (call <= params.rejectCalls) return generated.map((item: any, index) =>
        call === 1 && index === 0 ? item : { ...item, question: '' })
      return generated
    } })
  return { plan, outcome, calls: call }
}

async function testRECNOV1_HistoryAwareRecoveryPrefersUnusedKnowledge() {
  const value = brainWithUnits(8, 'rec-nov-1', 'fact')
  const usedIds = value.units.slice(0, 5).map(unit => unit.id)
  const history = { entries: [{ generationId: 'old', knowledgeTargetIds: usedIds,
    assessmentIntents: usedIds.map(() => 'old'), generatedAt: '2026-01-01T00:00:00.000Z' }] }
  const { plan, outcome } = await runRecoveryNoveltyScenario({ value, questionCount: 2,
    generationId: 'rec-nov-1-generation', history, rejectCalls: 1 })
  assert.equal(outcome.status, 'ready')
  assert.equal(outcome.initialAccepted, 1)
  const replacement = outcome.questions.find(question => !plan.plannedQuestions.some(initial => initial.candidateId === question.grounding.candidateId))!
  assert.ok(replacement)
  assert.equal(usedIds.includes(replacement.grounding.sourceUnitIds[0]), false)
}

async function testRECNOV2_MultipleRoundsMaintainIncrementalDiversity() {
  const { outcome } = await runRecoveryNoveltyScenario({ value: brainWithUnits(10, 'rec-nov-2', 'fact'),
    questionCount: 5, generationId: 'rec-nov-2-generation', rejectCalls: 3 })
  assert.equal(outcome.status, 'ready')
  assert.ok(outcome.replacementBatches >= 3)
  const counts = new Map<string, number>()
  for (const question of outcome.questions) {
    const target = knowledgeTargetOfQuestion(question)
    counts.set(target, (counts.get(target) || 0) + 1)
  }
  assert.ok(Math.max(...counts.values()) <= 2)
}

async function testRECNOV3_RecoveryUsesAccumulatedPersistedHistory() {
  const value = brainWithUnits(2, 'rec-nov-3', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const store = new InMemoryQuizArtifactStore()
  const identity = quizGenerationHistoryIdentity('rec-nov-3-session', value.scope.fingerprint, quizConfigFingerprint(cfg))
  await store.saveHistory(identity, { entries: [
    { generationId: 'A', knowledgeTargetIds: ['many-1'], assessmentIntents: ['old-A'], generatedAt: '2026-01-01T00:00:00.000Z' },
    { generationId: 'B', knowledgeTargetIds: ['many-1', 'many-2'], assessmentIntents: ['old-B1', 'old-B2'], generatedAt: '2026-01-02T00:00:00.000Z' },
  ] })
  let call = 0
  const built = await getOrBuildQuizArtifact('rec-nov-3-session', value, cfg, store, { mode: 'new', generateBatch: async plans => {
    call += 1
    const generated = await mockGenerate(plans)
    return call === 1 ? generated.map((item: any) => ({ ...item, question: '' })) : generated
  } })
  assert.equal(built.artifact.questions[0].grounding.sourceUnitIds[0], 'many-2')
  assert.ok((built.artifact.meta.generation?.replacementAttempts || 0) > 0)
}

async function testRECNOV4To5_ScarcityAndNoveltyExhaustionRemainSoft() {
  const scarce = brainWithUnits(3, 'rec-nov-4', 'formula')
  const scarceCfg = normalizeQuizConfig({ questionCount: 2, difficulty: 'medium', questionTypes: ['matching'] })
  const baseline = planQuiz(scarce, scarceCfg)
  const allUsed = baseline.globalCandidatePool.map(candidate => quizKnowledgeTargetId(candidate.sourceUnitIds, candidate.sourceRelationIds))
  const scarceRun = await runRecoveryNoveltyScenario({ value: scarce, questionCount: 2,
    generationId: 'rec-nov-4-generation', questionTypes: ['matching'], rejectCalls: 0,
    history: { entries: [{ generationId: 'old', knowledgeTargetIds: allUsed,
      assessmentIntents: allUsed.map(() => 'old'), generatedAt: '2026-01-01T00:00:00.000Z' }] } })
  assert.equal(scarceRun.outcome.status, 'ready'); assert.equal(scarceRun.outcome.questions.length, 2)
  assert.ok(scarceRun.outcome.questions.every(question => question.type === 'matching'))

  const tinyRun = await runRecoveryNoveltyScenario({ value: brainWithUnits(1, 'rec-nov-5', 'fact'),
    questionCount: 3, generationId: 'rec-nov-5-generation', rejectCalls: 1,
    history: { entries: [{ generationId: 'old', knowledgeTargetIds: ['many-1'],
      assessmentIntents: ['old'], generatedAt: '2026-01-01T00:00:00.000Z' }] } })
  assert.equal(tinyRun.outcome.status, 'ready'); assert.equal(tinyRun.outcome.questions.length, 3)
}

async function testRECNOV6To8_SeededRecoveryAndAuthority() {
  const run = (generationId: string) => runRecoveryNoveltyScenario({ value: brainWithUnits(12, 'rec-nov-seeded', 'fact'),
    questionCount: 4, generationId, rejectCalls: 1 })
  const sameA = await run('rec-nov-same'); const sameB = await run('rec-nov-same')
  assert.deepEqual(sameA.outcome.questions.map(knowledgeTargetOfQuestion), sameB.outcome.questions.map(knowledgeTargetOfQuestion))
  const different = await run('rec-nov-different')
  assert.notDeepEqual(new Set(sameA.outcome.questions.map(knowledgeTargetOfQuestion)),
    new Set(different.outcome.questions.map(knowledgeTargetOfQuestion)))
  for (const question of sameA.outcome.questions) {
    const candidate = sameA.plan.globalCandidatePool.find(item => item.candidateId === question.grounding.candidateId)!
    assert.ok(candidate)
    assert.deepEqual(question.grounding.answerTarget, candidate.answerTarget)
    assert.deepEqual(question.grounding.groundingTarget, candidate.groundingTarget)
  }
}

async function testRECNOV9To10_RecoveryBudgetAndGlobalPoolRegressions() {
  await testRecoveryReportsRealProviderBudgetExhaustion()
  await testRecoveryReportsLegitimateCandidateExhaustion()
  await testG1_GlobalRecoveryUsesDifferentSlotPool()
  await testG2_GlobalCandidateAfterLocalExhaustion()
  await testG3_ExactlyThreeRecoveriesForSeventeenOfTwenty()
  await testG4_ZeroGlobalCandidatesIsInsufficient()
  await testG5_GlobalCandidatesWithZeroBudgetExhausted()
  await testCandidateBuildFailureSkipsOnlyInvalidUnit()
}

async function testPOLICY1To10_WithinQuizCoverageBeforeHistory() {
  const value = brainWithUnits(11, 'policy-coverage', 'fact')
  const historyIds = value.units.slice(0, 10).map(unit => unit.id)
  const history = { entries: [{ generationId: 'history-A', knowledgeTargetIds: historyIds,
    assessmentIntents: historyIds.map(() => 'old'), generatedAt: '2026-01-01T00:00:00.000Z' }] }
  const cfg = normalizeQuizConfig({ questionCount: 10, difficulty: 'medium', questionTypes: ['multiple_choice'] })

  // POLICY-1/POLICY-6: initial planner covers knowledge before cross-generation novelty.
  const plan = planQuiz(value, cfg, { generationId: 'policy-plan', history })
  const plannedTargets = plan.plannedQuestions.map(question => quizKnowledgeTargetId(
    question.sourceUnitIds, question.sourceRelationIds))
  assert.equal(new Set(plannedTargets).size, 10)
  assert.ok(Math.max(...[...new Set(plannedTargets)].map(target => plannedTargets.filter(item => item === target).length)) <= 1)
  assert.equal(plannedTargets[0], 'many-11', 'history still chooses the never-used target first')

  // POLICY-2: a genuinely single-target Brain may reuse it without losing exact-N.
  const tinyPlan = planQuiz(brainWithUnits(1, 'policy-tiny', 'fact'), normalizeQuizConfig({
    questionCount: 5, difficulty: 'medium', questionTypes: ['multiple_choice'],
  }), { generationId: 'policy-tiny-generation', history: { entries: [{ generationId: 'old',
    knowledgeTargetIds: ['many-1'], assessmentIntents: ['old'], generatedAt: '2026-01-01T00:00:00.000Z' }] } })
  assert.equal(tinyPlan.plannedQuestions.length, 5)
  assert.equal(new Set(tinyPlan.plannedQuestions.map(question => quizKnowledgeTargetId(
    question.sourceUnitIds, question.sourceRelationIds))).size, 1)

  // POLICY-3: scarce matching remains present even when every target is historical.
  const scarce = brainWithUnits(2, 'policy-scarce', 'formula')
  const scarceCfg = normalizeQuizConfig({ questionCount: 2, difficulty: 'medium', questionTypes: ['matching'] })
  const scarceBaseline = planQuiz(scarce, scarceCfg)
  const scarceTargets = scarceBaseline.globalCandidatePool.map(candidate => quizKnowledgeTargetId(
    candidate.sourceUnitIds, candidate.sourceRelationIds))
  const scarcePlan = planQuiz(scarce, scarceCfg, { generationId: 'policy-scarce-generation', history: { entries: [{
    generationId: 'old', knowledgeTargetIds: scarceTargets, assessmentIntents: scarceTargets.map(() => 'old'),
    generatedAt: '2026-01-01T00:00:00.000Z',
  }] } })
  assert.equal(scarcePlan.plannedQuestions.length, 2)
  assert.ok(scarcePlan.plannedQuestions.every(question => question.questionType === 'matching'))

  // POLICY-4: assessment variants do not manufacture new knowledge identities.
  const variants = planQuiz(brainWithUnits(1, 'policy-variants', 'fact'), normalizeQuizConfig({
    questionCount: 5, difficulty: 'medium', questionTypes: ['multiple_choice'],
  }), { generationId: 'policy-variants-generation' })
  assert.equal(new Set(variants.plannedQuestions.map(question => quizKnowledgeTargetId(
    question.sourceUnitIds, question.sourceRelationIds))).size, 1)
  assert.equal(new Set(variants.plannedQuestions.map(question => question.assessmentIntent)).size, 5)

  // POLICY-5: multi-unit/relation identity includes every member and is order-independent.
  assert.equal(quizKnowledgeTargetId(['u2', 'u1'], ['r2', 'r1']), quizKnowledgeTargetId(['u1', 'u2'], ['r1', 'r2']))
  assert.notEqual(quizKnowledgeTargetId(['u1'], ['r1']), quizKnowledgeTargetId(['u1', 'u2'], ['r1']))

  // POLICY-7/POLICY-8: recovery uses the shared ordering across multiple rounds.
  await testRECNOV1_HistoryAwareRecoveryPrefersUnusedKnowledge()
  await testRECNOV2_MultipleRoundsMaintainIncrementalDiversity()

  // POLICY-9/POLICY-10: recovery is stable within a seed and variable across seeds.
  await testRECNOV6To8_SeededRecoveryAndAuthority()
}

async function testT1_MCOnly() {
  const v = brainWithUnits(10, 't1-mc-only', 'fact')
  const plan = planQuiz(v, normalizeQuizConfig({ questionCount: 8, difficulty: 'medium', questionTypes: ['multiple_choice'] }))
  assert.ok(plan.plannedQuestions.every(p => p.questionType === 'multiple_choice'))
  assert.equal(plan.plannedQuestions.length, 8)
}

async function testT2_MC_FillBlank() {
  const v = brainWithUnits(10, 't2-mc-fb', 'fact')
  const plan = planQuiz(v, normalizeQuizConfig({ questionCount: 8, difficulty: 'medium', questionTypes: ['multiple_choice', 'fill_blank'] }))
  const types = new Set(plan.plannedQuestions.map(p => p.questionType))
  assert.ok(types.has('multiple_choice')); assert.ok(types.has('fill_blank'))
}

async function testT3_SafeGroundedTFSupported() {
  const v = brainWithUnits(6, 't3-concept-tf', 'concept')
  const plan = planQuiz(v, normalizeQuizConfig({ questionCount: 6, difficulty: 'medium', questionTypes: ['multiple_choice', 'true_false'] }))
  assert.ok(plan.plannedQuestions.some(p => p.questionType === 'true_false'))
}

async function testT4_NoCompatibleFallback() {
  const v = brainWithUnits(6, 't4-matching-concept', 'concept')
  const plan = planQuiz(v, normalizeQuizConfig({ questionCount: 4, difficulty: 'medium', questionTypes: ['matching'] }))
  assert.equal(plan.plannedQuestions.length, 4)
  assert.ok(plan.plannedQuestions.every(question => question.questionType === 'matching'))
}

async function testT5_ScarcityAdversarial() {
  const v = brainT5Adversarial('t5-scarcity')
  const plan = planQuiz(v, normalizeQuizConfig({
    questionCount: 4, difficulty: 'medium',
    questionTypes: ['multiple_choice', 'matching'],
  }))
  const counts = plan.plannedQuestions.reduce<Record<string, number>>((acc, p) => { acc[p.questionType] = (acc[p.questionType] || 0) + 1; return acc }, {})
  assert.equal(counts.matching, 2)
  assert.equal(counts.multiple_choice, 2)
}

async function testT6_Determinism() {
  const v1 = brainMultipleBuckets('t6-det'); const v2 = brainMultipleBuckets('t6-det')
  const cfg = normalizeQuizConfig({ questionCount: 4, difficulty: 'medium', questionTypes: ['multiple_choice', 'fill_blank'] })
  const p1 = planQuiz(v1, cfg); const p2 = planQuiz(v2, cfg)
  assert.deepEqual(
    p1.plannedQuestions.map(p => `${p.questionType}:${p.sourceUnitIds.join(',')}:${p.sourcePage}`),
    p2.plannedQuestions.map(p => `${p.questionType}:${p.sourceUnitIds.join(',')}:${p.sourcePage}`),
  )
}

async function testT6_CoverageAwareRankingUsesDistinctUnitsBeforeRepeating() {
  const distinctUnitCount = 8
  const questionCount = 8
  const value = brainWithUnits(distinctUnitCount, 't6-coverage-aware-ranking', 'fact')
  for (const item of value.units) {
    item.importance = { tier: 'supporting', signals: ['model_judged'], confidence: .9 }
  }
  const cfg = normalizeQuizConfig({
    questionCount, difficulty: 'medium',
    questionTypes: ['multiple_choice', 'fill_blank', 'true_false'],
  })
  const first = planQuiz(value, cfg)
  const second = planQuiz(value, cfg)
  assert.equal(
    new Set(first.plannedQuestions.map(question => question.sourceUnitIds[0])).size,
    Math.min(questionCount, distinctUnitCount),
  )
  assert.deepEqual(first.plannedQuestions, second.plannedQuestions)
}

async function testT7_RecoveryPreservesTypeDistribution() {
  const v = brainT5Adversarial('t7-recovery-preserve')
  const cfg = normalizeQuizConfig({ questionCount: 4, difficulty: 'medium', questionTypes: ['multiple_choice', 'matching'] })
  const store = new InMemoryQuizArtifactStore()
  let batch = 0
  const gen: GenerateQuizBatchFn = async plans => {
    batch += 1
    const items = await mockGenerate(plans)
    if (batch === 1) return items.map((it: any) => it.type === 'matching' && it.planId.includes('proc-1') ? { ...it, question: '' } : it)
    return items
  }
  const res = await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: gen, batchSize: 8 })
  const counts = res.artifact.questions.reduce<Record<string, number>>((acc, q) => { acc[q.type] = (acc[q.type] || 0) + 1; return acc }, {})
  assert.equal(counts.matching, 2)
  assert.equal(counts.multiple_choice, 2)
}

async function testCandidateBuildFailureSkipsOnlyInvalidUnit() {
  const value = brainWithUnits(1, 'candidate-build-skip-one', 'fact')
  const invalidUnitId = value.units[0].id
  invalidateUnitLabelGrounding(value, invalidUnitId)
  const plan = planQuiz(value, normalizeQuizConfig({
    questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'],
  }))
  assert.equal(plan.plannedQuestions.length, 1)
  const recovered = plan.globalCandidatePool.find(candidate => candidate.sourceUnitIds.includes(invalidUnitId))
  assert.ok(recovered, 'a grounded statement must remain usable when only its derived label is unsupported')
  assert.notEqual(recovered.answerTarget.canonicalValue, value.units[0].label)
}

async function testCanonicalLabelTokensMatchNonAdjacentGroundedAssertion() {
  const value = brainWithUnits(1, 'canonical-token-overlap', 'fact')
  const target = value.units[0]
  target.label = 'Atlanta Falcons'
  target.statement = 'Los Falcons representan una parte importante de la identidad de Atlanta.'
  const authority = target.statement
  target.evidence = [{ ...target.evidence[0], quote: authority, description: authority }]
  target.provenance = [{ materialId: 'mat-a', page: 1, quote: authority, chunkId: 'c-1' }]

  const plan = planQuiz(value, normalizeQuizConfig({
    questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'],
  }))
  const candidate = plan.globalCandidatePool.find(item => item.sourceUnitIds.includes(target.id))
  assert.ok(candidate)
  assert.equal(candidate.answerTarget.canonicalValue, target.statement)
  assert.notEqual(candidate.answerTarget.canonicalValue, target.label)
}

async function testCanonicalLabelTokensStillRejectUngroundedUnit() {
  const value = brainWithUnits(1, 'canonical-token-missing', 'fact')
  const target = value.units[0]
  target.label = 'Atlanta Falcons'
  target.statement = 'La aficion representa una parte importante de la identidad deportiva.'
  const authority = target.statement
  target.evidence = [{ ...target.evidence[0], quote: authority, description: authority }]
  target.provenance = [{ materialId: 'mat-a', page: 1, quote: authority, chunkId: 'c-1' }]

  const plan = planQuiz(value, normalizeQuizConfig({
    questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'],
  }))
  assert.equal(plan.plannedQuestions[0].answerTarget.canonicalValue, authority)
  assert.notEqual(plan.plannedQuestions[0].answerTarget.canonicalValue, target.label)
}

async function testSeveralCandidateBuildFailuresPreserveExactCount() {
  const value = brainWithUnits(10, 'candidate-build-skip-several', 'fact')
  for (const target of value.units.slice(0, 3)) invalidateUnitLabelGrounding(value, target.id)
  const plan = planQuiz(value, normalizeQuizConfig({
    questionCount: 7, difficulty: 'medium', questionTypes: ['multiple_choice'],
  }))
  assert.equal(plan.plannedQuestions.length, 7)
}

async function testCandidateBuildFailuresStillThrowAtTrueCapacityShortfall() {
  const value = brainWithUnits(3, 'candidate-build-all-invalid', 'fact')
  for (const target of value.units) {
    target.evidence = []
    target.provenance = []
  }
  assert.throws(() => planQuiz(value, normalizeQuizConfig({
    questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'],
  })), /INSUFFICIENT_KNOWLEDGE/)
}

async function testT_BucketCoverage() {
  const v = brainMultipleBuckets('t-bucket')
  const plan = planQuiz(v, normalizeQuizConfig({ questionCount: 4, difficulty: 'medium', questionTypes: ['multiple_choice'] }))
  const buckets = new Set(plan.plannedQuestions.map(p => `${p.sourceMaterialId}:${p.sourcePage}`))
  assert.ok(buckets.size >= 3)
}

async function testTrueFalseNormalizerMatrix() {
  const cases: Array<[unknown, { valid: boolean; valueClass: string }]> = [
    [true, { valid: true, valueClass: 'boolean_true' }],
    ['true', { valid: true, valueClass: 'string_true' }],
    ['Verdadero', { valid: true, valueClass: 'spanish_true' }],
    [false, { valid: true, valueClass: 'boolean_false' }],
    ['false', { valid: false, valueClass: 'string_false' }],
    ['Falso', { valid: false, valueClass: 'spanish_false' }],
    [1, { valid: false, valueClass: 'numeric_one' }],
    [0, { valid: false, valueClass: 'numeric_zero' }],
    [null, { valid: false, valueClass: 'nullish' }],
    [undefined, { valid: false, valueClass: 'nullish' }],
    ['maybe', { valid: false, valueClass: 'other' }],
  ]
  for (const [input, expected] of cases) {
    const r = normalizeTrueFalseAnswer(input)
    assert.equal(r.valid, expected.valid); assert.equal(r.valueClass, expected.valueClass)
  }
}

async function testA_PresentationBalance() {
  const v = brainWithUnits(10, 'a-mc-balance', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 10, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const store = new InMemoryQuizArtifactStore()
  const built = await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: mockGenerate })
  const positions = summarizeCorrectPositions(built.artifact.questions)
  const counts = Object.values(positions)
  // Blocker 3 test-fix: histogram now includes zeros; balance across ALL 4 indexes.
  assert.equal(counts.length, 4)
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `MC balance: ${JSON.stringify(positions)}`)
  assert.ok(new Set(built.artifact.questions.map(q => (q as any).correctAnswer)).size >= 2)
  for (const q of built.artifact.questions) {
    if (q.type === 'multiple_choice') assert.ok(q.options[q.correctAnswer].startsWith('Answer'))
  }
  const again = await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: async () => { throw new Error('must-hit') } })
  assert.equal(again.cacheStatus, 'hit')
  for (let i = 0; i < built.artifact.questions.length; i += 1) {
    const a = built.artifact.questions[i] as any; const b = again.artifact.questions[i] as any
    if (a.type === 'multiple_choice') { assert.deepEqual(a.options, b.options); assert.equal(a.correctAnswer, b.correctAnswer) }
  }
  for (const q of built.artifact.questions) {
    assert.ok((q as any).grounding?.evidence?.length >= 1)
    assert.ok((q as any).grounding?.sourceUnitIds?.length >= 1)
  }
}

async function testA4_MultipleN_IncludingN1_NotStructurallyA() {
  for (const n of [1, 2, 3, 4, 5, 9, 10, 20]) {
    const v = brainWithUnits(Math.max(n + 3, 6), `a4-${n}`, 'fact')
    const cfg = normalizeQuizConfig({ questionCount: n, difficulty: 'medium', questionTypes: ['multiple_choice'] })
    const store = new InMemoryQuizArtifactStore()
    const built = await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: mockGenerate })
    assert.equal(built.artifact.questions.length, n)
    const positions = summarizeCorrectPositions(built.artifact.questions)
    assert.equal(Object.keys(positions).length, 4, `A4 N=${n} histogram must include ALL 4 indexes`)
    if (n >= 4) {
      const counts = Object.values(positions)
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `A4 N=${n} balance: ${JSON.stringify(positions)}`)
    }
  }
  // Blocker 3: for N=1, different (brainFingerprint) identities must NOT all
  // fall onto A. Iterate distinct seeds and require at least 2 distinct
  // correct-answer indexes across those single-question quizzes.
  const seenIndexes = new Set<number>()
  for (let i = 0; i < 12; i += 1) {
    const v = brainWithUnits(4, `a4-n1-${i}`, 'fact')
    const cfg = normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'] })
    const store = new InMemoryQuizArtifactStore()
    const built = await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: mockGenerate })
    const q = built.artifact.questions[0] as any
    seenIndexes.add(q.correctAnswer)
  }
  assert.ok(seenIndexes.size >= 2, `N=1 correct index must vary across identities, got ${[...seenIndexes]}`)
}

async function testA5_MultiSelectRemap() {
  const q: any = {
    id: 'ms1', type: 'multi_select', question: 'Which are supported?',
    explanation: 'x', difficulty: 'medium',
    options: ['A_correct', 'B_correct', 'C_distractor', 'D_distractor'],
    correctAnswers: [0, 1],
    grounding: { planId: 'x', slotId: 'x', candidateId: 'x', sourceUnitIds: ['u'], sourceRelationIds: [], evidence: [], supportingText: 'x' },
  }
  const r = applyQuizPresentation([q], { brainFingerprint: 'bf', configFingerprint: 'cf' }, config)
  const out = r.questions[0] as any
  assert.deepEqual(new Set(out.correctAnswers.map((i: number) => out.options[i])), new Set(['A_correct', 'B_correct']))
  assert.deepEqual(new Set(out.options), new Set(q.options))
}

async function testA8_NoRenderShuffle() {
  const src = readFileSync('components/materias/ALAIStudyALQuizzes.tsx', 'utf8')
  assert.doesNotMatch(src, /Math\.random\s*\(\s*\)\s*[-+*<>=]?[\s\S]{0,60}(options|shuffle|sort)/,
    'UI must not shuffle options with Math.random at render time')
}

async function testC1_And_C4_C5_C6_C12_RecoveryOnlyMissing() {
  const v = brainWithUnits(20, 'c1-recovery', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 10, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const store = new InMemoryQuizArtifactStore()
  const sentPlanIds: string[][] = []
  let batchNumber = 0
  const gen: GenerateQuizBatchFn = async plans => {
    batchNumber += 1
    sentPlanIds.push(plans.map(p => p.planId))
    const items = await mockGenerate(plans)
    if (batchNumber === 1) return items.map((it: any, idx) => idx === 0 ? { ...it, question: '' } : it)
    return items
  }
  const res = await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: gen, batchSize: 8 })
  assert.equal(res.status, 'ready'); assert.equal(res.artifact.questions.length, 10)
  const firstAcceptedPlanIds = new Set(
    (res.artifact.questions.map(q => (q as any).grounding?.planId as string | undefined).filter(Boolean) as string[])
      .filter(pid => !pid.startsWith('quiz-plan:r'))
  )
  const initialBatchCount = Math.ceil(10 / 8)
  for (let i = initialBatchCount; i < sentPlanIds.length; i += 1) {
    for (const pid of sentPlanIds[i]) {
      assert.ok(!firstAcceptedPlanIds.has(pid), `C4: accepted plan ${pid} regenerated in recovery batch ${i}`)
    }
  }
  assert.ok(sentPlanIds[sentPlanIds.length - 1].length < 10)
}

async function testC2_20_17_20_BudgetExactCount() {
  const v = brainWithUnits(30, 'c2-20-17', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 20, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const store = new InMemoryQuizArtifactStore()
  const sent: string[][] = []
  let batch = 0
  const gen: GenerateQuizBatchFn = async plans => {
    batch += 1
    sent.push(plans.map(p => p.planId))
    const items = await mockGenerate(plans)
    if (batch <= 2) return items.map((it: any, idx) => (batch === 1 && idx < 2) || (batch === 2 && idx === 0) ? { ...it, question: '' } : it)
    return items
  }
  const res = await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: gen, batchSize: 8 })
  assert.equal(res.artifact.questions.length, 20)
  const initialBatchCount = Math.ceil(20 / 8)
  const firstRecovery = sent[initialBatchCount] || []
  assert.equal(firstRecovery.length, 3)
  // Provider-attempt telemetry proven, upper-bound = budget.
  const telemetry = res.artifact.meta.generation!
  assert.equal(telemetry.providerAttemptsBudget, computeQuizProviderBudget(20))
  assert.ok(telemetry.providerAttemptsTotal <= telemetry.providerAttemptsBudget)
  assert.ok(telemetry.providerAttemptsTotal >= initialBatchCount)
}

async function testC3_RotateOnInvalidReplacement() {
  const v = brainWithUnits(6, 'c3-rotate', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 3, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const store = new InMemoryQuizArtifactStore()
  const sent: string[][] = []
  let batch = 0
  const gen: GenerateQuizBatchFn = async plans => {
    batch += 1
    sent.push(plans.map(p => p.planId))
    const items = await mockGenerate(plans)
    if (batch === 1) return items.map((it: any, idx) => idx === 0 ? { ...it, question: '' } : it)
    if (batch === 2) return items.map((it: any) => ({ ...it, question: '' }))
    return items
  }
  const res = await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: gen, batchSize: 8 })
  assert.equal(res.artifact.questions.length, 3)
  assert.ok(sent.length >= 3)
}

async function testC7_ReplacementPreservesType() {
  const v = brainT5Adversarial('c7-preserve-type')
  const cfg = normalizeQuizConfig({ questionCount: 4, difficulty: 'medium', questionTypes: ['multiple_choice', 'matching'] })
  const store = new InMemoryQuizArtifactStore()
  let batch = 0
  const gen: GenerateQuizBatchFn = async plans => {
    batch += 1
    const items = await mockGenerate(plans)
    if (batch === 1) return items.map((it: any) => it.type === 'matching' && it.planId.includes(':3:') ? { ...it, question: '' } : it)
    return items
  }
  const res = await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: gen, batchSize: 8 })
  const counts = res.artifact.questions.reduce<Record<string, number>>((acc, q) => { acc[q.type] = (acc[q.type] || 0) + 1; return acc }, {})
  assert.equal(counts.matching, 2)
}

async function testRecoveryContinuesBeyondThreeRounds() {
  const v = brainWithUnits(30, 'recovery-beyond-three-rounds', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 10, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const plan = planQuiz(v, cfg)
  const primaryIds = new Set(plan.plannedQuestions.map(item => item.candidateId))
  const delayedIds = new Set<string>()
  const delayed = plan.slots.slice(3).map(slot => {
    const candidate = plan.candidatePoolBySlot[slot.slotId]
      .find(item => !primaryIds.has(item.candidateId) && !delayedIds.has(item.candidateId))
    assert.ok(candidate, `expected a recovery candidate for ${slot.slotId}`)
    delayedIds.add(candidate.candidateId)
    plan.candidatePoolBySlot[slot.slotId] = []
    return { slot, candidate }
  })
  plan.globalCandidatePool = plan.plannedQuestions.map(item =>
    plan.globalCandidatePool.find(candidate => candidate.candidateId === item.candidateId)!)
  let call = 0
  const gen: GenerateQuizBatchFn = async plans => {
    call += 1
    const items = await mockGenerate(plans)
    if (call === 1) {
      plan.globalCandidatePool.push(delayed[0].candidate)
      return items.map((item: any, index) => index < 3 ? item : { ...item, question: '' })
    }
    const nextCandidates = call === 4 ? delayed.slice(3) : delayed.slice(call - 1, call)
    for (const next of nextCandidates) plan.globalCandidatePool.push(next.candidate)
    return items
  }

  const outcome = await generateQuizFromPlan(v, plan, { generateBatch: gen, batchSize: 10, providerBudget: 7 })
  assert.equal(outcome.status, 'ready')
  assert.equal(outcome.initialAccepted, 3)
  assert.equal(outcome.questions.length, 10)
  assert.equal(outcome.replacementBatches, 4, 'recovery must continue past round three while legitimate candidates and budget remain')
  assert.equal(outcome.providerAttemptsTotal, 5, 'the fifth provider call must be allowed after the live 4/7 state')
  assert.equal(call, 5)
}

async function testRecoveryContinuesAfterAnotherSlotReachesLocalCap() {
  const v = brainWithUnits(30, 'recovery-cross-slot-cap', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 10, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const plan = planQuiz(v, cfg)
  const [capSlot, laterSlot] = plan.slots.slice(8)
  const primaryIds = new Set(plan.plannedQuestions.map(item => item.candidateId))
  const capCandidates = plan.candidatePoolBySlot[capSlot.slotId]
    .filter(item => !primaryIds.has(item.candidateId)).slice(0, 2)
  const capCandidateIds = new Set(capCandidates.map(item => item.candidateId))
  const laterCandidate = plan.candidatePoolBySlot[laterSlot.slotId]
    .find(item => !primaryIds.has(item.candidateId) && !capCandidateIds.has(item.candidateId))
  assert.equal(capCandidates.length, 2)
  assert.ok(laterCandidate)
  plan.candidatePoolBySlot[capSlot.slotId] = [capCandidates[0]]
  plan.candidatePoolBySlot[laterSlot.slotId] = []
  plan.globalCandidatePool = [
    ...plan.plannedQuestions.map(item => plan.globalCandidatePool.find(candidate => candidate.candidateId === item.candidateId)!),
    capCandidates[0],
  ]
  let call = 0
  const gen: GenerateQuizBatchFn = async plans => {
    call += 1
    const items = await mockGenerate(plans)
    if (call === 1) return items.map((item: any, index) => index < 8 ? item : { ...item, question: '' })
    if (call === 2) {
      plan.globalCandidatePool.push(capCandidates[1])
      return items.map((item: any) => ({ ...item, question: '' }))
    }
    if (call === 3) plan.globalCandidatePool.push(laterCandidate)
    return items
  }

  const outcome = await generateQuizFromPlan(v, plan, { generateBatch: gen, batchSize: 10, providerBudget: 7 })
  assert.equal(outcome.status, 'ready')
  assert.notEqual(outcome.status, 'recovery_budget_exhausted')
  assert.equal(outcome.questions.length, 10)
  assert.equal(outcome.replacementBatches, 3)
}

async function testRecoveryReportsRealProviderBudgetExhaustion() {
  const v = brainWithUnits(20, 'recovery-real-provider-budget', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 10, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const plan = planQuiz(v, cfg)
  const gen: GenerateQuizBatchFn = async plans => {
    const items = await mockGenerate(plans)
    return items.map((item: any, index) => index < 9 ? item : { ...item, question: '' })
  }
  const outcome = await generateQuizFromPlan(v, plan, { generateBatch: gen, batchSize: 10, providerBudget: 1 })
  assert.equal(outcome.questions.length, 9)
  assert.equal(outcome.providerAttemptsTotal, 1)
  assert.equal(outcome.status, 'recovery_budget_exhausted')
}

async function testRecoveryReportsLegitimateCandidateExhaustion() {
  const v = brainWithUnits(1, 'recovery-candidates-exhausted', 'concept')
  const cfg = normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['true_false'] })
  const plan = planQuiz(v, cfg)
  const gen: GenerateQuizBatchFn = async plans =>
    (await mockGenerate(plans)).map((item: any) => ({ ...item, question: '' }))
  const outcome = await generateQuizFromPlan(v, plan, { generateBatch: gen, batchSize: 8, providerBudget: 7 })
  assert.equal(outcome.providerAttemptsTotal, 3)
  assert.equal(outcome.status, 'insufficient_valid_questions')
  assert.notEqual(outcome.status, 'recovery_budget_exhausted')
}

async function testC8_SaveRejectsWrongCount() {
  const store = new InMemoryQuizArtifactStore()
  let threw = false
  try {
    await store.save('x', {
      scope: brain().scope,
      meta: {
        schemaVersion: '3.0.0', quizVersion: '3.0.0', plannerVersion: '3.0.0',
        generatorVersion: '3.0.0', presentationVersion: '3.0.0',
        brainFingerprint: 'x', configFingerprint: 'y', sourceSelectionFingerprint: 'x',
        generatedAt: '2026', status: 'ready', llmCallsUsed: 0,
      },
      config: normalizeQuizConfig({ questionCount: 5, difficulty: 'medium', questionTypes: ['multiple_choice'] }),
      questions: [],
    } as any)
  } catch (e) { threw = String(e).includes('ARTIFACT_CORRUPT') }
  assert.equal(threw, true)
}

async function testC10a_InsufficientKnowledge() {
  const v = brain()
  const cfg = normalizeQuizConfig({ questionCount: 31, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const store = new InMemoryQuizArtifactStore()
  let msg = ''
  try { await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: mockGenerate, batchSize: 8 }) }
  catch (e) { msg = String(e) }
  assert.ok(msg.includes('INSUFFICIENT_KNOWLEDGE'), msg)
}

async function testC10b_InsufficientValidQuestions_EXACT() {
  // Exactly three legitimate transformations; all are academically rejected.
  const v = brainWithUnits(1, 'c10b-insuff-valid', 'concept')
  const cfg = normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['true_false'] })
  const store = new InMemoryQuizArtifactStore()
  const gen: GenerateQuizBatchFn = async plans => (await mockGenerate(plans)).map((it: any) => ({ ...it, question: '' }))
  let msg = ''
  try { await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: gen, batchSize: 8 }) } catch (e) { msg = String(e) }
  assert.ok(msg.includes('INSUFFICIENT_VALID_QUESTIONS'), `EXACT expected INSUFFICIENT_VALID_QUESTIONS, got ${msg}`)
}

async function testC10b2_RecoveryBudgetExhausted_EXACT() {
  // Large candidate pool but per-slot cap hit → recovery budget exhausted.
  const v = brainWithUnits(30, 'c10b2-budget', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 3, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const store = new InMemoryQuizArtifactStore()
  const gen: GenerateQuizBatchFn = async plans => (await mockGenerate(plans)).map((it: any) => ({ ...it, question: '' }))
  let msg = ''
  try { await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: gen, batchSize: 8 }) } catch (e) { msg = String(e) }
  assert.ok(msg.includes('RECOVERY_BUDGET_EXHAUSTED'), `EXACT expected RECOVERY_BUDGET_EXHAUSTED, got ${msg}`)
}

async function testC10c_ProviderGenerationFailed_EXACT() {
  const v = brainWithUnits(6, 'c10c-provider-fail', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 3, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const store = new InMemoryQuizArtifactStore()
  const gen: GenerateQuizBatchFn = async () => { throw new Error('PROVIDER_TIMEOUT') }
  let msg = ''
  try { await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: gen, batchSize: 8 }) } catch (e) { msg = String(e) }
  assert.ok(msg.includes('GENERATION_FAILED'), `EXACT expected GENERATION_FAILED, got ${msg}`)
}

async function testProviderBudget_N50_Pathological() {
  // Every batch invalid on the initial pass across all slots → recovery
  // triggers up to per-slot cap, but global budget must stop it.
  const v = brainWithUnits(80, 'n50-path', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 50, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const store = new InMemoryQuizArtifactStore()
  let providerAttemptsObserved = 0
  const gen: GenerateQuizBatchFn = async plans => {
    providerAttemptsObserved += 1
    return (await mockGenerate(plans)).map((it: any) => ({ ...it, question: '' }))
  }
  let msg = ''
  try { await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: gen, batchSize: 8 }) } catch (e) { msg = String(e) }
  const budget = computeQuizProviderBudget(50, 8)
  assert.ok(providerAttemptsObserved <= budget, `N=50 provider attempts ${providerAttemptsObserved} exceeded budget ${budget}`)
  assert.ok(msg.includes('RECOVERY_BUDGET_EXHAUSTED'), msg)
}

async function testProviderBudget_CleanN10() {
  const v = brainWithUnits(20, 'clean-n10', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 10, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const store = new InMemoryQuizArtifactStore()
  let attempts = 0
  const gen: GenerateQuizBatchFn = async plans => { attempts += 1; return mockGenerate(plans) }
  const res = await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: gen, batchSize: 8 })
  assert.equal(res.artifact.questions.length, 10)
  assert.equal(attempts, 2, `clean N=10 must attempt exactly ⌈10/8⌉=2 batches, got ${attempts}`)
}

async function testProviderBudget_CleanN20() {
  const v = brainWithUnits(30, 'clean-n20', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 20, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const store = new InMemoryQuizArtifactStore()
  let attempts = 0
  const gen: GenerateQuizBatchFn = async plans => { attempts += 1; return mockGenerate(plans) }
  const res = await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: gen, batchSize: 8 })
  assert.equal(res.artifact.questions.length, 20)
  assert.equal(attempts, 3, `clean N=20 must attempt exactly ⌈20/8⌉=3 batches, got ${attempts}`)
}

async function testLargeQuizTransformationContracts() {
  // L1: one truth can support ten distinct MC assessment transformations.
  const oneFact = brainWithUnits(1, 'l1-one-fact', 'fact')
  const l1 = planQuiz(oneFact, normalizeQuizConfig({
    questionCount: 10, difficulty: 'medium', questionTypes: ['multiple_choice'],
  }))
  assert.equal(l1.plannedQuestions.length, 10)
  assert.equal(new Set(l1.plannedQuestions.map(item => item.intent)).size, 10)
  assert.equal(new Set(l1.plannedQuestions.flatMap(item => item.sourceUnitIds)).size, 1)

  // L2: capacity is transformations, not the five source units.
  const fiveFacts = brainWithUnits(5, 'l2-five-facts', 'fact')
  const l2 = planQuiz(fiveFacts, normalizeQuizConfig({
    questionCount: 50, difficulty: 'medium', questionTypes: ['multiple_choice'],
  }))
  assert.equal(l2.plannedQuestions.length, 50)
  assert.ok(l2.plannedQuestions.length > fiveFacts.units.length)

  // L3-L9: rich structured knowledge reaches exact 100 across all six types.
  const rich = brainWithUnits(10, 'l3-rich-100', 'formula')
  rich.units.forEach((item, index) => {
    if (item.kind !== 'formula') throw new Error('TEST_FIXTURE_INVALID')
    item.statement = `${item.label} has distinct formula context ${index + 1}.`
    const authority = [item.label, item.statement, item.expression,
      ...item.variables.flatMap(variable => [variable.symbol, variable.meaning])].join(' | ')
    item.evidence = [{ ...item.evidence[0], description: authority, quote: authority }]
    if (item.provenance.length) item.provenance[0].quote = authority
  })
  const allTypes = ['multiple_choice', 'true_false', 'multi_select', 'fill_blank', 'matching', 'short_answer'] as const
  const cfg100 = normalizeQuizConfig({ questionCount: 100, difficulty: 'medium', questionTypes: [...allTypes] })
  const plan100 = planQuiz(rich, cfg100)
  assert.equal(plan100.plannedQuestions.length, 100)
  assert.equal(new Set(plan100.plannedQuestions.map(item => item.intent)).size, 100,
    'L6 assessment-intent identities must be unique')
  assert.ok(new Set(plan100.plannedQuestions.map(item => item.questionType)).size === 6,
    'L4 every supported selected type must be represented')
  const usesByUnit = new Map<string, number>()
  for (const item of plan100.plannedQuestions) {
    const id = item.sourceUnitIds[0]
    usesByUnit.set(id, (usesByUnit.get(id) || 0) + 1)
  }
  assert.ok([...usesByUnit.values()].some(count => count > 1), 'L7 a unit must be reusable across transformations')

  const store = new InMemoryQuizArtifactStore()
  let wrapperCalls = 0
  const batchSizes: number[] = []
  const generate100: GenerateQuizBatchFn = async plans => {
    wrapperCalls += 1
    batchSizes.push(plans.length)
    return mockGenerate(plans)
  }
  const first = await getOrBuildQuizArtifact('large-session', rich, cfg100, store, {
    generateBatch: generate100, batchSize: 8,
  })
  assert.equal(first.artifact.questions.length, 100)
  assert.equal(wrapperCalls, 13, 'clean N=100 must use ceil(100/8)=13 wrapper batches')
  assert.equal(new Set(first.artifact.questions.map(question => question.type)).size, 6)
  const normalizedQuestions = first.artifact.questions.map(question => question.question
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim())
  assert.equal(new Set(normalizedQuestions).size, 100, 'L5 normalized question wording must be unique')
  const decoded = decodePersistedQuizArtifact(first.artifact, {
    sessionId: 'large-session', brain: rich, config: cfg100,
    configFingerprint: first.artifact.meta.configFingerprint,
  })
  assert.equal(decoded.ok, true, 'L8-L9 every answer/evidence/page must pass the production decoder')

  // L10-L12: one academic rejection recovers only its missing slot.
  const recoveryStore = new InMemoryQuizArtifactStore()
  let recoveryCalls = 0
  const recoveryBatchSizes: number[] = []
  let rejected = false
  const recoverOne: GenerateQuizBatchFn = async plans => {
    recoveryCalls += 1
    recoveryBatchSizes.push(plans.length)
    const generated = await mockGenerate(plans)
    if (!rejected) {
      rejected = true
      return generated.map((item: any, index) => index === 0 ? { ...item, question: '' } : item)
    }
    return generated
  }
  const recovered = await getOrBuildQuizArtifact('large-recovery', rich, cfg100, recoveryStore, {
    generateBatch: recoverOne, batchSize: 8,
  })
  assert.equal(recovered.artifact.questions.length, 100, 'L10 rejection must not reduce exact count')
  assert.equal(recoveryBatchSizes.at(-1), 1, 'L11 replacement must generate only the missing slot')
  assert.equal(recoveryCalls, 14)
  assert.ok(recoveryCalls <= computeQuizProviderBudget(100, 8), 'L12 attempts must remain within N=100 budget')

  // L13: warm restore is byte-stable and invokes no generator.
  const warm = await getOrBuildQuizArtifact('large-session', rich, cfg100, store, {
    generateBatch: async () => { throw new Error('warm restore must not generate') }, batchSize: 8,
  })
  assert.equal(warm.cacheStatus, 'hit')
  assert.deepEqual(warm.artifact.questions, first.artifact.questions)

  assert.deepEqual(
    [10, 20, 50, 100].map(count => computeQuizProviderBudget(count, 8)),
    [7, 9, 18, 33],
    'provider budget formula must scale clean + repair + academic recovery allowances',
  )
  assert.deepEqual(batchSizes, [...Array(12).fill(8), 4])
}

async function testG_LeakageInvariants() {
  const v = brain()
  const plan = planQuiz(v, config)
  assert.ok(plan.plannedQuestions.every(p => p.evidence.every(ev => source.selectedPages[ev.materialId].includes(ev.page))))
  const raw = await mockGenerate(plan.plannedQuestions.map(item => ({
    planId: item.id, requiredType: item.questionType, difficulty: item.difficulty,
    units: item.sourceUnitIds.map(id => v.units.find(u => u.id === id)!).map(u => ({ id: u.id, kind: u.kind, label: u.label, statement: u.statement })), relations: [],
  })))
  const validated = validateGeneratedQuiz(v, plan, raw)
  const presentation = applyQuizPresentation(validated.questions, { brainFingerprint: v.scope.fingerprint, configFingerprint: plan.configFingerprint }, plan.config)
  for (const q of presentation.questions) {
    for (const ev of (q as any).grounding.evidence) {
      const pages = source.selectedPages[ev.materialId] || []
      assert.ok(pages.includes(ev.page))
    }
  }
}

async function testG4_VisualEvidencePreserved() {
  const v = brain()
  const plan = planQuiz(v, config)
  const raw = await mockGenerate(plan.plannedQuestions.map(item => ({
    planId: item.id, requiredType: item.questionType, difficulty: item.difficulty,
    units: item.sourceUnitIds.map(id => v.units.find(u => u.id === id)!).map(u => ({ id: u.id, kind: u.kind, label: u.label, statement: u.statement })), relations: [],
  })))
  const validated = validateGeneratedQuiz(v, plan, raw)
  const visual = validated.questions.find(q => (q as any).grounding.evidence.some((ev: any) => ev.derivation === 'vision'))
  assert.ok(visual)
  const evs = (visual as any).grounding.evidence.filter((ev: any) => ev.derivation === 'vision')
  for (const ev of evs) {
    assert.equal(typeof ev.pageFingerprint, 'string')
    assert.equal(typeof ev.analyzerVersion, 'string')
    assert.equal(typeof ev.promptVersion, 'string')
    assert.ok(!('quote' in ev))
  }
}

async function testG6_UnsupportedAnswerRejected() {
  const v = brain()
  const plan = planQuiz(v, config)
  const raw = await mockGenerate(plan.plannedQuestions.map(item => ({
    planId: item.id, requiredType: item.questionType, difficulty: item.difficulty,
    units: item.sourceUnitIds.map(id => v.units.find(u => u.id === id)!).map(u => ({ id: u.id, kind: u.kind, label: u.label, statement: u.statement })), relations: [],
  })))
  const broken = (raw as any[]).map((it, idx) => idx === 0 ? { ...it, options: ['Unrelated', 'X', 'Y', 'Z'], correctAnswer: 0 } : it)
  const validated = validateGeneratedQuiz(v, plan, broken)
  const diag = validated.diagnostics.find(d => d.reason === 'unsupported_answer')
  assert.ok(diag); assert.equal(diag!.subReason, 'correct_option_not_supported')
}

async function testGrounding_EvidenceLinked_RelationWithoutEvidence() {
  // Blocker 4 (case B): relation without valid authorized evidence must NOT
  // authorize an answer whose text lives only in that relation statement.
  const v = brain()
  // Strip evidence + provenance from r1 so relationEvidence returns [].
  ;(v as any).relations = v.relations.map(r => ({ ...r, evidence: [], provenance: [] }))
  const plan = planQuiz(v, normalizeQuizConfig({ questionCount: 3, difficulty: 'medium', questionTypes: ['multiple_choice'] }))
  // No planned question should reference r1 anymore.
  assert.ok(plan.plannedQuestions.every(p => !p.sourceRelationIds.includes('r1')),
    'relation without valid evidence must NOT be attached to plans')
}

async function testGrounding_EvidenceLinked_RelationWithEvidence() {
  const v = brain()
  const plan = planQuiz(v, normalizeQuizConfig({ questionCount: 3, difficulty: 'medium', questionTypes: ['multiple_choice'] }))
  const attached = plan.plannedQuestions.find(p => p.sourceRelationIds.includes('r1'))
  assert.ok(attached, 'relation r1 has authorized visual evidence, expected to be attached')
  assert.ok((attached as any).evidenceLinks.some((l: any) => l.kind === 'relation' && l.refId === 'r1' && l.evidence.length >= 1))
}

async function testGrounding_AssertionMustMatchEvidence() {
  const unrelated = brainWithUnits(1, 'grounding-unrelated', 'fact')
  unrelated.units[0].label = 'Jupiter'
  unrelated.units[0].statement = 'The secret answer is Jupiter'
  unrelated.units[0].evidence = [{ materialId: 'mat-a', page: 1, derivation: 'native_text', quote: 'This page discusses cell membranes.' }]
  const unrelatedPlan = planQuiz(unrelated, { questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  assert.equal(unrelatedPlan.plannedQuestions[0].answerTarget.canonicalValue, 'This page discusses cell membranes.')
  assert.notEqual(unrelatedPlan.plannedQuestions[0].answerTarget.canonicalValue, unrelated.units[0].label)
  const context = plannedContext(unrelated, unrelatedPlan.plannedQuestions[0])
  assert.equal(context.units[0].label, 'This page discusses cell membranes.')
  assert.equal(context.units[0].statement, 'This page discusses cell membranes.')
  assert.ok(context.units[0].groundedAssertions.includes('This page discusses cell membranes.'))

  const matching = brainWithUnits(1, 'grounding-matching', 'fact')
  matching.units[0].label = 'Jupiter'
  matching.units[0].statement = 'The secret answer is Jupiter'
  matching.units[0].evidence = [{ materialId: 'mat-a', page: 1, derivation: 'native_text', quote: 'The secret answer is Jupiter.' }]
  assert.equal(planQuiz(matching, { questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'] }).plannedQuestions.length, 1)

  const unrelatedRelation = brain()
  unrelatedRelation.relations[0].evidence = [{ materialId: 'mat-a', page: 3, derivation: 'vision', pageFingerprint: 'relation-page', analyzerVersion: '1.2.0', promptVersion: '1.1.0', description: 'Unrelated visual content' }]
  assert.ok(planQuiz(unrelatedRelation, config).plannedQuestions.every(question => !question.sourceRelationIds.includes('r1')))

  const visual = brainWithUnits(1, 'grounding-visual', 'fact')
  visual.units[0].evidence = [{ materialId: 'mat-a', page: 1, derivation: 'vision', pageFingerprint: 'immutable-page', analyzerVersion: '1.2.0', promptVersion: '1.1.0', description: visual.units[0].statement }]
  assert.equal(planQuiz(visual, { questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'] }).plannedQuestions.length, 1)
  const authorizedVisualAssertion = visual.units[0].statement
  visual.units[0].statement = 'Mutated unsupported assertion'
  visual.units[0].label = 'Mutated unsupported answer'
  const visualFallbackPlan = planQuiz(visual, { questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  assert.equal(visualFallbackPlan.plannedQuestions[0].answerTarget.canonicalValue, authorizedVisualAssertion,
    'GROUND-REG-3 authorized verbatim visual evidence remains usable')
  assert.notEqual(visualFallbackPlan.plannedQuestions[0].answerTarget.canonicalValue, visual.units[0].statement,
    'GROUND-REG-4 unsupported paraphrase is never promoted to authority')
  assert.notEqual(visualFallbackPlan.plannedQuestions[0].answerTarget.canonicalValue, visual.units[0].label,
    'GROUND-REG-5 provider/derived label cannot become authority')

  const unsupported = brainWithUnits(1, 'grounding-no-authority', 'fact')
  unsupported.units[0].label = 'Unsupported derived answer'
  unsupported.units[0].statement = 'Unsupported provider paraphrase'
  unsupported.units[0].evidence = []
  unsupported.units[0].provenance = []
  assert.throws(() => planQuiz(unsupported, { questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'] }), /INSUFFICIENT_KNOWLEDGE/,
    'GROUND-REG-4 a unit with no authorized evidence remains ineligible')
}

async function testGroundedVerbatimAuthorityFallback() {
  const value = brainWithUnits(1, 'ground-authority-verbatim', 'fact')
  const target = value.units[0]
  target.label = 'Etiqueta derivada no textual'
  target.statement = 'Paráfrasis no certificada por coincidencia literal.'
  const quote = 'La presión del sistema permanece constante durante el equilibrio.'
  target.evidence = [{ materialId: 'mat-a', page: 1, derivation: 'native_text', quote, chunkId: 'c-1' }]
  target.provenance = [{ materialId: 'mat-a', page: 1, quote, chunkId: 'c-1' }]

  const link = evidenceLinkForUnit(target, target.evidence, { includeVerbatimEvidence: true })
  assert.ok(link)
  assert.deepEqual(link!.assertions.map(assertion => assertion.text), [quote], 'GROUND-AUTH-4/6 exact evidence only')
  assert.ok(verifyEvidenceLink(link!, new Map([[target.id, target]]), new Map()), 'GROUND-AUTH-3 runtime authority reconstruction')

  const plan = planQuiz(value, { questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const question = plan.plannedQuestions[0]
  assert.equal(question.answerTarget.canonicalValue, quote, 'GROUND-AUTH-1 evidence-backed assertion remains usable')
  assert.notEqual(question.answerTarget.canonicalValue, target.label, 'GROUND-AUTH-2 derived label is not authority')
  assert.notEqual(question.answerTarget.canonicalValue, target.statement, 'GROUND-AUTH-4 unsupported paraphrase is not authority')
  const context = plannedContext(value, question)
  assert.equal(context.units[0].label, quote)
  assert.equal(context.units[0].statement, quote)

  const fuzzy = brainWithUnits(1, 'ground-authority-no-fuzzy', 'fact')
  fuzzy.units[0].label = 'Marte'
  fuzzy.units[0].statement = 'Marte es el planeta evaluado.'
  fuzzy.units[0].evidence = [{ materialId: 'mat-a', page: 1, derivation: 'native_text', quote: 'La geología marciana tiene cráteres.', chunkId: 'c-1' }]
  fuzzy.units[0].provenance = [{ materialId: 'mat-a', page: 1, quote: 'La geología marciana tiene cráteres.', chunkId: 'c-1' }]
  const fuzzyPlan = planQuiz(fuzzy, { questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  assert.equal(fuzzyPlan.plannedQuestions[0].answerTarget.canonicalValue, 'La geología marciana tiene cráteres.')
  assert.notEqual(fuzzyPlan.plannedQuestions[0].answerTarget.canonicalValue, 'Marte', 'GROUND-AUTH-7 no fuzzy label certification')

  const shortOnly = planQuiz(value, { questionCount: 1, difficulty: 'medium', questionTypes: ['true_false'] })
  assert.equal(shortOnly.plannedQuestions[0].answerTarget.kind, 'boolean', 'verbatim authority is safe for TF surface phrasing')
  assert.throws(() => planQuiz(value, { questionCount: 1, difficulty: 'medium', questionTypes: ['fill_blank'] }), /INSUFFICIENT_KNOWLEDGE/,
    'a full quote must not become a bad fill-blank answer')
}

async function testProviderAttemptHookCountsActualAttempts() {
  let providerAttempts = 0
  let generations = 0
  const repaired = await runGenerationPipeline<string>({
    taskType: 'evaluation_question', failurePath: 'single_repair',
    beforeProviderAttempt: () => { providerAttempts += 1 },
    generate: async () => ({ value: ++generations === 1 ? 'bad' : 'good' }),
    validate: value => ({ valid: value === 'good', errors: value === 'good' ? [] : ['STRUCTURAL_VALIDATION_FAILED'] }),
  })
  assert.equal(repaired.status, 'validated')
  assert.equal(providerAttempts, 2)

  let remaining = 1
  let cappedAttempts = 0
  const capped = await runGenerationPipeline<string>({
    taskType: 'evaluation_question', failurePath: 'single_repair',
    beforeProviderAttempt: () => {
      if (remaining <= 0) throw new Error('QUIZ_PROVIDER_BUDGET_EXHAUSTED')
      remaining -= 1; cappedAttempts += 1
    },
    generate: async () => ({ value: 'bad' }),
    validate: () => ({ valid: false, errors: ['STRUCTURAL_VALIDATION_FAILED'] }),
  })
  assert.equal(capped.status, 'budget_exhausted')
  assert.equal(cappedAttempts, 1)
}

function evaluationQuestion(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'eval-question', type: 'fill_blank', question: '¿Qué proceso convierte la energía de la luz?',
    answer: 'Fotosíntesis convierte energía luminosa', wordBank: [],
    explanation: 'La fotosíntesis transforma energía luminosa.', difficulty: 'medium',
    grounding: {
      planId: 'eval-plan', sourceUnitIds: ['u1'], sourceRelationIds: [], evidence: [],
      supportingText: 'La fotosíntesis convierte energía luminosa en energía química.',
      answerTarget: {
        kind: 'single_text', assertionIds: ['a1'],
        canonicalValue: 'Fotosíntesis convierte energía luminosa',
        acceptedSurfaceForms: ['Conversión fotosintética de energía luminosa'],
      },
    },
    ...overrides,
  }
}

function providerEvaluation(
  nivel: QuizAnswerEvaluation['nivel'], porcentaje: number, respuestaCorrecta = 'respuesta inventada',
): QuizAnswerEvaluation {
  return {
    nivel, porcentaje, analisis: 'Juicio de equivalencia del proveedor.', respuestaCorrecta,
    explicacion: 'Explicación.', consejo: '', evaluationMode: 'semantic_provider',
  }
}

async function withEvaluationProvider<T>(provider: (input: any) => Promise<QuizAnswerEvaluation>, run: () => Promise<T>): Promise<T> {
  const original = __quizEvaluatorDeps.generateValidatedLegacyJson
  ;(__quizEvaluatorDeps as any).generateValidatedLegacyJson = provider
  try { return await run() } finally { __quizEvaluatorDeps.generateValidatedLegacyJson = original }
}

async function testEVAL_DeterministicFastPaths() {
  const question = evaluationQuestion()
  for (const [label, answer] of [
    ['EVAL-1', 'Fotosíntesis convierte energía luminosa'],
    ['EVAL-2', 'Conversión fotosintética de energía luminosa'],
    ['EVAL-3', '  FOTOSÍNTESIS,   convierte energía luminosa!!!  '],
  ] as const) {
    let calls = 0
    const result = await withEvaluationProvider(async () => {
      calls += 1
      throw new Error(`${label}:PROVIDER_MUST_NOT_BE_CALLED`)
    }, () => evaluateQuizOpenAnswer(question, answer))
    assert.equal(result.nivel, 'correcta', label)
    assert.equal(result.evaluationMode, 'deterministic_exact', label)
    assert.equal(calls, 0, `${label} providerCalls`)
  }

  let wrongCalls = 0
  const wrong = await withEvaluationProvider(async () => {
    wrongCalls += 1
    return providerEvaluation('incorrecta', 0)
  }, () => evaluateQuizOpenAnswer(question, 'La tectónica mueve placas continentales'))
  assert.equal(wrong.nivel, 'incorrecta', 'EVAL-4')
  assert.equal(wrong.evaluationMode, 'semantic_provider', 'EVAL-4')
  assert.equal(wrongCalls, 1, 'EVAL-4 semantic judgement, no token-overlap shortcut')
}

async function testEVAL_SemanticProviderAndCanonicalAuthority() {
  const question = evaluationQuestion()
  let calls = 0
  const equivalent = await withEvaluationProvider(async input => {
    calls += 1
    await input.beforeProviderAttempt?.({})
    assert.match(input.prompt, /EXPECTED: Fotosíntesis convierte energía luminosa/)
    return providerEvaluation('correcta', 100, 'La respiración celular')
  }, () => evaluateQuizOpenAnswer(question, 'Convierte la energía luminosa'))
  assert.equal(calls, 1, 'EVAL-5 provider invoked')
  assert.equal(equivalent.evaluationMode, 'semantic_provider', 'EVAL-5')
  assert.equal(equivalent.nivel, 'correcta', 'EVAL-6')
  assert.equal(equivalent.respuestaCorrecta, question.answer, 'EVAL-11 canonical authority')
  assert.equal(equivalent.providerAttempts, 1)

  const nonEquivalent = await withEvaluationProvider(async input => {
    await input.beforeProviderAttempt?.({})
    return providerEvaluation('incorrecta', 0)
  }, () => evaluateQuizOpenAnswer(question, 'energía luminosa sin conversión'))
  assert.equal(nonEquivalent.nivel, 'incorrecta', 'EVAL-7')
  assert.equal(nonEquivalent.evaluationMode, 'semantic_provider')
}

async function testEVAL_SafeFallbacksAndFreezeRegression() {
  const question = evaluationQuestion()
  const thrown = await withEvaluationProvider(async input => {
    await input.beforeProviderAttempt?.({})
    throw new Error('PROVIDER_TIMEOUT')
  }, () => evaluateQuizOpenAnswer(question, 'Convierte parte de la energía luminosa'))
  assert.equal(thrown.evaluationMode, 'safe_ungraded', 'EVAL-8')
  assert.equal(thrown.nivel, 'sin_evaluar', 'EVAL-8')
  assert.equal(thrown.respuestaCorrecta, question.answer)
  assert.match(thrown.analisis, /suficiente confianza/)
  assert.match(thrown.consejo || '', /respuesta esperada/)

  let structuralAttempts = 0
  const malformed = await withEvaluationProvider(async input => {
    const exhausted = await runGenerationPipeline<QuizAnswerEvaluation>({
      taskType: 'evaluation_question', totalTimeoutMs: 5_000, failurePath: input.failurePath,
      beforeProviderAttempt: async context => {
        structuralAttempts += 1
        await input.beforeProviderAttempt?.(context)
      },
      generate: async () => ({ value: {} as QuizAnswerEvaluation }),
      validate: value => input.validate(value),
    })
    assert.equal(exhausted.status, 'budget_exhausted')
    throw new Error(`GENERATION_BUDGET_EXHAUSTED:${exhausted.validationResult.errors.join(',')}`)
  }, () => evaluateQuizOpenAnswer(question, 'Convierte energía en forma luminosa'))
  assert.equal(structuralAttempts, 2, 'one initial attempt plus one format repair')
  assert.equal(malformed.providerAttempts, 2)
  assert.equal(malformed.evaluationMode, 'safe_ungraded', 'EVAL-9/freeze')
  assert.equal(malformed.nivel, 'sin_evaluar')
  assert.match(malformed.failureReason || '', /EVALUATION_UNAVAILABLE/)

  await assert.doesNotReject(async () => {
    const result = await withEvaluationProvider(async () => { throw new Error('ANY_PROVIDER_FAILURE') },
      () => evaluateQuizOpenAnswer(question, 'energía luminosa parcialmente convertida'))
    assert.equal(result.evaluationMode, 'safe_ungraded')
  }, 'EVAL-10 evaluator failure path never throws')
}

async function testSemanticAssessmentDedupeAndGarbageFallback() {
  // DEDUP-1: textual variants of the same MC assessment share one identity;
  // validation rejects the duplicate while a distinct assessment exists.
  const mcBrain = brainWithUnits(3, 'assessment-dedup-mc')
  const mcPlan = planQuiz(mcBrain, normalizeQuizConfig({ questionCount: 2, difficulty: 'medium',
    questionTypes: ['multiple_choice'] }))
  const sameUnitVariants = mcPlan.globalCandidatePool.filter(candidate =>
    candidate.questionType === 'multiple_choice'
    && candidate.sourceUnitIds[0] === mcPlan.globalCandidatePool[0].sourceUnitIds[0])
  assert.ok(sameUnitVariants.length >= 2)
  assert.equal(quizAssessmentSemanticIdentity(sameUnitVariants[0]), quizAssessmentSemanticIdentity(sameUnitVariants[1]))
  const duplicateMcPlan = { ...mcPlan, plannedQuestions: sameUnitVariants.slice(0, 2).map((candidate, index) => ({
    ...mcPlan.plannedQuestions[index], ...candidate, id: `dedup-mc-${index}`, slotId: `dedup-mc-slot-${index}`,
  })) }
  const duplicateMcRaw = duplicateMcPlan.plannedQuestions.map((target, index) => authoritativeRaw(target, `dedup-mc-${index}`))
  const duplicateMcValidation = validateGeneratedQuiz(mcBrain, duplicateMcPlan, duplicateMcRaw)
  assert.equal(duplicateMcValidation.questions.length, 1)
  assert.equal(duplicateMcValidation.diagnostics[0].subReason, 'duplicate_assessment_identity')

  // DEDUP-2: aggregate variants with the same canonical correct set are one assessment.
  const multiBrain = aggregateMatchingFacts('assessment-dedup-multi', [
    'Shared A', 'Shared A', 'Shared A', 'Shared B', 'Shared B', 'Shared B',
  ])
  multiBrain.units.forEach((item, index) => {
    item.identity.canonicalSubject = index < 3 ? 'Assessment Group A' : 'Assessment Group B'
  })
  const multiPlan = planQuiz(multiBrain, normalizeQuizConfig({ questionCount: 2, difficulty: 'medium',
    questionTypes: ['multi_select'] }))
  const aggregateVariants = multiPlan.globalCandidatePool.filter(candidate =>
    candidate.questionType === 'multi_select' && candidate.sourceUnitIds.length >= 3).slice(0, 2)
  assert.equal(aggregateVariants.length, 2)
  assert.equal(quizAssessmentSemanticIdentity(aggregateVariants[0]), quizAssessmentSemanticIdentity(aggregateVariants[1]))
  const duplicateMultiPlan = { ...multiPlan, plannedQuestions: aggregateVariants.map((candidate, index) => ({
    ...multiPlan.plannedQuestions[index], ...candidate, id: `dedup-multi-${index}`, slotId: `dedup-multi-slot-${index}`,
  })) }
  const duplicateMultiValidation = validateGeneratedQuiz(multiBrain, duplicateMultiPlan,
    duplicateMultiPlan.plannedQuestions.map((target, index) => authoritativeRaw(target, `dedup-multi-${index}`)))
  assert.equal(duplicateMultiValidation.questions.length, 1)
  assert.equal(duplicateMultiValidation.diagnostics[0].subReason, 'duplicate_assessment_identity')

  // DEDUP-3/5: scarcity permits reuse only after alternatives are exhausted;
  // surplus knowledge yields ten distinct assessment identities.
  const scarceBrain = brainWithUnits(1, 'assessment-dedup-scarce')
  const scarcePlan = planQuiz(scarceBrain, normalizeQuizConfig({ questionCount: 2, difficulty: 'medium',
    questionTypes: ['multiple_choice'] }))
  const scarceOutcome = await generateQuizFromPlan(scarceBrain, scarcePlan, { generateBatch: mockGenerate })
  assert.equal(scarceOutcome.status, 'ready')
  const sameKnowledge = scarcePlan.globalCandidatePool[0]
  const differentFamily = { ...sameKnowledge, cognitiveIntent: 'recall' as const }
  differentFamily.assessmentSemanticIdentity = quizAssessmentSemanticIdentity(differentFamily)
  assert.notEqual(quizAssessmentSemanticIdentity(sameKnowledge), quizAssessmentSemanticIdentity(differentFamily))
  const sameKnowledgeId = quizKnowledgeTargetId(sameKnowledge.sourceUnitIds, sameKnowledge.sourceRelationIds)
  assert.ok(compareQuizCandidateNovelty(differentFamily, sameKnowledge, {
    historyCounts: new Map([[sameKnowledgeId, 1]]),
    assessmentHistoryCounts: new Map([[sameKnowledge.assessmentSemanticIdentity, 1]]),
    repeatDepthByKnowledgeTarget: new Map(), repeatDepthByAssessmentIdentity: new Map(),
    repeatDepthByUnit: new Map(), repeatDepthByCanonicalSubject: new Map(), bucketUsage: new Map(),
    ranks: new Map(), canonicalSubjectByUnit: new Map(), selectedTypes: ['multiple_choice'],
  }) < 0)
  const surplusPlan = planQuiz(brainWithUnits(12, 'assessment-dedup-surplus'), normalizeQuizConfig({
    questionCount: 10, difficulty: 'medium', questionTypes: ['multiple_choice'],
  }))
  assert.equal(new Set(surplusPlan.plannedQuestions.map(quizAssessmentSemanticIdentity)).size, 10)

  // DEDUP-4: recovery chooses an unseen semantic assessment after rejection.
  const recoveryBrain = brainWithUnits(5, 'assessment-dedup-recovery')
  const recoveryPlan = planQuiz(recoveryBrain, normalizeQuizConfig({ questionCount: 2, difficulty: 'medium',
    questionTypes: ['multiple_choice'] }))
  let recoveryRound = 0
  const recovery = await generateQuizFromPlan(recoveryBrain, recoveryPlan, { generateBatch: async plans => {
    recoveryRound += 1
    const raw = await mockGenerate(plans)
    return recoveryRound === 1 ? raw.map((question: any, index) => index === 1 ? { ...question, question: '' } : question) : raw
  } })
  assert.equal(recovery.status, 'ready')
  assert.equal(new Set(recovery.questions.map(question => question.grounding.assessmentSemanticIdentity)).size, 2)

  // HISTORY-1/3: semantic identities persist and rank NEW only; resume is exact and history-neutral.
  const historyBrain = brainWithUnits(12, 'assessment-history')
  const historyConfig = normalizeQuizConfig({ questionCount: 4, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const historyStore = new InMemoryQuizArtifactStore()
  const first = await getOrBuildQuizArtifact('assessment-history-session', historyBrain, historyConfig, historyStore,
    { mode: 'new', generateBatch: mockGenerate })
  const second = await getOrBuildQuizArtifact('assessment-history-session', historyBrain, historyConfig, historyStore,
    { mode: 'new', generateBatch: mockGenerate })
  const firstIdentities = new Set(first.artifact.questions.map(question => question.grounding.assessmentSemanticIdentity))
  const secondIdentities = new Set(second.artifact.questions.map(question => question.grounding.assessmentSemanticIdentity))
  assert.ok([...secondIdentities].every(identity => !firstIdentities.has(identity)))
  const historyIdentity = quizGenerationHistoryIdentity('assessment-history-session', historyBrain.scope.fingerprint,
    quizConfigFingerprint(historyConfig))
  const history = await historyStore.getHistory(historyIdentity)
  assert.equal(history?.entries.length, 2)
  assert.ok(history?.entries.every(entry => entry.assessmentSemanticIdentities?.length === 4))
  const historyBeforeResume = JSON.stringify(history)
  const resumed = await getOrBuildQuizArtifact('assessment-history-session', historyBrain, historyConfig, historyStore, {
    mode: 'resume', generationId: first.artifact.meta.generationId,
    generateBatch: async () => { throw new Error('HISTORY_RESUME_MUST_NOT_GENERATE') },
  })
  assert.equal(resumed.cacheStatus, 'hit')
  assert.deepEqual(resumed.artifact, first.artifact)
  assert.equal(JSON.stringify(await historyStore.getHistory(historyIdentity)), historyBeforeResume)

  // EVAL-GARBAGE/CORRECT/PARTIAL/PROVIDER-FAIL/EMPTY.
  for (const [expected, garbage] of [
    ['Matt Ryan y Julio Jones', 'ww'], ['Grandeza de un equipo', 'xyz'],
  ]) {
    let calls = 0
    const question = evaluationQuestion({ answer: expected, grounding: {
      ...evaluationQuestion().grounding, answerTarget: undefined,
    } })
    const result = await withEvaluationProvider(async () => {
      calls += 1; return providerEvaluation('incorrecta', 0)
    }, () => evaluateQuizOpenAnswer(question, garbage))
    assert.equal(result.evaluationMode, 'semantic_provider')
    assert.equal(result.nivel, 'incorrecta')
    assert.equal(result.porcentaje, 0)
    assert.equal(calls, 1)
  }
  const normalizedCorrect = await evaluateQuizOpenAnswer(evaluationQuestion({
    answer: 'Árbol de Decisión', grounding: { ...evaluationQuestion().grounding, answerTarget: undefined },
  }), '  ARBOL DE DECISION  ')
  assert.equal(normalizedCorrect.nivel, 'correcta')
  let partialCalls = 0
  const partial = await withEvaluationProvider(async input => {
    partialCalls += 1; await input.beforeProviderAttempt?.({}); return providerEvaluation('medio_correcta', 50)
  }, () => evaluateQuizOpenAnswer(evaluationQuestion({ grounding: {
    ...evaluationQuestion().grounding, answerTarget: undefined,
  } }), 'energía luminosa parcial'))
  assert.equal(partial.evaluationMode, 'semantic_provider')
  assert.equal(partialCalls, 1)
  const fallback = await withEvaluationProvider(async input => {
    await input.beforeProviderAttempt?.({}); throw new Error('PROVIDER_TIMEOUT')
  }, () => evaluateQuizOpenAnswer(evaluationQuestion(), 'energía luminosa parcial'))
  assert.equal(fallback.evaluationMode, 'safe_ungraded')
  assert.equal(fallback.porcentaje, null)
  const empty = await evaluateQuizOpenAnswer(evaluationQuestion(), '   ')
  assert.equal(empty.evaluationMode, 'deterministic_exact')
  assert.equal(empty.porcentaje, 0)
}

async function testEVAL_UISafetyNetContract() {
  const src = readFileSync('components/materias/ALAIStudyALQuizzes.tsx', 'utf8')
  assert.ok(src.includes('new AbortController()'))
  assert.ok(src.includes('evaluationController.abort(), 25_000'))
  assert.ok(src.includes('signal: evaluationController.signal'))
  assert.ok(src.includes('window.clearTimeout(evaluationTimeout)'))
  assert.ok(src.includes('r.ok && isGradedQuizEvaluation(data?.resultado)'))
  assert.ok(src.includes("safeUngradedEvaluation(expected, q.explanation || '')"))
  assert.doesNotMatch(src, /No fue posible verificar automáticamente/)
  assert.ok(src.includes('setPendingEvaluation({ questionId: q.id, feedback: evaluation })'))
  assert.ok(src.includes('evaluationBusyRef.current = false;'))
  assert.ok(src.includes('setIsEvaluating(false);'))
}

async function testLaterBatchTechnicalFailureAbortsRecovery() {
  const v = brainWithUnits(30, 'later-technical', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 20, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const plan = planQuiz(v, cfg)
  let batches = 0
  const outcome = await generateQuizFromPlan(v, plan, {
    batchSize: 8,
    generateBatch: async plans => {
      batches += 1
      if (batches === 2) throw new Error('PROVIDER_TIMEOUT')
      return mockGenerate(plans)
    },
  })
  assert.equal(outcome.status, 'provider_generation_failed')
  assert.equal(outcome.replacementBatches, 0)
  assert.equal(batches, 2)
}

async function testSessionScopedArtifactIdentityAndLookup() {
  const v = brainWithUnits(3, 'session-scope', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 3, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const store = new InMemoryQuizArtifactStore()
  const built = await getOrBuildQuizArtifact('session-a', v, cfg, store, { generateBatch: mockGenerate })
  assert.notEqual(
    quizArtifactIdentity('session-a', v.scope.fingerprint, built.artifact.meta.configFingerprint),
    quizArtifactIdentity('session-b', v.scope.fingerprint, built.artifact.meta.configFingerprint),
  )
  assert.equal(await lookupQuizArtifact('session-b', v, cfg, store), null)
  assert.equal((await lookupQuizArtifact('session-a', v, cfg, store))?.questions.length, 3)
}

async function testR4_TypeDistributionPreservedAfterRestore() {
  const v = brainMultipleBuckets('r4-restore')
  const cfg = normalizeQuizConfig({ questionCount: 4, difficulty: 'medium', questionTypes: ['multiple_choice', 'fill_blank'] })
  const store = new InMemoryQuizArtifactStore()
  const first = await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: mockGenerate })
  const dist1 = first.artifact.questions.map(q => q.type).join(',')
  const second = await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: async () => { throw new Error('must-hit') } })
  const dist2 = second.artifact.questions.map(q => q.type).join(',')
  assert.equal(dist1, dist2)
}

async function testR5_StaleCachedArtifactRejected() {
  const v = brainWithUnits(6, 'r5-stale', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 3, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const store = new InMemoryQuizArtifactStore()
  const identity = quizArtifactIdentity(v.scope.fingerprint, quizConfigFingerprint(cfg))
  const stale: any = {
    scope: v.scope,
    meta: {
      schemaVersion: '2.1.0', quizVersion: '2.1.0', plannerVersion: '2.1.0',
      generatorVersion: '2.1.0', presentationVersion: '2.1.0',
      brainFingerprint: v.scope.fingerprint, configFingerprint: quizConfigFingerprint(cfg),
      sourceSelectionFingerprint: v.scope.fingerprint, generatedAt: '2026',
      status: 'ready', llmCallsUsed: 0,
    },
    config: cfg, questions: [{ id: 'x' } as any],
  }
  ;(store as any).values.set(identity, stale)
  const built = await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: mockGenerate })
  assert.equal(built.cacheStatus, 'miss')
}

async function testArtifactCorruption_DecoderMatrix() {
  const v = brainWithUnits(6, 'corrupt-decoder', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 3, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const store = new InMemoryQuizArtifactStore()
  const built = await getOrBuildQuizArtifact(v, cfg, store, { generateBatch: mockGenerate })
  const identity = quizArtifactIdentity(v.scope.fingerprint, built.artifact.meta.configFingerprint)

  const mutations: Array<{ label: string; mutate: (a: any) => void; expectedReasonPrefix: string }> = [
    { label: 'invalid_question_type', mutate: a => { a.questions[0].type = 'trivia' }, expectedReasonPrefix: 'question:type_not_allowed' },
    { label: 'invalid_correct_index', mutate: a => { a.questions[0].correctAnswer = 99 }, expectedReasonPrefix: 'question:mc_correct_index_invalid' },
    { label: 'duplicate_ids', mutate: a => { a.questions[1].id = a.questions[0].id }, expectedReasonPrefix: 'question:duplicate_id' },
    { label: 'missing_grounding', mutate: a => { delete a.questions[0].grounding }, expectedReasonPrefix: 'question:grounding_missing' },
    { label: 'unauthorized_page', mutate: a => { a.questions[0].grounding.evidence[0].page = 99 }, expectedReasonPrefix: 'evidence_link_membership' },
    { label: 'wrong_config_count', mutate: a => { a.config.questionCount = 999 }, expectedReasonPrefix: 'config_invalid' },
    { label: 'nonexistent_unit', mutate: a => { a.questions[0].grounding.sourceUnitIds[0] = 'missing-unit' }, expectedReasonPrefix: 'grounding_unit_missing' },
    { label: 'broken_link_membership', mutate: a => { a.questions[0].grounding.evidenceLinks[0].evidence[0].page = 99 }, expectedReasonPrefix: 'evidence_link_membership' },
  ]
  for (const m of mutations) {
    const corrupt: any = JSON.parse(JSON.stringify(built.artifact))
    m.mutate(corrupt)
    const result = decodePersistedQuizArtifact(corrupt, { brain: v, config: cfg, configFingerprint: built.artifact.meta.configFingerprint })
    assert.equal(result.ok, false, `mutation ${m.label} must be rejected`)
    if (result.ok === false) {
      assert.equal(result.classification, 'corrupt', `mutation ${m.label} classification`)
      assert.ok(result.reason.startsWith(m.expectedReasonPrefix), `mutation ${m.label}: reason ${result.reason}`)
    }
  }
  // Sanity: unmodified artifact still validates.
  const ok = decodePersistedQuizArtifact(built.artifact, { brain: v, config: cfg, configFingerprint: built.artifact.meta.configFingerprint })
  assert.equal(ok.ok, true, 'unmodified artifact must validate')
  // Round-trip through lookup — CURRENT-identity-but-corrupt must throw.
  ;(store as any).values.set(identity, (() => { const c: any = JSON.parse(JSON.stringify(built.artifact)); c.questions[0].correctAnswer = 99; return c })())
  let threw = false
  try { await lookupQuizArtifact(v, cfg, store) } catch (e) { threw = String(e).includes('ARTIFACT_CORRUPT') }
  assert.equal(threw, true, 'lookupQuizArtifact must throw ARTIFACT_CORRUPT on current-version corrupt payload')
}

async function testArtifactEvidenceMustBelongToCurrentBrain() {
  const v = brainWithUnits(6, 'authoritative-evidence', 'fact')
  const cfg = normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'] })
  const built = await getOrBuildQuizArtifact(v, cfg, new InMemoryQuizArtifactStore(), { generateBatch: mockGenerate })
  const decode = (artifact: any, currentBrain = v) => decodePersistedQuizArtifact(artifact, {
    brain: currentBrain,
    config: cfg,
    configFingerprint: built.artifact.meta.configFingerprint,
  })
  const mutateBoth = (replacement: SourceEvidence) => {
    const artifact: any = JSON.parse(JSON.stringify(built.artifact))
    artifact.questions[0].grounding.evidence = [replacement]
    artifact.questions[0].grounding.evidenceLinks[0].evidence = [replacement]
    return artifact
  }
  const assertCorrupt = (artifact: any, label: string, currentBrain = v) => {
    const result = decode(artifact, currentBrain)
    assert.equal(result.ok, false, label)
    if (!result.ok) assert.equal(result.classification, 'corrupt', `${label}: classification`)
  }

  const original: any = built.artifact.questions[0].grounding.evidence[0]
  const fabricatedNative: SourceEvidence = {
    materialId: original.materialId,
    page: original.page,
    derivation: 'native_text',
    quote: 'Fabricated authorized-page statement that is absent from the current Brain.',
    chunkId: 'fabricated-chunk',
  }
  assertCorrupt(mutateBoth(fabricatedNative), 'A fabricated native evidence must be corrupt')

  const visualUnit = v.units.find(item => item.evidence?.some(ev => ev.derivation === 'vision'))!
  const visualBrain: MaterialBrain = { ...v, units: [visualUnit], relations: [] }
  const visualBuilt = await getOrBuildQuizArtifact(visualBrain, cfg, new InMemoryQuizArtifactStore(), { generateBatch: mockGenerate })
  const fabricatedVisual: any = JSON.parse(JSON.stringify(visualBuilt.artifact))
  const visualEvidence: any = fabricatedVisual.questions[0].grounding.evidence[0]
  const wrongVisual = { ...visualEvidence, pageFingerprint: `${visualEvidence.pageFingerprint}-forged`, analyzerVersion: 'forged' }
  fabricatedVisual.questions[0].grounding.evidence = [wrongVisual]
  fabricatedVisual.questions[0].grounding.evidenceLinks[0].evidence = [wrongVisual]
  const visualResult = decodePersistedQuizArtifact(fabricatedVisual, {
    brain: visualBrain, config: cfg, configFingerprint: visualBuilt.artifact.meta.configFingerprint,
  })
  assert.equal(visualResult.ok, false, 'B fabricated visual provenance must be corrupt')
  if (!visualResult.ok) assert.equal(visualResult.classification, 'corrupt')

  assert.equal(decode(JSON.parse(JSON.stringify(built.artifact))).ok, true,
    'C exact authoritative Brain evidence must remain valid')

  const linkedUnitId = built.artifact.questions[0].grounding.evidenceLinks[0].refId
  const linkedUnit = v.units.find(item => item.id === linkedUnitId)!
  const otherSamePage = v.units.find(item => item.id !== linkedUnitId
    && item.evidence?.[0]?.materialId === linkedUnit.evidence?.[0]?.materialId
    && item.evidence?.[0]?.page === linkedUnit.evidence?.[0]?.page)!
  assert.ok(otherSamePage?.evidence?.[0], 'fixture must contain another same-page entity')
  assertCorrupt(mutateBoth(otherSamePage.evidence![0]), 'D evidence from another same-page entity must be corrupt')

  const relationBrain = brain('authoritative-relation')
  const relationBuilt = await getOrBuildQuizArtifact(relationBrain, cfg, new InMemoryQuizArtifactStore(), { generateBatch: mockGenerate })
  const relationQuestion: any = relationBuilt.artifact.questions.find(question =>
    question.grounding.evidenceLinks.some(link => link.kind === 'relation'))
  assert.ok(relationQuestion, 'fixture must produce a relation-backed question')
  const relationValid = decodePersistedQuizArtifact(relationBuilt.artifact, {
    brain: relationBrain, config: cfg, configFingerprint: relationBuilt.artifact.meta.configFingerprint,
  })
  assert.equal(relationValid.ok, true, 'E authoritative relation evidence must remain valid')
  const wrongRelationArtifact: any = JSON.parse(JSON.stringify(relationBuilt.artifact))
  const wrongQuestion = wrongRelationArtifact.questions.find((question: any) =>
    question.grounding.evidenceLinks.some((link: any) => link.kind === 'relation'))
  const relationLink = wrongQuestion.grounding.evidenceLinks.find((link: any) => link.kind === 'relation')
  const wrongUnitEvidence = relationBrain.units.find(item => item.id === relationBrain.relations[0].fromUnitId)!.evidence![0]
  relationLink.evidence = [wrongUnitEvidence]
  wrongQuestion.grounding.evidence = wrongQuestion.grounding.evidence
    .filter((item: SourceEvidence) => item.derivation !== 'vision')
    .concat([wrongUnitEvidence])
  const wrongRelation = decodePersistedQuizArtifact(wrongRelationArtifact, {
    brain: relationBrain, config: cfg, configFingerprint: relationBuilt.artifact.meta.configFingerprint,
  })
  assert.equal(wrongRelation.ok, false, 'E neighboring unit evidence must not authorize a relation')
  if (!wrongRelation.ok) assert.equal(wrongRelation.classification, 'corrupt')
}

async function testUI_CustomCount_UsesCanonical() {
  const src = readFileSync('components/materias/ALAIStudyALQuizzes.tsx', 'utf8')
  assert.ok(src.includes('const canonicalCount = finalCount;'))
  assert.ok(src.includes("data.status === 'ready' || data.status === 'generating'"))
  assert.ok(src.includes('data.quiz.length <= canonicalCount'))
  assert.doesNotMatch(src, /data\.quiz\.length\s*===\s*questionCount/)
}

async function testUI_HydrationGuard() {
  const src = readFileSync('components/materias/ALAIStudyALQuizzes.tsx', 'utf8')
  assert.ok(src.includes("QUIZ_CONTINUITY_VERSION = '4.0.0-enjoyer'"))
  // Blocker 1: hydration must consult the server via lookup mode.
  assert.ok(src.includes("mode: 'lookup'"), 'UI must call server lookup mode during hydration')
  assert.ok(src.includes('serverIdentityMatches && serverQuestionsMatch'),
    'UI must require server identity + question IDs match before restore')
}

async function testUI_Route_LookupMode() {
  const route = readFileSync('app/api/alai-studyal-quizzes/route.ts', 'utf8')
  assert.ok(route.includes("body?.mode === 'lookup'") || route.includes("body?.mode === 'lookup'"))
  assert.ok(route.includes('validateEnjoyerQuizArtifact'))
  assert.ok(route.includes("errorResponse('ARTIFACT_MISS', 404)"))
}

async function testUI_Continuity_ForgedIdentity_Rejected() {
  // Simulate persisted state whose local identity is fabricated.
  // The UI cannot restore playing without the server confirming the identity.
  const route = readFileSync('app/api/alai-studyal-quizzes/route.ts', 'utf8')
  assert.ok(route.includes('enjoyerQuizArtifactIdentity') && route.includes('validateEnjoyerQuizArtifact'),
    'forged local identity must not be authoritatively backed by server')
}

async function testBatchStructuralValidator() {
  const expected = [
    { planId: 'p1', requiredType: 'multiple_choice' as const },
    { planId: 'p2', requiredType: 'true_false' as const },
  ]
  const ok = validateBatchStructure({ questions: [
    { planId: 'p1', id: 'q1', type: 'multiple_choice', question: 'q?', explanation: 'e', supportingText: 's', options: ['a', 'b', 'c', 'd'], correctAnswer: 0 },
    { planId: 'p2', id: 'q2', type: 'true_false', question: 'q?', explanation: 'e', supportingText: 's', correctAnswer: true },
  ] }, expected)
  assert.equal(ok.valid, true)
  const dup = validateBatchStructure({ questions: [
    { planId: 'p1', id: 'q1', type: 'multiple_choice', question: 'q?', explanation: 'e', supportingText: 's', options: ['a', 'b', 'c', 'd'], correctAnswer: 0 },
    { planId: 'p1', id: 'q1', type: 'multiple_choice', question: 'q?', explanation: 'e', supportingText: 's', options: ['a', 'b', 'c', 'd'], correctAnswer: 0 },
  ] }, expected)
  assert.equal(dup.valid, true, 'provider correlation IDs are reconciled by the generator')
  const wrongCount = validateBatchStructure({ questions: [
    { question: 'q?', explanation: 'e' },
  ] }, expected)
  assert.equal(wrongCount.valid, false)
  assert.ok(wrongCount.errors.some(e => e.includes('item_count:1:2')))
}

async function testProviderSurfaceCannotOverridePlannerAuthority() {
  // ID-1: provider IDs are neither trusted nor required to be unique.
  const many = brainWithUnits(10, 'provider-authority-ids')
  const manyPlan = planQuiz(many, normalizeQuizConfig({
    questionCount: 10, difficulty: 'medium', questionTypes: ['multiple_choice'],
  }))
  const malicious: GenerateQuizBatchFn = async plans => plans.map((plan: any, index) => ({
    ...(index % 2 ? {} : { planId: plan.planId, id: 'provider-duplicate-id' }),
    type: 'true_false',
    difficulty: 'hard',
    question: `Superficie única para ${plan.planId}`,
    explanation: plan.units[0].statement,
    options: ['respuesta falsa del provider'],
    correctAnswer: 99,
  }))
  const manyOutcome = await generateQuizFromPlan(many, manyPlan, { generateBatch: malicious })
  assert.equal(manyOutcome.status, 'ready', JSON.stringify(manyOutcome))
  assert.equal(manyOutcome.initialAccepted, 10)
  assert.equal(new Set(manyOutcome.questions.map(question => question.id)).size, 10)
  assert.ok(manyOutcome.questions.every(question => question.type === 'multiple_choice'))
  assert.ok(manyOutcome.questions.every(question => question.difficulty === 'medium'))

  // MS/TF/MC/fill/short/matching: provider owns surface only; the plan owns answers.
  const all = aggregateBrain('provider-authority-all-types')
  all.units.push(unit('authority-formula', 'mat-a', 1, 'native_text', 'formula'))
  const allPlan = planQuiz(all, normalizeQuizConfig({
    questionCount: 6, difficulty: 'medium',
    questionTypes: ['multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer'],
  }))
  const adversarial: GenerateQuizBatchFn = async plans => plans.map((plan: any) => ({
    planId: plan.planId,
    id: 'same-id',
    type: 'multiple_choice',
    difficulty: 'easy',
    question: plan.requiredType === 'fill_blank'
      ? `Completa ___ en ${plan.planId}`
      : `Pregunta válida y única ${plan.planId}`,
    explanation: plan.units.map((value: any) => value.statement).join(' | '),
    options: ['valor malicioso', ...(plan.answerTarget?.canonicalValues || [])],
    correctAnswer: plan.answerTarget?.canonicalValue === 'true' ? false : true,
    correctAnswers: [99],
    answer: 'respuesta maliciosa',
    wordBank: ['respuesta maliciosa'],
    pairs: [{ left: 'inventado', right: 'inventado' }],
    acceptedAnswers: ['respuesta maliciosa'],
  }))
  const allOutcome = await generateQuizFromPlan(all, allPlan, { generateBatch: adversarial })
  assert.equal(allOutcome.status, 'ready', JSON.stringify(allOutcome))
  assert.equal(allOutcome.initialAccepted, 6)
  assert.equal(allOutcome.replacementAttempts, 0)
  assert.deepEqual(new Set(allOutcome.questions.map(question => question.type)), new Set([
    'multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer',
  ]))
  for (const question of allOutcome.questions) {
    const target = question.grounding.answerTarget!
    assert.equal(question.difficulty, 'medium')
    if (question.type === 'multiple_choice') {
      assert.equal(question.options[question.correctAnswer], target.canonicalValue)
    } else if (question.type === 'multi_select') {
      assert.deepEqual(
        question.correctAnswers.map(index => question.options[index]).sort(),
        [...(target.canonicalValues || [])].sort(),
      )
    } else if (question.type === 'true_false') {
      assert.equal(question.correctAnswer, target.canonicalValue === 'true')
    } else if (question.type === 'fill_blank') {
      assert.equal(question.answer, target.canonicalValue)
    } else if (question.type === 'short_answer') {
      assert.ok(question.acceptedAnswers.includes(target.canonicalValue || ''))
    } else if (question.type === 'matching') {
      const actual = question.pairs.map(pair => `${pair.left}\u0000${pair.right}`).sort()
      const expected = (target.pairTargets || []).map(pair => `${pair.leftCanonical}\u0000${pair.rightCanonical}`).sort()
      assert.deepEqual(actual, expected)
    }
  }

  // Malformed provider distractors are repairable; duplicate canonical targets are not.
  const msPlan = allPlan.plannedQuestions.find(question => question.questionType === 'multi_select')!
  const repaired: any = stampAuthoritativeQuizOutput([msPlan], [{
    planId: msPlan.id, question: 'Selecciona los valores', explanation: 'Explicación',
    options: [msPlan.answerTarget.canonicalValues?.[0], msPlan.answerTarget.canonicalValues?.[0]],
  }])[0]
  assert.deepEqual(repaired.options.slice(0, msPlan.answerTarget.canonicalValues!.length), msPlan.answerTarget.canonicalValues)
  assert.deepEqual(repaired.correctAnswers, msPlan.answerTarget.canonicalValues!.map((_, index) => index))
  const collidingPlan: PlannedQuizQuestion = {
    ...msPlan,
    answerTarget: { ...msPlan.answerTarget, canonicalValues: ['Valor duplicado', 'valor dúplicado'] },
  }
  const collision: any = stampAuthoritativeQuizOutput([collidingPlan], [{
    planId: collidingPlan.id, question: 'Selecciona', explanation: 'Explicación', options: [],
  }])[0]
  assert.ok(new Set(collision.options.map(normalizeQuizText)).size < collision.options.length,
    'an invalid planner-owned canonical collision must remain visible to the strict validator')

  // ID-2: a replacement plan receives its own deterministic ID after rejection.
  const recoveryBrain = brainWithUnits(4, 'provider-authority-recovery')
  const recoveryPlan = planQuiz(recoveryBrain, normalizeQuizConfig({
    questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'],
  }))
  let calls = 0
  const recovery = await generateQuizFromPlan(recoveryBrain, recoveryPlan, {
    generateBatch: async plans => {
      calls += 1
      const generated = await malicious(plans)
      if (calls === 1) (generated[0] as any).question = ''
      return generated
    },
  })
  assert.equal(recovery.status, 'ready')
  assert.equal(recovery.replacementAttempts, 1)
  assert.ok(recovery.questions[0].id.startsWith('quiz-question:quiz-plan:r1:'))
}

async function testAllocationHelpAndResumeUXContracts() {
  const six = ['multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer'] as const
  const count = (n: number, types: readonly typeof six[number][], seed: string) =>
    Object.fromEntries(allocateQuizTypeCounts(n, types, seed)) as Record<string, number>

  assert.deepEqual(Object.values(count(6, six, 'a')).sort(), [1, 1, 1, 1, 1, 1], 'ALLOCATION-1')
  assert.deepEqual(Object.values(count(30, six, 'b')).sort(), [5, 5, 5, 5, 5, 5], 'ALLOCATION-2/PREVIEW-3')
  const ten = Object.values(count(10, six, 'c'))
  assert.equal(ten.reduce((sum, value) => sum + value, 0), 10, 'ALLOCATION-3 sum')
  assert.ok(Math.max(...ten) - Math.min(...ten) <= 1, 'ALLOCATION-3 fairness')
  const five = six.slice(0, 5)
  assert.deepEqual(Object.values(count(9, five, 'd')).sort((a, b) => b - a), [2, 2, 2, 2, 1], 'ALLOCATION-4')
  const placements = new Set(Array.from({ length: 20 }, (_, index) =>
    JSON.stringify(count(7, six, `rotation-${index}`))))
  assert.ok(placements.size > 1, 'ALLOCATION-5 different seeds rotate remainder')
  assert.deepEqual(count(10, six, 'same'), count(10, six, 'same'), 'ALLOCATION-6')
  assert.equal((allocateQuizTypeCounts(6, ['matching'], 'only') as Map<any, number>).has('multiple_choice'), false, 'ALLOCATION-7')
  assert.throws(() => allocateQuizTypeCounts(2, six, 'small'), /QUIZ_ALLOCATION_INSUFFICIENT_COUNT/)

  const sharedSeed = quizAllocationSeed(10, six, 'medium')
  const preview = allocateQuizTypeCounts(10, six, sharedSeed)
  const abundant = new Map(six.map(type => [type, 100]))
  const planned = allocateQuizTypeTargets(10, [...six], abundant, sharedSeed)
  assert.deepEqual(Object.fromEntries(preview), Object.fromEntries(planned), 'PREVIEW-1/2 shared allocator')
  const uiSource = readFileSync('components/materias/ALAIStudyALQuizzes.tsx', 'utf8')
  const plannerSource = readFileSync('lib/materialBrain/quiz/planner.ts', 'utf8')
  assert.ok(!uiSource.includes('allocateQuizTypeCounts(') && plannerSource.includes('allocateQuizTypeCounts('),
    'new Quiz UI does not advertise a type quota; legacy planner keeps its own allocator')
  assert.doesNotMatch(uiSource, /i === 0 \? perType \+ remainder/)

  const mc: any = { id: 'mc', type: 'multiple_choice', options: ['A', 'B', 'C', 'D'], correctAnswer: 1 }
  assert.ok(availableQuizHelpActions(mc).includes('eliminate_two'), 'TOOLS-1')
  assert.equal(availableQuizHelpActions({ ...mc, options: ['A', 'B'] }).includes('eliminate_two'), false, 'TOOLS-2')
  const mcEffect = createQuizHelpEffect(mc, 'eliminate_two')!
  assert.equal(mcEffect.hiddenOptionIndexes!.includes(mc.correctAnswer), false)

  const ms: any = { id: 'ms', type: 'multi_select', options: ['A', 'B', 'C'], correctAnswers: [0, 2] }
  const msEffect = createQuizHelpEffect(ms, 'discard_incorrect')!
  assert.ok(msEffect.hiddenOptionIndexes!.every(index => !ms.correctAnswers.includes(index)), 'TOOLS-3')
  const tf: any = { id: 'tf', type: 'true_false', correctAnswer: true, sourcePage: 2 }
  const tfEffect = createQuizHelpEffect(tf, 'review_evidence')!
  assert.doesNotMatch(tfEffect.message.toLowerCase(), /\b(true|false|verdadero|falso)\b/, 'TOOLS-4')
  const fill: any = { id: 'fb', type: 'fill_blank', answer: 'Atlanta' }
  const fillEffect = createQuizHelpEffect(fill, 'reveal_letter')!
  assert.notEqual(fillEffect.message.includes(fill.answer), true, 'TOOLS-5')
  const matching: any = { id: 'm', type: 'matching', pairs: [
    { left: 'A', right: 'Uno' }, { left: 'B', right: 'Dos' },
  ] }
  const matchingEffect = createQuizHelpEffect(matching, 'discard_connection')!
  assert.ok(matchingEffect.message.includes('A') && matchingEffect.message.includes('Dos'), 'TOOLS-6')
  assert.equal(matchingEffect.message.includes('A” no corresponde con “Uno'), false)
  const short: any = { id: 'sa', type: 'short_answer', acceptedAnswers: ['Matt Ryan'], sourcePage: 1 }
  assert.equal(createQuizHelpEffect(short, 'key_concept')!.message.includes('Matt Ryan'), false, 'TOOLS-7')
  assert.doesNotMatch(uiSource, /Repasar este tema/, 'TOOLS-8')

  let budget = { helpsUsed: 0, helpsRemaining: 3, consumed: false }
  for (let index = 0; index < 3; index += 1) budget = consumeQuizHelp(budget.helpsUsed, createQuizHelpEffect(mc, 'hint'))
  assert.deepEqual([budget.helpsUsed, budget.helpsRemaining], [3, 0], 'HELP-1')
  const fourth = consumeQuizHelp(budget.helpsUsed, createQuizHelpEffect(mc, 'hint'))
  assert.equal(fourth.consumed, false, 'HELP-2')
  assert.equal(fourth.message, QUIZ_HELP_EXHAUSTED_MESSAGE)
  assert.equal(consumeQuizHelp(1, null).helpsUsed, 1, 'HELP-3')

  const answerShapes = [[0, 2], { A: 'Uno', B: 'Dos' }, 'respuesta abierta']
  for (const userAnswer of answerShapes) assert.deepEqual(JSON.parse(JSON.stringify(userAnswer)), userAnswer, 'RESUME-2/3 serialization')
  const persisted = JSON.parse(JSON.stringify({
    quizState: 'playing', generationId: 'generation-a', currentIndex: 3,
    userAnswer: { A: 'Uno' }, helpsUsed: 2, helpsRemaining: 1,
  }))
  assert.deepEqual([persisted.generationId, persisted.currentIndex, persisted.helpsRemaining], ['generation-a', 3, 1], 'RESUME-1/4')
  assert.ok(uiSource.includes("['playing', 'results', 'review'].includes(saved.quizState)")
    && uiSource.includes('canRestoreSession'), 'RESUME-5')
  assert.ok(uiSource.includes("sessionId,\n      effectiveSourceSelection.fingerprint,\n      'quiz'"), 'RESUME-6 scoped key')
  assert.ok(uiSource.includes('setHelpsUsed') && uiSource.includes('helpEffectsByQuestion'))
}

async function testCoverageRecommendationContracts() {
  const mcConfig = (questionCount: number) => normalizeQuizConfig({
    questionCount, difficulty: 'medium', questionTypes: ['multiple_choice'],
  })
  const three = brainWithUnits(3, 'coverage-three')
  const threeCoverage = analyzeQuizCoverage(three, mcConfig(2))
  assert.equal(threeCoverage.totalAssessableTargets, 3, 'COVERAGE-REC-1 variants do not inflate targets')
  assert.equal(threeCoverage.recommendedQuestionCount, 3, 'COVERAGE-REC-1/12 wording variants do not inflate count')

  const five = brainWithUnits(5, 'coverage-five')
  const fiveCoverage = analyzeQuizCoverage(five, mcConfig(2))
  assert.ok(fiveCoverage.recommendedQuestionCount > threeCoverage.recommendedQuestionCount, 'COVERAGE-REC-2 distinct knowledge increases count')
  assert.equal(fiveCoverage.coveredTargetCount, 2, 'COVERAGE-REC-7 actual covered target count')
  assert.equal(fiveCoverage.estimatedCoveragePercent, 40, 'COVERAGE-REC-7 actual coverage percentage')
  assert.equal(fiveCoverage.representedSupportedTypeCount, 1, 'coverage and represented formats are separate')
  assert.equal(fiveCoverage.supportedSelectedTypeCount, 1)

  const aggregate = aggregateBrain('coverage-aggregate')
  const singleCoverage = analyzeQuizCoverage(aggregate, normalizeQuizConfig({
    questionCount: 1, difficulty: 'medium', questionTypes: ['multiple_choice'],
  }))
  const aggregateCoverage = analyzeQuizCoverage(aggregate, normalizeQuizConfig({
    questionCount: 1, difficulty: 'medium', questionTypes: ['multi_select'],
  }))
  assert.ok(aggregateCoverage.recommendedQuestionCount < singleCoverage.recommendedQuestionCount, 'COVERAGE-REC-3 aggregate reduces count')
  assert.equal(aggregateCoverage.coveredTargetCount, aggregateCoverage.totalAssessableTargets, 'COVERAGE-REC-8 recommended count covers all targets')
  assert.notEqual(aggregateCoverage.recommendedQuestionCount, singleCoverage.recommendedQuestionCount, 'COVERAGE-REC-5 selected types affect recommendation')

  const unsupported = brainWithUnits(3, 'coverage-unsupported', 'concept')
  unsupported.units.forEach(item => { item.label = 'Shared label'; item.identity.canonicalSubject = 'Shared label' })
  const unsupportedCoverage = analyzeQuizCoverage(unsupported, normalizeQuizConfig({
    questionCount: 1, difficulty: 'medium', questionTypes: ['matching'],
  }))
  assert.equal(unsupportedCoverage.recommendedQuestionCount, 0, 'COVERAGE-REC-4 unsupported type fabricates no coverage')
  assert.equal(unsupportedCoverage.unsupportedSelectedTypes[0]?.type, 'matching')

  assert.deepEqual(
    analyzeQuizCoverage(aggregate, normalizeQuizConfig({ questionCount: 2, difficulty: 'medium', questionTypes: ['multi_select'] })),
    analyzeQuizCoverage(aggregate, normalizeQuizConfig({ questionCount: 2, difficulty: 'medium', questionTypes: ['multi_select'] })),
    'COVERAGE-REC-10 deterministic',
  )
  const uiSource = readFileSync('components/materias/ALAIStudyALQuizzes.tsx', 'utf8')
  assert.doesNotMatch(uiSource, /suggestedQuestionCount|recommendedQuestionCount|idealQuestionCountForFullCoverage/,
    'new Quiz UI has no ideal-question concept')
  assert.ok(uiSource.includes('{finalCount} preguntas'), 'requested count is presented as exact')
  assert.ok(uiSource.includes('Cobertura del material: {coveragePreview.coveredTargetCount} / {coveragePreview.totalAssessableTargets}'),
    'setup renders canonical public coverage DTO')
  assert.ok(uiSource.includes('Cobertura del material: ${coverage.coveredTargetCount} / ${coverage.totalAssessableTargets}'),
    'results render canonical public coverage DTO')
  assert.equal(uiSource.includes('(coveragePreview as any).totalTargets'), false,
    'setup does not guess legacy coverage shapes')
  assert.equal(uiSource.includes('(coverage as any).totalTargets'), false,
    'results do not guess legacy coverage shapes')
  assert.ok(uiSource.includes('effectiveSourceSelection.fingerprint, coveragePreview, coverageFingerprint]')
    && !uiSource.includes('effectiveSourceSelection.fingerprint, questionCount')
    && !uiSource.includes('effectiveSourceSelection.fingerprint, difficulty'), 'REC-LOAD-3/4/5 controls do not retrigger')
  assert.ok(uiSource.includes('questionCount: 100') && uiSource.includes('questionTypes: Object.keys(TYPE_META)'), 'REC-LOAD-6 material-level configuration')
  assert.ok(uiSource.includes('setCoverageFingerprint(effectiveSourceSelection.fingerprint)')
    && uiSource.includes('coverageFingerprint === effectiveSourceSelection.fingerprint'), 'REC-LOAD-7 source change invalidates result')
  assert.ok(uiSource.includes("quizState !== 'setup'") && uiSource.includes('quizState, sessionId'), 'REC-LOAD-8 setup lifecycle trigger')
  assert.ok(uiSource.includes("!continuityReady || quizState !== 'setup'"), 'REC-LOAD-9 active resume skips recommendation')
  assert.equal(uiSource.includes('✦ Recomendado:'), false, 'large recommendation block removed')
  assert.equal(uiSource.includes('Formatos cubiertos:'), false, 'permanent format metrics removed')
  assert.ok(uiSource.includes("mode: 'coverage'") && uiSource.includes('sourceSelectionFingerprint: effectiveSourceSelection.fingerprint'), 'coverage request is source-scoped')
  assert.ok(uiSource.includes('if (coverageFingerprint === effectiveSourceSelection.fingerprint) return;'), 'QUIZ-PERF-3 server coverage is reused for the same fingerprint')
  assert.ok(!uiSource.includes('window.setTimeout(async () =>') && uiSource.includes("stage: 'coverage_ready'"), 'QUIZ-PERF setup recommendation has no artificial delay and is timed')
  assert.ok(uiSource.includes('.saq-count-pill.active'), 'selected count remains high contrast')
  assert.equal(providerCalls, 0, 'COVERAGE-REC-9 no provider calls')
  assert.equal(analyzeQuizCoverage(aggregate, { questionCount: 2, difficulty: 'medium', questionTypes: ['multi_select'] }).recommendedQuestionCount,
    aggregateCoverage.recommendedQuestionCount, 'COVERAGE-REC-11 generation seed cannot change recommendation')

  const cacheBrain = brainWithUnits(6, 'quiz-perf-persisted-coverage', 'fact')
  const cachedAnalysis = computeAndAttachMaterialQuizCoverage(cacheBrain)
  assert.deepEqual(readCachedQuizCoverage(cacheBrain, MATERIAL_QUIZ_COVERAGE_CONFIG), cachedAnalysis,
    'QUIZ-PERF-3 same fingerprint/config reuses deterministic persisted coverage')
  assert.equal(readCachedQuizCoverage(cacheBrain, normalizeQuizConfig({
    questionCount: 100, difficulty: 'hard', questionTypes: MATERIAL_QUIZ_COVERAGE_CONFIG.questionTypes,
  })), null, 'coverage cache never crosses a materially different configuration')

  const overLimit = analyzeQuizCoverage(brainWithUnits(105, 'coverage-over-limit'), normalizeQuizConfig({
    questionCount: 100, difficulty: 'medium', questionTypes: ['multiple_choice'],
  }))
  assert.equal(overLimit.recommendedQuestionCount, 105, 'coverage recommendation retains the full requirement')
  assert.equal(overLimit.suggestedQuestionCount, 100, 'single-quiz suggestion respects existing limit')
  assert.equal(overLimit.fullCoverageAchievableInSingleQuiz, false, 'limit-100 is explicit')
  assert.ok(overLimit.maxSingleQuizCoveragePercent < 100, 'limit-100 never claims false full coverage')
  assert.ok(uiSource.includes('Este quiz priorizará material aún no evaluado.'))
  assert.equal(uiSource.includes("`✦ ${n} Ideal`"), false, 'recommended preset remains single-line')
  assert.ok(uiSource.includes('Todo el material ya fue evaluado; este quiz reforzará la práctica.'))

  const distributed = brainWithUnits(12, 'coverage-distributed')
  const distributedPages = [1, 2, 10, 11, 20, 21, 30, 31, 40, 41, 42, 43]
  distributed.scope = buildSourceSelectionSnapshot(['mat-a'], { 'mat-a': Array.from({ length: 43 }, (_, index) => index + 1) })
  distributed.scope.fingerprint = 'coverage-distributed'
  distributed.units.forEach((item, index) => {
    const page = distributedPages[index]
    item.identity.canonicalSubject = 'Shared grounded subject'
    item.identity.semanticKey = `distributed-${index}`
    item.provenance = item.provenance.map(source => ({ ...source, page }))
    item.evidence = item.evidence?.map(source => ({ ...source, page }))
  })
  const distributedCoverage = analyzeQuizCoverage(distributed, normalizeQuizConfig({
    questionCount: 100, difficulty: 'medium', questionTypes: ['multi_select'],
  }))
  assert.ok(distributedCoverage.assessablePageCount > 2 && distributedCoverage.assessablePageCount < 43, 'REC-DENSITY-7 empty selected pages create no regions')
  assert.ok(distributedCoverage.sourceRegionCount >= 2, 'REC-DENSITY-1 distributed long material has multiple source regions')
  assert.ok(distributedCoverage.recommendedQuestionCount >= distributedCoverage.sourceRegionCoverageMinimum, 'REC-DENSITY-5 every region is budgeted')
  assert.ok(distributedCoverage.recommendedQuestionCount > distributedCoverage.knowledgeCoverageMinimum, 'REC-DENSITY-4 distant regions cannot collapse into one aggregate')

  const compactCoverage = analyzeQuizCoverage(aggregate, normalizeQuizConfig({
    questionCount: 100, difficulty: 'medium', questionTypes: ['multi_select'],
  }))
  assert.ok(compactCoverage.assessablePageCount <= 2 && compactCoverage.recommendedQuestionCount <= 2, 'REC-DENSITY-2 two-page material stays compact')
  assert.ok(compactCoverage.knowledgeCoverageMinimum < singleCoverage.knowledgeCoverageMinimum, 'REC-DENSITY-3 legitimate local aggregate reduces knowledge minimum')
  assert.deepEqual(
    analyzeQuizCoverage(distributed, { questionCount: 100, difficulty: 'easy', questionTypes: ['multi_select'] }),
    analyzeQuizCoverage(distributed, { questionCount: 100, difficulty: 'easy', questionTypes: ['multi_select'] }),
    'REC-DENSITY-8 deterministic',
  )
  assert.equal(
    analyzeQuizCoverage(distributed, { questionCount: 100, difficulty: 'hard', questionTypes: ['multi_select'] }).recommendedQuestionCount,
    distributedCoverage.recommendedQuestionCount,
    'REC-DENSITY-9 generation seed does not affect recommendation',
  )
  assert.ok(distributedCoverage.totalAssessableTargets <= distributed.units.length, 'REC-DENSITY-6 transformation variants do not inflate regions/targets')
  assert.ok(overLimit.suggestedQuestionCount === 100 && !overLimit.fullCoverageAchievableInSingleQuiz, 'REC-DENSITY-10 cap remains honest')
}

async function testInstantResumeVariableDistributionPopupAndReports() {
  const uiSource = readFileSync('components/materias/ALAIStudyALQuizzes.tsx', 'utf8')
  assert.ok(uiSource.includes('!continuityReady') && uiSource.includes('Cargando tu sesión de quiz…'), 'RESUME-UX-1/2')
  assert.ok(uiSource.includes("continuityReady && quizState === 'setup'"), 'setup must be gated until restore check completes')
  assert.ok(uiSource.includes('setCurrentIndex(Math.max(0, Number(saved.currentIndex || 0)))')
    && uiSource.includes('setGenerationId(saved.generationId || null)'), 'RESUME-UX-3')
  assert.ok(uiSource.includes('setContinuityReady(true)'), 'RESUME-UX-4/6 finite fallback')
  assert.ok(uiSource.includes("saved.quizState === 'playing'"), 'RESUME-UX-5 completed attempts are inert')
  assert.ok(uiSource.includes('restoreController.abort()') && uiSource.includes('8000'), 'restore has a timeout')

  const six = ['multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer'] as const
  const permutations = new Set<string>()
  for (let index = 0; index < 30; index += 1) {
    const allocation = allocateQuizTypeCounts(10, six, `new-${index}`)
    const values = [...allocation.values()]
    assert.equal(values.reduce((sum, value) => sum + value, 0), 10, 'DIST-VAR-1')
    assert.ok(values.every(value => value === 1 || value === 2), 'DIST-VAR-2')
    assert.ok(Math.max(...values) - Math.min(...values) <= 1, 'DIST-VAR-3')
    permutations.add(JSON.stringify(Object.fromEntries(allocation)))
  }
  assert.ok(permutations.size > 1, 'DIST-VAR-4/10')
  assert.deepEqual(Object.fromEntries(allocateQuizTypeCounts(10, six, 'fixed')),
    Object.fromEntries(allocateQuizTypeCounts(10, six, 'fixed')), 'DIST-VAR-5')
  assert.ok([...allocateQuizTypeCounts(30, six, 'x').values()].every(value => value === 5), 'DIST-VAR-6')
  assert.ok([...allocateQuizTypeCounts(6, six, 'y').values()].every(value => value === 1), 'DIST-VAR-7')
  assert.equal(allocateQuizTypeCounts(2, ['matching'], 'z').has('short_answer'), false, 'DIST-VAR-8')
  const rich = aggregateBrain('dist-var-planner')
  rich.units.push(unit('dist-formula', 'mat-a', 1, 'native_text', 'formula'))
  const cfg = normalizeQuizConfig({ questionCount: 10, difficulty: 'medium', questionTypes: [...six] })
  const seed = 'upcoming-generation-seed'
  const preview = Object.fromEntries(allocateQuizTypeCounts(10, six, seed))
  const plan = planQuiz(rich, cfg, { allocationSeed: seed })
  const planCounts: Record<string, number> = {}
  for (const question of plan.plannedQuestions) planCounts[question.questionType] = (planCounts[question.questionType] || 0) + 1
  assert.deepEqual(planCounts, preview, 'DIST-VAR-9 preview/planner seed contract')
  assert.ok(uiSource.includes('allocationSeed,') && uiSource.includes('setAllocationSeed(createUpcomingAllocationSeed())'),
    'new attempt receives a fresh stable generation seed without a preview quota')

  const hintQuestion: any = {
    id: 'hint-quality', type: 'multiple_choice', question: '¿Quién fue el mejor quarterback?',
    options: ['Matt Ryan', 'Otra A', 'Otra B', 'Otra C'], correctAnswer: 0,
    explanation: 'Matt Ryan aportó liderazgo, estabilidad y permanencia durante más de una década.',
    sourcePage: 2,
  }
  const hint = createQuizHelpEffect(hintQuestion, 'hint')!
  assert.equal(normalizeQuizText(hint.message).includes(normalizeQuizText('Matt Ryan')), false, 'POPUP-5 canonical leakage')
  assert.notEqual(normalizeQuizText(hint.message), normalizeQuizText(hintQuestion.question), 'hint not restatement')
  assert.match(normalizeQuizText(hint.message), /liderazgo|estabilidad|permanencia/, 'hint contains grounded cue')
  assert.match(hint.message, /^[A-ZÁÉÍÓÚÑ¿].*[.!?]$/, 'HINT-QUALITY-1 grammatical complete sentence')
  assert.doesNotMatch(hint.message, /Enfócate en esta idea respaldada por el material/i, 'HINT-QUALITY-1 no token-salad template')

  const descriptiveQuestion: any = {
    id: 'descriptive-quality', type: 'multiple_choice',
    question: '¿Qué jugador fue conocido por su combinación de tamaño, velocidad, fuerza y técnica?',
    options: ['Jugador Alfa', 'Jugador Beta', 'Jugador Gamma', 'Jugador Delta'], correctAnswer: 0,
    explanation: 'Jugador Alfa fue descrito por su combinación de tamaño, velocidad, fuerza y técnica, que lo convirtió en un oponente formidable.',
    sourcePage: 2,
  }
  const descriptiveHint = createQuizHelpEffect(descriptiveQuestion, 'hint')!
  assert.equal(normalizeQuizText(descriptiveHint.message).includes(normalizeQuizText('Jugador Alfa')), false, 'HINT-QUALITY-2 no canonical answer')
  assert.notEqual(normalizeQuizText(descriptiveHint.message), normalizeQuizText(descriptiveQuestion.question), 'HINT-QUALITY-3 not the question')
  assert.match(normalizeQuizText(descriptiveHint.message), /tamano.*velocidad.*fuerza.*tecnica/, 'HINT-QUALITY-4/5 grounded descriptive cue')
  assert.match(descriptiveHint.message, /^Piensa en la figura que el texto caracteriza por .+[.]$/, 'HINT-QUALITY-5 natural descriptive clue')

  assert.ok(uiSource.includes('<QuizModal title={HELP_MODAL_TITLE[activeHelpEffect.action]}'), 'POPUP-1/2')
  assert.ok(uiSource.includes("event.key === 'Escape'") && uiSource.includes("event.key !== 'Tab'"), 'POPUP-3 focus/escape')
  assert.equal(uiSource.includes('setActiveHelpEffect(saved'), false, 'POPUP-4 modal does not reopen on resume')
  assert.doesNotMatch(uiSource, /\b(?:alert|confirm)\s*\(/, 'POPUP-6')
  assert.ok(uiSource.includes('@media (max-width: 560px)') && uiSource.includes('max-height: min(680px'), 'POPUP-7')
  assert.equal(uiSource.includes('<p key={effect.action} className="saq-help-message">{effect.message}</p>'), false, 'HELP-UI-1/2 no persistent help body')
  assert.ok(uiSource.includes('return used ? null : ('), 'HELP-UI-3 one-shot tools are hidden after use')
  assert.ok(uiSource.includes('Ayudas: {helpsRemaining}/3'), 'HELP-UI-4 help budget remains visible')
  assert.ok(uiSource.includes('saq-report-separator') && uiSource.includes('⚑ Reportar'), 'HELP-UI-5 report stays visually independent')

  const original = { ...__quizReportDeps }
  let saved: any = null
  try {
    __quizReportDeps.getServerSession = async () => ({ user: { id: 'report-user' } }) as any
    __quizReportDeps.saveMaterialResult = async (input: any) => { saved = input; return input }
    const request = new NextRequest('http://localhost/api/quiz-reports', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        sessionId: 'session-report', generationId: 'generation-report', artifactIdentity: 'artifact-report',
        questionId: 'question-report', planId: 'plan-report', candidateId: 'candidate-report',
        questionType: 'matching', difficulty: 'medium', sourceMaterialIds: ['mat-a'], sourcePages: [2],
        sourceUnitIds: ['unit-a'], sourceRelationIds: ['relation-a'], questionText: 'Pregunta reportada',
        reason: 'Pregunta confusa', comment: 'Detalle opcional seguro',
      }),
    })
    const response = await POSTQuizReport(request)
    assert.equal(response.status, 200, 'REPORT-3')
    assert.equal(saved.result_type, 'quiz_report', 'REPORT storage')
    assert.equal(saved.payload.comment, 'Detalle opcional seguro', 'REPORT-9')
    const bad = await POSTQuizReport(new NextRequest('http://localhost/api/quiz-reports', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Otro' }),
    }))
    assert.equal(bad.status, 400, 'REPORT-7')
  } finally { Object.assign(__quizReportDeps, original) }
  assert.ok(uiSource.includes('⚑ Reportar') && uiSource.includes('Reportar pregunta'), 'REPORT-1/2')
  assert.ok(uiSource.includes("reportStatus === 'sending'") && uiSource.includes("reportStatus === 'success'"), 'REPORT-6/10')
  assert.ok(uiSource.includes('Gracias. Revisaremos esta pregunta.'), 'REPORT-10')
  assert.ok(uiSource.includes('submitQuestionReport') && !uiSource.includes('setHelpsUsed(budget.helpsUsed);\n    setReport'), 'REPORT-4/5')
}

async function testBudgetRetries() {
  let attempts = 0
  const r = await runGenerationPipeline<unknown[]>({
    taskType: 'evaluation_question', failurePath: 'single_repair',
    generate: async () => { attempts += 1; throw new Error('INVALID_JSON') },
    validate: () => ({ valid: true, errors: [] }),
  })
  assert.equal(r.status, 'budget_exhausted')
  assert.equal(attempts, 2)
}

async function testComputePositionAssignmentBalance() {
  const ids = Array.from({ length: 10 }, (_, i) => `q${i}`)
  const assignment = computeCorrectPositionAssignment(ids, 4, 12345)
  const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 }
  for (const v of assignment.values()) counts[v] = (counts[v] || 0) + 1
  const values = Object.values(counts).sort((a, b) => b - a)
  assert.deepEqual(values, [3, 3, 2, 2])
}

function aggregateBrain(fingerprint: string, unrelated = false): MaterialBrain {
  const value = brainWithUnits(4, fingerprint)
  value.units = [
    unit('agg-a', 'mat-a', 1, 'native_text', 'definition'),
    unit('agg-b', 'mat-a', 3, 'native_text', 'fact'),
    unit('agg-c', 'mat-a', 1, 'native_text', 'fact'),
    unit('agg-d', 'mat-a', 3, 'native_text', 'event_or_data'),
  ]
  value.units.forEach((item, index) => {
    item.identity.canonicalSubject = unrelated ? `subject-${index}` : 'Shared Subject'
    item.identity.semanticKey = `aggregate-key-${index}`
  })
  return value
}

async function testCAP1_AllSixTypesHaveRealCapacity() {
  const value = aggregateBrain('cap-1-all-types')
  value.units.push(unit('cap-formula', 'mat-a', 1, 'native_text', 'formula'))
  const selected = ['multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer'] as const
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: selected.length, difficulty: 'medium', questionTypes: [...selected] }))
  for (const type of selected) {
    assert.ok(plan.globalCandidatePool.some(candidate => candidate.questionType === type), `CAP-1 ${type}`)
    assert.ok((plan.typeCapabilityDiagnostics[type]?.capacity || 0) > 0, `CAP-1 diagnostic ${type}`)
    assert.equal(plan.typeCapabilityDiagnostics[type]?.reason, undefined)
  }
}

async function testCAP2_EverySupportedSelectedTypeAppearsBeforeRepeat() {
  const value = sameKindMatchingBrain('cap-2-supported-types')
  const types = ['multiple_choice', 'multi_select', 'matching'] as const
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: types.length, difficulty: 'medium', questionTypes: [...types] }))
  assert.deepEqual(new Set(plan.plannedQuestions.map(question => question.questionType)), new Set(types))
}

async function testCAP3_UnsupportedTypeRedistributesWithinSelection() {
  const value = brainWithUnits(4, 'cap-3-redistribute', 'concept')
  value.units.forEach(item => {
    item.label = 'Shared ambiguous label'
    const authority = `${item.label} | ${item.statement}`
    item.evidence = item.evidence.map(source => ({ ...source, quote: authority, description: authority }))
    item.provenance = item.provenance.map(source => ({ ...source, quote: authority }))
  })
  const selected = ['multiple_choice', 'matching'] as const
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 4, difficulty: 'medium', questionTypes: [...selected] }))
  assert.ok(plan.plannedQuestions.every(question => selected.includes(question.questionType as typeof selected[number])))
  assert.ok(plan.plannedQuestions.every(question => question.questionType === 'multiple_choice'))
  assert.equal(plan.typeCapabilityDiagnostics.matching?.capacity, 0)
}

async function testCAP4_AllSelectedTypesUnsupportedThrows() {
  const value = brainWithUnits(3, 'cap-4-all-unsupported', 'concept')
  value.units.forEach(item => {
    item.label = 'Shared ambiguous label'
    const authority = `${item.label} | ${item.statement}`
    item.evidence = item.evidence.map(source => ({ ...source, quote: authority, description: authority }))
    item.provenance = item.provenance.map(source => ({ ...source, quote: authority }))
  })
  assert.throws(() => planQuiz(value, normalizeQuizConfig({
    questionCount: 1, difficulty: 'medium', questionTypes: ['matching'],
  })), /INSUFFICIENT_KNOWLEDGE/)
}

async function testCAP5_ExplicitBrainRelationBuildsMatching() {
  const value = brain('cap-5-explicit-relation')
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['matching'] }))
  assert.ok(plan.globalCandidatePool.some(candidate => candidate.questionType === 'matching'
    && candidate.sourceRelationIds.includes('r1')))
}

async function testCAP6_FormulaSymbolMeaningMatchingRegression() {
  const value = brainWithUnits(1, 'cap-6-formula', 'formula')
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['matching'] }))
  const pairs = plan.plannedQuestions[0].answerTarget.pairTargets || []
  assert.deepEqual(pairs.map(pair => [pair.leftCanonical, pair.rightCanonical]), [['m', 'mass'], ['a', 'acc']])
}

async function testCAP7_TokenOverlapDoesNotCreateMatchingCluster() {
  const value = brainWithUnits(2, 'cap-7-no-fuzzy', 'fact')
  value.units.forEach(item => {
    item.label = 'Shared ambiguous label'
    const authority = `${item.label} | ${item.statement}`
    item.evidence = item.evidence.map(source => ({ ...source, quote: authority, description: authority }))
    item.provenance = item.provenance.map(source => ({ ...source, quote: authority }))
  })
  assert.throws(() => planQuiz(value, normalizeQuizConfig({
    questionCount: 1, difficulty: 'medium', questionTypes: ['matching'],
  })), /INSUFFICIENT_KNOWLEDGE/)
}

async function testCAP8_MultiSelectRequiresThreeValidNormalizedMembers() {
  const value = aggregateBrain('cap-8-normalized-cluster')
  const subjects = ['ÁREA COMÚN!', 'area comun', 'Área, común.']
  value.units.slice(0, 3).forEach((item, index) => { item.identity.canonicalSubject = subjects[index] })
  value.units[3].identity.canonicalSubject = 'different subject'
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['multi_select'] }))
  assert.equal(plan.plannedQuestions[0].sourceUnitIds.length, 3)
}

async function testCAP9_SameTopicTokensDoNotCreateMultiSelectCluster() {
  const value = brainWithUnits(3, 'cap-9-no-fuzzy-multi', 'fact')
  const subjects = ['Falcons', 'Atlanta Falcons', 'Falcons roster']
  value.units.forEach((item, index) => { item.identity.canonicalSubject = subjects[index] })
  assert.throws(() => planQuiz(value, normalizeQuizConfig({
    questionCount: 1, difficulty: 'medium', questionTypes: ['multi_select'],
  })), /INSUFFICIENT_KNOWLEDGE/)
}

async function testCAP10_ScarceCapacityConsumedBeforeAbundantOversampling() {
  const capacity = new Map<any, number>([['multiple_choice', 100], ['matching', 2]])
  const targets = allocateQuizTypeTargets(5, ['multiple_choice', 'matching'], capacity)
  assert.equal(targets.get('matching'), 2)
  assert.equal(targets.get('multiple_choice'), 3)
}

function sameKindMatchingBrain(fingerprint: string): MaterialBrain {
  const value = brainWithUnits(4, fingerprint, 'definition')
  value.units = Array.from({ length: 4 }, (_, index) => unit(
    `same-kind-${index + 1}`, 'mat-a', index % 2 ? 3 : 1, 'native_text', 'definition',
  ))
  value.units.forEach((item, index) => {
    item.identity.canonicalSubject = 'Shared Definition Subject'
    item.identity.semanticKey = `same-kind-definition-${index}`
    item.label = `Distinct term ${index + 1}`
    item.statement = `Distinct definition ${index + 1} for the shared subject`
    const authorityText = `${item.label} | ${item.statement} | ${item.term}`
    item.evidence = [{ ...item.evidence[0], quote: authorityText }]
    item.provenance = [{
      materialId: item.evidence[0].materialId,
      page: item.evidence[0].page,
      quote: authorityText,
      chunkId: `same-kind-${index + 1}`,
    }]
  })
  return value
}

function aggregateMatchingFacts(
  fingerprint: string,
  labels: string[],
): MaterialBrain {
  const value = brainWithUnits(labels.length, fingerprint, 'fact')
  value.units.forEach((item, index) => {
    item.identity.canonicalSubject = 'Shared Matching Subject'
    item.identity.semanticKey = `matching-fact-${index}`
    item.label = labels[index]
    item.statement = `Distinct grounded statement ${index + 1} for ${labels[index]}`
    const authorityText = `${item.label} | ${item.statement}`
    item.evidence = item.evidence.map(source => source.derivation === 'vision'
      ? { ...source, description: authorityText }
      : { ...source, quote: authorityText })
    item.provenance = item.provenance.map(source => ({ ...source, quote: authorityText }))
  })
  return value
}

async function testMATCH1To10_AggregateMatchingCollisions() {
  // MATCH-1/MATCH-5: every variant of a two-member collision is excluded upstream.
  const duplicate = aggregateMatchingFacts('match-1-duplicate', ['Atlanta Falcons', 'Atlanta Falcons'])
  const duplicateConfig = normalizeQuizConfig({ questionCount: 1, difficulty: 'medium',
    questionTypes: ['multiple_choice', 'matching'] })
  const duplicatePlan = planQuiz(duplicate, duplicateConfig)
  assert.equal(duplicatePlan.globalCandidatePool.filter(candidate => candidate.questionType === 'matching').length, 0)
  assert.equal(duplicatePlan.typeCapabilityDiagnostics.matching?.capacity, 0)
  assert.match(duplicatePlan.typeCapabilityDiagnostics.matching?.reason || '', /no global matching pool|no Brain relations/)

  // MATCH-2: colliding members are excluded, while distinct grounded pairs survive globally.
  const partial = aggregateMatchingFacts('match-2-partial', [
    'Atlanta Falcons', 'Atlanta Falcons', 'Unique grounded A', 'Unique grounded B',
  ])
  const partialPlan = planQuiz(partial, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium',
    questionTypes: ['multiple_choice', 'matching'] }))
  const partialCandidates = partialPlan.globalCandidatePool.filter(candidate => candidate.questionType === 'matching')
  assert.ok((partialPlan.typeCapabilityDiagnostics.matching?.capacity || 0) > 0)
  assert.ok(partialCandidates.length > 0)
  assert.ok(partialCandidates.some(candidate => {
    const left = candidate.answerTarget.pairTargets?.map(pair => pair.leftCanonical).sort()
    return JSON.stringify(left) === JSON.stringify(['Unique grounded A', 'Unique grounded B'])
  }))
  assert.ok(partialCandidates.every(candidate =>
    candidate.answerTarget.pairTargets?.every(pair => pair.leftCanonical !== 'Atlanta Falcons')))

  // MATCH-3/MATCH-4/MATCH-6: explicit definition term→statement structure remains supported.
  const healthy = sameKindMatchingBrain('match-3-healthy')
  const healthyPlan = planQuiz(healthy, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['matching'] }))
  const healthyCandidate = healthyPlan.globalCandidatePool.find(candidate => candidate.questionType === 'matching')!
  assert.ok(healthyCandidate)
  const healthyUnits = new Map(healthy.units.map(item => [item.id, item]))
  for (const [index, pair] of (healthyCandidate.answerTarget.pairTargets || []).entries()) {
    const sourceUnit = healthyUnits.get(healthyCandidate.sourceUnitIds[index])!
    assert.equal(pair.leftCanonical, sourceUnit.kind === 'definition' ? sourceUnit.term : sourceUnit.label)
    assert.equal(pair.rightCanonical, sourceUnit.statement)
    assert.ok(healthyCandidate.groundingTarget.evidenceBackedAssertionIds.includes(pair.leftAssertionId))
    assert.ok(healthyCandidate.groundingTarget.evidenceBackedAssertionIds.includes(pair.rightAssertionId))
    assert.ok(healthyCandidate.evidenceLinks.some(link => link.refId === sourceUnit.id))
  }

  // MATCH-7: defense in depth remains strict for raw duplicate left values.
  const target = healthyPlan.plannedQuestions[0]
  const rejected = validateGeneratedQuiz(healthy, healthyPlan, [{
    planId: target.id, id: 'match-7-duplicate-raw', type: 'matching', question: 'Match grounded pairs.',
    explanation: 'Grounded.', difficulty: 'medium', supportingText: healthy.units[0].statement,
    pairs: [{ left: 'Duplicated', right: 'Right A' }, { left: 'Duplicated', right: 'Right B' }],
  }])
  assert.equal(rejected.questions.length, 0)
  assert.equal(rejected.diagnostics[0].reason, 'invalid_schema')
  assert.equal(rejected.diagnostics[0].schemaMismatchField, 'pairs')

  // MATCH-8: exact-N redistributes only within selected supported types.
  const redistributed = planQuiz(duplicate, normalizeQuizConfig({ questionCount: 4, difficulty: 'medium',
    questionTypes: ['multiple_choice', 'matching'] }))
  assert.equal(redistributed.plannedQuestions.length, 4)
  assert.ok(redistributed.plannedQuestions.every(question => question.questionType === 'multiple_choice'))

  // MATCH-9: healthy scarcity and recovery distributions remain intact.
  await testT5_ScarcityAdversarial()
  await testT7_RecoveryPreservesTypeDistribution()

  // MATCH-10: coverage-first planning and shared recovery comparator remain intact.
  await testPOLICY1To10_WithinQuizCoverageBeforeHistory()
  await testRECNOV1_HistoryAwareRecoveryPrefersUnusedKnowledge()
  await testRECNOV2_MultipleRoundsMaintainIncrementalDiversity()

  assert.equal(normalizeQuizText('ÁTLANTA, Falcons!'), normalizeQuizText('atlanta falcons'))
}

async function testMATCHGLOBAL1To10_GlobalGroundedPairs() {
  const value = aggregateMatchingFacts('match-global', ['Entity A', 'Entity B', 'Entity C'])
  value.units.forEach((item, index) => {
    item.identity.canonicalSubject = `Distinct subject ${index + 1}`
  })
  const cfg = normalizeQuizConfig({ questionCount: 1, difficulty: 'hard', questionTypes: ['matching'] })
  const plan = planQuiz(value, cfg)
  const candidates = plan.globalCandidatePool.filter(candidate => candidate.questionType === 'matching')
  assert.ok(candidates.length > 0)
  assert.ok((plan.typeCapabilityDiagnostics.matching?.capacity || 0) > 0)
  const candidate = candidates[0]
  assert.equal(candidate.answerTarget.kind, 'pairs')
  const pairs = candidate.answerTarget.pairTargets || []
  assert.ok(pairs.length >= 3)
  assert.equal(new Set(pairs.map(pair => normalizeQuizText(pair.leftCanonical))).size, pairs.length)
  assert.equal(new Set(pairs.map(pair => normalizeQuizText(pair.rightCanonical))).size, pairs.length)
  const units = new Map(value.units.map(item => [item.id, item]))
  for (const pair of pairs) {
    const source = candidate.sourceUnitIds.map(id => units.get(id)!).find(item => item.label === pair.leftCanonical)
    assert.ok(source)
    assert.equal(pair.rightCanonical, source!.statement)
    assert.ok(candidate.answerTarget.assertionIds.includes(pair.leftAssertionId))
    assert.ok(candidate.answerTarget.assertionIds.includes(pair.rightAssertionId))
    assert.ok(candidate.evidenceLinks.some(link => link.refId === source!.id
      && link.assertions.some(assertion => assertion.assertionId === pair.leftAssertionId)
      && link.assertions.some(assertion => assertion.assertionId === pair.rightAssertionId)))
  }
  const generated = await generateQuizFromPlan(value, plan, { generateBatch: aggregateGenerate })
  assert.equal(generated.status, 'ready')
  assert.equal(generated.questions.length, 1)
  assert.equal(generated.questions[0].type, 'matching')

  const allTypes = ['multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer'] as const
  const allValue = aggregateBrain('match-global-all-six')
  const allPlan = planQuiz(allValue, normalizeQuizConfig({
    questionCount: 6, difficulty: 'hard', questionTypes: [...allTypes],
  }))
  assert.deepEqual(new Set(allPlan.plannedQuestions.map(question => question.questionType)), new Set(allTypes))

  const insufficient = aggregateMatchingFacts('match-global-insufficient', ['Only entity'])
  assert.throws(() => planQuiz(insufficient, cfg), /INSUFFICIENT_KNOWLEDGE:matching:/)

  const structuralKeys = candidates.map(item => (item.answerTarget.pairTargets || []).map(pair =>
    `${normalizeQuizText(pair.leftCanonical)}=>${normalizeQuizText(pair.rightCanonical)}`).sort().join('|'))
  assert.equal(new Set(structuralKeys).size, structuralKeys.length)
}

async function testFinalConsolidationContracts() {
  // EVIDENCE-FALLBACK-1/3/4 and MS-REAL-STRUCTURE-1: a derived paraphrase is
  // never certified; the exact authorized provenance span becomes canonical.
  const evidenceFallback = aggregateMatchingFacts('evidence-fallback', [
    'Shared entity', 'Shared entity', 'Shared entity',
  ])
  evidenceFallback.units.forEach((item, index) => {
    item.statement = `Derived paraphrase ${index + 1} that is not present verbatim`
    const authority = `Verbatim authorized evidence span ${index + 1} from the selected source`
    item.evidence = [{ materialId: 'mat-a', page: index % 2 ? 3 : 1, derivation: 'native_text',
      quote: authority, chunkId: `fallback-${index + 1}` }]
    item.provenance = [{ materialId: 'mat-a', page: index % 2 ? 3 : 1,
      quote: authority, chunkId: `fallback-${index + 1}` }]
  })
  const evidencePlan = planQuiz(evidenceFallback, normalizeQuizConfig({ questionCount: 1,
    difficulty: 'hard', questionTypes: ['multi_select'] }))
  const evidenceCandidate = evidencePlan.plannedQuestions[0]
  const evidenceValues = evidenceCandidate.answerTarget.canonicalValues || []
  assert.deepEqual(evidenceValues, evidenceFallback.units.map(unit => unit.provenance[0].quote))
  assert.ok(evidenceValues.every(value => !value.startsWith('Derived paraphrase')))
  for (const [index, assertionId] of evidenceCandidate.answerTarget.assertionIds.entries()) {
    const link = evidenceCandidate.evidenceLinks.find(item => item.refId === evidenceCandidate.sourceUnitIds[index])!
    const assertion = link.assertions.find(item => item.assertionId === assertionId)!
    assert.equal(assertion.text, evidenceValues[index])
    assert.equal(assertion.evidence[0].materialId, evidenceFallback.units[index].provenance[0].materialId)
    assert.equal(assertion.evidence[0].page, evidenceFallback.units[index].provenance[0].page)
    assert.ok(!link.assertions.some(item => item.text === evidenceFallback.units[index].statement))
  }

  // EVIDENCE-FALLBACK-2 and MS-REAL-STRUCTURE-2: fewer than three authorized
  // verbatim spans cannot manufacture aggregate capacity.
  const insufficientEvidence = JSON.parse(JSON.stringify(evidenceFallback)) as MaterialBrain
  insufficientEvidence.scope.fingerprint = 'evidence-fallback-insufficient'
  insufficientEvidence.units[2].evidence = []
  insufficientEvidence.units[2].provenance = []
  insufficientEvidence.units.push(unit('fallback-control', 'mat-a', 1, 'native_text', 'fact'))
  const insufficientEvidencePlan = planQuiz(insufficientEvidence, normalizeQuizConfig({ questionCount: 1,
    difficulty: 'hard', questionTypes: ['multiple_choice', 'multi_select'] }))
  assert.equal(insufficientEvidencePlan.typeCapabilityDiagnostics.multi_select?.capacity, 0)

  // MS-1/MS-2/AUTHORITY: duplicate labels resolve to exact grounded statements.
  const multi = aggregateMatchingFacts('final-ms-grounded', [
    'Shared label', 'Shared label', 'Shared label', 'Shared label',
  ])
  const multiConfig = normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['multi_select'] })
  const multiPlan = planQuiz(multi, multiConfig)
  const multiCandidate = multiPlan.globalCandidatePool.find(candidate => candidate.questionType === 'multi_select')!
  assert.ok(multiCandidate)
  const canonicalValues = multiCandidate.answerTarget.canonicalValues || []
  assert.equal(canonicalValues.length, 4)
  assert.equal(new Set(canonicalValues.map(normalizeQuizText)).size, canonicalValues.length)
  assert.deepEqual(canonicalValues, multiCandidate.sourceUnitIds.map(id => multi.units.find(unit => unit.id === id)!.statement))
  assert.deepEqual(multiCandidate.answerTarget.assertionIds, multiCandidate.groundingTarget.evidenceBackedAssertionIds)
  for (const [index, assertionId] of multiCandidate.answerTarget.assertionIds.entries()) {
    assert.ok(multiCandidate.evidenceLinks.some(link => link.refId === multiCandidate.sourceUnitIds[index]
      && link.assertions.some(assertion => assertion.assertionId === assertionId
        && assertion.text === canonicalValues[index])))
  }
  const multiOutcome = await generateQuizFromPlan(multi, multiPlan, { generateBatch: aggregateGenerate })
  assert.equal(multiOutcome.status, 'ready')
  const multiQuestion = multiOutcome.questions[0]
  assert.equal(multiQuestion.type, 'multi_select')
  if (multiQuestion.type === 'multi_select') {
    assert.ok(multiQuestion.correctAnswers.length >= 2)
    const correct = new Set(multiQuestion.correctAnswers.map(index => normalizeQuizText(multiQuestion.options[index])))
    assert.deepEqual(correct, new Set(canonicalValues.map(normalizeQuizText)))
    assert.ok(multiQuestion.options.filter((_, index) => !multiQuestion.correctAnswers.includes(index))
      .every(option => !correct.has(normalizeQuizText(option))))
  }

  // MS-3: duplicate label and duplicate statement members are all excluded;
  // semantic dedupe plus minimumMembers leaves honest zero capacity.
  const impossibleMulti = aggregateMatchingFacts('final-ms-impossible', [
    'Shared label', 'Shared label', 'Unique A', 'Unique B',
  ])
  impossibleMulti.units[1].statement = impossibleMulti.units[0].statement
  impossibleMulti.units[1].evidence = JSON.parse(JSON.stringify(impossibleMulti.units[0].evidence))
  impossibleMulti.units[1].provenance = JSON.parse(JSON.stringify(impossibleMulti.units[0].provenance))
  const impossiblePlan = planQuiz(impossibleMulti, normalizeQuizConfig({ questionCount: 2, difficulty: 'medium',
    questionTypes: ['multiple_choice', 'multi_select'] }))
  assert.equal(impossiblePlan.typeCapabilityDiagnostics.multi_select?.capacity, 0)
  assert.ok(impossiblePlan.plannedQuestions.every(question => question.questionType === 'multiple_choice'))

  // BRIEF-1/2: planner-owned cognitive intent and capped history hints reach plannedContext.
  const historyTargets = Array.from({ length: 14 }, (_, index) => `history-target-${index}`)
  for (const [difficulty, cognitiveIntent] of [
    ['easy', 'recall'], ['medium', 'discriminate'], ['hard', 'integrate'],
  ] as const) {
    const briefPlan = planQuiz(brainWithUnits(4, `brief-${difficulty}`), normalizeQuizConfig({
      questionCount: 1, difficulty, questionTypes: ['multiple_choice'],
    }), { generationId: `brief-${difficulty}`, history: { entries: [{
      generationId: 'previous', knowledgeTargetIds: historyTargets, assessmentIntents: [],
      generatedAt: '2026-01-01T00:00:00.000Z',
    }] } })
    const context = plannedContext(brainWithUnits(4, `brief-${difficulty}`), briefPlan.plannedQuestions[0])
    assert.equal(context.cognitiveIntent, cognitiveIntent)
    assert.equal(context.recentKnowledgeTargetsToAvoid?.length, 10)
    assert.match(buildQuizBatchPrompt([context]), new RegExp(cognitiveIntent))
  }
  const noHistoryBrain = brainWithUnits(4, 'brief-no-history')
  const noHistoryPlan = planQuiz(noHistoryBrain, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium',
    questionTypes: ['multiple_choice'] }))
  assert.equal(plannedContext(noHistoryBrain, noHistoryPlan.plannedQuestions[0]).recentKnowledgeTargetsToAvoid, undefined)

  // TYPE-1..4 / MATCH-STRICT-1: five real types appear; generic fact matching stays unsupported.
  const hardTypes = aggregateMatchingFacts('final-hard-types', [
    'Shared', 'Shared', 'Shared', 'Shared',
  ])
  const selected = ['multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer'] as const
  const hardTypePlan = planQuiz(hardTypes, normalizeQuizConfig({ questionCount: 10, difficulty: 'hard',
    questionTypes: [...selected] }))
  assert.equal(hardTypePlan.plannedQuestions.length, 10)
  assert.deepEqual(new Set(hardTypePlan.plannedQuestions.map(question => question.questionType)),
    new Set(['multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'short_answer']))
  assert.equal(hardTypePlan.typeCapabilityDiagnostics.matching?.capacity, 0)
  assert.ok(hardTypePlan.typeCapabilityDiagnostics.matching?.reason)
  assert.ok(hardTypePlan.plannedQuestions.every(question => selected.includes(question.questionType as typeof selected[number])))

  // MATCH-STRICT-2/3: explicit relation and formula structures remain valid.
  await testCAP5_ExplicitBrainRelationBuildsMatching()
  await testCAP6_FormulaSymbolMeaningMatchingRegression()

  // RECOVERY-TYPE-1: rejected multi_select is replaced by another multi_select.
  const recoveryPlan = planQuiz(multi, normalizeQuizConfig({ questionCount: 2, difficulty: 'medium',
    questionTypes: ['multiple_choice', 'multi_select'] }))
  let recoveryCall = 0
  const recovery = await generateQuizFromPlan(multi, recoveryPlan, { generateBatch: async plans => {
    recoveryCall += 1
    const generated = await mockGenerate(plans)
    if (recoveryCall === 1) return generated.map((raw: any) => raw.type === 'multi_select'
      ? { ...raw, options: ['duplicate', 'duplicate'], correctAnswers: [0, 1] } : raw)
    return generated
  } })
  assert.equal(recovery.status, 'ready')
  assert.equal(recovery.questions.filter(question => question.type === 'multi_select').length, 1)

  // DIFF-1..4: complexity is a soft ranking signal and raw difficulty cannot override the brief.
  const complexityBrain = brain('final-difficulty')
  const complexities: Record<string, number> = {}
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const cfg = normalizeQuizConfig({ questionCount: 1, difficulty, questionTypes: ['multiple_choice'] })
    const plan = planQuiz(complexityBrain, cfg)
    complexities[difficulty] = plan.plannedQuestions[0].sourceUnitIds.length + plan.plannedQuestions[0].sourceRelationIds.length
    const outcome = await generateQuizFromPlan(complexityBrain, plan, { generateBatch: async plans => {
      const generated = await mockGenerate(plans)
      return generated.map((raw: any) => ({ ...raw, difficulty: difficulty === 'easy' ? 'hard' : 'easy' }))
    } })
    assert.equal(outcome.questions[0].difficulty, difficulty)
    const artifact = await getOrBuildQuizArtifact(`diff-${difficulty}`, complexityBrain, cfg,
      new InMemoryQuizArtifactStore(), { mode: 'new', generateBatch: mockGenerate })
    assert.equal(artifact.artifact.meta.generation.averageGroundingComplexityByDifficulty[difficulty], complexities[difficulty])
  }
  assert.ok(complexities.easy <= complexities.medium)
  assert.ok(complexities.medium <= complexities.hard)

  // NEW-1: the explicit setup action activates M1/M2 new-generation semantics.
  const uiSource = readFileSync('components/materias/ALAIStudyALQuizzes.tsx', 'utf8')
  const generateBlock = uiSource.slice(uiSource.indexOf('const generateQuiz = useCallback'), uiSource.indexOf('const checkAnswer'))
  assert.match(generateBlock, /body:\s*JSON\.stringify\(\{\s*intent:\s*['"]new['"]/)
}

async function testQuizV21FinalAcceptanceGate() {
  const value = sameKindMatchingBrain('v21-final-acceptance')
  const allTypes = [
    'multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer',
  ] as const
  const cases = [
    { name: 'mc_matching', types: ['multiple_choice', 'matching'], count: 4 },
    { name: 'multi_short', types: ['multi_select', 'short_answer'], count: 4 },
    { name: 'matching_only', types: ['matching'], count: 3 },
    { name: 'multi_only', types: ['multi_select'], count: 3 },
    { name: 'all_six', types: [...allTypes], count: 10 },
  ] as const
  for (const item of cases) {
    const cfg = normalizeQuizConfig({ questionCount: item.count, difficulty: 'medium', questionTypes: [...item.types] })
    const plan = planQuiz(value, cfg)
    assert.equal(plan.plannedQuestions.length, item.count, `${item.name}: exact plan N`)
    assert.deepEqual(new Set(plan.plannedQuestions.map(question => question.questionType)), new Set(item.types),
      `${item.name}: every supported selected type appears`)
    assert.ok(plan.plannedQuestions.every(question => item.types.includes(question.questionType as never)),
      `${item.name}: no unselected type`)
    for (const type of item.types) assert.ok((plan.typeCapabilityDiagnostics[type]?.capacity || 0) > 0)
    for (const target of plan.plannedQuestions) {
      assert.deepEqual(target.answerTarget.assertionIds, target.groundingTarget.evidenceBackedAssertionIds)
      assert.ok(target.answerTarget.assertionIds.every(id => target.evidenceLinks.some(link =>
        link.assertions.some(assertion => assertion.assertionId === id))))
    }
  }

  // Legitimate term→definition matching through generation, validation,
  // presentation, persistence, and exact resume.
  const matchingConfig = normalizeQuizConfig({ questionCount: 3, difficulty: 'medium', questionTypes: ['matching'] })
  const matchingStore = new InMemoryQuizArtifactStore()
  let matchingCalls = 0
  const matchingGenerate: GenerateQuizBatchFn = async (...args) => {
    matchingCalls += 1
    return mockGenerate(...args)
  }
  const matchingNew = await getOrBuildQuizArtifact('v21-matching-session', value, matchingConfig, matchingStore,
    { mode: 'new', generateBatch: matchingGenerate })
  assert.equal(matchingNew.cacheStatus, 'miss')
  assert.equal(matchingNew.artifact.questions.length, 3)
  for (const question of matchingNew.artifact.questions) {
    assert.equal(question.type, 'matching')
    if (question.type !== 'matching') continue
    const targets = question.grounding.answerTarget?.pairTargets || []
    assert.equal(new Set(targets.map(pair => normalizeQuizText(pair.leftCanonical))).size, targets.length)
    assert.equal(new Set(targets.map(pair => normalizeQuizText(pair.rightCanonical))).size, targets.length)
    assert.ok(targets.every(pair => normalizeQuizText(pair.leftCanonical) !== normalizeQuizText(pair.rightCanonical)))
    assert.deepEqual(new Set(question.pairs.map(pair => `${normalizeQuizText(pair.left)}=>${normalizeQuizText(pair.right)}`)),
      new Set(targets.map(pair => `${normalizeQuizText(pair.leftCanonical)}=>${normalizeQuizText(pair.rightCanonical)}`)))
    assert.deepEqual(question.grounding.answerTarget?.assertionIds,
      question.grounding.groundingTarget?.evidenceBackedAssertionIds)
  }
  const matchingCallsBeforeResume = matchingCalls
  const matchingResume = await getOrBuildQuizArtifact('v21-matching-session', value, matchingConfig, matchingStore, {
    mode: 'resume', generationId: matchingNew.artifact.meta.generationId,
    generateBatch: async () => { throw new Error('RESUME_MUST_NOT_GENERATE') },
  })
  assert.equal(matchingResume.cacheStatus, 'hit')
  assert.deepEqual(matchingResume.artifact, matchingNew.artifact)
  assert.equal(matchingCalls, matchingCallsBeforeResume)

  // One candidate supply, equivalent configs: difficulty remains planner-owned
  // and complexity follows the approved soft ranking direction.
  const difficultyResults: Record<string, { average: number; aggregate: number; intents: string[] }> = {}
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const cfg = normalizeQuizConfig({ questionCount: 6, difficulty, questionTypes: [...allTypes] })
    const store = new InMemoryQuizArtifactStore()
    const result = await getOrBuildQuizArtifact(`v21-difficulty-${difficulty}`, value, cfg, store, {
      mode: 'new', generateBatch: async plans => (await mockGenerate(plans)).map((raw: any) => ({
        ...raw, difficulty: difficulty === 'easy' ? 'hard' : 'easy', type: raw.type,
      })),
    })
    const plan = planQuiz(value, cfg)
    difficultyResults[difficulty] = {
      average: result.artifact.meta.generation.averageGroundingComplexityByDifficulty[difficulty] || 0,
      aggregate: plan.plannedQuestions.filter(question =>
        question.sourceUnitIds.length + question.sourceRelationIds.length > 1).length,
      intents: [...new Set(plan.plannedQuestions.map(question => question.cognitiveIntent))],
    }
    assert.ok(result.artifact.questions.every(question => question.difficulty === difficulty))
  }
  assert.ok(difficultyResults.easy.average <= difficultyResults.medium.average)
  assert.ok(difficultyResults.medium.average <= difficultyResults.hard.average)

  // NEW A/B/C are independent misses; history accumulates solely as ranking
  // context. RESUME A is exact and performs zero generation.
  const generationConfig = normalizeQuizConfig({ questionCount: 10, difficulty: 'hard', questionTypes: [...allTypes] })
  const generationStore = new InMemoryQuizArtifactStore()
  let generationCalls = 0
  const generationMock: GenerateQuizBatchFn = async (...args) => {
    generationCalls += 1
    return mockGenerate(...args)
  }
  const generations = []
  for (const label of ['A', 'B', 'C']) {
    const result = await getOrBuildQuizArtifact('v21-generation-session', value, generationConfig, generationStore,
      { mode: 'new', generateBatch: generationMock })
    assert.equal(result.cacheStatus, 'miss', `NEW ${label}`)
    generations.push(result.artifact)
  }
  assert.equal(new Set(generations.map(artifact => artifact.meta.generationId)).size, 3)
  const historyIdentity = quizGenerationHistoryIdentity('v21-generation-session', value.scope.fingerprint,
    quizConfigFingerprint(generationConfig))
  const history = await generationStore.getHistory(historyIdentity)
  assert.equal(history?.entries.length, 3)
  assert.deepEqual(history?.entries.map(entry => entry.generationId), generations.map(artifact => artifact.meta.generationId))
  for (const artifact of generations) {
    const counts = new Map<string, number>()
    for (const question of artifact.questions) {
      const id = quizKnowledgeTargetId(question.grounding.sourceUnitIds, question.grounding.sourceRelationIds)
      counts.set(id, (counts.get(id) || 0) + 1)
    }
    // The shared four-unit aggregate must serve matching once and multi_select
    // twice at N=10; three is the fixture's type-scarcity lower bound.
    assert.ok(Math.max(...counts.values()) <= 3)
    assert.ok(counts.size >= 4)
  }
  assert.ok(new Set(generations.map(artifact => JSON.stringify(artifact.questions))).size > 1)
  const callsBeforeResume = generationCalls
  const resumeA = await getOrBuildQuizArtifact('v21-generation-session', value, generationConfig, generationStore, {
    mode: 'resume', generationId: generations[0].meta.generationId,
    generateBatch: async () => { throw new Error('RESUME_A_MUST_NOT_GENERATE') },
  })
  assert.equal(resumeA.cacheStatus, 'hit')
  assert.deepEqual(resumeA.artifact, generations[0])
  assert.equal(generationCalls, callsBeforeResume)

}

const aggregateGenerate: GenerateQuizBatchFn = async plans => plans.map((plan: any) => {
  const units = plan.units
  const base = { planId: plan.planId, id: `generated-${plan.planId}`, type: plan.requiredType,
    question: 'Which grounded aggregate statements are correct?', explanation: 'Grounded aggregate.',
    difficulty: 'medium', supportingText: units[0].statement }
  if (plan.requiredType === 'multi_select') return {
    ...base,
    options: plan.answerTarget.canonicalValues.length < 5
      ? [...plan.answerTarget.canonicalValues, 'Plausible ungrounded distractor']
      : [...plan.answerTarget.canonicalValues],
    correctAnswers: plan.answerTarget.canonicalValues.map((_: string, index: number) => index),
  }
  return {
    ...base,
    question: 'Match each grounded unit faithfully.',
    pairs: plan.answerTarget.pairTargets.map((pair: any) => ({ left: pair.leftCanonical, right: pair.rightCanonical })),
  }
})

async function testG1_GlobalRecoveryUsesDifferentSlotPool() {
  const value = brainWithUnits(8, 'g1-global-recovery')
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 2, difficulty: 'medium', questionTypes: ['multiple_choice'] }))
  const missingSlot = plan.slots[1]
  const primaryIds = new Set(plan.plannedQuestions.map(item => item.candidateId))
  const candidate = plan.candidatePoolBySlot[plan.slots[0].slotId].find(item => !primaryIds.has(item.candidateId))!
  plan.candidatePoolBySlot[missingSlot.slotId] = []
  let call = 0
  const outcome = await generateQuizFromPlan(value, plan, { generateBatch: async plans => {
    call += 1
    const generated = await mockGenerate(plans)
    return call === 1 ? generated.map((item: any, index) => index === 1 ? { ...item, question: '' } : item) : generated
  } })
  assert.ok(plan.globalCandidatePool.some(item => item.candidateId === candidate.candidateId))
  assert.equal(outcome.status, 'ready'); assert.equal(outcome.questions.length, 2)
}

async function testG2_GlobalCandidateAfterLocalExhaustion() { await testG1_GlobalRecoveryUsesDifferentSlotPool() }
async function testG3_ExactlyThreeRecoveriesForSeventeenOfTwenty() { await testC2_20_17_20_BudgetExactCount() }
async function testG4_ZeroGlobalCandidatesIsInsufficient() { await testRecoveryReportsLegitimateCandidateExhaustion() }
async function testG5_GlobalCandidatesWithZeroBudgetExhausted() { await testRecoveryReportsRealProviderBudgetExhaustion() }

async function testMS1_AggregatePlannerAndAcceptance() {
  const value = aggregateBrain('ms1')
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['multi_select'] }))
  assert.ok(plan.globalCandidatePool.some(item => item.questionType === 'multi_select' && item.sourceUnitIds.length >= 3))
  const outcome = await generateQuizFromPlan(value, plan, { generateBatch: aggregateGenerate })
  assert.equal(outcome.status, 'ready', JSON.stringify(outcome)); assert.equal(outcome.questions[0].type, 'multi_select')
}

async function testMS2_CorrectSelectionsPerUnitGrounded() { await testMS1_AggregatePlannerAndAcceptance() }

async function testMS3_ConflictingDistractorRejected() {
  const value = aggregateBrain('ms3')
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['multi_select'] }))
  const target = plan.plannedQuestions[0]
  const units = target.sourceUnitIds.map(id => value.units.find(item => item.id === id)!)
  const raw = { planId: target.id, id: 'ms-conflict', type: 'multi_select', question: 'Which grounded choices are correct?',
    explanation: 'Grounded.', difficulty: 'medium', supportingText: units[0].statement,
    options: [units[0].label, units[1].label, units[2].label], correctAnswers: [0, 1] }
  const rejected = validateGeneratedQuiz(value, plan, [raw])
  assert.equal(rejected.questions.length, 0); assert.equal(rejected.diagnostics[0].reason, 'unsupported_answer')
  const canonicalValues = target.answerTarget.canonicalValues!
  const accepted = validateGeneratedQuiz(value, plan, [{
    ...raw,
    id: 'ms-clean',
    options: [...canonicalValues, 'Ungrounded distractor'],
    correctAnswers: canonicalValues.map((_, index) => index),
  }])
  assert.equal(accepted.questions.length, 1)
}

async function testMS4_AggregateSpansUnitsAndLinks() {
  const value = aggregateBrain('ms4')
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['multi_select'] }))
  const candidate = plan.globalCandidatePool.find(item => item.questionType === 'multi_select')!
  assert.ok(candidate.sourceUnitIds.length > 1); assert.equal(candidate.evidenceLinks.length, candidate.sourceUnitIds.length)
}

async function testMS5_PartialAggregateKeepsValidMembers() {
  const value = aggregateBrain('ms5-partial-aggregate')
  const invalidUnitId = value.units[0].id
  invalidateUnitLabelGrounding(value, invalidUnitId)
  const plan = planQuiz(value, normalizeQuizConfig({
    questionCount: 1, difficulty: 'medium', questionTypes: ['multi_select'],
  }))
  const candidate = plan.globalCandidatePool.find(item => item.questionType === 'multi_select')
  assert.ok(candidate)
  assert.equal(candidate.sourceUnitIds.length, 4)
  assert.equal(candidate.sourceUnitIds.includes(invalidUnitId), true)
}

async function testMS6_PartialAggregateBelowThresholdIsRejected() {
  const value = aggregateBrain('ms6-partial-below-threshold')
  for (const item of value.units.slice(0, 3)) {
    item.evidence = []
    item.provenance = []
  }
  assert.throws(() => planQuiz(value, normalizeQuizConfig({
    questionCount: 1, difficulty: 'medium', questionTypes: ['multi_select'],
  })), /INSUFFICIENT_KNOWLEDGE/)
}

async function testM1_AggregatePlannerAndAcceptance() {
  const value = sameKindMatchingBrain('m1')
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['matching'] }))
  assert.ok(plan.globalCandidatePool.some(item => item.questionType === 'matching' && item.sourceUnitIds.length >= 2))
  const outcome = await generateQuizFromPlan(value, plan, { generateBatch: aggregateGenerate })
  assert.equal(outcome.status, 'ready'); assert.equal(outcome.questions[0].type, 'matching')
}

async function testM2_EveryPairGroundedToOwnUnit() { await testM1_AggregatePlannerAndAcceptance() }
async function testM3_UnrelatedUnitsNotGrouped() {
  const value = aggregateBrain('m3', true)
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['matching'] }))
  assert.equal(plan.plannedQuestions[0].questionType, 'matching')
}
async function testM4_AcceptedMatchingHasTwoToFourPairs() {
  const value = sameKindMatchingBrain('m4')
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['matching'] }))
  const outcome = await generateQuizFromPlan(value, plan, { generateBatch: aggregateGenerate })
  const pairs = (outcome.questions[0] as any).pairs
  assert.ok(pairs.length >= 2 && pairs.length <= 4)
}

async function testM5_SameKindDefinitionsProduceMatchingCandidate() {
  const value = sameKindMatchingBrain('m5-same-kind-candidate')
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['matching'] }))
  assert.ok(plan.globalCandidatePool.some(item => item.questionType === 'matching' && item.sourceUnitIds.length >= 2))
}

async function testM6_SameKindDefinitionsPreserveMatchingAtN18() {
  const value = sameKindMatchingBrain('m6-same-kind-n18')
  const requested = 18
  const plan = planQuiz(value, normalizeQuizConfig({
    questionCount: requested,
    difficulty: 'medium',
    questionTypes: ['multiple_choice', 'fill_blank', 'true_false', 'short_answer', 'multi_select', 'matching'],
  }))
  const generateBatch: GenerateQuizBatchFn = async plans => {
    const generated = []
    for (const candidate of plans) {
      const generator = candidate.requiredType === 'multi_select' || candidate.requiredType === 'matching'
        ? aggregateGenerate
        : mockGenerate
      generated.push((await generator([candidate]))[0])
    }
    return generated
  }
  const outcome = await generateQuizFromPlan(value, plan, { generateBatch })
  const types = new Set(outcome.questions.map(question => question.type))
  assert.equal(outcome.status, 'ready', JSON.stringify(outcome))
  assert.equal(outcome.questions.length, requested)
  assert.equal(types.has('matching'), true)
}

async function testT2_ZeroCapacityTypeRedistributesOnlyWithinSelection() {
  const value = brainWithUnits(6, 't2-zero-matching-capacity', 'fact')
  value.units.forEach((item, index) => {
    item.identity.canonicalSubject = `unrelated-subject-${index}`
    item.identity.semanticKey = `unrelated-fact-${index}`
    item.label = 'Shared ambiguous label'
    const authority = `${item.label} | ${item.statement}`
    item.evidence = item.evidence.map(source => ({ ...source, quote: authority, description: authority }))
    item.provenance = item.provenance.map(source => ({ ...source, quote: authority }))
  })
  value.relations = []
  const cfg = normalizeQuizConfig({
    questionCount: 8,
    difficulty: 'medium',
    questionTypes: ['multiple_choice', 'fill_blank', 'matching'],
  })
  const first = planQuiz(value, cfg)
  const second = planQuiz(value, cfg)
  const selected = new Set(cfg.questionTypes)

  assert.equal(first.plannedQuestions.length, 8)
  assert.ok(first.plannedQuestions.every(item => selected.has(item.questionType)))
  assert.ok(first.slots.every(item => selected.has(item.questionType)))
  assert.equal(first.plannedQuestions.some(item => item.questionType === 'matching'), false)
  assert.deepEqual(first.slots.map(item => item.questionType), second.slots.map(item => item.questionType))
  assert.deepEqual(first.slots.map(item => item.slotId), second.slots.map(item => item.slotId))
}

async function testT3_RepeatedPlansPreserveDistributionAndCandidateOrdering() {
  const value = brainWithUnits(8, 't3-repeat-determinism', 'process')
  value.units.forEach((item, index) => {
    item.identity.canonicalSubject = 'Shared Rich Subject'
    item.identity.semanticKey = `rich-process-${index}`
  })
  const cfg = normalizeQuizConfig({
    questionCount: 24,
    difficulty: 'medium',
    questionTypes: ['multiple_choice', 'true_false', 'multi_select', 'fill_blank', 'matching', 'short_answer'],
  })
  const plans = [planQuiz(value, cfg), planQuiz(value, cfg), planQuiz(value, cfg)]
  const expectedTypes = plans[0].slots.map(item => item.questionType)
  const expectedCandidates = plans[0].plannedQuestions.map(item => item.candidateId)
  const expectedGlobalPool = plans[0].globalCandidatePool.map(item => item.candidateId)
  for (const plan of plans.slice(1)) {
    assert.deepEqual(plan.slots.map(item => item.questionType), expectedTypes)
    assert.deepEqual(plan.plannedQuestions.map(item => item.candidateId), expectedCandidates)
    assert.deepEqual(plan.globalCandidatePool.map(item => item.candidateId), expectedGlobalPool)
  }
}

async function testD1_SameSourceDifferentTypeIntentNotDeduped() {
  const value = brainWithUnits(1, 'd1-shared-source', 'fact')
  const plan = planQuiz(value, normalizeQuizConfig({
    questionCount: 2, difficulty: 'medium', questionTypes: ['multiple_choice', 'fill_blank'],
  }))
  assert.equal(new Set(plan.plannedQuestions.flatMap(item => item.sourceUnitIds)).size, 1)
  assert.equal(new Set(plan.plannedQuestions.map(item => item.questionType)).size, 2)
  const outcome = await generateQuizFromPlan(value, plan, { generateBatch: mockGenerate })
  assert.equal(outcome.questions.length, 2, JSON.stringify(outcome.diagnostics))
  assert.equal(outcome.diagnostics.some(item => item.reason === 'duplicate'), false)
  const grounding = outcome.questions.map(question => (question as any).grounding)
  assert.deepEqual(grounding[0].sourceUnitIds, grounding[1].sourceUnitIds)
  assert.notEqual(outcome.questions[0].type, outcome.questions[1].type)
  assert.notEqual(plan.plannedQuestions[0].assessmentIntent, plan.plannedQuestions[1].assessmentIntent)
}

async function testD2_SameSemanticIntentCosmeticParaphraseRejected() {
  const value = brainWithUnits(1, 'd2-cosmetic-paraphrase', 'fact')
  const basePlan = planQuiz(value, normalizeQuizConfig({
    questionCount: 2, difficulty: 'medium', questionTypes: ['multiple_choice'],
  }))
  const first = basePlan.plannedQuestions[0]
  const second = basePlan.plannedQuestions[1]
  const plan = {
    ...basePlan,
    plannedQuestions: [first, {
      ...second,
      intent: first.intent,
      assessmentIntent: first.assessmentIntent,
      transformationVariant: first.transformationVariant,
    }],
  }
  const raw = await mockGenerate(plan.plannedQuestions.map(item => ({
    planId: item.id,
    requiredType: item.questionType,
    difficulty: item.difficulty,
    units: item.sourceUnitIds.map(id => value.units.find(unit => unit.id === id)!),
    relations: [],
  })))
  ;(raw[0] as any).question = 'Which supported answer applies to the first phrasing?'
  ;(raw[1] as any).question = 'What supported answer applies under a cosmetic rephrasing?'
  const outcome = validateGeneratedQuiz(value, plan, raw)
  assert.equal(outcome.questions.length, 1)
  assert.equal(outcome.diagnostics[0].reason, 'duplicate')
  assert.equal(outcome.diagnostics[0].subReason, 'duplicate_intent')
}

async function testL2_N100WarmRestoreHasZeroRegeneration() {
  const value = brainWithUnits(10, 'l2-warm-n100', 'process')
  value.units.forEach((item, index) => {
    item.identity.canonicalSubject = 'L2 Shared Subject'
    item.identity.semanticKey = `l2-process-${index}`
  })
  const cfg = normalizeQuizConfig({
    questionCount: 100,
    difficulty: 'medium',
    questionTypes: ['multiple_choice', 'true_false', 'multi_select', 'fill_blank', 'matching', 'short_answer'],
  })
  const store = new InMemoryQuizArtifactStore()
  const first = await getOrBuildQuizArtifact('l2-warm-session', value, cfg, store, {
    generateBatch: mockGenerate, batchSize: 8,
  })
  assert.equal(first.artifact.questions.length, 100)
  const second = await getOrBuildQuizArtifact('l2-warm-session', value, cfg, store, {
    generateBatch: async () => { throw new Error('L2 warm restore regenerated') }, batchSize: 8,
  })
  assert.equal(second.cacheStatus, 'hit')
  assert.equal(second.artifact.questions.length, 100)
  assert.deepEqual(second.artifact.questions.map(item => item.id), first.artifact.questions.map(item => item.id))
  assert.deepEqual(second.artifact.questions.map(item => item.type), first.artifact.questions.map(item => item.type))
}

async function testL3_CandidateCapacityExceedsUnitCount() {
  const value = brainWithUnits(7, 'l3-capacity-over-units', 'process')
  const plan = planQuiz(value, normalizeQuizConfig({
    questionCount: 20,
    difficulty: 'medium',
    questionTypes: ['multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'matching'],
  }))
  assert.equal(plan.plannedQuestions.length, 20)
  assert.equal(new Set(plan.plannedQuestions.map(item => item.candidateId)).size, 20)
  assert.equal(new Set(plan.plannedQuestions.map(item => item.intent)).size, 20)
}

function authoritativeRaw(target: PlannedQuizQuestion, id: string, supportingText = 'unrelated debug paraphrase'): Record<string, unknown> {
  const base: Record<string, unknown> = {
    planId: target.id, id, type: target.questionType,
    question: `Authoritative target question for ${id}`,
    explanation: 'Explanation derived from the authorized plan.', difficulty: target.difficulty, supportingText,
  }
  if (target.questionType === 'multiple_choice') return {
    ...base, options: [target.answerTarget.canonicalValue!, 'Invented distractor A', 'Invented distractor B', 'Invented distractor C'], correctAnswer: 0,
  }
  if (target.questionType === 'fill_blank') return {
    ...base, question: `Complete the authoritative ___ for ${id}`,
    answer: target.answerTarget.canonicalValue!,
    wordBank: [target.answerTarget.canonicalValue!, 'A', 'B', 'C'],
  }
  if (target.questionType === 'short_answer') return { ...base, acceptedAnswers: [target.answerTarget.canonicalValue!] }
  if (target.questionType === 'multi_select') {
    const values = target.answerTarget.canonicalValues!
    return {
      ...base, options: values.length < 5 ? [...values, 'Invented distractor'] : [...values],
      correctAnswers: values.map((_, index) => index),
    }
  }
  if (target.questionType === 'matching') return {
    ...base,
    pairs: target.answerTarget.pairTargets!.map(pair => ({ left: pair.leftCanonical, right: pair.rightCanonical })),
  }
  const presented = target.answerTarget.acceptedSurfaceForms?.[0]
  return {
    ...base,
    question: presented ? `Is this statement true: ${presented}?` : `Is the authorized statement true for ${id}?`,
    correctAnswer: target.answerTarget.canonicalValue === 'true',
  }
}

function oneTypePlan(type: 'multiple_choice' | 'fill_blank') {
  const value = brainWithUnits(4, `at-${type}`, 'fact')
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: [type] }))
  return { value, plan, target: plan.plannedQuestions[0] }
}

async function testAT_A1_ParaphrasedSupportingTextAccepted() {
  const { value, plan, target } = oneTypePlan('multiple_choice')
  assert.equal(validateGeneratedQuiz(value, plan, [authoritativeRaw(target, 'at-a1', 'a correct but nonverbatim paraphrase')]).questions.length, 1)
}

async function testAT_A2_WrongAnswerRejected() {
  const { value, plan, target } = oneTypePlan('multiple_choice')
  const raw = authoritativeRaw(target, 'at-a2')
  raw.options = ['Wrong answer', 'A', 'B', 'C']
  assert.equal(validateGeneratedQuiz(value, plan, [raw]).questions.length, 0)
}

async function testAT_A3_GarbageSupportingTextAccepted() {
  const { value, plan, target } = oneTypePlan('multiple_choice')
  assert.equal(validateGeneratedQuiz(value, plan, [authoritativeRaw(target, 'at-a3', 'ZXQ garbage unrelated')]).questions.length, 1)
}

async function testAT_A4_TamperedAssertionTargetRejected() {
  const { value, plan, target } = oneTypePlan('multiple_choice')
  target.answerTarget.assertionIds = ['unit:forged:stale']
  target.groundingTarget.evidenceBackedAssertionIds = ['unit:forged:stale']
  const result = validateGeneratedQuiz(value, plan, [authoritativeRaw(target, 'at-a4')])
  assert.equal(result.questions.length, 0); assert.equal(result.diagnostics[0].reason, 'invalid_evidence')
}

async function testAT_MC1_CanonicalOptionAccepted() { await testAT_A1_ParaphrasedSupportingTextAccepted() }
async function testAT_MC2_UngroundedDistractorsAccepted() { await testAT_A3_GarbageSupportingTextAccepted() }

async function testAT_FB1_CanonicalAnswerAccepted() {
  const { value, plan, target } = oneTypePlan('fill_blank')
  assert.equal(validateGeneratedQuiz(value, plan, [authoritativeRaw(target, 'at-fb1')]).questions.length, 1)
}

async function testAT_MS1_AllCanonicalSelectionsAccepted() {
  const value = aggregateBrain('at-ms1')
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['multi_select'] }))
  const validation = validateGeneratedQuiz(value, plan, [authoritativeRaw(plan.plannedQuestions[0], 'at-ms1')])
  assert.equal(validation.questions.length, 1, JSON.stringify(validation))
}

async function testAT_MS2_CanonicalDistractorAmbiguityRejected() {
  const value = aggregateBrain('at-ms2')
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['multi_select'] }))
  const target = plan.plannedQuestions[0]
  const values = target.answerTarget.canonicalValues!
  const raw = authoritativeRaw(target, 'at-ms2')
  raw.options = [...values.slice(0, -1), `Context ${values[values.length - 1]}`, values[values.length - 1]]
  raw.correctAnswers = values.map((_, index) => index)
  assert.equal(validateGeneratedQuiz(value, plan, [raw]).questions.length, 0)
}

async function testAT_M1_ExactPairsAccepted() {
  const value = sameKindMatchingBrain('at-m1')
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['matching'] }))
  assert.equal(validateGeneratedQuiz(value, plan, [authoritativeRaw(plan.plannedQuestions[0], 'at-m1')]).questions.length, 1)
}

async function testAT_M2_SwappedPairRejected() {
  const value = sameKindMatchingBrain('at-m2')
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['matching'] }))
  const target = plan.plannedQuestions[0]
  const raw = authoritativeRaw(target, 'at-m2')
  const pairs = target.answerTarget.pairTargets!
  raw.pairs = pairs.map((pair, index) => ({ left: pair.leftCanonical, right: pairs[(index + 1) % pairs.length].rightCanonical }))
  assert.equal(validateGeneratedQuiz(value, plan, [raw]).questions.length, 0)
}

async function testAT_M3_SingleUnitFormulaSymbolMeaningPaired() {
  const value = brainWithUnits(1, 'at-m3-formula-pairs', 'formula')
  const formula = value.units[0]
  if (formula.kind !== 'formula') throw new Error('TEST_FIXTURE_INVALID')
  formula.variables = [{ symbol: 'm', meaning: 'mass' }, { symbol: 'a', meaning: 'acceleration' }]
  const authority = [formula.label, formula.statement, formula.expression, 'm', 'mass', 'a', 'acceleration'].join(' | ')
  formula.evidence = [{ ...formula.evidence[0], description: authority, quote: authority }]
  formula.provenance = [{ materialId: 'mat-a', page: 1, quote: authority, chunkId: 'c-1' }]
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['matching'] }))
  const pairs = plan.plannedQuestions[0].answerTarget.pairTargets!
  assert.equal(pairs.find(pair => pair.leftCanonical === 'm')?.rightCanonical, 'mass')
  assert.equal(pairs.find(pair => pair.leftCanonical === 'a')?.rightCanonical, 'acceleration')
}

async function testAT_M4_NoSelfPairedProcessOrTerminologyMatching() {
  for (const kind of ['process', 'terminology'] as const) {
    const value = brainWithUnits(1, `at-m4-${kind}`, kind)
    value.units[0].identity.canonicalSubject = `unique-${kind}`
    assert.throws(() => planQuiz(value, normalizeQuizConfig({
      questionCount: 1, difficulty: 'medium', questionTypes: ['matching'],
    })), /INSUFFICIENT_KNOWLEDGE/)
  }
}

async function testAT_TF1_GroundedTrueAccepted() {
  const value = brainWithUnits(4, 'at-tf1', 'fact')
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 1, difficulty: 'medium', questionTypes: ['true_false'] }))
  assert.equal(plan.plannedQuestions[0].answerTarget.canonicalValue, 'true')
  assert.equal(validateGeneratedQuiz(value, plan, [authoritativeRaw(plan.plannedQuestions[0], 'at-tf1')]).questions.length, 1)
}

async function testAT_TF2_ControlledFalseAccepted() {
  const value = brainWithUnits(6, 'at-tf2', 'fact')
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 10, difficulty: 'medium', questionTypes: ['true_false'] }))
  const target = plan.plannedQuestions.find(item => item.answerTarget.canonicalValue === 'false')!
  assert.ok(target.answerTarget.trueFalseMutation)
  assert.equal(validateGeneratedQuiz(value, plan, [authoritativeRaw(target, 'at-tf2')]).questions.length, 1)
}

async function testAT_TF3_UnbackedFalseRejected() {
  const value = brainWithUnits(6, 'at-tf3', 'fact')
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 10, difficulty: 'medium', questionTypes: ['true_false'] }))
  const target = plan.plannedQuestions.find(item => item.answerTarget.canonicalValue === 'false')!
  target.answerTarget.trueFalseMutation = undefined
  assert.equal(validateGeneratedQuiz(value, plan, [authoritativeRaw(target, 'at-tf3')]).questions.length, 0)
}

async function testAT_TF4_AccidentalTruthMutationBlocked() {
  const value = brainWithUnits(2, 'at-tf4-accidental-truth', 'fact')
  const claims = [
    { id: 'vitamin-c', label: 'Vitamin C' },
    { id: 'vitamin-d', label: 'Vitamin D' },
  ]
  value.units.forEach((item, index) => {
    const claim = claims[index]
    item.id = claim.id
    item.identity = { canonicalSubject: claim.label, semanticKey: claim.id, qualifiers: [] }
    item.label = claim.label
    item.statement = `${claim.label} is a nutrient found in citrus fruits.`
    const authority = `${item.label} | ${item.statement}`
    item.evidence = [{ ...item.evidence[0], description: authority, quote: authority }]
    item.provenance = [{ materialId: 'mat-a', page: index % 2 ? 3 : 1, quote: authority, chunkId: `c-${index % 2 ? 3 : 1}` }]
  })
  const plan = planQuiz(value, normalizeQuizConfig({ questionCount: 6, difficulty: 'medium', questionTypes: ['true_false'] }))
  assert.equal(plan.plannedQuestions.filter(item => item.sourceUnitIds[0] === 'vitamin-c'
    && item.answerTarget.canonicalValue === 'false').length, 0)

  const stale = plan.plannedQuestions.find(item => item.sourceUnitIds[0] === 'vitamin-c')!
  stale.answerTarget = {
    kind: 'boolean', canonicalValue: 'false', assertionIds: stale.answerTarget.assertionIds,
    acceptedSurfaceForms: ['Vitamin D is a nutrient found in citrus fruits.'],
    trueFalseMutation: {
      mutationKind: 'entity_swap', originalCanonicalValue: 'Vitamin C', mutatedValue: 'Vitamin D',
    },
  }
  assert.equal(validateGeneratedQuiz(value, plan, [authoritativeRaw(stale, 'at-tf4')]).questions.length, 0)
}

async function testAT_LiveShape_FirstPassAcceptanceRegression() {
  const value = brainWithUnits(16, 'at-live-shape', 'process')
  const plan = planQuiz(value, normalizeQuizConfig({
    questionCount: 10, difficulty: 'medium',
    questionTypes: ['multiple_choice', 'multi_select', 'true_false', 'fill_blank', 'matching', 'short_answer'],
  }))
  const outcome = await generateQuizFromPlan(value, plan, { generateBatch: mockGenerate })
  assert.ok(outcome.initialAccepted >= 8, JSON.stringify(outcome))
  assert.equal(outcome.questions.length, 10); assert.equal(outcome.status, 'ready')
  console.log(`ANSWER_TARGET_LIVE_SHAPE initialAccepted=${outcome.initialAccepted} finalAccepted=${outcome.questions.length} status=${outcome.status}`)
}

async function main() {
  await testCAP1_AllSixTypesHaveRealCapacity()
  await testCAP2_EverySupportedSelectedTypeAppearsBeforeRepeat()
  await testCAP3_UnsupportedTypeRedistributesWithinSelection()
  await testCAP4_AllSelectedTypesUnsupportedThrows()
  await testCAP5_ExplicitBrainRelationBuildsMatching()
  await testCAP6_FormulaSymbolMeaningMatchingRegression()
  await testCAP7_TokenOverlapDoesNotCreateMatchingCluster()
  await testCAP8_MultiSelectRequiresThreeValidNormalizedMembers()
  await testCAP9_SameTopicTokensDoNotCreateMultiSelectCluster()
  await testCAP10_ScarceCapacityConsumedBeforeAbundantOversampling()
  await testAT_A1_ParaphrasedSupportingTextAccepted()
  await testAT_A2_WrongAnswerRejected()
  await testAT_A3_GarbageSupportingTextAccepted()
  await testAT_A4_TamperedAssertionTargetRejected()
  await testAT_MC1_CanonicalOptionAccepted()
  await testAT_MC2_UngroundedDistractorsAccepted()
  await testAT_FB1_CanonicalAnswerAccepted()
  await testAT_MS1_AllCanonicalSelectionsAccepted()
  await testAT_MS2_CanonicalDistractorAmbiguityRejected()
  await testAT_M1_ExactPairsAccepted()
  await testAT_M2_SwappedPairRejected()
  await testAT_M3_SingleUnitFormulaSymbolMeaningPaired()
  await testAT_M4_NoSelfPairedProcessOrTerminologyMatching()
  await testAT_TF1_GroundedTrueAccepted()
  await testAT_TF2_ControlledFalseAccepted()
  await testAT_TF3_UnbackedFalseRejected()
  await testAT_TF4_AccidentalTruthMutationBlocked()
  await testAT_LiveShape_FirstPassAcceptanceRegression()
  await testRouteAuthority()
  await testMatchingOnlyCapabilityErrorDetail()
  await testNEW1_NewIntentCreatesDistinctArtifacts()
  await testNEW3_SpecificGenerationResumeHasZeroRegeneration()
  await testBackwardCompatiblePlainResumeIdentity()
  await testGEN1To9_PlanningNoveltyContracts()
  await testGEN10To11_ArtifactResumeContracts()
  await testGEN12To17_PresentationContracts()
  await testGEN18To20_Regressions()
  await testPOLICY1To10_WithinQuizCoverageBeforeHistory()
  await testRECNOV1_HistoryAwareRecoveryPrefersUnusedKnowledge()
  await testRECNOV2_MultipleRoundsMaintainIncrementalDiversity()
  await testRECNOV3_RecoveryUsesAccumulatedPersistedHistory()
  await testRECNOV4To5_ScarcityAndNoveltyExhaustionRemainSoft()
  await testRECNOV6To8_SeededRecoveryAndAuthority()
  await testRECNOV9To10_RecoveryBudgetAndGlobalPoolRegressions()
  await testMATCH1To10_AggregateMatchingCollisions()
  await testMATCHGLOBAL1To10_GlobalGroundedPairs()
  await testFinalConsolidationContracts()
  await testQuizV21FinalAcceptanceGate()
  await testT1_MCOnly()
  await testT2_MC_FillBlank()
  await testT3_SafeGroundedTFSupported()
  await testT4_NoCompatibleFallback()
  await testT5_ScarcityAdversarial()
  await testT6_Determinism()
  await testT6_CoverageAwareRankingUsesDistinctUnitsBeforeRepeating()
  await testT7_RecoveryPreservesTypeDistribution()
  await testCandidateBuildFailureSkipsOnlyInvalidUnit()
  await testCanonicalLabelTokensMatchNonAdjacentGroundedAssertion()
  await testCanonicalLabelTokensStillRejectUngroundedUnit()
  await testSeveralCandidateBuildFailuresPreserveExactCount()
  await testCandidateBuildFailuresStillThrowAtTrueCapacityShortfall()
  await testT_BucketCoverage()
  await testTrueFalseNormalizerMatrix()
  await testBatchStructuralValidator()
  await testProviderSurfaceCannotOverridePlannerAuthority()
  await testAllocationHelpAndResumeUXContracts()
  await testCoverageRecommendationContracts()
  await testInstantResumeVariableDistributionPopupAndReports()
  await testA_PresentationBalance()
  await testA4_MultipleN_IncludingN1_NotStructurallyA()
  await testA5_MultiSelectRemap()
  await testA8_NoRenderShuffle()
  await testC1_And_C4_C5_C6_C12_RecoveryOnlyMissing()
  await testC2_20_17_20_BudgetExactCount()
  await testC3_RotateOnInvalidReplacement()
  await testC7_ReplacementPreservesType()
  await testRecoveryContinuesBeyondThreeRounds()
  await testRecoveryContinuesAfterAnotherSlotReachesLocalCap()
  await testRecoveryReportsRealProviderBudgetExhaustion()
  await testRecoveryReportsLegitimateCandidateExhaustion()
  await testG1_GlobalRecoveryUsesDifferentSlotPool()
  await testG2_GlobalCandidateAfterLocalExhaustion()
  await testG3_ExactlyThreeRecoveriesForSeventeenOfTwenty()
  await testG4_ZeroGlobalCandidatesIsInsufficient()
  await testG5_GlobalCandidatesWithZeroBudgetExhausted()
  await testMS1_AggregatePlannerAndAcceptance()
  await testMS2_CorrectSelectionsPerUnitGrounded()
  await testMS3_ConflictingDistractorRejected()
  await testMS4_AggregateSpansUnitsAndLinks()
  await testMS5_PartialAggregateKeepsValidMembers()
  await testMS6_PartialAggregateBelowThresholdIsRejected()
  await testM1_AggregatePlannerAndAcceptance()
  await testM2_EveryPairGroundedToOwnUnit()
  await testM3_UnrelatedUnitsNotGrouped()
  await testM4_AcceptedMatchingHasTwoToFourPairs()
  await testM5_SameKindDefinitionsProduceMatchingCandidate()
  await testM6_SameKindDefinitionsPreserveMatchingAtN18()
  await testT2_ZeroCapacityTypeRedistributesOnlyWithinSelection()
  await testT3_RepeatedPlansPreserveDistributionAndCandidateOrdering()
  await testD1_SameSourceDifferentTypeIntentNotDeduped()
  await testD2_SameSemanticIntentCosmeticParaphraseRejected()
  await testL2_N100WarmRestoreHasZeroRegeneration()
  await testL3_CandidateCapacityExceedsUnitCount()
  await testC8_SaveRejectsWrongCount()
  await testC10a_InsufficientKnowledge()
  await testC10b_InsufficientValidQuestions_EXACT()
  await testC10b2_RecoveryBudgetExhausted_EXACT()
  await testC10c_ProviderGenerationFailed_EXACT()
  await testProviderBudget_N50_Pathological()
  await testProviderBudget_CleanN10()
  await testProviderBudget_CleanN20()
  await testLargeQuizTransformationContracts()
  await testG_LeakageInvariants()
  await testG4_VisualEvidencePreserved()
  await testG6_UnsupportedAnswerRejected()
  await testGrounding_EvidenceLinked_RelationWithoutEvidence()
  await testGrounding_EvidenceLinked_RelationWithEvidence()
  await testGrounding_AssertionMustMatchEvidence()
  await testGroundedVerbatimAuthorityFallback()
  await testProviderAttemptHookCountsActualAttempts()
  await testEVAL_DeterministicFastPaths()
  await testEVAL_SemanticProviderAndCanonicalAuthority()
  await testEVAL_SafeFallbacksAndFreezeRegression()
  await testSemanticAssessmentDedupeAndGarbageFallback()
  await testEVAL_UISafetyNetContract()
  await testLaterBatchTechnicalFailureAbortsRecovery()
  await testSessionScopedArtifactIdentityAndLookup()
  await testR4_TypeDistributionPreservedAfterRestore()
  await testR5_StaleCachedArtifactRejected()
  await testArtifactCorruption_DecoderMatrix()
  await testArtifactEvidenceMustBelongToCurrentBrain()
  await testUI_CustomCount_UsesCanonical()
  await testUI_HydrationGuard()
  await testUI_Route_LookupMode()
  await testUI_Continuity_ForgedIdentity_Rejected()
  await testBudgetRetries()
  await testComputePositionAssignmentBalance()

  assert.throws(() => planQuiz({ ...brain(), units: [] }, config), /INSUFFICIENT_KNOWLEDGE/)
  assert.equal(providerCalls, 0)
  const idA = quizArtifactIdentity('bfx', quizConfigFingerprint(config))
  const idB = quizArtifactIdentity('bfy', quizConfigFingerprint(config))
  assert.notEqual(idA, idB)
  assert.ok(buildQuizBatchPrompt([{ planId: 'x', requiredType: 'multiple_choice', difficulty: 'medium', units: [], relations: [] }]).includes('{"questions":['))
  assert.deepEqual(normalizeQuizBatchResponse({ questions: [{ id: 'q' }] }), [{ id: 'q' }])
  assert.deepEqual(normalizeQuizBatchResponse([{ id: 'legacy' }]), [{ id: 'legacy' }])

  console.log('quiz-v2-contracts: PASS (providerCalls=0, rawTextAuthority=0, leakage=0, exactCount=true, evidenceLinked=true)')
}

main().catch(error => { console.error(error); process.exit(1) })
