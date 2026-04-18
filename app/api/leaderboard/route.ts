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
    // ✅ Traer leaderboard
    const { data, error } = await getAdmin()
      .from('leaderboard')
      .select('user_id, nombre, xp_total, flashcards_estudiadas, racha_actual, mejor_racha, precision_global, updated_at')
      .order('xp_total', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Leaderboard error:', error.message);
      return NextResponse.json({ success: true, data: [] });
    }

    const entries = data || [];

    // ✅ Traer perfiles de todos los usuarios del leaderboard
    const userIds = entries.map((e: any) => e.user_id).filter(Boolean);

    let profiles: Record<string, any> = {};

    if (userIds.length > 0) {
      try {
        const { data: profileData } = await getAdmin()
          .from('user_profiles')
          .select('id, genero, tipo_estudiante, universidad, carrera, avatar_url, created_at')
          .in('id', userIds);

        if (profileData) {
          profileData.forEach((p: any) => {
            profiles[p.id] = p;
          });
        }
      } catch {}
    }

    // ✅ Combinar leaderboard con datos del perfil
    const enriched = entries.map((e: any) => {
      const profile = profiles[e.user_id] || {};
      return {
        ...e,
        genero: profile.genero || null,
        tipo_estudiante: profile.tipo_estudiante || null,
        universidad: profile.universidad || null,
        carrera: profile.carrera || null,
        avatar_url: profile.avatar_url || null,
        fecha_registro: profile.created_at || e.updated_at,
      };
    });

    return NextResponse.json({ success: true, data: enriched });
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
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: true });
  }
}