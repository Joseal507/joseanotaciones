import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/auth/options';
import { objectExists } from '../../../../../lib/materials/storage';
import { getMaterial, markMaterialUploaded } from '../../../../../lib/materials/repository';
import type { CompleteUploadResponse } from '../../../../../lib/materials/types';


async function getUser() {
  const session = await getServerSession(authOptions);
  return (session?.user as any) || null;
}

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    // ─── Body ───
    const { materialId } = await req.json();
    if (!materialId) {
      return NextResponse.json({ error: 'materialId requerido' }, { status: 400 });
    }

    // ─── Verificar ownership ───
    const material = await getMaterial(materialId, user.id);
    if (!material) {
      return NextResponse.json({ error: 'Material no encontrado' }, { status: 404 });
    }

    // ─── Verificar que el archivo llegó a R2 ───
    const exists = await objectExists(material.storage_key);
    if (!exists) {
      return NextResponse.json(
        { error: 'El archivo aún no está disponible. Reintenta en unos segundos.' },
        { status: 409 },
      );
    }
    if (material.upload_status !== 'uploaded') {
      await markMaterialUploaded(material.id, user.id);
      material.upload_status = 'uploaded';
    }

    // ─── Devolver info del material ───
    const response: CompleteUploadResponse = {
      success: true,
      material: {
        id: material.id,
        nombre: material.nombre,
        extension: material.extension,
        kind: material.kind,
        size_bytes: material.size_bytes,
        text_status: material.text_status,
        created_at: material.created_at,
      },
    };

    return NextResponse.json(response);
  } catch (err: any) {
    console.error('upload/complete error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
