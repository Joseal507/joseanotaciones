import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { post_id } = await req.json();

    const { error } = await supabase.rpc('increment_views', { post_id_input: post_id });

    if (error) {
      // Fallback manual si no existe la función RPC
      const { data } = await supabase
        .from('comunidad_posts')
        .select('views')
        .eq('id', post_id)
        .single();

      await supabase
        .from('comunidad_posts')
        .update({ views: (data?.views || 0) + 1 })
        .eq('id', post_id);
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false });
  }
}
