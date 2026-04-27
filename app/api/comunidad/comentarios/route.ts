import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET comentarios de un post
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const post_id = searchParams.get('post_id');

  try {
    const { data, error } = await supabase
      .from('comunidad_comentarios')
      .select('*')
      .eq('post_id', post_id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return NextResponse.json({ comentarios: data || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST - crear comentario
export async function POST(req: NextRequest) {
  const { post_id, user_id, user_nombre, user_avatar, parent_id, contenido } = await req.json();
  try {
    // Verificar que comments están activos
    const { data: post } = await supabase
      .from('comunidad_posts')
      .select('comments_activos, user_id')
      .eq('id', post_id)
      .single();

    if (!post?.comments_activos) {
      return NextResponse.json({ error: 'Comentarios desactivados' }, { status: 403 });
    }

    const { data, error } = await supabase
      .from('comunidad_comentarios')
      .insert({ post_id, user_id, user_nombre, user_avatar, parent_id: parent_id || null, contenido })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ comentario: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH - editar comentario
export async function PATCH(req: NextRequest) {
  const { id, user_id, contenido } = await req.json();
  try {
    const { data: com } = await supabase.from('comunidad_comentarios').select('user_id').eq('id', id).single();
    if (com?.user_id !== user_id) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const { data, error } = await supabase
      .from('comunidad_comentarios')
      .update({ contenido, editado: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ comentario: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE - borrar comentario (dueño del comentario o dueño del post)
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const userId = searchParams.get('userId');

  try {
    const { data: com } = await supabase
      .from('comunidad_comentarios')
      .select('user_id, post_id')
      .eq('id', id)
      .single();

    const { data: post } = await supabase
      .from('comunidad_posts')
      .select('user_id')
      .eq('id', com?.post_id)
      .single();

    if (com?.user_id !== userId && post?.user_id !== userId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    await supabase.from('comunidad_comentarios').delete().eq('id', id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
