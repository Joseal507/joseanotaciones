import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../../../lib/auth/options'
import { buildSourceSelectionSnapshot } from '../../../../../lib/adaptive/sourceSelection'
import { resolveSourceMaterialsForBrain } from '../../../../../lib/materialBrain/resolve'
import { getMaterial, getMaterialText, resolveStudyKind } from '../../../../../lib/materials/repository'
import { getOrBuildProductionBrain, WorkerMaterialResultStore } from '../../../../../lib/materialBrain/productionStore'
import type { MaterialBrainStore } from '../../../../../lib/materialBrain/cache'
import type { MaterialBrainLookupStatus } from '../../../../../lib/materialBrain/types'

// ============================================================
// DEV-ONLY manual regeneration for the Material Brain Debug Viewer.
//
// This is NOT a second build pipeline: it calls the exact same
// canonical authority production traffic uses (getOrBuildProductionBrain
// → buildMaterialBrain), with forceRebuild:true so the previous brain
// for THIS fingerprint is explicitly invalidated first (see
// productionStore.ts). No extraction/merge/vision-gating logic lives
// here — this route only verifies who is allowed to ask for a rebuild
// and of exactly what.
// ============================================================

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const __regenerateRouteDeps = {
  getServerSession,
  getMaterial,
  getMaterialText,
  resolveStudyKind,
  getOrBuildProductionBrain,
  createStore: (): MaterialBrainStore => new WorkerMaterialResultStore(),
  isDevelopment: () => process.env.NODE_ENV !== 'production',
}

export interface MaterialBrainDebugRegenerateResponse {
  status: MaterialBrainLookupStatus
  fingerprint: string
  brainKey: string
  brain?: import('../../../../../lib/materialBrain/types').MaterialBrain
  error?: string
}

export async function POST(req: NextRequest) {
  if (!__regenerateRouteDeps.isDevelopment()) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  const session = await __regenerateRouteDeps.getServerSession(authOptions)
  const userId = ((session?.user || {}) as { id?: string }).id
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }

  const materialIds = Array.isArray(body?.materialIds) ? body.materialIds : []
  const selectedPages = body?.selectedPages && typeof body.selectedPages === 'object' ? body.selectedPages : {}
  const requestedFingerprint = String(body?.sourceSelectionFingerprint || '')

  // The backend is the sole authority on the fingerprint — a client-sent
  // value is only ever compared against it, never trusted on its own.
  const scope = buildSourceSelectionSnapshot(materialIds, selectedPages)
  if (!requestedFingerprint || requestedFingerprint !== scope.fingerprint) {
    return NextResponse.json({ error: 'FINGERPRINT_MISMATCH', fingerprint: scope.fingerprint }, { status: 409 })
  }

  try {
    // Ownership (ownership-gated getMaterial) + authorized-pages
    // resolution reuse the exact same canonical function the production
    // /api/material-brain route uses — no parallel resolution logic.
    const { materials } = await resolveSourceMaterialsForBrain(userId, scope.materialIds, scope.selectedPages, {
      getMaterial: __regenerateRouteDeps.getMaterial,
      getMaterialText: __regenerateRouteDeps.getMaterialText,
      resolveStudyKind: __regenerateRouteDeps.resolveStudyKind,
    })

    const store = __regenerateRouteDeps.createStore()
    const requestId = `mbdbg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    console.log('[MaterialBrain] material_brain_debug_regenerate_requested', JSON.stringify({
      requestId, fingerprint: scope.fingerprint, userId, materialCount: scope.materialIds.length,
    }))

    // Full synchronous rebuild (twoLevelReadiness:false — the same
    // legacy-full-build mode buildMaterialBrain/getOrBuildProductionBrain
    // already support) so one confirmed click yields one final result,
    // not a fast base the viewer would need a separate polling loop for.
    const result = await __regenerateRouteDeps.getOrBuildProductionBrain(scope, materials, store, {
      forceRebuild: true, requestId,
    })

    const response: MaterialBrainDebugRegenerateResponse = {
      status: result.status,
      fingerprint: scope.fingerprint,
      brainKey: `brain:${scope.fingerprint}`,
      brain: result.brain,
    }
    return NextResponse.json(response, { status: 200 })
  } catch (err: any) {
    const message = err?.message || String(err)
    if (
      message.startsWith('MATERIAL_NOT_FOUND:')
      || message.startsWith('MATERIAL_TEXT_UNAVAILABLE:')
      || message.startsWith('AUTHORIZED_PAGES_UNAVAILABLE:')
      || message.startsWith('MATERIAL_TEXT_PENDING:')
    ) {
      return NextResponse.json({ error: message }, { status: 422 })
    }
    if (message === 'NO_MATERIALS' || message === 'TOO_MANY_MATERIALS') {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    console.error('material-brain debug regenerate error:', message)
    return NextResponse.json({ error: 'INTERNAL_ERROR', message }, { status: 500 })
  }
}
