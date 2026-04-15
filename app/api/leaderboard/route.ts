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

// GET - obtener todos los del leaderboard
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('leaderboard')
      .select('nombre, xp_total, flashcards_estudiadas, racha_actual, mejor_racha, precision_global, updated_at')
      .order('xp_total', { ascending: false })
      .limit(50);

    if (error) throw error;
    return NextResponse.json({ success: true, data: data || [] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// POST - upsert mis stats
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromToken(request);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { nombre, xp_total, flashcards_estudiadas, racha_actual, mejor_racha, precision_global } = body;

    // Upsert - si existe actualiza, si no existe crea
    const { error } = await supabaseAdmin
      .from('leaderboard')
      .upsert({
        user_id: user.id,
        nombre: nombre || user.email?.split('@')[0] || 'Usuario',
        email: user.email,
        xp_total: xp_total || 0,
        flashcards_estudiadas: flashcards_estudiadas || 0,
        racha_actual: racha_actual || 0,
        mejor_racha: mejor_racha || 0,
        precision_global: precision_global || 0,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}