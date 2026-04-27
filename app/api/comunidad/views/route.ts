import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const { post_id, tipo } = await req.json();
  try {
    const campo = tipo === 'estudiado' ? 'estudiados' : 'views';
    await supabase.rpc('increment_comunidad_stat', { p_post_id: post_id, p_campo: campo });
    return NextResponse.json({ ok: true });
  } catch {
    // Fallback manual si no existe el rpc
    const { data } = await supabase.from('comunidad_posts').select('views,estudiados').eq('id', post_id).single();
    if (data) {
      await supabase.from('comunidad_posts').update({
        [campo]: (data as any)[campo] + 1
      }).eq('id', post_id);
    }
    return NextResponse.json({ ok: true });
  }
}
