import { buildSourceSelectionSnapshot, type SourceSelectionSnapshot } from '../../adaptive/sourceSelection'
import { workerAuthHeaders } from '../../worker/auth'

export interface AuthoritativeFreeSession {
  id: string
  userId: string
  processMode: string
  sourceSelection: SourceSelectionSnapshot
}

export async function getAuthoritativeFreeSession(
  sessionId: string,
  userId: string,
): Promise<AuthoritativeFreeSession | null> {
  const api = process.env.STUDYAL_API_URL || ''
  if (!api) throw new Error('SESSION_AUTHORITY_UNAVAILABLE')
  const response = await fetch(
    `${api}/study-sessions/by-user?userId=${encodeURIComponent(userId)}`,
    { cache: 'no-store', headers: workerAuthHeaders() },
  )
  if (!response.ok) throw new Error(`SESSION_AUTHORITY_FAILED:${response.status}`)
  const body = await response.json().catch(() => ({}))
  const row = (Array.isArray(body.sessions) ? body.sessions : [])
    .find((candidate: any) => String(candidate?.id || '') === sessionId)
  if (!row) return null
  const owner = String(row.userId || row.user_id || userId)
  if (owner !== userId) return null
  const processMode = String(row.processMode || row.studyMode || row.process_mode || row.study_mode || 'free')
  if (processMode !== 'free') return null
  const materialIds = (row.materialIds || row.material_ids || []).map(String).filter(Boolean)
  const selectedPages = row.selectedPages || row.selected_pages || {}
  return {
    id: sessionId,
    userId,
    processMode,
    sourceSelection: buildSourceSelectionSnapshot(materialIds, selectedPages),
  }
}
