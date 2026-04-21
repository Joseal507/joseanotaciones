import { NextRequest, NextResponse } from 'next/server';
import { r2Client } from '../../../lib/r2';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { archivoUrl } = await request.json();
    if (!archivoUrl) return NextResponse.json({ success: true });

    // ── Borrar de R2 ──
    if (archivoUrl.includes('r2.cloudflarestorage.com')) {
      try {
        const url = new URL(archivoUrl);
        const key = url.pathname.replace(/^\/[^/]+\//, '');
        await r2Client.send(new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET || 'joseanotaciones',
          Key: key,
        }));
        console.log(`🗑️ Borrado de R2: ${key}`);
      } catch (e: any) {
        console.warn(`⚠️ Error borrando de R2: ${e.message}`);
      }
    }

    // ── Borrar de Supabase Storage ──
    if (archivoUrl.includes('supabase.co')) {
      try {
        const url = new URL(archivoUrl);
        const path = url.pathname.split('/storage/v1/object/public/')[1];
        if (path) {
          const [bucket, ...rest] = path.split('/');
          await supabase.storage.from(bucket).remove([rest.join('/')]);
          console.log(`🗑️ Borrado de Supabase Storage: ${path}`);
        }
      } catch (e: any) {
        console.warn(`⚠️ Error borrando de Supabase: ${e.message}`);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
