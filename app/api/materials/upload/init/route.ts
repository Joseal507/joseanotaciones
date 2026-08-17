import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/auth/options';
import { validateFile, sanitizeFileName } from '../../../../../lib/materials/validation';
import { generateStorageKey, getPresignedUploadUrl } from '../../../../../lib/materials/storage';
import { createMaterial } from '../../../../../lib/materials/repository';
import type { InitUploadRequest, InitUploadResponse } from '../../../../../lib/materials/types';
import { createHash } from 'crypto';
import { workerAuthHeaders } from '../../../../../lib/worker/auth';


async function getUser() {
  const session = await getServerSession(authOptions);
  return (session?.user as any) || null;
}

export const dynamic = 'force-dynamic';

function makeId(userId: string, requestId: string, index: number) {
  return `mat_${createHash('sha256').update(`${userId}:${requestId}:${index}`).digest('hex').slice(0, 24)}`;
}

async function ownsParent(userId: string, materiaId: string, temaId: string): Promise<boolean> {
  const api = process.env.STUDYAL_API_URL || '';
  if (!api) throw new Error('STUDYAL_API_URL no configurado');
  const response = await fetch(`${api}/materias/by-user?userId=${encodeURIComponent(userId)}`, { cache: 'no-store', headers: workerAuthHeaders() });
  if (!response.ok) throw new Error(`PARENT_LOOKUP_${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || 'PARENT_LOOKUP_INVALID');
  const materia = (data.materias || []).find((entry: any) => String(entry?.id) === materiaId);
  return Boolean(materia && (materia.temas || []).some((entry: any) => String(entry?.id) === temaId));
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    // ─── Body ───
    const body: InitUploadRequest = await req.json();
    const { temaId, materiaId, requestId, files } = body;

    if (!temaId || !materiaId || !requestId || !files?.length) {
      return NextResponse.json(
        { error: 'Faltan parámetros: temaId, materiaId, requestId, files' },
        { status: 400 },
      );
    }

    if (files.length > 10) {
      return NextResponse.json(
        { error: 'Máximo 10 archivos por vez' },
        { status: 400 },
      );
    }
    if (!(await ownsParent(user.id, String(materiaId), String(temaId)))) {
      return NextResponse.json({ error: 'Materia/tema no encontrado' }, { status: 404 });
    }

    // ─── Validar + crear presigned URLs ───
    const uploads: InitUploadResponse['uploads'] = [];

    for (const [index, file] of files.entries()) {
      const validation = validateFile(file.name, file.size, file.type);
      if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }

      const materialId = makeId(user.id, requestId, index);
      const safeName = sanitizeFileName(file.name);
      const key = generateStorageKey(user.id, materialId, validation.extension!);

      // Crear registro en DB (sin texto aún)
      await createMaterial({
        id: materialId,
        user_id: user.id,
        tema_id: temaId,
        materia_id: materiaId,
        nombre: file.name,
        extension: validation.extension!,
        mime_type: file.type,
        size_bytes: file.size,
        storage_key: key,
        kind: validation.kind!,
      });

      // Generar presigned URL (el frontend sube directo a R2)
      const uploadUrl = await getPresignedUploadUrl(key, file.type);

      uploads.push({
        materialId,
        uploadUrl,
        key,
        expiresIn: 300,
      });
    }

    return NextResponse.json({ uploads } satisfies InitUploadResponse);
  } catch (err: any) {
    console.error('upload/init error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
