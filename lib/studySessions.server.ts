// Server-only StudySession authority: talks to the Worker directly.
// lib/studySessions.ts is client-only (window/localStorage/relative fetch)
// and cannot be reused here.
import { workerAuthHeaders } from './worker/auth';

const API = process.env.STUDYAL_API_URL || '';

export async function getSessionIdsByTemaServer(
  temaId: string,
  userId: string,
): Promise<string[]> {
  if (!API) return [];
  const res = await fetch(
    `${API}/study-sessions/by-user?userId=${encodeURIComponent(userId)}&temaId=${encodeURIComponent(temaId)}`,
    { cache: 'no-store', headers: workerAuthHeaders() },
  );
  if (!res.ok) throw new Error(`SESSIONS_BY_TEMA_FAILED:${res.status}`);
  const json = await res.json().catch(() => ({}));
  if (json?.success === false || json?.ok === false) {
    throw new Error(`SESSIONS_BY_TEMA_REJECTED:${json?.error || 'unknown'}`);
  }
  const sessions = Array.isArray(json.sessions) ? json.sessions : [];
  return sessions.map((s: any) => String(s?.id || '')).filter(Boolean);
}

export async function deleteStudySessionServer(
  id: string,
  userId: string,
): Promise<void> {
  if (!API) return;
  const res = await fetch(`${API}/study-sessions/delete`, {
    method: 'POST',
    headers: workerAuthHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ user_id: userId, id }),
  });
  if (!res.ok) throw new Error(`SESSION_DELETE_FAILED:${res.status}`);
  const json = await res.json().catch(() => ({}));
  if (json?.ok === false) throw new Error(`SESSION_DELETE_REJECTED:${json?.error || 'unknown'}`);
}
