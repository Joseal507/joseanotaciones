import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!auth) return NextResponse.json({ success: false }, { status: 401 });
    const { data: { user } } = await supabase.auth.getUser(auth);
    if (!user) return NextResponse.json({ success: false }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const con = searchParams.get('con');

    if (con) {
      // Mensajes de una conversación específica
      const { data } = await supabase
        .from('mensajes')
        .select('*')
        .or(`and(de_user_id.eq.${user.id},para_user_id.eq.${con}),and(de_user_id.eq.${con},para_user_id.eq.${user.id})`)
        .order('created_at', { ascending: true });

      // Marcar como leídos
      await supabase.from('mensajes')
        .update({ leido: true })
        .eq('para_user_id', user.id)
        .eq('de_user_id', con);

      return NextResponse.json({ success: true, data });
    }

    // Lista de conversaciones
    const { data } = await supabase
      .from('mensajes')
      .select(`*, de_profile:user_profiles!mensajes_de_user_id_fkey(nombre,avatar_url,username), para_profile:user_profiles!mensajes_para_user_id_fkey(nombre,avatar_url,username)`)
      .or(`de_user_id.eq.${user.id},para_user_id.eq.${user.id}`)
      .order('created_at', { ascending: false });

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!auth) return NextResponse.json({ success: false }, { status: 401 });
    const { data: { user } } = await supabase.auth.getUser(auth);
    if (!user) return NextResponse.json({ success: false }, { status: 401 });

    const { para_user_id, texto } = await req.json();
    if (!texto?.trim()) return NextResponse.json({ success: false, error: 'Texto vacío' });

    const { data, error } = await supabase
      .from('mensajes')
      .insert({ de_user_id: user.id, para_user_id, texto: texto.trim() })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
