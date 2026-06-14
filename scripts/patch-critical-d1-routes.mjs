import fs from "fs";

function w(path, content) {
  fs.writeFileSync(path, content.trimStart() + "\n");
  console.log("updated", path);
}

w("app/api/xp/route.ts", `
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
  const res = await fetch(\`\${API}/leaderboard/by-user?userId=\${encodeURIComponent(userId)}\`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  return data?.entry || null;
}

async function upsertLeaderboard(payload: Record<string, any>) {
  if (!API) throw new Error('STUDYAL_API_URL no configurado');
  const res = await fetch(\`\${API}/leaderboard/upsert\`, {
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
`);

w("app/api/racha/route.ts", `
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';

const API = process.env.STUDYAL_API_URL || process.env.NEXT_PUBLIC_STUDYAL_API_URL || '';

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
  const res = await fetch(\`\${API}/leaderboard/by-user?userId=\${encodeURIComponent(userId)}\`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  return data?.entry || null;
}

async function upsert(payload: any) {
  if (!API) throw new Error('STUDYAL_API_URL no configurado');
  const res = await fetch(\`\${API}/leaderboard/upsert\`, {
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
`);

w("app/api/perfil-publico/route.ts", `
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
  const res = await fetch(\`\${API}/leaderboard\`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  return data?.data || [];
}

async function getByUser(userId: string) {
  if (!API) return null;
  const res = await fetch(\`\${API}/leaderboard/by-user?userId=\${encodeURIComponent(userId)}\`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  return data?.entry || null;
}

async function upsert(payload: any) {
  if (!API) throw new Error('STUDYAL_API_URL no configurado');
  const res = await fetch(\`\${API}/leaderboard/upsert\`, {
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
`);

w("app/api/notif-unread/route.ts", `
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../lib/auth/options';

const API = process.env.STUDYAL_API_URL || process.env.NEXT_PUBLIC_STUDYAL_API_URL || '';

async function getUser() {
  const session = await getServerSession(authOptions);
  return (session?.user as any) || null;
}

export async function GET() {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (!API) return NextResponse.json({ unread: [] });

    const chatsRes = await fetch(\`\${API}/partner-chats/by-user?userId=\${encodeURIComponent(user.id)}\`, { cache: 'no-store' });
    const chatsData = await chatsRes.json().catch(() => ({}));
    const chats = chatsData?.chats || [];

    if (!chats.length) return NextResponse.json({ unread: [] });

    const groups: Record<string, any[]> = {};

    await Promise.all(chats.map(async (chat: any) => {
      const msgRes = await fetch(\`\${API}/partner-messages/by-chat?chatId=\${encodeURIComponent(chat.id)}\`, { cache: 'no-store' });
      const msgData = await msgRes.json().catch(() => ({}));
      const unread = (msgData?.messages || [])
        .filter((m: any) => m.sender_id !== user.id && !m.read_at && !m.deleted_at)
        .sort((a: any, b: any) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .slice(0, 50);

      if (unread.length) groups[chat.id] = unread;
    }));

    const senderIds = Array.from(new Set(Object.values(groups).flat().map((m: any) => m.sender_id)));
    const profileMap: Record<string, any> = {};

    await Promise.all(senderIds.map(async (id) => {
      const res = await fetch(\`\${API}/leaderboard/by-user?userId=\${encodeURIComponent(String(id))}\`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (data?.entry) profileMap[String(id)] = data.entry;
    }));

    const unread = Object.entries(groups).map(([chatId, mensajes]) => {
      const primer = mensajes[0];
      const p = profileMap[primer.sender_id] || {};
      return {
        chat_id: chatId,
        sender_id: primer.sender_id,
        sender_nombre: p.nombre || 'Partner',
        sender_avatar: p.avatar_url || null,
        count: mensajes.length,
        last_content: primer.content,
        last_at: primer.created_at,
      };
    });

    return NextResponse.json({ unread });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
`);
