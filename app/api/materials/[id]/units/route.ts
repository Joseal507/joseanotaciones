import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/auth/options';
import {
  getMaterial,
  getMaterialText,
  resolveStudyKind,
} from '../../../../../lib/materials/repository';
import { ensureMaterialTextExtraction } from '../../../../../lib/materials/textExtraction';
import { deriveSelectableUnits } from '../../../../../lib/adaptive/sourceSelection';

async function getUser() {
  const session = await getServerSession(authOptions);
  return (session?.user as any) || null;
}

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Autoridad única de "qué unidades tiene este material" para la UI de
// Elegir qué estudiar — usa exactamente deriveSelectableUnits, la misma
// función que filterTextToSelectedUnits usa para autorizar el corpus, así
// que lo que el usuario ve y lo que termina filtrado siempre coinciden.
// Solo relevante para kind 'txt' y 'web' — un material que resuelve a
// studyKind==='page' (PDF nativo, o docx/pptx/odt/rtf ya normalizados)
// devuelve units=[] a propósito: ese caso usa el picker de páginas
// existente (raster de página), no esta lista.
// Materiales Web NUNCA se re-extraen acá: su texto ya quedó cacheado al
// agregarlos (add-web/route.ts) y es la fuente autorizada permanente.
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const { id: materialId } = await context.params;
    const material = await getMaterial(materialId, user.id);
    if (!material) return NextResponse.json({ error: 'Material no encontrado' }, { status: 404 });

    if (material.conversion_status === 'processing') {
      return NextResponse.json({ error: 'MATERIAL_CONVERSION_PENDING' }, { status: 409 });
    }
    if (material.conversion_status === 'failed') {
      return NextResponse.json({ error: 'MATERIAL_CONVERSION_FAILED' }, { status: 409 });
    }

    const studyKind = resolveStudyKind(material);
    let text = (await getMaterialText(materialId))?.raw_text || '';

    if (!text && studyKind !== 'web') {
      const extraction = await ensureMaterialTextExtraction(material, user.id);
      if (extraction.status === 'error') {
        return NextResponse.json({ error: extraction.error || 'TEXT_EXTRACTION_FAILED' }, { status: 422 });
      }
      text = extraction.text || '';
    }

    const units = deriveSelectableUnits(text, studyKind);
    return NextResponse.json({ success: true, kind: studyKind, units });
  } catch (err: any) {
    console.error('materials/[id]/units error:', err);
    return NextResponse.json({ error: err?.message || 'Error interno' }, { status: 500 });
  }
}
