import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';

const API = process.env.STUDYAL_API_URL || '';

const limpiarMaterias = (materias: any[]) => {
  if (!Array.isArray(materias)) return [];
  return materias.map(m => ({
    ...m,
    temas: (m.temas || []).map((t: any) => ({
      ...t,
      documentos: (t.documentos || []).map((d: any) => {
        const { archivoBase64, archivoUrl, ...resto } = d;
        return resto;
      }),
    })),
  }));
};

async function getUserId() {
  const session = await getServerSession(authOptions);
  const user = session?.user as any;
  return user?.id || null;
}

export async function GET() {
  try {
    const userId = await getUserId();

    if (!userId) {
      return NextResponse.json({ success: false, error: 'No auth' }, { status: 401 });
    }

    if (!API) {
      return NextResponse.json({ success: true, materias: [] });
    }

    const res = await fetch(`${API}/materias/by-user?userId=${encodeURIComponent(userId)}`, {
      cache: 'no-store',
    });

    const json = await res.json();

    return NextResponse.json({
      success: true,
      materias: json.materias || [],
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Error interno' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();

    if (!userId) {
      return NextResponse.json({ success: false, error: 'No auth' }, { status: 401 });
    }

    const { materias } = await request.json();
    const materiasLimpias = limpiarMaterias(materias);

    if (API) {
      await fetch(`${API}/materias/upsert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          materias: materiasLimpias,
        }),
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Error interno' }, { status: 500 });
  }
}
