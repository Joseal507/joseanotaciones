import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../lib/auth/options'
import { deriveAuthorizedPageUnits, deriveTextUnitsForKind, unitTypeForKind } from '../../../lib/adaptive/sourceSelection'
import { getMaterial, getMaterialText } from '../../../lib/materials/repository'
import { createPageStudy, loadPageStudy, PageStudyError } from '../../../lib/pageStudy/service'
import { WorkerPageStudyStore } from '../../../lib/pageStudy/store'
import { PLAN_MATERIAL_MAX } from '../../../lib/pageStudy/batching'
import { PLAN_ID_PATTERN } from '../../../lib/pageStudy/routeSupport'
import { validatePageStudyBlockSize } from '../../../lib/pageStudy/ui'
import { buildPageStudyView } from '../../../lib/pageStudy/view'
import type { Material } from '../../../lib/materials/types'
import type { PageStudyState } from '../../../lib/pageStudy/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

function preparationGroups(state: PageStudyState) {
  const names = new Map(state.plan.materials.map(material => [material.materialId, material.name]))
  return state.plan.batches.map(group => ({
    sourceSelection: group.selection,
    materials: group.selection.materials.map(selection => ({
      materialId: selection.materialId,
      materialName: names.get(selection.materialId) || selection.materialId,
      selectedPages: selection.selectedPages,
    })),
  }))
}

async function currentUserId(): Promise<string | null> {
  try {
    return ((await __routeDeps.getServerSession(authOptions))?.user as { id?: string } | undefined)?.id ?? null
  } catch {
    return null
  }
}

function setupError(error: unknown): NextResponse {
  const code = error instanceof PageStudyError ? error.code : String((error as Error)?.message || '')
  const missing = code === 'PAGE_STUDY_STATE_NOT_FOUND'
  console.info('[page-study-setup] failed', { code: code || 'PAGE_STUDY_SETUP_FAILED' })
  return NextResponse.json({
    success: false,
    recoverable: !missing,
    userMessage: missing
      ? 'No encontramos este plan de estudio.'
      : 'No pude preparar este plan. Revisa que los materiales estén listos e inténtalo de nuevo.',
  }, { status: missing ? 404 : 503 })
}

/** Restore the server-derived preparation inputs for an existing durable plan. No provider work. */
export async function GET(req: NextRequest) {
  try {
    const userId = await currentUserId()
    if (!userId) return NextResponse.json({ success: false, recoverable: false, userMessage: 'Inicia sesión para continuar.' }, { status: 401 })
    const planId = req.nextUrl.searchParams.get('planId') || ''
    if (!PLAN_ID_PATTERN.test(planId)) return NextResponse.json({ success: false, recoverable: false, userMessage: 'Este plan no es válido.' }, { status: 400 })
    const { state } = await loadPageStudy({ store: __routeDeps.store }, { userId, planId })
    return NextResponse.json({ success: true, view: buildPageStudyView(state), preparationGroups: preparationGroups(state) })
  } catch (error) {
    return setupError(error)
  }
}

/**
 * Create or restore a Page Study plan. The client chooses only ordered owned material ids and block size.
 * Names, page universes, explicit page selections, batches, fingerprints and current position are all server-derived.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await currentUserId()
    if (!userId) return NextResponse.json({ success: false, recoverable: false, userMessage: 'Inicia sesión para continuar.' }, { status: 401 })
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const temaId = String(body?.temaId || '').trim()
    const ids = [...new Set((Array.isArray(body?.orderedMaterialIds) ? body!.orderedMaterialIds : [])
      .map(value => String(value || '').trim()).filter(Boolean))]
    const blockSize = validatePageStudyBlockSize(body?.blockSize)
    if (!temaId || ids.length < 1 || ids.length > PLAN_MATERIAL_MAX || blockSize === null) {
      return NextResponse.json({ success: false, recoverable: false, userMessage: 'Revisa los materiales y el tamaño del bloque.' }, { status: 400 })
    }

    const resolved = await Promise.all(ids.map(async materialId => {
      const material = await __routeDeps.getMaterial(materialId, userId)
      if (!material || String(material.tema_id) !== temaId || material.upload_status !== 'uploaded' || material.text_status !== 'ready') {
        throw new Error('PAGE_STUDY_MATERIAL_NOT_READY')
      }
      const text = await __routeDeps.getMaterialText(materialId)
      if (!text?.raw_text) throw new Error('PAGE_STUDY_MATERIAL_NOT_READY')
      const pages = pageUniverse(material, text.raw_text)
      if (!pages.length) throw new Error('PAGE_STUDY_MATERIAL_NOT_READY')
      return { materialId, name: material.nombre || materialId, selectedPages: pages }
    }))

    const universe = Object.fromEntries(resolved.map(material => [material.materialId, material.selectedPages]))
    const { state, created } = await createPageStudy({ store: __routeDeps.store }, {
      userId,
      temaId,
      materials: resolved,
      blockSize,
      universe,
    })
    return NextResponse.json({
      success: true,
      created,
      view: buildPageStudyView(state),
      preparationGroups: preparationGroups(state),
    })
  } catch (error) {
    return setupError(error)
  }
}
