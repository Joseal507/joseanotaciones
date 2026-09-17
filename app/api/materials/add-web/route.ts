import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createHash } from 'crypto';
import { authOptions } from '../../../../lib/auth/options';
import { createMaterial, saveMaterialText, markMaterialUploaded, updateMaterialTextStatus } from '../../../../lib/materials/repository';
import { extractWebMaterial } from '../../../../lib/materials/webExtract';
import { WebFetchError } from '../../../../lib/materials/webFetch';
import { workerAuthHeaders } from '../../../../lib/worker/auth';

const API = process.env.STUDYAL_API_URL || '';

async function getUser() {
  const session = await getServerSession(authOptions);
  return (session?.user as any) || null;
}

async function ownsParent(userId: string, materiaId: string, temaId: string): Promise<boolean> {
  if (!API) throw new Error('STUDYAL_API_URL no configurado');
  const response = await fetch(`${API}/materias/by-user?userId=${encodeURIComponent(userId)}`, { cache: 'no-store', headers: workerAuthHeaders() });
  if (!response.ok) throw new Error(`PARENT_LOOKUP_${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || 'PARENT_LOOKUP_INVALID');
  const materia = (data.materias || []).find((entry: any) => String(entry?.id) === materiaId);
  return Boolean(materia && (materia.temas || []).some((entry: any) => String(entry?.id) === temaId));
}

function makeId(userId: string, url: string): string {
  return `mat_${createHash('sha256').update(`${userId}:web:${url}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 24)}`;
}

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Ingesta de un material Web: fetch SSRF-safe (lib/materials/webFetch.ts) +
// extracción con Readability + segmentación por secciones
// (lib/materials/htmlSections.ts, misma autoridad que DOCX). El snapshot se
// toma UNA vez acá y se cachea en material_texts — ninguna sesión futura
// (Free/Adaptive) vuelve a descargar la URL. La URL es solo procedencia.
export async function POST(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { temaId, materiaId, url } = body || {};
    if (!temaId || !materiaId || !url || typeof url !== 'string' || !url.trim()) {
      return NextResponse.json({ error: 'Faltan parámetros: temaId, materiaId, url' }, { status: 400 });
    }

    if (!(await ownsParent(user.id, String(materiaId), String(temaId)))) {
      return NextResponse.json({ error: 'Materia/tema no encontrado' }, { status: 404 });
    }

    let extraction;
    try {
      extraction = await extractWebMaterial(url.trim());
    } catch (e: any) {
      if (e instanceof WebFetchError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: 422 });
      }
      throw e;
    }

    const materialId = makeId(user.id, extraction.finalUrl);
    const fetchedAt = new Date().toISOString();

    await createMaterial({
      id: materialId,
      user_id: user.id,
      tema_id: String(temaId),
      materia_id: String(materiaId),
      nombre: extraction.title.slice(0, 200),
      extension: 'html',
      mime_type: 'text/html',
      size_bytes: extraction.text.length,
      storage_key: '', // materiales Web no tienen objeto R2 — el snapshot vive en material_texts
      kind: 'web',
      source_url: extraction.finalUrl,
      fetched_at: fetchedAt,
    });

    await saveMaterialText(materialId, extraction.text);
    await markMaterialUploaded(materialId, user.id);
    await updateMaterialTextStatus(materialId, user.id, 'ready', {
      extracted_chars: extraction.text.length,
      pages_count: extraction.sectionsCount,
    });

    return NextResponse.json({
      success: true,
      material: {
        id: materialId,
        nombre: extraction.title,
        kind: 'web',
        source_url: extraction.finalUrl,
        fetched_at: fetchedAt,
        text_status: 'ready',
      },
    });
  } catch (err: any) {
    console.error('materials/add-web error:', err);
    return NextResponse.json({ error: err?.message || 'Error interno' }, { status: 500 });
  }
}
