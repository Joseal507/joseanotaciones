import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const { post_id, user_id, rating } = await req.json();
  try {
    await supabase
      .from('comunidad_ratings')
      .upsert({ post_id, user_id, rating }, { onConflict: 'post_id,user_id' });

    const { data } = await supabase
      .from('comunidad_ratings')
      .select('rating')
      .eq('post_id', post_id);

    const avg = data && data.length > 0
      ? data.reduce((a, r) => a + r.rating, 0) / data.length
      : 0;

    return NextResponse.json({ avg: Math.round(avg * 10) / 10, count: data?.length || 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
