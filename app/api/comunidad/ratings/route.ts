import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedStudyALUser } from '../../../../lib/auth/studyalUser';
import { workerAuthHeaders } from '../../../../lib/worker/auth';

const API = process.env.STUDYAL_API_URL || '';

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedStudyALUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!API) throw new Error('STUDYAL_API_URL no configurado');
    const body = await req.json();
    const res = await fetch(API + '/comunidad-ratings/upsert', {
      method: 'POST',
      headers: workerAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ ...body, user_id: user.id }),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
