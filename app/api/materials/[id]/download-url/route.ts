import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPresignedDownloadUrl } from '../../../../../lib/materials/storage';
import { getMaterial } from '../../../../../lib/materials/repository';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return NextResponse.json({ error: 'Token invalido' }, { status: 401 });

    const material = await getMaterial(id, user.id);
    if (!material) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

    const url = await getPresignedDownloadUrl(material.storage_key, 3600);
    return NextResponse.json({ url, expiresIn: 3600 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
