import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';
import { workerAuthHeaders } from '../../../lib/worker/auth';

const API = process.env.STUDYAL_API_URL || '';

async function getUser() {
  const session = await getServerSession(authOptions);
  return (session?.user as any) || null;
}

function parseDias(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function getEntry(userId: string) {
  if (!API) return null;
  const res = await fetch(`${API}/leaderboard/by-user?userId=${encodeURIComponent(userId)}`, { cache: 'no-store', headers: workerAuthHeaders() });
  const data = await res.json().catch(() => ({}));
  return data?.entry || null;
}

async function upsert(payload: any) {
  if (!API) throw new Error('STUDYAL_API_URL no configurado');
  const res = await fetch(`${API}/leaderboard/upsert`, {
    method: 'POST',
    headers: workerAuthHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || 'leaderboard_upsert_failed');
  return data.entry || null;
}

export async function GET() {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const data = await getEntry(user.id);

    return NextResponse.json({
      ok: true,
      racha_actual: Number(data?.racha_actual ?? 0),
      mejor_racha: Number(data?.mejor_racha ?? 0),
      ultimo_dia: data?.ultimo_dia_racha ?? '',
      dias_estudiados: parseDias(data?.dias_estudiados),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { racha_actual, mejor_racha, ultimo_dia, dias_estudiados } = body;

    if (typeof racha_actual !== 'number' || typeof mejor_racha !== 'number' || typeof ultimo_dia !== 'string') {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    }

    const current = await getEntry(user.id);
    const diasActuales = parseDias(current?.dias_estudiados);
    const diasNuevos = Array.isArray(dias_estudiados) ? dias_estudiados : [];
    const diasMerged = Array.from(new Set([...diasActuales, ...diasNuevos])).slice(-60);

    const mejorRachaFinal = Math.max(
      Number(current?.mejor_racha ?? 0),
      mejor_racha,
      racha_actual,
    );

    await upsert({
      user_id: user.id,
      email: user.email || null,
      nombre: user.name || user.email?.split('@')[0] || null,
      avatar_url: user.image || null,
      racha_actual,
      mejor_racha: mejorRachaFinal,
      ultimo_dia_racha: ultimo_dia,
      dias_estudiados: JSON.stringify(diasMerged),
    });

    return NextResponse.json({ ok: true, mejor_racha: mejorRachaFinal });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

