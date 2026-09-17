import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/auth/options';
import { objectExists } from '../../../../../lib/materials/storage';
import { getMaterial, markMaterialUploaded } from '../../../../../lib/materials/repository';
import { needsConversion, requestConversion } from '../../../../../lib/materials/conversion';
import { ensureMaterialTextExtraction } from '../../../../../lib/materials/textExtraction';
import { resolveStudyKind } from '../../../../../lib/materials/repository';
import type { CompleteUploadResponse } from '../../../../../lib/materials/types';


async function getUser() {
  const session = await getServerSession(authOptions);
  return (session?.user as any) || null;
}

export const dynamic = 'force-dynamic';
// LibreOffice puede tardar unos segundos por documento — presupuesto extra
// sobre el default. Si el plan de Vercel tiene un tope menor, esto se
// vuelve el primer candidato a mover a encolado (ver conversion.ts).
export const maxDuration = 90;

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

    // ─── Normalizar a PDF si el formato lo requiere (docx/pptx/odt/rtf) ───
    // Síncrono por simplicidad en V1 — requestConversion() ya está separado
    // como su propia función para poder moverse a una cola después sin
    // reescribir este route.
    let conversionStatus = material.conversion_status;
    if (needsConversion(material.kind) && material.conversion_status !== 'ready') {
      const result = await requestConversion({
        id: material.id,
        user_id: user.id,
        storage_key: material.storage_key,
        kind: material.kind,
        nombre: material.nombre,
      });
      conversionStatus = result.ok ? 'ready' : 'failed';
    }

    // PDF nativo: upload/complete es el owner que inicia extracción textual.
    // No depende del selector de páginas ni de visitar otra pantalla.
    let textStatus = material.text_status;
    if (resolveStudyKind(material) === 'pdf' && conversionStatus !== 'failed') {
      const extraction = await ensureMaterialTextExtraction(material, user.id);
      textStatus = extraction.status;
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
        text_status: textStatus,
        conversion_status: conversionStatus,
        created_at: material.created_at,
      },
    };

    return NextResponse.json(response);
  } catch (err: any) {
    console.error('upload/complete error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
