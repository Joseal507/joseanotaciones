import fs from "fs";

function w(path, content) {
  fs.writeFileSync(path, content.trimStart() + "\n");
  console.log("updated", path);
}

/* partner-upload -> NextAuth + R2 */
w("app/api/partner-upload/route.ts", `
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
    .replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
}

function publicUrl(key: string) {
  if (!PUBLIC_BASE) return key;
  return PUBLIC_BASE.replace(/\\/$/, '') + '/' + key;
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
    const path = \`\${folder}/\${user.id}/\${Date.now()}_\${Math.random().toString(36).slice(2, 8)}_\${clean}\`;

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
`);

/* delete-file -> solo R2 */
w("app/api/delete-file/route.ts", `
import { NextRequest, NextResponse } from 'next/server';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { r2 } from '../../../lib/materials/storage';

const BUCKET = process.env.R2_BUCKET ?? 'studyal';

function keyFromUrlOrPath(value: string) {
  try {
    if (!value.startsWith('http')) return value.replace(/^\\/+/, '');
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === BUCKET) parts.shift();
    return parts.join('/');
  } catch {
    return value.replace(/^\\/+/, '');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { archivoUrl } = await request.json();
    if (!archivoUrl) return NextResponse.json({ success: true });

    const key = keyFromUrlOrPath(archivoUrl);
    if (key) {
      try {
        await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
        console.log(\`🗑️ Borrado de R2: \${key}\`);
      } catch (e: any) {
        console.warn(\`⚠️ Error borrando de R2: \${e.message}\`);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
`);

/* storageUpload -> usa /api/partner-upload */
w("lib/storageUpload.ts", `
export async function subirBase64AlStorage(
  base64: string,
  nombre: string,
  tipo: 'canvas' | 'fondo' | 'imagen' | 'doc' = 'imagen',
): Promise<string> {
  try {
    if (!base64.startsWith('data:')) return base64;
    if (base64.length < 13000) return base64;

    const response = await fetch(base64);
    const blob = await response.blob();

    const ext = blob.type.includes('png') ? 'png'
      : blob.type.includes('jpeg') ? 'jpg'
      : blob.type.includes('pdf') ? 'pdf'
      : 'png';

    const file = new File([blob], \`\${tipo}_\${nombre}_\${Date.now()}.\${ext}\`, {
      type: blob.type || 'application/octet-stream',
    });

    const form = new FormData();
    form.append('file', file);
    form.append('folder', 'archivos');

    const res = await fetch('/api/partner-upload', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });

    const data = await res.json().catch(() => ({}));
    return data.url || base64;
  } catch (err) {
    console.error('Error subiendo al storage:', err);
    return base64;
  }
}

export async function subirFileAlStorage(
  file: File,
  tipo: 'doc' | 'imagen' = 'doc',
): Promise<string | null> {
  try {
    const form = new FormData();
    form.append('file', file);
    form.append('folder', tipo === 'doc' ? 'archivos/docs' : 'archivos/imagenes');

    const res = await fetch('/api/partner-upload', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });

    const data = await res.json().catch(() => ({}));
    return data.url || null;
  } catch (err) {
    console.error('Error subiendo archivo:', err);
    return null;
  }
}
`);

/* u/[username] -> NextAuth cookies, no Supabase token/updateUser */
const uFile = "app/u/[username]/page.tsx";
let u = fs.readFileSync(uFile, "utf8");

u = u.replace("import { supabase } from '../../../lib/supabase';", "import { getSession } from 'next-auth/react';");

u = u.replace(
`      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) return;
      const res = await fetch('/api/partners', { headers: { Authorization: 'Bearer ' + token } });`,
`      const res = await fetch('/api/partners', { credentials: 'same-origin' });`
);

u = u.replace(
`    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('No autenticado');
    const res = await fetch('/api/perfil-publico', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${token}\` },
      body: JSON.stringify(cambios),
    });`,
`    const session: any = await getSession();
    if (!session?.user?.id) throw new Error('No autenticado');
    const res = await fetch('/api/perfil-publico', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(cambios),
    });`
);

u = u.replace(
`    if (cambios.nombre) {
      await supabase.auth.updateUser({ data: { nombre: cambios.nombre } }).catch(() => {});
    }`,
`    if (cambios.nombre) {
      // NextAuth toma el nombre desde el perfil D1 en esta migración.
    }`
);

u = u.replace(
`                  const { data: s } = await supabase.auth.getSession();
                  const token = s.session?.access_token;
                  if (!token || !perfil) return;
                  await fetch('/api/partners', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ receiver_id: perfil.user_id }) });`,
`                  if (!perfil) return;
                  await fetch('/api/partners', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ receiver_id: perfil.user_id }) });`
);

u = u.replace(
`                  const { data: s } = await supabase.auth.getSession();
                  const token = s.session?.access_token;
                  const res = await fetch('/api/partners', { headers: { Authorization: 'Bearer ' + token } });
                  const data = await res.json();
                  const sol = data.solicitudes?.find((p: any) => p.partner.user_id === perfil?.user_id);
                  if (sol && token) {
                    await fetch('/api/partners', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ partner_id: sol.id, action: 'accept' }) });
                    setPartnerStatus('partner');
                  }`,
`                  const res = await fetch('/api/partners', { credentials: 'same-origin' });
                  const data = await res.json();
                  const sol = data.solicitudes?.find((p: any) => p.partner.user_id === perfil?.user_id);
                  if (sol) {
                    await fetch('/api/partners', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ partner_id: sol.id, action: 'accept' }) });
                    setPartnerStatus('partner');
                  }`
);

fs.writeFileSync(uFile, u);
console.log("patched", uFile);
