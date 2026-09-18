import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../lib/auth/options'
import { getMaterial } from '../../../lib/materials/repository'
import { WorkerMaterialEnjoyerStore, lookupStudyalMaterialEnjoyer } from '../../../lib/adaptive/materialEnjoyer'
import { getAuthoritativeFreeSession } from '../../../lib/materialBrain/quiz/sessionAuthority'
import { evaluateQuizOpenAnswer } from '../../../lib/materialBrain/quiz/evaluator'
import { mapEnjoyerQuizQuestionsForUi } from '../../../lib/quiz/fillBlankContract'
import {
  buildEnjoyerAssessmentUniverse,
  advanceEnjoyerQuizGeneration,
  enjoyerQuizArtifactIdentity,
  getOrCreateEnjoyerAssessmentDesign,
  normalizeEnjoyerQuizConfig,
  quizConfigFingerprint,
  startEnjoyerQuizGeneration,
  validateEnjoyerQuizArtifact,
  WorkerEnjoyerQuizStore,
  MAX_QUIZ_QUESTIONS,
  assertEnjoyerQuizState,
  AssessmentDesignValidationError,
  type EnjoyerQuizArtifact,
  type EnjoyerQuizGenerationManifest,
} from '../../../lib/materialBrain/quiz/enjoyer'
import {
  buildQuizCompletionResult,
  composeProgressiveQuizScope,
  deriveQuizProgressiveCoverage,
  quizCoverageScopeFingerprint,
  serializePublicQuizCoverage,
  WorkerQuizCompletionStore,
} from '../../../lib/materialBrain/quiz/progressiveCoverage'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export const __routeDeps = {
  getServerSession,
  getAuthoritativeFreeSession,
  getMaterial,
  lookupEnjoyer: async (fingerprint: string) => lookupStudyalMaterialEnjoyer(fingerprint, new WorkerMaterialEnjoyerStore()),
  getOrCreateDesign: getOrCreateEnjoyerAssessmentDesign,
  startGeneration: startEnjoyerQuizGeneration,
  advanceGeneration: advanceEnjoyerQuizGeneration,
  evaluateQuizOpenAnswer,
  createStore: () => new WorkerEnjoyerQuizStore(),
  createCompletionStore: () => new WorkerQuizCompletionStore(),
}

function errorResponse(code: string, status: number, detail?: string) {
  return NextResponse.json({ success: false, error: code, ...(detail ? { detail } : {}) }, { status })
}

export function responseForArtifact(artifact: EnjoyerQuizArtifact, cacheStatus: 'hit' | 'miss' | 'shared_inflight',
  manifest?: EnjoyerQuizGenerationManifest | null) {
  assertEnjoyerQuizState(artifact, manifest)
  const returnedQuestions = mapEnjoyerQuizQuestionsForUi(artifact.questions)
  const identity = enjoyerQuizArtifactIdentity(
    artifact.meta.authoritativeSessionId,
    artifact.meta.sourceSelectionFingerprint,
    artifact.meta.configFingerprint,
    artifact.meta.generationId,
  )
  const publicCoverage = serializePublicQuizCoverage(artifact.coverage, manifest?.universe)
  const mergedCoverage = { ...artifact.coverage, ...publicCoverage }
  return NextResponse.json({
    success: true, status: manifest?.status || artifact.meta.status, cacheStatus,
    requestedQuestionCount: artifact.config.questionCount,
    actualQuestionCount: returnedQuestions.length,
    completionReason: manifest?.completionReason || artifact.completionReason,
    quiz: returnedQuestions,
    artifactIdentity: identity,
    artifact: { ...artifact.meta, config: artifact.config, artifactIdentity: identity, coverage: mergedCoverage },
    coverage: mergedCoverage,
    manifest: manifest ? { totalSlots: manifest.totalSlots, readyCount: manifest.readyCount,
      status: manifest.status, presentedOrder: manifest.presentedOrder,
      completionReason: manifest.completionReason,
      coverageRepairAttempts: manifest.coverageRepairAttempts,
      questionsReplacedForCoverage: manifest.questionsReplacedForCoverage,
      finalCoveragePercent: manifest.coverage.coveragePercent,
      finalTopicCoverage: manifest.coverage.topicCoverage,
      coverage: { ...manifest.coverage, ...publicCoverage },
      rejectionCounts: manifest.rejectionCounts }
      : { totalSlots: artifact.scopePlan
          ? artifact.scopePlan.slots.length - (artifact.retiredSlotIds?.length || 0)
          : artifact.config.questionCount, readyCount: returnedQuestions.length,
        status: artifact.meta.status, presentedOrder: returnedQuestions.map(question => question.grounding.slotId) },
  })
}

/** Shared helper to classify and return design errors as 422. */
function handleDesignError(designError: any, context: string): NextResponse {
  const designMessage = String(designError?.message || designError || '')
  if (designError instanceof AssessmentDesignValidationError) {
    return errorResponse('INVALID_ASSESSMENT_DESIGN', 422, designError.reasonCode)
  }
  if (designMessage.includes('INVALID_ASSESSMENT_DESIGN')) {
    const reasonCode = designMessage.match(/INVALID_ASSESSMENT_DESIGN:(MALFORMED_DESIGN|INVALID_IDEAL_QUESTION_COUNT|QUESTION_COUNT_EXCEEDS_MAX|NO_VALID_TARGET_GROUPS|EMPTY_TARGET_GROUP|UNKNOWN_TARGET_ID|UNAUTHORIZED_TARGET_ID|UNCOVERED_TARGETS)(?=:|$)/)?.[1] || 'INVALID_ASSESSMENT_DESIGN'
    return errorResponse('INVALID_ASSESSMENT_DESIGN', 422, reasonCode)
  }
  if (designMessage.includes('GENERATION_BUDGET_EXHAUSTED')) {
    return errorResponse('INVALID_ASSESSMENT_DESIGN', 422, 'GENERATION_BUDGET_EXHAUSTED')
  }
  console.error(`[Quiz Enjoyer][${context}]`, designMessage)
  return errorResponse('GENERATION_FAILED', 500)
}

export async function POST(request: NextRequest) {
  try {
    const authSession = await __routeDeps.getServerSession(authOptions)
    const userId = String((authSession?.user as { id?: string } | undefined)?.id || '')
    if (!userId) return errorResponse('UNAUTHORIZED', 401)
    let body: any
    try { body = await request.json() } catch { return errorResponse('INVALID_CONFIG', 400) }
    const sessionId = String(body?.sessionId || '').trim()
    const requestedFingerprint = String(body?.sourceSelectionFingerprint || '').trim()
    if (!sessionId || !requestedFingerprint) return errorResponse('INVALID_CONFIG', 400)
    if (['content', 'contenido', 'texto', 'raw_text', 'rawText', 'materialText', 'combinedText', 'facts']
      .some(key => Object.prototype.hasOwnProperty.call(body, key))) {
      return errorResponse('INVALID_CONFIG', 400, 'RAW_SOURCE_AUTHORITY_FORBIDDEN')
    }
    let config
    try { config = normalizeEnjoyerQuizConfig(body?.config) } catch { return errorResponse('INVALID_CONFIG', 400) }
    const freeSession = await __routeDeps.getAuthoritativeFreeSession(sessionId, userId)
    if (!freeSession) return errorResponse('SESSION_NOT_FOUND', 404)
    const selection = freeSession.sourceSelection
    if (selection.fingerprint !== requestedFingerprint) return errorResponse('SOURCE_SELECTION_MISMATCH', 409)
    for (const materialId of selection.materialIds) {
      if (!await __routeDeps.getMaterial(materialId, userId)) return errorResponse('SESSION_NOT_FOUND', 404)
    }
    const payload = await __routeDeps.lookupEnjoyer(selection.fingerprint)
    if (!payload) return errorResponse('ENJOYER_NOT_READY', 409)
    let universe
    try { universe = buildEnjoyerAssessmentUniverse(payload, selection) }
    catch (error: any) {
      return errorResponse(String(error?.message || '').includes('MISMATCH') ? 'SOURCE_SELECTION_MISMATCH' : 'INSUFFICIENT_KNOWLEDGE', 422)
    }

    if (body?.mode === 'coverage') {
      const completionStore = __routeDeps.createCompletionStore()
      const scope = deriveQuizProgressiveCoverage(universe, userId,
        await completionStore.list(quizCoverageScopeFingerprint(userId, universe)))
      const publicCoverage = serializePublicQuizCoverage(scope, universe)
      const supportedTypes = [...config.questionTypes]
      return NextResponse.json({ success: true, status: 'ready', cacheStatus: 'hit',
        coverage: {
          ...publicCoverage,
          representedSupportedTypeCount: supportedTypes.length, supportedSelectedTypeCount: supportedTypes.length,
          assessablePageCount: new Set(universe.targets.flatMap(target => target.pages.map(page => `${target.materialId}:${page}`))).size,
          sourceRegionCount: universe.topics.length,
          supportedSelectedTypes: supportedTypes, unsupportedSelectedTypes: [],
        }, providerCalls: 0 })
    }

    const generationId = String(body?.generationId || '').trim()
    const store = __routeDeps.createStore()
    if (['lookup', 'evaluate', 'advance', 'complete'].includes(body?.mode) && !generationId) {
      return errorResponse('ARTIFACT_MISS', 404)
    }
    if (generationId) {
      const identity = enjoyerQuizArtifactIdentity(sessionId, selection.fingerprint, quizConfigFingerprint(config), generationId)
      const persisted = store.loadState ? await store.loadState(identity) : null
      const cached = persisted?.artifact ?? await store.get(identity)
      const cachedManifest = persisted?.manifest ?? (typeof store.getManifest === 'function' ? await store.getManifest(identity) : null)
      if (cached) assertEnjoyerQuizState(cached, cachedManifest, config)
      if (cached && validateEnjoyerQuizArtifact(cached, { sessionId, fingerprint: selection.fingerprint, config, generationId })) {
        if (body?.mode === 'evaluate') {
          const question = cached.questions.find(candidate => candidate.id === String(body?.questionId || ''))
          if (!question || !['fill_blank', 'short_answer'].includes(question.type)) return errorResponse('INVALID_CONFIG', 400)
          const evaluation = await __routeDeps.evaluateQuizOpenAnswer(question as any, String(body?.answer || ''), universe.materialLanguage)
          return NextResponse.json({ success: true, resultado: evaluation })
        }
        if (body?.mode === 'complete') {
          assertEnjoyerQuizState(cached, cachedManifest, config)
          if (cached.meta.status !== 'ready' || cachedManifest?.status !== 'ready') return errorResponse('QUIZ_NOT_READY', 409)
          const completionStore = __routeDeps.createCompletionStore()
          if (!cached.scopePlan) {
            const rawCoverage = deriveQuizProgressiveCoverage(universe, userId,
              await completionStore.list(quizCoverageScopeFingerprint(userId, universe)))
            const coverage = serializePublicQuizCoverage(rawCoverage, universe)
            return NextResponse.json({ success: true, status: 'completed', cacheStatus: 'hit',
              legacy: true, result: null, coverage, providerCalls: 0 })
          }
          const result = buildQuizCompletionResult({
            userId,
            universe,
            artifact: cached,
            artifactIdentity: identity,
            answers: Array.isArray(body?.answers) ? body.answers : [],
          })
          const inserted = await completionStore.insert(result)
          if (inserted.result.submissionHash !== result.submissionHash) {
            return errorResponse('QUIZ_ALREADY_COMPLETED', 409)
          }
          const rawCoverage = deriveQuizProgressiveCoverage(universe, userId,
            await completionStore.list(result.scopeFingerprint))
          const coverage = serializePublicQuizCoverage(rawCoverage, universe)
          return NextResponse.json({ success: true, status: 'completed', cacheStatus: inserted.applied ? 'miss' : 'hit',
            result: inserted.result, coverage, providerCalls: 0 })
        }
        if (body?.mode === 'advance') {
          const result = await __routeDeps.advanceGeneration({ universe, sessionId, config, generationId, store })
          return responseForArtifact(result.artifact, result.cacheStatus, result.manifest)
        }
        return responseForArtifact(cached, 'hit', cachedManifest)
      }
      if (body?.mode === 'lookup' || body?.mode === 'evaluate' || body?.mode === 'advance' || body?.mode === 'complete') {
        return errorResponse('ARTIFACT_MISS', 404)
      }
    }

    const newGenerationId = generationId || crypto.randomUUID()
    const completionStore = __routeDeps.createCompletionStore()
    const progressiveCoverage = deriveQuizProgressiveCoverage(universe, userId,
      await completionStore.list(quizCoverageScopeFingerprint(userId, universe)))
    const scopePlan = composeProgressiveQuizScope({ universe, coverage: progressiveCoverage, config,
      generationId: newGenerationId })
    if (!scopePlan.slots.length) return errorResponse('INSUFFICIENT_VALID_QUESTIONS', 422)
    const result = await __routeDeps.startGeneration({ payload, selection, sessionId, config,
      scopePlan, generationId: newGenerationId, store })
    return responseForArtifact(result.artifact, result.cacheStatus, result.manifest)
  } catch (error: any) {
    const message = String(error?.message || error || '')
    if (message.includes('QUIZ_COVERAGE_STORE_UNAVAILABLE')) {
      return errorResponse('QUIZ_COVERAGE_STORE_UNAVAILABLE', 503, 'WORKER_ROUTE_NOT_DEPLOYED')
    }
    if (message.includes('QUIZ_GENERATION_STORE_UNAVAILABLE')) {
      return errorResponse('QUIZ_GENERATION_STORE_UNAVAILABLE', 503, 'WORKER_ROUTE_NOT_DEPLOYED')
    }
    if (message.includes('QUIZ_COMPLETION_STORE_UNAVAILABLE')) {
      return errorResponse('QUIZ_COMPLETION_STORE_UNAVAILABLE', 503, 'WORKER_ROUTE_NOT_DEPLOYED')
    }
    if (message.includes('SOURCE_SELECTION_MISMATCH')) return errorResponse('SOURCE_SELECTION_MISMATCH', 409)
    if (message.includes('INSUFFICIENT_VALID_QUESTIONS') || (message.includes('INSUFFICIENT') && !message.includes('KNOWLEDGE'))) {
      return errorResponse('INSUFFICIENT_VALID_QUESTIONS', 422)
    }
    if (message.includes('QUESTION_COUNT_EXCEEDS_MAX')) {
      return errorResponse('QUESTION_COUNT_EXCEEDS_MAX', 500)
    }
    if (message.includes('MANIFEST_CORRUPT')) {
      return errorResponse('MANIFEST_CORRUPT', 500, 'INCONSISTENT_QUESTION_COUNT')
    }
    // Fix 3: GENERATION_BUDGET_EXHAUSTED from question generation must NOT become INVALID_ASSESSMENT_DESIGN.
    if (message.includes('GENERATION_BUDGET_EXHAUSTED')) {
      console.error('[Quiz Enjoyer][budget-exhausted]', message)
      return errorResponse('GENERATION_FAILED', 500)
    }
    console.error('[Quiz Enjoyer]', message)
    return errorResponse('GENERATION_FAILED', 500)
  }
}
