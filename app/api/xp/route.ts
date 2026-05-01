import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { calcularNivel } from '@/lib/nivelUtils';

const getAdmin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

async function getUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) {
    console.log('❌ XP: No token');
    return null;
  }
  try {
    const { data, error } = await getAdmin().auth.getUser(token);
    if (error || !data.user) {
      console.log('❌ XP auth error:', error?.message);
      return null;
    }
    return data.user;
  } catch (e: any) {
    console.log('❌ XP catch:', e.message);
    return null;
  }
}

export async function GET(req: NextRequest) {
  console.log('📥 GET /api/xp');
  try {
    const user = await getUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const db = getAdmin();
    const { data, error } = await db
      .from('leaderboard')
      .select('xp_total, xp_breakdown, nivel')
      .eq('user_id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const xpTotal = data?.xp_total ?? 0;
    const nivelCalculado = calcularNivel(xpTotal);

    console.log(`✅ XP GET: user=${user.id} xp=${xpTotal} nivel=${nivelCalculado}`);

    return NextResponse.json({
      ok: true,
      xp_total: xpTotal,
      nivel: nivelCalculado,
      xp_breakdown: data?.xp_breakdown ?? {},
    });
  } catch (e: any) {
    console.error('❌ XP GET crash:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  console.log('📥 POST /api/xp');
  try {
    const user = await getUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
    }

    const { fuente, cantidad, meta } = body;
    console.log(`📥 XP POST: fuente=${fuente} cantidad=${cantidad}`);

    const fuentesValidas = ['timer', 'flashcards', 'quiz', 'post', 'objetivo', 'login', 'racha', 'comunidad'];
    if (
      !fuente ||
      !fuentesValidas.includes(fuente) ||
      typeof cantidad !== 'number' ||
      cantidad === 0
    ) {
      console.log('❌ XP datos inválidos:', { fuente, cantidad });
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    }

    const db = getAdmin();
    const { data: current, error: errGet } = await db
      .from('leaderboard')
      .select('xp_total, xp_breakdown, nivel')
      .eq('user_id', user.id)
      .single();

    if (errGet && errGet.code !== 'PGRST116') {
      return NextResponse.json({ error: errGet.message }, { status: 500 });
    }

    const xpActual = current?.xp_total ?? 0;
    const breakdownActual = current?.xp_breakdown ?? {};
    const xpNuevo = Math.max(0, xpActual + cantidad);
    const nivelNuevo = calcularNivel(xpNuevo);
    const nivelAnterior = current?.nivel ?? calcularNivel(xpActual);

    const breakdownNuevo = {
      ...breakdownActual,
      [fuente]: (breakdownActual[fuente] ?? 0) + cantidad,
      ultima_actualizacion: new Date().toISOString(),
    };

    const { error: errUpdate } = await db
      .from('leaderboard')
      .upsert(
        {
          user_id: user.id,
          xp_total: xpNuevo,
          xp_breakdown: breakdownNuevo,
          nivel: nivelNuevo,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (errUpdate) {
      console.error('❌ XP upsert error:', errUpdate.message);
      return NextResponse.json({ error: errUpdate.message }, { status: 500 });
    }

    console.log(`✅ XP: +${cantidad} (${fuente}) → ${xpNuevo} | Nivel ${nivelAnterior}→${nivelNuevo}`);

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
    console.error('❌ XP POST crash:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
