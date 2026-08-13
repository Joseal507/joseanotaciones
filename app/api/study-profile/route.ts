import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedStudyALUser } from '../../../lib/auth/studyalUser';

const API = process.env.STUDYAL_API_URL || process.env.NEXT_PUBLIC_STUDYAL_API_URL || '';

export async function GET() {
  const user = await getAuthenticatedStudyALUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!API) return NextResponse.json({ error: 'StudyAL API unavailable' }, { status: 503 });
  try {
    const res = await fetch(`${API}/study-profiles/by-user?userId=${encodeURIComponent(user.id)}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Study profile unavailable' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedStudyALUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!API) return NextResponse.json({ error: 'StudyAL API unavailable' }, { status: 503 });
  try {
    const body = await req.json();
    const res = await fetch(`${API}/study-profiles/upsert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: user.id, profile: body.profile || {} }),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Study profile unavailable' }, { status: 503 });
  }
}
