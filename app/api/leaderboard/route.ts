import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';
import { workerAuthHeaders } from '../../../lib/worker/auth';

const API = process.env.STUDYAL_API_URL || '';

async function getUser() {
  const session = await getServerSession(authOptions);
  return (session?.user as any) || null;
}

export async function GET() {
  try {
    if (!API) {
      return NextResponse.json({ success: true, data: [] });
    }

    const res = await fetch(`${API}/leaderboard`, { cache: 'no-store', headers: workerAuthHeaders() });
    const data = await res.json();

    return NextResponse.json({
      success: true,
      data: data.data || [],
    });
  } catch (err: any) {
    return NextResponse.json({ success: true, data: [], error: err?.message || null });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user?.id) {
      return NextResponse.json({ success: false, error: 'No auth' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));

    const payload = {
      user_id: user.id,
      email: user.email || null,
      nombre: body.nombre ?? user.name ?? user.email?.split('@')[0] ?? null,
      avatar_url: body.avatar_url ?? user.image ?? null,
      flashcards_estudiadas: body.flashcards_estudiadas ?? null,
      racha_actual: body.racha_actual ?? null,
      mejor_racha: body.mejor_racha ?? null,
      precision_global: body.precision_global ?? null,
      visible_leaderboard: body.visible_leaderboard,
      descripcion: body.descripcion ?? null,
      genero: body.genero ?? null,
      tipo_estudiante: body.tipo_estudiante ?? null,
      universidad: body.universidad ?? null,
      carrera: body.carrera ?? null,
      quizzes_completados: body.quizzes_completados ?? null,
    };

    if (API) {
      const res = await fetch(`${API}/leaderboard/upsert`, {
        method: 'POST',
        headers: workerAuthHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      return NextResponse.json({ success: true, data: data.entry || null });
    }

    return NextResponse.json({ success: true, data: null });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Error interno' }, { status: 500 });
  }
}
