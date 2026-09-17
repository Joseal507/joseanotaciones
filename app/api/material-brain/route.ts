import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../lib/auth/options'
import { buildSourceSelectionSnapshot } from '../../../lib/adaptive/sourceSelection'
import { resolveSourceMaterialsForBrain } from '../../../lib/materialBrain/resolve'
import { getMaterial, getMaterialText, resolveStudyKind } from '../../../lib/materials/repository'
import { ensureMaterialTextExtraction } from '../../../lib/materials/textExtraction'
import { getOrBuildProductionBrain, WorkerMaterialResultStore } from '../../../lib/materialBrain/productionStore'
import { lookupMaterialBrain } from '../../../lib/materialBrain/cache'
import type { MaterialBrainLookupStatus } from '../../../lib/materialBrain/types'
import type { MaterialBrain } from '../../../lib/materialBrain/types'
import type { Material, TextStatus } from '../../../lib/materials/types'
import { isCompletedCheckpointStatus } from '../../../lib/materialBrain/build'
import { MATERIAL_QUIZ_COVERAGE_CONFIG, readCachedQuizCoverage } from '../../../lib/materialBrain/quiz/coverageCache'
import type { QuizCoverageAnalysis } from '../../../lib/materialBrain/quiz/types'
import { resolveMaterialCapabilities, type MaterialCapabilities } from '../../../lib/materialBrain/capabilities'
import { resolveMaterialAcademicStability, type AcademicStability } from '../../../lib/materialBrain/academicStability'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const __routeDeps = {
  getServerSession,
  getMaterial,
  getMaterialText,
  resolveStudyKind,
  lookupMaterialBrain,
  getOrBuildProductionBrain,
  ensureMaterialTextExtraction,
}

export interface MaterialBrainResponse {
  status: MaterialBrainLookupStatus
  textStatus?: TextStatus
  brain?: MaterialBrain
  preparation?: MaterialPreparationSummary
  quizRecommendation?: QuizCoverageAnalysis
  capabilities?: MaterialCapabilities
  brainEnrichment?: MaterialBrain['meta']['brainEnrichment'] | null
  academicStability?: AcademicStability
}

export interface MaterialBrainStatusResponse {
  status: MaterialBrainLookupStatus
  fingerprint: string
  builderVersion: string | null
  textStatus?: TextStatus
  preparation?: MaterialPreparationSummary
  quizRecommendation?: QuizCoverageAnalysis
  capabilities?: MaterialCapabilities
  brainEnrichment?: MaterialBrain['meta']['brainEnrichment'] | null
  academicStability?: AcademicStability
}

export interface MaterialPreparationSummary {
  requiredStatus: 'complete' | 'partial' | 'failed' | 'building' | 'missing'
  optionalVisualStatus: NonNullable<MaterialBrain['visualCoverage']>['status']
  completedRequiredSections: number
  totalRequiredSections: number
  completedOptionalSections: number
  totalOptionalSections: number
  requiredFailures: Array<{ chunkId: string; status: string; reason?: string }>
  optionalGaps: string[]
}

export function summarizeMaterialPreparation(
  brain: MaterialBrain | null | undefined,
  fallbackStatus: MaterialBrainLookupStatus,
): MaterialPreparationSummary {
  const progress = brain?.meta.requiredProgress
  const checkpoints = brain?.meta.chunkCheckpoints || {}
  const requiredStatus = brain?.sourceCoverage?.status
    || (fallbackStatus === 'building' ? 'building'
      : fallbackStatus === 'partial' ? 'partial'
        : fallbackStatus === 'failed' ? 'failed' : 'missing')
  return {
    requiredStatus,
    optionalVisualStatus: brain?.visualCoverage?.status || 'not_required',
    completedRequiredSections: progress?.completedRequiredSections || 0,
    totalRequiredSections: progress?.totalRequiredSections || 0,
    completedOptionalSections: progress?.completedOptionalSections || 0,
    totalOptionalSections: progress?.totalOptionalSections || 0,
    requiredFailures: Object.entries(checkpoints)
      .filter(([, checkpoint]) => checkpoint.sourceKind === 'text' && !isCompletedCheckpointStatus(checkpoint.status))
      .map(([chunkId, checkpoint]) => ({
        chunkId,
        status: checkpoint.status,
        ...(checkpoint.failureReason ? { reason: checkpoint.failureReason } : {}),
      })),
    optionalGaps: brain?.meta.optionalGaps?.details || [],
  }
}

function cachedQuizRecommendation(brain: MaterialBrain | null | undefined): QuizCoverageAnalysis | undefined {
  if (!brain) return undefined
  return readCachedQuizCoverage(brain, MATERIAL_QUIZ_COVERAGE_CONFIG) || undefined
}

function deriveAggregateTextStatus(materials: Material[]): TextStatus | undefined {
  const statuses = new Set(materials.map(m => m.text_status))
  if (statuses.has('pending')) return 'pending'
  if (statuses.has('processing')) return 'processing'
  if (statuses.has('error')) return 'error'
  if (statuses.size === 1 && statuses.has('ready')) return 'ready'
  return undefined
}

/**
 * GET — lookup-only, NEVER builds.
 * Returns minimal status response for the lifecycle hook to poll.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await __routeDeps.getServerSession(authOptions)
    const user = (session?.user || {}) as { id?: string }
    if (!user.id) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }

    const url = new URL(req.url)
    let materialIds: string[]
    let selectedPages: Record<string, number[]>

    try {
      materialIds = JSON.parse(url.searchParams.get('materialIds') || '[]')
      selectedPages = JSON.parse(url.searchParams.get('selectedPages') || '{}')
    } catch {
      return NextResponse.json({ error: 'INVALID_PARAMS' }, { status: 400 })
    }

    const cleanIds = (Array.isArray(materialIds) ? materialIds : [])
      .map((id: unknown) => String(id || '').trim())
      .filter(Boolean)
      .slice(0, 5)

    if (cleanIds.length === 0) {
      return NextResponse.json({ error: 'INVALID_MATERIAL_COUNT' }, { status: 400 })
    }

    const materials: Material[] = []
    for (const id of cleanIds) {
      const material = await __routeDeps.getMaterial(id, user.id)
      if (!material) {
        return NextResponse.json({ error: `MATERIAL_NOT_FOUND:${id}` }, { status: 422 })
      }
      materials.push(material)
    }

    const scope = buildSourceSelectionSnapshot(cleanIds, selectedPages)
    const store = new WorkerMaterialResultStore()
    const lookup = await __routeDeps.lookupMaterialBrain(store, scope.fingerprint)

    const response: MaterialBrainStatusResponse = {
      status: lookup.status,
      fingerprint: scope.fingerprint,
      builderVersion: lookup.brain?.meta?.builderVersion ?? null,
      textStatus: deriveAggregateTextStatus(materials),
      preparation: summarizeMaterialPreparation(lookup.brain, lookup.status),
      quizRecommendation: cachedQuizRecommendation(lookup.brain),
      capabilities: resolveMaterialCapabilities(lookup.brain),
      brainEnrichment: lookup.brain?.meta.brainEnrichment ?? null,
      academicStability: resolveMaterialAcademicStability(lookup.brain),
    }

    return NextResponse.json(response, { status: 200 })
  } catch (err: any) {
    console.error('material-brain GET error:', err?.message || err)
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: err?.message || String(err) },
      { status: 500 },
    )
  }
}

/**
 * POST — builds (or restores) the Brain. Unchanged from before.
 */
export async function POST(req: NextRequest) {
  // Instrumentation (mission: "prove WHO writes the second building
  // record"): every POST gets its own requestId, threaded through
  // getOrBuildProductionBrain into every store write it makes, so a
  // live log can be filtered by requestId to see exactly which HTTP
  // request owned which write — never inferred after the fact.
  const requestId = `mb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const requestStartedAt = Date.now()
  try {
    const session = await __routeDeps.getServerSession(authOptions)
    const user = (session?.user || {}) as { id?: string }
    if (!user.id) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }

    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
    }

    const rawMaterialIds = Array.isArray(body?.materialIds) ? body.materialIds : []
    const materialIds = rawMaterialIds
      .map((id: unknown) => String(id || '').trim())
      .filter(Boolean)
      .slice(0, 5)

    const rawSelectedPages = body?.selectedPages && typeof body.selectedPages === 'object'
      ? body.selectedPages
      : {}
    const cleanSelectedPages: Record<string, number[]> = {}
    for (const key of Object.keys(rawSelectedPages)) {
      const value = rawSelectedPages[key]
      cleanSelectedPages[key] = Array.isArray(value)
        ? value.map(Number).filter((page: number) => Number.isInteger(page) && page > 0)
        : []
    }

    if (materialIds.length === 0) {
      return NextResponse.json({ error: 'INVALID_MATERIAL_COUNT' }, { status: 400 })
    }

    const scope = buildSourceSelectionSnapshot(materialIds, cleanSelectedPages)
    console.log('[MaterialBrain] material_brain_request_begin', JSON.stringify({
      requestId, fingerprint: scope.fingerprint, requestedMode: 'twoLevelReadiness',
    }))
    // Recovery path for uploads created before upload/complete owned extraction.
    // The POST may advance pending → processing → ready; GET remains lookup-only.
    for (const materialId of scope.materialIds) {
      const material = await __routeDeps.getMaterial(materialId, user.id)
      if (!material) continue
      if (material.text_status === 'pending') {
        await __routeDeps.ensureMaterialTextExtraction(material, user.id)
      }
    }
    const { materials } = await resolveSourceMaterialsForBrain(user.id, scope.materialIds, scope.selectedPages, {
      getMaterial: __routeDeps.getMaterial,
      getMaterialText: __routeDeps.getMaterialText,
      resolveStudyKind: __routeDeps.resolveStudyKind,
    })

    const store = new WorkerMaterialResultStore()
    // Two-level readiness (P0 fast-entry): a missing brain gets the
    // FAST deterministic base immediately (0 provider calls, hub can
    // open); a sourceReady-but-enriching brain gets ONE bounded
    // background enrichment batch per call — the client keeps calling
    // this same endpoint (already-existing poll/retry wiring) to drive
    // enrichment forward without ever blocking hub entry.
    const result = await __routeDeps.getOrBuildProductionBrain(scope, materials, store, { twoLevelReadiness: true, requestId })

    const responseAcademicStability = resolveMaterialAcademicStability(result.brain)
    const responseBrainEnrichment = result.brain?.meta.brainEnrichment ?? null
    // P0 diagnostic (temporary-but-cheap, kept permanently — see mission
    // "Material Brain enrichment loop is now running, but every
    // continuation POST is a no-op"): the ONE piece of information every
    // prior log stream was missing is whether `result.brain` even EXISTS
    // for this response. `getOrBuildProductionBrain` intentionally
    // returns `{status:'building'}` with NO `brain` field when a valid
    // (non-expired) build lease is held by someone else — that is the
    // ONLY legitimate reason a 200 response carries no academic state
    // (brainEnrichment/academicStability both resolve to their safe
    // "nothing to report yet" defaults in that case). If this log ever
    // shows `hasBrain:false` for many consecutive real client ticks
    // against the SAME fingerprint with no other builder in the picture,
    // that is proof of a stuck/never-expiring lease, not a candidate-
    // selection or response-mapping bug.
    console.log('[MaterialBrain] material_brain_post_dispatch', JSON.stringify({
      requestId,
      fingerprint: scope.fingerprint,
      resultStatus: result.status,
      hasBrain: !!result.brain,
      brainEnrichment: responseBrainEnrichment,
      academicStability: responseAcademicStability,
    }))
    console.log('[MaterialBrain] material_brain_request_end', JSON.stringify({
      requestId, fingerprint: scope.fingerprint, status: result.status, hasBrain: !!result.brain,
      academicStability: responseAcademicStability, durationMs: Date.now() - requestStartedAt,
    }))

    return NextResponse.json({
      ...result,
      preparation: summarizeMaterialPreparation(result.brain, result.status),
      quizRecommendation: cachedQuizRecommendation(result.brain),
      capabilities: resolveMaterialCapabilities(result.brain),
      brainEnrichment: responseBrainEnrichment,
      academicStability: responseAcademicStability,
    }, { status: 200 })
  } catch (err: any) {
    console.error('material-brain route error:', requestId, err?.message || err)
    console.log('[MaterialBrain] material_brain_request_end', JSON.stringify({
      requestId, status: 'error', hasBrain: false, durationMs: Date.now() - requestStartedAt,
    }))

    const message = err?.message || String(err)
    if (message.startsWith('MATERIAL_TEXT_PENDING:')) {
      const parts = message.split(':')
      const textStatus: TextStatus = parts[2] === 'processing' ? 'processing' : 'pending'
      const response: MaterialBrainResponse = { status: 'missing', textStatus }
      return NextResponse.json(response, { status: 200 })
    }
    if (
      message.startsWith('MATERIAL_NOT_FOUND:') ||
      message.startsWith('MATERIAL_TEXT_UNAVAILABLE:') ||
      message.startsWith('AUTHORIZED_PAGES_UNAVAILABLE:')
    ) {
      return NextResponse.json({ error: message }, { status: 422 })
    }
    if (message === 'NO_MATERIALS' || message === 'TOO_MANY_MATERIALS') {
      return NextResponse.json({ error: message }, { status: 400 })
    }

    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message },
      { status: 500 },
    )
  }
}
