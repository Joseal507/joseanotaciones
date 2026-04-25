import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!auth) return NextResponse.json({ success: false }, { status: 401 });
    const { data: { user } } = await supabase.auth.getUser(auth);
    if (!user) return NextResponse.json({ success: false }, { status: 401 });

    // Buscar solicitudes
    const { data: amistades } = await supabase
      .from('amistades')
      .select('*')
      .or(`user_id.eq.${user.id},amigo_id.eq.${user.id}`);

    // Cargar perfiles
    const ids = new Set<string>();
    (amistades || []).forEach(a => { ids.add(a.user_id); ids.add(a.amigo_id); });
    ids.delete(user.id);

    let perfiles: Record<string, any> = {};
    if (ids.size > 0) {
      const { data: profs } = await supabase
        .from('user_profiles')
        .select('*')
        .in('id', Array.from(ids));
      if (profs) profs.forEach(p => { perfiles[p.id] = p; });

      // Fallback a leaderboard
      const missing = Array.from(ids).filter(id => !perfiles[id]);
      if (missing.length > 0) {
        const { data: leaders } = await supabase
          .from('leaderboard')
          .select('user_id, nombre, avatar_url, carrera, xp_total, racha_actual')
          .in('user_id', missing);
        if (leaders) leaders.forEach(l => { perfiles[l.user_id] = { id: l.user_id, ...l }; });
      }
    }

    // Buscar todos los usuarios para sugerir
    const { data: todosUsers } = await supabase
      .from('leaderboard')
      .select('user_id, nombre, avatar_url, carrera, universidad, xp_total, racha_actual')
      .neq('user_id', user.id)
      .order('xp_total', { ascending: false })
      .limit(20);

    return NextResponse.json({
      success: true,
      amistades: amistades || [],
      perfiles,
      sugerencias: todosUsers || [],
      myId: user.id,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!auth) return NextResponse.json({ success: false }, { status: 401 });
    const { data: { user } } = await supabase.auth.getUser(auth);
    if (!user) return NextResponse.json({ success: false }, { status: 401 });

    const { amigo_id, accion } = await req.json();

    if (accion === 'enviar') {
      const { error } = await supabase
        .from('amistades')
        .insert({ user_id: user.id, amigo_id, estado: 'pendiente' });
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (accion === 'aceptar') {
      await supabase.from('amistades')
        .update({ estado: 'aceptado' })
        .eq('user_id', amigo_id)
        .eq('amigo_id', user.id);
      return NextResponse.json({ success: true });
    }

    if (accion === 'rechazar' || accion === 'eliminar') {
      await supabase.from('amistades')
        .delete()
        .or(`and(user_id.eq.${user.id},amigo_id.eq.${amigo_id}),and(user_id.eq.${amigo_id},amigo_id.eq.${user.id})`);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'Acción inválida' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
