import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../../lib/auth/options'
import { lookupStudyalMaterialEnjoyer, WorkerMaterialEnjoyerStore } from '../../../../lib/adaptive/materialEnjoyer'
import { getMaterial, getMaterialText } from '../../../../lib/materials/repository'
import { WorkerPageStudyStore } from '../../../../lib/pageStudy/store'
import { runTutorTurn, type TutorDeps } from '../../../../lib/pageStudy/tutor'
import { PLAN_ID_PATTERN, forbiddenClientFields, pageStudyError } from '../../../../lib/pageStudy/routeSupport'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

/**
 * POST /api/page-study/turn — one durable Page Study tutor turn. Untrusted input only: plan id, the durable slot the client
 * was handed by the previous response, the user's message, the sequence it believes is next, and an optional response-only
 * language override. Block, pages, materials, authority batch, pending question, mastery and provenance are ALL resolved
 * server-side from the authoritative state.
 */
export const __routeDeps = {
  getServerSession,
  store: new WorkerPageStudyStore(),
  context: {
    lookupEnjoyer: (fingerprint: string) => lookupStudyalMaterialEnjoyer(fingerprint, new WorkerMaterialEnjoyerStore()),
    loadSource: async (materialId: string, userId: string) => {
      const material = await getMaterial(materialId, userId)             // ownership check: a foreign material is simply absent
      if (!material) return null
      const text = await getMaterialText(materialId)
      return text?.raw_text ? { materialId, name: String((material as { nombre?: string; name?: string }).nombre ?? (material as { name?: string }).name ?? materialId), kind: String((material as { kind?: string }).kind ?? 'pdf'), rawText: text.raw_text } : null
    },
  } satisfies TutorDeps['context'],
  provider: undefined as TutorDeps['provider'],
}

export async function POST(req: NextRequest) {
  try {
    let userId: string | null = null
    try { userId = ((await __routeDeps.getServerSession(authOptions))?.user as { id?: string } | undefined)?.id ?? null } catch { /* unauthenticated */ }
    if (!userId) return NextResponse.json({ success: false, error: 'UNAUTHORIZED', recoverable: false, userMessage: 'Inicia sesión para continuar.' }, { status: 401 })
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return NextResponse.json({ success: false, error: 'INVALID_REQUEST', recoverable: false }, { status: 400 })
    const forbidden = forbiddenClientFields(body)
    if (forbidden.length) return NextResponse.json({ success: false, error: 'PAGE_STUDY_FORBIDDEN_FIELD', recoverable: false, fields: forbidden }, { status: 400 })
    const planId = String(body.planId || ''); const slot = String(body.slot || '')
    const expectedSeq = body.expectedSeq === undefined ? undefined : Number(body.expectedSeq)
    if (!PLAN_ID_PATTERN.test(planId) || !slot || slot.length > 300 || (expectedSeq !== undefined && (!Number.isInteger(expectedSeq) || expectedSeq < 1))
      || (body.message !== undefined && typeof body.message !== 'string') || (body.languageOverride !== undefined && typeof body.languageOverride !== 'string')) {
      return NextResponse.json({ success: false, error: 'INVALID_REQUEST', recoverable: false }, { status: 400 })
    }
    const outcome = await runTutorTurn({ store: __routeDeps.store, context: __routeDeps.context, provider: __routeDeps.provider },
      { userId, planId, slot, message: String(body.message ?? ''), expectedSeq, languageOverride: typeof body.languageOverride === 'string' ? body.languageOverride : undefined })
    return NextResponse.json({ success: true, replayed: outcome.replayed, turn: outcome.turn, view: outcome.view })
  } catch (error) {
    return pageStudyError(error)
  }
}
