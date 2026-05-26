import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { objectExists } from '../../../../../lib/materials/storage';
import { getMaterial } from '../../../../../lib/materials/repository';
import type { CompleteUploadResponse } from '../../../../../lib/materials/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // ─── Auth ───
    const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

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
