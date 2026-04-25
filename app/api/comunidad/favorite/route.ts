import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!auth) return NextResponse.json({ success: false }, { status: 401 });
    const { data: { user } } = await supabase.auth.getUser(auth);
    if (!user) return NextResponse.json({ success: false }, { status: 401 });

    const { post_id } = await req.json();

    const { data: existing } = await supabase
      .from('post_favorites')
      .select('id')
      .eq('post_id', post_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (existing) {
      await supabase.from('post_favorites').delete().eq('id', existing.id);
    } else {
      await supabase.from('post_favorites').insert({ post_id, user_id: user.id });
    }

    const { count } = await supabase
      .from('post_favorites')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', post_id);

    await supabase
      .from('comunidad_posts')
      .update({ favorites: count || 0 })
      .eq('id', post_id);

    return NextResponse.json({ success: true, favorited: !existing, favorites: count || 0 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
