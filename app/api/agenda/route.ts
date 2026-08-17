import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedStudyALUser } from '../../../lib/auth/studyalUser';
import { workerAuthHeaders } from '../../../lib/worker/auth';

const API = process.env.STUDYAL_API_URL || '';

export async function GET() {
  const user = await getAuthenticatedStudyALUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!API) return NextResponse.json({ error: 'StudyAL API unavailable' }, { status: 503 });
  try {
    const res = await fetch(`${API}/agenda/by-user?userId=${encodeURIComponent(user.id)}`, { cache: 'no-store', headers: workerAuthHeaders() });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Agenda unavailable' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedStudyALUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!API) return NextResponse.json({ error: 'StudyAL API unavailable' }, { status: 503 });
  try {
    const body = await req.json();
    const res = await fetch(`${API}/agenda/upsert`, {
      method: 'POST',
      headers: workerAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        user_id: user.id,
        asignaciones: Array.isArray(body.asignaciones) ? body.asignaciones : [],
        objetivos: Array.isArray(body.objetivos) ? body.objetivos : [],
      }),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Agenda unavailable' }, { status: 503 });
  }
}
