import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ✅ Lazy init - evita top-level await
let _supabaseAdmin: ReturnType<typeof createClient> | null = null;
let _supabaseAuth: ReturnType<typeof createClient> | null = null;

const getSupabaseAdmin = () => {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabaseAdmin;
};

const getSupabaseAuth = () => {
  if (!_supabaseAuth) {
    _supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _supabaseAuth;
};

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

async function getUserFromToken(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  try {
    const { data: { user } } = await getSupabaseAuth().auth.getUser(token);
    return user;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromToken(request);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const uid = user.id;
    const supabaseAdmin = getSupabaseAdmin();

    const [materiasRes, agendaRes, horarioRes, settingsRes] = await Promise.all([
      supabaseAdmin.from('materias').select('datos').eq('user_id', uid).single(),
      supabaseAdmin.from('agenda').select('asignaciones, objetivos').eq('user_id', uid).single(),
      supabaseAdmin.from('horario').select('datos').eq('user_id', uid).single(),
      supabaseAdmin.from('user_settings').select('datos').eq('user_id', uid).single(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        materias: materiasRes.data?.datos || [],
        asignaciones: agendaRes.data?.asignaciones || [],
        objetivos: agendaRes.data?.objetivos || [],
        horario: horarioRes.data?.datos || null,
        settings: settingsRes.data?.datos || null,
      }
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromToken(request);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const uid = user.id;
    const body = await request.json();
    const { tipo, datos } = body;
    const supabaseAdmin = getSupabaseAdmin();

    if (tipo === 'materias') {
      const materiasLimpias = limpiarMaterias(datos);
      const { data: existing } = await supabaseAdmin
        .from('materias').select('id').eq('user_id', uid).single();
      if (existing) {
        await supabaseAdmin.from('materias')
          .update({ datos: materiasLimpias, updated_at: new Date().toISOString() })
          .eq('user_id', uid);
      } else {
        await supabaseAdmin.from('materias')
          .insert({ user_id: uid, datos: materiasLimpias });
      }
    }

    if (tipo === 'agenda') {
      const { data: existing } = await supabaseAdmin
        .from('agenda').select('id').eq('user_id', uid).single();
      if (existing) {
        await supabaseAdmin.from('agenda')
          .update({ asignaciones: datos.asignaciones, objetivos: datos.objetivos, updated_at: new Date().toISOString() })
          .eq('user_id', uid);
      } else {
        await supabaseAdmin.from('agenda')
          .insert({ user_id: uid, asignaciones: datos.asignaciones, objetivos: datos.objetivos });
      }
    }

    if (tipo === 'horario') {
      const { data: existing } = await supabaseAdmin
        .from('horario').select('id').eq('user_id', uid).single();
      if (existing) {
        await supabaseAdmin.from('horario')
          .update({ datos: datos, updated_at: new Date().toISOString() })
          .eq('user_id', uid);
      } else {
        await supabaseAdmin.from('horario')
          .insert({ user_id: uid, datos: datos });
      }
    }

    if (tipo === 'settings') {
      const { data: existing } = await supabaseAdmin
        .from('user_settings').select('id').eq('user_id', uid).single();
      if (existing) {
        await supabaseAdmin.from('user_settings')
          .update({ datos: datos, updated_at: new Date().toISOString() })
          .eq('user_id', uid);
      } else {
        await supabaseAdmin.from('user_settings')
          .insert({ user_id: uid, datos: datos });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}