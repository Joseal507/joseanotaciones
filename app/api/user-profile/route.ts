import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedStudyALUser } from '../../../lib/auth/studyalUser';
import { workerAuthHeaders } from '../../../lib/worker/auth';

const API = process.env.STUDYAL_API_URL || '';

export async function GET(req: NextRequest) {
  try {
    void req;
    const user = await getAuthenticatedStudyALUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    if (!API) {
      return NextResponse.json({ success: false, error: 'StudyAL API unavailable' }, { status: 503 });
    }

    const res = await fetch(`${API}/profiles/by-user?userId=${encodeURIComponent(user.id)}`, {
      cache: 'no-store',
      headers: workerAuthHeaders(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ success: false, error: json.error || 'Profile unavailable' }, { status: res.status });

    if (json.profile) {
      const pr = json.profile;
      console.log('\n══════════════════════════════════════════════');
      console.log('👤 PERFIL DEL USUARIO CARGADO');
      console.log('══════════════════════════════════════════════');
      console.log('  Nombre:', pr.nombre || '—');
      console.log('  Tipo:', pr.tipo_estudiante || pr.tipo_usuario || '—');
      console.log('  Universidad:', pr.universidad || pr.escuela || '—');
      console.log('  Carrera:', pr.carrera || '—');
      console.log('  Objetivo:', pr.objetivo || '—');
      console.log('  Edad:', pr.edad || '—');
      console.log('══════════════════════════════════════════════\n');
    }

    return NextResponse.json({
      success: true,
      data: json.profile || null,
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Profile unavailable' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedStudyALUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();

    if (!API) {
      return NextResponse.json({ success: false, error: 'StudyAL API unavailable' }, { status: 503 });
    }

    const payload = {
      user_id: user.id,
      nombre: body.nombre || null,
      email: user.email,
      avatar_url: body.avatar_url || user.image,
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
      headers: workerAuthHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(payload),
    });

    // Sincronizar campos públicos al perfil-publico (leaderboard)
    // Solo campos que deben ser públicos — NUNCA edad, permiso_menor, referral_source
    try {
      if (API) {
        const publicPayload: Record<string, any> = {
          user_id: payload.user_id,
          email: payload.email,
          nombre: payload.nombre,
          avatar_url: payload.avatar_url,
        };
        if (payload.tipo_estudiante !== undefined) publicPayload.tipo_estudiante = payload.tipo_estudiante;
        if (payload.universidad !== undefined) publicPayload.universidad = payload.universidad;
        if (payload.escuela !== undefined) publicPayload.escuela = payload.escuela;
        if (payload.carrera !== undefined) publicPayload.carrera = payload.carrera;
        if (payload.descripcion !== undefined) publicPayload.descripcion = payload.descripcion;
        if (payload.genero !== undefined) publicPayload.genero = payload.genero;
        if (body.visible_leaderboard !== undefined) publicPayload.visible_leaderboard = body.visible_leaderboard;

        await fetch(`${API}/leaderboard/upsert`, {
          method: 'POST',
          headers: workerAuthHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify(publicPayload),
        });
      }
    } catch {}

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Error interno' }, { status: 500 });
  }
}
