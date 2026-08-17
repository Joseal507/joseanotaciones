
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';
import { workerAuthHeaders } from '../../../lib/worker/auth';

const API = process.env.STUDYAL_API_URL || '';
export const CURRENT_ONBOARDING_VERSION = 3;

export async function GET() {
  try {
    const session: any = await getServerSession(authOptions);
    const user = session?.user;
    if (!user?.id) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });

    if (!API) {
      return NextResponse.json({
        success: true,
        currentVersion: CURRENT_ONBOARDING_VERSION,
        needsOnboarding: false,
        user: { id: user.id, name: user.name, email: user.email, image: user.image },
      });
    }

    const res = await fetch(`${API}/users/by-email?email=${encodeURIComponent(user.email || '')}`, { cache: 'no-store', headers: workerAuthHeaders() });
    const data = await res.json();
    const remoteUser = data.user || null;
    const version = Number(remoteUser?.onboarding_version || 0);
    const completed = Number(remoteUser?.onboarding_completed || 0) === 1;

    return NextResponse.json({
      success: true,
      currentVersion: CURRENT_ONBOARDING_VERSION,
      needsOnboarding: !completed || version < CURRENT_ONBOARDING_VERSION,
      user: {
        ...remoteUser,
        id: user.id,
        name: remoteUser?.name || user.name,
        email: user.email,
        image: remoteUser?.image || user.image,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Error interno' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session: any = await getServerSession(authOptions);
    const user = session?.user;
    if (!user?.id) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });

    const body = await req.json();

    if (!API) return NextResponse.json({ success: true });

    const payload = {
      ...body,
      user_id: user.id,
      email: user.email,
      avatar_url: user.image || body.avatar_url || null,
      onboarding_version: CURRENT_ONBOARDING_VERSION,
    };

    const res = await fetch(`${API}/onboarding/complete`, {
      method: 'POST',
      headers: workerAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || json.ok === false) {
      return NextResponse.json({ success: false, error: json.error || 'No se pudo guardar onboarding' }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: json.profile || null });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Error interno' }, { status: 500 });
  }
}
