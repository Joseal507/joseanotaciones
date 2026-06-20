import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';

const API = process.env.STUDYAL_API_URL || process.env.NEXT_PUBLIC_STUDYAL_API_URL || '';

async function getUserId() {
  const session = await getServerSession(authOptions);
  const user = session?.user as any;
  return user?.id || null;
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId();
    if (!userId) return NextResponse.json({ success: false, error: 'No auth' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const temaId = searchParams.get('temaId') || '';

    if (!API) return NextResponse.json({ success: true, sessions: [] });

    const res = await fetch(`${API}/study-sessions/by-user?userId=${encodeURIComponent(userId)}${temaId ? `&temaId=${encodeURIComponent(temaId)}` : ''}`, {
      cache: 'no-store',
    });

    const json = await res.json();

    return NextResponse.json({
      success: true,
      sessions: json.sessions || [],
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Error interno' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId();
    if (!userId) return NextResponse.json({ success: false, error: 'No auth' }, { status: 401 });

    const body = await req.json();

    if (!API) return NextResponse.json({ success: true, session: body });

    const res = await fetch(`${API}/study-sessions/upsert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        id: body.id,
        tema_id: body.temaId,
        enfoque: body.enfoque,
        material_ids: body.materialIds || [],
        selected_pages: body.selectedPages || null,
        flashcards: body.flashcards || null,
        notes: body.notes || null,
        material_text: body.materialText || null,
        current_phase: body.currentPhase || null,
        created_at: body.createdAt || Date.now(),
        last_opened_at: body.lastOpenedAt || Date.now(),
      }),
    });

    const json = await res.json();

    return NextResponse.json({
      success: true,
      session: json.session || body,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Error interno' }, { status: 500 });
  }
}
