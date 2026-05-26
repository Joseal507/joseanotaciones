/**
 * /api/racha
 * GET  → devuelve la racha del usuario desde Supabase
 * POST → guarda/actualiza la racha en Supabase
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const getAdmin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

async function getUser(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  try {
    const { data, error } = await getAdmin().auth.getUser(token);
    if (error || !data.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const db = getAdmin();
    const { data, error } = await db
      .from('leaderboard')
      .select('racha_actual, mejor_racha, ultimo_dia_racha, dias_estudiados')
      .eq('user_id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      racha_actual: data?.racha_actual ?? 0,
      mejor_racha: data?.mejor_racha ?? 0,
      ultimo_dia: data?.ultimo_dia_racha ?? '',
      dias_estudiados: data?.dias_estudiados ?? [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { racha_actual, mejor_racha, ultimo_dia, dias_estudiados } = body;

    if (
      typeof racha_actual !== 'number' ||
      typeof mejor_racha !== 'number' ||
      typeof ultimo_dia !== 'string'
    ) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    }

    const db = getAdmin();

    // Obtener valores actuales para nunca bajar mejor_racha
    const { data: current } = await db
      .from('leaderboard')
      .select('mejor_racha, dias_estudiados')
      .eq('user_id', user.id)
      .single();

    const mejorRachaFinal = Math.max(
      current?.mejor_racha ?? 0,
      mejor_racha,
      racha_actual,
    );

    // Merge de días estudiados
    const diasActuales: string[] = current?.dias_estudiados ?? [];
    const diasNuevos: string[] = dias_estudiados ?? [];
    const diasMerged = Array.from(new Set([...diasActuales, ...diasNuevos])).slice(-60);

    const { error } = await db
      .from('leaderboard')
      .upsert(
        {
          user_id: user.id,
          racha_actual,
          mejor_racha: mejorRachaFinal,
          ultimo_dia_racha: ultimo_dia,
          dias_estudiados: diasMerged,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, mejor_racha: mejorRachaFinal });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
