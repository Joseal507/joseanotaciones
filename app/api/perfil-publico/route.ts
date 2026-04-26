import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const username = searchParams.get('username');
    const userId   = searchParams.get('userId');

    if (!username && !userId) {
      return NextResponse.json({ error: 'username o userId requerido' }, { status: 400 });
    }

    let data: any = null;

    if (userId) {
      const { data: d } = await supabaseAdmin
        .from('leaderboard')
        .select('*')
        .eq('user_id', userId)
        .single();
      data = d;
    } else {
      const nombreClean = username!.trim();
      const { data: d1 } = await supabaseAdmin.from('leaderboard').select('*').eq('visible_leaderboard', true).eq('nombre', nombreClean).maybeSingle();
      if (d1) { data = d1; }
      else {
        const { data: d2 } = await supabaseAdmin.from('leaderboard').select('*').eq('visible_leaderboard', true).eq('nombre', nombreClean + ' ').maybeSingle();
        if (d2) { data = d2; }
        else {
          const { data: d3 } = await supabaseAdmin.from('leaderboard').select('*').eq('visible_leaderboard', true).ilike('nombre', `%${nombreClean}%`).limit(1).maybeSingle();
          data = d3;
        }
      }
    }

    if (!data) {
      return NextResponse.json({ error: 'Perfil no encontrado o privado' }, { status: 404 });
    }

    const { count } = await supabaseAdmin
      .from('leaderboard')
      .select('*', { count: 'exact', head: true })
      .eq('visible_leaderboard', true)
      .gt('xp_total', data.xp_total || 0);

    const { count: totalUsers } = await supabaseAdmin
      .from('leaderboard')
      .select('*', { count: 'exact', head: true })
      .eq('visible_leaderboard', true);

    return NextResponse.json({
      success: true,
      perfil: data,
      rank: (count || 0) + 1,
      totalUsers: totalUsers || 0,
    });

  } catch (err: any) {
    console.error('GET perfil-publico error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');

    // Verificar token
    const { data: userData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !userData.user) {
      console.error('Auth error:', authError);
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

    const userId = userData.user.id;
    const body = await req.json();

    console.log('PATCH perfil-publico - userId:', userId);
    console.log('PATCH perfil-publico - body:', body);

    // Campos permitidos
    const camposPermitidos: Record<string, any> = {};
    if (body.descripcion     !== undefined) camposPermitidos.descripcion     = body.descripcion?.trim()?.slice(0, 300) ?? null;
    if (body.carrera         !== undefined) camposPermitidos.carrera         = body.carrera?.trim()     || null;
    if (body.universidad     !== undefined) camposPermitidos.universidad     = body.universidad?.trim() || null;
    if (body.tipo_estudiante !== undefined) camposPermitidos.tipo_estudiante = body.tipo_estudiante?.trim() || null;
    if (body.genero          !== undefined) camposPermitidos.genero          = body.genero  || null;
    if (body.nombre          !== undefined) camposPermitidos.nombre          = body.nombre?.trim() || null;
    if (body.avatar_url      !== undefined) camposPermitidos.avatar_url      = body.avatar_url || null;

    console.log('Campos a actualizar:', camposPermitidos);

    if (Object.keys(camposPermitidos).length === 0) {
      return NextResponse.json({ error: 'Sin campos para actualizar' }, { status: 400 });
    }

    camposPermitidos.updated_at = new Date().toISOString();

    // Primero verificar que el usuario existe en leaderboard
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('leaderboard')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    console.log('Existing record:', existing, 'checkError:', checkError);

    if (!existing) {
      // No existe → insert
      const { error: insertError } = await supabaseAdmin
        .from('leaderboard')
        .insert({
          user_id: userId,
          email: userData.user.email,
          xp_total: 0,
          flashcards_estudiadas: 0,
          racha_actual: 0,
          mejor_racha: 0,
          precision_global: 0,
          visible_leaderboard: true,
          ...camposPermitidos,
        });

      if (insertError) {
        console.error('Insert error:', insertError);
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    } else {
      // Existe → update
      const { error: updateError } = await supabaseAdmin
        .from('leaderboard')
        .update(camposPermitidos)
        .eq('user_id', userId);

      if (updateError) {
        console.error('Update error:', updateError);
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    // Si cambió el nombre, actualizar también en auth metadata
    if (body.nombre) {
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: { nombre: body.nombre.trim() },
      }).then(({ error: e }) => { if (e) console.warn('No se pudo actualizar metadata:', e); });

      // Y en user_profiles si existe
      await supabaseAdmin
        .from('user_profiles')
        .update({ nombre: body.nombre.trim(), updated_at: new Date().toISOString() })
        .eq('id', userId)
        .then(({ error: e }) => { if (e) console.warn('No se pudo actualizar user_profiles:', e); });
    }

    console.log('PATCH exitoso para userId:', userId);
    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error('PATCH perfil-publico error completo:', err);
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
  }
}
