import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';

const API = process.env.STUDYAL_API_URL || process.env.NEXT_PUBLIC_STUDYAL_API_URL || '';

async function getUser() {
  const session = await getServerSession(authOptions);
  return (session?.user as any) || null;
}

async function getLeaderboard(): Promise<any[]> {
  if (!API) return [];
  const res = await fetch(`${API}/leaderboard`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  return data?.data || [];
}

async function getByUser(userId: string) {
  if (!API) return null;
  const res = await fetch(`${API}/leaderboard/by-user?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  return data?.entry || null;
}

async function upsert(payload: any) {
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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const username = searchParams.get('username');
    const userId = searchParams.get('userId');

    if (!username && !userId) {
      return NextResponse.json({ error: 'username o userId requerido' }, { status: 400 });
    }

    const all = await getLeaderboard();
    let perfil: any = null;

    if (userId) {
      perfil = await getByUser(userId);
    } else {
      const clean = username!.trim().toLowerCase();
      perfil =
        all.find((p: any) => String(p.nombre || '').trim().toLowerCase() === clean) ||
        all.find((p: any) => String(p.nombre || '').trim().toLowerCase() === (clean + ' ')) ||
        all.find((p: any) => String(p.nombre || '').toLowerCase().includes(clean));
    }

    if (!perfil || perfil.visible_leaderboard === 0) {
      return NextResponse.json({ error: 'Perfil no encontrado o privado' }, { status: 404 });
    }

    const visibles = all.filter((p: any) => Number(p.visible_leaderboard ?? 1) !== 0);
    const rank = visibles.filter((p: any) => Number(p.xp_total || 0) > Number(perfil.xp_total || 0)).length + 1;

    return NextResponse.json({
      success: true,
      perfil,
      rank,
      totalUsers: visibles.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const body = await req.json();

    const payload: Record<string, any> = {
      user_id: user.id,
      email: user.email || null,
      nombre: user.name || user.email?.split('@')[0] || null,
      avatar_url: user.image || null,
    };

    if (body.descripcion !== undefined) payload.descripcion = body.descripcion?.trim()?.slice(0, 300) ?? null;
    if (body.carrera !== undefined) payload.carrera = body.carrera?.trim() || null;
    if (body.universidad !== undefined) payload.universidad = body.universidad?.trim() || null;
    if (body.tipo_estudiante !== undefined) payload.tipo_estudiante = body.tipo_estudiante?.trim() || null;
    if (body.genero !== undefined) payload.genero = body.genero || null;
    if (body.nombre !== undefined) payload.nombre = body.nombre?.trim() || payload.nombre;
    if (body.avatar_url !== undefined) payload.avatar_url = body.avatar_url || null;
    if (body.visible_leaderboard !== undefined) payload.visible_leaderboard = !!body.visible_leaderboard;

    await upsert(payload);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
  }
}

