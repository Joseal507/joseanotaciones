import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../lib/auth/options'
import { saveMaterialResult } from '../../../lib/materials/repository'

const REASONS = new Set([
  'Pregunta incorrecta', 'Respuesta correcta incorrecta', 'Pregunta confusa',
  'Opciones malas o ambiguas', 'Pregunta repetida', 'No corresponde al material',
  'Error visual', 'Otro',
])

export const __quizReportDeps = { getServerSession, saveMaterialResult }

export async function POST(request: NextRequest) {
  const session = await __quizReportDeps.getServerSession(authOptions)
  const userId = String((session?.user as { id?: string } | undefined)?.id || '')
  if (!userId) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })
  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ success: false, error: 'INVALID_REPORT' }, { status: 400 }) }
  const sessionId = String(body?.sessionId || '').trim()
  const generationId = String(body?.generationId || '').trim()
  const questionId = String(body?.questionId || '').trim()
  const reason = String(body?.reason || '').trim()
  if (!sessionId || !generationId || !questionId || !REASONS.has(reason)) {
    return NextResponse.json({ success: false, error: 'INVALID_REPORT' }, { status: 400 })
  }
  const reportId = randomUUID()
  const payload = {
    reportId, userId, sessionId, generationId,
    artifactIdentity: String(body?.artifactIdentity || '').slice(0, 300),
    questionId, planId: String(body?.planId || '').slice(0, 300),
    candidateId: String(body?.candidateId || '').slice(0, 300),
    questionType: String(body?.questionType || '').slice(0, 50),
    difficulty: String(body?.difficulty || '').slice(0, 30),
    sourceMaterialIds: Array.isArray(body?.sourceMaterialIds) ? body.sourceMaterialIds.map(String).slice(0, 10) : [],
    sourcePages: Array.isArray(body?.sourcePages) ? body.sourcePages.map(Number).filter(Number.isFinite).slice(0, 30) : [],
    sourceUnitIds: Array.isArray(body?.sourceUnitIds) ? body.sourceUnitIds.map(String).slice(0, 30) : [],
    sourceRelationIds: Array.isArray(body?.sourceRelationIds) ? body.sourceRelationIds.map(String).slice(0, 30) : [],
    questionText: String(body?.questionText || '').slice(0, 2000),
    reason, comment: String(body?.comment || '').trim().slice(0, 2000),
    timestamp: new Date().toISOString(),
  }
  try {
    await __quizReportDeps.saveMaterialResult({
      material_id: `quiz_report:${reportId}`, enfoque: 'mixto', result_type: 'quiz_report',
      payload, content_hash: `${sessionId}:${generationId}:${questionId}:${reportId}`,
    })
    return NextResponse.json({ success: true, reportId })
  } catch {
    return NextResponse.json({ success: false, error: 'REPORT_SAVE_FAILED' }, { status: 500 })
  }
}
