import { NextRequest, NextResponse } from 'next/server';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2 } from '../../../lib/materials/storage';
import { getAuthenticatedStudyALUser } from '../../../lib/auth/studyalUser';
import { ownsR2Key } from '../../../lib/materials/ownership';

const BUCKET = process.env.R2_BUCKET ?? 'studyal';

function keyFromUrlOrPath(value: string) {
  try {
    if (!value.startsWith('http')) return value.replace(/^\/+/, '');
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === BUCKET) parts.shift();
    return parts.join('/');
  } catch {
    return value.replace(/^\/+/, '');
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedStudyALUser();
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const { archivoUrl } = await request.json();
    if (!archivoUrl) return NextResponse.json({ success: true });

    const key = keyFromUrlOrPath(archivoUrl);
    if (!key) return NextResponse.json({ success: true });

    if (!ownsR2Key(key, user.id)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    try {
      await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
      console.log(`🗑️ Borrado de R2: ${key}`);
    } catch (e: any) {
      console.warn(`⚠️ Error borrando de R2: ${e.message}`);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

