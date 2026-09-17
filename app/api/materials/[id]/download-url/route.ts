import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/auth/options';
import { getPresignedDownloadUrl } from '../../../../../lib/materials/storage';
import { getMaterial, resolveStudyKind, resolveStudyStorageKey } from '../../../../../lib/materials/repository';


async function getUser() {
  const session = await getServerSession(authOptions);
  return (session?.user as any) || null;
}

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const material = await getMaterial(id, user.id);
    if (!material) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (material.conversion_status === 'processing') {
      return NextResponse.json({ error: 'MATERIAL_CONVERSION_PENDING', code: 'MATERIAL_CONVERSION_PENDING' }, { status: 409 });
    }
    if (material.conversion_status === 'failed') {
      return NextResponse.json({
        error: 'MATERIAL_CONVERSION_FAILED',
        code: 'MATERIAL_CONVERSION_FAILED',
        conversionError: material.conversion_error || null,
      }, { status: 409 });
    }

    // Para lectura/selección se sirve la versión de estudio (normalized.pdf
    // cuando existe) — el usuario ve "Clase.pptx" pero abre su PDF
    // convertido, misma pedagogía que un PDF real.
    const url = await getPresignedDownloadUrl(resolveStudyStorageKey(material), 3600);
    return NextResponse.json({ url, expiresIn: 3600, kind: resolveStudyKind(material) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
