import { NextRequest, NextResponse } from 'next/server'
import type { VisualInteractionSubmission, VisualSpec } from '../../../../lib/adaptive/visual/visualContract'
import { verifyVisualSpecIntegrity } from '../../../../lib/adaptive/visual/visualSpecIntegrity'
import { gradeVisualInteraction } from '../../../../lib/adaptive/visual/visualGrading'

export const dynamic = 'force-dynamic'

interface VisualCheckRequest {
  visualSpec: VisualSpec
  submission: VisualInteractionSubmission
}

// Grading determinista, server-authoritative, sin LLM ($0 costo). Mismo patrón que
// session-check/questionIntegrity.ts: el servidor NUNCA confía en el dataSpec que
// trae el cliente — lo verifica contra la firma HMAC emitida en session-teach antes
// de usarlo para calificar. Un VisualSpec sin firma válida (mutado, forjado, o de
// otra sesión) se rechaza sin calificar.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<VisualCheckRequest>
    if (!body?.visualSpec || !body?.submission) {
      return NextResponse.json({ success: false, errorCode: 'VISUAL_CHECK_INVALID_REQUEST' }, { status: 400 })
    }
    if (!verifyVisualSpecIntegrity(body.visualSpec)) {
      return NextResponse.json({ success: false, errorCode: 'VISUAL_SPEC_INTEGRITY_INVALID' }, { status: 400 })
    }
    const result = gradeVisualInteraction(body.visualSpec, body.submission)
    return NextResponse.json({ success: true, result })
  } catch (error) {
    return NextResponse.json({
      success: false,
      errorCode: 'VISUAL_CHECK_FAILED',
      message: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}
