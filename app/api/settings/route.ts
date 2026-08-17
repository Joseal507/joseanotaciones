import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedStudyALUser } from '../../../lib/auth/studyalUser';
import { workerAuthHeaders } from '../../../lib/worker/auth';

const API = process.env.STUDYAL_API_URL || '';

export async function GET() {
  try {
    const user = await getAuthenticatedStudyALUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!API) return NextResponse.json({ success: false, error: 'StudyAL API unavailable' }, { status: 503 });

    const res = await fetch(`${API}/settings/by-user?userId=${encodeURIComponent(user.id)}`, {
      cache: 'no-store',
      headers: workerAuthHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return NextResponse.json({ success: false, error: data.error || 'Settings unavailable' }, { status: res.status || 502 });
    }

    return NextResponse.json({ success: true, settings: data.settings ?? null });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Error interno' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedStudyALUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!API) return NextResponse.json({ success: false, error: 'StudyAL API unavailable' }, { status: 503 });

    const body = await req.json().catch(() => ({}));
    const settings = body?.settings && typeof body.settings === 'object' ? body.settings : {};

    // Same guard the client used to apply itself before hitting the Worker
    // directly — kept here now that this route is the only path in.
    const settingsLimpios = {
      ...settings,
      fotoPerfil:
        typeof settings.fotoPerfil === 'string' && settings.fotoPerfil.startsWith('data:') && settings.fotoPerfil.length > 500_000
          ? ''
          : settings.fotoPerfil,
    };

    const res = await fetch(`${API}/settings/upsert`, {
      method: 'POST',
      headers: workerAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ user_id: user.id, settings: settingsLimpios }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return NextResponse.json({ success: false, error: data.error || 'Settings unavailable' }, { status: res.status || 502 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Error interno' }, { status: 500 });
  }
}
