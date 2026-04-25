import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function generarCodigo() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!auth) return NextResponse.json({ success: false }, { status: 401 });
    const { data: { user } } = await supabase.auth.getUser(auth);
    if (!user) return NextResponse.json({ success: false }, { status: 401 });

    const { post_id, accion, session_id, respuesta, pregunta_idx } = await req.json();

    if (accion === 'crear') {
      const codigo = generarCodigo();
      const { data, error } = await supabase
        .from('kahoot_sessions')
        .insert({ post_id, host_id: user.id, codigo, estado: 'esperando' })
        .select().single();
      if (error) throw error;
      return NextResponse.json({ success: true, data });
    }

    if (accion === 'unirse') {
      const { data: session } = await supabase
        .from('kahoot_sessions')
        .select('*')
        .eq('codigo', session_id)
        .single();
      if (!session) return NextResponse.json({ success: false, error: 'Sala no encontrada' });

      const nombre = req.headers.get('x-nombre') || 'Anónimo';
      const { data } = await supabase
        .from('kahoot_participantes')
        .upsert({ session_id: session.id, user_id: user.id, nombre, puntos: 0 })
        .select().single();

      return NextResponse.json({ success: true, session, participante: data });
    }

    if (accion === 'iniciar') {
      await supabase.from('kahoot_sessions')
        .update({ estado: 'activo', pregunta_actual: 0, updated_at: new Date().toISOString() })
        .eq('id', session_id)
        .eq('host_id', user.id);
      return NextResponse.json({ success: true });
    }

    if (accion === 'siguiente') {
      const { data: session } = await supabase
        .from('kahoot_sessions')
        .select('pregunta_actual')
        .eq('id', session_id)
        .single();

      await supabase.from('kahoot_sessions')
        .update({ pregunta_actual: (session?.pregunta_actual || 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', session_id);
      return NextResponse.json({ success: true });
    }

    if (accion === 'responder') {
      const { data: part } = await supabase
        .from('kahoot_participantes')
        .select('puntos, respuestas')
        .eq('session_id', session_id)
        .eq('user_id', user.id)
        .single();

      const respuestas = [...(part?.respuestas as any[] || []), { pregunta: pregunta_idx, respuesta, tiempo: Date.now() }];
      const correcta = respuesta.correcta ? (part?.puntos || 0) + 1000 : (part?.puntos || 0);

      await supabase.from('kahoot_participantes')
        .update({ puntos: correcta, respuestas })
        .eq('session_id', session_id)
        .eq('user_id', user.id);

      return NextResponse.json({ success: true, puntos: correcta });
    }

    if (accion === 'finalizar') {
      await supabase.from('kahoot_sessions')
        .update({ estado: 'finalizado', updated_at: new Date().toISOString() })
        .eq('id', session_id)
        .eq('host_id', user.id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'Acción inválida' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const codigo = searchParams.get('codigo');
    const session_id = searchParams.get('session_id');

    if (codigo) {
      const { data } = await supabase
        .from('kahoot_sessions')
        .select('*, comunidad_posts(*)')
        .eq('codigo', codigo)
        .single();
      return NextResponse.json({ success: true, data });
    }

    if (session_id) {
      const { data: session } = await supabase
        .from('kahoot_sessions')
        .select('*')
        .eq('id', session_id)
        .single();

      const { data: participantes } = await supabase
        .from('kahoot_participantes')
        .select('*')
        .eq('session_id', session_id)
        .order('puntos', { ascending: false });

      return NextResponse.json({ success: true, session, participantes });
    }

    return NextResponse.json({ success: false });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
