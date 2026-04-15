import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const limpiarMaterias = (materias: any[]) => {
  if (!Array.isArray(materias)) return [];
  return materias.map(m => ({
    ...m,
    temas: (m.temas || []).map((t: any) => ({
      ...t,
      documentos: (t.documentos || []).map((d: any) => {
        const { archivoBase64, archivoUrl, ...resto } = d;
        return resto;
      }),
    })),
  }));
};

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ success: false, error: 'No auth' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('materias')
      .select('datos')
      .eq('user_id', user.id)
      .single();

    if (error || !data) {
      return NextResponse.json({ success: true, materias: [] });
    }

    return NextResponse.json({ success: true, materias: data.datos || [] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ success: false, error: 'No auth' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 401 });
    }

    const { materias } = await request.json();
    const materiasLimpias = limpiarMaterias(materias);

    const { data: existing } = await supabase
      .from('materias')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (existing) {
      await supabase
        .from('materias')
        .update({ datos: materiasLimpias, updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
    } else {
      await supabase
        .from('materias')
        .insert({ user_id: user.id, datos: materiasLimpias });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}