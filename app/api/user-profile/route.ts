import { NextRequest, NextResponse } from 'next/server';

const API = process.env.STUDYAL_API_URL || '';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId requerido' }, { status: 400 });
    }

    if (!API) {
      return NextResponse.json({ success: true, data: null });
    }

    const res = await fetch(`${API}/profiles/by-user?userId=${encodeURIComponent(userId)}`, {
      cache: 'no-store',
    });

    const json = await res.json();

    return NextResponse.json({
      success: true,
      data: json.profile || null,
    });
  } catch {
    return NextResponse.json({ success: true, data: null });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.user_id && !body.id) {
      return NextResponse.json({ success: false, error: 'user_id requerido' }, { status: 400 });
    }

    if (!API) {
      return NextResponse.json({ success: true });
    }

    const payload = {
      user_id: body.user_id || body.id,
      nombre: body.nombre || null,
      email: body.email || null,
      avatar_url: body.avatar_url || null,
      descripcion: body.descripcion || null,
      genero: null,
      tipo_estudiante: body.tipo_estudiante || body.tipo_usuario || null,
      tipo_usuario: body.tipo_usuario || body.tipo_estudiante || null,
      universidad: body.universidad || null,
      escuela: body.escuela || null,
      carrera: body.carrera || null,
      edad: body.edad || null,
      es_menor: body.es_menor ?? null,
      permiso_menor: body.permiso_menor ?? null,
      referral_source: body.referral_source || null,
      objetivo: body.objetivo || null,
      onboarding_completo: body.onboarding_completo ?? true,
    };

    await fetch(`${API}/profiles/upsert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Error interno' }, { status: 500 });
  }
}
