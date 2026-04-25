import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(auth || '');
    if (!user) return NextResponse.json({ error: 'No auth' }, { status: 401 });

    const { target_id } = await req.json();

    const { data: existing } = await supabase
      .from('user_blocks')
      .select('id')
      .eq('blocker_id', user.id)
      .eq('blocked_id', target_id)
      .maybeSingle();

    if (existing) {
      await supabase.from('user_blocks').delete().eq('id', existing.id);
      return NextResponse.json({ blocked: false });
    } else {
      await supabase.from('user_blocks').insert({ blocker_id: user.id, blocked_id: target_id });
      return NextResponse.json({ blocked: true });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
