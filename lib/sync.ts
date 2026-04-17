import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ✅ Singleton para no crear clientes en cada request
let _admin: any = null;
let _auth: any = null;

const getAdmin = () => {
  if (!_admin) _admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  return _admin;
};

const getAuth = () => {
  if (!_auth) _auth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return _auth;
};

// ✅ Limpiar todo lo que sea base64 pesado
const limpiarBase64 = (obj: any): any => {
  if (typeof obj === 'string') {
    if (obj.startsWith('data:image') || obj.startsWith('data:application')) {
      return '[archivo]';
    }
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(limpiarBase64);
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const key of Object.keys(obj)) {
      // ✅ Estas keys nunca se guardan en DB
      if (['archivoBase64', 'archivoUrl'].includes(key)) continue;
      // ✅ canvasData y backgroundImage solo si son URLs (no base64)
      if (['canvasData', 'backgroundImage'].includes(key)) {
        const val = obj[key];
        if (typeof val === 'string' && val.startsWith('data:')) {
          result[key] = null; // no guardar base64 en DB
          continue;
        }
      }
      result[key] = limpiarBase64(obj[key]);
    }
    return result;
  }
  return obj;
};

async function getUser(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  try {
    const { data: { user } } = await getAuth().auth.getUser(token);
    return user;
  } catch { return null; }
}

async function upsert(tabla: string, uid: string, datos: any) {
  await getAdmin()
    .from(tabla)
    .upsert(
      { user_id: uid, ...datos, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const db = getAdmin();
    const uid = user.id;

    // ✅ Todo en paralelo para máxima velocidad
    const [mat, age, hor, set] = await Promise.all([
      db.from('materias').select('datos').eq('user_id', uid).single(),
      db.from('agenda').select('asignaciones, objetivos').eq('user_id', uid).single(),
      db.from('horario').select('datos').eq('user_id', uid).single(),
      db.from('user_settings').select('datos').eq('user_id', uid).single(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        materias: mat.data?.datos || [],
        asignaciones: age.data?.asignaciones || [],
        objetivos: age.data?.objetivos || [],
        horario: hor.data?.datos || null,
        settings: set.data?.datos || null,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const uid = user.id;
    const { tipo, datos } = await request.json();

    // ✅ Siempre limpiar base64 antes de guardar
    const datosLimpios = limpiarBase64(datos);

    if (tipo === 'materias') {
      await upsert('materias', uid, { datos: datosLimpios });
    } else if (tipo === 'agenda') {
      await upsert('agenda', uid, {
        asignaciones: datosLimpios.asignaciones || [],
        objetivos: datosLimpios.objetivos || [],
      });
    } else if (tipo === 'horario') {
      await upsert('horario', uid, { datos: datosLimpios });
    } else if (tipo === 'settings') {
      await upsert('user_settings', uid, { datos: datosLimpios });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}