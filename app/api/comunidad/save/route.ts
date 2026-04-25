import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!auth) return NextResponse.json({ error: 'No auth' }, { status: 401 });
    const { data: { user } } = await supabase.auth.getUser(auth);
    if (!user) return NextResponse.json({ error: 'No auth' }, { status: 401 });

    const { data: savedIds } = await supabase
      .from('post_favorites')
      .select('post_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    const postIds = (savedIds || []).map((r: any) => r.post_id);
    if (postIds.length === 0) return NextResponse.json({ data: [] });

    const { data: posts } = await supabase
      .from('comunidad_posts')
      .select('*')
      .in('id', postIds);

    const userIds = [...new Set((posts || []).map((p: any) => p.user_id).filter(Boolean))];
    let perfilesMap: any = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, nombre, foto_url')
        .in('id', userIds);
      profiles?.forEach((p: any) => { perfilesMap[p.id] = { nombre: p.nombre, avatar_url: p.foto_url }; });
    }

    const data = (posts || []).map((p: any) => ({
      ...p,
      user_profiles: perfilesMap[p.user_id] || { nombre: 'Estudiante', avatar_url: null },
    }));

    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!auth) return NextResponse.json({ error: 'No auth' }, { status: 401 });
    const { data: { user } } = await supabase.auth.getUser(auth);
    if (!user) return NextResponse.json({ error: 'No auth' }, { status: 401 });

    const { post_id } = await req.json();

    const { data: existing } = await supabase
      .from('post_favorites')
      .select('id')
      .eq('post_id', post_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (existing) {
      await supabase.from('post_favorites').delete().eq('id', existing.id);
      return NextResponse.json({ success: true, saved: false });
    } else {
      await supabase.from('post_favorites').insert({ post_id, user_id: user.id });
      return NextResponse.json({ success: true, saved: true });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
