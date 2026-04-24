import { NextRequest, NextResponse } from 'next/server';
import { generateR2Key, getPresignedUploadUrl } from '../../../lib/r2';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { fileName, contentType, userId = 'anonymous' } = await req.json();

    if (!fileName || !contentType) {
      return NextResponse.json({ error: 'fileName and contentType required' }, { status: 400 });
    }

    const key = generateR2Key(userId, fileName);
    const presignedUrl = await getPresignedUploadUrl(key, contentType);
    const r2Url = `${process.env.R2_ENDPOINT}/${process.env.R2_BUCKET || 'studyal'}/${key}`;

    return NextResponse.json({ presignedUrl, r2Url, key });
  } catch (error: any) {
    console.error('Presigned URL error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
