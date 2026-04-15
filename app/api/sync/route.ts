import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

let _supabaseAdmin: any = null;
let _supabaseAuth: any = null;

const getSupabaseAdmin = () => {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabaseAdmin as any;
};

const getSupabaseAuth = () => {
  if (!_supabaseAuth) {
    _supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _supabaseAuth as any;
};

const limpiarMaterias = (materias: any[]) => {
  if (!Array.isArray(materias)) return [];
  return materias.map((m: any) => ({
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

async function upsert(db: any, tabla: string, uid: string, datos: any) {
  const { data: existing } = await db.from(tabla).select('id').eq('user_id', uid).single();
  if (existing) {
    await db.from(tabla).update({ ...datos, updated_at: new Date().toISOString() }).eq('user_id', uid);
  } else {
    await db.from(tabla).insert({ user_id: uid, ...datos });
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromToken(request);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const uid = user.id;
    const db = getSupabaseAdmin();

    const [materiasRes, agendaRes, horarioRes, settingsRes] = await Promise.all([
      db.from('materias').select('datos').eq('user_id', uid).single(),
      db.from('agenda').select('asignaciones, objetivos').eq('user_id', uid).single(),
      db.from('horario').select('datos').eq('user_id', uid).single(),
      db.from('user_settings').select('datos').eq('user_id', uid).single(),
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
    const db = getSupabaseAdmin();

    if (tipo === 'materias') {
      const materiasLimpias = limpiarMaterias(datos);
      await upsert(db, 'materias', uid, { datos: materiasLimpias });
    }

    if (tipo === 'agenda') {
      await upsert(db, 'agenda', uid, {
        asignaciones: datos.asignaciones,
        objetivos: datos.objetivos,
      });
    }

    if (tipo === 'horario') {
      await upsert(db, 'horario', uid, { datos });
    }

    if (tipo === 'settings') {
      await upsert(db, 'user_settings', uid, { datos });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}