import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(auth || '');
    if (!user) return NextResponse.json({ error: 'No auth' }, { status: 401 });

    const { target_id } = await req.json();
    if (target_id === user.id) return NextResponse.json({ error: 'No puedes seguirte' }, { status: 400 });

    const { data: existing } = await supabase
      .from('user_follows')
      .select('id')
      .eq('follower_id', user.id)
      .eq('following_id', target_id)
      .maybeSingle();

    if (existing) {
      await supabase.from('user_follows').delete().eq('id', existing.id);
      await supabase.from('user_profiles').update({ followers_count: supabase.rpc('decrement', { x: 1 }) }).eq('id', target_id);
      await supabase.from('user_profiles').update({ following_count: supabase.rpc('decrement', { x: 1 }) }).eq('id', user.id);
      return NextResponse.json({ following: false });
    } else {
      await supabase.from('user_follows').insert({ follower_id: user.id, following_id: target_id });
      // Actualizar contadores con count real
      const { count: fc } = await supabase.from('user_follows').select('*', { count: 'exact', head: true }).eq('following_id', target_id);
      const { count: fwc } = await supabase.from('user_follows').select('*', { count: 'exact', head: true }).eq('follower_id', user.id);
      await supabase.from('user_profiles').update({ followers_count: fc || 0 }).eq('id', target_id);
      await supabase.from('user_profiles').update({ following_count: fwc || 0 }).eq('id', user.id);
      return NextResponse.json({ following: true });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
