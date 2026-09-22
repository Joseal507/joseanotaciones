import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../../lib/auth/options'
import { deriveAuthorizedPageUnits, deriveTextUnitsForKind, unitTypeForKind } from '../../../../lib/adaptive/sourceSelection'
import { getMaterial, getMaterialText } from '../../../../lib/materials/repository'
import { normalizePlanMaterials } from '../../../../lib/pageStudy/batching'
import { planIdOf, planKeyOf, stateRecordId } from '../../../../lib/pageStudy/identity'
import { PLAN_MATERIAL_MAX } from '../../../../lib/pageStudy/batching'
import { WorkerPageStudyStore } from '../../../../lib/pageStudy/store'
import { buildPageStudyView } from '../../../../lib/pageStudy/view'
import type { Material } from '../../../../lib/materials/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export const __routeDeps = {
  getServerSession,
  store: new WorkerPageStudyStore(),
  getMaterial,
  getMaterialText,
}

const range = (count: number): number[] => Array.from({ length: count }, (_, index) => index + 1)

function pageUniverse(material: Material, rawText: string): number[] {
  const recordedCount = Number(material.pages_count || 0)
  if (Number.isInteger(recordedCount) && recordedCount > 0 && recordedCount <= 20_000) return range(recordedCount)
  if (material.kind === 'image') return [1]
  const type = unitTypeForKind(material.normalized_kind || material.kind)
  const derived = type === 'page'
    ? deriveAuthorizedPageUnits(rawText, []).map(unit => unit.page)
    : deriveTextUnitsForKind(rawText, material.normalized_kind || material.kind, []).map(unit => unit.index)
  return [...new Set(derived)].sort((a, b) => a - b)
}

async function currentUserId(): Promise<string | null> {
  try {
    return ((await __routeDeps.getServerSession(authOptions))?.user as { id?: string } | undefined)?.id ?? null
  } catch {
    return null
  }
}

/**
 * Phase 6F: read-only discovery — "does a resumable Page Study session already exist for this
 * exact material-instance selection?" — WITHOUT creating anything. Session identity is already
 * deterministic (planId = f(userId, temaId, materialIds, selectedPages), keyed by material
 * INSTANCE id, never by content hash — see lib/pageStudy/identity.ts), and the existing POST
 * /api/page-study-plan is already idempotent (restore-first, never overwrites); this route exists
 * only because that POST's idempotency has a side effect (it creates a fresh session if none
 * exists yet), which a pure discovery check must never trigger. Zero provider calls: only Worker
 * state reads and the same cheap, provider-free page-count/text-extraction the setup POST already
 * does to derive the deterministic identity.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await currentUserId()
    if (!userId) return NextResponse.json({ success: false, exists: false, userMessage: 'Inicia sesión para continuar.' }, { status: 401 })
    const temaId = (req.nextUrl.searchParams.get('temaId') || '').trim()
    const ids = [...new Set((req.nextUrl.searchParams.get('materialIds') || '').split(',').map(v => v.trim()).filter(Boolean))]
    if (!temaId || ids.length < 1 || ids.length > PLAN_MATERIAL_MAX) {
      return NextResponse.json({ success: true, exists: false })
    }

    const resolved = await Promise.all(ids.map(async materialId => {
      const material = await __routeDeps.getMaterial(materialId, userId)
      if (!material || String(material.tema_id) !== temaId || material.upload_status !== 'uploaded' || material.text_status !== 'ready') return null
      const text = await __routeDeps.getMaterialText(materialId)
      if (!text?.raw_text) return null
      const pages = pageUniverse(material, text.raw_text)
      if (!pages.length) return null
      return { materialId, name: material.nombre || materialId, selectedPages: pages }
    }))
    if (resolved.some(m => !m)) return NextResponse.json({ success: true, exists: false })

    const materials = normalizePlanMaterials(resolved as Array<{ materialId: string; name: string; selectedPages: number[] }>)
    const planKey = planKeyOf(materials)
    const planId = planIdOf(userId, temaId, planKey)
    const stored = await __routeDeps.store.readState(stateRecordId(userId, planId))
    if (!stored) return NextResponse.json({ success: true, exists: false })

    const view = buildPageStudyView(stored.record.state)
    return NextResponse.json({
      success: true,
      exists: true,
      planId,
      finished: view.finished,
      currentMaterialId: view.block?.materialId ?? null,
      currentMaterialName: view.block?.materialName ?? null,
      pageStart: view.block?.pageStart ?? null,
      pageEnd: view.block?.pageEnd ?? null,
      coverage: view.coverage,
      updatedAt: stored.record.state.updatedAt,
    })
  } catch {
    return NextResponse.json({ success: true, exists: false })
  }
}
