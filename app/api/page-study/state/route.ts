import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../../lib/auth/options'
import { turnScopeOf } from '../../../../lib/pageStudy/identity'
import { loadPageStudy } from '../../../../lib/pageStudy/service'
import { WorkerPageStudyStore } from '../../../../lib/pageStudy/store'
import { PLAN_ID_PATTERN, pageStudyError } from '../../../../lib/pageStudy/routeSupport'
import { buildPageStudyView } from '../../../../lib/pageStudy/view'
import type { TutorResult } from '../../../../lib/pageStudy/tutor'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/page-study/state?planId= — restore. Storage reads only (plus exactly-once roll-forward of a completed-but-unapplied
 * turn): it can never reach a provider, which is what makes close/reopen/refresh free.
 */
export const __routeDeps = { getServerSession, store: new WorkerPageStudyStore() }

export async function GET(req: NextRequest) {
  try {
    let userId: string | null = null
    try { userId = ((await __routeDeps.getServerSession(authOptions))?.user as { id?: string } | undefined)?.id ?? null } catch { /* unauthenticated */ }
    if (!userId) return NextResponse.json({ success: false, error: 'UNAUTHORIZED', recoverable: false }, { status: 401 })
    const planId = req.nextUrl.searchParams.get('planId') || ''
    if (!PLAN_ID_PATTERN.test(planId)) return NextResponse.json({ success: false, error: 'INVALID_REQUEST', recoverable: false }, { status: 400 })
    const { state, rolledForward } = await loadPageStudy({ store: __routeDeps.store }, { userId, planId })
    const tail = await __routeDeps.store.listTurnsAfter(turnScopeOf(userId, planId), Math.max(0, state.turnSeq - 20), 20)
    const turns = tail.filter(t => t.record.status === 'completed' && t.record.result).map(t => {
      const r = t.record.result as unknown as TutorResult
      return { seq: r.seq, role: r.role, userMessage: r.userMessage, reply: r.reply, provenance: r.provenance, navigation: r.navigation, externalKnowledgeUsed: r.externalKnowledgeUsed }
    })
    return NextResponse.json({ success: true, rolledForward, view: buildPageStudyView(state), turns })
  } catch (error) {
    return pageStudyError(error)
  }
}
