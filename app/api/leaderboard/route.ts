import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

let _admin: any = null;
let _auth: any = null;

const getAdmin = () => {
  if (!_admin) _admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  return _admin;
};

const getAuth = () => {
  if (!_auth) _auth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return _auth;
};

async function getUser(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  try {
    const { data: { user } } = await getAuth().auth.getUser(token);
    return user;
  } catch { return null; }
}

export async function GET() {
  try {
    const { data, error } = await getAdmin()
      .from('leaderboard')
      .select('nombre, xp_total, flashcards_estudiadas, racha_actual, mejor_racha, precision_global, updated_at')
      .order('xp_total', { ascending: false })
      .limit(50);

    if (error) {
      // ✅ Si la tabla no existe, devolver array vacío sin crashear
      console.error('Leaderboard error:', error.message);
      return NextResponse.json({ success: true, data: [] });
    }

    return NextResponse.json({ success: true, data: data || [] });
  } catch (err: any) {
    return NextResponse.json({ success: true, data: [] });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const {
      nombre, xp_total, flashcards_estudiadas,
      racha_actual, mejor_racha, precision_global,
    } = body;

    const { error } = await getAdmin()
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
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('Leaderboard POST error:', error.message);
      // ✅ No crashear si la tabla no existe
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: true });
  }
}