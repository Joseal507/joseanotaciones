import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';
import { calcularNivel } from '@/lib/nivelUtils';

const API = process.env.STUDYAL_API_URL || process.env.NEXT_PUBLIC_STUDYAL_API_URL || '';

async function getUser() {
  const session = await getServerSession(authOptions);
  return (session?.user as any) || null;
}

function parseBreakdown(value: any): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

async function getLeaderboardEntry(userId: string) {
  if (!API) return null;
  const res = await fetch(`${API}/leaderboard/by-user?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  return data?.entry || null;
}

async function upsertLeaderboard(payload: Record<string, any>) {
  if (!API) throw new Error('STUDYAL_API_URL no configurado');
  const res = await fetch(`${API}/leaderboard/upsert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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

    const entry = await getLeaderboardEntry(user.id);
    const xpTotal = Number(entry?.xp_total ?? 0);
    const nivelCalculado = calcularNivel(xpTotal);

    return NextResponse.json({
      ok: true,
      xp_total: xpTotal,
      nivel: Number(entry?.nivel ?? nivelCalculado),
      xp_breakdown: parseBreakdown(entry?.xp_breakdown),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { fuente, cantidad } = body;

    const fuentesValidas = ['timer', 'flashcards', 'quiz', 'post', 'objetivo', 'login', 'racha', 'comunidad', 'daily_reward'];
    if (!fuente || !fuentesValidas.includes(fuente) || typeof cantidad !== 'number' || cantidad === 0) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    }

    const current = await getLeaderboardEntry(user.id);
    const xpActual = Number(current?.xp_total ?? 0);
    const breakdownActual = parseBreakdown(current?.xp_breakdown);
    const xpNuevo = Math.max(0, xpActual + cantidad);
    const nivelNuevo = calcularNivel(xpNuevo);
    const nivelAnterior = Number(current?.nivel ?? calcularNivel(xpActual));

    const breakdownNuevo = {
      ...breakdownActual,
      [fuente]: Number(breakdownActual[fuente] ?? 0) + cantidad,
      ultima_actualizacion: new Date().toISOString(),
    };

    await upsertLeaderboard({
      user_id: user.id,
      email: user.email || null,
      nombre: user.name || user.email?.split('@')[0] || null,
      avatar_url: user.image || null,
      xp_total: xpNuevo,
      xp_breakdown: JSON.stringify(breakdownNuevo),
      nivel: nivelNuevo,
    });

    return NextResponse.json({
      ok: true,
      xp_ganado: cantidad,
      xp_total: xpNuevo,
      xp_anterior: xpActual,
      nivel: nivelNuevo,
      nivel_anterior: nivelAnterior,
      subio_nivel: nivelNuevo > nivelAnterior,
      fuente,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

