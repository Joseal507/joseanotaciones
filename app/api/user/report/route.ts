import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(auth || '');
    if (!user) return NextResponse.json({ error: 'No auth' }, { status: 401 });

    const { reported_user_id, reported_post_id, motivo } = await req.json();

    await supabase.from('user_reports').insert({
      reporter_id: user.id,
      reported_user_id: reported_user_id || null,
      reported_post_id: reported_post_id || null,
      motivo: motivo || '',
    });

    // Enviar email de reporte
    try {
      const { data: reporterProfile } = await supabase
        .from('user_profiles')
        .select('nombre, email')
        .eq('id', user.id)
        .single();

      const { data: reportedProfile } = reported_user_id
        ? await supabase.from('user_profiles').select('nombre, email').eq('id', reported_user_id).single()
        : { data: null };

      await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://joseanotacioness.vercel.app'}/api/notify-new-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          es_reporte: true,
          reporter: reporterProfile?.nombre || user.id,
          reported_user: reportedProfile?.nombre || reported_user_id || 'N/A',
          reported_post_id: reported_post_id || 'N/A',
          motivo: motivo || 'Sin motivo',
        }),
      });
    } catch {}

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
