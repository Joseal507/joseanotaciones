import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(auth || '');
    if (!user) return NextResponse.json({ error: 'No auth' }, { status: 401 });

    const { post_id, rating } = await req.json();
    if (rating < 1 || rating > 5) return NextResponse.json({ error: 'Rating 1-5' }, { status: 400 });

    const { data: existing } = await supabase
      .from('post_ratings')
      .select('id, rating')
      .eq('post_id', post_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (existing) {
      await supabase.from('post_ratings').update({ rating }).eq('id', existing.id);
    } else {
      await supabase.from('post_ratings').insert({ post_id, user_id: user.id, rating });
    }

    const { data: ratings } = await supabase
      .from('post_ratings')
      .select('rating')
      .eq('post_id', post_id);

    const sum = (ratings || []).reduce((a: number, r: any) => a + r.rating, 0);
    const count = (ratings || []).length;

    await supabase.from('comunidad_posts').update({ rating_sum: sum, rating_count: count }).eq('id', post_id);

    return NextResponse.json({ success: true, rating_sum: sum, rating_count: count, my_rating: rating });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
