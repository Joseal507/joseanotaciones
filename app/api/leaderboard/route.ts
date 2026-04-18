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
      .select('*')
      .order('xp_total', { ascending: false })
      .limit(50);

    if (error) {
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
      // ✅ Datos del perfil
      genero, tipo_estudiante, universidad, carrera,
      que_quieres_estudiar, avatar_url, onboarding_completo,
    } = body;

    // ✅ Obtener el registro actual para no pisar datos existentes
    const { data: existing } = await getAdmin()
      .from('leaderboard')
      .select('*')
      .eq('user_id', user.id)
      .single();

    const upsertData: any = {
      user_id: user.id,
      nombre: nombre || existing?.nombre || user.email?.split('@')[0] || 'Usuario',
      email: user.email,
      xp_total: xp_total ?? existing?.xp_total ?? 0,
      flashcards_estudiadas: flashcards_estudiadas ?? existing?.flashcards_estudiadas ?? 0,
      racha_actual: racha_actual ?? existing?.racha_actual ?? 0,
      mejor_racha: mejor_racha ?? existing?.mejor_racha ?? 0,
      precision_global: precision_global ?? existing?.precision_global ?? 0,
      updated_at: new Date().toISOString(),
    };

    // ✅ Solo actualizar datos de perfil si vienen en el body
    if (genero !== undefined) upsertData.genero = genero;
    if (tipo_estudiante !== undefined) upsertData.tipo_estudiante = tipo_estudiante;
    if (universidad !== undefined) upsertData.universidad = universidad;
    if (carrera !== undefined) upsertData.carrera = carrera;
    if (que_quieres_estudiar !== undefined) upsertData.que_quieres_estudiar = que_quieres_estudiar;
    if (avatar_url !== undefined) upsertData.avatar_url = avatar_url;
    if (onboarding_completo !== undefined) upsertData.onboarding_completo = onboarding_completo;

    // ✅ Si es el primer registro, guardar created_at
    if (!existing) {
      upsertData.created_at = new Date().toISOString();
    }

    const { error } = await getAdmin()
      .from('leaderboard')
      .upsert(upsertData, { onConflict: 'user_id' });

    if (error) {
      console.error('Leaderboard POST error:', error.message);
      return NextResponse.json({ success: false, error: error.message });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('POST error:', err);
    return NextResponse.json({ success: false, error: err.message });
  }
}