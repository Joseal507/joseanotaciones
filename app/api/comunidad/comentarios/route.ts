import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const post_id = searchParams.get('post_id');
  if (!post_id) return NextResponse.json({ data: [] });

  const { data: comentarios } = await supabase
    .from('post_comentarios')
    .select('*')
    .eq('post_id', post_id)
    .is('parent_id', null)
    .order('created_at', { ascending: true });

  const { data: respuestas } = await supabase
    .from('post_comentarios')
    .select('*')
    .eq('post_id', post_id)
    .not('parent_id', 'is', null)
    .order('created_at', { ascending: true });

  const allIds = [...(comentarios || []), ...(respuestas || [])].map((c: any) => c.user_id);
  const userIds = [...new Set(allIds)];

  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('id, nombre, foto_url')
    .in('id', userIds);

  const perfilesMap: any = {};
  profiles?.forEach((p: any) => { perfilesMap[p.id] = p; });

  const respuestasMap: any = {};
  (respuestas || []).forEach((r: any) => {
    if (!respuestasMap[r.parent_id]) respuestasMap[r.parent_id] = [];
    respuestasMap[r.parent_id].push({
      ...r,
      user_profiles: perfilesMap[r.user_id] || { nombre: 'Estudiante', foto_url: null },
    });
  });

  const data = (comentarios || []).map((c: any) => ({
    ...c,
    user_profiles: perfilesMap[c.user_id] || { nombre: 'Estudiante', foto_url: null },
    respuestas: respuestasMap[c.id] || [],
  }));

  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(auth || '');
    if (!user) return NextResponse.json({ error: 'No auth' }, { status: 401 });

    const { post_id, texto, parent_id } = await req.json();
    if (!texto?.trim()) return NextResponse.json({ error: 'Texto requerido' }, { status: 400 });

    const { data, error } = await supabase
      .from('post_comentarios')
      .insert({ post_id, user_id: user.id, texto: texto.trim(), parent_id: parent_id || null })
      .select()
      .single();

    if (error) throw error;

    if (!parent_id) {
      const { data: post } = await supabase.from('comunidad_posts').select('comentarios').eq('id', post_id).single();
      await supabase.from('comunidad_posts').update({ comentarios: (post?.comentarios || 0) + 1 }).eq('id', post_id);
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(auth || '');
    if (!user) return NextResponse.json({ error: 'No auth' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const post_owner = searchParams.get('post_owner');

    const { data: comentario } = await supabase
      .from('post_comentarios')
      .select('user_id, post_id')
      .eq('id', id)
      .single();

    if (!comentario) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

    const puedeEliminar = comentario.user_id === user.id || post_owner === user.id;
    if (!puedeEliminar) return NextResponse.json({ error: 'Sin permiso' }, { status: 403 });

    await supabase.from('post_comentarios').delete().eq('id', id);

    const { count } = await supabase
      .from('post_comentarios')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', comentario.post_id)
      .is('parent_id', null);

    await supabase.from('comunidad_posts').update({ comentarios: count || 0 }).eq('id', comentario.post_id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(auth || '');
    if (!user) return NextResponse.json({ error: 'No auth' }, { status: 401 });

    const { comentario_id, accion } = await req.json();

    if (accion === 'like') {
      const { data: existing } = await supabase
        .from('comentario_likes')
        .select('id')
        .eq('comentario_id', comentario_id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (existing) {
        await supabase.from('comentario_likes').delete().eq('id', existing.id);
        const { count } = await supabase.from('comentario_likes').select('*', { count: 'exact', head: true }).eq('comentario_id', comentario_id);
        await supabase.from('post_comentarios').update({ likes: count || 0 }).eq('id', comentario_id);
        return NextResponse.json({ liked: false, likes: count || 0 });
      } else {
        await supabase.from('comentario_likes').insert({ comentario_id, user_id: user.id });
        const { count } = await supabase.from('comentario_likes').select('*', { count: 'exact', head: true }).eq('comentario_id', comentario_id);
        await supabase.from('post_comentarios').update({ likes: count || 0 }).eq('id', comentario_id);
        return NextResponse.json({ liked: true, likes: count || 0 });
      }
    }

    return NextResponse.json({ error: 'Acción inválida' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
