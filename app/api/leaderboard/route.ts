import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAuth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function getUserFromToken(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabaseAuth.auth.getUser(token);
  return user;
}

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('leaderboard')
      .select('nombre, xp_total, flashcards_estudiadas, racha_actual, mejor_racha, precision_global, updated_at')
      .order('xp_total', { ascending: false })
      .limit(20);

    if (error) throw error;
    return NextResponse.json({ success: true, data: data || [] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromToken(request);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { nombre, xp_total, flashcards_estudiadas, racha_actual, mejor_racha, precision_global } = body;

    const { data: existing } = await supabaseAdmin
      .from('leaderboard')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (existing) {
      await supabaseAdmin
        .from('leaderboard')
        .update({
          nombre,
          email: user.email,
          xp_total,
          flashcards_estudiadas,
          racha_actual,
          mejor_racha,
          precision_global,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);
    } else {
      await supabaseAdmin
        .from('leaderboard')
        .insert({
          user_id: user.id,
          nombre,
          email: user.email,
          xp_total,
          flashcards_estudiadas,
          racha_actual,
          mejor_racha,
          precision_global,
        });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}