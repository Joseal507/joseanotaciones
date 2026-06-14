import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth/options';
import { getMaterial, hardDeleteMaterial } from '../../../../lib/materials/repository';
import { deleteFromR2 } from '../../../../lib/materials/storage';


async function getUser() {
  const session = await getServerSession(authOptions);
  return (session?.user as any) || null;
}

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;

    // ─── Auth ───
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    // ─── Verificar ownership ───
    const material = await getMaterial(id, user.id);
    if (!material) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

    // ─── Borrar de R2 ───
    try {
      await deleteFromR2(material.storage_key);
      console.log(`🗑️ R2 borrado: ${material.storage_key}`);
    } catch (e: any) {
      console.warn(`⚠️ R2 delete warning: ${e.message}`);
    }

    // ─── Soft delete en DB (cascadea material_texts y material_results) ───
    await hardDeleteMaterial(id, user.id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('material delete error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
