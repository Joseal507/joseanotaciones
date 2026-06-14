import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth/options';
import { r2 } from '../../../lib/materials/storage';

const BUCKET = process.env.R2_BUCKET ?? 'studyal';
const PUBLIC_BASE =
  process.env.R2_PUBLIC_URL ||
  process.env.NEXT_PUBLIC_R2_PUBLIC_URL ||
  '';

async function getUser() {
  const session = await getServerSession(authOptions);
  return (session?.user as any) || null;
}

function safeName(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
}

function publicUrl(key: string) {
  if (!PUBLIC_BASE) return key;
  return PUBLIC_BASE.replace(/\/$/, '') + '/' + key;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const form = await req.formData();
    const file = form.get('file') as File | null;
    const folder = String(form.get('folder') || 'partner-files');

    if (!file) return NextResponse.json({ error: 'Archivo requerido' }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const clean = safeName(file.name);
    const path = `${folder}/${user.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${clean}`;

    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: path,
      Body: buffer,
      ContentType: file.type || 'application/octet-stream',
    }));

    return NextResponse.json({
      success: true,
      url: publicUrl(path),
      path,
      name: file.name,
      size: file.size,
      type: file.type,
    });
  } catch (err: any) {
    console.error('partner-upload route error:', err);
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
  }
}

