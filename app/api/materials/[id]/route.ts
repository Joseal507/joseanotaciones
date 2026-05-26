import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getMaterial, hardDeleteMaterial } from '../../../../lib/materials/repository';
import { deleteFromR2 } from '../../../../lib/materials/storage';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;

    // ─── Auth ───
    const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });

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
