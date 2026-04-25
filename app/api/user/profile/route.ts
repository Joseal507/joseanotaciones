import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const uid = searchParams.get('uid');
    if (!uid) return NextResponse.json({ error: 'No uid' }, { status: 400 });

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('id, nombre, foto_url, carrera, universidad, bio, followers_count, following_count, created_at')
      .eq('id', uid)
      .single();

    const { data: posts } = await supabase
      .from('comunidad_posts')
      .select('id, tipo, titulo, emoji, color, materia, likes, favorites, views, created_at, imagen_url, descripcion')
      .eq('user_id', uid)
      .eq('es_publico', true)
      .order('created_at', { ascending: false });

    const { count: followersCount } = await supabase
      .from('user_follows')
      .select('*', { count: 'exact', head: true })
      .eq('following_id', uid);

    const { count: followingCount } = await supabase
      .from('user_follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', uid);

    return NextResponse.json({
      profile: {
        ...profile,
        followers_count: followersCount || 0,
        following_count: followingCount || 0,
      },
      posts: posts || [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
