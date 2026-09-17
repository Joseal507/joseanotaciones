import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../../lib/auth/options'
import { buildSourceSelectionSnapshot } from '../../../../lib/adaptive/sourceSelection'
import { lookupMaterialBrain, type MaterialBrainStore } from '../../../../lib/materialBrain/cache'
import { WorkerMaterialResultStore } from '../../../../lib/materialBrain/productionStore'
import { getMaterial } from '../../../../lib/materials/repository'

export const dynamic = 'force-dynamic'

export const __debugRouteDeps = {
  getServerSession,
  getMaterial,
  createStore: (): MaterialBrainStore => new WorkerMaterialResultStore(),
  isDevelopment: () => process.env.NODE_ENV !== 'production',
}

export async function GET(req: NextRequest) {
  if (!__debugRouteDeps.isDevelopment()) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }
  const session = await __debugRouteDeps.getServerSession(authOptions)
  const userId = ((session?.user || {}) as { id?: string }).id
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })

  const url = new URL(req.url)
  let materialIds: string[]
  let selectedPages: Record<string, number[]>
  try {
    materialIds = JSON.parse(url.searchParams.get('materialIds') || '[]')
    selectedPages = JSON.parse(url.searchParams.get('selectedPages') || '{}')
  } catch {
    return NextResponse.json({ error: 'INVALID_PARAMS' }, { status: 400 })
  }
  const scope = buildSourceSelectionSnapshot(materialIds, selectedPages)
  const requestedFingerprint = String(url.searchParams.get('fingerprint') || '')
  if (!requestedFingerprint || requestedFingerprint !== scope.fingerprint) {
    return NextResponse.json({ error: 'FINGERPRINT_MISMATCH', fingerprint: scope.fingerprint }, { status: 409 })
  }
  for (const materialId of scope.materialIds) {
    if (!await __debugRouteDeps.getMaterial(materialId, userId)) {
      return NextResponse.json({ error: `MATERIAL_NOT_FOUND:${materialId}` }, { status: 422 })
    }
  }
  const lookup = await lookupMaterialBrain(__debugRouteDeps.createStore(), scope.fingerprint)
  return NextResponse.json({
    status: lookup.status,
    fingerprint: scope.fingerprint,
    brainKey: `brain:${scope.fingerprint}`,
    brain: lookup.brain || undefined,
  })
}
