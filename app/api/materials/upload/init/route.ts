import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/auth/options';
import { validateFile, sanitizeFileName } from '../../../../../lib/materials/validation';
import { generateStorageKey, getPresignedUploadUrl } from '../../../../../lib/materials/storage';
import { createMaterial } from '../../../../../lib/materials/repository';
import type { InitUploadRequest, InitUploadResponse } from '../../../../../lib/materials/types';


async function getUser() {
  const session = await getServerSession(authOptions);
  return (session?.user as any) || null;
}

export const dynamic = 'force-dynamic';

function makeId() {
  return 'mat_' + Date.now() + Math.random().toString(36).slice(2, 8);
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    // ─── Body ───
    const body: InitUploadRequest = await req.json();
    const { temaId, materiaId, files } = body;

    if (!temaId || !materiaId || !files?.length) {
      return NextResponse.json(
        { error: 'Faltan parámetros: temaId, materiaId, files' },
        { status: 400 },
      );
    }

    if (files.length > 10) {
      return NextResponse.json(
        { error: 'Máximo 10 archivos por vez' },
        { status: 400 },
      );
    }

    // ─── Validar + crear presigned URLs ───
    const uploads: InitUploadResponse['uploads'] = [];

    for (const file of files) {
      const validation = validateFile(file.name, file.size, file.type);
      if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }

      const materialId = makeId();
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
