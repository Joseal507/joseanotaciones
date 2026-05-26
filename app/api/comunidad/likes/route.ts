import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const { post_id, user_id } = await req.json();
  try {
    const { data: existing } = await supabase
      .from('comunidad_likes')
      .select('id')
      .eq('post_id', post_id)
      .eq('user_id', user_id)
      .single();

    if (existing) {
      await supabase.from('comunidad_likes').delete().eq('id', existing.id);
      return NextResponse.json({ liked: false });
    } else {
      await supabase.from('comunidad_likes').insert({ post_id, user_id });
      return NextResponse.json({ liked: true });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
