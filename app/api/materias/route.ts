import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';
import { workerAuthHeaders } from '../../../lib/worker/auth';

const API = process.env.STUDYAL_API_URL || '';

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

const validateAcademicTree = (materias: any[]) => {
  if (!Array.isArray(materias) || materias.length > 200) return false;
  const ids = new Set<string>();
  for (const materia of materias) {
    if (!materia?.id || !materia?.nombre || ids.has(String(materia.id))) return false;
    ids.add(String(materia.id));
    if (!Array.isArray(materia.temas)) return false;
    for (const tema of materia.temas) {
      if (!tema?.id || !tema?.nombre || ids.has(String(tema.id))) return false;
      ids.add(String(tema.id));
      if (!Array.isArray(tema.apuntes) || !Array.isArray(tema.documentos)) return false;
      for (const entity of [...tema.apuntes, ...tema.documentos]) {
        if (!entity?.id || ids.has(String(entity.id))) return false;
        ids.add(String(entity.id));
      }
    }
  }
  return true;
};

async function getUserId() {
  const session = await getServerSession(authOptions);
  const user = session?.user as any;
  return user?.id || null;
}

export async function GET() {
  try {
    const userId = await getUserId();

    if (!userId) {
      return NextResponse.json({ success: false, error: 'No auth' }, { status: 401 });
    }

    if (!API) {
      return NextResponse.json({ success: false, error: 'Backend no configurado' }, { status: 503 });
    }

    const res = await fetch(`${API}/materias/by-user?userId=${encodeURIComponent(userId)}`, {
      cache: 'no-store',
      headers: workerAuthHeaders(),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      return NextResponse.json({ success: false, error: json.error || 'Backend unavailable' }, { status: res.status || 502 });
    }

    return NextResponse.json({
      success: true,
      materias: json.materias || [],
      revision: Number(json.revision || 0),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Error interno' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();

    if (!userId) {
      return NextResponse.json({ success: false, error: 'No auth' }, { status: 401 });
    }

    const { materias, expectedRevision } = await request.json();
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      return NextResponse.json({ success: false, error: 'expectedRevision requerido' }, { status: 400 });
    }
    const materiasLimpias = limpiarMaterias(materias);
    if (!validateAcademicTree(materiasLimpias)) {
      return NextResponse.json({ success: false, error: 'Árbol académico inválido' }, { status: 400 });
    }

    if (API) {
      const upstream = await fetch(`${API}/materias/upsert`, {
        method: 'POST',
        headers: workerAuthHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          user_id: userId,
          materias: materiasLimpias,
          expected_revision: expectedRevision,
        }),
      });
      const result = await upstream.json().catch(() => ({}));
      if (upstream.status === 409) {
        return NextResponse.json({ success: false, error: 'VERSION_CONFLICT', ...result }, { status: 409 });
      }
      if (!upstream.ok || !result.ok) {
        return NextResponse.json({ success: false, error: result.error || 'Backend unavailable' }, { status: upstream.status || 502 });
      }
      return NextResponse.json({ success: true, revision: Number(result.revision) });
    }
    return NextResponse.json({ success: false, error: 'Backend no configurado' }, { status: 503 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Error interno' }, { status: 500 });
  }
}
